//! Agent Foundry desktop shell.
//!
//! A thin Tauri host around the React UI. It owns exactly three concerns:
//!
//! 1. Resolving where the plugin's bridge lives and what token talks to it,
//!    from CLI arguments, the environment, or the handshake file — in that order.
//! 2. Handing that to the WebView through one command, so the token never
//!    appears in a URL, a history entry or a referrer.
//! 3. Guaranteeing a single window: launching the app again focuses the window
//!    that already exists instead of opening another.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, WebviewWindow};

/// What the WebView needs to reach the plugin. Returned by `bridge_config`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeConfig {
    pub url: String,
    pub token: String,
    pub directory: String,
    pub protocol: u32,
}

/// The handshake file the plugin writes to `<project>/.agent-foundry/desktop.json`.
#[derive(Debug, Deserialize, Serialize)]
struct BridgeHandshake {
    protocol: u32,
    url: String,
    token: String,
    directory: String,
    #[serde(default)]
    pid: u32,
    #[serde(default)]
    started_at: String,
}

/// Shared, mutable bridge configuration.
///
/// Mutable because a relaunch can carry a *newer* token: the plugin rotates it
/// on every restart, so a window that outlived a plugin reload must be able to
/// pick up the new one rather than sitting on a token that no longer works.
#[derive(Default, Clone)]
pub struct AppState {
    bridge_config: Arc<Mutex<Option<BridgeConfig>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            bridge_config: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_config(&self, config: BridgeConfig) {
        if let Ok(mut guard) = self.bridge_config.lock() {
            *guard = Some(config);
        }
    }

    pub fn get_config(&self) -> Option<BridgeConfig> {
        self.bridge_config.lock().ok().and_then(|guard| guard.clone())
    }
}

/// Reads the handshake the plugin wrote for `directory`.
fn read_handshake(directory: &Path) -> Result<BridgeConfig, String> {
    let path = directory.join(".agent-foundry").join("desktop.json");
    let content =
        fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let handshake: BridgeHandshake =
        serde_json::from_str(&content).map_err(|e| format!("cannot parse {}: {e}", path.display()))?;
    Ok(BridgeConfig {
        url: handshake.url,
        token: handshake.token,
        directory: handshake.directory,
        protocol: handshake.protocol,
    })
}

/// Resolves the bridge config from one launch's arguments and environment.
///
/// Split out from `parse_bridge_args` so it can be tested without touching the
/// real process environment.
fn resolve_bridge_config(
    args: &[String],
    env_url: Option<String>,
    env_token: Option<String>,
    env_directory: Option<String>,
) -> Result<BridgeConfig, String> {
    let mut url: Option<String> = None;
    let mut token: Option<String> = None;
    let mut directory: Option<String> = None;

    let mut index = 1;
    while index < args.len() {
        let take = |i: usize, flag: &str| -> Result<String, String> {
            args.get(i + 1)
                .cloned()
                .ok_or_else(|| format!("{flag} requires a value"))
        };
        match args[index].as_str() {
            "--url" => {
                url = Some(take(index, "--url")?);
                index += 2;
            }
            "--token" => {
                token = Some(take(index, "--token")?);
                index += 2;
            }
            "--directory" => {
                directory = Some(take(index, "--directory")?);
                index += 2;
            }
            _ => index += 1,
        }
    }

    let url = url.or(env_url).filter(|value| !value.is_empty());
    let token = token.or(env_token).filter(|value| !value.is_empty());
    let directory = directory.or(env_directory).filter(|value| !value.is_empty());

    if let (Some(url), Some(token)) = (url, token) {
        return Ok(BridgeConfig {
            url,
            token,
            directory: directory.unwrap_or_else(|| ".".to_string()),
            protocol: 1,
        });
    }

    // Nothing on the command line: fall back to the file the plugin wrote.
    let directory =
        directory.ok_or_else(|| "need --url and --token, or --directory to read the handshake".to_string())?;
    read_handshake(&PathBuf::from(directory))
}

fn parse_bridge_args() -> Result<BridgeConfig, String> {
    let args: Vec<String> = std::env::args().collect();
    resolve_bridge_config(
        &args,
        std::env::var("FOUNDRY_BRIDGE_URL").ok(),
        std::env::var("FOUNDRY_BRIDGE_TOKEN").ok(),
        std::env::var("FOUNDRY_PROJECT_DIR").ok(),
    )
}

/// The only command exposed to the WebView.
#[tauri::command]
async fn bridge_config(state: tauri::State<'_, AppState>) -> Result<BridgeConfig, String> {
    match state.get_config() {
        Some(config) => {
            // Debug builds only: confirms the WebView reached the shell, which
            // is the first thing to check when the UI shows "disconnected".
            #[cfg(debug_assertions)]
            eprintln!("agent-foundry: bridge_config -> {}", config.url);
            Ok(config)
        }
        None => Err("the desktop shell was started without a bridge configuration".to_string()),
    }
}

/// Emitted to the page when a second launch asks for an existing window.
pub const REOPEN_EVENT: &str = "foundry://reopen";

/// Appends a diagnostic line when FOUNDRY_DESKTOP_PROBE is set.
///
/// A release build has no console and no devtools, so when the window misbehaves
/// there is otherwise nothing to read. Off by default; costs nothing when unset.
fn probe_log(line: &str) {
    if std::env::var("FOUNDRY_DESKTOP_PROBE").is_err() {
        return;
    }
    let path = std::env::temp_dir().join("foundry-shell.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(file, "{line}");
    }
}

/// Brings a window to the front from a background thread or a second launch.
fn focus(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn run() {
    let state = AppState::new();
    let initial = parse_bridge_args();
    let single_instance_state = state.clone();

    tauri::Builder::default()
        // Registered first so a second launch is intercepted before anything
        // else initialises. The callback is what makes "open it again" mean
        // "bring the existing window forward".
        .plugin(
            tauri_plugin_single_instance::Builder::new()
                .callback(move |app, argv, cwd| {
                    probe_log(&format!("second-instance argv={argv:?} cwd={cwd}"));
                    // A relaunch carries a newer token whenever the plugin has
                    // restarted, because it rotates the token on every start.
                    match resolve_bridge_config(&argv, None, None, Some(cwd)) {
                        Ok(config) => {
                            probe_log(&format!("second-instance resolved url={}", config.url));
                            single_instance_state.set_config(config);
                        }
                        Err(error) => probe_log(&format!("second-instance resolve FAILED: {error}")),
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        focus(&window);
                        // Tell the page to reconnect NOW. Focusing a native
                        // window does not reliably raise a DOM focus event, and
                        // without this the user waits out the reconnect backoff
                        // — up to half a minute — staring at "Disconnected"
                        // after explicitly asking for the board.
                        match window.emit(REOPEN_EVENT, ()) {
                            Ok(()) => probe_log("second-instance emitted reopen"),
                            Err(error) => probe_log(&format!("second-instance emit FAILED: {error}")),
                        }
                        if std::env::var("FOUNDRY_DESKTOP_PROBE").is_ok() {
                            // A separate collector can be pointed at with
                            // FOUNDRY_PROBE_URL; otherwise the bridge itself.
                            let url = std::env::var("FOUNDRY_PROBE_URL").ok().unwrap_or_else(|| {
                                single_instance_state
                                    .get_config()
                                    .map(|c| c.url)
                                    .unwrap_or_default()
                            });
                            let _ = window.eval(&format!(
                                "setTimeout(function(){{fetch('{url}/api/health?reopen=1'                                 +'&status='+(window.__foundryStatus||'none'));}},1200);"
                            ));
                        }
                    }
                })
                .build(),
        )
        .manage(state.clone())
        .setup(move |app| {
            match &initial {
                Ok(config) => state.set_config(config.clone()),
                Err(error) => {
                    // Not fatal: the UI renders a "cannot reach the plugin"
                    // state, which is more useful than refusing to start.
                    eprintln!("agent-foundry: {error}");
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                focus(&window);
                // Opt-in diagnostic for "the window opened but shows nothing".
                // Reports back over the bridge what the page actually contains,
                // which is otherwise invisible in a release build with no
                // devtools. Off unless FOUNDRY_DESKTOP_PROBE is set.
                if std::env::var("FOUNDRY_DESKTOP_PROBE").is_ok() {
                    let url = state.get_config().map(|c| c.url).unwrap_or_default();
                    let _ = window.eval(&format!(
                        "setTimeout(function(){{var r=document.getElementById('root');\
                         fetch('{url}/api/health?probe=1'\
                         +'&internals='+(('__TAURI_INTERNALS__' in window)?1:0)\
                         +'&root='+(r?r.childElementCount:-1)\
                         +'&scripts='+document.scripts.length\
                         +'&err='+encodeURIComponent(String(window.__foundryError||'none'))\
                         +'&text='+encodeURIComponent(document.body.innerText.slice(0,150)));}},2500);\
                         window.addEventListener('error',function(e){{window.__foundryError=e.message;}});"
                    ));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bridge_config])
        .run(tauri::generate_context!())
        .expect("failed to start the Agent Foundry desktop shell");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn args(list: &[&str]) -> Vec<String> {
        std::iter::once("agent-foundry.exe".to_string())
            .chain(list.iter().map(|s| s.to_string()))
            .collect()
    }

    #[test]
    fn parses_flags() {
        let config = resolve_bridge_config(
            &args(&["--url", "http://127.0.0.1:3000", "--token", "abc", "--directory", "/p"]),
            None,
            None,
            None,
        )
        .expect("should parse");
        assert_eq!(config.url, "http://127.0.0.1:3000");
        assert_eq!(config.token, "abc");
        assert_eq!(config.directory, "/p");
        assert_eq!(config.protocol, 1);
    }

    #[test]
    fn flags_take_precedence_over_environment() {
        let config = resolve_bridge_config(
            &args(&["--url", "http://127.0.0.1:1", "--token", "flag"]),
            Some("http://127.0.0.1:2".into()),
            Some("env".into()),
            None,
        )
        .expect("should parse");
        assert_eq!(config.url, "http://127.0.0.1:1");
        assert_eq!(config.token, "flag");
    }

    #[test]
    fn falls_back_to_environment() {
        let config = resolve_bridge_config(
            &args(&[]),
            Some("http://127.0.0.1:4000".into()),
            Some("env-token".into()),
            Some("/from-env".into()),
        )
        .expect("should parse");
        assert_eq!(config.url, "http://127.0.0.1:4000");
        assert_eq!(config.directory, "/from-env");
    }

    #[test]
    fn empty_environment_values_are_ignored() {
        let error = resolve_bridge_config(&args(&[]), Some(String::new()), Some(String::new()), None)
            .expect_err("empty values must not count as supplied");
        assert!(error.contains("--url"));
    }

    #[test]
    fn falls_back_to_the_handshake_file() {
        let dir = TempDir::new().expect("temp dir");
        let foundry = dir.path().join(".agent-foundry");
        fs::create_dir_all(&foundry).expect("create dir");
        let handshake = BridgeHandshake {
            protocol: 1,
            url: "http://127.0.0.1:12345".into(),
            token: "from-file".into(),
            directory: dir.path().to_string_lossy().to_string(),
            pid: 9999,
            started_at: "2026-01-01T00:00:00Z".into(),
        };
        let mut file = fs::File::create(foundry.join("desktop.json")).expect("create file");
        file.write_all(serde_json::to_string(&handshake).unwrap().as_bytes())
            .expect("write");

        let config = resolve_bridge_config(
            &args(&["--directory", &dir.path().to_string_lossy()]),
            None,
            None,
            None,
        )
        .expect("should read the handshake");
        assert_eq!(config.token, "from-file");
        assert_eq!(config.url, "http://127.0.0.1:12345");
    }

    #[test]
    fn reports_a_missing_handshake_clearly() {
        let dir = TempDir::new().expect("temp dir");
        let error = resolve_bridge_config(
            &args(&["--directory", &dir.path().to_string_lossy()]),
            None,
            None,
            None,
        )
        .expect_err("no handshake exists");
        assert!(error.contains("cannot read"), "unexpected error: {error}");
    }

    #[test]
    fn a_flag_without_a_value_is_an_error() {
        let error = resolve_bridge_config(&args(&["--url"]), None, None, None)
            .expect_err("missing value");
        assert!(error.contains("--url requires a value"));
    }

    #[test]
    fn state_starts_empty_and_accepts_updates() {
        let state = AppState::new();
        assert!(state.get_config().is_none());
        let config = BridgeConfig {
            url: "http://127.0.0.1:8000".into(),
            token: "first".into(),
            directory: "/test".into(),
            protocol: 1,
        };
        state.set_config(config.clone());
        assert_eq!(state.get_config().unwrap(), config);

        // A relaunch after a plugin restart must replace a stale token.
        let rotated = BridgeConfig { token: "second".into(), ..config };
        state.set_config(rotated.clone());
        assert_eq!(state.get_config().unwrap().token, "second");
    }
}

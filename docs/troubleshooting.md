# Troubleshooting

Common problems and their solutions.

## Symptom → cause → fix

### Plugin not loading

**Symptom**: `/foundry` command does not exist.

**Causes**:
- The plugin is not installed or not referenced in `opencode.json`.
- The plugin path in `opencode.json` is malformed.
- The plugin entry point cannot be found.
- The plugin built output does not exist.

**Fix**:
1. Verify the entry in `opencode.json` is a published package name or a local path
   (`file://`, `./`, or an absolute path):
   ```json
   {
     "plugin": ["opencode-agent-foundry"]
   }
   ```
   or from source:
   ```json
   {
     "plugin": ["./path/to/opencode-agent-foundry"]
   }
   ```
   or:
   ```json
   {
     "plugin": ["file:///absolute/path/to/opencode-agent-foundry"]
   }
   ```

2. For a source install, verify the built output exists:
   ```bash
   ls dist/index.js
   ```
   If missing, rebuild: `npm run build`.

3. Restart OpenCode.

4. Verify the orchestrator loaded with `/foundry-help`.

### Orchestrator missing from the picker

**Symptom**: The `/foundry` command does not appear in the chat, or when you try to invoke
it, OpenCode says "agent not found".

**Causes**:
- The plugin loaded but the agents were not registered.
- The config hook failed silently (common with malformed `opencode.json`).
- An existing user agent definition is named `orchestrator` and is preventing the plugin
  from registering its own.

**Fix**:
1. Check `opencode.json` for syntax errors (must be valid JSON).

2. If you have a custom `orchestrator` agent in your user configuration, remove it or
   rename it. The plugin contributes its own orchestrator, and user definitions take
   precedence — yours will win and will not have the foundry tools.

3. Restart OpenCode and try again.

### Tools missing

**Symptom**: Commands like `foundry_setup`, `foundry_start`, or `/foundry` work, but other
tools like `foundry_plan`, `foundry_execute` or `/foundry-board` are not available in a
reasoning role (architect, lead, analyst) or the builder agent.

**Causes**:
- The agent that is running does not have permission to use those tools.
- The tools were not registered.

**Fix**:
1. From a source checkout, verify all 20 tools register:
   ```bash
   npm run smoke
   ```
   This checks that the plugin loads, all tools are defined, and agents register.

2. Check which agent is active in your chat session. Tool access by role:
   - **Orchestrator**: all 20 tools.
   - **Reasoning roles** (architect, lead, analyst): cannot use `foundry_setup`. They
     work by reporting results upward.
   - **Builder**: cannot use `foundry_setup`, `foundry_plan`, `foundry_apply_plan`,
     `foundry_next`, `foundry_ask`, or `foundry_answer`. The orchestrator dispatches
     the builder with only its task and records results itself.

   This design keeps each role focused on its scope.

3. If you need all tools, invoke the orchestrator directly. Slash commands like `/foundry`
   and `/foundry-board` always invoke the orchestrator.

### Missing binary for `/foundry-ui`

**Symptom**: Running `/foundry-ui` returns an error: "The desktop console binary has not been
built yet. Run npm run desktop:doctor to check prerequisites, then npm run
desktop:build."

**Causes**:
- The desktop binary has not been built.
- The binary was built but is not in the expected location.
- A downloaded binary was placed in the wrong directory.

**Fix**:
1. Check prerequisites:
   ```bash
   npm run desktop:doctor
   ```
   This will report what is missing and print the exact command to install it.

2. Build the desktop console binary:
   ```bash
   npm run desktop:build
   ```
   On Windows with Git Bash, build from PowerShell instead.

3. Verify the binary exists:
   ```bash
   # Windows:
   ls src-tauri/target/release/*.exe
   # macOS:
   ls "src-tauri/target/release/Agent Foundry.app"
   # Linux:
   ls src-tauri/target/release/opencode-agent-foundry-desktop
   ```

4. If downloading a prebuilt binary, place it in `src-tauri/target/release/`:
   ```bash
   mv ~/Downloads/agent-foundry-desktop-* src-tauri/target/release/
   ```
   Then try `/foundry-ui` again.

### Window opens but shows disconnected

**Symptom**: The console window launches, briefly shows a loading state, then displays
"Disconnected — Retry" persistently. The Events feed may show older events, but nothing
updates.

**Causes**:
- The bridge is not running (it is created lazily on first `/foundry-ui`).
- The bridge started but closed (e.g., plugin stopped or reloaded).
- The token in memory does not match the one in the handshake file (plugin restarted).
- The handshake file is corrupt or unreadable.

**Fix**:
1. Enable diagnostics (see [Diagnostics](desktop.md#diagnostics)):
   ```bash
   export FOUNDRY_DESKTOP_PROBE=1
   ```
   Then reopen the window. Look for error messages in the console or probe output.

2. Click the "Retry" button. This forces a fresh read of the handshake file.

3. If "Retry" does not help, close the window and run `/foundry-ui` again.

4. Verify the handshake file exists and is readable:
   ```bash
   ls -la .agent-foundry/desktop.json
   ```
   It should be owned by the current user with mode 0600. If it is missing, the bridge
   may not have started — check the plugin's terminal for errors.

5. Restart the plugin (reload OpenCode or exit and restart).

### Preset reports unreachable roles

**Symptom**: In the setup screen, a preset shows a badge "N roles unreachable" and one
or more roles report "inherits from chat — not reachable".

**Causes**:
- A preset's candidate model is not available on your account.
- The model is spelled differently in the OpenCode catalogue.
- The account does not have access to that model provider.

**Fix**:
1. On the setup screen, choose "Choose per role" instead of a preset. You will pick the
   first available model for each role from your account's catalogue.

2. For each role, select a model you have access to.

3. Click "Save setup". The configuration is written immediately.

### Apply plan refused

**Symptom**: Trying to apply a plan returns an error: "Cannot apply PLAN-001: Q01, Q02
still unanswered. Put the questions to the human and record the answers with foundry_answer
first — a plan built on a guess costs more to undo than to delay."

**Causes**:
- One or more questions asked during planning are still unanswered.
- The human has not replied to all questions yet.

**Fix**:
1. Check which questions are unanswered with `agentfoundry status` (the "Waiting on you"
   section), or view the Dashboard "Questions" card in the desktop console.

2. Provide answers to each question. The orchestrator records them with
   `foundry_answer` automatically.

3. Then apply the plan again.

This guard exists because building a plan on incomplete information is expensive — the
plan often needs rework, and the rework itself is costly. Answering the questions first
costs less total.

### Execute refused

**Symptom**: Running `foundry_execute` (or `/foundry-next` then manually running) fails
with one of these errors:
- "Nothing to execute yet: the project is still CLARIFYING. Record the answers with
  foundry_answer, then plan."
- "Nothing to execute yet: the project is still PLANNING. Produce a plan with foundry_plan
  and apply it with foundry_apply_plan."
- From `foundry_doctor`: "cycles", "missing dependencies", or "unmet dependencies" errors.

**Causes**:
- The project is in CLARIFYING or PLANNING phase; no tasks exist to run yet.
- The dependency graph has a cycle (task A depends on B, B depends on A).
- A task depends on a nonexistent task ID.
- A task depends on another task that is not DONE.

**Fix**:
1. Check the project phase:
   ```bash
   agentfoundry status
   ```

2. If in CLARIFYING phase, answer all questions first. The orchestrator will record them
   automatically.

3. If in PLANNING phase, ask the orchestrator to create and apply a plan. Use
   `/foundry-next` to run the ready tasks.

4. Run the doctor to check for dependency errors:
   ```bash
   agentfoundry doctor
   ```
   Look for "cycles" or "missing dependencies". If a cycle exists, remove or change one
   `depends_on` reference. The orchestrator can replan and apply the new plan.

### Evidence rejected

**Symptom**: A task completes with `foundry_complete` but is marked FAILED instead of
moving to REVIEW. The error lists reasons like:
- "no evidence supplied — report files, commands and tests"
- "no files created, modified or deleted"
- "no tests executed"
- "tests failed"
- "files outside allowed_files: src/some-file.js"

**Causes**:
- The builder did not provide evidence (files, commands, tests).
- The builder reported passing tests without actually running any.
- The builder edited files outside the task's declared scope.
- Tests ran but did not pass.

**Fix**:
1. Verify the task's `allowed_files` and `acceptance_criteria`:
   ```bash
   agentfoundry task <id> --detail
   ```

2. Ensure evidence includes:
   - **files_created**, **files_modified**, and/or **files_deleted** — at least one.
   - **tests_executed** — a non-empty list of test commands that actually ran.
   - **test_result** — must be exactly `"pass"`. Anything else (including `"skip"` or
     empty) fails validation.

3. If files outside `allowed_files` were edited, either:
   - The task's scope was wrong and needs updating (escalate to the analyst/lead).
   - The builder edited files it should not have (re-run the task).

4. Rerun the task or escalate to a human for guidance:
   ```bash
   agentfoundry task <id> --detail  # See the rejection reason
   ```
   Ask the orchestrator to escalate the task to a more senior role or pause for review.

### Tasks deferred by file locks

**Symptom**: The board shows tasks in READY status, but `foundry_next` or `foundry_execute`
reports "deferred: file lock held by <task_id>". The same tasks never run, even when
others complete.

**Causes**:
- Two independent tasks are declared to edit overlapping files.
- `execution.allow_file_overlap` is false (the default).
- The scheduler defers one task to avoid concurrent modifications to the same file.

**Fix**:
1. Check the doctor report:
   ```bash
   agentfoundry doctor
   ```
   It lists tasks with file overlaps and suggests which ones cannot run in parallel.

2. Either:
   - **Replan**: Update the plan so overlapping tasks run sequentially (add a `depends_on`
     from one to the other).
   - **Allow overlaps** (if confident the tasks will not conflict): Edit `agent-foundry.json`
     and set `execution.allow_file_overlap` to true. Then retry. Note: this can lead to
     file conflicts at runtime.
   - **Increase the parallelism ceiling**: If the ceiling is low, edit `agent-foundry.json`
     to raise `execution.max_parallel`, or use the desktop console Settings to adjust
     "Concurrent builders". This allows more independent tasks to run sooner.

### Cost limit warning issued

**Symptom**: A task completes with `foundry_complete` and includes a `cost_warning` field
in the result, indicating that an estimate exceeded a cost limit (
`limits.max_cost_per_task_usd` or `limits.max_cost_per_project_usd`).

**Causes**:
- The estimated cost for the operation exceeded a configured limit.
- Token estimates for the role's context packet are high (large board, many tasks).

Note: cost limits are advisory. They do not stop execution; the operation completes and
the orchestrator records the warning so you can decide whether to continue.

**Fix**:
1. Review the warning in the completion result. Check current cost totals:
   ```bash
   agentfoundry status
   ```

2. To increase the limits, edit the project config file `agent-foundry.json`:
   ```json
   {
     "limits": {
       "max_cost_per_task_usd": 2.00,
       "max_cost_per_project_usd": 50.00
     }
   }
   ```
   Set to 0 to disable a limit.

3. To reduce token usage and bring estimated costs down, lower context budgets per role
   in `agent-foundry.json`:
   ```json
   {
     "context": {
       "builder": 4000
     }
   }
   ```
   Smaller budgets trim packets sooner, but roles see less context.

### Windows cargo not on PATH in Git Bash

**Symptom**: Running `npm run desktop:build` from Git Bash exits with 0 but produces no
binary. The message says "cargo not found" or similar.

**Causes**:
- Cargo (Rust's package manager) is installed but not in Git Bash's PATH.
- Tauri's CLI exited 0 even though cargo was missing, hiding the error.

**Fix**:
Build from PowerShell instead:
```powershell
npm run desktop:build
```

If you want to use Git Bash, add Cargo to the PATH:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
npm run desktop:build
```

After building, verify the binary's timestamp is recent (to confirm the build actually
ran).

### check:presets skipped in CI

**Symptom**: Running `npm run check:presets` in CI exits 0 immediately without reporting
preset status.

**Causes**:
- The preset audit requires a local OpenCode model catalogue file, which CI does not
  have.
- The script intentionally skips itself with exit 0 when the catalogue is missing, so the
  build does not fail in environments that cannot verify presets.

**Fix**:
This is expected behavior. The check is for local development with an OpenCode
catalogue. In CI, the smoke test covers essential invariants (no vendor names in agent
IDs, no default models, no execution modes). To verify presets in CI:
1. Set `OPENCODE_MODELS_JSON` to a path to a downloaded catalogue (if available).
2. Run the preset check again.

Otherwise, skip it in CI:
```bash
[ -z "$CI" ] && npm run check:presets
```

### Unstyled console (CSS not loading)

**Symptom**: The console window opens but renders with no styling — plain HTML without
colors, layout, or fonts.

**Causes**:
- The CSS bundle was deleted or not built.
- The build succeeded but the stylesheet path is wrong.
- A style audit failure was ignored.

**Fix**:
1. Run the style audit:
   ```bash
   npm run check:styles
   ```
   It reports which className values do not resolve to CSS in the built bundle.

2. Rebuild the web app:
   ```bash
   npm --prefix web run build
   npm run desktop:build  # Rebuilds and embeds the CSS
   ```

3. Verify the CSS file exists:
   ```bash
   ls web/dist/assets/index-*.css
   ```

4. If still broken, rebuild from scratch:
   ```bash
   rm -rf web/dist src-tauri/target
   npm --prefix web run build
   npm run desktop:build
   ```

### Legacy v1 config or state

**Symptom**: The project loads but uses old field names, or the config has fields like
`roles`, `mode`, or `max_executors_per_stage`.

**Causes**:
- The project was created with Agent Foundry v1.x and has not been migrated.
- The config file uses the v1 schema.

**Fix**:
1. The migration is automatic. The config loader converts v1 fields to v2 on read. The
   file is rewritten only on the next settings write (running setup or binding a model).
   No action is needed in most cases.

2. To force a migration, perform a settings write. For example, run the setup screen:
   ```bash
   /foundry-setup
   ```
   Or bind a model to a role:
   ```bash
   agentfoundry models --set analyst=anthropic/claude-sonnet-5
   ```

3. Verify the config file now has v2 fields:
   ```bash
   cat agent-foundry.json
   ```
   It should have `models`, `execution`, `context`, `limits`, and no `roles` or `mode`.

---

## FAQ

### Why are there no model defaults in the plugin?

Agent Foundry ships with zero configuration. Every role inherits the chat model by
default, so the plugin works out of the box with no setup. For specialized models (a
cheaper builder, a stronger architect), configure them once in `agent-foundry.json` or
via the setup screen. Hardcoded defaults require constant maintenance as models ship and
deprecate, and lock in a specific vendor or plan.

### Why is there only one execution flow, not modes?

Older designs offered three execution modes: `restricted` (wait for approval),
`automatic` (run everything), and `full` (autonomy). These were a binary choice made
before the problem was understood. Agent Foundry replaces modes with fine-grained
controls under user control:

- `execution.max_parallel` — how many tasks run at once.
- Review gates — which roles decide completion (run by the analyst or lead through
  `foundry_review`; the human is consulted only at critical checkpoints).
- Retry limits — how many times a task can fail before escalating.
- Cost warnings — alert when an estimate exceeds a limit (advisory, not blocking).

Tune these once based on risk tolerance; the same settings apply to every run. Modes
were a false choice; these levers are the real controls.

### Why cannot the orchestrator be bound to a specific model?

The orchestrator is your conversation partner. If a model is picked in chat, the
orchestrator follows automatically — no second configuration, nothing to forget. That is
why the orchestrator's agent definition has no `model` key: it inherits the chat model by
omission.

To use a different model for orchestration, change the chat model. To use one model in
chat but another for agents, bind the reasoning roles; the orchestrator still inherits
from chat.

### Can two roles share the same model?

Yes. If you set `models.architect` and `models.lead` to the same model ID, they both run
on it. The config file can specify any model for any role, or leave a role empty to inherit
the chat model.

### Is the desktop console required?

No. The plugin is fully functional headless. The console is a GUI for observability; the
board and task details are available through `/foundry-board` and `/foundry-graph`
commands in chat, or via the CLI (`agentfoundry board`, `agentfoundry tasks`). The
console is optional.

### Does Agent Foundry work offline or headless?

Yes. The plugin works without OpenCode's internet connection. All tools work except
`foundry_execute` and `foundry_consult`, which dispatch roles to run agents (requiring
network access to reach model providers). `foundry_escalate` does not dispatch; it records
an escalation and updates the task status locally.

For headless use with role dispatch, OpenCode needs internet access to reach the model
providers.

### Where does the bearer token live?

The token is generated fresh per process and stored temporarily in `.agent-foundry/desktop.json`
(the handshake file), written 0600 (owner-readable only). It passes from bridge to console
via Tauri IPC — never in a URL, query string, or environment variable. The file is deleted
when the bridge stops, so the token is temporary.


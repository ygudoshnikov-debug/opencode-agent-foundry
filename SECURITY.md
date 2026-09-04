# Security policy

## Supported versions

The latest published release receives security fixes.

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |

For reports affecting versions not listed above, see the "Reporting a vulnerability"
section below.

## Reporting a vulnerability

Report security vulnerabilities privately through
[GitHub Security Advisories](https://github.com/gjoliveira9634/opencode-agent-foundry/security/advisories/new)
rather than opening a public issue. Expect a first response within a week.

## Trust model: what this plugin touches

Vulnerability scope is limited to these boundaries:

- **State and configuration.** Agent Foundry writes state to `<project>/.agent-foundry/`
  (project-scoped) and configuration to `agent-foundry.json` files at the project or
  OpenCode config level. Nothing is written outside these directories.

- **Desktop bridge.** The bridge is a loopback-only HTTP + SSE server:
  - Binds to `127.0.0.1` on an ephemeral port (never `0.0.0.0`).
  - Requires a bearer token generated on each start.
  - Answers a fixed origin allowlist (Tauri origins and loopback only).
  - No wildcard CORS or preflight bypass.
  - Token is written to `.agent-foundry/desktop.json` with `0600` permissions and
    never passed on a command line or in a URL (both are readable by other processes).
  - Preflight requests are answered before auth to comply with CORS spec.

- **Role tool allowlists.** Each role receives an explicit allowlist of tools it can
  reach. A builder cannot invoke planning, configuration, or dispatch tools. However,
  a builder can edit files and run commands, because task implementation is its job.
  Treat `allowed_files` as a guardrail marking intent, not a sandbox enforcing
  isolation. The operating system's file permissions are the actual boundary.

- **External communication.** Model ids and prompts are sent to the LLM provider you
  configured (OpenAI, Anthropic, Google, OpenCode Go, etc.). The plugin adds no
  telemetry, calls no third-party service of its own, and does not phone home.

## What counts as a vulnerability

The following issues are in scope:

- Reaching the bridge from an origin outside the allowlist.
- A role invoking a tool outside its explicit allowlist.
- The plugin writing files outside the permitted directories.
- Arbitrary code execution through configuration or state deserialization.
- Credential leakage (tokens or authentication material stored insecurely
  or logged to an observable surface).

The following are not vulnerabilities:

- Missing validation of user input to tool arguments (the LLM provides the input; if
  it breaks things, that is a LLM behavior issue, not a security issue in the plugin).
- A builder modifying files outside `allowed_files` (that is a misconfigured task, not
  a security boundary breach).
- The cost of running a session being higher than expected (cost control is
  configuration and operator responsibility).
- Performance degradation or availability issues.

## Security in development

Contributors should:
- Run `npm run verify` before opening a pull request to catch type errors and smoke
  test invariant violations.
- Avoid serializing untrusted configuration to the state directory without validation.
- Be cautious with changes to the bridge CORS policy, bearer token generation, or role
  tool allowlists.
- Document any new security boundary in code comments and in this policy.

Questions about vulnerability scope or policy can be raised through the same GitHub
Security Advisories channel.

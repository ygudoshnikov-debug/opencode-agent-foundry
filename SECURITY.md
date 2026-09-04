# Security policy

## Supported versions

The latest published release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 1.x     | yes       |

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/gjoliveira9634/opencode-agent-foundry/security/advisories/new)
rather than opening a public issue. You should get a first response within a week.

## What this plugin touches

Worth knowing when judging whether something is a vulnerability:

- **It writes to your project.** State lives in `<project>/.agent-foundry/`, and configuration in
  `agent-foundry.json` at the project or OpenCode config level. Nothing is written outside those.
- **The desktop bridge is loopback-only.** It binds `127.0.0.1` on an ephemeral port, requires a
  bearer token generated per start, and answers a fixed origin allowlist. The token is written to
  `.agent-foundry/desktop.json` with `0600` permissions and never passed on a command line or in a
  URL, because both are readable by other processes on the machine.
- **Agents run with the tools you give them.** Each role gets an explicit tool allowlist — a builder
  cannot reach planning or configuration tools — but a builder can still edit files and run
  commands, because that is its job. Treat a task's `allowed_files` as a guardrail, not a sandbox.
- **Model ids are sent to whichever provider you configured.** The plugin adds no telemetry and
  contacts no service of its own.

If you find a way to reach the bridge from another origin, to escape a role's tool allowlist, or to
make the plugin write outside the directories above, that is a vulnerability and I would like to
hear about it.

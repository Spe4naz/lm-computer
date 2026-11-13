# Security policy

`lm-computer` gives a language model controlled access to the machine running
LM Studio. Treat it as a remote-execution service for a trusted LAN.

## Reporting a vulnerability

Use GitHub **Security advisories** in this repository. Do not open a public
issue with a working token, private key or an exploit against a third-party
machine.

## Secrets and tokens

- The plugin generates a bearer token on first launch and stores it in
  `~/.config/lm-computer/token.txt` with mode `0600`.
- Runtime configuration, the token, the audit log and the trash live in
  `~/.config/lm-computer` and are ignored by Git.
- The token is never printed by the API. Do not commit `.env` files, tokens or
  `config.json`.
- The web endpoints bind to `0.0.0.0` only to let LM Chat approve actions. Never
  expose ports `1236` (REST) or `1237` (MCP) to the internet; use a VPN or an
  authenticated proxy.
- Both listeners share the same bearer token. Opening only the MCP port to a
  client is enough for opencode; REST can stay closed to the LAN if unused.

## Approvals

- Shell commands and destructive file operations require confirmation in LM
  Chat or in the `zenity` fallback. The fallback is re-checked while an approval
  is pending, so it still appears if the app disconnects after the request.
- Temporary auto-accept is limited to 30 minutes and stops when the app is no
  longer polling the plugin.
- A hard denylist always blocks privilege escalation, filesystem formatting,
  raw device writes and power management commands, even with auto-accept. It
  matches `sudo`/`doas`/`pkexec` anywhere in the line, including
  `/usr/bin/sudo` and `bash -c 'sudo …'`.
- **The denylist is not a sandbox.** Encoded commands, scripts, aliases and a
  program that spawns another program can bypass it. After confirmation
  `shell_run` has the full rights of the user running the service and can read
  the plugin token, `~/.ssh`, and files outside the workspace. Do not enable
  auto-accept for an untrusted model or untrusted prompts.

## Runtime isolation

- `shell_run` receives a minimal environment allowlist (`PATH`, `HOME`, `LANG`,
  `TERM`, `TMPDIR`, display variables and a few OS paths). LM Studio internals
  (`LMS_PLUGIN_CLIENT_PASSKEY`, API keys) and proxy/SSH-agent credentials are
  not inherited.
- `PUT /api/config` can only change the workspace to a directory inside the
  user's home (or an explicit `LM_COMPUTER_ALLOWED_ROOTS` entry). The
  filesystem root is always rejected.
- CORS is disabled by default. Web origins must be listed explicitly in
  `LM_COMPUTER_CORS_ORIGINS`.
- Audit arguments and command strings are masked for bearer tokens, passwords,
  API keys and URL userinfo; `audit.jsonl` rotates to `audit.jsonl.1` after 5 MB.
- The generated systemd unit uses `NoNewPrivileges`, `PrivateTmp`,
  `ProtectSystem=full` and related kernel protections.

## CI checks

Every push runs gitleaks, CodeQL (JavaScript/TypeScript), an OSV dependency scan
and a CycloneDX SBOM job. Pull requests also run dependency review with a
high-severity threshold. The known zod advisory is temporarily ignored in
`osv-scanner.toml` until `@lmstudio/sdk` supports zod 4; request size limits
reduce its impact.

## Dependencies

Run `npm audit` and keep `@lmstudio/sdk`, `@modelcontextprotocol/sdk` and `zod`
up to date. Test fixtures contain fake credentials only. `npm audit` still
reports the zod 3 memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5) because
`@lmstudio/sdk` pins zod 3; request bodies and tool arguments are size-limited
while that upstream dependency is unresolved.

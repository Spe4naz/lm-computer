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
  Chat or in the `zenity` fallback.
- Temporary auto-accept is limited to 30 minutes and stops when the app is no
  longer polling the plugin.
- A hard denylist always blocks privilege escalation, filesystem formatting,
  raw device writes and power management commands, even with auto-accept.

## Dependencies

Run `npm audit` and keep `@lmstudio/sdk`, `@modelcontextprotocol/sdk` and `zod`
up to date. Test fixtures contain fake credentials only.

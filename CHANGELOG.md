# Changelog

All notable changes to `@namuh-eng/expn-cli` and `@namuh-eng/expn-sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

GitHub Releases (with full commit-level notes) are at:
https://github.com/namuh-eng/exponential/releases

---

## [Unreleased]

_Changes staged for the next release._

---

## [0.1.0] — Initial release

### Added
- `expn` CLI with full issue, project, cycle, team, workspace, token, comment,
  label, emoji, document, integration, notification, and favorites management.
- `@namuh-eng/expn-sdk` TypeScript SDK generated from the OpenAPI contract.
- `expn login`, `expn doctor`, `expn whoami`, `expn config` commands.
- `expn --version` flag that reports the installed package version.
- WebSocket sync-watch via `expn issues watch`.
- Human-readable table output on TTY; JSON output when piped or `--json` is set.

[Unreleased]: https://github.com/namuh-eng/exponential/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/namuh-eng/exponential/releases/tag/v0.1.0

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-10

### Added

- `docs/quickstart.md`: 5-minute Chinese quick-start guide (install via the
  plugin manager, verify all five tiers with `source: manual`, daily settings,
  custom packs and troubleshooting).
- Terminal surface: `dsh-spend-wallpaper status` and `render` commands
  (ANSI truecolor/256/monochrome half-block artwork, full-screen animation,
  `--tier`/`--once`/`--fps`/`--color` options) plus `--json` output for shell
  prompts and scripts. The host now persists `spendMicro`, source/status,
  `updatedAt` and a config snapshot so the CLI works without the DSH API.
- `docs/terminal.md` terminal usage guide.

## [0.1.0] - 2026-11-10

Initial M0 implementation.

### Added

- Host half: rolling 1-hour balance spend from the signed-in DeepSeek account
  wallet (`ctx.deepseekAccount.getBalance`) or the open-platform
  `/user/balance` endpoint, with `manual` mode for local testing.
- Host half: persisted balance samples (`$DSH_HOME/storages/spend-wallpaper/state.json`),
  five-tier mapping with hysteresis and minimum dwell time, `poor`/`rich`
  direction, and locked-tier support.
- Host half: HTTP surface under `/plugins/dsh-spend-wallpaper/` —
  `GET /state`, `GET /packs`, `GET /assets/<pack>/<file>`, `POST /refresh` —
  with a same-origin fence, ETag caching and path-traversal protection.
- Client half: self-contained Module Loader bundle that paints a full-viewport
  wallpaper layer behind the DSH web shell, with `frame` and `full` display
  modes, cross-fade transitions, video pause on hidden tab, and
  `prefers-reduced-motion` static fallback.
- Built-in "Deep Sea Mood" pack: five procedurally generated tiers, each with a
  2560×1440 WebP still and a 1280×720 VP9 WebM loop.
- Tooling: asset generator (`scripts/gen-assets.py`), client bundle shape check,
  pack validator, unit tests (Node test runner) and GitHub Actions CI.

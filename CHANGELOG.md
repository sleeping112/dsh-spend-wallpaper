# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.0] - 2026-11-10

### Added

- More adjustable parameters in the quick-switch panel:
  - appearance sliders: panel opacity, wallpaper scrim, extra dim, blur;
  - frame margin/radius sliders;
  - transition duration, sampling interval, statistic window, debounce preset
    and threshold preset chips.
- `/config` now also accepts `inset`, `radius`, `transitionMs`, `hysteresis`,
  `windowMinutes`, `sampleSeconds`, `minDwellSeconds` and `thresholds`
  (validated in `lib/control.js`; thresholds must be ascending and start at 0).
- Changing the sampling cadence restarts the sample timer immediately; window
  and threshold changes recompute the tier immediately.

## [0.7.0] - 2026-11-10

### Added

- **Quick-switch panel**: a floating 🐋 button opens an in-app panel to switch
  pack, full/frame mode, static/dynamic media, direction, preview any tier,
  lock the current tier, refresh data, toggle the wallpaper or reset overrides.
  Changes apply instantly and persist in the plugin state file.
- `POST /plugins/dsh-spend-wallpaper/config` host endpoint with a whitelist
  (`lib/control.js`) for presentation overrides; `{reset:true}` clears them.
  `/packs` now returns resolved asset URLs so the client can preview tiers
  locally for 15 seconds without touching host state.
- Overrides survive restarts via `state.json` (`overrides` field) and take
  precedence over the profile config.

## [0.6.0] - 2026-11-10

### Added

- New built-in pack **`deepseek-eats`** (now the default): a chibi-anime
  DeepSeek whale at the dinner table. Spend less, eat better — five tiers go
  from a grand feast, ramen, curry and plain rice down to an empty bowl with
  tears. Each tier ships a 2560×1440 WebP still and a short VP9 loop with
  blinking, steam, drifting petals/hearts and rain.
- `scripts/gen-anime-assets.py` generator for the new pack (PIL/numpy only, no
  third-party art), plus the existing `default` "Deep Sea Mood" pack remains
  available via `pack: default`.
- Asset tests now validate every shipped pack; CI pack-check runs on both.

### Changed

- Default `pack` is `deepseek-eats`.
- Default `scrim`/`dim` lowered to 0.10/0.03 in the shipped config; the anime
  pack is bright and pastel, so it needs less darkening than the sea pack.

## [0.5.0] - 2026-11-10

### Changed

- Rebuilt the built-in "Deep Sea Mood" pack with a new procedural renderer:
  five distinct scenes (aurora over a polar sea, moonlit whales, violet
  sunset with a boat, storm with lighthouse beam + rain + lightning, red
  tsunami with a glowing crest and embers), 2560×1440 static WebP stills and
  short seamless VP9 loops.
- Full-bleed defaults are stronger now: `surfaceOpacity` 0.50, `scrim` 0.20,
  `dim` 0.05, plus a subtle saturation/contrast boost on the wallpaper media
  layer. `full` mode also makes the `body` background transparent so the
  wallpaper is not dimmed twice by body + panel alpha.
- Default video loops are shorter (3.3 s) and render at 960×540 to keep the
  installed package small and generation cheap; static stills stay 2560×1440.

## [0.4.0] - 2026-11-10

### Changed

- Default display mode is now `full`: the wallpaper covers the whole window and
  panels are semi-transparent (`surfaceOpacity` default 0.55), instead of only
  showing around a `frame` border. `frame` remains available as an option.
- The browser half now applies the configured `blur` to the wallpaper media
  layer (with a slight overscan scale so blurred edges never show), which keeps
  text readable when the wallpaper is busy.

## [0.3.0] - 2026-11-10

### Added

- `cost-meter` data source: sample `dsh-cost-meter`'s `getState().today` cost
  counter and diff it over the plugin window, so subscription/token-plan and
  zero-wallet accounts still drive the wallpaper. `auto` now prefers
  cost-meter → account → api. Persisted samples carry a `kind`
  (`balance`/`spend`) so the two counter directions never mix in one window.

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

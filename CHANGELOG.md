# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.12.0] - 2026-11-12

### Added

- Per-scene **display settings**, so uploaded wallpapers no longer have to use
  the automatic center-cover crop:
  - fit: 铺满 `cover` / 完整 `contain` / 拉伸 `fill`;
  - focal point X/Y (0–100%) — e.g. choose the top or bottom of a portrait
    image/video;
  - zoom 100–300%.
  In the quick panel each tier has a 「显示」 button that opens these controls;
  after an upload the editor opens automatically for that tier.
- Settings persist as `sceneSettings` overrides (`POST /config`), are exposed in
  `/state` per scene and in the wallpaper payload, and are applied to both
  images and videos (including paused first-frame static mode).
- Quick focal presets: 顶部 / 居中 / 底部.

## [0.11.2] - 2026-11-10

### Fixed (scene feature audit)

- Custom video with `media: static`: the wallpaper used to become an `<img>`
  pointing at a `.webm` (broken/blank). It now renders a paused video element on
  its first frame.
- "清除" now deletes the uploaded `custom-<tier>.*` files instead of only
  dropping the override (no more orphaned media).
- Overrides whose file was deleted from disk are pruned when the scene pack is
  resolved; hidden-tier overrides are preserved for when the tier count grows.
- The upload file input is kept in the DOM until the picker resolves; removing
  it immediately could lose the change event in some browsers.
- Uploads with an empty MIME type infer image/video Content-Type from the file
  extension instead of being rejected.
- Editing two threshold/name fields quickly no longer drops the first edit
  (values are collected from the DOM before posting).

## [0.11.1] - 2026-11-10

### Fixed

- Inner translucent surfaces now keep a readable minimum alpha (composer 55%,
  cards 62%, code 58%, document preview 65%) even when `surfaceOpacity` is
  dragged very low; they still follow the slider above those floors.

## [0.11.0] - 2026-11-10

### Changed

- Full-bleed mode now also makes **inner surfaces translucent**, so the
  wallpaper shows through the chat composer and file-edit/code boxes:
  - `--dsw-specific-input-major` (chat composer + attachment/file cards),
  - `--dsw-alias-bg-layer-1/2` and `--dsw-alias-bg-module-platform`
    (file-edit/result cards, layered panels, selectors),
  - `--dsw-alias-markdown-code-block` (code blocks / edit boxes),
  - `--dsw-alias-bg-document-preview` (document preview panel).
  Their alpha is derived from the existing `surfaceOpacity` (slightly more
  opaque than the shell panels for readability), so the panel opacity slider
  tunes them too. Menus/dialogs that use layer-2 become translucent as well.

## [0.10.3] - 2026-11-10

### Changed

- The statistic window is now a fill-in parameter too (5–180 minutes) instead
  of preset 15/30/60/90 chips in the quick panel. Values apply immediately and
  recompute the current tier; blank keeps the profile/default value.

## [0.10.2] - 2026-11-10

### Changed

- The sampling interval is no longer a row of preset chips (60/120/180/300/600s);
  the quick panel now offers a fill-in number field for any value in 60–600
  seconds (blank shows the default). The value is still applied immediately by
  restarting the sample timer.

## [0.10.1] - 2026-11-10

### Added

- Each scene now has an **editable name** in the quick panel (placeholder shows
  the built-in name; empty falls back to it). Names are persisted via
  `POST /config { sceneNames: [...] }` and used in the current-tier label,
  preview chips and terminal status card.
- Built-in/custom scene names appear in panel scene rows and are capped at 40
  characters; `sceneNames` is validated in `lib/control.js`.

## [0.10.0] - 2026-11-10

### Changed

- Removed the **wallpaper pack / manifest format** entirely. Built-in scenes are
  flat files in `lib/assets/scenes/` and are copied to the writable state dir at
  startup.
- Each tier/threshold now has its **own scene**, which can be replaced by
  uploading a static image or dynamic video from the quick panel. "Clear"
  restores the built-in scene.
- **Tier count is adjustable** (2–8) and every threshold is editable directly in
  the panel (or via `POST /config { thresholds }`); the 5‑tier default remains.
- New HTTP routes:
  `GET /scenes/<tier>?kind=image|video`,
  `POST /scenes/<tier>` (raw upload + Content-Type),
  `POST /scenes/<tier>/reset`.
- `POST /config` no longer accepts `pack`/`direction`; removed the old
  `/packs` and `/assets/<pack>/<file>` routes.
- Docs updated (`docs/scenes.md`, README/quickstart); deleted `lib/packs.js`,
  `scripts/pack-check.mjs` and the old sea-scene generator.

## [0.9.0] - 2026-11-10

### Removed

- The **frame/相框 display mode** is gone: the wallpaper is now always
  full-bleed. The quick panel no longer shows the 铺满/相框 toggle, and the
  相框边距/圆角 sliders were removed with it.
- `POST /config` no longer accepts `mode`, `inset` or `radius`; persisted
  overrides from older versions drop those keys while keeping the valid ones.
  An old `mode: frame` in a profile config is ignored (rendering is forced to
  `full`).
- `rendering` snapshots no longer expose `inset`/`radius`, and the frame-mode
  CSS/body-padding rules were removed.

### Changed

- Docs (README/quickstart/design/terminal) updated to describe full-bleed only.

## [0.8.2] - 2026-11-10

### Fixed (preview sometimes went blank)

- The frame fade-out cleanup timer used a closure over the frame it was
  scheduled for. If a new frame appeared before that timer fired (rapid tier
  previews, or previewing right after a live wallpaper change), the older timer
  removed the *new* frame and the next cleanup removed everything — leaving the
  wallpaper layer empty until the next update. Cleanup is now a single
  cancellable timer that always keeps the latest active frame.
- A stale preview video erroring after a newer preview had started could
  replace the active frame with its poster fallback, so cleanup then removed the
  real preview. The fallback now only becomes active when its own video is the
  active frame.
- Previewing now un-hides the wallpaper layer, so previews are visible even if
  the live wallpaper was hidden (disabled / no wallpaper yet).
- `test/panel.test.mjs` gained regression cases for all three races.

## [0.8.1] - 2026-11-10

### Fixed (quick-switch panel audit)

- Previews now have a real 15 s expiry timer; previously they could outlive the
  15 s window until the next 20 s poll, and the chip state was already wrong.
- Switching packs in the panel now refetches `/packs`, so preview labels and
  asset URLs never come from the previously selected pack.
- With `direction: rich`, preview chips now show the mapped tier labels in the
  right order (tier 0 = worst meal) and preview the matching asset.
- Appearance sliders (opacity/scrim/blur/mode) now take effect while a tier is
  being previewed instead of being ignored until preview expiry.
- Switching pack / direction / media, resetting, disabling the wallpaper or
  refreshing clears an active preview instead of leaving a stale frame on screen.
- `clearPreview()` no longer re-creates the live wallpaper frame when nothing is
  previewing (avoids a fade/flicker on every pack/direction/media click).
- The panel keeps its scroll position across the 20 s poll re-render and does
  not rebuild while a slider is being dragged.
- Async pack fetches after plugin disposal no longer touch the removed panel.
- The panel is max-width constrained on narrow windows.
- `POST /config` rejects unknown pack ids instead of silently falling back.
- Added `test/panel.test.mjs` covering open/preview/expiry/rich mapping/pack
  refresh/slider posting (suite now 51 tests).

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

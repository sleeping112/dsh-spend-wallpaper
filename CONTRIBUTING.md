# Contributing to dsh-spend-wallpaper

Thanks for improving the plugin. This project targets **DSH 0.2.x** and has no
runtime dependencies beyond the packages the host already provides
(`@deepseek-ai/cordis`, `@deepseek-ai/schemastery`).

## Requirements

- Node.js **20+** for the host half and tests (`node --test`).
- Python 3.10+ with Pillow + numpy **only** if you want to regenerate the
  built-in artwork.
- ffmpeg (with `libvpx-vp9`) **only** for regenerating the WebM loops.
- A local DSH installation is needed for end-to-end verification; see
  [the design document](docs/design.md) for the tested commands.

## Development workflow

```sh
npm test                      # host + client + asset tests (node --test)
node scripts/build-client.mjs # validate the browser bundle wrapper
npm run demo                  # render one ANSI frame
```

Regenerating the built-in scenes is optional and overwrites the committed
files in `lib/assets/scenes/`:

```sh
python scripts/gen-anime-assets.py --skip-video # five WebP stills
python scripts/gen-anime-assets.py              # stills + WebM loops (needs ffmpeg)
```

There is no compile step: `lib/` is hand-authored ES module source and
`lib/client.js` is a single self-contained DSH client bundle. Keep it that way
unless a build step is justified in an issue.

## Layout rules

- `lib/*.js` — host modules. Plain ESM, no third-party imports except
  `@deepseek-ai/*` peer packages.
- `lib/client.js` — the browser half. It must stay a **single self-contained**
  Module Loader bundle (`window.__ModuleLoader__.load({ id, factory })`) with
  no relative imports: DSH serves each client bundle as one script and does not
  resolve sibling chunks for synchronous imports.
- `lib/terminal.js` / `lib/terminal-cli.js` + `bin/dsh-spend-wallpaper.mjs` —
  the terminal surface. `terminal.js` must stay pure (no DSH imports, no
  filesystem/process access); all state loading and animation lives in
  `terminal-cli.js`.
- `lib/assets/scenes/` — the five built-in WebP stills and five WebM loops.
  Media is committed: users install through `link:` or a Git checkout and expect
  the scenes to work without a build. They are copied to
  `$DSH_HOME/storages/spend-wallpaper/scenes/` on first start.
- `locale/` — Plugin Manager metadata (`meta.title`, `meta.description`) for
  `en` and `zh`.
- `assets/` — plugin icon and storefront screenshots; keep `screenshots.json`
  in sync with the files it lists.
- `test/` — Node test-runner files (`*.test.mjs`).
- `docs/` — quickstart, scene/upload formats, terminal reference and design
  notes. `docs/design.md` keeps historical sections and is labelled as such.

## Built-in artwork

The built-in scenes are generated from code by
`scripts/gen-anime-assets.py` (Pillow + numpy, no third-party artwork or
fonts), so they stay CC0. Do not add third-party artwork to this repository
unless you can license it. Uploaded scenes are user data and live under
`$DSH_HOME/storages/spend-wallpaper/scenes/`; see [docs/scenes.md](docs/scenes.md)
for the formats and HTTP routes.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Keep the
host and client halves in the same commit when a protocol change spans both.

## Pull requests

- Run `npm test` and `node scripts/build-client.mjs` before opening a PR.
- Describe any change to the HTTP payload or the client DOM/token assumptions;
  both are versioned against DSH releases.
- When bumping the DSH compatibility range, update `package.json`
  (`dsh.compatibility.dsh`, `engines.dsh`) and any affected README section.

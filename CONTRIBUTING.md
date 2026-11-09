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
npm test                     # all host + client + asset tests (node --test)
node scripts/build-client.mjs # validate the browser bundle wrapper
node scripts/pack-check.mjs  # validate the built-in wallpaper pack
npm run gen:assets           # regenerate built-in WebP/WebM artwork (ffmpeg)
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
- `lib/assets/packs/default/` — built-in pack; media is committed (users install
  through `link:` and expect the pack to work without a build).
- `test/` — Node test-runner files (`*.test.mjs`).
- `docs/` — design and pack-authoring documentation.

## Adding a wallpaper pack

Do not add third-party artwork to this repository unless you can license it.
The built-in pack is generated from code so it stays CC0. User packs belong in
`$DSH_HOME/spend-wallpaper/packs/<id>/` on the user's machine; see
[docs/packs.md](docs/packs.md) for the manifest format and how to validate a
pack with `node scripts/pack-check.mjs <dir>`.

## Commit style

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`). Keep the
host and client halves in the same commit when a protocol change spans both.

## Pull requests

- Run `npm test`, `node scripts/build-client.mjs` and
  `node scripts/pack-check.mjs` before opening a PR.
- Describe any change to the HTTP payload or the client DOM/token assumptions;
  both are versioned against DSH releases.
- When bumping the DSH compatibility range, update `package.json`
  (`dsh.compatibility.dsh`, `engines.dsh`) and the "Verified" section in the
  README.

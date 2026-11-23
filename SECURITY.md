# Security notes

## Reporting a vulnerability

Open a private security advisory on the repository (or contact the maintainer
privately) instead of filing a public issue. Please include a reproduction and
the affected DSH version.

## Design boundaries

- **Secrets stay on the host.** The balance API key is resolved through
  `ctx.credentials` (or the launch environment) only in the host half. It is
  never sent to the browser, never embedded in snapshot payloads, and never
  written to the state file.
- **Authenticated HTTP surface.** `/plugins/dsh-spend-wallpaper/*` is served by
  the DSH host webserver. Every route first applies DSH's Connection guard
  (`ctx.connection.requestRejection`), which enforces the Host/Origin fence and
  requires an authenticated browser or API session; a same-origin check remains
  as a second layer. The server binds to loopback by default. If the host is
  exposed beyond loopback, the routes stay limited to sessions authenticated by
  that deployment — still deploy behind a trusted proxy.
- **No remote media fetches.** The client only loads scenes served by the host
  from `$DSH_HOME/storages/spend-wallpaper/scenes/`. Uploads are size-limited,
  restricted to raster images (PNG/JPEG/WebP/GIF/AVIF) and videos
  (WebM/MP4/MOV/M4V), and no SVG is accepted.
- **No telemetry.** Balance amounts and usage never leave the machine.

## Supported versions

Security fixes target the latest `1.x` line and the DSH range declared in
`package.json` (`dsh.compatibility.dsh`).

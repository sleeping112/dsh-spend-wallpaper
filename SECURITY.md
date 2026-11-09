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
- **Loopback-first HTTP surface.** `/plugins/dsh-spend-wallpaper/*` is served by
  the DSH host webserver. Every route applies a same-origin fence and the
  server binds to loopback by default. If the host is exposed beyond loopback,
  the routes become reachable by that network — deploy behind a trusted proxy.
- **No remote media fetches.** The client only loads assets served by the host
  from discovered pack directories. User packs cannot use SVG (script surface)
  and asset paths are confined to the pack root with `realpath` checks.
- **No telemetry.** Balance amounts and usage never leave the machine.

## Supported versions

Security fixes target the latest `0.1.x` line and the DSH range declared in
`package.json` (`dsh.compatibility.dsh`).

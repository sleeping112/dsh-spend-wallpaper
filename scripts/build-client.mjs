#!/usr/bin/env node
/**
 * The client half ships as a single hand-authored Module Loader bundle
 * (`lib/client.js`); no bundler is required because it has no imports.
 * This script only validates the wrapper shape and reports its size, so a
 * typo fails the build instead of failing at page load.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(root, 'lib', 'client.js')
const source = fs.readFileSync(file, 'utf8')

const checks = [
  [/window\.__ModuleLoader__\.load\(/, 'must register through window.__ModuleLoader__.load'],
  [/id:\s*'dsh-spend-wallpaper'/, "loader id must be 'dsh-spend-wallpaper'"],
  [/factory:\s*\(require\)\s*=>/, 'must expose a factory(require)'],
  [/name:\s*'spend-wallpaper-client'/, 'must export a name'],
  [/apply:\s*\(ctx\)/, 'must export apply(ctx)'],
]
for (const [pattern, message] of checks) {
  if (!pattern.test(source)) {
    console.error(`lib/client.js: ${message}`)
    process.exit(1)
  }
}
if (source.length > 512 * 1024) {
  console.error(`lib/client.js: bundle too large (${source.length} bytes)`)
  process.exit(1)
}
console.log(`lib/client.js ok (${(source.length / 1024).toFixed(1)} KiB)`)

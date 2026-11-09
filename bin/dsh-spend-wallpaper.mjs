#!/usr/bin/env node
/**
 * Terminal entry point for dsh-spend-wallpaper.
 *
 *   dsh-spend-wallpaper status [--json]
 *   dsh-spend-wallpaper render [--tier 0-4] [--once] [--fps 8]
 */

import { run } from '../lib/terminal-cli.js'

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })

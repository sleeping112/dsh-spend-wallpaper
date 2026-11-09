#!/usr/bin/env node
/**
 * Validate one wallpaper pack directory without installing the plugin.
 *
 *   node scripts/pack-check.mjs [pack-dir] [--json]
 *
 * Defaults to the built-in `lib/assets/packs/default` pack. Exits non-zero with
 * every problem listed, so pack authors and CI fail on broken manifests.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validateManifest, validateAssetName, isInside } from '../lib/packs.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const json = args.includes('--json')
const target = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? path.join(root, 'lib', 'assets', 'packs', 'default'))
const id = path.basename(target)
const errors = []
const warnings = []

function checkFile(label, name, { optional = false } = {}) {
  try {
    validateAssetName(id, name)
  } catch (error) {
    errors.push(`${label}: ${error.message}`)
    return null
  }
  const candidate = path.resolve(target, name)
  if (!isInside(target, candidate)) {
    errors.push(`${label}: "${name}" escapes the pack directory`)
    return null
  }
  let stat
  try {
    stat = fs.statSync(candidate)
  } catch {
    if (!optional) errors.push(`${label}: missing "${name}"`)
    return null
  }
  if (!stat.isFile()) {
    errors.push(`${label}: "${name}" is not a file`)
    return null
  }
  if (stat.size < 1024) warnings.push(`${label}: "${name}" looks empty (${stat.size} bytes)`)
  if (stat.size > 16 * 1024 * 1024) errors.push(`${label}: "${name}" exceeds the 16 MiB limit`)
  return { name, size: stat.size }
}

let manifest = null
try {
  const raw = fs.readFileSync(path.join(target, 'manifest.json'), 'utf8')
  manifest = validateManifest(JSON.parse(raw), id)
} catch (error) {
  errors.push(`manifest: ${error instanceof Error ? error.message : String(error)}`)
}

const files = []
if (manifest !== null) {
  for (const tier of manifest.tiers) {
    const staticFile = checkFile(`tier ${tier.id}`, tier.static)
    if (staticFile !== null) files.push(staticFile)
    if (tier.dynamic !== null) {
      const dynamicFile = checkFile(`tier ${tier.id} (dynamic)`, tier.dynamic.src)
      if (dynamicFile !== null) files.push(dynamicFile)
      if (tier.dynamic.poster !== null) {
        const poster = checkFile(`tier ${tier.id} (poster)`, tier.dynamic.poster, { optional: true })
        if (poster !== null) files.push(poster)
      }
    }
  }
  if (!/CC0|MIT|CC-BY|CC-BY-SA/i.test(manifest.license)) {
    warnings.push('manifest.license is not an obvious redistributable license')
  }
}

const report = {
  dir: target,
  id,
  ok: errors.length === 0,
  tiers: manifest?.tiers.length ?? 0,
  files: files.length,
  bytes: files.reduce((total, file) => total + file.size, 0),
  errors,
  warnings,
}

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  console.log(`pack ${report.id} (${report.tiers} tiers, ${report.files} files, ${(report.bytes / 1024).toFixed(1)} KiB)`)
  for (const warning of warnings) console.warn(`warning: ${warning}`)
  for (const error of errors) console.error(`error: ${error}`)
  console.log(report.ok ? 'pack ok' : 'pack INVALID')
}
process.exitCode = report.ok ? 0 : 1

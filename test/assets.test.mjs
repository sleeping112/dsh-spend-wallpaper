/**
 * Built-in asset pack integrity checks: manifest schema, referenced files,
 * magic bytes, size budgets, and localization completeness.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packDir = path.join(root, 'lib', 'assets', 'packs', 'default')
const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'))

function readMagic(file, bytes) {
  const buffer = Buffer.alloc(bytes)
  const descriptor = fs.openSync(file, 'r')
  try {
    fs.readSync(descriptor, buffer, 0, bytes, 0)
  } finally {
    fs.closeSync(descriptor)
  }
  return buffer
}

test('manifest covers all five tiers with zh/en labels', () => {
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.id, 'default')
  assert.equal(manifest.tiers.length, 5)
  assert.equal(manifest.direction, 'poor')
  for (const tier of manifest.tiers) {
    assert.match(tier.id, /^[a-z0-9-]+$/)
    assert.ok(tier.label?.zh && tier.label?.en, `tier ${tier.id} needs zh/en labels`)
    assert.ok(tier.static, `tier ${tier.id} needs a static asset`)
    assert.ok(tier.dynamic?.src, `tier ${tier.id} should ship a dynamic asset`)
  }
})

test('every referenced asset exists and is a plausible media file', () => {
  for (const tier of manifest.tiers) {
    const staticFile = path.join(packDir, tier.static)
    const stat = fs.statSync(staticFile)
    assert.ok(stat.size > 1024, `${tier.static} must not be empty`)
    assert.ok(stat.size < 16 * 1024 * 1024, `${tier.static} exceeds 16 MiB`)
    const webp = readMagic(staticFile, 12)
    assert.equal(webp.toString('ascii', 0, 4), 'RIFF', `${tier.static} must be a RIFF container`)
    assert.equal(webp.toString('ascii', 8, 12), 'WEBP', `${tier.static} must be a WebP image`)

    const videoFile = path.join(packDir, tier.dynamic.src)
    const videoStat = fs.statSync(videoFile)
    assert.ok(videoStat.size > 1024, `${tier.dynamic.src} must not be empty`)
    assert.ok(videoStat.size < 16 * 1024 * 1024, `${tier.dynamic.src} exceeds 16 MiB`)
    const ebml = readMagic(videoFile, 4)
    assert.equal(ebml.readUInt32BE(0), 0x1a45dfa3, `${tier.dynamic.src} must be a WebM/EBML file`)
  }
})

test('pack ships a license that allows redistribution', () => {
  assert.match(manifest.license, /CC0|MIT|CC-BY/i)
  assert.ok(fs.existsSync(path.join(root, 'LICENSE')))
})

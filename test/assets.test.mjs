/**
 * Built-in scene integrity checks: every bundled image/video is a plausible
 * media file. There is no pack manifest anymore.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scenesDir = path.join(root, 'lib', 'assets', 'scenes')

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

test('built-in scenes ship five images and five videos', () => {
  const files = fs.readdirSync(scenesDir)
  const images = files.filter((name) => name.endsWith('.webp'))
  const videos = files.filter((name) => name.endsWith('.webm'))
  assert.equal(images.length, 5)
  assert.equal(videos.length, 5)
})

test('every built-in scene is a plausible media file', () => {
  for (const name of fs.readdirSync(scenesDir)) {
    const file = path.join(scenesDir, name)
    const stat = fs.statSync(file)
    assert.ok(stat.size > 1024, `${name} must not be empty`)
    assert.ok(stat.size < 16 * 1024 * 1024, `${name} exceeds 16 MiB`)
    if (name.endsWith('.webp')) {
      const magic = readMagic(file, 12)
      assert.equal(magic.toString('ascii', 0, 4), 'RIFF', `${name} must be a RIFF container`)
      assert.equal(magic.toString('ascii', 8, 12), 'WEBP', `${name} must be a WebP image`)
    } else if (name.endsWith('.webm')) {
      const ebml = readMagic(file, 4)
      assert.equal(ebml.readUInt32BE(0), 0x1a45dfa3, `${name} must be a WebM/EBML file`)
    }
  }
})

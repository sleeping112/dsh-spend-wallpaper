/**
 * Terminal renderer for dsh-spend-wallpaper.
 *
 * The Web GUI paints a real image/video layer; a terminal cannot. This module
 * renders the *same mood* as ANSI truecolor half-block art (gradient + waves +
 * stars) and a status card, so the plugin is usable from a shell/TUI as well.
 *
 * Pure functions only: no DSH APIs, no filesystem, no process I/O. The CLI in
 * `terminal-cli.js` owns state loading and the animation loop.
 */

const ESC = '\x1b['

/** Palettes mirror `scripts/gen-assets.py` (5 tiers, poor direction). */
export const TIER_PALETTES = [
  {
    top: [9, 21, 42], bottom: [4, 10, 22], glow: [36, 78, 140],
    waves: [[24, 62, 110], [18, 48, 92], [12, 32, 66]],
    stars: 0.0016, lightning: false, label: 'calm',
  },
  {
    top: [10, 30, 56], bottom: [5, 14, 30], glow: [42, 120, 168],
    waves: [[26, 92, 132], [20, 68, 108], [13, 46, 78], [9, 30, 56]],
    stars: 0.0013, lightning: false, label: 'ripple',
  },
  {
    top: [28, 20, 62], bottom: [10, 8, 28], glow: [126, 78, 190],
    waves: [[60, 40, 108], [46, 28, 92], [32, 20, 74], [20, 12, 52]],
    stars: 0.0008, lightning: false, label: 'swell',
  },
  {
    top: [78, 26, 18], bottom: [20, 6, 6], glow: [220, 92, 42],
    waves: [[120, 44, 26], [92, 32, 22], [64, 22, 18], [40, 12, 12]],
    stars: 0, lightning: true, label: 'storm',
  },
  {
    top: [34, 6, 6], bottom: [6, 2, 2], glow: [188, 32, 32],
    waves: [[96, 12, 12], [72, 8, 8], [52, 6, 6], [34, 4, 4]],
    stars: 0, lightning: true, label: 'tsunami',
  },
]

const FULLWIDTH = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
]

export function charWidth(char) {
  const code = char.codePointAt(0)
  if (code === undefined) return 0
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0
  for (const [start, end] of FULLWIDTH) {
    if (code >= start && code <= end) return 2
  }
  return 1
}

export function displayWidth(text) {
  let width = 0
  for (const char of String(text)) width += charWidth(char)
  return width
}

export function truncateToWidth(text, width) {
  if (width <= 0) return ''
  let out = ''
  let used = 0
  for (const char of String(text)) {
    const charSize = charWidth(char)
    if (used + charSize > width) break
    out += char
    used += charSize
  }
  return out
}

export function padToWidth(text, width, align = 'left') {
  const trimmed = truncateToWidth(text, width)
  const padding = Math.max(0, width - displayWidth(trimmed))
  if (align === 'right') return ' '.repeat(padding) + trimmed
  if (align === 'center') {
    const left = Math.floor(padding / 2)
    return ' '.repeat(left) + trimmed + ' '.repeat(padding - left)
  }
  return trimmed + ' '.repeat(padding)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967296
}

export function paletteForTier(index) {
  const clamped = clamp(Math.trunc(Number(index)) || 0, 0, TIER_PALETTES.length - 1)
  return TIER_PALETTES[clamped]
}

/**
 * Resolve one pixel (normalized 0..1 coordinates) to an RGB triple.
 * @param {number} x horizontal position 0..1
 * @param {number} y vertical position 0..1
 * @param {object} palette entry from TIER_PALETTES
 * @param {number} tier 0..4 (drives wave amplitude)
 * @param {number} phase animation phase in radians
 */
export function samplePixel(x, y, palette, tier, phase = 0) {
  // Sky gradient.
  let color = mix(palette.top, palette.bottom, Math.pow(clamp(y, 0, 1), 0.85))

  // Soft glow near the horizon.
  const dx = x - 0.5
  const dy = y - 0.08
  const distance = Math.sqrt(dx * dx + dy * dy)
  const glow = Math.pow(clamp(1 - distance / 0.9, 0, 1), 2.2) * 0.55
  color = mix(color, palette.glow, glow)

  // Stars in the calm tiers.
  if (palette.stars > 0 && y < 0.55) {
    const star = hash(Math.floor(x * 400), Math.floor(y * 400))
    if (star < palette.stars) {
      const twinkle = 0.55 + 0.45 * Math.sin(phase * 2 + star * 900)
      color = mix(color, [225, 238, 255], twinkle * 0.9)
    }
  }

  // Layered sine waves, back to front.
  const waves = palette.waves
  for (let index = 0; index < waves.length; index += 1) {
    const base = 0.58 + index * 0.075
    const amplitude = 0.018 + tier * 0.012 + index * 0.012
    const frequency = 1.35 + tier * 0.5 + index * 0.35
    const wavePhase = phase * (1 + index * 0.35) + index * 1.7
    const boundary = base + amplitude * Math.sin(x * Math.PI * 2 * frequency + wavePhase)
    if (y >= boundary) {
      const depth = clamp((y - boundary) / 0.35, 0, 1)
      color = mix(color, waves[index], 0.35 + depth * 0.5)
    }
  }

  if (palette.lightning) {
    const flash = Math.max(0, Math.sin(phase * 2) - 0.86) / 0.14
    if (flash > 0 && y < 0.5) color = mix(color, [255, 226, 180], flash * 0.45)
  }

  return color
}

/** ANSI color code for a pixel. */
function colorCode(color, [r, g, b], mode) {
  if (mode === 'none') return ''
  if (mode === '256') {
    const cube = (value) => Math.round((clamp(value, 0, 255) / 255) * 5)
    const index = 16 + 36 * cube(r) + 6 * cube(g) + cube(b)
    return `${ESC}${color};5;${index}m`
  }
  return `${ESC}${color};2;${r};${g};${b}m`
}

/**
 * Render one wallpaper frame as ANSI text.
 *
 * Every terminal cell carries two vertical pixels using the upper half block
 * (`▀`): foreground = upper pixel, background = lower pixel.
 *
 * @param {object} options
 * @param {number} options.width columns
 * @param {number} options.height rows
 * @param {number} options.tier 0..4
 * @param {number} [options.phase] animation phase in radians
 * @param {'truecolor'|'256'|'none'} [options.colorMode]
 * @returns {string[]} one string per row
 */
export function renderWallpaperFrame({ width, height, tier, phase = 0, colorMode = 'truecolor' }) {
  const columns = clamp(Math.trunc(width), 8, 240)
  const rows = clamp(Math.trunc(height), 3, 120)
  const palette = paletteForTier(tier)
  const pixelHeight = rows * 2
  const lines = []

  if (colorMode === 'none') {
    // Monochrome fallback: normalize luminance per frame so dark palettes still
    // show wave shapes in a plain terminal or a redirected log file.
    const grid = []
    let minimum = 1
    let maximum = 0
    for (let row = 0; row < rows; row += 1) {
      const line = []
      for (let column = 0; column < columns; column += 1) {
        const x = columns === 1 ? 0 : column / (columns - 1)
        const upper = samplePixel(x, (row * 2) / (pixelHeight - 1), palette, tier, phase)
        const luminance = (0.2126 * upper[0] + 0.7152 * upper[1] + 0.0722 * upper[2]) / 255
        line.push(luminance)
        minimum = Math.min(minimum, luminance)
        maximum = Math.max(maximum, luminance)
      }
      grid.push(line)
    }
    const range = Math.max(0.04, maximum - minimum)
    const ramp = ' .:-=+*#%@'
    for (const line of grid) {
      let text = ''
      for (const luminance of line) {
        const level = clamp(Math.round(((luminance - minimum) / range) * (ramp.length - 1)), 0, ramp.length - 1)
        text += ramp[level]
      }
      lines.push(text)
    }
    return lines
  }

  for (let row = 0; row < rows; row += 1) {
    let line = ''
    let lastForeground = ''
    let lastBackground = ''
    for (let column = 0; column < columns; column += 1) {
      const x = columns === 1 ? 0 : column / (columns - 1)
      const upper = samplePixel(x, (row * 2) / (pixelHeight - 1), palette, tier, phase)
      const lower = samplePixel(x, (row * 2 + 1) / (pixelHeight - 1), palette, tier, phase)
      const fg = colorCode(38, upper, colorMode)
      const bg = colorCode(48, lower, colorMode)
      if (fg !== lastForeground) {
        line += fg
        lastForeground = fg
      }
      if (bg !== lastBackground) {
        line += bg
        lastBackground = bg
      }
      line += '▀'
    }
    line += `${ESC}0m`
    lines.push(line)
  }
  return lines
}

/** Humanized "x minutes ago" for status output. */
export function relativeTime(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return '未知'
  const delta = Math.max(0, now - ms)
  if (delta < 10_000) return '刚刚'
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

/**
 * Build the `status` card.
 *
 * @param {object} view
 * @param {string|null} view.spend e.g. "0.42"
 * @param {string|null} view.tierLabel e.g. "起浪"
 * @param {number} view.tierIndex
 * @param {string|null} view.nextAt
 * @param {string|null} view.nextLabel
 * @param {string|null} view.source
 * @param {number} view.samples
 * @param {number} view.updatedAt
 * @param {string|null} view.lastError
 * @param {string} [view.currency]
 * @param {number} [view.width]
 */
export function renderStatusCard(view) {
  const width = clamp(Math.trunc(Number(view.width) || 56), 30, 100)
  const inner = width - 4
  const title = ' 余额壁纸 '
  const top = `╭─${title}${'─'.repeat(Math.max(0, width - 3 - displayWidth(title)))}╮`
  const bottom = `╰${'─'.repeat(width - 2)}╯`
  const row = (text) => `│ ${padToWidth(text, inner)} │`
  const lines = [top]

  const spend = view.spend === null || view.spend === undefined ? '未知' : `${view.spend} ${view.currency ?? ''}`.trim()
  const tier = view.tierLabel ? `第 ${view.tierIndex} 档「${view.tierLabel}」` : `第 ${view.tierIndex} 档`
  lines.push(row(`最近 1 小时  ${spend}`))
  lines.push(row(`当前档位    ${tier}`))
  if (view.nextAt) {
    const gap = view.spend !== null && view.nextAt !== null
      ? `（还差 ${(Number(view.nextAt) - Number(view.spend)).toFixed(2)}）`
      : ''
    lines.push(row(`下一档      ${view.nextAt} ${view.nextLabel ?? ''}${gap}`))
  } else {
    lines.push(row('下一档      已到顶档'))
  }
  const sourceLabels = { account: '账号余额', api: '开放平台 API Key', 'cost-meter': '本地用量估算', manual: '手动值' }
  lines.push(row(`数据源      ${sourceLabels[view.source] ?? '未就绪'} · ${view.samples} 个样本`))
  lines.push(row(`更新于      ${relativeTime(view.updatedAt)}`))
  if (view.lastError) lines.push(row(`诊断        ${view.lastError}`))
  lines.push(bottom)
  return lines.join('\n')
}

/** One-line status used under the animated wallpaper. */
export function renderStatusLine(view) {
  const spend = view.spend === null || view.spend === undefined ? '--' : view.spend
  const tier = view.tierLabel ? `${view.tierIndex}·${view.tierLabel}` : String(view.tierIndex)
  const source = { account: '账号', api: 'API', 'cost-meter': '估算', manual: '手动' }[view.source] ?? '未知'
  return `余额壁纸  ¥${spend}/h  ${tier}  ${source}  ${relativeTime(view.updatedAt)}  [q 退出]`
}

/**
 * `dsh-spend-wallpaper` terminal CLI.
 *
 * Two commands keep the plugin useful without a browser:
 *   status  — read the host's persisted snapshot and print a status card
 *   render  — draw the current tier as an animated ANSI wallpaper (or one frame)
 *
 * The renderer is intentionally self-contained: it only reads the state file
 * written by the host half, so it also works from a plain shell while DSH is
 * running in the terminal.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatAmount, parseAmount } from './money.js'
import { mapPackIndex } from './tiers.js'
import { loadState, stateFilePath, userPacksDir } from './store.js'
import {
  padToWidth,
  renderStatusCard,
  renderStatusLine,
  renderWallpaperFrame,
} from './terminal.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))
const BUILTIN_PACKS = path.join(HERE, 'assets', 'packs')
const DEFAULT_THRESHOLDS = ['0', '0.05', '0.30', '1.50', '6.00']

const ESC = '\x1b'

function write(stream, text) {
  stream.write(text)
}

export function parseArgs(argv) {
  const args = { _: [], options: {} }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '-h') {
      args.options.help = true
      continue
    }
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const [key, inline] = token.slice(2).split('=')
    if (key === 'help' || key === 'version' || key === 'json' || key === 'once' || key === 'no-status' || key === 'watch') {
      args.options[key] = true
      continue
    }
    if (inline !== undefined) {
      args.options[key] = inline
      continue
    }
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      args.options[key] = true
      continue
    }
    args.options[key] = next
    index += 1
  }
  return args
}

/** Locate a pack manifest: user packs first, then the built-in pack. */
export function readPackManifest(packId) {
  const candidates = [
    path.join(userPacksDir(), packId, 'manifest.json'),
    path.join(BUILTIN_PACKS, packId, 'manifest.json'),
  ]
  for (const manifestPath of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (parsed && Array.isArray(parsed.tiers)) return parsed
    } catch {
      // Try the next location.
    }
  }
  return null
}

function localized(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    return value.zh ?? value.en ?? Object.values(value)[0] ?? ''
  }
  return ''
}

/** Build the display view shared by `status` and the animation status line. */
export function buildView(state) {
  const config = state?.config ?? {}
  const direction = config.direction === 'rich' ? 'rich' : 'poor'
  const packId = typeof config.pack === 'string' && config.pack.length > 0 ? config.pack : 'default'
  const manifest = readPackManifest(packId) ?? readPackManifest('default')
  const tierIndex = Number.isFinite(state?.tier?.index) ? state.tier.index : 0
  const sceneLabels = Array.isArray(config.sceneLabels) ? config.sceneLabels : []
  let tierLabel = typeof sceneLabels[tierIndex] === 'string' ? sceneLabels[tierIndex] : null
  if (tierLabel === null && manifest) {
    const mapped = mapPackIndex(tierIndex, manifest.tiers.length, manifest.direction === 'rich' ? 'rich' : 'poor', direction)
    const tier = manifest.tiers[mapped]
    if (tier) tierLabel = localized(tier.label) || tier.id
  }
  let thresholds = DEFAULT_THRESHOLDS
  if (Array.isArray(config.thresholds) && config.thresholds.length >= 2) thresholds = config.thresholds
  let nextAt = null
  try {
    const micros = thresholds.map(parseAmount)
    const next = micros[tierIndex + 1]
    if (next !== undefined) nextAt = formatAmount(next)
  } catch {
    // Malformed persisted thresholds: fall back to no "next" hint.
  }
  const spendMicro = Number.isFinite(state?.spendMicro) ? state.spendMicro : null
  let nextLabel = typeof sceneLabels[tierIndex + 1] === 'string' ? sceneLabels[tierIndex + 1] : null
  if (nextLabel === null && manifest && tierIndex + 1 < manifest.tiers.length) {
    const mappedNext = mapPackIndex(tierIndex + 1, manifest.tiers.length, manifest.direction === 'rich' ? 'rich' : 'poor', direction)
    const nextTier = manifest.tiers[mappedNext]
    if (nextTier) nextLabel = localized(nextTier.label) || nextTier.id
  }
  return {
    spend: spendMicro === null ? null : formatAmount(spendMicro),
    tierIndex,
    tierLabel,
    nextAt,
    nextLabel,
    source: state?.source ?? null,
    status: state?.status ?? 'unknown',
    samples: Array.isArray(state?.samples) ? state.samples.length : 0,
    updatedAt: Number.isFinite(state?.updatedAt) ? state.updatedAt : 0,
    currency: state?.currency ?? config.currency ?? 'CNY',
    lastError: state?.lastError ?? null,
    packId,
    direction,
    manifest,
  }
}

function loadCliState() {
  try {
    return loadState(stateFilePath())
  } catch {
    return null
  }
}

function detectColorMode(io, requested) {
  if (requested === 'none' || requested === '256' || requested === 'truecolor') return requested
  if (io.env?.NO_COLOR) return 'none'
  const colorTerm = String(io.env?.COLORTERM ?? '').toLowerCase()
  const program = String(io.env?.TERM_PROGRAM ?? '')
  if (colorTerm.includes('truecolor') || colorTerm.includes('24bit')) return 'truecolor'
  if (io.env?.WT_SESSION || /iTerm|WezTerm|vscode|Windows Terminal/i.test(program)) return 'truecolor'
  if (io.stdout?.isTTY) return '256'
  return 'none'
}

function terminalSize(io, options) {
  const width = Number(options.width) || (io.stdout?.isTTY ? io.stdout.columns : 100) || 100
  const height = Number(options.height) || (io.stdout?.isTTY ? io.stdout.rows : 28) || 28
  return { width: Math.max(20, Math.min(200, width)), height: Math.max(5, Math.min(80, height)) }
}

function statusCommand(args, io) {
  const state = loadCliState()
  if (args.options.json) {
    if (!state) {
      write(io.stdout, `${JSON.stringify({ ok: false, error: 'no-state', home: stateFilePath() }, null, 2)}\n`)
      return 1
    }
    const view = buildView(state)
    write(io.stdout, `${JSON.stringify({ ok: true, ...view, manifest: undefined }, null, 2)}\n`)
    return 0
  }
  if (!state) {
    write(io.stderr, `还没有状态数据（${stateFilePath()}）。\n先启动 DSH 并启用 dsh-spend-wallpaper；或先用 render --tier N 预览效果。\n`)
    return 1
  }
  const view = buildView(state)
  write(io.stdout, `${renderStatusCard(view)}\n`)
  if (view.lastError) write(io.stderr, `诊断：${view.lastError}\n`)
  return 0
}

function resolveRenderTier(args, state, view) {
  const requested = args.options.tier
  const fallback = { spendTier: view?.tierIndex ?? 0, explicitSlot: null }
  if (requested === undefined) return fallback
  if (/^\d+$/.test(String(requested))) {
    return { spendTier: Math.max(0, Math.min(4, Number(requested))), explicitSlot: null }
  }
  const manifest = view?.manifest ?? readPackManifest('default')
  if (manifest) {
    const found = manifest.tiers.findIndex((tier) => tier.id === String(requested))
    if (found >= 0) return { spendTier: fallback.spendTier, explicitSlot: found }
  }
  return fallback
}

async function renderCommand(args, io) {
  const options = args.options
  if (options.help) {
    write(io.stdout, helpText())
    return 0
  }
  const state = loadCliState()
  const view = state ? buildView(state) : null
  const { spendTier, explicitSlot } = resolveRenderTier(args, state, view)
  const manifest = view?.manifest ?? readPackManifest('default')
  const paletteTier = explicitSlot !== null
    ? explicitSlot
    : mapPackIndex(
      spendTier,
      manifest?.tiers?.length ?? 5,
      manifest?.direction === 'rich' ? 'rich' : 'poor',
      view?.direction ?? 'poor',
    )
  const colorMode = detectColorMode(io, options.color)
  const size = terminalSize(io, options)
  const showStatus = options['no-status'] !== true
  const fps = Math.max(1, Math.min(30, Number(options.fps) || 8))
  const once = Boolean(options.once) || io.stdout?.isTTY !== true

  // Previewing a specific tier must not lie in the status line: derive the
  // label from the same pack manifest and show the requested tier.
  const previewView = view ? { ...view } : null
  if (previewView !== null) {
    previewView.tierIndex = explicitSlot !== null ? explicitSlot : spendTier
    if (manifest) {
      const mapped = explicitSlot !== null
        ? explicitSlot
        : mapPackIndex(spendTier, manifest.tiers.length, manifest.direction === 'rich' ? 'rich' : 'poor', view?.direction ?? 'poor')
      const tier = manifest.tiers[mapped]
      if (tier) previewView.tierLabel = localized(tier.label) || tier.id
    }
  }

  const frameText = (phase, dimensions, withStatus) => {
    const rows = withStatus ? dimensions.height - 1 : dimensions.height
    const lines = renderWallpaperFrame({
      width: dimensions.width,
      height: Math.max(2, rows),
      tier: paletteTier,
      phase,
      colorMode,
    })
    if (withStatus) {
      const status = view
        ? renderStatusLine(previewView)
        : '余额壁纸  未读取到状态  先启动 DSH 并启用插件  [q 退出]'
      const padded = padToWidth(status, dimensions.width)
      lines.push(colorMode === 'none' ? padded : `${ESC}[7m${padded}${ESC}[0m`)
    }
    return lines.join('\n')
  }

  if (once) {
    write(io.stdout, `${frameText(0, size, showStatus && view !== null)}\n`)
    return 0
  }

  // Animated full-screen mode.
  let stopped = false
  let phase = 0
  let timer = null
  let dimensions = size
  const cleanup = () => {
    if (stopped) return
    stopped = true
    if (timer !== null) clearInterval(timer)
    try {
      io.stdin?.setRawMode?.(false)
    } catch {
      // Not a raw-capable stdin.
    }
    io.stdin?.pause?.()
    write(io.stdout, `${ESC}[0m${ESC}[?25h${ESC}[?1049l`)
  }
  const onKey = (data) => {
    const text = String(data)
    if (text.includes('q') || text.includes('Q') || text.charCodeAt(0) === 3) cleanup()
  }
  const onResize = () => {
    dimensions = terminalSize(io, options)
    draw()
  }
  const draw = () => {
    if (stopped) return
    write(io.stdout, `${ESC}[H${frameText(phase, dimensions, showStatus)}`)
  }
  const onSignal = () => cleanup()

  write(io.stdout, `${ESC}[?1049h${ESC}[?25l${ESC}[2J`)
  io.stdin?.setRawMode?.(true)
  io.stdin?.resume?.()
  io.stdin?.on?.('data', onKey)
  io.stdout?.on?.('resize', onResize)
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  timer = setInterval(() => {
    phase = (phase + 0.11) % (Math.PI * 2)
    draw()
  }, Math.round(1000 / fps))
  draw()

  return new Promise((resolve) => {
    const wait = setInterval(() => {
      if (!stopped) return
      clearInterval(wait)
      io.stdin?.off?.('data', onKey)
      io.stdout?.off?.('resize', onResize)
      process.removeListener('SIGINT', onSignal)
      process.removeListener('SIGTERM', onSignal)
      resolve(0)
    }, 50)
    wait.unref?.()
  })
}

export function helpText() {
  return `dsh-spend-wallpaper ${PACKAGE.version} — 在终端里查看余额与壁纸

用法:
  dsh-spend-wallpaper status [--json]      读取 DSH 插件状态并打印状态卡
  dsh-spend-wallpaper render [options]     用 ANSI 字符画渲染当前档位壁纸

render 选项:
  --tier <0-4|id>   指定档位（默认读取已持久化的当前档位）
  --once            只渲染一帧后退出（非 TTY 默认如此）
  --fps <n>         动画帧率，默认 8（1-30）
  --width <n>       列数（默认取终端宽度）
  --height <n>      行数（默认取终端高度）
  --color <mode>    truecolor | 256 | none（默认自动检测）
  --no-status       不显示底部状态行
  -h, --help        显示本帮助

示例:
  dsh-spend-wallpaper status
  dsh-spend-wallpaper render --tier 4 --once
  dsh-spend-wallpaper render              # 全屏动画，按 q 退出

状态文件: ${stateFilePath()}
`
}

/**
 * CLI entry point. Returns an exit code; `io` is injectable for tests.
 * @param {string[]} argv arguments after the executable name
 * @param {object} [io]
 */
export async function run(argv, io = {}) {
  const input = {
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
    stdin: io.stdin ?? process.stdin,
    env: io.env ?? process.env,
  }
  // Allow tests and scripts to point the CLI at a different harness home.
  if (input.env.DSH_HOME && process.env.DSH_HOME !== input.env.DSH_HOME) {
    process.env.DSH_HOME = input.env.DSH_HOME
  }
  const args = parseArgs(argv)
  if (args.options.version) {    write(input.stdout, `${PACKAGE.version}\n`)
    return 0
  }
  if (args.options.help || args._.length === 0) {
    write(input.stdout, helpText())
    return args.options.help ? 0 : 1
  }
  const command = args._[0]
  if (command === 'status') return statusCommand(args, input)
  if (command === 'render') return renderCommand(args, input)
  write(input.stderr, `未知命令：${command}\n\n${helpText()}`)
  return 1
}

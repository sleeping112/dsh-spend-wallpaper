// dsh-spend-wallpaper client bundle (DSH client Module Loader format).
// Browser half of dsh-spend-wallpaper: paints the wallpaper layer behind the
// DSH web shell and follows /plugins/dsh-spend-wallpaper/state.
window.__ModuleLoader__.load({
  id: 'dsh-spend-wallpaper',
  factory: (require) => {
    'use strict'

    const API = '/plugins/dsh-spend-wallpaper'
    const POLL_MS = 20_000
    const LAYER_ID = 'dswp-root'
    const STYLE_ID = 'dsh-spend-wallpaper/client.css'
    const CSS = `
html[data-dswp] { overflow: hidden; }
html[data-dswp] body { background-color: transparent !important; }
#${LAYER_ID} {
  position: fixed; inset: 0; z-index: -1;
  pointer-events: none; user-select: none;
  overflow: hidden; contain: strict;
  transition: opacity var(--dswp-fade, 600ms) ease;
}
#${LAYER_ID}[data-dswp-hidden] { opacity: 0; }
#${LAYER_ID} .dswp-media {
  position: absolute; inset: 0; overflow: hidden;
  filter: blur(var(--dswp-blur, 0px)) saturate(1.18) contrast(1.04);
  transform: scale(var(--dswp-scale, 1.02));
  transform-origin: center;
}
#${LAYER_ID} .dswp-frame {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: center;
  opacity: 0; transition: opacity var(--dswp-fade, 600ms) ease;
  will-change: opacity;
}
#${LAYER_ID} .dswp-frame[data-dswp-active] { opacity: 1; }
#${LAYER_ID} .dswp-scrim {
  position: absolute; inset: 0;
  background:
    radial-gradient(120% 90% at 50% 0%, transparent 40%, var(--dswp-scrim-2, rgba(0,0,0,.18)) 100%),
    linear-gradient(180deg, transparent 0%, var(--dswp-scrim, rgba(0,0,0,.28)) 100%);
  filter: blur(var(--dswp-scrim-blur, 0px));
}
html[data-dswp-mode="full"] body {
  background-color: transparent !important;
  background-image: none !important;
  --dsw-alias-bg-base: var(--dswp-surface, rgba(9, 13, 22, .55)) !important;
  --dsw-specific-sidebar-fill: var(--dswp-sidebar, rgba(9, 13, 22, .75)) !important;
  /* Chat composer + attachment/file cards. */
  --dsw-specific-input-major: var(--dswp-composer, rgba(9, 13, 22, .6)) !important;
  /* File-edit / result cards and layered panels. */
  --dsw-alias-bg-layer-1: var(--dswp-card, rgba(9, 13, 22, .66)) !important;
  --dsw-alias-bg-layer-2: var(--dswp-card, rgba(9, 13, 22, .66)) !important;
  /* Code blocks and the file/document edit viewer. */
  --dsw-alias-markdown-code-block: var(--dswp-code, rgba(9, 13, 22, .6)) !important;
  --dsw-alias-bg-document-preview: var(--dswp-document, rgba(9, 13, 22, .7)) !important;
  --dsw-alias-bg-module-platform: var(--dswp-card, rgba(9, 13, 22, .66)) !important;
}

#dswp-quick {
  position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
  width: 42px; height: 42px; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .28);
  background: rgba(20, 26, 40, .72);
  color: #fff; font-size: 21px; line-height: 1;
  cursor: pointer; pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 22px rgba(0, 0, 0, .28);
  backdrop-filter: blur(10px);
  transition: transform .15s ease, background .15s ease;
}
#dswp-quick:hover { transform: translateY(-1px) scale(1.05); background: rgba(36, 46, 70, .82); }
#dswp-panel {
  position: fixed; right: 18px; bottom: 70px; z-index: 2147483000;
  width: 304px; max-height: calc(100vh - 120px); overflow: auto;
  max-width: calc(100vw - 36px);
  padding: 14px 14px 12px; border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(18, 23, 36, .9);
  color: #eef2fb; pointer-events: auto;
  box-shadow: 0 16px 44px rgba(0, 0, 0, .4);
  backdrop-filter: blur(18px);
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
#dswp-panel[hidden] { display: none; }
#dswp-panel .dswp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
#dswp-panel .dswp-title { font-weight: 600; font-size: 14px; }
#dswp-panel .dswp-close {
  background: transparent; border: none; color: #aab6cc; font-size: 16px;
  cursor: pointer; padding: 0 2px; line-height: 1;
}
#dswp-panel .dswp-meta { color: #9fabc2; font-size: 12px; margin-bottom: 10px; }
#dswp-panel .dswp-section { margin: 10px 0; }
#dswp-panel .dswp-label { color: #8e9bb2; font-size: 11px; letter-spacing: .04em; margin-bottom: 5px; }
#dswp-panel .dswp-row { display: flex; flex-wrap: wrap; gap: 6px; }
#dswp-panel .dswp-chip {
  flex: 1 1 auto; min-width: 64px; padding: 6px 8px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, .14); background: rgba(255, 255, 255, .06);
  color: #e7edfa; cursor: pointer; font-size: 12px;
}
#dswp-panel .dswp-chip[data-active="1"] {
  background: rgba(106, 158, 255, .32);
  border-color: rgba(140, 180, 255, .7);
  color: #fff;
}
#dswp-panel .dswp-chip:disabled { opacity: .45; cursor: default; }
#dswp-panel .dswp-actions { display: flex; gap: 6px; margin-top: 12px; }
#dswp-panel .dswp-action {
  flex: 1; padding: 7px 8px; border-radius: 8px; cursor: pointer; font-size: 12px;
  border: 1px solid rgba(255, 255, 255, .18); background: rgba(255, 255, 255, .1);
  color: #fff;
}
#dswp-panel .dswp-action.primary { background: #4d7ef0; border-color: #4d7ef0; }
#dswp-panel .dswp-status { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, .1); color: #9fabc2; font-size: 12px; }
#dswp-panel .dswp-slider { margin: 7px 0; }
#dswp-panel .dswp-threshold-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
#dswp-panel .dswp-threshold {
  width: 92px; padding: 4px 6px; border-radius: 6px; font-size: 12px;
  border: 1px solid rgba(255, 255, 255, .18); background: rgba(255, 255, 255, .08); color: #fff;
}
#dswp-panel .dswp-scene-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 5px 0; }
#dswp-panel .dswp-scene-name {
  flex: 1 1 auto; min-width: 0; padding: 4px 6px; border-radius: 6px; font-size: 12px;
  border: 1px solid rgba(255, 255, 255, .16); background: rgba(255, 255, 255, .08); color: #eef2fb;
}
#dswp-panel .dswp-scene-name::placeholder { color: #7f8ca6; }
#dswp-panel .dswp-param {
  width: 112px; padding: 4px 6px; border-radius: 6px; font-size: 12px;
  border: 1px solid rgba(255, 255, 255, .18); background: rgba(255, 255, 255, .08); color: #fff;
}
#dswp-panel .dswp-scene-label { font-size: 12px; color: #dfe7f8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#dswp-panel .dswp-scene-actions { display: flex; gap: 5px; flex: 0 0 auto; }
#dswp-panel .dswp-scene-display {
  margin: 2px 0 8px; padding: 6px 8px 8px; border-radius: 8px;
  background: rgba(255, 255, 255, .04); border: 1px solid rgba(255, 255, 255, .08);
}
#dswp-panel .dswp-scene-actions .dswp-action { flex: 0 0 auto; padding: 4px 8px; }
#dswp-panel .dswp-slider-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
#dswp-panel .dswp-value { color: #cfdaf2; font-size: 11px; font-variant-numeric: tabular-nums; }
#dswp-panel .dswp-range {
  width: 100%; height: 4px; -webkit-appearance: none; appearance: none;
  border-radius: 2px; background: rgba(255, 255, 255, .18); outline: none; cursor: pointer;
}
#dswp-panel .dswp-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%;
  background: #7aa2ff; border: 1px solid rgba(255, 255, 255, .7);
}
#dswp-panel .dswp-range::-moz-range-thumb {
  width: 13px; height: 13px; border-radius: 50%; background: #7aa2ff;
  border: 1px solid rgba(255, 255, 255, .7);
}
@media (prefers-reduced-motion: reduce) {
  #dswp-quick { transition: none; }
}
@media (prefers-reduced-motion: reduce) {
  #${LAYER_ID}, #${LAYER_ID} .dswp-frame { transition: none !important; }
}
@media (prefers-contrast: more) {
  #${LAYER_ID} .dswp-scrim { background: rgba(0, 0, 0, .72); }
}
`

    const isDark = () => {
      const body = document.body
      if (!body) return true
      if (body.hasAttribute('data-ds-dark-theme')) return true
      const scheme = body.getAttribute('data-theme') || document.documentElement.getAttribute('data-theme')
      if (scheme === 'dark') return true
      if (scheme === 'light') return false
      return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
    }
    const prefersReducedMotion = () => window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

    let styleTag = null
    let activeFrame = null
    let frameCleanupTimer = null

    function cancelFrameCleanup() {
      if (frameCleanupTimer !== null) {
        window.clearTimeout(frameCleanupTimer)
        frameCleanupTimer = null
      }
    }

    function ensureStyle() {
      if (styleTag !== null) return styleTag
      styleTag = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']')
      if (styleTag === null) {
        styleTag = document.createElement('style')
        styleTag.dataset.plugin = 'dsh-spend-wallpaper'
        styleTag.dataset.pluginCss = STYLE_ID
        styleTag.textContent = CSS
        document.head.appendChild(styleTag)
      }
      return styleTag
    }
    function removeStyle() {
      if (styleTag !== null) {
        try { styleTag.remove() } catch { /* ignore */ }
        styleTag = null
      }
    }

    function ensureLayer() {
      const existing = document.getElementById(LAYER_ID)
      if (existing !== null) existing.remove()
      const root = document.createElement('div')
      root.id = LAYER_ID
      root.setAttribute('aria-hidden', 'true')
      const scrim = document.createElement('div')
      scrim.className = 'dswp-scrim'
      root.appendChild(scrim)
      document.body.prepend(root)
      return root
    }

    function rgba(hex, alpha) {
      const value = hex.replace('#', '')
      const red = parseInt(value.slice(0, 2), 16)
      const green = parseInt(value.slice(2, 4), 16)
      const blue = parseInt(value.slice(4, 6), 16)
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`
    }

    function applyScrimColors(state) {
      const html = document.documentElement
      const dark = isDark()
      const scrim = Math.max(0, Math.min(1, Number(state?.rendering?.scrim ?? 0.10)))
      const dim = Math.max(0, Math.min(1, Number(state?.rendering?.dim ?? 0.03)))
      const light = dark ? '#0b1220' : '#f6f8fc'
      const strength = Math.min(1, scrim + dim)
      html.style.setProperty('--dswp-scrim', rgba(light, strength))
      html.style.setProperty('--dswp-scrim-2', rgba(light, strength * 0.6))
      html.style.setProperty('--dswp-scrim-blur', '0px')
      const surface = Math.max(0.2, Math.min(1, Number(state?.rendering?.surfaceOpacity ?? 0.50)))
      html.style.setProperty('--dswp-surface', rgba(dark ? '#0b1220' : '#ffffff', surface))
      html.style.setProperty('--dswp-sidebar', rgba(dark ? '#0b1220' : '#ffffff', Math.min(1, surface + 0.18)))
      // Inner surfaces (chat composer, file edit cards, code blocks, document
      // preview) are normally opaque; keep them slightly more solid than the
      // panels but still let the wallpaper through.
      const tint = dark ? '#0b1220' : '#ffffff'
      const inner = (floor, offset) => rgba(tint, Math.min(1, Math.max(floor, surface + offset)))
      html.style.setProperty('--dswp-composer', inner(0.55, 0.10))
      html.style.setProperty('--dswp-card', inner(0.62, 0.18))
      html.style.setProperty('--dswp-code', inner(0.58, 0.12))
      html.style.setProperty('--dswp-document', inner(0.65, 0.22))
      const blur = Math.max(0, Math.min(24, Number(state?.rendering?.blur ?? 0)))
      html.style.setProperty('--dswp-blur', `${blur}px`)
      html.style.setProperty('--dswp-scale', blur > 0 ? '1.04' : '1.02')
    }

    function applyRendering(state) {
      const html = document.documentElement
      const rendering = state?.rendering ?? {}
      html.dataset.dswp = 'on'
      // The wallpaper is always full-bleed now; the old frame mode was removed.
      html.dataset.dswpMode = 'full'
      html.style.setProperty('--dswp-fade', `${Math.max(0, Number(rendering.transitionMs ?? 600))}ms`)
      applyScrimColors(state)
      ensureStyle()
    }

    function clearRendering() {
      const html = document.documentElement
      delete html.dataset.dswp
      delete html.dataset.dswpMode
      for (const property of ['--dswp-fade', '--dswp-scrim', '--dswp-scrim-2', '--dswp-scrim-blur', '--dswp-surface', '--dswp-sidebar', '--dswp-composer', '--dswp-card', '--dswp-code', '--dswp-document', '--dswp-blur', '--dswp-scale']) {
        html.style.removeProperty(property)
      }
    }

    function applyFrameLayout(element, wallpaper) {
      const fit = ['cover', 'contain', 'fill'].includes(wallpaper.fit) ? wallpaper.fit : 'cover'
      const x = Number.isFinite(Number(wallpaper.x)) ? Number(wallpaper.x) : 50
      const y = Number.isFinite(Number(wallpaper.y)) ? Number(wallpaper.y) : 50
      const scale = Number.isFinite(Number(wallpaper.scale)) ? Number(wallpaper.scale) : 1
      element.style.objectFit = fit
      element.style.objectPosition = `${x}% ${y}%`
      element.style.transformOrigin = 'center'
      element.style.transform = scale !== 1 ? `scale(${scale})` : ''
    }

    function createFrame(wallpaper, posterOnly, autoplay = true) {
      const element = document.createElement(posterOnly ? 'img' : 'video')
      element.className = 'dswp-frame'
      element.setAttribute('aria-hidden', 'true')
      element.draggable = false
      applyFrameLayout(element, wallpaper)
      if (posterOnly) {
        element.src = wallpaper.poster || wallpaper.src
        element.alt = ''
      } else {
        element.src = wallpaper.src
        if (wallpaper.poster) element.poster = wallpaper.poster
        element.muted = true
        element.defaultMuted = true
        element.loop = true
        element.playsInline = true
        element.autoplay = autoplay
        element.preload = 'metadata'
        element.setAttribute('muted', '')
        element.setAttribute('playsinline', '')
        element.setAttribute('disablespictureinpicture', '')
        element.addEventListener('error', () => {
          if (wallpaper.poster && element.parentNode) {
            const fallback = createFrame(wallpaper, true)
            element.parentNode.insertBefore(fallback, element)
            // The cleanup timer keeps whatever the *latest* frame is; make
            // sure the fallback wins instead of the removed video, but never
            // hijack the active frame if a newer preview already replaced it.
            if (activeFrame === element) activeFrame = fallback
            requestAnimationFrame(() => fallback.dataset.dswpActive = '1')
            element.remove()
          }
        })
        const start = () => {
          if (autoplay) {
            element.play().catch(() => {})
          } else {
            // A custom video has no poster; force a decoded first frame so
            // "static" mode does not show a broken image.
            try { element.currentTime = 0.001 } catch { /* ignore */ }
          }
        }
        element.addEventListener('canplay', start, { once: true })
        if (autoplay) start()
      }
      return element
    }

    function setMedia(layer, wallpaper, rendering) {
      const media = layer.querySelector('.dswp-media')
      const container = media || layer
      // A new frame supersedes any pending cleanup: cancelling the old timer
      // prevents an older transition from removing the new preview/live frame
      // (which previously caused the wallpaper to briefly disappear).
      cancelFrameCleanup()
      if (!wallpaper) {
        activeFrame = null
        for (const child of [...container.querySelectorAll('.dswp-frame')]) child.remove()
        return
      }
      const reduced = prefersReducedMotion()
      // A user-uploaded video has no poster. In static/reduced mode we still
      // need a <video> element (paused on its first frame); an <img> with a
      // video URL would be a broken image and leave the layer blank.
      const videoWithoutPoster = wallpaper.kind === 'video' && !wallpaper.poster
      const posterOnly = (wallpaper.kind !== 'video' || reduced || (rendering?.media === 'static'))
        && !videoWithoutPoster
      const autoplay = !posterOnly && !reduced && rendering?.media !== 'static'
      const frame = createFrame(wallpaper, posterOnly, autoplay)
      activeFrame = frame
      container.appendChild(frame)
      requestAnimationFrame(() => {
        frame.dataset.dswpActive = '1'
      })
      const fade = Math.max(0, Number(rendering?.transitionMs ?? 600))
      frameCleanupTimer = window.setTimeout(() => {
        frameCleanupTimer = null
        for (const child of [...container.querySelectorAll('.dswp-frame')]) {
          if (child !== activeFrame) child.remove()
        }
      }, fade + 50)
    }

    function el(tag, props = {}, children = []) {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(props)) {
        if (key === 'text') node.textContent = String(value)
        else if (key === 'className') node.className = String(value)
        else if (key === 'dataset') Object.assign(node.dataset, value)
        else if (key === 'onClick') node.addEventListener('click', value)
        else node.setAttribute(key, String(value))
      }
      for (const child of children) node.appendChild(child)
      return node
    }

    function createQuickUi(api) {
      const button = el('button', {
        id: 'dswp-quick', type: 'button', title: '壁纸快捷切换', text: '🐋',
        'aria-label': '壁纸快捷切换',
      })
      const panel = el('div', { id: 'dswp-panel' })
      panel.setAttribute('hidden', '')
      let disposed = false
      let expandedScene = -1
      const get = api.getSnapshot

      const close = () => panel.setAttribute('hidden', '')
      const toggle = () => {
        if (!panel.hasAttribute('hidden')) {
          close()
          return
        }
        panel.removeAttribute('hidden')
        const snapshot = get()
        if (!disposed && expandedScene === -1 && snapshot?.scenes?.[snapshot.tier?.index]?.custom) {
          expandedScene = snapshot.tier.index
        }
        render(true)
      }

      const chip = (label, active, onClick, disabled = false) => {
        const props = {
          className: 'dswp-chip', type: 'button', dataset: { active: active ? '1' : '0' },
          text: label, onClick,
        }
        if (disabled) props.disabled = ''
        return el('button', props)
      }

      const row = (label, chips) => el('div', { className: 'dswp-section' }, [
        el('div', { className: 'dswp-label', text: label }),
        el('div', { className: 'dswp-row' }, chips),
      ])

      const slider = (label, value, min, max, step, format, onCommit) => {
        const current = Number.isFinite(Number(value)) ? Number(value) : min
        const valueLabel = el('span', { className: 'dswp-value', text: format(current) })
        const input = el('input', {
          className: 'dswp-range', type: 'range', min, max, step, value: current,
          'aria-label': label,
        })
        input.addEventListener('input', () => {
          valueLabel.textContent = format(Number(input.value))
        })
        input.addEventListener('change', () => {
          const next = Number(input.value)
          if (Number.isFinite(next)) onCommit(next)
        })
        return el('div', { className: 'dswp-slider' }, [
          el('div', { className: 'dswp-slider-head' }, [
            el('span', { className: 'dswp-label', text: label }),
            valueLabel,
          ]),
          input,
        ])
      }

      const thresholdValues = () => (get()?.thresholds ?? []).map(String)
      const patchThresholds = (values) => api.patchConfig({ thresholds: values })

      const changeTierCount = (delta) => {
        const values = thresholdValues()
        if (delta > 0 && values.length < 8) {
          const last = Number(values[values.length - 1] ?? 0)
          values.push(String(last <= 0 ? 0.05 : Number((last * 2).toFixed(4))))
        } else if (delta < 0 && values.length > 2) {
          values.pop()
        } else {
          return
        }
        patchThresholds(values)
      }

      const chooseScene = (index) => {
        const input = el('input', { type: 'file', accept: 'image/*,video/*' })
        input.style.display = 'none'
        const cleanup = () => {
          if (input.parentNode) input.remove()
        }
        input.addEventListener('change', () => {
          const file = input.files?.[0] ?? null
          cleanup()
          if (!file) return
          const reader = new FileReader()
          reader.onload = async () => {
            try {
              // Some browsers give an empty MIME type for less common files;
              // infer it from the extension so the host accepts the upload.
              let contentType = file.type
              if (!contentType) {
                const name = String(file.name || '').toLowerCase()
                if (name.endsWith('.webm')) contentType = 'video/webm'
                else if (name.endsWith('.mp4')) contentType = 'video/mp4'
                else if (name.endsWith('.mov')) contentType = 'video/quicktime'
                else if (name.endsWith('.png')) contentType = 'image/png'
                else if (name.endsWith('.jpg') || name.endsWith('.jpeg')) contentType = 'image/jpeg'
                else if (name.endsWith('.webp')) contentType = 'image/webp'
                else if (name.endsWith('.gif')) contentType = 'image/gif'
                else if (name.endsWith('.avif')) contentType = 'image/avif'
                else contentType = 'application/octet-stream'
              }
              const response = await fetch(`${API}/scenes/${index}`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': contentType },
                body: reader.result,
              })
              if (response.ok) {
                await api.pollNow()
                expandedScene = index
                render(true)
              }
            } catch {
              // Keep the previous scene on failure.
            }
          }
          reader.readAsArrayBuffer(file)
        })
        document.body.appendChild(input)
        input.click()
        // Cancelling the picker does not always fire `change`; clean up later.
        window.setTimeout(() => {
          if (input.parentNode) input.remove()
        }, 120_000)
      }

      const resetScene = async (index) => {
        try {
          await fetch(`${API}/scenes/${index}/reset`, { method: 'POST', credentials: 'same-origin' })
        } catch {
          // Poll below reflects whatever the host kept.
        }
        await api.pollNow()
      }

      const sceneSettingAt = (index) => {
        const scene = (get()?.scenes ?? [])[index]
        return scene?.settings ?? { fit: 'cover', x: 50, y: 50, scale: 1 }
      }

      const patchSceneSetting = (index, patch) => {
        const settings = (get()?.scenes ?? []).map((scene) => ({
          fit: 'cover', x: 50, y: 50, scale: 1,
          ...(scene.settings ?? {}),
        }))
        settings[index] = { ...sceneSettingAt(index), ...patch }
        api.patchConfig({ sceneSettings: settings })
      }

      const sceneDisplayControls = (index) => {
        const settings = sceneSettingAt(index)
        return el('div', { className: 'dswp-scene-display' }, [
          el('div', { className: 'dswp-row' }, [
            chip('铺满', settings.fit === 'cover', () => patchSceneSetting(index, { fit: 'cover' })),
            chip('完整', settings.fit === 'contain', () => patchSceneSetting(index, { fit: 'contain' })),
            chip('拉伸', settings.fit === 'fill', () => patchSceneSetting(index, { fit: 'fill' })),
          ]),
          el('div', { className: 'dswp-row' }, [
            chip('顶部', settings.y === 0, () => patchSceneSetting(index, { y: 0 })),
            chip('居中', settings.y === 50, () => patchSceneSetting(index, { y: 50 })),
            chip('底部', settings.y === 100, () => patchSceneSetting(index, { y: 100 })),
          ]),
          slider('横向焦点', settings.x, 0, 100, 1,
            (value) => `${Math.round(value)}%`, (value) => patchSceneSetting(index, { x: value })),
          slider('纵向焦点', settings.y, 0, 100, 1,
            (value) => `${Math.round(value)}%`, (value) => patchSceneSetting(index, { y: value })),
          slider('缩放', settings.scale, 1, 3, 0.05,
            (value) => `${Math.round(value * 100)}%`, (value) => patchSceneSetting(index, { scale: value })),
        ])
      }

      const render = (force = false) => {
        if (disposed || panel.hasAttribute('hidden')) return
        if (!force) {
          const active = document.activeElement
          // Do not rebuild the panel while a text/number/slider input is being
          // edited; button clicks force a rebuild instead.
          if (active && active.tagName === 'INPUT' && panel.contains(active)) return
        }
        const scrollTop = panel.scrollTop || 0
        const snapshot = get()
        panel.textContent = ''
        panel.appendChild(el('div', { className: 'dswp-head' }, [
          el('span', { className: 'dswp-title', text: '壁纸快捷切换 · v0.12.3' }),
          el('button', { className: 'dswp-close', type: 'button', text: '×', 'aria-label': '关闭', onClick: close }),
        ]))
        if (snapshot === null) {
          panel.appendChild(el('div', { className: 'dswp-meta', text: '正在读取状态…' }))
          panel.scrollTop = scrollTop
          return
        }
        panel.appendChild(el('div', {
          className: 'dswp-meta',
          text: `${snapshot.tier?.label ?? '—'} · ¥${snapshot.spend1h ?? '--'}/h · ${snapshot.scenes.length} 档`,
        }))
        const activeSceneIndex = snapshot.tier?.index ?? 0
        if (snapshot.scenes?.[activeSceneIndex]?.custom) {
          panel.appendChild(el('div', { className: 'dswp-section' }, [
            el('div', { className: 'dswp-label', text: '当前场景画面（已上传，可直接调）' }),
            sceneDisplayControls(activeSceneIndex),
          ]))
        }
        const scenes = snapshot.scenes ?? []
        const thresholds = snapshot.thresholds ?? []
        // Thresholds + tier count.
        const tierSection = el('div', { className: 'dswp-section' }, [
          el('div', { className: 'dswp-slider-head' }, [
            el('span', { className: 'dswp-label', text: '档位与阈值' }),
            el('div', { className: 'dswp-row' }, [
              chip('−', false, () => changeTierCount(-1), thresholds.length <= 2),
              el('span', { className: 'dswp-value', text: `${thresholds.length} 档` }),
              chip('+', false, () => changeTierCount(1), thresholds.length >= 8),
            ]),
          ]),
        ])
        thresholds.forEach((value, index) => {
          const input = el('input', {
            className: 'dswp-threshold', type: 'number', step: '0.01', min: '0',
            value: String(value), 'aria-label': `阈值 ${index}`,
          })
          if (index === 0) input.setAttribute('disabled', '')
          input.addEventListener('change', () => {
            // Collect every field from the DOM so two quick edits in different
            // threshold boxes cannot overwrite each other before the next poll.
            const values = panel.querySelectorAll('.dswp-threshold').map((item) => item.value)
            if (index < values.length) values[index] = input.value
            patchThresholds(values)
          })
          tierSection.appendChild(el('div', { className: 'dswp-threshold-row' }, [
            el('span', { className: 'dswp-label', text: index === 0 ? '起始' : `阈值 ${index + 1}` }),
            input,
            el('span', { className: 'dswp-value', text: '元/小时' }),
          ]))
        })
        panel.appendChild(tierSection)

        // Per-tier scenes with upload / clear.
        const sceneSection = el('div', { className: 'dswp-section' }, [
          el('div', { className: 'dswp-label', text: '每档场景（可上传图片或视频）' }),
        ])
        scenes.forEach((scene, index) => {
          const actions = [
            el('button', {
              className: 'dswp-action', type: 'button',
              text: expandedScene === index ? '收起' : '调整画面',
              onClick: () => {
                expandedScene = expandedScene === index ? -1 : index
                render(true)
              },
            }),
            el('button', {
              className: 'dswp-action', type: 'button', text: '上传',
              onClick: () => chooseScene(index),
            }),
          ]
          if (scene.custom) {
            actions.push(el('button', {
              className: 'dswp-action', type: 'button', text: '清除',
              onClick: () => resetScene(index),
            }))
          }
          sceneSection.appendChild(el('div', { className: 'dswp-scene-row' }, [
            el('input', {
              className: 'dswp-scene-name', type: 'text', maxlength: '40',
              value: scene.label, placeholder: '场景名', 'aria-label': `第 ${index + 1} 档名称`,
            }),
            el('div', { className: 'dswp-scene-actions' }, actions),
          ]))
          const nameInput = sceneSection.children[sceneSection.children.length - 1].children[0]
          nameInput.addEventListener('change', () => {
            const names = panel.querySelectorAll('.dswp-scene-name').map((item) => item.value.trim())
            if (index < names.length) names[index] = nameInput.value.trim()
            api.patchConfig({ sceneNames: names })
          })
          if (expandedScene === index) {
            const settings = scene.settings ?? { fit: 'cover', x: 50, y: 50, scale: 1 }
            const editor = el('div', { className: 'dswp-scene-display' }, [
              el('div', { className: 'dswp-row' }, [
                chip('铺满', settings.fit === 'cover', () => patchSceneSetting(index, { fit: 'cover' })),
                chip('完整', settings.fit === 'contain', () => patchSceneSetting(index, { fit: 'contain' })),
                chip('拉伸', settings.fit === 'fill', () => patchSceneSetting(index, { fit: 'fill' })),
              ]),
              el('div', { className: 'dswp-row' }, [
                chip('顶部', settings.y === 0, () => patchSceneSetting(index, { y: 0 })),
                chip('居中', settings.y === 50, () => patchSceneSetting(index, { y: 50 })),
                chip('底部', settings.y === 100, () => patchSceneSetting(index, { y: 100 })),
              ]),
              slider('横向焦点', settings.x, 0, 100, 1,
                (value) => `${Math.round(value)}%`, (value) => patchSceneSetting(index, { x: value })),
              slider('纵向焦点', settings.y, 0, 100, 1,
                (value) => `${Math.round(value)}%`, (value) => patchSceneSetting(index, { y: value })),
              slider('缩放', settings.scale, 1, 3, 0.05,
                (value) => `${Math.round(value * 100)}%`, (value) => patchSceneSetting(index, { scale: value })),
            ])
            sceneSection.appendChild(editor)
            if (typeof editor.scrollIntoView === 'function') {
              requestAnimationFrame(() => {
                try { editor.scrollIntoView({ block: 'nearest' }) } catch { /* ignore */ }
              })
            }
          }
        })
        panel.appendChild(sceneSection)

        const packed = snapshot.scenes.map((scene, index) => [scene, index])
        panel.appendChild(row('预览档位', packed.map(([scene, index]) => chip(
          scene.label,
          api.isPreviewing() && api.previewIndex() === index,
          () => {
            const preview = snapshot.scenes[index]
            if (preview) api.showPreview({
              kind: preview.videoUrl ? 'video' : 'image',
              src: preview.videoUrl || preview.imageUrl,
              poster: preview.videoUrl ? preview.imageUrl : null,
              ...(preview.settings ?? {}),
              transitionMs: snapshot.rendering?.transitionMs ?? 600,
              sceneIndex: index,
            }, index)
          },
          snapshot.enabled === false,
        ))))
        panel.appendChild(row('锁定', [
          chip(snapshot.lockedTier ? `已锁定 ${snapshot.tier.label}` : '锁定当前档', Boolean(snapshot.lockedTier), () => api.patchConfig({
            lockedTier: snapshot.lockedTier ? '' : String(snapshot.tier.index),
          })),
        ]))

        panel.appendChild(el('div', { className: 'dswp-section' }, [
          el('div', { className: 'dswp-label', text: '外观' }),
          slider('面板不透明度', snapshot.rendering?.surfaceOpacity ?? 0.45, 0.2, 1, 0.05,
            (value) => `${Math.round(value * 100)}%`, (value) => api.patchConfig({ surfaceOpacity: value })),
          slider('壁纸暗化', snapshot.rendering?.scrim ?? 0.1, 0, 0.6, 0.02,
            (value) => `${Math.round(value * 100)}%`, (value) => api.patchConfig({ scrim: value })),
          slider('额外压暗', snapshot.rendering?.dim ?? 0.03, 0, 0.6, 0.02,
            (value) => `${Math.round(value * 100)}%`, (value) => api.patchConfig({ dim: value })),
          slider('壁纸模糊', snapshot.rendering?.blur ?? 0, 0, 16, 1,
            (value) => `${value}px`, (value) => api.patchConfig({ blur: value })),
        ]))
        panel.appendChild(row('切换动画', [0, 300, 600, 1200].map((ms) => chip(
          ms === 0 ? '无' : `${ms}ms`,
          snapshot.rendering?.transitionMs === ms,
          () => api.patchConfig({ transitionMs: ms }),
        ))))
        const sampleInput = el('input', {
          className: 'dswp-param', type: 'number', min: '60', max: '600', step: '1',
          value: String(snapshot.sampling?.sampleSeconds ?? 180),
          placeholder: '180', 'aria-label': '采样间隔（秒）',
        })
        sampleInput.addEventListener('change', () => {
          const value = Number(sampleInput.value)
          if (Number.isFinite(value)) api.patchConfig({ sampleSeconds: value })
        })
        panel.appendChild(el('div', { className: 'dswp-section' }, [
          el('div', { className: 'dswp-label', text: '采样间隔（秒，60–600，留空用默认）' }),
          sampleInput,
        ]))
        const windowInput = el('input', {
          className: 'dswp-param', type: 'number', min: '5', max: '180', step: '1',
          value: String(snapshot.windowMinutes ?? 60), placeholder: '60',
          'aria-label': '统计窗口（分钟）',
        })
        windowInput.addEventListener('change', () => {
          const value = Number(windowInput.value)
          if (Number.isFinite(value)) api.patchConfig({ windowMinutes: value })
        })
        panel.appendChild(el('div', { className: 'dswp-section' }, [
          el('div', { className: 'dswp-label', text: '统计窗口（分钟，5–180，留空用默认）' }),
          windowInput,
        ]))
        const hysteresis = snapshot.sampling?.hysteresis
        const dwell = snapshot.sampling?.minDwellSeconds
        panel.appendChild(row('防抖', [
          ['快速', 0.1, 120], ['默认', 0.25, 600], ['稳定', 0.4, 1800],
        ].map(([label, h, d]) => chip(
          label,
          hysteresis === h && dwell === d,
          () => api.patchConfig({ hysteresis: h, minDwellSeconds: d }),
        ))))
        const actions = []
        if (api.isPreviewing()) actions.push(el('button', { className: 'dswp-action primary', type: 'button', text: '回到实时', onClick: () => api.clearPreview() }))
        actions.push(el('button', {
          className: 'dswp-action', type: 'button', text: '刷新数据', onClick: () => {
            api.clearPreview()
            api.refresh()
          },
        }))
        actions.push(el('button', { className: 'dswp-action', type: 'button', text: snapshot.enabled ? '关闭壁纸' : '开启壁纸', onClick: () => api.patchConfig({ enabled: !snapshot.enabled }) }))
        actions.push(el('button', {
          className: 'dswp-action', type: 'button', text: '恢复默认', onClick: () => {
            api.clearPreview()
            api.patchConfig({ reset: true })
          },
        }))
        panel.appendChild(el('div', { className: 'dswp-actions' }, actions))
        panel.appendChild(el('div', { className: 'dswp-status', text: '已上传场景点「调整画面」可改裁切焦点/缩放；设置按档保存' }))
        panel.scrollTop = scrollTop
      }

      button.addEventListener('click', toggle)
      document.body.appendChild(button)
      document.body.appendChild(panel)

      return {
        update() {
          if (!disposed && !panel.hasAttribute('hidden')) render()
        },
        dispose() {
          disposed = true
          button.remove()
          panel.remove()
        },
      }
    }

    function install(ctx) {
      if (!document.body) return () => {}
      ensureStyle()
      const layer = ensureLayer()
      const media = document.createElement('div')
      media.className = 'dswp-media'
      layer.insertBefore(media, layer.firstChild)

      let snapshot = null
      let applied = null
      let timer = null
      let stopped = false
      let previewActive = false
      let previewUntil = 0
      let previewWallpaper = null
      let previewIndex = null
      let previewTimer = null
      let quick = null

      const themeObserver = new MutationObserver(() => {
        if (snapshot !== null) applyScrimColors(snapshot)
      })
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })

      const updateQuick = () => {
        if (quick !== null) quick.update(snapshot)
      }

      const apply = (next) => {
        if (stopped || !next) return
        applied = next
        const wallpaper = previewActive && previewWallpaper !== null && Date.now() < previewUntil
          ? previewWallpaper
          : next.wallpaper
        if (!next.enabled) {
          clearRendering()
          layer.dataset.dswpHidden = '1'
          setMedia(layer, null, next.rendering)
          return
        }
        delete layer.dataset.dswpHidden
        if (!wallpaper) {
          // No usable pack yet: leave the stock DSH look untouched.
          clearRendering()
          layer.dataset.dswpHidden = '1'
          setMedia(layer, null, next.rendering)
          return
        }
        applyRendering(next)
        setMedia(layer, wallpaper, next.rendering)
      }

      const poll = async () => {
        if (stopped) return
        try {
          const response = await fetch(`${API}/state`, { credentials: 'same-origin', cache: 'no-store' })
          if (!response.ok) return
          const next = await response.json()
          snapshot = next
          updateQuick()
          if (previewActive) {
            if (Date.now() < previewUntil && next.enabled) {
              // Keep the previewed wallpaper, but let appearance/theme changes
              // (opacity, scrim, mode…) apply while previewing.
              if (next.rendering) {
                applyRendering(next)
                applyScrimColors(next)
              }
              return
            }
            if (previewTimer !== null) {
              window.clearTimeout(previewTimer)
              previewTimer = null
            }
            previewActive = false
            previewWallpaper = null
            previewIndex = null
            apply(next)
            return
          }
          const same = applied !== null
            && applied.wallpaper?.src === next.wallpaper?.src
            && applied.rendering?.mode === next.rendering?.mode
            && applied.enabled === next.enabled
          if (!same) apply(next)
          else if (next.rendering) applyScrimColors(next)
        } catch {
          // Keep the last known wallpaper when the host is briefly unreachable.
        }
      }

      const showPreview = (wallpaper, index) => {
        previewActive = true
        previewWallpaper = wallpaper
        previewIndex = index
        previewUntil = Date.now() + 15_000
        if (previewTimer !== null) window.clearTimeout(previewTimer)
        previewTimer = window.setTimeout(() => {
          previewTimer = null
          clearPreview()
        }, 15_000)
        if (snapshot !== null) {
          // A previously hidden layer (disabled / no wallpaper yet) must be
          // unhidden for the preview, otherwise the preview is invisible.
          delete layer.dataset.dswpHidden
          applyRendering(snapshot)
          setMedia(layer, wallpaper, snapshot.rendering)
        }
        updateQuick()
      }

      const clearPreview = () => {
        const wasActive = previewActive || previewTimer !== null
        if (previewTimer !== null) {
          window.clearTimeout(previewTimer)
          previewTimer = null
        }
        previewActive = false
        previewUntil = 0
        previewWallpaper = null
        previewIndex = null
        if (wasActive) {
          if (snapshot !== null) apply(snapshot)
          updateQuick()
        }
      }

      const patchConfig = async (patch) => {
        try {
          await fetch(`${API}/config`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
        } catch {
          // The next poll reflects whatever the host accepted.
        }
        await poll()
      }

      const refresh = async () => {
        try {
          await fetch(`${API}/refresh`, { method: 'POST', credentials: 'same-origin' })
        } catch {
          // Ignore; the poll reports the host snapshot.
        }
        await poll()
      }

      quick = createQuickUi({
        getSnapshot: () => snapshot,
        isPreviewing: () => previewActive && Date.now() < previewUntil,
        previewIndex: () => previewIndex,
        showPreview,
        clearPreview,
        patchConfig,
        refresh,
        pollNow: poll,
      })

      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          poll()
          const video = layer.querySelector('video')
          if (video) video.play().catch(() => {})
        } else {
          for (const video of layer.querySelectorAll('video')) video.pause()
        }
      }

      const onFocus = () => poll()
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('focus', onFocus)
      poll()
      timer = window.setInterval(poll, POLL_MS)

      return () => {
        stopped = true
        cancelFrameCleanup()
        if (timer !== null) window.clearInterval(timer)
        if (previewTimer !== null) {
          window.clearTimeout(previewTimer)
          previewTimer = null
        }
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('focus', onFocus)
        themeObserver.disconnect()
        if (quick !== null) quick.dispose()
        for (const video of layer.querySelectorAll('video')) {
          try { video.pause() } catch { /* ignore */ }
        }
        layer.remove()
        removeStyle()
        clearRendering()
      }
    }

    const exports = {
      name: 'spend-wallpaper-client',
      inject: [],
      apply: (ctx) => {
        const start = () => {
          const dispose = install(ctx)
          return () => {
            try {
              dispose()
            } catch {
              // Ignore teardown races during HMR.
            }
          }
        }
        if (typeof ctx.effect === 'function') ctx.effect(start, 'spend-wallpaper: wallpaper layer')
        else start()
      },
    }
    return exports
  },
})

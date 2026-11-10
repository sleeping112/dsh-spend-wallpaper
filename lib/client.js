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
html[data-dswp-mode="frame"] body {
  box-sizing: border-box;
  padding: var(--dswp-inset, 16px);
}
html[data-dswp-mode="frame"] #root > div:first-child {
  border-radius: var(--dswp-radius, 16px);
  overflow: hidden;
}
html[data-dswp-mode="full"] body {
  background-color: transparent !important;
  background-image: none !important;
  --dsw-alias-bg-base: var(--dswp-surface, rgba(9, 13, 22, .55)) !important;
  --dsw-specific-sidebar-fill: var(--dswp-sidebar, rgba(9, 13, 22, .75)) !important;
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
      const blur = Math.max(0, Math.min(24, Number(state?.rendering?.blur ?? 0)))
      html.style.setProperty('--dswp-blur', `${blur}px`)
      html.style.setProperty('--dswp-scale', blur > 0 ? '1.04' : '1.02')
    }

    function applyRendering(state) {
      const html = document.documentElement
      const rendering = state?.rendering ?? {}
      html.dataset.dswp = 'on'
      html.dataset.dswpMode = rendering.mode === 'full' ? 'full' : 'frame'
      html.style.setProperty('--dswp-inset', `${Math.max(0, Number(rendering.inset ?? 16))}px`)
      html.style.setProperty('--dswp-radius', `${Math.max(0, Number(rendering.radius ?? 16))}px`)
      html.style.setProperty('--dswp-fade', `${Math.max(0, Number(rendering.transitionMs ?? 600))}ms`)
      applyScrimColors(state)
      ensureStyle()
    }

    function clearRendering() {
      const html = document.documentElement
      delete html.dataset.dswp
      delete html.dataset.dswpMode
      for (const property of ['--dswp-inset', '--dswp-radius', '--dswp-fade', '--dswp-scrim', '--dswp-scrim-2', '--dswp-scrim-blur', '--dswp-surface', '--dswp-sidebar', '--dswp-blur', '--dswp-scale']) {
        html.style.removeProperty(property)
      }
    }

    function createFrame(wallpaper, posterOnly) {
      const element = document.createElement(posterOnly ? 'img' : 'video')
      element.className = 'dswp-frame'
      element.setAttribute('aria-hidden', 'true')
      element.draggable = false
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
        element.autoplay = true
        element.preload = 'metadata'
        element.setAttribute('muted', '')
        element.setAttribute('playsinline', '')
        element.setAttribute('disablespictureinpicture', '')
        element.addEventListener('error', () => {
          if (wallpaper.poster && element.parentNode) {
            const fallback = createFrame(wallpaper, true)
            element.parentNode.insertBefore(fallback, element)
            requestAnimationFrame(() => fallback.dataset.dswpActive = '1')
            element.remove()
          }
        })
        const play = () => element.play().catch(() => {})
        element.addEventListener('canplay', play, { once: true })
        play()
      }
      return element
    }

    function setMedia(layer, wallpaper, rendering) {
      const media = layer.querySelector('.dswp-media')
      const container = media || layer
      if (!wallpaper) {
        for (const child of [...container.querySelectorAll('.dswp-frame')]) child.remove()
        return
      }
      const reduced = prefersReducedMotion()
      const posterOnly = wallpaper.kind !== 'video' || reduced || (rendering?.media === 'static')
      if (posterOnly && !wallpaper.poster && wallpaper.kind === 'video') {
        // A video without a poster cannot render as a still frame; fall back to a paused video.
      }
      const frame = createFrame(wallpaper, posterOnly)
      container.appendChild(frame)
      requestAnimationFrame(() => {
        frame.dataset.dswpActive = '1'
      })
      const fade = Math.max(0, Number(rendering?.transitionMs ?? 600))
      window.setTimeout(() => {
        for (const child of [...container.querySelectorAll('.dswp-frame')]) {
          if (child !== frame) child.remove()
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
      let packs = null
      let loading = false
      let latest = null
      const get = api.getSnapshot

      const close = () => panel.setAttribute('hidden', '')
      const toggle = () => {
        if (!panel.hasAttribute('hidden')) {
          close()
          return
        }
        panel.removeAttribute('hidden')
        if (packs === null) loadPacks()
        render()
      }

      const loadPacks = async () => {
        if (loading || packs !== null) return
        loading = true
        try {
          const response = await fetch(`${API}/packs`, { credentials: 'same-origin', cache: 'no-store' })
          if (response.ok) packs = await response.json()
        } catch {
          // Retry next time the panel is opened.
        } finally {
          loading = false
          render()
        }
      }

      const chip = (label, active, onClick, disabled = false) => {
        const props = {
          className: 'dswp-chip', type: 'button', dataset: { active: active ? '1' : '0' },
          text: label, onClick,
        }
        if (disabled) props.disabled = ''
        return el('button', props)
      }

      const currentPack = () => {
        if (packs === null) return null
        return packs.packs.find((pack) => pack.id === packs.selected) ?? packs.packs[0] ?? null
      }

      const row = (label, chips) => el('div', { className: 'dswp-section' }, [
        el('div', { className: 'dswp-label', text: label }),
        el('div', { className: 'dswp-row' }, chips),
      ])

      const buildPreview = (index) => {
        const snapshot = get()
        const pack = currentPack()
        if (snapshot === null || pack === null) return null
        const direction = snapshot.rendering?.direction === 'rich' ? 'rich' : 'poor'
        const mapped = pack.direction === direction ? index : pack.tiers.length - 1 - index
        const tier = pack.tiers[mapped]
        if (!tier) return null
        const media = snapshot.rendering?.media ?? 'auto'
        const dynamic = tier.dynamic && media !== 'static' ? tier.dynamic : null
        const src = dynamic ? (dynamic.url || tier.staticUrl) : tier.staticUrl
        if (!src) return null
        return {
          kind: dynamic && dynamic.type === 'video' ? 'video' : 'image',
          src,
          poster: dynamic ? (dynamic.posterUrl || tier.staticUrl) : null,
          transitionMs: snapshot.rendering?.transitionMs ?? 600,
          packId: pack.id,
          tierIndex: mapped,
          tierId: tier.id,
        }
      }

      const render = () => {
        if (panel.hasAttribute('hidden')) return
        const snapshot = get()
        latest = snapshot
        panel.textContent = ''
        panel.appendChild(el('div', { className: 'dswp-head' }, [
          el('span', { className: 'dswp-title', text: '壁纸快捷切换' }),
          el('button', { className: 'dswp-close', type: 'button', text: '×', 'aria-label': '关闭', onClick: close }),
        ]))
        if (snapshot === null) {
          panel.appendChild(el('div', { className: 'dswp-meta', text: '正在读取状态…' }))
        } else {
          const tierText = snapshot.tier ? `${snapshot.tier.index} · ${snapshot.tier.label}` : '—'
          panel.appendChild(el('div', {
            className: 'dswp-meta',
            text: `${snapshot.pack?.name ?? '—'} · ${tierText} · ¥${snapshot.spend1h ?? '--'}/h`,
          }))
        }
        if (packs === null) {
          panel.appendChild(el('div', { className: 'dswp-meta', text: '读取素材包…' }))
        } else {
          panel.appendChild(row('素材包', packs.packs.map((pack) => chip(
            pack.name && pack.name !== pack.id ? pack.name : pack.id,
            snapshot?.pack?.id === pack.id,
            () => api.patchConfig({ pack: pack.id }),
          ))))
        }
        if (snapshot !== null) {
          panel.appendChild(row('显示', [
            chip('铺满', snapshot.rendering?.mode === 'full', () => api.patchConfig({ mode: 'full' })),
            chip('相框', snapshot.rendering?.mode === 'frame', () => api.patchConfig({ mode: 'frame' })),
          ]))
          panel.appendChild(row('动态', [
            chip('自动', snapshot.rendering?.media === 'auto', () => api.patchConfig({ media: 'auto' })),
            chip('静态', snapshot.rendering?.media === 'static', () => api.patchConfig({ media: 'static' })),
            chip('动态', snapshot.rendering?.media === 'dynamic', () => api.patchConfig({ media: 'dynamic' })),
          ]))
          panel.appendChild(row('方向', [
            chip('越花越惨', snapshot.rendering?.direction === 'poor', () => api.patchConfig({ direction: 'poor' })),
            chip('越花越好', snapshot.rendering?.direction === 'rich', () => api.patchConfig({ direction: 'rich' })),
          ]))
          const pack = currentPack()
          if (pack) {
            const direction = snapshot.rendering?.direction === 'rich' ? 'rich' : 'poor'
            const previewing = api.isPreviewing()
            panel.appendChild(row('预览档位', pack.tiers.map((tier, index) => chip(
              tier.label,
              previewing && api.previewIndex() === index,
              () => {
                const preview = buildPreview(index)
                if (preview) api.showPreview(preview, index)
              },
            ))))
            panel.appendChild(row('锁定', [
              chip(snapshot.lockedTier ? `已锁定 ${snapshot.tier.label}` : '锁定当前档', Boolean(snapshot.lockedTier), () => api.patchConfig({
                lockedTier: snapshot.lockedTier ? '' : String(snapshot.tier.index),
              })),
            ]))
            void direction
          }
        }
        const actions = []
        if (api.isPreviewing()) actions.push(el('button', { className: 'dswp-action primary', type: 'button', text: '回到实时', onClick: () => api.clearPreview() }))
        if (snapshot !== null) {
          actions.push(el('button', { className: 'dswp-action', type: 'button', text: '刷新数据', onClick: () => api.refresh() }))
          actions.push(el('button', { className: 'dswp-action', type: 'button', text: snapshot.enabled ? '关闭壁纸' : '开启壁纸', onClick: () => api.patchConfig({ enabled: !snapshot.enabled }) }))
          actions.push(el('button', { className: 'dswp-action', type: 'button', text: '恢复默认', onClick: () => api.patchConfig({ reset: true }) }))
        }
        if (actions.length > 0) panel.appendChild(el('div', { className: 'dswp-actions' }, actions))
        panel.appendChild(el('div', { className: 'dswp-status', text: '改动立即生效，并保存在插件状态里' }))
      }

      button.addEventListener('click', toggle)
      document.body.appendChild(button)
      document.body.appendChild(panel)

      return {
        update(snapshot) {
          latest = snapshot
          if (!panel.hasAttribute('hidden')) render()
        },
        dispose() {
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
          if (previewActive && Date.now() < previewUntil) return
          if (previewActive) {
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
        if (snapshot !== null) {
          applyRendering(snapshot)
          setMedia(layer, wallpaper, snapshot.rendering)
        }
        updateQuick()
      }

      const clearPreview = () => {
        previewActive = false
        previewWallpaper = null
        previewIndex = null
        if (snapshot !== null) apply(snapshot)
        updateQuick()
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
        if (timer !== null) window.clearInterval(timer)
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

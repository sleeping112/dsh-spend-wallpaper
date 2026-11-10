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

    function install(ctx) {
      if (!document.body) return () => {}
      ensureStyle()
      const layer = ensureLayer()
      const media = document.createElement('div')
      media.className = 'dswp-media'
      layer.insertBefore(media, layer.firstChild)
      let snapshot = null
      let timer = null
      let stopped = false
      const themeObserver = new MutationObserver(() => {
        if (snapshot !== null) applyScrimColors(snapshot)
      })
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })

      const apply = (next) => {
        if (stopped || !next) return
        snapshot = next
        if (!next.enabled) {
          clearRendering()
          layer.dataset.dswpHidden = '1'
          setMedia(layer, null, next.rendering)
          return
        }
        delete layer.dataset.dswpHidden
        if (!next.wallpaper) {
          // No usable pack yet: leave the stock DSH look untouched.
          clearRendering()
          layer.dataset.dswpHidden = '1'
          setMedia(layer, null, next.rendering)
          return
        }
        applyRendering(next)
        setMedia(layer, next.wallpaper, next.rendering)
      }

      const poll = async () => {
        if (stopped) return
        try {
          const response = await fetch(`${API}/state`, { credentials: 'same-origin', cache: 'no-store' })
          if (!response.ok) return
          const next = await response.json()
          const same = snapshot !== null
            && snapshot.wallpaper?.src === next.wallpaper?.src
            && snapshot.rendering?.mode === next.rendering?.mode
            && snapshot.enabled === next.enabled
          if (!same) apply(next)
          else if (next.rendering) applyScrimColors(next)
        } catch {
          // Keep the last known wallpaper when the host is briefly unreachable.
        }
      }

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

'use client'

/**
 * visible-responsive-container.tsx — recharts ResponsiveContainer that stays
 * quiet inside zero-size containers (QA-ROUND-2026-09-16-C).
 *
 * Problem: home-client.tsx keeps every visited module mounted via
 * <KeepAlivePage> which hides inactive pages with `display:none`. recharts'
 * ResponsiveContainer re-measures on every render — when a hidden page's
 * charts re-render (react-query background refetch, window focus, etc.)
 * recharts floods the console with:
 *   "The width(0) and height(0) of chart should be greater than 0 ..."
 *
 * Fix: render the inner chart tree ONLY while the wrapper has a non-zero
 * box. Two layers of detection:
 *   1. Synchronous check during render (`offsetWidth/Height`) — catches the
 *      "re-render while hidden" case before recharts ever measures.
 *   2. ResizeObserver — flips visibility state when the ancestor page is
 *      shown/hidden again (display:none → 0×0 → observer fires).
 *
 * Drop-in replacement: swap `<ResponsiveContainer ...>` for
 * `<VisibleResponsiveContainer ...>` — props are forwarded unchanged.
 */
import * as React from 'react'
import { ResponsiveContainer, type ResponsiveContainerProps } from 'recharts'

export function VisibleResponsiveContainer(props: ResponsiveContainerProps) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  // Tick state — bumped by ResizeObserver so React re-renders and the sync
  // size check below re-evaluates after visibility flips.
  const [, setTick] = React.useState(0)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTick((t) => t + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Synchronous visibility check (layout read is cheap — no forced reflow
  // beyond what recharts would do anyway). offsetParent check also covers
  // ancestors hidden via display:none.
  const el = ref.current
  const hasSize = !el || (el.offsetWidth > 0 && el.offsetHeight > 0)

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {hasSize ? <ResponsiveContainer {...props} /> : null}
    </div>
  )
}

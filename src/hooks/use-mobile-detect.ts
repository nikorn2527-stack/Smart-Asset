'use client'

/**
 * use-mobile-detect.ts — Detect mobile devices and manage mobile mode.
 *
 * Strategy:
 *   1. On mount: check viewport width + user agent
 *   2. If mobile (< 768px OR mobile UA): auto-switch to mobile mode
 *   3. If desktop: use desktop mode (sidebar layout)
 *   4. User can override: "โหมดมือถือ" button forces mobile mode
 *
 * Mobile detection signals:
 *   - viewport width < 768px (Tailwind `md` breakpoint)
 *   - User agent contains mobile keywords
 *   - Touch support (primary input = touch)
 *
 * Usage:
 *   import { useMobileDetect, useIsMobile } from '@/hooks/use-mobile-detect'
 *
 *   const isMobile = useIsMobile()  // boolean
 *   const { isMobile, isTablet, isDesktop, forceMode } = useMobileDetect()
 */

import * as React from 'react'

export interface MobileDetectResult {
  /** True if viewport < 768px or mobile UA */
  isMobile: boolean
  /** True if viewport >= 768px and < 1024px (tablet) */
  isTablet: boolean
  /** True if viewport >= 1024px (desktop) */
  isDesktop: boolean
  /** True if touch is the primary input */
  hasTouch: boolean
  /** Viewport width in pixels */
  viewportWidth: number
}

const MOBILE_BREAKPOINT = 768
const TABLET_BREAKPOINT = 1024

const MOBILE_UA_PATTERNS = [
  /Android/i,
  /webOS/i,
  /iPhone/i,
  /iPad/i,
  /iPod/i,
  /BlackBerry/i,
  /Windows Phone/i,
  /Mobile/i,
  /Silk/i,
  /Opera Mini/i,
  /IEMobile/i,
]

function detectMobileUA(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return MOBILE_UA_PATTERNS.some((p) => p.test(ua))
}

function detectTouch(): boolean {
  if (typeof window === 'undefined') return false
  // Check if touch is the primary input
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  // But touch alone isn't enough — some laptops have touch screens.
  // Combine with viewport check in the main hook.
  return hasTouch
}

/**
 * Hook that returns mobile/tablet/desktop detection.
 * Re-renders on viewport resize.
 */
export function useMobileDetect(): MobileDetectResult {
  const [result, setResult] = React.useState<MobileDetectResult>({
    isMobile: false,
    isTablet: false,
    isDesktop: true, // default to desktop (SSR safe)
    hasTouch: false,
    viewportWidth: 1024,
  })

  React.useEffect(() => {
    function update() {
      const width = window.innerWidth
      const isMobileUA = detectMobileUA()
      const hasTouch = detectTouch()

      // Mobile: narrow viewport OR mobile UA (but not iPad with desktop UA)
      const isMobile = width < MOBILE_BREAKPOINT || (isMobileUA && width < TABLET_BREAKPOINT)
      const isTablet = width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT && !isMobileUA
      const isDesktop = !isMobile && !isTablet

      setResult({
        isMobile,
        isTablet,
        isDesktop,
        hasTouch,
        viewportWidth: width,
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return result
}

/**
 * Simple boolean hook — true if mobile device.
 */
export function useIsMobile(): boolean {
  const { isMobile } = useMobileDetect()
  return isMobile
}

/**
 * Hook that auto-switches to mobile mode on mobile devices.
 * Returns true if the app should render MobileShell.
 *
 * Logic:
 *   - If user explicitly selected 'mobile' page → true (manual override)
 *   - If auto-detected as mobile → true (auto-switch)
 *   - Otherwise → false (desktop layout)
 */
export function useAutoMobileMode(activePage: string): boolean {
  const { isMobile } = useMobileDetect()

  // User explicitly selected mobile mode via sidebar button
  if (activePage === 'mobile') return true

  // Auto-switch: mobile device + not already on a specific mobile-friendly page
  // Only auto-switch on initial load (not when user navigates to a desktop page)
  // This is handled in the page component — this hook just reports the state.
  return isMobile
}

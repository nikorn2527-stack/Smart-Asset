'use client'

/**
 * use-keyboard-aware.ts — React hook สำหรับจัดการคีย์บอร์ดบนมือถือ
 *
 * ปัญหา: เมื่อคีย์บอร์ดขึ้นบนมือถือ มันบัง input field + ปุ่มบันทึก
 *
 * วิธีแก้:
 *   1. ใช้ visualViewport API เพื่อ detect ความสูงของคีย์บอร์ด
 *   2. Auto-scroll ไปยัง focused input เมื่อคีย์บอร์ดขึ้น
 *   3. ปรับ container height ให้เหลือพอดีกับพื้นที่เหนือคีย์บอร์ด
 *
 * Usage:
 *   const { keyboardHeight, isKeyboardVisible, scrollRef } = useKeyboardAware()
 *   <div ref={scrollRef} style={{ height: isKeyboardVisible ? `calc(100dvh - ${keyboardHeight}px)` : 'auto' }}>
 *     <input onFocus={...} />
 *     <button>บันทึก</button>
 *   </div>
 */

import * as React from 'react'

interface KeyboardAwareState {
  /** Height of the on-screen keyboard in pixels (0 if not visible) */
  keyboardHeight: number
  /** True when the keyboard is currently visible */
  isKeyboardVisible: boolean
  /** Ref to attach to the scrollable container */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** Scroll an element into view (used on input focus) */
  scrollIntoView: (el: HTMLElement | null) => void
}

export function useKeyboardAware(): KeyboardAwareState {
  const [keyboardHeight, setKeyboardHeight] = React.useState(0)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    // visualViewport API is the modern way to detect keyboard
    // https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
    const viewport = window.visualViewport
    if (!viewport) return

    let rafId: number | null = null

    const update = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        // layoutViewport = full viewport (including address bar)
        // visualViewport = visible area (excludes keyboard)
        // keyboard height = layoutViewport.height - visualViewport.height
        // (when keyboard is up, visualViewport shrinks)
        const layoutHeight = window.innerHeight
        const visualHeight = viewport.height
        const offsetTop = viewport.offsetTop
        const detected = Math.max(0, layoutHeight - visualHeight - offsetTop)
        setKeyboardHeight(detected > 50 ? detected : 0)
      })
    }

    // Initial check
    update()

    // Listen for viewport changes (keyboard show/hide)
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)

    // Also listen for focus/blur events on inputs (fallback)
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        // Delay to let keyboard animate up
        setTimeout(() => {
          update()
          scrollIntoView(target)
        }, 300)
      }
    }
    document.addEventListener('focusin', handleFocus)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      document.removeEventListener('focusin', handleFocus)
    }
  }, [])

  const scrollIntoView = React.useCallback((el: HTMLElement | null) => {
    if (!el || typeof window === 'undefined') return
    // Use visualViewport to get the actual visible area
    const viewport = window.visualViewport
    if (!viewport) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const rect = el.getBoundingClientRect()
    // If element is below the visible viewport (i.e. behind keyboard)
    const visibleBottom = viewport.height + viewport.offsetTop
    if (rect.bottom > visibleBottom - 20) {
      // Scroll so the element is just above the keyboard
      const scrollAmount = rect.bottom - (visibleBottom - 20)
      const container = scrollRef.current
      if (container) {
        container.scrollTop += scrollAmount + 20
      } else {
        window.scrollBy({ top: scrollAmount + 20, behavior: 'smooth' })
      }
    }
  }, [])

  return {
    keyboardHeight,
    isKeyboardVisible: keyboardHeight > 0,
    scrollRef,
    scrollIntoView,
  }
}

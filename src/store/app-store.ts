import { create } from 'zustand'

export type ActivePage =
  | 'dashboard'
  | 'devices'
  | 'meter'
  | 'paper-analytics'
  | 'work-orders'
  | 'stock'
  | 'import'
  | 'templates'
  | 'settings'
  | 'itam'
  | 'itam-devices'
  | 'itam-meter'
  | 'itam-meter-keyboard'
  | 'itam-repairs'
  | 'itam-work-orders'
  | 'itam-stock'
  | 'itam-sticker-editor'
  | 'itam-document-editor'
  | 'itam-paper-analytics'
  | 'itam-settings'
  | 'itam-audit'
  | 'itam-snapshot-viewer'
  | 'reports-hub'
  | 'devices-page'
  | 'monthly-report'
  | 'meter-page'
  | 'paper-analytics-page'
  | 'mobile'
  | 'pm-schedules'
  | 'material-cost'

export type SettingsTab = 'app' | 'master' | 'sites' | 'rates' | 'users' | 'audit'

interface AppState {
  activePage: ActivePage
  sidebarOpen: boolean
  /** A device id that the devices page should auto-open the detail sheet for on mount. */
  pendingDeviceId: string | null
  /** A settings tab to auto-activate on mount. */
  pendingSettingsTab: SettingsTab | null
  /** A device type filter to apply on devices page on mount. */
  pendingDeviceType: string | null
  /** A device status filter to apply on devices page on mount. */
  pendingDeviceStatus: string | null
  /** A warranty status filter to apply on devices page on mount. */
  pendingWarrantyFilter: 'expiring' | 'expired' | null
  /** A meter-page action to auto-run on mount (e.g. 'open-cycle' opens the cycle dialog). */
  pendingMeterAction: string | null
  /** Set true to open the global search palette from anywhere. */
  searchOpen: boolean
  /** Set true to open the global QR/barcode scanner dialog. */
  qrScannerOpen: boolean
  /**
   * The last scanned QR/barcode value plus a monotonically-increasing
   * `nonce` so consumers can react even when the same code is scanned twice
   * in a row. Use `qrScanNonce` in deps to detect new scans.
   */
  lastQrScan: string | null
  qrScanNonce: number
  /**
   * Page navigation history stack — supports back/forward navigation.
   * When user navigates to a new page, current page is pushed to history.
   * goBack() pops the last entry. This preserves form state via sessionStorage.
   */
  pageHistory: ActivePage[]
  pageForwardStack: ActivePage[]
  setActivePage: (page: ActivePage) => void
  /** Navigate back to previous page (pops history stack). Returns true if back was possible. */
  goBack: () => boolean
  /** Navigate forward (if user went back). Returns true if forward was possible. */
  goForward: () => boolean
  /** Check if back navigation is possible. */
  canGoBack: () => boolean
  /** Check if forward navigation is possible. */
  canGoForward: () => boolean
  toggleSidebar: () => void
  closeSidebar: () => void
  setPendingDeviceId: (id: string | null) => void
  clearPendingDeviceId: () => void
  setPendingDeviceType: (type: string | null) => void
  clearPendingDeviceType: () => void
  setPendingDeviceStatus: (status: string | null) => void
  clearPendingDeviceStatus: () => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  clearPendingSettingsTab: () => void
  setPendingWarrantyFilter: (f: 'expiring' | 'expired' | null) => void
  clearPendingWarrantyFilter: () => void
  setPendingMeterAction: (action: string | null) => void
  clearPendingMeterAction: () => void
  setSearchOpen: (open: boolean) => void
  setQrScannerOpen: (open: boolean) => void
  /** Publish a scanned value (also bumps the nonce). */
  publishQrScan: (value: string) => void
  /** Clear the last scanned value (does not affect nonce). */
  clearLastQrScan: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  activePage: 'dashboard',
  sidebarOpen: false,
  pendingDeviceId: null,
  pendingDeviceType: null,
  pendingDeviceStatus: null,
  pendingSettingsTab: null,
  pendingWarrantyFilter: null,
  pendingMeterAction: null,
  searchOpen: false,
  qrScannerOpen: false,
  lastQrScan: null,
  qrScanNonce: 0,
  pageHistory: [],
  pageForwardStack: [],
  setActivePage: (page) =>
    set((s) => ({
      // Push current page to history (unless same page or initial dashboard)
      pageHistory:
        s.activePage === page
          ? s.pageHistory
          : [...s.pageHistory, s.activePage].slice(-20), // cap at 20 entries
      pageForwardStack: [], // clear forward stack on new navigation
      activePage: page,
    })),
  goBack: () => {
    const { pageHistory, pageForwardStack, activePage } = get()
    if (pageHistory.length === 0) return false
    const previous = pageHistory[pageHistory.length - 1]
    set({
      activePage: previous,
      pageHistory: pageHistory.slice(0, -1),
      pageForwardStack: [...pageForwardStack, activePage].slice(-20),
    })
    return true
  },
  goForward: () => {
    const { pageForwardStack, pageHistory, activePage } = get()
    if (pageForwardStack.length === 0) return false
    const next = pageForwardStack[pageForwardStack.length - 1]
    set({
      activePage: next,
      pageForwardStack: pageForwardStack.slice(0, -1),
      pageHistory: [...pageHistory, activePage].slice(-20),
    })
    return true
  },
  canGoBack: () => get().pageHistory.length > 0,
  canGoForward: () => get().pageForwardStack.length > 0,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeSidebar: () => set({ sidebarOpen: false }),
  setPendingDeviceId: (id) => set({ pendingDeviceId: id }),
  clearPendingDeviceId: () => set({ pendingDeviceId: null }),
  setPendingDeviceType: (type) => set({ pendingDeviceType: type }),
  clearPendingDeviceType: () => set({ pendingDeviceType: null }),
  setPendingDeviceStatus: (status) => set({ pendingDeviceStatus: status }),
  clearPendingDeviceStatus: () => set({ pendingDeviceStatus: null }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  clearPendingSettingsTab: () => set({ pendingSettingsTab: null }),
  setPendingWarrantyFilter: (f) => set({ pendingWarrantyFilter: f }),
  clearPendingWarrantyFilter: () => set({ pendingWarrantyFilter: null }),
  setPendingMeterAction: (action) => set({ pendingMeterAction: action }),
  clearPendingMeterAction: () => set({ pendingMeterAction: null }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setQrScannerOpen: (open) => set({ qrScannerOpen: open }),
  publishQrScan: (value) =>
    set((s) => ({
      lastQrScan: value,
      qrScanNonce: s.qrScanNonce + 1,
      qrScannerOpen: false,
    })),
  clearLastQrScan: () => set({ lastQrScan: null }),
}))

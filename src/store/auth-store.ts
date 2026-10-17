// ============================================================
// Auth Store (Task ID: RBAC-DASHBOARD)
// ============================================================
// จัดการ state ของ user ปัจจุบัน + permissions ฝั่ง client
// - ดึงข้อมูลจาก /api/auth/me ตอน mount
// - ค้างค่าไว้ใน localStorage เพื่อให้ refresh ไม่หาย
// - ใน sandbox/preview mode หากไม่มี user จะใช้ default admin permissions
// ============================================================

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  DEFAULT_PREVIEW_PERMISSIONS,
  computeNavVisibility,
  hasPermission as rbacHasPermission,
  hasAnyPermission as rbacHasAnyPermission,
  canAccessSite as rbacCanAccessSite,
  type NavVisibility,
} from '@/lib/rbac'

export interface CurrentUser {
  id: string
  email: string
  username?: string | null
  name?: string | null
  role: string
  department?: string | null
  permissions: string[]
  allowedSites: string | null
  active: boolean
  avatarUrl?: string | null
  /** Demo user flag — drives the demo banner + demo-aware UI behaviour. */
  isDemo?: boolean
}

interface AuthState {
  user: CurrentUser | null
  token: string | null
  isAuthenticated: boolean
  /** โหลดจาก /api/auth/me แล้วหรือยัง */
  initialized: boolean
  /** กำลังโหลดอยู่หรือไม่ */
  loading: boolean
  /** Compat: true จนกว่าจะตรวจ auth เสร็จ (ใช้โดย page.tsx boot effect) */
  isBooting: boolean
  /** Compat: ตรวจ token กับ server แล้วอัปเดต state (ใช้โดย page.tsx) */
  checkAuth: () => Promise<boolean>
  /** ข้อความ error (ถ้ามี) */
  error: string | null
  setUser: (user: CurrentUser | null) => void
  setInitialized: (v: boolean) => void
  setLoading: (v: boolean) => void
  setError: (e: string | null) => void
  /** เข้าสู่ระบบผ่าน ITAM JWT endpoint */
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  /** โหลดข้อมูล user จาก server ครั้งแรก */
  fetchMe: () => Promise<void>
  /** Logout — เคลียร์ state */
  logout: () => void
  /** setUser จาก legacy API (compat สำหรับ page.tsx เดิม) */
  setSession: (token: string, user: CurrentUser) => void
  /** clear — alias สำหรับ logout (compat) */
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      initialized: false,
      loading: false,
      error: null,
      isBooting: true,
      setUser: (user) => set({ user, error: null }),
      setInitialized: (initialized) => set({ initialized }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      login: async (username, password) => {
        set({ loading: true, error: null })
        try {
          const res = await fetch('/api/itam/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          })
          const json = (await res.json().catch(() => ({}))) as {
            token?: string
            user?: CurrentUser
            error?: string
          }
          if (!res.ok || !json.token || !json.user) {
            const error = json.error ?? 'เข้าสู่ระบบไม่สำเร็จ'
            set({ loading: false, error })
            return { ok: false, error }
          }
          set({
            user: json.user,
            token: json.token,
            isAuthenticated: true,
            loading: false,
            initialized: true,
            isBooting: false,
            error: null,
          })
          return { ok: true }
        } catch {
          const error = 'ไม่สามารถเชื่อมต่อระบบเข้าสู่ระบบได้'
          set({ loading: false, error })
          return { ok: false, error }
        }
      },
      fetchMe: async () => {
        set({ loading: true, error: null })
        try {
          const token = get().token
          const res = await fetch(token ? '/api/itam/auth/me' : '/api/auth/me', {
            cache: 'no-store',
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          })
          if (!res.ok) {
            // ไม่ authenticated — ใช้ default preview user
            set({
              user: makePreviewUser(),
              token: null,
              isAuthenticated: false,
              loading: false,
              initialized: true,
              error: null,
            })
            return
          }
          const json = await res.json()
          const user = json?.user as CurrentUser | undefined
          if (user) {
            set({
              user: {
                ...user,
                permissions:
                  Array.isArray(user.permissions) && user.permissions.length > 0
                    ? user.permissions
                    : DEFAULT_PREVIEW_PERMISSIONS,
              },
              token: get().token,
              isAuthenticated: true,
              loading: false,
              initialized: true,
              error: null,
            })
          } else {
            set({
              user: makePreviewUser(),
              token: null,
              isAuthenticated: false,
              loading: false,
              initialized: true,
              error: null,
            })
          }
        } catch {
          set({
              user: makePreviewUser(),
              token: null,
              isAuthenticated: false,
              loading: false,
              initialized: true,
              error: null,
            })
        }
      },
      logout: () => {
        const token = get().token
        void fetch(token ? '/api/itam/auth/logout' : '/api/auth/logout', {
          method: 'POST',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        }).catch(() => undefined)
        set({ user: null, token: null, isAuthenticated: false, initialized: true, isBooting: false })
      },
      // Compat: checkAuth — verify token with server, update state, set isBooting false
      checkAuth: async () => {
        try {
          const token = get().token
          if (!token) {
            set({ isBooting: false, initialized: true })
            return false
          }
          const res = await fetch('/api/itam/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          })
          if (!res.ok) {
            set({ user: null, token: null, isAuthenticated: false, isBooting: false, initialized: true })
            return false
          }
          const data = await res.json()
          if (data.user) {
            set({ user: data.user, isAuthenticated: true, isBooting: false, initialized: true })
            return true
          }
          set({ isBooting: false, initialized: true })
          return false
        } catch {
          set({ isBooting: false, initialized: true })
          return false
        }
      },
      // Compat: setSession — set token + user directly
      setSession: (token: string, user: CurrentUser) => {
        set({ token, user, isAuthenticated: true, isBooting: false, initialized: true, error: null })
      },
      // Compat: clear — alias for logout
      clear: () => {
        set({ user: null, token: null, isAuthenticated: false, initialized: true, isBooting: false })
      },
    }),
    {
      name: 'itam-auth',
      storage: createJSONStorage(() => {
        // SSR-safe: localStorage only available in browser
        if (typeof window === 'undefined') {
          // Return a no-op storage for server-side rendering
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          }
        }
        return localStorage
      }),
      partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }),
      onRehydrateStorage: () => (state) => {
        // CRITICAL: After rehydration from localStorage, always set isBooting=false
        // if there's no token (so the app doesn't get stuck on the boot screen).
        // If there IS a token, checkAuth() in the mount effect will handle it.
        if (state) {
          if (!state.token) {
            // No token: skip boot, go straight to login
            state.isBooting = false
            state.initialized = true
          }
          // If token exists: keep isBooting=true, let checkAuth() verify it
        }
      },
      // Don't skip hydration — we need it to persist the token across refreshes
      skipHydration: false,
    },
  ),
)

function makePreviewUser(): CurrentUser {
  return {
    id: 'preview',
    email: 'admin@example.com',
    username: 'admin',
    name: 'ผู้ดูแลระบบ (พรีวิว)',
    role: 'admin',
    department: null,
    permissions: DEFAULT_PREVIEW_PERMISSIONS,
    allowedSites: 'ALL',
    active: true,
    isDemo: false,
  }
}

// ---- Selectors / helpers ----

/** คืนค่า permissions ของ user ปัจจุบัน (หรือ default preview ถ้ายังไม่ login) */
export function usePermissions(): string[] {
  return useAuthStore((s) => s.user?.permissions ?? DEFAULT_PREVIEW_PERMISSIONS)
}

/** คืนค่า role ของ user ปัจจุบัน (default 'admin' สำหรับ preview) */
export function useRole(): string {
  return useAuthStore((s) => s.user?.role ?? 'admin')
}

/** คืนค่า allowedSites ของ user ปัจจุบัน */
export function useAllowedSites(): string | null {
  return useAuthStore((s) => s.user?.allowedSites ?? 'ALL')
}

/** เช็ก permission เดี่ยว */
export function useHasPermission(permission: string): boolean {
  const perms = usePermissions()
  return rbacHasPermission(perms, permission)
}

/** เช็ก permission หลายตัว (OR) */
export function useHasAnyPermission(permissions: string[]): boolean {
  const perms = usePermissions()
  return rbacHasAnyPermission(perms, permissions)
}

/** เช็กว่าเข้าถึง site ได้หรือไม่ */
export function useCanAccessSite(site: string): boolean {
  const allowed = useAllowedSites()
  return rbacCanAccessSite(allowed, site)
}

/** คำนวณ visibility ของ nav items ตาม permissions */
export function useNavVisibility(): NavVisibility {
  const perms = usePermissions()
  return computeNavVisibility(perms)
}

// ============================================================
// Compatibility helpers — used by src/app/page.tsx
// The feat-branch auth-store uses `persist` + `initialized` + `fetchMe`,
// but page.tsx (from main branch) expects `isBooting` + `checkAuth` +
// `hydrateAuthFromStorage`. These wrappers bridge the gap.
// ============================================================

/** Read token + user from localStorage (persist middleware already does this,
 *  but we expose this for explicit hydration on mount).
 *
 *  CRITICAL FIX: Must always set isBooting = false when no token is found,
 *  otherwise the app stays stuck on "กำลังตรวจสอบเซสชัน..." forever.
 */
export function hydrateAuthFromStorage(): void {
  if (typeof window === 'undefined') return
  const state = useAuthStore.getState()
  if (state.token) {
    // Token exists — will be verified by checkAuth() in the mount effect
    useAuthStore.setState({ initialized: false })
  } else {
    // No token — skip network call, set isBooting false immediately
    useAuthStore.setState({ initialized: true, isBooting: false })
  }
}

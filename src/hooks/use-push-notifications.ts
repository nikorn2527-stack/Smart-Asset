/**
 * use-push-notifications.ts — Client-side hook for browser push.
 *
 * SPRINT-5: Manages push notification subscription lifecycle.
 *
 * Usage:
 *   const { isSupported, isSubscribed, subscribe, unsubscribe } = usePushNotifications()
 *
 *   if (isSupported && !isSubscribed) {
 *     <Button onClick={subscribe}>เปิดการแจ้งเตือน</Button>
 *   }
 */

'use client'

import * as React from 'react'
import { useAuthStore } from '@/store/auth-store'

interface PushState {
  isSupported: boolean
  isSubscribed: boolean
  isLoading: boolean
  error: string | null
}

export function usePushNotifications() {
  const [state, setState] = React.useState<PushState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: false,
    error: null,
  })

  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  // Check if push is supported + already subscribed
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState((s) => ({ ...s, isSupported: false }))
      return
    }

    setState((s) => ({ ...s, isSupported: true }))

    // Check existing subscription
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setState((s) => ({
          ...s,
          isSubscribed: subscription !== null,
        }))
      })
      .catch(() => {
        // SW not ready yet — not an error
      })
  }, [])

  // Subscribe to push notifications
  const subscribe = React.useCallback(async () => {
    if (!user) {
      setState((s) => ({ ...s, error: 'กรุณาเข้าสู่ระบบก่อน' }))
      return
    }

    setState((s) => ({ ...s, isLoading: true, error: null }))

    try {
      // 1. Get public key from server
      const vapidRes = await fetch('/api/push/vapid-key')
      if (!vapidRes.ok) throw new Error('ไม่สามารถดึง VAPID key ได้')
      const { publicKey } = await vapidRes.json()

      // 2. Convert VAPID key to Uint8Array for subscribe()
      const applicationServerKey = urlBase64ToUint8Array(publicKey)

      // 3. Register SW + subscribe
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })

      // 4. Send subscription to server
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ subscription }),
      })

      if (!subRes.ok) throw new Error('ไม่สามารถบันทึก subscription ได้')

      setState((s) => ({
        ...s,
        isSubscribed: true,
        isLoading: false,
      }))
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด',
      }))
    }
  }, [user, token])

  // Unsubscribe from push notifications
  const unsubscribe = React.useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }))

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        await subscription.unsubscribe()

        // Notify server
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
      }

      setState((s) => ({
        ...s,
        isSubscribed: false,
        isLoading: false,
      }))
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด',
      }))
    }
  }, [token])

  return {
    ...state,
    subscribe,
    unsubscribe,
  }
}

// Helper: convert base64 URL → Uint8Array (for VAPID key)
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

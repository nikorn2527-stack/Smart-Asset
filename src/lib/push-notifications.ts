/**
 * push-notifications.ts — Web Push notification helper.
 *
 * Generates VAPID keys, manages subscriptions, and sends push
 * notifications to browsers even when the app tab is closed.
 *
 * Usage:
 *   import { getVapidKeys, sendPushNotification, subscribeUser } from '@/lib/push-notifications'
 *
 *   const keys = getVapidKeys()  // { publicKey, privateKey }
 *   await sendPushNotification(subscription, { title, body, url })
 */

import type { NextRequest } from 'next/server'
import webpush from 'web-push'

// ── VAPID keys ─────────────────────────────────────────────
// Generate once, store in env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// Generate with: bunx web-push generate-vapid-keys

export interface VapidKeys {
  publicKey: string
  privateKey: string
}

let vapidConfigured = false

function ensureVapidConfigured(): void {
  if (vapidConfigured) return

  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY

  if (!publicKey || !privateKey) {
    // In dev, auto-generate ephemeral keys (not persisted — will change
    // on restart, so subscriptions won't survive). In production, MUST
    // set env vars.
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[push-notifications] VAPID keys not set — using dev-only ephemeral keys')
      const devKeys = webpush.generateVAPIDKeys()
      webpush.setVapidDetails(
        'mailto:dev@itam.local',
        devKeys.publicKey,
        devKeys.privateKey,
      )
      vapidConfigured = true
      return
    }
    throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in production')
  }

  webpush.setVapidDetails(
    'mailto:noreply@itam.local',
    publicKey,
    privateKey,
  )
  vapidConfigured = true
}

/** Get the public key to send to the browser for subscription. */
export function getPublicKey(): string {
  ensureVapidConfigured()
  // In dev with ephemeral keys, we need to extract from the configured state
  // web-push doesn't expose it directly, so we re-read env or use the dev key
  const publicKey = process.env.VAPID_PUBLIC_KEY
  if (publicKey) return publicKey

  // Dev mode — generate and return (note: changes on restart)
  const devKeys = webpush.generateVAPIDKeys()
  // Reconfigure with the new keys
  webpush.setVapidDetails('mailto:dev@itam.local', devKeys.publicKey, devKeys.privateKey)
  return devKeys.publicKey
}

/** Generate new VAPID keys (run once, store in env vars). */
export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys()
}

// ── Push subscription storage ─────────────────────────────
// Stored in AppSetting as JSON array. Each entry:
//   { userId, endpoint, keys: { p256dh, auth }, createdAt }

interface PushSubscription {
  userId: string
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
  createdAt: string
}

async function loadSubscriptions(): Promise<PushSubscription[]> {
  // Lazy import to avoid circular dependency
  const { db } = await import('@/lib/db')
  const row = await db.appSetting.findUnique({ where: { key: 'pushSubscriptions' } })
  if (!row?.value) return []
  try {
    return JSON.parse(row.value) as PushSubscription[]
  } catch {
    return []
  }
}

async function saveSubscriptions(subs: PushSubscription[]): Promise<void> {
  const { db } = await import('@/lib/db')
  const json = JSON.stringify(subs)
  await db.appSetting.upsert({
    where: { key: 'pushSubscriptions' },
    update: { value: json },
    create: { key: 'pushSubscriptions', value: json },
  })
}

/** Subscribe a user to push notifications. Called from the browser. */
export async function subscribeUser(
  userId: string,
  subscription: webpush.PushSubscription,
): Promise<void> {
  const subs = await loadSubscriptions()

  // Remove existing subscription for this user (replace)
  const filtered = subs.filter(s => s.userId !== userId || s.endpoint !== subscription.endpoint)

  filtered.push({
    userId,
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    createdAt: new Date().toISOString(),
  })

  await saveSubscriptions(filtered)
}

/** Unsubscribe a user from push notifications. */
export async function unsubscribeUser(endpoint: string): Promise<void> {
  const subs = await loadSubscriptions()
  const filtered = subs.filter(s => s.endpoint !== endpoint)
  await saveSubscriptions(filtered)
}

// ── Send push notification ────────────────────────────────

interface PushPayload {
  title: string
  body: string
  url?: string  // URL to open when clicked
  tag?: string  // grouping tag (replaces previous with same tag)
  icon?: string // icon URL
}

/** Send a push notification to a specific user's browser(s). */
export async function sendPushNotification(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  ensureVapidConfigured()

  const subs = await loadSubscriptions()
  const userSubs = subs.filter(s => s.userId === userId)

  if (userSubs.length === 0) {
    return { sent: 0, failed: 0 }
  }

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? 'itam-notification',
    icon: payload.icon ?? '/icon-192.png',
  })

  let sent = 0
  let failed = 0

  // Send to all subscriptions for this user (may have multiple browsers)
  for (const sub of userSubs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        pushPayload,
      )
      sent++
    } catch (err) {
      console.error('[push-notifications] send failed:', err)
      // If subscription is expired (410 Gone), remove it
      if (err instanceof Error && err.message.includes('410')) {
        await unsubscribeUser(sub.endpoint)
      }
      failed++
    }
  }

  return { sent, failed }
}

/** Send a push notification to ALL subscribed users (broadcast). */
export async function broadcastPushNotification(
  payload: PushPayload,
): Promise<{ sent: number; failed: number; totalUsers: number }> {
  ensureVapidConfigured()

  const subs = await loadSubscriptions()
  if (subs.length === 0) {
    return { sent: 0, failed: 0, totalUsers: 0 }
  }

  // Group by userId to count unique users
  const userIds = new Set(subs.map(s => s.userId))

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag ?? 'itam-broadcast',
    icon: payload.icon ?? '/icon-192.png',
  })

  let sent = 0
  let failed = 0

  // Send in parallel (web-push is async)
  const promises = subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        pushPayload,
      )
      sent++
    } catch (err) {
      console.error('[push-notifications] broadcast send failed:', err)
      if (err instanceof Error && err.message.includes('410')) {
        await unsubscribeUser(sub.endpoint)
      }
      failed++
    }
  })

  await Promise.all(promises)

  return { sent, failed, totalUsers: userIds.size }
}

/**
 * realtime.ts — in-process pub/sub for Server-Sent Events (SSE).
 *
 * Why this exists:
 *   • GAS uses client-side polling (60s intervals) — high latency + wasteful.
 *   • Next.js can keep a long-lived SSE connection open and push events to all
 *     connected clients the instant data changes. This module is the bridge:
 *     mutation endpoints call `publishRealtimeEvent()`; the `/api/itam/events`
 *     SSE route subscribes to a per-token channel and forwards events to the
 *     client over the wire.
 *
 * Cross-process note: this is in-memory, so it works when the whole app runs
 * in a single Node process (true for our standalone Next.js server). For
 * multi-instance deployments you'd swap the in-memory Map for Redis pub/sub.
 *
 * Server-only — do not import from client components.
 */

import type { ItamJWTPayload } from './auth'

export type RealtimeEventType =
  | 'device-added'
  | 'device-updated'
  | 'device-deleted'
  | 'device-transferred'
  | 'meter-written'
  | 'dashboard-changed'
  | 'notification-sent'

export interface RealtimeEvent {
  type: RealtimeEventType
  /** Asset code or other entity id touched by the event (optional). */
  assetCode?: string
  /** Back-compat alias — some subscribers still read the legacy `assetNo`
   *  key. Kept so an in-flight event isn't lost during a rolling deploy. */
  assetNo?: string
  /** Site that the change happened on (so subscribers with restricted site
   *  access don't see cross-site events). */
  site?: string | null
  /** Free-form payload (e.g. new status, meter count delta). */
  payload?: Record<string, unknown>
  /** Server timestamp — seconds since epoch (SSE `id:` line uses this). */
  ts: number
}

type Subscriber = (event: RealtimeEvent) => void

interface SubscriberEntry {
  subscriber: Subscriber
  /** Filter: only deliver events whose site matches this subscriber's
   *  allowed-sites list (or ALL = receive everything). */
  allowedSites: string | 'ALL'
  /** Email of the subscribed user (for debugging only). */
  email: string
}

// Map keyed by a logical channel id (we use one global channel for simplicity,
// but the structure allows per-channel fan-out if needed later).
const subscribers = new Map<string, Set<SubscriberEntry>>()
const CHANNEL = 'default'

let _lastEventId = 0

/**
 * Subscribe to realtime events. Returns an unsubscribe function — the SSE route
 * must call it when the client closes the connection to avoid leaks.
 */
export function subscribe(
  user: ItamJWTPayload,
  onEvent: Subscriber,
): () => void {
  const email = user.email || 'anonymous'
  const entry: SubscriberEntry = {
    subscriber: onEvent,
    allowedSites: user.allowedSites || 'ALL',
    email,
  }
  let set = subscribers.get(CHANNEL)
  if (!set) {
    set = new Set()
    subscribers.set(CHANNEL, set)
  }
  set.add(entry)
  return () => {
    const s = subscribers.get(CHANNEL)
    if (!s) return
    s.delete(entry)
    if (s.size === 0) subscribers.delete(CHANNEL)
  }
}

/**
 * Publish a realtime event to all connected subscribers. Filters by site when
 * the subscriber has a restricted allowed-sites list. Safe to call from any
 * API route — non-throwing, returns immediately even with 0 subscribers.
 */
export function publishRealtimeEvent(event: Omit<RealtimeEvent, 'ts'>): void {
  const full: RealtimeEvent = { ...event, ts: Date.now() }
  const s = subscribers.get(CHANNEL)
  if (!s || s.size === 0) return
  _lastEventId += 1
  for (const entry of s) {
    // Site filter — superadmins see everything; site-restricted users only
    // see events for their sites (or events with no site attached).
    if (entry.allowedSites !== 'ALL') {
      if (full.site && !entry.allowedSites.split(',').includes(full.site)) {
        continue
      }
    }
    try {
      entry.subscriber(full)
    } catch {
      // Subscriber threw — remove it so one bad client doesn't break others.
      s.delete(entry)
    }
  }
}

/** Test helper — count of currently connected subscribers (for debugging). */
export function subscriberCount(): number {
  let n = 0
  for (const set of subscribers.values()) n += set.size
  return n
}

/** Returns the last event id assigned (used as the SSE Last-Event-ID header). */
export function lastEventId(): number {
  return _lastEventId
}

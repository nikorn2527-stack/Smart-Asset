/**
 * Simple offline queue for mobile form submissions.
 * Stores failed requests in localStorage and retries when online.
 *
 * Usage (mobile forms):
 *   try { await fetch(...) }
 *   catch (e) {
 *     if (!navigator.onLine) {
 *       addToQueue({ url: '/api/...', method: 'POST', body: payload, label: 'แจ้งซ่อม ...' })
 *       toast.success('บันทึกไว้ในคิว จะส่งอัตโนมัติเมื่อออนไลน์')
 *       return
 *     }
 *     // existing error handling
 *   }
 *
 * Auth: the helper reads the Bearer token from the same localStorage key the
 * auth-store uses (`itam-auth`) so queued retries are still authenticated.
 */

interface QueuedRequest {
  id: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  body: unknown
  timestamp: number
  retries: number
  label: string // human-readable description for UI
  /** Client-generated UUID to prevent duplicate processing on retry.
   * Server-side endpoints should check this header and return 200
   * (idempotent success) if the same key was already processed. */
  idempotencyKey: string
}

const QUEUE_KEY = 'itam.offline-queue'
const MAX_RETRIES = 3
/** In-memory lock to prevent concurrent processQueue() runs.
 * Without this, the 'online' event listener + the addToQueue() setTimeout
 * could both fire processQueue() at the same time, reading the same
 * queue from localStorage and sending duplicate requests. */
let isProcessing = false

export function getQueue(): QueuedRequest[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addToQueue(req: Omit<QueuedRequest, 'id' | 'timestamp' | 'retries' | 'idempotencyKey'>): void {
  try {
    const queue = getQueue()
    // Generate idempotency key — server can use this to deduplicate
    // (e.g. stock-items/[id]/transaction checks if key already processed)
    // P1 Security: Use crypto.randomUUID() instead of Math.random()
    // (Math.random() is not cryptographically secure — predictable keys
    // could allow duplicate request injection)
    const idemUuid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
    const idempotencyKey = `idem_${idemUuid}`
    const qUuid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    queue.push({
      ...req,
      id: `q_${qUuid}`,
      idempotencyKey,
      timestamp: Date.now(),
      retries: 0,
    })
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
    // Trigger retry when back online (non-blocking, guarded by isProcessing)
    if (navigator.onLine) setTimeout(() => { void processQueue() }, 1000)
  } catch {
    // localStorage may be full (large photo payloads) — silently drop
    // to avoid crashing the form. Caller can fall back to its own error UI.
  }
}

export async function processQueue(): Promise<{ processed: number; failed: number }> {
  // Guard against concurrent runs (addToQueue setTimeout + 'online' event)
  if (isProcessing) return { processed: 0, failed: 0 }
  isProcessing = true

  try {
    const queue = getQueue()
    if (queue.length === 0) return { processed: 0, failed: 0 }

    // Get auth token
    let token: string | null = null
    try {
      const raw = localStorage.getItem('itam-auth')
      if (raw) token = JSON.parse(raw)?.state?.token ?? null
    } catch {
      // ignore — proceed without auth (server will 401 and the request stays queued)
    }

    let processed = 0
    let failed = 0
    const remaining: QueuedRequest[] = []

    for (const req of queue) {
      try {
        const res = await fetch(req.url, {
          method: req.method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            // Idempotency key — server-side endpoints that support
            // deduplication should check this header. If the same key
          // was already processed, return 200 (idempotent success).
            'X-Idempotency-Key': req.idempotencyKey,
          },
          body: JSON.stringify(req.body),
        })
        if (res.ok) {
          processed++
        } else {
          req.retries++
          if (req.retries < MAX_RETRIES) remaining.push(req)
          else failed++
        }
      } catch {
        req.retries++
        if (req.retries < MAX_RETRIES) remaining.push(req)
        else failed++
      }
    }

    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
    return { processed, failed }
  } finally {
    isProcessing = false
  }
}

export function clearQueue(): void {
  localStorage.removeItem(QUEUE_KEY)
}

// Auto-process when back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    setTimeout(() => { void processQueue() }, 2000)
  })
}

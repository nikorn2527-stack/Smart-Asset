/**
 * webauthn-challenge-store.ts — In-memory challenge storage for WebAuthn.
 * TTL 5 min, auto-cleanup.
 */
interface ChallengeEntry { challenge: string; expiresAt: number }
const store = new Map<string, ChallengeEntry>()
const TTL_MS = 5 * 60 * 1000

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of store.entries()) if (v.expiresAt < now) store.delete(k)
  }, 5 * 60 * 1000).unref?.()
}

export function setChallenge(key: string, challenge: string) {
  store.set(key, { challenge, expiresAt: Date.now() + TTL_MS })
}
export function getChallenge(key: string): string | null {
  const e = store.get(key)
  if (!e) return null
  if (e.expiresAt < Date.now()) { store.delete(key); return null }
  return e.challenge
}
export function deleteChallenge(key: string) { store.delete(key) }

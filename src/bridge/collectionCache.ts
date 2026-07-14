// Last-known-good collection cache — webview-only (no native dependency).
//
// Native owns the truth: it reads the owned set from the chain and pushes it
// over the bridge. When it can't (offline, RPC timeout, silent host), the
// webview used to fall back to the empty state after the boot timeout —
// telling a collector with a full Pocket "No collectibles yet". Instead we
// persist the most recent delivered snapshot to localStorage and seed the
// collection store from it at boot, so the gallery renders the last-known
// collection immediately; any live delivery replaces it wholesale.
//
// Same resilient pattern as firstRun.ts: wrapped in try/catch because some
// WebView configurations block storage — in that case there's simply no
// offline fallback, matching the pre-cache behavior.

import type { OwnedNft } from './types'

const KEY = 'pkt_collection_cache_v1'

// Never persist under the dev panel / URL mocks — a mock collection written
// to the real cache would resurface as the user's "last known" set on the
// next real boot.
const isMockSession =
  typeof window !== 'undefined' && /[?&](dev|mock)=/.test(window.location.search)

interface CachePayload {
  owned: unknown[]
  displayName?: string
  /** Unix-milliseconds write time — not used for expiry (the owned set only
   *  ever grows, so stale is still correct), kept for debugging. */
  savedAt?: number
}

/** The cached last-delivered collection, or null if absent/unreadable.
 *  Items are returned raw — the collection store re-coerces each one on
 *  seed, so a tampered or legacy payload degrades to fewer (or zero) items,
 *  never a crash. */
export function loadCachedCollection(): CachePayload | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Record<string, unknown>
    if (!Array.isArray(obj.owned)) return null
    return {
      owned: obj.owned,
      ...(typeof obj.displayName === 'string' ? { displayName: obj.displayName } : {})
    }
  } catch {
    return null
  }
}

/** Persist the current collection as the boot fallback for the next session. */
export function saveCachedCollection(owned: OwnedNft[], displayName?: string): void {
  if (isMockSession) return
  try {
    const payload: CachePayload = { owned, savedAt: Date.now() }
    if (displayName) payload.displayName = displayName
    window.localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* storage unavailable — no offline fallback this session; harmless */
  }
}

// Local-only "redeemed sticker" state.
//
// A sticker the holder has redeemed at the swag stand. There's no native or
// on-chain signal for this, so it's webview-local: a Set of redeemed
// collectible hashes persisted to localStorage (the same resilient pattern as
// firstRun.ts — wrapped in try/catch because some WebViews block storage, in
// which case redemption simply doesn't persist across sessions). Keyed by the
// collectible's normalized hash (lowercase, no 0x).

import { useSyncExternalStore } from 'react'

const KEY = 'pkt_redeemed_stickers_v1'

function normalize(hash: string): string {
  return (hash.startsWith('0x') || hash.startsWith('0X') ? hash.slice(2) : hash).toLowerCase()
}

function load(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.map((h) => normalize(String(h))) : [])
  } catch {
    return new Set()
  }
}

const redeemed = load()
const listeners = new Set<() => void>()

function serialize(): string {
  return [...redeemed].sort().join(',')
}

// Cached snapshot so useSyncExternalStore sees a value-stable result between
// changes (recomputed only when a redemption actually happens).
let snapshot = serialize()

function persist(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...redeemed]))
  } catch {
    /* storage unavailable — redemption won't persist; harmless */
  }
}

/** True iff this collectible's hash has been redeemed. */
export function isRedeemed(hash: string): boolean {
  return redeemed.has(normalize(hash))
}

/** Mark a collectible redeemed (idempotent). Persists + notifies subscribers. */
export function redeem(hash: string): void {
  const h = normalize(hash)
  if (redeemed.has(h)) return
  redeemed.add(h)
  persist()
  snapshot = serialize()
  for (const cb of listeners) {
    try { cb() } catch { /* a listener throwing can't break the store */ }
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function getSnapshot(): string {
  return snapshot
}

/** Subscribe a component to redemption changes. Returns an opaque version
 *  token (changes whenever any redemption changes); read isRedeemed(hash) in
 *  render to get the live state. */
export function useRedeemedVersion(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// View-model helpers: turn raw OwnedNft data into the shape the gallery
// renders, plus hash/date formatting and sorting.

import type { OwnedNft } from '../bridge/types'
import { resolveCollectible, CATALOGUE_HAS_STICKERS, type ResolvedCollectible } from './resolver'

/** A fully-resolved collectible ready for the UI. Each owned hash is unique,
 *  but distinct hashes often resolve to the SAME art — the gallery collapses
 *  those into one representative tile carrying a `count` (see
 *  collapseDuplicates), shown as a small "×N" badge. */
export interface CollectibleEntry {
  /** Normalized hash (lowercase, no 0x) — the React key + dedup id. */
  hash: string
  /** 0x-prefixed hash for display / copy. */
  hashHex: string
  /** Short friendly code for the tile, e.g. "7F3A·9C2B". */
  shortCode: string
  /** Unix-seconds mint time, if known. */
  mintedAt?: number
  /** True for staged candidates not yet finalised on-chain. */
  pending: boolean
  /** Resolved art + rarity + name. */
  resolved: ResolvedCollectible
  /** Number of owned items that resolve to this same asset (≥1). Set by
   *  collapseDuplicates; a value > 1 renders a "×N" badge on the tile. */
  count?: number
}

function strip0x(hash: string): string {
  return hash.startsWith('0x') || hash.startsWith('0X') ? hash.slice(2) : hash
}

/** Truncated hash for inline display: "a3f1c0…9c2b". */
export function shortHash(hash: string): string {
  const h = strip0x(hash)
  if (h.length <= 12) return h
  return `${h.slice(0, 6)}…${h.slice(-4)}`
}

/** Compact, distinctive code for a tile badge: two 4-char groups from the
 *  head + tail of the hash, uppercased. Stable per hash, reads like a
 *  serial number ("7F3A·9C2B"). */
export function shortCode(hash: string): string {
  const h = strip0x(hash).toUpperCase()
  if (h.length < 8) return h
  return `${h.slice(0, 4)}·${h.slice(-4)}`
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric'
})

/** Absolute mint date, e.g. "27 May 2026". Falls back to "Pending" for a
 *  missing or out-of-range value rather than rendering "Invalid Date". */
export function formatMintDate(mintedAt: number | undefined): string {
  if (!mintedAt) return 'Pending'
  const d = new Date(mintedAt * 1000)
  return Number.isNaN(d.getTime()) ? 'Pending' : DATE_FMT.format(d)
}

/** Relative mint time, e.g. "2d ago", "just now". `now` is injectable
 *  for testing. */
export function formatRelative(mintedAt: number | undefined, now: number = Date.now()): string {
  if (!mintedAt) return 'pending'
  const diffMs = now - mintedAt * 1000
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(day / 365)}y ago`
}

/** Resolve one OwnedNft into a CollectibleEntry. */
export function buildEntry(nft: OwnedNft): CollectibleEntry {
  const hash = strip0x(nft.hash).toLowerCase()
  const hashHex = `0x${hash}`
  const entry: CollectibleEntry = {
    hash,
    hashHex,
    shortCode: shortCode(hash),
    pending: nft.pending === true,
    resolved: resolveCollectible(nft.hash)
  }
  if (typeof nft.mintedAt === 'number') entry.mintedAt = nft.mintedAt
  return entry
}

/** Build all gallery entries from the owned set, applying the per-game sticker
 *  guarantee.
 *
 *  We can't change how attestation hashes are minted, so we can't force a
 *  sticker on-chain. Instead we deliver the guarantee at presentation time:
 *  group the owned NFTs into mint batches (one game writes its NFTs with a
 *  single `mintedAt`, per the bridge contract), and within any batch that has
 *  NO organic sticker, promote the lexicographically-smallest-hash item to a
 *  sticker. Items without a timestamp (pending candidates) form one batch.
 *
 *  The choice is a pure function of the batch's hashes, so the game-results
 *  reveal makes the identical promotion over the same batch — the same hash
 *  shows as the same sticker in both places. A small number of batches end up
 *  with a *bonus* sticker (when an organic sticker also rolls), which is fine.
 *
 *  Note: this also retroactively guarantees a sticker for past games already
 *  in the collection — the smallest-hash item of each older batch becomes a
 *  sticker too, so "one sticker per game" holds across the whole Pocket. */
/** Max gap, in seconds, between two NFTs' mint times for them to count as the
 *  same game. A game's NFTs are minted together (one block/extrinsic), so they
 *  share a near-identical timestamp; distinct games are minutes+ apart. We
 *  cluster within this window rather than requiring EXACTLY equal timestamps —
 *  otherwise any per-NFT timestamp drift would split a game into singletons and
 *  promote every item to a sticker. Comfortably larger than any intra-game mint
 *  spread, and far smaller than the gap between two separately-played games. */
const GAME_GAP_S = 90

export function buildEntries(nfts: OwnedNft[]): CollectibleEntry[] {
  const built = nfts.map(buildEntry)
  if (!CATALOGUE_HAS_STICKERS || built.length === 0) return built

  // Partition indices into game batches. Confirmed items cluster by mint time
  // (gap ≤ GAME_GAP_S → same game); pending / timestamp-less items form one
  // batch on their own.
  const batches: number[][] = []
  const confirmed = built
    .map((e, i) => ({ i, t: e.mintedAt }))
    .filter((x): x is { i: number; t: number } => typeof x.t === 'number')
    .sort((a, b) => a.t - b.t)
  let cur: number[] = []
  let prevT: number | null = null
  for (const { i, t } of confirmed) {
    if (prevT !== null && t - prevT > GAME_GAP_S) { batches.push(cur); cur = [] }
    cur.push(i)
    prevT = t
  }
  if (cur.length > 0) batches.push(cur)
  const pending = built.flatMap((e, i) => (typeof e.mintedAt === 'number' ? [] : [i]))
  if (pending.length > 0) batches.push(pending)

  // Per game, if no organic sticker, promote the smallest-hash item to its
  // sticker image. (The same rule the reveal applies over the same hashes, so
  // both agree on which item — and which sticker — the game grants.)
  for (const batch of batches) {
    if (batch.some((i) => built[i]!.resolved.isSticker)) continue
    let pick = batch[0]!
    for (const i of batch) if (built[i]!.hash < built[pick]!.hash) pick = i
    built[pick] = { ...built[pick]!, resolved: resolveCollectible(built[pick]!.hashHex, true) }
  }
  return built
}

/** Collapse entries that resolve to the same asset into one representative
 *  carrying a `count`. The representative is the most-recently-minted member,
 *  so "Newest" sort reflects the latest copy. Pending and confirmed copies of
 *  the same art stay separate (they're distinct states). Input is not mutated.
 *  Insertion order of first-seen assets is preserved (sortEntries reorders). */
export function collapseDuplicates(entries: CollectibleEntry[]): CollectibleEntry[] {
  const groups = new Map<string, { rep: CollectibleEntry; count: number }>()
  for (const e of entries) {
    const key = `${e.resolved.url}|${e.pending ? 'p' : 'o'}`
    const g = groups.get(key)
    if (!g) { groups.set(key, { rep: e, count: 1 }); continue }
    g.count += 1
    if ((e.mintedAt ?? 0) > (g.rep.mintedAt ?? 0)) g.rep = e
  }
  return Array.from(groups.values(), ({ rep, count }) => ({ ...rep, count }))
}

export type SortMode = 'recent' | 'rarity' | 'name'

export const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Newest',
  rarity: 'Rarity',
  name: 'Name'
}

/** Sort a list of entries by the chosen mode. Returns a new array; never
 *  mutates the input. Ties break on hash for a stable, deterministic order
 *  regardless of native delivery order. */
export function sortEntries(entries: CollectibleEntry[], mode: SortMode): CollectibleEntry[] {
  const out = entries.slice()
  out.sort((a, b) => {
    switch (mode) {
      case 'recent': {
        // Pending (no timestamp) sort to the very top — they're the
        // freshest activity the user should notice.
        const am = a.mintedAt ?? Infinity
        const bm = b.mintedAt ?? Infinity
        if (am !== bm) return bm - am
        break
      }
      case 'rarity': {
        // Tier order: sticker (special) → rare → common; newest within a tier.
        const tier = (e: CollectibleEntry) =>
          e.resolved.isSticker ? 2 : e.resolved.isRare ? 1 : 0
        const ta = tier(a)
        const tb = tier(b)
        if (ta !== tb) return tb - ta
        const am = a.mintedAt ?? 0
        const bm = b.mintedAt ?? 0
        if (am !== bm) return bm - am
        break
      }
      case 'name': {
        const cmp = a.resolved.name.localeCompare(b.resolved.name)
        if (cmp !== 0) return cmp
        break
      }
    }
    return a.hash.localeCompare(b.hash)
  })
  return out
}

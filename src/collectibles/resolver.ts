// Collectible hash → displayable asset.
//
// Ported from the CollectableHashResolver tool (~/git/CollectableHashResolver)
// and the game-results webview's src/attestations/resolver.ts. Images are
// uploaded to the Bulletin Chain (Summit network) and indexed by
// CID in cid_map.json. The 32-byte NFT hash deterministically picks one
// image from the catalog:
//
//   bytes 0-1 → rarity roll (uint16; if < RARE_THRESHOLD → rare pool)
//   bytes 2-3 → image index (uint16; mod pool size → entry in the
//                lexicographically-sorted pool)
//
// The collection is split at module load into a "normal" pool and a
// "rare" pool by checking each filename for the substring "rare"
// (case-insensitive). Sorting is by full path key, lexicographic, so new
// images appended with later 5-digit prefixes never remap existing hashes.
//
// Unlike the game-results version this resolver is SYNCHRONOUS: the
// gallery resolves a whole owned set up front to lay out tiles, and the
// only async work (loading the IPFS image) happens in the <img> tag.

import cidMap from './cid_map.json'

/** Summit Bulletin Chain IPFS gateway. Bulletin storage expires
 *  (~2 weeks); when that happens, re-upload via the resolver tool. */
const IPFS_GATEWAY = 'https://summit-ipfs.polkadot.io/ipfs'

/** Rarity threshold over a uint16 space (0..65535). 6554/65536 ≈ 10%
 *  chance of a rare roll. Matches RARE_THRESHOLD in the resolver tool. */
const RARE_THRESHOLD = 6554

export type Rarity = 'common' | 'rare'

interface PoolEntry {
  url: string
  filename: string
  name: string
  collection: string
  /** 1-based position of this item within its collection (sorted), and the
   *  collection's total size — drives the "No. X of Y" detail fact. */
  collectionIndex: number
  collectionSize: number
}

/** Percentage drop-rate for a rarity, derived from RARE_THRESHOLD over the
 *  uint16 space. Rare ≈ 10%, common ≈ 90%. Used by the detail "Drop rate"
 *  fact. */
export function dropRatePercent(rarity: Rarity): number {
  const rare = Math.round((RARE_THRESHOLD / 65536) * 100)
  return rarity === 'rare' ? rare : 100 - rare
}

/** Title-case a separator-delimited fragment: "_"/"-" → spaces, collapse
 *  whitespace, capitalise each word. */
function titleCase(fragment: string): string {
  return fragment
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Split a catalogue filename into its collection (the first underscore
 *  segment after the numeric index) and the item's display name (everything
 *  after it). The 5-digit prefix and any standalone `rare` tag are dropped.
 *    "00001_Cocktail_Aperol_Spritz.png" → { collection: "Cocktail", name: "Aperol Spritz" }
 *    "00004_Cocktail_Bramble_rare.png"  → { collection: "Cocktail", name: "Bramble" }
 *    "00031_Fruit_Lingonberry.png"      → { collection: "Fruit",    name: "Lingonberry" }
 *  A single-segment filename (no collection prefix) keeps that segment as the
 *  name and leaves the collection empty. */
function parseFilename(filename: string): { collection: string; name: string } {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')        // drop extension
    .replace(/^\d+[_-]/, '')              // drop leading 5-digit index
  const segments = base.split('_').filter((s) => s && !/^rare$/i.test(s))
  const collection = titleCase(segments[0] ?? '')
  const name = titleCase(segments.slice(1).join(' '))
  return name ? { collection, name } : { collection: '', name: collection }
}

/** Just the collection token of a filename (the first segment) — a lighter
 *  path than `parseFilename` for the load-time grouping pass, which only
 *  needs to bucket every catalogue key by collection. */
function collectionOf(filename: string): string {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\d+[_-]/, '')
  return titleCase(base.split('_')[0] ?? '')
}

const MAP = cidMap as Record<string, string>

/** Index the catalogue once at module load into two pools of *map keys*
 *  (lexicographically sorted, partitioned by the "rare" substring in the
 *  basename), skipping entries whose CID is missing/empty so the pool sizes
 *  match exactly. This does only the cheap classification — no URL strings,
 *  no display-name regexes, no per-entry objects — so the hash→image
 *  mapping stays byte-for-byte identical while the heavy materialization is
 *  deferred to `materialize()`.
 *
 *  Why: the mapping needs the full ordered/classified catalogue (a hash
 *  picks `pickVal % pool.length` over the sorted pool, so dropping entries
 *  would remap every hash). But a CID is only ever *used* for an entry the
 *  user actually owns. With the catalogue at thousands of entries, eagerly
 *  building a URL + running the 6-regex name transform for all of them at
 *  startup was O(catalogue) wasted main-thread work before first paint;
 *  now it's O(owned). */
function indexCatalogue(): {
  normal: string[]
  rare: string[]
  place: Map<string, { index: number; size: number }>
} {
  const normal: string[] = []
  const rare: string[] = []
  // collection → its keys in sorted order, for "No. X of Y" placement.
  const byCollection = new Map<string, string[]>()
  for (const key of Object.keys(MAP).sort()) {
    const cid = MAP[key]
    if (typeof cid !== 'string' || !cid) continue
    const filename = key.replace(/\\/g, '/').split('/').pop() || key
    if (filename.toLowerCase().includes('rare')) rare.push(key)
    else normal.push(key)
    const collection = collectionOf(filename)
    const members = byCollection.get(collection)
    if (members) members.push(key)
    else byCollection.set(collection, [key])
  }
  const place = new Map<string, { index: number; size: number }>()
  for (const members of byCollection.values()) {
    members.forEach((k, i) => place.set(k, { index: i + 1, size: members.length }))
  }
  return { normal, rare, place }
}

const { normal: NORMAL_KEYS, rare: RARE_KEYS, place: COLLECTION_PLACE } = indexCatalogue()

/** Total number of distinct images in the catalogue (normal + rare). */
export const CATALOGUE_SIZE = NORMAL_KEYS.length + RARE_KEYS.length

/** Lazily turn a catalogue key into a displayable PoolEntry, memoized so a
 *  repeated resolve (a popular image, a re-render, or the malformed-hash
 *  fallback) never rebuilds the URL/name. Only ever called for entries the
 *  user owns. */
const entryCache = new Map<string, PoolEntry>()
function materialize(key: string): PoolEntry {
  let entry = entryCache.get(key)
  if (entry) return entry
  const filename = key.replace(/\\/g, '/').split('/').pop() || key
  const { collection, name } = parseFilename(filename)
  const place = COLLECTION_PLACE.get(key) ?? { index: 0, size: 0 }
  entry = {
    url: `${IPFS_GATEWAY}/${MAP[key]}`,
    filename,
    name,
    collection,
    collectionIndex: place.index,
    collectionSize: place.size
  }
  entryCache.set(key, entry)
  return entry
}

export interface ResolvedCollectible {
  /** IPFS gateway URL — ready to drop into an <img src>. */
  url: string
  /** Original filename from cid_map (e.g. "00003_Black_Opal_rare.png"). */
  filename: string
  /** Human display name with the collection prefix removed, e.g. the
   *  "Aperol Spritz" of "00001_Cocktail_Aperol_Spritz.png". */
  name: string
  /** Collection the item belongs to — the first filename segment, e.g.
   *  "Cocktail". Empty for single-segment filenames. */
  collection: string
  /** 1-based position of this item within its collection, and the
   *  collection's total size — for the "No. X of Y" detail fact. Both 0 if
   *  the item's collection couldn't be placed. */
  collectionIndex: number
  collectionSize: number
  /** Binary rarity derived from the hash (the catalogue has a normal pool
   *  and a "rare" pool — there are no finer tiers). */
  rarity: Rarity
  /** Convenience alias for `rarity === 'rare'`. */
  isRare: boolean
}

/** Parse a uint16 from two consecutive bytes at the given byte offset. */
function uint16At(hex: string, byteOffset: number): number {
  const start = byteOffset * 2
  const hi = parseInt(hex.slice(start, start + 2), 16)
  const lo = parseInt(hex.slice(start + 2, start + 4), 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return 0
  return ((hi & 0xff) << 8) | (lo & 0xff)
}

/** Resolve a 32-byte NFT hash to a catalogue image.
 *
 *  Accepts hex with or without a leading "0x", case-insensitive. On
 *  malformed input, falls back to the first available entry and logs a
 *  warning (one bad hash never empties the gallery). */
export function resolveCollectible(hashHex: string): ResolvedCollectible {
  const cleaned = (hashHex || '').trim()
  const hex = cleaned.startsWith('0x') || cleaned.startsWith('0X')
    ? cleaned.slice(2)
    : cleaned

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    const fallbackKey = NORMAL_KEYS[0] ?? RARE_KEYS[0]
    if (!fallbackKey) throw new Error('cid_map is empty')
    console.warn(
      `[resolver] hash not 32-byte hex (got ${hex.length} chars), using fallback`,
      hashHex.slice(0, 16)
    )
    return { ...materialize(fallbackKey), rarity: 'common', isRare: false }
  }

  const rarityVal = uint16At(hex, 0)
  const pickVal = uint16At(hex, 2)

  const useRare = RARE_KEYS.length > 0 && rarityVal < RARE_THRESHOLD
  const pool = useRare ? RARE_KEYS : NORMAL_KEYS
  if (pool.length === 0) throw new Error('collectible pools are empty')

  const entry = materialize(pool[pickVal % pool.length]!)
  return { ...entry, rarity: useRare ? 'rare' : 'common', isRare: useRare }
}

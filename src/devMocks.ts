// Mock CollectionInput shapes used by the ?dev=1 panel. Each variant
// exercises a distinct gallery state. In production, native delivers the
// real owned set via window.setCollection / window.pushNft.

import type { CollectionInput, OwnedNft } from './bridge/types'

/** A realistic native-shape NFT hash: 64 lowercase hex chars (32 bytes).
 *  The resolver consumes the first 4 bytes for rarity + image pick, so a
 *  plain random hash is all we need. */
function randomHash(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let h = '0x'
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0')
  return h
}

/** Set the rarity roll (bytes 0-1, big-endian uint16) on a fresh random hash
 *  so it lands in a chosen band. The resolver checks bands low→high: sticker
 *  [0, 1311), rare [1311, 7865), common otherwise (see resolver.ts). */
function hashWithRarityRoll(min: number, max: number): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const v = min + Math.floor(Math.random() * (max - min))
  bytes[0] = (v >> 8) & 0xff
  bytes[1] = v & 0xff
  let h = '0x'
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0')
  return h
}

/** A hash forced into the rare pool: rarity roll in [STICKER_THRESHOLD,
 *  STICKER_THRESHOLD + RARE_THRESHOLD) = [1311, 7865). (Previously this set the
 *  roll to ~0, which now lands in the sticker band — hence the explicit range.) */
function rareHash(): string {
  return hashWithRarityRoll(1311, 7865)
}

/** A hash forced into the sticker pool: rarity roll in [0, STICKER_THRESHOLD)
 *  = [0, 1311). These are the 14 special Web3-Summit stickers. */
function stickerHash(): string {
  return hashWithRarityRoll(0, 1311)
}

/** `n` DISTINCT hashes that all resolve to the SAME asset: the resolver keys
 *  off bytes 0-3 (rarity roll + image pick), so sharing those four bytes while
 *  randomising the rest yields duplicates of one collectible. Used to exercise
 *  the "×N" duplicate badge. */
function dupes(n: number): OwnedNft[] {
  const head = new Uint8Array(4)
  crypto.getRandomValues(head)
  const now = Math.floor(Date.now() / 1000)
  const out: OwnedNft[] = []
  for (let i = 0; i < n; i++) {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    bytes.set(head, 0)
    let h = '0x'
    for (let j = 0; j < bytes.length; j++) h += bytes[j]!.toString(16).padStart(2, '0')
    out.push({ hash: h, mintedAt: now - i * 3600 })
  }
  return out
}

const DAY = 86_400 // seconds

/** Build `count` owned NFTs spread across recent "games" of ~10 items each.
 *
 *  CRITICAL: every item in a game shares ONE exact `mintedAt` (the on-chain
 *  per-game value). The gallery groups by mint time to apply the per-game
 *  sticker guarantee, so per-item timestamp jitter would split a game into
 *  singletons and promote EVERY item to a sticker. We don't inject stickers
 *  here — the gallery's own promotion adds exactly one per game, exercising the
 *  real guarantee path (mirrors production, where organic stickers are rare). */
function buildOwned(count: number, rareEvery: number = 7): OwnedNft[] {
  const now = Math.floor(Date.now() / 1000)
  const out: OwnedNft[] = []
  for (let i = 0; i < count; i++) {
    const game = Math.floor(i / 10)
    const mintedAt = now - game * 3 * DAY // SAME for every item in the game
    const isRare = rareEvery > 0 && i % rareEvery === rareEvery - 1
    out.push({ hash: isRare ? rareHash() : randomHash(), mintedAt })
  }
  return out
}

/** One game (10 items at one timestamp) that already contains an organic
 *  sticker — exercises the "sticker present, skip promotion" path, so the game
 *  shows exactly one sticker without the gallery promoting a second. */
function gameWithOrganicSticker(): OwnedNft[] {
  const now = Math.floor(Date.now() / 1000)
  const out: OwnedNft[] = [{ hash: stickerHash(), mintedAt: now }]
  for (let i = 0; i < 9; i++) out.push({ hash: randomHash(), mintedAt: now })
  return out
}

export interface DevMock {
  label: string
  build: () => CollectionInput
}

// Realistic People Chain handles — lowercase, with a numeric suffix, ~11
// chars. Most usernames cluster around this length, so the header is tuned
// to display them comfortably.
const MOCK_NAME = 'byteboro.42'

export const DEV_MOCKS: DevMock[] = [
  {
    label: 'small (5)',
    build: () => ({ displayName: MOCK_NAME, owned: buildOwned(5) })
  },
  {
    label: 'typical (18)',
    build: () => ({ displayName: MOCK_NAME, owned: buildOwned(18) })
  },
  {
    label: 'collector (60)',
    build: () => ({ displayName: 'quartzwilds.18', owned: buildOwned(60) })
  },
  {
    label: 'rare-heavy (12)',
    build: () => ({ displayName: MOCK_NAME, owned: buildOwned(12, 2) })
  },
  {
    label: 'organic sticker',
    build: () => ({ displayName: MOCK_NAME, owned: gameWithOrganicSticker() })
  },
  {
    label: '+ pending',
    build: () => ({
      displayName: MOCK_NAME,
      owned: [
        ...buildOwned(9),
        { hash: rareHash(), pending: true },
        { hash: randomHash(), pending: true }
      ]
    })
  },
  {
    label: '+ duplicates',
    build: () => ({
      displayName: MOCK_NAME,
      owned: [...buildOwned(6), ...dupes(4), ...dupes(2)]
    })
  },
  {
    label: 'empty',
    build: () => ({ displayName: MOCK_NAME, owned: [] })
  }
]

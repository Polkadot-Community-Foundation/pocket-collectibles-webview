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

/** A hash forced into the rare pool: bytes 0-1 < RARE_THRESHOLD (6554).
 *  We set byte 0 = 0x00 so the uint16 is always well under the threshold. */
function rareHash(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  bytes[0] = 0x00
  bytes[1] = Math.floor(Math.random() * 0x19) // < 0x1999 ≈ 6553
  let h = '0x'
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0')
  return h
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

/** Build `count` owned NFTs spread across recent "games". Items minted in
 *  the same game share a near-identical timestamp (bounded within a block),
 *  mirroring the on-chain note that per-game timestamps cluster together. */
function buildOwned(count: number, rareEvery: number = 7): OwnedNft[] {
  const now = Math.floor(Date.now() / 1000)
  const out: OwnedNft[] = []
  // Group items into "games" of ~10, each game a few days apart.
  for (let i = 0; i < count; i++) {
    const game = Math.floor(i / 10)
    const mintedAt = now - game * 3 * DAY - Math.floor(Math.random() * 120)
    const isRare = rareEvery > 0 && i % rareEvery === rareEvery - 1
    out.push({ hash: isRare ? rareHash() : randomHash(), mintedAt })
  }
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

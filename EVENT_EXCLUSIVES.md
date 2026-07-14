# Event exclusives — how the Web3 Summit sticker tier worked, and how to build the next one

For Web3 Summit 2026 the gallery had a special "sticker" tier: 14 event-exclusive
items that rendered with their own Polkadot-pink identity, were guaranteed once
per game played at the event, and could be redeemed at the swag stand for a real
physical sticker. The event ended and the whole feature was removed. This note
records how it was built so the next event exclusive doesn't start from zero.

The full reference implementation lives in git history — `178b21e` (new
stickers), `2ecff0e` (add sticker logic), and the removal commit that follows
them show every piece end to end.

## The moving parts

An event-exclusive tier touched five layers. All of them are needed again for
anything similar.

### 1. Catalogue entries (`src/collectibles/cid_map.json`)

Exclusive items were ordinary catalogue entries whose filename marked them as a
tier of their own: category segment `Stickers` and tag `w3s`, e.g.
`00001--Stickers--agentic_human--w3s--8F5E4F.webp`. The resolver classified
filenames into pools at module load (`indexCatalogue()`), so a new tier only
needs a recognizable filename convention plus a matching classifier predicate
(the old one was `isStickerFilename()`).

Rules that still apply to any catalogue change:

- Pools are sorted lexicographically by map key, and a hash picks
  `pickVal % pool.length`. Adding or removing entries **within a pool remaps
  which item every in-band hash resolves to**. Adding a whole new pool (new
  tier) is safe for existing pools; growing an existing pool is not.
- New images must be appended with later 5-digit prefixes so existing keys keep
  their sort position.

### 2. Resolver band (`src/collectibles/resolver.ts`)

Rarity comes from bytes 0–1 of the 32-byte NFT hash (big-endian uint16, 0–65535),
checked against bands low→high. The sticker tier carved its band out of the
*bottom* of the space:

```
[0, 1311)      → sticker pool   (≈2% organic chance)
[1311, 7865)   → rare pool      (≈10%)
else           → normal pool
```

An empty pool's band fell through to the next tier — that fall-through is what
made removal safe: with the sticker pool gone, `[0, 7865)` all resolves as rare,
which is why `RARE_THRESHOLD` is now 7865 and must never be changed (see the
comment on the constant).

**Band arithmetic is permanent history.** Hashes are already minted on-chain;
the resolver is the only thing that decides what art they show. When you add a
tier, carve its band from an existing tier's range and accept that in-band
hashes users already own will visibly change tier. When you retire it, fold the
band into the adjacent tier rather than renumbering — that's the only way
existing rare/common items keep their exact art.

The resolver also took a `forceSticker` override parameter so a hash could be
*presented* as a sticker regardless of its roll (see the guarantee below), with
the hash's index bytes still picking which sticker. Keep any such override a
pure function of the hash so independent surfaces agree.

### 3. The per-event guarantee (`src/collectibles/format.ts`)

Marketing wanted "every game played at the event grants one sticker", but the
minting layer can't force a hash's bytes retroactively and organic rolls are
only ~2%. The guarantee was delivered at **presentation time** in
`buildEntries()`:

- Group the owned set into per-game mint batches. A game's NFTs share one
  on-chain `mintedAt`, but per-item drift happens, so batches were clustered
  with a gap tolerance (`GAME_GAP_S = 90` seconds) instead of exact equality —
  exact matching would split a game into singletons and promote *every* item.
  Pending items (no timestamp) formed one batch of their own.
- In any batch with no organic sticker, promote the
  lexicographically-smallest-hash item via the `forceSticker` resolve.

Because promotion was a pure function of the batch's hashes, the game-results
reveal webview could run the identical rule over the same batch and show the
same item as the same sticker. If you reintroduce a guarantee, keep it pure and
deterministic for exactly this reason.

There was additionally a minting-layer component: one crafted attestation hash
per game with rarity bytes inside the exclusive band, so at least one *organic*
exclusive existed per game where possible.

### 4. Redemption state (`src/collectibles/redeemed.ts`, deleted)

Physical redemption had no native or on-chain signal, so it was webview-local:
a `Set` of normalized hashes (lowercase, no `0x`) persisted to `localStorage`
under `pkt_redeemed_stickers_v1`, wrapped in try/catch because some WebViews
block storage, and exposed to React through `useSyncExternalStore` with a
cached string snapshot. Consequences to be aware of next time:

- Redemption is trust-based and device-local. Clearing app data "un-redeems".
  It worked because a human at the swag stand watched the tap happen. Anything
  unsupervised needs a server- or chain-side record instead.
- The confirm dialog existed because redemption is irreversible from the
  holder's point of view — copy warned "only redeem when the staff tells you
  to".

### 5. UI surfaces

Everything visual keyed off `resolved.isSticker` / `rarity === 'sticker'`:

- **Tile** (`CollectibleTile.tsx`): `tile--sticker` class (pink glow, idle
  float), a `★ STICKER` badge, and the collection line swapped for a pink
  "REDEEM ME" / "REDEEMED" call-out that updated live via the redeemed store.
- **Detail** (`DetailScreen.tsx`): `★ STICKER` rarity pill
  (`rarity-pill--sticker`), a prominent redeem callout panel, a pink Redeem
  button replacing the disabled Send button, and a portal-mounted confirmation
  dialog (`confirm-*` styles, Esc handled in capture phase so it pre-empted the
  detail view's own Esc-to-close).
- **Sorting** (`format.ts`): the rarity sort put the exclusive tier above rare.
- **Dev mocks** (`devMocks.ts`): a `stickerHash()` helper (rarity roll forced
  into the band) and an "organic sticker" scenario exercising the
  guarantee-skip path.

## Checklist for the next event exclusive

1. Add tagged catalogue entries under a new filename category with a fresh
   prefix range; never grow the existing normal/rare pools mid-flight.
2. Carve a band for the new tier out of an existing band's range; mirror the
   exact same constants in the game-results webview resolver and the
   CollectableHashResolver tool **in the same release** — the two surfaces must
   agree byte-for-byte on hash→art.
3. If a per-game guarantee is wanted: coordinate with the minting layer for
   in-band crafted hashes, and/or add a pure presentation-time promotion over
   mint-time batches (with gap clustering).
4. Decide where redemption truth lives (local was fine for staffed, one-off
   redemption; anything else needs a backend).
5. Add the tier's UI: tile badge + glow, rarity pill, detail callout/action,
   sort priority, dev mocks, `dropRatePercent` branch.
6. Plan the retirement path up front: when the event ends, fold the band into
   the adjacent tier (don't renumber), remove the catalogue entries, and note
   the absorbed range on the surviving threshold constant — as was done with
   `RARE_THRESHOLD = 7865`.

// Plain-language explanations for the concepts the gallery surfaces, shown
// via the InfoTip "?" affordances. Single source of truth for this copy so
// the wording stays consistent wherever a concept is explained.
//
// Consumer-first: no chain / NFT / hash jargon — just what it means for the
// person holding the collectible.

export interface Concept {
  title: string
  body: string
}

export const CONCEPTS = {
  rarity: {
    title: 'Rarity & drop rate',
    body: 'Some collectibles turn up far less often than others, and the rarest ones glow brighter. The drop rate is roughly how often this exact one appears.'
  },
  pending: {
    title: 'Pending',
    body: "This collectible is still being finalized. It'll confirm shortly, and then show the date you earned it."
  }
} as const satisfies Record<string, Concept>

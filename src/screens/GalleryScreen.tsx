import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import CollectibleTile from '../components/CollectibleTile'
import type { CollectibleEntry, SortMode } from '../collectibles/format'
import { sortEntries, collapseDuplicates, SORT_LABELS } from '../collectibles/format'
import { EASE, prefersReducedMotion } from '../anim/easings'
import { haptic } from '../haptics/engine'

interface GalleryScreenProps {
  entries: CollectibleEntry[]
  displayName?: string
  /** Open the detail view. Passes the current sorted list + the tapped
   *  item's index so detail can swipe between items in display order, plus
   *  the on-screen art rect for the shared-element zoom. */
  onOpen: (list: CollectibleEntry[], index: number, artRect: DOMRect) => void
}

const SORT_MODES: SortMode[] = ['recent', 'rarity', 'name']

export default function GalleryScreen({ entries, displayName, onOpen }: GalleryScreenProps) {
  const [sort, setSort] = useState<SortMode>('recent')
  const gridRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)

  // Tiles show one entry per distinct asset (duplicates collapsed to a "×N"
  // badge); the header counts below stay on the full owned set.
  const sorted = useMemo(() => sortEntries(collapseDuplicates(entries), sort), [entries, sort])
  const rareCount = useMemo(() => entries.filter((e) => e.resolved.isRare).length, [entries])

  // Publish the header's bottom edge as a CSS variable so the ambient
  // particle canvas can mask itself out behind the title/stats/sort area
  // — motes appear only over the content below, not over the header. The
  // variable defaults to 0 on screens that don't set it, so the boot /
  // empty / detail views aren't affected.
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const update = () => {
      const bottom = header.offsetTop + header.offsetHeight
      document.documentElement.style.setProperty('--gallery-header-bottom', `${bottom}px`)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(header)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--gallery-header-bottom')
    }
  }, [])

  // Entrance: header slides up, the owned-count rolls, tiles cascade in.
  // Runs once per mount (empty deps); a new collection replays it via the
  // remount key in App, and sort-change reflow is handled separately below.
  //
  // No re-run guard here on purpose: the cleanup reverts the timeline, so
  // under StrictMode's setup→cleanup→setup double-invoke the second setup
  // must be free to rebuild it. A `didIntro` guard would let the first
  // setup build the timeline, the cleanup revert it, and the second setup
  // bail — leaving the entrance reverted and never replayed. Empty deps also
  // keep an unstable onOpen identity from tearing down the animation on an
  // unrelated App re-render. (The owned-count roll is its own effect below.)
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion()

    const ctx = gsap.context(() => {
      if (reduce) {
        gsap.set(['.gallery-header > *', '.tile'], { opacity: 1, clearProps: 'transform' })
        return
      }
      const tl = gsap.timeline()
      tl.from('.gallery-header > *', {
        y: 18, opacity: 0, duration: 0.5, stagger: 0.07, ease: EASE.entranceSoft
      })
      const tiles = gridRef.current?.querySelectorAll('.tile')
      if (tiles && tiles.length) {
        tl.from(tiles, {
          y: 28, scale: 0.82, opacity: 0,
          duration: 0.55,
          ease: EASE.settleSoft,
          // `amount` spreads the stagger across a fixed total time regardless
          // of tile count — `each` would give a 20s+ tail on a large (capped)
          // collection. ~0.045/tile for a small set, compressed for big ones.
          stagger: { amount: Math.min(0.6, tiles.length * 0.045), from: 'start', grid: 'auto' }
        }, '-=0.2')
      }
      // The owned-count roll lives in its own effect (below) so GSAP owns
      // the count node outright — see the note there.
    }, headerRef)

    // Dev convenience: `?open=<n>` auto-opens the nth tile once the grid
    // has laid out, so the detail view can be shared / screenshotted via a
    // plain URL. No-op in normal use.
    const openParam = new URLSearchParams(window.location.search).get('open')
    if (openParam != null) {
      const i = Math.max(0, Math.min(sorted.length - 1, parseInt(openParam, 10) || 0))
      window.setTimeout(() => {
        const tile = gridRef.current?.querySelectorAll('.tile')[i]
        const art = tile?.querySelector('.tile-art') as HTMLElement | null
        if (art) onOpen(sorted, i, art.getBoundingClientRect())
      }, reduce ? 50 : 900)
    }

    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Owned-count roll. GSAP owns the count node OUTRIGHT — the span renders
  // no React child (see JSX) so React never commits a number into the same
  // text node GSAP is animating. Previously the span rendered
  // `{entries.length}` while a tween wrote textContent toward a mount-time
  // target: when items streamed in mid-roll, React committed the new number,
  // GSAP overwrote it back toward the stale target, and — because React's
  // vdom already held the live value — it never repaired the DOM, leaving the
  // header permanently undercounting. Now the count rolls from whatever is
  // currently shown to the LIVE count on mount and on every change.
  const countTweenRef = useRef<gsap.core.Tween | null>(null)
  useLayoutEffect(() => {
    const el = countRef.current
    if (!el) return
    const target = entries.length
    countTweenRef.current?.kill()
    if (prefersReducedMotion()) {
      el.textContent = String(target)
      return
    }
    const shown = parseInt(el.textContent || '', 10)
    const obj = { n: Number.isFinite(shown) ? shown : 0 }
    countTweenRef.current = gsap.to(obj, {
      n: target, duration: 0.6, ease: 'power2.out',
      onUpdate: () => { el.textContent = String(Math.round(obj.n)) }
    })
    return () => { countTweenRef.current?.kill() }
  }, [entries.length])

  // Reflow when the sort mode changes: a quick stagger so the new order
  // reads as a deliberate reshuffle rather than a hard cut.
  const prevSort = useRef(sort)
  useLayoutEffect(() => {
    if (prevSort.current === sort) return
    prevSort.current = sort
    if (prefersReducedMotion()) return
    const tiles = gridRef.current?.querySelectorAll('.tile')
    if (!tiles || !tiles.length) return
    gsap.fromTo(tiles,
      { opacity: 0, scale: 0.9, y: 10 },
      {
        opacity: 1, scale: 1, y: 0, duration: 0.4, ease: EASE.entranceSoft,
        // Bounded total spread (see entrance) so a large set doesn't crawl.
        stagger: { amount: Math.min(0.4, tiles.length * 0.02), from: 'start' }
      }
    )
  }, [sort])

  return (
    <div className="screen gallery">
      <div className="gallery-header" ref={headerRef}>
        <h1 className="gallery-title">
          {displayName ?? 'your collection'}
        </h1>
        <div className="gallery-stats">
          <span className="stat-count"><span ref={countRef} /> collectibles</span>
          {rareCount > 0 && (
            <>
              <span className="stat-dot">·</span>
              <span className="stat-rare">✦ {rareCount} rare</span>
            </>
          )}
        </div>
        <div className="sort-row" role="tablist" aria-label="Sort collectibles">
          {SORT_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={sort === m}
              className={`sort-chip${sort === m ? ' is-active' : ''}`}
              onClick={() => {
                if (sort === m) return
                haptic.initFromGesture()
                haptic.play('tap-store')
                setSort(m)
              }}
            >
              {SORT_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="gallery-scroll">
        <div className="gallery-grid" ref={gridRef}>
          {sorted.map((entry, i) => (
            <CollectibleTile
              key={entry.hash}
              entry={entry}
              onOpen={(_e, rect) => onOpen(sorted, i, rect)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Empty-collection state — shown when native delivers zero owned items.
 *  Kept here so the gallery module owns both populated + empty cases. */
export function EmptyGallery({ displayName }: { displayName?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.from('.empty > *', { y: 20, opacity: 0, duration: 0.6, stagger: 0.1, ease: EASE.entranceSoft })
      gsap.to('.empty-orb', { scale: 1.06, duration: 2.4, ease: EASE.float, yoyo: true, repeat: -1 })
    }, ref)
    return () => ctx.revert()
  }, [])
  return (
    <div className="screen gallery" ref={ref}>
      <div className="empty">
        <div className="empty-orb" aria-hidden="true">◈</div>
        <h1 className="gallery-title">
          {displayName ? `Nothing yet, ${displayName}` : 'No collectibles yet'}
        </h1>
        <p className="empty-copy">
          Play and pass games to earn collectibles. They'll appear here, ready to admire.
        </p>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import PhoneFrame from './components/PhoneFrame'
import ParticleCanvas, { type ParticleCanvasApi } from './components/ParticleCanvas'
import GalleryScreen, { EmptyGallery } from './screens/GalleryScreen'
import DetailScreen from './screens/DetailScreen'
import {
  readInitialCollection,
  subscribeCollection,
  hasDelivered,
  getCollectionGeneration,
  getDroppedCount
} from './bridge/collection'
import { sendFlowEvent } from './bridge/send'
import type { CollectionInput, OwnedNft } from './bridge/types'
import { buildEntry, type CollectibleEntry } from './collectibles/format'
import { DEV_MOCKS } from './devMocks'

// If native never delivers a collection, fall back to the empty state
// after this long rather than spinning forever (offline / silent host).
const BOOT_TIMEOUT_MS = 8_000

// Dev panel shows only with ?dev=1. Mirrors the game-results convention.
const isDevMode =
  typeof window !== 'undefined' && /[?&]dev=1\b/.test(window.location.search)

// "Embedded" = running inside a native WebView host (not a desktop preview).
// CSS flattens the phone-frame mockup when body.is-embedded is set.
const isEmbedded =
  typeof window !== 'undefined' && (
    !!(window as unknown as { collectibles?: unknown }).collectibles ||
    !!window.webkit?.messageHandlers?.collectibles ||
    /[?&]embed=1\b/.test(window.location.search)
  )

interface Selection {
  list: CollectibleEntry[]
  index: number
  originRect: DOMRect
}

export default function App() {
  const initial = useMemo(() => readInitialCollection(), [])
  const [items, setItems] = useState<OwnedNft[]>(initial.items)
  const [displayName, setDisplayName] = useState<string | undefined>(initial.displayName)
  const [delivered, setDelivered] = useState<boolean>(hasDelivered())
  const [bootTimedOut, setBootTimedOut] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  // Remount key for the gallery: bumps only on a wholesale setCollection
  // (new scenario / dev mock), so the entrance — count-up included —
  // replays. Incremental pushNft streaming leaves it untouched.
  const [collectionGen, setCollectionGen] = useState<number>(getCollectionGeneration())

  const particleRef = useRef<ParticleCanvasApi>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const hasFiredReady = useRef(false)
  const reportedDropped = useRef(0)
  const hasFiredGalleryShown = useRef(false)
  const prevCollectionGen = useRef(collectionGen)

  // Resolve raw NFTs → display entries. Memoized so we only re-resolve when
  // the owned set actually changes.
  const entries = useMemo(() => items.map(buildEntry), [items])
  // Always-current entries, so the deferred gallery_shown fire below reports
  // the live count rather than a value captured when the effect first ran.
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // Subscribe to native collection deliveries (initial + late + streamed).
  useEffect(() => {
    const off = subscribeCollection((next) => {
      setItems(next)
      setDelivered(hasDelivered())
      setCollectionGen(getCollectionGeneration())
      // Surface to native when we capped an oversized delivery (so it learns
      // the user owns more than we render). Only on change, to avoid spam.
      const dropped = getDroppedCount()
      if (dropped > 0 && dropped !== reportedDropped.current) {
        reportedDropped.current = dropped
        sendFlowEvent({ type: 'flow.error', phase: 'collection_truncated', detail: `dropped=${dropped}` })
      }
      // Re-read the name in case it arrived with this delivery.
      const fresh = readInitialCollection()
      if (fresh.displayName) setDisplayName(fresh.displayName)
    })
    return off
  }, [])

  // flow.ready once per page lifetime, after first paint.
  useEffect(() => {
    if (hasFiredReady.current) return
    hasFiredReady.current = true
    sendFlowEvent({ type: 'flow.ready' })
  }, [])

  // Dev convenience: `?mock=<name>` auto-loads a scenario on boot so a
  // populated gallery can be shared / screenshotted via a plain URL.
  // No native required. Matches the first whitespace-delimited word of a
  // DEV_MOCKS label (e.g. ?mock=typical, ?mock=rare, ?mock=collector).
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('mock')
    if (!param) return
    const mock = DEV_MOCKS.find((m) => m.label.toLowerCase().startsWith(param.toLowerCase()))
    if (!mock) return
    const w = window as unknown as { setCollection?: (i: CollectionInput) => void }
    w.setCollection?.(mock.build())
  }, [])

  // Tag <body> when embedded so CSS flattens the desktop phone frame.
  useEffect(() => {
    if (!isEmbedded) return
    document.body.classList.add('is-embedded')
    return () => { document.body.classList.remove('is-embedded') }
  }, [])

  // Boot timeout — only relevant before any delivery.
  useEffect(() => {
    if (delivered) return
    const t = window.setTimeout(() => {
      sendFlowEvent({ type: 'flow.error', phase: 'boot_timeout' })
      setBootTimedOut(true)
    }, BOOT_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [delivered])

  // Ambient starfield behind everything, for the whole session.
  useEffect(() => {
    particleRef.current?.startAmbient()
    return () => particleRef.current?.stopAmbient()
  }, [])

  // Asset-failure telemetry. Image-load failures (most likely expired
  // Bulletin Chain CIDs) accumulate on window.__ASSET_FAILURES__ as tiles
  // load lazily. Poll and emit a debounced rollup — only when the count
  // grows — so native learns "art isn't loading" without one event per
  // image. Cheap (a number read every few seconds) for the session.
  useEffect(() => {
    if (!delivered) return
    let reported = 0
    const id = window.setInterval(() => {
      const n = (window as unknown as { __ASSET_FAILURES__?: number }).__ASSET_FAILURES__ ?? 0
      if (n > reported) {
        reported = n
        sendFlowEvent({ type: 'flow.error', phase: 'assets', detail: `image_failures=${n}` })
      }
    }, 4000)
    return () => window.clearInterval(id)
  }, [delivered])

  // flow.gallery_shown — fired once, the first time the populated gallery is
  // shown. Deferred one frame so a burst of pushNft items arriving in the
  // same tick as the first render is counted (the bridge coalesces notifies
  // into a microtask; a frame lands safely after), and reports the LIVE count
  // via entriesRef rather than a value captured at the gallery's mount —
  // which undercounted while items were still streaming.
  useEffect(() => {
    if (hasFiredGalleryShown.current) return
    if (!delivered || entries.length === 0) return
    hasFiredGalleryShown.current = true
    const id = requestAnimationFrame(() => {
      sendFlowEvent({ type: 'flow.gallery_shown', count: entriesRef.current.length })
    })
    return () => cancelAnimationFrame(id)
  }, [delivered, entries.length])

  // A wholesale setCollection (generation bump) replaces the gallery behind
  // an open detail view; the detail holds a snapshot of the OLD list and
  // would keep navigating now-stale/removed items. Close it on replace.
  // Incremental pushNft never bumps the generation, so streaming updates
  // don't dismiss an open detail.
  useEffect(() => {
    if (prevCollectionGen.current === collectionGen) return
    prevCollectionGen.current = collectionGen
    setSelection(null)
  }, [collectionGen])

  function handleOpen(list: CollectibleEntry[], index: number, originRect: DOMRect): void {
    const entry = list[index]
    if (!entry) return
    // Spectacle on open is a rare-only flourish — common items open clean.
    // The particle canvas lives inside the phone frame, so translate the
    // tile's viewport-space center into frame-local coordinates (identity
    // when embedded full-screen; corrects for the centered frame in
    // desktop preview).
    if (entry.resolved.isRare) {
      const frame = frameRef.current?.getBoundingClientRect()
      const cx = originRect.left + originRect.width / 2 - (frame?.left ?? 0)
      const cy = originRect.top + originRect.height / 2 - (frame?.top ?? 0)
      particleRef.current?.sparkleBurst(cx, cy)
    }
    setSelection({ list, index, originRect })
  }

  function handleClose(): void {
    const cur = selection ? selection.list[selection.index] : null
    if (cur) sendFlowEvent({ type: 'flow.item_closed', hash: cur.hashHex })
    setSelection(null)
  }

  function handleShow(hash: string): void {
    sendFlowEvent({ type: 'flow.item_opened', hash: hash.startsWith('0x') ? hash : `0x${hash}` })
  }

  // Dev helper: load a mock collection via the registered native global.
  // setCollection replaces the store wholesale and notifies subscribers, so
  // no resetCollection() is needed here — and calling it would be wrong, as
  // it clears the listener set (including this component's own subscription).
  function loadMock(build: () => CollectionInput): void {
    setSelection(null)
    const w = window as unknown as { setCollection?: (i: CollectionInput) => void }
    w.setCollection?.(build())
  }

  const showBoot = !delivered && !bootTimedOut

  return (
    <div className="page">
      <PhoneFrame ref={frameRef}>
        <ParticleCanvas ref={particleRef} />
        {showBoot && (
          <div className="boot-screen" aria-live="polite">
            <div className="boot-mark" aria-hidden="true">◈</div>
            <div className="boot-copy">Opening your collection…</div>
          </div>
        )}
        {!showBoot && entries.length === 0 && <EmptyGallery {...(displayName ? { displayName } : {})} />}
        {!showBoot && entries.length > 0 && (
          <GalleryScreen
            key={collectionGen}
            entries={entries}
            {...(displayName ? { displayName } : {})}
            onOpen={handleOpen}
          />
        )}

        {/* Detail lives INSIDE the frame so it's clipped to the phone in
            desktop preview (and fills the screen when embedded) — a genuine
            representation of the on-device modal, not a window overlay. */}
        {selection && (
          <DetailScreen
            list={selection.list}
            index={selection.index}
            originRect={selection.originRect}
            onClose={handleClose}
            onShow={handleShow}
          />
        )}
      </PhoneFrame>

      {isDevMode && (
        <div className="dev-panel" role="group" aria-label="Dev mock collections">
          <span className="dev-panel-label">↪ mock collection</span>
          {DEV_MOCKS.map((m) => (
            <button
              key={m.label}
              type="button"
              className="dev-panel-btn"
              onClick={() => loadMock(m.build)}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className="dev-panel-btn dev-panel-btn--reload"
            onClick={() => window.location.reload()}
            title="Reload to reset all state"
          >
            ↻ reload
          </button>
        </div>
      )}
    </div>
  )
}

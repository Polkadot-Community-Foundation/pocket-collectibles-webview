import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createPool, type Pool } from '../particles/pool'
import { createRenderer, type Renderer } from '../particles/renderer'
import {
  dustBurst,
  sparkleBurst,
  legendaryBurst,
  legendaryFollowup,
  silhouetteTap,
  badgeTrail,
  ambientStar,
  revealStarfield,
  nebulaWisps,
  type Tint
} from '../particles/emitters'

// Imperative API exposed to consumers (mainly Stage + the anim/* timelines).
// Each method enqueues particles into the shared pool which the renderer's
// rAF loop consumes and draws on the next frame.
export interface ParticleCanvasApi {
  dustBurst(x: number, y: number, tint?: Tint): void
  sparkleBurst(x: number, y: number): void
  legendaryBurst(x: number, y: number): void
  legendaryFollowup(x: number, y: number): void
  silhouetteTap(x: number, y: number): void
  badgeTrail(x: number, y: number, tint?: Tint): void
  revealStarfield(): void
  nebulaWisps(): void
  startAmbient(): void
  stopAmbient(): void
}

interface AmbientState {
  id: ReturnType<typeof setInterval> | 0
  active: boolean
}

const ParticleCanvas = forwardRef<ParticleCanvasApi>(function ParticleCanvas(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const poolRef = useRef<Pool | null>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const ambientRef = useRef<AmbientState>({ id: 0, active: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pool = createPool()
    poolRef.current = pool
    const renderer = createRenderer(canvas, pool)
    rendererRef.current = renderer
    return () => {
      renderer.destroy()
      // Fully reset the ambient channel — clear BOTH the interval and the
      // `active` guard, so a subsequent startAmbient() (e.g. when React
      // StrictMode re-runs effects, or when ambient is restarted) is free
      // to create a fresh interval instead of being short-circuited by a
      // stale "already active" flag from the previous run.
      if (ambientRef.current.id) clearInterval(ambientRef.current.id)
      ambientRef.current.id = 0
      ambientRef.current.active = false
    }
  }, [])

  useImperativeHandle(ref, () => ({
    dustBurst(x, y, tint) {
      if (poolRef.current) dustBurst(poolRef.current, x, y, tint)
    },
    sparkleBurst(x, y) {
      if (poolRef.current) sparkleBurst(poolRef.current, x, y)
    },
    legendaryBurst(x, y) {
      if (!poolRef.current) return
      legendaryBurst(poolRef.current, x, y)
    },
    legendaryFollowup(x, y) {
      if (poolRef.current) legendaryFollowup(poolRef.current, x, y)
    },
    silhouetteTap(x, y) {
      if (poolRef.current) silhouetteTap(poolRef.current, x, y)
    },
    badgeTrail(x, y, tint) {
      if (poolRef.current) badgeTrail(poolRef.current, x, y, tint)
    },
    revealStarfield() {
      if (!poolRef.current || !rendererRef.current) return
      const { width, height } = rendererRef.current.dimensions()
      revealStarfield(poolRef.current, width, height)
    },
    nebulaWisps() {
      if (!poolRef.current || !rendererRef.current) return
      const { width, height } = rendererRef.current.dimensions()
      nebulaWisps(poolRef.current, width, height)
    },
    startAmbient() {
      if (ambientRef.current.active || !rendererRef.current || !poolRef.current) return
      ambientRef.current.active = true
      const pool = poolRef.current
      const { width, height } = rendererRef.current.dimensions()
      // Spawn every ~90ms (≈11/sec). With a 3.5–6 s lifetime per mote that
      // gives ~50 alive at any moment, distributed across the canvas — a
      // populated but unobtrusive ambient field.
      ambientRef.current.id = setInterval(() => {
        ambientStar(pool, width, height)
      }, 90)
    },
    stopAmbient() {
      ambientRef.current.active = false
      if (ambientRef.current.id) clearInterval(ambientRef.current.id)
      ambientRef.current.id = 0
    }
  }), [])

  return <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />
})

export default ParticleCanvas

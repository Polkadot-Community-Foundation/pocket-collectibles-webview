// Per-item "glow" colour extraction.
//
// Each collectible floats on a saturated, colour-matched glow blob (see the
// mock-ups). To tint that blob we read the item's own pixels: items sit on a
// transparent background, so we sample only the opaque body and pick its most
// *vibrant* hue — a flat average would mud everything to grey. The Bulletin
// gateway serves `access-control-allow-origin: *`, so a crossOrigin image can
// be drawn to a canvas and read without tainting.
//
// Results are cached by URL (gallery tile + detail hero share one extraction;
// gateway assets are immutable).

export interface Swatch {
  /** "R G B" space-separated, ready for `rgb(var(--glow) / a)`. */
  rgb: string
  /** True when the item carries a real, saturated colour (vs near-greyscale
   *  like obsidian/galena) — lets the glow stay restrained for grey items. */
  vivid: boolean
}

const cache = new Map<string, Swatch>()
const inflight = new Map<string, Promise<Swatch | null>>()

/** Already-extracted swatch for a URL, if any — lets the detail view seed the
 *  correct glow synchronously for an item the gallery already processed. */
export function getCachedSwatch(key: string): Swatch | null {
  return cache.get(key) ?? null
}

/** Extract a swatch for a URL via a SEPARATE, off-DOM crossOrigin image, so
 *  the displayed <img> never carries crossOrigin (a non-CORS gateway would
 *  make a crossOrigin image fail to render entirely). Resolves null on any
 *  failure — CORS taint, decode error, 404 — and the caller just keeps the
 *  default glow. Cached + de-duped per URL. */
export function loadSwatch(url: string): Promise<Swatch | null> {
  const cached = cache.get(url)
  if (cached) return Promise.resolve(cached)
  const existing = inflight.get(url)
  if (existing) return existing
  const p = new Promise<Swatch | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(extractSwatch(img, url))
    img.onerror = () => resolve(null)
    img.src = url
  })
  inflight.set(url, p)
  void p.then(() => inflight.delete(url))
  return p
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/** Punch up the chosen colour so the glow reads cleanly — lift saturation a
 *  little and force a high value (a glow is light, not pigment). Grey items
 *  (low saturation) are left near-neutral so they don't get a false tint. */
function vivify(r: number, g: number, b: number): { rgb: string; vivid: boolean } {
  const { h, s, v } = rgbToHsv(r, g, b)
  const vivid = s > 0.18
  const s2 = vivid ? Math.min(1, s * 1.35) : s
  const v2 = Math.max(v, 0.92)
  const [vr, vg, vb] = hsvToRgb(h, s2, v2)
  return { rgb: `${vr} ${vg} ${vb}`, vivid }
}

/** Extract the glow swatch from a loaded, CORS-clean image. Returns null if
 *  the canvas can't be read (tainted) or the image is fully transparent. */
export function extractSwatch(img: HTMLImageElement, key: string): Swatch | null {
  const cached = cache.get(key)
  if (cached) return cached
  try {
    const S = 28
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, S, S)
    const { data } = ctx.getImageData(0, 0, S, S)

    // Hue histogram weighted by saturation·value·alpha; also accumulate a
    // plain average of opaque pixels as the greyscale fallback.
    const BUCKETS = 24
    const w = new Float64Array(BUCKETS)
    const rw = new Float64Array(BUCKETS)
    const gw = new Float64Array(BUCKETS)
    const bw = new Float64Array(BUCKETS)
    let opaque = 0, ar = 0, ag = 0, ab = 0

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a < 200) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      opaque++; ar += r; ag += g; ab += b
      const { h, s, v } = rgbToHsv(r, g, b)
      const weight = s * v * (a / 255)
      const k = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS))
      w[k] += weight; rw[k] += r * weight; gw[k] += g * weight; bw[k] += b * weight
    }
    if (opaque === 0) return null

    let best = -1, bestW = 0
    for (let k = 0; k < BUCKETS; k++) if (w[k] > bestW) { bestW = w[k]; best = k }

    let result: Swatch
    if (best >= 0 && bestW > opaque * 0.04) {
      result = vivify(rw[best] / w[best], gw[best] / w[best], bw[best] / w[best])
    } else {
      // Near-greyscale item: tint the glow with its (cool/neutral) average.
      result = vivify(ar / opaque, ag / opaque, ab / opaque)
    }
    cache.set(key, result)
    return result
  } catch {
    return null
  }
}

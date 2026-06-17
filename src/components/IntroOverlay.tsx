import { useEffect, useState } from 'react'

// First-run intro for the Pocket. Three short cards explaining what
// collectibles are, where they come from, and how to look closer. Skippable,
// shown once (gated on localStorage in App via firstRun.ts). Consumer-first
// copy — no chain / NFT jargon.
const CARDS: Array<{ mark: string; title: string; body: string }> = [
  {
    mark: '◈',
    title: 'Welcome to your Pocket',
    body: 'Every collectible you earn lives here.'
  },
  {
    mark: '◇',
    title: 'Earned by playing',
    body: 'You collect these by playing games. The better you play, the more you find.'
  },
  {
    mark: '✦',
    title: 'Rarer finds glow brighter',
    body: 'Tap any collectible to see it full-screen, with its rarity and details.'
  }
]

interface IntroOverlayProps {
  /** Fires when the user finishes or skips the intro. */
  onDone: () => void
}

export default function IntroOverlay({ onDone }: IntroOverlayProps) {
  const [step, setStep] = useState(0)
  const last = step === CARDS.length - 1
  const card = CARDS[step]!

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])

  return (
    <div
      className="intro-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to your collection"
    >
      <button type="button" className="intro-skip" onClick={onDone}>Skip</button>

      {/* key={step} replays the entrance on each card change. */}
      <div className="intro-card" key={step}>
        <div className="intro-art" aria-hidden="true">{card.mark}</div>
        <h2 className="intro-title">{card.title}</h2>
        <p className="intro-body">{card.body}</p>
      </div>

      <div className="intro-footer">
        <div className="intro-dots" aria-hidden="true">
          {CARDS.map((_, i) => (
            <span key={i} className={`intro-dot${i === step ? ' is-active' : ''}`} />
          ))}
        </div>
        <button
          type="button"
          className="intro-next"
          onClick={() => (last ? onDone() : setStep(step + 1))}
        >
          {last ? 'Got it' : 'Next'}
        </button>
      </div>
    </div>
  )
}

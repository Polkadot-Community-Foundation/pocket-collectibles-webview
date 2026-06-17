// First-run persistence — webview-only (no native dependency).
//
// localStorage is the only "have they seen it" signal available without
// native help; the haptics-mute setting already relies on it persisting in
// this WebView target, so a first-run flag is the same proven mechanism.
// Wrapped in try/catch because some WebView configurations throw on storage
// access (private mode / disabled DOM storage) — in that case the intro
// simply shows again, which is harmless (it's skippable and non-blocking).

const INTRO_KEY = 'pkt_intro_v1'

export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return false
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, '1')
  } catch {
    /* storage unavailable — intro may reshow next session, which is fine */
  }
}

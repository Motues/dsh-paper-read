/**
 * Whether the relation guide opens by itself.
 *
 * Stored in localStorage because it is a per-browser reading habit, not library
 * data: it must survive restarts without touching the paper store, and it must
 * never make the host fail when storage is unavailable.
 */

const KEY = 'paperreader.relations.guide'

export type GuidePreference = 'on' | 'off'

export function readGuidePreference(): GuidePreference | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'on' || value === 'off' ? value : null
  } catch {
    return 'off'
  }
}

export function writeGuidePreference(value: GuidePreference): void {
  try {
    window.localStorage.setItem(KEY, value)
  } catch {
    /* private mode / storage disabled: the guide still works, just not remembered */
  }
}

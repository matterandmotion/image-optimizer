import type { Mode, QualityLevel, Role } from '../lib/plan'

export const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'responsive', label: 'Responsive set' },
  { value: 'master', label: 'CMS master' },
]

export const ROLES: readonly { value: Role; label: string }[] = [
  { value: 'hero', label: 'Hero' },
  { value: 'content', label: 'Content' },
  { value: 'card', label: 'Card' },
  { value: 'graphic', label: 'Graphic' },
]

export const QUALITIES: readonly { value: QualityLevel; label: string }[] = [
  { value: 'small', label: 'Lower' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'high', label: 'Higher' },
]

export const MASTER_WIDTHS = [1920, 2560, 3840].map((w) => ({ value: w, label: `${w} px` }))

/** Copies text, returning whether it worked (clipboard access can be refused). */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

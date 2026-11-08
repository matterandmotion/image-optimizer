import type { Mode, QualityLevel, Role } from '../lib/plan'
import type { Markup } from '../lib/snippet'

export const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'master', label: 'CMS master' },
  { value: 'responsive', label: 'Responsive set' },
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

export const MARKUPS: readonly { value: Markup; label: string }[] = [
  { value: 'html', label: 'HTML' },
  { value: 'jsx', label: 'JSX' },
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

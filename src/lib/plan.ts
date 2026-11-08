import type { VariantSpec } from '../engine/types'

/** What the image is for. Each role sets widths and formats. */
export type Role = 'hero' | 'content' | 'card' | 'graphic'

/**
 * `responsive`: several widths and formats plus markup, for hand-built sites.
 * `master`: one right-sized, high-quality file for a CMS or site builder that makes its own renditions.
 */
export type Mode = 'responsive' | 'master'

export type QualityLevel = 'small' | 'balanced' | 'high'

export interface PlanSettings {
  mode: Mode
  role: Role
  quality: QualityLevel
  /** Longest width for `master` mode. */
  masterWidth: number
}

export const DEFAULT_SETTINGS: PlanSettings = {
  mode: 'master',
  role: 'content',
  quality: 'balanced',
  masterWidth: 2560,
}

export const ROLE_WIDTHS: Record<Role, readonly number[]> = {
  hero: [640, 960, 1280, 1920, 2560],
  content: [400, 800, 1200, 1600],
  card: [400, 800],
  graphic: [800, 1600],
}

/** Encoder quality per level. Will be replaced by perceptual auto-quality in v0.2. */
export const QUALITY: Record<QualityLevel, { jpeg: number; webp: number; avif: number }> = {
  small: { jpeg: 70, webp: 70, avif: 45 },
  balanced: { jpeg: 80, webp: 80, avif: 58 },
  high: { jpeg: 88, webp: 88, avif: 70 },
}

/** Deliberately high: CMSs re-encode their renditions, so the master needs headroom. */
export const MASTER_QUALITY = { jpeg: 90 }

/**
 * Widths to produce for a source, never upscaling. If the source falls between two widths,
 * its own width is added, unless it is within 15% of the largest kept width.
 */
export function planWidths(sourceWidth: number, widths: readonly number[]): number[] {
  const sorted = [...new Set(widths)].sort((a, b) => a - b)
  const kept = sorted.filter((w) => w <= sourceWidth)
  if (kept.length === 0) return [sourceWidth]
  const top = kept[kept.length - 1]
  const largest = sorted[sorted.length - 1]
  if (sourceWidth < largest && (sourceWidth - top) / sourceWidth > 0.15) kept.push(sourceWidth)
  return kept
}

export function planVariants(
  source: { width: number; hasAlpha: boolean },
  s: PlanSettings,
): VariantSpec[] {
  if (s.mode === 'master') {
    const width = Math.min(source.width, s.masterWidth)
    // PNG keeps transparency and every CMS accepts it; photos go to high-quality JPEG.
    return source.hasAlpha || s.role === 'graphic'
      ? [{ width, format: 'png', quality: 100 }]
      : [{ width, format: 'jpeg', quality: MASTER_QUALITY.jpeg }]
  }

  const q = QUALITY[s.quality]
  return planWidths(source.width, ROLE_WIDTHS[s.role]).flatMap((width): VariantSpec[] => {
    if (s.role === 'graphic')
      return [
        { width, format: 'webp', quality: 100, lossless: true },
        { width, format: 'png', quality: 100 },
      ]
    // JPEG can't hold transparency, so transparent photos fall back to WebP.
    return [
      { width, format: 'avif', quality: q.avif },
      source.hasAlpha
        ? { width, format: 'webp', quality: q.webp }
        : { width, format: 'jpeg', quality: q.jpeg },
    ]
  })
}

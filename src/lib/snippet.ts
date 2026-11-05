import type { Format } from '../engine/types'
import type { Role } from './plan'

export interface SnippetOutput {
  name: string
  format: Format
  width: number
  height: number
}

const MIME: Record<Format, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/** Starting points for `sizes`; edit them to match the layout. */
export const SIZES: Record<Role, string> = {
  hero: '100vw',
  content: '(min-width: 800px) 800px, 100vw',
  card: '(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw',
  graphic: '(min-width: 800px) 800px, 100vw',
}

/** `''`, or the path with exactly one trailing slash. */
export function normalisePath(path: string): string {
  const trimmed = path.trim()
  return trimmed === '' ? '' : trimmed.replace(/\/*$/, '/')
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * `<picture>` markup for one image's responsive set. Formats appear in the order given
 * (preferred first); the last one becomes the `<img>` fallback.
 * Hero images load eagerly with high fetch priority; everything else is lazy, with
 * `sizes="auto, …"` so supporting browsers pick the width from the layout.
 */
export function pictureHtml(
  role: Role,
  outputs: SnippetOutput[],
  path = '/images/',
  alt = '',
): string {
  const base = normalisePath(path)
  const byFormat = new Map<Format, SnippetOutput[]>()
  for (const o of outputs) byFormat.set(o.format, [...(byFormat.get(o.format) ?? []), o])
  const formats = [...byFormat.keys()]
  const fallback = formats[formats.length - 1]
  const srcset = (f: Format) =>
    [...byFormat.get(f)!]
      .sort((a, b) => a.width - b.width)
      .map((o) => `${base}${o.name} ${o.width}w`)
      .join(', ')
  const largest = byFormat.get(fallback)!.reduce((a, b) => (b.width > a.width ? b : a))
  const eager = role === 'hero'
  const sizes = eager ? SIZES[role] : `auto, ${SIZES[role]}`
  const loading = eager
    ? 'fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"'

  const lines = ['<picture>']
  for (const f of formats.slice(0, -1))
    lines.push(`  <source type="${MIME[f]}" srcset="${srcset(f)}" sizes="${sizes}">`)
  lines.push(
    `  <img src="${base}${largest.name}" srcset="${srcset(fallback)}" sizes="${sizes}" width="${largest.width}" height="${largest.height}" alt="${escape(alt)}" ${loading}>`,
  )
  lines.push('</picture>')
  return lines.join('\n')
}

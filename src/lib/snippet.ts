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

/** HTML also covers Astro, Svelte and Vue templates; JSX is for React and Preact. */
export type Markup = 'html' | 'jsx'

const JSX_NAMES: Record<string, string> = { srcset: 'srcSet', fetchpriority: 'fetchPriority' }

/** Inline CSS, with camelCase property names (as in JSX). */
type Style = Record<string, string>

const kebab = (prop: string) => prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const jsString = (s: string) => `'${s.replace(/[\\']/g, '\\$&')}'`

function tag(markup: Markup, name: string, attrs: [string, string | number | Style][]): string {
  const parts = attrs.map(([key, value]) => {
    if (typeof value === 'object') {
      const entries = Object.entries(value)
      return markup === 'html'
        ? `${key}="${escape(entries.map(([k, v]) => `${kebab(k)}: ${v}`).join('; '))}"`
        : `${key}={{ ${entries.map(([k, v]) => `${k}: ${jsString(v)}`).join(', ')} }}`
    }
    if (markup === 'html') return `${key}="${escape(String(value))}"`
    const prop = JSX_NAMES[key] ?? key
    return typeof value === 'number' ? `${prop}={${value}}` : `${prop}="${escape(value)}"`
  })
  return `<${name} ${parts.join(' ')}${markup === 'jsx' ? ' />' : '>'}`
}

/** A comment in the given markup, e.g. to label each image in a combined snippet. */
export function comment(markup: Markup, text: string): string {
  return markup === 'jsx'
    ? `{/* ${text.replace(/\*\//g, '* /')} */}`
    : `<!-- ${text.replace(/--/g, '- -')} -->`
}

/**
 * `<picture>` markup for one image's responsive set. Formats appear in the order given
 * (preferred first); the last one becomes the `<img>` fallback.
 * Hero images load eagerly with high fetch priority; everything else is lazy, with
 * `sizes="auto, …"` so supporting browsers pick the width from the layout.
 */
export function pictureMarkup(
  role: Role,
  outputs: SnippetOutput[],
  {
    path = '/images/',
    alt = '',
    markup = 'html',
    background = null,
  }: {
    path?: string
    alt?: string
    markup?: Markup
    /** A colour to show until the image has loaded (an inline style). */
    background?: string | null
  } = {},
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
  const loading: [string, string][] = eager
    ? [
        ['fetchpriority', 'high'],
        ['decoding', 'async'],
      ]
    : [
        ['loading', 'lazy'],
        ['decoding', 'async'],
      ]

  const lines = ['<picture>']
  for (const f of formats.slice(0, -1))
    lines.push(
      '  ' +
        tag(markup, 'source', [
          ['type', MIME[f]],
          ['srcset', srcset(f)],
          ['sizes', sizes],
        ]),
    )
  lines.push(
    '  ' +
      tag(markup, 'img', [
        ['src', `${base}${largest.name}`],
        ['srcset', srcset(fallback)],
        ['sizes', sizes],
        ['width', largest.width],
        ['height', largest.height],
        ['alt', alt],
        ...loading,
        ...(background ? [['style', { backgroundColor: background }] as [string, Style]] : []),
      ]),
  )
  lines.push('</picture>')
  return lines.join('\n')
}

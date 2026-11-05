import type { Format } from '../engine/types'

export const EXTENSIONS: Record<Format, string> = {
  avif: 'avif',
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
}

/** URL-safe, lowercase base name: `IMG 4821 (Final).JPG` → `img-4821-final`. */
export function slugify(filename: string): string {
  const slug = filename
    .replace(/\.[^./]+$/, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'image'
}

/** Makes `base` unique within `taken` by appending -2, -3, …, and records it. */
export function uniqueBase(base: string, taken: Set<string>): string {
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`
  taken.add(name)
  return name
}

/** `hero-1600w.avif` for a responsive set; `hero.jpg` for a CMS master (`width` null). */
export function outputName(base: string, format: Format, width: number | null): string {
  return width === null
    ? `${base}.${EXTENSIONS[format]}`
    : `${base}-${width}w.${EXTENSIONS[format]}`
}

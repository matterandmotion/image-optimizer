import { describe, expect, it } from 'vitest'
import { formatBytes, formatList, formatSaved } from './format'
import { outputName, slugify, uniqueBase } from './naming'

describe('slugify', () => {
  it.each([
    ['IMG 4821 (Final).JPG', 'img-4821-final'],
    ['Café_Terrasse.jpeg', 'cafe-terrasse'],
    ['hero-mountains.jpg', 'hero-mountains'],
    ['--weird--.png', 'weird'],
    ['写真.png', 'image'],
    ['archive.tar.gz', 'archive-tar'],
  ])('%s → %s', (input, expected) => expect(slugify(input)).toBe(expected))
})

describe('uniqueBase', () => {
  it('appends a counter on collision', () => {
    const taken = new Set<string>()
    expect(['hero', 'hero', 'hero', 'logo'].map((b) => uniqueBase(b, taken))).toEqual([
      'hero',
      'hero-2',
      'hero-3',
      'logo',
    ])
  })
})

describe('outputName', () => {
  it('adds the width for responsive sets, not for a master', () => {
    expect(outputName('hero', 'avif', 1600)).toBe('hero-1600w.avif')
    expect(outputName('hero', 'jpeg', 800)).toBe('hero-800w.jpg')
    expect(outputName('hero', 'jpeg', null)).toBe('hero.jpg')
  })
})

describe('format', () => {
  it('formats bytes in decimal units', () => {
    expect([999, 4210, 148_400, 2_412_000].map(formatBytes)).toEqual([
      '999 B',
      '4.2 KB',
      '148 KB',
      '2.4 MB',
    ])
  })
  it('formats savings, negative when the output is larger', () => {
    expect(formatSaved(11_800_000, 612_000)).toBe('94.8%')
    expect(formatSaved(280_000, 335_000)).toBe('−19.6%')
    expect(formatSaved(0, 10)).toBe('—')
  })
  it('joins lists in prose', () => {
    expect(formatList([400, 800, 1200, 1600])).toBe('400, 800, 1200 and 1600')
    expect(formatList([800])).toBe('800')
  })
})

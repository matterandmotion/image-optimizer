import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, planVariants, planWidths, ROLE_WIDTHS } from './plan'

describe('planWidths', () => {
  const content = ROLE_WIDTHS.content // 400, 800, 1200, 1600

  it('keeps every width for large sources', () => {
    expect(planWidths(6000, content)).toEqual([400, 800, 1200, 1600])
  })

  it('never upscales', () => {
    expect(planWidths(1000, content)).toEqual([400, 800, 1000])
    expect(planWidths(300, content)).toEqual([300])
  })

  it('skips the source width when it is close to a kept width', () => {
    expect(planWidths(1300, content)).toEqual([400, 800, 1200]) // 1300 is within 15% of 1200
    expect(planWidths(1600, content)).toEqual([400, 800, 1200, 1600])
  })

  it('sorts and de-duplicates', () => {
    expect(planWidths(5000, [800, 400, 800])).toEqual([400, 800])
  })
})

describe('planVariants', () => {
  const photo = { width: 4000, hasAlpha: false }
  const responsive = { ...DEFAULT_SETTINGS, mode: 'responsive' } as const

  it('responsive photo: AVIF + JPEG at each width', () => {
    const v = planVariants(photo, responsive)
    expect(v.map((x) => `${x.width} ${x.format}`)).toEqual([
      '400 avif',
      '400 jpeg',
      '800 avif',
      '800 jpeg',
      '1200 avif',
      '1200 jpeg',
      '1600 avif',
      '1600 jpeg',
    ])
  })

  it('transparent photo falls back to WebP instead of JPEG', () => {
    const v = planVariants({ width: 1000, hasAlpha: true }, { ...responsive, role: 'card' })
    expect(v.map((x) => x.format)).toEqual(['avif', 'webp', 'avif', 'webp'])
  })

  it('graphics: lossless WebP + PNG', () => {
    const v = planVariants({ width: 2400, hasAlpha: true }, { ...responsive, role: 'graphic' })
    expect(v).toEqual([
      { width: 800, format: 'webp', quality: 100, lossless: true },
      { width: 800, format: 'png', quality: 100 },
      { width: 1600, format: 'webp', quality: 100, lossless: true },
      { width: 1600, format: 'png', quality: 100 },
    ])
  })

  it('master (the default): one high-quality JPEG capped at the master width', () => {
    expect(planVariants(photo, DEFAULT_SETTINGS)).toEqual([
      { width: 2560, format: 'jpeg', quality: 90 },
    ])
    expect(planVariants({ width: 1800, hasAlpha: false }, DEFAULT_SETTINGS)[0].width).toBe(1800)
  })

  it('master: PNG for transparency', () => {
    expect(planVariants({ width: 900, hasAlpha: true }, DEFAULT_SETTINGS)).toEqual([
      { width: 900, format: 'png', quality: 100 },
    ])
  })
})

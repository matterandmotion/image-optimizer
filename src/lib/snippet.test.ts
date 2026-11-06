import { describe, expect, it } from 'vitest'
import { manifest } from './manifest'
import { comment, normalisePath, pictureMarkup, type SnippetOutput } from './snippet'

const set = (
  base: string,
  widths: number[],
  formats: SnippetOutput['format'][],
  ratio = 2 / 3,
): SnippetOutput[] =>
  widths.flatMap((w) =>
    formats.map((format) => ({
      name: `${base}-${w}w.${format === 'jpeg' ? 'jpg' : format}`,
      format,
      width: w,
      height: Math.round(w * ratio),
    })),
  )

describe('pictureMarkup', () => {
  it('lazy content image: AVIF source, JPEG fallback, sizes=auto', () => {
    expect(pictureMarkup('content', set('hero', [400, 800], ['avif', 'jpeg']))).toBe(
      [
        '<picture>',
        '  <source type="image/avif" srcset="/images/hero-400w.avif 400w, /images/hero-800w.avif 800w" sizes="auto, (min-width: 800px) 800px, 100vw">',
        '  <img src="/images/hero-800w.jpg" srcset="/images/hero-400w.jpg 400w, /images/hero-800w.jpg 800w" sizes="auto, (min-width: 800px) 800px, 100vw" width="800" height="533" alt="" loading="lazy" decoding="async">',
        '</picture>',
      ].join('\n'),
    )
  })

  it('hero image loads eagerly with high priority', () => {
    const html = pictureMarkup('hero', set('h', [640, 1280], ['avif', 'jpeg']), {
      path: 'assets',
      alt: 'A "big" view',
    })
    expect(html).toContain('sizes="100vw"')
    expect(html).toContain('fetchpriority="high"')
    expect(html).not.toContain('loading="lazy"')
    expect(html).toContain('src="assets/h-1280w.jpg"')
    expect(html).toContain('alt="A &quot;big&quot; view"')
  })

  it('graphic: WebP source with PNG fallback', () => {
    const html = pictureMarkup('graphic', set('logo', [800, 1600], ['webp', 'png']), { path: '' })
    expect(html).toContain(
      '<source type="image/webp" srcset="logo-800w.webp 800w, logo-1600w.webp 1600w"',
    )
    expect(html).toContain('<img src="logo-1600w.png"')
  })

  it('JSX: camelCase props, numeric sizes, self-closing tags', () => {
    expect(
      pictureMarkup('content', set('hero', [400, 800], ['avif', 'jpeg']), { markup: 'jsx' }),
    ).toBe(
      [
        '<picture>',
        '  <source type="image/avif" srcSet="/images/hero-400w.avif 400w, /images/hero-800w.avif 800w" sizes="auto, (min-width: 800px) 800px, 100vw" />',
        '  <img src="/images/hero-800w.jpg" srcSet="/images/hero-400w.jpg 400w, /images/hero-800w.jpg 800w" sizes="auto, (min-width: 800px) 800px, 100vw" width={800} height={533} alt="" loading="lazy" decoding="async" />',
        '</picture>',
      ].join('\n'),
    )
    const hero = pictureMarkup('hero', set('h', [640], ['avif', 'jpeg']), { markup: 'jsx' })
    expect(hero).toContain('fetchPriority="high"')
    expect(hero).not.toContain('fetchpriority')
  })

  it('placeholder colour as an inline style, in either markup', () => {
    const outputs = set('a', [400], ['avif', 'jpeg'])
    expect(pictureMarkup('content', outputs, { background: '#847d8e' })).toContain(
      'decoding="async" style="background-color: #847d8e">',
    )
    expect(pictureMarkup('content', outputs, { background: '#847d8e', markup: 'jsx' })).toContain(
      `decoding="async" style={{ backgroundColor: '#847d8e' }} />`,
    )
    expect(pictureMarkup('content', outputs, { background: null })).not.toContain('style')
  })

  it('escapes attribute values', () => {
    const html = pictureMarkup('card', set('a', [400], ['avif', 'jpeg']), { path: '/x"&y/' })
    expect(html).toContain('src="/x&quot;&amp;y/a-400w.jpg"')
  })

  it('comments in either markup, without closing them early', () => {
    expect(comment('html', 'a--b.jpg')).toBe('<!-- a- -b.jpg -->')
    expect(comment('jsx', 'a*/b.jpg')).toBe('{/* a* /b.jpg */}')
  })

  it('normalises the path', () => {
    expect(['/images', '/images///', ' cdn/img/ ', ''].map(normalisePath)).toEqual([
      '/images/',
      '/images/',
      'cdn/img/',
      '',
    ])
  })
})

describe('manifest', () => {
  it('lists outputs and markup', () => {
    const outputs = set('hero', [400], ['avif', 'jpeg']).map((o) => ({ ...o, bytes: 1000 }))
    const json = JSON.parse(
      manifest('responsive', { path: '/img/', placeholder: true }, [
        {
          base: 'hero',
          role: 'content',
          source: { file: 'Hero.jpg', width: 400, height: 267, bytes: 50_000 },
          colour: '#847d8e',
          outputs,
        },
      ]),
    )
    expect(json.images[0].outputs).toEqual([
      { file: 'hero-400w.avif', format: 'avif', width: 400, height: 267, bytes: 1000 },
      { file: 'hero-400w.jpg', format: 'jpeg', width: 400, height: 267, bytes: 1000 },
    ])
    expect(json.images[0].html).toContain('/img/hero-400w.avif 400w')
    expect(json.images[0].color).toBe('#847d8e')
    expect(json.images[0].html).toContain('style="background-color: #847d8e"')
  })

  it('leaves markup out for CMS masters', () => {
    const json = JSON.parse(
      manifest('master', { path: '/img/', placeholder: false }, [
        {
          base: 'hero',
          role: 'content',
          source: { file: 'Hero.jpg', width: 3000, height: 2000, bytes: 9e6 },
          colour: null,
          outputs: [],
        },
      ]),
    )
    expect(json.images[0].html).toBeUndefined()
  })
})

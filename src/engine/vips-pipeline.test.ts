import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import encodeAvif, { init as initAvif } from '@jsquash/avif/encode.js'
import Vips from 'wasm-vips'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AvifEncoder, VariantSpec } from './types'
import { chooseShrink, probe, processImage, rgbaToPng } from './vips-pipeline'

// Test images are made with libvips' built-in profiles, so no binary fixtures are needed.

let vips: typeof Vips
const avif: AvifEncoder = (img, quality) =>
  encodeAvif(img as unknown as ImageData, { quality, speed: 8 })

beforeAll(async () => {
  vips = await Vips({ dynamicLibraries: ['vips-heif.wasm'] })
  // Node gets jSquash's single-threaded build; it needs the compiled module passed in.
  const wasm = readFileSync(
    createRequire(import.meta.url).resolve('@jsquash/avif/codec/enc/avif_enc.wasm'),
  )
  await initAvif(await WebAssembly.compile(wasm))
}, 60_000)

type Rgb = [number, number, number]
const PATCHES: Rgb[] = [
  [200, 40, 50],
  [40, 160, 70],
  [60, 90, 200],
  [230, 190, 150],
  [128, 128, 128],
  [120, 180, 230],
]

/** Six flat colour patches side by side. */
function patches(width = 192, height = 64) {
  const data = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data.set(PATCHES[Math.floor((x * PATCHES.length) / width)], (y * width + x) * 3)
  return vips.Image.newFromMemory(data, width, height, 3, vips.BandFormat.uchar).copy({
    interpretation: 'srgb',
  })
}

function decode(bytes: Uint8Array) {
  const im = vips.Image.newFromBuffer(bytes)
  return { im, px: im.writeToMemory() as Uint8Array }
}

/** Mean colour of the centre of each patch. */
function patchMeans(px: Uint8Array, width: number, height: number, bands: number): Rgb[] {
  return PATCHES.map((_, i) => {
    const x0 = Math.floor(((i + 0.25) * width) / PATCHES.length)
    const x1 = Math.floor(((i + 0.75) * width) / PATCHES.length)
    const sum = [0, 0, 0]
    let n = 0
    for (let y = Math.floor(height / 4); y < (3 * height) / 4; y++)
      for (let x = x0; x < x1; x++, n++)
        for (let c = 0; c < 3; c++) sum[c] += px[(y * width + x) * bands + c]
    return sum.map((s) => s / n) as Rgb
  })
}

const maxError = (a: Rgb[], b: Rgb[]) =>
  Math.max(...a.flatMap((p, i) => p.map((v, c) => Math.abs(v - b[i][c]))))

async function one(buf: Uint8Array, spec: VariantSpec) {
  const [out] = await processImage(vips, avif, buf, [spec])
  return out
}

describe('colour management', () => {
  it('converts Display P3 to sRGB before stripping the profile', async () => {
    const p3 = patches().iccTransform('p3', { input_profile: 'srgb', intent: 'relative' })
    const buf = p3.writeToBuffer('.jpg', { Q: 98, subsample_mode: 'off' })
    const rawP3 = patchMeans(p3.cast('uchar').writeToMemory() as Uint8Array, 192, 64, 3)
    expect(maxError(rawP3, PATCHES)).toBeGreaterThan(10) // the input really is P3

    const out = await one(buf, { width: 96, format: 'jpeg', quality: 95 })
    const { im, px } = decode(out.bytes)
    expect(maxError(patchMeans(px, im.width, im.height, im.bands), PATCHES)).toBeLessThan(4)
  })

  it('converts CMYK with its embedded profile', async () => {
    const cmyk = patches().iccTransform('cmyk', { input_profile: 'srgb', intent: 'relative' })
    const buf = cmyk.writeToBuffer('.jpg', { Q: 98 })
    expect(probe(vips, buf).interpretation).toBe('cmyk')
    // what a colour-managed viewer shows for this file (CMYK gamut is smaller than sRGB)
    const viewer = vips.Image.newFromBuffer(buf).iccTransform('srgb', {
      embedded: true,
      intent: 'relative',
    })
    const expected = patchMeans(viewer.writeToMemory() as Uint8Array, 192, 64, 3)

    const out = await one(buf, { width: 96, format: 'jpeg', quality: 95 })
    const { im, px } = decode(out.bytes)
    expect(im.bands).toBe(3)
    expect(maxError(patchMeans(px, im.width, im.height, im.bands), expected)).toBeLessThan(4)
  })

  it('reads 16-bit PNG into 8-bit sRGB', async () => {
    const deep = patches().linear(257, 0).cast('ushort').copy({ interpretation: 'rgb16' })
    const buf = deep.writeToBuffer('.png', { bitdepth: 16 })
    expect(probe(vips, buf).interpretation).toBe('rgb16')
    const out = await one(buf, { width: 192, format: 'png', quality: 100 })
    const { im, px } = decode(out.bytes)
    expect(im.format).toBe('uchar')
    expect(maxError(patchMeans(px, im.width, im.height, im.bands), PATCHES)).toBeLessThan(1)
  })
})

describe('orientation and metadata', () => {
  /** Displayed image: red left half, blue right half. */
  function halves(width = 120, height = 60) {
    const data = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++)
      data.set(i % width < width / 2 ? [220, 0, 0] : [0, 0, 220], i * 3)
    return vips.Image.newFromMemory(data, width, height, 3, vips.BandFormat.uchar).copy({
      interpretation: 'srgb',
    })
  }

  it('applies EXIF orientation', async () => {
    const stored = halves().rot('d270').copy() // pixels stored rotated 90° counter-clockwise
    stored.setInt('orientation', 6) // "rotate 90° clockwise to display"
    const buf = stored.writeToBuffer('.jpg', { Q: 95 })
    expect(probe(vips, buf)).toMatchObject({ width: 120, height: 60, orientation: 6 })

    const out = await one(buf, { width: 120, format: 'png', quality: 100 })
    expect([out.width, out.height]).toEqual([120, 60])
    const { px } = decode(out.bytes)
    const at = (x: number, y: number) =>
      Array.from(px.subarray((y * 120 + x) * 3, (y * 120 + x) * 3 + 3))
    expect(at(10, 30)[0]).toBeGreaterThan(180) // red on the left
    expect(at(110, 30)[2]).toBeGreaterThan(180) // blue on the right
  })

  it('strips EXIF, ICC and XMP from every format', async () => {
    const tagged = patches().iccTransform('p3', { input_profile: 'srgb' }).copy()
    tagged.setInt('orientation', 1) // makes libvips write an EXIF block
    const buf = tagged.writeToBuffer('.jpg', { Q: 95 })
    const src = vips.Image.newFromBuffer(buf)
    expect(src.getTypeof('exif-data')).not.toBe(0)
    expect(src.getTypeof('icc-profile-data')).not.toBe(0)

    const outs = await processImage(vips, avif, buf, [
      { width: 96, format: 'jpeg', quality: 80 },
      { width: 96, format: 'webp', quality: 80 },
      { width: 96, format: 'png', quality: 100 },
      { width: 96, format: 'avif', quality: 60 },
    ])
    for (const o of outs) {
      const im = vips.Image.newFromBuffer(o.bytes)
      for (const field of ['exif-data', 'icc-profile-data', 'xmp-data'])
        expect(im.getTypeof(field), `${o.spec.format} ${field}`).toBe(0)
    }
  })
})

describe('transparency', () => {
  it('keeps alpha in WebP, PNG and AVIF', async () => {
    const w = 64
    const h = 32
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++)
      data.set(i % w < w / 2 ? [0, 0, 0, 0] : [220, 20, 20, 255], i * 4)
    const buf = vips.Image.newFromMemory(data, w, h, 4, vips.BandFormat.uchar)
      .copy({ interpretation: 'srgb' })
      .writeToBuffer('.png')
    expect(probe(vips, buf).hasAlpha).toBe(true)

    const outs = await processImage(vips, avif, buf, [
      { width: w, format: 'webp', quality: 100, lossless: true },
      { width: w, format: 'png', quality: 100 },
      { width: w, format: 'avif', quality: 80 },
    ])
    for (const o of outs) {
      const { im, px } = decode(o.bytes)
      expect(im.bands, o.spec.format).toBe(4)
      expect(px[(16 * w + 4) * 4 + 3], `${o.spec.format} transparent`).toBeLessThan(5)
      expect(px[(16 * w + 60) * 4 + 3], `${o.spec.format} opaque`).toBeGreaterThan(250)
      expect(px[(16 * w + 60) * 4], `${o.spec.format} red`).toBeGreaterThan(200)
    }
  })

  it('flattens onto white for JPEG', async () => {
    const data = new Uint8Array(8 * 8 * 4) // fully transparent
    const buf = vips.Image.newFromMemory(data, 8, 8, 4, vips.BandFormat.uchar)
      .copy({ interpretation: 'srgb' })
      .writeToBuffer('.png')
    const { im, px } = decode((await one(buf, { width: 8, format: 'jpeg', quality: 90 })).bytes)
    expect(im.bands).toBe(3)
    expect(px[0]).toBeGreaterThan(250)
  })
})

describe('sizing', () => {
  it('chooses shrink-on-load that leaves at least 2× for lanczos3', () => {
    expect(chooseShrink(9254, 1600)).toBe(2)
    expect(chooseShrink(9254, 400)).toBe(8)
    expect(chooseShrink(4000, 1000)).toBe(2)
    expect(chooseShrink(1000, 800)).toBe(1)
  })

  it('resizes to the target width with uniform scale', async () => {
    const buf = patches(2000, 400).writeToBuffer('.jpg', { Q: 90 })
    const out = await one(buf, { width: 250, format: 'jpeg', quality: 80 })
    expect([out.width, out.height]).toEqual([250, 50])
  })

  it('never upscales', async () => {
    const buf = patches(300, 100).writeToBuffer('.png')
    const out = await one(buf, { width: 1600, format: 'webp', quality: 80 })
    expect([out.width, out.height]).toEqual([300, 100])
  })

  it('renders each width once and returns variants in request order', async () => {
    const buf = patches(800, 200).writeToBuffer('.jpg', { Q: 90 })
    const outs = await processImage(vips, avif, buf, [
      { width: 400, format: 'avif', quality: 50 },
      { width: 400, format: 'jpeg', quality: 80 },
      { width: 200, format: 'jpeg', quality: 80 },
    ])
    expect(outs.map((o) => `${o.width}x${o.height} ${o.spec.format}`)).toEqual([
      '400x100 avif',
      '400x100 jpeg',
      '200x50 jpeg',
    ])
  })
})

it('is deterministic', async () => {
  const buf = patches(640, 200).writeToBuffer('.jpg', { Q: 90 })
  const specs: VariantSpec[] = [
    { width: 320, format: 'jpeg', quality: 80 },
    { width: 320, format: 'avif', quality: 55 },
  ]
  const [a, b] = [
    await processImage(vips, avif, buf, specs),
    await processImage(vips, avif, buf, specs),
  ]
  expect(a.map((o) => Buffer.from(o.bytes).toString('base64'))).toEqual(
    b.map((o) => Buffer.from(o.bytes).toString('base64')),
  )
})

describe('rgbaToPng', () => {
  const rgba = (alpha: number) => {
    const px = new Uint8Array(4 * 4 * 4)
    for (let i = 0; i < px.length; i += 4) px.set([200, 100, 50, 255], i)
    px[px.length - 1] = alpha
    return px
  }

  it('drops the alpha band when every pixel is opaque', () => {
    const png = vips.Image.newFromBuffer(rgbaToPng(vips, rgba(255), 4, 4))
    expect([png.width, png.height, png.bands, png.hasAlpha()]).toEqual([4, 4, 3, false])
    expect([...(png.writeToMemory() as Uint8Array).slice(0, 3)]).toEqual([200, 100, 50])
  })

  it('keeps it when any pixel is transparent', () => {
    const png = vips.Image.newFromBuffer(rgbaToPng(vips, rgba(0), 4, 4))
    expect([png.bands, png.hasAlpha()]).toEqual([4, true])
  })
})

describe('classify', () => {
  it('tells flat graphics from photos', () => {
    expect(probe(vips, patches(600, 200).writeToBuffer('.png')).kind).toBe('graphic')

    const w = 300
    const h = 200
    const noise = new Uint8Array(w * h * 3)
    let seed = 7
    for (let i = 0; i < noise.length; i++)
      noise[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24
    const photoLike = vips.Image.newFromMemory(noise, w, h, 3, vips.BandFormat.uchar).copy({
      interpretation: 'srgb',
    })
    expect(probe(vips, photoLike.writeToBuffer('.png')).kind).toBe('photo')
  })

  it('treats JPEG as a photo', () => {
    expect(probe(vips, patches().writeToBuffer('.jpg', { Q: 90 })).kind).toBe('photo')
  })
})

describe('average colour', () => {
  // The mean of the six patches, rounded.
  const mean = [0, 1, 2].map((c) =>
    Math.round(PATCHES.reduce((sum, p) => sum + p[c], 0) / PATCHES.length),
  )

  it('averages in sRGB, for PNG and (shrunk on load) JPEG', () => {
    for (const buf of [
      patches(600, 200).writeToBuffer('.png'),
      patches(1920, 640).writeToBuffer('.jpg', { Q: 95 }),
    ]) {
      const colour = probe(vips, buf).colour!
      const rgb = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16))
      rgb.forEach((v, i) => expect(Math.abs(v - mean[i])).toBeLessThanOrEqual(2))
    }
  })

  it('converts the colour profile first', () => {
    // sRGB red stored with a Display P3 profile: the raw numbers are about (234, 51, 35)
    const red = vips.Image.black(64, 64)
      .add([255, 0, 0])
      .cast('uchar')
      .copy({ interpretation: 'srgb' })
    const p3 = red.iccTransform('p3', { input_profile: 'srgb' })
    expect(probe(vips, p3.writeToBuffer('.png')).colour).toBe('#ff0000')
  })

  it('is null for images with transparency', () => {
    expect(probe(vips, patches().bandjoin(128).writeToBuffer('.png')).colour).toBeNull()
  })
})

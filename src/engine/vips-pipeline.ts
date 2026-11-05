import type Vips from 'wasm-vips'
import type { AvifEncoder, EncodedVariant, RgbaImage, SourceInfo, VariantSpec } from './types'

// Environment-agnostic: takes an initialised wasm-vips module, so the same code runs in the
// engine worker and in Node tests.

type VipsModule = typeof Vips
type Image = Vips.Image

/** EXIF orientations 5–8 swap width and height. */
const SWAPS_AXES = new Set([5, 6, 7, 8])

/** Same mozjpeg tuning sharp uses for `mozjpeg: true`. */
const JPEG = {
  optimize_coding: true,
  interlace: true,
  trellis_quant: true,
  overshoot_deringing: true,
  optimize_scans: true,
  quant_table: 3,
  keep: 'none',
}

/** Reads the header, then classifies the content (decoding a small sample, except for JPEG). */
export function probe(vips: VipsModule, buf: Uint8Array): SourceInfo {
  const im = vips.Image.newFromBuffer(buf, '', { access: 'sequential' })
  let header: Omit<SourceInfo, 'kind'>
  try {
    const orientation = im.getTypeof('orientation') ? im.getInt('orientation') : 1
    const swap = SWAPS_AXES.has(orientation)
    header = {
      width: swap ? im.height : im.width,
      height: swap ? im.width : im.height,
      hasAlpha: im.hasAlpha(),
      loader: im.getString('vips-loader'),
      interpretation: im.interpretation,
      hasProfile: im.getTypeof('icc-profile-data') !== 0,
      orientation,
    }
  } finally {
    im.delete()
  }
  return { ...header, kind: header.loader.startsWith('jpegload') ? 'photo' : classify(vips, buf) }
}

/**
 * Photo or flat-colour graphic, from a nearest-neighbour sample (no blending, so flat areas
 * stay flat). Photos measured 40–72% unique colours and <10% identical neighbours; graphics
 * and UI screenshots measured <2% and >90%.
 */
export function classify(vips: VipsModule, buf: Uint8Array): 'photo' | 'graphic' {
  let im = vips.Image.newFromBuffer(buf, '', { access: 'sequential' })
  if (im.width > 256) im = step(im, im.resize(256 / im.width, { kernel: 'nearest' }))
  if (im.format !== 'uchar') im = step(im, im.colourspace('srgb'))
  if (im.format !== 'uchar') im = step(im, im.cast('uchar'))
  try {
    const px = im.writeToMemory() as Uint8Array
    const { width, height, bands } = im
    const colour = (i: number) =>
      bands >= 3 ? (px[i] << 16) | (px[i + 1] << 8) | px[i + 2] : px[i]
    const colours = new Set<number>()
    let same = 0
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * bands
        const c = colour(i)
        colours.add(c)
        if (x > 0 && c === colour(i - bands)) same++
      }
    const flat = same / Math.max(1, (width - 1) * height)
    const unique = colours.size / (width * height)
    return flat > 0.5 || unique < 0.05 ? 'graphic' : 'photo'
  } finally {
    im.delete()
  }
}

/**
 * Shrink-on-load factor for JPEG/WebP: the largest power of two that still leaves at least
 * 2× of the reduction to lanczos3. Shrinking further on load visibly softens fine detail.
 */
export function chooseShrink(sourceWidth: number, targetWidth: number): number {
  let shrink = 1
  while (shrink < 8 && Math.floor(sourceWidth / (shrink * 2)) >= 2 * targetWidth) shrink *= 2
  return shrink
}

/** Unrefs `prev` once `next` (which holds its own reference) replaces it. */
function step(prev: Image, next: Image): Image {
  if (next !== prev) prev.delete()
  return next
}

/**
 * Converts to 8-bit sRGB. Any embedded profile is applied, not just CMYK, so Display P3 photos
 * don't come out washed out once metadata is stripped.
 */
function toSrgb(im: Image): Image {
  const cmyk = im.interpretation === 'cmyk'
  if (cmyk || im.getTypeof('icc-profile-data') !== 0) {
    return step(
      im,
      im.iccTransform('srgb', {
        embedded: true,
        input_profile: cmyk ? 'cmyk' : 'srgb',
        intent: 'relative',
        depth: 8,
      }),
    )
  }
  if (im.interpretation !== 'srgb') im = step(im, im.colourspace('srgb'))
  if (im.format !== 'uchar') im = step(im, im.cast('uchar'))
  return im
}

function resizeBy(im: Image, scale: number): Image {
  if (!im.hasAlpha()) return step(im, im.resize(scale, { kernel: 'lanczos3' }))
  im = step(im, im.premultiply())
  im = step(im, im.resize(scale, { kernel: 'lanczos3' }))
  im = step(im, im.unpremultiply())
  return step(im, im.cast('uchar'))
}

/**
 * Decodes, converts to sRGB, resizes and orients the source for one target width.
 * Streams the decode and only materialises the resized result, so very large sources
 * never sit fully decoded in WASM memory.
 */
export function render(
  vips: VipsModule,
  buf: Uint8Array,
  info: SourceInfo,
  targetWidth: number,
): Image {
  const width = Math.min(targetWidth, info.width)
  const shrink =
    info.loader.startsWith('jpegload') || info.loader.startsWith('webpload')
      ? chooseShrink(info.width, width)
      : 1
  const loadOptions =
    shrink === 1
      ? ''
      : info.loader.startsWith('jpegload')
        ? `[shrink=${shrink}]`
        : `[scale=${1 / shrink}]`
  let im = vips.Image.newFromBuffer(buf, loadOptions, { access: 'sequential' })
  im = toSrgb(im)
  // Resize the stored (unrotated) image by the scale that gives the displayed target width,
  // then rotate the small result.
  const displayedWidth = SWAPS_AXES.has(info.orientation) ? im.height : im.width
  if (width < displayedWidth) im = resizeBy(im, width / displayedWidth)
  im = step(im, im.copyMemory())
  if (info.orientation !== 1) im = step(im, im.autorot())
  return im
}

export function encodeWithVips(im: Image, spec: VariantSpec): Uint8Array {
  switch (spec.format) {
    case 'jpeg': {
      if (!im.hasAlpha()) return im.writeToBuffer('.jpg', { Q: spec.quality, ...JPEG })
      const flat = im.flatten({ background: [255, 255, 255] })
      try {
        return flat.writeToBuffer('.jpg', { Q: spec.quality, ...JPEG })
      } finally {
        flat.delete()
      }
    }
    case 'webp':
      return im.writeToBuffer(
        '.webp',
        spec.lossless
          ? { lossless: true, effort: 4, keep: 'none' }
          : { Q: spec.quality, effort: 4, smart_subsample: true, keep: 'none' },
      )
    case 'png':
      return im.writeToBuffer(
        '.png',
        spec.palette
          ? { palette: true, Q: spec.quality, effort: 7, compression: 9, keep: 'none' }
          : { compression: 9, keep: 'none' },
      )
    case 'avif':
      throw new Error('AVIF is encoded by the AvifEncoder, not libvips')
  }
}

/** 8-bit RGBA copy of the pixels, for the AVIF encoder. */
export function toRgba(im: Image): RgbaImage {
  const rgba = im.hasAlpha() ? im : im.bandjoin(255)
  try {
    const mem = rgba.writeToMemory() as Uint8Array
    // writeToMemory may return a view into the WASM heap; copy before the heap can move.
    const data = new Uint8ClampedArray(mem.byteLength)
    data.set(mem)
    return { data, width: rgba.width, height: rgba.height }
  } finally {
    if (rgba !== im) rgba.delete()
  }
}

/** Renders each distinct width once, then encodes every requested format from it. */
export async function processImage(
  vips: VipsModule,
  encodeAvif: AvifEncoder,
  buf: Uint8Array,
  specs: VariantSpec[],
  onVariant?: (done: number, total: number) => void,
): Promise<EncodedVariant[]> {
  const info = probe(vips, buf)
  const byWidth = new Map<number, VariantSpec[]>()
  for (const s of specs) byWidth.set(s.width, [...(byWidth.get(s.width) ?? []), s])
  const out: EncodedVariant[] = []
  for (const [width, group] of byWidth) {
    const im = render(vips, buf, info, width)
    try {
      for (const spec of group) {
        const t0 = performance.now()
        const bytes =
          spec.format === 'avif'
            ? new Uint8Array(await encodeAvif(toRgba(im), spec.quality))
            : encodeWithVips(im, spec)
        out.push({ spec, width: im.width, height: im.height, bytes, ms: performance.now() - t0 })
        onVariant?.(out.length, specs.length)
      }
    } finally {
      im.delete()
    }
  }
  return out
}

/**
 * A lossless PNG from 8-bit RGBA pixels (e.g. from a canvas). The alpha band is dropped when
 * every pixel is opaque, so photos aren't treated as transparent images.
 */
export function rgbaToPng(vips: VipsModule, rgba: Uint8Array, width: number, height: number) {
  let opaque = true
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i] !== 255) {
      opaque = false
      break
    }
  let im = vips.Image.newFromMemory(rgba, width, height, 4, vips.BandFormat.uchar)
  im = step(im, im.copy({ interpretation: 'srgb' }))
  if (opaque) im = step(im, im.extractBand(0, { n: 3 }))
  try {
    // Fast compression: this is an intermediate file, never an output.
    return im.writeToBuffer('.png', { compression: 1 }) as Uint8Array
  } finally {
    im.delete()
  }
}

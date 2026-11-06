export type Format = 'avif' | 'webp' | 'jpeg' | 'png'

/** One output file to produce from a source image. */
export interface VariantSpec {
  /** Target width in px. Sources narrower than this are never upscaled. */
  width: number
  format: Format
  /** 1–100. Ignored for lossless output. */
  quality: number
  /** WebP only. */
  lossless?: boolean
  /** PNG only: quantise to a palette (lossy, much smaller for flat graphics). Otherwise PNG is lossless. */
  palette?: boolean
}

export interface SourceInfo {
  /** Displayed size, after EXIF orientation. */
  width: number
  height: number
  hasAlpha: boolean
  /** libvips loader, e.g. `jpegload_buffer`. */
  loader: string
  /** libvips interpretation, e.g. `srgb`, `cmyk`, `b-w`, `rgb16`. */
  interpretation: string
  hasProfile: boolean
  /** EXIF orientation, 1–8. */
  orientation: number
  /** Flat-colour graphics (logos, illustrations, screenshots) suit lossless formats. */
  kind: 'photo' | 'graphic'
  /** Average colour (`#rrggbb`), to show while the image loads; null if it has transparency. */
  colour: string | null
}

export interface EncodedVariant {
  spec: VariantSpec
  width: number
  height: number
  bytes: Uint8Array
  ms: number
}

export interface RgbaImage {
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

/** AVIF encoding is delegated (jSquash's multi-threaded encoder in the browser). */
export type AvifEncoder = (image: RgbaImage, quality: number) => Promise<ArrayBuffer>

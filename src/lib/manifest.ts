import type { Mode, Role } from './plan'
import { pictureMarkup, SIZES, type SnippetOutput } from './snippet'

export interface ManifestImage {
  base: string
  role: Role
  source: { file: string; width: number; height: number; bytes: number }
  outputs: (SnippetOutput & { bytes: number })[]
}

export const MANIFEST = 'manifest.json'
/** Identifies a manifest.json written by this tool. */
export const GENERATOR = 'image-optimizer'

/** `manifest.json` for the ZIP: every output with its size, plus the markup for responsive sets. */
export function manifest(mode: Mode, path: string, images: ManifestImage[]): string {
  return JSON.stringify(
    {
      generator: GENERATOR,
      mode,
      images: images.map((img) => ({
        name: img.base,
        role: img.role,
        source: img.source,
        ...(mode === 'responsive' && {
          sizes: SIZES[img.role],
          html: pictureMarkup(img.role, img.outputs, { path }),
        }),
        outputs: img.outputs.map(({ name, format, width, height, bytes }) => ({
          file: name,
          format,
          width,
          height,
          bytes,
        })),
      })),
    },
    null,
    2,
  )
}

import type { Mode, Role } from './plan'
import { pictureHtml, SIZES, type SnippetOutput } from './snippet'

export interface ManifestImage {
  base: string
  role: Role
  source: { file: string; width: number; height: number; bytes: number }
  outputs: (SnippetOutput & { bytes: number })[]
}

/** `manifest.json` for the ZIP: every output with its size, plus the markup for responsive sets. */
export function manifest(mode: Mode, path: string, images: ManifestImage[]): string {
  return JSON.stringify(
    {
      generator: 'image-optimizer',
      mode,
      images: images.map((img) => ({
        name: img.base,
        role: img.role,
        source: img.source,
        ...(mode === 'responsive' && {
          sizes: SIZES[img.role],
          html: pictureHtml(img.role, img.outputs, path),
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

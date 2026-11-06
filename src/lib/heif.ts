/** HEIF brands for HEVC-coded images: what iPhones (and some Android phones) save as HEIC. */
const HEVC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'])
/** AVIF is HEIF too, but AV1-coded, and libvips reads it. */
const AV1_BRANDS = new Set(['avif', 'avis'])

/** How many bytes of a file `isHevcHeif` needs: enough for any real `ftyp` box. */
export const HEIF_HEAD_BYTES = 256

/**
 * Whether a file's first bytes (its ISO BMFF `ftyp` box) mark it as HEVC-coded HEIF. libvips
 * here recognises those files but has no HEVC decoder; Safari can decode them.
 */
export function isHevcHeif(head: Uint8Array): boolean {
  const fourcc = (at: number) => String.fromCharCode(...head.subarray(at, at + 4))
  if (head.length < 16 || fourcc(4) !== 'ftyp') return false
  // size, 'ftyp', major brand, minor version, then compatible brands to the end of the box
  const size = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0)
  const end = Math.min(size, head.length)
  const brands = [fourcc(8)]
  for (let at = 16; at + 4 <= end; at += 4) brands.push(fourcc(at))
  return brands.some((b) => HEVC_BRANDS.has(b)) && !brands.some((b) => AV1_BRANDS.has(b))
}

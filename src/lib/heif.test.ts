import { describe, expect, it } from 'vitest'
import { isHevcHeif } from './heif'

/** An `ftyp` box (minor version 0), followed by the start of the next box. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const brands = [major, '\0\0\0\0', ...compatible]
  const size = 8 + brands.length * 4
  const out = new Uint8Array(size + 8)
  new DataView(out.buffer).setUint32(0, size)
  const ascii = new TextEncoder()
  out.set(ascii.encode('ftyp'), 4)
  brands.forEach((brand, i) => out.set(ascii.encode(brand), 8 + i * 4))
  out.set(ascii.encode('meta'), size + 4)
  return out
}

describe('isHevcHeif', () => {
  it('spots HEIC by its major brand', () => {
    expect(isHevcHeif(ftyp('heic', 'mif1', 'heic'))).toBe(true)
  })

  it('spots HEIC listed only as a compatible brand', () => {
    // As in libheif's example.heic: major brand mif1, compatible mif1 heic hevc.
    expect(isHevcHeif(ftyp('mif1', 'mif1', 'heic', 'hevc'))).toBe(true)
  })

  it('leaves AVIF to libvips', () => {
    expect(isHevcHeif(ftyp('avif', 'avif', 'mif1', 'miaf'))).toBe(false)
    expect(isHevcHeif(ftyp('mif1', 'mif1', 'avif', 'heic'))).toBe(false)
  })

  it('only reads brands inside the ftyp box', () => {
    // 'heic' right after the box, where the next box's size goes
    const head = ftyp('mif1', 'mif1')
    head.set(new TextEncoder().encode('heic'), head.length - 8)
    expect(isHevcHeif(head)).toBe(false)
  })

  it('ignores other files and short reads', () => {
    expect(
      isHevcHeif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1])),
    ).toBe(false)
    expect(isHevcHeif(ftyp('heic').subarray(0, 12))).toBe(false)
    expect(isHevcHeif(new Uint8Array())).toBe(false)
  })
})

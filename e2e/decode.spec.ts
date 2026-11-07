import { expect, test } from '@playwright/test'

/** A 24-bit BMP: a format libvips can't read but every browser can. */
function bmp(width: number, height: number): Buffer {
  const row = Math.ceil((width * 3) / 4) * 4
  const out = Buffer.alloc(54 + row * height)
  out.write('BM', 0)
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(row * height, 34)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = 54 + (height - 1 - y) * row + x * 3 // bottom-up rows, BGR
      out[o] = (x * 7 + y * 3) % 256
      out[o + 1] = Math.round((y / height) * 255)
      out[o + 2] = Math.round((x / width) * 255)
    }
  return out
}

test('falls back to the browser for formats libvips can’t read', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'scan.bmp',
    mimeType: 'image/bmp',
    buffer: bmp(1000, 600),
  })
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('1000 × 600')).toBeVisible()
  await page.getByRole('button', { name: 'scan.bmp', exact: true }).click()
  // Opaque, so a JPEG master, not a PNG.
  await expect(page.getByText('scan.jpg', { exact: true })).toBeVisible()
})

test('says when the browser can’t open a HEIC either, in full on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'IMG_0001.HEIC',
    mimeType: 'image/heic',
    buffer: Buffer.from('not really a HEIC file'),
  })
  const message = page.getByText(
    'This browser can’t open HEIC. Convert it to JPEG first, or use Safari.',
  )
  await expect(message).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('cell', { name: 'Failed' })).toBeVisible()
  // Not cut off: the whole message fits its box.
  expect(await message.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
})

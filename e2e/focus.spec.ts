import { expect, test } from '@playwright/test'

test('every control shows a focus ring when tabbed to', async ({ page }) => {
  await page.goto('/')
  const jpeg = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(900, 600)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c33'
    ctx.fillRect(0, 0, 900, 600)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' })
    return [...new Uint8Array(await blob.arrayBuffer())]
  })
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(jpeg),
  })
  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'photo.jpg', exact: true }).click()
  await page.locator('h1').click()

  const missing: string[] = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      // Some controls draw the ring on their label (focus-within).
      const ring = (e: Element | null) => {
        if (!e) return false
        const s = getComputedStyle(e)
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
      }
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName
      return {
        name: `${el.tagName.toLowerCase()} ${name}`.slice(0, 60),
        ring: ring(el) || ring(el.closest('label')),
      }
    })
    if (!focused) break
    if (!focused.ring) missing.push(focused.name)
  }
  expect(missing).toEqual([])
})

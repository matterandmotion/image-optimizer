import { expect, test, type Page } from '@playwright/test'

/** A JPEG drawn in the page, so the repo needs no binary fixtures. */
async function makeJpeg(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')!
      const gradient = ctx.createLinearGradient(0, 0, w, h)
      gradient.addColorStop(0, '#c33')
      gradient.addColorStop(1, '#36c')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, w, h)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
      let s = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(byte)
      return btoa(s)
    },
    [width, height],
  )
  return Buffer.from(base64, 'base64')
}

/** A flat-colour PNG (a "graphic"), drawn in the page. */
async function makePng(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#2563eb'
      ctx.fillRect(w / 4, h / 4, w / 2, h / 2)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      let s = ''
      for (const byte of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(byte)
      return btoa(s)
    },
    [width, height],
  )
  return Buffer.from(base64, 'base64')
}

test('makes a responsive set, a ZIP and a CMS master', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto('/')
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  await page.locator('input[type=file]').setInputFiles({
    name: 'Hero Shot.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeJpeg(page, 1000, 600),
  })

  // Content role, 1000 px source: 400, 800 and 1000 px, as AVIF + JPEG
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Hero Shot.jpg', exact: true }).click()
  for (const width of [400, 800, 1000])
    for (const ext of ['avif', 'jpg'])
      await expect(page.getByText(`hero-shot-${width}w.${ext}`, { exact: true })).toBeVisible()

  // <picture> markup with the default path, and Copy HTML
  await expect(page.locator('pre')).toContainText(
    '<source type="image/avif" srcset="/images/hero-shot-400w.avif 400w, /images/hero-shot-800w.avif 800w, /images/hero-shot-1000w.avif 1000w"',
  )
  await page.getByRole('button', { name: 'Copy HTML' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '<img src="/images/hero-shot-1000w.jpg"',
  )

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download ZIP' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('images.zip')

  // Switching mode re-processes; the row stays expanded.
  await page.getByRole('radio', { name: 'CMS master' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('hero-shot.jpg', { exact: true })).toBeVisible()
  await expect(page.getByText('hero-shot-400w.avif', { exact: true })).toHaveCount(0)

  expect(errors).toEqual([])
})

test('detects a flat graphic and gives it lossless WebP + PNG', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await makePng(page, 1800, 900),
  })
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByLabel('Role for logo.png')).toHaveValue('Graphic')
  await page.getByRole('button', { name: 'logo.png', exact: true }).click()
  for (const name of ['logo-800w.webp', 'logo-800w.png', 'logo-1600w.webp', 'logo-1600w.png'])
    await expect(page.getByText(name, { exact: true })).toBeVisible()

  // overriding the role re-processes just this image
  await page.getByLabel('Role for logo.png').selectOption('Content')
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('logo-1600w.avif', { exact: true })).toBeVisible()
})

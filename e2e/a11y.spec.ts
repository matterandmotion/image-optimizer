import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { makeJpeg, makePng } from './images.js'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

async function violations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`axe finds nothing in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/')
    expect(await violations(page), 'empty').toEqual([])

    await page.locator('input[type=file]').setInputFiles([
      { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 1000, 600) },
      { name: 'logo.png', mimeType: 'image/png', buffer: await makePng(page, 600, 400) },
      // A failed row, for the contrast of its message.
      { name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('not a HEIC') },
    ])
    // Listed, waiting for Optimize.
    await expect(page.getByRole('cell', { name: 'Ready' })).toHaveCount(2, { timeout: 30_000 })
    expect(await violations(page), 'ready').toEqual([])

    await page.getByRole('radio', { name: 'Responsive set' }).click()
    await page.getByRole('button', { name: 'Optimize 2 images' }).click()
    // While processing: the progress bar needs a name.
    await expect(page.getByRole('progressbar', { name: 'Processing photo.jpg' })).toBeVisible()
    expect(await violations(page), 'processing').toEqual([])

    await expect(page.getByText(/^2 done/)).toBeVisible({ timeout: 90_000 })
    await page.getByRole('button', { name: 'photo.jpg', exact: true }).click()
    expect(await violations(page), 'done, row open').toEqual([])

    await page.getByRole('button', { name: 'Compare photo.jpg with the original' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await violations(page), 'compare').toEqual([])
  })
}

test('focus stays on the list when rows are removed', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 600, 400) },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 600, 400) },
    { name: 'c.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 600, 400) },
  ])
  await page.getByRole('button', { name: 'Optimize 3 images' }).click()
  await expect(page.getByText(/^3 done/)).toBeVisible({ timeout: 90_000 })
  const remove = (name: string) => page.getByRole('button', { name: `Remove ${name}` })

  // The next row's button takes its place; after the last row, the one before.
  await remove('b.jpg').focus()
  await page.keyboard.press('Enter')
  await expect(remove('c.jpg')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(remove('a.jpg')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /^Drop images here/ })).toBeFocused()

  // Clear does the same.
  await page.locator('input[type=file]').setInputFiles({
    name: 'd.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeJpeg(page, 600, 400),
  })
  await page.getByRole('button', { name: 'Clear' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /^Drop images here/ })).toBeFocused()
})

test('copying is announced', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeJpeg(page, 600, 400),
  })
  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  const announced = page.getByRole('status').filter({ hasText: 'Copied to the clipboard.' })

  await page.getByRole('button', { name: 'Copy HTML' }).click()
  await expect(announced).toBeAttached()

  // The snippet panel's Copy too.
  await page.getByRole('button', { name: 'photo.jpg', exact: true }).click()
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(announced).toBeAttached()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`dropdown options are readable in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme })
    await page.goto('/')
    await page.locator('input[type=file]').setInputFiles({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: await makeJpeg(page, 600, 400),
    })
    await expect(page.getByLabel('Role for photo.jpg')).toBeVisible({ timeout: 30_000 })

    // The open list is drawn by the browser, outside the page, so check the options' own colours.
    // Under a transparent option, Chrome's list is white.
    const ratios = await page.locator('option').evaluateAll((options) => {
      const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!
      const luminance = (colour: string) => {
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, 1, 1)
        ctx.fillStyle = colour
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((v) => {
          const c = v / 255
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      return options.map((o) => {
        const s = getComputedStyle(o)
        const [a, b] = [luminance(s.color), luminance(s.backgroundColor)].sort((x, y) => y - x)
        return { option: o.textContent, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 10) / 10 }
      })
    })
    expect(ratios.length).toBeGreaterThan(0)
    expect(ratios.filter((r) => r.ratio < 4.5)).toEqual([])
  })
}

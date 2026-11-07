import { expect, test } from '@playwright/test'
import { makeJpeg, makePng } from './images.js'

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
  await expect(page.getByRole('radio', { name: 'CMS master' })).toBeChecked()
  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()

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

  // JSX markup: React prop names; the choice is remembered, unlike the output
  await page.getByLabel('Markup').selectOption('JSX')
  await expect(page.locator('pre')).toContainText(
    '<source type="image/avif" srcSet="/images/hero-shot-400w.avif 400w',
  )
  await expect(page.locator('pre')).toContainText('width={1000} height={600}')
  await page.getByRole('button', { name: 'Copy JSX' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /^\{\/\* Hero Shot\.jpg \*\/\}\n<picture>/,
  )
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('image-optimizer:settings')!),
  )
  expect(stored.markup).toBe('jsx')
  expect(stored).not.toHaveProperty('mode')

  // average-colour placeholder, as an inline style
  await page.getByLabel('Placeholder').check()
  await expect(page.locator('pre')).toContainText(/style=\{\{ backgroundColor: '#[0-9a-f]{6}' \}\}/)

  // before/after: both sides are the output's size; Esc closes
  await page.getByRole('button', { name: 'Compare hero-shot-1000w.avif' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('img')).toHaveCount(2, { timeout: 30_000 })
  await expect
    .poll(() =>
      dialog
        .locator('img')
        .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).naturalWidth)),
    )
    .toEqual([1000, 1000])
  const divider = dialog.getByLabel('Divider position')
  await divider.focus()
  await page.keyboard.press('Home')
  await expect(divider).toHaveValue('0')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download ZIP' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('images.zip')

  // Switching mode runs nothing until Optimize; then the row opens on the new files.
  await page.getByRole('radio', { name: 'CMS master' }).click()
  await expect(page.getByRole('cell', { name: 'Ready' })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('hero-shot.jpg', { exact: true })).toBeVisible()
  await expect(page.getByText('hero-shot-400w.avif', { exact: true })).toHaveCount(0)

  // Switching back brings the responsive set back, without another run.
  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await expect(page.getByRole('cell', { name: 'Done' })).toBeVisible()
  await expect(page.getByText('hero-shot-400w.avif', { exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('detects a flat graphic and gives it lossless WebP + PNG', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: await makePng(page, 1800, 900),
  })
  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByLabel('Role for logo.png')).toHaveValue('Graphic')
  await page.getByRole('button', { name: 'logo.png', exact: true }).click()
  for (const name of ['logo-800w.webp', 'logo-800w.png', 'logo-1600w.webp', 'logo-1600w.png'])
    await expect(page.getByText(name, { exact: true })).toBeVisible()

  // overriding the role needs another Optimize, for just this image
  await page.getByLabel('Role for logo.png').selectOption('Content')
  await expect(page.getByRole('cell', { name: 'Ready' })).toBeVisible()
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('logo-1600w.avif', { exact: true })).toBeVisible()
})

test('saves into a folder, leaving a foreign manifest.json alone', async ({ page }) => {
  // The native folder picker can't be driven by tests; stand in a folder of the
  // origin-private file system, which supports the same handle API.
  await page.addInitScript(() => {
    Object.assign(window, {
      showDirectoryPicker: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle('site', { create: true }),
    })
  })
  await page.goto('/')
  const folder = () =>
    page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('site')
      const files: Record<string, string> = {}
      for await (const [name, handle] of dir.entries()) {
        const file = await (handle as FileSystemFileHandle).getFile()
        files[name] = name.endsWith('.json') ? await file.text() : `${file.size} bytes`
      }
      return files
    })
  // the site already has a web app manifest, and an old copy of one output
  await page.evaluate(async () => {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('site', {
      create: true,
    })
    for (const [name, text] of [
      ['manifest.json', '{"name":"My site"}'],
      ['photo-400w.avif', 'old'],
    ]) {
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
      await writable.write(text)
      await writable.close()
    }
  })

  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: await makeJpeg(page, 1000, 600),
  })
  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await page.getByRole('button', { name: 'Optimize 1 image' }).click()
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Save to folder' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveText(
    'Saved 6 files to “site”, replacing 1. The folder’s own manifest.json wasn’t replaced.',
  )
  let files = await folder()
  expect(Object.keys(files).sort()).toEqual([
    'manifest.json',
    'photo-1000w.avif',
    'photo-1000w.jpg',
    'photo-400w.avif',
    'photo-400w.jpg',
    'photo-800w.avif',
    'photo-800w.jpg',
  ])
  expect(files['manifest.json']).toBe('{"name":"My site"}')
  expect(files['photo-400w.avif']).not.toBe('3 bytes')

  // without the foreign manifest, ours is written, and replaced on the next save
  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('site')
    await dir.removeEntry('manifest.json')
  })
  await page.getByRole('button', { name: 'Save to folder' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveText(
    'Saved 7 files to “site”, replacing 6.',
  )
  files = await folder()
  expect(JSON.parse(files['manifest.json']).generator).toBe('image-optimizer')
  await page.getByRole('button', { name: 'Save to folder' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toHaveText(
    'Saved 7 files to “site”, replacing 7.',
  )
})

test('waits for Optimize, locks the settings while it runs, and can stop', async ({ page }) => {
  await page.goto('/')
  const jpeg = await makeJpeg(page, 3000, 2000)
  await page
    .locator('input[type=file]')
    .setInputFiles(
      ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: jpeg })),
    )

  // Listed and read, but nothing is made until Optimize.
  await expect(page.getByRole('cell', { name: 'Ready' })).toHaveCount(3, { timeout: 30_000 })
  await expect(page.getByText('3 images', { exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download ZIP' })).toHaveCount(0)

  await page.getByRole('radio', { name: 'Responsive set' }).click()
  await page.getByRole('button', { name: 'Optimize 3 images' }).click()
  await expect(page.getByRole('progressbar')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'CMS master' })).toBeDisabled()
  await expect(page.getByLabel(/^Quality/)).toBeDisabled()
  await expect(page.getByLabel('Role for b.jpg')).toBeDisabled()

  // Stop: nothing is queued or running, and the settings unlock.
  await page.getByRole('button', { name: 'Stop' }).click()
  const optimize = page.getByRole('button', { name: /^Optimize \d images?$/ })
  await expect(optimize).toBeFocused()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Queued' })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: 'CMS master' })).toBeEnabled()

  // Optimize again finishes the rest; the same button then downloads.
  await optimize.click()
  await expect(page.getByText(/^3 done/)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('button', { name: 'Download ZIP' })).toBeFocused()
})

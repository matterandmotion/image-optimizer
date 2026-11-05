import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { makeJpeg } from './images.js'

/**
 * These tests run their own `vite preview` of the build, so they can stop the server (the
 * real thing, rather than emulated offline) or change files under it. The build comes from
 * the Playwright web server step.
 */
async function preview(
  port: number,
  dir = 'dist',
): Promise<{ url: string; stop(): Promise<void> }> {
  const url = `http://localhost:${port}/`
  const args = ['node_modules/vite/bin/vite.js', 'preview', '--port', `${port}`, '--strictPort']
  const server: ChildProcess = spawn(process.execPath, [...args, '--outDir', dir], {
    stdio: 'ignore',
  })
  const stop = () =>
    new Promise<void>((resolve) => {
      if (server.exitCode !== null) return resolve()
      server.once('exit', () => resolve())
      server.kill()
    })
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(url).then(
        (r) => r.ok,
        () => false,
      )
    )
      return { url, stop }
    await new Promise((r) => setTimeout(r, 100))
  }
  await stop()
  throw new Error(`vite preview didn't start on port ${port}`)
}

test('works offline after the first visit', async ({ page }) => {
  const server = await preview(4174)
  let jpeg: Buffer
  try {
    await page.goto(server.url)
    await expect(page.getByText('Works offline.')).toBeVisible({ timeout: 60_000 })
    jpeg = await makeJpeg(page, 1000, 600)
  } finally {
    await server.stop()
  }
  await expect(fetch(server.url)).rejects.toThrow()

  // The page, its headers (cross-origin isolation) and both engines come from the cache.
  const response = await page.reload()
  expect(response?.fromServiceWorker()).toBe(true)
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer: jpeg,
  })
  await expect(page.getByText(/^1 done/)).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'photo.jpg', exact: true }).click()
  await expect(page.getByText('photo-1000w.avif', { exact: true })).toBeVisible()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download ZIP' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('images.zip')
})

test('offers a new version and reloads into it', async ({ page }) => {
  // A copy of the build, so this test can "deploy" a change without touching dist/.
  const dir = mkdtempSync(join(tmpdir(), 'image-optimizer-'))
  cpSync('dist', dir, { recursive: true })
  const server = await preview(4175, dir)
  try {
    await page.goto(server.url)
    await expect(page.getByText('Works offline.')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('A new version is ready.')).toBeHidden()

    appendFileSync(join(dir, 'sw.js'), '\n// next deploy\n')
    await page.reload()
    await expect(page.getByText('A new version is ready.')).toBeVisible({ timeout: 60_000 })

    await Promise.all([
      page.waitForEvent('framenavigated'),
      page.getByRole('button', { name: 'Reload', exact: true }).click(),
    ])
    await expect(page.getByText('Works offline.')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('A new version is ready.')).toBeHidden()
    expect(
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration()
        return {
          waiting: !!registration?.waiting,
          controlled: !!navigator.serviceWorker.controller,
        }
      }),
    ).toEqual({ waiting: false, controlled: true })
  } finally {
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

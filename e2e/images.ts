import type { Page } from '@playwright/test'

/** A JPEG drawn in the page, so the repo needs no binary fixtures. */
export async function makeJpeg(page: Page, width: number, height: number): Promise<Buffer> {
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
export async function makePng(page: Page, width: number, height: number): Promise<Buffer> {
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

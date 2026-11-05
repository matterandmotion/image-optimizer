/// <reference lib="webworker" />
import encodeAvif from '@jsquash/avif/encode.js'
import type Vips from 'wasm-vips'
import type { EngineInfo, Request, Response } from './protocol'
import type { AvifEncoder } from './types'
import { probe, processImage, rgbaToPng } from './vips-pipeline'

declare const self: DedicatedWorkerGlobalScope

let vips: typeof Vips | undefined
let info: EngineInfo | undefined

// jSquash picks its multi-threaded build when the page is cross-origin isolated.
// speed 5 matches libvips' default AVIF effort; 'auto' tune already means ssim at q >= 50.
const avif: AvifEncoder = (image, quality) =>
  encodeAvif(new ImageData(image.data, image.width, image.height), { quality, speed: 5 })

async function init(vipsUrl: string): Promise<EngineInfo> {
  if (info) return info
  // Loaded from a plain URL so the module, its pthread workers and vips-heif.wasm (AVIF/HEIF
  // input) resolve next to each other, untouched by the bundler.
  const { default: load } = await import(/* @vite-ignore */ vipsUrl)
  vips = (await load({ dynamicLibraries: ['vips-heif.wasm'] })) as typeof Vips
  vips.concurrency(navigator.hardwareConcurrency)
  vips.Cache.max(0)
  const result = { vips: String(vips.version()), threads: Number(vips.concurrency() ?? 1) }
  info = result
  return result
}

/** Safari's canvas limit (16.7 MP). Larger images are scaled down to fit; outputs are smaller. */
const MAX_CANVAS_PIXELS = 4096 * 4096

/** Decodes with the browser: orientation applied, colour converted to sRGB by the canvas. */
async function decodeWithBrowser(buf: ArrayBuffer): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(new Blob([buf]), {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
  })
  try {
    const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (bitmap.width * bitmap.height)))
    const width = Math.max(1, Math.floor(bitmap.width * scale))
    const height = Math.max(1, Math.floor(bitmap.height * scale))
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { colorSpace: 'srgb' })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)
    return rgbaToPng(vips!, new Uint8Array(data.buffer), width, height)
  } finally {
    bitmap.close()
  }
}

const post = (msg: Response, transfer: Transferable[] = []) => self.postMessage(msg, transfer)

self.onmessage = async ({ data: req }: MessageEvent<Request>) => {
  try {
    switch (req.type) {
      case 'init':
        post({ id: req.id, kind: 'done', result: await init(req.vipsUrl) })
        break
      case 'probe':
        if (!vips) throw new Error('engine not initialised')
        post({ id: req.id, kind: 'done', result: probe(vips, new Uint8Array(req.buf)) })
        break
      case 'decode': {
        if (!vips) throw new Error('engine not initialised')
        const png = await decodeWithBrowser(req.buf)
        post({ id: req.id, kind: 'done', result: png }, [png.buffer as ArrayBuffer])
        break
      }
      case 'process': {
        if (!vips) throw new Error('engine not initialised')
        const out = await processImage(
          vips,
          avif,
          new Uint8Array(req.buf),
          req.specs,
          (done, total) => post({ id: req.id, kind: 'progress', done, total }),
        )
        post(
          { id: req.id, kind: 'done', result: out },
          out.map((o) => o.bytes.buffer as ArrayBuffer),
        )
        break
      }
    }
  } catch (e) {
    post({ id: req.id, kind: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

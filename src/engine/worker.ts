/// <reference lib="webworker" />
import encodeAvif from '@jsquash/avif/encode.js'
import type Vips from 'wasm-vips'
import type { EngineInfo, Request, Response } from './protocol'
import type { AvifEncoder } from './types'
import { probe, processImage } from './vips-pipeline'

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
    post({ id: req.id, kind: 'error', message: describe(e) })
  }
}

/** Emscripten's thread pool rejects with the ErrorEvent of a worker that failed to start. */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e instanceof ErrorEvent) return e.message || 'An encoder worker failed to start'
  return String(e)
}

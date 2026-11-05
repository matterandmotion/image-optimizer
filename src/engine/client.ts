import type { EngineInfo, Request, Response, Results } from './protocol'
import type { EncodedVariant, SourceInfo, VariantSpec } from './types'

type Pending = {
  resolve: (value: never) => void
  reject: (error: Error) => void
  onProgress?: (done: number, total: number) => void
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

/**
 * Main-thread handle to the image engine worker (wasm-vips + jSquash AVIF).
 * Processes one request at a time per instance.
 */
export class Engine {
  private worker: Worker | null = null
  private ready: Promise<EngineInfo> | null = null
  private pending = new Map<number, Pending>()
  private seq = 0

  /** Loads the WASM modules. Called implicitly by `probe` and `process`. */
  init(): Promise<EngineInfo> {
    this.ready ??= this.call('init', {
      vipsUrl: new URL(`${import.meta.env.BASE_URL}${__VIPS_DIR__}vips-es6.js`, location.origin)
        .href,
    })
    return this.ready
  }

  async probe(file: Blob): Promise<SourceInfo> {
    await this.init()
    const buf = await file.arrayBuffer()
    return this.call('probe', { buf }, [buf])
  }

  async process(
    file: Blob,
    specs: VariantSpec[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<EncodedVariant[]> {
    await this.init()
    const buf = await file.arrayBuffer()
    return this.call('process', { buf, specs }, [buf], onProgress)
  }

  /** Stops all work immediately. The next call starts a fresh worker. */
  cancel() {
    this.worker?.terminate()
    this.worker = null
    this.ready = null
    for (const p of this.pending.values()) p.reject(new CancelledError())
    this.pending.clear()
  }

  private get w(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
        name: 'engine',
      })
      worker.onmessage = ({ data }: MessageEvent<Response>) => {
        const p = this.pending.get(data.id)
        if (!p) return
        if (data.kind === 'progress') return p.onProgress?.(data.done, data.total)
        this.pending.delete(data.id)
        if (data.kind === 'done') p.resolve(data.result as never)
        else p.reject(new Error(data.message))
      }
      worker.onerror = (e) => {
        e.preventDefault()
        const error = new Error(e.message || 'engine worker failed')
        for (const p of this.pending.values()) p.reject(error)
        this.pending.clear()
        this.worker?.terminate()
        this.worker = null
        this.ready = null
      }
      this.worker = worker
    }
    return this.worker
  }

  private call<T extends keyof Results>(
    type: T,
    payload: Omit<Extract<Request, { type: T }>, 'id' | 'type'>,
    transfer: Transferable[] = [],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Results[T]> {
    const id = ++this.seq
    return new Promise<Results[T]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject, onProgress })
      this.w.postMessage({ id, type, ...payload }, transfer)
    })
  }
}

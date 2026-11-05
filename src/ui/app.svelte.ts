import { CancelledError, Engine } from '../engine/client'
import type { Format, SourceInfo } from '../engine/types'
import { outputName, slugify, uniqueBase } from '../lib/naming'
import { DEFAULT_SETTINGS, planVariants, type PlanSettings } from '../lib/plan'
import { isImage } from './files'

export type Status = 'reading' | 'queued' | 'processing' | 'done' | 'error'

export interface Output {
  name: string
  format: Format
  width: number
  height: number
  blob: Blob
  url: string
}

const MIME: Record<Format, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
}
const SETTINGS_KEY = 'image-optimizer:settings'

/** Engine output buffers are transferred copies, never shared memory. */
const blobOf = (bytes: Uint8Array, format: Format) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[format] })

export class Item {
  readonly id = crypto.randomUUID()
  status = $state<Status>('reading')
  info = $state.raw<SourceInfo | null>(null)
  thumb = $state<string | null>(null)
  progress = $state.raw({ done: 0, total: 0 })
  outputs = $state.raw<Output[]>([])
  error = $state<string | null>(null)

  constructor(
    readonly file: File,
    readonly base: string,
  ) {}

  /** What a browser downloads at the largest size: the first (preferred) format at the largest width. */
  get primary(): Output | undefined {
    const widest = Math.max(...this.outputs.map((o) => o.width))
    return this.outputs.find((o) => o.width === widest)
  }

  releaseOutputs() {
    for (const o of this.outputs) URL.revokeObjectURL(o.url)
    this.outputs = []
  }

  release() {
    this.releaseOutputs()
    if (this.thumb) URL.revokeObjectURL(this.thumb)
  }
}

function loadSettings(): PlanSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export class App {
  items = $state<Item[]>([])
  settings = $state<PlanSettings>(loadSettings())

  /** Heavy processing, one image at a time. */
  private engine = new Engine()
  /** Probes and thumbnails, so new files show up while a batch is running. */
  private reader = new Engine()
  private running = false
  private bases = new Set<string>()

  get done() {
    return this.items.filter((i) => i.status === 'done')
  }

  get busy() {
    return this.items.some(
      (i) => i.status === 'reading' || i.status === 'queued' || i.status === 'processing',
    )
  }

  get totals() {
    let original = 0
    let output = 0
    for (const item of this.done) {
      original += item.file.size
      output += item.primary?.blob.size ?? 0
    }
    return { original, output }
  }

  add(files: File[]) {
    for (const file of files.filter(isImage)) {
      const item = new Item(file, uniqueBase(slugify(file.name), this.bases))
      this.items.push(item)
      void this.read(item)
    }
  }

  /** Changing settings re-processes everything with the new plan. */
  set(patch: Partial<PlanSettings>) {
    Object.assign(this.settings, patch)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify($state.snapshot(this.settings)))
    } catch {
      // storage unavailable (private mode); settings just won't persist
    }
    for (const item of this.items)
      if (item.status === 'done' || item.status === 'processing') {
        item.releaseOutputs()
        item.status = 'queued'
      }
    this.engine.cancel()
    void this.pump()
  }

  remove(item: Item) {
    if (item.status === 'processing') this.engine.cancel()
    item.release()
    this.bases.delete(item.base)
    this.items = this.items.filter((i) => i !== item)
    void this.pump()
  }

  clear() {
    this.engine.cancel()
    this.reader.cancel()
    for (const item of this.items) item.release()
    this.items = []
    this.bases.clear()
  }

  async zip(): Promise<Blob> {
    const { downloadZip } = await import('client-zip')
    const files = this.done.flatMap((item) =>
      item.outputs.map((o) => ({ name: o.name, input: o.blob })),
    )
    return downloadZip(files).blob()
  }

  private async read(item: Item) {
    try {
      const info = await this.reader.probe(item.file)
      const [thumb] = await this.reader.process(item.file, [
        { width: 160, format: 'webp', quality: 75 },
      ])
      if (!this.items.includes(item)) return
      item.info = info
      item.thumb = URL.createObjectURL(blobOf(thumb.bytes, 'webp'))
      item.status = 'queued'
      void this.pump()
    } catch (e) {
      if (e instanceof CancelledError) return
      item.status = 'error'
      item.error = /\.(heic|heif)$/i.test(item.file.name)
        ? 'HEIC isn’t supported yet'
        : 'Can’t read this file'
    }
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (let item = this.next(); item; item = this.next()) {
        const target = item
        const settings = $state.snapshot(this.settings)
        target.status = 'processing'
        target.progress = { done: 0, total: 0 }
        try {
          const encoded = await this.engine.process(
            target.file,
            planVariants(target.info!, settings),
            (done, total) => (target.progress = { done, total }),
          )
          target.outputs = encoded.map((e) => {
            const blob = blobOf(e.bytes, e.spec.format)
            const width = settings.mode === 'master' ? null : e.width
            return {
              name: outputName(target.base, e.spec.format, width),
              format: e.spec.format,
              width: e.width,
              height: e.height,
              blob,
              url: URL.createObjectURL(blob),
            }
          })
          target.status = 'done'
        } catch (e) {
          // Cancelled by a settings change or removal: the item is already re-queued or gone.
          if (e instanceof CancelledError) continue
          target.status = 'error'
          target.error = e instanceof Error ? e.message : String(e)
        }
      }
    } finally {
      this.running = false
    }
  }

  private next(): Item | undefined {
    return this.items.find((i) => i.status === 'queued')
  }
}

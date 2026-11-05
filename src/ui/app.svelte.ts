import { CancelledError, Engine } from '../engine/client'
import type { Format, SourceInfo } from '../engine/types'
import { manifest } from '../lib/manifest'
import { outputName, slugify, uniqueBase } from '../lib/naming'
import {
  DEFAULT_SETTINGS,
  planVariants,
  type Mode,
  type PlanSettings,
  type Role,
} from '../lib/plan'
import { pictureHtml } from '../lib/snippet'
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

export interface Settings extends PlanSettings {
  /** URL path the images will be served from, used in the HTML snippets. */
  path: string
}
const DEFAULTS: Settings = { ...DEFAULT_SETTINGS, path: '/images/' }

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
  /** Role picked for this image. `null` follows the toolbar (graphics default to Graphic). */
  roleOverride = $state<Role | null>(null)
  /** Mode and role the current outputs were made with. */
  madeWith = $state.raw<{ mode: Mode; role: Role } | null>(null)
  /** The original rendered losslessly at a given width, for comparisons. */
  readonly originals = new Map<number, Promise<string>>()

  /** What the engine reads: the file, or a PNG the browser decoded it to (e.g. HEIC in Safari). */
  source: Blob

  constructor(
    readonly file: File,
    readonly base: string,
  ) {
    this.source = file
  }

  /** What a browser downloads at the largest size: the first (preferred) format at the largest width. */
  get primary(): Output | undefined {
    const widest = Math.max(...this.outputs.map((o) => o.width))
    return this.outputs.find((o) => o.width === widest)
  }

  releaseOutputs() {
    for (const o of this.outputs) URL.revokeObjectURL(o.url)
    this.outputs = []
    this.madeWith = null
  }

  release() {
    this.releaseOutputs()
    if (this.thumb) URL.revokeObjectURL(this.thumb)
    for (const url of this.originals.values()) void url.then(URL.revokeObjectURL, () => {})
    this.originals.clear()
  }
}

function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export interface Comparison {
  item: Item
  output: Output
  original: string | null
}

export class App {
  items = $state<Item[]>([])
  settings = $state<Settings>(loadSettings())
  comparing = $state.raw<Comparison | null>(null)

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

  roleFor(item: Item): Role {
    return item.roleOverride ?? (item.info?.kind === 'graphic' ? 'graphic' : this.settings.role)
  }

  /** Changing plan settings re-processes everything. */
  set(patch: Partial<PlanSettings>) {
    Object.assign(this.settings, patch)
    this.save()
    for (const item of this.items) this.requeue(item)
    this.engine.cancel()
    void this.pump()
  }

  /** Only affects the HTML snippets; nothing is re-processed. */
  setPath(path: string) {
    this.settings.path = path
    this.save()
  }

  setRole(item: Item, role: Role) {
    item.roleOverride = role
    const processing = item.status === 'processing'
    this.requeue(item)
    if (processing) this.engine.cancel()
    void this.pump()
  }

  /** Opens the before/after view. The original is rendered at the output's width, losslessly. */
  async compare(item: Item, output: Output) {
    this.comparing = { item, output, original: null }
    let original = item.originals.get(output.width)
    if (!original) {
      original = this.reader
        .process(item.source, [{ width: output.width, format: 'png', quality: 100 }])
        .then(([o]) => URL.createObjectURL(blobOf(o.bytes, 'png')))
      item.originals.set(output.width, original)
      original.catch(() => item.originals.delete(output.width))
    }
    try {
      const url = await original
      if (this.comparing?.output === output) this.comparing = { item, output, original: url }
    } catch {
      if (this.comparing?.output === output) this.comparing = null
    }
  }

  /** `<picture>` markup for a finished responsive set; null for CMS masters. */
  html(item: Item): string | null {
    if (item.status !== 'done' || item.madeWith?.mode !== 'responsive') return null
    return pictureHtml(item.madeWith.role, item.outputs, this.settings.path)
  }

  allHtml(): string {
    return this.done
      .map((item) => {
        const html = this.html(item)
        return html && `<!-- ${item.file.name} -->\n${html}`
      })
      .filter(Boolean)
      .join('\n\n')
  }

  remove(item: Item) {
    if (this.comparing?.item === item) this.comparing = null
    if (item.status === 'processing') this.engine.cancel()
    item.release()
    this.bases.delete(item.base)
    this.items = this.items.filter((i) => i !== item)
    void this.pump()
  }

  clear() {
    this.comparing = null
    this.engine.cancel()
    this.reader.cancel()
    for (const item of this.items) item.release()
    this.items = []
    this.bases.clear()
  }

  /** Every output, plus manifest.json (sizes, dimensions and, for responsive sets, markup). */
  async zip(): Promise<Blob> {
    const { downloadZip } = await import('client-zip')
    const done = this.done
    const files = done.flatMap((item) => item.outputs.map((o) => ({ name: o.name, input: o.blob })))
    const json = manifest(
      this.settings.mode,
      this.settings.path,
      done.map((item) => ({
        base: item.base,
        role: item.madeWith?.role ?? this.roleFor(item),
        source: {
          file: item.file.name,
          width: item.info?.width ?? 0,
          height: item.info?.height ?? 0,
          bytes: item.file.size,
        },
        outputs: item.outputs.map((o) => ({ ...o, bytes: o.blob.size })),
      })),
    )
    files.push({ name: 'manifest.json', input: new Blob([json], { type: 'application/json' }) })
    return downloadZip(files).blob()
  }

  private requeue(item: Item) {
    if (this.comparing?.item === item) this.comparing = null
    if (item.status !== 'done' && item.status !== 'processing') return
    item.releaseOutputs()
    item.status = 'queued'
  }

  private save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify($state.snapshot(this.settings)))
    } catch {
      // storage unavailable (private mode); settings just won't persist
    }
  }

  private async read(item: Item) {
    try {
      const info = await this.probeOrDecode(item)
      const [thumb] = await this.reader.process(item.source, [
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
        ? 'This browser can’t open HEIC'
        : 'Can’t read this file'
    }
  }

  /** libvips reads most files; for the rest (HEIC in Safari, BMP, …) the browser may decode. */
  private async probeOrDecode(item: Item): Promise<SourceInfo> {
    try {
      return await this.reader.probe(item.file)
    } catch (e) {
      if (e instanceof CancelledError) throw e
      item.source = await this.reader.decode(item.file)
      return this.reader.probe(item.source)
    }
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      for (let item = this.next(); item; item = this.next()) {
        const target = item
        const settings = $state.snapshot(this.settings)
        const role = this.roleFor(target)
        target.status = 'processing'
        target.progress = { done: 0, total: 0 }
        try {
          const encoded = await this.engine.process(
            target.source,
            planVariants(target.info!, { ...settings, role }),
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
          target.madeWith = { mode: settings.mode, role }
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

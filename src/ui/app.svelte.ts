import { CancelledError, Engine } from '../engine/client'
import type { Format, SourceInfo } from '../engine/types'
import { GENERATOR, MANIFEST, manifest } from '../lib/manifest'
import { outputName, slugify, uniqueBase } from '../lib/naming'
import {
  DEFAULT_SETTINGS,
  planVariants,
  type Mode,
  type PlanSettings,
  type Role,
} from '../lib/plan'
import { comment, pictureMarkup, type Markup } from '../lib/snippet'
import { isImage, saveToFolder, type ExportFile, type FolderResult } from './files'

/** `ready`: read, and waiting for Optimize. `done`: has outputs for the current settings. */
export type Status = 'reading' | 'ready' | 'queued' | 'processing' | 'done' | 'error'

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

/** A finished set of outputs. Its key identifies the files it holds (mode and variants). */
interface Result {
  key: string
  outputs: Output[]
}

export interface Settings extends PlanSettings {
  /** URL path the images will be served from, used in the snippets. */
  path: string
  /** Snippet syntax. */
  markup: Markup
  /** Give each image its average colour as a background until it loads. */
  placeholder: boolean
}
const DEFAULTS: Settings = {
  ...DEFAULT_SETTINGS,
  path: '/images/',
  markup: 'html',
  placeholder: false,
}

/** Engine output buffers are transferred copies, never shared memory. */
const blobOf = (bytes: Uint8Array, format: Format) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[format] })

export class Item {
  readonly id = crypto.randomUUID()
  status = $state<Status>('reading')
  info = $state.raw<SourceInfo | null>(null)
  thumb = $state<string | null>(null)
  progress = $state.raw({ done: 0, total: 0 })
  /** Outputs for the current settings; empty until it has been optimized with them. */
  outputs = $state.raw<Output[]>([])
  error = $state<string | null>(null)
  /** Role picked for this image. `null` follows the toolbar (graphics default to Graphic). */
  roleOverride = $state<Role | null>(null)
  /** Optimize was pressed while this was still being read. */
  startWhenRead = $state(false)
  /** The last finished set in each mode, so switching back needs no second run. */
  readonly results = new Map<Mode, Result>()
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

  /** Keeps a finished set, replacing the one before it in that mode. */
  keep(mode: Mode, result: Result) {
    for (const o of this.results.get(mode)?.outputs ?? []) URL.revokeObjectURL(o.url)
    this.results.set(mode, result)
  }

  release() {
    for (const { outputs } of this.results.values())
      for (const o of outputs) URL.revokeObjectURL(o.url)
    this.results.clear()
    this.outputs = []
    if (this.thumb) URL.revokeObjectURL(this.thumb)
    for (const url of this.originals.values()) void url.then(URL.revokeObjectURL, () => {})
    this.originals.clear()
  }
}

/** Everything but the output is remembered: each visit starts on CMS master. */
function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return { ...DEFAULTS, ...stored, mode: DEFAULTS.mode }
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

  /** How many images Optimize would start: read and not yet made with these settings, or still being read. */
  get toOptimize() {
    return this.items.filter(
      (i) => i.status === 'ready' || (i.status === 'reading' && !i.startWhenRead),
    ).length
  }

  /** Between Optimize and the last image finishing. Plan settings are locked meanwhile. */
  get optimizing() {
    return this.items.some(
      (i) =>
        i.status === 'queued' ||
        i.status === 'processing' ||
        (i.status === 'reading' && i.startWhenRead),
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

  /**
   * Plan settings change what Optimize will make; nothing runs until it's pressed.
   * Images already made with the new settings (in that mode) show those files again.
   */
  set(patch: Partial<PlanSettings>) {
    Object.assign(this.settings, patch)
    this.save()
    for (const item of this.items) this.sync(item)
  }

  /** These only affect the snippets; nothing is re-processed. */
  setSnippet(patch: Partial<Pick<Settings, 'path' | 'markup' | 'placeholder'>>) {
    Object.assign(this.settings, patch)
    this.save()
  }

  setRole(item: Item, role: Role) {
    item.roleOverride = role
    this.sync(item)
  }

  /** Optimizes every image not yet made with the current settings, including any still being read. */
  optimize() {
    for (const item of this.items) {
      if (item.status === 'ready') item.status = 'queued'
      else if (item.status === 'reading') item.startWhenRead = true
    }
    void this.pump()
  }

  /** Stops the run. Finished images keep their files; the rest go back to ready. */
  stop() {
    for (const item of this.items) {
      item.startWhenRead = false
      if (item.status === 'queued' || item.status === 'processing') item.status = 'ready'
    }
    this.engine.cancel()
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
  snippet(item: Item): string | null {
    if (item.status !== 'done' || this.settings.mode !== 'responsive') return null
    const { path, markup, placeholder } = this.settings
    const background = placeholder ? (item.info?.colour ?? null) : null
    return pictureMarkup(this.roleFor(item), item.outputs, { path, markup, background })
  }

  /** Every image's snippet, each labelled with its file name. */
  allSnippets(): string {
    return this.done
      .map((item) => {
        const snippet = this.snippet(item)
        return snippet && `${comment(this.settings.markup, item.file.name)}\n${snippet}`
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
  exportFiles(): ExportFile[] {
    const done = this.done
    const files = done.flatMap((item) => item.outputs.map((o) => ({ name: o.name, blob: o.blob })))
    const json = manifest(
      this.settings.mode,
      this.settings,
      done.map((item) => ({
        base: item.base,
        role: this.roleFor(item),
        source: {
          file: item.file.name,
          width: item.info?.width ?? 0,
          height: item.info?.height ?? 0,
          bytes: item.file.size,
        },
        colour: item.info?.colour ?? null,
        outputs: item.outputs.map((o) => ({ ...o, bytes: o.blob.size })),
      })),
    )
    files.push({ name: MANIFEST, blob: new Blob([json], { type: 'application/json' }) })
    return files
  }

  async zip(): Promise<Blob> {
    const { downloadZip } = await import('client-zip')
    return downloadZip(this.exportFiles().map((f) => ({ name: f.name, input: f.blob }))).blob()
  }

  /** Writes everything into a folder. Resolves to null if the picker was cancelled. */
  saveToFolder(): Promise<FolderResult | null> {
    // A folder like a site's public/ may hold a web app manifest.json; only replace our own.
    return saveToFolder(this.exportFiles(), async (existing) => {
      if (existing.name !== MANIFEST) return false
      try {
        return JSON.parse(await existing.text()).generator !== GENERATOR
      } catch {
        return true
      }
    })
  }

  /** What Optimize makes for this image now. Equal keys mean the same files, whatever the role. */
  private plan(item: Item) {
    const specs = planVariants(item.info!, { ...this.settings, role: this.roleFor(item) })
    return { specs, key: JSON.stringify([this.settings.mode, specs]) }
  }

  /** Shows the image's finished set for the current settings, if it has one; otherwise it's ready. */
  private sync(item: Item) {
    if (item.status !== 'ready' && item.status !== 'done') return
    const result = item.results.get(this.settings.mode)
    const current = result?.key === this.plan(item).key ? result : undefined
    item.outputs = current?.outputs ?? []
    item.status = current ? 'done' : 'ready'
    if (!current && this.comparing?.item === item) this.comparing = null
  }

  private save() {
    try {
      // mode: undefined leaves the output out (JSON drops it); see loadSettings.
      const settings = { ...$state.snapshot(this.settings), mode: undefined }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
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
      item.status = item.startWhenRead ? 'queued' : 'ready'
      item.startWhenRead = false
      if (item.status === 'queued') void this.pump()
    } catch (e) {
      if (e instanceof CancelledError) return
      item.status = 'error'
      item.error = /\.(heic|heif)$/i.test(item.file.name)
        ? 'This browser can’t open HEIC. Convert it to JPEG first, or use Safari.'
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
        const mode = this.settings.mode
        const { specs, key } = this.plan(target)
        target.status = 'processing'
        target.progress = { done: 0, total: 0 }
        try {
          const encoded = await this.engine.process(
            target.source,
            specs,
            (done, total) => (target.progress = { done, total }),
          )
          if (!this.items.includes(target)) continue
          const outputs = encoded.map((e) => {
            const blob = blobOf(e.bytes, e.spec.format)
            const width = mode === 'master' ? null : e.width
            return {
              name: outputName(target.base, e.spec.format, width),
              format: e.spec.format,
              width: e.width,
              height: e.height,
              blob,
              url: URL.createObjectURL(blob),
            }
          })
          target.keep(mode, { key, outputs })
          target.status = 'ready'
          this.sync(target)
        } catch (e) {
          // Stopped, removed or cleared: stop() has already put the image back to ready.
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

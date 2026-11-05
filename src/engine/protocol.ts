import type { EncodedVariant, SourceInfo, VariantSpec } from './types'

export interface EngineInfo {
  vips: string
  threads: number
}

export type Request =
  | { id: number; type: 'init'; vipsUrl: string }
  | { id: number; type: 'probe'; buf: ArrayBuffer }
  | { id: number; type: 'process'; buf: ArrayBuffer; specs: VariantSpec[] }
  | { id: number; type: 'decode'; buf: ArrayBuffer }

export interface Results {
  init: EngineInfo
  probe: SourceInfo
  process: EncodedVariant[]
  /** A lossless PNG of an image libvips can't read but the browser can. */
  decode: Uint8Array
}

export type Response =
  | { id: number; kind: 'done'; result: Results[keyof Results] }
  | { id: number; kind: 'error'; message: string }
  | { id: number; kind: 'progress'; done: number; total: number }

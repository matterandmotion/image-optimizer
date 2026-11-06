const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif|tiff?|heic|heif)$/i

export function isImage(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
}

/** Files from a drop, including everything inside dropped folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  // Entries must be taken synchronously, before the drop event returns.
  const entries = [...dt.items].map((item) => item.webkitGetAsEntry?.()).filter((e) => e != null)
  if (entries.length === 0) return [...dt.files]
  const files: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(
        await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)),
      )
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        )
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}

/** Saves a blob through a temporary download link. */
export function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export interface ExportFile {
  name: string
  blob: Blob
}

type DirectoryPicker = (options?: {
  id?: string
  mode?: 'read' | 'readwrite'
}) => Promise<FileSystemDirectoryHandle>

const picker = (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker

/** Whether files can be written straight into a folder (Chromium on desktop). */
export const canSaveToFolder = typeof picker === 'function'

export interface FolderResult {
  folder: string
  written: number
  replaced: number
  /** Existing files left alone because `keep` said so. */
  kept: string[]
}

/**
 * Asks for a folder and writes the files into it, replacing files with the same name unless
 * `keep(existing)` says otherwise. Resolves to null if the folder picker was cancelled.
 * Call it straight from a click: the picker needs the user's gesture.
 */
export async function saveToFolder(
  files: ExportFile[],
  keep: (existing: File) => Promise<boolean> = async () => false,
): Promise<FolderResult | null> {
  let dir: FileSystemDirectoryHandle
  try {
    // `id` makes the picker reopen in the folder used last time.
    dir = await picker!({ id: 'image-optimizer', mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
  const result: FolderResult = { folder: dir.name, written: 0, replaced: 0, kept: [] }
  for (const file of files) {
    const existing = await dir
      .getFileHandle(file.name)
      .then((h) => h.getFile())
      .catch(() => null)
    if (existing && (await keep(existing))) {
      result.kept.push(file.name)
      continue
    }
    const writable = await (await dir.getFileHandle(file.name, { create: true })).createWritable()
    await writable.write(file.blob)
    await writable.close()
    result.written++
    if (existing) result.replaced++
  }
  return result
}

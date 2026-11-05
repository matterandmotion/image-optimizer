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

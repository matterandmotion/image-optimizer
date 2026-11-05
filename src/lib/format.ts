/** Decimal units, like file managers and browser dev tools: 148 KB, 2.4 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 10_000) return `${(bytes / 1000).toFixed(1)} KB`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/** Share of the original saved: `94.9%`, or negative (`−19.6%`) when the output is larger. */
export function formatSaved(original: number, output: number): string {
  if (original === 0) return '—'
  const saved = (1 - output / original) * 100
  return saved < 0 ? `−${(-saved).toFixed(1)}%` : `${saved.toFixed(1)}%`
}

/** `400, 800, 1200 and 1600` */
export function formatList(items: readonly (string | number)[]): string {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

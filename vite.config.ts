import { readFileSync } from 'node:fs'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The image engine needs SharedArrayBuffer, which only works when the page is
// cross-origin isolated. Production gets these headers from public/_headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

// `vite preview` serves the exact global headers from public/_headers (CSP included),
// so a local preview behaves like production. Dev only gets isolation, because the
// CSP would block Vite's HMR client.
function productionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  let inGlobalBlock = false
  for (const line of readFileSync('public/_headers', 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      inGlobalBlock = line.trim() === '/*'
      continue
    }
    if (!inGlobalBlock) continue
    const i = line.indexOf(':')
    headers[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return headers
}

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: { headers: isolation },
  preview: { headers: productionHeaders() },
  worker: { format: 'es' },
})

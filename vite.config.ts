import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { configDefaults, defineConfig, type Plugin } from 'vitest/config'

// The image engine needs SharedArrayBuffer, which only works when the page is
// cross-origin isolated. Production gets these headers from public/_headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * wasm-vips is loaded at runtime from a plain URL (not bundled), so its pthread workers and
 * dynamic modules resolve next to it. Served from node_modules in dev, copied into the build
 * under a versioned path so it can be cached forever.
 */
function wasmVips(): Plugin {
  const lib = new URL('./node_modules/wasm-vips/lib/', import.meta.url)
  const { version } = JSON.parse(readFileSync(new URL('../package.json', lib), 'utf8'))
  const dir = `vendor/wasm-vips/${version}/`
  const files = ['vips-es6.js', 'vips.wasm', 'vips-heif.wasm']
  const types: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm' }
  return {
    name: 'wasm-vips',
    config: () => ({ define: { __VIPS_DIR__: JSON.stringify(dir) } }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url?.split('?')[0].replace(`/${dir}`, '')
        if (!req.url?.startsWith(`/${dir}`) || !file || !files.includes(file)) return next()
        res.setHeader('Content-Type', types[extname(file)])
        res.end(readFileSync(new URL(file, lib)))
      })
    },
    generateBundle() {
      for (const file of files)
        this.emitFile({
          type: 'asset',
          fileName: dir + file,
          source: readFileSync(new URL(file, lib)),
        })
    },
  }
}

/**
 * `vite preview` applies public/_headers like Cloudflare does (path rules, `! Header` detach),
 * so a local preview behaves like production. Dev only gets isolation, because the CSP
 * would block Vite's HMR client.
 */
function productionHeaders(): Plugin {
  type Rule = { path: RegExp; set: [string, string][]; detach: string[] }
  const rules: Rule[] = []
  for (const line of readFileSync('public/_headers', 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      const pattern = line
        .trim()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
      rules.push({ path: new RegExp(`^${pattern}$`), set: [], detach: [] })
      continue
    }
    const rule = rules[rules.length - 1]
    const h = line.trim()
    if (h.startsWith('!')) rule.detach.push(h.slice(1).trim())
    else rule.set.push([h.slice(0, h.indexOf(':')).trim(), h.slice(h.indexOf(':') + 1).trim()])
  }
  return {
    name: 'production-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '/'
        for (const rule of rules.filter((r) => r.path.test(path))) {
          for (const name of rule.detach) res.removeHeader(name)
          for (const [name, value] of rule.set) res.setHeader(name, value)
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), svelte(), wasmVips(), productionHeaders()],
  server: { headers: isolation },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@jsquash/avif', 'wasm-vips'] },
  test: { testTimeout: 30_000, exclude: [...configDefaults.exclude, 'e2e/**'] },
})

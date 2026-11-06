import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import type { Dirent } from 'node:fs'
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

/**
 * Builds src/sw.ts to /sw.js, then fills in the list of files to precache and a cache name
 * derived from their contents. Runs after the whole build is written, so the list includes
 * worker bundles, the wasm-vips files and public/.
 */
function serviceWorker(): Plugin {
  const placeholders = { cache: '__SW_CACHE__', precache: '__SW_PRECACHE__' }
  let outDir = ''
  // Fetched on use and cached then, rather than on install: font subsets other than basic
  // Latin, and jSquash's single-threaded AVIF build (only used without cross-origin isolation).
  const lazy = (file: string) =>
    (file.endsWith('.woff2') && !file.includes('-latin-')) || /(^|\/)avif_enc-[^/]+$/.test(file)
  const skip = ['sw.js', '_headers', '_redirects', 'index.html']
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    buildStart() {
      this.emitFile({
        type: 'chunk',
        id: fileURLToPath(new URL('./src/sw.ts', import.meta.url)),
        fileName: 'sw.js',
      })
    },
    closeBundle(error) {
      if (error) return
      const files = (readdirSync(outDir, { recursive: true, withFileTypes: true }) as Dirent[])
        .filter((d) => d.isFile())
        .map((d) => relative(outDir, join(d.parentPath, d.name)).split(sep).join('/'))
        .filter((f) => f !== 'sw.js')
        .sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)))
      // '' is the page itself (served at the scope URL).
      const precache = [
        '',
        ...files.filter((f) => !skip.includes(f) && !f.endsWith('.map')),
      ].filter((f) => !lazy(f))
      const path = join(outDir, 'sw.js')
      const code = readFileSync(path, 'utf8')
      for (const name of Object.values(placeholders))
        if (!code.includes(name)) throw new Error(`sw.js: ${name} was renamed by the build`)
      writeFileSync(
        path,
        code
          .replaceAll(
            placeholders.cache,
            JSON.stringify(`image-optimizer-${hash.digest('hex').slice(0, 12)}`),
          )
          .replaceAll(placeholders.precache, JSON.stringify(precache)),
      )
    },
  }
}

export default defineConfig({
  plugins: [tailwindcss(), svelte(), wasmVips(), productionHeaders(), serviceWorker()],
  server: { headers: isolation },
  worker: {
    format: 'es',
    // One file per worker. jSquash's AVIF pthread workers otherwise import their glue code at
    // runtime, and WebKit doesn't route a nested worker's own requests through the service
    // worker, so AVIF failed offline in Safari.
    rolldownOptions: { output: { codeSplitting: false } },
  },
  optimizeDeps: { exclude: ['@jsquash/avif', 'wasm-vips'] },
  test: { testTimeout: 30_000, exclude: [...configDefaults.exclude, 'e2e/**'] },
})

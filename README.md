# Image Optimizer

Resize, compress and convert images for websites, in the browser. Files are processed on your device and never uploaded.

**https://image-optimizer-7ba.pages.dev**

## Using it

Drop images or folders on the page, choose files, or paste. They're listed, and nothing is made until you press **Optimize**. Pick an output first:

- **CMS master** (the default): one high-quality file per image, no wider than a maximum width. For a CMS or site builder that makes its own sizes (Wagtail, Payload, Webflow, Framer, …), so the stored original isn't needlessly large.
- **Responsive set**: several widths of each image in modern formats, plus `<picture>` markup to paste into your site. For sites you build yourself.

The settings are locked while images are being optimized; _Stop_ ends the run. Changing a setting afterwards doesn't run anything: press Optimize again. If you switch back to settings an image was already optimized with, its files come back without another run.

Download everything as a ZIP, or single files from a row. In Chrome and Edge, _Save to folder_ writes everything straight into a folder you pick, such as your site's `public/images`. Tap a thumbnail to compare an output with the original: drag the divider and switch between fit and actual pixels.

After the first visit the tool works offline. The footer says "Works offline." once it's ready, and offers a reload when a new version has been published.

### Responsive set

Each image has a role, which decides its widths and the `sizes` attribute in the markup:

| Role    | Widths (px)                | `sizes`                                                     |
| ------- | -------------------------- | ----------------------------------------------------------- |
| Hero    | 640, 960, 1280, 1920, 2560 | `100vw`                                                     |
| Content | 400, 800, 1200, 1600       | `(min-width: 800px) 800px, 100vw`                           |
| Card    | 400, 800                   | `(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw` |
| Graphic | 800, 1600                  | `(min-width: 800px) 800px, 100vw`                           |

- **Images are never enlarged.** Widths larger than the original are dropped. If the original falls between two widths, its own width is added, unless it's within 15% of the largest one kept.
- **Photos** become AVIF with a JPEG fallback, or a WebP fallback if they're transparent. Quality is Lower, Balanced or Higher.
- **Graphics** (logos, screenshots, flat illustrations) become lossless WebP with a PNG fallback. PNG, WebP and other non-JPEG files are checked for this automatically; JPEGs are treated as photos. You can change any row's role.
- **Markup.** Open a row to see its `<picture>` element.
  - Set _Path_ to the folder the images will live in on your site.
  - Choose HTML or JSX. HTML also works in Astro, Svelte and Vue templates; JSX uses React's prop names (`srcSet`, `fetchPriority`).
  - _Copy HTML_ (or _Copy JSX_) copies the markup for every image.
  - Hero images load eagerly with `fetchpriority="high"`; the rest are lazy-loaded with `sizes="auto, …"`. The `sizes` values are starting points: adjust them to your layout.
- **Placeholder.** Optionally, each `<img>` gets the image's average colour as an inline `background-color`, shown until the image loads. Off by default, because a strict Content Security Policy on your site blocks inline styles. Transparent images don’t get one.
- **`manifest.json`**, in the ZIP or the folder, lists every file with its format, width, height and size, plus each image's markup and average colour. Saving to a folder replaces files with the same names. The exception is a `manifest.json` this tool didn't write, such as a web app manifest, which is left alone.

### CMS master

One file per image, up to 1920, 2560 or 3840 px wide: JPEG at quality 90 for photos (high, because a CMS re-encodes its own sizes), PNG for graphics and transparent images.

### Every image

- EXIF orientation is applied, so the pixels are the right way up.
- Colour profiles (Display P3, Adobe RGB, CMYK, …) are converted to sRGB.
- Metadata is removed: EXIF, GPS location, camera details.
- Resizing uses Lanczos-3.

Reads JPEG, PNG, WebP, AVIF, GIF (first frame) and TIFF. Other formats are handed to the browser's own decoder: that opens BMP everywhere and HEIC in Safari. HEIC doesn't open in Chrome or Firefox yet.

## Privacy

Images are decoded, resized and encoded on your device, in the page. The Content Security Policy (`connect-src 'self'`) stops the page from sending data to any other server, and there are no analytics, trackers or third-party scripts. The font is served from the same site.

Your settings (role, quality, maximum width, path, markup, placeholder) are kept in your browser's local storage. The output isn't: each visit starts on CMS master. A service worker keeps a copy of the app in the browser's cache, so it works offline; it only ever fetches the app's own files.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev            # dev server
pnpm check          # type check
pnpm test           # unit tests
pnpm build          # production build in dist/
pnpm preview        # serve dist/ with production headers
pnpm test:e2e       # browser tests against the production build (Playwright)
```

Pull requests go to `staging`, which deploys to https://staging.image-optimizer-7ba.pages.dev. `staging` is merged into `main`, which deploys to the live site.

## Self-hosting

`pnpm install && pnpm build`, then serve `dist/` as a static site. [`public/_headers`](public/_headers), which Cloudflare Pages and Netlify read, sets:

- `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, which the image engine needs for `SharedArrayBuffer`
- a Content Security Policy that blocks requests to other origins

Hosts that don't read `_headers` need to send the same headers.

`sw.js` is a service worker that caches the app and both engines (about 5 MB compressed) after the first visit, so the tool works offline. It's generated by the build; serve it from the site root with `Cache-Control: no-cache`.

## How it works

Everything runs in a Web Worker in the browser:

- [wasm-vips](https://github.com/kleisauke/wasm-vips) (libvips) decodes, applies EXIF orientation, converts colour profiles (Display P3, CMYK, …) to sRGB, resizes with Lanczos-3 and encodes JPEG (mozjpeg), WebP and PNG. Metadata is removed.
- [jSquash](https://github.com/jamsinclair/jSquash) encodes AVIF with its multi-threaded libavif/libaom build.
- Files libvips can't read are decoded by the browser (`createImageBitmap`), drawn to an sRGB canvas and passed on as lossless PNG.

For files libvips reads, output is byte-identical across browsers, so the engine is tested once, in Node (`src/engine/*.test.ts`).

## Third-party software

The site ships these as separate WebAssembly files:

- wasm-vips: MIT. Contains libvips (LGPL-2.1-or-later) and the libraries listed in its [`versions.json`](https://github.com/kleisauke/wasm-vips/blob/master/versions.json), under their own licences.
- @jsquash/avif: Apache-2.0. Contains libavif (BSD-2-Clause) and libaom (BSD-2-Clause, with the AOMedia patent licence).

## License

[MIT](LICENSE)

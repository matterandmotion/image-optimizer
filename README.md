# Image Optimizer

Resize, compress and convert images for websites, in the browser. Files are processed on your device and never uploaded.

**Status:** early development, not usable yet.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev            # dev server
pnpm check          # type check
pnpm test           # unit tests
pnpm build          # production build in dist/
pnpm preview        # serve dist/ with production headers
```

## Deployment

The build output (`dist/`) is a static site. [`public/_headers`](public/_headers) sets:

- `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`, which the image engine needs for `SharedArrayBuffer`
- a Content Security Policy that blocks requests to other origins

Hosts that don't read `_headers` need to send the same headers.

## License

[MIT](LICENSE)

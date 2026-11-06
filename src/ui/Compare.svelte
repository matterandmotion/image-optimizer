<script lang="ts">
  import { formatBytes, formatSaved } from '../lib/format'
  import type { Item, Output } from './app.svelte'
  import Segmented from './Segmented.svelte'

  let {
    item,
    output,
    original,
    onclose,
  }: {
    item: Item
    output: Output
    /** The original rendered losslessly at the output's size; null while it's being made. */
    original: string | null
    onclose: () => void
  } = $props()

  const ZOOMS = [
    { value: 'fit', label: 'Fit' },
    { value: 'actual', label: 'Actual pixels' },
  ] as const

  let dialog: HTMLDialogElement
  let split = $state(50)
  let zoom = $state<'fit' | 'actual'>('fit')
  const saved = $derived(formatSaved(item.file.size, output.blob.size))
  // "Actual pixels" maps one image pixel to one screen pixel.
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1

  $effect(() => dialog.showModal())

  const label =
    'pointer-events-none absolute top-3 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white'
</script>

<dialog
  bind:this={dialog}
  {onclose}
  onclick={(e) => e.target === dialog && dialog.close()}
  aria-label="Compare {output.name} with the original"
  class="m-auto h-[90dvh] w-[95vw] max-w-7xl overflow-hidden rounded-lg bg-white p-0 text-neutral-900 backdrop:bg-black/60 dark:bg-neutral-950 dark:text-neutral-100"
>
  <div class="flex h-full flex-col">
    <header
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800"
    >
      <h2 class="min-w-0 truncate font-semibold">{output.name}</h2>
      <span class="text-neutral-500 tabular-nums dark:text-neutral-400">
        {output.width} × {output.height} · {formatBytes(output.blob.size)} · {saved} smaller than the
        original ({formatBytes(item.file.size)})
      </span>
      <span class="flex-1"></span>
      <Segmented label="Zoom" value={zoom} options={ZOOMS} onchange={(z) => (zoom = z)} />
      <button
        type="button"
        class="flex size-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        aria-label="Close"
        onclick={() => dialog.close()}
      >
        <svg
          class="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="m4.5 4.5 7 7m0-7-7 7" />
        </svg>
      </button>
    </header>

    <div class="relative min-h-0 flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-900">
      {#if original}
        {#snippet pair()}
          <img src={output.url} alt="" class="absolute inset-0 size-full" />
          <img
            src={original}
            alt=""
            class="absolute inset-0 size-full"
            style:clip-path="inset(0 {100 - split}% 0 0)"
          />
          <span
            class="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.2)]"
            style:left="{split}%"
          ></span>
          <span class="{label} left-3">Original</span>
          <span class="{label} right-3">{output.format.toUpperCase()}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            bind:value={split}
            aria-label="Divider position"
            class="absolute inset-0 size-full cursor-ew-resize opacity-0"
          />
        {/snippet}
        <!-- One box with the image's aspect ratio holds both images, so they line up exactly;
             the original is clipped to the left of the divider. -->
        {#if zoom === 'fit'}
          <!-- Largest size that fits, but never enlarged beyond actual pixels. -->
          <div class="[container-type:size] absolute inset-4 flex items-center justify-center">
            <div
              class="relative"
              style:width="min(100cqw, 100cqh * {output.width / output.height}, {output.width /
                dpr}px)"
              style:aspect-ratio="{output.width} / {output.height}"
            >
              {@render pair()}
            </div>
          </div>
        {:else}
          <div
            class="relative m-4"
            style:width="{output.width / dpr}px"
            style:height="{output.height / dpr}px"
          >
            {@render pair()}
          </div>
        {/if}
      {:else}
        <p
          class="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400"
        >
          Preparing the original…
        </p>
      {/if}
    </div>
  </div>
</dialog>

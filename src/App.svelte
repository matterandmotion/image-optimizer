<script lang="ts">
  import { formatBytes, formatList } from './lib/format'
  import {
    ROLE_WIDTHS,
    type Mode,
    type PlanSettings,
    type QualityLevel,
    type Role,
  } from './lib/plan'
  import { App } from './ui/app.svelte'
  import FileRow from './ui/FileRow.svelte'
  import { filesFromDataTransfer, save } from './ui/files'
  import Segmented from './ui/Segmented.svelte'
  import Select from './ui/Select.svelte'

  const app = new App()

  const MODES: { value: Mode; label: string }[] = [
    { value: 'responsive', label: 'Responsive set' },
    { value: 'master', label: 'CMS master' },
  ]
  const ROLES: { value: Role; label: string }[] = [
    { value: 'hero', label: 'Hero' },
    { value: 'content', label: 'Content' },
    { value: 'card', label: 'Card' },
    { value: 'graphic', label: 'Graphic' },
  ]
  const QUALITIES: { value: QualityLevel; label: string }[] = [
    { value: 'small', label: 'Lower' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'high', label: 'Higher' },
  ]
  const MASTER_WIDTHS = [1920, 2560, 3840].map((w) => ({ value: w, label: `${w} px` }))

  let input: HTMLInputElement
  let dragging = $state(false)
  let zipping = $state(false)

  const summary = $derived(describe(app.settings))
  const totals = $derived(app.totals)
  const done = $derived(app.done.length)
  const failed = $derived(app.items.filter((i) => i.status === 'error').length)
  const pending = $derived(app.items.length - done - failed)

  function describe(s: PlanSettings): string {
    if (s.mode === 'master')
      return `One high-quality JPEG up to ${s.masterWidth} px wide (PNG if transparent), for a CMS or site builder that makes its own sizes.`
    const widths = formatList(ROLE_WIDTHS[s.role])
    return s.role === 'graphic'
      ? `${widths} px versions as lossless WebP, with PNG as the fallback.`
      : `${widths} px versions as AVIF, with JPEG as the fallback. Never larger than the original.`
  }

  async function downloadZip() {
    zipping = true
    try {
      save(await app.zip(), 'images.zip')
    } finally {
      zipping = false
    }
  }

  function ondragover(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    dragging = true
  }

  async function ondrop(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    dragging = false
    app.add(await filesFromDataTransfer(e.dataTransfer))
  }

  const button =
    'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40'
  const secondary = `${button} border border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900`
  const primary = `${button} bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200`
</script>

<svelte:window
  {ondragover}
  {ondrop}
  ondragleave={(e) => {
    if (e.relatedTarget === null) dragging = false
  }}
  onpaste={(e) => app.add([...(e.clipboardData?.files ?? [])])}
/>

<input
  bind:this={input}
  type="file"
  multiple
  accept="image/*,.heic,.heif,.avif,.tif,.tiff"
  class="hidden"
  onchange={(e) => {
    app.add([...(e.currentTarget.files ?? [])])
    e.currentTarget.value = ''
  }}
/>

<div class="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:px-6">
  <header class="flex items-baseline justify-between gap-4">
    <h1 class="text-base font-semibold">Image Optimizer</h1>
    {#if done}
      <p class="text-sm text-neutral-500 tabular-nums">
        {formatBytes(totals.original)} → {formatBytes(totals.output)}
      </p>
    {/if}
  </header>

  {#if app.items.length === 0}
    <button
      type="button"
      onclick={() => input.click()}
      class={[
        'mt-6 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
        dragging
          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30'
          : 'border-neutral-300 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-600',
      ]}
    >
      <span class="text-lg font-medium">Drop images here</span>
      <span class="mt-1 text-sm text-neutral-500"
        >or choose files. Folders and pasting work too.</span
      >
    </button>
  {:else}
    <div class="mt-6 flex flex-wrap items-center gap-2">
      <Segmented
        label="Output"
        value={app.settings.mode}
        options={MODES}
        onchange={(mode) => app.set({ mode })}
      />
      {#if app.settings.mode === 'responsive'}
        <Select
          label="Role"
          value={app.settings.role}
          options={ROLES}
          onchange={(role) => app.set({ role })}
        />
        <Select
          label="Quality"
          value={app.settings.quality}
          options={QUALITIES}
          onchange={(quality) => app.set({ quality })}
        />
      {:else}
        <Select
          label="Max width"
          value={app.settings.masterWidth}
          options={MASTER_WIDTHS}
          onchange={(masterWidth) => app.set({ masterWidth })}
        />
      {/if}
      <span class="flex-1"></span>
      <button type="button" class={secondary} onclick={() => input.click()}>Add images</button>
      <button
        type="button"
        class={primary}
        disabled={!done || pending > 0 || zipping}
        onclick={downloadZip}
      >
        {zipping ? 'Preparing…' : 'Download ZIP'}
      </button>
    </div>

    <p class="mt-3 text-sm text-neutral-500">{summary}</p>

    <!-- Fixed column widths, so nothing shifts while files process. -->
    <table class="mt-4 w-full table-fixed text-sm">
      <colgroup>
        <col />
        <col class="hidden w-32 sm:table-column" />
        <col class="hidden w-24 sm:table-column" />
        <col class="w-20 sm:w-24" />
        <col class="hidden w-20 sm:table-column" />
        <col class="w-28 sm:w-36" />
        <col class="w-9" />
      </colgroup>
      <thead class="text-neutral-500">
        <tr class="border-b border-neutral-200 dark:border-neutral-800">
          <th class="py-2 pr-3 text-left font-medium">File</th>
          <th class="hidden px-3 text-right font-medium sm:table-cell">Dimensions</th>
          <th class="hidden px-3 text-right font-medium sm:table-cell">Original</th>
          <th
            class="px-3 text-right font-medium"
            title="The file a browser downloads at the largest size"
          >
            Largest
          </th>
          <th class="hidden px-3 text-right font-medium sm:table-cell">Saved</th>
          <th class="pl-3 text-left font-medium">Status</th>
          <th><span class="sr-only">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        {#each app.items as item (item.id)}
          <FileRow {item} onremove={() => app.remove(item)} />
        {/each}
      </tbody>
    </table>

    <div
      class="mt-4 flex items-center justify-between gap-4 text-sm text-neutral-500 tabular-nums"
      aria-live="polite"
    >
      <span>
        {pending ? `${done} of ${done + pending} done` : `${done} done`}{failed
          ? ` · ${failed} couldn’t be read`
          : ''}
      </span>
      <span class="flex items-center gap-4">
        {#if done && totals.original > totals.output}
          <span
            >Saved <span class="font-semibold text-neutral-900 dark:text-neutral-100"
              >{formatBytes(totals.original - totals.output)}</span
            ></span
          >
        {/if}
        <button
          type="button"
          class="hover:text-neutral-900 dark:hover:text-neutral-100"
          onclick={() => app.clear()}>Clear</button
        >
      </span>
    </div>
  {/if}

  <footer class="mt-auto pt-10 text-sm text-neutral-500">
    Files are processed on this device and never uploaded.
  </footer>
</div>

{#if dragging && app.items.length}
  <div
    class="pointer-events-none fixed inset-3 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-600 bg-white/70 text-lg font-medium dark:bg-neutral-950/70"
  >
    Drop to add images
  </div>
{/if}

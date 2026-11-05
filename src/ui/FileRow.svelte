<script lang="ts">
  import { formatBytes, formatSaved } from '../lib/format'
  import type { Item } from './app.svelte'

  let { item, onremove }: { item: Item; onremove: () => void } = $props()

  let open = $state(false)
  const primary = $derived(item.primary)
  const saved = $derived(primary ? formatSaved(item.file.size, primary.blob.size) : '—')
  const fraction = $derived(item.progress.total ? item.progress.done / item.progress.total : 0)

  const cell = 'px-3 text-right whitespace-nowrap tabular-nums'
</script>

<tr class="border-b border-neutral-100 dark:border-neutral-900">
  <td class="py-2 pr-3">
    <button
      type="button"
      class="flex w-full items-center gap-3 text-left font-medium disabled:cursor-default"
      aria-expanded={open}
      disabled={item.status !== 'done'}
      onclick={() => (open = !open)}
    >
      <span class="size-8 shrink-0 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-900">
        {#if item.thumb}<img src={item.thumb} alt="" class="size-full object-cover" />{/if}
      </span>
      <span class="truncate">{item.file.name}</span>
    </button>
  </td>
  <td class="hidden sm:table-cell {cell}">
    {item.info ? `${item.info.width} × ${item.info.height}` : ''}
  </td>
  <td class="hidden sm:table-cell {cell}">{formatBytes(item.file.size)}</td>
  <td class={cell}>{primary ? formatBytes(primary.blob.size) : '—'}</td>
  <td class="hidden sm:table-cell {cell}">{saved}</td>
  <td class="pl-3 whitespace-nowrap">
    {#if item.status === 'processing'}
      <span class="flex items-center gap-2 text-neutral-500 tabular-nums">
        <span
          class="h-1 w-12 overflow-hidden rounded-full bg-neutral-200 sm:w-16 dark:bg-neutral-800"
        >
          <span class="block h-full bg-blue-600 transition-[width]" style:width="{fraction * 100}%"
          ></span>
        </span>
        {item.progress.total ? `${item.progress.done} of ${item.progress.total}` : ''}
      </span>
    {:else if item.status === 'error'}
      <span class="block truncate text-red-600 dark:text-red-400" title={item.error}
        >{item.error}</span
      >
    {:else}
      <span class="text-neutral-500">
        {{ reading: 'Reading', queued: 'Queued', done: 'Done' }[item.status]}
      </span>
    {/if}
  </td>
  <td>
    <button
      type="button"
      class="ml-auto flex size-7 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
      aria-label="Remove {item.file.name}"
      onclick={onremove}
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
  </td>
</tr>
{#if open && item.status === 'done'}
  <tr class="border-b border-neutral-100 dark:border-neutral-900">
    <td colspan="7" class="pt-1 pb-3 pl-11">
      <ul class="grid gap-1 text-neutral-500">
        {#each item.outputs as output (output.name)}
          <li
            class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_8rem_5rem_auto]"
          >
            <span class="truncate font-medium text-neutral-900 dark:text-neutral-100"
              >{output.name}</span
            >
            <span class="hidden text-right tabular-nums sm:block"
              >{output.width} × {output.height}</span
            >
            <span class="text-right tabular-nums">{formatBytes(output.blob.size)}</span>
            <a
              class="text-blue-600 hover:underline dark:text-blue-400"
              href={output.url}
              download={output.name}
            >
              Download
            </a>
          </li>
        {/each}
      </ul>
    </td>
  </tr>
{/if}

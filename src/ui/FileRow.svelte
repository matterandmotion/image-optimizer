<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'
  import { formatBytes, formatSaved } from '../lib/format'
  import type { Role } from '../lib/plan'
  import type { Markup } from '../lib/snippet'
  import type { Item, Output } from './app.svelte'
  import InlineSelect from './InlineSelect.svelte'
  import { copy, MARKUPS, ROLES } from './options'

  let {
    item,
    role,
    snippet,
    path,
    markup,
    placeholder,
    onsnippet,
    onrole,
    oncompare,
    onremove,
  }: {
    item: Item
    role: Role
    snippet: string | null
    path: string
    markup: Markup
    placeholder: boolean
    onsnippet: (patch: { path?: string; markup?: Markup; placeholder?: boolean }) => void
    onrole: (role: Role) => void
    oncompare: (output: Output) => void
    onremove: () => void
  } = $props()

  let open = $state(false)
  let copied = $state(false)
  // Original and Saved are hidden below `sm`; the detail row must span only the visible
  // columns, or the table grows phantom columns that squeeze the file name.
  const wide = new MediaQuery('min-width: 40rem')
  const primary = $derived(item.primary)
  const saved = $derived(primary ? formatSaved(item.file.size, primary.blob.size) : '—')
  const fraction = $derived(item.progress.total ? item.progress.done / item.progress.total : 0)

  async function copySnippet() {
    if (snippet && (await copy(snippet))) {
      copied = true
      setTimeout(() => (copied = false), 1500)
    }
  }

  const cell = 'px-3 text-right whitespace-nowrap tabular-nums'
</script>

<tr class="border-b border-neutral-100 dark:border-neutral-900">
  <td class="py-2 pr-3">
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="size-9 shrink-0 overflow-hidden rounded bg-neutral-100 enabled:cursor-zoom-in disabled:cursor-default dark:bg-neutral-900"
        aria-label="Compare {item.file.name} with the original"
        disabled={!primary}
        onclick={() => primary && oncompare(primary)}
      >
        {#if item.thumb}<img src={item.thumb} alt="" class="size-full object-cover" />{/if}
      </button>
      <div class="min-w-0 flex-1">
        <button
          type="button"
          class="block max-w-full truncate text-left font-medium enabled:hover:underline disabled:cursor-default"
          aria-expanded={open}
          disabled={item.status !== 'done'}
          onclick={() => (open = !open)}
        >
          {item.file.name}
        </button>
        {#if item.info}
          <div class="flex items-center gap-1.5 text-xs text-neutral-500">
            <span class="hidden whitespace-nowrap tabular-nums sm:inline"
              >{item.info.width} × {item.info.height}</span
            >
            <span class="hidden sm:inline" aria-hidden="true">·</span>
            <InlineSelect
              label="Role for {item.file.name}"
              value={role}
              options={ROLES}
              onchange={onrole}
            />
          </div>
        {/if}
      </div>
    </div>
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
        <span class="hidden sm:inline"
          >{item.progress.total ? `${item.progress.done} of ${item.progress.total}` : ''}</span
        >
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
    <td colspan={wide.current ? 6 : 4} class="pt-1 pb-4 pl-12">
      <ul class="grid gap-1 text-neutral-500">
        {#each item.outputs as output (output.name)}
          <li
            class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_8rem_5rem_auto_auto]"
          >
            <span class="truncate font-medium text-neutral-900 dark:text-neutral-100"
              >{output.name}</span
            >
            <span class="hidden text-right tabular-nums sm:block"
              >{output.width} × {output.height}</span
            >
            <span class="text-right tabular-nums">{formatBytes(output.blob.size)}</span>
            <button
              type="button"
              class="text-blue-600 hover:underline dark:text-blue-400"
              aria-label="Compare {output.name}"
              onclick={() => oncompare(output)}
            >
              Compare
            </button>
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
      {#if snippet}
        <div class="mt-3 rounded-md bg-neutral-50 dark:bg-neutral-900">
          <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pt-2 text-xs text-neutral-500"
          >
            <InlineSelect
              label="Markup"
              title="HTML also works in Astro, Svelte and Vue templates. JSX is for React."
              class="font-medium"
              value={markup}
              options={MARKUPS}
              onchange={(markup) => onsnippet({ markup })}
            />
            <label
              class="flex items-center gap-1.5"
              title="Where the images will live on your site"
            >
              <span>Path</span>
              <input
                class="w-28 rounded border border-neutral-200 bg-white px-1.5 py-0.5 font-mono text-neutral-900 outline-none focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
                value={path}
                spellcheck="false"
                oninput={(e) => onsnippet({ path: e.currentTarget.value })}
              />
            </label>
            {#if item.info?.colour}
              <label
                class="flex items-center gap-1.5"
                title="Shows the image’s average colour until it has loaded, as an inline style"
              >
                <input
                  type="checkbox"
                  class="accent-blue-600"
                  checked={placeholder}
                  onchange={(e) => onsnippet({ placeholder: e.currentTarget.checked })}
                />
                <span>Placeholder</span>
                <span
                  class="size-3 rounded-sm ring-1 ring-black/10 ring-inset dark:ring-white/15"
                  style:background-color={item.info.colour}
                ></span>
              </label>
            {/if}
            <button
              type="button"
              class="ml-auto font-medium hover:text-neutral-900 dark:hover:text-neutral-100"
              onclick={copySnippet}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre
            class="px-3 pt-1.5 pb-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{snippet}</pre>
        </div>
      {/if}
    </td>
  </tr>
{/if}

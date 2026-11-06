<script lang="ts" generics="T extends string | number">
  let {
    label,
    value,
    options,
    onchange,
  }: {
    label: string
    value: T
    options: readonly { value: T; label: string }[]
    onchange: (value: T) => void
  } = $props()
</script>

<label
  class="relative inline-flex items-center gap-1.5 rounded-md border border-neutral-200 py-1.5 pr-7 pl-2.5 text-sm focus-within:outline-2 focus-within:outline-blue-600 dark:border-neutral-800"
>
  <span class="text-neutral-500 dark:text-neutral-400">{label}</span>
  <select
    class="cursor-pointer appearance-none bg-transparent font-medium outline-none"
    onchange={(e) => onchange(options[e.currentTarget.selectedIndex].value)}
  >
    {#each options as option (option.value)}
      <option selected={option.value === value}>{option.label}</option>
    {/each}
  </select>
  <svg
    class="pointer-events-none absolute right-2 size-3.5 text-neutral-400"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    aria-hidden="true"
  >
    <path d="m4 6 4 4 4-4" />
  </svg>
</label>

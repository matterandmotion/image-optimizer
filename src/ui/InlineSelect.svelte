<script lang="ts" generics="T extends string | number">
  // A borderless select that reads as part of a line of small text.
  let {
    label,
    value,
    options,
    onchange,
    title,
    disabled = false,
    class: className = '',
  }: {
    /** For screen readers; not shown. */
    label: string
    value: T
    options: readonly { value: T; label: string }[]
    onchange: (value: T) => void
    title?: string
    disabled?: boolean
    class?: string
  } = $props()
</script>

<label class="relative inline-flex items-center" {title}>
  <span class="sr-only">{label}</span>
  <select
    class="cursor-pointer appearance-none bg-transparent pr-3.5 focus-visible:outline-2 focus-visible:outline-blue-600 enabled:hover:text-neutral-900 disabled:cursor-default dark:enabled:hover:text-neutral-100 {className}"
    {disabled}
    onchange={(e) => onchange(options[e.currentTarget.selectedIndex].value)}
  >
    {#each options as option (option.value)}
      <option selected={option.value === value}>{option.label}</option>
    {/each}
  </select>
  <svg
    class="pointer-events-none absolute right-0 size-3"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    aria-hidden="true"
  >
    <path d="m4 6 4 4 4-4" />
  </svg>
</label>

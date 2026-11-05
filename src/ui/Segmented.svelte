<script lang="ts" generics="T extends string">
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

<div
  role="radiogroup"
  aria-label={label}
  class="inline-flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-900"
>
  {#each options as option (option.value)}
    <button
      type="button"
      role="radio"
      aria-checked={option.value === value}
      onclick={() => onchange(option.value)}
      class={[
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-blue-600',
        option.value === value
          ? 'bg-white text-neutral-900 shadow-xs dark:bg-neutral-800 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100',
      ]}
    >
      {option.label}
    </button>
  {/each}
</div>

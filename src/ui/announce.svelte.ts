/**
 * Text for a visually hidden live region, for changes a screen reader wouldn't otherwise hear
 * about, such as a Copy button briefly reading "Copied".
 */
class Announcer {
  text = $state('')
  #timer: ReturnType<typeof setTimeout> | undefined

  say(text: string) {
    // Setting the same text twice isn't announced, so clear it first and set it a moment later.
    this.text = ''
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => (this.text = text), 50)
  }
}

export const announcer = new Announcer()

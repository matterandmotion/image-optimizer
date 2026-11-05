/**
 * Registers the service worker (production builds only) and reports what it means for the
 * page: whether the app now works offline, and whether a new version is waiting.
 */
export class Offline {
  /** The app and its engines are cached; it will open and work without a connection. */
  ready = $state(false)
  /** A newer version is installed and starts on reload. */
  update = $state(false)

  private registration: ServiceWorkerRegistration | undefined
  private reloading = false

  constructor() {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    // Precaching downloads both engines up front (about 5 MB); skip it when data is metered.
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return
    // After load, so the precache doesn't compete with the page's own first requests.
    if (document.readyState === 'complete') void this.register()
    else addEventListener('load', () => void this.register(), { once: true })
  }

  /** Switches to the waiting version and reloads into it. */
  apply() {
    const waiting = this.registration?.waiting
    if (!waiting) return location.reload()
    this.reloading = true
    waiting.postMessage({ type: 'skip-waiting' })
  }

  private async register() {
    const sw = navigator.serviceWorker
    sw.addEventListener('controllerchange', () => {
      if (this.reloading) location.reload()
    })
    try {
      const registration = await sw.register(`${import.meta.env.BASE_URL}sw.js`)
      this.registration = registration
      // A worker that finishes installing while another one controls the page is an update.
      const track = (worker: ServiceWorker | null) => {
        if (!worker) return
        const check = () => {
          if (worker.state === 'installed' && sw.controller) this.update = true
        }
        check()
        worker.addEventListener('statechange', check)
      }
      track(registration.waiting)
      track(registration.installing)
      registration.addEventListener('updatefound', () => track(registration.installing))
      // Resolves once a worker is active, which means everything was precached.
      await sw.ready
      this.ready = true
    } catch {
      // Offline support is a bonus: private windows and some browsers refuse it.
    }
  }
}

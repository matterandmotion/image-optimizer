import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the production build (`vite preview` applies public/_headers),
// so the CSP and cross-origin isolation are exercised too.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})

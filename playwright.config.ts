import { defineConfig } from '@playwright/test'

const PORT = 4173

// The e2e tests mock the Supabase HTTP API (see tests/e2e/mock.ts), so no
// backend is needed. The app is built against a fake Supabase URL.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'off',
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'http://supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key',
    },
  },
})

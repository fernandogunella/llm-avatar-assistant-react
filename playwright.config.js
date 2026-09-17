import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the live E2E suite.
 *
 * The dev server is launched automatically (Vite + the /v1 -> llama.cpp proxy
 * from vite.config.js, which reads .env.local for target/key/model). The E2E
 * test then drives the real component against the real model and verifies the
 * response + automatic section scroll.
 *
 * NOTE: these tests hit a real local model, so they are gated behind the
 * `live` project and are skipped when LLM_E2E=0, letting `npm test` (unit
 * only) and `npm run e2e` (live) stay independent.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,               // local models can be slow on first token
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // Use headless Chromium. WebGL for the 3D avatar is not required for the
    // E2E assertions (we check DOM, not pixels); headless works.
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...process.env, VITE_LLM_MODEL: process.env.VITE_LLM_MODEL || 'FG-Inteligencia' },
  },
});

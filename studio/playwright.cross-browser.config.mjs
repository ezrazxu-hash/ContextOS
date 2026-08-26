import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "cross-browser-smoke.spec.mjs",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          env: {
            MOZ_DISABLE_CONTENT_SANDBOX: "1",
          },
        },
      },
    },
  ],
});

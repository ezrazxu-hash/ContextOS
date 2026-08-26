export default {
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
};

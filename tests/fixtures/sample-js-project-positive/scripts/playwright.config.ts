
declare const process: { env: Record<string, string | undefined> };

function getWorkerCount() {
  const envVal = process.env.TEST_WORKERS;
  if (!envVal) return 4;
  return parseInt(envVal, 10);
}

function getRetryCount() {
  return process.env.CI ? 2 : 0;
}

const playwrightConfig = {
  workers: getWorkerCount(),
  retries: getRetryCount(),
  timeout: 30_000,
};



declare const devices: Record<string, unknown>;
declare function defineConfig(cfg: unknown): unknown;

// Playwright testMatch/testIgnore with ASCII file-path regex — unicode flag irrelevant.
export default defineConfig({
  projects: [
    {
      name: 'e2e-api',
      testMatch: /e2e\/api\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'e2e-ui',
      testMatch: /e2e\/(?!api\/).*\.spec\.ts/,
      testIgnore: /e2e\/fixtures\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

/** Written by test/playwright/auth.setup.ts, consumed by the e2e project. */
const STORAGE_STATE = 'test/playwright/.artifacts/auth.json';

/**
 * Playwright E2E config.
 *
 * Browser: uses the SYSTEM-INSTALLED Edge via the `msedge` channel, so Playwright
 * never downloads a browser (~150MB). Verified that `chromium.launch({ channel })`
 * works on this machine while %LOCALAPPDATA%\ms-playwright stays empty.
 * Swap `channel` to 'chrome' for Google Chrome - also no download.
 *
 * Run with:  npx playwright test
 * Headed by default so failures can be watched live.
 */
export default defineConfig({
    testDir: './test/playwright',
    // Screenshots / traces land here; per-test failure shots go to
    // test/playwright/<test-name>/error (see _fixtures.ts).
    outputDir: './test/playwright/.artifacts',
    fullyParallel: false,
    // The lifecycle mutates shared rows (DO status, trip closure, invoice links).
    // Running one worker at a time keeps runs deterministic.
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    // Step 4 drives three batch transitions with a reload after each, so it
    // legitimately needs ~60s. 120s was tight enough to flake on a busy machine.
    timeout: 240_000,
    expect: { timeout: 15_000 },
    reporter: [
        ['list'],
        ['html', { outputFolder: './test/playwright/.artifacts-report', open: 'never' }],
    ],
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
        channel: 'msedge',
        headless: !!process.env.CI,
        actionTimeout: 20_000,
        navigationTimeout: 45_000,
        screenshot: 'only-on-failure',
        // Video needs Playwright's bundled ffmpeg, which lives in the browser
        // cache we deliberately do not download. Trace + screenshots cover
        // debugging without it.
        video: 'off',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
        },
        {
            name: 'e2e',
            testIgnore: /auth\.setup\.ts/,
            dependencies: ['setup'],
            use: {
                ...devices['Desktop Chrome'],
                storageState: STORAGE_STATE,
            },
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000/login',
        reuseExistingServer: true,
        timeout: 180_000,
    },
});
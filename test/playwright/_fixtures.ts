import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_STATE_PATH = 'test/playwright/.artifacts/auth.json';

/**
 * Per-page diagnostics collected by the `page` fixture and consumed by the
 * auto-screenshot fixture. A WeakMap keeps the data tied to the page instance
 * instead of leaking across tests (module scope would be shared state).
 */
type Diagnostics = {
    consoleErrors: string[];
    failedRequests: string[];
    failedResponses: string[];
};

const diagnostics = new WeakMap<Page, Diagnostics>();

function collect(page: Page): Diagnostics {
    let entry = diagnostics.get(page);
    if (!entry) {
        entry = { consoleErrors: [], failedRequests: [], failedResponses: [] };
        diagnostics.set(page, entry);
        page.on('console', msg => {
            if (msg.type() === 'error') entry!.consoleErrors.push(msg.text());
        });
        page.on('requestfailed', req => {
            entry!.failedRequests.push(
                `${req.method()} ${req.url()} :: ${req.failure()?.errorText ?? 'unknown'}`
            );
        });
        page.on('response', res => {
            if (res.status() >= 400) {
                entry!.failedResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
            }
        });
    }
    return entry;
}

/**
 * Fixture that, on failure, writes into test/playwright/<spec-folder>/error/:
 *   <test-title>.png   full-page screenshot
 *   <test-title>.log   console errors + failed/4xx-5xx network calls
 *
 * The folder comes from the spec file location, so
 *   test/playwright/mitra-trip-lifecycle/mitra-trip.spec.ts
 * writes failures to test/playwright/mitra-trip-lifecycle/error/.
 */
export const test = base.extend<{ autoScreenshot: void }>({
    page: async ({ page }, use) => {
        collect(page);
        await use(page);
    },

    autoScreenshot: [
        async ({ page }, use, testInfo: TestInfo) => {
            await use();

            if (testInfo.status === testInfo.expectedStatus) return;

            const errorDir = path.join(path.dirname(testInfo.file), 'error');
            fs.mkdirSync(errorDir, { recursive: true });

            const slug = testInfo.titlePath
                .slice(1)
                .join(' > ')
                .replace(/[\\/:*?"<>|]+/g, '-')
                .replace(/\s+/g, '-')
                .slice(0, 120) || 'unnamed';

            const shotPath = path.join(errorDir, `${slug}.png`);
            try {
                await page.screenshot({ path: shotPath, fullPage: true, timeout: 15_000 });
                await testInfo.attach('failure-screenshot', { path: shotPath, contentType: 'image/png' });
            } catch (error) {
                testInfo.annotations.push({
                    type: 'screenshot-error',
                    description: String(error).slice(0, 300),
                });
            }

            const diag = diagnostics.get(page);
            const lines = [
                ...(diag?.consoleErrors ?? []).map(t => `[console.error] ${t}`),
                ...(diag?.failedRequests ?? []).map(t => `[requestfailed] ${t}`),
                ...(diag?.failedResponses ?? []).map(t => `[http] ${t}`),
            ];
            if (lines.length > 0) {
                const logPath = path.join(errorDir, `${slug}.log`);
                fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
                await testInfo.attach('failure-log', { path: logPath, contentType: 'text/plain' });
            }
        },
        { auto: true },
    ],
});

export { expect };

/* ------------------------------------------------------------------ */
/* Shared UI helpers                                                   */
/* ------------------------------------------------------------------ */

/** Waits for a toast matching `matcher` and returns its text. */
export async function expectToast(page: Page, matcher: RegExp, timeout = 20_000): Promise<string> {
    const toast = page.locator('.toast-message');
    await expect(toast.first()).toBeVisible({ timeout });
    const texts = await toast.allInnerTexts();
    const match = texts.find(t => matcher.test(t));
    if (!match) {
        throw new Error(`Expected a toast matching ${matcher} but got ${JSON.stringify(texts)}`);
    }
    return match;
}

/** Requires the matching toast to be a SUCCESS toast, not an error toast. */
export async function expectSuccessToast(page: Page, matcher: RegExp, timeout = 20_000): Promise<string> {
    const text = await expectToast(page, matcher, timeout);
    const asError = await page
        .locator('.toast.error')
        .filter({ has: page.locator('.toast-message', { hasText: matcher }) })
        .count();
    if (asError > 0) {
        throw new Error(`Toast matched ${matcher} but rendered as an error toast: "${text}"`);
    }
    return text;
}

/**
 * Picks an option from the app's Combobox.
 * The Combobox input has NO accessible name (no id, no aria-label, and the
 * codebase has zero htmlFor), so it is addressed by placeholder only.
 */
export async function selectComboboxOption(
    page: Page,
    placeholder: string,
    optionText: string | RegExp
): Promise<void> {
    const input = page.getByPlaceholder(placeholder, { exact: true }).first();
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.click();
    const option = page.getByRole('option', { name: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 20_000 });
    await option.click();
    await expect(input).not.toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
}

/** Fills a date input located by its container (date inputs have no labels). */
export async function fillDateInput(page: Page, container: string, value: string): Promise<void> {
    const input = page.locator(`${container} input[type="date"]`).first();
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.fill(value);
}

/** Local YYYY-MM-DD, matching the app's <input type="date"> expectations. */
export function today(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function randomSuffix(): string {
    const stamp = Date.now().toString(36);
    const rand = Math.floor(Math.random() * 46_656).toString(36).padStart(3, '0');
    return `${stamp}${rand}`;
}
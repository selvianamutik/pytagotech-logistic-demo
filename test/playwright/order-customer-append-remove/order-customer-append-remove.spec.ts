import path from 'node:path';
import fs from 'node:fs';
import {
    test,
    expect,
    selectComboboxOption,
} from '../_fixtures';

type RunContext = { resi: string; orderId: string; tripId: string };

/**
 * Order customer append/remove E2E (post-DO, no locks), run once per trip
 * ownership flavor:
 *   1. create single-customer order with a trip plan
 *   2. materialize the trip plan into a real trip
 *   3. append a second customer from the order detail page (Tambah),
 *      assert badges + propagation to the trip page
 *   4. remove the second customer via the badge x, assert badges +
 *      trip page clean again; primary has no x button
 *
 * Customer add/remove works regardless of DO existence; only cancelled
 * orders, unknown customers, the primary, and the cap of 5 are guarded.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const PRIMARY_CUSTOMER = process.env.E2E_CUSTOMER_A ?? 'PT Pangan Nusantara';
const ADDED_CUSTOMER = process.env.E2E_CUSTOMER_B ?? 'CV Sembada Plastik';
const PICKUP_ADDRESS =
    process.env.E2E_PICKUP_ADDRESS ?? 'Jl. Test Append E2E No. 1, Surabaya, Jawa Timur';

// NOTE: process.pid alone is NOT unique across runs (OS recycles pids), so a
// timestamp is included — otherwise a rerun can 409 against its own placeholder
// from an earlier run. The suite tag keeps the two suites in one run distinct.
function placeholderSjNumber(suiteTag: string) {
    return process.env.E2E_PLACEHOLDER_SJ ??
        `SJ/PROCESS/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${process.pid}-${Date.now().toString(36).toUpperCase()}-${suiteTag}`;
}

function defineCustomerAppendRemoveSuite(suiteTitle: string, useMitraTrip: boolean) {
    const suiteTag = useMitraTrip ? 'M' : 'I';
    test.describe(suiteTitle, () => {
        test.describe.configure({ mode: 'serial' });

        const ctx: RunContext = { resi: '', orderId: '', tripId: '' };
        let tripUrl = '';
        let orderUrl = '';

        test(`1. create single-customer order with ${useMitraTrip ? 'a MITRA' : 'an INTERNAL'} trip plan`, async ({ page }) => {
            await page.goto(`${BASE_URL}/orders/new`);
            await expect(page.getByRole('heading', { name: 'Buat Order Baru' })).toBeVisible({ timeout: 30_000 });

            await selectCustomerByName(page, 'Pilih customer', PRIMARY_CUSTOMER);

            const category = page.getByPlaceholder('Pilih kategori armada', { exact: true }).first();
            await category.waitFor({ state: 'visible', timeout: 30_000 });
            await category.click();
            await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 20_000 });
            await page.getByRole('option').first().click();

            await page
                .getByPlaceholder('Alamat lokasi pengambilan barang', { exact: true })
                .fill(PICKUP_ADDRESS);

            await page.getByRole('button', { name: /Tambah Trip/ }).click();

            if (useMitraTrip) {
                const mitraRadio = page.getByRole('radio', { name: 'Mitra', exact: true });
                await expect(mitraRadio).toBeVisible({ timeout: 20_000 });
                if ((await mitraRadio.getAttribute('aria-checked')) !== 'true') {
                    await mitraRadio.click();
                }
            } else {
                // INTERNAL trip: fleet, wage and cash stay visible.
                await selectComboboxOption(page, 'Pilih kendaraan', /.+/);
                await selectComboboxOption(page, 'Pilih supir', /.+/);

                // Armada-category override reason only appears on service mismatch.
                await page.waitForTimeout(1500);
                const overrideReason = page.getByPlaceholder('Mis. armada sesuai tidak tersedia atau load harus dipecah', { exact: true });
                if (await overrideReason.count()) {
                    await overrideReason.first().fill('E2E internal trip');
                }

                await page.getByPlaceholder('Isi upah trip', { exact: true }).fill('1000000');
                await selectComboboxOption(page, 'Pilih sumber uang jalan', /.+/);
                await page.getByPlaceholder('Isi uang jalan awal', { exact: true }).fill('500000');
            }

            const pickupCheckbox = page.getByRole('checkbox', { name: /^Pickup 1/ }).first();
            await expect(pickupCheckbox).toBeVisible({ timeout: 20_000 });
            if (!(await pickupCheckbox.isChecked())) {
                await pickupCheckbox.check();
            }

            const saveOrder = page.getByRole('button', { name: /Simpan Order/ });
            await expect(saveOrder).toBeEnabled({ timeout: 30_000 });
            await saveOrder.click();

            const toast = page.locator('.toast.success .toast-message');
            await expect(toast.first()).toBeVisible({ timeout: 45_000 });
            const toastText = await toast.first().innerText();
            const match = toastText.match(/Order dibuat:\s*(\S+)/);
            if (!match) {
                throw new Error(`Could not parse resi from success toast: "${toastText}"`);
            }
            ctx.resi = match[1];

            await page.waitForURL(/\/orders\/[a-f0-9-]{36}/i, {
                waitUntil: 'commit',
                timeout: 45_000,
            });
            orderUrl = page.url();
            ctx.orderId = orderUrl.slice(orderUrl.lastIndexOf('/') + 1);

            expect(ctx.resi).toBeTruthy();
        });

    test('2. materialize the trip plan into a real trip', async ({ page }) => {
        if (!ctx.orderId) throw new Error('orderId is not set - step 1 must run first');
        const placeholderSj = placeholderSjNumber(suiteTag);
        await page.goto(`${BASE_URL}/orders/${ctx.orderId}`, { waitUntil: 'commit' });

            const inputButton = page.getByRole('button', { name: /Input Surat Jalan/ }).first();
            await inputButton.waitFor({ state: 'visible', timeout: 45_000 });
            await inputButton.click();

            const modal = page.locator('.modal').filter({ hasText: /Input Surat Jalan/ });
            await expect(modal).toBeVisible({ timeout: 20_000 });

            await modal
                .getByPlaceholder('Mis. SJ/27032026/001', { exact: true })
                .first()
                .fill(placeholderSj.toUpperCase());

            await modal.getByRole('button', { name: /Input Surat Jalan/ }).last().click();

            const toast = page.locator('.toast.success .toast-message').filter({ hasText: /Trip dibuat/ }).first();
            await expect(toast).toBeVisible({ timeout: 60_000 });

            const tripLink = page.locator('a[href^="/delivery-orders/"]').first();
            await tripLink.waitFor({ state: 'visible', timeout: 45_000 });
            ctx.tripId = (await tripLink.getAttribute('href'))!
                .replace('/delivery-orders/', '')
                .split('?')[0];
            tripUrl = `${BASE_URL}/trips/${ctx.tripId}`;

            expect(ctx.tripId).toMatch(/^[a-f0-9-]{36}$/i);
        });

        test('3. append a second customer from order detail, assert trip propagation', async ({ page }) => {
            await page.goto(`${BASE_URL}/orders/${ctx.orderId}`, { waitUntil: 'commit' });
            await expect(page.getByText(ctx.resi, { exact: false }).first()).toBeVisible({ timeout: 45_000 });

            // Only the primary shows before appending.
            await expect(page.getByText(ADDED_CUSTOMER, { exact: false })).toHaveCount(0, { timeout: 15_000 });

            await page.getByRole('button', { name: /^Tambah$/ }).click();
            await selectComboboxOption(page, 'Pilih customer...', new RegExp(escapeRegExp(ADDED_CUSTOMER)));
            await page.getByRole('button', { name: /^Simpan$/ }).click();

            await expect(page.locator('.toast.success .toast-message').filter({ hasText: /ditambahkan ke order/ }).first())
                .toBeVisible({ timeout: 30_000 });

            // Badge renders on the order...
            await expect(page.getByText(ADDED_CUSTOMER, { exact: false }).first()).toBeVisible({ timeout: 30_000 });

            // ...and the trip page sees the new customer (propagation).
            await page.goto(tripUrl, { waitUntil: 'commit' });
            await expect(page.getByRole('button', { name: /Tambah SJ/ })).toBeVisible({ timeout: 45_000 });
            await expect(page.getByText(ADDED_CUSTOMER, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
        });

        test('4. remove the second customer, assert trip is clean, primary has no x', async ({ page }) => {
            await page.goto(`${BASE_URL}/orders/${ctx.orderId}`, { waitUntil: 'commit' });
            await expect(page.getByText(ADDED_CUSTOMER, { exact: false }).first()).toBeVisible({ timeout: 45_000 });

            // The primary customer badge must never offer removal.
            const primaryRemove = page.getByRole('button', { name: new RegExp(`^Hapus customer ${escapeRegExp(PRIMARY_CUSTOMER)}$`) });
            await expect(primaryRemove).toHaveCount(0);

            await page.getByRole('button', { name: new RegExp(`^Hapus customer ${escapeRegExp(ADDED_CUSTOMER)}$`) }).click();

            await expect(page.locator('.toast.success .toast-message').filter({ hasText: /dihapus dari order/ }).first())
                .toBeVisible({ timeout: 30_000 });

            await expect(page.getByText(ADDED_CUSTOMER, { exact: false })).toHaveCount(0, { timeout: 30_000 });

            // Propagation: the trip page no longer lists the removed customer.
            await page.goto(tripUrl, { waitUntil: 'commit' });
            await expect(page.getByRole('button', { name: /Tambah SJ/ })).toBeVisible({ timeout: 45_000 });
            await expect(page.getByText(ADDED_CUSTOMER, { exact: false })).toHaveCount(0, { timeout: 30_000 });
        });

        test.afterAll(() => {
            const summary = {
                resi: ctx.resi,
                orderId: ctx.orderId,
                tripId: ctx.tripId,
                orderUrl,
                tripUrl,
            };
            if (!ctx.resi) return;
            const file = path.join(__dirname, 'last-run.json');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
            console.log(`\nCustomer append/remove run (${suiteTitle}):`, JSON.stringify(summary));
        });
    });
}

defineCustomerAppendRemoveSuite('Order customer append/remove (MITRA trip)', true);
defineCustomerAppendRemoveSuite('Order customer append/remove (INTERNAL trip)', false);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function selectCustomerByName(page: import('@playwright/test').Page, placeholder: string, name: string) {
    const input = page.getByPlaceholder(placeholder, { exact: true }).first();
    await input.waitFor({ state: 'visible', timeout: 30_000 });
    await input.click();
    await input.fill(name);

    const option = page.getByRole('option', { name: new RegExp(escapeRegExp(name)) }).first();
    await option.waitFor({ state: 'visible', timeout: 30_000 });
    await option.click();
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

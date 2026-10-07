import path from 'node:path';
import fs from 'node:fs';
import {
    test,
    expect,
    selectComboboxOption,
} from '../_fixtures';

type RunContext = { resi: string; orderId: string; tripId: string };
const ctx: RunContext = { resi: '', orderId: '', tripId: '' };

/**
 * Multi-customer billing E2E:
 *   1. create INTERNAL order with TWO customers + trip plan
 *   2. materialize that plan into a real trip
 *   3. create 2 surat jalan on the trip
 *   4. advance both SJs to ARRIVED
 *   5. finalize SJ-1 to DELIVERED, billing it to customer A
 *   6. finalize SJ-2 to DELIVERED, billing it to customer B
 *   7. tutup trip
 *   8. invoice customer A (SJ-1 only; SJ-2 must be absent), settle in full
 *   9. invoice customer B (SJ-2 only; SJ-1 must be consumed), settle in full
 *
 * This proves the multi-customer billing contract end to end: one SJ is a
 * billing candidate on either trip customer's invoice, but is consumed once,
 * on exactly one of them (Rule 4), and each invoice settles independently.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const CUSTOMER_A = process.env.E2E_CUSTOMER_A ?? 'PT Pangan Nusantara';
const CUSTOMER_B = process.env.E2E_CUSTOMER_B ?? 'CV Sembada Plastik';
const PICKUP_ADDRESS =
    process.env.E2E_PICKUP_ADDRESS ?? 'Jl. Test Multi E2E No. 1, Surabaya, Jawa Timur';

const SJ_NUMBERS = {
    first: process.env.E2E_SJ_1 ?? '',
    second: process.env.E2E_SJ_2 ?? '',
};

// NOTE: process.pid alone is NOT unique across runs (OS recycles pids), so a
// timestamp is included — otherwise a rerun can 409 against its own placeholder
// from an earlier run.
const PLACEHOLDER_SJ_NUMBER =
    process.env.E2E_PLACEHOLDER_SJ ??
    `SJ/PROCESS/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${process.pid}-${Date.now().toString(36).toUpperCase()}`;

test.describe('Multi-customer billing', () => {
    test.describe.configure({ mode: 'serial' });

    let tripUrl = '';
    let orderUrl = '';
    let invoiceAUrl = '';
    let invoiceBUrl = '';

    test.beforeAll(async () => {
        test.skip(
            !SJ_NUMBERS.first || !SJ_NUMBERS.second,
            'Set E2E_SJ_1, E2E_SJ_2 to run this spec'
        );
    });

    test('1. create INTERNAL order with two customers and a trip plan', async ({ page }) => {
        await page.goto(`${BASE_URL}/orders/new`);
        await expect(page.getByRole('heading', { name: 'Buat Order Baru' })).toBeVisible({ timeout: 30_000 });

        // --- primary customer -------------------------------------------------
        await selectCustomerByName(page, 'Pilih customer', CUSTOMER_A);

        // --- second customer (chip) -------------------------------------------
        await selectComboboxOption(page, 'Tambah customer lain', new RegExp(escapeRegExp(CUSTOMER_B)));
        await expect(page.getByText(CUSTOMER_B, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

        // --- armada category (first option is the seed "Reguler" service) -----
        const category = page.getByPlaceholder('Pilih kategori armada', { exact: true }).first();
        await category.waitFor({ state: 'visible', timeout: 30_000 });
        await category.click();
        await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 20_000 });
        await page.getByRole('option').first().click();

        // --- pickup point ------------------------------------------------------
        await page
            .getByPlaceholder('Alamat lokasi pengambilan barang', { exact: true })
            .fill(PICKUP_ADDRESS);

        // --- INTERNAL trip plan (default ownership; MITRA would hide fleet) ---
        await page.getByRole('button', { name: /Tambah Trip/ }).click();

        const pickupCheckbox = page.getByRole('checkbox', { name: /^Pickup 1/ }).first();
        await expect(pickupCheckbox).toBeVisible({ timeout: 20_000 });
        if (!(await pickupCheckbox.isChecked())) {
            await pickupCheckbox.check();
        }

        // Vehicle + driver: first available options.
        await selectComboboxOption(page, 'Pilih kendaraan', /.+/);
        await selectComboboxOption(page, 'Pilih supir', /.+/);

        // Armada-category override reason only appears on service mismatch.
        const overrideReason = page.getByPlaceholder('Mis. armada sesuai tidak tersedia atau load harus dipecah', { exact: true });
        if (await overrideReason.count()) {
            await overrideReason.first().fill('E2E: kategori armadaίκ tersedia, pakai yang ada');
        }

        // Wage + cash + source bank.
        await page.getByPlaceholder('Isi upah trip', { exact: true }).fill('1000000');
        await selectComboboxOption(page, 'Pilih sumber uang jalan', /.+/);
        await page.getByPlaceholder('Isi uang jalan awal', { exact: true }).fill('500000');

        // --- save -----------------------------------------------------------
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
        expect(ctx.orderId).toMatch(/^[a-f0-9-]{36}$/i);
    });

    test('2. materialize the trip plan into a real trip', async ({ page }) => {
        if (!ctx.orderId) throw new Error('orderId is not set - step 1 must run first');
        await page.goto(`${BASE_URL}/orders/${ctx.orderId}`, { waitUntil: 'commit' });

        const inputButton = page.getByRole('button', { name: /Input Surat Jalan/ }).first();
        await inputButton.waitFor({ state: 'visible', timeout: 45_000 });
        await inputButton.click();

        const modal = page.locator('.modal').filter({ hasText: /Input Surat Jalan/ });
        await expect(modal).toBeVisible({ timeout: 20_000 });

        await modal
            .getByPlaceholder('Mis. SJ/27032026/001', { exact: true })
            .first()
            .fill(PLACEHOLDER_SJ_NUMBER.toUpperCase());

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

    test('3. create 2 surat jalan on the trip', async ({ page }) => {
        await openTripDetail(page);

        const created: string[] = [];
        for (const [index, sjNumber] of [SJ_NUMBERS.first, SJ_NUMBERS.second].entries()) {
            await page.getByRole('button', { name: /Tambah SJ/ }).first().click();

            const modal = page.locator('.modal').filter({ hasText: 'Tambah Surat Jalan' });
            await expect(modal).toBeVisible({ timeout: 20_000 });

            await modal
                .getByPlaceholder('Contoh: SJ/27032026/001', { exact: true })
                .fill(sjNumber.toUpperCase());

            // "Tambah manual" keeps the test independent of master barang data.
            const masterBarang = modal.getByPlaceholder(/Pilih master barang|Belum ada master barang/).first();
            await expect(masterBarang).toBeVisible({ timeout: 20_000 });
            await masterBarang.click();
            const manualOption = page.getByRole('option', { name: 'Tambah manual' }).first();
            await manualOption.waitFor({ state: 'visible', timeout: 20_000 });
            await manualOption.click();

            await modal
                .getByPlaceholder('Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik', { exact: true })
                .fill(`Barang Uji E2E Multi ${index + 1}`);

            await fillGroupNumber(modal, 'Koli', '1');
            await fillGroupNumber(modal, 'Berat', '1000');
            await fillGroupNumber(modal, 'Volume', '1');

            await modal.getByRole('button', { name: /^Buat SJ$/ }).click();

            await page.waitForTimeout(8_000);
            created.push(sjNumber);

            await page.reload({ waitUntil: 'commit' });
            await expect(page.getByText(sjNumber, { exact: false }).first()).toBeVisible({
                timeout: 60_000,
            });
        }

        expect(created).toHaveLength(2);
    });

    test('4. advance both SJs to ARRIVED', async ({ page }) => {
        await openTripDetail(page);

        for (const target of ['Dalam Pengiriman', 'Tiba di Tujuan']) {
            const batchButton = page.getByRole('button', { name: /Update Batch SJ/ }).first();
            await expect(batchButton).toBeVisible({ timeout: 30_000 });
            await batchButton.click();

            const modal = page.locator('.modal').filter({ hasText: /Batch SJ/ }).first();
            await expect(modal).toBeVisible({ timeout: 20_000 });

            await selectComboboxOption(page, 'Pilih status', new RegExp(`^${target}$`));
            await fillPodDetails(modal);

            await modal.getByRole('button', { name: /Lanjut Aktual Barang|Simpan Batch SJ/ }).first()
                .click({ timeout: 15_000 });

            await page.waitForTimeout(6_000);
            await page.reload({ waitUntil: 'commit' });
            await page.getByRole('button', { name: /Tambah SJ/ }).first()
                .waitFor({ state: 'visible', timeout: 60_000 });
        }

        await expect(page.getByText('Tiba di Tujuan', { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    });

    test('5. finalize SJ-1 to DELIVERED billing customer A', async ({ page }) => {
        await finalizeSingleSj(page, SJ_NUMBERS.first, SJ_NUMBERS.second, CUSTOMER_A, 'Gudang Customer A');
        await expect(page.getByText(SJ_NUMBERS.first, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    });

    test('6. finalize SJ-2 to DELIVERED billing customer B', async ({ page }) => {
        await finalizeSingleSj(page, SJ_NUMBERS.second, SJ_NUMBERS.first, CUSTOMER_B, 'Gudang Customer B');
        await expect(page.getByText(SJ_NUMBERS.second, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    });

    test('7. tutup trip', async ({ page }) => {
        await openTripDetail(page);

        // Remove the placeholder reference (no items) so the trip can close.
        const placeholderLink = page
            .locator('.detail-value.font-mono')
            .filter({ hasText: PLACEHOLDER_SJ_NUMBER.toUpperCase() })
            .first();
        if (await placeholderLink.count()) {
            await placeholderLink
                .locator('xpath=ancestor::div[1]')
                .getByRole('button', { name: /^Hapus$/ })
                .first()
                .click();

            const confirmDelete = page.locator('.modal').filter({ hasText: 'Hapus Surat Jalan' }).first();
            await expect(confirmDelete).toBeVisible({ timeout: 20_000 });
            await confirmDelete.getByRole('button', { name: /^Hapus$/ }).first().click();
            await page.waitForTimeout(6_000);
        }

        await page.getByRole('button', { name: /^Tutup Trip$/ }).first().click();

        const modal = page.locator('.modal').filter({ hasText: 'Tutup Trip' });
        await expect(modal).toBeVisible({ timeout: 20_000 });

        // Internal trip: accept the prefilled odometer, no changes needed.
        await modal.getByRole('button', { name: /^Tutup Trip$/ }).click();

        await expect(page.locator('.toast-message').filter({ hasText: 'Trip ditutup oleh admin' }).first())
            .toBeVisible({ timeout: 45_000 });
    });

    test('8. invoice customer A carries only SJ-1, then settle in full', async ({ page }) => {
        invoiceAUrl = await createInvoiceForCustomer(page, CUSTOMER_A, SJ_NUMBERS.first, SJ_NUMBERS.second);
        await settleInvoiceInFull(page, invoiceAUrl);
    });

    test('9. invoice customer B carries only SJ-2, then settle in full', async ({ page }) => {
        invoiceBUrl = await createInvoiceForCustomer(page, CUSTOMER_B, SJ_NUMBERS.second, SJ_NUMBERS.first);
        await settleInvoiceInFull(page, invoiceBUrl);
    });

    test.afterAll(() => {
        const summary = {
            resi: ctx.resi,
            orderId: ctx.orderId,
            tripId: ctx.tripId,
            orderUrl,
            tripUrl,
            invoiceAUrl,
            invoiceBUrl,
            sjs: [SJ_NUMBERS.first, SJ_NUMBERS.second],
        };
        if (!ctx.resi) return;
        const file = path.join(__dirname, 'last-run.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
        console.log('\nMulti-customer billing run:', JSON.stringify(summary));
    });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Selects a customer from a Combobox by its placeholder, typing the name.
 */
async function selectCustomerByName(page: import('@playwright/test').Page, placeholder: string, name: string) {
    const input = page.getByPlaceholder(placeholder, { exact: true }).first();
    await input.waitFor({ state: 'visible', timeout: 30_000 });
    await input.click();
    await input.fill(name);

    const option = page.getByRole('option', { name: new RegExp(escapeRegExp(name)) }).first();
    await option.waitFor({ state: 'visible', timeout: 30_000 });
    await option.click();
}

async function openTripDetail(page: import('@playwright/test').Page) {
    if (!ctx.tripId) throw new Error('tripId is not set - step 1 must run first');
    await page.goto(`${BASE_URL}/trips/${ctx.tripId}`, { waitUntil: 'commit' });

    await expect(page.getByRole('button', { name: /Tambah SJ/ })).toBeVisible({ timeout: 45_000 });
}

/**
 * Finalizes exactly one SJ to DELIVERED with the given billing customer,
 * leaving the other SJ untouched for its own batch.
 */
async function finalizeSingleSj(
    page: import('@playwright/test').Page,
    targetSj: string,
    otherSj: string,
    billingCustomer: string,
    dropLocation: string
) {
    await openTripDetail(page);

    const batchButton = page.getByRole('button', { name: /Update Batch SJ/ }).first();
    await expect(batchButton).toBeVisible({ timeout: 30_000 });
    await batchButton.click();

    const modal = page.locator('.modal').filter({ hasText: /Batch SJ/ }).first();
    await expect(modal).toBeVisible({ timeout: 20_000 });

    await selectComboboxOption(page, 'Pilih status', /^Terkirim$/);
    await fillPodDetails(modal);

    // Narrow the batch to the target SJ only.
    const otherBox = modal.getByRole('checkbox', { name: new RegExp(escapeRegExp(otherSj)) });
    if (await otherBox.count()) {
        if (await otherBox.first().isChecked()) {
            await otherBox.first().uncheck();
        }
    }
    const targetBox = modal.getByRole('checkbox', { name: new RegExp(escapeRegExp(targetSj)) });
    if (await targetBox.count()) {
        if (!(await targetBox.first().isChecked())) {
            await targetBox.first().check();
        }
    }

    // Bill this batch to the given customer.
    await selectComboboxOption(page, 'Pilih customer invoice', new RegExp(escapeRegExp(billingCustomer)));

    const dropInput = modal.getByPlaceholder('Mis. Gudang Customer Surabaya', { exact: true }).first();
    if (await dropInput.count()) {
        await dropInput.fill(dropLocation);
    }

    await modal.getByRole('button', { name: /Lanjut Aktual Barang|Simpan Batch SJ/ }).first()
        .click({ timeout: 15_000 });

    const cargo = page.locator('.modal').filter({ hasText: /Aktual Barang SJ/ }).first();
    if (await cargo.isVisible({ timeout: 20_000 }).catch(() => false)) {
        for (const [label, value] of [
            ['Koli Aktual', '1'],
            ['Berat Aktual', '1000'],
            ['Volume Aktual', '1'],
        ] as const) {
            const group = cargo.locator('.form-group').filter({ hasText: label }).first();
            await group.locator('input.form-input').first().fill(value);
        }

        const finalize = cargo.getByRole('button', { name: 'Finalkan Batch SJ', exact: true }).first();
        await expect(finalize).toBeEnabled({ timeout: 20_000 });
        await finalize.click();
    }

    await page.waitForTimeout(6_000);
    await page.reload({ waitUntil: 'commit' });
    await page.getByRole('button', { name: /Tambah SJ/ }).first()
        .waitFor({ state: 'visible', timeout: 60_000 });
}

/**
 * Creates an invoice for one customer and asserts the SJ split:
 * the wanted SJ is offered, the other SJ is absent.
 */
async function createInvoiceForCustomer(
    page: import('@playwright/test').Page,
    customerName: string,
    wantedSj: string,
    absentSj: string
): Promise<string> {
    await page.goto(`${BASE_URL}/invoices/new`);

    await selectCustomerByName(page, '-- Pilih Customer --', customerName);

    const sjPickerInput = page.getByPlaceholder('-- Pilih SJ siap tagih --', { exact: true }).first();
    await expect(sjPickerInput).toBeVisible({ timeout: 30_000 });
    await sjPickerInput.click();

    const option = page
        .getByRole('option')
        .filter({ hasText: wantedSj })
        .first();
    await expect(option).toBeVisible({ timeout: 30_000 });

    // The other SJ must not be offered to this customer at all.
    await expect(page.getByRole('option').filter({ hasText: absentSj })).toHaveCount(0, { timeout: 15_000 });

    await option.click();

    const picker = page.locator('.modal').filter({ hasText: 'Pilih SJ untuk Invoice' });
    await expect(picker).toBeVisible({ timeout: 20_000 });

    // The picker must list only the wanted SJ.
    await expect(picker.getByText(wantedSj, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(picker.getByText(absentSj, { exact: false })).toHaveCount(0, { timeout: 15_000 });

    const allBoxes = picker.getByRole('checkbox');
    const boxCount = await allBoxes.count();
    expect(boxCount).toBeGreaterThan(0);
    for (let i = 0; i < boxCount; i += 1) {
        const box = allBoxes.nth(i);
        if (!(await box.isChecked())) await box.check();
    }

    await picker.getByRole('button', { name: /Tambahkan \d+ SJ/ }).click();
    await expect(picker).toBeHidden({ timeout: 20_000 });

    const rateInput = page.getByPlaceholder(/^Ketik tarif per /).first();
    await expect(rateInput).toBeVisible({ timeout: 20_000 });
    await rateInput.fill('1000');

    await page.getByRole('button', { name: /Simpan Invoice/ }).click();

    await expect(page.locator('.toast.success .toast-message').filter({ hasText: /Invoice berhasil dibuat/ }).first())
        .toBeVisible({ timeout: 60_000 });

    await page.waitForURL(/\/invoices\/[a-f0-9-]{36}/i, { timeout: 45_000 }).catch(() => undefined);
    const url = page.url();
    expect(url).toMatch(/\/invoices\/[a-f0-9-]{36}/i);

    // The invoice detail must show the wanted SJ and not the other one.
    // Wait for the detail card first: first hit compiles the page + data.
    // SJ rows live inside the collapsed "Rincian Perjalanan" card: expand it.
    await expect(page.getByText('Detail Invoice', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
    await page.getByText('Rincian Perjalanan', { exact: true }).first().click();
    await expect(page.getByText(wantedSj, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(absentSj, { exact: false })).toHaveCount(0, { timeout: 15_000 });

    return url;
}

/**
 * Pays an invoice in full via Tunai and asserts the Lunas status.
 */
async function settleInvoiceInFull(page: import('@playwright/test').Page, invoiceUrl: string) {
    await page.goto(invoiceUrl, { waitUntil: 'commit' });
    await expect(page.getByRole('button', { name: /Catat Pembayaran/ }).first()).toBeVisible({ timeout: 45_000 });

    await page.getByRole('button', { name: /Catat Pembayaran/ }).first().click();

    const modal = page.locator('.modal').filter({ hasText: 'Catat Pembayaran Invoice' });
    await expect(modal).toBeVisible({ timeout: 20_000 });

    await modal.getByRole('button', { name: /Bayar penuh/ }).click();

    // Metode defaults to Transfer (needs a bank account); Tunai posts to Kas automatically.
    const methodGroup = modal.locator('.form-group').filter({ hasText: 'Metode' }).first();
    await methodGroup.locator('input').first().click();
    const tunaiOption = page.getByRole('option', { name: 'Tunai' }).first();
    await tunaiOption.waitFor({ state: 'visible', timeout: 20_000 });
    await tunaiOption.click();

    await modal.getByRole('button', { name: /Simpan Pembayaran Invoice/ }).click();

    await expect(page.locator('.toast.success .toast-message').filter({ hasText: /Pembayaran|Lunas|berhasil/ }).first())
        .toBeVisible({ timeout: 60_000 });

    await page.waitForTimeout(4_000);
    await page.reload({ waitUntil: 'commit' });
    await expect(page.getByText('Lunas', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
}

async function fillPodDetails(modal: import('@playwright/test').Locator) {
    const nameGroup = modal.locator('.form-group').filter({ hasText: 'Nama Penerima POD' }).first();
    if (await nameGroup.count()) {
        await nameGroup.locator('input.form-input').first().fill('Penerima Uji E2E');
    }
    const dateGroup = modal.locator('.form-group').filter({ hasText: 'Tanggal Terima POD' }).first();
    if (await dateGroup.count()) {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        await dateGroup.locator('input[type="date"]').first()
            .fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
}

async function fillGroupNumber(
    modal: import('@playwright/test').Locator,
    labelText: string,
    value: string
) {
    const label = modal.locator(`label.form-label:text-is("${labelText}")`).first();
    await label.waitFor({ state: 'visible', timeout: 20_000 });
    await label.locator('..').locator('input').first().fill(value);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

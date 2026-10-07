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
 * MITRA trip lifecycle E2E:
 *   1. create order with a MITRA trip plan
 *   2. materialize that plan into a real trip ("Input Surat Jalan")
 *   3. create 2 surat jalan on the trip
 *   4. advance both SJs to DELIVERED
 *   5. tutup trip
 *   6. create an invoice from those SJs
 *
 * Note the two-phase trip creation: POST orders/create-with-items only stores
 * `tripPlans` as drafts inside orders.extra_data. No delivery_orders row is
 * written. The trip only exists after the per-plan "Input Surat Jalan" button on
 * the order detail page posts delivery-orders/create-with-items.
 *
 * On any failure, _fixtures.ts writes a full-page screenshot + console/network
 * log into this folder's ./error directory.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

const CUSTOMER = process.env.E2E_CUSTOMER_NAME ?? '';
const PICKUP_ADDRESS =
    process.env.E2E_PICKUP_ADDRESS ?? 'Jl. Test Mitra E2E No. 1, Surabaya, Jawa Timur';

const SJ_NUMBERS = {
    first: process.env.E2E_SJ_1 ?? '',
    second: process.env.E2E_SJ_2 ?? '',
};

// Step 2 must supply a shipper reference to satisfy
// "Isi minimal 1 No. SJ pengirim untuk barang menyusul", but reusing a real
// E2E number would collide with the duplicate-reference guard
// ("No. SJ pengirim X ditulis lebih dari sekali") and leave that SJ with no
// items. So the placeholder gets its own distinct number.
// NOTE: process.pid alone is NOT unique across runs (OS recycles pids), so a
// timestamp is included — otherwise a rerun can 409 against its own placeholder
// from an earlier run (seen with R-202610-0028 vs R-202610-0043).
const PLACEHOLDER_SJ_NUMBER =
    process.env.E2E_PLACEHOLDER_SJ ??
    `SJ/PROCESS/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}/${process.pid}-${Date.now().toString(36).toUpperCase()}`;

test.describe('MITRA trip lifecycle', () => {
    // The steps share in-memory state (orderId / tripId / SJ numbers), so they
    // must run in order in one worker and stop at the first failure.
    test.describe.configure({ mode: 'serial' });

    // Shared across the steps of one run.
    let tripUrl = '';
    let orderUrl = '';
    let invoiceUrl = '';
    let firstOrderSjNumbers: string[] = [];

    test.beforeAll(async () => {
        test.skip(
            !CUSTOMER || !SJ_NUMBERS.first || !SJ_NUMBERS.second,
            'Set E2E_CUSTOMER_NAME, E2E_SJ_1, E2E_SJ_2 to run this spec'
        );
    });

    test('1. create order with a MITRA trip plan', async ({ page }) => {
        await page.goto(`${BASE_URL}/orders/new`);
        await expect(page.getByRole('heading', { name: 'Buat Order Baru' })).toBeVisible({ timeout: 30_000 });

        // --- customer -------------------------------------------------------
        await selectCustomer(page, 'Pilih customer');

        // --- armada category ---
        // Required in practice: orders.service_ref is NOT NULL in Postgres, but
        // the field is rendered without a required marker, so leaving it blank
        // makes the POST fail with:
        //   400 null value in column "service_ref" ... violates not-null constraint
        // The first option is the seed "Reguler" service.
        const category = page.getByPlaceholder('Pilih kategori armada', { exact: true }).first();
        await category.waitFor({ state: 'visible', timeout: 30_000 });
        await category.click();
        await page.getByRole('option').first().waitFor({ state: 'visible', timeout: 20_000 });
        await page.getByRole('option').first().click();

        // --- pickup point (needed so the trip plan can bind a pickup stop) ---
        await page
            .getByPlaceholder('Alamat lokasi pengambilan barang', { exact: true })
            .fill(PICKUP_ADDRESS);

        // --- MITRA trip plan -----------------------------------------------
        // tripDrafts starts empty, so a trip must be added explicitly.
        await page.getByRole('button', { name: /Tambah Trip/ }).click();

        // TripOwnershipSwitch renders a radiogroup with Internal / Mitra buttons.
        const mitraRadio = page.getByRole('radio', { name: 'Mitra', exact: true });
        await expect(mitraRadio).toBeVisible();
        if ((await mitraRadio.getAttribute('aria-checked')) !== 'true') {
            await mitraRadio.click();
        }
        await expect(mitraRadio).toHaveAttribute('aria-checked', 'true');

        // Bind the first pickup stop to this trip. The checkbox sits inside a
        // <label> whose text is "Pickup 1 · <label>".
        const pickupCheckbox = page.getByRole('checkbox', { name: /^Pickup 1/ }).first();
        await expect(pickupCheckbox).toBeVisible();
        if (!(await pickupCheckbox.isChecked())) {
            await pickupCheckbox.check();
        }

        // --- save -----------------------------------------------------------
        const saveOrder = page.getByRole('button', { name: /Simpan Order/ });
        await expect(saveOrder).toBeEnabled();
        await saveOrder.click();

        // Success toast carries the resi: "Order dibuat: R-... | 1 trip disimpan"
        const toast = page.locator('.toast.success .toast-message');
        await expect(toast.first()).toBeVisible({ timeout: 45_000 });
        const toastText = await toast.first().innerText();
        const match = toastText.match(/Order dibuat:\s*(\S+)/);
        if (!match) {
            throw new Error(`Could not parse resi from success toast: "${toastText}"`);
        }
        ctx.resi = match[1];

        // The app redirects to the order detail page after saving. Captured here
        // so later steps can jump straight to the trip instead of hunting for it
        // in a paginated list.
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

        // Per-trip-plan button on the "Rencana Trip" card. Absent while the plan
        // is unlinked, present as "Input Surat Jalan".
        const inputButton = page.getByRole('button', { name: /Input Surat Jalan/ }).first();
        await inputButton.waitFor({ state: 'visible', timeout: 45_000 });
        await inputButton.click();

        const modal = page.locator('.modal').filter({ hasText: /Input Surat Jalan/ });
        await expect(modal).toBeVisible({ timeout: 20_000 });

        // MITRA regression guard: the modal must not ask for internal fleet data.
        await expect(modal.getByText(/tidak memakai kendaraan, supir, dan uang jalan internal/))
            .toBeVisible({ timeout: 10_000 });

        // Server-side validation (orders/[id]/page.tsx handleCreateDO) rejects the
        // submit with "Isi minimal 1 No. SJ pengirim untuk barang menyusul" when no
        // shipper reference exists, so fill the first draft-SJ reference. The trip
        // is created now; the actual SJs are added afterwards from the trip page.
        await modal
            .getByPlaceholder('Mis. SJ/27032026/001', { exact: true })
            .first()
            .fill(PLACEHOLDER_SJ_NUMBER.toUpperCase());

        // Submit with "barang menyusul" so the trip is created first. This
        // placeholder is a separate reference from the two real SJs in step 3.
        await modal.getByRole('button', { name: /Input Surat Jalan/ }).last().click();

        // Toast: "Trip dibuat: DO-..."
        const toast = page.locator('.toast.success .toast-message').filter({ hasText: /Trip dibuat/ }).first();
        await expect(toast).toBeVisible({ timeout: 60_000 });

        // The plan card flips to "Kelola Trip / SJ", which links the
        // delivery-order (trip) route - not /trips/.
        const tripLink = page.locator('a[href^="/delivery-orders/"]').first();
        await tripLink.waitFor({ state: 'visible', timeout: 45_000 });
        // href carries a ?returnTo=... query param; keep only the id.
        ctx.tripId = (await tripLink.getAttribute('href'))!
            .replace('/delivery-orders/', '')
            .split('?')[0];
        tripUrl = `${BASE_URL}/trips/${ctx.tripId}`;

        expect(ctx.tripId).toMatch(/^[a-f0-9-]{36}$/i);
    });

    test('3. create 2 surat jalan on the MITRA trip', async ({ page }) => {
        await openTripDetail(page);

        const created: string[] = [];
        for (const [index, sjNumber] of [SJ_NUMBERS.first, SJ_NUMBERS.second].entries()) {
            await page.getByRole('button', { name: /Tambah SJ/ }).first().click();

            const modal = page.locator('.modal').filter({ hasText: 'Tambah Surat Jalan' });
            await expect(modal).toBeVisible({ timeout: 20_000 });

            // SJ number input, auto-uppercased.
            await modal
                .getByPlaceholder('Contoh: SJ/27032026/001', { exact: true })
                .fill(sjNumber.toUpperCase());

            // "Tambah manual" keeps the test independent of master barang /
            // customer-product data. Create mode ALREADY seeds one empty item
            // row, so do NOT press "Tambah Item": that appends a second, empty
            // draft and the save is then rejected with
            // "Barang baru baris 1 perlu deskripsi atau master barang".
            const masterBarang = modal.getByPlaceholder(/Pilih master barang|Belum ada master barang/).first();
            await expect(masterBarang).toBeVisible({ timeout: 20_000 });
            await masterBarang.click();
            const manualOption = page.getByRole('option', { name: 'Tambah manual' }).first();
            await manualOption.waitFor({ state: 'visible', timeout: 20_000 });
            await manualOption.click();

            await modal
                .getByPlaceholder('Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik', { exact: true })
                .fill(`Barang Uji E2E Mitra ${index + 1}`);

            // Koli / Berat / Volume are <label> + FormattedNumberInput siblings
            // with no htmlFor and no placeholder. The unit Comboboxes already
            // default to Kg and m3, so only the numbers are filled.
            await fillGroupNumber(modal, 'Koli', '1');
            await fillGroupNumber(modal, 'Berat', '1000');
            await fillGroupNumber(modal, 'Volume', '1');

            await modal.getByRole('button', { name: /^Buat SJ$/ }).click();

            // Give the save time to round-trip, then reload and assert the SJ
            // number is PERSISTED. Asserting on the success toast is unreliable
            // (it auto-dismisses in seconds) and the modal does not always close
            // even on success, so persisted state is the real signal.
            await page.waitForTimeout(8_000);
            created.push(sjNumber);

            await page.reload({ waitUntil: 'commit' });
            await expect(page.getByText(sjNumber, { exact: false }).first()).toBeVisible({
                timeout: 60_000,
            });
        }

        firstOrderSjNumbers = created;
        expect(created).toHaveLength(2);
    });

    test('4. advance both SJs to DELIVERED', async ({ page }) => {
        await openTripDetail(page);

        // Transitions are step-only: CREATED -> ON_DELIVERY -> ARRIVED -> DELIVERED,
        // and each step opens its own modal, so drive them one at a time.
        for (const target of ['Dalam Pengiriman', 'Tiba di Tujuan', 'Terkirim']) {
            const batchButton = page.getByRole('button', { name: /Update Batch SJ/ }).first();
            await expect(batchButton).toBeVisible({ timeout: 30_000 });
            await batchButton.click();

            const modal = page.locator('.modal').filter({ hasText: /Batch SJ/ }).first();
            await expect(modal).toBeVisible({ timeout: 20_000 });

            await selectComboboxOption(page, 'Pilih status', new RegExp(`^${target}$`));
            await fillPodDetails(modal);

            // The last step ("Terkirim") is a finalization: it also needs the drop
            // location, then opens the per-item realization modal.
            const dropLocation = modal.getByPlaceholder('Mis. Gudang Customer Surabaya', { exact: true }).first();
            if (await dropLocation.count()) {
                await dropLocation.fill('Gudang Customer Surabaya');
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

            // Toasts auto-dismiss, so confirm the persisted status instead.
            await page.waitForTimeout(6_000);
            await page.reload({ waitUntil: 'commit' });
            await page.getByRole('button', { name: /Tambah SJ/ }).first()
                .waitFor({ state: 'visible', timeout: 60_000 });
        }

        // Both SJs must now read Terkirim / Selesai.
        await expect(page.getByText('Terkirim', { exact: false }).first()).toBeVisible({ timeout: 30_000 });

        // Step 2's placeholder reference has no items, so it never advances and
        // keeps the trip out of DELIVERED. Remove it so the trip can close.
        // The link sits next to its own Hapus button in the detail row.
        const placeholderLink = page
            .locator('.detail-value.font-mono')
            .filter({ hasText: PLACEHOLDER_SJ_NUMBER.toUpperCase() })
            .first();
        await placeholderLink.waitFor({ state: 'visible', timeout: 30_000 });

        await placeholderLink
            .locator('xpath=ancestor::div[1]')
            .getByRole('button', { name: /^Hapus$/ })
            .first()
            .click();

        // Confirmation: "Hapus Surat Jalan".
        const confirmDelete = page.locator('.modal').filter({ hasText: 'Hapus Surat Jalan' }).first();
        await expect(confirmDelete).toBeVisible({ timeout: 20_000 });
        await confirmDelete.getByRole('button', { name: /^Hapus$/ }).first().click();
        await page.waitForTimeout(6_000);

        await expect(page.getByText(PLACEHOLDER_SJ_NUMBER.toUpperCase(), { exact: false }))
            .toHaveCount(0, { timeout: 30_000 });
    });

    test('5. tutup trip', async ({ page }) => {
        await openTripDetail(page);

        await page.getByRole('button', { name: /^Tutup Trip$/ }).first().click();

        const modal = page.locator('.modal').filter({ hasText: 'Tutup Trip' });
        await expect(modal).toBeVisible({ timeout: 20_000 });

        // MITRA regression guard: no odometer / oil-service / tire UI on a MITRA
        // trip. Its presence would mean the MITRA exemption regressed.
        await expect(modal.getByText(/Odometer Akhir Trip/)).toHaveCount(0);
        await expect(modal.getByText(/Sisa Servis Oli Setelah Trip/)).toHaveCount(0);
        await expect(modal.getByText(/Ban Unit Sebelum/)).toHaveCount(0);

        await modal.getByRole('button', { name: /^Tutup Trip$/ }).click();

        await expect(page.locator('.toast-message').filter({ hasText: 'Trip ditutup oleh admin' }).first())
            .toBeVisible({ timeout: 45_000 });
    });

    test('6. create an invoice from the delivered SJs', async ({ page }) => {
        await page.goto(`${BASE_URL}/invoices/new`);

        await selectCustomer(page, '-- Pilih Customer --');

        // Pick the DO/SJ that is ready to bill.
        const sjPickerInput = page.getByPlaceholder('-- Pilih SJ siap tagih --', { exact: true }).first();
        await expect(sjPickerInput).toBeVisible({ timeout: 30_000 });
        await sjPickerInput.click();

        // Options are labelled "DO-... | 1 SJ tersisa | <SJ numbers>", not by resi.
        const option = page
            .getByRole('option')
            .filter({ hasText: firstOrderSjNumbers[0] ?? ctx.resi })
            .first();
        await expect(option).toBeVisible({ timeout: 30_000 });
        await option.click();

        // SJ selection modal: tick every listed SJ.
        const picker = page.locator('.modal').filter({ hasText: 'Pilih SJ untuk Invoice' });
        await expect(picker).toBeVisible({ timeout: 20_000 });

        const allBoxes = picker.getByRole('checkbox');
        const boxCount = await allBoxes.count();
        expect(boxCount).toBeGreaterThan(0);
        for (let i = 0; i < boxCount; i += 1) {
            const box = allBoxes.nth(i);
            if (!(await box.isChecked())) await box.check();
        }

        await picker.getByRole('button', { name: /Tambahkan \d+ SJ/ }).click();
        await expect(picker).toBeHidden({ timeout: 20_000 });

        // Each row needs a rate > 0; this customer has no master tariff, so type
        // a manual one. Placeholder varies by billing mode.
        const rateInput = page.getByPlaceholder(/^Ketik tarif per /).first();
        await expect(rateInput).toBeVisible({ timeout: 20_000 });
        await rateInput.fill('1000');

        await page.getByRole('button', { name: /Simpan Invoice/ }).click();

        await expect(page.locator('.toast.success .toast-message').filter({ hasText: /Invoice berhasil dibuat/ }).first())
            .toBeVisible({ timeout: 60_000 });

        await page.waitForURL(/\/invoices\/[a-f0-9-]{36}/i, { timeout: 45_000 }).catch(() => undefined);
        invoiceUrl = page.url();
    });

    test.afterAll(() => {
        const summary = {
            resi: ctx.resi,
            orderId: ctx.orderId,
            tripId: ctx.tripId,
            orderUrl,
            tripUrl,
            invoiceUrl,
            sjs: firstOrderSjNumbers,
        };
        if (!ctx.resi) return;
        const file = path.join(__dirname, 'last-run.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(summary, null, 2), 'utf8');
        console.log('\nMITRA lifecycle run:', JSON.stringify(summary));
    });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Selects the configured customer from a Combobox.
 *
 * The Combobox input KEEPS its own placeholder ("Pilih customer") while
 * filtering, so the query is typed into that same input - it is not a second
 * field. There is no separate search box.
 */
async function selectCustomer(page: import('@playwright/test').Page, placeholder: string) {
    const input = page.getByPlaceholder(placeholder, { exact: true }).first();
    await input.waitFor({ state: 'visible', timeout: 30_000 });
    await input.click();
    await input.fill(CUSTOMER);

    const option = page.getByRole('option', { name: new RegExp(escapeRegExp(CUSTOMER)) }).first();
    await option.waitFor({ state: 'visible', timeout: 30_000 });
    await option.click();
}

/**
 * Opens the trip detail for this run.
 *
 * Goes straight to /trips/{id} (captured in step 1) rather than searching the
 * trips list: that list is paginated ("Menampilkan 1-10 dari 26 data"), so a
 * freshly created trip is not on page 1 and searching by resi silently fails.
 */
async function openTripDetail(page: import('@playwright/test').Page) {
    if (!ctx.tripId) throw new Error('tripId is not set - step 1 must run first');
    await page.goto(`${BASE_URL}/trips/${ctx.tripId}`, { waitUntil: 'commit' });

    // "Tambah SJ" only renders once the trip data has loaded, so it doubles as
    // the readiness signal for this page.
    await expect(page.getByRole('button', { name: /Tambah SJ/ })).toBeVisible({ timeout: 45_000 });
}

/**
 * POD fields are required for delivery transitions.
 * They are `<label>` + sibling `<input>` with NO htmlFor and NO placeholder,
 * so they are addressed via their form-group container text.
 */
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

/**
 * Fills a FormattedNumberInput located by its <label> text.
 * Optionally picks the unit from the Combobox sitting next to that input
 * (Berat has Kg/Ton, Volume has m3/Liter/KL).
 */
async function fillGroupNumber(
    modal: import('@playwright/test').Locator,
    labelText: string,
    value: string
) {
    // Markup is `<div><label class="form-label">Koli</label><input/></div>`,so the field lives in the label's DIRECT parent. Matching on
    // `label:text-is(...)` + `locator('..')` avoids taking the .last() of every
    // div containing the label, which landed on an ancestor with no input.
    //
    // The trailing unit Combobox (Kg/Ton, m3/Liter/KL) is left at its default so
    // this helper never has to click it: its "Hapus pilihan" toggle button
    // overlaps the input and swallows pointer events.
    const label = modal.locator(`label.form-label:text-is("${labelText}")`).first();
    await label.waitFor({ state: 'visible', timeout: 20_000 });
    await label.locator('..').locator('input').first().fill(value);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
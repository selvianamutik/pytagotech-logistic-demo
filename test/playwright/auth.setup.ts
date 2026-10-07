import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_STATE_PATH } from './_fixtures';

/**
 * Authenticates once and writes storageState so the lifecycle spec does not log
 * in per test.
 *
 * This logs in through the API rather than clicking the form: the login button is
 * only wired up after React hydration, so a click-based login is racy against a
 * cold dev server (observed: sometimes never leaves /login).
 *
 * Credentials come from env (never hardcoded, never committed):
 *   E2E_EMAIL, E2E_PASSWORD
 *
 * Required role: OWNER or OPERASIONAL. `/orders/new` needs orders:create, trip
 * close needs trips:update, invoicing needs invoices:create. DRIVER accounts
 * are rejected by the endpoint with 403.
 */
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const SESSION_COOKIE = 'logistik-session';

setup('authenticate', async ({ request }) => {
    setup.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD to run E2E tests');

    // The endpoint rejects requests without a same-origin Origin/Referer, so the
    // header has to be sent explicitly from an API context.
    const response = await request.post(`${BASE_URL}/api/auth/login`, {
        data: { email: EMAIL, password: PASSWORD },
        headers: { Origin: BASE_URL, Referer: `${BASE_URL}/login` },
    });

    if (!response.ok()) {
        const body = await response.text().catch(() => '');
        throw new Error(`Login failed: HTTP ${response.status()} ${response.statusText()} :: ${body.slice(0, 300)}`);
    }

    const payload = (await response.json()) as { success?: boolean; user?: { role?: string; email?: string } };
    expect(payload.success, `unexpected login payload: ${JSON.stringify(payload).slice(0, 300)}`).toBe(true);

    const role = payload.user?.role;
    if (role !== 'OWNER' && role !== 'OPERASIONAL') {
        throw new Error(
            `E2E login must use an OWNER or OPERASIONAL account (needs orders:create / trips:update / invoices:create). Got role=${role}`
        );
    }

    const state = await request.storageState();
    const hasSession = state.cookies.some(c => c.name === SESSION_COOKIE);
    if (!hasSession) {
        throw new Error(`Login succeeded but no "${SESSION_COOKIE}" cookie was stored`);
    }

    const statePath = path.resolve(STORAGE_STATE_PATH);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
});
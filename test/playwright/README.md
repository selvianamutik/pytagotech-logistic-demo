# E2E Tests (Playwright)

## Layout

```
test/playwright/
  _fixtures.ts                     shared test fixture + UI helpers
  auth.setup.ts                    one-time login, caches storageState
  mitra-trip-lifecycle/
    mitra-trip-lifecycle.spec.ts   order -> MITRA trip -> 2 SJ -> delivered -> tutup -> invoice
    error/                         failure screenshots + console/network logs (gitignored)
  .artifacts/                      traces, videos, auth.json (gitignored)
```

## No browser download

The config uses the **system-installed Edge** via Playwright's `msedge` channel:

```ts
use: { channel: 'msedge' }
```

That resolves to your installed `msedge.exe` instead of downloading Chromium
into `%LOCALAPPDATA%\ms-playwright`. Change `channel` to `chrome` for Google
Chrome (also no download).

## Env vars

Set these before running. Credentials are never committed.

```powershell
$env:E2E_EMAIL        = "..."
$env:E2E_PASSWORD     = "..."
$env:E2E_CUSTOMER_NAME = "PT ..."          # exact customer name as shown in the Combobox
$env:E2E_SJ_1         = "SJ/..."           # unique per run, e.g. SJ/E2E/<timestamp>/1
$env:E2E_SJ_2         = "SJ/..."
# optional
$env:E2E_PICKUP_ADDRESS = "Jl. ..."       # default: Jl. Test Mitra E2E No. 1, Surabaya
$env:E2E_BASE_URL       = "http://localhost:3000"
```

`E2E_SJ_1` / `E2E_SJ_2` **must be unique per run** — SJ numbers collide otherwise.

Required role: OWNER or OPERASIONAL. `/orders/new` needs `orders:create`;
tutup trip needs `trips:update`; invoice needs `invoices:create`.

## Run

```powershell
npm run test:e2e                  # all
npx playwright test --headed      # watch it run
npx playwright test -g "tutup trip"   # single step
npx playwright show-report        # HTML report
```

The dev server is reused if already running (`webServer.reuseExistingServer`).

## Failure artifacts

On any failure the fixture writes into
`test/playwright/mitra-trip-lifecycle/error/`:

- `<test-title>.png` — full-page screenshot
- `<test-title>.log` — console errors, failed requests, HTTP >= 400

Plus per-test trace/video in `.artifacts`.

## Why selectors look unusual

This codebase has **zero `data-testid` attributes** and **zero `htmlFor`**
attributes under `src/app/(admin)/**`, so `getByLabel()` does not work and every
field must be reached via placeholder, `role=radio`, or its `.form-group`
container text. The Combobox also has no accessible name (no id / aria-label),
so it is always addressed by `getByPlaceholder(...)`.

If you refactor this test later, adding `data-testid` to the handful of
components in the flow would make the specs dramatically less brittle.
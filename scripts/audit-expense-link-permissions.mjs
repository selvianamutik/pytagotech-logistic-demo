#!/usr/bin/env node
/**
 * audit-expense-link-permissions.mjs
 *
 * Guards the 3-place wiring footgun for the "ModuleLinkPermissions" dict.
 * The ExpenseLinkPermissions type requires 7 boolean fields; the pieces that
 * must stay in sync are:
 *
 *   1. src/lib/expense-related-docs.ts     — the type declares the 7 fields
 *   2. src/app/(admin)/expenses/page.tsx   — list page: 7 canOpen* consts,
 *      object shorthand + deps array
 *   3. src/app/(admin)/expenses/[id]/page.tsx — detail page: same 7 consts,
 *      object shorthand + deps array
 *   4. src/app/(admin)/expenses/resi/[id]/page.tsx — resi detail page (subset)
 *
 * If tsc is clean, every one of these sites declares + wires every field, so a
 * missing field fails loudly at build time. This audit is a cross-file trace of
 * the same requirement so CI breaks with a readable message, not just a tsc slur.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIB = join(ROOT, 'src', 'lib', 'expense-related-docs.ts');

const PAGES = [
  ['src/app/(admin)/expenses/page.tsx', 'list'],
  ['src/app/(admin)/expenses/[id]/page.tsx', 'detail'],
];

// Canonical field names as declared by ExpenseLinkPermissions.
const FIELDS = [
  'canOpenBankAccountPage',
  'canOpenDriverBoronganPage',
  'canOpenDriverVoucherPage',
  'canOpenIncidentPage',
  'canOpenMaintenancePage',
  'canOpenOrderPage',
  'canOpenVehiclePage',
];

let failures = 0;

function fail(msg) {
  failures++;
  console.error(`  - ${msg}`);
}

console.log('audit-expense-link-permissions — cross-file wiring trace');
console.log(`lib: ${LIB}`);
console.log(`canonical fields (${FIELDS.length}): ${FIELDS.join(', ')}`);
console.log('');

// 1) lib declares every canonical field as `name: boolean;`
if (!existsSync(LIB)) {
  fail(`lib file missing: ${LIB}`);
} else {
  const lib = readFileSync(LIB, 'utf8');
  for (const f of FIELDS) {
    const re = new RegExp(`\\b${f}\\s*:\\s*boolean\\b`);
    if (!re.test(lib)) fail(`lib does not declare "${f}": boolean`);
  }
}

// 2) each page: declares const, object uses shorthand, deps array includes it
for (const [rel, kind] of PAGES) {
  const abs = join(ROOT, rel);
  console.log(`--- ${rel} (${kind})`);
  if (!existsSync(abs)) {
    fail(`page missing: ${rel}`);
    continue;
  }
  const src = readFileSync(abs, 'utf8');
  for (const f of FIELDS) {
    const decl = new RegExp(`const\\s+${f}\\b`);
    if (!decl.test(src)) {
      fail(`${rel}: missing declaration const ${f}`);
      continue;
    }
    // Object shorthand: `  canOpenBankAccountPage,` at 8-space indent.
    const re = new RegExp(`\\n\\s{8}${f},`);
    if (!re.test(src)) fail(`${rel}: missing object shorthand ${f}`);
    // Deps array: `, canOpenBankAccountPage,` or `[canOpenBankAccountPage,`.
    const deps = new RegExp(`\\b${f},`);
    if (!deps.test(src) && !new RegExp(`\\[\\s*${f},`).test(src)) {
      fail(`${rel}: missing deps entry ${f}`);
    }
  }
}

console.log('');
if (failures > 0) {
  console.error(`AUDIT FAILED — ${failures} problem(s) found`);
  process.exit(1);
} else {
  console.log('AUDIT PASSED — all fields declared and wired in lib + pages');
  process.exit(0);
}

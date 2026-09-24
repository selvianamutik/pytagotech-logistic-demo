import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadScriptEnv } from './_env.mjs';
import XLSX from 'xlsx';

loadScriptEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const XLSX_PATH = process.argv[2] || join(process.cwd(), 'CUSTOMER_CLEANED.xlsx');

if (!existsSync(XLSX_PATH)) {
    console.error(`File not found: ${XLSX_PATH}`);
    console.error('Place CUSTOMER_CLEANED.xlsx in the project root folder, or pass the full path as argument:');
    console.error('  node scripts/import-customers-xlsx.mjs "C:\\path\\to\\file.xlsx"');
    process.exit(1);
}

async function supabasePost(table, row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: JSON.stringify(row),
    });
    if (!res.ok) {
        throw new Error(`POST failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

function generateId() {
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 8);
    return `cust-${ts}-${rnd}`;
}

function toText(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s || null;
}

function toNumber(value) {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

async function checkExists(name) {
    const qs = new URLSearchParams({ name: `eq.${name}`, select: 'source_document_id' });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/customers?${qs}`, {
        headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.length > 0;
}

async function main() {
    const wb = XLSX.readFile(XLSX_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const dataRows = rows.slice(1).filter(r => toText(r[0]));

    console.log(`Found ${dataRows.length} customer rows in Excel\n`);

    const now = new Date().toISOString();
    const candidates = [];

    for (const r of dataRows) {
        const name = toText(r[0]);
        if (!name) continue;

        const extra = {};
        const creditLimit = toNumber(r[6]);
        if (creditLimit !== null) extra.creditLimitAmount = creditLimit;
        const doPrefix = toText(r[8]);
        if (doPrefix) extra.deliveryOrderPrefix = doPrefix;

        candidates.push({
            source_document_id: generateId(),
            document_created_at: now,
            document_updated_at: now,
            name,
            contact_person: toText(r[1]),
            address: toText(r[2])?.replace(/\n/g, ', '),
            phone: toText(r[3])?.replace(/^Telp\.\s*/i, '').trim(),
            email: toText(r[4]),
            default_payment_term: toNumber(r[5]),
            npwp: toText(r[7]),
            active: true,
            extra_data: extra,
        });
    }

    console.log('Checking for existing customers...');
    const toInsert = [];
    for (const c of candidates) {
        const exists = await checkExists(c.name);
        if (exists) {
            console.log(`  SKIP: "${c.name}" already exists`);
        } else {
            toInsert.push(c);
        }
    }

    if (toInsert.length === 0) {
        console.log('\nAll customers already exist. Nothing to insert.');
        return;
    }

    console.log(`\nInserting ${toInsert.length} customer(s) one by one...`);
    let ok = 0, fail = 0;
    for (let i = 0; i < toInsert.length; i++) {
        try {
            await supabasePost('customers', [toInsert[i]]);
            ok++;
            process.stdout.write('.');
        } catch (err) {
            fail++;
            process.stdout.write('x');
        }
        if ((i + 1) % 50 === 0 || i === toInsert.length - 1) {
            process.stdout.write(` ${i + 1}/${toInsert.length}\n`);
        }
    }

    console.log(`\nDone! ${ok} imported, ${fail} failed.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

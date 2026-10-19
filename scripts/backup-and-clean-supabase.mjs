import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import {
    isMissingSupabaseTableError,
    RELATIONAL_RESET_TABLES,
    RELATIONAL_TABLES,
} from './_supabase-relational.mjs';

loadScriptEnv();

const supabaseUrl = requireAnyEnv([
    'SUPABASE_URL',
    'SUPABASE_PROJECT_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PROJECT_URL',
]);
const serviceRoleKey = requireAnyEnv([
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE',
]);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const BACKUP_ROOT = path.join(repoRoot, 'backups');
const EXTRA_TABLES = ['rate_limit_buckets'];
const BACKUP_TABLES = [...RELATIONAL_TABLES, ...EXTRA_TABLES];
const DELETE_TABLES = [...RELATIONAL_RESET_TABLES, ...EXTRA_TABLES];
const FULL_PRESERVE_TABLES = new Set(['app_users', 'services', 'trip_route_rates']);

// Master data tambahan yang ikut dipertahankan penuh saat flag
// --preserve-masters dipakai (mis. bersih-bersih DB demo: users,
// karyawan, customer, kendaraan, dan master lain tetap utuh, hanya data
// transaksional yang dihapus). Tanpa flag, perilaku default tidak berubah.
const MASTER_PRESERVE_TABLES = [
    'company_profiles',
    'drivers',
    'customers',
    'employees',
    'vehicles',
    'customer_products',
    'customer_billing_rates',
    'customer_recipients',
    'customer_pickup_locations',
    'bank_accounts',
    'chart_of_accounts',
    'accounting_periods',
    'suppliers',
    'warehouse_items',
    'supplier_item_prices',
    'expense_categories',
];

function hasFlag(flag) {
    return process.argv.includes(flag);
}

if (hasFlag('--preserve-masters')) {
    for (const table of MASTER_PRESERVE_TABLES) {
        FULL_PRESERVE_TABLES.add(table);
    }
}

function timestampSlug(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function rowId(row) {
    return typeof row?.source_document_id === 'string'
        ? row.source_document_id
        : typeof row?.id === 'string'
            ? row.id
            : null;
}

function uniqueText(values) {
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
}

async function supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

async function fetchAllRows(table) {
    const rows = [];
    const pageSize = 1000;
    let from = 0;

    while (true) {
        const response = await supabaseRequest(`${table}?select=*`, {
            headers: {
                Range: `${from}-${from + pageSize - 1}`,
            },
        });
        const page = await response.json();
        if (!Array.isArray(page)) {
            throw new Error(`Unexpected Supabase response for ${table}`);
        }
        rows.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
    }

    return rows;
}

async function fetchBackupSnapshot() {
    const snapshot = {};
    const missingTables = [];

    for (const table of BACKUP_TABLES) {
        try {
            snapshot[table] = await fetchAllRows(table);
        } catch (error) {
            if (isMissingSupabaseTableError(error)) {
                snapshot[table] = [];
                missingTables.push(table);
                continue;
            }
            throw error;
        }
    }

    return { snapshot, missingTables };
}

function buildPreservePlan(snapshot) {
    const appUsers = snapshot.app_users || [];
    const drivers = snapshot.drivers || [];
    const driverIds = new Set(drivers.map(row => rowId(row)).filter(Boolean));
    const linkedDriverIds = uniqueText(appUsers.map(user => user.driver_ref));
    const existingLinkedDriverIds = linkedDriverIds.filter(id => driverIds.has(id));
    const missingLinkedDriverIds = linkedDriverIds.filter(id => !driverIds.has(id));

    const preserveIdsByTable = {};
    if (existingLinkedDriverIds.length > 0) {
        preserveIdsByTable.drivers = new Set(existingLinkedDriverIds);
    }

    return {
        fullPreserveTables: [...FULL_PRESERVE_TABLES],
        preserveIdsByTable,
        linkedDriverIds,
        existingLinkedDriverIds,
        missingLinkedDriverIds,
    };
}

function buildCounts(snapshot) {
    return Object.fromEntries(BACKUP_TABLES.map(table => [table, (snapshot[table] || []).length]));
}

async function writeBackup(snapshot, manifest) {
    const backupDir = path.join(BACKUP_ROOT, `supabase-clean-reset-${timestampSlug()}`);
    await fs.mkdir(backupDir, { recursive: true });

    const files = {};
    for (const table of BACKUP_TABLES) {
        const fileName = `${table}.json`;
        files[table] = fileName;
        await fs.writeFile(
            path.join(backupDir, fileName),
            JSON.stringify(snapshot[table] || [], null, 2),
            'utf8'
        );
    }

    const finalManifest = {
        ...manifest,
        backupDir,
        files,
    };
    await fs.writeFile(
        path.join(backupDir, 'manifest.json'),
        JSON.stringify(finalManifest, null, 2),
        'utf8'
    );

    return backupDir;
}

async function deleteRowsBySourceDocumentId(table, ids) {
    for (const id of ids) {
        await supabaseRequest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
            method: 'DELETE',
        });
    }
}

async function deleteAllManagedRows(table) {
    if (table === 'rate_limit_buckets') {
        await supabaseRequest(`${table}?id=not.is.null`, { method: 'DELETE' });
        return;
    }

    await supabaseRequest(`${table}?source_document_id=not.is.null`, { method: 'DELETE' });
    await supabaseRequest(`${table}?source_document_id=is.null`, { method: 'DELETE' });
}

async function resetTables(snapshot, preservePlan) {
    const deletedCounts = {};

    for (const table of DELETE_TABLES) {
        if (FULL_PRESERVE_TABLES.has(table)) {
            deletedCounts[table] = 0;
            console.log(`Preserving Supabase table: ${table}`);
            continue;
        }

        const preserveIds = preservePlan.preserveIdsByTable[table];
        const rows = snapshot[table] || [];

        try {
            if (preserveIds && preserveIds.size > 0) {
                const idsToDelete = rows
                    .map(row => rowId(row))
                    .filter(id => id && !preserveIds.has(id));
                console.log(`Resetting Supabase table: ${table} (${idsToDelete.length} rows, preserving ${preserveIds.size})`);
                await deleteRowsBySourceDocumentId(table, idsToDelete);
                deletedCounts[table] = idsToDelete.length;
                continue;
            }

            console.log(`Resetting Supabase table: ${table} (${rows.length} rows)`);
            await deleteAllManagedRows(table);
            deletedCounts[table] = rows.length;
        } catch (error) {
            if (isMissingSupabaseTableError(error)) {
                console.warn(`Skipping reset for ${table}: table not found`);
                deletedCounts[table] = 0;
                continue;
            }
            throw error;
        }
    }

    return deletedCounts;
}

function verifyAfterReset(beforeCounts, afterSnapshot, preservePlan) {
    const errors = [];
    const afterCounts = buildCounts(afterSnapshot);

    for (const table of BACKUP_TABLES) {
        if (FULL_PRESERVE_TABLES.has(table)) {
            if (afterCounts[table] !== beforeCounts[table]) {
                errors.push(`${table} count changed from ${beforeCounts[table]} to ${afterCounts[table]}`);
            }
            continue;
        }

        const preserveIds = preservePlan.preserveIdsByTable[table];
        if (preserveIds && preserveIds.size > 0) {
            if (afterCounts[table] !== preserveIds.size) {
                errors.push(`${table} expected ${preserveIds.size} preserved rows, got ${afterCounts[table]}`);
            }
            continue;
        }

        if (afterCounts[table] !== 0) {
            errors.push(`${table} expected 0 rows, got ${afterCounts[table]}`);
        }
    }

    const usersAfter = afterSnapshot.app_users || [];
    const linkedDriverIdsAfter = new Set(uniqueText(usersAfter.map(user => user.driver_ref)));
    for (const driverId of preservePlan.existingLinkedDriverIds) {
        if (!linkedDriverIdsAfter.has(driverId)) {
            errors.push(`app_users driver_ref ${driverId} was not preserved`);
        }
    }

    return { afterCounts, errors };
}

function printPlan(counts, preservePlan, missingTables) {
    const nonEmptyTables = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .sort(([left], [right]) => left.localeCompare(right));

    console.log('Supabase clean reset audit');
    console.log(`Tables with data: ${nonEmptyTables.length}`);
    for (const [table, count] of nonEmptyTables) {
        const preserved = FULL_PRESERVE_TABLES.has(table)
            ? 'preserved'
            : preservePlan.preserveIdsByTable[table]
                ? `partial preserve ${preservePlan.preserveIdsByTable[table].size}`
                : 'will reset';
        console.log(`- ${table}: ${count} (${preserved})`);
    }

    if (preservePlan.linkedDriverIds.length > 0) {
        console.log(`Driver refs on login users: ${preservePlan.linkedDriverIds.join(', ')}`);
    }
    if (preservePlan.missingLinkedDriverIds.length > 0) {
        console.warn(`Missing linked driver rows: ${preservePlan.missingLinkedDriverIds.join(', ')}`);
    }
    if (missingTables.length > 0) {
        console.warn(`Missing tables: ${missingTables.join(', ')}`);
    }
}

async function main() {
    const execute = hasFlag('--execute');
    const { snapshot, missingTables } = await fetchBackupSnapshot();
    const counts = buildCounts(snapshot);
    const preservePlan = buildPreservePlan(snapshot);

    printPlan(counts, preservePlan, missingTables);

    if (!execute) {
        console.log('Audit only. Re-run with --execute to backup and reset.');
        return;
    }

    const manifest = {
        createdAt: new Date().toISOString(),
        purpose: 'Clean Supabase app data while preserving login users and trip route rate masters.',
        missingTables,
        countsBefore: counts,
        preservePolicy: {
            fullTables: preservePlan.fullPreserveTables,
            partialTables: Object.fromEntries(
                Object.entries(preservePlan.preserveIdsByTable).map(([table, ids]) => [table, [...ids]])
            ),
            linkedDriverIds: preservePlan.linkedDriverIds,
            missingLinkedDriverIds: preservePlan.missingLinkedDriverIds,
        },
    };

    const backupDir = await writeBackup(snapshot, manifest);
    console.log(`Backup written: ${backupDir}`);

    const deletedCounts = await resetTables(snapshot, preservePlan);
    const { snapshot: afterSnapshot } = await fetchBackupSnapshot();
    const verification = verifyAfterReset(counts, afterSnapshot, preservePlan);

    const result = {
        backupDir,
        countsBefore: counts,
        countsAfter: verification.afterCounts,
        deletedCounts,
        verificationErrors: verification.errors,
    };
    console.log(JSON.stringify(result, null, 2));

    if (verification.errors.length > 0) {
        throw new Error(`Reset verification failed: ${verification.errors.join('; ')}`);
    }

    console.log('Clean reset complete and verified.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

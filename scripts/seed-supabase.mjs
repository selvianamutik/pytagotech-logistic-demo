import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import { seedRelationalTables, summarizeUnsupportedSeedDocTypes } from './_supabase-relational.mjs';
import { deriveTripSuratJalanDocs } from './_trip-surat-jalan-seed-utils.mjs';

loadScriptEnv();

const WORKFLOW_TRANSACTION_DOC_TYPES = [
    'order',
    'orderItem',
    'deliveryOrder',
    'deliveryOrderItem',
    'trip',
    'suratJalan',
    'suratJalanItem',
    'trackingLog',
    'driverVoucher',
    'driverVoucherDisbursement',
    'driverVoucherItem',
    'driverBorongan',
    'driverBoronganItem',
    'invoice',
    'invoiceItem',
    'freightNota',
    'freightNotaItem',
    'payment',
    'customerReceipt',
    'invoiceAdjustment',
    'customerOverpaymentRefund',
    'income',
    'maintenance',
    'incident',
    'incidentSettlementLine',
    'incidentActionLog',
];

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

function getArgValue(flag, fallback = '') {
    const match = process.argv.find(arg => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : fallback;
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function getCsvArgValues(flag) {
    const value = getArgValue(flag, '');
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
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

function logSkippedTypes(seedDocuments) {
    const skipped = summarizeUnsupportedSeedDocTypes(seedDocuments);
    if (skipped.length === 0) return;

    console.warn('Skipping non-relational seed document types:');
    for (const entry of skipped) {
        console.warn(`  - ${entry.type}: ${entry.count}`);
    }
}

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function isInventoryLinkedTireEvent(doc, warehouseItemsById) {
    if (!doc || doc._type !== 'tireEvent' || typeof doc.linkedWarehouseItemRef !== 'string' || !doc.linkedWarehouseItemRef.trim()) {
        return false;
    }
    const linkedItem = warehouseItemsById.get(doc.linkedWarehouseItemRef);
    return Boolean(linkedItem && linkedItem.trackingMode === 'TIRE_ASSET');
}

function filterInventoryLinkedTireSeedDocuments(seedDocuments) {
    const warehouseItemsById = new Map(
        seedDocuments
            .filter(doc => doc && doc._type === 'warehouseItem' && typeof doc._id === 'string')
            .map(doc => [doc._id, doc])
    );
    const keptTireEventIds = new Set();
    let removedTireEvents = 0;
    let originalTireEvents = 0;

    for (const doc of seedDocuments) {
        if (!doc || doc._type !== 'tireEvent') continue;
        originalTireEvents += 1;
        if (isInventoryLinkedTireEvent(doc, warehouseItemsById)) {
            keptTireEventIds.add(doc._id);
        } else {
            removedTireEvents += 1;
        }
    }

    if (originalTireEvents > 0 && keptTireEventIds.size === 0) {
        throw new Error('Seed ban tidak valid: semua tireEvent terfilter karena tidak terhubung ke inventory TIRE_ASSET.');
    }

    let removedTireHistoryLogs = 0;
    const filteredDocuments = seedDocuments.filter(doc => {
        if (!doc || doc._type !== 'tireEvent') return true;
        return keptTireEventIds.has(doc._id);
    }).filter(doc => {
        if (!doc || doc._type !== 'tireHistoryLog') return true;
        const keepHistory = keptTireEventIds.has(doc.tireEventRef);
        if (!keepHistory) {
            removedTireHistoryLogs += 1;
        }
        return keepHistory;
    });

    const warehouseStockByItemRef = new Map();
    for (const doc of filteredDocuments) {
        if (!doc || doc._type !== 'tireEvent') continue;
        if (doc.holderType === 'WAREHOUSE' && doc.status === 'IN_WAREHOUSE') {
            warehouseStockByItemRef.set(doc.linkedWarehouseItemRef, (warehouseStockByItemRef.get(doc.linkedWarehouseItemRef) || 0) + 1);
        }
    }

    for (const item of warehouseItemsById.values()) {
        if (item.trackingMode !== 'TIRE_ASSET') continue;
        const tireStock = warehouseStockByItemRef.get(item._id) || 0;
        const itemStock = toFiniteNumber(item.currentStockQty);
        if (itemStock !== tireStock) {
            throw new Error(`Seed ban tidak sinkron: ${item.itemCode || item._id} currentStockQty=${itemStock}, tetapi tireEvent IN_WAREHOUSE=${tireStock}.`);
        }
    }

    if (removedTireEvents > 0 || removedTireHistoryLogs > 0) {
        console.log(`Filtering standalone tire seed docs: removed ${removedTireEvents} tireEvent and ${removedTireHistoryLogs} tireHistoryLog rows.`);
    }

    return filteredDocuments;
}

async function main() {
    const seedFile = getArgValue('--input', path.join('artifacts', 'default-supabase-seed.json'));
    const raw = await readFile(path.resolve(process.cwd(), seedFile), 'utf8');
    const parsedSeedDocuments = JSON.parse(raw);

    if (!Array.isArray(parsedSeedDocuments)) {
        throw new Error('Seed input must be a JSON array.');
    }

    const skipWorkflowTransactions = hasFlag('--skip-workflow-transactions');
    const skipDocTypes = new Set(getCsvArgValues('--skip-doc-types'));
    const skipDocIds = new Set(getCsvArgValues('--skip-doc-ids'));
    if (skipWorkflowTransactions) {
        WORKFLOW_TRANSACTION_DOC_TYPES.forEach(type => skipDocTypes.add(type));
    }

    // Filter base documents before derivation so skipped delivery orders don't
    // spawn derived trips / surat jalan that also fail FK constraints.
    const filteredBaseDocuments = parsedSeedDocuments.filter(doc =>
        doc &&
        typeof doc === 'object' &&
        !skipDocTypes.has(doc._type) &&
        !skipDocIds.has(doc._id) &&
        !['trip', 'suratJalan', 'suratJalanItem'].includes(doc._type)
    );

    const deriveTripSuratJalan = hasFlag('--derive-trip-surat-jalan') && !skipWorkflowTransactions;
    const seedDocuments = deriveTripSuratJalan
        ? (() => {
            const { tripDocs, suratJalanDocs, suratJalanItemDocs } = deriveTripSuratJalanDocs(filteredBaseDocuments);
            console.log('Deriving Trip / Surat Jalan seed docs in-memory...');
            console.log(`  - trips: ${tripDocs.length}`);
            console.log(`  - surat jalan: ${suratJalanDocs.length}`);
            console.log(`  - surat jalan items: ${suratJalanItemDocs.length}`);
            return [...filteredBaseDocuments, ...tripDocs, ...suratJalanDocs, ...suratJalanItemDocs];
        })()
        : filteredBaseDocuments;

    const filteredSeedDocuments = seedDocuments.filter(doc =>
        !skipDocTypes.has(doc._type) &&
        !skipDocIds.has(doc._id)
    );
    const enforceInventoryLinkedTires = hasFlag('--enforce-inventory-linked-tires');
    const seedDocumentsToImport = enforceInventoryLinkedTires
        ? filterInventoryLinkedTireSeedDocuments(filteredSeedDocuments)
        : filteredSeedDocuments;

    if (skipDocTypes.size > 0) {
        console.log(`Skipping seed document types: ${Array.from(skipDocTypes).sort().join(', ')}`);
    }
    if (skipDocIds.size > 0) {
        console.log(`Skipping seed document ids: ${Array.from(skipDocIds).sort().join(', ')}`);
    }

    logSkippedTypes(seedDocumentsToImport);
    console.log(`Seeding relational tables from ${seedFile}${deriveTripSuratJalan ? ' with direct Trip / Surat Jalan derivation' : ''}...`);
    await seedRelationalTables(supabaseRequest, seedDocumentsToImport);
    console.log('Seed selesai.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

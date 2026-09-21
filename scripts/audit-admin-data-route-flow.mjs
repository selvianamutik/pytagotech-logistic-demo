import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/data/route.ts');
const source = fs.readFileSync(routePath, 'utf8');
const adminAppDir = path.join(process.cwd(), 'src/app/(admin)');
const dataImportRoutePath = path.join(process.cwd(), 'src/app/api/data-import/route.ts');
const dataImportRouteSource = fs.readFileSync(dataImportRoutePath, 'utf8');
const reminderRoutePath = path.join(process.cwd(), 'src/app/api/notifications/operational-admin/due-reminders/route.ts');
const reminderRouteSource = fs.readFileSync(reminderRoutePath, 'utf8');
const driverScoringRoutePath = path.join(process.cwd(), 'src/app/api/driver/scoring/acknowledge/route.ts');
const driverScoringRouteSource = fs.readFileSync(driverScoringRoutePath, 'utf8');
const proxyPath = path.join(process.cwd(), 'src/proxy.ts');
const proxySource = fs.readFileSync(proxyPath, 'utf8');
const rbacPath = path.join(process.cwd(), 'src/lib/rbac.ts');
const rbacSource = fs.readFileSync(rbacPath, 'utf8');
const suratJalanListPagePath = path.join(process.cwd(), 'src/app/(admin)/surat-jalan/page.tsx');
const suratJalanListPageSource = fs.readFileSync(suratJalanListPagePath, 'utf8');
const suratJalanDetailPagePath = path.join(process.cwd(), 'src/app/(admin)/surat-jalan/[id]/page.tsx');
const suratJalanDetailPageSource = fs.readFileSync(suratJalanDetailPagePath, 'utf8');
const adminClientPath = path.join(process.cwd(), 'src/lib/api/admin-client.ts');
const adminClientSource = fs.readFileSync(adminClientPath, 'utf8');
const customerDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/customers/[id]/page.tsx'), 'utf8');
const incidentDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/fleet/incidents/[id]/page.tsx'), 'utf8');
const driverDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/fleet/drivers/[id]/page.tsx'), 'utf8');
const tripDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/_components/TripDetailPage.tsx'), 'utf8');
const orderDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/orders/[id]/page.tsx'), 'utf8');
const driverVoucherDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/driver-vouchers/[id]/page.tsx'), 'utf8');
const documentTypesPath = path.join(process.cwd(), 'src/lib/document-types.ts');
const documentTypesSource = fs.readFileSync(documentTypesPath, 'utf8');
const financeWorkflowPath = path.join(process.cwd(), 'src/lib/api/finance-workflows.ts');
const financeWorkflowSource = fs.readFileSync(financeWorkflowPath, 'utf8');
const accountingStatementsPath = path.join(process.cwd(), 'src/app/(admin)/accounting/statements/page.tsx');
const accountingStatementsSource = fs.readFileSync(accountingStatementsPath, 'utf8');
const accountingLedgerPath = path.join(process.cwd(), 'src/app/(admin)/accounting/ledger/page.tsx');
const accountingLedgerSource = fs.readFileSync(accountingLedgerPath, 'utf8');
const accountingPostingPath = path.join(process.cwd(), 'src/lib/api/accounting-posting.ts');
const accountingPostingSource = fs.readFileSync(accountingPostingPath, 'utf8');
const accountingWorkflowsPath = path.join(process.cwd(), 'src/lib/api/accounting-workflows.ts');
const accountingWorkflowsSource = fs.readFileSync(accountingWorkflowsPath, 'utf8');
const backfillAccountingPath = path.join(process.cwd(), 'scripts/backfill-accounting-journals.ts');
const backfillAccountingSource = fs.readFileSync(backfillAccountingPath, 'utf8');
const genericWorkflowsPath = path.join(process.cwd(), 'src/lib/api/generic-workflows.ts');
const genericWorkflowsSource = fs.readFileSync(genericWorkflowsPath, 'utf8');
const driverWorkflowPath = path.join(process.cwd(), 'src/lib/api/driver-workflows.ts');
const driverWorkflowSource = fs.readFileSync(driverWorkflowPath, 'utf8');
const orderWorkflowPath = path.join(process.cwd(), 'src/lib/api/order-workflows.ts');
const orderWorkflowSource = fs.readFileSync(orderWorkflowPath, 'utf8');
const documentStorePath = path.join(process.cwd(), 'src/lib/repositories/document-store.ts');
const documentStoreSource = fs.readFileSync(documentStorePath, 'utf8');
const reportsSupportPath = path.join(process.cwd(), 'src/lib/reports-support.ts');
const reportsSupportSource = fs.readFileSync(reportsSupportPath, 'utf8');
const dataQuerySupportPath = path.join(process.cwd(), 'src/lib/api/data-query-support.ts');
const dataQuerySupportSource = fs.readFileSync(dataQuerySupportPath, 'utf8');
const invoiceListPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/invoices/page.tsx'), 'utf8');
const invoiceCreatePageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/invoices/new/page.tsx'), 'utf8');
const bankAccountDetailPageSource = fs.readFileSync(path.join(process.cwd(), 'src/app/(admin)/bank-accounts/[id]/page.tsx'), 'utf8');
const accountingLedgerMigrationPath = path.join(process.cwd(), 'supabase/migrations/0015_relational_accounting_ledger.sql');
const accountingLedgerMigrationSource = fs.readFileSync(accountingLedgerMigrationPath, 'utf8').toLowerCase();
const accountingRevisionMigrationPath = path.join(process.cwd(), 'supabase/migrations/0016_accounting_journal_revision_unique_index.sql');
const accountingRevisionMigrationSource = fs.readFileSync(accountingRevisionMigrationPath, 'utf8').toLowerCase();
const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const migrationSources = fs.readdirSync(migrationsDir)
    .filter(fileName => fileName.endsWith('.sql'))
    .sort()
    .map(fileName => ({
        fileName,
        source: fs.readFileSync(path.join(migrationsDir, fileName), 'utf8'),
    }));

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertBefore(sourceText, firstNeedle, secondNeedle, label) {
    const firstIndex = sourceText.indexOf(firstNeedle);
    const secondIndex = sourceText.indexOf(secondNeedle);
    assert(firstIndex >= 0, `${label}: marker pertama tidak ditemukan.`);
    assert(secondIndex >= 0, `${label}: marker kedua tidak ditemukan.`);
    assert(firstIndex < secondIndex, `${label}: urutan marker salah.`);
}

function extractBalancedBlockFrom(sourceText, label, startNeedle) {
    const startIndex = sourceText.indexOf(startNeedle);
    assert(startIndex >= 0, `${label} tidak ditemukan.`);

    const openIndex = sourceText.indexOf('{', startIndex);
    assert(openIndex >= 0, `Block ${label} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < sourceText.length; index += 1) {
        const char = sourceText[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return sourceText.slice(openIndex, index + 1);
        }
    }

    throw new Error(`Block ${label} tidak tertutup.`);
}

function extractBalancedBlock(label, startNeedle) {
    return extractBalancedBlockFrom(source, label, startNeedle);
}

function assertActionMappedToUpdate(block, action) {
    assert(
        block.includes(`action === '${action}'`),
        `Action ${action} belum masuk getMutationPermissionAction sebagai update.`
    );
}

function assertDispatch(block, entity, action, handler) {
    const actionIndex = block.indexOf(`entity === '${entity}' && action === '${action}'`);
    assert(actionIndex >= 0, `Dispatch action ${entity}/${action} tidak ditemukan di POST /api/data.`);
    const handlerIndex = block.indexOf(handler, actionIndex);
    assert(handlerIndex >= 0, `Action ${entity}/${action} tidak mengarah ke ${handler}.`);

    const nextDeliveryOrderDispatchIndex = block.indexOf(`entity === '${entity}' && action ===`, actionIndex + 1);
    assert(
        nextDeliveryOrderDispatchIndex < 0 || handlerIndex < nextDeliveryOrderDispatchIndex,
        `Handler ${handler} untuk action ${entity}/${action} berada di luar block dispatch yang benar.`
    );
}

function extractSpecialPermissionBlock(block, action, entity = 'delivery-orders') {
    const marker = `entity === '${entity}' && action === '${action}'`;
    const markerIndex = block.indexOf(marker);
    if (markerIndex < 0) return null;

    const ifStart = block.lastIndexOf('if', markerIndex);
    assert(ifStart >= 0, `Special permission ${action} tidak punya if block.`);
    const openIndex = block.indexOf('{', markerIndex);
    assert(openIndex >= 0, `Special permission ${action} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < block.length; index += 1) {
        const char = block[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return block.slice(ifStart, index + 1);
        }
    }

    throw new Error(`Special permission ${action} tidak tertutup.`);
}

function assertSpecialRoles(block, action, expectedRoles, entity = 'delivery-orders') {
    const permissionBlock = extractSpecialPermissionBlock(block, action, entity);
    assert(permissionBlock, `Special permission ${action} tidak ditemukan.`);

    const usesPermissionDelegation = /hasPermission\(\s*session\s*,\s*'[^']+'\s*,\s*'[^']+'\s*\)/.test(permissionBlock);

    for (const role of expectedRoles) {
        assert(
            permissionBlock.includes(`role === '${role}'`) || usesPermissionDelegation,
            `Special permission ${action} belum mengizinkan ${role}.`
        );
    }

    if (!usesPermissionDelegation) {
        for (const role of ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) {
            if (!expectedRoles.includes(role)) {
                assert(
                    !permissionBlock.includes(`role === '${role}'`),
                    `Special permission ${action} tidak boleh mengizinkan ${role}.`
                );
            }
        }
    }
}

const mutationPermissionBlock = extractBalancedBlock(
    'getMutationPermissionAction',
    'function getMutationPermissionAction'
);
const specialPermissionBlock = extractBalancedBlock(
    'hasSpecialMutationPermission',
    'function hasSpecialMutationPermission'
);
const postBlock = extractBalancedBlock('POST /api/data', 'export async function POST');
const entityModuleMapBlock = extractBalancedBlock('ENTITY_MODULE_MAP', 'const ENTITY_MODULE_MAP');
const accountingPeriodFallbackBlock = extractBalancedBlock(
    'shouldFallbackToBusinessDate',
    'function shouldFallbackToBusinessDate'
);

const documentTypeEntities = Array.from(
    documentTypesSource.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'[^']+'/gm),
    match => match[1]
);
const intentionallyUnmappedEntities = new Set(['company', 'incomes', 'driver-borogan-items']);
for (const entity of documentTypeEntities) {
    if (intentionallyUnmappedEntities.has(entity)) {
        continue;
    }
    const escapedEntity = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert(
        new RegExp(`(?:'${escapedEntity}'|${escapedEntity}):\\s*'`).test(entityModuleMapBlock),
        `Entity ${entity} belum punya mapping module API.`
    );
}

function matchesPathSegment(pathname, basePath) {
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function getAdminPageRoutes() {
    const routes = [];

    function walk(currentDir) {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const entryPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(entryPath);
                continue;
            }
            if (entry.name !== 'page.tsx') {
                continue;
            }

            const relativeDir = path.relative(adminAppDir, currentDir)
                .replace(/\\/g, '/')
                .split('/')
                .filter(segment => segment && !segment.startsWith('('))
                .join('/');
            routes.push(relativeDir ? `/${relativeDir}` : '/');
        }
    }

    walk(adminAppDir);
    return routes.sort();
}

function getProxyGuardPaths() {
    return Array.from(proxySource.matchAll(/\{\s*path:\s*'([^']+)'/g), match => match[1]);
}

function getSidebarHrefs() {
    return Array.from(rbacSource.matchAll(/href:\s*'([^']+)'/g), match => match[1]);
}

function auditAdminRouteProxyCoverage() {
    const proxyPaths = getProxyGuardPaths();
    const uncoveredAdminRoutes = getAdminPageRoutes()
        .filter(route => route !== '/')
        .filter(route => !proxyPaths.some(proxyPath => matchesPathSegment(route, proxyPath)));
    const uncoveredSidebarHrefs = getSidebarHrefs()
        .filter(href => !proxyPaths.some(proxyPath => matchesPathSegment(href, proxyPath)));

    assert(
        uncoveredAdminRoutes.length === 0,
        `Halaman admin belum punya proxy guard: ${uncoveredAdminRoutes.join(', ')}`
    );
    assert(
        uncoveredSidebarHrefs.length === 0,
        `Link sidebar belum punya proxy guard: ${uncoveredSidebarHrefs.join(', ')}`
    );
}

function auditSupabaseRlsCoverage() {
    const createdTables = new Set();
    const rlsEnabledTables = new Set();
    const publicViews = [];
    const securityDefinerFiles = [];

    for (const migration of migrationSources) {
        for (const match of migration.source.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)) {
            createdTables.add(match[1]);
        }
        for (const match of migration.source.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)) {
            rlsEnabledTables.add(match[1]);
        }

        const dynamicRlsList = migration.source.match(/foreach\s+table_name\s+in\s+array\s+array\[([\s\S]*?)\]/i);
        if (dynamicRlsList) {
            for (const match of dynamicRlsList[1].matchAll(/'([a-z0-9_]+)'/gi)) {
                rlsEnabledTables.add(match[1]);
            }
        }

        for (const match of migration.source.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.([a-z0-9_]+)/gi)) {
            publicViews.push(`${migration.fileName}:${match[1]}`);
        }

        if (/security\s+definer/i.test(migration.source)) {
            securityDefinerFiles.push(migration.fileName);
        }
    }

    const missingRlsTables = [...createdTables].filter(tableName => !rlsEnabledTables.has(tableName)).sort();
    assert(
        missingRlsTables.length === 0,
        `Table Supabase public belum enable RLS: ${missingRlsTables.join(', ')}`
    );
    assert(
        publicViews.length === 0,
        `Public view harus diaudit security_invoker atau dipindah dari exposed schema: ${publicViews.join(', ')}`
    );
    assert(
        securityDefinerFiles.length === 0,
        `Migration tidak boleh menambah SECURITY DEFINER di exposed schema tanpa audit eksplisit: ${securityDefinerFiles.join(', ')}`
    );
}

assert(
    entityModuleMapBlock.includes("'driver-scores': 'driverScores'"),
    'Entity driver-scores harus dikunci ke module driverScores.'
);
assert(
    proxySource.includes("{ path: '/fleet/drivers/skors', module: 'driverScores' }"),
    'Route /fleet/drivers/skors harus dikunci ke module driverScores.'
);
assertBefore(
    proxySource,
    "{ path: '/fleet/drivers/skors', module: 'driverScores' }",
    "{ path: '/fleet/drivers', module: 'drivers' }",
    'Proxy route skors supir harus lebih spesifik dari route supir'
);
assert(
    proxySource.includes("{ path: '/settings/import-data', module: 'dataImports' }"),
    'Route /settings/import-data harus dikunci ke module dataImports.'
);
assert(
    proxySource.includes("{ path: '/inventory', module: 'warehouseItems', fallbackModules: ['suppliers', 'purchases', 'maintenance'] }"),
    'Route /inventory harus bisa dibuka oleh role yang punya salah satu akses anak inventory.'
);
assert(
    rbacSource.includes("{ label: 'Pemakaian Barang', href: '/inventory/material-usage', icon: 'BarChart3', module: 'maintenance' }"),
    'Sidebar harus menampilkan Pemakaian Barang untuk role yang punya akses maintenance.'
);
assert(
    suratJalanListPageSource.includes('buildAdminLoadNotice') &&
        suratJalanListPageSource.includes('loadNotice?.title'),
    'List Surat Jalan harus menampilkan pesan akses/error yang jelas, bukan selalu empty-state data kosong.'
);
assert(
    suratJalanDetailPageSource.includes('loadOptionalCollection') &&
        suratJalanDetailPageSource.includes('detail.deliveryOrder.customerRef && canEditSuratJalan && canOpenCustomerPage'),
    'Detail Surat Jalan harus memperlakukan master barang customer sebagai data pendukung optional sesuai role.'
);
assert(
    suratJalanDetailPageSource.includes('buildAdminLoadNotice') &&
        suratJalanDetailPageSource.includes("'detail Surat Jalan'"),
    'Detail Surat Jalan harus menampilkan pesan akses terbatas saat data inti ditolak permission.'
);
assert(
    /hasPermission\(\s*session(?:\.role)?\s*,\s*'dataImports'\s*,\s*'view'\s*\)/.test(dataImportRouteSource),
    'POST /api/data-import harus mengunci akses ke module dataImports, bukan hanya target import.'
);
assert(
    reminderRouteSource.includes('ensureSameOriginRequest(request)'),
    'Manual POST reminder harus memakai same-origin guard saat tidak memakai secret bearer.'
);
assert(
    driverScoringRouteSource.includes('hasBearerDriverAuth(request)'),
    'Driver scoring acknowledge harus bypass same-origin hanya untuk Bearer token driver.'
);
auditAdminRouteProxyCoverage();
auditSupabaseRlsCoverage();

const deliveryOrderActions = [
    {
        action: 'set-status',
        handler: 'handleDeliveryOrderStatusUpdate',
        specialRoles: null,
    },
    {
        action: 'assign-trip-resources',
        handler: 'handleDeliveryOrderTripResourceAssign',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'append-cargo-items',
        handler: 'handleDeliveryOrderAppendCargoItems',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'update-cargo-item',
        handler: 'handleDeliveryOrderCargoItemUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'remove-cargo-item',
        handler: 'handleDeliveryOrderCargoItemRemove',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'update-shipper-reference',
        handler: 'handleDeliveryOrderShipperReferenceUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'FINANCE'],
    },
    {
        action: 'update-surat-jalan-actual-cargo',
        handler: 'handleDeliveryOrderSuratJalanActualCargoUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'reject-driver-status-request',
        handler: 'handleDeliveryOrderDriverStatusRequestReject',
        specialRoles: null,
    },
];

for (const item of deliveryOrderActions) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, 'delivery-orders', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );

    if (item.specialRoles) {
        assertSpecialRoles(specialPermissionBlock, item.action, item.specialRoles);
    } else {
        assert(
            !extractSpecialPermissionBlock(specialPermissionBlock, item.action),
            `Action ${item.action} seharusnya memakai permission module umum, bukan special role override.`
        );
    }
}

const freightNotaUpdateActions = [
    {
        action: 'update-with-items',
        handler: 'handleFreightNotaUpdate',
    },
    {
        action: 'update-pph23',
        handler: 'handleFreightNotaPph23Update',
    },
];

for (const item of freightNotaUpdateActions) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, 'freight-notas', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );
}

for (const item of [
    {
        entity: 'supplier-item-prices',
        action: 'revise-price',
        handler: 'handleSupplierItemPriceRevise',
    },
]) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, item.entity, item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );
}

const supplierPriceRevisionBlock = extractBalancedBlockFrom(
    genericWorkflowsSource,
    'handleSupplierItemPriceRevise',
    'export async function handleSupplierItemPriceRevise'
);
assert(
    supplierPriceRevisionBlock.includes('supplierPriceHistoricalFieldsChanged') &&
    supplierPriceRevisionBlock.includes('Harga supplier historis yang sudah dipakai pembelian tidak boleh ditimpa'),
    'Revisi harga supplier harus menolak overwrite field historis yang sudah dipakai pembelian.'
);
assert(
    supplierPriceRevisionBlock.includes('nextEffectiveFrom < existingEffectiveFrom'),
    'Revisi harga supplier harus menolak tanggal efektif yang mundur dari versi lama.'
);

const manualJournalActions = [
    {
        action: 'create-manual',
        handler: 'handleManualJournalCreate',
        specialRoles: ['OWNER', 'FINANCE'],
    },
    {
        action: 'void-manual',
        handler: 'handleManualJournalVoid',
        specialRoles: ['OWNER', 'FINANCE'],
    },
];

for (const item of manualJournalActions) {
    assertDispatch(postBlock, 'journal-entries', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );
    assertSpecialRoles(specialPermissionBlock, item.action, item.specialRoles, 'journal-entries');
}

for (const controlAccountSystemKey of [
    'cash_on_hand',
    'bank',
    'accounts_receivable',
    'accounts_payable',
    'inventory',
    'driver_advance',
    'customer_deposit',
]) {
    assert(
        accountingWorkflowsSource.includes(`'${controlAccountSystemKey}'`),
        `Jurnal manual harus mengunci akun kontrol workflow ${controlAccountSystemKey} agar sub-ledger tidak mismatch.`
    );
}
assert(
    accountingWorkflowsSource.includes('WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS') &&
        accountingWorkflowsSource.includes('Akun kontrol') &&
        accountingWorkflowsSource.includes('saldo rincian dan buku besar tetap sinkron'),
    'Workflow jurnal manual harus menjelaskan kenapa akun kontrol workflow ditolak.'
);

assert(
    postBlock.includes("session.role === 'DRIVER'") &&
        postBlock.includes('Driver tidak diizinkan mengakses API admin'),
    'POST /api/data harus tetap menolak role DRIVER karena driver memakai route /api/driver.'
);

const hardCodedReceivableLegacyUpdates = financeWorkflowSource.match(
    /updateDocument\([\s\S]{0,220}buildReceivablePatch\([\s\S]{0,220}['"]invoice['"]\)/g
) || [];
assert(
    hardCodedReceivableLegacyUpdates.length === 0,
    'Mutasi piutang tidak boleh hard-code updateDocument(..., buildReceivablePatch(...), "invoice") karena invoice aktif memakai freightNota.'
);
assert(
    financeWorkflowSource.includes('function getReceivableDocumentType') &&
        financeWorkflowSource.includes('async function updateReceivableSnapshot'),
    'Finance workflow harus memakai helper updateReceivableSnapshot agar tipe dokumen piutang mengikuti snapshot.'
);
const freightNotaWorkflowUpdateBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'handleFreightNotaUpdate',
    'export async function handleFreightNotaUpdate'
);
assert(
    freightNotaWorkflowUpdateBlock.includes('buildNotaRowsFromDeliveryOrder') &&
        freightNotaWorkflowUpdateBlock.includes('findBuiltNotaRowMatch') &&
        freightNotaWorkflowUpdateBlock.includes('hasDeliveryOrderBillableCargo') &&
        freightNotaWorkflowUpdateBlock.includes('belum punya realisasi drop yang bisa ditagihkan'),
    'Revisi invoice harus memvalidasi ulang realisasi drop billable seperti create invoice agar barang hold/return tidak bisa ditagihkan lewat edit.'
);
assert(
    (freightNotaWorkflowUpdateBlock.match(/buildFreightNotaCoverageRowKeys/g) || []).length >= 2,
    'Revisi invoice harus memakai coverage key yang sama dengan create invoice agar alias nomor SJ/header tidak bisa double billing.'
);
assert(
    !accountingStatementsSource.includes('toISOString().slice(0, 10)'),
    'Laporan keuangan tidak boleh memakai toISOString().slice(0, 10) untuk periode karena timezone bisa menggeser tanggal akhir bulan.'
);
assert(
    !accountingPostingSource.includes('new Date().toISOString().slice(0, 10)'),
    'Posting jurnal fallback harus memakai business date, bukan tanggal UTC dari toISOString().'
);
assert(
    (accountingPostingSource.includes('const maxSequence = existingEntries.reduce') ||
        accountingPostingSource.includes('const maxSequence = monthEntries.reduce')) &&
        accountingPostingSource.includes('Math.max(max, sequence)') &&
        !accountingPostingSource.includes('const periodCount = existingEntries.filter'),
    'Nomor jurnal harus memakai suffix maksimum existing, bukan count row, agar void/delete cleanup tidak membuat nomor jurnal duplikat.'
);
assert(
    documentStoreSource.includes('relationalMaxNumericSuffixByPrefix') &&
        documentStoreSource.includes('const maxExistingSuffix') &&
        documentStoreSource.includes('Math.max(currentCounter, maxExistingSuffix) + 1') &&
        !documentStoreSource.includes('relationalCountByPrefix') &&
        documentStoreSource.includes("company.synced_at") &&
        documentStoreSource.includes("'is.null'"),
    'Nomor dokumen bisnis harus memakai suffix maksimum existing dan lock synced_at null-safe, bukan count row yang bisa membuat nomor duplikat setelah void/delete.'
);
assert(
    !accountingPostingSource.includes('deleteDocument('),
    'Posting jurnal tidak boleh menghapus line jurnal lama. Revisi jurnal harus void entry lama lalu post entry baru agar riwayat tetap utuh.'
);
assert(
    accountingPostingSource.includes('function isSamePostedJournal') &&
        accountingPostingSource.includes("const activeEntries = sourceEntries.filter(entry => entry.status !== 'VOID')") &&
        accountingPostingSource.includes('activeEntries.length === 1') &&
        accountingPostingSource.includes("status: 'VOID'"),
    'Posting jurnal harus idempotent: jika isi sama jangan repost, jika berubah void jurnal aktif lama lalu buat jurnal baru.'
);
assert(
    accountingPostingSource.includes("filter(entry => entry.status !== 'VOID')") &&
        accountingPostingSource.includes('Promise.all(existing.map'),
    'Void jurnal harus menutup semua jurnal aktif untuk source yang sama, bukan hanya hasil query pertama.'
);
assert(
    accountingPostingSource.includes('function resolveDriverVoucherIssuedAmount') &&
        accountingPostingSource.includes('const driverAdvanceCloseAmount = resolveDriverVoucherIssuedAmount') &&
        accountingPostingSource.includes('const additionalPaymentAmount = Math.max(-balance, 0)') &&
        !accountingPostingSource.includes('totalExpense + Math.max(balance, 0)') &&
        !accountingPostingSource.includes("lines.push({ account: 'driver_advance', debit: shortage"),
    'Settlement uang jalan harus menutup akun bon sebesar total uang diberikan dan mencatat kekurangan sebagai kredit kas/bank, bukan debit-kredit ulang di akun bon.'
);
assertActionMappedToUpdate(mutationPermissionBlock, 'settle-batch');
assertDispatch(postBlock, 'driver-vouchers', 'settle-batch', 'handleDriverVoucherBatchSettlement');
const settleBatchPermissionBlock = extractSpecialPermissionBlock(specialPermissionBlock, 'settle-batch', 'driver-vouchers');
assert(settleBatchPermissionBlock, 'Special permission settle-batch belum ada di hasSpecialMutationPermission.');
assert(
    /hasPermission\(\s*session\s*,\s*'driverVouchers'\s*,\s*'update'\s*\)/.test(settleBatchPermissionBlock),
    'settle-batch harus memakai hasPermission(session, driverVouchers, update).'
);
assert(
    accountingPeriodFallbackBlock.includes("action === 'settle-batch'"),
    'settle-batch harus masuk fallback business date pengecekan periode akuntansi.'
);
const driverVoucherBatchSettleBlock = extractBalancedBlockFrom(
    driverWorkflowSource,
    'handleDriverVoucherBatchSettlement',
    'export async function handleDriverVoucherBatchSettlement'
);
assert(
    driverVoucherBatchSettleBlock.includes('handleDriverVoucherSettlement') &&
        driverVoucherBatchSettleBlock.includes('settled.push') &&
        driverVoucherBatchSettleBlock.includes('failed.push'),
    'Penyelesaian massal harus mengulang logika settle per trip (handleDriverVoucherSettlement) dan mengumpulkan hasil selesai/gagal.'
);
const driverVoucherDisbursementDeleteBlock = extractBalancedBlockFrom(
    driverWorkflowSource,
    'handleDriverVoucherDisbursementDelete',
    'export async function handleDriverVoucherDisbursementDelete'
);
assert(
    driverVoucherDisbursementDeleteBlock.includes("status: 'VOID'") &&
        driverVoucherDisbursementDeleteBlock.includes('voidedAt: new Date().toISOString()') &&
        driverVoucherDisbursementDeleteBlock.includes('const remainingDisbursements = state.disbursements.filter') &&
        !driverVoucherDisbursementDeleteBlock.includes('getDriverVoucherIssuedAmount(state.voucher) - amount') &&
        driverVoucherDisbursementDeleteBlock.includes('reversalBankTransactionRef') &&
        driverVoucherDisbursementDeleteBlock.includes("type: 'CREDIT'") &&
        driverVoucherDisbursementDeleteBlock.includes('reversesBankTransactionRef') &&
        driverVoucherDisbursementDeleteBlock.includes("voidJournalEntryForSource(session, 'DRIVER_VOUCHER_DISBURSEMENT'") &&
        !driverVoucherDisbursementDeleteBlock.includes("deleteDocument(disbursementId, 'driverVoucherDisbursement')") &&
        !driverVoucherDisbursementDeleteBlock.includes('deleteDocument(disbursement.bankTransactionRef'),
    'Hapus top up uang jalan harus soft-void disbursement, membuat mutasi bank pembalik, dan void jurnal; bukan menghapus histori pencairan.'
);
const driverVoucherItemUpdateBlock = extractBalancedBlockFrom(
    driverWorkflowSource,
    'handleDriverVoucherItemUpdate',
    'export async function handleDriverVoucherItemUpdate'
);
assert(
    driverVoucherItemUpdateBlock.includes("state.voucher.status === 'SETTLED'") &&
        driverVoucherItemUpdateBlock.includes('computeDriverVoucherTotals') &&
        driverVoucherItemUpdateBlock.includes("updateDocument(itemId, itemPatch, 'driverVoucherItem')") &&
        driverVoucherItemUpdateBlock.includes("updateDocument(initialItem.voucherRef") &&
        driverVoucherItemUpdateBlock.includes("'UPDATE'") &&
        driverVoucherItemUpdateBlock.includes("'driver-voucher-items'"),
    'Edit biaya lain-lain harus lewat workflow khusus, menolak bon settled, update item, hitung ulang total voucher, dan tulis audit log.'
);
assertDispatch(postBlock, 'driver-voucher-items', 'update', 'handleDriverVoucherItemUpdate');
assert(
    source.includes("entity === 'driver-voucher-disbursements'") &&
        source.includes("items = items.filter(item => item.status !== 'VOID');"),
    'GET driver-voucher-disbursements harus menyembunyikan disbursement VOID dari UI aktif.'
);
const freightNotaDeleteBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'handleFreightNotaDelete',
    'export async function handleFreightNotaDelete'
);
assert(
    freightNotaDeleteBlock.includes("status: 'VOID'") &&
        freightNotaDeleteBlock.includes('voidedAt: nowIso') &&
        freightNotaDeleteBlock.includes("voidJournalEntryForSource(session, 'FREIGHT_NOTA', id, 'ISSUE')") &&
        freightNotaDeleteBlock.includes("voidJournalEntryForSource(session, 'FREIGHT_NOTA', id, 'PPH23')") &&
        !freightNotaDeleteBlock.includes("deleteDocument(id, 'freightNota')") &&
        !freightNotaDeleteBlock.includes("deleteDocument(item._id, 'freightNotaItem')"),
    'Hapus invoice harus soft-void invoice dan itemnya, lalu void jurnal; bukan menghapus histori invoice.'
);
assert(
    financeWorkflowSource.includes("existingNotaItems.filter(item => item.status !== 'VOID')") &&
        financeWorkflowSource.includes("item.status !== 'VOID' && itemDoRef && uniqueDoRefs.includes(itemDoRef)") &&
        source.includes("entity === 'freight-nota-items'") &&
        source.includes("items = items.filter(item => item.status !== 'VOID');"),
    'Item invoice VOID harus disembunyikan dari UI aktif dan tidak boleh ikut guard double billing.'
);
const actualCargoInvoiceLockStart = orderWorkflowSource.indexOf('async function getDeliveryOrderActualCargoInvoiceLockMessage');
assert(actualCargoInvoiceLockStart >= 0, 'getDeliveryOrderActualCargoInvoiceLockMessage tidak ditemukan.');
const actualCargoInvoiceLockEnd = orderWorkflowSource.indexOf('async function applyTripClosureOdometerUpdates', actualCargoInvoiceLockStart);
assert(actualCargoInvoiceLockEnd > actualCargoInvoiceLockStart, 'Block getDeliveryOrderActualCargoInvoiceLockMessage tidak tertutup sebelum helper berikutnya.');
const actualCargoInvoiceLockBlock = orderWorkflowSource.slice(actualCargoInvoiceLockStart, actualCargoInvoiceLockEnd);
assert(
    actualCargoInvoiceLockBlock.includes("item.status !== 'VOID'") &&
        orderWorkflowSource.includes("function getFreightNotaUsageItemRefs(row: Pick<DeliveryOrderInvoiceUsageRow, 'deliveryOrderItemRef' | 'deliveryOrderItemRefs'>)") &&
        actualCargoInvoiceLockBlock.includes('actualDropPointKey') &&
        actualCargoInvoiceLockBlock.includes('targetNoSJs'),
    'Lock edit aktual SJ harus granular per item/SJ/titik drop dan mengabaikan item invoice VOID.'
);
const suratJalanActualCargoUpdateBlock = extractBalancedBlockFrom(
    orderWorkflowSource,
    'handleDeliveryOrderSuratJalanActualCargoUpdate',
    'export async function handleDeliveryOrderSuratJalanActualCargoUpdate'
);
assert(
    suratJalanActualCargoUpdateBlock.includes('getDeliveryOrderActualCargoInvoiceLockMessage') &&
        suratJalanActualCargoUpdateBlock.includes("suratJalanRecord.tripStatus !== 'DELIVERED'") &&
        suratJalanActualCargoUpdateBlock.includes('deliveryOrder.tripClosedByAdminAt') &&
        suratJalanActualCargoUpdateBlock.includes('hasPendingDriverApprovalRequest(deliveryOrder)') &&
        suratJalanActualCargoUpdateBlock.includes('targetActualDropPoints: previousTargetedBillablePoints') &&
        suratJalanActualCargoUpdateBlock.includes('return NextResponse.json({ error: invoiceLockMessage }, { status: 409 });'),
    'Edit aktual SJ harus hanya untuk SJ delivered, menolak trip ditutup/pending approval, dan ditolak sebelum mutation ketika SJ/barang/titik drop sudah masuk invoice aktif.'
);
const shipperReferenceUpdateBlock = extractBalancedBlockFrom(
    orderWorkflowSource,
    'handleDeliveryOrderShipperReferenceUpdate',
    'export async function handleDeliveryOrderShipperReferenceUpdate'
);
assert(
    shipperReferenceUpdateBlock.includes("status?: string") &&
        shipperReferenceUpdateBlock.includes("find(item => item.status !== 'VOID')"),
    'Ubah nomor SJ harus mengabaikan item invoice VOID agar invoice yang sudah dibatalkan tidak tetap mengunci data.'
);
const orderCancelBlock = extractBalancedBlockFrom(
    orderWorkflowSource,
    'handleOrderCancel',
    'export async function handleOrderCancel'
);
assert(
    orderCancelBlock.includes("status?: string") &&
        orderCancelBlock.includes("find(item => item.status !== 'VOID')"),
    'Batal order harus mengabaikan item invoice VOID saat mengecek histori invoice aktif.'
);
const receivableSnapshotBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'loadReceivableSnapshot',
    'async function loadReceivableSnapshot'
);
assert(
    receivableSnapshotBlock.includes("doc.status === 'VOID'") &&
        receivableSnapshotBlock.includes('Invoice yang sudah dibatalkan tidak bisa diproses lagi') &&
        receivableSnapshotBlock.includes('{ status: 409 }'),
    'Semua mutasi piutang harus menolak invoice VOID lewat loadReceivableSnapshot, bukan hanya menyembunyikan dari UI.'
);
const customerReceiptCreateBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'handleCustomerReceiptCreate',
    'export async function handleCustomerReceiptCreate'
);
assert(
    !customerReceiptCreateBlock.includes("throw new Error('Semua alokasi penerimaan wajib memilih invoice')") &&
        !customerReceiptCreateBlock.includes("throw new Error('Nominal alokasi penerimaan tidak valid')") &&
        customerReceiptCreateBlock.includes("NextResponse.json({ error: 'Semua alokasi penerimaan wajib memilih invoice' }, { status: 400 })") &&
        customerReceiptCreateBlock.includes("NextResponse.json({ error: 'Nominal alokasi penerimaan tidak valid' }, { status: 400 })"),
    'Validasi alokasi customer receipt harus mengembalikan 400 JSON, bukan throw mentah yang bisa menjadi 500.'
);
assert(
    reportsSupportSource.includes('const activeFreightNotas = freightNotas.filter(item => item.status !== \'VOID\')') &&
        reportsSupportSource.includes('const totalNotaIssued = activeFreightNotas') &&
        reportsSupportSource.includes('const totalNotaOutstanding = activeFreightNotas'),
    'Laporan keuangan harus mengecualikan invoice VOID dari total terbit dan outstanding walaupun data dipanggil langsung.'
);
assert(
    bankAccountDetailPageSource.includes('`/api/data?entity=${entity}&id=${encodeURIComponent(id)}`') &&
        !bankAccountDetailPageSource.includes('.filter(id => /^nota-/i.test(id))'),
    'Detail rekening/kas harus bisa membuka link invoice UUID dari mutasi bank; jangan membatasi invoiceRef hanya format lama nota-.'
);
assert(
    dataQuerySupportSource.includes('function filterRequestsFreightNotaStatus') &&
        dataQuerySupportSource.includes("const includeVoidedNotas = filterRequestsFreightNotaStatus(filterObj, 'VOID');") &&
        dataQuerySupportSource.includes('const visibleNotaRows = includeVoidedNotas ? notaRows : notaRows.filter(isActiveFreightNota);') &&
        dataQuerySupportSource.includes("if (operator === 'in')") &&
        dataQuerySupportSource.includes('Array.isArray(operatorValue) && operatorValue.includes(actualValue as never)') &&
        dataQuerySupportSource.includes('applyDerivedFreightNotaStatus(visibleNotaRows, paymentTotalsByInvoice, invoiceRefundsByRef)') &&
        invoiceListPageSource.includes('if (nota.status === \'VOID\')') &&
        invoiceListPageSource.includes('<option value="">Semua Status Aktif</option>'),
    'Daftar invoice harus default menampilkan status aktif saja, tetapi filter Dibatalkan tetap bisa mengambil invoice VOID secara eksplisit.'
);
assert(
    invoiceCreatePageSource.includes("taripSource: 'MANUAL'") &&
        invoiceCreatePageSource.includes("taripSource === 'MASTER'") &&
        invoiceCreatePageSource.includes('customerBillingRateSnapshot') &&
        invoiceCreatePageSource.includes('applyMasterRateToRow') &&
        invoiceCreatePageSource.includes('Tarif master untuk baris ini belum ditemukan') &&
        financeWorkflowSource.includes('taripSource') &&
        financeWorkflowSource.includes('customerBillingRateSnapshot'),
    'Buat/revisi invoice harus menyimpan snapshot sumber tarif dan menjaga override manual agar tidak diam-diam ditimpa master data.'
);
assert(
    invoiceCreatePageSource.includes('async (): Promise<InvoiceReferenceData>') &&
        invoiceCreatePageSource.includes('ensureInvoiceReferenceData') &&
        invoiceCreatePageSource.includes('ensureCustomerBillingRates') &&
        invoiceCreatePageSource.includes("fetchAllAdminCollectionData<Order>('/api/data?entity=orders'") &&
        invoiceCreatePageSource.includes("fetchAllAdminCollectionData<DeliveryOrderItem>('/api/data?entity=delivery-order-items'") &&
        invoiceCreatePageSource.includes("fetchAllAdminCollectionData<CustomerBillingRate>") &&
        !invoiceCreatePageSource.includes("fetchAdminCollectionData<Order[]>('/api/data?entity=orders'") &&
        !invoiceCreatePageSource.includes("fetchAdminCollectionData<DeliveryOrderItem[]>('/api/data?entity=delivery-order-items'") &&
        !invoiceCreatePageSource.includes("fetchAdminCollectionData<CustomerBillingRate[]>('/api/data?entity=customer-billing-rates'"),
    'Halaman buat/revisi invoice tidak boleh mengambil order, item DO, semua tarif, dan pemakaian invoice secara luas saat initial load; data berat harus lazy saat dibutuhkan.'
);
assert(
    invoiceCreatePageSource.includes('const [revisionBlock, setRevisionBlock]') &&
        invoiceCreatePageSource.includes("fetchAllAdminCollectionData<Payment>") &&
        invoiceCreatePageSource.includes("fetchAllAdminCollectionData<CustomerOverpaymentRefund>") &&
        invoiceCreatePageSource.includes('Invoice Tidak Bisa Direvisi Penuh') &&
        invoiceCreatePageSource.includes('Buat Tagihan Susulan') &&
        financeWorkflowSource.includes('Invoice tidak bisa direvisi setelah ada pembayaran, refund, atau klaim/potongan aktif'),
    'Direct URL revisi invoice harus diblokir jelas sebelum form terbuka ketika invoice sudah punya pembayaran, refund, atau klaim/potongan.'
);
assert(
    rbacSource.includes('invoices:') &&
        rbacSource.includes('freightNotas:') &&
        rbacSource.includes("{ label: 'Invoice', href: '/invoices', icon: 'Receipt', module: 'invoices' }") &&
        !rbacSource.includes("{ label: 'Invoice', href: '/invoices', icon: 'Receipt', module: 'freightNotas' }") &&
        proxySource.includes("{ path: '/invoices', module: 'invoices' }") &&
        !proxySource.includes("{ path: '/invoices', module: 'freightNotas' }") &&
        source.includes("payments: 'invoices'") &&
        source.includes("'customer-receipts': 'invoices'") &&
        source.includes("'customer-overpayment-refunds': 'invoices'") &&
        source.includes("'invoice-adjustments': 'invoices'") &&
        source.includes("'freight-notas': 'invoices'") &&
        source.includes("'freight-nota-items': 'invoices'") &&
        (invoiceListPageSource.includes("hasPermission(user, 'invoices', 'create')") ||
            invoiceListPageSource.includes("hasPermission(user.role, 'invoices', 'create')")) &&
        (invoiceListPageSource.includes("hasPermission(user, 'invoices', 'update')") ||
            invoiceListPageSource.includes("hasPermission(user.role, 'invoices', 'update')")),
    'Akses invoice harus memakai modul canonical invoices; freightNotas hanya alias kompatibilitas agar API, proxy, sidebar, dan tombol UI tidak pecah role-nya.'
);
assert(
    reportsSupportSource.includes("function isInvoiceOverpaymentRefund") &&
        reportsSupportSource.includes("item => isInvoiceOverpaymentRefund(item) && inPeriod(item.date)") &&
        reportsSupportSource.includes("const revenueRefundRows = filteredOverpaymentRefunds.filter(isInvoiceOverpaymentRefund)"),
    'Laba/rugi hanya boleh mengurangi pendapatan dari refund overpaid invoice; refund sisa receipt belum teralokasi adalah arus kas, bukan koreksi pendapatan.'
);
assert(
    reportsSupportSource.includes("getDateSortTime(b.date) - getDateSortTime(a.date)") &&
        reportsSupportSource.includes("String(b._createdAt || '').localeCompare(String(a._createdAt || ''))") &&
        reportsSupportSource.includes("String(b._id).localeCompare(String(a._id))"),
    'Laporan arus kas harus mengurutkan mutasi secara stabil berdasarkan tanggal, waktu dibuat, lalu id agar saldo berjalan tidak terlihat acak pada tanggal yang sama.'
);
for (const [label, migrationSource] of [
    ['schema awal accounting ledger', accountingLedgerMigrationSource],
    ['migration revisi accounting journal unique index', accountingRevisionMigrationSource],
]) {
    assert(
        migrationSource.includes('idx_journal_entries_source_event_unique') &&
            migrationSource.includes("where status = 'posted'") &&
            migrationSource.includes('source_type is not null') &&
            migrationSource.includes('source_ref is not null') &&
            migrationSource.includes('source_event is not null'),
        `Unique index source jurnal di ${label} harus hanya membatasi jurnal POSTED agar jurnal VOID tetap menjadi riwayat revisi.`
    );
}
assert(
    accountingRevisionMigrationSource.includes('drop index if exists public.idx_journal_entries_source_event_unique'),
    'Migration revisi jurnal harus drop unique index lama yang belum memfilter status POSTED.'
);
assert(
    accountingLedgerSource.includes('const periodLines') &&
        accountingLedgerSource.includes('const cumulativeLines') &&
        accountingLedgerSource.includes('buildProfitLossFromLedger(periodSummaries)') &&
        accountingLedgerSource.includes('buildBalanceSheetFromLedger(balanceSummaries)'),
    'Buku besar harus memisahkan mutasi periode untuk laba/rugi dan saldo kumulatif untuk neraca.'
);
assert(
    accountingLedgerSource.includes('String(right.entryDate || "").localeCompare(String(left.entryDate || ""))') &&
        accountingLedgerSource.includes('.slice(0, 40)'),
    'Mutasi terakhir buku besar harus disort kronologis desc secara stabil, bukan mengambil urutan fetch detail jurnal.'
);
assert(
    accountingPostingSource.includes('postBankAccountOpeningBalanceJournal') &&
        accountingPostingSource.includes("sourceType: 'BANK_ACCOUNT'") &&
        accountingPostingSource.includes("sourceEvent: 'OPENING_BALANCE'") &&
        accountingPostingSource.includes("account: 'equity_capital'"),
    'Saldo awal rekening/kas harus diposting sebagai jurnal opening balance ke modal agar neraca mengikuti saldo kas-bank aktual.'
);
assert(
    backfillAccountingSource.includes('postBankAccountOpeningBalanceJournal') &&
        backfillAccountingSource.includes("voidJournalEntryForSource(BACKFILL_SESSION, 'BANK_ACCOUNT'") &&
        backfillAccountingSource.includes('resolveOpeningBalanceDate(bankAccount, bankTransactions)'),
    'Backfill accounting harus membangun ulang jurnal saldo awal rekening dan membatalkan jurnal saldo awal yang sudah nol.'
);
const genericWorkflowPath = path.join(process.cwd(), 'src/lib/api/generic-workflows.ts');
const genericWorkflowSource = fs.readFileSync(genericWorkflowPath, 'utf8');
const protectedLedgerBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isProtectedLedgerEntity',
    'function isProtectedLedgerEntity'
);
const workflowCreateBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isWorkflowManagedCreateEntity',
    'function isWorkflowManagedCreateEntity'
);
const workflowUpdateBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isWorkflowManagedUpdateEntity',
    'function isWorkflowManagedUpdateEntity'
);
const workflowDeleteBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isWorkflowManagedDeleteEntity',
    'function isWorkflowManagedDeleteEntity'
);

for (const accountingEntity of ['chart-of-accounts', 'journal-entries', 'journal-lines', 'accounting-periods']) {
    assert(
        protectedLedgerBlock.includes(`entity === '${accountingEntity}'`),
        `Entity akuntansi ${accountingEntity} harus dilindungi dari mutation API umum.`
    );
    assert(
        workflowCreateBlock.includes(`entity === '${accountingEntity}'`),
        `Entity akuntansi ${accountingEntity} tidak boleh dibuat lewat generic create walaupun role finance punya izin create laporan.`
    );
}

for (const ledgerEntity of [
    'payments',
    'customer-receipts',
    'customer-overpayment-refunds',
    'invoice-adjustments',
    'incomes',
    'expenses',
    'bank-transactions',
    'purchase-payments',
]) {
    assert(
        protectedLedgerBlock.includes(`entity === '${ledgerEntity}'`),
        `Entity ledger ${ledgerEntity} harus ditolak dari update/delete generic.`
    );
}

for (const workflowEntity of [
    'stock-movements',
    'driver-vouchers',
    'driver-voucher-items',
    'driver-voucher-disbursements',
    'purchases',
    'purchase-items',
    'freight-notas',
    'freight-nota-items',
]) {
    assert(
        workflowCreateBlock.includes(`entity === '${workflowEntity}'`),
        `Entity workflow ${workflowEntity} tidak boleh dibuat lewat generic create.`
    );
}

for (const workflowEntity of [
    'stock-movements',
    'driver-vouchers',
    'driver-voucher-items',
    'driver-voucher-disbursements',
    'purchases',
    'purchase-items',
    'freight-notas',
    'freight-nota-items',
]) {
    assert(
        workflowUpdateBlock.includes(`entity === '${workflowEntity}'`),
        `Entity workflow ${workflowEntity} tidak boleh diubah lewat generic update.`
    );
}

for (const workflowEntity of [
    'stock-movements',
    'driver-vouchers',
    'purchase-payments',
    'purchases',
    'purchase-items',
    'freight-nota-items',
]) {
    assert(
        workflowDeleteBlock.includes(`entity === '${workflowEntity}'`),
        `Entity workflow ${workflowEntity} tidak boleh dihapus lewat generic delete.`
    );
}

for (const routeGuard of [
    ["payments", 'isCreateAction', 'handlePaymentCreate'],
    ["customer-receipts", 'isCreateAction', 'handleCustomerReceiptCreate'],
    ["expenses", null, 'handleExpenseCreate'],
    ["purchase-payments", "action === 'record-payment' || !action", 'handlePurchasePaymentCreate'],
    ["stock-movements", 'isCreateAction', 'handleStockMovementCreate'],
    ["driver-vouchers", null, 'handleDriverVoucherCreate'],
    ["driver-voucher-items", null, 'handleDriverVoucherItemCreate'],
]) {
    const [entity, condition, handler] = routeGuard;
    assert(postBlock.includes(`entity === '${entity}'`), `Route ${entity} belum punya guard khusus.`);
    if (condition) {
        assert(postBlock.includes(condition), `Route ${entity} belum membatasi condition ${condition}.`);
    }
    assert(postBlock.includes(handler), `Route ${entity} tidak mengarah ke ${handler}.`);
}

assert(
    adminClientSource.includes('fetchOptionalAdminData') &&
        adminClientSource.includes('fetchOptionalAdminCollectionData') &&
        adminClientSource.includes('silentAccessDenied'),
    'Admin client harus punya fetch opsional untuk data pendukung role-limited.'
);

for (const [label, pageSource] of [
    ['Surat Jalan detail', suratJalanDetailPageSource],
    ['Trip/DO detail', tripDetailPageSource],
    ['Customer detail', customerDetailPageSource],
    ['Incident detail', incidentDetailPageSource],
    ['Driver detail', driverDetailPageSource],
    ['Order detail', orderDetailPageSource],
    ['Uang Jalan detail', driverVoucherDetailPageSource],
]) {
    assert(
        pageSource.includes('buildAdminLoadNotice') && pageSource.includes('AdminLoadNotice'),
        `${label} harus memakai pesan akses root yang jelas, bukan hanya "tidak ditemukan".`
    );
}

for (const [label, pageSource, requiredNeedles] of [
    ['Surat Jalan detail', suratJalanDetailPageSource, ['loadOptionalCollection', 'customer-products']],
    ['Trip/DO detail', tripDetailPageSource, ['fetchOptionalAdminData', 'trip-detail-references', 'fetchOptionalAdminCollectionData']],
    ['Customer detail', customerDetailPageSource, ['fetchOptionalAdminCollectionData', 'canManageCustomer', 'services']],
    ['Incident detail', incidentDetailPageSource, ['fetchOptionalAdminCollectionData', 'warehouse-items', 'fetchOptionalAdminData']],
    ['Driver detail', driverDetailPageSource, ['fetchOptionalAdminCollectionData', 'canViewDriverScores', 'buildDriverScoresQuery']],
    ['Order detail', orderDetailPageSource, ['fetchOptionalAdminCollectionData', 'canViewFreightNotas', 'freight-nota-items']],
]) {
    for (const needle of requiredNeedles) {
        assert(pageSource.includes(needle), `${label} belum mengamankan data pendukung ${needle}.`);
    }
}

assert(
    !driverVoucherDetailPageSource.includes('if (loading || !voucher)'),
    'Uang Jalan detail tidak boleh menampilkan skeleton terus saat voucher tidak ditemukan/akses ditolak.'
);

console.log(`Admin data route audit OK: ${deliveryOrderActions.length} delivery-order actions, ${freightNotaUpdateActions.length} freight-nota update actions, ${manualJournalActions.length} manual-journal actions, role entity/proxy/menu guards, role-limited detail UI guards, import/reminder/driver API security guards, Supabase RLS coverage, receivable document-type guard, accounting date/ledger guards, accounting revision history, accounting mutation guards, manual journal control-account guards, and ledger workflow route guards verified.`);

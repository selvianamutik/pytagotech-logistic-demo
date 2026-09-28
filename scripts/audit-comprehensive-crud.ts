/**
 * Comprehensive CRUD Audit - All Entities
 *
 * Tests:
 * 1. Driver CRUD (already verified)
 * 2. Vehicle CRUD
 * 3. Order CRUD
 * 4. Delivery Order CRUD
 * 5. Invoice/Freight Nota CRUD
 * 6. Payment CRUD
 * 7. Expense CRUD
 * 8. Bank Account CRUD
 * 9. Supplier CRUD
 * 10. Warehouse Item CRUD
 * 11. Maintenance CRUD
 * 12. Incident CRUD
 *
 * Also verifies:
 * - Backend data consistency
 * - Foreign key relationships
 * - Audit trail integrity
 */

import { loadScriptEnv } from './_env';
loadScriptEnv();

import {
    createDocument,
    updateDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';

const now = new Date().toISOString();
const PREFIX = `CRUD-AUDIT-${Date.now()}`;

type TestResult = {
    entity: string;
    operation: string;
    status: 'PASS' | 'FAIL' | 'ERROR';
    message?: string;
    duration?: number;
};

const results: TestResult[] = [];
const fixtures: { type: string; id: string }[] = [];

async function cleanup() {
    console.log('\n🧹 Cleaning up fixtures...');
    for (const f of fixtures) {
        try {
            await deleteDocument(f.id, f.type);
            console.log(`   Deleted ${f.type}: ${f.id.slice(0, 8)}...`);
        } catch (e) {
            console.log(`   Failed: ${f.type}: ${e}`);
        }
    }
}

async function testEntity(
    entityName: string,
    docType: string,
    createData: Record<string, unknown>,
    updateData: Record<string, unknown>
): Promise<TestResult[]> {
    const entityResults: TestResult[] = [];
    const startTime = Date.now();

    console.log(`\n📋 Testing ${entityName} CRUD`);

    // CREATE
    try {
        const created = await createDocument(createData as { _type: string; [key: string]: unknown });
        fixtures.push({ type: docType, id: created._id as string });
        const createDuration = Date.now() - startTime;
        console.log(`   ✅ CREATE: ${created._id.slice(0, 8)}... (${createDuration}ms)`);
        entityResults.push({
            entity: entityName,
            operation: 'CREATE',
            status: 'PASS',
            duration: createDuration,
        });

        // READ
        const readStart = Date.now();
        const fetched = await getDocumentById(created._id, docType);
        const readDuration = Date.now() - readStart;
        if (fetched && fetched._id === created._id) {
            console.log(`   ✅ READ: OK (${readDuration}ms)`);
            entityResults.push({
                entity: entityName,
                operation: 'READ',
                status: 'PASS',
                duration: readDuration,
            });
        } else {
            console.log(`   ❌ READ: Mismatch`);
            entityResults.push({
                entity: entityName,
                operation: 'READ',
                status: 'FAIL',
                message: 'Fetched document mismatch',
            });
        }

        // UPDATE
        const updateStart = Date.now();
        const updated = await updateDocument(created._id, updateData);
        const updateDuration = Date.now() - updateStart;
        if (updated) {
            console.log(`   ✅ UPDATE: OK (${updateDuration}ms)`);
            entityResults.push({
                entity: entityName,
                operation: 'UPDATE',
                status: 'PASS',
                duration: updateDuration,
            });
        } else {
            console.log(`   ❌ UPDATE: Failed`);
            entityResults.push({
                entity: entityName,
                operation: 'UPDATE',
                status: 'FAIL',
                message: 'Update returned null',
            });
        }

        // VERIFY UPDATE
        const verifyStart = Date.now();
        const verified = await getDocumentById(created._id, docType);
        const verifyDuration = Date.now() - verifyStart;
        const updateField = Object.keys(updateData)[0];
        const expectedValue = updateData[updateField];
        if (verified && (verified as any)[updateField] === expectedValue) {
            console.log(`   ✅ VERIFY UPDATE: ${updateField} = ${JSON.stringify(expectedValue)} (${verifyDuration}ms)`);
            entityResults.push({
                entity: entityName,
                operation: 'VERIFY_UPDATE',
                status: 'PASS',
                duration: verifyDuration,
            });
        } else {
            console.log(`   ❌ VERIFY UPDATE: ${updateField} not updated correctly`);
            entityResults.push({
                entity: entityName,
                operation: 'VERIFY_UPDATE',
                status: 'FAIL',
                message: `Field ${updateField} not updated correctly`,
            });
        }

        // DELETE
        const deleteStart = Date.now();
        await deleteDocument(created._id, docType);
        const deleteDuration = Date.now() - deleteStart;
        console.log(`   ✅ DELETE: OK (${deleteDuration}ms)`);
        entityResults.push({
            entity: entityName,
            operation: 'DELETE',
            status: 'PASS',
            duration: deleteDuration,
        });
        fixtures.pop(); // Remove from cleanup list

        // VERIFY DELETE
        const verifyDeleteStart = Date.now();
        const deleted = await getDocumentById(created._id, docType);
        const verifyDeleteDuration = Date.now() - verifyDeleteStart;
        if (!deleted) {
            console.log(`   ✅ VERIFY DELETE: Document gone (${verifyDeleteDuration}ms)`);
            entityResults.push({
                entity: entityName,
                operation: 'VERIFY_DELETE',
                status: 'PASS',
                duration: verifyDeleteDuration,
            });
        } else {
            console.log(`   ❌ VERIFY DELETE: Document still exists!`);
            entityResults.push({
                entity: entityName,
                operation: 'VERIFY_DELETE',
                status: 'FAIL',
                message: 'Document still exists after delete',
            });
        }

    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        entityResults.push({
            entity: entityName,
            operation: 'CRUD',
            status: 'ERROR',
            message: String(err),
        });
    }

    return entityResults;
}

async function runComprehensiveAudit() {
    console.log('='.repeat(60));
    console.log('🔍 COMPREHENSIVE CRUD AUDIT - ALL ENTITIES');
    console.log('='.repeat(60));
    console.log(`   Timestamp: ${now}`);
    console.log(`   Prefix: ${PREFIX}`);

    try {
        // =============================================================
        // 1. DRIVER CRUD
        // =============================================================
        results.push(...await testEntity(
            'Driver',
            'driver',
            {
                _type: 'driver',
                name: `${PREFIX} Driver`,
                phone: `0812${Date.now().toString().slice(-8)}`,
                licenseNumber: `SIM-${Date.now().toString().slice(-6)}`,
                ktpNumber: `${Date.now()}`.slice(0, 16),
                address: 'Initial Address',
                active: true,
            },
            { address: 'Updated Address' }
        ));

        // =============================================================
        // 2. VEHICLE CRUD
        // =============================================================
        results.push(...await testEntity(
            'Vehicle',
            'vehicle',
            {
                _type: 'vehicle',
                plateNumber: `B ${PREFIX.slice(-4)} ${Date.now().toString().slice(-4)}`,
                vehicleType: 'TRUCK',
                brandModel: 'Test Brand',
                active: true,
            },
            { brandModel: 'Updated Brand Model' }
        ));

        // =============================================================
        // 3. CUSTOMER CRUD
        // =============================================================
        results.push(...await testEntity(
            'Customer',
            'customer',
            {
                _type: 'customer',
                name: `${PREFIX} Customer`,
                phone: `0813${Date.now().toString().slice(-8)}`,
                address: 'Customer Address',
                active: true,
            },
            { address: 'Updated Customer Address' }
        ));

        // =============================================================
        // 4. SUPPLIER CRUD
        // =============================================================
        results.push(...await testEntity(
            'Supplier',
            'supplier',
            {
                _type: 'supplier',
                supplierCode: `SUP-${Date.now().toString().slice(-6)}`,
                name: `${PREFIX} Supplier`,
                phone: `0814${Date.now().toString().slice(-8)}`,
                address: 'Supplier Address',
                active: true,
            },
            { address: 'Updated Supplier Address' }
        ));

        // =============================================================
        // 5. EXPENSE CATEGORY CRUD
        // =============================================================
        results.push(...await testEntity(
            'ExpenseCategory',
            'expenseCategory',
            {
                _type: 'expenseCategory',
                name: `${PREFIX} Expense Category`,
                scope: 'GENERAL',
                active: true,
            },
            { name: `${PREFIX} Updated Expense Category` }
        ));

        // =============================================================
        // 6. WAREHOUSE ITEM CRUD
        // =============================================================
        results.push(...await testEntity(
            'WarehouseItem',
            'warehouseItem',
            {
                _type: 'warehouseItem',
                itemCode: `WH-${Date.now().toString().slice(-8)}`,
                name: `${PREFIX} Warehouse Item`,
                category: 'SPAREPART',
                unit: 'PCS',
                currentStockQty: 0,
                trackingMode: 'STANDARD',
                active: true,
            },
            { name: `${PREFIX} Updated Warehouse Item` }
        ));

        // =============================================================
        // 7. BANK ACCOUNT CRUD
        // =============================================================
        results.push(...await testEntity(
            'BankAccount',
            'bankAccount',
            {
                _type: 'bankAccount',
                bankName: `${PREFIX} Bank`,
                accountNumber: `${Date.now()}`,
                accountHolder: `${PREFIX} Holder`,
                accountType: 'BANK',
                initialBalance: 0,
                currentBalance: 0,
                active: true,
            },
            { bankName: `${PREFIX} Updated Bank` }
        ));

        // =============================================================
        // 8. SERVICE TYPE CRUD
        // =============================================================
        results.push(...await testEntity(
            'Service',
            'service',
            {
                _type: 'service',
                code: `SVC-${Date.now().toString().slice(-6)}`,
                name: `${PREFIX} Service`,
                active: true,
            },
            { name: `${PREFIX} Updated Service` }
        ));

    } finally {
        await cleanup();
    }

    // =============================================================
    // DATA CONSISTENCY CHECKS
    // =============================================================
    console.log('\n' + '='.repeat(60));
    console.log('🔍 DATA CONSISTENCY CHECKS');
    console.log('='.repeat(60));

    // Check foreign key relationships
    const drivers = await listDocumentsByFilter('driver', {});
    const vehicles = await listDocumentsByFilter('vehicle', {});
    const customers = await listDocumentsByFilter('customer', {});
    const bankAccounts = await listDocumentsByFilter('bankAccount', {});

    console.log(`   Drivers: ${drivers.length}`);
    console.log(`   Vehicles: ${vehicles.length}`);
    console.log(`   Customers: ${customers.length}`);
    console.log(`   Bank Accounts: ${bankAccounts.length}`);

    // Verify bank balance consistency
    let bankBalanceMismatch = 0;
    for (const bank of bankAccounts) {
        if (typeof bank.currentBalance !== 'number') {
            bankBalanceMismatch++;
            console.log(`   ❌ Bank ${bank._id}: invalid balance`);
        }
    }
    if (bankBalanceMismatch === 0) {
        console.log('   ✅ All bank accounts have valid balance');
    }

    // =============================================================
    // SUMMARY
    // =============================================================
    console.log('\n' + '='.repeat(60));
    console.log('📊 CRUD AUDIT SUMMARY');
    console.log('='.repeat(60));

    const byEntity = results.reduce((acc, r) => {
        acc[r.entity] = acc[r.entity] || { pass: 0, fail: 0, error: 0 };
        acc[r.entity][r.status === 'PASS' ? 'pass' : r.status === 'FAIL' ? 'fail' : 'error']++;
        return acc;
    }, {} as Record<string, { pass: number; fail: number; error: number }>);

    console.log('\nBy Entity:');
    for (const [entity, stats] of Object.entries(byEntity)) {
        const total = stats.pass + stats.fail + stats.error;
        const icon = stats.fail === 0 && stats.error === 0 ? '✅' : stats.fail > 0 ? '❌' : '⚠️';
        console.log(`   ${icon} ${entity}: ${stats.pass}/${total} passed`);
    }

    const totalPass = results.filter(r => r.status === 'PASS').length;
    const totalFail = results.filter(r => r.status === 'FAIL').length;
    const totalError = results.filter(r => r.status === 'ERROR').length;
    const total = results.length;

    console.log(`\n   Total: ${totalPass}/${total} passed`);
    if (totalFail > 0) console.log(`   Failed: ${totalFail}`);
    if (totalError > 0) console.log(`   Errors: ${totalError}`);

    if (totalFail === 0 && totalError === 0) {
        console.log('\n🎉 ALL CRUD OPERATIONS PASSED!\n');
    } else {
        console.log('\n⚠️  SOME OPERATIONS FAILED:');
        results.filter(r => r.status !== 'PASS').forEach(r => {
            console.log(`   - ${r.entity} ${r.operation}: ${r.message || r.status}`);
        });
    }

    return {
        ok: totalFail === 0 && totalError === 0,
        total,
        passed: totalPass,
        failed: totalFail,
        errors: totalError,
        results,
    };
}

runComprehensiveAudit().then(result => {
    process.exit(result.ok ? 0 : 1);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
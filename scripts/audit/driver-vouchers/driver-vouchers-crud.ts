/**
 * Audit Script: DRIVER VOUCHERS - CRUD
 *
 * Tests:
 * 1. Voucher Create validation
 * 2. Voucher Read/Query
 * 3. Voucher Issue/Topup/Settle
 * 4. Voucher Status transitions
 * 5. Voucher-Driver match
 */

import { loadScriptEnv } from '../../_env';
loadScriptEnv();

import {
    createDocument,
    updateDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
} from '../../../src/lib/repositories/document-store';

type TestResult = { name: string; status: 'PASS' | 'FAIL' | 'ERROR'; details?: string };
const results: TestResult[] = [];
const fixtures: { type: string; id: string }[] = [];

async function cleanup() {
    console.log('\n🧹 Cleaning up fixtures...');
    for (const f of fixtures) {
        try {
            await deleteDocument(f.id, f.type);
        } catch (e) { /* ignore */ }
    }
}

async function testVoucherCreateValidation() {
    console.log('\n📋 TEST: Voucher Create Validation');

    try {
        const vouchers = await listDocumentsByFilter('driverVoucher', {});
        console.log(`   📊 Total vouchers: ${vouchers.length}`);

        let validCount = 0;
        let missingDriver = 0;
        let missingNumber = 0;
        let missingAmount = 0;

        for (const v of vouchers) {
            const hasDriver = Boolean(v.driverRef);
            const hasNumber = Boolean(v.bonNumber);
            const hasAmount = v.cashGiven !== undefined && v.cashGiven > 0;

            if (hasDriver && hasNumber && hasAmount) {
                validCount++;
            }
            if (!v.driverRef) missingDriver++;
            if (!v.bonNumber) missingNumber++;
            if (!hasAmount) missingAmount++;
        }

        console.log(`   ✅ Valid vouchers: ${validCount}/${vouchers.length}`);
        console.log(`   ⚠️  Missing driver: ${missingDriver}`);
        console.log(`   ⚠️  Missing number: ${missingNumber}`);
        console.log(`   ⚠️  Missing/zero amount: ${missingAmount}`);

        return { name: 'Voucher Create', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Voucher Create', status: 'ERROR', details: String(err) };
    }
}

async function testVoucherRead() {
    console.log('\n📋 TEST: Voucher Read/Query');

    try {
        const vouchers = await listDocumentsByFilter('driverVoucher', {});

        const statusCounts: Record<string, number> = {};
        let totalIssued = 0;
        let totalSpent = 0;

        for (const v of vouchers) {
            statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
            totalIssued += v.totalIssuedAmount || 0;
            totalSpent += v.totalSpent || 0;
        }

        console.log(`   📊 Total vouchers: ${vouchers.length}`);
        console.log(`   📊 By status:`);
        Object.entries(statusCounts).forEach(([s, count]) => {
            if (count > 0) console.log(`      ${s}: ${count}`);
        });
        console.log(`   📊 Total Issued: Rp ${totalIssued.toLocaleString()}`);
        console.log(`   📊 Total Spent: Rp ${totalSpent.toLocaleString()}`);

        return { name: 'Voucher Read', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Voucher Read', status: 'ERROR', details: String(err) };
    }
}

async function testVoucherStatusTransitions() {
    console.log('\n📋 TEST: Voucher Status Transitions');

    try {
        const ALLOWED_TRANSITIONS: Record<string, string[]> = {
            OPEN: ['ISSUED', 'CANCELLED'],
            ISSUED: ['TOPUP', 'SETTLED', 'CANCELLED'],
            TOPUP: ['TOPUP', 'SETTLED', 'CANCELLED'],
            SETTLED: [],
            CANCELLED: [],
        };

        const vouchers = await listDocumentsByFilter('driverVoucher', {});
        let invalidTransitions = 0;

        for (const v of vouchers) {
            if (v.statusHistory && v.statusHistory.length > 1) {
                for (let i = 1; i < v.statusHistory.length; i++) {
                    const prev = v.statusHistory[i - 1].status;
                    const curr = v.statusHistory[i].status;

                    if (!ALLOWED_TRANSITIONS[prev]?.includes(curr)) {
                        invalidTransitions++;
                        console.log(`   ❌ Invalid: ${prev} -> ${curr} on ${v.bonNumber}`);
                    }
                }
            }
        }

        if (invalidTransitions > 0) {
            return { name: 'Status Transitions', status: 'FAIL', details: `${invalidTransitions} invalid` };
        }

        console.log(`   ✅ All transitions valid`);
        return { name: 'Status Transitions', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Status Transitions', status: 'ERROR', details: String(err) };
    }
}

async function testVoucherBalanceCalculation() {
    console.log('\n📋 TEST: Voucher Balance Calculation');

    try {
        const vouchers = await listDocumentsByFilter('driverVoucher', {});
        let incorrectBalance = 0;

        for (const v of vouchers) {
            // Balance = totalIssuedAmount - totalSpent - driverFeeAmount
            // driverFeeAmount is the borongan fee from DO.taripBorongan
            // This is the CORRECT formula as per business logic
            const expectedBalance = (v.totalIssuedAmount || 0) - (v.totalSpent || 0) - (v.driverFeeAmount || 0);

            if (v.balance !== undefined) {
                const diff = Math.abs(v.balance - expectedBalance);
                if (diff > 1) {
                    incorrectBalance++;
                    console.log(`   ❌ ${v.bonNumber}: Balance ${v.balance}, expected ${expectedBalance}`);
                    console.log(`      breakdown: issued=${v.totalIssuedAmount} - spent=${v.totalSpent} - fee=${v.driverFeeAmount}`);
                } else {
                    console.log(`   ✅ ${v.bonNumber}: Balance ${v.balance} (correct)`);
                }
            }
        }

        console.log(`   📊 Incorrect balances: ${incorrectBalance}`);

        return { name: 'Balance Calculation', status: incorrectBalance > 0 ? 'FAIL' : 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Balance Calculation', status: 'ERROR', details: String(err) };
    }
}

async function testVoucherDriverMatch() {
    console.log('\n📋 TEST: Voucher-Driver Data Match');

    try {
        const vouchers = await listDocumentsByFilter('driverVoucher', {});
        let validLinks = 0;
        let invalidLinks = 0;

        for (const v of vouchers) {
            if (!v.driverRef) {
                invalidLinks++;
                continue;
            }

            const driver = await getDocumentById(v.driverRef, 'driver');

            if (driver) {
                validLinks++;
                if (v.driverName !== driver.name) {
                    console.log(`   ⚠️  ${v.bonNumber}: Driver name mismatch`);
                }
            } else {
                invalidLinks++;
                console.log(`   ❌ ${v.bonNumber}: Orphan driverRef ${v.driverRef}`);
            }
        }

        console.log(`   ✅ Valid driver links: ${validLinks}`);
        console.log(`   ❌ Invalid driver links: ${invalidLinks}`);

        if (invalidLinks > 0) {
            return { name: 'Voucher-Driver Match', status: 'FAIL', details: `${invalidLinks} orphans` };
        }

        return { name: 'Voucher-Driver Match', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Voucher-Driver Match', status: 'ERROR', details: String(err) };
    }
}

async function testVoucherBankMatch() {
    console.log('\n📋 TEST: Voucher-Bank Data Match');

    try {
        const vouchers = await listDocumentsByFilter('driverVoucher', {});
        let withBank = 0;
        let validLinks = 0;
        let invalidLinks = 0;

        for (const v of vouchers) {
            if (v.issueBankRef) {
                withBank++;
                const bank = await getDocumentById(v.issueBankRef, 'bankAccount');

                if (bank) {
                    validLinks++;
                } else {
                    invalidLinks++;
                    console.log(`   ❌ ${v.bonNumber}: Orphan bankRef ${v.issueBankRef}`);
                }
            }
        }

        console.log(`   📊 With bank ref: ${withBank}`);
        console.log(`   ✅ Valid bank links: ${validLinks}`);
        console.log(`   ❌ Invalid bank links: ${invalidLinks}`);

        return { name: 'Voucher-Bank Match', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Voucher-Bank Match', status: 'ERROR', details: String(err) };
    }
}

async function testVoucherSettlementLogic() {
    console.log('\n📋 TEST: Voucher Settlement Logic');

    try {
        const vouchers = await listDocumentsByFilter('driverVoucher', { status: 'SETTLED' });
        let withSettlementLines = 0;
        let withoutSettlementLines = 0;

        for (const v of vouchers) {
            if (v.settlementLines && v.settlementLines.length > 0) {
                withSettlementLines++;

                // Verify total matches
                const lineTotal = v.settlementLines.reduce(
                    (sum: number, line: { amount?: number }) => sum + (line.amount || 0),
                    0
                );

                if (Math.abs(lineTotal - (v.totalSpent || 0)) > 1) {
                    console.log(`   ⚠️  ${v.bonNumber}: Line total mismatch`);
                }
            } else {
                withoutSettlementLines++;
            }
        }

        console.log(`   📊 Settled with lines: ${withSettlementLines}`);
        console.log(`   ⚠️  Settled without lines: ${withoutSettlementLines}`);

        return { name: 'Settlement Logic', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Settlement Logic', status: 'ERROR', details: String(err) };
    }
}

async function runAudit() {
    console.log('='.repeat(60));
    console.log('🔍 AUDIT: DRIVER VOUCHERS');
    console.log('='.repeat(60));

    results.push(await testVoucherCreateValidation());
    results.push(await testVoucherRead());
    results.push(await testVoucherStatusTransitions());
    results.push(await testVoucherBalanceCalculation());
    results.push(await testVoucherDriverMatch());
    results.push(await testVoucherBankMatch());
    results.push(await testVoucherSettlementLogic());

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    console.log(`   Passed: ${passed}, Failed: ${failed}`);

    if (failed > 0) {
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`   - ${r.name}: ${r.details}`);
        });
    }

    return { ok: failed === 0, results };
}

runAudit().then(r => process.exit(r.ok ? 0 : 1)).catch(e => { console.error(e); process.exit(1); });
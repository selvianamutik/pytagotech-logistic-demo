/**
 * Debug Driver Voucher Balance Mismatch
 */

import { loadScriptEnv } from './_env';
loadScriptEnv();

import {
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type {
    DriverVoucher,
    DriverVoucherDisbursement,
    DriverVoucherItem
} from '../src/lib/types';

async function main() {
    console.log('=== DRIVER VOUCHER BALANCE INVESTIGATION ===\n');

    // Get all vouchers
    const vouchers = await listDocumentsByFilter<DriverVoucher>('driverVoucher', {});
    console.log('Total vouchers:', vouchers.length);

    for (const v of vouchers) {
        console.log('\n' + '='.repeat(50));
        console.log('Voucher:', v.bonNumber, '| Status:', v.status);
        console.log('='.repeat(50));

        console.log('\n[Stored Fields]');
        console.log('  initialCashGiven:', v.initialCashGiven);
        console.log('  cashGiven:', v.cashGiven);
        console.log('  totalIssuedAmount:', v.totalIssuedAmount);
        console.log('  totalSpent:', v.totalSpent);
        console.log('  balance:', v.balance);
        console.log('  issuedDate:', v.issuedDate);
        console.log('  settledDate:', v.settledDate);

        // Get disbursements
        const disbursements = await listDocumentsByFilter<DriverVoucherDisbursement>('driverVoucherDisbursement', {
            voucherRef: v._id
        });
        console.log('\n[Disbursements]', disbursements.length, 'found');

        // Group by status
        const byStatus: Record<string, number> = {};
        for (const d of disbursements) {
            const status = d.status || 'undefined';
            byStatus[status] = (byStatus[status] || 0) + (d.amount || 0);
            console.log(`  ${d.kind || 'unknown'}: ${d.amount} (${status})`);
        }
        console.log('  By status:', byStatus);

        // Get items (expenses)
        const items = await listDocumentsByFilter<DriverVoucherItem>('driverVoucherItem', {
            voucherRef: v._id
        });
        console.log('\n[Items/Expenses]', items.length, 'found');
        let totalItemAmount = 0;
        for (const i of items) {
            console.log(`  ${i.description || 'no desc'}: ${i.amount}`);
            totalItemAmount += (i.amount || 0);
        }
        console.log('  Total items:', totalItemAmount);

        // Get settlement lines if settled
        if (v.status === 'SETTLED') {
            const settlementLines = await listDocumentsByFilter('driverVoucherSettlementLine', {
                voucherRef: v._id
            });
            console.log('\n[Settlement Lines]', settlementLines.length, 'found');
            for (const line of settlementLines) {
                console.log(`  ${line.description || 'no desc'}: ${line.amount}`);
            }
        }

        // Calculate expected values
        console.log('\n[CALCULATION]');
        // NOTE: Correct formula is balance = totalIssuedAmount - totalSpent - driverFeeAmount
        // driverFeeAmount = taripBorongan from Delivery Order (borongan fee owed to driver)
        // Balance negatif = driver kelebihan bayar borongan, harus kembalikan selisih (VALID)

        // How is totalIssuedAmount calculated?
        const issued1 = v.totalIssuedAmount;
        const issued2 = v.cashGiven;
        const issued3 = v.initialCashGiven;
        const issuedSource = issued1 !== undefined && issued1 !== null ? 'totalIssuedAmount'
            : issued2 !== undefined && issued2 !== null ? 'cashGiven'
            : issued3 !== undefined && issued3 !== null ? 'initialCashGiven'
            : 'NONE';

        console.log('  Issued source field:', issuedSource);
        const issued = issued1 ?? issued2 ?? issued3 ?? 0;
        console.log('  Issued value:', issued);

        const fee = (v as unknown as { driverFeeAmount?: number }).driverFeeAmount || 0;
        console.log('  driverFeeAmount (taripBorongan):', fee);

        // CORRECT formula: balance = totalIssuedAmount - totalSpent - driverFeeAmount
        const expectedBalance = issued - (v.totalSpent || 0) - fee;
        console.log('  Expected balance (issued - totalSpent - driverFeeAmount):', issued, '-', v.totalSpent || 0, '-', fee, '=', expectedBalance);

        // Legacy formula (INCORRECT — does not account for borongan fee):
        const legacyBalance = issued - (v.totalSpent || 0);
        console.log('  Legacy formula (issued - totalSpent ONLY, INCORRECT):', legacyBalance);

        // What should balance be?
        console.log('\n[RESULT]');
        console.log('  Stored balance:', v.balance);
        console.log('  Expected (correct formula):', expectedBalance);

        const match = Math.abs((v.balance || 0) - expectedBalance) <= 1;
        console.log('  Match:', match ? '✅ YES' : '❌ NO');

        if (!match) {
            console.log('\n  ⚠️  BALANCE MISMATCH DETECTED!');
            console.log('  Stored balance does not match correct formula.');
            console.log('  Diff:', (v.balance || 0) - expectedBalance);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.error('Error:', e);
        process.exit(1);
    });

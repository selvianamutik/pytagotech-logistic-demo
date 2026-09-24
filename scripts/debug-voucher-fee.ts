/**
 * Debug driverFeeAmount impact on balance
 */

import { loadScriptEnv } from './_env';
loadScriptEnv();

import { listDocumentsByFilter } from '../src/lib/repositories/document-store';
import type { DriverVoucher } from '../src/lib/types';

async function main() {
    console.log('=== CHECKING DRIVER FEE AMOUNT ===\n');

    const vouchers = await listDocumentsByFilter<DriverVoucher>('driverVoucher', {});

    for (const v of vouchers) {
        console.log('=== ' + v.bonNumber + ' ===');
        console.log('totalIssuedAmount:', v.totalIssuedAmount);
        console.log('totalSpent:', v.totalSpent);
        console.log('driverFeeAmount:', v.driverFeeAmount);
        console.log('balance (stored):', v.balance);

        // Calculate with driver fee
        const issued = v.totalIssuedAmount || 0;
        const spent = v.totalSpent || 0;
        const fee = v.driverFeeAmount || 0;
        const totalClaim = spent + fee;
        const expectedBalance = issued - totalClaim;

        console.log('\n[CALCULATION]');
        console.log('issued - (spent + fee) = ' + issued + ' - (' + spent + ' + ' + fee + ') = ' + expectedBalance);
        console.log('stored balance:', v.balance);
        console.log('MATCH:', expectedBalance === v.balance ? 'YES ✅' : 'NO ❌');

        if (expectedBalance !== v.balance) {
            console.log('\n⚠️  MISMATCH! Difference:', v.balance - expectedBalance);
        }
        console.log('');
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => {
        console.error('Error:', e);
        process.exit(1);
    });
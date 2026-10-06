import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    applyCustomerProductToOrderItem,
    applyOrderItemAutoWeightFromQty,
    shouldLockOrderItemVolume,
    shouldLockOrderItemWeight,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
    type OrderItemForm,
} from '../src/lib/order-create-page-support';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
} from '../src/lib/measurement';
import type { CustomerProduct } from '../src/lib/types';

const baseItem: OrderItemForm = {
    customerProductRef: '',
    description: '',
    qtyKoli: 0,
    weightInputValue: 0,
    weightInputUnit: 'KG',
    volumeInputValue: 0,
    volumeInputUnit: 'M3',
    pickupStopKey: 'pickup-1',
    shipperReferenceNumber: 'SJ-TEST',
    value: 0,
};

const asbesProduct: CustomerProduct = {
    _id: 'product-asbes',
    _type: 'customerProduct',
    customerRef: 'customer-1',
    code: 'ASBES12',
    name: 'ASBES',
    defaultQtyKoli: 1,
    defaultWeight: 0.4,
    defaultWeightInputValue: 0.4,
    defaultWeightInputUnit: 'KG',
    active: true,
};

const keramikProduct: CustomerProduct = {
    _id: 'product-keramik',
    _type: 'customerProduct',
    customerRef: 'customer-1',
    code: 'KRM',
    name: 'Keramik',
    defaultQtyKoli: 1,
    defaultWeight: 12,
    defaultWeightInputValue: 12,
    defaultWeightInputUnit: 'KG',
    active: true,
};

const asbesItem = applyCustomerProductToOrderItem(baseItem, asbesProduct);
assert.equal(asbesItem.qtyKoli, 1);
assert.equal(asbesItem.weightInputValue, 0.4);
assert.equal(asbesItem.autoWeightBasisQtyKoli, 1);
assert.equal(asbesItem.autoWeightBasisWeightKg, 0.4);

const twoKoliAsbes = applyOrderItemAutoWeightFromQty(asbesItem, 2);
assert.equal(twoKoliAsbes.qtyKoli, 2);
assert.equal(twoKoliAsbes.weightInputValue, 0.8);

const twoKoliKeramik = applyCustomerProductToOrderItem(twoKoliAsbes, keramikProduct);
assert.equal(twoKoliKeramik.qtyKoli, 2);
assert.equal(twoKoliKeramik.weightInputValue, 24);
assert.equal(twoKoliKeramik.autoWeightBasisQtyKoli, 2);
assert.equal(twoKoliKeramik.autoWeightBasisWeightKg, 24);

const threeKoliKeramik = applyOrderItemAutoWeightFromQty(twoKoliKeramik, 3);
assert.equal(threeKoliKeramik.weightInputValue, 36);

const keramikInTon = updateOrderItemWeightUnit(twoKoliKeramik, 'TON');
assert.equal(keramikInTon.weightInputValue, 0.024);

const legacyProductWithoutInputUnit = {
    ...keramikProduct,
    defaultWeightInputUnit: undefined,
};
const legacyProductAppliedToTonRow = applyCustomerProductToOrderItem(
    { ...baseItem, qtyKoli: 2, weightInputUnit: 'TON' },
    legacyProductWithoutInputUnit
);
assert.equal(legacyProductAppliedToTonRow.weightInputUnit, 'TON');
assert.equal(legacyProductAppliedToTonRow.weightInputValue, 0.024);

// Standard conversion factors: 1 ton = 1000 kg, 1000 liter = 1 m3, 1 KL = 1 m3.
assert.equal(convertWeightToKg(1, 'TON'), 1000);
assert.equal(convertWeightToKg(2.5, 'KG'), 2.5);
assert.equal(convertKgToWeightInputValue(1000, 'TON'), 1);
assert.equal(convertKgToWeightInputValue(1500, 'KG'), 1500);
assert.equal(convertVolumeToM3(1000, 'LITER'), 1);
assert.equal(convertVolumeToM3(2.5, 'M3'), 2.5);
assert.equal(convertVolumeToM3(1, 'KL'), 1);
assert.equal(convertM3ToVolumeInputValue(1, 'LITER'), 1000);
assert.equal(convertM3ToVolumeInputValue(1, 'KL'), 1);
assert.equal(convertM3ToVolumeInputValue(2.5, 'M3'), 2.5);

// Switching the volume unit must preserve the physical amount across m3/liter/KL.
const twoM3 = { ...baseItem, volumeInputValue: 2, volumeInputUnit: 'M3' as const };
const twoM3InLiter = updateOrderItemVolumeUnit(twoM3, 'LITER');
assert.equal(twoM3InLiter.volumeInputValue, 2000);
assert.equal(updateOrderItemVolumeUnit(twoM3InLiter, 'KL').volumeInputValue, 2);
assert.equal(updateOrderItemVolumeUnit(twoM3InLiter, 'M3').volumeInputValue, 2);

// Switching the weight unit must preserve kilograms across kg/ton.
assert.equal(updateOrderItemWeightUnit(twoKoliKeramik, 'KG').weightInputValue, 24);
assert.equal(updateOrderItemWeightUnit(keramikInTon, 'KG').weightInputValue, 24);

// Master data items lock derived weight and volume; manual items stay editable.
const masterWithCargo: OrderItemForm = {
    ...baseItem,
    customerProductRef: 'product-keramik',
    qtyKoli: 2,
    weightInputValue: 24,
    volumeInputValue: 1.5,
};
assert.equal(shouldLockOrderItemWeight(masterWithCargo), true);
assert.equal(shouldLockOrderItemVolume(masterWithCargo), true);

const manualWithCargo: OrderItemForm = {
    ...baseItem,
    customerProductRef: '',
    manualEntry: true,
    description: 'Barang manual',
    qtyKoli: 2,
    weightInputValue: 24,
    volumeInputValue: 1.5,
};
assert.equal(shouldLockOrderItemWeight(manualWithCargo), false);
assert.equal(shouldLockOrderItemVolume(manualWithCargo), false);

// A master data item with no derived value yet must stay fillable.
assert.equal(shouldLockOrderItemWeight({ ...baseItem, customerProductRef: 'product-keramik', qtyKoli: 2, weightInputValue: 0 }), false);
assert.equal(shouldLockOrderItemVolume({ ...baseItem, customerProductRef: 'product-keramik', qtyKoli: 2, volumeInputValue: 0 }), false);

// Guard the UI wiring: weight inputs must not be gated by the volume predicate
// (and vice versa), and unit selects must never be data-locked so users can
// always convert between kg/ton and m3/liter/KL.
const cargoUiFiles = [
    'src/app/(admin)/orders/[id]/page.tsx',
    'src/app/(admin)/_components/TripDetailPage.tsx',
    'src/app/(admin)/orders/[id]/edit/page.tsx',
];

for (const relativePath of cargoUiFiles) {
    const source = readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    const lines = source.split(/\r?\n/);
    const label = path.basename(relativePath);

    lines.forEach((line, index) => {
        const disabledWithin = (span: number) => {
            const end = Math.min(index + span, lines.length);
            for (let cursor = index + 1; cursor < end; cursor += 1) {
                const match = lines[cursor].match(/^\s*(?:disabled|readOnly)\s*=\{/);
                if (match) return lines[cursor];
            }
            return '';
        };

        if (/value=\{\w+\.weightInputValue\}/.test(line)) {
            const disabled = disabledWithin(8);
            assert.ok(
                !disabled.includes('shouldLockOrderItemVolume'),
                `${label}:${index + 1} weight input must not be locked by the volume predicate`
            );
        }

        if (/value=\{\w+\.volumeInputValue\}/.test(line)) {
            const disabled = disabledWithin(8);
            assert.ok(
                !disabled.includes('shouldLockOrderItemWeight'),
                `${label}:${index + 1} volume input must not be locked by the weight predicate`
            );
        }

        if (/options=\{.*(?:WEIGHT|VOLUME)_INPUT_UNIT_OPTIONS/.test(line)) {
            const disabled = disabledWithin(12);
            assert.ok(
                !disabled.includes('shouldLock'),
                `${label}:${index + 1} unit select must stay unlocked so units remain convertible`
            );
        }
    });
}

console.log('Order item auto weight audit OK');

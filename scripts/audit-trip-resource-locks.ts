import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    buildTripResourceAssignments,
    isDeliveryOrderResourceLocked,
    tripDriverAssignments,
    tripVehicleAssignments,
} from '../src/lib/trip-resource-lock-support';
import type { DeliveryOrder, Order } from '../src/lib/types';

// One driver/vehicle may be assigned to several DOs at once, so an open trip no
// longer blocks the resource. These assertions guard the new contract:
//  1. assignment badges list every open DO/trip using the resource
//  2. nothing is treated as a hard lock
//  3. server routes no longer reject an already-assigned resource

const activeStatuses: DeliveryOrder['status'][] = [
    'CREATED',
    'ON_DELIVERY',
    'ARRIVED',
    'PARTIAL_HOLD',
    'DELIVERED',
];

for (const status of activeStatuses) {
    assert.equal(
        isDeliveryOrderResourceLocked({
            _id: `do-${status.toLowerCase()}`,
            status,
            vehicleRef: 'veh-active',
            driverRef: 'drv-active',
        }),
        true,
        `${status} must stay visible in the driver portal as an active trip`
    );
}

assert.equal(
    isDeliveryOrderResourceLocked({
        _id: 'do-closed',
        status: 'DELIVERED',
        vehicleRef: 'veh-free',
        driverRef: 'drv-free',
        tripClosedByAdminAt: '2026-05-10T00:00:00.000Z',
    }),
    false,
    'closed trips must not stay active in the driver portal'
);

const activeOrder: Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'> = {
    _id: 'order-active',
    masterResi: 'R-ACTIVE',
    status: 'OPEN',
    tripPlans: [
        {
            _key: 'plan-unlinked',
            sequence: 1,
            date: '2026-05-10',
            issueBankRef: 'bank-001',
            cashGiven: 100000,
            vehicleRef: 'veh-plan',
            driverRef: 'drv-plan',
        },
        {
            _key: 'plan-linked',
            sequence: 2,
            date: '2026-05-10',
            issueBankRef: 'bank-001',
            cashGiven: 100000,
            vehicleRef: 'veh-linked',
            driverRef: 'drv-linked',
            linkedDeliveryOrderRef: 'do-linked',
        },
    ],
};

// Two open DOs deliberately share the same vehicle and driver.
const index = buildTripResourceAssignments({
    deliveryOrders: [
        {
            _id: 'do-a',
            doNumber: 'DO-202605-0001',
            status: 'ON_DELIVERY',
            vehicleRef: 'veh-shared',
            driverRef: 'drv-shared',
        },
        {
            _id: 'do-b',
            doNumber: 'DO-202605-0002',
            status: 'CREATED',
            vehicleRef: 'veh-shared',
            driverRef: 'drv-shared',
        },
        {
            _id: 'do-closed',
            doNumber: 'DO-202605-0003',
            status: 'DELIVERED',
            vehicleRef: 'veh-closed',
            driverRef: 'drv-closed',
            tripClosedByAdminAt: '2026-05-11T00:00:00.000Z',
        },
        {
            _id: 'do-cancelled',
            doNumber: 'DO-202605-0004',
            status: 'CANCELLED',
            vehicleRef: 'veh-cancelled',
            driverRef: 'drv-cancelled',
        },
    ],
    orders: [activeOrder],
});

const sharedVehicle = tripVehicleAssignments('veh-shared', index);
const sharedDriver = tripDriverAssignments('drv-shared', index);
assert.equal(sharedVehicle.length, 2, 'both open DOs must be listed for a shared vehicle');
assert.equal(sharedDriver.length, 2, 'both open DOs must be listed for a shared driver');
assert.deepEqual(
    sharedVehicle.map(item => item.label).sort(),
    ['DO-202605-0001', 'DO-202605-0002'],
    'assignment labels must identify each open DO'
);
assert.deepEqual(
    sharedVehicle.map(item => item.status).sort(),
    ['CREATED', 'ON_DELIVERY'],
    'assignment status must be preserved for the badge'
);

assert.equal(tripVehicleAssignments('veh-closed', index).length, 0, 'closed DO must not be listed');
assert.equal(tripVehicleAssignments('veh-cancelled', index).length, 0, 'cancelled DO must not be listed');
assert.equal(tripVehicleAssignments('veh-plan', index).length, 1, 'unlinked active order plan must be listed');
assert.equal(tripVehicleAssignments('veh-linked', index).length, 0, 'plan already linked to a DO must not double-count');
assert.equal(tripVehicleAssignments('veh-unknown', index).length, 0);
assert.equal(tripVehicleAssignments(undefined, index).length, 0);
assert.equal(tripDriverAssignments('drv-unknown', undefined).length, 0, 'missing index must not throw');

// No hard lock remains anywhere in the write paths.
const orderWorkflows = readFileSync(new URL('../src/lib/api/order-workflows.ts', import.meta.url), 'utf8');
assert.doesNotMatch(
    orderWorkflows,
    /assertTripResourcesAssignable/,
    'order workflows must not assert trip resource exclusivity'
);
assert.doesNotMatch(
    orderWorkflows,
    /masih dipakai di surat jalan aktif/,
    'order workflows must not reject a vehicle already used by an active DO'
);
assert.doesNotMatch(
    orderWorkflows,
    /masih terikat di surat jalan aktif/,
    'order workflows must not reject a driver already used by an active DO'
);

// The driver portal still relies on the active-trip predicate.
const driverPortal = readFileSync(new URL('../src/lib/api/driver-portal.ts', import.meta.url), 'utf8');
assert.match(
    driverPortal,
    /isDeliveryOrderResourceLocked/,
    'driver portal must keep filtering its active trips'
);

// The badge helper must stay wired into every driver/vehicle picker.
for (const page of [
    'src/app/(admin)/orders/new/page.tsx',
    'src/app/(admin)/orders/[id]/page.tsx',
    'src/app/(admin)/_components/TripDetailPage.tsx',
]) {
    const source = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(source, /TripAssignmentDropdownMeta/, `${page} must render assignment badges in the dropdown`);
    assert.match(source, /TripResourceAssignmentBadges/, `${page} must render assignment badges under the field`);
}

console.log('Trip resource assignment audit passed (multi-DO drivers/vehicles allowed).');

import { hash } from 'bcryptjs';

import { loadScriptEnv } from './_env';

loadScriptEnv();

import {
    getDriverAssignedDeliveryOrders,
    getDriverAssignedVouchers,
} from '../src/lib/api/driver-portal';
import {
    createDocument,
    deleteDocument,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';

/**
 * Seed data untuk aplikasi driver (Flutter).
 *
 * Membuat 1 supir + 1 akun login, 5 trip dengan status berbeda,
 * 2 SJ per trip, dan 1 bon (uang jalan) per trip.
 *
 * Semua id memakai prefix `seed-drv`. Setiap run AWAL-nya menghapus data
 * seed lama (user + master data + trip + bon) lalu membuat ulang dari nol,
 * sehingga hasil run selalu sama persis dan tidak ada data lama yang
 * tertinggal (mis. password atau schema yang sudah berubah).
 *
 * Jalankan:
 *   npm run seed:driver-app              # hapus data seed lama, lalu buat ulang
 *   npm run seed:driver-app -- --no-reset  # upsert tanpa hapus
 *
 * CATATAN VISIBILITAS
 * Driver app hanya menampilkan DO yang lolos `isDeliveryOrderResourceLocked`
 * (src/lib/trip-resource-lock-support.ts):
 *   - status harus salah satu dari CREATED / ON_DELIVERY / ARRIVED /
 *     PARTIAL_HOLD / DELIVERED
 *   - TIDAK boleh berstatus CANCELLED
 *   - TIDAK boleh punya `tripClosedByAdminAt` (trip ditutup admin)
 * Karena itu seed ini sengaja tidak membuat trip CANCELLED maupun
 * trip yang ditutup admin: keduanya tidak akan terlihat oleh driver.
 */

const SEED_PREFIX = 'seed-drv';
const DRIVER_EMAIL = 'driver@seed.test';
// Hanya untuk data demo lokal. Server mewajibkan minimal 8 karakter
// (src/app/api/auth/login tidak membatasi pola lain).
const DRIVER_PASSWORD = 'driver123';
const DRIVER_NAME = 'Budi Santoso';
const DRIVER_PHONE = '0812-1000-9001';

const DRIVER_REF = `${SEED_PREFIX}-driver`;
const USER_REF = `${SEED_PREFIX}-user`;
const CUSTOMER_REF = `${SEED_PREFIX}-customer`;
const VEHICLE_REF = `${SEED_PREFIX}-vehicle`;
const SERVICE_REF = `${SEED_PREFIX}-service`;
const CUSTOMER_NAME = 'PT Sinar Transport Nusantara';

/**
 * Master barang PT Sinar Transport Nusantara.
 *
 * Dipakai driver saat input SJ/barang (Kelola SJ & Barang), jadi supir tidak
 * perlu mengetik nama barang dari nol. `defaultWeight` disimpan dalam KG dan
 * `defaultVolume` dalam M3 (hasil normalisasi), sedangkan pasangan
 * `*InputValue` + `*InputUnit` menyimpan satuan yang dilihat supir.
 */
const CUSTOMER_PRODUCTS: Array<{
    code: string;
    name: string;
    description: string;
    defaultQtyKoli: number;
    defaultWeightInputValue: number;
    defaultWeightInputUnit: 'KG' | 'TON';
    defaultVolumeInputValue: number;
    defaultVolumeInputUnit: 'M3' | 'LITER' | 'KL';
}> = [
    {
        code: 'STN-BRG-001',
        name: 'Semen Portland 40 kg',
        description: 'Semen Portland Composite 40 kg per sak',
        defaultQtyKoli: 20,
        defaultWeightInputValue: 800,
        defaultWeightInputUnit: 'KG',
        defaultVolumeInputValue: 0.96,
        defaultVolumeInputUnit: 'M3',
    },
    {
        code: 'STN-BRG-002',
        name: 'Pasir Silika',
        description: 'Pasir silika kering untuk beton presisi',
        defaultQtyKoli: 8,
        defaultWeightInputValue: 12,
        defaultWeightInputUnit: 'TON',
        defaultVolumeInputValue: 6.4,
        defaultVolumeInputUnit: 'M3',
    },
    {
        code: 'STN-BRG-003',
        name: 'Besi Beton Ulir 10 mm',
        description: 'Barangan besi beton ulir diameter 10 mm, panjang 12 m',
        defaultQtyKoli: 12,
        defaultWeightInputValue: 2.4,
        defaultWeightInputUnit: 'TON',
        defaultVolumeInputValue: 3.6,
        defaultVolumeInputUnit: 'M3',
    },
    {
        code: 'STN-BRG-004',
        name: 'Cat Tembok 25 kg',
        description: 'Cat tembok interior/eksterior 25 kg per pail',
        defaultQtyKoli: 10,
        defaultWeightInputValue: 250,
        defaultWeightInputUnit: 'KG',
        defaultVolumeInputValue: 0.35,
        defaultVolumeInputUnit: 'M3',
    },
    {
        code: 'STN-BRG-005',
        name: 'Keramik 60x60 cm',
        description: 'Keramik lantai 60x60 cm, dus 1,44 m2',
        defaultQtyKoli: 6,
        defaultWeightInputValue: 900,
        defaultWeightInputUnit: 'KG',
        defaultVolumeInputValue: 2.1,
        defaultVolumeInputUnit: 'M3',
    },
    {
        code: 'STN-BRG-006',
        name: 'Pipa PVC 4 Inch',
        description: 'Pipa PVC AW 4 inch, panjang 4 m per batang',
        defaultQtyKoli: 5,
        defaultWeightInputValue: 450,
        defaultWeightInputUnit: 'KG',
        defaultVolumeInputValue: 2.8,
        defaultVolumeInputUnit: 'M3',
    },
    {
        code: 'STN-BRG-007',
        name: 'Kayu Papan 3 Meter',
        description: 'Papan kayu ukuran 3 meter untuk pallet',
        defaultQtyKoli: 7,
        defaultWeightInputValue: 1.05,
        defaultWeightInputUnit: 'TON',
        defaultVolumeInputValue: 4.2,
        defaultVolumeInputUnit: 'M3',
    },
];

/** Dibereskan lebih dulu saat --reset (child -> parent). */
const SEED_DOC_TYPES = [
    'driverVoucherItem',
    'driverVoucherDisbursement',
    'driverVoucher',
    'suratJalan',
    'trip',
    'deliveryOrder',
    'order',
    'vehicle',
    'service',
    'customerProduct',
    'customer',
    'user',
    'driver',
] as const;

type TripSeed = {
    sequence: number;
    /** Status DO. Harus salah satu dari LOCKING_DELIVERY_ORDER_STATUSES. */
    doStatus: 'CREATED' | 'ON_DELIVERY' | 'ARRIVED' | 'PARTIAL_HOLD' | 'DELIVERED';
    /** Status tiap SJ. Panjang harus 2. */
    sjStatuses: ['CREATED' | 'ON_DELIVERY' | 'ARRIVED' | 'PARTIAL_HOLD' | 'DELIVERED',
        'CREATED' | 'ON_DELIVERY' | 'ARRIVED' | 'PARTIAL_HOLD' | 'DELIVERED'];
    bonStatus: 'DRAFT' | 'ISSUED' | 'SETTLED';
    origin: string;
    destination: string;
    receiver: string;
    /** Uang awal bon (INITIAL disbursement). */
    cashGiven: number;
    /** Tambahan pencairan (TOP_UP disbursements). */
    topUps?: number[];
    /** Baris pengeluaran pada bon. */
    expenses?: { category: string; description: string; amount: number }[];
    /** Upah borongan / fee driver. */
    driverFee: number;
    /** Di-set bila status DO-nya belum selesai. */
    trackingState?: 'ACTIVE' | 'PAUSED';
    /** Dipakai untuk status PARTIAL_HOLD agar hold terisi di manifest. */
    holdOnFirstSj?: boolean;
};

const TRIP_SEEDS: TripSeed[] = [
    {
        sequence: 1,
        doStatus: 'CREATED',
        sjStatuses: ['CREATED', 'CREATED'],
        bonStatus: 'DRAFT',
        origin: 'Gudang Cikarang Barat',
        destination: 'Bekasi Selatan',
        receiver: 'PT Sinar Logistik',
        cashGiven: 0,
        driverFee: 850000,
    },
    {
        sequence: 2,
        doStatus: 'ON_DELIVERY',
        sjStatuses: ['ON_DELIVERY', 'ON_DELIVERY'],
        bonStatus: 'ISSUED',
        origin: 'Gudang Cikarang Barat',
        destination: 'Bandung / Gedebage',
        receiver: 'CV Mitra Distribusi Bandung',
        cashGiven: 750000,
        topUps: [250000],
        expenses: [
            { category: 'Makan', description: 'Konsumsi sopir di jalan', amount: 45000 },
            { category: 'Toll', description: 'Tol tol sementara', amount: 120000 },
        ],
        driverFee: 1250000,
        trackingState: 'ACTIVE',
    },
    {
        sequence: 3,
        doStatus: 'ARRIVED',
        sjStatuses: ['ARRIVED', 'ARRIVED'],
        bonStatus: 'ISSUED',
        origin: 'Gudang Tambun',
        destination: 'Semarang / Pandan Arung',
        receiver: 'PT Karya Niaga Semarang',
        cashGiven: 600000,
        expenses: [
            { category: 'Parkir', description: 'Parkir bongkar muat', amount: 35000 },
            { category: 'Makan', description: 'Konsumsi crew', amount: 60000 },
            { category: 'Lain-lain', description: 'ATK sementara', amount: 25000 },
        ],
        driverFee: 980000,
        trackingState: 'PAUSED',
    },
    {
        sequence: 4,
        doStatus: 'PARTIAL_HOLD',
        sjStatuses: ['PARTIAL_HOLD', 'CREATED'],
        bonStatus: 'ISSUED',
        origin: 'Gudang Cikarang Timur',
        destination: 'Surabaya / Rungkut',
        receiver: 'PT Sinar Mas Surabaya',
        cashGiven: 900000,
        expenses: [
            { category: 'Toll', description: 'Tol Surabaya', amount: 185000 },
            { category: 'Makan', description: 'Konsumsi tim muat', amount: 40000 },
        ],
        driverFee: 1650000,
        trackingState: 'ACTIVE',
        holdOnFirstSj: true,
    },
    {
        sequence: 5,
        doStatus: 'DELIVERED',
        sjStatuses: ['DELIVERED', 'DELIVERED'],
        bonStatus: 'SETTLED',
        origin: 'Gudang Jababeka',
        destination: 'Jakarta / Kelapa Gading',
        receiver: 'PT Nusantara Distribusi',
        cashGiven: 500000,
        topUps: [150000],
        expenses: [
            { category: 'BBM', description: 'Isi solar Pertalite', amount: 275000 },
            { category: 'Parkir', description: 'Parkir gudang tujuan', amount: 30000 },
            { category: 'Makan', description: 'Konsumsi sopir', amount: 35000 },
        ],
        driverFee: 780000,
    },
];

function businessDate(daysAgo: number) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString().slice(0, 10);
}

function log(message: string) {
    console.log(`[seed:driver-app] ${message}`);
}

async function seedDriverAndMasterData() {
    await createDocument({
        _id: DRIVER_REF,
        _type: 'driver',
        name: DRIVER_NAME,
        phone: DRIVER_PHONE,
        licenseNumber: 'B1234567890',
        address: 'Jl. Kaliabang Tengah No. 21, Bekasi',
        active: true,
    });

    await createDocument({
        _id: USER_REF,
        _type: 'user',
        name: DRIVER_NAME,
        email: DRIVER_EMAIL,
        role: 'DRIVER',
        driverRef: DRIVER_REF,
        driverName: DRIVER_NAME,
        // bcrypt cost 10, sama dengan hashPassword() di src/lib/auth.ts.
        passwordHash: await hash(DRIVER_PASSWORD, 10),
        active: true,
    });

    await createDocument({
        _id: CUSTOMER_REF,
        _type: 'customer',
        name: CUSTOMER_NAME,
        contactPerson: 'Bapak Sutrisno',
        phone: '021-5550001',
        address: 'Kawasan Industri Jababeka, Cikarang',
        defaultPaymentTerm: 30,
        active: true,
    });

    await createDocument({
        _id: SERVICE_REF,
        _type: 'service',
        code: 'REGULER',
        name: 'Reguler',
        description: 'Layanan reguler seed driver app',
        active: true,
    });

    await createDocument({
        _id: VEHICLE_REF,
        _type: 'vehicle',
        unitCode: 'UNIT-SEED-01',
        plateNumber: 'B 9123 KJA',
        vehicleType: 'TRUCK',
        brandModel: 'Hino 500 Series',
        year: 2021,
        capacityKg: 9000,
        serviceRef: SERVICE_REF,
        status: 'READY',
        lastOdometer: 128450,
        lastOdometerAt: businessDate(1),
    });

    await seedCustomerProducts();

    log(`supir + akun + customer + master barang + kendaraan + service siap (${DRIVER_EMAIL})`);
}

/** Master barang untuk customer seed, dipakai driver saat input SJ/barang. */
async function seedCustomerProducts() {
    for (const [index, product] of CUSTOMER_PRODUCTS.entries()) {
        await createDocument({
            _id: `${SEED_PREFIX}-product-${String(index + 1).padStart(3, '0')}`,
            _type: 'customerProduct',
            customerRef: CUSTOMER_REF,
            customerName: CUSTOMER_NAME,
            code: product.code,
            name: product.name,
            description: product.description,
            defaultQtyKoli: product.defaultQtyKoli,
            // Normalisasi (KG / M3), sama seperti yang ditulis workflow server.
            defaultWeight: product.defaultWeightInputUnit === 'TON'
                ? product.defaultWeightInputValue * 1000
                : product.defaultWeightInputValue,
            defaultVolume: product.defaultVolumeInputUnit === 'LITER'
                ? product.defaultVolumeInputValue / 1000
                : product.defaultVolumeInputUnit === 'KL'
                    ? product.defaultVolumeInputValue * 1000
                    : product.defaultVolumeInputValue,
            defaultWeightInputValue: product.defaultWeightInputValue,
            defaultWeightInputUnit: product.defaultWeightInputUnit,
            defaultVolumeInputValue: product.defaultVolumeInputValue,
            defaultVolumeInputUnit: product.defaultVolumeInputUnit,
            active: true,
        });
    }
}

type CargoSummarySeed = { qtyKoli: number; weightKg: number; volumeM3: number };

async function seedTrip(seed: TripSeed) {
    const orderRef = `${SEED_PREFIX}-order-${seed.sequence}`;
    const deliveryOrderRef = `${SEED_PREFIX}-do-${seed.sequence}`;
    const tripRef = `${SEED_PREFIX}-trip-${seed.sequence}`;
    const voucherRef = `${SEED_PREFIX}-voucher-${seed.sequence}`;
    const tripDate = businessDate(14 - seed.sequence * 2);
    const doNumber = `DO-SEED-${String(seed.sequence).padStart(4, '0')}`;

    const cargoByIndex: CargoSummarySeed[] = [
        { qtyKoli: 8, weightKg: 2400, volumeM3: 18 },
        { qtyKoli: 5, weightKg: 1600, volumeM3: 12 },
    ];

    await createDocument({
        _id: orderRef,
        _type: 'order',
        masterResi: `MR-SEED-${String(seed.sequence).padStart(3, '0')}`,
        // Tanpa orderItem, cargo capabilities otomatis true (driver portal).
        cargoEntryMode: 'DELIVERY_ORDER',
        customerRef: CUSTOMER_REF,
        customerName: 'PT Sinar Transport Nusantara',
        // orders.service_ref NOT NULL (migrasi 0019).
        serviceRef: SERVICE_REF,
        serviceName: 'Reguler',
        receiverName: seed.receiver,
        receiverPhone: '0812-9999-0000',
        receiverAddress: `${seed.destination}, Indonesia`,
        receiverCompany: seed.receiver,
        pickupAddress: seed.origin,
        status: 'DELIVERED',
        notes: `Order seed driver app trip ${seed.sequence}`,
    });

    const shipperReferences = seed.sjStatuses.map((sjStatus, index) => ({
        _key: `${SEED_PREFIX}-sj-${seed.sequence}-${index + 1}`,
        sequence: index + 1,
        referenceNumber: `SJ/SEED/${String(seed.sequence).padStart(3, '0')}/${String(index + 1).padStart(3, '0')}`,
        date: tripDate,
        receiverName: seed.receiver,
        receiverCompany: seed.receiver,
        receiverAddress: `${seed.destination}, Indonesia`,
        tripStatus: sjStatus,
    }));

    await createDocument({
        _id: deliveryOrderRef,
        _type: 'deliveryOrder',
        doNumber,
        orderRef,
        masterResi: `MR-SEED-${String(seed.sequence).padStart(3, '0')}`,
        customerRef: CUSTOMER_REF,
        customerName: 'PT Sinar Transport Nusantara',
        vehicleRef: VEHICLE_REF,
        vehiclePlate: 'B 9123 KJA',
        driverRef: DRIVER_REF,
        driverName: DRIVER_NAME,
        date: tripDate,
        status: seed.doStatus,
        // Sengaja TIDAK diisi: tripClosedByAdminAt membuat DO tidak terlihat di driver app.
        trackingState: seed.trackingState,
        trackingStartedAt: seed.trackingState ? businessDate(14 - seed.sequence * 2) : null,
        tripOriginArea: seed.origin,
        tripDestinationArea: seed.destination,
        pickupAddress: seed.origin,
        receiverName: seed.receiver,
        receiverAddress: `${seed.destination}, Indonesia`,
        notes: `Seed driver app - ${seed.doStatus}`,
        tripStartOdometerKm: 128000 + seed.sequence * 100,
        shipperReferences,
        pickupStops: [{
            _key: `${SEED_PREFIX}-stop-${seed.sequence}-1`,
            sequence: 1,
            pickupLabel: 'Gudang',
            pickupAddress: seed.origin,
        }],
    });

    // surat_jalan_documents.trip_ref FK ke tabel `trips`, jadi tiap trip
    // butuh dokumen trip tersendiri (bukan deliveryOrderRef).
    await createDocument({
        _id: tripRef,
        _type: 'trip',
        tripNumber: doNumber,
        deliveryOrderRef,
        orderRef,
        masterResi: `MR-SEED-${String(seed.sequence).padStart(3, '0')}`,
        customerRef: CUSTOMER_REF,
        customerName: 'PT Sinar Transport Nusantara',
        vehicleRef: VEHICLE_REF,
        vehiclePlate: 'B 9123 KJA',
        driverRef: DRIVER_REF,
        driverName: DRIVER_NAME,
        serviceRef: SERVICE_REF,
        serviceName: 'Reguler',
        tripDate,
        status: seed.doStatus,
        pickupAddress: seed.origin,
        receiverName: seed.receiver,
        receiverCompany: seed.receiver,
        receiverAddress: `${seed.destination}, Indonesia`,
        tripOriginArea: seed.origin,
        tripDestinationArea: seed.destination,
    });

    // Dua SJ per trip. Status SJ ikut menentukan status trip di aplikasi
    // (delivery_order_service.dart::_deriveTripStatusFromSuratJalanRecords).
    for (const [index, sjStatus] of seed.sjStatuses.entries()) {
        const cargo = cargoByIndex[index];
        const held = seed.holdOnFirstSj && index === 0;
        const holdCargo: CargoSummarySeed = held
            ? { qtyKoli: 2, weightKg: 600, volumeM3: 4.5 }
            : { qtyKoli: 0, weightKg: 0, volumeM3: 0 };

        await createDocument({
            _id: `${SEED_PREFIX}-suratjalan-${seed.sequence}-${index + 1}`,
            _type: 'suratJalan',
            tripRef,
            deliveryOrderRef,
            deliveryOrderRef,
            orderRef,
            customerRef: CUSTOMER_REF,
            customerName: 'PT Sinar Transport Nusantara',
            referenceKey: shipperReferences[index]._key,
            suratJalanNumber: shipperReferences[index].referenceNumber,
            pickupAddress: seed.origin,
            receiverName: seed.receiver,
            receiverCompany: seed.receiver,
            receiverAddress: `${seed.destination}, Indonesia`,
            tripDate,
            tripStatus: sjStatus,
            vehiclePlate: 'B 9123 KJA',
            driverName: DRIVER_NAME,
            itemCount: 3,
            cargoSummary: cargo,
            billableCargo: held
                ? { qtyKoli: cargo.qtyKoli - 2, weightKg: cargo.weightKg - 600, volumeM3: cargo.volumeM3 - 4.5 }
                : cargo,
            holdCargo,
            returnCargo: { qtyKoli: 0, weightKg: 0, volumeM3: 0 },
        });
    }

    // Satu bon per trip.
    const issuedDate = tripDate;
    const totalIssued = seed.cashGiven + (seed.topUps || []).reduce((sum, amount) => sum + amount, 0);
    const totalSpent = (seed.expenses || []).reduce((sum, item) => sum + item.amount, 0);

    await createDocument({
        _id: voucherRef,
        _type: 'driverVoucher',
        bonNumber: `BON-SEED-${String(seed.sequence).padStart(4, '0')}`,
        driverRef: DRIVER_REF,
        driverName: DRIVER_NAME,
        deliveryOrderRef,
        doNumber,
        vehicleRef: VEHICLE_REF,
        vehiclePlate: 'B 9123 KJA',
        route: `${seed.origin} - ${seed.destination}`,
        issuedDate,
        cashGiven: seed.cashGiven,
        initialCashGiven: seed.cashGiven,
        totalIssuedAmount: totalIssued,
        topUpCount: (seed.topUps || []).length,
        driverFeeAmount: seed.driverFee,
        totalClaimAmount: totalSpent,
        totalSpent,
        balance: totalIssued - totalSpent,
        status: seed.bonStatus,
        notes: `Bon seed untuk trip ${doNumber}`,
        settledDate: seed.bonStatus === 'SETTLED' ? tripDate : null,
    });

    // Bon DRAFT belum pernah dicairkan, jadi tanpa disbursement.
    if (seed.cashGiven > 0) {
        await createDocument({
            _id: `${SEED_PREFIX}-disb-${seed.sequence}-initial`,
            _type: 'driverVoucherDisbursement',
            voucherRef,
            date: issuedDate,
            amount: seed.cashGiven,
            kind: 'INITIAL',
            status: 'ACTIVE',
            note: 'Pencairan awal',
        });
    }

    (seed.topUps || []).forEach((amount, index) => {
        void createDocument({
            _id: `${SEED_PREFIX}-disb-${seed.sequence}-topup-${index + 1}`,
            _type: 'driverVoucherDisbursement',
            voucherRef,
            date: issuedDate,
            amount,
            kind: 'TOP_UP',
            status: 'ACTIVE',
            note: `Top up #${index + 1}`,
        });
    });

    (seed.expenses || []).forEach((expense, index) => {
        void createDocument({
            _id: `${SEED_PREFIX}-vitem-${seed.sequence}-${index + 1}`,
            _type: 'driverVoucherItem',
            voucherRef,
            expenseDate: issuedDate,
            category: expense.category,
            description: expense.description,
            amount: expense.amount,
        });
    });

    log(`trip ${seed.sequence}: ${doNumber} (${seed.doStatus}) + 2 SJ + bon ${seed.bonStatus}`);
}

async function resetSeed() {
    for (const docType of SEED_DOC_TYPES) {
        const docs = await listDocumentsByFilter<{ _id: string }>(docType, {});
        const matching = docs.filter(doc => doc._id?.startsWith(SEED_PREFIX));
        for (const doc of matching) {
            await deleteDocument(doc._id, docType);
        }
        if (matching.length > 0) {
            log(`reset ${matching.length} dokumen ${docType}`);
        }
    }
}

async function verify() {
    const trips = await getDriverAssignedDeliveryOrders(DRIVER_REF);
    const vouchers = await getDriverAssignedVouchers(DRIVER_REF);
    const products = await listDocumentsByFilter('customerProduct', {
        customerRef: CUSTOMER_REF,
    });

    log('--- yang akan terlihat di aplikasi driver ---');
    log(`trip: ${trips.length} | bon: ${vouchers.length}`);
    log(`master barang (${CUSTOMER_NAME}): ${products.length}`);
    for (const product of [...products].sort((a, b) => a.code.localeCompare(b.code))) {
        log(`  ${product.code.padEnd(12)} ${product.name}`);
    }

    const voucherByDeliveryOrderRef = new Map(
        vouchers.map(voucher => [voucher.deliveryOrderRef, voucher]),
    );

    for (const trip of trips) {
        const voucher = voucherByDeliveryOrderRef.get(trip._id);
        log(
            [
                trip.doNumber?.padEnd(13),
                `status=${String(trip.status).padEnd(12)}`,
                `sj=${(trip.driverSuratJalanRecords as unknown[] | undefined)?.length ?? 0}`,
                `barang=${trip.driverCargoItems?.length ?? 0}`,
                `bon=${voucher ? `${voucher.bonNumber}/${voucher.status}` : 'TIDAK ADA'}`,
                voucher ? `terpakai=Rp ${Math.round(voucher.operationalSpent)}` : '',
            ]
                .filter(Boolean)
                .join(' | '),
        );
    }
}

async function seed() {
    // Default: hapus dulu data seed lama (user + master data + trip + bon),
    // lalu buat ulang dari nol. Jadi hasil run selalu sama persis, dan
    // perubahan password/schema lama tidak tertinggal.
    // Pakai --no-reset bila mau upsert tanpa hapus.
    const keepExisting = process.argv.includes('--no-reset');
    if (!keepExisting) {
        await resetSeed();
    } else {
        log('mode --no-reset: data seed lama tidak dihapus (upsert).');
    }

    await seedDriverAndMasterData();
    for (const tripSeed of TRIP_SEEDS) {
        await seedTrip(tripSeed);
    }

    await verify();
    log(`selesai. login driver: ${DRIVER_EMAIL} / ${DRIVER_PASSWORD}`);
}

seed().catch((error) => {
    console.error('[seed:driver-app] gagal', error);
    process.exitCode = 1;
});
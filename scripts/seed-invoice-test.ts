import { loadScriptEnv, requireAnyEnv } from './_env';
import { seedRelationalTables, summarizeUnsupportedSeedDocTypes } from './_supabase-relational';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

async function supabaseRequest(path: string, init: RequestInit = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
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

async function listRows<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const current = { ...params };
    if (!current.select) {
        current.select = '*';
    }
    const qs = new URLSearchParams(current).toString();
    const response = await supabaseRequest(`${path}?${qs}`);
    return (await response.json()) as T[];
}

const PERIOD = '202610';
const CUSTOMER_ID = 'cust-seed-inv-001';
const CUSTOMER_NAME = 'PT Negeri Distribusi Test';
const CUSTOMER_PICKUP = 'Gudang PT Logistik Demo - Tulangan, Sidoarjo';
const ISSUER = {
    issuerCompanyName: 'PT Logistik Demo',
    issuerCompanyEmail: 'logistikdemo@email.com',
    issuerCompanyPhone: '08123456789',
    issuerCompanyAddress: 'JL. LOGISTIK DEMO INDONESIA',
    issuerCompanyLogoUrl: '/logo.png',
};

type ServiceRow = { source_document_id: string; code: string | null; name: string | null };
type VehicleRow = { source_document_id: string; plate_number: string | null; unit_code: string | null; service_ref: string | null };
type DriverRow = { source_document_id: string; name: string | null };

async function fetchReferenceData() {
    const [services, vehicles, drivers] = await Promise.all([
        listRows<ServiceRow>('services', { select: 'source_document_id,code,name', limit: '200' }),
        listRows<VehicleRow>('vehicles', { select: 'source_document_id,plate_number,unit_code,service_ref', 'service_ref': 'not.is.null,neq.null', limit: '200' }),
        listRows<DriverRow>('drivers', { select: 'source_document_id,name', active: 'is.true', limit: '200' }),
    ]);
    if (!vehicles.length) {
        throw new Error('Tidak ada kendaraan ber-service_ref di database');
    }
    if (!drivers.length) {
        throw new Error('Tidak ada driver aktif di database');
    }
    const svc = services.find(item => item.source_document_id === 'svc-001' || item.code === 'svc-001')
        ?? services.find(item => item.name?.toLowerCase().includes('engkel'))
        ?? services[0];
    if (!svc) {
        throw new Error('Tidak ada layanan (services) di database');
    }
    const cddVehicles = vehicles.filter(item => item.service_ref === svc.source_document_id);
    const usableVehicles = cddVehicles.length > 0 ? cddVehicles : vehicles;
    return { svc, vehicles: usableVehicles, drivers };
}

type TripRow = {
    doId: string;
    orderId: string;
    doNumber: string;
    sjNumber: string;
    date: string;
    destination: string;
    vehiclePlate: string;
    ratePerKg: number;
    items: { doiId: string; desc: string; qty: number; weight: number; volume: number }[];
};

type NotaLineSpec = { row: TripRow; item: TripRow['items'][number] };

function collectNotaLines(trips: TripRow[], rowLimit: number): NotaLineSpec[] {
    const lines: NotaLineSpec[] = [];
    for (const row of trips) {
        for (const item of row.items) {
            if (lines.length >= rowLimit) return lines;
            lines.push({ row, item });
        }
    }
    return lines;
}

function seedReadyInvoices(opts: { docs: any[]; created: string; trips: TripRow[] }) {
    const { docs, created, trips } = opts;

    const invoices = [
        { key: '3row', suffix: '9001', rowLimit: 3, dueDate: '2026-11-15' },
        { key: '10row', suffix: '9002', rowLimit: 10, dueDate: '2026-11-30' },
    ];

    for (const invoice of invoices) {
        const lines = collectNotaLines(trips, invoice.rowLimit);
        if (lines.length < invoice.rowLimit) {
            throw new Error(`Invoice seed ${invoice.key}:butuh ${invoice.rowLimit} baris, hanya tersedia ${lines.length}`);
        }

        const notaId = `nota-seed-inv-${PERIOD}-${invoice.suffix}`;
        const itemIds: string[] = [];

        let totalCollie = 0;
        let totalWeightKg = 0;
        let totalVolumeM3 = 0;
        let totalAmount = 0;

        for (const [index, line] of lines.entries()) {
            const uangRp = Math.round(line.item.weight * line.row.ratePerKg);
            totalCollie += line.item.qty;
            totalWeightKg += line.item.weight;
            totalVolumeM3 += line.item.volume;
            totalAmount += uangRp;

            const itemId = `nfi-seed-inv-${PERIOD}-${invoice.suffix}-${String(index + 1).padStart(3, '0')}`;
            itemIds.push(itemId);
            docs.push({
                _id: itemId,
                _type: 'freightNotaItem',
                _createdAt: created,
                _updatedAt: created,
                notaRef: notaId,
                doRef: line.row.doId,
                deliveryOrderItemRef: line.item.doiId,
                customerRef: CUSTOMER_ID,
                customerName: CUSTOMER_NAME,
                doNumber: line.row.doNumber,
                vehiclePlate: line.row.vehiclePlate,
                date: line.row.date,
                noSJ: line.row.sjNumber,
                dari: CUSTOMER_PICKUP,
                tujuan: line.row.destination,
                barang: line.item.desc,
                collie: line.item.qty,
                beratKg: line.item.weight,
                volumeM3: line.item.volume,
                tarip: line.row.ratePerKg,
                uangRp,
                plt: '',
                pc: '',
                k: '',
                kbl: '',
                invoiceLineDate: line.row.date,
                ket: `Uji coba cetak invoice ${invoice.rowLimit} baris.`,
            });
        }

        const netAmount = totalAmount;
        docs.push({
            _id: notaId,
            _type: 'freightNota',
            _createdAt: created,
            _updatedAt: created,
            notaNumber: `NOTA-${PERIOD}-${invoice.suffix}`,
            notaDisplayNumber: `NOTA/${PERIOD}/${invoice.suffix}`,
            ...ISSUER,
            issuerCompanySignatureName: 'Bagian Administrasi',
            customerRef: CUSTOMER_ID,
            customerName: CUSTOMER_NAME,
            customerAddress: 'Jl. Industri Raya No. 88, Surabaya',
            customerContactPerson: 'Budi Test',
            customerPhone: '081234567890',
            issueDate: '2026-10-31',
            dueDate: invoice.dueDate,
            status: 'UNPAID',
            totalAmount,
            totalAdjustmentAmount: 0,
            pph23Enabled: false,
            pph23RatePercent: 2,
            pph23BaseMode: 'BEFORE_CLAIM',
            netAmount,
            totalPaidEffective: 0,
            refundedOverpaymentAmount: 0,
            openOverpaymentAmount: 0,
            totalCollie,
            totalWeightKg,
            totalVolumeM3: Number(totalVolumeM3.toFixed(2)),
            billingMode: 'PER_KG',
            instructionAccounts: [],
            footerNote: 'Invoice ini adalah data uji coba (seed) untuk memeriksa hasil cetak.',
            notes: `Uji coba cetak invoice dengan ${invoice.rowLimit} baris perincian SJ.`,
        });

        console.log(`Invoice uji ${invoice.rowLimit} baris: NOTA-${PERIOD}-${invoice.suffix} | ${itemIds.length} item | collie ${totalCollie} | ${totalWeightKg} kg | ${totalVolumeM3.toFixed(1)} m3 | Rp ${totalAmount.toLocaleString('id-ID')}`);
    }
}

async function main() {
    const { svc, vehicles, drivers } = await fetchReferenceData();
    console.log(`Menggunakan service ${svc.source_document_id} (${svc.name}), ${vehicles.length} kendaraan, ${drivers.length} driver.`);

    const BASIS_VALUES = ['PER_KG', 'PER_TON', 'PER_VOLUME', 'PER_LITER', 'PER_TRIP'] as const;
    const destinations = [
        { dest: 'Surabaya', rates: { PER_KG: 900, PER_TON: 1_350_000, PER_VOLUME: 780_000, PER_LITER: 780, PER_TRIP: 1_100_000 } },
        { dest: 'Sidoarjo', rates: { PER_KG: 700, PER_TON: 1_050_000, PER_VOLUME: 610_000, PER_LITER: 610, PER_TRIP: 850_000 } },
        { dest: 'Kediri', rates: { PER_KG: 1400, PER_TON: 2_100_000, PER_VOLUME: 1_230_000, PER_LITER: 1_230, PER_TRIP: 1_700_000 } },
        { dest: 'Madiun', rates: { PER_KG: 1650, PER_TON: 2_480_000, PER_VOLUME: 1_450_000, PER_LITER: 1_450, PER_TRIP: 2_000_000 } },
        { dest: 'Malang', rates: { PER_KG: 1500, PER_TON: 2_250_000, PER_VOLUME: 1_310_000, PER_LITER: 1_310, PER_TRIP: 1_800_000 } },
        { dest: 'Pasuruan', rates: { PER_KG: 1100, PER_TON: 1_650_000, PER_VOLUME: 960_000, PER_LITER: 960, PER_TRIP: 1_350_000 } },
    ];
    const generalRates = { PER_KG: 1200, PER_TON: 1_800_000, PER_VOLUME: 1_050_000, PER_LITER: 1050, PER_TRIP: 1_450_000 };

    const created = '2026-09-30T08:00:00.000+00:00';

    const docs: any[] = [];

    docs.push({
        _id: CUSTOMER_ID,
        _type: 'customer',
        _createdAt: created,
        _updatedAt: created,
        name: CUSTOMER_NAME,
        address: 'Jl. Industri Raya No. 88, Surabaya',
        contactPerson: 'Budi Test',
        phone: '081234567890',
        email: 'budi@negeri-distribusi.test',
        npwp: '99.999.999.9-999.999',
        defaultPaymentTerm: 30,
        active: true,
        defaultFreightNotaBillingMode: 'PER_KG',
        defaultPph23Enabled: false,
        defaultPph23RatePercent: 2,
        defaultPph23BaseMode: 'BEFORE_CLAIM',
    });

    for (const [index, item] of destinations.entries()) {
        for (const basis of BASIS_VALUES) {
            docs.push({
                _id: `cbr-seed-inv-${index + 1}-${basis.toLowerCase()}`,
                _type: 'customerBillingRate',
                _createdAt: created,
                _updatedAt: created,
                customerRef: CUSTOMER_ID,
                customerName: CUSTOMER_NAME,
                serviceRef: svc.source_document_id,
                serviceName: svc.name || '',
                basis,
                rate: item.rates[basis],
                routeFrom: CUSTOMER_PICKUP,
                routeTo: item.dest,
                notes: `Rate uji coba tarif billing ${item.dest} (${basis})`,
                active: true,
            });
        }
    }
    for (const basis of BASIS_VALUES) {
        docs.push({
            _id: `cbr-seed-inv-general-${basis.toLowerCase()}`,
            _type: 'customerBillingRate',
            _createdAt: created,
            _updatedAt: created,
            customerRef: CUSTOMER_ID,
            customerName: CUSTOMER_NAME,
            serviceRef: svc.source_document_id,
            serviceName: svc.name || '',
            basis,
            rate: generalRates[basis],
            routeFrom: '',
            routeTo: '',
            notes: `Rate umum fallback semua rute (${basis})`,
            active: true,
        });
    }

    const ITEM_PRESETS = [
        [{ desc: 'Beras premium', qty: 40, weight: 800, volume: 1.2 }],
        [{ desc: 'Minyak goreng refill', qty: 60, weight: 1200, volume: 2.4 }],
        [{ desc: 'Gula kemasan 1 kg', qty: 100, weight: 1500, volume: 2.0 }, { desc: 'Tepung terigu 25 kg', qty: 20, weight: 500, volume: 0.9 }],
        [{ desc: 'Air mineral dus', qty: 120, weight: 2000, volume: 3.6 }, { desc: 'Cairan pembersih', qty: 30, weight: 600, volume: 1.0 }, { desc: 'Karton kosong', qty: 10, weight: 80, volume: 1.6 }],
    ];

    let orderIndex = 0;
    let oiIndex = 0;
    let doiIndex = 0;

    const tripRows: TripRow[] = [];

    for (let doSeq = 1; doSeq <= 10; doSeq += 1) {
        orderIndex += 1;
        const seq = String(orderIndex).padStart(3, '0');
        const doSeq4 = String(orderIndex).padStart(4, '0');
        const date = `2026-10-${String((doSeq % 9) + 1).padStart(2, '0')}`;
        const destination = destinations[(doSeq - 1) % destinations.length];
        const preset = ITEM_PRESETS[(doSeq - 1) % ITEM_PRESETS.length];
        const sjNumber = `SJUI-${PERIOD}-${String(doSeq).padStart(3, '0')}`;
        const doId = `do-seed-inv-${PERIOD}-${String(doSeq).padStart(3, '0')}`;
        const orderId = `order-seed-inv-${PERIOD}-${String(doSeq).padStart(3, '0')}`;
        const masterResi = `R-INVTEST-${PERIOD}-${String(doSeq).padStart(3, '0')}`;
        const doNumber = `DO-INVTEST-${PERIOD}-${doSeq4}`;
        const receiverCompany = `PT Receiving ${destination.dest}`;
        const receiverName = `Rizky Test ${doSeq}`;
        const receiverAddress = `Jl. Gatot Subroto No. ${doSeq}, ${destination.dest}`;
        const vehicle = vehicles[(doSeq - 1) % vehicles.length];
        const driver = drivers[(doSeq - 1) % drivers.length];

        docs.push({
            _id: orderId,
            _type: 'order',
            _createdAt: created,
            _updatedAt: created,
            masterResi,
            status: 'COMPLETE',
            customerRef: CUSTOMER_ID,
            customerName: CUSTOMER_NAME,
            receiverName,
            receiverPhone: '08170000001',
            receiverAddress,
            receiverCompany,
            pickupAddress: CUSTOMER_PICKUP,
            serviceRef: svc.source_document_id,
            serviceName: svc.name || '',
            notes: `Order uji coba invoice #${doSeq}.`,
        });

        const itemIds: string[] = [];
        for (const item of preset) {
            oiIndex += 1;
            const oiId = `oi-seed-inv-${PERIOD}-${String(oiIndex).padStart(3, '0')}`;
            itemIds.push(oiId);
            docs.push({
                _id: oiId,
                _type: 'orderItem',
                _createdAt: created,
                _updatedAt: created,
                orderRef: orderId,
                description: item.desc,
                qtyKoli: item.qty,
                weight: item.weight,
                volume: item.volume,
                weightInputUnit: 'KG',
                weightInputValue: item.weight,
                volumeInputUnit: 'M3',
                volumeInputValue: item.volume,
                deliveredQtyKoli: item.qty,
                deliveredWeight: item.weight,
                status: 'DELIVERED',
            });
        }

        const trackingStartedAt = `${date}T01:20:00+00:00`;
        const trackingStoppedAt = `${date}T10:30:00+00:00`;

        docs.push({
            _id: doId,
            _type: 'deliveryOrder',
            _createdAt: created,
            _updatedAt: created,
            date,
            notes: `SJ uji coba invoice DO-${doSeq}.`,
            status: 'DELIVERED',
            podNote: 'Barang diterima lengkap dan kondisi baik.',
            doNumber,
            orderRef: orderId,
            driverRef: driver.source_document_id,
            driverName: driver.name || '',
            masterResi,
            serviceRef: svc.source_document_id,
            serviceName: svc.name || '',
            vehicleRef: vehicle.source_document_id,
            vehiclePlate: vehicle.plate_number || '',
            vehicleServiceRef: vehicle.service_ref || svc.source_document_id,
            vehicleServiceName: svc.name || '',
            customerRef: CUSTOMER_ID,
            customerName: CUSTOMER_NAME,
            receiverName,
            receiverPhone: '08170000001',
            trackingState: 'STOPPED',
            trackingStartedAt,
            trackingStoppedAt,
            trackingLastSeenAt: `${date}T10:28:00+00:00`,
            trackingLastSource: 'DRIVER_APP',
            trackingLastSpeedKph: 0,
            trackingLastAccuracyM: 9,
            trackingLastLat: -7.25,
            trackingLastLng: 112.61,
            receiverAddress,
            receiverCompany,
            customerDoNumber: sjNumber,
            customerDoPeriod: PERIOD,
            customerDoPrefix: 'SJUI',
            customerDoSequence: doSeq,
            tripOriginArea: 'Jawa Timur',
            tripDestinationArea: destination.dest,
            pickupAddress: CUSTOMER_PICKUP,
            pickupStops: preset.map((_, itemIndex) => ({
                _key: `pickup-${doId}-${itemIndex + 1}`,
                sequence: itemIndex + 1,
                pickupAddress: CUSTOMER_PICKUP,
            })),
            shipperReferences: [{
                _key: `sj-${doId}-1`,
                sequence: 1,
                referenceNumber: sjNumber,
                pickupStopKey: `pickup-${doId}-1`,
                pickupAddress: CUSTOMER_PICKUP,
                receiverName,
                receiverPhone: '08170000001',
                receiverCompany,
                receiverAddress,
                billingCustomerRef: CUSTOMER_ID,
                billingCustomerName: CUSTOMER_NAME,
                notes: preset.length > 1 ? `Satu SJ berisi ${preset.length} barang.` : undefined,
            }],
            actualDropPoints: preset.map((item, itemIndex) => ({
                _key: `drop-${doId}-${itemIndex + 1}`,
                sequence: itemIndex + 1,
                stopType: 'DROP',
                deliveryOrderItemRef: undefined,
                deliveryOrderItemRefs: [],
                shipperReferenceNumber: sjNumber,
                locationName: receiverCompany,
                locationAddress: destination.dest,
                qtyKoli: item.qty,
                weightKg: item.weight,
                weightInputValue: item.weight,
                weightInputUnit: 'KG',
                volumeM3: item.volume,
                volumeInputValue: item.volume,
                volumeInputUnit: 'M3',
                billingCustomerRef: CUSTOMER_ID,
                billingCustomerName: CUSTOMER_NAME,
            })),
            cargoFinalizedAt: `${date}T10:32:00+00:00`,
            cargoFinalizedBy: 'user-admin-001',
            cargoFinalizedByName: 'Admin Test',
            tripClosedByAdminAt: `${date}T10:35:00+00:00`,
            tripClosedByAdminName: 'Admin Test',
            tripStartOdometerKm: 12000 + doSeq * 10,
            tripEndOdometerKm: 12000 + doSeq * 10 + 62,
            tripDistanceKm: 62,
            odometerConfirmedAt: `${date}T10:33:00+00:00`,
            odometerConfirmedByName: 'Admin Test',
            podReceivedDate: date,
            podReceiverName: receiverName,
            taripBorongan: 1350000,
            baseTaripBorongan: 1350000,
            keteranganBorongan: `Borongan trip reguler ${CUSTOMER_PICKUP} - ${destination.dest}.`,
            ...ISSUER,
        });

        for (const [itemIndex, item] of preset.entries()) {
            doiIndex += 1;
            docs.push({
                _id: `doi-seed-inv-${PERIOD}-${String(doiIndex).padStart(3, '0')}`,
                _type: 'deliveryOrderItem',
                _createdAt: created,
                _updatedAt: created,
                deliveryOrderRef: doId,
                orderItemRef: itemIds[itemIndex],
                shipperReferenceNumber: sjNumber,
                orderItemDescription: item.desc,
                orderItemQtyKoli: item.qty,
                orderItemWeight: item.weight,
                orderItemVolumeM3: item.volume,
                shippedQtyKoli: item.qty,
                shippedWeight: item.weight,
                shippedVolume: item.volume,
                actualQtyKoli: item.qty,
                actualWeightKg: item.weight,
                actualVolumeM3: item.volume,
                actualWeightInputValue: item.weight,
                actualWeightInputUnit: 'KG',
                actualVolumeInputValue: item.volume,
                actualVolumeInputUnit: 'M3',
                actualFillRate: 1,
            });
        }

        tripRows.push({
            doId,
            orderId,
            doNumber,
            sjNumber,
            date,
            destination: destination.dest,
            vehiclePlate: vehicle.plate_number || '',
            ratePerKg: destination.rates.PER_KG,
            items: preset.map((item, itemIndex) => ({
                doiId: `doi-seed-inv-${PERIOD}-${String(doiIndex - preset.length + 1 + itemIndex).padStart(3, '0')}`,
                desc: item.desc,
                qty: item.qty,
                weight: item.weight,
                volume: item.volume,
            })),
        });
    }

    seedReadyInvoices({ docs, created, trips: tripRows });

    const skipped = summarizeUnsupportedSeedDocTypes(docs);
    if (skipped.length > 0) {
        throw new Error(`Ada doc type yang tidak didukung: ${skipped.map(item => item.type).join(', ')}`);
    }

    console.log(`Menyiapkan ${docs.length} dokumen seed: ${docs.filter(item => item._type === 'deliveryOrder').length} DO, ${docs.filter(item => item._type === 'order').length} order, ${docs.filter(item => item._type === 'customerBillingRate').length} tarif billing, ${docs.filter(item => item._type === 'freightNota').length} invoice, ${docs.filter(item => item._type === 'freightNotaItem').length} item invoice.`);

    const keepRateIds = new Set(docs.filter(item => item._type === 'customerBillingRate').map(item => item._id));
    const staleRateIds = (await listRows<{ source_document_id: string }>('customer_billing_rates', {
        select: 'source_document_id',
        customer_ref: `eq.${CUSTOMER_ID}`,
    })).map(row => row.source_document_id).filter(id => !keepRateIds.has(id));
    if (staleRateIds.length > 0) {
        await supabaseRequest(`customer_billing_rates?source_document_id=in.(${staleRateIds.join(',')})`, { method: 'DELETE' });
        console.log(`Membersihkan ${staleRateIds.length} tarif billing lama: ${staleRateIds.join(', ')}`);
    }

    await seedRelationalTables(supabaseRequest, docs);
    console.log('Seed uji coba invoice selesai di-upsert');

    const [doRows, notaRows, itemCountRows] = await Promise.all([
        listRows<Record<string, unknown>>('delivery_orders', { select: 'source_document_id,status', customer_ref: `eq.${CUSTOMER_ID}` }),
        listRows<{ source_document_id: string; nota_number: string; total_amount: number }>('freight_notas', {
            select: 'source_document_id,nota_number,total_amount',
            customer_ref: `eq.${CUSTOMER_ID}`,
            order: 'nota_number.asc',
        }),
        listRows<{ source_document_id: string; nota_ref: string }>('freight_nota_items', { select: 'source_document_id,nota_ref' }),
    ]);
    console.log(`Terverifikasi ${doRows.length} delivery order untuk ${CUSTOMER_NAME}.`);

    const counts = new Map<string, number>();
    for (const row of itemCountRows) {
        counts.set(row.nota_ref, (counts.get(row.nota_ref) || 0) + 1);
    }
    console.log(`Terverifikasi ${notaRows.length} invoice siap cetak:`);
    for (const nota of notaRows) {
        console.log(`  ${nota.nota_number}: ${counts.get(nota.source_document_id) || 0} baris perincian | Rp ${Number(nota.total_amount).toLocaleString('id-ID')}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
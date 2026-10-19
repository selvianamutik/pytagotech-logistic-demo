import { writeFileSync } from 'node:fs';
import { loadScriptEnv, requireAnyEnv } from 'file:///D:/Work/Web/logistik-admin-panel/scripts/_env.mjs';

process.chdir('D:/Work/Web/logistik-admin-panel');
loadScriptEnv('D:/Work/Web/logistik-admin-panel');
const u = requireAnyEnv(['SUPABASE_URL','SUPABASE_PROJECT_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const k = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE']);

async function g(path, params) {
    const qs = new URLSearchParams(params || {}).toString();
    const r = await fetch(u + '/rest/v1/' + path + '?' + qs, { headers: { apikey: k, Authorization: 'Bearer ' + k } });
    if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + await r.text());
    return r.json();
}

const vehicles = await g('vehicles', { select: 'source_document_id,plate_number,unit_code,service_ref', service_ref: 'not.is.null,neq.null', limit: '200' });
const drivers = await g('drivers', { select: 'source_document_id,name', active: 'is.true', limit: '200' });
if (!vehicles.length) throw new Error('no vehicles found');
if (!drivers.length) throw new Error('no drivers found');
const svcByName = { 'CDD / Engkel': 'svc-001', 'Tronton / Trailer': 'svc-006' };

const PERIOD = '202609';
const created = '2026-04-19T15:24:41.71+00:00';
const stockAdapter = v => ({
    vehicleRef: v.source_document_id,
    vehiclePlate: v.plate_number,
    vehicleServiceRef: v.service_ref,
});

const customers = {
    'cust-001': {
        name: 'PT Pangan Nusantara', prefix: 'SJ', pickup: 'Gudang PT Logistik Demo - Tulangan',
        origin: 'Tulangan', dest: 'Surabaya', phonePref: '08177710',
    },
    'cust-002': {
        name: 'PT Baja Timur Abadi', prefix: 'BK', pickup: 'Pabrik Baja Timur - Gresik',
        origin: 'Gresik', dest: 'Kediri', phonePref: '08177711',
    },
    'cust-003': {
        name: 'CV Sembada Plastik', prefix: 'SP', pickup: 'Gudang Rungkut Industri II No. 7, Surabaya',
        origin: 'Surabaya', dest: 'Kediri', phonePref: '08177712',
    },
};

const ISSUER = {
    issuerCompanyName: 'PT Logistik Demo',
    issuerCompanyEmail: 'logistikdemo@email.com',
    issuerCompanyPhone: '08123456789',
    issuerCompanyAddress: 'JL. LOGISTIK DEMO INDONESIA',
    issuerCompanyLogoUrl: '/logo.png',
};

const plan = [
    {
        customerRef: 'cust-001', doSeq: 1, date: '2026-09-15',
        receiverCompany: 'PT Retail Sentosa Surabaya', receiverName: 'Samsul Hadi', receiverPhone: '081777100001',
        receiverAddress: 'Jl. Pelabuhan No. 5, Surabaya',
        taripBorongan: 1350000, scheduledSJ: 'SJ-202609-001', villeDate: {},
        barang: [
            ['Beras premium 5 kg', 40, 800, 5, 9600000],
            ['Minyak goreng refill', 60, 1200, 6, 8400000],
        ],
        note: 'Distribusi retail reguler Surabaya, muatan lengkap.',
    },
    {
        customerRef: 'cust-001', doSeq: 2, date: '2026-09-16',
        receiverCompany: 'Pusat Distribusi Kediri', receiverName: 'Fajar Nugroho', receiverPhone: '081777100007',
        receiverAddress: 'Jl. Mastrip No. 77, Kediri',
        taripBorongan: 1450000, scheduledSJ: 'SJ-202609-002', villeDate: {},
        barang: [['Gula kemasan 1 kg', 100, 1500, 7, 4750000]],
        note: 'Pengiriman gula kemasan, POV lengkap di Kediri.',
    },
    {
        customerRef: 'cust-002', doSeq: 1, date: '2026-09-15',
        receiverCompany: 'Baja Timur Kediri', receiverName: 'Hendra Wijaya', receiverPhone: '081777100009',
        receiverAddress: 'Jl. Ahmad Dahlan No. 2, Kediri',
        taripBorongan: 1600000, scheduledSJ: 'BK-202609-001', villeDate: {},
        barang: [
            ['Plat baja ringan', 8, 240, 2, 9800000],
            ['Besi hollow 2x2', 10, 500, 3, 8500000],
        ],
        note: 'Kiriman material baja untuk proyek Kediri.',
    },
    {
        customerRef: 'cust-002', doSeq: 2, date: '2026-09-17',
        receiverCompany: 'PT Kontruksi Karya Utama', receiverName: 'Rizky Firmansyah', receiverPhone: '081777100002',
        receiverAddress: 'Jl. Veteran No. 9, Madiun',
        taripBorongan: 1500000, scheduledSJ: 'BK-202609-002', villeDate: {},
        barang: [['Plat galvanis proyek batch A', 50, 1000, 10, 18000000]],
        note: 'Plat galvanis diterima penuh di Madiun.',
    },
    {
        customerRef: 'cust-003', doSeq: 1, date: '2026-09-16',
        receiverCompany: 'PT Recycle Kediri', receiverName: 'Dewi Kurniasih', receiverPhone: '081777100008',
        receiverAddress: 'Jl. Veteran No. 5, Kediri',
        taripBorongan: 738000, scheduledSJ: 'SP-202609-001', villeDate: {},
        barang: [['Biji plastik recycle', 60, 1800, 8, 6500000]],
        note: 'Kiriman biji plastik recycle rutin.',
    },
    {
        customerRef: 'cust-003', doSeq: 2, date: '2026-09-18',
        receiverCompany: 'PT Plastindo Jaya', receiverName: 'Andri Setiawan', receiverPhone: '081777100003',
        receiverAddress: 'Jl. Margorejo Indah No. 3, Surabaya',
        taripBorongan: 950000, scheduledSJ: 'SP-202609-002', villeDate: {},
        barang: [
            ['Film plastik packing', 30, 600, 4, 7200000],
            ['Kantong anyam 50 kg', 20, 400, 3, 3800000],
        ],
        note: 'Dua barang retail dalam satu SJ, drop Surabaya.',
    },
];

const docs = [];
let orderIdx = 0;
let oiIdx = 0;
let doiIdx = 0;

for (const p of plan) {
    orderIdx += 1;
    const seq = String(orderIdx).padStart(3, '0');
    const doSeq4 = String(orderIdx).padStart(4, '0');
    const cust = customers[p.customerRef];
    const customerDoNumber = `${cust.prefix}-${PERIOD}-${String(p.doSeq).padStart(3, '0')}`;
    const doId = `do-202609-${seq}`;
    const orderId = `order-202609-${seq}`;
    const masterResi = `R-202609-${seq}`;
    const doNumber = `DO-202609-${doSeq4}`;
    const svc = 'svc-001';
    const svcName = 'CDD / Engkel';
    const veh = stockAdapter(vehicles[(orderIdx - 1) % vehicles.length]);
    const drv = drivers[(orderIdx - 1) % drivers.length];
    const sjKey = `sj-${doId}-1`;

    docs.push({
        masterResi, status: 'COMPLETE', customerRef: p.customerRef, customerName: cust.name,
        receiverName: p.receiverName, receiverPhone: p.receiverPhone, receiverAddress: p.receiverAddress,
        receiverCompany: p.receiverCompany, pickupAddress: cust.pickup, serviceRef: svc, serviceName: svcName,
        notes: p.note, createdAt: `${p.date}T08:00:00Z`,
        _id: orderId, _type: 'order', _createdAt: created, _updatedAt: created,
    });

    for (const [desc, qty, weight, volume, value] of p.barang) {
        oiIdx += 1;
        const oiId = `oi-202609-${String(oiIdx).padStart(3, '0')}`;
        docs.push({
            value, status: 'DELIVERED', volume, weight, qtyKoli: qty,
            orderRef: orderId, description: desc,
            weightInputUnit: 'KG', weightInputValue: weight,
            volumeInputUnit: 'M3', volumeInputValue: volume,
            deliveredQtyKoli: qty, deliveredWeight: weight,
            _id: oiId, _type: 'orderItem', _createdAt: created, _updatedAt: created,
        });
        p._oiIds = p._oiIds || [];
        p._oiIds.push(oiId);
    }

    const stops = p.barang.map((_, i) => ({
        _key: `pickup-${doId}-${i + 1}`, sequence: i + 1, pickupAddress: cust.pickup,
    }));
    const keepStopKey = stops[0]._key;
    const sjRef = {
        _key: sjKey, sequence: 1, referenceNumber: customerDoNumber,
        pickupStopKey: keepStopKey, pickupAddress: cust.pickup,
        receiverName: p.receiverName, receiverPhone: p.receiverPhone,
        receiverCompany: p.receiverCompany, receiverAddress: p.receiverAddress,
        notes: p.barang.length > 1 ? `Satu SJ berisi ${p.barang.length} barang.` : undefined,
    };
    const actualDropPoints = p.barang.map(([desc, qty, weight], i) => ({
        _key: `drop-${doId}-${i + 1}`, sequence: i + 1, stopType: 'DROP',
        deliveryOrderItemRef: undefined, deliveryOrderItemRefs: [],
        shipperReferenceNumber: customerDoNumber,
        locationName: p.receiverCompany, locationAddress: p.receiverAddress,
        qtyKoli: qty, weightKg: weight, weightInputValue: weight, weightInputUnit: 'KG',
    }));

    const trackingStartedAt = `${p.date}T01:20:00Z`;
    const trackingStoppedAt = `${p.date}T10:30:00Z`;

    docs.push({
        date: p.date,
        notes: p.note,
        status: 'DELIVERED',
        podNote: 'Barang diterima lengkap dan kondisi baik.',
        doNumber,
        orderRef: orderId,
        driverRef: drv.source_document_id,
        driverName: drv.name,
        masterResi,
        serviceRef: svc,
        serviceName: svcName,
        vehicleRef: veh.vehicleRef,
        vehiclePlate: veh.vehiclePlate,
        vehicleServiceRef: veh.vehicleServiceRef,
        vehicleServiceName: 'CDD / Engkel',
        customerRef: p.customerRef,
        customerName: cust.name,
        receiverName: p.receiverName,
        receiverPhone: p.receiverPhone,
        trackingState: 'STOPPED',
        trackingStartedAt,
        trackingStoppedAt,
        trackingLastSeenAt: `${p.date}T10:28:00Z`,
        trackingLastSource: 'DRIVER_APP',
        trackingLastSpeedKph: 0,
        trackingLastAccuracyM: 9,
        trackingLastLat: -7.2575,
        trackingLastLng: 112.7521,
        receiverAddress: p.receiverAddress,
        receiverCompany: p.receiverCompany,
        customerDoNumber,
        customerDoPeriod: PERIOD,
        customerDoPrefix: cust.prefix,
        customerDoSequence: p.doSeq,
        tripOriginArea: cust.origin,
        tripDestinationArea: cust.dest,
        pickupAddress: cust.pickup,
        pickupStops: stops,
        shipperReferences: [sjRef],
        actualDropPoints,
        cargoFinalizedAt: `${p.date}T10:32:00Z`,
        cargoFinalizedBy: 'user-admin-001',
        cargoFinalizedByName: 'Dimas Wicaksono',
        tripClosedByAdminAt: `${p.date}T10:35:00Z`,
        tripClosedByAdminName: 'Dimas Wicaksono',
        tripStartOdometerKm: 12450,
        tripEndOdometerKm: 12512,
        tripDistanceKm: 62,
        odometerConfirmedAt: `${p.date}T10:33:00Z`,
        odometerConfirmedByName: 'Dimas Wicaksono',
        podReceivedDate: p.date,
        podReceiverName: p.receiverName,
        taripBorongan: p.taripBorongan,
        baseTaripBorongan: p.taripBorongan,
        keteranganBorongan: `Borongan trip reguler ${cust.origin} - ${cust.dest}.`,
        notes: p.note,
        ...ISSUER,
        _id: doId, _type: 'deliveryOrder', _createdAt: created, _updatedAt: created,
    });

    for (let i = 0; i < p.barang.length; i += 1) {
        doiIdx += 1;
        const [desc, qty, weight, volume] = p.barang[i];
        docs.push({
            deliveryOrderRef: doId,
            orderItemRef: p._oiIds[i],
            shipperReferenceNumber: customerDoNumber,
            orderItemDescription: desc,
            orderItemQtyKoli: qty,
            orderItemWeight: weight,
            orderItemVolumeM3: volume,
            shippedQtyKoli: qty,
            shippedWeight: weight,
            shippedVolume: volume,
            actualQtyKoli: qty,
            actualWeightKg: weight,
            actualVolumeM3: volume,
            actualWeightInputValue: weight,
            actualWeightInputUnit: 'KG',
            actualFillRate: 1,
            _id: `doi-202609-${String(doiIdx).padStart(3, '0')}`, _type: 'deliveryOrderItem',
            _createdAt: created, _updatedAt: created,
        });
    }
}

for (let x = 1; x <= 6; x += 1) {
    if (!docs.some(d => d._type === 'deliveryOrder' && d._id === `do-202609-${String(x).padStart(3, '0')}`)) {
        throw new Error(`missing do #${x}`);
    }
}

writeFileSync('D:/Work/Web/logistik-admin-panel/artifacts/delivery-order-demo-seed.json', JSON.stringify(docs, null, 2));
console.log('WROTE', docs.filter(d => d._type === 'deliveryOrder').length, 'DOs,', docs.filter(d => d._type === 'orderItem').length, 'orderItems,', docs.filter(d => d._type === 'deliveryOrderItem').length, 'deliveryOrderItems, total', docs.length, 'docs');
console.log('vehicles used:', [...new Set(docs.filter(d => d._type === 'deliveryOrder').map(d => `${d.vehicleRef} (${d.vehiclePlate})`))].join(', '));
console.log('drivers used:', [...new Set(docs.filter(d => d._type === 'deliveryOrder').map(d => `${d.driverRef} (${d.driverName})`))].join(', '));
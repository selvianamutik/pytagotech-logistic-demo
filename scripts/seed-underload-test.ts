import { loadScriptEnv, requireAnyEnv } from './_env';
import { seedRelationalTables, summarizeUnsupportedSeedDocTypes } from './_supabase-relational';

loadScriptEnv();
const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

async function req(path: string, init: RequestInit = {}) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  if (!r.ok) throw new Error(await r.text());
  return r;
}
async function listRows<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams({ select: '*', ...params }).toString();
  return (await (await req(`${path}?${qs}`)).json()) as T[];
}
const PERIOD = '202610';
const PREFIX = `underload-${PERIOD}`;
const CUSTOMER_ID = `cust-seed-${PREFIX}`;
const CUSTOMER_NAME = 'PT Muatan Kurang Test';
const CUSTOMER_PICKUP = 'Gudang PT Muatan Kurang Test - Sidoarjo';
const SERVICE_ID = `svc-seed-${PREFIX}`;
const SERVICE_NAME = 'CDD / Engkel Underload Test';
const SERVICE_LIMIT_KG = 10000;
const TRIP_RATE_ID = `trr-seed-${PREFIX}`;
const VEHICLE_ID = `veh-seed-${PREFIX}`;
const DRIVER_ID = `drv-seed-${PREFIX}`;
const BASE_FEE = 1500000;
const RATE_PER_TON = 10000;
type SeedDoc = Record<string, unknown> & { _id: string; _type: string };
async function main() {
  const docs: SeedDoc[] = [];
  const now = new Date().toISOString();
  const create = (d: SeedDoc) => { docs.push({ ...d, _createdAt: now, _updatedAt: now }); };
  create({ _id: SERVICE_ID, _type: 'service', code: `UND-${PERIOD}`, name: SERVICE_NAME, description: 'Layanan uji underload.', maxPayloadKg: SERVICE_LIMIT_KG, oilMaintenanceKm: 10000, tireLayoutConfig: { axleLayouts: ['SINGLE', 'DUAL'], spareCount: 1 }, active: true });
  create({ _id: TRIP_RATE_ID, _type: 'tripRouteRate', originArea: 'Sidoarjo', destinationArea: 'Underload Test', serviceRef: SERVICE_ID, serviceName: SERVICE_NAME, rate: BASE_FEE, overtonaseDriverRatePerTon: RATE_PER_TON, notes: 'Tarif uji underload.', active: true });
  create({ _id: CUSTOMER_ID, _type: 'customer', name: CUSTOMER_NAME, address: CUSTOMER_PICKUP, phone: '(031) 8000001', email: 'underload-test@example.com', active: true, pickupLocations: [{ _key: `pickup-${PREFIX}`, label: 'Gudang utama', address: CUSTOMER_PICKUP, isDefault: true }], recipients: [{ _key: `recipient-${PREFIX}`, name: 'Toko Underload Test', address: 'Jl. Underload No. 1', phone: '081000000001', isDefault: true }] });
  create({ _id: VEHICLE_ID, _type: 'vehicle', unitCode: `UND-${PERIOD}`, plateNumber: 'W 0000 UND', serviceRef: SERVICE_ID, serviceName: SERVICE_NAME, capacityKg: SERVICE_LIMIT_KG + 5000, status: 'AVAILABLE', active: true, stnkExpiry: '2027-10-01' });
  create({ _id: DRIVER_ID, _type: 'driver', name: 'Driver Underload Test', phone: '081000000002', active: true });
  const cases: Array<{ s: string; kg: number; mode?: string; rate?: number; manual?: number; ded: number }> = [
    { s: 'auto', kg: 8000, ded: 20000 },
    { s: 'subton', kg: 9600, ded: 0 },
    { s: 'manual', kg: 8000, manual: 1500, ded: 10000 },
    { s: 'custom', kg: 7000, mode: 'custom', rate: 25, ded: 75000 },
  ];
  for (let idx = 0; idx < cases.length; idx++) {
    const c = cases[idx];
    const seq = String(idx + 1).padStart(2, '0');
    const orderId = `ord-seed-${PREFIX}-${c.s}`;
    const doId = `do-seed-${PREFIX}-${c.s}`;
    const doiId = `doi-seed-${PREFIX}-${c.s}`;
    const doNumber = `DO-UND-${PERIOD}-${seq}`;
    const sjNumber = `SJ-UND-${PERIOD}-${seq}`;
    const desc = `Paket Underload ${c.s} ${seq}`;
    create({ _id: orderId, _type: 'order', masterResi: `RESI-UND-${PERIOD}-${seq}`, cargoEntryMode: 'DELIVERY_ORDER', customerRef: CUSTOMER_ID, customerName: CUSTOMER_NAME, serviceRef: SERVICE_ID, serviceName: SERVICE_NAME, pickupAddress: CUSTOMER_PICKUP, receiverName: 'Toko Underload Test', receiverCompany: 'Toko Underload Test', receiverAddress: 'Jl. Underload No. 1', receiverPhone: '081000000001', status: 'COMPLETE', tripPlans: [], createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'seed-underload-test', tripOriginArea: 'Sidoarjo', tripDestinationArea: 'Underload Test' });
    create({ _id: `${orderId}-item-1`, _type: 'orderItem', orderRef: orderId, customerProductRef: `prod-seed-${PREFIX}-${c.s}`, description: desc, qtyKoli: 10, weight: c.kg, volume: 2, deliveredQtyKoli: 10, deliveredWeight: c.kg, status: 'COMPLETE' });
    create({
      _id: doId, _type: 'deliveryOrder', orderRef: orderId, customerRef: CUSTOMER_ID, customerName: CUSTOMER_NAME, doNumber, vehicleRef: VEHICLE_ID, vehiclePlate: 'W 0000 UND', driverRef: DRIVER_ID, driverName: 'Driver Underload Test', serviceRef: SERVICE_ID, serviceName: SERVICE_NAME, tripRouteRateRef: TRIP_RATE_ID, tripOriginArea: 'Sidoarjo', tripDestinationArea: 'Underload Test', date: '2026-10-02', status: 'DELIVERED',
      ...(c.manual !== undefined ? { manualUnderloadWeightKg: c.manual } : {}),
      ...(c.mode !== undefined ? { underloadRateMode: c.mode } : {}),
      ...(c.rate !== undefined ? { underloadDriverRatePerKg: c.rate } : {}),
      shipperReferences: [{ _key: `${doId}-sj`, referenceNumber: sjNumber, pickupAddress: CUSTOMER_PICKUP }], pickupAddress: CUSTOMER_PICKUP, receiverName: 'Toko Underload Test', receiverCompany: 'Toko Underload Test', receiverAddress: 'Jl. Underload No. 1', receiverPhone: '081000000001', baseTaripBorongan: BASE_FEE, taripBorongan: BASE_FEE - c.ded, actualTotalWeightKg: c.kg, serviceMaxPayloadKg: SERVICE_LIMIT_KG, vehicleCapacityKg: SERVICE_LIMIT_KG + 5000, actualDropPoints: [{ _key: `${doId}-drop-1`, sequence: 1, stopType: 'DROP', deliveryOrderItemRef: doiId, deliveryOrderItemRefs: [doiId], shipperReferenceKey: `${doId}-sj`, shipperReferenceNumber: sjNumber, locationName: 'Toko Underload Test', locationAddress: 'Jl. Underload No. 1', qtyKoli: 10, weightKg: c.kg, volumeM3: 2 }], cargoFinalizedAt: '2026-10-02T10:00:00.000Z' });
    create({ _id: doiId, _type: 'deliveryOrderItem', deliveryOrderRef: doId, orderItemRef: `${orderId}-item-1`, shipperReferenceKey: `${doId}-sj`, shipperReferenceNumber: sjNumber, orderItemDescription: desc, orderItemQtyKoli: 10, orderItemWeight: c.kg, orderItemVolumeM3: 2, actualQtyKoli: 10, actualWeightKg: c.kg, actualVolumeM3: 2 });
  }
  const skipped = summarizeUnsupportedSeedDocTypes(docs);
  if (skipped.length > 0) throw new Error(`tipe tak didukung: ${skipped.map((x) => x.type).join(', ')}`);
  console.log(`Menyiapkan ${docs.length} dokumen underload. Ekspektasi auto Rp 20.000, subton Rp 0, manual Rp 10.000, custom Rp 75.000.`);
  await seedRelationalTables(req, docs);
  console.log('Seed underload selesai di-upsert');
  const rows = await listRows<Record<string, unknown>>('delivery_orders', { select: 'source_document_id,do_number', customer_ref: `eq.${CUSTOMER_ID}` });
  console.log(`Terverifikasi ${rows.length} DO untuk ${CUSTOMER_NAME}.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });



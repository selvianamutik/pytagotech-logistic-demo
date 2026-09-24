import { loadScriptEnv, requireAnyEnv } from './_env.mjs';

loadScriptEnv();

const url = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const key = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE', 'SUPABASE_SECRET_KEY']);

async function q(table, select, filter) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter ? `&${filter}` : ''}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`${table} ${res.status}: ${await res.text()}`);
    return res.json();
}

const doNumber = 'DO-202603-0011';

console.log('=== delivery_orders DO-202603-0011 ===');
const doRows = await q('delivery_orders', 'id,do_number,do_status,tracking_state,driver_name,vehicle_plate,notes,pod_note,shipper_reference_count', `do_number=eq.${doNumber}`);
for (const r of doRows) console.log(JSON.stringify(r));

console.log('\n=== trips derived from do-011 ===');
const tripRows = await q('trips', 'id,trip_number,trip_status,tracking_state,driver_name,vehicle_plate,hold_cargo_qty_koli,hold_cargo_weight_kg,hold_cargo_volume_m3,trip_status', `source_delivery_order_ref=eq.do-011`);
if (tripRows.length === 0) console.log('(none)');
for (const r of tripRows) console.log(JSON.stringify(r));

console.log('\n=== surat_jalan_documents derived from do-011 ===');
const sjRows = await q('surat_jalan_documents', 'id,surat_jalan_number,sj_status,trip_status,driver_name,hold_cargo_qty_koli,hold_cargo_weight_kg,hold_cargo_volume_m3,notes', `source_delivery_order_ref=eq.do-011`);
if (sjRows.length === 0) console.log('(none)');
for (const r of sjRows) console.log(JSON.stringify(r));

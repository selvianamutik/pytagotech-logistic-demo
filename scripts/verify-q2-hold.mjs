import { createClient } from '@supabase/supabase-js';
import { loadScriptEnv, requireAnyEnv } from './_env.mjs';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL', 'SUPABASE_SUPABASE_APP_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE', 'SUPABASE_SUPABASE_SERVICE_ROLE']);

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

async function main() {
    console.log('=== delivery_orders DO-202603-0011 ===');
    const { data: doRows, error: doErr } = await supabase
        .from('delivery_orders')
        .select('id,do_number,do_status,tracking_state,driver_name,vehicle_plate,notes,shipper_references,pod_note')
        .eq('do_number', 'DO-202603-0011');
    if (doErr) { console.error('DO query error:', doErr.message); process.exit(1); }
    for (const row of doRows || []) console.log(JSON.stringify(row));

    console.log('\n=== derived trip for DO-202603-0011 (source_delivery_order_ref = do-011) ===');
    const { data: tripRows, error: tripErr } = await supabase
        .from('trips')
        .select('id,trip_number,trip_date,trip_status,tracking_state,driver_name,vehicle_plate,trip_origin_area,trip_destination_area,hold_cargo_qty_koli,hold_cargo_weight_kg,hold_cargo_volume_m3,trip_notes')
        .or('trip_number.eq.DO-202603-0011,source_delivery_order_ref.eq.do-011')
        .limit(10);
    if (tripErr) { console.error('Trip query error:', tripErr.message); process.exit(1); }
    for (const row of tripRows || []) console.log(JSON.stringify(row));

    console.log('\n=== derived surat jalan for DO-202603-0011 ===');
    const { data: sjRows, error: sjErr } = await supabase
        .from('surat_jalan_documents')
        .select('id,surat_jalan_number,sj_status,driver_name,vehicle_plate,billable_cargo_qty_koli,hold_cargo_qty_koli,hold_cargo_weight_kg,return_cargo_qty_koli,notes')
        .or('surat_jalan_number.eq.DO-202603-0011,source_delivery_order_ref.eq.do-011')
        .limit(10);
    if (sjErr) { console.error('SJ query error:', sjErr.message); process.exit(1); }
    for (const row of sjRows || []) console.log(JSON.stringify(row));
}

main().catch(err => { console.error(err); process.exit(1); });

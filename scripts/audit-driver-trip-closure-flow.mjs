import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();

function read(relativePath) {
    return fs.readFileSync(path.join(appDir, relativePath), 'utf8');
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertIncludes(source, expected, message) {
    assert(source.includes(expected), message);
}

function assertNotIncludes(source, expected, message) {
    assert(!source.includes(expected), message);
}

function assertMatches(source, pattern, message) {
    assert(pattern.test(source), message);
}

const mobileTrackingPageSource = read('apps/driver_app/lib/src/features/tracking/presentation/tracking_home_page.dart');
const mobileDeliveryOrderServiceSource = read('apps/driver_app/lib/src/features/tracking/data/delivery_order_service.dart');
const driverStatusRouteSource = read('src/app/api/driver/delivery-orders/status/route.ts');
const orderWorkflowSource = read('src/lib/api/order-workflows.ts');
const adminTripDetailSource = read('src/app/(admin)/_components/TripDetailPage.tsx');
const adminDataRouteSource = read('src/app/api/data/route.ts');
const tripResourceLockSource = read('src/lib/trip-resource-lock-support.ts');

assertIncludes(
    mobileTrackingPageSource,
    'Future<void> _openTripClosure(DeliveryTrip trip) async',
    'Mobile driver harus punya action khusus untuk mengajukan tutup trip.'
);
assertIncludes(
    mobileTrackingPageSource,
    'if (trip.status != TripStatus.delivered)',
    'Mobile driver tidak boleh mengajukan tutup trip sebelum status trip DELIVERED.'
);
assertIncludes(
    mobileTrackingPageSource,
    'if (trip.isTripClosedByAdmin)',
    'Mobile driver harus memblokir tutup trip yang sudah ditutup admin.'
);
assertIncludes(
    mobileTrackingPageSource,
    'if (trip.isAwaitingAdminApproval)',
    'Mobile driver harus memblokir pengajuan tutup trip saat masih ada approval admin pending.'
);
assertMatches(
    mobileTrackingPageSource,
    /await _popDialogAfterKeyboardDismiss<_TripClosureSubmitResult>\(\s+context,\s+_TripClosureSubmitResult\(/,
    'Dialog tutup trip mobile harus memakai pop keyboard-safe sebelum submit agar stabil saat input angka aktif.'
);
assertMatches(
    mobileTrackingPageSource,
    /_popDialogAfterKeyboardDismiss<_TripClosureSubmitResult>\(\s+context,\s+\)/,
    'Dialog tutup trip mobile harus memakai pop keyboard-safe sebelum batal agar stabil saat input angka aktif.'
);
assertIncludes(
    mobileTrackingPageSource,
    'FocusManager.instance.primaryFocus?.unfocus();',
    'Dialog input mobile harus menutup fokus lewat FocusManager sebelum route dialog dipop.'
);
assertIncludes(
    mobileTrackingPageSource,
    'await Future<void>.delayed(const Duration(milliseconds: 150));',
    'Dialog input mobile harus memberi jeda singkat setelah unfocus supaya IME/focus settle sebelum pop.'
);
assertNotIncludes(
    mobileTrackingPageSource,
    "import 'mobile_input_visibility.dart';",
    'Dialog tracking mobile tidak boleh bergantung ke MobileInputVisibilityRoot karena wrapper ini pernah memicu red screen native saat dialog ditutup dengan input fokus.'
);
assertIncludes(
    mobileTrackingPageSource,
    'scrollPadding: _keyboardAwareScrollPadding(context)',
    'Input odometer tutup trip harus punya padding keyboard-aware agar halaman tidak hilang saat mengetik.'
);
assertIncludes(
    mobileTrackingPageSource,
    'Odometer akhir tidak boleh lebih kecil dari',
    'Mobile driver harus memvalidasi odometer akhir tidak lebih kecil dari odometer kendaraan terakhir.'
);
assertIncludes(
    mobileTrackingPageSource,
    'Permintaan tutup trip dikirim. Menunggu approval admin.',
    'Mobile driver harus menjelaskan bahwa tutup trip masih menunggu approval admin.'
);

assertIncludes(
    mobileDeliveryOrderServiceSource,
    'Future<void> requestTripClosure',
    'Mobile service harus punya request khusus tutup trip.'
);
assertIncludes(
    mobileDeliveryOrderServiceSource,
    "'status': 'DELIVERED'",
    'Payload tutup trip mobile harus memakai status DELIVERED.'
);
assertIncludes(
    mobileDeliveryOrderServiceSource,
    "'closeTripOnly': true",
    'Payload tutup trip mobile harus ditandai closeTripOnly agar tidak tercampur finalisasi SJ/barang.'
);
assertIncludes(
    mobileDeliveryOrderServiceSource,
    "'tripEndOdometerKm': tripEndOdometerKm",
    'Payload tutup trip mobile harus mengirim odometer akhir.'
);
assertIncludes(
    mobileDeliveryOrderServiceSource,
    "'Authorization': 'Bearer $sessionToken'",
    'Payload tutup trip mobile harus memakai sesi driver yang login.'
);

assertIncludes(
    driverStatusRouteSource,
    'const closeTripOnly = body.closeTripOnly === true;',
    'API driver harus membedakan permintaan tutup trip dari finalisasi SJ biasa.'
);
assertIncludes(
    driverStatusRouteSource,
    "if (status !== 'DELIVERED')",
    'API driver harus menolak closeTripOnly selain status DELIVERED.'
);
assertIncludes(
    driverStatusRouteSource,
    'if (deliveryOrder.pendingDriverStatus || pendingDriverRequests.length > 0)',
    'API driver harus menolak tutup trip jika masih ada approval driver lain pending.'
);
assertIncludes(
    driverStatusRouteSource,
    'if (deliveryOrder.tripClosedByAdminAt)',
    'API driver harus menolak tutup trip yang sudah ditutup admin.'
);
assertIncludes(
    driverStatusRouteSource,
    "if (deliveryOrder.status !== 'DELIVERED')",
    'API driver harus mengizinkan pengajuan tutup trip hanya setelah DO DELIVERED.'
);
assertIncludes(
    driverStatusRouteSource,
    "listDocumentsByFilter<SuratJalanRecord>('suratJalan', { tripRef: id })",
    'API driver harus membaca seluruh SJ trip sebelum menerima pengajuan tutup trip.'
);
assertIncludes(
    driverStatusRouteSource,
    "activeSuratJalanRecords.some(record => record.tripStatus !== 'DELIVERED')",
    'API driver harus memastikan semua SJ sudah DELIVERED sebelum tutup trip.'
);
assertIncludes(
    driverStatusRouteSource,
    'if (tripEndOdometerKm <= 0)',
    'API driver harus mewajibkan odometer akhir positif.'
);
assertIncludes(
    driverStatusRouteSource,
    'const lastOdometer = Math.max(Number(vehicle.lastOdometer) || 0, 0);',
    'API driver harus memakai odometer terakhir kendaraan sebagai baseline validasi.'
);
assertIncludes(
    driverStatusRouteSource,
    'if (tripEndOdometerKm < lastOdometer)',
    'API driver harus menolak odometer akhir di bawah odometer kendaraan terakhir.'
);
assertIncludes(
    driverStatusRouteSource,
    'closeTripOnly: true',
    'Pending request tutup trip harus tersimpan sebagai closeTripOnly.'
);
assertIncludes(
    driverStatusRouteSource,
    'targetSuratJalanRefs: selectedSuratJalanRefs',
    'Pending request tutup trip harus menargetkan seluruh SJ aktif dalam trip.'
);
assertIncludes(
    driverStatusRouteSource,
    'pendingDriverRequests: [pendingDriverRequest]',
    'Pengajuan tutup trip harus masuk ke queue approval admin.'
);
assertIncludes(
    driverStatusRouteSource,
    'tripEndOdometerKm,',
    'Draft odometer akhir harus tersimpan sambil menunggu approval admin.'
);

assertIncludes(
    orderWorkflowSource,
    'pendingDriverTripEndOdometerKm = undefined;',
    'Finalisasi SJ/barang driver tidak boleh otomatis menutup trip atau mengirim odometer akhir.'
);
assertIncludes(
    orderWorkflowSource,
    'const tripEndOdometerPatch = deliveryOrder.odometerConfirmedAt || !rejectedRequest.closeTripOnly ? {} : { tripEndOdometerKm: null };',
    'Reject approval tutup trip harus membersihkan draft odometer jika belum dikonfirmasi admin.'
);
assertIncludes(
    orderWorkflowSource,
    'export async function handleDeliveryOrderTripClosureSet',
    'Admin harus punya workflow eksplisit untuk menutup trip.'
);
assertIncludes(
    orderWorkflowSource,
    "if (closed && deliveryOrder.status !== 'DELIVERED' && deliveryOrder.status !== 'PARTIAL_HOLD')",
    'Workflow admin hanya boleh menutup trip setelah DELIVERED atau PARTIAL_HOLD.'
);
assertIncludes(
    orderWorkflowSource,
    'applyTripClosureOdometerUpdates',
    'Workflow admin harus mengupdate odometer kendaraan saat trip ditutup.'
);
assertIncludes(
    orderWorkflowSource,
    'pendingDriverRequests: nextPendingDriverRequests',
    'Approval admin tutup trip harus menghapus request driver yang sudah direview.'
);

assertIncludes(
    adminDataRouteSource,
    "entity === 'delivery-orders' && action === 'set-trip-closure'",
    'Admin API harus membuka action set-trip-closure untuk approval tutup trip.'
);
assertIncludes(
    adminDataRouteSource,
    'handleDeliveryOrderTripClosureSet(session, data, addAuditLog)',
    'Admin API harus meneruskan set-trip-closure ke workflow penutupan trip.'
);

assertIncludes(
    adminTripDetailSource,
    'const isPendingDriverTripClosureRequest = (request?: PendingDriverStatusRequest | null) =>',
    'Admin detail trip harus mengenali pending request tutup trip driver.'
);
assertIncludes(
    adminTripDetailSource,
    "request.closeTripOnly || request.tripEndOdometerKm",
    'Admin detail trip harus membedakan request tutup trip dari approval finalisasi SJ.'
);
assertIncludes(
    adminTripDetailSource,
    "Driver mengajukan tutup trip",
    'Admin detail trip harus menampilkan konteks request tutup trip.'
);
assertIncludes(
    adminTripDetailSource,
    'Odometer akhir diajukan:',
    'Admin detail trip harus menampilkan odometer akhir yang diajukan driver.'
);
assertIncludes(
    adminTripDetailSource,
    "void toggleTripClosure(request.tripEndOdometerKm || undefined);",
    'Review tutup trip admin harus membawa odometer yang diajukan driver ke modal closure.'
);
assertIncludes(
    adminTripDetailSource,
    "Review Tutup Trip",
    'Admin detail trip harus punya aksi eksplisit Review Tutup Trip.'
);

// `isDeliveryOrderResourceLocked` no longer gates assignability (a driver/vehicle
// may be reused across many DOs). It only decides which trips the driver portal
// keeps listing as active, so these checks are about portal visibility.
assertIncludes(
    tripResourceLockSource,
    "order.tripEndOdometerKm === 'number'",
    'Trip aktif di portal supir harus memperhitungkan odometer yang menunggu approval.'
);
assertIncludes(
    tripResourceLockSource,
    '!order.odometerConfirmedAt',
    'Trip hanya boleh berhenti aktif di portal supir setelah odometer dikonfirmasi admin.'
);
assertMatches(
    tripResourceLockSource,
    /LOCKING_DELIVERY_ORDER_STATUSES[\s\S]*'DELIVERED'/,
    'DO DELIVERED harus tetap tampil sebagai trip aktif di portal supir sampai admin closure.'
);
assertMatches(
    tripResourceLockSource,
    /order\.status === 'CANCELLED' \|\| order\.tripClosedByAdminAt/,
    'Trip harus berhenti tampil aktif di portal supir setelah tripClosedByAdminAt.'
);

console.log('Driver trip closure audit OK: mobile request, API guards, admin approval, odometer, and active-trip visibility verified.');

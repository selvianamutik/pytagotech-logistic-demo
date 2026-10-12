import 'package:driver_app/src/features/tracking/domain/models.dart';
import 'package:driver_app/src/features/tracking/presentation/voucher_widgets.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

DriverTripVoucher _voucher() {
    return const DriverTripVoucher(
        id: 'v-1',
        bonNumber: 'BON-SEED-0002',
        status: 'ISSUED',
        issuedDate: '2026-09-30',
        totalIssuedAmount: 1500000,
        initialCashGiven: 1500000,
        topUpAmount: 0,
        operationalSpent: 165000,
        operationalBalance: 1335000,
        driverFeeAmount: 250000,
        totalClaimAmount: 165000,
        netSettlementAmount: 1085000,
        doNumber: 'DO-SEED-0002',
        vehiclePlate: 'B 9123 KJA',
        route: 'Cikarang -> Surabaya',
    );
}

Future<void> _pumpAt(WidgetTester tester, double width) async {
    tester.view.physicalSize = Size(width, 720);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
        MaterialApp(
            home: Scaffold(
                body: DriverVoucherPreviewDialog(voucher: _voucher()),
            ),
        ),
    );
    await tester.pumpAndSettle();
}

void main() {
    // "Tutup" dan "Download PDF" harus sama tinggi di semua lebar layar.
    //-label "Download PDF" yang lebih panjang sebelumnya membungkus di layar
    // sempit sehingga tombolnya lebih tinggi dari "Tutup".
    for (final width in <double>[320, 360, 400, 480, 800]) {
        testWidgets('tombol aksi sama besar di lebar $width', (tester) async {
            await _pumpAt(tester, width);

            final closeButton = find.widgetWithText(OutlinedButton, 'Tutup');
            final downloadButton = find.widgetWithText(FilledButton, 'Download PDF');
            expect(closeButton, findsOneWidget);
            expect(downloadButton, findsOneWidget);

            final closeSize = tester.getSize(closeButton);
            final downloadSize = tester.getSize(downloadButton);
            expect(closeSize.height, downloadSize.height);
            expect(closeSize.width, downloadSize.width);
        });
    }
}
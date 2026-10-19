import 'package:driver_app/src/app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('DriverTrackingApp restores session before login', (
    tester,
  ) async {
    await tester.pumpWidget(const DriverTrackingApp());
    await tester.pump();

    expect(find.text('Memulihkan sesi driver...'), findsOneWidget);
    expect(find.byIcon(Icons.location_off_rounded), findsNothing);

    await tester.pump(const Duration(seconds: 9));
    await tester.pumpAndSettle();

    expect(find.text('PT. Logistik Demo'), findsOneWidget);
    expect(find.text('Masuk'), findsOneWidget);
    expect(find.byIcon(Icons.location_off_rounded), findsNothing);
  });
}

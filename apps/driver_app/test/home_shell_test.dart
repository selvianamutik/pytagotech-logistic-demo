import 'package:driver_app/src/app.dart';
import 'package:driver_app/src/features/tracking/data/tracking_controller.dart';
import 'package:driver_app/src/features/tracking/domain/models.dart';
import 'package:driver_app/src/features/tracking/presentation/shell/home_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Finder shellNavigation() => find.byKey(const Key('home-shell-navigation'));

  Finder destination(String label) =>
      find.descendant(of: shellNavigation(), matching: find.text(label));

  Future<TrackingController> pumpShell(
    WidgetTester tester, {
    Size size = const Size(390, 844),
  }) async {
    tester.view.devicePixelRatio = 1.0;
    tester.view.physicalSize = size;
    addTearDown(tester.view.reset);

    final controller = TrackingController();
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: HomeShell(
          session: const DriverAppSession(
            driverId: 'driver-1',
            driverName: 'Budi',
            email: 'driver@seed.test',
            role: 'DRIVER',
            token: 'token-1',
          ),
          onSessionRefreshed: (_) {},
          onLogout: () {},
          controller: controller,
        ),
      ),
    );
    await tester.pump();
    return controller;
  }

  testWidgets('HomeShell menampilkan tiga tujuan navigasi di ponsel', (
    tester,
  ) async {
    await pumpShell(tester);

    expect(destination('Trip'), findsOneWidget);
    expect(destination('Uang Jalan'), findsOneWidget);
    expect(destination('Akun'), findsOneWidget);
    // Surat Jalan tidak punya menu: status SJ hanya bermakna dalam konteks trip
    // yang dipilih, jadi lewat kartu trip di tab Trip.
    expect(find.text('SJ'), findsNothing);

    final navigationBar = tester.widget<NavigationBar>(shellNavigation());
    expect(navigationBar.destinations, hasLength(3));
    expect(navigationBar.selectedIndex, 0);
  });

  testWidgets('HomeShell berpindah antar tiga tab', (tester) async {
    await pumpShell(tester);

    int selectedIndex() =>
        tester.widget<NavigationBar>(shellNavigation()).selectedIndex;

    await tester.tap(destination('Uang Jalan'));
    await tester.pumpAndSettle();
    expect(selectedIndex(), 1);

    await tester.tap(destination('Akun'));
    await tester.pumpAndSettle();
    expect(selectedIndex(), 2);

    await tester.tap(destination('Trip'));
    await tester.pumpAndSettle();
    expect(selectedIndex(), 0);
  });

  testWidgets('HomeShell memakai rail yang sama di tablet', (tester) async {
    await pumpShell(tester, size: const Size(1024, 1366));

    expect(
      tester.widget<NavigationRail>(shellNavigation()).destinations,
      hasLength(3),
    );
    expect(destination('Uang Jalan'), findsOneWidget);
    expect(find.text('SJ'), findsNothing);

    await tester.tap(destination('Akun'));
    await tester.pumpAndSettle();
    expect(tester.widget<NavigationRail>(shellNavigation()).selectedIndex, 2);
  });

  testWidgets(
    'perubahan trip di controller langsung terlihat di tab Uang Jalan',
    (tester) async {
      final controller = await pumpShell(tester);

      await tester.tap(destination('Uang Jalan'));
      await tester.pumpAndSettle();
      expect(find.textContaining('DO-FIX-0001'), findsNothing);

      // Dashboard yang menulis ke controller; tab lain harus rebuild tanpa fetch.
      controller.syncPortalData(
        trips: [_tripFixture],
        plannedTrips: const [],
        customerProducts: const [],
        customerRecipients: const [],
        driverVouchers: const [],
        driverIncidents: const [],
        selectedTrip: _tripFixture,
      );

      await tester.pump();
      expect(find.textContaining('DO-FIX-0001'), findsWidgets);
    },
  );
  void publish(
    TrackingController controller, {
    required List<DeliveryTrip> trips,
    DeliveryTrip? selectedTrip,
  }) {
    controller.syncPortalData(
      trips: trips,
      plannedTrips: const [],
      customerProducts: const [],
      customerRecipients: const [],
      driverVouchers: const [],
      driverIncidents: const [],
      selectedTrip: selectedTrip,
      loading: false,
      clearError: true,
    );
  }

  testWidgets('tab Trip tidak lagi punya switcher Cek Trip / Uang Jalan', (
    tester,
  ) async {
    await pumpShell(tester);

    expect(find.text('Cek Trip'), findsNothing);
    // Riwayat bon sekarang milik tab Uang Jalan.
    expect(find.text('Lihat Riwayat'), findsNothing);
  });

  testWidgets('kartu driver di tab Trip bukan lagi tautan ke akun', (
    tester,
  ) async {
    await pumpShell(tester);

    expect(find.text('Budi'), findsOneWidget);
    final card = find.ancestor(
      of: find.text('Budi'),
      matching: find.byType(Card),
    );
    // Tanpa InkWell tidak ada lagi affordance "buka akun".
    expect(
      find.descendant(of: card, matching: find.byType(InkWell)),
      findsNothing,
    );
    expect(
      find.descendant(
        of: card,
        matching: find.byIcon(Icons.chevron_right_rounded),
      ),
      findsNothing,
    );
  });

  testWidgets('empty state Uang Jalan mengarahkan balik ke tab Trip', (
    tester,
  ) async {
    final controller = await pumpShell(tester);
    await tester.tap(destination('Uang Jalan'));
    await tester.pumpAndSettle();

    publish(controller, trips: const []);
    await tester.pump();

    expect(find.text('Pilih trip dulu'), findsOneWidget);
    await tester.tap(find.text('Buka Trip'));
    await tester.pumpAndSettle();
    expect(tester.widget<NavigationBar>(shellNavigation()).selectedIndex, 0);
  });

  testWidgets('tab Uang Jalan menampilkan bon dan tombol riwayat', (
    tester,
  ) async {
    final controller = await pumpShell(tester);
    await tester.tap(destination('Uang Jalan'));
    await tester.pumpAndSettle();

    publish(controller, trips: [_tripFixture], selectedTrip: _tripFixture);
    await tester.pump();

    expect(find.textContaining('DO-FIX-0001'), findsWidgets);
    expect(find.text('Lihat Riwayat'), findsOneWidget);
    expect(find.text('Belum ada uang jalan untuk DO-FIX-0001'), findsOneWidget);
  });
}

final _tripFixture = DeliveryTrip(
  deliveryOrderId: 'trip-1',
  doNumber: 'DO-FIX-0001',
  vehiclePlate: 'B 1234 CD',
  originLabel: 'Jakarta',
  destinationLabel: 'Bandung',
  customerName: 'Toko Example',
  status: TripStatus.arrived,
  etdLabel: '08:00',
  statusNote: '',
  allowsDirectCargoInput: false,
);

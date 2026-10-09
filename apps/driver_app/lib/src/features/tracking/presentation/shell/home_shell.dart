import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app.dart';
import '../../data/tracking_controller.dart';
import '../../data/tracking_scope.dart';
import 'pages/account_tab.dart';
import 'pages/trip_tab.dart';
import 'pages/voucher_tab.dart';

/// Tiga tujuan utama aplikasi driver.
///
/// Shell ini menggantikan pola "push halaman penuh": data trip dan bon sekarang
/// dibaca dari satu [TrackingController] sehingga pindah tab tidak memicu fetch
/// ulang dan pilihan driver tidak hilang saat pindah menu.
///
/// Surat Jalan sengaja tidak punya menu sendiri: status SJ hanya bermakna dalam
/// konteks trip yang dipilih, jadi pengaturannya tetap di dalam kartu trip.
class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.session,
    required this.onSessionRefreshed,
    required this.onLogout,
    this.controller,
    this.initialIndex = 0,
  });

  final DriverAppSession session;
  final FutureOr<void> Function(DriverAppSession session) onSessionRefreshed;
  final VoidCallback onLogout;

  /// Hanya untuk widget test; production memakai controller sendiri.
  final TrackingController? controller;

  final int initialIndex;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  late final TrackingController _controller =
      widget.controller ?? TrackingController();
  late final bool _ownsController = widget.controller == null;

  int _index = 0;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _controller.updateSession(widget.session);
  }

  @override
  void didUpdateWidget(HomeShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session.driverId != widget.session.driverId ||
        oldWidget.session.token != widget.session.token) {
      _controller.updateSession(widget.session);
    }
  }

  @override
  void dispose() {
    if (_ownsController) _controller.dispose();
    super.dispose();
  }

  void _select(int index) {
    if (index == _index) return;
    setState(() => _index = index);
  }

  @override
  Widget build(BuildContext context) {
    final destinations = _ShellDestination.values;

    return TrackingScope(
      controller: _controller,
      // `ListenableBuilder` supaya tab yang hanya membaca controller (Uang
      // Jalan, Akun) ikut rebuild saat dashboard memuat data baru. Tanpa ini
      // tombol "Muat ulang" terlihat seperti tidak melakukan apa-apa.
      child: ListenableBuilder(
        listenable: _controller,
        builder: (context, _) {
          final wide = MediaQuery.sizeOf(context).width >= 720;

          final pages = <Widget>[
            TripTab(
              session: widget.session,
              onSessionRefreshed: widget.onSessionRefreshed,
              onLogout: widget.onLogout,
              controller: _controller,
            ),
            VoucherTab(controller: _controller, onOpenTrips: () => _select(0)),
            AccountTab(
              session: widget.session,
              onSessionRefreshed: widget.onSessionRefreshed,
              onLogout: widget.onLogout,
              controller: _controller,
            ),
          ];

          final body = IndexedStack(index: _index, children: pages);

          if (wide) {
            return Scaffold(
              body: Row(
                children: [
                  SafeArea(
                    child: NavigationRail(
                      key: const Key('home-shell-navigation'),
                      selectedIndex: _index,
                      onDestinationSelected: _select,
                      labelType: NavigationRailLabelType.all,
                      leading: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Icon(
                          Icons.local_shipping_rounded,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                      ),
                      destinations: [
                        for (final destination in destinations)
                          NavigationRailDestination(
                            icon: Icon(destination.icon),
                            selectedIcon: Icon(destination.selectedIcon),
                            label: Text(destination.label),
                          ),
                      ],
                    ),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: body),
                ],
              ),
            );
          }

          return Scaffold(
            body: body,
            bottomNavigationBar: NavigationBar(
              key: const Key('home-shell-navigation'),
              selectedIndex: _index,
              onDestinationSelected: _select,
              destinations: [
                for (final destination in destinations)
                  NavigationDestination(
                    icon: Icon(destination.icon),
                    selectedIcon: Icon(destination.selectedIcon),
                    label: destination.label,
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

enum _ShellDestination {
  trips('Trip', Icons.local_shipping_outlined, Icons.local_shipping_rounded),
  vouchers(
    'Uang Jalan',
    Icons.account_balance_wallet_outlined,
    Icons.account_balance_wallet_rounded,
  ),
  account('Akun', Icons.person_outline_rounded, Icons.person_rounded);

  const _ShellDestination(this.label, this.icon, this.selectedIcon);

  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

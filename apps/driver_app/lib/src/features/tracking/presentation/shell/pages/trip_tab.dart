import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../../app.dart';
import '../../../data/tracking_controller.dart';
import '../../tracking_home_page.dart';

/// Tab "Trip" di dalam [HomeShell].
///
/// Isinya masih [TrackingHomePage] (dashboard) yang sudah jadi, tapi sekarang
/// menerima [TrackingController] sehingga hasil load-nya langsung dipakai tab
/// Uang Jalan tanpa fetch ulang.
class TripTab extends StatelessWidget {
  const TripTab({
    super.key,
    required this.session,
    required this.onSessionRefreshed,
    required this.onLogout,
    required this.controller,
  });

  final DriverAppSession session;
  final FutureOr<void> Function(DriverAppSession session) onSessionRefreshed;
  final VoidCallback onLogout;
  final TrackingController controller;

  @override
  Widget build(BuildContext context) {
    return TrackingHomePage(
      session: session,
      onSessionRefreshed: onSessionRefreshed,
      onLogout: onLogout,
      sharedController: controller,
    );
  }
}

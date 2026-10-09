import 'package:flutter/widgets.dart';

import '../data/tracking_controller.dart';

/// Menyediakan [TrackingController] ke seluruh subtree.
///
/// Pakai `InheritedNotifier` bawaan Flutter, bukan `provider` atau
/// `riverpod`, supaya menambah navigasi tidak menambah dependency.
/// Widget yang memanggil [TrackingScope.of] akan rebuild saat data berubah.
class TrackingScope extends InheritedNotifier<TrackingController> {
  const TrackingScope({
    super.key,
    required TrackingController controller,
    required super.child,
  }) : super(notifier: controller);

  static TrackingController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<TrackingScope>();
    assert(scope?.notifier != null, 'TrackingScope tidak ditemukan di tree.');
    return scope!.notifier!;
  }

  /// Versi yang tidak rebuild; `null` kalau halaman dibuka tanpa scope
  /// (hanya terjadi di widget test).
  static TrackingController? maybeOf(BuildContext context) {
    return context.getInheritedWidgetOfExactType<TrackingScope>()?.notifier;
  }

  /// Versi non-rebuild untuk event handler (tombol, callback).
  static TrackingController read(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<TrackingScope>();
    assert(scope?.notifier != null, 'TrackingScope tidak ditemukan di tree.');
    return scope!.notifier!;
  }
}

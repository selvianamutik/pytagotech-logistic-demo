import 'package:flutter/material.dart';

import '../../../../../shared/theme.dart';
import '../../../../../shared/widgets/app_info_card.dart';
import '../../../data/tracking_controller.dart';
import '../../../domain/models.dart';
import '../../voucher_history_page.dart';
import '../../voucher_widgets.dart';

/// Tab "Uang Jalan": semua functionality bon, bukan cuma bon trip terpilih.
///
/// Dulu halaman ini masih memakai switcher "Cek Trip / Uang Jalan" di dalam
/// dashboard. Sekarang switcher itu hilang: navigasi lewat navbar bawah, dan
/// tab ini menjadi satu-satunya tempat untuk melihat bon.
class VoucherTab extends StatelessWidget {
  const VoucherTab({
    super.key,
    required this.controller,
    required this.onOpenTrips,
  });

  final TrackingController controller;

  /// Dipakai tombol di empty state untuk mengarahkan driver ke tab Trip.
  final VoidCallback onOpenTrips;

  Future<void> _openHistory(BuildContext context) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => VoucherHistoryPage(
          initialVouchers: controller.visibleDriverVouchers,
          onRefresh: () async {
            await controller.refresh();
            return controller.visibleDriverVouchers;
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Uang Jalan',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        actions: [
          IconButton(
            tooltip: 'Muat ulang',
            onPressed: controller.loading ? null : () => controller.refresh(),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _VoucherTabBody(
        controller: controller,
        onOpenTrips: onOpenTrips,
        onOpenHistory: () => _openHistory(context),
      ),
      bottomNavigationBar: null,
      backgroundColor: scheme.surface,
    );
  }
}

class _VoucherTabBody extends StatelessWidget {
  const _VoucherTabBody({
    required this.controller,
    required this.onOpenTrips,
    required this.onOpenHistory,
  });

  final TrackingController controller;
  final VoidCallback onOpenTrips;
  final VoidCallback onOpenHistory;

  @override
  Widget build(BuildContext context) {
    final trip = controller.selectedTrip;
    final voucher = controller.selectedTripVoucher;

    // Loading dengan trip terpilih tetap menampilkan skeleton supaya tombol
    // "Lihat Riwayat" tidak ikut berkedip saat pull-to-refresh.
    if (controller.loading) {
      return ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: const [
          VoucherListSkeleton(),
          SizedBox(height: AppSpacing.lg),
          VoucherSkeletonCard(),
        ],
      );
    }

    if (controller.error != null && trip == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: AppMessageBanner(
            icon: Icons.cloud_off_rounded,
            message: controller.error!,
            onRetry: () => controller.refresh(),
          ),
        ),
      );
    }

    if (trip == null) {
      return Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: VoucherPlaceholderCard(
            icon: Icons.touch_app_outlined,
            title: 'Pilih trip dulu',
            message:
                'Uang Jalan ditampilkan untuk trip yang dipilih di tab Trip.',
            actionLabel: 'Buka Trip',
            onAction: onOpenTrips,
          ),
        ),
      );
    }

    final others = controller.visibleDriverVouchers
        .where((item) => item.id != voucher?.id)
        .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        _TripContextCard(trip: trip),
        const SizedBox(height: AppSpacing.md),
        if (voucher == null) ...[
          VoucherPlaceholderCard(
            icon: Icons.account_balance_wallet_outlined,
            title: 'Belum ada uang jalan untuk ${trip.doNumber}',
            message:
                'Bon akan muncul di sini setelah admin menerbitkannya untuk trip ini.',
          ),
          const SizedBox(height: AppSpacing.md),
        ] else ...[
          Text(
            'Bon ${trip.doNumber}',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: AppSpacing.xs),
          DriverVoucherCard(
            voucher: voucher,
            onPreview: () => showDriverVoucherPreviewDialog(context, voucher),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: controller.loading ? null : onOpenHistory,
            icon: const Icon(Icons.history_rounded, size: 18),
            label: const Text('Lihat Riwayat'),
          ),
        ),
        if (others.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          Text(
            'Bon trip lain (${others.length})',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          const SizedBox(height: AppSpacing.xs),
          for (final item in others)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.xs),
              child: DriverVoucherExpandableCard(
                voucher: item,
                onPreview: () => showDriverVoucherPreviewDialog(context, item),
              ),
            ),
        ],
      ],
    );
  }
}

class _TripContextCard extends StatelessWidget {
  const _TripContextCard({required this.trip});

  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.primaryContainer.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Icon(Icons.local_shipping_rounded, color: scheme.primary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  trip.doNumber,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                Text(
                  trip.customerName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: scheme.onSurface.withValues(alpha: 0.65),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

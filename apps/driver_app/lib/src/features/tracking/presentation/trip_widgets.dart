import 'package:flutter/material.dart';

import '../../../shared/theme.dart';
import '../../../shared/widgets/app_skeleton.dart';
import '../domain/models.dart';

Color deliveryStatusColor(String status, ColorScheme scheme) {
  return switch (status.trim().toUpperCase()) {
    'CREATED' => scheme.onSurface.withValues(alpha: 0.55),
    'ON_DELIVERY' => scheme.primary,
    'ARRIVED' => AppColors.warning,
    'PARTIAL_HOLD' => AppColors.warning,
    'DELIVERED' => AppColors.success,
    'CANCELLED' => scheme.error,
    _ => scheme.onSurface.withValues(alpha: 0.68),
  };
}

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    // Warna selalu ditemani label teks: status tidak pernah hanya mengandalkan
    // warna (aturan aksesibilitas "color is not the only indicator").
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.status, this.prefix});

  final TripStatus status;
  final String? prefix;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final apiStatus = deliveryStatusApiValue(status);
    final color = deliveryStatusColor(apiStatus, scheme);
    final statusLabel = deliveryStatusLabel(apiStatus);
    final label = prefix == null ? statusLabel : '$prefix: $statusLabel';
    return StatusPill(label: label, color: color);
  }
}

class SuratJalanStatusChip extends StatelessWidget {
  const SuratJalanStatusChip({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = deliveryStatusColor(status, scheme);
    return StatusPill(label: deliveryStatusLabel(status), color: color);
  }
}

/// Kartu trip untuk daftar trip. Dipakai oleh halaman pilih trip.
///
/// Seluruh kartu adalah satu target sentuh >=48dp dengan ripple Material,
/// bukan GestureDetector polos, supaya ada feedback tekan dan terbaca
/// screen reader sebagai satu tombol.
class TripListCard extends StatelessWidget {
  const TripListCard({
    super.key,
    required this.trip,
    required this.isSelected,
    required this.onTap,
  });

  final DeliveryTrip trip;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.fromLTRB(15, 14, 15, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: isSelected
                  ? scheme.primary.withValues(alpha: 0.55)
                  : scheme.outline,
              width: isSelected ? 1.5 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: AppSpacing.xs,
                runSpacing: AppSpacing.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    trip.doNumber,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                  if (isSelected)
                    ExcludeSemantics(
                      child: Icon(
                        Icons.check_circle_rounded,
                        color: scheme.primary,
                        size: 16,
                      ),
                    ),
                  StatusChip(status: trip.status, prefix: 'Trip'),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '${trip.customerName} | ${trip.vehiclePlate}',
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.6),
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 6),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ExcludeSemantics(
                    child: Icon(
                      Icons.route_rounded,
                      size: 14,
                      color: scheme.onSurface.withValues(alpha: 0.4),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.xxs),
                  Expanded(
                    child: Text(
                      '${trip.originLabel} -> ${trip.destinationLabel}',
                      style: TextStyle(
                        color: scheme.onSurface.withValues(alpha: 0.7),
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Skeleton daftar trip saat dashboard memuat data.
class TripListSkeleton extends StatelessWidget {
  const TripListSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        _TripSkeletonCard(),
        SizedBox(height: 10),
        _TripSkeletonCard(),
        SizedBox(height: 10),
        _TripSkeletonCard(compact: true),
      ],
    );
  }
}

class _TripSkeletonCard extends StatelessWidget {
  const _TripSkeletonCard({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AppSkeletonBlock(width: 44, height: 44, radius: 14),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppSkeletonBlock(width: 170, height: 16, radius: 8),
                      SizedBox(height: 8),
                      AppSkeletonBlock(width: 220, height: 12, radius: 8),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                const AppSkeletonBlock(width: 74, height: 28, radius: 999),
              ],
            ),
            const SizedBox(height: 16),
            const AppSkeletonBlock(
              width: double.infinity,
              height: 12,
              radius: 8,
            ),
            const SizedBox(height: 8),
            AppSkeletonBlock(width: compact ? 180 : 260, height: 12, radius: 8),
          ],
        ),
      ),
    );
  }
}

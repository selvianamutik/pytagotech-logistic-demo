import 'package:flutter/material.dart';

import '../domain/models.dart';

Color deliveryStatusColor(String status, ColorScheme scheme) {
  return switch (status.trim().toUpperCase()) {
    'CREATED' => const Color(0xFF64748B),
    'ON_DELIVERY' => scheme.primary,
    'ARRIVED' => const Color(0xFFB45309),
    'PARTIAL_HOLD' => const Color(0xFFB45309),
    'DELIVERED' => const Color(0xFF15803D),
    'CANCELLED' => const Color(0xFFB91C1C),
    _ => scheme.onSurface.withValues(alpha: 0.68),
  };
}

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
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
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.fromLTRB(15, 14, 15, 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: isSelected
                ? scheme.primary.withValues(alpha: 0.5)
                : const Color(0xFFE2E8E4),
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
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
                  Icon(
                    Icons.check_circle_rounded,
                    color: scheme.primary,
                    size: 16,
                  ),
                StatusChip(status: trip.status, prefix: 'Trip'),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${trip.customerName} | ${trip.vehiclePlate}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.route_rounded,
                  size: 13,
                  color: scheme.onSurface.withValues(alpha: 0.35),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    '${trip.originLabel} -> ${trip.destinationLabel}',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.62),
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
    );
  }
}

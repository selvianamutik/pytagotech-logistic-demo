import 'package:flutter/material.dart';

import '../theme.dart';

/// Panel informasi netral: judul + penjelasan singkat.
///
/// Dipakai untuk memberi konteks tanpa mengalihkan perhatian, misalnya
/// aturan unlock saat menambah SJ atau Closure.
class AppInfoCard extends StatelessWidget {
  const AppInfoCard({
    super.key,
    required this.title,
    required this.message,
    this.icon,
  });

  final String title;
  final String message;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (icon != null) ...[
                Icon(
                  icon,
                  size: 16,
                  color: scheme.onSurface.withValues(alpha: 0.6),
                ),
                const SizedBox(width: AppSpacing.xs),
              ],
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            message,
            style: TextStyle(
              color: scheme.onSurface.withValues(alpha: 0.7),
              fontSize: 13,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

/// Banner error / warning dengan aksi coba lagi.
class AppMessageBanner extends StatelessWidget {
  const AppMessageBanner({
    super.key,
    required this.icon,
    required this.message,
    this.onRetry,
    this.isWarning = false,
  });

  final IconData icon;
  final String message;
  final VoidCallback? onRetry;
  final bool isWarning;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = isWarning ? const Color(0xFFB45309) : scheme.error;
    final background = isWarning
        ? const Color(0xFFFEF3C7)
        : scheme.errorContainer;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: TextStyle(color: color, fontSize: 13)),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: Text(
                'Coba lagi',
                style: TextStyle(color: color, fontSize: 13),
              ),
            ),
        ],
      ),
    );
  }
}

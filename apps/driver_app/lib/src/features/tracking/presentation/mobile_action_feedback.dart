import 'package:flutter/material.dart';

import '../../../shared/theme.dart';

enum MobileFeedbackType { success, info, warning, error }

void showMobileFeedback(
  BuildContext context, {
  required String message,
  MobileFeedbackType type = MobileFeedbackType.info,
  String? title,
  Duration duration = const Duration(seconds: 4),
}) {
  final messenger = ScaffoldMessenger.of(context);
  final theme = Theme.of(context);
  final scheme = theme.colorScheme;
  final config = _mobileFeedbackConfig(scheme, type);
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(
    SnackBar(
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      backgroundColor: Colors.transparent,
      duration: duration,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 18),
      padding: EdgeInsets.zero,
      content: DecoratedBox(
        decoration: BoxDecoration(
          color: config.background,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: config.border),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.14),
              blurRadius: 24,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: config.iconBackground,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(config.icon, color: config.iconColor, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title ?? config.defaultTitle,
                      style: theme.textTheme.labelLarge?.copyWith(
                            color: config.foreground,
                            fontWeight: FontWeight.w800,
                          ) ??
                          TextStyle(
                            color: config.foreground,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      message,
                      style: theme.textTheme.bodySmall?.copyWith(
                            color: config.foreground.withValues(alpha: 0.78),
                            height: 1.35,
                            fontWeight: FontWeight.w600,
                          ) ??
                          TextStyle(
                            color: config.foreground.withValues(alpha: 0.78),
                            height: 1.35,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

_MobileFeedbackConfig _mobileFeedbackConfig(
  ColorScheme scheme,
  MobileFeedbackType type,
) {
  switch (type) {
    case MobileFeedbackType.success:
      const accent = AppColors.success;
      return _MobileFeedbackConfig(
        defaultTitle: 'Berhasil',
        icon: Icons.check_circle_rounded,
        background: Color.alphaBlend(
          accent.withValues(alpha: 0.10),
          scheme.surface,
        ),
        foreground: scheme.onSurface,
        border: accent.withValues(alpha: 0.28),
        iconBackground: accent.withValues(alpha: 0.14),
        iconColor: accent,
      );
    case MobileFeedbackType.warning:
      const accent = AppColors.warning;
      return _MobileFeedbackConfig(
        defaultTitle: 'Perlu dicek',
        icon: Icons.warning_amber_rounded,
        background: Color.alphaBlend(
          accent.withValues(alpha: 0.11),
          scheme.surface,
        ),
        foreground: scheme.onSurface,
        border: accent.withValues(alpha: 0.30),
        iconBackground: accent.withValues(alpha: 0.15),
        iconColor: accent,
      );
    case MobileFeedbackType.error:
      return _MobileFeedbackConfig(
        defaultTitle: 'Gagal',
        icon: Icons.error_rounded,
        background: Color.alphaBlend(
          scheme.error.withValues(alpha: 0.10),
          scheme.surface,
        ),
        foreground: scheme.onSurface,
        border: scheme.error.withValues(alpha: 0.28),
        iconBackground: scheme.error.withValues(alpha: 0.14),
        iconColor: scheme.error,
      );
    case MobileFeedbackType.info:
      return _MobileFeedbackConfig(
        defaultTitle: 'Info',
        icon: Icons.info_rounded,
        background: Color.alphaBlend(
          scheme.primary.withValues(alpha: 0.09),
          scheme.surface,
        ),
        foreground: scheme.onSurface,
        border: scheme.primary.withValues(alpha: 0.22),
        iconBackground: scheme.primary.withValues(alpha: 0.12),
        iconColor: scheme.primary,
      );
  }
}

class _MobileFeedbackConfig {
  const _MobileFeedbackConfig({
    required this.defaultTitle,
    required this.icon,
    required this.background,
    required this.foreground,
    required this.border,
    required this.iconBackground,
    required this.iconColor,
  });

  final String defaultTitle;
  final IconData icon;
  final Color background;
  final Color foreground;
  final Color border;
  final Color iconBackground;
  final Color iconColor;
}

Future<bool> showMobileActionConfirmation(
  BuildContext context, {
  required String title,
  required String message,
  String cancelLabel = 'Batal',
  String confirmLabel = 'Lanjutkan',
  IconData icon = Icons.warning_amber_rounded,
  bool destructive = false,
}) async {
  FocusManager.instance.primaryFocus?.unfocus();
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) {
      final scheme = Theme.of(context).colorScheme;
      final accent = destructive ? scheme.error : scheme.primary;
      final accentContainer = destructive
          ? scheme.errorContainer
          : scheme.primaryContainer;

      return AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
        contentPadding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
        actionsPadding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        title: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: accentContainer,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
        content: Text(message, style: const TextStyle(height: 1.45)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(cancelLabel),
          ),
          FilledButton(
            style: destructive
                ? FilledButton.styleFrom(
                    backgroundColor: scheme.error,
                    foregroundColor: scheme.onError,
                  )
                : null,
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(confirmLabel),
          ),
        ],
      );
    },
  );
  return confirmed == true;
}

class MobileActionOverlay extends StatelessWidget {
  const MobileActionOverlay({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Positioned.fill(
      child: AbsorbPointer(
        child: ColoredBox(
          color: Colors.black.withValues(alpha: 0.32),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: Material(
                color: scheme.surface,
                elevation: 16,
                borderRadius: BorderRadius.circular(18),
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator.adaptive(
                          strokeWidth: 3,
                          valueColor: AlwaysStoppedAnimation(scheme.primary),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Flexible(
                        child: Text(
                          message,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

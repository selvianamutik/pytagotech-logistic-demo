import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../../app.dart';
import '../../../../../shared/theme.dart';
import '../../../../auth/presentation/account_settings_page.dart';
import '../../../data/driver_access_service.dart';
import '../../../data/tracking_controller.dart';

/// Tab "Akun" di dalam [HomeShell].
///
/// Isinya form profil yang sudah ada; logout dipindah ke sini karena tidak
/// lagi ada di app bar dashboard.
class AccountTab extends StatefulWidget {
  const AccountTab({
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
  State<AccountTab> createState() => _AccountTabState();
}

class _AccountTabState extends State<AccountTab> {
  /// Muat ulang sesi supaya nama akun baru langsung tampil di app bar.
  Future<void> _refreshSession() async {
    final token = widget.session.token;
    if (token == null || token.isEmpty) return;
    try {
      final refreshed = await DriverAccessService().fetchCurrentSession(
        sessionToken: token,
      );
      await widget.onSessionRefreshed(
        refreshed.copyWith(refreshToken: widget.session.refreshToken),
      );
    } catch (_) {
      // Nama tetap tersimpan di server; gagangnya hanya tampilan lokal.
    }
  }

  Future<void> _confirmLogout() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Keluar dari aplikasi?'),
        content: const Text(
          'Sesi driver di perangkat ini akan dihapus. Kamu perlu login ulang '
          'untuk lanjut.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Keluar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    widget.controller.updateSession(null);
    widget.onLogout();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Akun Saya',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: AccountSettingsPage(
        session: widget.session,
        embedded: true,
        onNameSaved: _refreshSession,
        footer: SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: _confirmLogout,
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: const Text('Keluar'),
            style: OutlinedButton.styleFrom(
              foregroundColor: Theme.of(context).colorScheme.error,
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            ),
          ),
        ),
      ),
    );
  }
}

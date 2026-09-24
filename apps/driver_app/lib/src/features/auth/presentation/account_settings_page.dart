import 'package:flutter/material.dart';

import '../../../app.dart';
import '../data/driver_account_service.dart';
import '../data/driver_auth_service.dart';
import '../../tracking/presentation/mobile_action_feedback.dart';

class AccountSettingsPage extends StatefulWidget {
  const AccountSettingsPage({super.key, required this.session});

  final DriverAppSession session;

  @override
  State<AccountSettingsPage> createState() => _AccountSettingsPageState();
}

class _AccountSettingsPageState extends State<AccountSettingsPage> {
  final DriverAccountService _accountService = DriverAccountService();
  final _nameController = TextEditingController();
  final _currentPasswordController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _obscureCurrentPassword = true;
  bool _obscureNewPassword = true;
  bool _obscureConfirmPassword = true;
  bool _savingName = false;
  bool _savingPassword = false;
  String? _nameError;
  String? _passwordError;

  @override
  void initState() {
    super.initState();
    final initialName = widget.session.accountName.trim().isNotEmpty
        ? widget.session.accountName.trim()
        : widget.session.driverName.trim();
    _nameController.text = initialName;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _currentPasswordController.dispose();
    _newPasswordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _showSuccess(String message) {
    showMobileFeedback(context, type: MobileFeedbackType.success, message: message);
  }

  Future<void> _saveName() async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      setState(() => _nameError = 'Sesi tidak valid. Silakan login ulang.');
      return;
    }
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      setState(() => _nameError = 'Nama wajib diisi.');
      return;
    }
    if (name.length > 100) {
      setState(() => _nameError = 'Nama maksimal 100 karakter.');
      return;
    }

    setState(() {
      _savingName = true;
      _nameError = null;
    });
    try {
      await _accountService.updateAccountName(
        sessionToken: sessionToken,
        name: name,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on DriverAuthException catch (err) {
      if (!mounted) return;
      setState(() => _nameError = err.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _nameError = 'Tidak bisa terhubung ke server.');
    } finally {
      if (mounted) setState(() => _savingName = false);
    }
  }

  Future<void> _changePassword() async {
    final sessionToken = widget.session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      setState(() => _passwordError = 'Sesi tidak valid. Silakan login ulang.');
      return;
    }
    final currentPassword = _currentPasswordController.text;
    final newPassword = _newPasswordController.text;
    final confirmPassword = _confirmPasswordController.text;

    if (currentPassword.isEmpty || newPassword.isEmpty || confirmPassword.isEmpty) {
      setState(() => _passwordError = 'Semua kolom password wajib diisi.');
      return;
    }
    if (newPassword.length < 8) {
      setState(() => _passwordError = 'Password baru minimal 8 karakter.');
      return;
    }
    if (newPassword != confirmPassword) {
      setState(() => _passwordError = 'Konfirmasi password tidak sama.');
      return;
    }
    if (newPassword == currentPassword) {
      setState(
        () => _passwordError = 'Password baru harus berbeda dari password lama.',
      );
      return;
    }

    setState(() {
      _savingPassword = true;
      _passwordError = null;
    });
    try {
      await _accountService.changePassword(
        sessionToken: sessionToken,
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      if (!mounted) return;
      _currentPasswordController.clear();
      _newPasswordController.clear();
      _confirmPasswordController.clear();
      _showSuccess('Password berhasil diubah.');
    } on DriverAuthException catch (err) {
      if (!mounted) return;
      setState(() => _passwordError = err.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _passwordError = 'Tidak bisa terhubung ke server.');
    } finally {
      if (mounted) setState(() => _savingPassword = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Akun Saya')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SectionCard(
                title: 'Profil',
                icon: Icons.person_outline_rounded,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _FieldLabel(label: 'Nama Akun'),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _nameController,
                      textCapitalization: TextCapitalization.words,
                      textInputAction: TextInputAction.done,
                      maxLength: 100,
                      buildCounter:
                          (
                            context, {
                            required currentLength,
                            required isFocused,
                            maxLength,
                          }) => null,
                      decoration: const InputDecoration(
                        hintText: 'Nama akun login',
                        prefixIcon: Icon(Icons.badge_outlined),
                      ),
                      onSubmitted: (_) {
                        if (!_savingName) _saveName();
                      },
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Nama ini dipakai sebagai identitas akun login. Nama pada data supir dikelola oleh admin.',
                      style: TextStyle(
                        color: scheme.onSurface.withValues(alpha: 0.55),
                        fontSize: 12,
                        height: 1.4,
                      ),
                    ),
                    if (_nameError != null) ...[
                      const SizedBox(height: 10),
                      _InlineError(message: _nameError!),
                    ],
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _savingName ? null : _saveName,
                        icon: _savingName
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator.adaptive(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.save_outlined, size: 17),
                        label: Text(_savingName ? 'Menyimpan...' : 'Simpan Nama'),
                      ),
                    ),
                    const SizedBox(height: 18),
                    _ReadOnlyRow(
                      icon: Icons.alternate_email_rounded,
                      label: 'Email',
                      value: widget.session.email,
                    ),
                    const SizedBox(height: 10),
                    _ReadOnlyRow(
                      icon: Icons.local_shipping_outlined,
                      label: 'Nama Supir (data master)',
                      value: widget.session.driverName,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              _SectionCard(
                title: 'Ubah Password',
                icon: Icons.lock_outline_rounded,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _PasswordField(
                      label: 'Password Lama',
                      controller: _currentPasswordController,
                      obscureText: _obscureCurrentPassword,
                      onToggleVisibility:
                          () => setState(
                            () => _obscureCurrentPassword =
                                !_obscureCurrentPassword,
                          ),
                    ),
                    const SizedBox(height: 14),
                    _PasswordField(
                      label: 'Password Baru',
                      controller: _newPasswordController,
                      obscureText: _obscureNewPassword,
                      hint: 'Minimal 8 karakter',
                      onToggleVisibility:
                          () => setState(
                            () =>
                                _obscureNewPassword = !_obscureNewPassword,
                          ),
                    ),
                    const SizedBox(height: 14),
                    _PasswordField(
                      label: 'Konfirmasi Password Baru',
                      controller: _confirmPasswordController,
                      obscureText: _obscureConfirmPassword,
                      onToggleVisibility:
                          () => setState(
                            () =>
                                _obscureConfirmPassword =
                                    !_obscureConfirmPassword,
                          ),
                    ),
                    if (_passwordError != null) ...[
                      const SizedBox(height: 10),
                      _InlineError(message: _passwordError!),
                    ],
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _savingPassword ? null : _changePassword,
                        icon: _savingPassword
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator.adaptive(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.key_rounded, size: 17),
                        label: Text(
                          _savingPassword ? 'Menyimpan...' : 'Ubah Password',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.title,
    required this.icon,
    required this.child,
  });

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: Icon(icon, color: scheme.primary, size: 18),
                ),
                const SizedBox(width: 10),
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: TextStyle(
        color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.58),
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}

class _PasswordField extends StatelessWidget {
  const _PasswordField({
    required this.label,
    required this.controller,
    required this.obscureText,
    required this.onToggleVisibility,
    this.hint,
  });

  final String label;
  final TextEditingController controller;
  final bool obscureText;
  final VoidCallback onToggleVisibility;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FieldLabel(label: label),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          obscureText: obscureText,
          textInputAction: TextInputAction.next,
          decoration: InputDecoration(
            hintText: hint ?? 'Masukkan password',
            prefixIcon: Icon(
              Icons.lock_outline_rounded,
              size: 18,
              color: scheme.onSurface.withValues(alpha: 0.35),
            ),
            suffixIcon: GestureDetector(
              onTap: onToggleVisibility,
              child: Icon(
                obscureText
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: 18,
                color: scheme.onSurface.withValues(alpha: 0.35),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ReadOnlyRow extends StatelessWidget {
  const _ReadOnlyRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, size: 17, color: scheme.onSurface.withValues(alpha: 0.45)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: scheme.onSurface.withValues(alpha: 0.5),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value.isEmpty ? '-' : value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.lock_rounded,
            size: 13,
            color: scheme.onSurface.withValues(alpha: 0.3),
          ),
        ],
      ),
    );
  }
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline_rounded, color: scheme.error, size: 15),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: scheme.error,
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';

import '../../../app.dart';
import '../../../shared/branding.dart';
import '../../../shared/widgets/app_info_card.dart';
import '../data/driver_auth_service.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.onLogin});

  final FutureOr<void> Function(DriverAppSession session) onLogin;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final DriverAuthService _authService = DriverAuthService();
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _submitting = false;
  bool _obscurePassword = true;
  String? _errorMessage;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _errorMessage = null;
    });
    try {
      final session = await _authService.login(
        email: _emailController.text.trim(),
        password: _passwordController.text,
      );
      if (!mounted) return;
      await widget.onLogin(session);
    } on DriverAuthException catch (err) {
      if (!mounted) return;
      setState(() => _errorMessage = err.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _errorMessage = 'Tidak bisa terhubung ke server login');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final size = MediaQuery.sizeOf(context);
    final compact = size.width <= 390 || size.height < 760;
    final veryCompact = size.height < 680;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 20 : 24,
              vertical: veryCompact ? 18 : (compact ? 22 : 32),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: veryCompact ? 64 : (compact ? 72 : 82),
                    height: veryCompact ? 46 : (compact ? 50 : 56),
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: scheme.outlineVariant.withValues(alpha: 0.5),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.08),
                          blurRadius: 16,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Image.asset(
                      gmsLogoAsset,
                      fit: BoxFit.contain,
                        semanticLabel: 'Logo PT. Logistik Demo',
                      errorBuilder: (context, error, stackTrace) => Icon(
                        Icons.local_shipping_rounded,
                        color: scheme.primary,
                        size: 26,
                      ),
                    ),
                  ),
                  SizedBox(height: veryCompact ? 16 : (compact ? 20 : 24)),
                  Text(
                    gmsCompanyName,
                    style: TextStyle(
                      color: scheme.onSurface,
                      fontSize: veryCompact ? 24 : (compact ? 26 : 30),
                      fontWeight: FontWeight.w800,
                      height: 1.1,
                    ),
                  ),
                  SizedBox(height: veryCompact ? 6 : 8),
                  Text(
                    'Aplikasi driver untuk cek trip, uang jalan, dan kirim lokasi.',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.56),
                      fontSize: 14,
                      height: 1.45,
                    ),
                  ),
                  SizedBox(height: veryCompact ? 20 : (compact ? 26 : 34)),
                  AutofillGroup(
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const _FieldLabel(label: 'Email'),
                          const SizedBox(height: 8),
                          TextFormField(
                            controller: _emailController,
                            autocorrect: false,
                            enableSuggestions: false,
                            autofillHints: const [
                              AutofillHints.username,
                              AutofillHints.email,
                            ],
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            decoration: InputDecoration(
                              hintText: 'driver@perusahaan.com',
                              prefixIcon: ExcludeSemantics(
                                child: Icon(
                                  Icons.alternate_email_rounded,
                                  size: 20,
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.4,
                                  ),
                                ),
                              ),
                            ),
                            validator: (value) {
                              final text = value?.trim() ?? '';
                              if (text.isEmpty || !text.contains('@')) {
                                return 'Masukkan email yang valid';
                              }
                              return null;
                            },
                          ),
                          SizedBox(height: veryCompact ? 14 : 16),
                          const _FieldLabel(label: 'Password'),
                          const SizedBox(height: 8),
                          TextFormField(
                            controller: _passwordController,
                            autofillHints: const [AutofillHints.password],
                            obscureText: _obscurePassword,
                            textInputAction: TextInputAction.done,
                            decoration: InputDecoration(
                              hintText: 'Masukkan password',
                              prefixIcon: ExcludeSemantics(
                                child: Icon(
                                  Icons.lock_outline_rounded,
                                  size: 20,
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.4,
                                  ),
                                ),
                              ),
                              // IconButton (bukan GestureDetector) supaya area
                              // sentuh 48dp, ada ripple, dan terbaca screen
                              // reader dengan label yang jelas.
                              suffixIcon: IconButton(
                                tooltip: _obscurePassword
                                    ? 'Tampilkan password'
                                    : 'Sembunyikan password',
                                onPressed: () => setState(
                                  () => _obscurePassword = !_obscurePassword,
                                ),
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                  size: 20,
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.55,
                                  ),
                                ),
                              ),
                            ),
                            validator: (value) {
                              if ((value ?? '').length < 6) {
                                return 'Password minimal 6 karakter';
                              }
                              return null;
                            },
                            onFieldSubmitted: (_) {
                              if (!_submitting) {
                                _submit();
                              }
                            },
                          ),
                          if (_errorMessage != null) ...[
                            const SizedBox(height: 14),
                            AppMessageBanner(
                              icon: Icons.error_outline_rounded,
                              message: _errorMessage!,
                            ),
                          ],
                          SizedBox(height: veryCompact ? 18 : 24),
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton(
                              onPressed: _submitting ? null : _submit,
                              child: _submitting
                                  ? SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator.adaptive(
                                        strokeWidth: 2,
                                        valueColor: AlwaysStoppedAnimation(
                                          scheme.onPrimary,
                                        ),
                                      ),
                                    )
                                  : const Text(
                                      'Masuk',
                                      style: TextStyle(
                                        fontSize: 15,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
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

import 'dart:async';

import 'package:flutter/material.dart';

import 'features/auth/data/driver_session_store.dart';
import 'features/auth/presentation/login_page.dart';
import 'features/tracking/data/driver_access_service.dart';
import 'features/tracking/presentation/tracking_home_page.dart';
import 'shared/branding.dart';
import 'shared/theme.dart';

class DriverTrackingApp extends StatefulWidget {
  const DriverTrackingApp({super.key});

  @override
  State<DriverTrackingApp> createState() => _DriverTrackingAppState();
}

class _DriverTrackingAppState extends State<DriverTrackingApp> {
  final DriverSessionStore _sessionStore = DriverSessionStore();
  final DriverAccessService _accessService = DriverAccessService();

  DriverAppSession? _session;
  bool _restoringSession = true;

  @override
  void initState() {
    super.initState();
    unawaited(_restoreCachedSession());
  }

  Future<void> _handleLogin(DriverAppSession session) async {
    await _sessionStore.save(session).timeout(const Duration(seconds: 8));
    if (!mounted) return;
    setState(() {
      _session = session;
    });
  }

  void _handleLogout() {
    unawaited(_sessionStore.clear());
    setState(() {
      _session = null;
    });
  }

  Future<void> _handleSessionRefreshed(DriverAppSession session) async {
    await _sessionStore.save(session).timeout(const Duration(seconds: 8));
    if (!mounted) return;
    setState(() {
      _session = session;
    });
  }

  Future<void> _restoreCachedSession() async {
    DriverAppSession? cachedSession;
    try {
      cachedSession = await _sessionStore.load().timeout(
        const Duration(seconds: 8),
      );
    } catch (_) {
      cachedSession = null;
    }
    if (!mounted) return;

    if (cachedSession == null ||
        ((cachedSession.token ?? '').isEmpty &&
            (cachedSession.refreshToken ?? '').isEmpty)) {
      setState(() => _restoringSession = false);
      return;
    }

    try {
      final refreshedSession = (cachedSession.token ?? '').isNotEmpty
          ? await _accessService
                .fetchCurrentSession(sessionToken: cachedSession.token!)
                .then(
                  (session) => session.copyWith(
                    refreshToken: cachedSession!.refreshToken,
                  ),
                )
          : await _accessService.refreshSession(
              refreshToken: cachedSession.refreshToken!,
            );
      await _sessionStore.save(refreshedSession);
      if (!mounted) return;
      setState(() {
        _session = refreshedSession;
        _restoringSession = false;
      });
    } on DriverAccessException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        final refreshToken = cachedSession.refreshToken;
        if (refreshToken != null && refreshToken.isNotEmpty) {
          try {
            final refreshedSession = await _accessService.refreshSession(
              refreshToken: refreshToken,
            );
            await _sessionStore.save(refreshedSession);
            if (!mounted) return;
            setState(() {
              _session = refreshedSession;
              _restoringSession = false;
            });
            return;
          } catch (_) {
            // Fall through to clearing the invalid cached session.
          }
        }
        await _sessionStore.clear();
        if (!mounted) return;
        setState(() {
          _session = null;
          _restoringSession = false;
        });
        return;
      }
      setState(() {
        _session = cachedSession;
        _restoringSession = false;
      });
    } catch (_) {
      setState(() {
        _session = cachedSession;
        _restoringSession = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: gmsDriverAppTitle,
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: _restoringSession
          ? const _DriverSessionRestorePage()
          : _session == null
          ? LoginPage(onLogin: _handleLogin)
          : TrackingHomePage(
              session: _session!,
              onSessionRefreshed: _handleSessionRefreshed,
              onLogout: _handleLogout,
            ),
    );
  }
}

class _DriverSessionRestorePage extends StatelessWidget {
  const _DriverSessionRestorePage();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 34,
              height: 34,
              child: CircularProgressIndicator.adaptive(
                valueColor: AlwaysStoppedAnimation(scheme.primary),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Memulihkan sesi driver...',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.74),
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class DriverAppSession {
  const DriverAppSession({
    required this.driverId,
    required this.driverName,
    required this.email,
    required this.role,
    this.accountName = '',
    this.driverRef,
    this.token,
    this.refreshToken,
    this.accessNotice,
  });

  final String driverId;
  final String driverName;

  /// Nama akun login (app_users.name). Bisa diubah driver sendiri.
  final String accountName;
  final String email;
  final String role;
  final String? driverRef;
  final String? token;
  final String? refreshToken;
  final DriverAccessNotice? accessNotice;

  Map<String, dynamic> toJson() => {
    'driverId': driverId,
    'driverName': driverName,
    'accountName': accountName,
    'email': email,
    'role': role,
    'driverRef': driverRef,
    'token': token,
    'refreshToken': refreshToken,
    'accessNotice': accessNotice?.toJson(),
  };

  factory DriverAppSession.fromJson(Map<String, dynamic> json) {
    final token = json['token']?.toString();
    final refreshToken = json['refreshToken']?.toString();
    return DriverAppSession(
      driverId: json['driverId']?.toString() ?? json['_id']?.toString() ?? '',
      driverName:
          json['driverName']?.toString() ?? json['name']?.toString() ?? '',
      accountName: json['accountName']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      role: json['role']?.toString() ?? 'DRIVER',
      driverRef: json['driverRef']?.toString(),
      token: token,
      refreshToken: refreshToken,
      accessNotice: parseDriverAccessNotice(json['accessNotice']),
    );
  }

  static DriverAppSession fromApiUserJson(
    Map<String, dynamic> user, {
    required String token,
    String? refreshToken,
    DriverAccessNotice? accessNotice,
  }) {
    return DriverAppSession(
      driverId: user['_id']?.toString() ?? user['driverId']?.toString() ?? '',
      driverName:
          user['driverName']?.toString() ?? user['name']?.toString() ?? '',
      accountName: user['name']?.toString() ?? '',
      email: user['email']?.toString() ?? '',
      role: user['role']?.toString() ?? 'DRIVER',
      driverRef: user['driverRef']?.toString(),
      token: token,
      refreshToken: refreshToken,
      accessNotice: accessNotice,
    );
  }

  DriverAppSession copyWith({
    String? token,
    String? refreshToken,
    String? accountName,
    DriverAccessNotice? accessNotice,
  }) {
    return DriverAppSession(
      driverId: driverId,
      driverName: driverName,
      accountName: accountName ?? this.accountName,
      email: email,
      role: role,
      driverRef: driverRef,
      token: token ?? this.token,
      refreshToken: refreshToken ?? this.refreshToken,
      accessNotice: accessNotice ?? this.accessNotice,
    );
  }
}

class DriverAccessNotice {
  const DriverAccessNotice({
    required this.scoreId,
    required this.scoreType,
    required this.title,
    required this.message,
    required this.blocking,
    required this.effectiveDate,
    required this.dueDate,
    required this.durationDays,
    this.notes,
    this.warningAcknowledgedAt,
  });

  final String scoreId;
  final String scoreType;
  final String title;
  final String message;
  final bool blocking;
  final String effectiveDate;
  final String dueDate;
  final int durationDays;
  final String? notes;
  final String? warningAcknowledgedAt;

  bool get isWarning => scoreType == 'WARNING';

  Map<String, dynamic> toJson() => {
    'scoreId': scoreId,
    'scoreType': scoreType,
    'title': title,
    'message': message,
    'blocking': blocking,
    'effectiveDate': effectiveDate,
    'dueDate': dueDate,
    'durationDays': durationDays,
    'notes': notes,
    'warningAcknowledgedAt': warningAcknowledgedAt,
  };
}

DriverAccessNotice? parseDriverAccessNotice(dynamic value) {
  final json = value is Map<String, dynamic> ? value : null;
  if (json == null) {
    return null;
  }
  final scoreId = json['scoreId']?.toString();
  final scoreType = json['scoreType']?.toString();
  final title = json['title']?.toString();
  final message = json['message']?.toString();
  final effectiveDate = json['effectiveDate']?.toString() ?? '';
  final dueDate = json['dueDate']?.toString() ?? '';
  final durationDays = json['durationDays'] is num
      ? (json['durationDays'] as num).toInt()
      : 0;

  if (scoreId == null ||
      scoreType == null ||
      title == null ||
      message == null) {
    return null;
  }

  return DriverAccessNotice(
    scoreId: scoreId,
    scoreType: scoreType,
    title: title,
    message: message,
    blocking: json['blocking'] == true,
    effectiveDate: effectiveDate,
    dueDate: dueDate,
    durationDays: durationDays,
    notes: json['notes']?.toString(),
    warningAcknowledgedAt: json['warningAcknowledgedAt']?.toString(),
  );
}

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../../../app.dart';
import '../../../shared/branding.dart';
import '../../auth/presentation/account_settings_page.dart';
import '../data/driver_access_service.dart';
import '../data/delivery_order_service.dart';
import '../data/driver_tracking_service.dart';
import '../domain/models.dart';
import 'delivery_completion_page.dart';
import 'delivery_manifest_page.dart';
import 'mobile_action_feedback.dart';
import 'mobile_numeric_input_formatter.dart';

enum _DriverHomeSection { trips, vouchers }

class TrackingHomePage extends StatefulWidget {
  const TrackingHomePage({
    super.key,
    required this.session,
    required this.onSessionRefreshed,
    required this.onLogout,
  });

  final DriverAppSession session;
  final FutureOr<void> Function(DriverAppSession session) onSessionRefreshed;
  final VoidCallback onLogout;

  @override
  State<TrackingHomePage> createState() => _TrackingHomePageState();
}

class _TrackingHomePageState extends State<TrackingHomePage>
    with WidgetsBindingObserver {
  static const Duration _autoTrackingInterval = Duration(minutes: 15);

  final DeliveryOrderService _deliveryOrderService = DeliveryOrderService();
  final DriverAccessService _driverAccessService = DriverAccessService();
  DriverTrackingService? _trackingService;
  DriverAppSession? _activeSession;

  List<DeliveryTrip> _trips = const [];
  List<DriverAssignedTripPlan> _plannedTrips = const [];
  List<CustomerProductOption> _customerProducts = const [];
  List<CustomerRecipientOption> _customerRecipients = const [];
  List<DriverTripVoucher> _driverVouchers = const [];
  List<DriverIncident> _driverIncidents = const [];
  final Set<String> _createdShipperReferenceStatusOverrides = <String>{};
  _DriverHomeSection _activeSection = _DriverHomeSection.trips;
  DeliveryTrip? _selectedTrip;
  DeliveryTrip? _activeTrip;
  LocationSnapshot? _latestLocation;

  bool _trackingEnabled = false;
  bool _loadingTrips = true;
  bool _updatingStatus = false;
  bool _updatingBatchStatus = false;
  bool _submittingManifest = false;
  bool _acknowledgingWarning = false;
  bool _reportingIncident = false;
  bool _submittingIncidentResolution = false;
  String? _loadError;
  String? _locationError;
  String? _pingError;
  int _pingCount = 0;
  DriverAccessNotice? _accessNotice;

  Timer? _pingCounterTimer;
  Timer? _noticePollTimer;
  String? _trackingDeliveryOrderId;
  DriverAppSession get _session => _activeSession ?? widget.session;

  List<DriverTripVoucher> get _visibleDriverVouchers {
    final vouchers = <DriverTripVoucher>[];
    final seenKeys = <String>{};
    for (final voucher in _driverVouchers) {
      final key = voucher.id.trim().isNotEmpty ? voucher.id : voucher.bonNumber;
      if (seenKeys.add(key)) {
        vouchers.add(voucher);
      }
    }
    return vouchers;
  }

  void _showSuccess(String message) {
    showMobileFeedback(
      context,
      type: MobileFeedbackType.success,
      message: message,
    );
  }

  void _showInfo(String message) {
    showMobileFeedback(
      context,
      type: MobileFeedbackType.info,
      message: message,
    );
  }

  void _showWarning(String message) {
    showMobileFeedback(
      context,
      type: MobileFeedbackType.warning,
      message: message,
    );
  }

  void _showError(String message) {
    showMobileFeedback(
      context,
      type: MobileFeedbackType.error,
      message: message,
    );
  }

  Future<DriverAppSession?> _refreshDriverSession() async {
    final refreshToken = _session.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      return null;
    }

    try {
      final refreshedSession = await _driverAccessService.refreshSession(
        refreshToken: refreshToken,
      );
      if (!mounted) return null;
      final shouldRestartTracking =
          (_trackingService?.isRunning ?? false) &&
          _activeTrip != null &&
          _trackingEnabled;
      _trackingService?.stop();
      setState(() {
        _activeSession = refreshedSession;
        _accessNotice = refreshedSession.accessNotice;
        _trackingService = DriverTrackingService(
          sessionToken: refreshedSession.token ?? '',
        );
      });
      await widget.onSessionRefreshed(refreshedSession);
      if (shouldRestartTracking) {
        _startTracking(initialAction: 'heartbeat');
      }
      return refreshedSession;
    } catch (_) {
      return null;
    }
  }

  Future<T> _withFreshSession<T>(
    Future<T> Function(String sessionToken) action,
  ) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      throw const DeliveryOrderException(
        'Sesi driver tidak valid. Silakan login ulang.',
        401,
      );
    }

    try {
      return await action(sessionToken);
    } on DeliveryOrderException catch (error) {
      if (error.statusCode != 401) rethrow;
      final refreshed = await _refreshDriverSession();
      final refreshedToken = refreshed?.token;
      if (refreshedToken == null || refreshedToken.isEmpty) rethrow;
      return action(refreshedToken);
    }
  }

  @override
  void initState() {
    super.initState();
    _activeSession = widget.session;
    _accessNotice = _session.accessNotice;
    _trackingService = DriverTrackingService(
      sessionToken: _session.token ?? '',
    );
    unawaited(_bootstrapPage());
    WidgetsBinding.instance.addObserver(this);
    _noticePollTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted && _session.token != null) {
        unawaited(_silentNoticeCheck());
      }
    });
  }

  @override
  void didUpdateWidget(covariant TrackingHomePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.session.token != widget.session.token ||
        oldWidget.session.refreshToken != widget.session.refreshToken) {
      final shouldRestartTracking =
          (_trackingService?.isRunning ?? false) &&
          _activeTrip != null &&
          _trackingEnabled;
      _trackingService?.stop();
      _activeSession = widget.session;
      _trackingService = DriverTrackingService(
        sessionToken: _session.token ?? '',
      );
      if (shouldRestartTracking) {
        _startTracking(initialAction: 'heartbeat');
      }
    }
  }

  Future<void> _silentNoticeCheck() async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) return;

    try {
      final notice = await _driverAccessService.fetchCurrentAccessNotice(
        sessionToken: sessionToken,
      );
      if (!mounted) return;

      if (notice == null) {
        if (_accessNotice != null) {
          setState(() => _accessNotice = null);
        }
      } else if (_isNoticeBlocking(notice)) {
        if (_accessNotice?.scoreId != notice.scoreId ||
            !_isNoticeBlocking(_accessNotice)) {
          setState(() {
            _accessNotice = notice;
            _loadingTrips = false;
          });
        }
      } else {
        if (_accessNotice?.scoreId != notice.scoreId ||
            _accessNotice?.warningAcknowledgedAt !=
                notice.warningAcknowledgedAt) {
          setState(() => _accessNotice = notice);
        }
      }
    } catch (_) {
      // Background poll swallows errors safely
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (!_loadingTrips) {
        unawaited(_bootstrapPage());
      }
    }
  }

  bool _isNoticeBlocking(DriverAccessNotice? notice) {
    final isBlocking =
        notice != null &&
        (notice.blocking ||
            (notice.isWarning &&
                (notice.warningAcknowledgedAt == null ||
                    notice.warningAcknowledgedAt!.isEmpty)));
    return isBlocking;
  }

  Future<void> _bootstrapPage() async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = 'Sesi driver tidak valid. Silakan login ulang.';
      });
      return;
    }

    try {
      final notice = await _driverAccessService.fetchCurrentAccessNotice(
        sessionToken: sessionToken,
      );
      if (!mounted) return;
      if (_isNoticeBlocking(notice)) {
        setState(() {
          _accessNotice = notice;
          _loadingTrips = false;
          _loadError = null;
        });
        return;
      }
      setState(() => _accessNotice = notice);
      await _loadTrips(skipAccessRefresh: true);
    } on DriverAccessException catch (err) {
      if (!mounted) return;
      // Server explicitly rejected access — surface the error.
      // Keep any session-level blocking notice visible.
      if (_isNoticeBlocking(_accessNotice)) {
        setState(() => _loadingTrips = false);
      } else {
        setState(() {
          _loadingTrips = false;
          _loadError = err.message;
        });
      }
    } catch (_) {
      // Network / parse errors — do not swallow silently.
      if (!mounted) return;
      if (_isNoticeBlocking(_accessNotice)) {
        // Session has a blocking notice — keep showing it, stop spinner.
        setState(() => _loadingTrips = false);
      } else {
        setState(() {
          _loadingTrips = false;
          _loadError =
              'Gagal terhubung ke server. Tarik ke bawah untuk refresh.';
        });
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _noticePollTimer?.cancel();
    _pingCounterTimer?.cancel();
    _trackingService?.stop();
    super.dispose();
  }

  // ── Trips ──────────────────────────────────────────────────

  Future<void> _loadTrips({bool skipAccessRefresh = false}) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      setState(() {
        _loadingTrips = false;
        _loadError = 'Sesi driver tidak valid. Silakan login ulang.';
      });
      return;
    }

    if (!skipAccessRefresh) {
      try {
        final notice = await _driverAccessService.fetchCurrentAccessNotice(
          sessionToken: sessionToken,
        );
        if (!mounted) return;
        if (_isNoticeBlocking(notice)) {
          setState(() {
            _accessNotice = notice;
            _loadingTrips = false;
            _loadError = null;
          });
          return;
        }
        setState(() => _accessNotice = notice);
      } on DriverAccessException catch (err) {
        if (!mounted) return;
        setState(() {
          _loadingTrips = false;
          _loadError = err.message;
        });
        return;
      }
    }

    setState(() {
      _loadingTrips = true;
      _loadError = null;
    });
    try {
      final portalData = await _deliveryOrderService.fetchDriverPortalData(
        sessionToken: sessionToken,
      );
      var incidents = const <DriverIncident>[];
      try {
        incidents = await _deliveryOrderService.fetchDriverIncidents(
          sessionToken: sessionToken,
        );
      } catch (_) {
        // Incident status is supplementary; do not block the driver's trip list
        // if this lightweight refresh fails.
      }
      final trips = _applyCreatedShipperReferenceStatusOverrides(
        portalData.trips,
      );
      if (!mounted) return;
      final activeId = _trackingDeliveryOrderId ?? _activeTrip?.deliveryOrderId;
      final selectedId = _selectedTrip?.deliveryOrderId;
      final nextActiveTrip = _selectAutoTrackingTrip(trips, activeId);
      setState(() {
        _trips = trips;
        _plannedTrips = portalData.plannedTrips;
        _customerProducts = portalData.customerProducts;
        _customerRecipients = portalData.customerRecipients;
        _driverVouchers = portalData.driverVouchers;
        _driverIncidents = incidents;
        // DO NOT clear _accessNotice here. It should only be cleared by
        // explicit server response (notice = null) or after acknowledgement.
        // The previous code was wiping warnings incorrectly.
        _activeTrip = nextActiveTrip;
        _selectedTrip =
            (selectedId != null
                ? trips.firstWhereOrNull((t) => t.deliveryOrderId == selectedId)
                : null) ??
            _activeTrip ??
            (trips.isNotEmpty ? trips.first : null);
        _loadingTrips = false;
      });
      unawaited(_syncAutoTracking(nextActiveTrip));
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = err.message;
        if (err.statusCode == 403) {
          _accessNotice = DriverAccessNotice(
            scoreId: '',
            scoreType: 'DAYS',
            title: 'Akses aplikasi ditangguhkan',
            message: err.message,
            blocking: true,
            effectiveDate: '',
            dueDate: '',
            durationDays: 0,
          );
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingTrips = false;
        _loadError = 'Tidak bisa memuat trip driver dari server';
      });
    }
  }

  List<DeliveryTrip> _applyCreatedShipperReferenceStatusOverrides(
    List<DeliveryTrip> trips,
  ) {
    if (_createdShipperReferenceStatusOverrides.isEmpty) return trips;

    return trips
        .map((trip) {
          if (trip.shipperReferences.isEmpty) return trip;
          var changed = false;
          final references = trip.shipperReferences
              .map((reference) {
                final shouldForceCreated = _referenceIdentityCandidates(
                  trip.deliveryOrderId,
                  documentId: reference.documentId,
                  referenceKey: reference.key,
                  referenceNumber: reference.referenceNumber,
                ).any(_createdShipperReferenceStatusOverrides.contains);
                if (!shouldForceCreated) return reference;
                if ((reference.tripStatus ?? '').trim().toUpperCase() ==
                    'CREATED') {
                  return reference;
                }
                changed = true;
                return reference.copyWith(tripStatus: 'CREATED');
              })
              .toList(growable: false);
          return changed ? trip.copyWith(shipperReferences: references) : trip;
        })
        .toList(growable: false);
  }

  Set<String> _referenceIdentityCandidates(
    String deliveryOrderId, {
    String? documentId,
    String? referenceKey,
    String? referenceNumber,
  }) {
    final normalizedOrderId = deliveryOrderId.trim();
    final normalizedDocumentId = documentId?.trim();
    final normalizedKey = referenceKey?.trim();
    final normalizedNumber = referenceNumber?.trim().toUpperCase();
    return <String>{
      if (normalizedDocumentId?.isNotEmpty == true) normalizedDocumentId!,
      if (normalizedOrderId.isNotEmpty && normalizedKey?.isNotEmpty == true)
        '$normalizedOrderId:$normalizedKey',
      if (normalizedOrderId.isNotEmpty && normalizedNumber?.isNotEmpty == true)
        '$normalizedOrderId:$normalizedNumber',
      if (normalizedKey?.isNotEmpty == true) normalizedKey!,
      if (normalizedNumber?.isNotEmpty == true) normalizedNumber!,
    };
  }

  Set<String> _newShipperReferenceStatusOverrideKeys(
    DeliveryTrip trip,
    List<DriverManifestShipperReferenceInput> nextReferences,
  ) {
    final existingKeys = <String>{};
    for (final reference in trip.shipperReferences) {
      existingKeys.addAll(
        _referenceIdentityCandidates(
          trip.deliveryOrderId,
          documentId: reference.documentId,
          referenceKey: reference.key,
          referenceNumber: reference.referenceNumber,
        ),
      );
    }

    final newKeys = <String>{};
    for (final reference in nextReferences) {
      final candidates = _referenceIdentityCandidates(
        trip.deliveryOrderId,
        referenceKey: reference.key,
        referenceNumber: reference.referenceNumber,
      );
      if (candidates.isEmpty ||
          candidates.any(existingKeys.contains) ||
          _createdShipperReferenceStatusOverrides.any(candidates.contains)) {
        continue;
      }
      newKeys.addAll(candidates);
    }
    return newKeys;
  }

  void _clearCreatedStatusOverridesForRefs(
    DeliveryTrip trip,
    Iterable<String> targetRefs,
  ) {
    for (final targetRef in targetRefs) {
      final normalizedTarget = targetRef.trim();
      if (normalizedTarget.isEmpty) continue;
      final reference = trip.shipperReferences.firstWhereOrNull(
        (item) => _referenceIdentityCandidates(
          trip.deliveryOrderId,
          documentId: item.documentId,
          referenceKey: item.key,
          referenceNumber: item.referenceNumber,
        ).contains(normalizedTarget),
      );
      final candidates = reference == null
          ? _referenceIdentityCandidates(
              trip.deliveryOrderId,
              documentId: normalizedTarget,
              referenceKey: normalizedTarget,
              referenceNumber: normalizedTarget,
            )
          : _referenceIdentityCandidates(
              trip.deliveryOrderId,
              documentId: reference.documentId,
              referenceKey: reference.key,
              referenceNumber: reference.referenceNumber,
            );
      _createdShipperReferenceStatusOverrides.removeAll(candidates);
    }
  }

  Future<void> _closeWarningNotice() async {
    final sessionToken = _session.token;
    final notice = _accessNotice;
    if (sessionToken == null ||
        sessionToken.isEmpty ||
        notice == null ||
        !notice.isWarning ||
        notice.scoreId.isEmpty) {
      return;
    }

    setState(() => _acknowledgingWarning = true);
    try {
      final nextNotice = await _driverAccessService.acknowledgeWarning(
        sessionToken: sessionToken,
        scoreId: notice.scoreId,
      );
      if (!mounted) return;
      setState(() {
        _acknowledgingWarning = false;
        _accessNotice = nextNotice;
      });
      await _loadTrips(skipAccessRefresh: true);
    } on DriverAccessException catch (err) {
      if (!mounted) return;
      setState(() => _acknowledgingWarning = false);
      _showError(err.message);
    }
  }

  // ── Tracking ───────────────────────────────────────────────

  List<CustomerProductOption> _productsForCustomer(String? customerRef) {
    final normalizedCustomerRef = customerRef?.trim() ?? '';
    if (normalizedCustomerRef.isEmpty) {
      return _customerProducts;
    }
    return _customerProducts
        .where((product) => product.customerRef == normalizedCustomerRef)
        .toList(growable: false);
  }

  List<CustomerRecipientOption> _recipientsForCustomer(String? customerRef) {
    final normalizedCustomerRef = customerRef?.trim() ?? '';
    if (normalizedCustomerRef.isEmpty) {
      return _customerRecipients;
    }
    return _customerRecipients
        .where((recipient) => recipient.customerRef == normalizedCustomerRef)
        .toList(growable: false);
  }

  bool _canManageManifest(DeliveryTrip trip) {
    if (trip.isTripClosedByAdmin || trip.hasBlockingAdminApproval) {
      return false;
    }
    return switch (trip.status) {
      TripStatus.assigned ||
      TripStatus.onDelivery ||
      TripStatus.arrived ||
      TripStatus.partialHold ||
      TripStatus.delivered => true,
    };
  }

  TripStatus? _preferredSuratJalanStatus(DeliveryTrip trip) {
    return switch (trip.status) {
      TripStatus.assigned => TripStatus.onDelivery,
      TripStatus.onDelivery => TripStatus.arrived,
      TripStatus.arrived => TripStatus.delivered,
      TripStatus.partialHold => TripStatus.onDelivery,
      TripStatus.delivered => null,
    };
  }

  String _statusApiValue(TripStatus status) {
    return deliveryStatusApiValue(status);
  }

  String _referenceStatusForBatch(
    DeliveryTrip trip,
    DeliveryShipperReference reference,
  ) {
    final status = reference.tripStatus?.trim().toUpperCase();
    if (status != null && status.isNotEmpty) return status;
    return _statusApiValue(trip.status);
  }

  bool _canMoveReferenceToStatus(
    DeliveryTrip trip,
    DeliveryShipperReference reference,
    TripStatus nextStatus,
  ) {
    if (trip.isShipperReferencePendingFinalization(reference)) {
      return false;
    }
    if (!_hasRequiredTrackingForStatus(trip, nextStatus)) {
      return false;
    }
    return _referenceCanMoveByStatus(trip, reference, nextStatus);
  }

  bool _hasRequiredTrackingForStatus(DeliveryTrip trip, TripStatus nextStatus) {
    return !deliveryStatusRequiresActiveTracking(nextStatus) ||
        trip.hasActiveTracking;
  }

  bool _referenceCanMoveByStatus(
    DeliveryTrip trip,
    DeliveryShipperReference reference,
    TripStatus nextStatus,
  ) {
    final currentStatus = _referenceStatusForBatch(trip, reference);
    return switch (nextStatus) {
      TripStatus.onDelivery =>
        currentStatus == 'CREATED' || currentStatus == 'PARTIAL_HOLD',
      TripStatus.arrived => currentStatus == 'ON_DELIVERY',
      TripStatus.delivered =>
        reference.canRequestFinalization && currentStatus == 'ARRIVED',
      TripStatus.assigned || TripStatus.partialHold => false,
    };
  }

  List<DeliveryShipperReference> _suratJalanStatusEligibleReferences(
    DeliveryTrip trip,
    TripStatus nextStatus,
  ) {
    return trip.shipperReferences
        .where(
          (reference) => _canMoveReferenceToStatus(trip, reference, nextStatus),
        )
        .toList(growable: false);
  }

  TripStatus? _trackingBlockedSuratJalanStatus(DeliveryTrip trip) {
    if (trip.hasActiveTracking) return null;
    const orderedStatuses = [TripStatus.onDelivery, TripStatus.arrived];
    for (final status in orderedStatuses) {
      if (!deliveryStatusRequiresActiveTracking(status)) continue;
      final hasReferenceReady = trip.shipperReferences.any(
        (reference) =>
            !trip.isShipperReferencePendingFinalization(reference) &&
            _referenceCanMoveByStatus(trip, reference, status),
      );
      if (hasReferenceReady) {
        return status;
      }
    }
    return null;
  }

  List<TripStatus> _availableSuratJalanStatuses(DeliveryTrip trip) {
    const orderedStatuses = [
      TripStatus.onDelivery,
      TripStatus.arrived,
      TripStatus.delivered,
    ];
    return orderedStatuses
        .where(
          (status) =>
              _suratJalanStatusEligibleReferences(trip, status).isNotEmpty,
        )
        .toList(growable: false);
  }

  bool _canUpdateSuratJalanStatus(DeliveryTrip trip) {
    if (trip.isTripClosedByAdmin || trip.hasBlockingAdminApproval) {
      return false;
    }
    return _availableSuratJalanStatuses(trip).isNotEmpty;
  }

  String _suratJalanRefForBatch(
    DeliveryTrip trip,
    DeliveryShipperReference reference,
  ) {
    final documentId = reference.documentId?.trim();
    if (documentId != null && documentId.isNotEmpty) return documentId;
    final suffix = reference.key?.trim().isNotEmpty == true
        ? reference.key!.trim()
        : reference.referenceNumber.trim();
    return '${trip.deliveryOrderId}:$suffix';
  }

  bool _suratJalanBatchRefMatches(
    DeliveryTrip trip,
    DeliveryShipperReference reference,
    String candidateRef,
  ) {
    final normalized = candidateRef.trim();
    if (normalized.isEmpty) return false;
    final documentId = reference.documentId?.trim();
    final key = reference.key?.trim();
    final number = reference.referenceNumber.trim();
    final candidates = <String>{
      _suratJalanRefForBatch(trip, reference),
      if (documentId != null && documentId.isNotEmpty) documentId,
      if (key != null && key.isNotEmpty) '${trip.deliveryOrderId}:$key',
      if (number.isNotEmpty) '${trip.deliveryOrderId}:$number',
      if (key != null && key.isNotEmpty) key,
      if (number.isNotEmpty) number,
    };
    return candidates.contains(normalized);
  }

  String _selectedSuratJalanText(
    DeliveryTrip trip,
    List<String> targetSuratJalanRefs,
  ) {
    final selected = trip.shipperReferences
        .where(
          (reference) => targetSuratJalanRefs.any(
            (ref) => _suratJalanBatchRefMatches(trip, reference, ref),
          ),
        )
        .map((reference) => reference.referenceNumber)
        .where((value) => value.trim().isNotEmpty)
        .toList(growable: false);
    if (selected.isEmpty) return '${targetSuratJalanRefs.length} SJ';
    if (selected.length <= 3) return selected.join(', ');
    return '${selected.take(3).join(', ')} +${selected.length - 3} SJ';
  }

  String _suratJalanStatusDistributionText(DeliveryTrip trip) {
    if (trip.shipperReferences.isEmpty) {
      return deliveryStatusLabel(_statusApiValue(trip.status));
    }

    final counts = <String, int>{};
    for (final reference in trip.shipperReferences) {
      final status = _referenceStatusForBatch(trip, reference);
      counts[status] = (counts[status] ?? 0) + 1;
    }

    const orderedStatuses = [
      'CREATED',
      'ON_DELIVERY',
      'ARRIVED',
      'PARTIAL_HOLD',
      'DELIVERED',
      'CANCELLED',
    ];
    final orderedLabels = [
      ...orderedStatuses
          .where((status) => counts.containsKey(status))
          .map((status) => '${deliveryStatusLabel(status)} ${counts[status]}'),
      ...counts.entries
          .where((entry) => !orderedStatuses.contains(entry.key))
          .map((entry) => '${deliveryStatusLabel(entry.key)} ${entry.value}'),
    ];
    return orderedLabels.join(', ');
  }

  String _suratJalanStatusHelperText(DeliveryTrip trip) {
    final availableStatuses = _availableSuratJalanStatuses(trip);
    final preferredStatus = _preferredSuratJalanStatus(trip);
    final nextStatus = availableStatuses.contains(preferredStatus)
        ? preferredStatus
        : availableStatuses.isEmpty
        ? null
        : availableStatuses.first;
    if (nextStatus == null) {
      final trackingBlockedStatus = _trackingBlockedSuratJalanStatus(trip);
      if (trackingBlockedStatus != null) {
        return 'Aktifkan tracking dulu sebelum memindahkan SJ ke ${_apiStatusLabel(_statusApiValue(trackingBlockedStatus))}.';
      }
      return 'Tidak ada SJ yang bisa diupdate pada tahap ini.';
    }
    final eligibleCount = _suratJalanStatusEligibleReferences(
      trip,
      nextStatus,
    ).length;
    if (eligibleCount == 0) {
      return 'Tidak ada SJ yang bisa diupdate pada tahap ini.';
    }
    final targetLabel = _apiStatusLabel(_statusApiValue(nextStatus));
    return 'Status SJ: ${_suratJalanStatusDistributionText(trip)}. $eligibleCount SJ siap dipindah ke $targetLabel.';
  }

  String _apiStatusLabel(String status) {
    return deliveryStatusLabel(status);
  }

  Future<void> _openTripManifestPlan(DriverAssignedTripPlan tripPlan) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (tripPlan.linkedDeliveryOrderRef?.trim().isNotEmpty == true) {
      if (!mounted) return;
      _showInfo('Trip ini sudah punya DO. Kelola SJ dari DO aktifnya.');
      return;
    }

    final result = await Navigator.of(context)
        .push<DeliveryManifestSubmitResult>(
          MaterialPageRoute(
            builder: (_) => DeliveryManifestPage(
              title: tripPlan.allowsDirectCargoInput
                  ? 'Buat SJ & Barang'
                  : 'Buat SJ',
              submitLabel: tripPlan.allowsDirectCargoInput
                  ? 'Simpan SJ & Barang'
                  : 'Simpan SJ',
              pickupStops: tripPlan.pickupStops,
              customerProducts: _productsForCustomer(tripPlan.customerRef),
              allowsDirectCargoInput: tripPlan.allowsDirectCargoInput,
            ),
          ),
        );

    if (result == null) {
      return;
    }

    setState(() => _submittingManifest = true);
    try {
      await _deliveryOrderService.createDeliveryOrderFromTripPlan(
        sessionToken: sessionToken,
        orderRef: tripPlan.orderRef,
        orderTripPlanKey: tripPlan.tripPlanKey,
        shipperReferences: result.shipperReferences,
        cargoItems: result.cargoItems,
      );
      await _loadTrips();
      if (!mounted) return;
      _showSuccess(
        tripPlan.allowsDirectCargoInput
            ? 'SJ dan barang berhasil dibuat.'
            : 'SJ berhasil dibuat.',
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _submittingManifest = false);
      }
    }
  }

  Future<void> _openDeliveryManifest(DeliveryTrip trip) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (!_canManageManifest(trip)) {
      if (!mounted) return;
      _showWarning(
        trip.isTripClosedByAdmin
            ? 'Trip sudah ditutup admin. SJ/barang dikunci sampai trip dibuka kembali.'
            : 'DO ini tidak bisa diubah dari aplikasi driver.',
      );
      return;
    }

    final result = await Navigator.of(context)
        .push<DeliveryManifestSubmitResult>(
          MaterialPageRoute(
            builder: (_) => DeliveryManifestPage(
              title: trip.allowsDirectCargoInput
                  ? 'Kelola SJ & Barang'
                  : 'Kelola SJ',
              submitLabel: trip.allowsDirectCargoInput
                  ? 'Simpan SJ & Barang'
                  : 'Simpan SJ',
              pickupStops: trip.pickupStops,
              customerProducts: _productsForCustomer(trip.customerRef),
              allowsDirectCargoInput: trip.allowsDirectCargoInput,
              initialShipperReferences: trip.shipperReferences,
              existingCargoItems: trip.cargoItems,
              existingActualDropPoints: trip.actualDropPoints,
            ),
          ),
        );

    if (result == null) {
      return;
    }

    final newStatusOverrideKeys = _newShipperReferenceStatusOverrideKeys(
      trip,
      result.shipperReferences,
    );
    setState(() => _submittingManifest = true);
    try {
      for (final itemId in result.deletedCargoItemIds) {
        await _deliveryOrderService.deleteDeliveryOrderCargoItem(
          sessionToken: sessionToken,
          deliveryOrderId: trip.deliveryOrderId,
          deliveryOrderItemId: itemId,
        );
      }
      await _deliveryOrderService.syncDeliveryOrderShipperReferences(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        shipperReferences: result.shipperReferences,
      );
      for (final item in result.updatedCargoItems) {
        await _deliveryOrderService.updateDeliveryOrderCargoItem(
          sessionToken: sessionToken,
          deliveryOrderId: trip.deliveryOrderId,
          deliveryOrderItemId: item.deliveryOrderItemId,
          cargoItem: item.cargoItem,
        );
      }
      if (result.cargoItems.isNotEmpty) {
        await _deliveryOrderService.appendCargoToDeliveryOrder(
          sessionToken: sessionToken,
          deliveryOrderId: trip.deliveryOrderId,
          shipperReferences: result.shipperReferences,
          cargoItems: result.cargoItems,
        );
      }
      _createdShipperReferenceStatusOverrides.addAll(newStatusOverrideKeys);
      await _loadTrips();
      if (!mounted) return;
      _showSuccess(
        result.cargoItems.isEmpty
            ? 'SJ berhasil disimpan.'
            : 'SJ dan barang berhasil disimpan.',
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _submittingManifest = false);
      }
    }
  }

  Future<void> _openSuratJalanStatus(DeliveryTrip trip) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    final availableStatuses = _availableSuratJalanStatuses(trip);
    if (!_canUpdateSuratJalanStatus(trip) || availableStatuses.isEmpty) {
      if (!mounted) return;
      _showInfo('Tidak ada SJ yang bisa diupdate pada tahap ini.');
      return;
    }

    final preferredStatus = _preferredSuratJalanStatus(trip);
    var selectedStatus = availableStatuses.contains(preferredStatus)
        ? preferredStatus!
        : availableStatuses.first;
    final selectedRefs = _suratJalanStatusEligibleReferences(
      trip,
      selectedStatus,
    ).map((reference) => _suratJalanRefForBatch(trip, reference)).toSet();

    final result = await showDialog<_SuratJalanStatusSelection>(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final eligibleRefs = _suratJalanStatusEligibleReferences(
              trip,
              selectedStatus,
            );
            final targetLabel = _apiStatusLabel(
              _statusApiValue(selectedStatus),
            );
            return AlertDialog(
              title: const Text('Update Status SJ'),
              content: SizedBox(
                width: double.maxFinite,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 420),
                  child: ListView(
                    shrinkWrap: true,
                    children: [
                      Text(
                        'Status SJ saat ini: ${_suratJalanStatusDistributionText(trip)}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<TripStatus>(
                        key: ValueKey(selectedStatus),
                        initialValue: selectedStatus,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Status Tujuan',
                        ),
                        items: availableStatuses
                            .map(
                              (status) => DropdownMenuItem(
                                value: status,
                                child: Text(
                                  _apiStatusLabel(_statusApiValue(status)),
                                ),
                              ),
                            )
                            .toList(growable: false),
                        onChanged: (value) {
                          if (value == null) return;
                          setDialogState(() {
                            selectedStatus = value;
                            selectedRefs
                              ..clear()
                              ..addAll(
                                _suratJalanStatusEligibleReferences(
                                  trip,
                                  selectedStatus,
                                ).map(
                                  (reference) =>
                                      _suratJalanRefForBatch(trip, reference),
                                ),
                              );
                          });
                        },
                      ),
                      const SizedBox(height: 8),
                      Text(
                        selectedStatus == TripStatus.delivered
                            ? 'Pilih SJ yang akan diajukan terkirim. Setelah ini driver mengisi POD dan realisasi muatan.'
                            : 'Pilih SJ yang akan diupdate. Status trip utama mengikuti progres SJ.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (trip.shipperReferences.length >
                          eligibleRefs.length) ...[
                        const SizedBox(height: 8),
                        Text(
                          '${trip.shipperReferences.length - eligibleRefs.length} SJ lain belum memenuhi syarat atau sedang dikunci approval admin.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                      const SizedBox(height: 12),
                      ...eligibleRefs.map((reference) {
                        final refId = _suratJalanRefForBatch(trip, reference);
                        final eligible = _canMoveReferenceToStatus(
                          trip,
                          reference,
                          selectedStatus,
                        );
                        final pending = trip
                            .isShipperReferencePendingFinalization(reference);
                        final currentLabel = _apiStatusLabel(
                          _referenceStatusForBatch(trip, reference),
                        );
                        return CheckboxListTile(
                          value: selectedRefs.contains(refId),
                          onChanged: eligible
                              ? (checked) {
                                  setDialogState(() {
                                    if (checked == true) {
                                      selectedRefs.add(refId);
                                    } else {
                                      selectedRefs.remove(refId);
                                    }
                                  });
                                }
                              : null,
                          title: Text(reference.referenceNumber),
                          subtitle: Text(
                            pending
                                ? 'Menunggu approval admin'
                                : 'Status sekarang: $currentLabel -> $targetLabel',
                          ),
                          controlAffinity: ListTileControlAffinity.leading,
                          contentPadding: EdgeInsets.zero,
                        );
                      }),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Batal'),
                ),
                FilledButton.icon(
                  onPressed: selectedRefs.isEmpty
                      ? null
                      : () => Navigator.of(context).pop(
                          _SuratJalanStatusSelection(
                            status: selectedStatus,
                            targetSuratJalanRefs: selectedRefs.toList(
                              growable: false,
                            ),
                          ),
                        ),
                  icon: const Icon(Icons.sync_alt_rounded),
                  label: Text('Update ${selectedRefs.length} SJ'),
                ),
              ],
            );
          },
        );
      },
    );

    if (result == null || result.targetSuratJalanRefs.isEmpty) {
      return;
    }

    if (result.status == TripStatus.delivered) {
      await _openDeliveryCompletion(
        trip,
        initialSelectedSuratJalanRefs: result.targetSuratJalanRefs,
      );
      return;
    }

    setState(() => _updatingBatchStatus = true);
    try {
      final selectedText = _selectedSuratJalanText(
        trip,
        result.targetSuratJalanRefs,
      );
      final targetLabel = _apiStatusLabel(_statusApiValue(result.status));
      await _withFreshSession(
        (sessionToken) => _deliveryOrderService.updateBatchSuratJalanStatus(
          sessionToken: sessionToken,
          deliveryOrderId: trip.deliveryOrderId,
          status: result.status,
          targetSuratJalanRefs: result.targetSuratJalanRefs,
          note: _statusNoteForUpdate(result.status),
        ),
      );
      _clearCreatedStatusOverridesForRefs(trip, result.targetSuratJalanRefs);
      await _loadTrips();
      if (!mounted) return;
      final refreshedTrip = _trips.firstWhereOrNull(
        (item) => item.deliveryOrderId == trip.deliveryOrderId,
      );
      final distribution = refreshedTrip == null
          ? ''
          : ' Status sekarang: ${_suratJalanStatusDistributionText(refreshedTrip)}.';
      _showSuccess(
        '$selectedText berhasil dipindah ke $targetLabel.$distribution',
      );
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _updatingBatchStatus = false);
      }
    }
  }

  Future<String?> _checkPermission() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return 'GPS mati. Aktifkan layanan lokasi.';
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      return 'Izin lokasi ditolak. Buka pengaturan aplikasi.';
    }
    return null;
  }

  bool _shouldAutoTrack(DeliveryTrip trip) {
    if (trip.hasBlockingAdminApproval || trip.isTripClosedByAdmin) {
      return false;
    }
    return switch (trip.status) {
      TripStatus.assigned ||
      TripStatus.onDelivery ||
      TripStatus.arrived ||
      TripStatus.partialHold => true,
      TripStatus.delivered => false,
    };
  }

  DeliveryTrip? _selectAutoTrackingTrip(
    List<DeliveryTrip> trips,
    String? preferredDeliveryOrderId,
  ) {
    if (preferredDeliveryOrderId != null) {
      final retained = trips.firstWhereOrNull(
        (trip) =>
            trip.deliveryOrderId == preferredDeliveryOrderId &&
            _shouldAutoTrack(trip),
      );
      if (retained != null) return retained;
    }

    final serverLocked = trips.firstWhereOrNull(
      (trip) =>
          (trip.trackingState == 'ACTIVE' || trip.trackingState == 'PAUSED') &&
          _shouldAutoTrack(trip),
    );
    if (serverLocked != null) return serverLocked;

    return trips.firstWhereOrNull(_shouldAutoTrack);
  }

  Future<void> _syncAutoTracking(DeliveryTrip? trip) async {
    if (!mounted) return;

    if (trip == null || !_shouldAutoTrack(trip)) {
      if ((_trackingService?.isRunning ?? false) || _trackingEnabled) {
        _pingCounterTimer?.cancel();
        _trackingService?.stop();
        setState(() {
          _trackingEnabled = false;
          _activeTrip = null;
          _trackingDeliveryOrderId = null;
          _pingCount = 0;
        });
      }
      return;
    }

    if ((_trackingService?.isRunning ?? false) &&
        _trackingDeliveryOrderId == trip.deliveryOrderId) {
      if (!_trackingEnabled ||
          _activeTrip?.deliveryOrderId != trip.deliveryOrderId) {
        setState(() {
          _activeTrip = trip;
          _trackingEnabled = true;
        });
      }
      return;
    }

    final err = await _checkPermission();
    if (err != null) {
      if (!mounted) return;
      _pingCounterTimer?.cancel();
      _trackingService?.stop();
      setState(() {
        _locationError = err;
        _trackingEnabled = false;
        _trackingDeliveryOrderId = null;
        _pingCount = 0;
      });
      return;
    }

    if (!mounted) return;
    setState(() {
      _activeTrip = trip;
      _selectedTrip ??= trip;
      _trackingEnabled = true;
      _trackingDeliveryOrderId = trip.deliveryOrderId;
      _locationError = null;
      _pingError = null;
      _pingCount = 0;
    });
    _startTracking(initialAction: _trackingStartAction(trip));
  }

  void _startTracking({String initialAction = 'start'}) {
    final trip = _activeTrip;
    if (trip == null || !_shouldAutoTrack(trip)) return;

    _pingCounterTimer?.cancel();
    final trackingService = _trackingService;
    if (trackingService == null) return;

    trackingService.start(
      deliveryOrderId: trip.deliveryOrderId,
      interval: _autoTrackingInterval,
      onLocation: (snapshot) {
        if (!mounted) return;
        setState(() {
          _latestLocation = snapshot;
          _locationError = null;
        });
      },
      onError: (err) {
        if (!mounted) return;
        setState(() => _pingError = err);
      },
      initialAction: initialAction,
      onPingSuccess: () {
        if (!mounted) return;
        unawaited(_loadTrips());
      },
      onTrackingInactive: (message) {
        if (!mounted) return;
        _pingCounterTimer?.cancel();
        _trackingService?.stop();
        setState(() {
          _trackingEnabled = false;
          _activeTrip = null;
          _trackingDeliveryOrderId = null;
          _pingCount = 0;
          _pingError = message;
        });
        unawaited(_loadTrips());
      },
    );

    _pingCounterTimer = Timer.periodic(_autoTrackingInterval, (_) {
      if (!mounted || !_trackingEnabled) return;
      setState(() => _pingCount++);
    });
  }

  // ── Trip actions ───────────────────────────────────────────

  Future<void> _openDeliveryCompletion(
    DeliveryTrip trip, {
    List<String> initialSelectedSuratJalanRefs = const [],
  }) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (trip.cargoItems.isEmpty) {
      if (!mounted) return;
      _showWarning(
        'Muatan DO belum ada. Isi barang dulu sebelum ajukan selesai.',
      );
      return;
    }

    final result = await Navigator.of(context)
        .push<DeliveryCompletionSubmitResult>(
          MaterialPageRoute(
            builder: (_) => DeliveryCompletionPage(
              trip: trip,
              customerRecipients: _recipientsForCustomer(trip.customerRef),
              initialSelectedSuratJalanRefs: initialSelectedSuratJalanRefs,
            ),
          ),
        );

    if (result == null) {
      return;
    }

    setState(() => _updatingStatus = true);
    try {
      await _withFreshSession(
        (sessionToken) => _deliveryOrderService.requestDeliveryCompletion(
          sessionToken: sessionToken,
          deliveryOrderId: trip.deliveryOrderId,
          note: result.note,
          podReceiverName: result.podReceiverName,
          podReceivedDate: result.podReceivedDate,
          selectedSuratJalanRefs: result.selectedSuratJalanRefs,
          actualItems: result.actualItems,
          actualDropPoints: result.actualDropPoints,
        ),
      );
      await _loadTrips();
      if (!mounted) return;
      _showSuccess('Permintaan selesai dikirim. Menunggu approval admin.');
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _updatingStatus = false);
      }
    }
  }

  Future<void> _openTripClosure(DeliveryTrip trip) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }
    if (trip.status != TripStatus.delivered) {
      _showInfo('Tutup trip hanya bisa diajukan setelah trip selesai.');
      return;
    }
    if (trip.isTripClosedByAdmin) {
      _showInfo('Trip ini sudah ditutup admin.');
      return;
    }
    if (trip.isAwaitingAdminApproval) {
      _showInfo('Trip ini masih menunggu approval admin.');
      return;
    }

    final currentOdometer = (trip.vehicleLastOdometer ?? 0).clamp(
      0,
      double.infinity,
    );
    final odometerController = TextEditingController(
      text: trip.tripEndOdometerKm != null && trip.tripEndOdometerKm! > 0
          ? _formatWholeNumberInput(trip.tripEndOdometerKm)
          : '',
    );
    final noteController = TextEditingController();

    final result = await showDialog<_TripClosureSubmitResult>(
      context: context,
      builder: (context) {
        String? errorText;

        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> submit() async {
              final odometer = _parseOdometerInput(odometerController.text);
              if (odometer == null || odometer <= 0) {
                setDialogState(
                  () => errorText = 'Odometer akhir trip wajib diisi.',
                );
                return;
              }
              if (odometer < currentOdometer) {
                setDialogState(
                  () => errorText =
                      'Odometer akhir tidak boleh lebih kecil dari ${_formatKm(currentOdometer)} km.',
                );
                return;
              }
              await _popDialogAfterKeyboardDismiss<_TripClosureSubmitResult>(
                context,
                _TripClosureSubmitResult(
                  odometerKm: odometer,
                  note: noteController.text.trim(),
                ),
              );
            }

            return AlertDialog(
              title: const Text('Tutup Trip'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Odometer kendaraan terakhir: ${_formatKm(currentOdometer)} km',
                      style: TextStyle(
                        color: Theme.of(
                          context,
                        ).colorScheme.onSurface.withValues(alpha: 0.65),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: odometerController,
                      keyboardType: mobileNumberKeyboardType(0),
                      inputFormatters: mobileNumberInputFormatters(0),
                      scrollPadding: _keyboardAwareScrollPadding(context),
                      decoration: InputDecoration(
                        labelText: 'Odometer Akhir Trip',
                        suffixText: 'km',
                      ),
                      onSubmitted: (_) => unawaited(submit()),
                    ),
                    if (errorText != null) ...[
                      const SizedBox(height: 8),
                      _TripClosureWarning(message: errorText!),
                    ],
                    const SizedBox(height: 12),
                    TextField(
                      controller: noteController,
                      minLines: 2,
                      maxLines: 4,
                      scrollPadding: _keyboardAwareScrollPadding(context),
                      decoration: const InputDecoration(
                        labelText: 'Catatan',
                        hintText: 'Opsional',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => unawaited(
                    _popDialogAfterKeyboardDismiss<_TripClosureSubmitResult>(
                      context,
                    ),
                  ),
                  child: const Text('Batal'),
                ),
                FilledButton.icon(
                  onPressed: () => unawaited(submit()),
                  icon: const Icon(Icons.lock_clock_rounded),
                  label: const Text('Ajukan Tutup Trip'),
                ),
              ],
            );
          },
        );
      },
    );
    odometerController.dispose();
    noteController.dispose();

    if (result == null) {
      return;
    }

    setState(() => _updatingStatus = true);
    try {
      await _deliveryOrderService.requestTripClosure(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        tripEndOdometerKm: result.odometerKm,
        note: result.note,
      );
      await _loadTrips();
      if (!mounted) return;
      _showSuccess('Permintaan tutup trip dikirim. Menunggu approval admin.');
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _updatingStatus = false);
      }
    }
  }

  Future<void> _openIncidentReport(DeliveryTrip trip) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }

    final locationController = TextEditingController(
      text: _latestLocation == null
          ? ''
          : '${_latestLocation!.latitude.toStringAsFixed(6)}, ${_latestLocation!.longitude.toStringAsFixed(6)}',
    );
    final odometerController = TextEditingController(
      text: (trip.tripEndOdometerKm != null && trip.tripEndOdometerKm! > 0)
          ? _formatWholeNumberInput(trip.tripEndOdometerKm)
          : (trip.vehicleLastOdometer != null && trip.vehicleLastOdometer! > 0)
          ? _formatWholeNumberInput(trip.vehicleLastOdometer)
          : '',
    );
    final descriptionController = TextEditingController();

    final result = await showDialog<_IncidentReportSubmitResult>(
      context: context,
      builder: (context) {
        var incidentType = 'OTHER';
        var urgency = 'MEDIUM';
        String? errorText;

        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> submit() async {
              final locationText = locationController.text.trim();
              final description = descriptionController.text.trim();
              final odometer = _parseOdometerInput(odometerController.text);
              if (locationText.isEmpty) {
                setDialogState(() => errorText = 'Lokasi insiden wajib diisi.');
                return;
              }
              if (odometer == null || odometer <= 0) {
                setDialogState(
                  () => errorText = 'Odometer insiden wajib diisi.',
                );
                return;
              }
              if (description.isEmpty) {
                setDialogState(
                  () => errorText = 'Kronologi insiden wajib diisi.',
                );
                return;
              }
              await _popDialogAfterKeyboardDismiss<_IncidentReportSubmitResult>(
                context,
                _IncidentReportSubmitResult(
                  incidentType: incidentType,
                  urgency: urgency,
                  locationText: locationText,
                  odometer: odometer,
                  description: description,
                ),
              );
            }

            return AlertDialog(
              title: Text('Lapor Insiden ${trip.doNumber}'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (errorText != null) ...[
                      Text(
                        errorText!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    DropdownButtonFormField<String>(
                      initialValue: incidentType,
                      decoration: const InputDecoration(
                        labelText: 'Tipe Insiden',
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'OTHER',
                          child: Text('Lainnya'),
                        ),
                        DropdownMenuItem(
                          value: 'ENGINE_TROUBLE',
                          child: Text('Mesin bermasalah'),
                        ),
                        DropdownMenuItem(
                          value: 'BLOWOUT_TIRE',
                          child: Text('Ban pecah'),
                        ),
                        DropdownMenuItem(
                          value: 'ACCIDENT_MINOR',
                          child: Text('Kecelakaan ringan'),
                        ),
                        DropdownMenuItem(
                          value: 'ACCIDENT_MAJOR',
                          child: Text('Kecelakaan berat'),
                        ),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setDialogState(() => incidentType = value);
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: urgency,
                      decoration: const InputDecoration(labelText: 'Urgensi'),
                      items: const [
                        DropdownMenuItem(value: 'LOW', child: Text('Rendah')),
                        DropdownMenuItem(
                          value: 'MEDIUM',
                          child: Text('Sedang'),
                        ),
                        DropdownMenuItem(value: 'HIGH', child: Text('Tinggi')),
                      ],
                      onChanged: (value) {
                        if (value != null) {
                          setDialogState(() => urgency = value);
                        }
                      },
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: locationController,
                      minLines: 1,
                      maxLines: 3,
                      scrollPadding: _keyboardAwareScrollPadding(context),
                      decoration: const InputDecoration(
                        labelText: 'Lokasi Insiden',
                        hintText: 'Koordinat / nama jalan / lokasi kejadian',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: odometerController,
                      keyboardType: mobileNumberKeyboardType(0),
                      inputFormatters: mobileNumberInputFormatters(0),
                      scrollPadding: _keyboardAwareScrollPadding(context),
                      decoration: const InputDecoration(
                        labelText: 'Odometer Saat Insiden',
                        suffixText: 'km',
                      ),
                      onSubmitted: (_) => unawaited(submit()),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: descriptionController,
                      minLines: 4,
                      maxLines: 6,
                      scrollPadding: _keyboardAwareScrollPadding(context),
                      decoration: const InputDecoration(
                        labelText: 'Kronologi',
                        hintText:
                            'Jelaskan kejadian dan kondisi kendaraan/barang',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => unawaited(
                    _popDialogAfterKeyboardDismiss<_IncidentReportSubmitResult>(
                      context,
                    ),
                  ),
                  child: const Text('Batal'),
                ),
                FilledButton.icon(
                  onPressed: () => unawaited(submit()),
                  icon: const Icon(Icons.report_problem_outlined),
                  label: const Text('Kirim Laporan'),
                ),
              ],
            );
          },
        );
      },
    );

    locationController.dispose();
    odometerController.dispose();
    descriptionController.dispose();

    if (result == null) {
      return;
    }

    setState(() => _reportingIncident = true);
    try {
      await _deliveryOrderService.reportIncident(
        sessionToken: sessionToken,
        deliveryOrderId: trip.deliveryOrderId,
        incidentType: result.incidentType,
        urgency: result.urgency,
        locationText: result.locationText,
        odometer: result.odometer,
        description: result.description,
      );
      await _loadTrips();
      if (!mounted) return;
      _showSuccess('Laporan insiden dikirim ke admin.');
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _reportingIncident = false);
      }
    }
  }

  List<DriverIncident> _incidentsForTrip(DeliveryTrip trip) {
    return _driverIncidents
        .where(
          (incident) =>
              incident.relatedDeliveryOrderRef == trip.deliveryOrderId,
        )
        .toList(growable: false);
  }

  List<DriverIncident> _activeIncidentsForTrip(DeliveryTrip trip) {
    return _incidentsForTrip(trip)
        .where((incident) => incident.blocksNewIncidentReport)
        .toList(growable: false);
  }

  String? _incidentReportBlockMessage(DeliveryTrip trip) {
    final activeIncidents = _activeIncidentsForTrip(trip);
    if (activeIncidents.isEmpty) {
      return null;
    }
    final waitingAdminIncident = activeIncidents.firstWhereOrNull(
      (incident) => incident.isWaitingResolutionReview,
    );
    if (waitingAdminIncident != null) {
      return 'Laporan baru tersedia setelah pengajuan ${waitingAdminIncident.incidentNumber} direview admin.';
    }
    final waitingCloseIncident = activeIncidents.firstWhereOrNull(
      (incident) => incident.status == 'RESOLVED',
    );
    if (waitingCloseIncident != null) {
      return 'Laporan baru tersedia setelah ${waitingCloseIncident.incidentNumber} ditutup admin.';
    }
    return 'Selesaikan ${activeIncidents.first.incidentNumber} sebelum membuat laporan insiden baru.';
  }

  Future<void> _openIncidentResolution(
    DeliveryTrip trip,
    DriverIncident incident,
  ) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }

    final noteController = TextEditingController();
    final locationController = TextEditingController(
      text: _latestLocation == null
          ? incident.locationText
          : '${_latestLocation!.latitude.toStringAsFixed(6)}, ${_latestLocation!.longitude.toStringAsFixed(6)}',
    );

    final result = await showDialog<_IncidentResolutionSubmitResult>(
      context: context,
      builder: (context) {
        String? errorText;

        return StatefulBuilder(
          builder: (context, setDialogState) {
            Future<void> submit() async {
              final note = noteController.text.trim();
              if (note.isEmpty) {
                setDialogState(
                  () => errorText = 'Catatan penyelesaian wajib diisi.',
                );
                return;
              }

              await _popDialogAfterKeyboardDismiss<
                _IncidentResolutionSubmitResult
              >(
                context,
                _IncidentResolutionSubmitResult(
                  note: note,
                  locationText: locationController.text.trim(),
                ),
              );
            }

            return AlertDialog(
              title: Text('Ajukan Selesai ${incident.incidentNumber}'),
              content: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${trip.doNumber} | ${trip.vehiclePlate}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 12),
                      if (errorText != null) ...[
                        Text(
                          errorText!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      TextField(
                        controller: noteController,
                        minLines: 3,
                        maxLines: 5,
                        scrollPadding: _keyboardAwareScrollPadding(context),
                        decoration: const InputDecoration(
                          labelText: 'Catatan Selesai',
                          hintText: 'Jelaskan tindakan yang sudah dilakukan',
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: locationController,
                        minLines: 1,
                        maxLines: 3,
                        scrollPadding: _keyboardAwareScrollPadding(context),
                        decoration: const InputDecoration(
                          labelText: 'Lokasi Akhir',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => unawaited(
                    _popDialogAfterKeyboardDismiss<
                      _IncidentResolutionSubmitResult
                    >(context),
                  ),
                  child: const Text('Batal'),
                ),
                FilledButton.icon(
                  onPressed: () => unawaited(submit()),
                  icon: const Icon(Icons.task_alt_rounded),
                  label: const Text('Ajukan'),
                ),
              ],
            );
          },
        );
      },
    );

    noteController.dispose();
    locationController.dispose();

    if (result == null) {
      return;
    }

    setState(() => _submittingIncidentResolution = true);
    try {
      await _deliveryOrderService.submitIncidentResolution(
        sessionToken: sessionToken,
        incidentRef: incident.id,
        resolutionNote: result.note,
        resolutionLocationText: result.locationText,
        costs: const [],
      );
      await _loadTrips();
      if (!mounted) return;
      _showSuccess('Penyelesaian insiden dikirim. Menunggu review admin.');
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _submittingIncidentResolution = false);
      }
    }
  }

  Future<void> _openIncidentCostSubmission(
    DeliveryTrip trip,
    DriverIncident incident,
  ) async {
    final sessionToken = _session.token;
    if (sessionToken == null || sessionToken.isEmpty) {
      return;
    }

    final costRows = <_IncidentCostDraftController>[
      _IncidentCostDraftController(),
    ];

    final result = await showDialog<_IncidentCostSubmitResult>(
      context: context,
      builder: (context) {
        String? errorText;

        return StatefulBuilder(
          builder: (context, setDialogState) {
            void addCostRow() {
              setDialogState(
                () => costRows.add(_IncidentCostDraftController()),
              );
            }

            Future<void> removeCostRow(int index) async {
              if (index < 0 || index >= costRows.length) return;
              if (costRows.length == 1) {
                setDialogState(
                  () => errorText = 'Minimal satu biaya wajib diisi.',
                );
                return;
              }
              final confirmed = await showMobileActionConfirmation(
                context,
                title: 'Hapus biaya ini?',
                message:
                    'Baris biaya driver ini akan dihapus dari draft tambahan biaya. Data belum dikirim sebelum kamu menekan Kirim Biaya.',
                confirmLabel: 'Hapus Biaya',
                icon: Icons.delete_outline_rounded,
                destructive: true,
              );
              if (!context.mounted || !confirmed) return;
              final removed = costRows.removeAt(index);
              removed.dispose();
              setDialogState(() {});
            }

            Future<void> submit() async {
              final costs = <DriverIncidentCostInput>[];
              for (var index = 0; index < costRows.length; index++) {
                final row = costRows[index];
                final amount = _parseCurrencyInput(row.amount.text);
                final description = row.description.text.trim();
                final payee = row.payeeName.text.trim();
                final rowNote = row.note.text.trim();
                final hasAnyInput =
                    amount > 0 ||
                    description.isNotEmpty ||
                    payee.isNotEmpty ||
                    rowNote.isNotEmpty;
                if (!hasAnyInput) {
                  continue;
                }
                if (amount <= 0 || description.isEmpty) {
                  setDialogState(
                    () => errorText =
                        'Biaya baris ${index + 1} wajib berisi nominal dan deskripsi.',
                  );
                  return;
                }
                costs.add(
                  DriverIncidentCostInput(
                    category: row.category,
                    amount: amount,
                    description: description,
                    payeeName: payee,
                    note: rowNote,
                  ),
                );
              }

              if (costs.isEmpty) {
                setDialogState(
                  () => errorText =
                      'Tambahkan minimal satu biaya sebelum dikirim ke admin.',
                );
                return;
              }

              await _popDialogAfterKeyboardDismiss<_IncidentCostSubmitResult>(
                context,
                _IncidentCostSubmitResult(costs: costs),
              );
            }

            return AlertDialog(
              title: Text('Tambah Biaya ${incident.incidentNumber}'),
              content: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${trip.doNumber} | ${trip.vehiclePlate}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 12),
                      if (errorText != null) ...[
                        Text(
                          errorText!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'Biaya Driver',
                              style: TextStyle(fontWeight: FontWeight.w800),
                            ),
                          ),
                          TextButton.icon(
                            onPressed: addCostRow,
                            icon: const Icon(Icons.add_rounded),
                            label: const Text('Tambah'),
                          ),
                        ],
                      ),
                      for (var index = 0; index < costRows.length; index++) ...[
                        const SizedBox(height: 10),
                        _IncidentCostInputCard(
                          key: ObjectKey(costRows[index]),
                          row: costRows[index],
                          index: index,
                          onRemove: () => unawaited(removeCostRow(index)),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => unawaited(
                    _popDialogAfterKeyboardDismiss<_IncidentCostSubmitResult>(
                      context,
                    ),
                  ),
                  child: const Text('Batal'),
                ),
                FilledButton.icon(
                  onPressed: () => unawaited(submit()),
                  icon: const Icon(Icons.receipt_long_rounded),
                  label: const Text('Kirim Biaya'),
                ),
              ],
            );
          },
        );
      },
    );

    for (final row in costRows) {
      row.dispose();
    }

    if (result == null) {
      return;
    }

    setState(() => _submittingIncidentResolution = true);
    try {
      await _deliveryOrderService.submitIncidentResolution(
        sessionToken: sessionToken,
        incidentRef: incident.id,
        resolutionNote: 'Driver menambahkan biaya insiden',
        costs: result.costs,
      );
      await _loadTrips();
      if (!mounted) return;
      _showSuccess('Biaya tambahan insiden dikirim. Menunggu review admin.');
    } on DeliveryOrderException catch (err) {
      if (!mounted) return;
      _showError(err.message);
    } finally {
      if (mounted) {
        setState(() => _submittingIncidentResolution = false);
      }
    }
  }

  String _statusNoteForUpdate(TripStatus status) {
    return switch (status) {
      TripStatus.onDelivery => 'Pengiriman dimulai via driver app',
      TripStatus.arrived => 'Driver menandai sudah tiba via driver app',
      TripStatus.partialHold =>
        'Driver mengajukan sisa SJ selesai via aplikasi driver',
      TripStatus.delivered =>
        'Driver mengajukan delivery selesai via aplikasi driver',
      TripStatus.assigned => 'Status diperbarui via driver app',
    };
  }

  String _trackingStartAction(DeliveryTrip? trip) {
    final trackingState = trip?.trackingState;
    if (trackingState == 'ACTIVE') {
      return 'heartbeat';
    }
    if (trackingState == 'PAUSED') {
      return 'resume';
    }
    return 'start';
  }

  String? get _activeActionMessage {
    if (_submittingManifest) return 'Menyimpan SJ dan barang...';
    if (_updatingBatchStatus) return 'Mengupdate status SJ...';
    if (_updatingStatus) return 'Mengirim update trip...';
    if (_reportingIncident) return 'Mengirim laporan insiden...';
    if (_submittingIncidentResolution) {
      return 'Mengirim penyelesaian insiden...';
    }
    return null;
  }

  Future<void> _openAccountSettings() async {
    final nameChanged = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AccountSettingsPage(session: _session),
      ),
    );
    if (nameChanged != true || !mounted) return;
    await _refreshDriverSession();
    if (!mounted) return;
    _showSuccess('Nama akun berhasil diperbarui.');
  }

  Future<void> _confirmLogout() async {
    final lockedTrip = _trips.firstWhereOrNull(
      (trip) =>
          trip.trackingState == 'ACTIVE' || trip.trackingState == 'PAUSED',
    );
    if (lockedTrip != null) {
      final shouldLogout = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Keluar aplikasi driver?'),
          content: Text(
            'Kamu masih terikat ke ${lockedTrip.doNumber}. Keluar sekarang akan menghentikan ping lokasi dari HP ini sampai login lagi.',
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
      if (shouldLogout != true || !mounted) return;
    }

    widget.onLogout();
  }

  // ── Build ──────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final compact = MediaQuery.sizeOf(context).width < 380;
    final pendingTripPlans = _plannedTrips
        .where(
          (tripPlan) =>
              tripPlan.linkedDeliveryOrderRef?.trim().isNotEmpty != true,
        )
        .toList(growable: false);
    final accessNotice = _accessNotice;
    final hasBlockingNotice =
        accessNotice != null &&
        (accessNotice.blocking ||
            (accessNotice.isWarning &&
                (accessNotice.warningAcknowledgedAt == null ||
                    accessNotice.warningAcknowledgedAt!.isEmpty)));
    final blockingNotice = hasBlockingNotice ? accessNotice : null;
    final actionMessage = _activeActionMessage;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          gmsCompanyName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: compact
                ? IconButton(
                    onPressed: _confirmLogout,
                    tooltip: 'Keluar',
                    icon: const Icon(Icons.logout_rounded),
                  )
                : OutlinedButton.icon(
                    onPressed: _confirmLogout,
                    icon: const Icon(Icons.logout_rounded, size: 15),
                    label: const Text('Keluar'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      textStyle: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
          ),
        ],
      ),
      body: Stack(
        children: [
          RefreshIndicator(
            onRefresh: hasBlockingNotice ? () async {} : _loadTrips,
            color: scheme.primary,
            child: ListView(
              padding: EdgeInsets.fromLTRB(
                16,
                10,
                16,
                28 + MediaQuery.paddingOf(context).bottom,
              ),
              physics: hasBlockingNotice
                  ? const NeverScrollableScrollPhysics()
                  : const AlwaysScrollableScrollPhysics(),
              children: [
                _DriverCard(
                  session: _session,
                  tripCount: _trips.length + pendingTripPlans.length,
                  onTap: _openAccountSettings,
                ),
                const SizedBox(height: 12),
                _DriverSectionSwitcher(
                  activeSection: _activeSection,
                  tripCount: _trips.length + pendingTripPlans.length,
                  voucherCount: _visibleDriverVouchers.length,
                  onChanged: (section) => setState(() {
                    _activeSection = section;
                  }),
                ),
                const SizedBox(height: 16),
                if (!hasBlockingNotice && accessNotice != null) ...[
                  _ErrorBanner(
                    icon: Icons.warning_amber_rounded,
                    message: accessNotice.message,
                    isWarning: true,
                  ),
                  const SizedBox(height: 16),
                ],
                if (_activeSection == _DriverHomeSection.trips) ...[
                  if (!hasBlockingNotice && pendingTripPlans.isNotEmpty) ...[
                    _SectionHeader(
                      title: 'Trip siap input SJ',
                      count: pendingTripPlans.length,
                    ),
                    const SizedBox(height: 10),
                    ...pendingTripPlans.map(
                      (tripPlan) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _PlannedTripCard(
                          tripPlan: tripPlan,
                          busy: _submittingManifest,
                          onPressed: () =>
                              unawaited(_openTripManifestPlan(tripPlan)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],
                  _SectionHeader(title: 'Trip', count: _trips.length),
                  const SizedBox(height: 10),
                  _buildTripList(scheme),
                  if (_selectedTrip != null) ...[
                    const SizedBox(height: 20),
                    const _SectionHeader(title: 'Trip dipilih'),
                    const SizedBox(height: 10),
                    _TripDetailCard(trip: _selectedTrip!),
                    const SizedBox(height: 12),
                    _ManifestSummaryCard(trip: _selectedTrip!),
                    if (_incidentsForTrip(_selectedTrip!).isNotEmpty) ...[
                      const SizedBox(height: 12),
                      _DriverIncidentCard(
                        incidents: _incidentsForTrip(_selectedTrip!),
                        busy: _submittingIncidentResolution,
                        onAddCost: (incident) => unawaited(
                          _openIncidentCostSubmission(_selectedTrip!, incident),
                        ),
                        onSubmitResolution: (incident) => unawaited(
                          _openIncidentResolution(_selectedTrip!, incident),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.tonalIcon(
                        onPressed:
                            _submittingManifest ||
                                !_canManageManifest(_selectedTrip!)
                            ? null
                            : () => unawaited(
                                _openDeliveryManifest(_selectedTrip!),
                              ),
                        icon: _submittingManifest
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator.adaptive(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation(
                                    scheme.primary,
                                  ),
                                ),
                              )
                            : const Icon(Icons.inventory_2_outlined),
                        label: Text(
                          _selectedTrip!.allowsDirectCargoInput
                              ? 'Kelola SJ & Barang'
                              : 'Kelola SJ',
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _TripStatusActionsCard(
                      buttonLabel: 'Update Status SJ',
                      helperText: _suratJalanStatusHelperText(_selectedTrip!),
                      enabled: _canUpdateSuratJalanStatus(_selectedTrip!),
                      busy: _updatingBatchStatus,
                      onPressed: () =>
                          unawaited(_openSuratJalanStatus(_selectedTrip!)),
                    ),
                    const SizedBox(height: 12),
                    if (_incidentReportBlockMessage(_selectedTrip!) !=
                        null) ...[
                      _ErrorBanner(
                        icon: Icons.report_problem_outlined,
                        message: _incidentReportBlockMessage(_selectedTrip!)!,
                        isWarning: true,
                      ),
                    ] else ...[
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _reportingIncident
                              ? null
                              : () => unawaited(
                                  _openIncidentReport(_selectedTrip!),
                                ),
                          icon: _reportingIncident
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator.adaptive(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.report_problem_outlined),
                          label: Text(
                            _reportingIncident
                                ? 'Mengirim laporan...'
                                : 'Lapor Insiden',
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 12),
                    if (_locationError != null) ...[
                      _ErrorBanner(
                        icon: Icons.location_off_rounded,
                        message: _locationError!,
                        onRetry: () =>
                            unawaited(_syncAutoTracking(_selectedTrip)),
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (_pingError != null) ...[
                      _ErrorBanner(
                        icon: Icons.cloud_off_rounded,
                        message: _pingError!,
                        isWarning: true,
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (_selectedTrip!.isAwaitingAdminApproval) ...[
                      _ErrorBanner(
                        icon: Icons.admin_panel_settings_rounded,
                        message: _selectedTrip!.hasBlockingAdminApproval
                            ? 'Trip ini menunggu approval admin.'
                            : 'Sebagian SJ menunggu approval admin. SJ lain tetap bisa diajukan selesai.',
                        isWarning: true,
                      ),
                      const SizedBox(height: 12),
                    ],
                    if (_selectedTrip!.isTripClosedByAdmin) ...[
                      const _ErrorBanner(
                        icon: Icons.lock_clock_rounded,
                        message:
                            'Trip sudah ditutup admin. Tambah SJ dan edit muatan dikunci sampai trip dibuka kembali.',
                        isWarning: true,
                      ),
                      const SizedBox(height: 12),
                    ],
                    _TrackingCard(
                      trackingEnabled: _trackingEnabled,
                      location: _latestLocation,
                      pingCount: _pingCount,
                    ),
                    if (_selectedTrip!.status == TripStatus.delivered &&
                        !_selectedTrip!.isAwaitingAdminApproval &&
                        !_selectedTrip!.isTripClosedByAdmin) ...[
                      const SizedBox(height: 12),
                      _CloseTripButton(
                        onPressed: _updatingStatus
                            ? null
                            : () => unawaited(_openTripClosure(_selectedTrip!)),
                      ),
                    ],
                  ],
                ] else ...[
                  _SectionHeader(
                    title: 'Riwayat Bon Uang Jalan',
                    count: _visibleDriverVouchers.length,
                  ),
                  const SizedBox(height: 10),
                  _buildVoucherList(scheme),
                ],
              ],
            ),
          ),
          if (blockingNotice != null)
            Positioned.fill(
              child: ColoredBox(
                color: Colors.black.withValues(alpha: 0.45),
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: Material(
                        color: Colors.white,
                        elevation: 16,
                        borderRadius: BorderRadius.circular(24),
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    width: 48,
                                    height: 48,
                                    decoration: BoxDecoration(
                                      color: blockingNotice.blocking
                                          ? scheme.errorContainer
                                          : scheme.secondaryContainer,
                                      borderRadius: BorderRadius.circular(16),
                                    ),
                                    child: Icon(
                                      blockingNotice.blocking
                                          ? Icons.block_rounded
                                          : Icons.warning_amber_rounded,
                                      color: blockingNotice.blocking
                                          ? scheme.error
                                          : scheme.secondary,
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Text(
                                      blockingNotice.title,
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 16),
                              Text(
                                blockingNotice.message,
                                style: TextStyle(
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.78,
                                  ),
                                  height: 1.5,
                                ),
                              ),
                              const SizedBox(height: 12),
                              Text(
                                blockingNotice.isWarning
                                    ? 'Warning ini hanya tampil satu kali. Setelah ditutup, warning akan hilang dari aplikasi driver.'
                                    : 'Akses akan kembali normal setelah masa skors selesai di server.',
                                style: TextStyle(
                                  color: scheme.onSurface.withValues(
                                    alpha: 0.6,
                                  ),
                                  fontSize: 12,
                                  height: 1.45,
                                ),
                              ),
                              const SizedBox(height: 20),
                              Row(
                                children: [
                                  if (blockingNotice.blocking)
                                    OutlinedButton.icon(
                                      onPressed: () =>
                                          unawaited(_bootstrapPage()),
                                      icon: const Icon(Icons.refresh_rounded),
                                      label: const Text('Refresh'),
                                    ),
                                  const Spacer(),
                                  if (blockingNotice.blocking)
                                    FilledButton.icon(
                                      onPressed: widget.onLogout,
                                      icon: const Icon(Icons.logout_rounded),
                                      label: const Text('Keluar'),
                                    )
                                  else
                                    FilledButton(
                                      onPressed: _acknowledgingWarning
                                          ? null
                                          : () => unawaited(
                                              _closeWarningNotice(),
                                            ),
                                      child: Text(
                                        _acknowledgingWarning
                                            ? 'Memproses...'
                                            : 'Tutup Warning',
                                      ),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          if (actionMessage != null)
            MobileActionOverlay(message: actionMessage),
        ],
      ),
    );
  }

  Widget _buildTripList(ColorScheme scheme) {
    if (_loadingTrips) {
      return const _DriverTripListSkeleton();
    }
    if (_loadError != null) {
      return _ErrorCard(message: _loadError!, onRetry: _loadTrips);
    }
    if (_trips.isEmpty) return const _EmptyCard();
    return Column(
      children: _trips
          .map(
            (trip) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _TripListCard(
                trip: trip,
                isSelected:
                    _selectedTrip?.deliveryOrderId == trip.deliveryOrderId,
                onTap: () => setState(() => _selectedTrip = trip),
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _buildVoucherList(ColorScheme scheme) {
    if (_loadingTrips) {
      return const _DriverVoucherListSkeleton();
    }
    if (_loadError != null) {
      return _ErrorCard(message: _loadError!, onRetry: _loadTrips);
    }
    final vouchers = _visibleDriverVouchers;
    if (vouchers.isEmpty) {
      return const _EmptyCard(
        title: 'Belum ada uang jalan trip',
        message:
            'Bon uang jalan akan muncul setelah admin menerbitkan bon untuk trip kamu.',
      );
    }
    return Column(
      children: vouchers
          .map(
            (voucher) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _DriverVoucherCard(
                voucher: voucher,
                onPreview: () => _openVoucherPreview(voucher),
              ),
            ),
          )
          .toList(growable: false),
    );
  }

  void _openVoucherPreview(DriverTripVoucher voucher) {
    showDialog<void>(
      context: context,
      builder: (context) => _DriverVoucherPreviewDialog(voucher: voucher),
    );
  }
}

// ── Driver card ────────────────────────────────────────────
class _IncidentReportSubmitResult {
  const _IncidentReportSubmitResult({
    required this.incidentType,
    required this.urgency,
    required this.locationText,
    required this.odometer,
    required this.description,
  });

  final String incidentType;
  final String urgency;
  final String locationText;
  final double odometer;
  final String description;
}

class _IncidentResolutionSubmitResult {
  const _IncidentResolutionSubmitResult({
    required this.note,
    required this.locationText,
  });

  final String note;
  final String locationText;
}

class _IncidentCostSubmitResult {
  const _IncidentCostSubmitResult({required this.costs});

  final List<DriverIncidentCostInput> costs;
}

class _IncidentCostDraftController {
  _IncidentCostDraftController();

  String category = 'REPAIR';
  final TextEditingController amount = TextEditingController();
  final TextEditingController description = TextEditingController();
  final TextEditingController payeeName = TextEditingController();
  final TextEditingController note = TextEditingController();

  void dispose() {
    amount.dispose();
    description.dispose();
    payeeName.dispose();
    note.dispose();
  }
}

class _TripClosureSubmitResult {
  const _TripClosureSubmitResult({
    required this.odometerKm,
    required this.note,
  });

  final double odometerKm;
  final String note;
}

class _TripClosureWarning extends StatelessWidget {
  const _TripClosureWarning({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.errorContainer.withValues(alpha: 0.42),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.error.withValues(alpha: 0.24)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, color: scheme.error, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              softWrap: true,
              style: TextStyle(
                color: scheme.onErrorContainer,
                fontSize: 12.5,
                height: 1.35,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

double? _parseOdometerInput(String value) {
  final parsed = parseMobileNumberInput(value);
  if (value.trim().isEmpty) return null;
  return parsed.isNaN || parsed.isInfinite ? null : parsed;
}

double _parseCurrencyInput(String value) {
  final parsed = parseMobileNumberInput(value);
  return parsed.isNaN || parsed.isInfinite ? 0 : parsed;
}

String _formatWholeNumberInput(num? value) =>
    formatMobileNumberValue(value?.roundToDouble(), fractionDigits: 0);

const _jakartaUtcOffset = Duration(hours: 7);
final _dateOnlyPattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

EdgeInsets _keyboardAwareScrollPadding(BuildContext context) {
  return const EdgeInsets.fromLTRB(20, 20, 20, 120);
}

Future<void> _popDialogAfterKeyboardDismiss<T extends Object?>(
  BuildContext context, [
  T? result,
]) async {
  FocusManager.instance.primaryFocus?.unfocus();
  await Future<void>.delayed(const Duration(milliseconds: 150));
  if (!context.mounted) return;
  Navigator.of(context).pop<T>(result);
}

DateTime _toJakartaDateTime(DateTime value) {
  return value.toUtc().add(_jakartaUtcOffset);
}

String _formatJakartaTimeText(DateTime value) {
  final jakarta = _toJakartaDateTime(value);
  String twoDigits(int input) => input.toString().padLeft(2, '0');
  return '${twoDigits(jakarta.hour)}:${twoDigits(jakarta.minute)} WIB';
}

String _formatRupiah(num value) {
  final rounded = value.round().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < rounded.length; index++) {
    final remaining = rounded.length - index;
    buffer.write(rounded[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return 'Rp ${buffer.toString()}';
}

String _formatDateText(String? value) {
  final rawValue = value?.trim();
  if (rawValue == null || rawValue.isEmpty) return '-';
  final dateOnlyMatch = _dateOnlyPattern.firstMatch(rawValue);
  if (dateOnlyMatch != null) {
    return '${dateOnlyMatch.group(3)}/${dateOnlyMatch.group(2)}/${dateOnlyMatch.group(1)}';
  }
  final parsed = DateTime.tryParse(rawValue);
  if (parsed == null) return rawValue;
  final local = _toJakartaDateTime(parsed);
  String twoDigits(int input) => input.toString().padLeft(2, '0');
  return '${twoDigits(local.day)}/${twoDigits(local.month)}/${local.year}';
}

String _textOrDash(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? '-' : trimmed;
}

String _normalizeManifestReference(String? value) =>
    (value ?? '').trim().toUpperCase();

bool _manifestCargoMatchesReference(
  DeliveryCargoItem item,
  DeliveryShipperReference reference,
) {
  final itemKey = (item.shipperReferenceKey ?? '').trim();
  final referenceKey = (reference.key ?? '').trim();
  if (itemKey.isNotEmpty && referenceKey.isNotEmpty) {
    return itemKey == referenceKey;
  }

  final itemNumber = _normalizeManifestReference(item.shipperReferenceNumber);
  final referenceNumber = _normalizeManifestReference(
    reference.referenceNumber,
  );
  if (itemNumber.isNotEmpty && referenceNumber.isNotEmpty) {
    return itemNumber == referenceNumber;
  }

  return itemKey.isEmpty &&
      itemNumber.isEmpty &&
      referenceKey.isEmpty &&
      referenceNumber.isEmpty;
}

String _formatManifestNumber(num value, {int fractionDigits = 2}) {
  final digits = value == value.roundToDouble() ? 0 : fractionDigits;
  return formatMobileNumberValue(value.toDouble(), fractionDigits: digits);
}

String _formatManifestUnit(String? value, String fallback) {
  final normalized = (value ?? fallback).trim().toUpperCase();
  if (normalized == 'M3') return 'm3';
  return normalized.toLowerCase();
}

String _formatManifestCargoSummary({
  num? qtyKoli,
  num? weightKg,
  num? volumeM3,
  num? weightInputValue,
  String? weightInputUnit,
  num? volumeInputValue,
  String? volumeInputUnit,
}) {
  final parts = <String>[];
  if (qtyKoli != null && qtyKoli > 0) {
    parts.add('${_formatManifestNumber(qtyKoli)} koli');
  }

  final displayWeight = weightInputValue ?? weightKg;
  if (displayWeight != null && displayWeight > 0) {
    parts.add(
      '${_formatManifestNumber(displayWeight)} ${_formatManifestUnit(weightInputUnit, 'KG')}',
    );
  }

  final displayVolume = volumeInputValue ?? volumeM3;
  if (displayVolume != null && displayVolume > 0) {
    parts.add(
      '${_formatManifestNumber(displayVolume, fractionDigits: 3)} ${_formatManifestUnit(volumeInputUnit, 'M3')}',
    );
  }

  return parts.isEmpty ? '-' : parts.join(' | ');
}

String _voucherDisbursementLabel(
  DriverTripVoucherDisbursement disbursement,
  int sequence,
) {
  if (disbursement.kind == 'INITIAL' || disbursement.kind == 'TOP_UP') {
    return formatDriverTripVoucherBonLabel(sequence);
  }
  return disbursement.kind;
}

String _voucherDisbursementSummary(DriverTripVoucher voucher) {
  final totalDisbursements = voucher.disbursements.length;
  if (totalDisbursements == 0) return 'Detail pencairan belum tersedia';
  final topUpCount = voucher.disbursements
      .where((item) => item.kind == 'TOP_UP')
      .length;
  if (topUpCount == 0) return '1 pencairan dalam bon ini';
  return '$totalDisbursements pencairan dalam bon ini';
}

String _voucherPdfFileName(DriverTripVoucher voucher) {
  final safeBon = voucher.bonNumber.replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_');
  return 'uang-jalan-$safeBon.pdf';
}

pw.Widget _pdfKeyValue(String label, String value) {
  return pw.Padding(
    padding: const pw.EdgeInsets.only(bottom: 6),
    child: pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.SizedBox(
          width: 105,
          child: pw.Text(
            label,
            style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
          ),
        ),
        pw.Expanded(child: pw.Text(value)),
      ],
    ),
  );
}

pw.TableRow _pdfTableHeader(List<String> cells) {
  return pw.TableRow(
    decoration: const pw.BoxDecoration(color: PdfColor.fromInt(0xFFEFF4FA)),
    children: cells
        .map(
          (cell) => pw.Padding(
            padding: const pw.EdgeInsets.all(6),
            child: pw.Text(
              cell,
              style: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 9),
            ),
          ),
        )
        .toList(growable: false),
  );
}

pw.TableRow _pdfTableRow(List<String> cells) {
  return pw.TableRow(
    children: cells
        .map(
          (cell) => pw.Padding(
            padding: const pw.EdgeInsets.all(6),
            child: pw.Text(cell, style: const pw.TextStyle(fontSize: 9)),
          ),
        )
        .toList(growable: false),
  );
}

Future<Uint8List> _buildDriverVoucherPdf(DriverTripVoucher voucher) async {
  final document = pw.Document();
  final disbursements = voucher.disbursements;
  final expenses = voucher.items;

  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (context) => [
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'PT Gading Mas Surya',
                  style: pw.TextStyle(
                    fontSize: 18,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.SizedBox(height: 4),
                pw.Text('Uang Jalan Trip ${voucher.bonNumber}'),
              ],
            ),
            pw.Text(
              'Dicetak: ${_formatDateText(DateTime.now().toUtc().toIso8601String())}',
            ),
          ],
        ),
        pw.SizedBox(height: 14),
        pw.Divider(thickness: 1.2),
        pw.SizedBox(height: 14),
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  _pdfKeyValue('No. Bon', voucher.bonNumber),
                  _pdfKeyValue('Tanggal', _formatDateText(voucher.issuedDate)),
                  _pdfKeyValue('No. DO', _textOrDash(voucher.doNumber)),
                  _pdfKeyValue('Kendaraan', _textOrDash(voucher.vehiclePlate)),
                  _pdfKeyValue('Rute', _textOrDash(voucher.route)),
                  _pdfKeyValue('Status', voucher.statusLabel),
                ],
              ),
            ),
            pw.SizedBox(width: 18),
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  _pdfKeyValue(
                    'Total Uang',
                    _formatRupiah(voucher.totalIssuedAmount),
                  ),
                  _pdfKeyValue(
                    'Biaya Lain-lain',
                    _formatRupiah(voucher.operationalSpent),
                  ),
                  _pdfKeyValue(
                    'Sisa Bon',
                    _formatRupiah(voucher.operationalBalance),
                  ),
                  _pdfKeyValue(
                    'Upah Borongan',
                    _formatRupiah(voucher.driverFeeAmount),
                  ),
                  _pdfKeyValue(
                    voucher.settlementDisplayLabel,
                    _formatRupiah(voucher.netSettlementAmount.abs()),
                  ),
                ],
              ),
            ),
          ],
        ),
        pw.SizedBox(height: 18),
        pw.Text(
          'Riwayat Pencairan Uang Jalan',
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
        ),
        pw.SizedBox(height: 8),
        pw.Table(
          border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFFD6DEE8)),
          columnWidths: const {
            0: pw.FixedColumnWidth(28),
            1: pw.FixedColumnWidth(70),
            2: pw.FlexColumnWidth(),
            3: pw.FlexColumnWidth(),
            4: pw.FlexColumnWidth(),
            5: pw.FixedColumnWidth(78),
          },
          children: [
            _pdfTableHeader([
              'No',
              'Tanggal',
              'Jenis',
              'Sumber Dana',
              'Catatan',
              'Jumlah',
            ]),
            if (disbursements.isEmpty)
              _pdfTableRow(['-', '-', 'Belum ada riwayat bon', '-', '-', '-'])
            else
              ...(() {
                return disbursements.indexed.map((entry) {
                  final index = entry.$1;
                  final item = entry.$2;
                  return _pdfTableRow([
                    '${index + 1}',
                    _formatDateText(item.date),
                    _voucherDisbursementLabel(item, index + 1),
                    _textOrDash(item.bankAccountName),
                    _textOrDash(item.note),
                    _formatRupiah(item.amount),
                  ]);
                });
              })(),
          ],
        ),
        pw.SizedBox(height: 18),
        pw.Text(
          'Biaya Lain-lain',
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
        ),
        pw.SizedBox(height: 8),
        pw.Table(
          border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFFD6DEE8)),
          columnWidths: const {
            0: pw.FixedColumnWidth(28),
            1: pw.FixedColumnWidth(70),
            2: pw.FlexColumnWidth(),
            3: pw.FlexColumnWidth(),
            4: pw.FixedColumnWidth(78),
          },
          children: [
            _pdfTableHeader([
              'No',
              'Tanggal',
              'Kategori',
              'Deskripsi',
              'Jumlah',
            ]),
            if (expenses.isEmpty)
              _pdfTableRow(['-', '-', 'Tidak ada biaya lain-lain', '-', '-'])
            else
              ...expenses.indexed.map((entry) {
                final index = entry.$1;
                final item = entry.$2;
                return _pdfTableRow([
                  '${index + 1}',
                  _formatDateText(item.expenseDate),
                  item.category,
                  _textOrDash(item.description),
                  _formatRupiah(item.amount),
                ]);
              }),
          ],
        ),
      ],
    ),
  );

  return document.save();
}

class _SuratJalanStatusSelection {
  const _SuratJalanStatusSelection({
    required this.status,
    required this.targetSuratJalanRefs,
  });

  final TripStatus status;
  final List<String> targetSuratJalanRefs;
}

String _incidentStatusLabel(String status) {
  return switch (status) {
    'OPEN' => 'Dilaporkan',
    'IN_PROGRESS' => 'Ditangani',
    'RESOLVED' => 'Selesai, review admin',
    'CLOSED' => 'Ditutup',
    _ => status,
  };
}

String _incidentCostCategoryLabel(String category) {
  return switch (category) {
    'REPAIR' => 'Perbaikan',
    'SPAREPART' => 'Sparepart',
    'TIRE' => 'Ban',
    'TOWING' => 'Derek / Evakuasi',
    'MEDICAL' => 'Medis',
    'ADMINISTRATION' => 'Administrasi',
    'POLICE_ADMIN' => 'Administrasi',
    'ACCOMMODATION' => 'Akomodasi',
    'CARGO_HANDLING' => 'Bongkar / Handling',
    'THIRD_PARTY_DAMAGE' => 'Kerusakan Pihak Ketiga',
    'OTHER' => 'Lainnya',
    _ => category,
  };
}

String _formatKm(num value) {
  final rounded = value.round().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < rounded.length; index++) {
    final remaining = rounded.length - index;
    buffer.write(rounded[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return buffer.toString();
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({
    required this.session,
    required this.tripCount,
    this.onTap,
  });
  final DriverAppSession session;
  final int tripCount;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final compact = MediaQuery.sizeOf(context).width < 380;
    final tripLabel = tripCount == 1 ? '1 trip' : '$tripCount trip';
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: EdgeInsets.all(compact ? 14 : 16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: compact ? 42 : 46,
                height: compact ? 42 : 46,
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  Icons.person_pin_circle_rounded,
                  color: scheme.primary,
                  size: compact ? 22 : 24,
                ),
              ),
              SizedBox(width: compact ? 12 : 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      session.driverName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: compact ? 14 : 15,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      session.role,
                      style: TextStyle(
                        color: scheme.onSurface.withValues(alpha: 0.5),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Container(
                padding: EdgeInsets.symmetric(
                  horizontal: compact ? 10 : 12,
                  vertical: compact ? 5 : 6,
                ),
                decoration: BoxDecoration(
                  color: scheme.primaryContainer,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  tripLabel,
                  style: TextStyle(
                    color: scheme.primary,
                    fontWeight: FontWeight.w700,
                    fontSize: compact ? 12 : 13,
                  ),
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: scheme.onSurface.withValues(alpha: 0.35),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Section header ─────────────────────────────────────────
class _DriverSectionSwitcher extends StatelessWidget {
  const _DriverSectionSwitcher({
    required this.activeSection,
    required this.tripCount,
    required this.voucherCount,
    required this.onChanged,
  });

  final _DriverHomeSection activeSection;
  final int tripCount;
  final int voucherCount;
  final ValueChanged<_DriverHomeSection> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    Widget buildButton({
      required _DriverHomeSection section,
      required IconData icon,
      required String label,
      required int count,
    }) {
      final selected = activeSection == section;
      final content = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 8),
          Flexible(child: Text('$label ($count)')),
        ],
      );
      final shape = RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
      );

      return Expanded(
        child: selected
            ? FilledButton(
                onPressed: () => onChanged(section),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: shape,
                ),
                child: content,
              )
            : OutlinedButton(
                onPressed: () => onChanged(section),
                style: OutlinedButton.styleFrom(
                  foregroundColor: scheme.onSurface,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: shape,
                ),
                child: content,
              ),
      );
    }

    return Row(
      children: [
        buildButton(
          section: _DriverHomeSection.trips,
          icon: Icons.local_shipping_outlined,
          label: 'Cek Trip',
          count: tripCount,
        ),
        const SizedBox(width: 10),
        buildButton(
          section: _DriverHomeSection.vouchers,
          icon: Icons.account_balance_wallet_outlined,
          label: 'Uang Jalan',
          count: voucherCount,
        ),
      ],
    );
  }
}

class _DriverTripListSkeleton extends StatelessWidget {
  const _DriverTripListSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: const [
        _DriverTripSkeletonCard(),
        SizedBox(height: 10),
        _DriverTripSkeletonCard(),
        SizedBox(height: 10),
        _DriverTripSkeletonCard(compact: true),
      ],
    );
  }
}

class _DriverVoucherListSkeleton extends StatelessWidget {
  const _DriverVoucherListSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: const [
        _DriverVoucherSkeletonCard(),
        SizedBox(height: 10),
        _DriverVoucherSkeletonCard(),
      ],
    );
  }
}

class _DriverTripSkeletonCard extends StatelessWidget {
  const _DriverTripSkeletonCard({this.compact = false});

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
              children: const [
                _DriverSkeletonBlock(width: 44, height: 44, radius: 14),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _DriverSkeletonBlock(width: 170, height: 16, radius: 8),
                      SizedBox(height: 8),
                      _DriverSkeletonBlock(width: 220, height: 12, radius: 8),
                    ],
                  ),
                ),
                SizedBox(width: 10),
                _DriverSkeletonBlock(width: 74, height: 28, radius: 999),
              ],
            ),
            const SizedBox(height: 16),
            const _DriverSkeletonBlock(
              width: double.infinity,
              height: 12,
              radius: 8,
            ),
            const SizedBox(height: 8),
            _DriverSkeletonBlock(
              width: compact ? 180 : 260,
              height: 12,
              radius: 8,
            ),
          ],
        ),
      ),
    );
  }
}

class _DriverVoucherSkeletonCard extends StatelessWidget {
  const _DriverVoucherSkeletonCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const [
            Row(
              children: [
                _DriverSkeletonBlock(width: 42, height: 42, radius: 14),
                SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _DriverSkeletonBlock(width: 160, height: 15, radius: 8),
                      SizedBox(height: 8),
                      _DriverSkeletonBlock(width: 120, height: 12, radius: 8),
                    ],
                  ),
                ),
                _DriverSkeletonBlock(width: 86, height: 28, radius: 999),
              ],
            ),
            SizedBox(height: 16),
            _DriverSkeletonBlock(width: double.infinity, height: 12, radius: 8),
            SizedBox(height: 8),
            _DriverSkeletonBlock(width: 210, height: 12, radius: 8),
          ],
        ),
      ),
    );
  }
}

class _DriverSkeletonBlock extends StatelessWidget {
  const _DriverSkeletonBlock({
    required this.width,
    required this.height,
    required this.radius,
  });

  final double width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      width: width,
      height: height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(radius),
          gradient: LinearGradient(
            colors: [
              scheme.surfaceContainerHighest.withValues(alpha: 0.72),
              scheme.surfaceContainerHighest.withValues(alpha: 0.38),
              scheme.surfaceContainerHighest.withValues(alpha: 0.72),
            ],
            stops: const [0.05, 0.48, 0.95],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
      ),
    );
  }
}

class _DriverVoucherCard extends StatelessWidget {
  const _DriverVoucherCard({required this.voucher, required this.onPreview});

  final DriverTripVoucher voucher;
  final VoidCallback onPreview;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final settlementColor = voucher.netSettlementAmount < 0
        ? scheme.error
        : scheme.primary;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    Icons.account_balance_wallet_outlined,
                    color: scheme.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        voucher.bonNumber,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'DO ${_textOrDash(voucher.doNumber)} | ${_formatDateText(voucher.issuedDate)}',
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.62),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    voucher.statusLabel,
                    style: TextStyle(
                      color: scheme.secondary,
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.42),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                _voucherDisbursementSummary(voucher),
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.74),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 12),
            _VoucherInfoGrid(
              items: [
                _VoucherInfoItem(
                  label: 'Total Uang',
                  value: _formatRupiah(voucher.totalIssuedAmount),
                ),
                _VoucherInfoItem(
                  label: 'Biaya Lain-lain',
                  value: _formatRupiah(voucher.operationalSpent),
                ),
                _VoucherInfoItem(
                  label: 'Upah Borongan',
                  value: _formatRupiah(voucher.driverFeeAmount),
                ),
                _VoucherInfoItem(
                  label: voucher.settlementDisplayLabel,
                  value: _formatRupiah(voucher.netSettlementAmount.abs()),
                  color: settlementColor,
                  caption: voucher.settlementLabel,
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: onPreview,
                icon: const Icon(Icons.print_outlined, size: 18),
                label: const Text('Preview / PDF'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VoucherInfoItem {
  const _VoucherInfoItem({
    required this.label,
    required this.value,
    this.color,
    this.caption,
  });

  final String label;
  final String value;
  final Color? color;
  final String? caption;
}

class _VoucherInfoGrid extends StatelessWidget {
  const _VoucherInfoGrid({required this.items});

  final List<_VoucherInfoItem> items;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        final twoColumns = constraints.maxWidth >= 440;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: items
              .map(
                (item) => SizedBox(
                  width: twoColumns
                      ? (constraints.maxWidth - 10) / 2
                      : constraints.maxWidth,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest.withValues(
                        alpha: 0.42,
                      ),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: scheme.outlineVariant.withValues(alpha: 0.75),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.label,
                          style: TextStyle(
                            color: scheme.onSurface.withValues(alpha: 0.58),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          item.value,
                          softWrap: true,
                          overflow: TextOverflow.visible,
                          style: TextStyle(
                            color: item.color ?? scheme.onSurface,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (item.caption?.trim().isNotEmpty == true) ...[
                          const SizedBox(height: 3),
                          Text(
                            item.caption!,
                            style: TextStyle(
                              color: scheme.onSurface.withValues(alpha: 0.55),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              )
              .toList(growable: false),
        );
      },
    );
  }
}

class _DriverVoucherPreviewDialog extends StatelessWidget {
  const _DriverVoucherPreviewDialog({required this.voucher});

  final DriverTripVoucher voucher;

  Future<void> _downloadPdf(BuildContext context) async {
    try {
      final bytes = await _buildDriverVoucherPdf(voucher);
      await Printing.sharePdf(
        bytes: bytes,
        filename: _voucherPdfFileName(voucher),
      );
    } catch (error) {
      if (!context.mounted) return;
      showMobileFeedback(
        context,
        type: MobileFeedbackType.error,
        message: 'Gagal membuat PDF: $error',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Dialog(
      insetPadding: const EdgeInsets.all(18),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Preview Uang Jalan',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          voucher.bonNumber,
                          style: TextStyle(
                            color: scheme.onSurface.withValues(alpha: 0.62),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _VoucherInfoGrid(
                      items: [
                        _VoucherInfoItem(
                          label: 'DO',
                          value: _textOrDash(voucher.doNumber),
                        ),
                        _VoucherInfoItem(
                          label: 'Tanggal',
                          value: _formatDateText(voucher.issuedDate),
                        ),
                        _VoucherInfoItem(
                          label: 'Kendaraan',
                          value: _textOrDash(voucher.vehiclePlate),
                        ),
                        _VoucherInfoItem(
                          label: 'Rute',
                          value: _textOrDash(voucher.route),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Ringkasan',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 10),
                    _VoucherSummaryLine(
                      label: 'Total uang diberikan',
                      value: _formatRupiah(voucher.totalIssuedAmount),
                    ),
                    _VoucherSummaryLine(
                      label: 'Biaya lain-lain',
                      value: _formatRupiah(voucher.operationalSpent),
                    ),
                    _VoucherSummaryLine(
                      label: 'Sisa bon operasional',
                      value: _formatRupiah(voucher.operationalBalance),
                    ),
                    _VoucherSummaryLine(
                      label: 'Upah borongan',
                      value: _formatRupiah(voucher.driverFeeAmount),
                    ),
                    _VoucherSummaryLine(
                      label: voucher.settlementDisplayLabel,
                      value: _formatRupiah(voucher.netSettlementAmount.abs()),
                    ),
                    const SizedBox(height: 18),
                    _VoucherHistorySection(voucher: voucher),
                  ],
                ),
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Tutup'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () => _downloadPdf(context),
                      icon: const Icon(Icons.download_rounded, size: 18),
                      label: const Text('Download PDF'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VoucherSummaryLine extends StatelessWidget {
  const _VoucherSummaryLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              softWrap: true,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.64),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              softWrap: true,
              overflow: TextOverflow.visible,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _VoucherHistorySection extends StatelessWidget {
  const _VoucherHistorySection({required this.voucher});

  final DriverTripVoucher voucher;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Detail pencairan bon ini',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        if (voucher.disbursements.isEmpty)
          Text(
            'Belum ada riwayat bon.',
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.56)),
          )
        else
          ...(() {
            return voucher.disbursements.indexed.map((entry) {
              final sequence = entry.$1 + 1;
              final item = entry.$2;
              return _VoucherHistoryRow(
                title: _voucherDisbursementLabel(item, sequence),
                subtitle:
                    '${_formatDateText(item.date)} | ${_textOrDash(item.bankAccountName)}',
                amount: _formatRupiah(item.amount),
              );
            });
          })(),
        const SizedBox(height: 16),
        const Text(
          'Biaya lain-lain',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        if (voucher.items.isEmpty)
          Text(
            'Tidak ada biaya lain-lain.',
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.56)),
          )
        else
          ...voucher.items.map(
            (item) => _VoucherHistoryRow(
              title: item.category,
              subtitle:
                  '${_formatDateText(item.expenseDate)} | ${_textOrDash(item.description)}',
              amount: _formatRupiah(item.amount),
            ),
          ),
      ],
    );
  }
}

class _VoucherHistoryRow extends StatelessWidget {
  const _VoucherHistoryRow({
    required this.title,
    required this.subtitle,
    required this.amount,
  });

  final String title;
  final String subtitle;
  final String amount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.34),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.58),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              amount,
              textAlign: TextAlign.right,
              softWrap: true,
              overflow: TextOverflow.visible,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, this.count});
  final String title;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            color: scheme.onSurface,
            fontSize: 15,
            fontWeight: FontWeight.w700,
          ),
        ),
        if (count != null) ...[
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                color: scheme.primary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ── Trip list card ─────────────────────────────────────────
class _TripListCard extends StatelessWidget {
  const _TripListCard({
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
                _StatusChip(status: trip.status, prefix: 'Trip'),
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

// ── Trip detail card ───────────────────────────────────────
class _PlannedTripCard extends StatelessWidget {
  const _PlannedTripCard({
    required this.tripPlan,
    required this.busy,
    required this.onPressed,
  });

  final DriverAssignedTripPlan tripPlan;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final pickupSummary = tripPlan.pickupStops.isEmpty
        ? 'Pickup belum diset'
        : tripPlan.pickupStops.map((pickup) => pickup.displayLabel).join(', ');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  tripPlan.tripLabel,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    tripPlan.allowsDirectCargoInput ? 'SJ & Barang' : 'SJ',
                    style: TextStyle(
                      color: scheme.primary,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${tripPlan.customerName ?? 'Tanpa customer'} | ${tripPlan.vehiclePlate ?? '-'}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              pickupSummary,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.72),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonalIcon(
                onPressed: busy ? null : onPressed,
                icon: busy
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator.adaptive(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation(scheme.primary),
                        ),
                      )
                    : const Icon(Icons.note_add_outlined),
                label: Text(
                  tripPlan.allowsDirectCargoInput
                      ? 'Buat SJ & Barang'
                      : 'Buat SJ',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ManifestSummaryCard extends StatelessWidget {
  const _ManifestSummaryCard({required this.trip});

  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final shipperRefs = trip.shipperReferences;
    final orphanCargoItems = trip.cargoItems
        .where(
          (item) => !shipperRefs.any(
            (shipperRef) => _manifestCargoMatchesReference(item, shipperRef),
          ),
        )
        .toList(growable: false);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Manifest',
                  style: TextStyle(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${shipperRefs.length} SJ',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.72),
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (shipperRefs.isEmpty && trip.cargoItems.isEmpty)
              Text(
                'Belum ada SJ tercatat untuk DO ini.',
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.58),
                  fontSize: 13,
                ),
              )
            else
              Column(
                children: [
                  ...shipperRefs.map((shipperRef) {
                    final status =
                        shipperRef.tripStatus?.trim().isNotEmpty == true
                        ? shipperRef.tripStatus!.trim()
                        : deliveryStatusApiValue(trip.status);
                    final cargoItems = trip.cargoItems
                        .where(
                          (item) =>
                              _manifestCargoMatchesReference(item, shipperRef),
                        )
                        .toList(growable: false);
                    return _ManifestReferenceAccordion(
                      referenceNumber: shipperRef.referenceNumber,
                      status: status,
                      targetLabel: shipperRef.targetLabel.trim(),
                      pickupAddress: shipperRef.pickupAddress?.trim() ?? '',
                      cargoItems: cargoItems,
                      initiallyExpanded: shipperRefs.length <= 2,
                    );
                  }),
                  if (orphanCargoItems.isNotEmpty)
                    _ManifestReferenceAccordion(
                      referenceNumber: 'Barang tanpa SJ',
                      status: deliveryStatusApiValue(trip.status),
                      targetLabel: '',
                      pickupAddress: '',
                      cargoItems: orphanCargoItems,
                      initiallyExpanded: true,
                    ),
                ],
              ),
            const SizedBox(height: 10),
            Text(
              trip.allowsDirectCargoInput
                  ? '${trip.cargoItems.length} barang sudah tercatat di DO ini.'
                  : 'Muatan mengikuti order/resi. Driver cukup kelola nomor SJ dan pickup yang dibawa.',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 12.5,
                height: 1.4,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ManifestReferenceAccordion extends StatelessWidget {
  const _ManifestReferenceAccordion({
    required this.referenceNumber,
    required this.status,
    required this.targetLabel,
    required this.pickupAddress,
    required this.cargoItems,
    required this.initiallyExpanded,
  });

  final String referenceNumber;
  final String status;
  final String targetLabel;
  final String pickupAddress;
  final List<DeliveryCargoItem> cargoItems;
  final bool initiallyExpanded;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final plannedSummary = _formatManifestCargoSummary(
      qtyKoli: cargoItems.fold<num>(
        0,
        (sum, item) => sum + (item.qtyKoli ?? 0),
      ),
      weightKg: cargoItems.fold<num>(
        0,
        (sum, item) => sum + (item.weightKg ?? 0),
      ),
      volumeM3: cargoItems.fold<num>(
        0,
        (sum, item) => sum + (item.volumeM3 ?? 0),
      ),
    );

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.32)),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          tilePadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          title: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                referenceNumber,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
              _SuratJalanStatusChip(status: status),
            ],
          ),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${cargoItems.length} barang | Rencana: $plannedSummary',
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.68),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (targetLabel.isNotEmpty && targetLabel != '-') ...[
                  const SizedBox(height: 4),
                  Text(
                    targetLabel,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.72),
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
                if (pickupAddress.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    pickupAddress,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.58),
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ],
            ),
          ),
          children: cargoItems.isEmpty
              ? [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Belum ada barang tercatat untuk SJ ini.',
                      style: TextStyle(
                        color: scheme.onSurface.withValues(alpha: 0.58),
                        fontSize: 12.5,
                      ),
                    ),
                  ),
                ]
              : cargoItems
                    .map((item) => _ManifestCargoItemTile(item: item))
                    .toList(growable: false),
        ),
      ),
    );
  }
}

class _ManifestCargoItemTile extends StatelessWidget {
  const _ManifestCargoItemTile({required this.item});

  final DeliveryCargoItem item;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final plannedSummary = _formatManifestCargoSummary(
      qtyKoli: item.qtyKoli,
      weightKg: item.weightKg,
      volumeM3: item.volumeM3,
      weightInputValue: item.weightInputValue,
      weightInputUnit: item.weightInputUnit,
      volumeInputValue: item.volumeInputValue,
      volumeInputUnit: item.volumeInputUnit,
    );
    final hasActual =
        item.actualQtyKoli != null ||
        item.actualWeightInputValue != null ||
        item.actualVolumeInputValue != null;
    final actualSummary = hasActual
        ? _formatManifestCargoSummary(
            qtyKoli: item.actualQtyKoli,
            weightInputValue: item.actualWeightInputValue,
            weightInputUnit: item.actualWeightInputUnit,
            volumeInputValue: item.actualVolumeInputValue,
            volumeInputUnit: item.actualVolumeInputUnit,
          )
        : 'Belum final';

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item.description.trim().isEmpty ? '-' : item.description.trim(),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
          if ((item.pickupAddress ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              item.pickupAddress!.trim(),
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 11,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
          const SizedBox(height: 6),
          Text(
            'Rencana: $plannedSummary',
            style: TextStyle(
              color: scheme.onSurface.withValues(alpha: 0.68),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Aktual final: $actualSummary',
            style: TextStyle(
              color: hasActual
                  ? scheme.primary
                  : scheme.onSurface.withValues(alpha: 0.5),
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _TripStatusActionsCard extends StatelessWidget {
  const _TripStatusActionsCard({
    required this.buttonLabel,
    required this.helperText,
    required this.enabled,
    required this.busy,
    required this.onPressed,
  });

  final String buttonLabel;
  final String helperText;
  final bool enabled;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final helperStyle = TextStyle(
      color: scheme.onSurface.withValues(alpha: 0.58),
      fontSize: 12.5,
      height: 1.35,
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Update Status SJ',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 4),
            Text(
              'Pilih status tujuan dan SJ yang akan diupdate.',
              style: helperStyle,
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: enabled && !busy ? onPressed : null,
                icon: busy
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator.adaptive(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation(scheme.onPrimary),
                        ),
                      )
                    : const Icon(Icons.sync_alt_rounded),
                label: Text(buttonLabel),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  textStyle: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(helperText, style: helperStyle),
          ],
        ),
      ),
    );
  }
}

class _DriverIncidentCard extends StatelessWidget {
  const _DriverIncidentCard({
    required this.incidents,
    required this.busy,
    required this.onAddCost,
    required this.onSubmitResolution,
  });

  final List<DriverIncident> incidents;
  final bool busy;
  final void Function(DriverIncident incident) onAddCost;
  final void Function(DriverIncident incident) onSubmitResolution;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final actionIncident = incidents.firstWhereOrNull(
      (incident) => incident.canOpenResolutionForm,
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.report_problem_outlined,
                  color: scheme.error,
                  size: 18,
                ),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Insiden Aktif',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                Text(
                  '${incidents.length}',
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.58),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ...incidents.map((incident) {
              final draftTotal = incident.settlementLines
                  .where((line) => line.status == 'DRAFT')
                  .fold<num>(0, (sum, line) => sum + line.amount);
              final draftInfo = incident.draftCostCount > 0
                  ? ' | ${incident.draftCostCount} biaya draft ${_formatRupiah(draftTotal)}'
                  : '';
              return Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.errorContainer.withValues(alpha: 0.28),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: scheme.error.withValues(alpha: 0.24),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${incident.incidentNumber} | ${_incidentStatusLabel(incident.status)}$draftInfo',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
                    if (incident.locationText.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        incident.locationText,
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.62),
                          fontSize: 12.5,
                        ),
                      ),
                    ],
                    if (incident.description.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        incident.description,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5),
                      ),
                    ],
                    if (incident.canOpenResolutionForm) ...[
                      const SizedBox(height: 10),
                      if (incident.canAddResolutionCost) ...[
                        Text(
                          'Penyelesaian sudah diajukan. Tambahkan biaya baru sebelum admin review bila ada perubahan.',
                          style: TextStyle(
                            color: scheme.onSurface.withValues(alpha: 0.62),
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                    if (!incident.canOpenResolutionForm &&
                        incident.hasSubmittedResolution) ...[
                      const SizedBox(height: 10),
                      Text(
                        incident.isWaitingResolutionReview
                            ? 'Penyelesaian sudah diajukan. Menunggu review admin.'
                            : incident.status == 'RESOLVED' ||
                                  incident.status == 'CLOSED'
                            ? 'Penyelesaian sudah disetujui admin.'
                            : incident.hasPostedResolution
                            ? 'Biaya insiden sudah masuk uang jalan. Tunggu admin menyelesaikan status insiden.'
                            : 'Pengajuan penyelesaian sudah direview admin. Tunggu admin menyelesaikan status insiden.',
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.62),
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
              );
            }),
            if (actionIncident != null) ...[
              const SizedBox(height: 12),
              if (actionIncident.canAddResolutionCost) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.tonalIcon(
                    onPressed: busy ? null : () => onAddCost(actionIncident),
                    icon: busy
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator.adaptive(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation(
                                scheme.primary,
                              ),
                            ),
                          )
                        : const Icon(Icons.receipt_long_rounded),
                    label: Text(busy ? 'Mengirim...' : 'Tambah Biaya Insiden'),
                  ),
                ),
              ],
              if (actionIncident.canAddResolutionCost &&
                  actionIncident.canSubmitResolution)
                const SizedBox(height: 8),
              if (actionIncident.canSubmitResolution)
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: busy
                        ? null
                        : () => onSubmitResolution(actionIncident),
                    icon: busy
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator.adaptive(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation(
                                scheme.onPrimary,
                              ),
                            ),
                          )
                        : const Icon(Icons.task_alt_rounded),
                    label: Text(
                      busy ? 'Mengirim...' : 'Ajukan Selesai Insiden',
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _IncidentCostInputCard extends StatefulWidget {
  const _IncidentCostInputCard({
    super.key,
    required this.row,
    required this.index,
    required this.onRemove,
  });

  final _IncidentCostDraftController row;
  final int index;
  final VoidCallback onRemove;

  @override
  State<_IncidentCostInputCard> createState() => _IncidentCostInputCardState();
}

class _IncidentCostInputCardState extends State<_IncidentCostInputCard> {
  static const _categoryOptions = [
    'REPAIR',
    'SPAREPART',
    'TIRE',
    'TOWING',
    'MEDICAL',
    'ADMINISTRATION',
    'ACCOMMODATION',
    'CARGO_HANDLING',
    'THIRD_PARTY_DAMAGE',
    'OTHER',
  ];

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.48),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.24)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Biaya ${widget.index + 1}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              IconButton(
                onPressed: widget.onRemove,
                icon: const Icon(Icons.delete_outline_rounded),
                tooltip: 'Hapus biaya',
              ),
            ],
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: widget.row.category,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Kategori'),
            items: _categoryOptions
                .map(
                  (category) => DropdownMenuItem(
                    value: category,
                    child: Text(
                      _incidentCostCategoryLabel(category),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                )
                .toList(growable: false),
            onChanged: (value) {
              if (value == null) return;
              setState(() => widget.row.category = value);
            },
          ),
          const SizedBox(height: 10),
          TextField(
            controller: widget.row.amount,
            keyboardType: mobileNumberKeyboardType(0),
            inputFormatters: mobileNumberInputFormatters(0),
            scrollPadding: _keyboardAwareScrollPadding(context),
            decoration: const InputDecoration(
              labelText: 'Nominal',
              prefixText: 'Rp ',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: widget.row.description,
            minLines: 2,
            maxLines: 3,
            scrollPadding: _keyboardAwareScrollPadding(context),
            decoration: const InputDecoration(
              labelText: 'Deskripsi Biaya',
              hintText: 'Contoh: tambal ban / derek / sparepart',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: widget.row.payeeName,
            scrollPadding: _keyboardAwareScrollPadding(context),
            decoration: const InputDecoration(labelText: 'Dibayar ke'),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: widget.row.note,
            minLines: 1,
            maxLines: 3,
            scrollPadding: _keyboardAwareScrollPadding(context),
            decoration: const InputDecoration(labelText: 'Catatan'),
          ),
        ],
      ),
    );
  }
}

class _TripDetailCard extends StatelessWidget {
  const _TripDetailCard({required this.trip});
  final DeliveryTrip trip;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
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
                _StatusChip(status: trip.status, prefix: 'Trip'),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${trip.originLabel} -> ${trip.destinationLabel}',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.7),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _DetailTile(
                  icon: Icons.business_rounded,
                  label: 'Customer',
                  value: trip.customerName,
                ),
                _DetailTile(
                  icon: Icons.local_shipping_rounded,
                  label: 'Kendaraan',
                  value: trip.vehiclePlate,
                ),
                if (trip.receiverName != null)
                  _DetailTile(
                    icon: Icons.person_rounded,
                    label: 'Penerima',
                    value: trip.receiverName!,
                  ),
                _DetailTile(
                  icon: Icons.calendar_today_rounded,
                  label: 'Tanggal',
                  value: trip.etdLabel,
                ),
              ],
            ),
            if (trip.itemSummary != null && trip.itemSummary!.isNotEmpty) ...[
              const SizedBox(height: 12),
              _DetailNote(
                icon: Icons.notes_rounded,
                label: 'Catatan',
                value: trip.itemSummary!,
              ),
            ],
            if (trip.hasRejectedDriverRequestNotice) ...[
              const SizedBox(height: 12),
              _DetailNote(
                icon: Icons.warning_amber_rounded,
                label: 'Permintaan Driver Ditolak',
                value: trip.rejectedRequestNote!.trim(),
                tone: _DetailNoteTone.warning,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DetailTile extends StatelessWidget {
  const _DetailTile({
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
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 140, maxWidth: 220),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: scheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: scheme.outline.withValues(alpha: 0.4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 15, color: scheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.5),
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: const TextStyle(fontSize: 13),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum _DetailNoteTone { neutral, warning }

class _DetailNote extends StatelessWidget {
  const _DetailNote({
    required this.icon,
    required this.label,
    required this.value,
    this.tone = _DetailNoteTone.neutral,
  });

  final IconData icon;
  final String label;
  final String value;
  final _DetailNoteTone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: tone == _DetailNoteTone.warning
            ? scheme.errorContainer.withValues(alpha: 0.45)
            : scheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: tone == _DetailNoteTone.warning
              ? scheme.error.withValues(alpha: 0.35)
              : scheme.outline.withValues(alpha: 0.4),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 15,
            color: tone == _DetailNoteTone.warning
                ? scheme.error
                : scheme.primary,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.5),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Tracking card ──────────────────────────────────────────
class _TrackingCard extends StatelessWidget {
  const _TrackingCard({
    required this.trackingEnabled,
    required this.location,
    required this.pingCount,
  });

  final bool trackingEnabled;
  final LocationSnapshot? location;
  final int pingCount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: trackingEnabled
                        ? scheme.primaryContainer
                        : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    trackingEnabled
                        ? Icons.sensors_rounded
                        : Icons.sensors_off_rounded,
                    color: trackingEnabled
                        ? scheme.primary
                        : scheme.onSurface.withValues(alpha: 0.3),
                    size: 18,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        trackingEnabled
                            ? 'Tracking aktif'
                            : 'Tracking nonaktif',
                        style: TextStyle(
                          color: trackingEnabled
                              ? scheme.primary
                              : scheme.onSurface,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        trackingEnabled
                            ? '$pingCount ping terkirim'
                            : 'Aktif otomatis saat ada trip aktif',
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.5),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                _AutoBadge(active: trackingEnabled),
              ],
            ),
            if (location != null) ...[
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: scheme.outline.withValues(alpha: 0.4),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        _StatMini(
                          label: 'Terakhir',
                          value: _formatJakartaTimeText(location!.recordedAt),
                        ),
                        _StatMini(
                          label: 'Kecepatan',
                          value:
                              '${location!.speedKph.toStringAsFixed(0)} km/h',
                        ),
                        _StatMini(
                          label: 'Akurasi',
                          value:
                              '+/- ${location!.accuracyM.toStringAsFixed(0)} m',
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.location_on_rounded,
                          size: 13,
                          color: scheme.onSurface.withValues(alpha: 0.4),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            '${location!.latitude.toStringAsFixed(6)}, '
                            '${location!.longitude.toStringAsFixed(6)}',
                            style: TextStyle(
                              fontSize: 12,
                              color: scheme.onSurface.withValues(alpha: 0.5),
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Error banner ───────────────────────────────────────────
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
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
    final bgColor = isWarning ? const Color(0xFFFEF3C7) : scheme.errorContainer;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: bgColor,
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

// ── Chip / stat ────────────────────────────────────────────
class _AutoBadge extends StatelessWidget {
  const _AutoBadge({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: active ? scheme.primaryContainer : scheme.surface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: active
              ? scheme.primary.withValues(alpha: 0.36)
              : scheme.outline.withValues(alpha: 0.36),
        ),
      ),
      child: Text(
        active ? 'Otomatis' : 'Standby',
        style: TextStyle(
          color: active
              ? scheme.primary
              : scheme.onSurface.withValues(alpha: 0.55),
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _StatMini extends StatelessWidget {
  const _StatMini({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 92),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: Theme.of(
                context,
              ).colorScheme.onSurface.withValues(alpha: 0.4),
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
          ),
        ],
      ),
    );
  }
}

// ── Buttons ────────────────────────────────────────────────
// ── Status chip ────────────────────────────────────────────
class _CloseTripButton extends StatelessWidget {
  const _CloseTripButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.lock_clock_rounded, size: 18),
        label: const Text('Tutup Trip'),
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}

Color _deliveryStatusColor(String status, ColorScheme scheme) {
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, this.prefix});
  final TripStatus status;
  final String? prefix;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final apiStatus = deliveryStatusApiValue(status);
    final color = _deliveryStatusColor(apiStatus, scheme);
    final statusLabel = deliveryStatusLabel(apiStatus);
    final label = prefix == null ? statusLabel : '$prefix: $statusLabel';
    return _StatusPill(label: label, color: color);
  }
}

class _SuratJalanStatusChip extends StatelessWidget {
  const _SuratJalanStatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = _deliveryStatusColor(status, scheme);
    return _StatusPill(label: deliveryStatusLabel(status), color: color);
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

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

// ── Error / empty states ───────────────────────────────────
class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});
  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.error_outline_rounded,
                  color: scheme.error,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Text(
                  'Gagal memuat',
                  style: TextStyle(
                    color: scheme.error,
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 14),
            OutlinedButton(
              onPressed: () => unawaited(onRetry()),
              child: const Text('Coba lagi'),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({this.title = 'Tidak ada DO aktif', this.message});

  final String title;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 40),
        child: Column(
          children: [
            Icon(
              Icons.inbox_rounded,
              color: scheme.onSurface.withValues(alpha: 0.2),
              size: 36,
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.5),
                fontWeight: FontWeight.w700,
              ),
            ),
            if (message?.trim().isNotEmpty == true) ...[
              const SizedBox(height: 6),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: Text(
                  message!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.45),
                    fontSize: 12,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ── Extension ──────────────────────────────────────────────
extension _IterableX<T> on Iterable<T> {
  T? firstWhereOrNull(bool Function(T) test) {
    for (final e in this) {
      if (test(e)) return e;
    }
    return null;
  }
}

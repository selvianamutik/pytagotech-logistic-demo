import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../app.dart';
import '../data/delivery_order_service.dart';
import '../domain/models.dart';

/// Sumber data bersama untuk seluruh tab di dalam shell.
///
/// Sebelumnya semua data ini hidup di `TrackingHomePage`, jadi tab Uang Jalan
/// tidak bisa membacanya tanpa lewat push halaman penuh. Dipindahkan ke sini
/// memakai `ChangeNotifier` bawaan Flutter, tanpa menambah dependency.
///
/// Yang menulis tetap satu: dashboard memasang [_attachReload] supaya
/// `refresh()` dari tab lain mendelegasikan ke pemuat miliknya, bukan
/// melakukan request kedua yang bisa membuat dua tab menampilkan data berbeda.
///
/// Controller ini SADAR akan dispose: begitu sesi habis masa validitynya,
/// `_disposed` di-set dan `notifyListeners()` dipanggil apa adanya supaya
/// tidak meledak. Itu penting karena `notifyListeners()` setelah dispose
/// melempar exception di mode debug.
class TrackingController extends ChangeNotifier {
  TrackingController({DeliveryOrderService? service})
    : _service = service ?? DeliveryOrderService();

  final DeliveryOrderService _service;

  Object? _reloadOwner;
  Future<void> Function()? _reloadPortal;

  DriverAppSession? _session;

  List<DeliveryTrip> _trips = const [];
  List<DriverAssignedTripPlan> _plannedTrips = const [];
  List<CustomerProductOption> _customerProducts = const [];
  List<CustomerRecipientOption> _customerRecipients = const [];
  List<DriverTripVoucher> _driverVouchers = const [];
  List<DriverIncident> _driverIncidents = const [];

  DeliveryTrip? _selectedTrip;

  bool _loading = false;
  String? _error;
  bool _disposed = false;

  /// Status override untuk SJ yang baru dibuat di app.
  ///
  /// Setelah menambah SJ, server belum selalu mengembalikan status terbaru
  /// di respons berikutnya. Set ini dipakai agar SJ baru tidak terlihat
  /// sebagai "Dibuat" sampai refresh berikutnya mengonfirmasi.
  final Set<String> _createdStatusOverrides = <String>{};

  DriverAppSession? get session => _session;
  List<DeliveryTrip> get trips => _trips;
  List<DriverAssignedTripPlan> get plannedTrips => _plannedTrips;
  List<CustomerProductOption> get customerProducts => _customerProducts;
  List<CustomerRecipientOption> get customerRecipients => _customerRecipients;
  List<DriverTripVoucher> get driverVouchers => _driverVouchers;
  List<DriverIncident> get driverIncidents => _driverIncidents;
  DeliveryTrip? get selectedTrip => _selectedTrip;
  bool get loading => _loading;
  String? get error => _error;

  /// Bon milik trip yang dipilih, untuk tab Uang Jalan.
  DriverTripVoucher? get selectedTripVoucher {
    final trip = _selectedTrip;
    return trip == null ? null : voucherForTrip(trip);
  }

  void updateSession(DriverAppSession? session) {
    if (identical(session, _session)) return;
    // Sesi yang sama tidak perlu mem-build ulang subtree; penting karena shell
    // memanggil ini dari `initState` saat `TrackingScope` sedang di-mount.
    if (session != null &&
        _session != null &&
        session.driverId == _session!.driverId &&
        session.token == _session!.token) {
      _session = session;
      return;
    }
    _session = session;
    _safeNotify();
  }

  /// Dipanggil dashboard setelah driver memilih trip dari picker.
  void selectTrip(DeliveryTrip? trip) {
    _selectedTrip = trip;
    _safeNotify();
  }

  /// Terima data portal yang baru dimuat dashboard.
  ///
  /// Dashboard tetap satu-satunya pemanggil endpoint (ia juga mengurus access
  /// notice, auto-tracking, dan polling), tapi hasil load-nya disalin ke sini
  /// supaya tab SJ dan Uang Jalan tidak perlu fetch sendiri.
  void syncPortalData({
    required List<DeliveryTrip> trips,
    required List<DriverAssignedTripPlan> plannedTrips,
    required List<CustomerProductOption> customerProducts,
    required List<CustomerRecipientOption> customerRecipients,
    required List<DriverTripVoucher> driverVouchers,
    required List<DriverIncident> driverIncidents,
    required DeliveryTrip? selectedTrip,
    bool? loading,
    String? error,
    bool clearError = false,
  }) {
    _trips = trips;
    _plannedTrips = plannedTrips;
    _customerProducts = customerProducts;
    _customerRecipients = customerRecipients;
    _driverVouchers = driverVouchers;
    _driverIncidents = driverIncidents;
    _selectedTrip = selectedTrip;
    if (loading != null) _loading = loading;
    if (clearError) {
      _error = null;
    } else if (error != null) {
      _error = error;
    }
    _safeNotify();
  }

  /// Terapkan override status ke [trips].
  ///
  /// Dipakai dashboard setelah menambah SJ supaya status barunya tidak
  /// "lompat" balik sebelum server mengonfirmasi.
  List<DeliveryTrip> applyCreatedStatusOverrides(List<DeliveryTrip> trips) =>
      _applyCreatedStatusOverrides(trips);

  /// Mendaftarkan pemuat data milik dashboard, lalu [refresh] ikut memakainya.
  ///
  /// [owner] dipakai sebagai token supaya `detachReload` dari dashboard lama
  /// tidak ikut melepas pendaftaran dashboard yang baru.
  void attachReload(Object owner, Future<void> Function() loadPortal) {
    _reloadOwner = owner;
    _reloadPortal = loadPortal;
  }

  void detachReload(Object owner) {
    if (identical(_reloadOwner, owner)) {
      _reloadOwner = null;
      _reloadPortal = null;
    }
  }

  Future<void> refresh() async {
    final loadPortal = _reloadPortal;
    if (loadPortal != null) {
      await loadPortal();
      return;
    }
    final token = _session?.token;
    if (token == null || token.isEmpty) {
      _loading = false;
      _error = 'Sesi driver tidak valid. Silakan login ulang.';
      _safeNotify();
      return;
    }

    _loading = true;
    _error = null;
    _safeNotify();

    try {
      final portalData = await _service.fetchDriverPortalData(
        sessionToken: token,
      );
      if (_disposed) return;

      var incidents = const <DriverIncident>[];
      try {
        incidents = await _service.fetchDriverIncidents(sessionToken: token);
      } catch (_) {
        // Status insiden bersifat tambahan; jangan halangi daftar trip
        // driver kalau refresh ringan ini gagal.
      }
      if (_disposed) return;

      final trips = _applyCreatedStatusOverrides(portalData.trips);
      final selectedId = _selectedTrip?.deliveryOrderId;

      _trips = trips;
      _plannedTrips = portalData.plannedTrips;
      _customerProducts = portalData.customerProducts;
      _customerRecipients = portalData.customerRecipients;
      _driverVouchers = portalData.driverVouchers;
      _driverIncidents = incidents;
      _selectedTrip =
          (selectedId == null
              ? null
              : _firstWhereDeliveryOrderId(trips, selectedId)) ??
          _activeTripOrFallback(trips);
      _loading = false;
      _safeNotify();
    } on DeliveryOrderException catch (err) {
      if (_disposed) return;
      _loading = false;
      _error = err.message;
      _safeNotify();
    } catch (_) {
      if (_disposed) return;
      _loading = false;
      _error = 'Gagal terhubung ke server. Tarik ke bawah untuk refresh.';
      _safeNotify();
    }
  }

  /// Muat ulang bon saja, untuk halaman riwayat uang jalan.
  Future<List<DriverTripVoucher>> refreshVouchers() async {
    await refresh();
    return visibleDriverVouchers;
  }

  /// Bon milik [trip]. Admin hanya mengizinkan satu bon per DO, jadi
  /// kecocokan pertama dikembalikan; sisanya defensif.
  DriverTripVoucher? voucherForTrip(DeliveryTrip trip) {
    final vouchers = visibleDriverVouchers;
    final deliveryOrderRef = trip.deliveryOrderId.trim();
    if (deliveryOrderRef.isNotEmpty) {
      for (final voucher in vouchers) {
        if ((voucher.deliveryOrderRef ?? '').trim() == deliveryOrderRef) {
          return voucher;
        }
      }
    }
    final doNumber = trip.doNumber.trim().toLowerCase();
    if (doNumber.isEmpty) return null;
    for (final voucher in vouchers) {
      if ((voucher.doNumber ?? '').trim().toLowerCase() == doNumber) {
        return voucher;
      }
    }
    return null;
  }

  List<DriverTripVoucher> get visibleDriverVouchers {
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

  /// Catat SJ yang barusan dibuat driver supaya tidak terdisplay sebagai
  /// "Dibuat" di respons yang belum ter-cache server.
  void noteCreatedSuratJalanStatuses(Iterable<String> keys) {
    if (keys.isEmpty) return;
    _createdStatusOverrides.addAll(keys);
    _safeNotify();
  }

  /// Hapus override setelah server mengonfirmasi status baru.
  ///
  /// [targetRefs] boleh berupa batch ref apa pun yang diterima server;
  /// dicocokkan balik ke identitas SJ pada trip agar alias yang tertinggal
  /// ikut terhapus.
  void clearCreatedStatusOverrides(
    DeliveryTrip trip,
    Iterable<String> targetRefs,
  ) {
    if (_createdStatusOverrides.isEmpty) return;
    var removed = false;

    for (final targetRef in targetRefs) {
      final normalizedTarget = targetRef.trim();
      if (normalizedTarget.isEmpty) continue;

      DeliveryShipperReference? match;
      for (final item in trip.shipperReferences) {
        final candidates = _referenceIdentityCandidates(
          trip.deliveryOrderId,
          documentId: item.documentId,
          referenceKey: item.key,
          referenceNumber: item.referenceNumber,
        );
        if (candidates.contains(normalizedTarget)) {
          match = item;
          break;
        }
      }

      final candidates = match == null
          ? _referenceIdentityCandidates(
              trip.deliveryOrderId,
              documentId: normalizedTarget,
              referenceKey: normalizedTarget,
              referenceNumber: normalizedTarget,
            )
          : _referenceIdentityCandidates(
              trip.deliveryOrderId,
              documentId: match.documentId,
              referenceKey: match.key,
              referenceNumber: match.referenceNumber,
            );
      if (candidates.any(_createdStatusOverrides.remove)) {
        removed = true;
      }
    }

    if (removed) _safeNotify();
  }

  List<DeliveryTrip> _applyCreatedStatusOverrides(List<DeliveryTrip> trips) {
    if (_createdStatusOverrides.isEmpty) return trips;

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
                ).any(_createdStatusOverrides.contains);
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

  /// Semua alias yang bisa dipakai server untuk menunjuk satu SJ.
  ///
  /// Endpoint batch menerima beberapa bentuk id (documentId, key, nomor SJ),
  /// jadi saat menyimpan override kita mendaftarkan semuanya sekaligus.
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

  /// Kunci override untuk SJ yang baru saja dibuat driver.
  Set<String> newSuratJalanStatusOverrideKeys(
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
          _createdStatusOverrides.any(candidates.contains)) {
        continue;
      }
      newKeys.addAll(candidates);
    }
    return newKeys;
  }

  DeliveryTrip? _firstWhereDeliveryOrderId(
    List<DeliveryTrip> trips,
    String deliveryOrderId,
  ) {
    for (final trip in trips) {
      if (trip.deliveryOrderId == deliveryOrderId) return trip;
    }
    return null;
  }

  DeliveryTrip? _activeTripOrFallback(List<DeliveryTrip> trips) {
    for (final trip in trips) {
      if (trip.hasActiveTracking) return trip;
    }
    return trips.isEmpty ? null : trips.first;
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _safeNotify() {
    if (_disposed) return;
    notifyListeners();
  }
}

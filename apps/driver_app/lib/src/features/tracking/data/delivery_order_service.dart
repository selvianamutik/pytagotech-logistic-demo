import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../shared/config.dart';
import '../../../shared/format.dart';
import '../domain/models.dart';

class DeliveryOrderService {
  Future<List<DeliveryTrip>> fetchDriverTrips({
    required String sessionToken,
  }) async {
    final portalData = await fetchDriverPortalData(sessionToken: sessionToken);
    return portalData.trips;
  }

  Future<DriverPortalData> fetchDriverPortalData({
    required String sessionToken,
  }) async {
    final response = await http.get(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders'),
      headers: {
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memuat trip driver';
      throw DeliveryOrderException(message, response.statusCode);
    }

    final tripData = decoded['data'] is List
        ? decoded['data'] as List
        : const [];
    final plannedTripData = decoded['plannedTrips'] is List
        ? decoded['plannedTrips'] as List
        : const [];
    final customerProductData = decoded['customerProducts'] is List
        ? decoded['customerProducts'] as List
        : const [];
    final customerRecipientData = decoded['customerRecipients'] is List
        ? decoded['customerRecipients'] as List
        : const [];
    final driverVoucherData = decoded['driverVouchers'] is List
        ? decoded['driverVouchers'] as List
        : const [];

    return DriverPortalData(
      trips: tripData
          .whereType<Map<String, dynamic>>()
          .map(_mapTrip)
          .toList(growable: false),
      plannedTrips: plannedTripData
          .whereType<Map<String, dynamic>>()
          .map(_mapTripPlan)
          .toList(growable: false),
      customerProducts: customerProductData
          .whereType<Map<String, dynamic>>()
          .map(_mapCustomerProduct)
          .toList(growable: false),
      customerRecipients: customerRecipientData
          .whereType<Map<String, dynamic>>()
          .map(_mapCustomerRecipient)
          .toList(growable: false),
      driverVouchers: driverVoucherData
          .whereType<Map<String, dynamic>>()
          .map(_mapDriverTripVoucher)
          .toList(growable: false),
    );
  }

  Future<DeliveryTrip> updateTripStatus({
    required String sessionToken,
    required String deliveryOrderId,
    required TripStatus status,
    String? note,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/status'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'status': _mapStatusToApi(status),
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memperbarui status DO';
      throw DeliveryOrderException(message, response.statusCode);
    }

    final data = decoded['data'];
    if (data is! Map<String, dynamic>) {
      throw const DeliveryOrderException(
        'Respons update status tidak valid',
        500,
      );
    }

    return _mapTrip(data);
  }

  Future<void> updateBatchSuratJalanStatus({
    required String sessionToken,
    required String deliveryOrderId,
    required TripStatus status,
    required List<String> targetSuratJalanRefs,
    String? note,
  }) async {
    final response = await http.post(
      Uri.parse(
        '${AppConfig.apiBaseUrl}/api/driver/delivery-orders/batch-status',
      ),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'status': _mapStatusToApi(status),
        'targetSuratJalanRefs': targetSuratJalanRefs,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memperbarui status SJ';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> requestDeliveryCompletion({
    required String sessionToken,
    required String deliveryOrderId,
    String? note,
    required String podReceiverName,
    required String podReceivedDate,
    required List<String> selectedSuratJalanRefs,
    required List<DriverActualCargoInput> actualItems,
    required List<DriverActualDropPointInput> actualDropPoints,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/status'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'status': 'DELIVERED',
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
        'podReceiverName': podReceiverName.trim(),
        'podReceivedDate': podReceivedDate.trim(),
        if (selectedSuratJalanRefs.isNotEmpty)
          'selectedSuratJalanRefs': selectedSuratJalanRefs,
        'actualItems': actualItems.map((item) => item.toJson()).toList(),
        'actualDropPoints': actualDropPoints
            .map((item) => item.toJson())
            .toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal mengajukan DO selesai';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> requestTripClosure({
    required String sessionToken,
    required String deliveryOrderId,
    required double tripEndOdometerKm,
    String? note,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/status'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'status': 'DELIVERED',
        'closeTripOnly': true,
        'tripEndOdometerKm': tripEndOdometerKm,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal mengajukan tutup trip';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> reportIncident({
    required String sessionToken,
    required String deliveryOrderId,
    required String incidentType,
    required String urgency,
    required String locationText,
    required double odometer,
    required String description,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/incidents'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'relatedDeliveryOrderRef': deliveryOrderId,
        'dateTime': DateTime.now().toUtc().toIso8601String(),
        'incidentType': incidentType,
        'urgency': urgency,
        'locationText': locationText.trim(),
        'odometer': odometer,
        'description': description.trim(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal mengirim laporan insiden';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<List<DriverIncident>> fetchDriverIncidents({
    required String sessionToken,
  }) async {
    final response = await http.get(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/incidents'),
      headers: {
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal memuat insiden driver';
      throw DeliveryOrderException(message, response.statusCode);
    }

    final data = decoded['data'] is List ? decoded['data'] as List : const [];
    return data
        .whereType<Map<String, dynamic>>()
        .map(_mapDriverIncident)
        .toList(growable: false);
  }

  Future<void> submitIncidentResolution({
    required String sessionToken,
    required String incidentRef,
    required String resolutionNote,
    String? resolutionLocationText,
    double? resolutionOdometer,
    required List<DriverIncidentCostInput> costs,
  }) async {
    final response = await http.patch(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/incidents'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'action': 'submit-resolution',
        'incidentRef': incidentRef,
        'resolutionNote': resolutionNote.trim(),
        if (resolutionLocationText != null &&
            resolutionLocationText.trim().isNotEmpty)
          'resolutionLocationText': resolutionLocationText.trim(),
        if (resolutionOdometer != null && resolutionOdometer > 0)
          'resolutionOdometer': resolutionOdometer,
        'costs': costs.map((cost) => cost.toJson()).toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal mengajukan penyelesaian insiden';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> createDeliveryOrderFromTripPlan({
    required String sessionToken,
    required String orderRef,
    required String orderTripPlanKey,
    required List<DriverManifestShipperReferenceInput> shipperReferences,
    required List<DriverManifestCargoItemInput> cargoItems,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/create'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'orderRef': orderRef,
        'orderTripPlanKey': orderTripPlanKey,
        'shipperReferences': shipperReferences
            .map((item) => item.toJson())
            .toList(),
        'cargoItems': cargoItems.map((item) => item.toJson()).toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal membuat surat jalan dari trip order';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> appendCargoToDeliveryOrder({
    required String sessionToken,
    required String deliveryOrderId,
    required List<DriverManifestShipperReferenceInput> shipperReferences,
    required List<DriverManifestCargoItemInput> cargoItems,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/delivery-orders/cargo'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'shipperReferences': shipperReferences
            .map((item) => item.toJson())
            .toList(),
        'cargoItems': cargoItems.map((item) => item.toJson()).toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal menyimpan SJ/barang driver';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> syncDeliveryOrderShipperReferences({
    required String sessionToken,
    required String deliveryOrderId,
    required List<DriverManifestShipperReferenceInput> shipperReferences,
  }) async {
    final response = await http.post(
      Uri.parse(
        '${AppConfig.apiBaseUrl}/api/driver/delivery-orders/shipper-references',
      ),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'shipperReferences': shipperReferences
            .map((item) => item.toJson())
            .toList(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal menyimpan daftar SJ driver';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> updateDeliveryOrderCargoItem({
    required String sessionToken,
    required String deliveryOrderId,
    required String deliveryOrderItemId,
    required DriverManifestCargoItemInput cargoItem,
  }) async {
    final response = await http.patch(
      Uri.parse(
        '${AppConfig.apiBaseUrl}/api/driver/delivery-orders/cargo-item',
      ),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'id': deliveryOrderId,
        'deliveryOrderItemId': deliveryOrderItemId,
        'cargoItem': cargoItem.toJson(),
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal mengubah barang SJ driver';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  Future<void> deleteDeliveryOrderCargoItem({
    required String sessionToken,
    required String deliveryOrderId,
    required String deliveryOrderItemId,
  }) async {
    final request =
        http.Request(
            'DELETE',
            Uri.parse(
              '${AppConfig.apiBaseUrl}/api/driver/delivery-orders/cargo-item',
            ),
          )
          ..headers.addAll({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-client-type': 'driver-app',
            'Authorization': 'Bearer $sessionToken',
          })
          ..body = jsonEncode({
            'id': deliveryOrderId,
            'deliveryOrderItemId': deliveryOrderItemId,
          });

    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);
    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal menghapus barang SJ driver';
      throw DeliveryOrderException(message, response.statusCode);
    }
  }

  DeliveryTrip _mapTrip(Map<String, dynamic> json) {
    final status = (json['status'] as String?) ?? 'CREATED';
    final mappedStatus = _deriveTripStatusFromSuratJalanRecords(
      json['driverSuratJalanRecords'],
      fallbackStatus: _mapTripStatus(status),
    );

    final date = (json['date'] as String?)?.trim();
    final pickupAddress = (json['pickupAddress'] as String?)?.trim();
    final receiverName = (json['receiverName'] as String?)?.trim();
    final receiverAddress = (json['receiverAddress'] as String?)?.trim();
    final notes = (json['notes'] as String?)?.trim();
    final pickupStops = _mapPickupStops(json['pickupStops']);
    final pendingDriverRequests = _mapPendingDriverRequests(
      json['pendingDriverRequests'],
    );
    final tripOriginArea = (json['tripOriginArea'] as String?)?.trim();
    final tripDestinationArea = (json['tripDestinationArea'] as String?)
        ?.trim();
    var originLabel = '-';
    if (pickupAddress?.isNotEmpty == true) {
      originLabel = pickupAddress!;
    } else if (tripOriginArea?.isNotEmpty == true) {
      originLabel = tripOriginArea!;
    }
    final destinationLabel = tripDestinationArea?.isNotEmpty == true
        ? tripDestinationArea!
        : '-';

    return DeliveryTrip(
      deliveryOrderId: json['_id'] as String? ?? '',
      doNumber: json['doNumber'] as String? ?? '-',
      vehiclePlate: (json['vehiclePlate'] as String?)?.trim().isNotEmpty == true
          ? json['vehiclePlate'] as String
          : '-',
      originLabel: originLabel,
      destinationLabel: destinationLabel,
      customerName: (json['customerName'] as String?)?.trim().isNotEmpty == true
          ? json['customerName'] as String
          : 'Tanpa customer',
      status: mappedStatus,
      // Label tanggal tanpa awalan "Tanggal DO": tile di halaman Trip sudah
      // berlabel "Tanggal", dan format mengikuti kebiasaan Indonesia.
      etdLabel: formatDdMmYyyy(date),
      statusNote: defaultTripStatusNote(
        mappedStatus,
        pendingDriverStatus: (json['pendingDriverStatus'] as String?)?.trim(),
        hasPendingTripClosureRequest: pendingDriverRequests.any(
          (request) => request.isTripClosureRequest,
        ),
      ),
      allowsDirectCargoInput: json['allowsDirectCargoInput'] != false,
      orderRef: _readRefId(json['orderRef']),
      customerRef: _readRefId(json['customerRef']),
      customerRefs: _readRefIdList(json['customerRefs']),
      receiverName: receiverName?.isNotEmpty == true ? receiverName : null,
      receiverAddress: receiverAddress?.isNotEmpty == true
          ? receiverAddress
          : null,
      itemSummary: notes?.isNotEmpty == true ? notes : null,
      trackingState: (json['trackingState'] as String?)?.trim(),
      pendingDriverStatus: (json['pendingDriverStatus'] as String?)?.trim(),
      pendingDriverRequests: pendingDriverRequests,
      tripClosedByAdminAt: (json['tripClosedByAdminAt'] as String?)?.trim(),
      tripClosedByAdminName: (json['tripClosedByAdminName'] as String?)?.trim(),
      vehicleLastOdometer: _toDouble(json['vehicleLastOdometer']),
      vehicleLastOdometerAt: (json['vehicleLastOdometerAt'] as String?)?.trim(),
      tripEndOdometerKm: _toDouble(json['tripEndOdometerKm']),
      pickupStops: pickupStops,
      shipperReferences: _mapShipperReferences(
        json['shipperReferences'],
        suratJalanRecords: json['driverSuratJalanRecords'],
        fallbackDeliveryOrderId: json['_id'] as String? ?? '',
        fallbackCustomerDoNumber: (json['customerDoNumber'] as String?)?.trim(),
        fallbackDate: date,
        fallbackPickupStopKey: pickupStops.isNotEmpty
            ? pickupStops.first.key
            : null,
      ),
      cargoItems: _mapCargoItems(json['driverCargoItems']),
      actualDropPoints: _mapActualDropPoints(json['actualDropPoints']),
      pendingActualCargoItems: _mapPendingActualCargoItems(
        json['pendingDriverActualCargoItems'],
      ),
      pendingActualDropPoints: _mapActualDropPoints(
        json['pendingDriverActualDropPoints'],
      ),
      rejectedRequestStatus: (json['driverRejectedRequestStatus'] as String?)
          ?.trim(),
      rejectedRequestNote: (json['driverRejectedRequestNote'] as String?)
          ?.trim(),
      rejectedRequestAt: (json['driverRejectedRequestAt'] as String?)?.trim(),
    );
  }

  TripStatus _mapTripStatus(String status) {
    return switch (status.trim().toUpperCase()) {
      'HEADING_TO_PICKUP' => TripStatus.onDelivery,
      'ON_DELIVERY' => TripStatus.onDelivery,
      'ARRIVED' => TripStatus.arrived,
      'PARTIAL_HOLD' => TripStatus.partialHold,
      'DELIVERED' => TripStatus.delivered,
      _ => TripStatus.assigned,
    };
  }

  TripStatus _deriveTripStatusFromSuratJalanRecords(
    dynamic raw, {
    required TripStatus fallbackStatus,
  }) {
    if (raw is! List) return fallbackStatus;

    final statuses = raw
        .whereType<Map<String, dynamic>>()
        .where((item) => (_toInt(item['itemCount']) ?? 0) > 0)
        .map((item) => (item['tripStatus'] as String?)?.trim().toUpperCase())
        .whereType<String>()
        .where((status) => status.isNotEmpty)
        .toList(growable: false);
    if (statuses.isEmpty) return fallbackStatus;

    if (statuses.every((status) => status == 'DELIVERED')) {
      return TripStatus.delivered;
    }
    if (statuses.any((status) => status == 'PARTIAL_HOLD')) {
      return TripStatus.partialHold;
    }
    if (statuses.any((status) => status == 'ARRIVED')) {
      return TripStatus.arrived;
    }
    if (statuses.any((status) => status == 'ON_DELIVERY')) {
      return TripStatus.onDelivery;
    }
    return fallbackStatus;
  }

  DriverAssignedTripPlan _mapTripPlan(Map<String, dynamic> json) {
    return DriverAssignedTripPlan(
      orderRef: (json['orderRef'] as String?)?.trim() ?? '',
      masterResi: (json['masterResi'] as String?)?.trim(),
      customerRef: _readRefId(json['customerRef']),
      customerRefs: _readRefIdList(json['customerRefs']),
      customerName: (json['customerName'] as String?)?.trim(),
      serviceName: (json['serviceName'] as String?)?.trim(),
      tripPlanKey: (json['tripPlanKey'] as String?)?.trim() ?? '',
      tripSequence: _toInt(json['tripSequence']) ?? 1,
      pickupStops: _mapPickupStops(json['pickupStops']),
      vehicleRef: (json['vehicleRef'] as String?)?.trim(),
      vehiclePlate: (json['vehiclePlate'] as String?)?.trim(),
      driverRef: (json['driverRef'] as String?)?.trim(),
      driverName: (json['driverName'] as String?)?.trim(),
      tripOriginArea: (json['tripOriginArea'] as String?)?.trim(),
      tripDestinationArea: (json['tripDestinationArea'] as String?)?.trim(),
      taripBorongan: _toDouble(json['taripBorongan']),
      cashGiven: _toDouble(json['cashGiven']),
      issueBankName: (json['issueBankName'] as String?)?.trim(),
      date: (json['date'] as String?)?.trim(),
      notes: (json['notes'] as String?)?.trim(),
      linkedDeliveryOrderRef: (json['linkedDeliveryOrderRef'] as String?)
          ?.trim(),
      linkedDeliveryOrderNumber: (json['linkedDeliveryOrderNumber'] as String?)
          ?.trim(),
      linkedDeliveryOrderStatus: (json['linkedDeliveryOrderStatus'] as String?)
          ?.trim(),
      allowsDirectCargoInput: json['allowsDirectCargoInput'] != false,
    );
  }

  CustomerProductOption _mapCustomerProduct(Map<String, dynamic> json) {
    return CustomerProductOption(
      id: (json['_id'] as String?)?.trim() ?? '',
      customerRef: _readRefId(json['customerRef']) ?? '',
      name: (json['name'] as String?)?.trim() ?? '-',
      code: (json['code'] as String?)?.trim(),
      description: (json['description'] as String?)?.trim(),
      defaultQtyKoli: _toDouble(json['defaultQtyKoli']),
      defaultWeight: _toDouble(json['defaultWeight']),
      defaultWeightInputValue: _toDouble(json['defaultWeightInputValue']),
      defaultWeightInputUnit: (json['defaultWeightInputUnit'] as String?)
          ?.trim(),
      defaultVolume: _toDouble(json['defaultVolume']),
      defaultVolumeInputValue: _toDouble(json['defaultVolumeInputValue']),
      defaultVolumeInputUnit: (json['defaultVolumeInputUnit'] as String?)
          ?.trim(),
    );
  }

  CustomerRecipientOption _mapCustomerRecipient(Map<String, dynamic> json) {
    return CustomerRecipientOption(
      id: (json['_id'] as String?)?.trim() ?? '',
      customerRef: _readRefId(json['customerRef']) ?? '',
      label: (json['label'] as String?)?.trim() ?? '',
      receiverName: (json['receiverName'] as String?)?.trim() ?? '',
      receiverAddress: (json['receiverAddress'] as String?)?.trim() ?? '',
      receiverPhone: (json['receiverPhone'] as String?)?.trim(),
      receiverCompany: (json['receiverCompany'] as String?)?.trim(),
    );
  }

  DriverTripVoucher _mapDriverTripVoucher(Map<String, dynamic> json) {
    return DriverTripVoucher(
      id: (json['_id'] as String?)?.trim() ?? '',
      bonNumber: (json['bonNumber'] as String?)?.trim() ?? '-',
      status: (json['status'] as String?)?.trim() ?? 'ISSUED',
      issuedDate: (json['issuedDate'] as String?)?.trim() ?? '',
      doNumber: (json['doNumber'] as String?)?.trim(),
      deliveryOrderRef: _readRefId(json['deliveryOrderRef']),
      vehiclePlate: (json['vehiclePlate'] as String?)?.trim(),
      route: (json['route'] as String?)?.trim(),
      issueBankName: (json['issueBankName'] as String?)?.trim(),
      settlementBankName: (json['settlementBankName'] as String?)?.trim(),
      notes: (json['notes'] as String?)?.trim(),
      totalIssuedAmount: _toDouble(json['totalIssuedAmount']) ?? 0,
      initialCashGiven: _toDouble(json['initialCashGiven']) ?? 0,
      topUpAmount: _toDouble(json['topUpAmount']) ?? 0,
      operationalSpent: _toDouble(json['operationalSpent']) ?? 0,
      operationalBalance: _toDouble(json['operationalBalance']) ?? 0,
      driverFeeAmount: _toDouble(json['driverFeeAmount']) ?? 0,
      totalClaimAmount: _toDouble(json['totalClaimAmount']) ?? 0,
      netSettlementAmount: _toDouble(json['netSettlementAmount']) ?? 0,
      disbursements: _mapDriverTripVoucherDisbursements(json['disbursements']),
      items: _mapDriverTripVoucherItems(json['items']),
    );
  }

  List<DriverTripVoucherDisbursement> _mapDriverTripVoucherDisbursements(
    dynamic raw,
  ) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DriverTripVoucherDisbursement(
            id: (item['_id'] as String?)?.trim() ?? '',
            date: (item['date'] as String?)?.trim() ?? '',
            kind: (item['kind'] as String?)?.trim() ?? 'INITIAL',
            amount: _toDouble(item['amount']) ?? 0,
            bankAccountName: (item['bankAccountName'] as String?)?.trim(),
            note: (item['note'] as String?)?.trim(),
          ),
        )
        .where((item) => item.id.isNotEmpty)
        .toList(growable: false);
  }

  List<DriverTripVoucherItem> _mapDriverTripVoucherItems(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DriverTripVoucherItem(
            id: (item['_id'] as String?)?.trim() ?? '',
            expenseDate: (item['expenseDate'] as String?)?.trim() ?? '',
            category: (item['category'] as String?)?.trim() ?? '-',
            amount: _toDouble(item['amount']) ?? 0,
            description: (item['description'] as String?)?.trim(),
          ),
        )
        .where((item) => item.id.isNotEmpty)
        .toList(growable: false);
  }

  DriverIncident _mapDriverIncident(Map<String, dynamic> json) {
    return DriverIncident(
      id: (json['_id'] as String?)?.trim() ?? '',
      incidentNumber: (json['incidentNumber'] as String?)?.trim() ?? '-',
      status: (json['status'] as String?)?.trim() ?? 'OPEN',
      incidentType: (json['incidentType'] as String?)?.trim() ?? 'OTHER',
      urgency: (json['urgency'] as String?)?.trim() ?? 'MEDIUM',
      relatedDeliveryOrderRef:
          _readRefId(json['relatedDeliveryOrderRef']) ?? '',
      relatedDONumber: (json['relatedDONumber'] as String?)?.trim() ?? '-',
      description: (json['description'] as String?)?.trim() ?? '',
      locationText: (json['locationText'] as String?)?.trim() ?? '',
      odometer: _toDouble(json['odometer']),
      dateTime: (json['dateTime'] as String?)?.trim(),
      pendingDriverResolutionRequestedAt:
          (json['pendingDriverResolutionRequestedAt'] as String?)?.trim(),
      settlementLines: _mapIncidentSettlementLines(json['settlementLines']),
    );
  }

  List<DriverIncidentSettlementLine> _mapIncidentSettlementLines(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DriverIncidentSettlementLine(
            id: (item['_id'] as String?)?.trim() ?? '',
            status: (item['status'] as String?)?.trim() ?? 'DRAFT',
            category: (item['category'] as String?)?.trim() ?? 'OTHER',
            amount: _toDouble(item['amount']) ?? 0,
            description: (item['description'] as String?)?.trim() ?? '',
            isDriverSubmitted: item['driverSubmitted'] == true,
          ),
        )
        .where((line) => line.id.isNotEmpty)
        .toList(growable: false);
  }

  List<DeliveryPickupStop> _mapPickupStops(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DeliveryPickupStop(
            key:
                (item['_key'] as String?)?.trim() ??
                'pickup-${_toInt(item['sequence']) ?? 1}',
            sequence: _toInt(item['sequence']) ?? 1,
            pickupLabel: (item['pickupLabel'] as String?)?.trim(),
            pickupAddress: (item['pickupAddress'] as String?)?.trim() ?? '-',
            notes: (item['notes'] as String?)?.trim(),
          ),
        )
        .toList(growable: false);
  }

  List<DeliveryShipperReference> _mapShipperReferences(
    dynamic raw, {
    dynamic suratJalanRecords,
    String? fallbackDeliveryOrderId,
    String? fallbackCustomerDoNumber,
    String? fallbackDate,
    String? fallbackPickupStopKey,
  }) {
    final suratJalanRecordByKey = _mapSuratJalanRecordMetadata(
      suratJalanRecords,
    );
    final references = <DeliveryShipperReference>[];
    final seenReferenceKeys = <String>{};
    final seenReferenceNumbers = <String>{};
    if (raw is List) {
      for (final item in raw.whereType<Map<String, dynamic>>()) {
        final referenceNumber = (item['referenceNumber'] as String?)?.trim();
        if (referenceNumber == null || referenceNumber.isEmpty) continue;
        final referenceKey = (item['_key'] as String?)?.trim();
        final recordMetadata =
            (referenceKey != null && referenceKey.isNotEmpty
                ? suratJalanRecordByKey['key:$referenceKey']
                : null) ??
            suratJalanRecordByKey['number:${referenceNumber.toUpperCase()}'];
        final pickupAddress =
            recordMetadata?.pickupAddress ??
            (item['pickupAddress'] as String?)?.trim();
        final referenceDate = (item['date'] as String?)?.trim();
        references.add(
          DeliveryShipperReference(
            referenceNumber: referenceNumber,
            documentId:
                recordMetadata?.documentId ??
                _deriveSuratJalanDocumentId(
                  fallbackDeliveryOrderId,
                  referenceKey?.isNotEmpty == true
                      ? referenceKey
                      : referenceNumber,
                ),
            key: referenceKey,
            tripStatus: recordMetadata?.tripStatus,
            date: referenceDate?.isNotEmpty == true
                ? referenceDate
                : (recordMetadata?.tripDate ?? fallbackDate),
            holdQtyKoli: recordMetadata?.holdQtyKoli,
            holdWeightKg: recordMetadata?.holdWeightKg,
            holdVolumeM3: recordMetadata?.holdVolumeM3,
            pickupStopKey: (item['pickupStopKey'] as String?)?.trim(),
            pickupAddress: pickupAddress?.isNotEmpty == true
                ? pickupAddress
                : null,
            receiverName: (item['receiverName'] as String?)?.trim(),
            receiverCompany: (item['receiverCompany'] as String?)?.trim(),
            receiverAddress: (item['receiverAddress'] as String?)?.trim(),
          ),
        );
        if (referenceKey != null && referenceKey.isNotEmpty) {
          seenReferenceKeys.add(referenceKey);
        }
        seenReferenceNumbers.add(referenceNumber.toUpperCase());
      }
    }
    if (suratJalanRecords is List) {
      for (final item in suratJalanRecords.whereType<Map<String, dynamic>>()) {
        final referenceNumber = (item['suratJalanNumber'] as String?)?.trim();
        if (referenceNumber == null || referenceNumber.isEmpty) continue;
        final referenceKey = (item['referenceKey'] as String?)?.trim();
        if ((referenceKey != null &&
                referenceKey.isNotEmpty &&
                seenReferenceKeys.contains(referenceKey)) ||
            seenReferenceNumbers.contains(referenceNumber.toUpperCase())) {
          continue;
        }
        final documentId = (item['_id'] as String?)?.trim();
        final tripDate = (item['tripDate'] as String?)?.trim();
        final pickupAddress = (item['pickupAddress'] as String?)?.trim();
        final tripStatus = (item['tripStatus'] as String?)?.trim();
        final holdCargo = item['holdCargo'] is Map<String, dynamic>
            ? item['holdCargo'] as Map<String, dynamic>
            : const <String, dynamic>{};
        references.add(
          DeliveryShipperReference(
            referenceNumber: referenceNumber,
            documentId: documentId?.isNotEmpty == true
                ? documentId
                : _deriveSuratJalanDocumentId(
                    fallbackDeliveryOrderId,
                    referenceKey?.isNotEmpty == true
                        ? referenceKey
                        : referenceNumber,
                  ),
            key: referenceKey,
            tripStatus: tripStatus,
            date: tripDate?.isNotEmpty == true ? tripDate : fallbackDate,
            holdQtyKoli: _toDouble(holdCargo['qtyKoli']),
            holdWeightKg: _toDouble(holdCargo['weightKg']),
            holdVolumeM3: _toDouble(holdCargo['volumeM3']),
            pickupStopKey: (item['pickupStopKey'] as String?)?.trim(),
            pickupAddress: pickupAddress?.isNotEmpty == true
                ? pickupAddress
                : null,
            receiverName: (item['receiverName'] as String?)?.trim(),
            receiverCompany: (item['receiverCompany'] as String?)?.trim(),
            receiverAddress: (item['receiverAddress'] as String?)?.trim(),
          ),
        );
        if (referenceKey != null && referenceKey.isNotEmpty) {
          seenReferenceKeys.add(referenceKey);
        }
        seenReferenceNumbers.add(referenceNumber.toUpperCase());
      }
    }
    if (references.isEmpty &&
        fallbackCustomerDoNumber != null &&
        fallbackCustomerDoNumber.isNotEmpty) {
      final recordMetadata =
          suratJalanRecordByKey['number:${fallbackCustomerDoNumber.toUpperCase()}'] ??
          suratJalanRecordByKey['id:$fallbackDeliveryOrderId:primary'];
      references.add(
        DeliveryShipperReference(
          referenceNumber: fallbackCustomerDoNumber,
          documentId:
              recordMetadata?.documentId ??
              _deriveSuratJalanDocumentId(fallbackDeliveryOrderId, 'primary'),
          key: null,
          tripStatus: recordMetadata?.tripStatus,
          date: recordMetadata?.tripDate ?? fallbackDate,
          holdQtyKoli: recordMetadata?.holdQtyKoli,
          holdWeightKg: recordMetadata?.holdWeightKg,
          holdVolumeM3: recordMetadata?.holdVolumeM3,
          pickupStopKey: fallbackPickupStopKey,
          pickupAddress: recordMetadata?.pickupAddress,
        ),
      );
    }
    return references;
  }

  Map<String, _SuratJalanRecordMetadata> _mapSuratJalanRecordMetadata(
    dynamic raw,
  ) {
    final result = <String, _SuratJalanRecordMetadata>{};
    if (raw is! List) return result;
    for (final item in raw.whereType<Map<String, dynamic>>()) {
      final pickupAddress = (item['pickupAddress'] as String?)?.trim();
      final documentId = (item['_id'] as String?)?.trim();
      final tripStatus = (item['tripStatus'] as String?)?.trim();
      final tripDate = (item['tripDate'] as String?)?.trim();
      final holdCargo = item['holdCargo'] is Map<String, dynamic>
          ? item['holdCargo'] as Map<String, dynamic>
          : const <String, dynamic>{};
      final metadata = _SuratJalanRecordMetadata(
        documentId: documentId,
        pickupAddress: pickupAddress?.isNotEmpty == true ? pickupAddress : null,
        tripStatus: tripStatus,
        tripDate: tripDate?.isNotEmpty == true ? tripDate : null,
        holdQtyKoli: _toDouble(holdCargo['qtyKoli']),
        holdWeightKg: _toDouble(holdCargo['weightKg']),
        holdVolumeM3: _toDouble(holdCargo['volumeM3']),
      );
      if (documentId != null && documentId.isNotEmpty) {
        result['id:$documentId'] = metadata;
      }
      final referenceKey = (item['referenceKey'] as String?)?.trim();
      if (referenceKey != null && referenceKey.isNotEmpty) {
        result['key:$referenceKey'] = metadata;
      }
      final referenceNumber = (item['suratJalanNumber'] as String?)?.trim();
      if (referenceNumber != null && referenceNumber.isNotEmpty) {
        result['number:${referenceNumber.toUpperCase()}'] = metadata;
      }
    }
    return result;
  }

  String? _deriveSuratJalanDocumentId(String? deliveryOrderId, String? suffix) {
    final normalizedDeliveryOrderId = deliveryOrderId?.trim() ?? '';
    final normalizedSuffix = suffix?.trim() ?? '';
    if (normalizedDeliveryOrderId.isEmpty || normalizedSuffix.isEmpty) {
      return null;
    }
    return '$normalizedDeliveryOrderId:$normalizedSuffix';
  }

  List<DeliveryCargoItem> _mapCargoItems(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DeliveryCargoItem(
            id: (item['_id'] as String?)?.trim() ?? '',
            description:
                (item['orderItemDescription'] as String?)?.trim() ?? '-',
            pickupStopKey: (item['pickupStopKey'] as String?)?.trim(),
            pickupAddress: (item['pickupAddress'] as String?)?.trim(),
            shipperReferenceKey: (item['shipperReferenceKey'] as String?)
                ?.trim(),
            shipperReferenceNumber: (item['shipperReferenceNumber'] as String?)
                ?.trim(),
            customerProductRef: _readRefId(item['customerProductRef']),
            qtyKoli: _toDouble(
              item['orderItemQtyKoli'] ?? item['shippedQtyKoli'],
            ),
            weightKg: _toDouble(
              item['orderItemWeight'] ?? item['shippedWeight'],
            ),
            volumeM3: _toDouble(item['orderItemVolumeM3']),
            weightInputValue: _toDouble(item['orderItemWeightInputValue']),
            weightInputUnit: (item['orderItemWeightInputUnit'] as String?)
                ?.trim(),
            volumeInputValue: _toDouble(item['orderItemVolumeInputValue']),
            volumeInputUnit: (item['orderItemVolumeInputUnit'] as String?)
                ?.trim(),
            heldQtyKoli: _toDouble(item['heldQtyKoli']),
            heldWeightKg: _toDouble(item['heldWeight']),
            heldVolumeM3: _toDouble(item['heldVolume']),
            actualQtyKoli: _toDouble(item['actualQtyKoli']),
            actualWeightInputValue: _toDouble(item['actualWeightInputValue']),
            actualWeightInputUnit: (item['actualWeightInputUnit'] as String?)
                ?.trim(),
            actualVolumeInputValue: _toDouble(item['actualVolumeInputValue']),
            actualVolumeInputUnit: (item['actualVolumeInputUnit'] as String?)
                ?.trim(),
          ),
        )
        .toList(growable: false);
  }

  List<PendingDriverActualCargoItem> _mapPendingActualCargoItems(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => PendingDriverActualCargoItem(
            deliveryOrderItemRef:
                (item['deliveryOrderItemRef'] as String?)?.trim() ?? '',
            actualQtyKoli: _toDouble(item['actualQtyKoli']),
            actualWeightInputValue: _toDouble(item['actualWeightInputValue']),
            actualWeightInputUnit: (item['actualWeightInputUnit'] as String?)
                ?.trim(),
            actualVolumeInputValue: _toDouble(item['actualVolumeInputValue']),
            actualVolumeInputUnit: (item['actualVolumeInputUnit'] as String?)
                ?.trim(),
          ),
        )
        .where((item) => item.deliveryOrderItemRef.isNotEmpty)
        .toList(growable: false);
  }

  List<PendingDriverRequest> _mapPendingDriverRequests(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => PendingDriverRequest(
            requestId: (item['requestId'] as String?)?.trim() ?? '',
            status: (item['status'] as String?)?.trim() ?? '',
            targetSuratJalanRefs: _toStringList(item['targetSuratJalanRefs']),
            closeTripOnly: item['closeTripOnly'] == true,
            tripEndOdometerKm: _toDouble(item['tripEndOdometerKm']),
          ),
        )
        .where((item) => item.requestId.isNotEmpty && item.status.isNotEmpty)
        .toList(growable: false);
  }

  List<DeliveryActualDropPoint> _mapActualDropPoints(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(
          (item) => DeliveryActualDropPoint(
            sequence: _toInt(item['sequence']),
            stopType: (item['stopType'] as String?)?.trim() ?? 'DROP',
            deliveryOrderItemRef: (item['deliveryOrderItemRef'] as String?)
                ?.trim(),
            deliveryOrderItemRefs: _toStringList(item['deliveryOrderItemRefs']),
            actualDropGroupKey: (item['actualDropGroupKey'] as String?)?.trim(),
            shipperReferenceNumber: (item['shipperReferenceNumber'] as String?)
                ?.trim(),
            shipperReferenceKey: (item['shipperReferenceKey'] as String?)
                ?.trim(),
            originLocationName: (item['originLocationName'] as String?)?.trim(),
            originLocationAddress: (item['originLocationAddress'] as String?)
                ?.trim(),
            locationName: (item['locationName'] as String?)?.trim() ?? '',
            locationAddress: (item['locationAddress'] as String?)?.trim(),
            qtyKoli: _toDouble(item['qtyKoli']),
            weightInputValue: _toDouble(item['weightInputValue']),
            weightInputUnit: (item['weightInputUnit'] as String?)?.trim(),
            volumeInputValue: _toDouble(item['volumeInputValue']),
            volumeInputUnit: (item['volumeInputUnit'] as String?)?.trim(),
            note: (item['note'] as String?)?.trim(),
          ),
        )
        .where((item) => item.locationName.isNotEmpty)
        .toList(growable: false);
  }

  String _mapStatusToApi(TripStatus status) {
    return switch (status) {
      TripStatus.assigned => 'CREATED',
      TripStatus.onDelivery => 'ON_DELIVERY',
      TripStatus.arrived => 'ARRIVED',
      TripStatus.partialHold => 'PARTIAL_HOLD',
      TripStatus.delivered => 'DELIVERED',
    };
  }

  Map<String, dynamic> _decodeJson(String body) {
    if (body.isEmpty) return <String, dynamic>{};
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }

  double? _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  int? _toInt(dynamic value) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }

  List<String> _toStringList(dynamic value) {
    if (value is! List) return const [];
    return value
        .whereType<String>()
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }

  String? _readRefId(dynamic value) {
    if (value is String) {
      final trimmed = value.trim();
      return trimmed.isNotEmpty ? trimmed : null;
    }
    if (value is Map<String, dynamic>) {
      final ref =
          (value['_ref'] as String?)?.trim() ??
          (value['_id'] as String?)?.trim();
      return ref != null && ref.isNotEmpty ? ref : null;
    }
    return null;
  }

  /// Reads a list of customer refs. Multi-customer trips return more than one; older payloads
  /// simply return an empty list and callers fall back to the single `customerRef`.
  List<String> _readRefIdList(dynamic value) {
    if (value is! List) {
      return const [];
    }
    final refs = <String>[];
    for (final entry in value) {
      final ref = _readRefId(entry);
      if (ref != null && !refs.contains(ref)) {
        refs.add(ref);
      }
    }
    return refs;
  }
}

class DriverManifestShipperReferenceInput {
  const DriverManifestShipperReferenceInput({
    required this.referenceNumber,
    this.key,
    this.date,
    this.pickupStopKey,
  });

  final String referenceNumber;
  final String? key;
  final String? date;
  final String? pickupStopKey;

  Map<String, dynamic> toJson() => {
    if (key != null && key!.isNotEmpty) '_key': key,
    'referenceNumber': referenceNumber,
    if (date != null && date!.isNotEmpty) 'date': date,
    if (pickupStopKey != null && pickupStopKey!.isNotEmpty)
      'pickupStopKey': pickupStopKey,
  };
}

class DriverManifestCargoItemInput {
  const DriverManifestCargoItemInput({
    this.customerProductRef,
    required this.description,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
    required this.shipperReferenceNumber,
    this.pickupStopKey,
  });

  final String? customerProductRef;
  final String description;
  final double qtyKoli;
  final double weightInputValue;
  final String weightInputUnit;
  final double volumeInputValue;
  final String volumeInputUnit;
  final String shipperReferenceNumber;
  final String? pickupStopKey;

  Map<String, dynamic> toJson() => {
    if (customerProductRef != null && customerProductRef!.isNotEmpty)
      'customerProductRef': customerProductRef,
    'description': description,
    'qtyKoli': qtyKoli,
    'weightInputValue': weightInputValue,
    'weightInputUnit': weightInputUnit,
    'volumeInputValue': volumeInputValue,
    'volumeInputUnit': volumeInputUnit,
    'shipperReferenceNumber': shipperReferenceNumber,
    if (pickupStopKey != null && pickupStopKey!.isNotEmpty)
      'pickupStopKey': pickupStopKey,
  };
}

class DriverActualCargoInput {
  const DriverActualCargoInput({
    required this.deliveryOrderItemRef,
    required this.actualQtyKoli,
    required this.actualWeightInputValue,
    required this.actualWeightInputUnit,
    required this.actualVolumeInputValue,
    required this.actualVolumeInputUnit,
  });

  final String deliveryOrderItemRef;
  final double actualQtyKoli;
  final double actualWeightInputValue;
  final String actualWeightInputUnit;
  final double actualVolumeInputValue;
  final String actualVolumeInputUnit;

  Map<String, dynamic> toJson() => {
    'deliveryOrderItemRef': deliveryOrderItemRef,
    'actualQtyKoli': actualQtyKoli,
    'actualWeightInputValue': actualWeightInputValue,
    'actualWeightInputUnit': actualWeightInputUnit,
    'actualVolumeInputValue': actualVolumeInputValue,
    'actualVolumeInputUnit': actualVolumeInputUnit,
  };
}

class DriverActualDropPointInput {
  const DriverActualDropPointInput({
    required this.stopType,
    required this.locationName,
    required this.locationAddress,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
    this.deliveryOrderItemRef,
    this.deliveryOrderItemRefs = const [],
    this.actualDropGroupKey,
    this.shipperReferenceNumber,
    this.shipperReferenceKey,
    this.originLocationName,
    this.originLocationAddress,
    this.note,
  });

  final String stopType;
  final String? deliveryOrderItemRef;
  final List<String> deliveryOrderItemRefs;
  final String? actualDropGroupKey;
  final String? shipperReferenceNumber;
  final String? shipperReferenceKey;
  final String? originLocationName;
  final String? originLocationAddress;
  final String locationName;
  final String locationAddress;
  final double qtyKoli;
  final double weightInputValue;
  final String weightInputUnit;
  final double volumeInputValue;
  final String volumeInputUnit;
  final String? note;

  Map<String, dynamic> toJson() => {
    'stopType': stopType,
    if (deliveryOrderItemRef != null && deliveryOrderItemRef!.trim().isNotEmpty)
      'deliveryOrderItemRef': deliveryOrderItemRef!.trim(),
    if (deliveryOrderItemRefs.isNotEmpty)
      'deliveryOrderItemRefs': deliveryOrderItemRefs
          .map((item) => item.trim())
          .where((item) => item.isNotEmpty)
          .toList(growable: false),
    if (actualDropGroupKey != null && actualDropGroupKey!.trim().isNotEmpty)
      'actualDropGroupKey': actualDropGroupKey!.trim(),
    if (shipperReferenceNumber != null &&
        shipperReferenceNumber!.trim().isNotEmpty)
      'shipperReferenceNumber': shipperReferenceNumber!.trim(),
    if (shipperReferenceKey != null && shipperReferenceKey!.trim().isNotEmpty)
      'shipperReferenceKey': shipperReferenceKey!.trim(),
    if (originLocationName != null && originLocationName!.trim().isNotEmpty)
      'originLocationName': originLocationName!.trim(),
    if (originLocationAddress != null &&
        originLocationAddress!.trim().isNotEmpty)
      'originLocationAddress': originLocationAddress!.trim(),
    'locationName': locationName,
    'locationAddress': locationAddress,
    'qtyKoli': qtyKoli,
    'weightInputValue': weightInputValue,
    'weightInputUnit': weightInputUnit,
    'volumeInputValue': volumeInputValue,
    'volumeInputUnit': volumeInputUnit,
    if (note != null && note!.trim().isNotEmpty) 'note': note!.trim(),
  };
}

class DeliveryOrderException implements Exception {
  const DeliveryOrderException(this.message, this.statusCode);

  final String message;
  final int statusCode;

  @override
  String toString() => 'DeliveryOrderException($statusCode): $message';
}

class _SuratJalanRecordMetadata {
  const _SuratJalanRecordMetadata({
    required this.documentId,
    required this.pickupAddress,
    required this.tripStatus,
    this.tripDate,
    this.holdQtyKoli,
    this.holdWeightKg,
    this.holdVolumeM3,
  });

  final String? documentId;
  final String? pickupAddress;
  final String? tripStatus;
  final String? tripDate;
  final double? holdQtyKoli;
  final double? holdWeightKg;
  final double? holdVolumeM3;
}

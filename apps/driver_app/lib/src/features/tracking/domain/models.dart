enum TripStatus { assigned, onDelivery, arrived, partialHold, delivered }

String deliveryStatusApiValue(TripStatus status) {
  return switch (status) {
    TripStatus.assigned => 'CREATED',
    TripStatus.onDelivery => 'ON_DELIVERY',
    TripStatus.arrived => 'ARRIVED',
    TripStatus.partialHold => 'PARTIAL_HOLD',
    TripStatus.delivered => 'DELIVERED',
  };
}

bool deliveryStatusRequiresActiveTracking(TripStatus status) {
  return switch (status) {
    TripStatus.onDelivery || TripStatus.arrived => true,
    TripStatus.assigned ||
    TripStatus.partialHold ||
    TripStatus.delivered => false,
  };
}

String deliveryStatusLabel(String status) {
  return switch (status.trim().toUpperCase()) {
    'CREATED' => 'Dibuat',
    'ON_DELIVERY' => 'Dalam Pengiriman',
    'ARRIVED' => 'Tiba di Tujuan',
    'PARTIAL_HOLD' => 'Terkirim Sebagian / Hold',
    'DELIVERED' => 'Terkirim',
    'CANCELLED' => 'Dibatalkan',
    'DRIVER_REQUESTED_DELIVERED' => 'Driver Ajukan Finalisasi',
    'DRIVER_REQUEST_REJECTED' => 'Permintaan Driver Ditolak',
    _ => status.trim().isEmpty ? '-' : status.trim(),
  };
}

class DeliveryPickupStop {
  const DeliveryPickupStop({
    required this.key,
    required this.sequence,
    required this.pickupAddress,
    this.pickupLabel,
    this.notes,
  });

  final String key;
  final int sequence;
  final String pickupAddress;
  final String? pickupLabel;
  final String? notes;

  String get displayLabel {
    final label = (pickupLabel ?? '').trim();
    if (label.isNotEmpty) {
      return 'Pickup $sequence - $label';
    }
    return 'Pickup $sequence';
  }
}

class DeliveryShipperReference {
  const DeliveryShipperReference({
    required this.referenceNumber,
    this.documentId,
    this.key,
    this.tripStatus,
    this.date,
    this.holdQtyKoli,
    this.holdWeightKg,
    this.holdVolumeM3,
    this.pickupStopKey,
    this.pickupAddress,
    this.receiverName,
    this.receiverCompany,
    this.receiverAddress,
  });

  final String referenceNumber;
  final String? documentId;
  final String? key;
  final String? tripStatus;
  final String? date;
  final double? holdQtyKoli;
  final double? holdWeightKg;
  final double? holdVolumeM3;
  final String? pickupStopKey;
  final String? pickupAddress;
  final String? receiverName;
  final String? receiverCompany;
  final String? receiverAddress;

  bool get canRequestFinalization {
    final status = tripStatus?.trim().toUpperCase();
    return status == null ||
        status.isEmpty ||
        status == 'ARRIVED' ||
        status == 'PARTIAL_HOLD';
  }

  String get statusLabel => deliveryStatusLabel(tripStatus ?? '');

  String get targetLabel {
    final company = (receiverCompany ?? '').trim();
    if (company.isNotEmpty) return company;
    final name = (receiverName ?? '').trim();
    if (name.isNotEmpty) return name;
    final address = (receiverAddress ?? '').trim();
    if (address.isNotEmpty) return address;
    return '-';
  }

  DeliveryShipperReference copyWith({String? tripStatus}) {
    return DeliveryShipperReference(
      referenceNumber: referenceNumber,
      documentId: documentId,
      key: key,
      tripStatus: tripStatus ?? this.tripStatus,
      date: date,
      holdQtyKoli: holdQtyKoli,
      holdWeightKg: holdWeightKg,
      holdVolumeM3: holdVolumeM3,
      pickupStopKey: pickupStopKey,
      pickupAddress: pickupAddress,
      receiverName: receiverName,
      receiverCompany: receiverCompany,
      receiverAddress: receiverAddress,
    );
  }
}

class DeliveryCargoItem {
  const DeliveryCargoItem({
    required this.id,
    required this.description,
    this.pickupStopKey,
    this.pickupAddress,
    this.shipperReferenceKey,
    this.shipperReferenceNumber,
    this.customerProductRef,
    this.qtyKoli,
    this.weightKg,
    this.volumeM3,
    this.weightInputValue,
    this.weightInputUnit,
    this.volumeInputValue,
    this.volumeInputUnit,
    this.heldQtyKoli,
    this.heldWeightKg,
    this.heldVolumeM3,
    this.actualQtyKoli,
    this.actualWeightInputValue,
    this.actualWeightInputUnit,
    this.actualVolumeInputValue,
    this.actualVolumeInputUnit,
  });

  final String id;
  final String description;
  final String? pickupStopKey;
  final String? pickupAddress;
  final String? shipperReferenceKey;
  final String? shipperReferenceNumber;
  final String? customerProductRef;
  final double? qtyKoli;
  final double? weightKg;
  final double? volumeM3;
  final double? weightInputValue;
  final String? weightInputUnit;
  final double? volumeInputValue;
  final String? volumeInputUnit;
  final double? heldQtyKoli;
  final double? heldWeightKg;
  final double? heldVolumeM3;
  final double? actualQtyKoli;
  final double? actualWeightInputValue;
  final String? actualWeightInputUnit;
  final double? actualVolumeInputValue;
  final String? actualVolumeInputUnit;
}

class PendingDriverActualCargoItem {
  const PendingDriverActualCargoItem({
    required this.deliveryOrderItemRef,
    this.actualQtyKoli,
    this.actualWeightInputValue,
    this.actualWeightInputUnit,
    this.actualVolumeInputValue,
    this.actualVolumeInputUnit,
  });

  final String deliveryOrderItemRef;
  final double? actualQtyKoli;
  final double? actualWeightInputValue;
  final String? actualWeightInputUnit;
  final double? actualVolumeInputValue;
  final String? actualVolumeInputUnit;
}

class DeliveryActualDropPoint {
  const DeliveryActualDropPoint({
    required this.stopType,
    required this.locationName,
    this.deliveryOrderItemRef,
    this.deliveryOrderItemRefs = const [],
    this.actualDropGroupKey,
    this.shipperReferenceNumber,
    this.shipperReferenceKey,
    this.sequence,
    this.originLocationName,
    this.originLocationAddress,
    this.locationAddress,
    this.qtyKoli,
    this.weightInputValue,
    this.weightInputUnit,
    this.volumeInputValue,
    this.volumeInputUnit,
    this.note,
  });

  final int? sequence;
  final String stopType;
  final String? deliveryOrderItemRef;
  final List<String> deliveryOrderItemRefs;
  final String? actualDropGroupKey;
  final String? shipperReferenceNumber;
  final String? shipperReferenceKey;
  final String? originLocationName;
  final String? originLocationAddress;
  final String locationName;
  final String? locationAddress;
  final double? qtyKoli;
  final double? weightInputValue;
  final String? weightInputUnit;
  final double? volumeInputValue;
  final String? volumeInputUnit;
  final String? note;
}

class CustomerProductOption {
  const CustomerProductOption({
    required this.id,
    required this.customerRef,
    required this.name,
    this.code,
    this.description,
    this.defaultQtyKoli,
    this.defaultWeight,
    this.defaultWeightInputValue,
    this.defaultWeightInputUnit,
    this.defaultVolume,
    this.defaultVolumeInputValue,
    this.defaultVolumeInputUnit,
  });

  final String id;
  final String customerRef;
  final String name;
  final String? code;
  final String? description;
  final double? defaultQtyKoli;
  final double? defaultWeight;
  final double? defaultWeightInputValue;
  final String? defaultWeightInputUnit;
  final double? defaultVolume;
  final double? defaultVolumeInputValue;
  final String? defaultVolumeInputUnit;

  String get displayLabel {
    final normalizedCode = (code ?? '').trim();
    if (normalizedCode.isNotEmpty) {
      return '$normalizedCode - $name';
    }
    return name;
  }
}

class CustomerRecipientOption {
  const CustomerRecipientOption({
    required this.id,
    required this.customerRef,
    required this.label,
    required this.receiverName,
    required this.receiverAddress,
    this.receiverPhone,
    this.receiverCompany,
  });

  final String id;
  final String customerRef;
  final String label;
  final String receiverName;
  final String receiverAddress;
  final String? receiverPhone;
  final String? receiverCompany;

  String get locationName {
    final company = (receiverCompany ?? '').trim();
    if (company.isNotEmpty) return company;
    final name = receiverName.trim();
    if (name.isNotEmpty) return name;
    return label.trim();
  }

  String get displayLabel {
    final normalizedLabel = label.trim();
    final target = locationName.trim();
    if (normalizedLabel.isNotEmpty &&
        target.isNotEmpty &&
        normalizedLabel.toLowerCase() != target.toLowerCase()) {
      return '$normalizedLabel - $target';
    }
    if (normalizedLabel.isNotEmpty) return normalizedLabel;
    if (target.isNotEmpty) return target;
    return receiverAddress;
  }
}

class DriverAssignedTripPlan {
  const DriverAssignedTripPlan({
    required this.orderRef,
    required this.tripPlanKey,
    required this.tripSequence,
    required this.pickupStops,
    required this.allowsDirectCargoInput,
    this.masterResi,
    this.customerRef,
    this.customerRefs = const [],
    this.customerName,
    this.serviceName,
    this.vehicleRef,
    this.vehiclePlate,
    this.driverRef,
    this.driverName,
    this.tripOriginArea,
    this.tripDestinationArea,
    this.taripBorongan,
    this.cashGiven,
    this.issueBankName,
    this.date,
    this.notes,
    this.linkedDeliveryOrderRef,
    this.linkedDeliveryOrderNumber,
    this.linkedDeliveryOrderStatus,
  });

  final String orderRef;
  final String tripPlanKey;
  final int tripSequence;
  final List<DeliveryPickupStop> pickupStops;
  final bool allowsDirectCargoInput;
  final String? masterResi;
  final String? customerRef;
  /// Every customer this trip plan serves; the primary `customerRef` is first.
  final List<String> customerRefs;
  final String? customerName;
  final String? serviceName;
  final String? vehicleRef;
  final String? vehiclePlate;
  final String? driverRef;
  final String? driverName;
  final String? tripOriginArea;
  final String? tripDestinationArea;
  final double? taripBorongan;
  final double? cashGiven;
  final String? issueBankName;
  final String? date;
  final String? notes;
  final String? linkedDeliveryOrderRef;
  final String? linkedDeliveryOrderNumber;
  final String? linkedDeliveryOrderStatus;

  String get tripLabel => masterResi?.trim().isNotEmpty == true
      ? '${masterResi!} / Trip $tripSequence'
      : 'Trip $tripSequence';
}

class DriverTripVoucher {
  const DriverTripVoucher({
    required this.id,
    required this.bonNumber,
    required this.status,
    required this.issuedDate,
    required this.totalIssuedAmount,
    required this.initialCashGiven,
    required this.topUpAmount,
    required this.operationalSpent,
    required this.operationalBalance,
    required this.driverFeeAmount,
    required this.totalClaimAmount,
    required this.netSettlementAmount,
    this.doNumber,
    this.deliveryOrderRef,
    this.vehiclePlate,
    this.route,
    this.issueBankName,
    this.settlementBankName,
    this.notes,
    this.disbursements = const [],
    this.items = const [],
  });

  final String id;
  final String bonNumber;
  final String status;
  final String issuedDate;
  final double totalIssuedAmount;
  final double initialCashGiven;
  final double topUpAmount;
  final double operationalSpent;
  final double operationalBalance;
  final double driverFeeAmount;
  final double totalClaimAmount;
  final double netSettlementAmount;
  final String? doNumber;
  final String? deliveryOrderRef;
  final String? vehiclePlate;
  final String? route;
  final String? issueBankName;
  final String? settlementBankName;
  final String? notes;
  final List<DriverTripVoucherDisbursement> disbursements;
  final List<DriverTripVoucherItem> items;

  String get statusLabel => switch (status) {
    'DRAFT' => 'Draft',
    'ISSUED' => 'Diberikan',
    'SETTLED' => 'Selesai',
    _ => status,
  };

  String get settlementLabel {
    if (netSettlementAmount < 0) return '$settlementDisplayLabel ke supir';
    if (netSettlementAmount > 0) return 'Dikembalikan ke perusahaan';
    return 'Nihil';
  }

  String get settlementDisplayLabel {
    if (netSettlementAmount < 0) {
      return '${formatDriverTripVoucherBonLabel(disbursements.length + 1)} Penutupan';
    }
    if (netSettlementAmount > 0) return 'Pengembalian Sisa Bon';
    return 'Penyelesaian Uang Jalan';
  }
}

String formatDriverTripVoucherBonLabel(int sequence) {
  if (sequence <= 1) return 'Bon Pertama';
  if (sequence == 2) return 'Bon Kedua';
  if (sequence == 3) return 'Bon Ketiga';
  return 'Bon Ke-$sequence';
}

class DriverTripVoucherDisbursement {
  const DriverTripVoucherDisbursement({
    required this.id,
    required this.date,
    required this.kind,
    required this.amount,
    this.bankAccountName,
    this.note,
  });

  final String id;
  final String date;
  final String kind;
  final double amount;
  final String? bankAccountName;
  final String? note;
}

class DriverTripVoucherItem {
  const DriverTripVoucherItem({
    required this.id,
    required this.expenseDate,
    required this.category,
    required this.amount,
    this.description,
  });

  final String id;
  final String expenseDate;
  final String category;
  final double amount;
  final String? description;
}

class DriverPortalData {
  const DriverPortalData({
    required this.trips,
    required this.plannedTrips,
    required this.customerProducts,
    required this.customerRecipients,
    this.driverVouchers = const [],
    this.incidents = const [],
  });

  final List<DeliveryTrip> trips;
  final List<DriverAssignedTripPlan> plannedTrips;
  final List<CustomerProductOption> customerProducts;
  final List<CustomerRecipientOption> customerRecipients;
  final List<DriverTripVoucher> driverVouchers;
  final List<DriverIncident> incidents;
}

class DriverIncident {
  const DriverIncident({
    required this.id,
    required this.incidentNumber,
    required this.status,
    required this.incidentType,
    required this.urgency,
    required this.relatedDeliveryOrderRef,
    required this.relatedDONumber,
    required this.description,
    required this.locationText,
    this.odometer,
    this.dateTime,
    this.pendingDriverResolutionRequestedAt,
    this.settlementLines = const [],
  });

  final String id;
  final String incidentNumber;
  final String status;
  final String incidentType;
  final String urgency;
  final String relatedDeliveryOrderRef;
  final String relatedDONumber;
  final String description;
  final String locationText;
  final double? odometer;
  final String? dateTime;
  final String? pendingDriverResolutionRequestedAt;
  final List<DriverIncidentSettlementLine> settlementLines;

  bool get hasPendingDriverResolutionRequest =>
      pendingDriverResolutionRequestedAt?.trim().isNotEmpty == true;

  bool get hasDriverSubmittedSettlementLine =>
      settlementLines.any((line) => line.isDriverSubmitted);

  bool get hasSubmittedResolution =>
      hasPendingDriverResolutionRequest || hasDriverSubmittedSettlementLine;

  bool get hasReviewedResolution =>
      isFinalAdminStage ||
      settlementLines.any(
        (line) => line.isDriverSubmitted && line.status != 'DRAFT',
      );

  bool get hasPostedResolution => settlementLines.any(
    (line) => line.isDriverSubmitted && line.status == 'POSTED',
  );

  bool get isWaitingResolutionReview =>
      hasSubmittedResolution && !hasReviewedResolution;

  bool get isFinalAdminStage => status == 'RESOLVED' || status == 'CLOSED';

  bool get canSubmitResolution => !isFinalAdminStage && !hasSubmittedResolution;

  bool get canAddResolutionCost => isWaitingResolutionReview;

  bool get canOpenResolutionForm => canSubmitResolution || canAddResolutionCost;

  bool get blocksNewIncidentReport => status != 'CLOSED';

  int get draftCostCount =>
      settlementLines.where((line) => line.status == 'DRAFT').length;
}

class DriverIncidentSettlementLine {
  const DriverIncidentSettlementLine({
    required this.id,
    required this.status,
    required this.category,
    required this.amount,
    required this.description,
    this.isDriverSubmitted = false,
  });

  final String id;
  final String status;
  final String category;
  final double amount;
  final String description;
  final bool isDriverSubmitted;
}

class DriverIncidentCostInput {
  const DriverIncidentCostInput({
    required this.category,
    required this.amount,
    required this.description,
    this.payeeName,
    this.note,
  });

  final String category;
  final double amount;
  final String description;
  final String? payeeName;
  final String? note;

  Map<String, dynamic> toJson() => {
    'category': category,
    'amount': amount,
    'description': description,
    if (payeeName != null && payeeName!.trim().isNotEmpty)
      'payeeName': payeeName!.trim(),
    if (note != null && note!.trim().isNotEmpty) 'note': note!.trim(),
  };
}

class DeliveryTrip {
  const DeliveryTrip({
    required this.deliveryOrderId,
    required this.doNumber,
    required this.vehiclePlate,
    required this.originLabel,
    required this.destinationLabel,
    required this.customerName,
    required this.status,
    required this.etdLabel,
    required this.statusNote,
    required this.allowsDirectCargoInput,
    this.orderRef,
    this.customerRef,
    this.customerRefs = const [],
    this.trackingState,
    this.pendingDriverStatus,
    this.pendingDriverRequests = const [],
    this.tripClosedByAdminAt,
    this.tripClosedByAdminName,
    this.vehicleLastOdometer,
    this.vehicleLastOdometerAt,
    this.tripEndOdometerKm,
    this.receiverName,
    this.receiverAddress,
    this.itemSummary,
    this.pickupStops = const [],
    this.shipperReferences = const [],
    this.cargoItems = const [],
    this.actualDropPoints = const [],
    this.pendingActualCargoItems = const [],
    this.pendingActualDropPoints = const [],
    this.rejectedRequestStatus,
    this.rejectedRequestNote,
    this.rejectedRequestAt,
  });

  final String deliveryOrderId;
  final String doNumber;
  final String vehiclePlate;
  final String originLabel;
  final String destinationLabel;
  final String customerName;
  final TripStatus status;
  final String etdLabel;
  final String statusNote;
  final bool allowsDirectCargoInput;
  final String? orderRef;
  final String? customerRef;
  /// Every customer this trip serves; the primary `customerRef` is first.
  final List<String> customerRefs;
  final String? trackingState;
  final String? pendingDriverStatus;
  final List<PendingDriverRequest> pendingDriverRequests;
  final String? tripClosedByAdminAt;
  final String? tripClosedByAdminName;
  final double? vehicleLastOdometer;
  final String? vehicleLastOdometerAt;
  final double? tripEndOdometerKm;
  final String? receiverName;
  final String? receiverAddress;
  final String? itemSummary;
  final List<DeliveryPickupStop> pickupStops;
  final List<DeliveryShipperReference> shipperReferences;
  final List<DeliveryCargoItem> cargoItems;
  final List<DeliveryActualDropPoint> actualDropPoints;
  final List<PendingDriverActualCargoItem> pendingActualCargoItems;
  final List<DeliveryActualDropPoint> pendingActualDropPoints;
  final String? rejectedRequestStatus;
  final String? rejectedRequestNote;
  final String? rejectedRequestAt;

  bool get hasRejectedDriverRequestNotice =>
      rejectedRequestNote?.trim().isNotEmpty == true;

  bool get hasPendingTripClosureRequest =>
      pendingDriverRequests.any((request) => request.isTripClosureRequest);

  bool get hasUntargetedPendingFinalizationRequest => pendingDriverRequests.any(
    (request) =>
        request.status == 'DELIVERED' &&
        !request.isTripClosureRequest &&
        request.targetSuratJalanRefs.isEmpty,
  );

  bool get hasBlockingAdminApproval =>
      pendingDriverStatus == 'DELIVERED' ||
      hasPendingTripClosureRequest ||
      hasUntargetedPendingFinalizationRequest;

  bool get isTripClosedByAdmin =>
      tripClosedByAdminAt?.trim().isNotEmpty == true;

  bool get hasActiveTracking => trackingState?.trim().toUpperCase() == 'ACTIVE';

  bool get isAwaitingAdminApproval =>
      pendingDriverStatus == 'DELIVERED' || pendingDriverRequests.isNotEmpty;

  Set<String> get pendingFinalizationSuratJalanRefs {
    return pendingDriverRequests
        .where(
          (request) =>
              request.status == 'DELIVERED' && !request.isTripClosureRequest,
        )
        .expand((request) => request.targetSuratJalanRefs)
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet();
  }

  bool isShipperReferencePendingFinalization(
    DeliveryShipperReference reference,
  ) {
    final pendingRefs = pendingFinalizationSuratJalanRefs;
    if (pendingRefs.isEmpty) return false;

    final documentId = reference.documentId?.trim();
    final referenceKey = reference.key?.trim();
    final referenceNumber = reference.referenceNumber.trim();
    final candidates = <String>{
      if (documentId != null && documentId.isNotEmpty) documentId,
      if (referenceKey != null && referenceKey.isNotEmpty)
        '$deliveryOrderId:$referenceKey',
      if (referenceNumber.isNotEmpty) '$deliveryOrderId:$referenceNumber',
      if (referenceKey != null && referenceKey.isNotEmpty) referenceKey,
      if (referenceNumber.isNotEmpty) referenceNumber,
    };
    return candidates.any(pendingRefs.contains);
  }

  bool canRequestFinalizationForReference(DeliveryShipperReference reference) {
    return reference.canRequestFinalization &&
        !isShipperReferencePendingFinalization(reference);
  }

  bool get canRequestMoreFinalization {
    if (isTripClosedByAdmin || hasBlockingAdminApproval) return false;
    if (shipperReferences.isEmpty) return !isAwaitingAdminApproval;
    return shipperReferences.any(canRequestFinalizationForReference);
  }

  int get shipperReferenceCount => shipperReferences.length;

  DeliveryTrip copyWith({
    TripStatus? status,
    String? trackingState,
    String? pendingDriverStatus,
    String? statusNote,
    List<DeliveryShipperReference>? shipperReferences,
  }) {
    final nextStatus = status ?? this.status;
    final nextPendingDriverStatus =
        pendingDriverStatus ?? this.pendingDriverStatus;
    return DeliveryTrip(
      deliveryOrderId: deliveryOrderId,
      doNumber: doNumber,
      vehiclePlate: vehiclePlate,
      originLabel: originLabel,
      destinationLabel: destinationLabel,
      customerName: customerName,
      status: nextStatus,
      etdLabel: etdLabel,
      allowsDirectCargoInput: allowsDirectCargoInput,
      orderRef: orderRef,
      customerRef: customerRef,
      statusNote:
          statusNote ??
          defaultTripStatusNote(
            nextStatus,
            pendingDriverStatus: nextPendingDriverStatus,
            hasPendingTripClosureRequest: hasPendingTripClosureRequest,
          ),
      trackingState: trackingState ?? this.trackingState,
      pendingDriverStatus: nextPendingDriverStatus,
      pendingDriverRequests: pendingDriverRequests,
      tripClosedByAdminAt: tripClosedByAdminAt,
      tripClosedByAdminName: tripClosedByAdminName,
      vehicleLastOdometer: vehicleLastOdometer,
      vehicleLastOdometerAt: vehicleLastOdometerAt,
      tripEndOdometerKm: tripEndOdometerKm,
      receiverName: receiverName,
      receiverAddress: receiverAddress,
      itemSummary: itemSummary,
      pickupStops: pickupStops,
      shipperReferences: shipperReferences ?? this.shipperReferences,
      cargoItems: cargoItems,
      actualDropPoints: actualDropPoints,
      pendingActualCargoItems: pendingActualCargoItems,
      pendingActualDropPoints: pendingActualDropPoints,
      rejectedRequestStatus: rejectedRequestStatus,
      rejectedRequestNote: rejectedRequestNote,
      rejectedRequestAt: rejectedRequestAt,
    );
  }
}

class PendingDriverRequest {
  const PendingDriverRequest({
    required this.requestId,
    required this.status,
    this.targetSuratJalanRefs = const [],
    this.closeTripOnly = false,
    this.tripEndOdometerKm,
  });

  final String requestId;
  final String status;
  final List<String> targetSuratJalanRefs;
  final bool closeTripOnly;
  final double? tripEndOdometerKm;

  bool get isTripClosureRequest => closeTripOnly || tripEndOdometerKm != null;
}

String defaultTripStatusNote(
  TripStatus status, {
  String? pendingDriverStatus,
  bool hasPendingTripClosureRequest = false,
}) {
  if (hasPendingTripClosureRequest) {
    return 'Menunggu approval tutup trip';
  }
  if (pendingDriverStatus == 'DELIVERED') {
    return 'Menunggu approval admin';
  }

  return switch (status) {
    TripStatus.onDelivery => 'Pengiriman berjalan',
    TripStatus.arrived => 'Driver sudah tiba',
    TripStatus.partialHold => 'Sebagian muatan hold',
    TripStatus.delivered => 'Trip selesai',
    TripStatus.assigned => 'Trip sudah ditugaskan',
  };
}

class DriverLocationSnapshot {
  const DriverLocationSnapshot({
    required this.latitude,
    required this.longitude,
    required this.speedKph,
    required this.accuracyMeters,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final double speedKph;
  final double accuracyMeters;
  final DateTime recordedAt;
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/delivery_order_service.dart';
import '../domain/models.dart';
import '../../../shared/widgets/app_info_card.dart';
import 'mobile_action_feedback.dart';
import 'mobile_delivery_form_utils.dart';
import 'mobile_input_visibility.dart';
import 'mobile_numeric_input_formatter.dart';
import 'mobile_unit_selector_field.dart';

enum _CompletionStep { setup, drop, cargo, review }

const _completionSteps = [
  _CompletionStep.setup,
  _CompletionStep.drop,
  _CompletionStep.cargo,
  _CompletionStep.review,
];

extension _CompletionStepLabels on _CompletionStep {
  String get label => switch (this) {
    _CompletionStep.setup => 'SJ & POD',
    _CompletionStep.drop => 'Titik Drop',
    _CompletionStep.cargo => 'Aktual Barang',
    _CompletionStep.review => 'Kirim',
  };

  String get shortLabel => switch (this) {
    _CompletionStep.setup => 'SJ',
    _CompletionStep.drop => 'Drop',
    _CompletionStep.cargo => 'Barang',
    _CompletionStep.review => 'Kirim',
  };

  String get helper => switch (this) {
    _CompletionStep.setup => 'Pilih SJ dan POD',
    _CompletionStep.drop => 'Realisasi drop',
    _CompletionStep.cargo => 'Aktual barang',
    _CompletionStep.review => 'Review akhir',
  };
}

class DeliveryCompletionPage extends StatefulWidget {
  const DeliveryCompletionPage({
    super.key,
    required this.trip,
    required this.customerRecipients,
    this.initialSelectedSuratJalanRefs = const [],
  });

  final DeliveryTrip trip;
  final List<CustomerRecipientOption> customerRecipients;
  final List<String> initialSelectedSuratJalanRefs;

  @override
  State<DeliveryCompletionPage> createState() => _DeliveryCompletionPageState();
}

class _DeliveryCompletionPageState extends State<DeliveryCompletionPage>
    with WidgetsBindingObserver {
  final _inputVisibilityKey = GlobalKey();
  final _dropVisibilityKeys = <String, GlobalKey>{};
  final _noteController = TextEditingController();
  late final TextEditingController _podReceiverNameController;
  late final TextEditingController _podReceivedDateController;
  bool _submitting = false;
  bool _inputVisibilityScheduled = false;
  _CompletionStep _currentStep = _CompletionStep.setup;
  String? _selectedDropDraftId;
  late List<_ActualCargoDraft> _cargoDrafts;
  late List<_ActualDropDraft> _dropDrafts;
  late Set<String> _selectedShipperReferenceValues;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    FocusManager.instance.addListener(_scheduleFocusedInputVisibility);
    _cargoDrafts = _buildInitialCargoDrafts(widget.trip);
    _dropDrafts = _buildInitialDropDrafts(widget.trip, _cargoDrafts);
    _selectedShipperReferenceValues = _initialSelectedReferenceValues(
      widget.trip,
      _cargoDrafts,
      widget.initialSelectedSuratJalanRefs,
    );
    _dropDrafts = _normalizeDropDraftsForSelectedReferences(
      _dropDrafts,
      _selectedShipperReferences,
      _selectedCargoDrafts,
    );
    _selectedDropDraftId = _dropDrafts.isNotEmpty ? _dropDrafts.first.id : null;
    _podReceiverNameController = TextEditingController(
      text: _defaultPodReceiverName(widget.trip, _selectedShipperReferences),
    );
    _podReceivedDateController = TextEditingController(
      text: _currentJakartaDateValue(),
    );
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_scheduleFocusedInputVisibility);
    WidgetsBinding.instance.removeObserver(this);
    _dropVisibilityKeys.clear();
    _noteController.dispose();
    _podReceiverNameController.dispose();
    _podReceivedDateController.dispose();
    super.dispose();
  }

  @override
  void didChangeMetrics() {
    _scheduleFocusedInputVisibility();
  }

  List<DeliveryShipperReference> get _selectedShipperReferences =>
      _selectedReferencesForValues(
        widget.trip,
        widget.trip.shipperReferences,
        _selectedShipperReferenceValues,
      );

  List<_ActualCargoDraft> get _selectedCargoDrafts =>
      _cargoDraftsForSelectedReferences(
        _cargoDrafts,
        widget.trip.shipperReferences,
        _selectedShipperReferences,
      );

  List<_ActualDropDraft> get _selectedDropDrafts =>
      _dropDraftsForSelectedReferences(
        _dropDrafts,
        widget.trip.shipperReferences,
        _selectedShipperReferences,
      );

  void _setShipperReferenceSelected(String optionValue, bool selected) {
    setState(() {
      final nextValues = Set<String>.from(_selectedShipperReferenceValues);
      if (selected) {
        nextValues.add(optionValue);
      } else {
        nextValues.remove(optionValue);
      }
      _selectedShipperReferenceValues = nextValues;
      _dropDrafts = _normalizeDropDraftsForSelectedReferences(
        _dropDrafts,
        _selectedShipperReferences,
        _selectedCargoDrafts,
      );
      _selectedDropDraftId = _resolveSelectedDropDraft(
        _dropDraftsForSelectedReferences(
          _dropDrafts,
          widget.trip.shipperReferences,
          _selectedShipperReferences,
        ),
      )?.id;
    });
  }

  _ActualDropDraft? _resolveSelectedDropDraft(List<_ActualDropDraft> drafts) {
    if (drafts.isEmpty) return null;
    final selectedId = _selectedDropDraftId;
    if (selectedId != null) {
      for (final draft in drafts) {
        if (draft.id == selectedId) return draft;
      }
    }
    return drafts.first;
  }

  void _selectDropDraft(String draftId) {
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _selectedDropDraftId = draftId);
  }

  Future<void> _pickPodReceivedDate() async {
    final initialDate =
        _parseDateValue(_podReceivedDateController.text) ??
        _jakartaDateTimeNow();
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(_jakartaDateTimeNow().year + 2, 12, 31),
    );
    if (picked == null) return;
    _podReceivedDateController.text = _formatDateValue(picked);
  }

  void _updateCargo(
    String cargoId, {
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    setState(() {
      _cargoDrafts = _cargoDrafts
          .map((draft) {
            if (draft.itemId != cargoId) return draft;
            final nextWeightUnit = weightInputUnit == null
                ? draft.weightInputUnit
                : normalizeMobileWeightUnit(weightInputUnit);
            final nextVolumeUnit = volumeInputUnit == null
                ? draft.volumeInputUnit
                : normalizeMobileVolumeUnit(volumeInputUnit);
            final nextQty = qtyKoli ?? draft.qtyKoli;
            final autoWeightValue = qtyKoli != null && weightInputValue == null
                ? _autoWeightInputValueForQty(
                    draft: _ActualDropDraft.create(
                      qtyKoli: draft.qtyKoli,
                      weightInputValue: draft.weightInputValue,
                      weightInputUnit: draft.weightInputUnit,
                      volumeInputValue: draft.volumeInputValue,
                      volumeInputUnit: draft.volumeInputUnit,
                    ),
                    cargo: draft,
                    nextQtyKoli: nextQty,
                    nextWeightUnit: nextWeightUnit,
                  )
                : null;
            final autoVolumeValue = qtyKoli != null && volumeInputValue == null
                ? _autoVolumeInputValueForQty(
                    draft: _ActualDropDraft.create(
                      qtyKoli: draft.qtyKoli,
                      weightInputValue: draft.weightInputValue,
                      weightInputUnit: draft.weightInputUnit,
                      volumeInputValue: draft.volumeInputValue,
                      volumeInputUnit: draft.volumeInputUnit,
                    ),
                    cargo: draft,
                    nextQtyKoli: nextQty,
                    nextVolumeUnit: nextVolumeUnit,
                  )
                : null;
            final convertedWeightValue =
                weightInputUnit != null && weightInputValue == null
                ? formatMobileMetric(
                    _convertKgToWeightInputValue(
                      _convertWeightToKg(
                        draft.weightInputValueNumber,
                        draft.weightInputUnit,
                      ),
                      nextWeightUnit,
                    ),
                    fractionDigits: mobileWeightInputFractionDigits(
                      nextWeightUnit,
                    ),
                  )
                : weightInputValue ?? autoWeightValue;
            final convertedVolumeValue =
                volumeInputUnit != null && volumeInputValue == null
                ? formatMobileMetric(
                    _convertM3ToVolumeInputValue(
                      _convertVolumeToM3(
                        draft.volumeInputValueNumber,
                        draft.volumeInputUnit,
                      ),
                      nextVolumeUnit,
                    ),
                    fractionDigits: mobileVolumeInputFractionDigits(
                      nextVolumeUnit,
                    ),
                  )
                : volumeInputValue ?? autoVolumeValue;

            return draft.copyWith(
              qtyKoli: qtyKoli,
              weightInputValue: convertedWeightValue,
              weightInputUnit: weightInputUnit,
              volumeInputValue: convertedVolumeValue,
              volumeInputUnit: volumeInputUnit,
            );
          })
          .toList(growable: false);
    });
  }

  void _updateDrop(
    String draftId, {
    String? stopType,
    String? deliveryOrderItemRef,
    List<String>? deliveryOrderItemRefs,
    String? locationName,
    String? locationAddress,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
    String? shipperReferenceNumber,
    String? shipperReferenceKey,
    String? note,
  }) {
    final targetDraft = _dropDrafts.firstWhere(
      (draft) => draft.id == draftId,
      orElse: () => _ActualDropDraft.create(),
    );
    final groupDraftIds = targetDraft.id == draftId
        ? _dropGroupDraftsFor(
            targetDraft,
            _dropDrafts,
          ).map((draft) => draft.id).toSet()
        : <String>{};
    final hasPointLevelPatch =
        stopType != null || locationName != null || locationAddress != null;

    setState(() {
      _dropDrafts = _dropDrafts
          .map((draft) {
            if (draft.id != draftId &&
                (!hasPointLevelPatch || !groupDraftIds.contains(draft.id))) {
              return draft;
            }
            if (draft.id != draftId) {
              return draft.copyWith(
                stopType: stopType,
                locationName: locationName,
                locationAddress: locationAddress,
              );
            }
            if (draft.id != draftId) return draft;
            final selectedItem =
                _findCargoDraftByItemRef(
                  _cargoDrafts,
                  deliveryOrderItemRef ?? draft.deliveryOrderItemRef,
                ) ??
                _resolvedSingleCargoDraftForDrop(draft, _cargoDrafts);
            final nextQty = qtyKoli ?? draft.qtyKoli;
            final nextWeightUnit = weightInputUnit ?? draft.weightInputUnit;
            final nextVolumeUnit = volumeInputUnit ?? draft.volumeInputUnit;
            final nextWeightInputValue =
                qtyKoli != null && weightInputValue == null
                ? _autoWeightInputValueForQty(
                    draft: draft,
                    cargo: selectedItem,
                    nextQtyKoli: nextQty,
                    nextWeightUnit: nextWeightUnit,
                  )
                : weightInputUnit != null && weightInputValue == null
                ? formatMobileMetric(
                    _convertKgToWeightInputValue(
                      _convertWeightToKg(
                        draft.weightInputValueNumber,
                        draft.weightInputUnit,
                      ),
                      nextWeightUnit,
                    ),
                    fractionDigits: mobileWeightInputFractionDigits(
                      nextWeightUnit,
                    ),
                  )
                : weightInputValue;
            final nextVolumeInputValueFromQty =
                qtyKoli != null && volumeInputValue == null
                ? _autoVolumeInputValueForQty(
                    draft: draft,
                    cargo: selectedItem,
                    nextQtyKoli: nextQty,
                    nextVolumeUnit: nextVolumeUnit,
                  )
                : null;
            final nextVolumeInputValue =
                volumeInputUnit != null && volumeInputValue == null
                ? formatMobileMetric(
                    _convertM3ToVolumeInputValue(
                      _convertVolumeToM3(
                        draft.volumeInputValueNumber,
                        draft.volumeInputUnit,
                      ),
                      nextVolumeUnit,
                    ),
                    fractionDigits: mobileVolumeInputFractionDigits(
                      nextVolumeUnit,
                    ),
                  )
                : volumeInputValue ?? nextVolumeInputValueFromQty;

            return draft.copyWith(
              stopType: stopType,
              deliveryOrderItemRef: deliveryOrderItemRef,
              deliveryOrderItemRefs: deliveryOrderItemRefs,
              locationName: locationName,
              locationAddress: locationAddress,
              qtyKoli: qtyKoli,
              weightInputValue: nextWeightInputValue,
              weightInputUnit: weightInputUnit,
              volumeInputValue: nextVolumeInputValue,
              volumeInputUnit: volumeInputUnit,
              shipperReferenceNumber: shipperReferenceNumber,
              shipperReferenceKey: shipperReferenceKey,
              note: note,
            );
          })
          .toList(growable: false);
    });
  }

  void _addDropPoint() {
    FocusManager.instance.primaryFocus?.unfocus();
    final drafts = _createNextDropDraftsForSelectedCargo(
      _selectedCargoDrafts,
      _selectedDropDrafts,
      _selectedShipperReferences,
    );
    final selectedDraft = drafts.first;
    setState(() {
      _dropDrafts = [..._dropDrafts, ...drafts];
      _selectedDropDraftId = selectedDraft.id;
    });
    _scheduleDraftVisibility(_dropVisibilityKey(selectedDraft.id));
  }

  Future<void> _removeDropPoint(String draftId) async {
    final confirmed = await showMobileActionConfirmation(
      context,
      title: 'Hapus titik drop?',
      message:
          'Qty, berat, volume, dan catatan di titik ini akan hilang dari draft finalisasi. Data belum dikirim sebelum kamu menekan Ajukan Selesai.',
      confirmLabel: 'Hapus Titik',
      icon: Icons.delete_outline_rounded,
      destructive: true,
    );
    if (!mounted || !confirmed) return;

    setState(() {
      final next = _dropDrafts.where((draft) => draft.id != draftId).toList();
      _dropDrafts = next.isNotEmpty ? next : [_ActualDropDraft.create()];
      _selectedDropDraftId = _resolveSelectedDropDraft(_selectedDropDrafts)?.id;
    });
  }

  void _addCargoAllocationToDrop(
    String draftId,
    List<_DropAllocationEditResult> results,
  ) {
    if (results.isEmpty) return;
    final sourceDraft = _dropDrafts.firstWhere(
      (draft) => draft.id == draftId,
      orElse: () => _ActualDropDraft.create(),
    );
    if (sourceDraft.id != draftId || _selectedCargoDrafts.isEmpty) return;

    var nextDropDrafts = [..._dropDrafts];
    var selectedResultDraftId = draftId;

    for (final result in results) {
      final cargo = result.cargo;
      final latestSourceDraft = nextDropDrafts.firstWhere(
        (draft) => draft.id == draftId,
        orElse: () => sourceDraft,
      );
      final groupDrafts = _dropGroupDraftsFor(
        latestSourceDraft,
        nextDropDrafts,
      );
      final existingDraft = groupDrafts.firstWhere(
        (draft) => _normalizedDropItemRefs(draft).contains(cargo.itemId),
        orElse: () => _ActualDropDraft.create(groupKey: sourceDraft.groupKey),
      );

      if (existingDraft.groupKey == sourceDraft.groupKey &&
          _normalizedDropItemRefs(existingDraft).contains(cargo.itemId)) {
        final updatedDraft = _applyDropAllocationValues(existingDraft, result);
        nextDropDrafts = nextDropDrafts
            .map((entry) => entry.id == existingDraft.id ? updatedDraft : entry)
            .toList(growable: false);
        selectedResultDraftId = updatedDraft.id;
        continue;
      }

      final targetIsBlank =
          latestSourceDraft.id == draftId &&
          !_dropDraftHasItemSelection(latestSourceDraft) &&
          !_hasActualDropItemValues(latestSourceDraft);
      if (targetIsBlank) {
        final nextDraft = _applyCargoDraftToDrop(
          latestSourceDraft,
          cargo,
          nextDropDrafts,
          forceValues: true,
        );
        final updatedDraft = _applyDropAllocationValues(nextDraft, result);
        nextDropDrafts = nextDropDrafts
            .map((draft) => draft.id == draftId ? updatedDraft : draft)
            .toList(growable: false);
        selectedResultDraftId = updatedDraft.id;
        continue;
      }

      final base = _ActualDropDraft.create(
        stopType: latestSourceDraft.stopType,
        shipperReferenceNumber: latestSourceDraft.shipperReferenceNumber,
        shipperReferenceKey: latestSourceDraft.shipperReferenceKey,
        originLocationName: latestSourceDraft.originLocationName,
        originLocationAddress: latestSourceDraft.originLocationAddress,
        locationName: latestSourceDraft.locationName,
        locationAddress: latestSourceDraft.locationAddress,
        weightInputUnit: latestSourceDraft.weightInputUnit,
        volumeInputUnit: latestSourceDraft.volumeInputUnit,
        note: latestSourceDraft.note,
        groupKey: latestSourceDraft.groupKey,
      );
      final nextDraft = _applyCargoDraftToDrop(
        base,
        cargo,
        nextDropDrafts,
        forceValues: true,
      );
      final updatedDraft = _applyDropAllocationValues(nextDraft, result);
      nextDropDrafts = [...nextDropDrafts, updatedDraft];
      selectedResultDraftId = updatedDraft.id;
    }

    setState(() {
      _dropDrafts = nextDropDrafts;
      _selectedDropDraftId = selectedResultDraftId;
    });
    _scheduleDraftVisibility(_dropVisibilityKey(selectedResultDraftId));
  }

  void _selectRecipient(String draftId, String recipientId) {
    // "Isi manual" memakai nilai kosong. Memilihnya harus membersihkan
    // nama/alamat yang tadi otomatis terisi dari Master Customer supaya
    // field "Nama Lokasi" jadi satu-satunya sumber kebenaran.
    if (recipientId.isEmpty) {
      _updateDrop(draftId, locationName: '', locationAddress: '');
      return;
    }

    CustomerRecipientOption? recipient;
    for (final item in widget.customerRecipients) {
      if (item.id == recipientId) {
        recipient = item;
        break;
      }
    }
    final selectedRecipient = recipient;
    if (selectedRecipient == null) return;

    _updateDrop(
      draftId,
      locationName: selectedRecipient.locationName,
      locationAddress: selectedRecipient.receiverAddress,
    );
  }

  Future<void> _submit() async {
    final validationError = _validateDrafts();
    if (validationError != null) {
      _showError(validationError);
      return;
    }

    final selectedReferences = _selectedShipperReferences;
    final submissionDropDrafts =
        _effectiveSubmissionDropDrafts(
              _selectedDropDrafts,
              _selectedCargoDrafts,
            )
            .map(
              (draft) =>
                  _applySingleReferenceToBlankDrop(draft, selectedReferences),
            )
            .toList(growable: false);
    final actualItems = _buildSubmissionActualItems(
      _selectedCargoDrafts,
      submissionDropDrafts,
    );

    final actualDropPoints = submissionDropDrafts
        .map((draft) {
          final itemRefs = _dropItemRefsForSubmission(
            draft,
            _selectedCargoDrafts,
          );
          return DriverActualDropPointInput(
            stopType: _normalizeDropStopType(draft.stopType),
            deliveryOrderItemRef: itemRefs.length == 1 ? itemRefs.first : null,
            deliveryOrderItemRefs: itemRefs,
            actualDropGroupKey: draft.groupKey,
            shipperReferenceNumber:
                draft.shipperReferenceNumber.trim().isNotEmpty
                ? draft.shipperReferenceNumber.trim()
                : null,
            shipperReferenceKey: draft.shipperReferenceKey.trim().isNotEmpty
                ? draft.shipperReferenceKey.trim()
                : null,
            originLocationName: draft.originLocationName.trim().isNotEmpty
                ? draft.originLocationName.trim()
                : null,
            originLocationAddress: draft.originLocationAddress.trim().isNotEmpty
                ? draft.originLocationAddress.trim()
                : null,
            locationName: draft.locationName.trim().isNotEmpty
                ? draft.locationName.trim()
                : draft.locationAddress.trim(),
            locationAddress: draft.locationAddress.trim(),
            qtyKoli: draft.qtyKoliValue,
            weightInputValue: draft.weightInputValueNumber,
            weightInputUnit: normalizeMobileWeightUnit(draft.weightInputUnit),
            volumeInputValue: draft.volumeInputValueNumber,
            volumeInputUnit: normalizeMobileVolumeUnit(draft.volumeInputUnit),
            note: draft.note.trim().isNotEmpty ? draft.note.trim() : null,
          );
        })
        .toList(growable: false);

    setState(() => _submitting = true);
    Navigator.of(context).pop(
      DeliveryCompletionSubmitResult(
        note: _noteController.text.trim(),
        podReceiverName: _podReceiverNameController.text.trim(),
        podReceivedDate: _podReceivedDateController.text.trim(),
        selectedSuratJalanRefs: _selectedSuratJalanDocumentIds(
          widget.trip,
          selectedReferences,
          _selectedCargoDrafts,
        ),
        actualItems: actualItems,
        actualDropPoints: actualDropPoints,
      ),
    );
  }

  String? _validateDrafts() {
    final selectedReferences = _selectedShipperReferences;
    final selectedCargoDrafts = _selectedCargoDrafts;
    final selectedDropDrafts = _selectedDropDrafts;
    final effectiveDropDrafts = _effectiveSubmissionDropDrafts(
      selectedDropDrafts,
      selectedCargoDrafts,
    );
    if (widget.trip.shipperReferences.isNotEmpty &&
        selectedReferences.isEmpty) {
      return 'Pilih minimal satu SJ untuk diajukan selesai.';
    }
    if (_podReceiverNameController.text.trim().isEmpty) {
      return 'Nama penerima POD wajib diisi.';
    }
    if (!_isValidDateValue(_podReceivedDateController.text)) {
      return 'Tanggal terima POD wajib diisi dengan format YYYY-MM-DD.';
    }
    if (selectedCargoDrafts.isEmpty) {
      return 'Muatan DO belum ada. Isi barang dulu sebelum ajukan selesai.';
    }

    final itemSpecificDropRefs = effectiveDropDrafts
        .map((drop) => _dropItemRefsForSubmission(drop, selectedCargoDrafts))
        .where((refs) => refs.length == 1)
        .expand((refs) => refs)
        .toSet();
    for (final draft in selectedCargoDrafts) {
      final derivedFromItemDrop = itemSpecificDropRefs.contains(draft.itemId);
      final qty = draft.qtyKoliValue;
      final weight = draft.weightInputValueNumber;
      final volume = draft.volumeInputValueNumber;
      final hasActualValue = qty > 0 || weight > 0 || volume > 0;
      if (!hasActualValue && !derivedFromItemDrop) {
        return 'Semua barang harus punya realisasi aktual.';
      }
      if (!derivedFromItemDrop && draft.requireQty && qty <= 0) {
        return 'Qty aktual wajib diisi untuk barang yang punya target koli.';
      }
      if (!derivedFromItemDrop && draft.requireWeight && weight <= 0) {
        return 'Berat aktual wajib diisi untuk barang yang punya target berat.';
      }
      if (!derivedFromItemDrop && draft.requireVolume && volume <= 0) {
        return 'Volume aktual wajib diisi untuk barang yang punya target volume.';
      }
    }

    if (selectedDropDrafts.isEmpty) {
      return 'Isi minimal satu titik realisasi drop.';
    }

    final activeDropDrafts = _activeDropDraftsForValidation(selectedDropDrafts);
    final missingLocationMessage = _getMissingDropLocationMessage(
      activeDropDrafts,
    );
    if (missingLocationMessage != null) {
      return missingLocationMessage;
    }

    for (final draft in effectiveDropDrafts) {
      if (_isIgnorableEmptyNonBillableDrop(draft)) continue;
      if (draft.qtyKoliValue <= 0 &&
          draft.weightInputValueNumber <= 0 &&
          draft.volumeInputValueNumber <= 0) {
        return 'Setiap titik realisasi harus punya qty, berat, atau volume.';
      }
    }

    final detailedDropMessage = _getDetailedMultiDropAllocationMessage(
      effectiveDropDrafts,
      selectedCargoDrafts,
    );
    if (detailedDropMessage != null) {
      return detailedDropMessage;
    }

    final remainingAllocationMessage = _getRemainingDropAllocationMessage(
      activeDropDrafts,
      selectedCargoDrafts,
    );
    if (remainingAllocationMessage != null) {
      return remainingAllocationMessage;
    }

    final ambiguityMessage = _getAmbiguousActualDropMappingMessage(
      effectiveDropDrafts,
      selectedCargoDrafts,
    );
    if (ambiguityMessage != null) {
      return ambiguityMessage;
    }

    final normalizedDropDrafts = effectiveDropDrafts
        .map(
          (draft) =>
              _applySingleReferenceToBlankDrop(draft, selectedReferences),
        )
        .toList(growable: false);
    final actualItems = _buildSubmissionActualItems(
      selectedCargoDrafts,
      normalizedDropDrafts,
    );
    final cargoTotals = _summarizeActualItemInputs(actualItems);
    final dropTotals = _summarizeBillableDropDrafts(normalizedDropDrafts);
    if (cargoTotals.qtyKoli > 0 &&
        (dropTotals.qtyKoli - cargoTotals.qtyKoli).abs() > 0.01) {
      return 'Total qty titik drop terkirim harus sama dengan qty aktual muatan.';
    }
    if (cargoTotals.weightKg > 0 &&
        (dropTotals.weightKg - cargoTotals.weightKg).abs() > 0.01) {
      return 'Total berat titik drop terkirim harus sama dengan berat aktual muatan.';
    }
    if (cargoTotals.volumeM3 > 0 &&
        (dropTotals.volumeM3 - cargoTotals.volumeM3).abs() > 0.001) {
      return 'Total volume titik drop terkirim harus sama dengan volume aktual muatan.';
    }

    return null;
  }

  void _showError(String message) {
    showMobileFeedback(
      context,
      type: MobileFeedbackType.error,
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

  void _scheduleFocusedInputVisibility() {
    if (_inputVisibilityScheduled) return;
    if (focusedEditableContextInside(_inputVisibilityKey) == null) return;

    _inputVisibilityScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _inputVisibilityScheduled = false;
      if (!mounted) return;

      final inputContext = focusedEditableContextInside(_inputVisibilityKey);
      if (inputContext == null) return;

      ensureMobileInputVisible(inputContext);
    });
  }

  GlobalKey _dropVisibilityKey(String draftId) =>
      _dropVisibilityKeys.putIfAbsent(draftId, () => GlobalKey());

  void _setCurrentStep(_CompletionStep step) {
    if (_currentStep == step) return;
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() => _currentStep = step);
  }

  void _selectStepFromHeader(_CompletionStep step) {
    final currentIndex = _completionSteps.indexOf(_currentStep);
    final targetIndex = _completionSteps.indexOf(step);
    if (targetIndex < 0 || targetIndex > currentIndex) return;
    _setCurrentStep(step);
  }

  void _goToPreviousStep() {
    final index = _completionSteps.indexOf(_currentStep);
    if (index <= 0) return;
    _setCurrentStep(_completionSteps[index - 1]);
  }

  void _goToNextStep() {
    final index = _completionSteps.indexOf(_currentStep);
    if (index < 0 || index >= _completionSteps.length - 1) return;
    if (_currentStep == _CompletionStep.setup) {
      final validationMessage = _validateSetupStep();
      if (validationMessage != null) {
        _showWarning(validationMessage);
        return;
      }
    }
    if (_currentStep == _CompletionStep.drop) {
      final validation = _validateDropStepForCargo();
      if (validation != null) {
        if (validation.warning) {
          _showWarning(validation.message);
        } else {
          _showError(validation.message);
        }
        return;
      }
    }
    _setCurrentStep(_completionSteps[index + 1]);
  }

  String? _validateSetupStep() {
    if (widget.trip.shipperReferences.isNotEmpty &&
        _selectedShipperReferences.isEmpty) {
      return 'Pilih minimal satu SJ dulu sebelum lanjut.';
    }
    if (_podReceiverNameController.text.trim().isEmpty) {
      return 'Nama penerima POD wajib diisi sebelum lanjut.';
    }
    if (!_isValidDateValue(_podReceivedDateController.text)) {
      return 'Tanggal terima POD wajib diisi dengan format YYYY-MM-DD.';
    }
    return null;
  }

  _StepValidationMessage? _validateDropStepForCargo() {
    final selectedCargoDrafts = _selectedCargoDrafts;
    final selectedDropDrafts = _selectedDropDrafts;
    final effectiveDropDrafts = _effectiveSubmissionDropDrafts(
      selectedDropDrafts,
      selectedCargoDrafts,
    );
    if (selectedCargoDrafts.isEmpty) {
      return const _StepValidationMessage.error(
        'Muatan DO belum ada. Isi barang dulu sebelum ajukan selesai.',
      );
    }
    if (selectedDropDrafts.isEmpty) {
      return const _StepValidationMessage.error(
        'Isi minimal satu titik realisasi drop.',
      );
    }
    final activeDropDrafts = _activeDropDraftsForValidation(selectedDropDrafts);
    final missingLocationMessage = _getMissingDropLocationMessage(
      activeDropDrafts,
    );
    if (missingLocationMessage != null) {
      return _StepValidationMessage.warning(missingLocationMessage);
    }

    for (final draft in effectiveDropDrafts) {
      if (_isIgnorableEmptyNonBillableDrop(draft)) continue;
      if (draft.qtyKoliValue <= 0 &&
          draft.weightInputValueNumber <= 0 &&
          draft.volumeInputValueNumber <= 0) {
        return const _StepValidationMessage.error(
          'Setiap titik realisasi harus punya qty, berat, atau volume.',
        );
      }
    }
    final detailedDropMessage = _getDetailedMultiDropAllocationMessage(
      effectiveDropDrafts,
      selectedCargoDrafts,
    );
    if (detailedDropMessage != null) {
      return _StepValidationMessage.error(detailedDropMessage);
    }
    final remainingAllocationMessage = _getRemainingDropAllocationMessage(
      activeDropDrafts,
      selectedCargoDrafts,
    );
    if (remainingAllocationMessage != null) {
      return _StepValidationMessage.error(remainingAllocationMessage);
    }
    final ambiguityMessage = _getAmbiguousActualDropMappingMessage(
      effectiveDropDrafts,
      selectedCargoDrafts,
    );
    return ambiguityMessage == null
        ? null
        : _StepValidationMessage.error(ambiguityMessage);
  }

  void _scheduleDraftVisibility(GlobalKey key) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final draftContext = key.currentContext;
      if (draftContext == null || !draftContext.mounted) return;

      Scrollable.ensureVisible(
        draftContext,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
        alignment: 0.08,
        alignmentPolicy: ScrollPositionAlignmentPolicy.explicit,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final selectedReferences = _selectedShipperReferences;
    final selectedCargoDrafts = _selectedCargoDrafts;
    final selectedDropDrafts = _selectedDropDrafts;
    final selectedDropDraft = _resolveSelectedDropDraft(selectedDropDrafts);
    final selectedDropIndex = selectedDropDraft == null
        ? 0
        : _dropGroupIndex(selectedDropDrafts, selectedDropDraft);
    final selectedDropGroups = _groupDropDraftsForUi(selectedDropDrafts);
    final cargoSections = _groupCargoDraftsBySelectedReferences(
      selectedCargoDrafts,
      selectedReferences,
    );
    final normalizedDropDrafts = selectedDropDrafts
        .map(
          (draft) =>
              _applySingleReferenceToBlankDrop(draft, selectedReferences),
        )
        .toList(growable: false);
    final usesDropDerivedCargo = _usesDropDerivedActualCargo(
      normalizedDropDrafts,
      selectedCargoDrafts,
    );
    final derivedActualItems = _buildSubmissionActualItems(
      selectedCargoDrafts,
      normalizedDropDrafts,
    );
    final derivedActualItemByRef = {
      for (final item in derivedActualItems) item.deliveryOrderItemRef: item,
    };
    final hasMultiTargetDefault = widget.trip.shipperReferences.length > 1;
    final usesDetailedDrop =
        selectedDropDrafts.length > 1 ||
        selectedDropDrafts.any(
          (draft) => _normalizeDropStopType(draft.stopType) != 'DROP',
        );
    final currentStepIndex = _completionSteps.indexOf(_currentStep);
    final canGoBack = currentStepIndex > 0 && !_submitting;
    final canGoNext =
        currentStepIndex >= 0 &&
        currentStepIndex < _completionSteps.length - 1 &&
        !_submitting;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      appBar: AppBar(title: const Text('Ajukan Selesai')),
      body: SafeArea(
        child: KeyedSubtree(
          key: _inputVisibilityKey,
          child: Column(
            children: [
              _CompletionStepHeader(
                currentStep: _currentStep,
                onStepSelected: _submitting ? null : _selectStepFromHeader,
              ),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  child: _CompletionStepBody(
                    key: ValueKey(_currentStep),
                    step: _currentStep,
                    children: switch (_currentStep) {
                      _CompletionStep.setup => [
                        AppInfoCard(
                          title: 'Realisasi trip',
                          message: hasMultiTargetDefault
                              ? 'Trip ini punya beberapa target SJ. Driver perlu isi realisasi muatan dan alokasi titik drop dengan benar.'
                              : 'Isi realisasi muatan dan titik drop. Admin akan cross-check sebelum DO diselesaikan.',
                        ),
                        if (widget.trip.shipperReferences.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          _BatchSuratJalanCard(
                            references: widget.trip.shipperReferences,
                            selectedValues: _selectedShipperReferenceValues,
                            canRequestFinalization:
                                widget.trip.canRequestFinalizationForReference,
                            onChanged: _submitting
                                ? null
                                : _setShipperReferenceSelected,
                          ),
                        ],
                        const SizedBox(height: 12),
                        _PodCard(
                          receiverController: _podReceiverNameController,
                          dateController: _podReceivedDateController,
                          onPickDate: _submitting ? null : _pickPodReceivedDate,
                        ),
                      ],
                      _CompletionStep.drop => [
                        _DropWorkflowCard(
                          cargoCount: selectedCargoDrafts.length,
                          dropCount: selectedDropGroups.length,
                          usesDetailedDrop: usesDetailedDrop,
                        ),
                        const SizedBox(height: 12),
                        _ActualDropSelectorField(
                          groups: selectedDropGroups,
                          cargoDrafts: selectedCargoDrafts,
                          selectedDraftId: selectedDropDraft?.id,
                          onChanged: _selectDropDraft,
                        ),
                        const SizedBox(height: 12),
                        if (selectedDropDraft != null)
                          Padding(
                            key: _dropVisibilityKey(selectedDropDraft.id),
                            padding: const EdgeInsets.only(bottom: 12),
                            child: _ActualDropCard(
                              key: ValueKey(selectedDropDraft.id),
                              index: selectedDropIndex + 1,
                              draft: selectedDropDraft,
                              customerRecipients: widget.customerRecipients,
                              cargoDrafts: selectedCargoDrafts,
                              allDropDrafts: selectedDropDrafts,
                              dropGroupDrafts: _dropGroupDraftsFor(
                                selectedDropDraft,
                                selectedDropDrafts,
                              ),
                              showRemove: selectedDropGroups.length > 1,
                              onChanged: _updateDrop,
                              onAddCargoAllocation: _addCargoAllocationToDrop,
                              onRecipientChanged: _selectRecipient,
                              onRemove: _removeDropPoint,
                            ),
                          ),
                        OutlinedButton.icon(
                          onPressed: _submitting ? null : _addDropPoint,
                          icon: const Icon(Icons.add_location_alt_rounded),
                          label: const Text('Tambah Titik Drop'),
                        ),
                      ],
                      _CompletionStep.cargo => [
                        AppInfoCard(
                          title: 'Aktual Barang SJ',
                          message:
                              'Pilih titik drop, lalu tentukan aktual muatan per SJ dan barang di titik tersebut.',
                        ),
                        const SizedBox(height: 12),
                        if (selectedDropDraft != null)
                          _ActualCargoByDropEditor(
                            selectedDropGroups: selectedDropGroups,
                            selectedDropDraft: selectedDropDraft,
                            selectedCargoDrafts: selectedCargoDrafts,
                            allDropDrafts: selectedDropDrafts,
                            onDropSelected: _selectDropDraft,
                            onDetermine: _addCargoAllocationToDrop,
                          )
                        else
                          ...cargoSections.map(
                            (section) => usesDropDerivedCargo
                                ? _DerivedActualCargoSection(
                                    key: ValueKey(
                                      'derived-cargo-section-${section.key}',
                                    ),
                                    section: section,
                                    showHeader: hasMultiTargetDefault,
                                    actualItemByRef: derivedActualItemByRef,
                                  )
                                : _ActualCargoSection(
                                    key: ValueKey(
                                      'cargo-section-${section.key}',
                                    ),
                                    section: section,
                                    showHeader: hasMultiTargetDefault,
                                    onChanged: _updateCargo,
                                  ),
                          ),
                      ],
                      _CompletionStep.review => [
                        AppInfoCard(
                          title: 'Review & Kirim',
                          message:
                              'Cek ringkasan aktual barang dan titik drop sebelum diajukan ke admin.',
                        ),
                        const SizedBox(height: 12),
                        _ReviewDropPointSummaryList(
                          groups: selectedDropGroups,
                          cargoDrafts: selectedCargoDrafts,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _noteController,
                          minLines: 2,
                          maxLines: 4,
                          scrollPadding: mobileInputScrollPadding,
                          decoration: const InputDecoration(
                            labelText: 'Catatan Driver',
                            hintText: 'Opsional',
                          ),
                        ),
                      ],
                    },
                  ),
                ),
              ),
              _CompletionFooter(
                currentStep: _currentStep,
                busy: _submitting,
                canGoBack: canGoBack,
                canGoNext: canGoNext,
                onBack: _goToPreviousStep,
                onNext: _goToNextStep,
                onSubmit: _submit,
                scheme: scheme,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CompletionStepHeader extends StatelessWidget {
  const _CompletionStepHeader({
    required this.currentStep,
    required this.onStepSelected,
  });

  final _CompletionStep currentStep;
  final ValueChanged<_CompletionStep>? onStepSelected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final currentIndex = _completionSteps.indexOf(currentStep);

    return Material(
      color: scheme.surface,
      elevation: 1,
      shadowColor: scheme.shadow.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxWidth < 420;
            final chips = <Widget>[
              for (final entry in _completionSteps.indexed)
                _CompletionStepChip(
                  step: entry.$2,
                  index: entry.$1 + 1,
                  selected: entry.$2 == currentStep,
                  complete: entry.$1 < currentIndex,
                  enabled: onStepSelected != null && entry.$1 <= currentIndex,
                  compact: compact,
                  onSelected: () => onStepSelected?.call(entry.$2),
                ),
            ];

            if (compact) {
              return Row(
                children: [
                  for (final entry in chips.indexed) ...[
                    if (entry.$1 > 0) const SizedBox(width: 6),
                    Expanded(child: entry.$2),
                  ],
                ],
              );
            }

            return Row(
              children: [
                for (final entry in chips.indexed) ...[
                  if (entry.$1 > 0) const SizedBox(width: 8),
                  Expanded(child: entry.$2),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _CompletionStepChip extends StatelessWidget {
  const _CompletionStepChip({
    required this.step,
    required this.index,
    required this.selected,
    required this.complete,
    required this.enabled,
    required this.compact,
    required this.onSelected,
  });

  final _CompletionStep step;
  final int index;
  final bool selected;
  final bool complete;
  final bool enabled;
  final bool compact;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = selected
        ? scheme.primaryContainer
        : complete
        ? scheme.secondaryContainer.withValues(alpha: 0.68)
        : scheme.surfaceContainerHighest.withValues(alpha: 0.45);
    final foreground = selected
        ? scheme.onPrimaryContainer
        : scheme.onSurface.withValues(alpha: 0.76);

    return InkWell(
      key: ValueKey('completion-step-chip-${step.name}'),
      onTap: enabled ? onSelected : null,
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 10,
          vertical: compact ? 8 : 10,
        ),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? scheme.primary.withValues(alpha: 0.42)
                : scheme.outline.withValues(alpha: 0.18),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: compact ? 22 : 24,
              height: compact ? 22 : 24,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected
                    ? scheme.primary
                    : complete
                    ? scheme.secondary
                    : scheme.surface,
                shape: BoxShape.circle,
              ),
              child: complete
                  ? Icon(Icons.check_rounded, size: 15, color: scheme.onPrimary)
                  : Text(
                      '$index',
                      style: TextStyle(
                        color: selected
                            ? scheme.onPrimary
                            : scheme.onSurface.withValues(alpha: 0.72),
                        fontWeight: FontWeight.w800,
                        fontSize: compact ? 11 : 12,
                      ),
                    ),
            ),
            SizedBox(width: compact ? 6 : 8),
            Flexible(
              child: compact
                  ? Text(
                      step.shortLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: foreground,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                      ),
                    )
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          step.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: foreground,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          step.helper,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: foreground.withValues(alpha: 0.64),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
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

class _CompletionStepBody extends StatelessWidget {
  const _CompletionStepBody({
    super.key,
    required this.step,
    required this.children,
  });

  final _CompletionStep step;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: ValueKey('completion-step-scroll-${step.name}'),
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: children,
    );
  }
}

class _CompletionFooter extends StatelessWidget {
  const _CompletionFooter({
    required this.currentStep,
    required this.busy,
    required this.canGoBack,
    required this.canGoNext,
    required this.onBack,
    required this.onNext,
    required this.onSubmit,
    required this.scheme,
  });

  final _CompletionStep currentStep;
  final bool busy;
  final bool canGoBack;
  final bool canGoNext;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final VoidCallback onSubmit;
  final ColorScheme scheme;

  @override
  Widget build(BuildContext context) {
    final isReview = currentStep == _CompletionStep.review;
    final primaryLabel = switch (currentStep) {
      _CompletionStep.setup ||
      _CompletionStep.drop ||
      _CompletionStep.cargo => 'Lanjut',
      _CompletionStep.review => 'Ajukan Selesai',
    };

    return DecoratedBox(
      decoration: BoxDecoration(
        color: scheme.surface,
        border: Border(
          top: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.72)),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
        child: Row(
          children: [
            if (canGoBack) ...[
              Expanded(
                flex: 4,
                child: OutlinedButton.icon(
                  onPressed: busy ? null : onBack,
                  icon: const Icon(Icons.arrow_back_rounded),
                  label: const Text('Kembali'),
                ),
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              flex: 6,
              child: FilledButton.icon(
                onPressed: busy
                    ? null
                    : (isReview
                          ? onSubmit
                          : canGoNext
                          ? onNext
                          : null),
                icon: busy
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator.adaptive(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation(scheme.onPrimary),
                        ),
                      )
                    : Icon(
                        isReview
                            ? Icons.check_circle_rounded
                            : Icons.arrow_forward_rounded,
                      ),
                label: Text(primaryLabel),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class DeliveryCompletionSubmitResult {
  const DeliveryCompletionSubmitResult({
    required this.note,
    required this.podReceiverName,
    required this.podReceivedDate,
    required this.selectedSuratJalanRefs,
    required this.actualItems,
    required this.actualDropPoints,
  });

  final String note;
  final String podReceiverName;
  final String podReceivedDate;
  final List<String> selectedSuratJalanRefs;
  final List<DriverActualCargoInput> actualItems;
  final List<DriverActualDropPointInput> actualDropPoints;
}

class _StepValidationMessage {
  const _StepValidationMessage._(this.message, {required this.warning});

  const _StepValidationMessage.error(String message)
    : this._(message, warning: false);

  const _StepValidationMessage.warning(String message)
    : this._(message, warning: true);

  final String message;
  final bool warning;
}

class _ActualCargoTotals {
  const _ActualCargoTotals({
    required this.qtyKoli,
    required this.weightKg,
    required this.volumeM3,
  });

  final double qtyKoli;
  final double weightKg;
  final double volumeM3;
}

class _ActualCargoSectionData {
  const _ActualCargoSectionData({
    required this.key,
    required this.label,
    required this.targetLabel,
    required this.drafts,
  });

  final String key;
  final String label;
  final String targetLabel;
  final List<_ActualCargoDraft> drafts;
}

class _ActualCargoDraft {
  const _ActualCargoDraft({
    required this.itemId,
    required this.description,
    required this.shipperReferenceNumber,
    required this.shipperReferenceKey,
    required this.requireQty,
    required this.requireWeight,
    required this.requireVolume,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
    required this.dropQtyKoli,
    required this.dropWeightInputValue,
    required this.dropWeightInputUnit,
    required this.dropVolumeInputValue,
    required this.dropVolumeInputUnit,
  });

  final String itemId;
  final String description;
  final String shipperReferenceNumber;
  final String shipperReferenceKey;
  final bool requireQty;
  final bool requireWeight;
  final bool requireVolume;
  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;
  final String dropQtyKoli;
  final String dropWeightInputValue;
  final String dropWeightInputUnit;
  final String dropVolumeInputValue;
  final String dropVolumeInputUnit;

  double get qtyKoliValue => _parseDouble(qtyKoli);
  double get weightInputValueNumber => _parseDouble(weightInputValue);
  double get volumeInputValueNumber => _parseDouble(volumeInputValue);
  double get dropQtyKoliValue => _parseDouble(dropQtyKoli);
  double get dropWeightInputValueNumber => _parseDouble(dropWeightInputValue);
  double get dropVolumeInputValueNumber => _parseDouble(dropVolumeInputValue);

  _ActualCargoDraft copyWith({
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    return _ActualCargoDraft(
      itemId: itemId,
      description: description,
      shipperReferenceNumber: shipperReferenceNumber,
      shipperReferenceKey: shipperReferenceKey,
      requireQty: requireQty,
      requireWeight: requireWeight,
      requireVolume: requireVolume,
      qtyKoli: qtyKoli ?? this.qtyKoli,
      weightInputValue: weightInputValue ?? this.weightInputValue,
      weightInputUnit: weightInputUnit ?? this.weightInputUnit,
      volumeInputValue: volumeInputValue ?? this.volumeInputValue,
      volumeInputUnit: volumeInputUnit ?? this.volumeInputUnit,
      dropQtyKoli: dropQtyKoli,
      dropWeightInputValue: dropWeightInputValue,
      dropWeightInputUnit: dropWeightInputUnit,
      dropVolumeInputValue: dropVolumeInputValue,
      dropVolumeInputUnit: dropVolumeInputUnit,
    );
  }
}

class _ActualDropDraft {
  const _ActualDropDraft({
    required this.id,
    required this.groupKey,
    required this.stopType,
    required this.deliveryOrderItemRef,
    required this.deliveryOrderItemRefs,
    required this.shipperReferenceNumber,
    required this.shipperReferenceKey,
    required this.originLocationName,
    required this.originLocationAddress,
    required this.locationName,
    required this.locationAddress,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
    required this.note,
  });

  final String id;
  final String groupKey;
  final String stopType;
  final String deliveryOrderItemRef;
  final List<String> deliveryOrderItemRefs;
  final String shipperReferenceNumber;
  final String shipperReferenceKey;
  final String originLocationName;
  final String originLocationAddress;
  final String locationName;
  final String locationAddress;
  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;
  final String note;

  double get qtyKoliValue => _parseDouble(qtyKoli);
  double get weightInputValueNumber => _parseDouble(weightInputValue);
  double get volumeInputValueNumber => _parseDouble(volumeInputValue);

  factory _ActualDropDraft.create({
    String stopType = 'DROP',
    String deliveryOrderItemRef = '',
    List<String> deliveryOrderItemRefs = const [],
    String shipperReferenceNumber = '',
    String shipperReferenceKey = '',
    String originLocationName = '',
    String originLocationAddress = '',
    String locationName = '',
    String locationAddress = '',
    String qtyKoli = '',
    String weightInputValue = '',
    String weightInputUnit = 'KG',
    String volumeInputValue = '',
    String volumeInputUnit = 'M3',
    String note = '',
    String? groupKey,
  }) {
    final resolvedGroupKey = groupKey ?? UniqueKey().toString();
    return _ActualDropDraft(
      id: UniqueKey().toString(),
      groupKey: resolvedGroupKey,
      stopType: stopType,
      deliveryOrderItemRef: deliveryOrderItemRef,
      deliveryOrderItemRefs: deliveryOrderItemRefs,
      shipperReferenceNumber: shipperReferenceNumber,
      shipperReferenceKey: shipperReferenceKey,
      originLocationName: originLocationName,
      originLocationAddress: originLocationAddress,
      locationName: locationName,
      locationAddress: locationAddress,
      qtyKoli: qtyKoli,
      weightInputValue: weightInputValue,
      weightInputUnit: weightInputUnit,
      volumeInputValue: volumeInputValue,
      volumeInputUnit: volumeInputUnit,
      note: note,
    );
  }

  _ActualDropDraft copyWith({
    String? groupKey,
    String? stopType,
    String? deliveryOrderItemRef,
    List<String>? deliveryOrderItemRefs,
    String? shipperReferenceNumber,
    String? shipperReferenceKey,
    String? originLocationName,
    String? originLocationAddress,
    String? locationName,
    String? locationAddress,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
    String? note,
  }) {
    return _ActualDropDraft(
      id: id,
      groupKey: groupKey ?? this.groupKey,
      stopType: stopType ?? this.stopType,
      deliveryOrderItemRef: deliveryOrderItemRef ?? this.deliveryOrderItemRef,
      deliveryOrderItemRefs:
          deliveryOrderItemRefs ?? this.deliveryOrderItemRefs,
      shipperReferenceNumber:
          shipperReferenceNumber ?? this.shipperReferenceNumber,
      shipperReferenceKey: shipperReferenceKey ?? this.shipperReferenceKey,
      originLocationName: originLocationName ?? this.originLocationName,
      originLocationAddress:
          originLocationAddress ?? this.originLocationAddress,
      locationName: locationName ?? this.locationName,
      locationAddress: locationAddress ?? this.locationAddress,
      qtyKoli: qtyKoli ?? this.qtyKoli,
      weightInputValue: weightInputValue ?? this.weightInputValue,
      weightInputUnit: weightInputUnit ?? this.weightInputUnit,
      volumeInputValue: volumeInputValue ?? this.volumeInputValue,
      volumeInputUnit: volumeInputUnit ?? this.volumeInputUnit,
      note: note ?? this.note,
    );
  }
}

List<_ActualCargoDraft> _buildInitialCargoDrafts(DeliveryTrip trip) {
  final pendingById = {
    for (final item in trip.pendingActualCargoItems)
      item.deliveryOrderItemRef: item,
  };
  final hasHoldContinuationContext = _hasHoldContinuationContext(trip);
  final holdContinuationByItemId = _holdContinuationTotalsByItemId(trip);
  final holdContinuationItemIds = _holdContinuationItemIds(trip);
  return trip.cargoItems
      .map<_ActualCargoDraft?>((item) {
        final isHoldContinuationItem =
            hasHoldContinuationContext &&
            holdContinuationItemIds.contains(item.id);
        final holdContinuation = isHoldContinuationItem
            ? holdContinuationByItemId[item.id] ??
                  _heldCargoItemFallbackDraft(item)
            : null;
        final pending = isHoldContinuationItem ? null : pendingById[item.id];
        if (isHoldContinuationItem && holdContinuation == null) {
          return null;
        }
        final defaultWeightUnit =
            (pending?.actualWeightInputUnit ??
                    holdContinuation?.weightInputUnit ??
                    item.actualWeightInputUnit ??
                    item.weightInputUnit ??
                    'KG')
                .toUpperCase();
        final defaultVolumeUnit =
            (pending?.actualVolumeInputUnit ??
                    holdContinuation?.volumeInputUnit ??
                    item.actualVolumeInputUnit ??
                    item.volumeInputUnit ??
                    'M3')
                .toUpperCase();
        final defaultQty =
            pending?.actualQtyKoli ??
            holdContinuation?.qtyKoliValue ??
            (isHoldContinuationItem ? null : item.actualQtyKoli) ??
            item.qtyKoli ??
            0;
        final defaultWeightInput =
            pending?.actualWeightInputValue ??
            holdContinuation?.weightInputValueNumber ??
            (isHoldContinuationItem ? null : item.actualWeightInputValue) ??
            item.weightInputValue ??
            (item.weightKg ?? 0);
        final defaultVolumeInput =
            pending?.actualVolumeInputValue ??
            holdContinuation?.volumeInputValueNumber ??
            (isHoldContinuationItem ? null : item.actualVolumeInputValue) ??
            item.volumeInputValue ??
            (item.volumeM3 ?? 0);
        final dropQty = holdContinuation?.qtyKoliValue ?? item.qtyKoli ?? 0;
        final dropWeightUnit =
            (holdContinuation?.weightInputUnit ?? item.weightInputUnit ?? 'KG')
                .toUpperCase();
        final dropVolumeUnit =
            (holdContinuation?.volumeInputUnit ?? item.volumeInputUnit ?? 'M3')
                .toUpperCase();
        final dropWeightInput =
            holdContinuation?.weightInputValueNumber ??
            item.weightInputValue ??
            (item.weightKg ?? 0);
        final dropVolumeInput =
            holdContinuation?.volumeInputValueNumber ??
            item.volumeInputValue ??
            (item.volumeM3 ?? 0);
        return _ActualCargoDraft(
          itemId: item.id,
          description: item.description,
          shipperReferenceNumber: item.shipperReferenceNumber ?? '',
          shipperReferenceKey: item.shipperReferenceKey ?? '',
          requireQty: (item.qtyKoli ?? 0) > 0,
          requireWeight:
              (item.weightKg ?? 0) > 0 || (item.weightInputValue ?? 0) > 0,
          requireVolume:
              (item.volumeM3 ?? 0) > 0 || (item.volumeInputValue ?? 0) > 0,
          qtyKoli: formatMobileMetric(defaultQty),
          weightInputValue: formatMobileMetric(
            defaultWeightInput,
            fractionDigits: mobileWeightInputFractionDigits(defaultWeightUnit),
          ),
          weightInputUnit: defaultWeightUnit,
          volumeInputValue: formatMobileMetric(
            defaultVolumeInput,
            fractionDigits: defaultVolumeUnit == 'LITER' ? 0 : 3,
          ),
          volumeInputUnit: defaultVolumeUnit,
          dropQtyKoli: formatMobileMetric(dropQty),
          dropWeightInputValue: formatMobileMetric(
            dropWeightInput,
            fractionDigits: mobileWeightInputFractionDigits(dropWeightUnit),
          ),
          dropWeightInputUnit: dropWeightUnit,
          dropVolumeInputValue: formatMobileMetric(
            dropVolumeInput,
            fractionDigits: dropVolumeUnit == 'LITER' ? 0 : 3,
          ),
          dropVolumeInputUnit: dropVolumeUnit,
        );
      })
      .whereType<_ActualCargoDraft>()
      .toList(growable: false);
}

_ActualDropDraft? _heldCargoItemFallbackDraft(DeliveryCargoItem item) {
  final heldQtyKoli = item.heldQtyKoli ?? 0;
  final heldWeightKg = item.heldWeightKg ?? 0;
  final heldVolumeM3 = item.heldVolumeM3 ?? 0;
  if (heldQtyKoli <= 0 && heldWeightKg <= 0 && heldVolumeM3 <= 0) {
    return null;
  }

  final weightUnit = (item.weightInputUnit ?? 'KG').toUpperCase();
  final volumeUnit = (item.volumeInputUnit ?? 'M3').toUpperCase();
  return _ActualDropDraft.create(
    deliveryOrderItemRef: item.id,
    deliveryOrderItemRefs: [item.id],
    qtyKoli: formatMobileMetric(heldQtyKoli),
    weightInputValue: formatMobileMetric(
      _convertKgToWeightInputValue(heldWeightKg, weightUnit),
      fractionDigits: mobileWeightInputFractionDigits(weightUnit),
    ),
    weightInputUnit: weightUnit,
    volumeInputValue: formatMobileMetric(
      _convertM3ToVolumeInputValue(heldVolumeM3, volumeUnit),
      fractionDigits: volumeUnit == 'LITER' ? 0 : 3,
    ),
    volumeInputUnit: volumeUnit,
  );
}

List<_ActualDropDraft> _buildInitialDropDrafts(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (trip.pendingActualDropPoints.isNotEmpty) {
    return trip.pendingActualDropPoints
        .map(
          (point) => _ActualDropDraft.create(
            stopType: point.stopType,
            groupKey: point.actualDropGroupKey?.trim().isNotEmpty == true
                ? point.actualDropGroupKey
                : null,
            deliveryOrderItemRef: point.deliveryOrderItemRef ?? '',
            deliveryOrderItemRefs: point.deliveryOrderItemRefs,
            shipperReferenceNumber: point.shipperReferenceNumber ?? '',
            shipperReferenceKey: point.shipperReferenceKey ?? '',
            originLocationName: point.originLocationName ?? '',
            originLocationAddress: point.originLocationAddress ?? '',
            locationName: point.locationName,
            locationAddress: point.locationAddress ?? '',
            qtyKoli: formatMobileMetric(point.qtyKoli),
            weightInputValue: formatMobileMetric(
              point.weightInputValue,
              fractionDigits: mobileWeightInputFractionDigits(
                point.weightInputUnit ?? 'KG',
              ),
            ),
            weightInputUnit: (point.weightInputUnit ?? 'KG').toUpperCase(),
            volumeInputValue: formatMobileMetric(
              point.volumeInputValue,
              fractionDigits:
                  (point.volumeInputUnit ?? 'M3').toUpperCase() == 'LITER'
                  ? 0
                  : 3,
            ),
            volumeInputUnit: (point.volumeInputUnit ?? 'M3').toUpperCase(),
            note: point.note ?? '',
          ),
        )
        .toList(growable: false);
  }

  final firstDropDrafts = _buildFirstDropPointAllocationDrafts(
    trip,
    cargoDrafts,
  );
  return firstDropDrafts.isNotEmpty
      ? firstDropDrafts
      : [_ActualDropDraft.create()];
}

List<_ActualDropDraft> _buildFirstDropPointAllocationDrafts(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (cargoDrafts.isEmpty) return const [];

  final base = _ActualDropDraft.create();
  final groupKey = base.groupKey;

  return cargoDrafts
      .map((cargo) {
        final holdPoint = _holdContinuationPointForCargo(trip, cargo);
        return _ActualDropDraft.create(
          groupKey: groupKey,
          stopType: 'DROP',
          deliveryOrderItemRef: cargo.itemId,
          deliveryOrderItemRefs: [cargo.itemId],
          shipperReferenceKey: cargo.shipperReferenceKey,
          shipperReferenceNumber: cargo.shipperReferenceNumber,
          originLocationName: holdPoint?.locationName ?? '',
          originLocationAddress: holdPoint?.locationAddress ?? '',
          qtyKoli: cargo.dropQtyKoli,
          weightInputValue: cargo.dropWeightInputValue,
          weightInputUnit: cargo.dropWeightInputUnit,
          volumeInputValue: cargo.dropVolumeInputValue,
          volumeInputUnit: cargo.dropVolumeInputUnit,
          note: holdPoint == null ? '' : 'Lanjutan hold dikirim',
        );
      })
      .toList(growable: false);
}

DeliveryActualDropPoint? _holdContinuationPointForCargo(
  DeliveryTrip trip,
  _ActualCargoDraft cargo,
) {
  final holdContinuationItemIds = _holdContinuationItemIds(trip);
  if (!holdContinuationItemIds.contains(cargo.itemId)) return null;
  for (final point in trip.actualDropPoints) {
    if (!_isHoldContinuationStopType(point.stopType)) continue;
    final itemRefs = _deliveryActualDropPointItemRefs(point, trip.cargoItems);
    if (itemRefs.contains(cargo.itemId)) return point;
  }
  return null;
}

Map<String, _ActualDropDraft> _holdContinuationTotalsByItemId(
  DeliveryTrip trip,
) {
  if (!_hasHoldContinuationContext(trip)) return const {};

  final holdContinuationItemIds = _holdContinuationItemIds(trip);
  final totalsByItemId = <String, _ActualDropDraft>{};
  for (final point in trip.actualDropPoints) {
    if (!_isHoldContinuationStopType(point.stopType)) continue;
    final itemRefs = _deliveryActualDropPointItemRefs(point, trip.cargoItems);
    final scopedItemRefs = itemRefs
        .where(holdContinuationItemIds.contains)
        .toList(growable: false);
    if (scopedItemRefs.length != 1) continue;
    final itemRef = scopedItemRefs.first;
    final current = totalsByItemId[itemRef];
    totalsByItemId[itemRef] = _sumDropDraftValues(
      current,
      _actualDropPointToDraft(point, deliveryOrderItemRef: itemRef),
    );
  }
  return totalsByItemId;
}

bool _hasHoldContinuationContext(DeliveryTrip trip) {
  return _holdContinuationReferenceCandidates(trip).isNotEmpty;
}

Set<String> _holdContinuationItemIds(DeliveryTrip trip) {
  final referenceCandidates = _holdContinuationReferenceCandidates(trip);
  if (referenceCandidates.isEmpty) return const {};
  return trip.cargoItems
      .where(
        (item) => _cargoItemReferenceCandidates(
          trip,
          item,
        ).any(referenceCandidates.contains),
      )
      .map((item) => item.id)
      .toSet();
}

Set<String> _holdContinuationReferenceCandidates(DeliveryTrip trip) {
  final candidates = <String>{};
  for (final reference in trip.shipperReferences) {
    final status = (reference.tripStatus ?? '').trim().toUpperCase();
    final hasHoldCargo =
        (reference.holdQtyKoli ?? 0) > 0 ||
        (reference.holdWeightKg ?? 0) > 0 ||
        (reference.holdVolumeM3 ?? 0) > 0;
    if (status != 'PARTIAL_HOLD' && !hasHoldCargo) continue;
    candidates.addAll(_shipperReferenceCandidates(trip, reference));
  }
  return candidates;
}

Set<String> _shipperReferenceCandidates(
  DeliveryTrip trip,
  DeliveryShipperReference reference,
) {
  final documentId = reference.documentId?.trim();
  final key = reference.key?.trim();
  final number = reference.referenceNumber.trim();
  return {
    if (documentId != null && documentId.isNotEmpty) documentId,
    if (key != null && key.isNotEmpty) key,
    if (number.isNotEmpty) number,
    if (key != null && key.isNotEmpty) '${trip.deliveryOrderId}:$key',
    if (number.isNotEmpty) '${trip.deliveryOrderId}:$number',
  };
}

Set<String> _cargoItemReferenceCandidates(
  DeliveryTrip trip,
  DeliveryCargoItem item,
) {
  final key = item.shipperReferenceKey?.trim();
  final number = item.shipperReferenceNumber?.trim();
  return {
    if (key != null && key.isNotEmpty) key,
    if (number != null && number.isNotEmpty) number,
    if (key != null && key.isNotEmpty) '${trip.deliveryOrderId}:$key',
    if (number != null && number.isNotEmpty) '${trip.deliveryOrderId}:$number',
  };
}

bool _isHoldContinuationStopType(String value) {
  final normalized = _normalizeDropStopType(value);
  return normalized == 'HOLD' || normalized == 'TRANSIT';
}

List<String> _deliveryActualDropPointItemRefs(
  DeliveryActualDropPoint point,
  List<DeliveryCargoItem> cargoItems,
) {
  final seen = <String>{};
  final refs = <String>[];
  void addRef(String? value) {
    final trimmed = (value ?? '').trim();
    if (trimmed.isEmpty || !seen.add(trimmed)) return;
    refs.add(trimmed);
  }

  addRef(point.deliveryOrderItemRef);
  for (final value in point.deliveryOrderItemRefs) {
    addRef(value);
  }
  if (refs.isNotEmpty) return refs;

  final matchingItems = cargoItems
      .where((item) {
        final pointKey = (point.shipperReferenceKey ?? '').trim();
        final pointNumber = (point.shipperReferenceNumber ?? '')
            .trim()
            .toUpperCase();
        return (pointKey.isNotEmpty &&
                item.shipperReferenceKey?.trim() == pointKey) ||
            (pointNumber.isNotEmpty &&
                item.shipperReferenceNumber?.trim().toUpperCase() ==
                    pointNumber);
      })
      .toList(growable: false);
  if (matchingItems.length == 1) {
    return [matchingItems.first.id];
  }
  return const [];
}

_ActualDropDraft _actualDropPointToDraft(
  DeliveryActualDropPoint point, {
  required String deliveryOrderItemRef,
}) {
  return _ActualDropDraft.create(
    deliveryOrderItemRef: deliveryOrderItemRef,
    deliveryOrderItemRefs: [deliveryOrderItemRef],
    qtyKoli: formatMobileMetric(point.qtyKoli),
    weightInputValue: formatMobileMetric(
      point.weightInputValue,
      fractionDigits: mobileWeightInputFractionDigits(
        point.weightInputUnit ?? 'KG',
      ),
    ),
    weightInputUnit: (point.weightInputUnit ?? 'KG').toUpperCase(),
    volumeInputValue: formatMobileMetric(
      point.volumeInputValue,
      fractionDigits: (point.volumeInputUnit ?? 'M3').toUpperCase() == 'LITER'
          ? 0
          : 3,
    ),
    volumeInputUnit: (point.volumeInputUnit ?? 'M3').toUpperCase(),
  );
}

_ActualDropDraft _sumDropDraftValues(
  _ActualDropDraft? current,
  _ActualDropDraft next,
) {
  if (current == null) return next;
  final weightUnit = normalizeMobileWeightUnit(current.weightInputUnit);
  final volumeUnit = normalizeMobileVolumeUnit(current.volumeInputUnit);
  final weightKg =
      _convertWeightToKg(
        current.weightInputValueNumber,
        current.weightInputUnit,
      ) +
      _convertWeightToKg(next.weightInputValueNumber, next.weightInputUnit);
  final volumeM3 =
      _convertVolumeToM3(
        current.volumeInputValueNumber,
        current.volumeInputUnit,
      ) +
      _convertVolumeToM3(next.volumeInputValueNumber, next.volumeInputUnit);
  return current.copyWith(
    qtyKoli: formatMobileMetric(current.qtyKoliValue + next.qtyKoliValue),
    weightInputValue: formatMobileMetric(
      _convertKgToWeightInputValue(weightKg, weightUnit),
      fractionDigits: mobileWeightInputFractionDigits(weightUnit),
    ),
    weightInputUnit: weightUnit,
    volumeInputValue: formatMobileMetric(
      _convertM3ToVolumeInputValue(volumeM3, volumeUnit),
      fractionDigits: volumeUnit == 'LITER' ? 0 : 3,
    ),
    volumeInputUnit: volumeUnit,
  );
}

Set<String> _initialSelectedReferenceValues(
  DeliveryTrip trip,
  List<_ActualCargoDraft> cargoDrafts,
  List<String> initialSelectedSuratJalanRefs,
) {
  final requestedRefs = initialSelectedSuratJalanRefs
      .map(_normalizeSuratJalanRefCandidate)
      .where((value) => value.isNotEmpty)
      .toSet();
  if (requestedRefs.isNotEmpty) {
    final requestedValues = trip.shipperReferences
        .where(trip.canRequestFinalizationForReference)
        .where(
          (reference) => _suratJalanRefCandidates(
            trip,
            reference,
          ).any(requestedRefs.contains),
        )
        .map(_shipperReferenceOptionValue)
        .toSet();
    if (requestedValues.isNotEmpty) return requestedValues;
  }

  final referencesWithCargo = trip.shipperReferences
      .where(trip.canRequestFinalizationForReference)
      .where(
        (reference) => cargoDrafts.any(
          (draft) => _cargoDraftMatchesReference(draft, reference),
        ),
      )
      .map(_shipperReferenceOptionValue)
      .toSet();
  if (referencesWithCargo.isNotEmpty) return referencesWithCargo;
  return trip.shipperReferences
      .where(trip.canRequestFinalizationForReference)
      .map(_shipperReferenceOptionValue)
      .toSet();
}

List<DeliveryShipperReference> _selectedReferencesForValues(
  DeliveryTrip trip,
  List<DeliveryShipperReference> references,
  Set<String> selectedValues,
) {
  return references
      .where(
        (reference) =>
            selectedValues.contains(_shipperReferenceOptionValue(reference)),
      )
      .where(trip.canRequestFinalizationForReference)
      .toList(growable: false);
}

List<_ActualCargoDraft> _cargoDraftsForSelectedReferences(
  List<_ActualCargoDraft> drafts,
  List<DeliveryShipperReference> references,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (references.isEmpty) return drafts;
  if (selectedReferences.isEmpty) return const [];
  if (selectedReferences.length == references.length) return drafts;
  return drafts
      .where(
        (draft) => selectedReferences.any(
          (reference) => _cargoDraftMatchesReference(draft, reference),
        ),
      )
      .toList(growable: false);
}

List<_ActualCargoSectionData> _groupCargoDraftsBySelectedReferences(
  List<_ActualCargoDraft> drafts,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (drafts.isEmpty) return const [];
  if (selectedReferences.isEmpty) {
    return [
      _ActualCargoSectionData(
        key: 'manual',
        label: 'Tanpa SJ',
        targetLabel: '',
        drafts: drafts,
      ),
    ];
  }

  final usedItemIds = <String>{};
  final sections = <_ActualCargoSectionData>[];
  for (final reference in selectedReferences) {
    final sectionDrafts = drafts
        .where((draft) => _cargoDraftMatchesReference(draft, reference))
        .toList(growable: false);
    if (sectionDrafts.isEmpty) continue;
    usedItemIds.addAll(sectionDrafts.map((draft) => draft.itemId));
    sections.add(
      _ActualCargoSectionData(
        key: _shipperReferenceOptionValue(reference),
        label: reference.referenceNumber,
        targetLabel: reference.targetLabel,
        drafts: sectionDrafts,
      ),
    );
  }

  final unmatchedDrafts = drafts
      .where((draft) => !usedItemIds.contains(draft.itemId))
      .toList(growable: false);
  if (unmatchedDrafts.isNotEmpty) {
    sections.add(
      _ActualCargoSectionData(
        key: 'unmatched',
        label: 'Tanpa SJ',
        targetLabel: '',
        drafts: unmatchedDrafts,
      ),
    );
  }

  if (sections.isEmpty) {
    return [
      _ActualCargoSectionData(
        key: 'all',
        label: selectedReferences.first.referenceNumber,
        targetLabel: selectedReferences.first.targetLabel,
        drafts: drafts,
      ),
    ];
  }
  return sections;
}

List<_ActualDropDraft> _dropDraftsForSelectedReferences(
  List<_ActualDropDraft> drafts,
  List<DeliveryShipperReference> references,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (references.isEmpty) return drafts;
  if (selectedReferences.isEmpty) return const [];
  if (selectedReferences.length == references.length) return drafts;
  return drafts
      .where(
        (draft) =>
            _dropDraftHasNoReference(draft) ||
            selectedReferences.any(
              (reference) => _dropDraftMatchesReference(draft, reference),
            ),
      )
      .toList(growable: false);
}

List<_ActualDropDraft> _normalizeDropDraftsForSelectedReferences(
  List<_ActualDropDraft> drafts,
  List<DeliveryShipperReference> selectedReferences,
  List<_ActualCargoDraft> selectedCargoDrafts,
) {
  final totals = _summarizeCargoDropBasisDrafts(selectedCargoDrafts);
  final retainedDrafts = drafts
      .where(
        (draft) =>
            selectedReferences.isEmpty ||
            _dropDraftHasNoReference(draft) ||
            selectedReferences.any(
              (reference) => _dropDraftMatchesReference(draft, reference),
            ),
      )
      .toList(growable: false);
  var nextDrafts = retainedDrafts.isNotEmpty
      ? retainedDrafts
      : [
          _ActualDropDraft.create(
            qtyKoli: formatMobileMetric(totals.qtyKoli),
            weightInputValue: formatMobileMetric(totals.weightKg),
            volumeInputValue: formatMobileMetric(
              totals.volumeM3,
              fractionDigits: 3,
            ),
          ),
        ];

  if (selectedReferences.length == 1 &&
      nextDrafts.length == 1 &&
      _dropDraftHasNoReference(nextDrafts.first) &&
      !_dropDraftHasItemSelection(nextDrafts.first)) {
    nextDrafts = [
      nextDrafts.first.copyWith(
        qtyKoli: formatMobileMetric(totals.qtyKoli),
        weightInputValue: formatMobileMetric(totals.weightKg),
        volumeInputValue: formatMobileMetric(
          totals.volumeM3,
          fractionDigits: 3,
        ),
      ),
    ];
  }

  if (selectedReferences.length != 1) {
    return nextDrafts;
  }

  return nextDrafts
      .map(
        (draft) => _applySingleReferenceToBlankDrop(draft, selectedReferences),
      )
      .toList(growable: false);
}

_ActualDropDraft _applySingleReferenceToBlankDrop(
  _ActualDropDraft draft,
  List<DeliveryShipperReference> selectedReferences,
) {
  if (selectedReferences.length != 1 || !_dropDraftHasNoReference(draft)) {
    return draft;
  }
  final reference = selectedReferences.first;
  return draft.copyWith(
    shipperReferenceNumber: reference.referenceNumber,
    shipperReferenceKey: reference.key ?? '',
  );
}

bool _cargoDraftMatchesReference(
  _ActualCargoDraft draft,
  DeliveryShipperReference reference,
) {
  final draftKey = draft.shipperReferenceKey.trim();
  final draftNumber = draft.shipperReferenceNumber.trim().toUpperCase();
  final referenceKey = (reference.key ?? '').trim();
  final referenceNumber = reference.referenceNumber.trim().toUpperCase();
  return (draftKey.isNotEmpty &&
          referenceKey.isNotEmpty &&
          draftKey == referenceKey) ||
      (draftNumber.isNotEmpty &&
          referenceNumber.isNotEmpty &&
          draftNumber == referenceNumber);
}

bool _dropDraftHasNoReference(_ActualDropDraft draft) =>
    draft.shipperReferenceKey.trim().isEmpty &&
    draft.shipperReferenceNumber.trim().isEmpty;

bool _dropDraftMatchesReference(
  _ActualDropDraft draft,
  DeliveryShipperReference reference,
) {
  final draftKey = draft.shipperReferenceKey.trim();
  final draftNumber = draft.shipperReferenceNumber.trim().toUpperCase();
  final referenceKey = (reference.key ?? '').trim();
  final referenceNumber = reference.referenceNumber.trim().toUpperCase();
  return (draftKey.isNotEmpty &&
          referenceKey.isNotEmpty &&
          draftKey == referenceKey) ||
      (draftNumber.isNotEmpty &&
          referenceNumber.isNotEmpty &&
          draftNumber == referenceNumber);
}

List<String> _selectedSuratJalanDocumentIds(
  DeliveryTrip trip,
  List<DeliveryShipperReference> selectedReferences,
  List<_ActualCargoDraft> selectedCargoDrafts,
) {
  if (trip.shipperReferences.isEmpty || selectedReferences.isEmpty) {
    return const [];
  }
  final selectedAllReferences =
      selectedReferences.length == trip.shipperReferences.length;
  final hasUnmappedCargo = selectedCargoDrafts.any(
    (draft) =>
        draft.shipperReferenceKey.trim().isEmpty &&
        draft.shipperReferenceNumber.trim().isEmpty,
  );
  if (selectedAllReferences && hasUnmappedCargo) {
    return const [];
  }

  return selectedReferences
      .map((reference) => _suratJalanDocumentIdForReference(trip, reference))
      .where((value) => value.isNotEmpty)
      .toSet()
      .toList(growable: false);
}

String _suratJalanDocumentIdForReference(
  DeliveryTrip trip,
  DeliveryShipperReference reference,
) {
  final documentId = reference.documentId?.trim();
  if (documentId != null && documentId.isNotEmpty) return documentId;
  final key = (reference.key ?? '').trim();
  final suffix = key.isNotEmpty ? key : reference.referenceNumber.trim();
  if (trip.deliveryOrderId.trim().isEmpty || suffix.isEmpty) return '';
  return '${trip.deliveryOrderId}:$suffix';
}

String _normalizeSuratJalanRefCandidate(String value) =>
    value.trim().toUpperCase();

Set<String> _suratJalanRefCandidates(
  DeliveryTrip trip,
  DeliveryShipperReference reference,
) {
  final documentId = _suratJalanDocumentIdForReference(trip, reference);
  final key = (reference.key ?? '').trim();
  final number = reference.referenceNumber.trim();
  return {
    if (documentId.isNotEmpty) _normalizeSuratJalanRefCandidate(documentId),
    if (key.isNotEmpty) _normalizeSuratJalanRefCandidate(key),
    if (key.isNotEmpty)
      _normalizeSuratJalanRefCandidate('${trip.deliveryOrderId}:$key'),
    if (number.isNotEmpty) _normalizeSuratJalanRefCandidate(number),
    if (number.isNotEmpty)
      _normalizeSuratJalanRefCandidate('${trip.deliveryOrderId}:$number'),
  };
}

String _defaultPodReceiverName(
  DeliveryTrip trip,
  List<DeliveryShipperReference> selectedReferences,
) {
  final tripReceiver = (trip.receiverName ?? '').trim();
  if (tripReceiver.isNotEmpty) return tripReceiver;
  for (final reference in selectedReferences) {
    final targetLabel = reference.targetLabel.trim();
    if (targetLabel.isNotEmpty && targetLabel != '-') return targetLabel;
  }
  return '';
}

DateTime _jakartaDateTimeNow() =>
    DateTime.now().toUtc().add(const Duration(hours: 7));

String _currentJakartaDateValue() => _formatDateValue(_jakartaDateTimeNow());

String _formatDateValue(DateTime date) {
  String twoDigits(int value) => value.toString().padLeft(2, '0');
  return '${date.year}-${twoDigits(date.month)}-${twoDigits(date.day)}';
}

DateTime? _parseDateValue(String value) {
  final parts = value.trim().split('-');
  if (parts.length != 3) return null;
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
  final day = int.tryParse(parts[2]);
  if (year == null || month == null || day == null) return null;
  return DateTime(year, month, day);
}

bool _isValidDateValue(String value) =>
    RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value.trim());

_ActualCargoTotals _summarizeCargoDropBasisDrafts(
  List<_ActualCargoDraft> drafts,
) {
  double qtyKoli = 0;
  double weightKg = 0;
  double volumeM3 = 0;
  for (final draft in drafts) {
    qtyKoli += draft.dropQtyKoliValue;
    weightKg += _convertWeightToKg(
      draft.dropWeightInputValueNumber,
      draft.dropWeightInputUnit,
    );
    volumeM3 += _convertVolumeToM3(
      draft.dropVolumeInputValueNumber,
      draft.dropVolumeInputUnit,
    );
  }
  return _ActualCargoTotals(
    qtyKoli: qtyKoli,
    weightKg: weightKg,
    volumeM3: volumeM3,
  );
}

_ActualCargoTotals _summarizeDropDrafts(List<_ActualDropDraft> drafts) {
  double qtyKoli = 0;
  double weightKg = 0;
  double volumeM3 = 0;
  for (final draft in drafts) {
    qtyKoli += draft.qtyKoliValue;
    weightKg += _convertWeightToKg(
      draft.weightInputValueNumber,
      draft.weightInputUnit,
    );
    volumeM3 += _convertVolumeToM3(
      draft.volumeInputValueNumber,
      draft.volumeInputUnit,
    );
  }
  return _ActualCargoTotals(
    qtyKoli: qtyKoli,
    weightKg: weightKg,
    volumeM3: volumeM3,
  );
}

_ActualCargoTotals _summarizeBillableDropDrafts(
  List<_ActualDropDraft> drafts,
) => _summarizeDropDrafts(
  drafts
      .where((draft) => _isBillableDropType(draft.stopType))
      .toList(growable: false),
);

_ActualCargoTotals _summarizeActualItemInputs(
  List<DriverActualCargoInput> items,
) {
  double qtyKoli = 0;
  double weightKg = 0;
  double volumeM3 = 0;
  for (final item in items) {
    qtyKoli += item.actualQtyKoli;
    weightKg += _convertWeightToKg(
      item.actualWeightInputValue,
      item.actualWeightInputUnit,
    );
    volumeM3 += _convertVolumeToM3(
      item.actualVolumeInputValue,
      item.actualVolumeInputUnit,
    );
  }
  return _ActualCargoTotals(
    qtyKoli: qtyKoli,
    weightKg: weightKg,
    volumeM3: volumeM3,
  );
}

List<DriverActualCargoInput> _buildSubmissionActualItems(
  List<_ActualCargoDraft> cargoDrafts,
  List<_ActualDropDraft> dropDrafts,
) {
  final itemSpecificRefs = dropDrafts
      .map((drop) => _dropItemRefsForSubmission(drop, cargoDrafts))
      .where((refs) => refs.length == 1)
      .expand((refs) => refs)
      .toSet();

  return cargoDrafts
      .map((draft) {
        final weightUnit = normalizeMobileWeightUnit(draft.weightInputUnit);
        final volumeUnit = normalizeMobileVolumeUnit(draft.volumeInputUnit);
        if (!itemSpecificRefs.contains(draft.itemId)) {
          return _actualInputFromCargoDraft(draft);
        }

        final billableDrops = dropDrafts.where((drop) {
          final itemRefs = _dropItemRefsForSubmission(drop, cargoDrafts);
          return itemRefs.length == 1 &&
              itemRefs.first == draft.itemId &&
              _isBillableDropType(drop.stopType);
        });
        double qtyKoli = 0;
        double weightKg = 0;
        double volumeM3 = 0;
        for (final drop in billableDrops) {
          qtyKoli += drop.qtyKoliValue;
          weightKg += _convertWeightToKg(
            drop.weightInputValueNumber,
            drop.weightInputUnit,
          );
          volumeM3 += _convertVolumeToM3(
            drop.volumeInputValueNumber,
            drop.volumeInputUnit,
          );
        }
        return DriverActualCargoInput(
          deliveryOrderItemRef: draft.itemId,
          actualQtyKoli: qtyKoli,
          actualWeightInputValue: _convertKgToWeightInputValue(
            weightKg,
            weightUnit,
          ),
          actualWeightInputUnit: weightUnit,
          actualVolumeInputValue: _convertM3ToVolumeInputValue(
            volumeM3,
            volumeUnit,
          ),
          actualVolumeInputUnit: volumeUnit,
        );
      })
      .toList(growable: false);
}

bool _usesDropDerivedActualCargo(
  List<_ActualDropDraft> dropDrafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  return dropDrafts.any((drop) {
    if (!_isBillableDropType(drop.stopType)) return false;
    return _dropItemRefsForSubmission(drop, cargoDrafts).length == 1;
  });
}

DriverActualCargoInput _actualInputFromCargoDraft(_ActualCargoDraft draft) {
  return DriverActualCargoInput(
    deliveryOrderItemRef: draft.itemId,
    actualQtyKoli: draft.qtyKoliValue,
    actualWeightInputValue: draft.weightInputValueNumber,
    actualWeightInputUnit: normalizeMobileWeightUnit(draft.weightInputUnit),
    actualVolumeInputValue: draft.volumeInputValueNumber,
    actualVolumeInputUnit: normalizeMobileVolumeUnit(draft.volumeInputUnit),
  );
}

List<String> _normalizedDropItemRefs(_ActualDropDraft draft) {
  final seen = <String>{};
  final values = <String>[];
  void addRef(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty || !seen.add(trimmed)) return;
    values.add(trimmed);
  }

  addRef(draft.deliveryOrderItemRef);
  for (final value in draft.deliveryOrderItemRefs) {
    addRef(value);
  }
  return values;
}

List<String> _dropItemRefsForSubmission(
  _ActualDropDraft draft,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final explicitRefs = _normalizedDropItemRefs(draft);
  if (explicitRefs.isNotEmpty) return explicitRefs;
  final resolvedCargo = _resolvedSingleCargoDraftForDrop(draft, cargoDrafts);
  return resolvedCargo == null ? const [] : [resolvedCargo.itemId];
}

String? _getMissingDropLocationMessage(List<_ActualDropDraft> dropDrafts) {
  final groups = _groupDropDraftsForUi(dropDrafts);
  for (final entry in groups.indexed) {
    final locationName = entry.$2.primaryDraft.locationName.trim();
    if (locationName.isEmpty) {
      return 'Nama lokasi wajib diisi untuk Titik Drop ${entry.$1 + 1}.';
    }
  }
  return null;
}

String? _getDetailedMultiDropAllocationMessage(
  List<_ActualDropDraft> dropDrafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (dropDrafts.length <= 1 || cargoDrafts.length <= 1) return null;

  final groups = _groupDropDraftsForUi(dropDrafts);
  for (final group in groups) {
    final billableDrafts = group.drafts
        .where(
          (draft) =>
              _isBillableDropType(draft.stopType) &&
              _hasActualDropItemValues(draft),
        )
        .toList(growable: false);
    if (billableDrafts.isEmpty) continue;

    final hasItemSpecificAllocation = billableDrafts.any(
      (draft) => _dropItemRefsForSubmission(draft, cargoDrafts).length == 1,
    );
    if (!hasItemSpecificAllocation) {
      return 'Untuk multi-drop, pilih barang spesifik di setiap titik agar aktual barang dihitung dari alokasi drop.';
    }
  }

  return null;
}

String? _getRemainingDropAllocationMessage(
  List<_ActualDropDraft> dropDrafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (!_requiresCompleteDropItemAllocation(dropDrafts, cargoDrafts)) {
    return null;
  }

  for (final cargo in cargoDrafts) {
    final remaining = _remainingDropValuesForCargoItem(
      cargo,
      dropDrafts,
      excludeDraftId: '',
    );
    if (!_hasActualDropItemValues(remaining)) continue;

    final itemLabel = cargo.description.trim().isEmpty
        ? 'Barang'
        : cargo.description.trim();
    return '$itemLabel masih punya sisa alokasi ${_formatDropDraftValues(remaining)}. Alokasikan ke titik drop atau Hold / Inap sebelum lanjut.';
  }

  return null;
}

bool _requiresCompleteDropItemAllocation(
  List<_ActualDropDraft> dropDrafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (dropDrafts.isEmpty || cargoDrafts.isEmpty) return false;
  final detailedContext =
      dropDrafts.length > 1 ||
      dropDrafts.any((draft) => _isNonBillableDropType(draft.stopType)) ||
      dropDrafts.any(_dropDraftHasItemSelection);
  if (!detailedContext) return false;

  return dropDrafts.any((draft) {
    return _dropItemRefsForSubmission(draft, cargoDrafts).length == 1;
  });
}

List<_ActualDropDraft> _effectiveSubmissionDropDrafts(
  List<_ActualDropDraft> dropDrafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (dropDrafts.length == 1 &&
      !_dropDraftHasItemSelection(dropDrafts.first) &&
      _hasActualDropItemValues(dropDrafts.first)) {
    return _expandGenericDropDraftToCargoAllocations(
      dropDrafts.first,
      cargoDrafts,
    );
  }

  final effective = <_ActualDropDraft>[];
  for (final group in _groupDropDraftsForUi(dropDrafts)) {
    final itemSpecificDrafts = group.drafts
        .where((draft) {
          if (!_hasActualDropItemValues(draft)) return false;
          return _dropItemRefsForSubmission(draft, cargoDrafts).length == 1;
        })
        .toList(growable: false);

    if (itemSpecificDrafts.isNotEmpty) {
      effective.addAll(itemSpecificDrafts);
      continue;
    }

    effective.addAll(
      group.drafts.where((draft) {
        return !_isIgnorableEmptyNonBillableDrop(draft);
      }),
    );
  }
  return effective;
}

List<_ActualDropDraft> _expandGenericDropDraftToCargoAllocations(
  _ActualDropDraft sourceDraft,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (cargoDrafts.isEmpty) return [sourceDraft];
  return cargoDrafts
      .map((cargo) {
        return sourceDraft.copyWith(
          deliveryOrderItemRef: cargo.itemId,
          deliveryOrderItemRefs: [cargo.itemId],
          shipperReferenceKey: cargo.shipperReferenceKey,
          shipperReferenceNumber: cargo.shipperReferenceNumber,
          qtyKoli: cargo.dropQtyKoli,
          weightInputValue: cargo.dropWeightInputValue,
          weightInputUnit: cargo.dropWeightInputUnit,
          volumeInputValue: cargo.dropVolumeInputValue,
          volumeInputUnit: cargo.dropVolumeInputUnit,
        );
      })
      .toList(growable: false);
}

List<_ActualDropDraft> _activeDropDraftsForValidation(
  List<_ActualDropDraft> dropDrafts,
) {
  return dropDrafts
      .where((draft) => !_isIgnorableEmptyNonBillableDrop(draft))
      .toList(growable: false);
}

bool _isIgnorableEmptyNonBillableDrop(_ActualDropDraft draft) {
  return _isNonBillableDropType(draft.stopType) &&
      !_hasActualDropItemValues(draft);
}

_ActualCargoDraft? _resolvedSingleCargoDraftForDrop(
  _ActualDropDraft draft,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final explicitRefs = _normalizedDropItemRefs(draft);
  if (explicitRefs.length == 1) {
    return _findCargoDraftByItemRef(cargoDrafts, explicitRefs.first);
  }
  if (explicitRefs.length > 1) return null;

  final matchingItems = cargoDrafts
      .where((cargo) => _dropDraftMatchesCargo(draft, cargo))
      .toList(growable: false);
  if (matchingItems.length != 1) return null;
  return matchingItems.first;
}

bool _dropDraftHasItemSelection(_ActualDropDraft draft) =>
    _normalizedDropItemRefs(draft).isNotEmpty;

_ActualCargoDraft? _findCargoDraftByItemRef(
  List<_ActualCargoDraft> drafts,
  String? itemRef,
) {
  final normalized = (itemRef ?? '').trim();
  if (normalized.isEmpty) return null;
  for (final draft in drafts) {
    if (draft.itemId == normalized) return draft;
  }
  return null;
}

List<_ActualDropDraft> _createNextDropDraftsForSelectedCargo(
  List<_ActualCargoDraft> selectedCargoDrafts,
  List<_ActualDropDraft> selectedDropDrafts,
  List<DeliveryShipperReference> selectedReferences,
) {
  final base = _ActualDropDraft.create();
  final targetReference = selectedReferences.length == 1
      ? selectedReferences.first
      : null;
  final baseWithTarget = targetReference == null
      ? base
      : base.copyWith(
          shipperReferenceNumber: targetReference.referenceNumber,
          shipperReferenceKey: targetReference.key ?? '',
        );
  if (selectedCargoDrafts.isEmpty) return [baseWithTarget];

  final groupKey = baseWithTarget.groupKey;
  final nextDrafts = <_ActualDropDraft>[];
  for (final cargo in selectedCargoDrafts) {
    final remaining = _remainingDropValuesForCargoItem(
      cargo,
      selectedDropDrafts,
      excludeDraftId: baseWithTarget.id,
    );
    if (!_hasActualDropItemValues(remaining)) continue;
    final itemBase = nextDrafts.isEmpty
        ? baseWithTarget
        : _ActualDropDraft.create(
            stopType: baseWithTarget.stopType,
            shipperReferenceNumber: baseWithTarget.shipperReferenceNumber,
            shipperReferenceKey: baseWithTarget.shipperReferenceKey,
            originLocationName: baseWithTarget.originLocationName,
            originLocationAddress: baseWithTarget.originLocationAddress,
            locationName: baseWithTarget.locationName,
            locationAddress: baseWithTarget.locationAddress,
            note: baseWithTarget.note,
            groupKey: groupKey,
          );
    nextDrafts.add(
      _applyCargoDraftToDrop(
        itemBase,
        cargo,
        selectedDropDrafts,
        forceValues: true,
      ),
    );
  }

  if (nextDrafts.isNotEmpty) return nextDrafts;

  return [
    _applyCargoDraftToDrop(
      baseWithTarget,
      selectedCargoDrafts.first,
      selectedDropDrafts,
      forceValues: true,
    ),
  ];
}

_ActualDropDraft _applyCargoDraftToDrop(
  _ActualDropDraft draft,
  _ActualCargoDraft cargo,
  List<_ActualDropDraft> allDrafts, {
  required bool forceValues,
}) {
  final remaining = _remainingDropValuesForCargoItem(
    cargo,
    allDrafts,
    excludeDraftId: draft.id,
  );
  String valueOrCurrent(String current, String next) {
    if (forceValues || current.trim().isEmpty) return next;
    return current;
  }

  return draft.copyWith(
    deliveryOrderItemRef: cargo.itemId,
    deliveryOrderItemRefs: [cargo.itemId],
    shipperReferenceNumber: cargo.shipperReferenceNumber,
    shipperReferenceKey: cargo.shipperReferenceKey,
    qtyKoli: valueOrCurrent(draft.qtyKoli, remaining.qtyKoli),
    weightInputValue: valueOrCurrent(
      draft.weightInputValue,
      remaining.weightInputValue,
    ),
    weightInputUnit: remaining.weightInputUnit,
    volumeInputValue: valueOrCurrent(
      draft.volumeInputValue,
      remaining.volumeInputValue,
    ),
    volumeInputUnit: remaining.volumeInputUnit,
  );
}

_ActualDropDraft _applyDropAllocationValues(
  _ActualDropDraft draft,
  _DropAllocationEditResult result,
) {
  return draft.copyWith(
    qtyKoli: result.qtyKoli,
    weightInputValue: result.weightInputValue,
    weightInputUnit: result.weightInputUnit,
    volumeInputValue: result.volumeInputValue,
    volumeInputUnit: result.volumeInputUnit,
  );
}

_ActualDropDraft _remainingDropValuesForCargoItem(
  _ActualCargoDraft cargo,
  List<_ActualDropDraft> allDrafts, {
  required String excludeDraftId,
}) {
  double usedQtyKoli = 0;
  double usedWeightKg = 0;
  double usedVolumeM3 = 0;
  for (final draft in allDrafts) {
    if (draft.id == excludeDraftId) continue;
    final itemRefs = _normalizedDropItemRefs(draft);
    if (itemRefs.length != 1 || itemRefs.first != cargo.itemId) continue;
    usedQtyKoli += draft.qtyKoliValue;
    usedWeightKg += _convertWeightToKg(
      draft.weightInputValueNumber,
      draft.weightInputUnit,
    );
    usedVolumeM3 += _convertVolumeToM3(
      draft.volumeInputValueNumber,
      draft.volumeInputUnit,
    );
  }

  final weightUnit = normalizeMobileWeightUnit(cargo.dropWeightInputUnit);
  final volumeUnit = normalizeMobileVolumeUnit(cargo.dropVolumeInputUnit);
  final remainingQtyKoli = (cargo.dropQtyKoliValue - usedQtyKoli)
      .clamp(0, double.infinity)
      .toDouble();
  final remainingWeightKg =
      (_convertWeightToKg(cargo.dropWeightInputValueNumber, weightUnit) -
              usedWeightKg)
          .clamp(0, double.infinity)
          .toDouble();
  final remainingVolumeM3 =
      (_convertVolumeToM3(cargo.dropVolumeInputValueNumber, volumeUnit) -
              usedVolumeM3)
          .clamp(0, double.infinity)
          .toDouble();
  final remainingWeightInputValue = _convertKgToWeightInputValue(
    remainingWeightKg,
    weightUnit,
  );
  final remainingVolumeInputValue = _convertM3ToVolumeInputValue(
    remainingVolumeM3,
    volumeUnit,
  );
  return _ActualDropDraft.create(
    qtyKoli: remainingQtyKoli <= 0 && cargo.dropQtyKoliValue > 0
        ? '0'
        : formatMobileMetric(remainingQtyKoli),
    weightInputValue:
        remainingWeightInputValue <= 0 && cargo.dropWeightInputValueNumber > 0
        ? '0'
        : formatMobileMetric(
            remainingWeightInputValue,
            fractionDigits: mobileWeightInputFractionDigits(weightUnit),
          ),
    weightInputUnit: weightUnit,
    volumeInputValue:
        remainingVolumeInputValue <= 0 && cargo.dropVolumeInputValueNumber > 0
        ? '0'
        : formatMobileMetric(
            remainingVolumeInputValue,
            fractionDigits: volumeUnit == 'LITER' ? 0 : 3,
          ),
    volumeInputUnit: volumeUnit,
  );
}

bool _hasActualDropItemValues(_ActualDropDraft draft) =>
    draft.qtyKoliValue > 0 ||
    draft.weightInputValueNumber > 0 ||
    draft.volumeInputValueNumber > 0;

String? _autoWeightInputValueForQty({
  required _ActualDropDraft draft,
  required _ActualCargoDraft? cargo,
  required String nextQtyKoli,
  required String nextWeightUnit,
}) {
  if (cargo == null) return null;
  final qtyKoli = _parseDouble(nextQtyKoli);
  final basisQtyKoli = cargo.dropQtyKoliValue;
  final basisWeightKg = _convertWeightToKg(
    cargo.dropWeightInputValueNumber,
    cargo.dropWeightInputUnit,
  );
  if (qtyKoli <= 0 || basisQtyKoli <= 0 || basisWeightKg <= 0) {
    return '';
  }

  final currentQtyKoli = draft.qtyKoliValue;
  final currentWeightKg = _convertWeightToKg(
    draft.weightInputValueNumber,
    draft.weightInputUnit,
  );
  final previousAutoWeightKg = currentQtyKoli > 0
      ? basisWeightKg * currentQtyKoli / basisQtyKoli
      : 0;
  final shouldRefresh =
      currentWeightKg <= 0 ||
      previousAutoWeightKg <= 0 ||
      (currentWeightKg - previousAutoWeightKg).abs() <= 0.01;
  if (!shouldRefresh) return null;

  final nextWeightKg = basisWeightKg * qtyKoli / basisQtyKoli;
  final normalizedUnit = normalizeMobileWeightUnit(nextWeightUnit);
  return formatMobileMetric(
    _convertKgToWeightInputValue(nextWeightKg, normalizedUnit),
    fractionDigits: mobileWeightInputFractionDigits(normalizedUnit),
  );
}

String? _autoVolumeInputValueForQty({
  required _ActualDropDraft draft,
  required _ActualCargoDraft? cargo,
  required String nextQtyKoli,
  required String nextVolumeUnit,
}) {
  if (cargo == null) return null;
  final qtyKoli = _parseDouble(nextQtyKoli);
  final basisQtyKoli = cargo.dropQtyKoliValue;
  final basisVolumeM3 = _convertVolumeToM3(
    cargo.dropVolumeInputValueNumber,
    cargo.dropVolumeInputUnit,
  );
  if (qtyKoli <= 0 || basisQtyKoli <= 0 || basisVolumeM3 <= 0) {
    return '';
  }

  final currentQtyKoli = draft.qtyKoliValue;
  final currentVolumeM3 = _convertVolumeToM3(
    draft.volumeInputValueNumber,
    draft.volumeInputUnit,
  );
  final previousAutoVolumeM3 = currentQtyKoli > 0
      ? basisVolumeM3 * currentQtyKoli / basisQtyKoli
      : 0;
  final shouldRefresh =
      currentVolumeM3 <= 0 ||
      previousAutoVolumeM3 <= 0 ||
      (currentVolumeM3 - previousAutoVolumeM3).abs() <= 0.001;
  final nextVolumeM3 = shouldRefresh
      ? basisVolumeM3 * qtyKoli / basisQtyKoli
      : (currentQtyKoli > 0 && currentVolumeM3 > 0
            ? currentVolumeM3 * qtyKoli / currentQtyKoli
            : 0.0);
  if (nextVolumeM3 <= 0) return null;

  final normalizedUnit = normalizeMobileVolumeUnit(nextVolumeUnit);
  return formatMobileMetric(
    _convertM3ToVolumeInputValue(nextVolumeM3, normalizedUnit),
    fractionDigits: mobileVolumeInputFractionDigits(normalizedUnit),
  );
}

String _formatCargoDraftValues(_ActualCargoDraft draft) {
  final parts = <String>[
    if (draft.qtyKoliValue > 0)
      '${formatMobileMetric(draft.qtyKoliValue)} koli',
    if (draft.weightInputValueNumber > 0)
      '${formatMobileMetric(draft.weightInputValueNumber, fractionDigits: mobileWeightInputFractionDigits(draft.weightInputUnit))} ${normalizeMobileWeightUnit(draft.weightInputUnit)}',
    if (draft.volumeInputValueNumber > 0)
      '${formatMobileMetric(draft.volumeInputValueNumber, fractionDigits: normalizeMobileVolumeUnit(draft.volumeInputUnit) == 'LITER' ? 0 : 3)} ${normalizeMobileVolumeUnit(draft.volumeInputUnit)}',
  ];
  return parts.isEmpty ? 'Belum diisi' : parts.join(' / ');
}

String _formatActualCargoInputValues(DriverActualCargoInput input) {
  final weightUnit = normalizeMobileWeightUnit(input.actualWeightInputUnit);
  final volumeUnit = normalizeMobileVolumeUnit(input.actualVolumeInputUnit);
  final parts = <String>[
    if (input.actualQtyKoli > 0)
      '${formatMobileMetric(input.actualQtyKoli)} koli',
    if (input.actualWeightInputValue > 0)
      '${formatMobileMetric(input.actualWeightInputValue, fractionDigits: mobileWeightInputFractionDigits(weightUnit))} $weightUnit',
    if (input.actualVolumeInputValue > 0)
      '${formatMobileMetric(input.actualVolumeInputValue, fractionDigits: volumeUnit == 'LITER' ? 0 : 3)} $volumeUnit',
  ];
  return parts.isEmpty ? 'Belum dialokasikan' : parts.join(' / ');
}

String _shipperReferenceOptionValue(DeliveryShipperReference reference) {
  final key = (reference.key ?? '').trim();
  if (key.isNotEmpty) return 'key:$key';
  return 'number:${reference.referenceNumber.trim().toUpperCase()}';
}

String? _getAmbiguousActualDropMappingMessage(
  List<_ActualDropDraft> drops,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (drops.length <= 1 || cargoDrafts.length <= 1) return null;

  final groups = <String, List<_ActualCargoDraft>>{};
  for (final cargo in cargoDrafts) {
    final key = _cargoDraftReferenceGroupKey(cargo);
    groups.putIfAbsent(key, () => []).add(cargo);
  }

  for (final entry in groups.entries) {
    final groupItems = entry.value;
    if (groupItems.length <= 1) continue;

    final groupDrops = drops
        .where(
          (drop) =>
              groupItems.any((cargo) => _dropDraftMatchesCargo(drop, cargo)),
        )
        .toList(growable: false);
    final hasBillable = groupDrops.any(
      (drop) => _isBillableDropType(drop.stopType),
    );
    final hasNonBillable = groupDrops.any(
      (drop) => _isNonBillableDropType(drop.stopType),
    );
    if (!hasBillable || !hasNonBillable) continue;

    final hasAmbiguousDrop = groupDrops.any((drop) {
      if (_dropDraftHasItemSelection(drop)) return false;
      final matchedItems = groupItems
          .where((cargo) => _dropDraftMatchesCargo(drop, cargo))
          .length;
      return matchedItems > 1;
    });
    if (!hasAmbiguousDrop) continue;

    final groupLabel = groupItems.first.shipperReferenceNumber.trim().isEmpty
        ? 'SJ ini'
        : 'SJ ${groupItems.first.shipperReferenceNumber.trim()}';
    return '$groupLabel punya campuran drop dan hold/return. Pilih barang spesifik untuk setiap titik sebelum finalisasi agar status dan invoice per barang tidak salah.';
  }

  return null;
}

String _cargoDraftReferenceGroupKey(_ActualCargoDraft cargo) {
  final key = cargo.shipperReferenceKey.trim();
  if (key.isNotEmpty) return 'key:$key';
  final number = cargo.shipperReferenceNumber.trim().toUpperCase();
  if (number.isNotEmpty) return 'number:$number';
  return 'TANPA-SJ';
}

bool _dropDraftMatchesCargo(_ActualDropDraft drop, _ActualCargoDraft cargo) {
  final itemRefs = _normalizedDropItemRefs(drop);
  if (itemRefs.isNotEmpty) return itemRefs.contains(cargo.itemId);

  final dropReferenceKey = drop.shipperReferenceKey.trim();
  final dropReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
  if (dropReferenceKey.isEmpty && dropReferenceNumber.isEmpty) return true;

  return (dropReferenceKey.isNotEmpty &&
          dropReferenceKey == cargo.shipperReferenceKey.trim()) ||
      (dropReferenceNumber.isNotEmpty &&
          dropReferenceNumber ==
              cargo.shipperReferenceNumber.trim().toUpperCase());
}

String _resolveRecipientOptionValue(
  _ActualDropDraft drop,
  List<CustomerRecipientOption> recipients,
) {
  final locationName = drop.locationName.trim().toLowerCase();
  final locationAddress = drop.locationAddress.trim().toLowerCase();
  if (locationName.isEmpty && locationAddress.isEmpty) return '';

  for (final recipient in recipients) {
    final recipientName = recipient.locationName.trim().toLowerCase();
    final recipientAddress = recipient.receiverAddress.trim().toLowerCase();
    if ((locationAddress.isNotEmpty && locationAddress == recipientAddress) ||
        (locationName.isNotEmpty && locationName == recipientName)) {
      return recipient.id;
    }
  }
  return '';
}

double _parseDouble(String raw) => parseMobileNumberInput(raw);

double _convertWeightToKg(double value, String unit) {
  if (value <= 0) return 0;
  return unit.toUpperCase() == 'TON' ? value * 1000 : value;
}

double _convertVolumeToM3(double value, String unit) {
  if (value <= 0) return 0;
  switch (unit.toUpperCase()) {
    case 'LITER':
      return value / 1000;
    case 'KL':
      return value;
    default:
      return value;
  }
}

double _convertKgToWeightInputValue(double weightKg, String unit) {
  if (weightKg <= 0) return 0;
  return unit.toUpperCase() == 'TON' ? weightKg / 1000 : weightKg;
}

double _convertM3ToVolumeInputValue(double volumeM3, String unit) {
  if (volumeM3 <= 0) return 0;
  return unit.toUpperCase() == 'LITER' ? volumeM3 * 1000 : volumeM3;
}

String _normalizeDropStopType(String value) {
  final normalized = value.trim().toUpperCase();
  return switch (normalized) {
    'HOLD' => 'HOLD',
    'TRANSIT' => 'TRANSIT',
    'EXTRA_DROP' => 'EXTRA_DROP',
    'RETURN' => 'RETURN',
    _ => 'DROP',
  };
}

String _editableDriverDropStopType(String value) {
  final normalized = _normalizeDropStopType(value);
  return switch (normalized) {
    'HOLD' || 'TRANSIT' || 'RETURN' => 'HOLD',
    _ => 'DROP',
  };
}

const _driverDropStopTypeItems = [
  DropdownMenuItem<String>(value: 'DROP', child: Text('Drop')),
  DropdownMenuItem<String>(value: 'HOLD', child: Text('Hold / Inap')),
];

bool _isBillableDropType(String value) {
  final normalized = _normalizeDropStopType(value);
  return normalized == 'DROP' || normalized == 'EXTRA_DROP';
}

bool _isNonBillableDropType(String value) => !_isBillableDropType(value);

class _PodCard extends StatelessWidget {
  const _PodCard({
    required this.receiverController,
    required this.dateController,
    required this.onPickDate,
  });

  final TextEditingController receiverController;
  final TextEditingController dateController;
  final VoidCallback? onPickDate;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'POD',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: receiverController,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Nama Penerima POD'),
              scrollPadding: mobileInputScrollPadding,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: dateController,
              keyboardType: TextInputType.datetime,
              decoration: InputDecoration(
                labelText: 'Tanggal Terima POD',
                suffixIcon: IconButton(
                  onPressed: onPickDate,
                  icon: const Icon(Icons.calendar_today_rounded),
                  tooltip: 'Pilih tanggal',
                ),
              ),
              scrollPadding: mobileInputScrollPadding,
            ),
          ],
        ),
      ),
    );
  }
}

class _BatchSuratJalanCard extends StatelessWidget {
  const _BatchSuratJalanCard({
    required this.references,
    required this.selectedValues,
    required this.canRequestFinalization,
    required this.onChanged,
  });

  final List<DeliveryShipperReference> references;
  final Set<String> selectedValues;
  final bool Function(DeliveryShipperReference reference)
  canRequestFinalization;
  final void Function(String optionValue, bool selected)? onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Text(
                'SJ Finalisasi',
                style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
              ),
            ),
            for (final reference in references)
              CheckboxListTile(
                value: selectedValues.contains(
                  _shipperReferenceOptionValue(reference),
                ),
                onChanged:
                    canRequestFinalization(reference) && onChanged != null
                    ? (value) => onChanged!(
                        _shipperReferenceOptionValue(reference),
                        value ?? false,
                      )
                    : null,
                title: Text(reference.referenceNumber),
                subtitle: Text(
                  _shipperReferenceSubtitle(
                    reference,
                    pending:
                        !canRequestFinalization(reference) &&
                        reference.canRequestFinalization,
                  ),
                ),
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              ),
          ],
        ),
      ),
    );
  }
}

String _shipperReferenceSubtitle(
  DeliveryShipperReference reference, {
  bool pending = false,
}) {
  final parts = [
    reference.targetLabel,
    if ((reference.tripStatus ?? '').trim().isNotEmpty)
      deliveryStatusLabel(reference.tripStatus!.trim()),
    if (pending) 'Menunggu approval admin',
  ].where((value) => value.trim().isNotEmpty && value.trim() != '-');
  return parts.isEmpty ? 'Belum ada tujuan' : parts.join(' | ');
}

class _DropWorkflowCard extends StatelessWidget {
  const _DropWorkflowCard({
    required this.cargoCount,
    required this.dropCount,
    required this.usesDetailedDrop,
  });

  final int cargoCount;
  final int dropCount;
  final bool usesDetailedDrop;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Tentukan Realisasi Titik Drop',
              style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            const SizedBox(height: 8),
            Text(
              usesDetailedDrop
                  ? '$dropCount titik drop aktif untuk $cargoCount item. Barang tiap titik harus jelas sebelum diajukan.'
                  : '$cargoCount item akan turun di satu titik. Tambahkan titik hanya untuk multi-drop atau hold/inap.',
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.62),
                height: 1.4,
                fontSize: 12.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActualCargoByDropEditor extends StatelessWidget {
  const _ActualCargoByDropEditor({
    required this.selectedDropGroups,
    required this.selectedDropDraft,
    required this.selectedCargoDrafts,
    required this.allDropDrafts,
    required this.onDropSelected,
    required this.onDetermine,
  });

  final List<_DropUiGroup> selectedDropGroups;
  final _ActualDropDraft selectedDropDraft;
  final List<_ActualCargoDraft> selectedCargoDrafts;
  final List<_ActualDropDraft> allDropDrafts;
  final ValueChanged<String> onDropSelected;
  final void Function(String draftId, List<_DropAllocationEditResult> results)
  onDetermine;

  @override
  Widget build(BuildContext context) {
    final dropGroupDrafts = _dropGroupDraftsFor(
      selectedDropDraft,
      allDropDrafts,
    );
    final allocationDrafts = dropGroupDrafts
        .where(_dropDraftHasItemSelection)
        .toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ActualDropSelectorField(
          groups: selectedDropGroups,
          cargoDrafts: selectedCargoDrafts,
          selectedDraftId: selectedDropDraft.id,
          onChanged: onDropSelected,
        ),
        const SizedBox(height: 12),
        _DropPointCargoAccordion(
          sourceDraftId: selectedDropDraft.id,
          cargoDrafts: selectedCargoDrafts,
          allDropDrafts: allDropDrafts,
          allocationDrafts: allocationDrafts,
          title: 'Aktual Barang di Titik Ini',
          buttonLabel: 'Tentukan Aktual Barang',
          modalTitle: 'Tentukan Aktual Barang',
          quantityLabel: 'Qty Aktual',
          weightLabel: 'Berat Aktual',
          volumeLabel: 'Volume Aktual',
          showRemainingHelper: false,
          onDetermine: onDetermine,
        ),
        const SizedBox(height: 12),
        _DropPointAllocationSummary(
          drafts: allocationDrafts,
          cargoDrafts: selectedCargoDrafts,
        ),
      ],
    );
  }
}

class _ActualCargoSection extends StatelessWidget {
  const _ActualCargoSection({
    super.key,
    required this.section,
    required this.showHeader,
    required this.onChanged,
  });

  final _ActualCargoSectionData section;
  final bool showHeader;
  final void Function(
    String cargoId, {
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  })
  onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final targetLabel = section.targetLabel.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showHeader) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(
                  Icons.description_outlined,
                  size: 16,
                  color: scheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    targetLabel.isEmpty
                        ? section.label
                        : '${section.label} | $targetLabel',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.72),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        ...section.drafts.map(
          (draft) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _ActualCargoCard(
              key: ValueKey(draft.itemId),
              draft: draft,
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}

class _DerivedActualCargoSection extends StatelessWidget {
  const _DerivedActualCargoSection({
    super.key,
    required this.section,
    required this.showHeader,
    required this.actualItemByRef,
  });

  final _ActualCargoSectionData section;
  final bool showHeader;
  final Map<String, DriverActualCargoInput> actualItemByRef;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final targetLabel = section.targetLabel.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showHeader) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(
                  Icons.description_outlined,
                  size: 16,
                  color: scheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    targetLabel.isEmpty
                        ? section.label
                        : '${section.label} | $targetLabel',
                    style: TextStyle(
                      color: scheme.onSurface.withValues(alpha: 0.72),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        ...section.drafts.map(
          (draft) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _DerivedActualCargoCard(
              key: ValueKey('derived-${draft.itemId}'),
              draft: draft,
              actualItem: actualItemByRef[draft.itemId],
            ),
          ),
        ),
      ],
    );
  }
}

class _DerivedActualCargoCard extends StatelessWidget {
  const _DerivedActualCargoCard({
    super.key,
    required this.draft,
    required this.actualItem,
  });

  final _ActualCargoDraft draft;
  final DriverActualCargoInput? actualItem;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final sjNumber = draft.shipperReferenceNumber.trim();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        draft.description,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                      if (sjNumber.isNotEmpty) ...[
                        const SizedBox(height: 4),
                        Text(
                          'SJ $sjNumber',
                          style: TextStyle(
                            color: scheme.onSurface.withValues(alpha: 0.62),
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Chip(
                  visualDensity: VisualDensity.compact,
                  label: Text(actualItem == null ? 'Kosong' : 'Terisi'),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.38),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: scheme.outline.withValues(alpha: 0.24),
                ),
              ),
              child: Text(
                actualItem == null
                    ? 'Belum ada alokasi item di titik drop.'
                    : _formatActualCargoInputValues(actualItem!),
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.74),
                  fontSize: 12.5,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActualCargoCard extends StatelessWidget {
  const _ActualCargoCard({
    super.key,
    required this.draft,
    required this.onChanged,
  });

  final _ActualCargoDraft draft;
  final void Function(
    String cargoId, {
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  })
  onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              draft.description,
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
            ),
            if (draft.shipperReferenceNumber.trim().isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                'SJ ${draft.shipperReferenceNumber.trim()}',
                style: TextStyle(
                  color: Theme.of(
                    context,
                  ).colorScheme.onSurface.withValues(alpha: 0.62),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.qtyKoli,
              keyboardType: mobileNumberKeyboardType(2),
              inputFormatters: mobileNumberInputFormatters(2),
              decoration: InputDecoration(
                labelText: draft.requireQty ? 'Qty Aktual *' : 'Qty Aktual',
                enabled: draft.requireQty,
              ),
              enabled: draft.requireQty,
              onChanged: (value) => onChanged(draft.itemId, qtyKoli: value),
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget weightField() {
                  final fractionDigits = mobileWeightInputFractionDigits(
                    draft.weightInputUnit,
                  );
                  return _SyncedTextFormField(
                    value: draft.weightInputValue,
                    keyboardType: mobileNumberKeyboardType(fractionDigits),
                    inputFormatters: mobileNumberInputFormatters(
                      fractionDigits,
                    ),
                    decoration: InputDecoration(
                      labelText: draft.requireWeight
                          ? 'Berat Aktual *'
                          : 'Berat Aktual',
                    ),
                    onChanged: (value) =>
                        onChanged(draft.itemId, weightInputValue: value),
                  );
                }

                Widget weightUnitField() {
                  final selectedUnit = normalizeMobileWeightUnit(
                    draft.weightInputUnit,
                  );
                  return MobileUnitSelectorField(
                    value: selectedUnit,
                    options: const ['KG', 'TON'],
                    onChanged: (value) =>
                        onChanged(draft.itemId, weightInputUnit: value),
                  );
                }

                if (constraints.maxWidth < 340) {
                  return Column(
                    children: [
                      weightField(),
                      const SizedBox(height: 12),
                      weightUnitField(),
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: weightField()),
                    const SizedBox(width: 12),
                    SizedBox(width: 110, child: weightUnitField()),
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                Widget volumeField() {
                  final fractionDigits = mobileVolumeInputFractionDigits(
                    draft.volumeInputUnit,
                  );
                  return _SyncedTextFormField(
                    value: draft.volumeInputValue,
                    keyboardType: mobileNumberKeyboardType(fractionDigits),
                    inputFormatters: mobileNumberInputFormatters(
                      fractionDigits,
                    ),
                    decoration: InputDecoration(
                      labelText: draft.requireVolume
                          ? 'Volume Aktual *'
                          : 'Volume Aktual',
                    ),
                    onChanged: (value) =>
                        onChanged(draft.itemId, volumeInputValue: value),
                  );
                }

                Widget volumeUnitField() {
                  final selectedUnit = normalizeMobileVolumeUnit(
                    draft.volumeInputUnit,
                  );
                  return MobileUnitSelectorField(
                    value: selectedUnit,
                    options: const ['M3', 'LITER', 'KL'],
                    onChanged: (value) =>
                        onChanged(draft.itemId, volumeInputUnit: value),
                  );
                }

                if (constraints.maxWidth < 340) {
                  return Column(
                    children: [
                      volumeField(),
                      const SizedBox(height: 12),
                      volumeUnitField(),
                    ],
                  );
                }

                return Row(
                  children: [
                    Expanded(child: volumeField()),
                    const SizedBox(width: 12),
                    SizedBox(width: 110, child: volumeUnitField()),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _ActualDropSelectorField extends StatelessWidget {
  const _ActualDropSelectorField({
    required this.groups,
    required this.cargoDrafts,
    required this.selectedDraftId,
    required this.onChanged,
  });

  final List<_DropUiGroup> groups;
  final List<_ActualCargoDraft> cargoDrafts;
  final String? selectedDraftId;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    if (groups.isEmpty) {
      return InputDecorator(
        decoration: const InputDecoration(
          labelText: 'Pilih Titik Drop',
          enabled: false,
        ),
        child: Text(
          'Belum ada titik drop',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
            color: Theme.of(context).disabledColor,
          ),
        ),
      );
    }

    final selectedIndex = _selectedDropGroupIndex(groups, selectedDraftId);
    final selectedGroup = groups[selectedIndex];

    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: groups.length > 1 ? () => _openPicker(context) : null,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: 'Pilih Titik Drop',
          helperText: groups.length > 1
              ? '${groups.length} titik drop tersedia. Pilih titik yang mau diedit.'
              : 'Satu titik drop tersedia.',
          helperMaxLines: 2,
          suffixIcon: groups.length > 1
              ? const Icon(Icons.expand_more_rounded)
              : null,
        ),
        child: Text(
          _dropSelectorTitle(selectedGroup, selectedIndex),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
      ),
    );
  }

  Future<void> _openPicker(BuildContext context) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final selectedId = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Pilih Titik Drop',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: groups.length,
                    separatorBuilder: (context, index) =>
                        const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final group = groups[index];
                      final draft = group.primaryDraft;
                      return ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 4,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                        leading: const Icon(Icons.location_on_outlined),
                        title: Text(_dropSelectorTitle(group, index)),
                        subtitle: Text(
                          _dropSelectorSubtitle(group, cargoDrafts),
                        ),
                        trailing: group.containsDraftId(selectedDraftId)
                            ? const Icon(Icons.check_rounded)
                            : null,
                        onTap: () => Navigator.of(context).pop(draft.id),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    if (selectedId != null && selectedId != selectedDraftId) {
      onChanged(selectedId);
    }
  }
}

int _selectedDropGroupIndex(
  List<_DropUiGroup> groups,
  String? selectedDraftId,
) {
  final index = groups.indexWhere(
    (group) => group.containsDraftId(selectedDraftId),
  );
  return index < 0 ? 0 : index;
}

int _dropGroupIndex(List<_ActualDropDraft> drafts, _ActualDropDraft draft) {
  final groups = _groupDropDraftsForUi(drafts);
  final index = groups.indexWhere((group) => group.containsDraftId(draft.id));
  return index < 0 ? 0 : index;
}

List<_DropUiGroup> _groupDropDraftsForUi(List<_ActualDropDraft> drafts) {
  final groups = <_DropUiGroup>[];
  final groupByKey = <String, List<_ActualDropDraft>>{};
  for (final draft in drafts) {
    groupByKey.putIfAbsent(_dropLocationGroupKey(draft), () => []).add(draft);
  }
  for (final entry in groupByKey.entries) {
    groups.add(_DropUiGroup(key: entry.key, drafts: entry.value));
  }
  return groups;
}

class _DropUiGroup {
  const _DropUiGroup({required this.key, required this.drafts});

  final String key;
  final List<_ActualDropDraft> drafts;

  _ActualDropDraft get primaryDraft => drafts.first;
  List<_ActualDropDraft> get allocatedDrafts => drafts
      .where(
        (draft) =>
            _dropDraftHasItemSelection(draft) &&
            _hasActualDropItemValues(draft),
      )
      .toList(growable: false);

  bool containsDraftId(String? draftId) =>
      draftId != null && drafts.any((draft) => draft.id == draftId);
}

_ActualCargoDraft? _dropSelectedCargo(
  _ActualDropDraft draft,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final itemRefs = _normalizedDropItemRefs(draft);
  if (itemRefs.length != 1) return null;
  return _findCargoDraftByItemRef(cargoDrafts, itemRefs.first);
}

List<_ActualDropDraft> _dropGroupDraftsFor(
  _ActualDropDraft draft,
  List<_ActualDropDraft> drafts,
) {
  final selectedKey = _dropLocationGroupKey(draft);
  return drafts
      .where((entry) => _dropLocationGroupKey(entry) == selectedKey)
      .toList(growable: false);
}

String _dropLocationGroupKey(_ActualDropDraft draft) {
  final explicitGroupKey = draft.groupKey.trim();
  if (explicitGroupKey.isNotEmpty) return explicitGroupKey;
  String normalize(String value) => value.trim().toLowerCase();
  final locationName = normalize(draft.locationName);
  final locationAddress = normalize(draft.locationAddress);
  if (locationName.isEmpty && locationAddress.isEmpty) {
    return 'draft:${draft.id}';
  }
  return [
    _normalizeDropStopType(draft.stopType),
    locationName,
    locationAddress,
    normalize(draft.originLocationName),
    normalize(draft.originLocationAddress),
  ].join('|');
}

String _dropSelectorTitle(_DropUiGroup group, int index) {
  final draft = group.primaryDraft;
  final location = draft.locationName.trim();
  final title = location.isNotEmpty ? location : 'Titik Drop ${index + 1}';
  return '$title - ${group.allocatedDrafts.length} barang';
}

String _dropSelectorSubtitle(
  _DropUiGroup group,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final draft = group.primaryDraft;
  final metrics = <String>[];
  final labels = <String>[_dropStopTypeLabel(draft.stopType)];
  final allocatedDrafts = group.allocatedDrafts;
  final sjNumbers = allocatedDrafts
      .map((entry) => _dropSelectedCargo(entry, cargoDrafts))
      .whereType<_ActualCargoDraft>()
      .map((cargo) => cargo.shipperReferenceNumber.trim())
      .where((value) => value.isNotEmpty)
      .toSet();
  if (sjNumbers.isNotEmpty) {
    labels.add(
      sjNumbers.length == 1
          ? 'SJ ${sjNumbers.first}'
          : '${sjNumbers.length} SJ',
    );
  }
  final totals = _summarizeDropDrafts(allocatedDrafts);
  if (totals.qtyKoli > 0) {
    metrics.add('${formatMobileMetric(totals.qtyKoli)} koli');
  }
  if (totals.weightKg > 0) {
    metrics.add('${formatMobileMetric(totals.weightKg)} kg');
  }
  if (totals.volumeM3 > 0) {
    metrics.add('${formatMobileMetric(totals.volumeM3, fractionDigits: 3)} m3');
  }
  final address = draft.locationAddress.trim();
  final firstLine = [
    labels.join(' | '),
    if (metrics.isNotEmpty) metrics.join(' / '),
  ].join(' - ');
  if (address.isEmpty) return firstLine;
  return '$firstLine\n$address';
}

String _dropStopTypeLabel(String value) {
  return switch (_normalizeDropStopType(value)) {
    'HOLD' => 'Hold / Inap',
    'TRANSIT' => 'Transit',
    'RETURN' => 'Return',
    'EXTRA_DROP' => 'Extra Drop',
    _ => 'Drop',
  };
}

List<_DropCargoPickerGroup> _dropCargoPickerGroups(
  List<_ActualCargoDraft> drafts,
) {
  final groups = <String, List<_ActualCargoDraft>>{};
  for (final draft in drafts) {
    final key = _dropCargoPickerGroupKey(draft);
    groups.putIfAbsent(key, () => []).add(draft);
  }
  return groups.entries
      .map(
        (entry) => _DropCargoPickerGroup(
          key: entry.key,
          label: entry.value.first.shipperReferenceNumber.trim().isEmpty
              ? 'Tanpa SJ'
              : 'SJ ${entry.value.first.shipperReferenceNumber.trim()}',
          drafts: entry.value,
        ),
      )
      .toList(growable: false);
}

String _dropCargoPickerGroupKey(_ActualCargoDraft draft) {
  final key = draft.shipperReferenceKey.trim();
  if (key.isNotEmpty) return 'key:$key';
  final number = draft.shipperReferenceNumber.trim().toUpperCase();
  if (number.isNotEmpty) return 'number:$number';
  return 'unmatched';
}

class _DropCargoPickerGroup {
  const _DropCargoPickerGroup({
    required this.key,
    required this.label,
    required this.drafts,
  });

  final String key;
  final String label;
  final List<_ActualCargoDraft> drafts;
}

class _DropPointCargoAccordion extends StatelessWidget {
  const _DropPointCargoAccordion({
    required this.sourceDraftId,
    required this.cargoDrafts,
    required this.allDropDrafts,
    required this.allocationDrafts,
    this.title = 'Barang SJ di Titik Ini',
    this.buttonLabel = 'Tentukan Barang',
    this.modalTitle = 'Tentukan Barang',
    this.quantityLabel = 'Qty Drop',
    this.weightLabel = 'Berat Drop',
    this.volumeLabel = 'Volume Drop',
    this.showRemainingHelper = true,
    required this.onDetermine,
  });

  final String sourceDraftId;
  final List<_ActualCargoDraft> cargoDrafts;
  final List<_ActualDropDraft> allDropDrafts;
  final List<_ActualDropDraft> allocationDrafts;
  final String title;
  final String buttonLabel;
  final String modalTitle;
  final String quantityLabel;
  final String weightLabel;
  final String volumeLabel;
  final bool showRemainingHelper;
  final void Function(String draftId, List<_DropAllocationEditResult> results)
  onDetermine;

  @override
  Widget build(BuildContext context) {
    final groups = _dropCargoPickerGroups(cargoDrafts);
    if (groups.isEmpty) {
      return Text(
        'Belum ada barang SJ untuk dialokasikan.',
        style: TextStyle(
          color: Theme.of(
            context,
          ).colorScheme.onSurface.withValues(alpha: 0.62),
          fontSize: 12,
          height: 1.35,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurface,
            fontWeight: FontWeight.w700,
            fontSize: 12.5,
          ),
        ),
        const SizedBox(height: 8),
        ...groups.map(
          (group) => _DropPointCargoGroupTile(
            group: group,
            allDropDrafts: allDropDrafts,
            allocationDrafts: allocationDrafts,
            sourceDraftId: sourceDraftId,
            buttonLabel: buttonLabel,
            modalTitle: modalTitle,
            quantityLabel: quantityLabel,
            weightLabel: weightLabel,
            volumeLabel: volumeLabel,
            showRemainingHelper: showRemainingHelper,
            onDetermine: onDetermine,
          ),
        ),
      ],
    );
  }
}

class _DropPointCargoGroupTile extends StatelessWidget {
  const _DropPointCargoGroupTile({
    required this.group,
    required this.allDropDrafts,
    required this.allocationDrafts,
    required this.sourceDraftId,
    required this.buttonLabel,
    required this.modalTitle,
    required this.quantityLabel,
    required this.weightLabel,
    required this.volumeLabel,
    required this.showRemainingHelper,
    required this.onDetermine,
  });

  final _DropCargoPickerGroup group;
  final List<_ActualDropDraft> allDropDrafts;
  final List<_ActualDropDraft> allocationDrafts;
  final String sourceDraftId;
  final String buttonLabel;
  final String modalTitle;
  final String quantityLabel;
  final String weightLabel;
  final String volumeLabel;
  final bool showRemainingHelper;
  final void Function(String draftId, List<_DropAllocationEditResult> results)
  onDetermine;

  List<_ActualDropDraft> get displayAllocationDrafts =>
      allocationDrafts.isNotEmpty
      ? allocationDrafts
      : _implicitFirstDropAllocations(
          sourceDraftId,
          allDropDrafts,
          group.drafts,
        );

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ExpansionTile(
        initiallyExpanded: true,
        title: Text(group.label),
        subtitle: Text('${group.drafts.length} barang'),
        children: [
          ...group.drafts.map((draft) {
            final allocation = _allocationDraftForCargo(
              displayAllocationDrafts,
              draft.itemId,
            );
            final allocated =
                allocation != null && _hasActualDropItemValues(allocation);
            final description = draft.description.trim().isEmpty
                ? 'Barang'
                : draft.description;
            final remaining = _remainingDropValuesForCargoItem(
              draft,
              allDropDrafts.length == 1 && displayAllocationDrafts.isNotEmpty
                  ? displayAllocationDrafts
                  : allDropDrafts,
              excludeDraftId: '',
            );
            return ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              leading: Icon(
                allocated
                    ? Icons.check_circle_rounded
                    : Icons.inventory_2_outlined,
                color: allocated
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(
                        context,
                      ).colorScheme.onSurface.withValues(alpha: 0.48),
              ),
              title: Text(description),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    allocation == null
                        ? 'Akan dialokasikan: ${_formatDropDraftValues(remaining)}'
                        : 'Dialokasikan: ${_formatDropDraftValues(allocation)}',
                  ),
                  if (showRemainingHelper)
                    Text(
                      'Sisa : ${_formatRemainingKoli(remaining.qtyKoliValue)} koli',
                    ),
                ],
              ),
            );
          }),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => _openDetermineSheet(context),
                label: Text(buttonLabel),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openDetermineSheet(BuildContext context) async {
    FocusManager.instance.primaryFocus?.unfocus();
    final results = await showModalBottomSheet<List<_DropAllocationEditResult>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (context) => _DropPointCargoDetermineSheet(
        group: group,
        allocationDrafts: _allocationDraftsWithRemainingDefaults(
          allocationDrafts: displayAllocationDrafts,
          cargoDrafts: group.drafts,
          allDropDrafts:
              allDropDrafts.length == 1 && displayAllocationDrafts.isNotEmpty
              ? displayAllocationDrafts
              : allDropDrafts,
        ),
        title: modalTitle,
        quantityLabel: quantityLabel,
        weightLabel: weightLabel,
        volumeLabel: volumeLabel,
      ),
    );
    if (results != null && results.isNotEmpty) {
      onDetermine(sourceDraftId, results);
    }
  }
}

class _DropPointCargoDetermineSheet extends StatefulWidget {
  const _DropPointCargoDetermineSheet({
    required this.group,
    required this.allocationDrafts,
    required this.title,
    required this.quantityLabel,
    required this.weightLabel,
    required this.volumeLabel,
  });

  final _DropCargoPickerGroup group;
  final List<_ActualDropDraft> allocationDrafts;
  final String title;
  final String quantityLabel;
  final String weightLabel;
  final String volumeLabel;

  @override
  State<_DropPointCargoDetermineSheet> createState() =>
      _DropPointCargoDetermineSheetState();
}

class _DropPointCargoDetermineSheetState
    extends State<_DropPointCargoDetermineSheet> {
  late String _selectedItemId;
  late final Map<String, _DropAllocationValueDraft> _valueDraftByItemId;
  final Set<String> _editedItemIds = {};

  @override
  void initState() {
    super.initState();
    _selectedItemId = widget.group.drafts.first.itemId;
    _valueDraftByItemId = {
      for (final cargo in widget.group.drafts)
        cargo.itemId: _DropAllocationValueDraft.fromCargoAndAllocation(
          cargo,
          _allocationDraftForCargo(widget.allocationDrafts, cargo.itemId),
        ),
    };
  }

  _ActualCargoDraft get _selectedCargo => widget.group.drafts.firstWhere(
    (draft) => draft.itemId == _selectedItemId,
    orElse: () => widget.group.drafts.first,
  );

  _ActualDropDraft? get _selectedAllocation =>
      _allocationDraftForCargo(widget.allocationDrafts, _selectedCargo.itemId);

  _DropAllocationValueDraft get _selectedValueDraft =>
      _valueDraftByItemId[_selectedItemId] ??
      _DropAllocationValueDraft.fromCargoAndAllocation(
        _selectedCargo,
        _selectedAllocation,
      );

  void _selectItem(String itemId) {
    setState(() => _selectedItemId = itemId);
  }

  void _patchSelectedValue({
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    final current = _selectedValueDraft;
    final nextQtyKoli = qtyKoli ?? current.qtyKoli;
    final nextWeightUnit = weightInputUnit ?? current.weightInputUnit;
    final nextVolumeUnit = volumeInputUnit ?? current.volumeInputUnit;
    final autoWeightInputValue =
        weightInputValue == null && (qtyKoli != null || weightInputUnit != null)
        ? _autoWeightInputValueForQty(
            draft: _ActualDropDraft.create(
              deliveryOrderItemRef: _selectedCargo.itemId,
              deliveryOrderItemRefs: [_selectedCargo.itemId],
              shipperReferenceNumber: _selectedCargo.shipperReferenceNumber,
              shipperReferenceKey: _selectedCargo.shipperReferenceKey,
              qtyKoli: current.qtyKoli,
              weightInputValue: current.weightInputValue,
              weightInputUnit: current.weightInputUnit,
              volumeInputValue: current.volumeInputValue,
              volumeInputUnit: current.volumeInputUnit,
            ),
            cargo: _selectedCargo,
            nextQtyKoli: nextQtyKoli,
            nextWeightUnit: nextWeightUnit,
          )
        : null;
    final autoVolumeInputValue =
        volumeInputValue == null && (qtyKoli != null || volumeInputUnit != null)
        ? _autoVolumeInputValueForQty(
            draft: _ActualDropDraft.create(
              deliveryOrderItemRef: _selectedCargo.itemId,
              deliveryOrderItemRefs: [_selectedCargo.itemId],
              shipperReferenceNumber: _selectedCargo.shipperReferenceNumber,
              shipperReferenceKey: _selectedCargo.shipperReferenceKey,
              qtyKoli: current.qtyKoli,
              weightInputValue: current.weightInputValue,
              weightInputUnit: current.weightInputUnit,
              volumeInputValue: current.volumeInputValue,
              volumeInputUnit: current.volumeInputUnit,
            ),
            cargo: _selectedCargo,
            nextQtyKoli: nextQtyKoli,
            nextVolumeUnit: nextVolumeUnit,
          )
        : null;
    _valueDraftByItemId[_selectedItemId] = current.copyWith(
      qtyKoli: qtyKoli,
      weightInputValue: weightInputValue ?? autoWeightInputValue,
      weightInputUnit: weightInputUnit,
      volumeInputValue: volumeInputValue ?? autoVolumeInputValue,
      volumeInputUnit: volumeInputUnit,
    );
    _editedItemIds.add(_selectedItemId);
  }

  void _submit() {
    final itemIdsToSave = <String>{_selectedItemId, ..._editedItemIds};
    final results = <_DropAllocationEditResult>[];
    for (final itemId in itemIdsToSave) {
      final cargo = widget.group.drafts.firstWhere(
        (draft) => draft.itemId == itemId,
        orElse: () => widget.group.drafts.first,
      );
      final valueDraft =
          _valueDraftByItemId[itemId] ??
          _DropAllocationValueDraft.fromCargoAndAllocation(
            cargo,
            _allocationDraftForCargo(widget.allocationDrafts, itemId),
          );
      results.add(
        _DropAllocationEditResult(
          cargo: cargo,
          qtyKoli: valueDraft.qtyKoli,
          weightInputValue: valueDraft.weightInputValue,
          weightInputUnit: normalizeMobileWeightUnit(
            valueDraft.weightInputUnit,
          ),
          volumeInputValue: valueDraft.volumeInputValue,
          volumeInputUnit: normalizeMobileVolumeUnit(
            valueDraft.volumeInputUnit,
          ),
        ),
      );
    }
    Navigator.of(context).pop(results);
  }

  @override
  Widget build(BuildContext context) {
    final selectedCargo = _selectedCargo;
    final selectedAllocation = _selectedAllocation;
    final selectedValueDraft = _selectedValueDraft;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(
        heightFactor: 0.86,
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.title,
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.w800),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            widget.group.label,
                            style: TextStyle(
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurface.withValues(alpha: 0.62),
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Tutup',
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: ListView(
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _selectedItemId,
                        isExpanded: true,
                        decoration: const InputDecoration(
                          labelText: 'Barang SJ',
                        ),
                        items: widget.group.drafts
                            .map(
                              (draft) => DropdownMenuItem(
                                value: draft.itemId,
                                child: Text(
                                  draft.description.trim().isEmpty
                                      ? 'Barang'
                                      : draft.description,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(growable: false),
                        onChanged: (value) {
                          if (value != null) _selectItem(value);
                        },
                      ),
                      const SizedBox(height: 10),
                      Text(
                        selectedAllocation == null
                            ? 'Sisa aktual: ${_formatCargoDraftValues(selectedCargo)}'
                            : 'Saat ini: ${_formatDropDraftValues(selectedAllocation)}',
                        style: TextStyle(
                          color: Theme.of(
                            context,
                          ).colorScheme.onSurface.withValues(alpha: 0.68),
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 12),
                      _SyncedTextFormField(
                        value: selectedValueDraft.qtyKoli,
                        keyboardType: mobileNumberKeyboardType(2),
                        inputFormatters: mobileNumberInputFormatters(2),
                        decoration: InputDecoration(
                          labelText: widget.quantityLabel,
                        ),
                        onChanged: (value) =>
                            _patchSelectedValue(qtyKoli: value),
                      ),
                      const SizedBox(height: 12),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final fractionDigits =
                              mobileWeightInputFractionDigits(
                                selectedValueDraft.weightInputUnit,
                              );
                          final weightField = _SyncedTextFormField(
                            value: selectedValueDraft.weightInputValue,
                            keyboardType: mobileNumberKeyboardType(
                              fractionDigits,
                            ),
                            inputFormatters: mobileNumberInputFormatters(
                              fractionDigits,
                            ),
                            decoration: InputDecoration(
                              labelText: widget.weightLabel,
                            ),
                            onChanged: (value) =>
                                _patchSelectedValue(weightInputValue: value),
                          );
                          final unitField = MobileUnitSelectorField(
                            key: ValueKey(
                              'allocation-weight-unit-${selectedValueDraft.weightInputUnit}',
                            ),
                            value: normalizeMobileWeightUnit(
                              selectedValueDraft.weightInputUnit,
                            ),
                            options: const ['KG', 'TON'],
                            onChanged: (value) => setState(
                              () => _patchSelectedValue(weightInputUnit: value),
                            ),
                          );
                          if (constraints.maxWidth < 340) {
                            return Column(
                              children: [
                                weightField,
                                const SizedBox(height: 12),
                                unitField,
                              ],
                            );
                          }
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: weightField),
                              const SizedBox(width: 12),
                              SizedBox(width: 110, child: unitField),
                            ],
                          );
                        },
                      ),
                      const SizedBox(height: 12),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final fractionDigits =
                              mobileVolumeInputFractionDigits(
                                selectedValueDraft.volumeInputUnit,
                              );
                          final volumeField = _SyncedTextFormField(
                            value: selectedValueDraft.volumeInputValue,
                            keyboardType: mobileNumberKeyboardType(
                              fractionDigits,
                            ),
                            inputFormatters: mobileNumberInputFormatters(
                              fractionDigits,
                            ),
                            decoration: InputDecoration(
                              labelText: widget.volumeLabel,
                            ),
                            onChanged: (value) =>
                                _patchSelectedValue(volumeInputValue: value),
                          );
                          final unitField = MobileUnitSelectorField(
                            key: ValueKey(
                              'allocation-volume-unit-${selectedValueDraft.volumeInputUnit}',
                            ),
                            value: normalizeMobileVolumeUnit(
                              selectedValueDraft.volumeInputUnit,
                            ),
                            options: const ['M3', 'LITER', 'KL'],
                            onChanged: (value) => setState(
                              () => _patchSelectedValue(volumeInputUnit: value),
                            ),
                          );
                          if (constraints.maxWidth < 340) {
                            return Column(
                              children: [
                                volumeField,
                                const SizedBox(height: 12),
                                unitField,
                              ],
                            );
                          }
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: volumeField),
                              const SizedBox(width: 12),
                              SizedBox(width: 110, child: unitField),
                            ],
                          );
                        },
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _submit,
                    icon: const Icon(Icons.save_rounded),
                    label: const Text('Simpan Alokasi'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DropAllocationEditResult {
  const _DropAllocationEditResult({
    required this.cargo,
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
  });

  final _ActualCargoDraft cargo;
  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;
}

class _DropAllocationValueDraft {
  const _DropAllocationValueDraft({
    required this.qtyKoli,
    required this.weightInputValue,
    required this.weightInputUnit,
    required this.volumeInputValue,
    required this.volumeInputUnit,
  });

  final String qtyKoli;
  final String weightInputValue;
  final String weightInputUnit;
  final String volumeInputValue;
  final String volumeInputUnit;

  factory _DropAllocationValueDraft.fromCargoAndAllocation(
    _ActualCargoDraft cargo,
    _ActualDropDraft? allocation,
  ) {
    return _DropAllocationValueDraft(
      qtyKoli: allocation?.qtyKoli ?? cargo.dropQtyKoli,
      weightInputValue:
          allocation?.weightInputValue ?? cargo.dropWeightInputValue,
      weightInputUnit: allocation?.weightInputUnit ?? cargo.dropWeightInputUnit,
      volumeInputValue:
          allocation?.volumeInputValue ?? cargo.dropVolumeInputValue,
      volumeInputUnit: allocation?.volumeInputUnit ?? cargo.dropVolumeInputUnit,
    );
  }

  _DropAllocationValueDraft copyWith({
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
  }) {
    return _DropAllocationValueDraft(
      qtyKoli: qtyKoli ?? this.qtyKoli,
      weightInputValue: weightInputValue ?? this.weightInputValue,
      weightInputUnit: weightInputUnit ?? this.weightInputUnit,
      volumeInputValue: volumeInputValue ?? this.volumeInputValue,
      volumeInputUnit: volumeInputUnit ?? this.volumeInputUnit,
    );
  }
}

_ActualDropDraft? _allocationDraftForCargo(
  List<_ActualDropDraft> drafts,
  String itemId,
) {
  for (final draft in drafts) {
    if (_normalizedDropItemRefs(draft).contains(itemId)) return draft;
  }
  return null;
}

List<_ActualDropDraft> _allocationDraftsWithRemainingDefaults({
  required List<_ActualDropDraft> allocationDrafts,
  required List<_ActualCargoDraft> cargoDrafts,
  required List<_ActualDropDraft> allDropDrafts,
}) {
  final nextDrafts = [...allocationDrafts];
  for (final cargo in cargoDrafts) {
    if (_allocationDraftForCargo(nextDrafts, cargo.itemId) != null) continue;
    final remaining = _remainingDropValuesForCargoItem(
      cargo,
      allDropDrafts,
      excludeDraftId: '',
    );
    nextDrafts.add(
      remaining.copyWith(
        deliveryOrderItemRef: cargo.itemId,
        deliveryOrderItemRefs: [cargo.itemId],
        shipperReferenceKey: cargo.shipperReferenceKey,
        shipperReferenceNumber: cargo.shipperReferenceNumber,
      ),
    );
  }
  return nextDrafts;
}

List<_ActualDropDraft> _implicitFirstDropAllocations(
  String sourceDraftId,
  List<_ActualDropDraft> allDropDrafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  if (cargoDrafts.isEmpty || allDropDrafts.length != 1) return const [];
  final sourceDraft = allDropDrafts.first;
  if (sourceDraft.id != sourceDraftId ||
      _dropDraftHasItemSelection(sourceDraft) ||
      !_hasActualDropItemValues(sourceDraft)) {
    return const [];
  }
  return _expandGenericDropDraftToCargoAllocations(sourceDraft, cargoDrafts);
}

List<_ActualDropDraft> _orderDropDraftsByCargoSequence(
  List<_ActualDropDraft> drafts,
  List<_ActualCargoDraft> cargoDrafts,
) {
  final ordered = <_ActualDropDraft>[];
  final usedDraftIds = <String>{};
  for (final group in _dropCargoPickerGroups(cargoDrafts)) {
    for (final cargo in group.drafts) {
      final allocation = _allocationDraftForCargo(drafts, cargo.itemId);
      if (allocation == null || !usedDraftIds.add(allocation.id)) continue;
      ordered.add(allocation);
    }
  }
  for (final draft in drafts) {
    if (usedDraftIds.add(draft.id)) {
      ordered.add(draft);
    }
  }
  return ordered;
}

class _ActualDropCard extends StatelessWidget {
  const _ActualDropCard({
    super.key,
    required this.index,
    required this.draft,
    required this.customerRecipients,
    required this.cargoDrafts,
    required this.allDropDrafts,
    required this.dropGroupDrafts,
    required this.showRemove,
    required this.onChanged,
    required this.onAddCargoAllocation,
    required this.onRecipientChanged,
    required this.onRemove,
  });

  final int index;
  final _ActualDropDraft draft;
  final List<CustomerRecipientOption> customerRecipients;
  final List<_ActualCargoDraft> cargoDrafts;
  final List<_ActualDropDraft> allDropDrafts;
  final List<_ActualDropDraft> dropGroupDrafts;
  final bool showRemove;
  final void Function(
    String draftId, {
    String? stopType,
    String? deliveryOrderItemRef,
    List<String>? deliveryOrderItemRefs,
    String? shipperReferenceNumber,
    String? shipperReferenceKey,
    String? locationName,
    String? locationAddress,
    String? qtyKoli,
    String? weightInputValue,
    String? weightInputUnit,
    String? volumeInputValue,
    String? volumeInputUnit,
    String? note,
  })
  onChanged;
  final void Function(String draftId, List<_DropAllocationEditResult> results)
  onAddCargoAllocation;
  final void Function(String draftId, String recipientId) onRecipientChanged;
  final void Function(String draftId) onRemove;

  @override
  Widget build(BuildContext context) {
    final selectedRecipientValue = _resolveRecipientOptionValue(
      draft,
      customerRecipients,
    );
    final allocationDrafts = dropGroupDrafts
        .where(_dropDraftHasItemSelection)
        .toList(growable: false);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Titik Drop $index',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                if (showRemove)
                  IconButton(
                    onPressed: () => onRemove(draft.id),
                    icon: const Icon(Icons.delete_outline_rounded),
                    tooltip: 'Hapus titik',
                  ),
              ],
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _editableDriverDropStopType(draft.stopType),
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Tipe Titik'),
              items: _driverDropStopTypeItems,
              onChanged: (value) =>
                  onChanged(draft.id, stopType: value ?? 'DROP'),
            ),
            const SizedBox(height: 12),
            if (customerRecipients.isNotEmpty) ...[
              DropdownButtonFormField<String>(
                key: ValueKey(
                  'drop-recipient-${draft.id}-$selectedRecipientValue',
                ),
                initialValue: selectedRecipientValue,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Master Tujuan Customer',
                ),
                items: [
                  const DropdownMenuItem(value: '', child: Text('Isi manual')),
                  ...customerRecipients.map(
                    (recipient) => DropdownMenuItem(
                      value: recipient.id,
                      child: Text(
                        recipient.displayLabel,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
                onChanged: (value) => onRecipientChanged(draft.id, value ?? ''),
              ),
              const SizedBox(height: 12),
            ],
            _SyncedTextFormField(
              value: draft.locationName,
              decoration: const InputDecoration(labelText: 'Nama Lokasi'),
              onChanged: (value) => onChanged(draft.id, locationName: value),
            ),
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.locationAddress,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'Alamat Lokasi'),
              onChanged: (value) => onChanged(draft.id, locationAddress: value),
            ),
            const SizedBox(height: 12),
            _DropPointCargoAccordion(
              sourceDraftId: draft.id,
              cargoDrafts: cargoDrafts,
              allDropDrafts: allDropDrafts,
              allocationDrafts: allocationDrafts,
              onDetermine: onAddCargoAllocation,
            ),
            const SizedBox(height: 12),
            _DropPointAllocationSummary(
              drafts: allocationDrafts,
              cargoDrafts: cargoDrafts,
            ),
            const SizedBox(height: 12),
            _SyncedTextFormField(
              value: draft.note,
              minLines: 2,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Catatan Titik Drop',
              ),
              onChanged: (value) => onChanged(draft.id, note: value),
            ),
          ],
        ),
      ),
    );
  }
}

class _DropPointAllocationSummary extends StatelessWidget {
  const _DropPointAllocationSummary({
    required this.drafts,
    required this.cargoDrafts,
  });

  final List<_ActualDropDraft> drafts;
  final List<_ActualCargoDraft> cargoDrafts;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final allocatedDrafts = drafts
        .where(_hasActualDropItemValues)
        .toList(growable: false);
    final orderedDrafts = _orderDropDraftsByCargoSequence(
      allocatedDrafts,
      cargoDrafts,
    );
    if (orderedDrafts.isEmpty) {
      return Text(
        'Belum ada barang ditambahkan di titik ini.',
        style: TextStyle(
          color: scheme.onSurface.withValues(alpha: 0.62),
          fontSize: 12,
          height: 1.35,
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.38),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outline.withValues(alpha: 0.24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Alokasi Barang Titik Ini',
            style: TextStyle(
              color: scheme.onSurface,
              fontWeight: FontWeight.w700,
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 8),
          for (final entry in orderedDrafts.indexed) ...[
            if (entry.$1 > 0) const Divider(height: 14),
            _DropPointAllocationRow(
              draft: entry.$2,
              cargo: _dropSelectedCargo(entry.$2, cargoDrafts),
            ),
          ],
        ],
      ),
    );
  }
}

class _ReviewDropPointSummaryList extends StatelessWidget {
  const _ReviewDropPointSummaryList({
    required this.groups,
    required this.cargoDrafts,
  });

  final List<_DropUiGroup> groups;
  final List<_ActualCargoDraft> cargoDrafts;

  @override
  Widget build(BuildContext context) {
    if (groups.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Detail Titik Drop',
          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14),
        ),
        const SizedBox(height: 8),
        ...groups.indexed.map(
          (entry) => _ReviewDropPointSummaryCard(
            index: entry.$1,
            group: entry.$2,
            cargoDrafts: cargoDrafts,
          ),
        ),
      ],
    );
  }
}

class _ReviewDropPointSummaryCard extends StatelessWidget {
  const _ReviewDropPointSummaryCard({
    required this.index,
    required this.group,
    required this.cargoDrafts,
  });

  final int index;
  final _DropUiGroup group;
  final List<_ActualCargoDraft> cargoDrafts;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final draft = group.primaryDraft;
    final locationName = draft.locationName.trim();
    final locationAddress = draft.locationAddress.trim();
    final title = locationName.isEmpty
        ? 'Titik Drop ${index + 1}'
        : locationName;
    final allocatedDrafts = _orderDropDraftsByCargoSequence(
      group.allocatedDrafts,
      cargoDrafts,
    );
    final totals = _summarizeDropDrafts(allocatedDrafts);
    final totalDraft = _ActualDropDraft.create(
      qtyKoli: formatMobileMetric(totals.qtyKoli),
      weightInputValue: formatMobileMetric(totals.weightKg),
      weightInputUnit: 'KG',
      volumeInputValue: formatMobileMetric(totals.volumeM3, fractionDigits: 3),
      volumeInputUnit: 'M3',
    );

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.location_on_outlined, color: scheme.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        _dropStopTypeLabel(draft.stopType),
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.62),
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (locationAddress.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                locationAddress,
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.62),
                  fontSize: 12.5,
                  height: 1.35,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.38),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: scheme.outline.withValues(alpha: 0.20),
                ),
              ),
              child: Text(
                'Total: ${_formatDropDraftValues(totalDraft)}',
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.74),
                  fontSize: 12.5,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 10),
            if (allocatedDrafts.isEmpty)
              Text(
                'Belum ada barang dialokasikan.',
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.62),
                  fontSize: 12.5,
                ),
              )
            else
              for (final itemEntry in allocatedDrafts.indexed) ...[
                if (itemEntry.$1 > 0) const Divider(height: 14),
                _DropPointAllocationRow(
                  draft: itemEntry.$2,
                  cargo: _dropSelectedCargo(itemEntry.$2, cargoDrafts),
                ),
              ],
          ],
        ),
      ),
    );
  }
}

class _DropPointAllocationRow extends StatelessWidget {
  const _DropPointAllocationRow({required this.draft, required this.cargo});

  final _ActualDropDraft draft;
  final _ActualCargoDraft? cargo;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final resolvedCargo = cargo;
    final sjNumber =
        resolvedCargo == null ||
            resolvedCargo.shipperReferenceNumber.trim().isEmpty
        ? 'Tanpa SJ'
        : resolvedCargo.shipperReferenceNumber.trim();
    final description = resolvedCargo == null
        ? 'Barang belum dipilih'
        : resolvedCargo.description.trim().isEmpty
        ? 'Barang'
        : resolvedCargo.description;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Icon(
            Icons.inventory_2_outlined,
            color: scheme.onSurface.withValues(alpha: 0.46),
            size: 20,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  description,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 12.5,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '$sjNumber | ${_formatDropDraftValues(draft)}',
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.62),
                    fontSize: 11.5,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _formatDropDraftValues(_ActualDropDraft draft) {
  final parts = <String>[
    if (draft.qtyKoliValue > 0)
      '${formatMobileMetric(draft.qtyKoliValue)} koli',
    if (draft.weightInputValueNumber > 0)
      '${formatMobileMetric(draft.weightInputValueNumber, fractionDigits: mobileWeightInputFractionDigits(draft.weightInputUnit))} ${normalizeMobileWeightUnit(draft.weightInputUnit)}',
    if (draft.volumeInputValueNumber > 0)
      '${formatMobileMetric(draft.volumeInputValueNumber, fractionDigits: normalizeMobileVolumeUnit(draft.volumeInputUnit) == 'LITER' ? 0 : 3)} ${normalizeMobileVolumeUnit(draft.volumeInputUnit)}',
  ];
  if (parts.isEmpty && draft.qtyKoli.trim().isNotEmpty) {
    parts.add('0 koli');
  }
  if (parts.isEmpty && draft.weightInputValue.trim().isNotEmpty) {
    parts.add('0 ${normalizeMobileWeightUnit(draft.weightInputUnit)}');
  }
  if (parts.isEmpty && draft.volumeInputValue.trim().isNotEmpty) {
    parts.add('0 ${normalizeMobileVolumeUnit(draft.volumeInputUnit)}');
  }
  return parts.isEmpty ? 'Belum diisi' : parts.join(' / ');
}

String _formatRemainingKoli(double value) {
  if (value <= 0) {
    return '0';
  }
  final formatted = formatMobileMetric(value);
  return formatted.trim().isEmpty ? '0' : formatted;
}

class _SyncedTextFormField extends StatefulWidget {
  const _SyncedTextFormField({
    required this.value,
    required this.decoration,
    required this.onChanged,
    this.keyboardType,
    this.inputFormatters,
    this.minLines,
    this.maxLines = 1,
    this.enabled = true,
  });

  final String value;
  final InputDecoration decoration;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final int? minLines;
  final int? maxLines;
  final bool enabled;

  @override
  State<_SyncedTextFormField> createState() => _SyncedTextFormFieldState();
}

class _SyncedTextFormFieldState extends State<_SyncedTextFormField> {
  late final TextEditingController _controller;
  String? _pendingControllerValue;
  bool _controllerSyncScheduled = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(covariant _SyncedTextFormField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value == _controller.text) return;

    _pendingControllerValue = widget.value;
    if (_controllerSyncScheduled) return;

    _controllerSyncScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _controllerSyncScheduled = false;
      if (!mounted) return;
      final nextValue = _pendingControllerValue;
      _pendingControllerValue = null;
      if (nextValue == null || nextValue != widget.value) return;
      if (nextValue == _controller.text) return;

      _controller.value = TextEditingValue(
        text: nextValue,
        selection: TextSelection.collapsed(offset: nextValue.length),
      );
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: _controller,
      keyboardType: widget.keyboardType,
      inputFormatters: widget.inputFormatters,
      minLines: widget.minLines,
      maxLines: widget.maxLines,
      decoration: widget.decoration,
      enabled: widget.enabled,
      scrollPadding: mobileInputScrollPadding,
      onChanged: widget.onChanged,
    );
  }
}

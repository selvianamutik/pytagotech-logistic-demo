'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useApp, useToast } from '../layout';
import { CheckCircle, Printer, FileDown, Truck, Save, MapPin, Radio, Edit, Wallet, Plus, Trash2, X, ChevronDown } from 'lucide-react';
import CollapsibleCard from '@/components/CollapsibleCard';
import AuditTrailCard from './AuditTrailCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import SplitDecimalNumberInput from '@/components/SplitDecimalNumberInput';
import { formatFormattedNumberValue, parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData, fetchOptionalAdminCollectionData, fetchOptionalAdminData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    buildDeliveryOrderDetailState,
    buildDeliveryOrderPrintHtml,
    buildActualCargoDrafts,
    buildTripResourceBusyIds,
    buildDeliveryOrderTripFeeUpdateData,
    buildResolvedDeliveryOrder,
    buildDefaultActualDropDrafts,
    createEmptyActualDropDraft,
    applyActualCargoAutoWeightFromQty,
    applyActualDropAutoWeightFromQty,
    shouldLockActualCargoVolume,
    getAssignableTripDrivers,
    getAssignableTripVehicles,
    getNextDeliveryOrderStatuses,
    getTripResourceActionLabel,
    shouldRequireTripVehicleOverrideReason,
    shouldOpenAdvancedDropEditor,
    sortTrackingLogs,
    updateActualCargoDraftVolumeUnit,
    updateActualDropDraftVolumeUnit,
    updateActualDropDraftWeightUnit,
    type ActualCargoDraft,
    type ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
import {
    deriveDeliveryOrderCompletionOutcome,
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderDisplayStatusMeta,
    getDeliveryOrderHoldCargoSummary,
    isDeliveryOrderBillableDropType,
    isDeliveryOrderHoldDropType,
    isDeliveryOrderReturnDropType,
} from '@/lib/delivery-order-completion';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import {
    DO_ACTUAL_DROP_TYPE_MAP,
    DO_STATUS_MAP,
    formatCurrency,
    formatDate,
    formatDateTime,
    formatInternalDeliveryOrderNumber,
    formatQuantity,
    formatShipperDeliveryOrderNumber,
    getDriverVoucherFinancialSummary,
} from '@/lib/utils';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    formatCargoSummary,
    getWeightInputFractionDigits,
    VOLUME_INPUT_UNIT_OPTIONS,
    type WeightInputUnit,
    WEIGHT_INPUT_UNIT_OPTIONS,
} from '@/lib/measurement';
import {
    ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR,
    buildActualDropItemValueKey,
    buildDriverReviewActualDropHydration,
    formatActualDropDraftNumber,
    formatItemCodeNameLabel,
    hasCargoSummaryValue,
    hasActualDropItemInput,
    hasActualDropItemValues,
    hasDeliveryOrderItemActualCargo,
    parseActualDropItemValueKey,
    pickActualDropItemValues,
    subtractCargoSummary,
    summarizeActualCargoDraftAsCargoSummary,
    summarizeActualDropItemValues,
    type ActualCargoItemValueDraft,
    type ActualDropItemValueDraft,
} from '@/lib/trip-detail-actual-drop-admin-support';
import {
    buildResolvedShipperReferenceEntries,
    matchesShipperReferenceDraft,
    type ExistingShipperReferenceItemDraft,
    type ResolvedShipperReferenceEntry,
    type ShipperReferenceDraft,
} from '@/lib/trip-detail-shipping-reference-support';
import {
    createDefaultCancelTripExpenseForm,
    getDefaultCancelExpenseCategoryRef,
    isOperationalCancelExpenseCategory,
    type CancelTripExpenseFormState,
} from '@/lib/cancel-trip-expense-support';
import {
    createDefaultDeliveryOrderCargoDraftItem,
    createDefaultDeliveryOrderCargoDraftGroup,
    flattenDeliveryOrderCargoDraftGroups,
    getDraftDeliveryOrderCargoGroups,
    getDeliveryOrderCargoDraftItems,
    toDeliveryOrderCargoDraftItem,
    type DeliveryOrderCargoDraftGroup,
    type DeliveryOrderCargoDraftItem,
} from '@/lib/delivery-order-cargo-draft-support';
import {
    createDefaultDriverVoucherItemForm,
    createDefaultDriverVoucherTopUpForm,
    DRIVER_VOUCHER_EXPENSE_CATEGORIES,
    buildDriverVoucherCashBreakdown,
    buildDriverVoucherSettlementDisplay,
    inferDriverVoucherDisbursementCount,
    sortDriverVoucherDisbursements,
} from '@/lib/driver-voucher-detail-support';
import { applyCustomerProductToOrderItem, applyOrderItemAutoWeightFromQty, shouldLockOrderItemVolume, shouldLockOrderItemWeight, summarizeDraftOrderCargo, updateOrderItemVolumeUnit, updateOrderItemWeightUnit } from '@/lib/order-create-page-support';
import { generateDOPdf } from '@/lib/pdf/doTemplate';
import { hasPageAccess, hasPermission, normalizeUserRole } from '@/lib/rbac';
import { buildTripRateAreaOptions, findMatchingTripRouteRate, formatTripRouteRateLabel } from '@/lib/trip-route-rate-support';
import { roundToPrecision } from '@/lib/number-precision';
import type { SuratJalanDocument, Trip, TripCashLinkSummary, TripDetailReferencesSnapshot, TripDetailSnapshot, TripTrackingEvent } from '@/lib/trip-document-types';
import type { BankAccount, Customer, CustomerProduct, CustomerRecipient, DeliveryOrder, DeliveryOrderItem, CompanyProfile, FreightNota, FreightNotaItem, Order, OrderItem, Driver, DriverVoucher, DriverVoucherDisbursement, ExpenseCategory, PendingDriverStatusRequest, Service, TireEvent, TripRouteRate, Vehicle } from '@/lib/types';

const BATCH_SURAT_JALAN_STATUS_OPTIONS = ['ON_DELIVERY', 'ARRIVED', 'DELIVERED'] as const;

type TripCashIssueFormState = {
    vehicleRef: string;
    driverRef: string;
    vehicleCategoryOverrideReason: string;
    tripOriginArea: string;
    tripDestinationArea: string;
    tripRouteRateRef: string;
    taripBorongan: number;
    keteranganBorongan: string;
    issueBankRef: string;
    cashGiven: number;
    issuedDate: string;
    notes: string;
};

type ActualCargoStepBlockMessage = {
    kind: 'setup' | 'drop' | 'allocation';
    title: string;
    detail?: string;
    target?: string;
    allocated?: string;
};

function createDefaultTripCashIssueForm(): TripCashIssueFormState {
    return {
        vehicleRef: '',
        driverRef: '',
        vehicleCategoryOverrideReason: '',
        tripOriginArea: '',
        tripDestinationArea: '',
        tripRouteRateRef: '',
        taripBorongan: 0,
        keteranganBorongan: '',
        issueBankRef: '',
        cashGiven: 0,
        issuedDate: getBusinessDateValue(),
        notes: '',
    };
}

export default function TripDetailPage() {
    const params = useParams();
    const pathname = usePathname();
    const { addToast } = useToast();
    const { user } = useApp();
    const doId = params.id as string;
    const [tripData, setTripData] = useState<Trip | null>(null);
    const [doData, setDoData] = useState<DeliveryOrder | null>(null);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [tripFreightNotaItems, setTripFreightNotaItems] = useState<FreightNotaItem[]>([]);
    const [tripFreightNotas, setTripFreightNotas] = useState<FreightNota[]>([]);
    const [suratJalanDocuments, setSuratJalanDocuments] = useState<SuratJalanDocument[]>([]);
    const [trackingLogs, setTrackingLogs] = useState<TripTrackingEvent[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [billingCustomers, setBillingCustomers] = useState<Array<Pick<Customer, '_id' | 'name' | 'active'>>>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [activeTrips, setActiveTrips] = useState<Trip[]>([]);
    const [activeOrders, setActiveOrders] = useState<Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [showRejectRequestModal, setShowRejectRequestModal] = useState(false);
    const [showTripResourcesModal, setShowTripResourcesModal] = useState(false);
    const [showShipperReferenceModal, setShowShipperReferenceModal] = useState(false);
    const [showCargoModal, setShowCargoModal] = useState(false);
    const [showTripCashIssueModal, setShowTripCashIssueModal] = useState(false);
    const [showTripCashTopUpModal, setShowTripCashTopUpModal] = useState(false);
    const [showTripCashExpenseModal, setShowTripCashExpenseModal] = useState(false);
    const [showTripCashSettleModal, setShowTripCashSettleModal] = useState(false);
    const [showCancelTripModal, setShowCancelTripModal] = useState(false);
    const [showActualCargoFinalizationModal, setShowActualCargoFinalizationModal] = useState(false);
    const [actualCargoStepBlockMessages, setActualCargoStepBlockMessages] = useState<ActualCargoStepBlockMessage[]>([]);
    const [showSuratJalanActualEditModal, setShowSuratJalanActualEditModal] = useState(false);
    const [manualOvertonaseReviewMode, setManualOvertonaseReviewMode] = useState<'manual' | 'automatic' | null>(null);
    const [selectedSuratJalanActualEditDocument, setSelectedSuratJalanActualEditDocument] = useState<SuratJalanDocument | null>(null);
    const [selectedSuratJalanActualEditItemRef, setSelectedSuratJalanActualEditItemRef] = useState('');
    const statusModalBodyRef = useRef<HTMLDivElement | null>(null);
    const actualCargoModalBodyRef = useRef<HTMLDivElement | null>(null);
    const statusModalScrollTopRef = useRef(0);
    const actualCargoModalScrollTopRef = useRef(0);
    const shouldRestoreStatusModalScrollRef = useRef(false);
    const shouldRestoreActualCargoModalScrollRef = useRef(false);
    const [activeFinalizationCargoItemRef, setActiveFinalizationCargoItemRef] = useState('');
    const [activeFinalizationDropKey, setActiveFinalizationDropKey] = useState('');
    const [activeFinalizationReviewDropKey, setActiveFinalizationReviewDropKey] = useState('');
    const [actualCargoModalReturnTarget, setActualCargoModalReturnTarget] = useState<'status' | 'review'>('status');
    const [newStatus, setNewStatus] = useState('');
    const [selectedStatusSuratJalanRefs, setSelectedStatusSuratJalanRefs] = useState<string[]>([]);
    const [statusNote, setStatusNote] = useState('');
    const [cancelTripNote, setCancelTripNote] = useState('');
    const [reviewingDriverRequest, setReviewingDriverRequest] = useState(false);
    const [reviewingDriverRequestId, setReviewingDriverRequestId] = useState('');
    const [rejectRequestNote, setRejectRequestNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(getBusinessDateValue());
    const [podNote, setPodNote] = useState('');
    const [suratJalanStatusFilter, setSuratJalanStatusFilter] = useState('');
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [actualCargoItemValueMap, setActualCargoItemValueMap] = useState<Record<string, ActualCargoItemValueDraft>>({});
    const [actualDropPoints, setActualDropPoints] = useState<ActualDropDraft[]>([]);
    const [actualDropItemValueMap, setActualDropItemValueMap] = useState<Record<string, ActualDropItemValueDraft>>({});
    const [actualDropEditSnapshot, setActualDropEditSnapshot] = useState<{
        points: ActualDropDraft[];
        itemValueMap: Record<string, ActualDropItemValueDraft>;
    } | null>(null);
    const [actualCargoSetupSnapshot, setActualCargoSetupSnapshot] = useState<ActualCargoDraft[]>([]);
    const [suratJalanActualEditItems, setSuratJalanActualEditItems] = useState<ActualCargoDraft[]>([]);
    const [suratJalanActualEditDropPoints, setSuratJalanActualEditDropPoints] = useState<ActualDropDraft[]>([]);
    const [partialHoldContinuationItemRefs, setPartialHoldContinuationItemRefs] = useState<string[]>([]);
    const [showAdvancedDropEditor, setShowAdvancedDropEditor] = useState(false);
    const [editingTarip, setEditingTarip] = useState(false);
    const [taripBorongan, setTaripBorongan] = useState<number>(0);
    const [keteranganBorongan, setKeteranganBorongan] = useState('');
    const [manualOvertonaseWeightInputValue, setManualOvertonaseWeightInputValue] = useState(0);
    const [manualOvertonaseWeightInputUnit, setManualOvertonaseWeightInputUnit] = useState<WeightInputUnit>('KG');
    const [tripRouteRates, setTripRouteRates] = useState<TripRouteRate[]>([]);
    const [tripRouteRateRef, setTripRouteRateRef] = useState('');
    const [tripOriginArea, setTripOriginArea] = useState('');
    const [tripDestinationArea, setTripDestinationArea] = useState('');
    const [linkedVoucher, setLinkedVoucher] = useState<DriverVoucher | null>(null);
    const [linkedVoucherDisbursements, setLinkedVoucherDisbursements] = useState<DriverVoucherDisbursement[]>([]);
    const [linkedTripCashLink, setLinkedTripCashLink] = useState<TripCashLinkSummary | null>(null);
    const [linkedVoucherBonNumber, setLinkedVoucherBonNumber] = useState('');
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [savingTarip, setSavingTarip] = useState(false);
    const [savingManualOvertonase, setSavingManualOvertonase] = useState(false);
    const [loadingTripCashOptions, setLoadingTripCashOptions] = useState(false);
    const [issuingTripCash, setIssuingTripCash] = useState(false);
    const [toppingUpTripCash, setToppingUpTripCash] = useState(false);
    const [savingTripCashExpense, setSavingTripCashExpense] = useState(false);
    const [settlingTripCash, setSettlingTripCash] = useState(false);
    const [cancellingTrip, setCancellingTrip] = useState(false);
    const [rejectingRequest, setRejectingRequest] = useState(false);
    const [loadingTripResources, setLoadingTripResources] = useState(false);
    const [savingTripResources, setSavingTripResources] = useState(false);
    const [savingShipperReference, setSavingShipperReference] = useState(false);
    const [savingCargo, setSavingCargo] = useState(false);
    const [savingSuratJalanActualEdit, setSavingSuratJalanActualEdit] = useState(false);
    const [togglingTripClosure, setTogglingTripClosure] = useState(false);
    const [pendingTripClosure, setPendingTripClosure] = useState<boolean | null>(null);
    const [tripClosureOdometer, setTripClosureOdometer] = useState(0);
    const [tripClosureTires, setTripClosureTires] = useState<TireEvent[]>([]);
    const [loadingTripClosureTires, setLoadingTripClosureTires] = useState(false);
    const [removingCargoItemId, setRemovingCargoItemId] = useState<string | null>(null);
    const [deletingShipperReferenceKey, setDeletingShipperReferenceKey] = useState<string | null>(null);
    const [pendingDeleteAction, setPendingDeleteAction] = useState<
        | { type: 'cargo-item'; deliveryOrderItemId: string; itemLabel: string }
        | { type: 'shipper-reference'; reference: ResolvedShipperReferenceEntry; itemCount: number; deleteLocked: boolean; lockReason?: string }
        | null
    >(null);
    const [editingCargoItemId, setEditingCargoItemId] = useState<string | null>(null);
    const [editableCargoItemMap, setEditableCargoItemMap] = useState<Record<string, boolean>>({});
    const [linkedOrderItemDetailMap, setLinkedOrderItemDetailMap] = useState<Record<string, Pick<OrderItem, '_id' | 'entrySource' | 'sourceDeliveryOrderRef' | 'customerProductRef' | 'customerProductCode' | 'customerProductName'> | undefined>>({});
    const [tripVehicleRef, setTripVehicleRef] = useState('');
    const [tripDriverRef, setTripDriverRef] = useState('');
    const [tripVehicleOverrideReason, setTripVehicleOverrideReason] = useState('');
    const [shipperReferenceDrafts, setShipperReferenceDrafts] = useState<ShipperReferenceDraft[]>([{
        draftKey: crypto.randomUUID(),
        referenceKey: '',
        referenceNumber: '',
        date: getBusinessDateValue(),
        pickupStopKey: '',
        pickupAddress: '',
        selectedRecipientId: '',
        billingCustomerRef: '',
        billingCustomerName: '',
        receiverName: '',
        receiverPhone: '',
        receiverAddress: '',
        receiverCompany: '',
    }]);
    const [shipperReferenceModalMode, setShipperReferenceModalMode] = useState<'edit' | 'create'>('edit');
    const [selectedShipperReferenceDraftKey, setSelectedShipperReferenceDraftKey] = useState('');
    const [shipperReferenceItemDraftMap, setShipperReferenceItemDraftMap] = useState<Record<string, DeliveryOrderCargoDraftItem[]>>({});
    const [shipperReferenceExistingItemDraftMap, setShipperReferenceExistingItemDraftMap] = useState<Record<string, ExistingShipperReferenceItemDraft[]>>({});
    const [deletedShipperReferenceItemIds, setDeletedShipperReferenceItemIds] = useState<string[]>([]);
    const [shipperReferenceFormat, setShipperReferenceFormat] = useState('SJ');
    const [cargoDraftGroups, setCargoDraftGroups] = useState<DeliveryOrderCargoDraftGroup[]>([createDefaultDeliveryOrderCargoDraftGroup()]);
    const [tripCashIssueForm, setTripCashIssueForm] = useState<TripCashIssueFormState>(createDefaultTripCashIssueForm);
    const [tripCashTopUpForm, setTripCashTopUpForm] = useState(createDefaultDriverVoucherTopUpForm);
    const [tripCashExpenseForm, setTripCashExpenseForm] = useState(createDefaultDriverVoucherItemForm);
    const [cancelTripExpenseForm, setCancelTripExpenseForm] = useState<CancelTripExpenseFormState>(createDefaultCancelTripExpenseForm);
    const [tripCashSettlementDate, setTripCashSettlementDate] = useState(getBusinessDateValue());
    const [tripCashSettlementBankRef, setTripCashSettlementBankRef] = useState('');
    const editingTaripRef = useRef(false);
    const driverReviewDropEditedRef = useRef(false);
    const loadedReferenceCustomerRef = useRef<string>('');
    const normalizedRole = user ? normalizeUserRole(user.role) : null;
    const canManageDeliveryStatus = user ? hasPermission(user, 'deliveryOrders', 'update') : false;
    const canExportDeliveryOrder = user ? hasPermission(user, 'deliveryOrders', 'export') : false;
    const canPrintDeliveryOrder = user ? hasPermission(user, 'deliveryOrders', 'print') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user, 'customers') : false;
    const canOpenSourceOrderPage = user ? hasPageAccess(user, 'orders') : false;
    const canOpenDriverPage = user ? hasPageAccess(user, 'drivers') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user, 'vehicles') : false;
    const canViewTripCash = user ? hasPermission(user, 'driverVouchers', 'view') : false;
    const canCreateTripCash = user ? hasPermission(user, 'driverVouchers', 'create') : false;
    const canOpenTripCashPage = user ? hasPageAccess(user, 'driverVouchers') : false;
    const canAssignTripResources = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'ARMADA';
    const canEditShipperReference = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'FINANCE';
    const canEditDeliveryCargo = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL' || normalizedRole === 'ARMADA';
    const canReviewDriverRequest = canManageDeliveryStatus;
    const canManageTripFee = canManageDeliveryStatus;
    const canManageTripCashCosts = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL';
    const canSettleTripCash = normalizedRole === 'OWNER' || normalizedRole === 'FINANCE';
    const currentPath = pathname || `/delivery-orders/${doId}`;
    const withReturnTo = (href: string) => `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(currentPath)}`;
    const hasOpenModal =
        showStatusModal ||
        showRejectRequestModal ||
        showTripResourcesModal ||
        showShipperReferenceModal ||
        showCargoModal ||
        showTripCashIssueModal ||
        showTripCashTopUpModal ||
        showTripCashExpenseModal ||
        showTripCashSettleModal ||
        showCancelTripModal ||
        showActualCargoFinalizationModal ||
        actualCargoStepBlockMessages.length > 0 ||
        showSuratJalanActualEditModal ||
        manualOvertonaseReviewMode !== null ||
        pendingTripClosure !== null;
    const tripOriginAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'originArea', {
        serviceRef: doData?.serviceRef,
    });
    const tripDestinationAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
        originArea: tripOriginArea,
        serviceRef: doData?.serviceRef,
    });
    const matchedTripRouteRate = findMatchingTripRouteRate(tripRouteRates, {
        originArea: tripOriginArea,
        destinationArea: tripDestinationArea,
        serviceRef: doData?.serviceRef,
    });
    const isTripFeeLockedToMaster = Boolean(matchedTripRouteRate);

    const applyTripRouteSelection = (nextOriginArea: string, nextDestinationArea: string) => {
        setTripOriginArea(nextOriginArea);
        setTripDestinationArea(nextDestinationArea);

        const nextMatchedRate = findMatchingTripRouteRate(tripRouteRates, {
            originArea: nextOriginArea,
            destinationArea: nextDestinationArea,
            serviceRef: doData?.serviceRef,
        });
        setTripRouteRateRef(nextMatchedRate?._id || '');
        if (nextMatchedRate) {
            setTaripBorongan(nextMatchedRate.rate || 0);
        } else {
            setTaripBorongan(0);
        }
    };

    const handleTripOriginAreaChange = (nextOriginArea: string) => {
        const nextDestinationOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
            originArea: nextOriginArea,
            serviceRef: doData?.serviceRef,
        });
        const preservedDestination =
            nextOriginArea && nextDestinationOptions.includes(tripDestinationArea)
                ? tripDestinationArea
                : '';
        applyTripRouteSelection(nextOriginArea, preservedDestination);
    };

    const handleTripDestinationAreaChange = (nextDestinationArea: string) => {
        applyTripRouteSelection(tripOriginArea, nextDestinationArea);
    };

    useEffect(() => {
        editingTaripRef.current = editingTarip;
    }, [editingTarip]);

    useEffect(() => {
        if (!hasOpenModal) {
            return;
        }

        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
        };
    }, [hasOpenModal]);

    useEffect(() => {
        if (!showStatusModal || !reviewingDriverRequest || newStatus !== 'DELIVERED') {
            return;
        }
        if (driverReviewDropEditedRef.current) {
            return;
        }
        if (!doData) {
            return;
        }
        const requestActualDropPoints = reviewingDriverRequestId
            ? (doData.pendingDriverRequests || []).find(request => request.requestId === reviewingDriverRequestId)?.actualDropPoints
            : undefined;
        const sourceActualDropPoints = requestActualDropPoints || doData.pendingDriverActualDropPoints || [];
        if (!sourceActualDropPoints.length) {
            return;
        }

        const hydratedDropState = buildDriverReviewActualDropHydration(sourceActualDropPoints, actualCargoItems);
        const syncedDropDrafts = hydratedDropState.groupedDrafts.length > 0
            ? hydratedDropState.groupedDrafts
            : buildDefaultActualDropDrafts(
                doData,
                actualCargoItems,
                sourceActualDropPoints
            );
        const shouldUseAdvancedDropEditor = shouldOpenAdvancedDropEditor(doData, syncedDropDrafts);
        const nextSyncedDropDrafts = syncedDropDrafts;

        setActualDropPoints(current => {
            if (current.length === nextSyncedDropDrafts.length) {
                const isSame = current.every((item, index) => {
                    const nextItem = nextSyncedDropDrafts[index];
                    return nextItem
                        && item.stopType === nextItem.stopType
                        && item.locationName === nextItem.locationName
                        && item.locationAddress === nextItem.locationAddress
                        && item.qtyKoli === nextItem.qtyKoli
                        && item.weightInputValue === nextItem.weightInputValue
                        && item.weightInputUnit === nextItem.weightInputUnit
                        && item.volumeInputValue === nextItem.volumeInputValue
                        && item.volumeInputUnit === nextItem.volumeInputUnit
                        && item.note === nextItem.note;
                });
                if (isSame) {
                    return current;
                }
            }
            return nextSyncedDropDrafts;
        });
        setActualDropItemValueMap(hydratedDropState.itemValueMap);
        setShowAdvancedDropEditor(shouldUseAdvancedDropEditor);
    }, [
        actualCargoItems,
        doData,
        newStatus,
        reviewingDriverRequest,
        reviewingDriverRequestId,
        showStatusModal,
    ]);

    const hydrateDeliveryOrderItemsState = useCallback(async (deliveryOrderItems: DeliveryOrderItem[]) => {
        const linkedOrderItemRefs = Array.from(
            new Set(
                deliveryOrderItems
                    .map(item => item.orderItemRef)
                    .filter((value): value is string => Boolean(value))
            )
        );
        const linkedOrderItems = linkedOrderItemRefs.length > 0
            ? await fetchOptionalAdminCollectionData<Pick<OrderItem, '_id' | 'entrySource' | 'sourceDeliveryOrderRef' | 'customerProductRef' | 'customerProductCode' | 'customerProductName'>>(
                `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ _id: linkedOrderItemRefs }))}`,
                'Gagal memuat detail trip',
                undefined,
                { onError: (message) => addToast('error', message), silentAccessDenied: true }
            )
            : [];
        const linkedOrderItemMap = new Map(
            (linkedOrderItems || []).map(item => [item._id, item])
        );
        const nextEditableCargoItemMap = deliveryOrderItems.reduce<Record<string, boolean>>((acc, item) => {
            const linkedOrderItem = linkedOrderItemMap.get(item.orderItemRef);
            acc[item._id] = Boolean(
                linkedOrderItem?.entrySource === 'DELIVERY_ORDER' &&
                linkedOrderItem.sourceDeliveryOrderRef === doId
            );
            return acc;
        }, {});

        setDoItems(deliveryOrderItems);
        setEditableCargoItemMap(nextEditableCargoItemMap);
        setLinkedOrderItemDetailMap(
            (linkedOrderItems || []).reduce<Record<string, Pick<OrderItem, '_id' | 'entrySource' | 'sourceDeliveryOrderRef' | 'customerProductRef' | 'customerProductCode' | 'customerProductName'> | undefined>>((acc, item) => {
                acc[item._id] = item;
                return acc;
            }, {})
        );
    }, [addToast, doId]);

    const loadDOReferences = useCallback(async (deliveryOrder: DeliveryOrder | null) => {
        if (!deliveryOrder?._id) {
            setBillingCustomers([]);
            setCustomerProducts([]);
            setCustomerRecipients([]);
            setShipperReferenceFormat('SJ');
            setTripRouteRates([]);
            loadedReferenceCustomerRef.current = '';
            return;
        }

        const snapshot = await fetchOptionalAdminData<TripDetailReferencesSnapshot | null>(
            `/api/data?entity=trip-detail-references&id=${deliveryOrder._id}`,
            'Gagal memuat referensi trip',
            { onError: (message) => addToast('error', message), silentAccessDenied: true }
        );

        setBillingCustomers(snapshot?.billingCustomers || []);
        setCustomerProducts(snapshot?.customerProducts || []);
        setCustomerRecipients(snapshot?.customerRecipients || []);
        setShipperReferenceFormat((snapshot?.customerData?.deliveryOrderPrefix || 'SJ').toUpperCase());
        setTripRouteRates(snapshot?.tripRouteRates || []);
        loadedReferenceCustomerRef.current = deliveryOrder?.customerRef || '';
    }, [addToast]);

    const applyTripDetailSnapshot = useCallback(async (tripDetail: TripDetailSnapshot | null) => {
        const trip = tripDetail?.trip || null;
        const deliveryOrder = tripDetail?.deliveryOrder || null;
        const sourceOrder = tripDetail?.sourceOrder || null;
        const deliveryOrderItems = tripDetail?.deliveryOrderItems || [];
        const trackingEvents = tripDetail?.trackingEvents || [];
        const resolvedDeliveryOrder = buildResolvedDeliveryOrder(deliveryOrder, sourceOrder);

        setTripData(trip);
        setDoData(resolvedDeliveryOrder);
        setSuratJalanDocuments(tripDetail?.suratJalanDocuments || []);
        const activeInvoiceItems = resolvedDeliveryOrder?._id
            ? await fetchAdminCollectionData<FreightNotaItem[]>(
                `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: resolvedDeliveryOrder._id }))}`,
                'Gagal memuat invoice trip'
            ).catch(() => [] as FreightNotaItem[])
            : [];
        const filteredActiveInvoiceItems = (activeInvoiceItems || []).filter(item => item.status !== 'VOID');
        const activeInvoiceIds = [...new Set(filteredActiveInvoiceItems.map(item => item.notaRef).filter(Boolean))];
        const activeInvoiceHeaders = activeInvoiceIds.length > 0
            ? await fetchAdminCollectionData<FreightNota[]>(
                `/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: activeInvoiceIds }))}`,
                'Gagal memuat nomor invoice trip'
            ).catch(() => [] as FreightNota[])
            : [];
        setTripFreightNotaItems(filteredActiveInvoiceItems);
        setTripFreightNotas((activeInvoiceHeaders || []).filter(item => item.status !== 'VOID'));
        setLinkedVoucher(tripDetail?.linkedVoucher || null);
        setLinkedTripCashLink(tripDetail?.tripCashLink || null);
        setLinkedVoucherBonNumber(tripDetail?.linkedVoucher?.bonNumber || tripDetail?.tripCashLink?.bonNumber || '');
        if (tripDetail?.linkedVoucher?._id) {
            const disbursementRows = await fetchAllAdminCollectionData<DriverVoucherDisbursement>(
                `/api/data?entity=driver-voucher-disbursements&filter=${encodeURIComponent(JSON.stringify({ voucherRef: tripDetail.linkedVoucher._id }))}`,
                'Gagal memuat riwayat uang jalan trip'
            ).catch(() => []);
            setLinkedVoucherDisbursements(sortDriverVoucherDisbursements(disbursementRows || []));
        } else {
            setLinkedVoucherDisbursements([]);
        }
        if (!editingTaripRef.current) {
            setTaripBorongan((resolvedDeliveryOrder?.baseTaripBorongan ?? resolvedDeliveryOrder?.taripBorongan) || 0);
            setKeteranganBorongan(resolvedDeliveryOrder?.keteranganBorongan || '');
            setTripRouteRateRef(resolvedDeliveryOrder?.tripRouteRateRef || '');
            setTripOriginArea(resolvedDeliveryOrder?.tripOriginArea || '');
            setTripDestinationArea(resolvedDeliveryOrder?.tripDestinationArea || '');
        }
        if (!savingManualOvertonase) {
            setManualOvertonaseWeightInputUnit('KG');
            setManualOvertonaseWeightInputValue(resolvedDeliveryOrder?.manualOvertonaseWeightKg || 0);
        }
        await hydrateDeliveryOrderItemsState(deliveryOrderItems);
        setTrackingLogs(sortTrackingLogs(trackingEvents));

        return {
            deliveryOrder,
            deliveryOrderItems,
            resolvedDeliveryOrder,
        };
    }, [hydrateDeliveryOrderItemsState, savingManualOvertonase]);

    const loadDO = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'initial') {
            setLoading(true);
            setLoadNotice(null);
        }

        try {
            const tripDetail = await fetchAdminData<TripDetailSnapshot | null>(
                `/api/data?entity=trip-detail&id=${doId}`,
                'Gagal memuat detail trip'
            );
            const { deliveryOrder } = await applyTripDetailSnapshot(tripDetail);

            const shouldReloadReferences =
                mode === 'initial' ||
                loadedReferenceCustomerRef.current !== (deliveryOrder?.customerRef || '');
            if (shouldReloadReferences) {
                await loadDOReferences(deliveryOrder);
            }
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail trip');
            if (mode === 'initial') {
                setLoadNotice(buildAdminLoadNotice(
                    message,
                    'Trip',
                    'Halaman ini hanya bisa dilihat oleh role yang punya akses Trip / Surat Jalan.'
                ));
            }
            addToast('error', message);
        } finally {
            if (mode === 'initial') {
                setLoading(false);
            }
        }
    }, [addToast, applyTripDetailSnapshot, doId, loadDOReferences]);

    const refreshTripDetail = useCallback(async () => {
        await loadDO('refresh');
    }, [loadDO]);

    const loadTripResources = useCallback(async () => {
        setLoadingTripResources(true);
        try {
            const [driverRows, vehicleRows, deliveryOrders, activeOrderRows, currentDriver, currentVehicle] = await Promise.all([
                fetchAdminCollectionData<Driver[]>(
                    `/api/data?entity=drivers&filter=${encodeURIComponent(JSON.stringify({ active: true }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                fetchAdminCollectionData<Vehicle[]>(
                    `/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                fetchAdminCollectionData<Trip[]>(
                    `/api/data?entity=trips&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'PARTIAL_HOLD', 'DELIVERED'] }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                fetchAdminCollectionData<Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>>(
                    `/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ status: ['OPEN', 'PARTIAL'] }))}`,
                    'Gagal memuat opsi armada trip'
                ),
                doData?.driverRef
                    ? fetchAdminData<Driver | null>(`/api/data?entity=drivers&id=${doData.driverRef}`, 'Gagal memuat opsi armada trip')
                    : Promise.resolve(null),
                doData?.vehicleRef
                    ? fetchAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${doData.vehicleRef}`, 'Gagal memuat opsi armada trip')
                    : Promise.resolve(null),
            ]);

            const nextDrivers = [...(driverRows || [])];
            if (currentDriver && !nextDrivers.some(driver => driver._id === currentDriver._id)) {
                nextDrivers.push(currentDriver);
            }

            const nextVehicles = [...(vehicleRows || [])];
            if (currentVehicle && !nextVehicles.some(vehicle => vehicle._id === currentVehicle._id)) {
                nextVehicles.push(currentVehicle);
            }

            setDrivers(nextDrivers);
            setVehicles(nextVehicles);
            setActiveTrips(deliveryOrders || []);
            setActiveOrders(activeOrderRows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat opsi armada trip');
        } finally {
            setLoadingTripResources(false);
        }
    }, [addToast, doData?.driverRef, doData?.vehicleRef]);

    const loadTripCashBankAccounts = useCallback(async () => {
        setLoadingTripCashOptions(true);
        try {
            const accountRows = await fetchAdminCollectionData<BankAccount[]>(
                '/api/data?entity=bank-accounts',
                'Gagal memuat rekening uang jalan trip'
            );
            const activeAccounts = (accountRows || []).filter(account => account.active !== false);
            setBankAccounts(activeAccounts);
            setTripCashIssueForm(previous =>
                previous.issueBankRef && !activeAccounts.some(account => account._id === previous.issueBankRef)
                    ? { ...previous, issueBankRef: '' }
                    : previous
            );
            setTripCashTopUpForm(previous =>
                previous.bankAccountRef && !activeAccounts.some(account => account._id === previous.bankAccountRef)
                    ? { ...previous, bankAccountRef: '' }
                    : previous
            );
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat rekening uang jalan trip');
        } finally {
            setLoadingTripCashOptions(false);
        }
    }, [addToast]);

    const loadCancelTripExpenseReferences = useCallback(async () => {
        setLoadingTripCashOptions(true);
        try {
            const [categoryRows, accountRows] = await Promise.all([
                fetchAdminCollectionData<ExpenseCategory[]>(
                    '/api/data?entity=expense-categories',
                    'Gagal memuat kategori pengeluaran'
                ),
                fetchAdminCollectionData<BankAccount[]>(
                    '/api/data?entity=bank-accounts',
                    'Gagal memuat kas / bank pengeluaran'
                ),
            ]);
            const activeAccounts = (accountRows || []).filter(account => account.active !== false);
            const activeCategories = (categoryRows || []).filter(category => category.active !== false);
            setBankAccounts(activeAccounts);
            setExpenseCategories(activeCategories);
            return { categories: activeCategories, accounts: activeAccounts };
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat referensi biaya batal trip');
            return { categories: expenseCategories, accounts: bankAccounts };
        } finally {
            setLoadingTripCashOptions(false);
        }
    }, [addToast, bankAccounts, expenseCategories]);

    const loadTripCashModalReferences = useCallback(async () => {
        await Promise.all([
            loadTripResources(),
            loadTripCashBankAccounts(),
        ]);
    }, [loadTripCashBankAccounts, loadTripResources]);

    const openTripResourcesModal = async () => {
        if (!canAssignTripResources) return;
        setTripVehicleRef(doData?.vehicleRef || '');
        setTripDriverRef(doData?.driverRef || '');
        setTripVehicleOverrideReason(doData?.vehicleCategoryOverrideReason || '');
        setShowTripResourcesModal(true);
        await loadTripResources();
    };

    const openTripCashIssueModal = async () => {
        if (!canCreateTripCash || !doData || linkedVoucher || linkedTripCashLink) return;
        const plannedIssueBankRef = doData.plannedTripIssueBankRef || '';
        setTripCashIssueForm({
            vehicleRef: doData.vehicleRef || '',
            driverRef: doData.driverRef || '',
            vehicleCategoryOverrideReason: doData.vehicleCategoryOverrideReason || '',
            tripOriginArea: doData.tripOriginArea || '',
            tripDestinationArea: doData.tripDestinationArea || '',
            tripRouteRateRef: doData.tripRouteRateRef || '',
            taripBorongan: (doData.baseTaripBorongan ?? doData.taripBorongan) || 0,
            keteranganBorongan: doData.keteranganBorongan || '',
            issueBankRef: plannedIssueBankRef,
            cashGiven: parseFormattedNumberish(doData.plannedTripCashGiven ?? 0, { allowDecimal: false, maxFractionDigits: 0 }),
            issuedDate: getBusinessDateValue(),
            notes: '',
        });
        setShowTripCashIssueModal(true);
        await loadTripCashModalReferences();
    };

    const applyTripCashIssueRouteSelection = (nextOriginArea: string, nextDestinationArea: string) => {
        const nextMatchedRate = findMatchingTripRouteRate(tripRouteRates, {
            originArea: nextOriginArea,
            destinationArea: nextDestinationArea,
            serviceRef: doData?.serviceRef,
        });
        setTripCashIssueForm(previous => ({
            ...previous,
            tripOriginArea: nextOriginArea,
            tripDestinationArea: nextDestinationArea,
            tripRouteRateRef: nextMatchedRate?._id || '',
            taripBorongan: nextMatchedRate?.rate ?? previous.taripBorongan,
        }));
    };

    const handleTripCashIssueOriginChange = (nextOriginArea: string) => {
        const nextDestinationOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
            originArea: nextOriginArea,
            serviceRef: doData?.serviceRef,
        });
        const preservedDestination =
            nextOriginArea && nextDestinationOptions.includes(tripCashIssueForm.tripDestinationArea)
                ? tripCashIssueForm.tripDestinationArea
                : '';
        applyTripCashIssueRouteSelection(nextOriginArea, preservedDestination);
    };

    const handleTripCashIssueDestinationChange = (nextDestinationArea: string) => {
        applyTripCashIssueRouteSelection(tripCashIssueForm.tripOriginArea, nextDestinationArea);
    };

    const openShipperReferenceModal = (mode: 'edit' | 'create' = 'edit') => {
        if (mode === 'edit' && !canEditShipperReference) return;
        if (mode === 'create' && !canAppendCargoToDo) return;
        const resolvedShipperReferences = buildResolvedShipperReferenceEntries(doData, doItems);
        const normalizedFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
        const nextReferences = resolvedShipperReferences
            .map(reference => ({
                draftKey: reference.draftKey,
                referenceKey: reference.referenceKey,
                referenceNumber: reference.referenceNumber,
                date: reference.date || getBusinessDateValue(),
                pickupStopKey: reference.pickupStopKey,
                pickupAddress: reference.pickupAddress,
                selectedRecipientId: resolveMatchingRecipientId(reference.billingCustomerRef || doData?.customerRef, {
                    receiverName: reference.receiverName,
                    receiverPhone: reference.receiverPhone,
                    receiverCompany: reference.receiverCompany,
                    receiverAddress: reference.receiverAddress,
                }),
                billingCustomerRef: reference.billingCustomerRef,
                billingCustomerName: reference.billingCustomerName,
                receiverName: reference.receiverName,
                receiverPhone: reference.receiverPhone,
                receiverAddress: reference.receiverAddress,
                receiverCompany: reference.receiverCompany,
            }))
            .filter(reference => Boolean(reference.referenceNumber));
        const firstEditableDraftKey = (
            nextReferences.find(ref => getSuratJalanOperationalStatus(ref.referenceKey).status !== 'DELIVERED')
            || nextReferences[0]
        )?.draftKey || '';
        const baseDrafts = nextReferences.length > 0
            ? nextReferences
            : [{
                draftKey: crypto.randomUUID(),
                referenceKey: '',
                referenceNumber: doData?.customerDoNumber || (normalizedFormat !== 'SJ' ? normalizedFormat : ''),
                date: getBusinessDateValue(),
                pickupStopKey: '',
                pickupAddress: doData?.pickupAddress || '',
                selectedRecipientId: '',
                billingCustomerRef: doData?.customerRef || '',
                billingCustomerName: doData?.customerName || '',
                receiverName: '',
                receiverPhone: '',
                receiverAddress: '',
                receiverCompany: '',
            }];
        const initialDrafts = mode === 'create'
            ? [
                ...baseDrafts,
                {
                    draftKey: crypto.randomUUID(),
                    referenceKey: '',
                    referenceNumber: '',
                    date: getBusinessDateValue(),
                    pickupStopKey: defaultShipperReferencePickupOption?.key || '',
                    pickupAddress: defaultShipperReferencePickupOption?.address || '',
                    selectedRecipientId: '',
                    billingCustomerRef: doData?.customerRef || '',
                    billingCustomerName: doData?.customerName || '',
                    receiverName: '',
                    receiverPhone: '',
                    receiverAddress: '',
                    receiverCompany: '',
                },
            ]
            : baseDrafts;
        setShipperReferenceDrafts(initialDrafts);
        setSelectedShipperReferenceDraftKey(
            mode === 'create'
                ? (initialDrafts[initialDrafts.length - 1]?.draftKey || '')
                : firstEditableDraftKey
        );
        setShipperReferenceModalMode(mode);
        setDeletedShipperReferenceItemIds([]);
        setShipperReferenceExistingItemDraftMap(
            initialDrafts.reduce<Record<string, ExistingShipperReferenceItemDraft[]>>((acc, draft) => {
                acc[draft.draftKey] = doItems
                    .filter(item => matchesShipperReferenceDraft(draft, doData, item))
                    .map(item => {
                        const weightInputUnit = item.orderItemWeightInputUnit || 'KG';
                        const volumeInputUnit = item.orderItemVolumeInputUnit || 'M3';
                        const linkedOrderItem = item.orderItemRef ? linkedOrderItemDetailMap[item.orderItemRef] : undefined;
                        return {
                            deliveryOrderItemId: item._id,
                            customerProductRef: linkedOrderItem?.customerProductRef || '',
                            description: item.orderItemDescription || '',
                            qtyKoli: parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0),
                            weightInputValue: parseFormattedNumberish(
                                item.orderItemWeightInputValue ?? item.orderItemWeight ?? item.shippedWeight ?? 0,
                                { maxFractionDigits: getWeightInputFractionDigits(weightInputUnit) }
                            ),
                            weightInputUnit,
                            volumeInputValue: parseFormattedNumberish(
                                item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 0,
                                { maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3 }
                            ),
                            volumeInputUnit,
                            value: 0,
                            id: item.orderItemRef,
                        };
                    });
                return acc;
            }, {})
        );
        setShipperReferenceItemDraftMap(
            mode === 'create' && initialDrafts[initialDrafts.length - 1]?.draftKey
                ? {
                    [initialDrafts[initialDrafts.length - 1].draftKey]: [createDefaultDeliveryOrderCargoDraftItem()],
                }
                : {}
        );
        setShowShipperReferenceModal(true);
    };

    const updateShipperReferenceDraft = (draftKey: string, patch: Partial<ShipperReferenceDraft>) => {
        setShipperReferenceDrafts(previous => previous.map(entry => (
            entry.draftKey === draftKey
                ? { ...entry, ...patch }
                : entry
        )));
    };

    const removeShipperReferenceDraft = (draftKey: string) => {
        const nextDrafts = shipperReferenceDrafts.filter(entry => entry.draftKey !== draftKey);
        const resolvedDrafts = nextDrafts.length > 0
            ? nextDrafts
            : [{
                draftKey: crypto.randomUUID(),
                referenceKey: '',
                referenceNumber: '',
                date: getBusinessDateValue(),
                pickupStopKey: defaultShipperReferencePickupOption?.key || '',
                pickupAddress: defaultShipperReferencePickupOption?.address || '',
                selectedRecipientId: '',
                billingCustomerRef: doData?.customerRef || '',
                billingCustomerName: doData?.customerName || '',
                receiverName: '',
                receiverPhone: '',
                receiverAddress: '',
                receiverCompany: '',
            }];
        setShipperReferenceDrafts(resolvedDrafts);
        setSelectedShipperReferenceDraftKey(current => (
            current === draftKey
                ? (resolvedDrafts[0]?.draftKey || '')
                : (resolvedDrafts.some(entry => entry.draftKey === current) ? current : (resolvedDrafts[0]?.draftKey || ''))
        ));
        setShipperReferenceItemDraftMap(previous => {
            const nextMap = { ...previous };
            delete nextMap[draftKey];
            return nextMap;
        });
        setShipperReferenceExistingItemDraftMap(previous => {
            const nextMap = { ...previous };
            delete nextMap[draftKey];
            return nextMap;
        });
    };

    const updateSelectedShipperReferenceItemDraft = <K extends keyof DeliveryOrderCargoDraftItem>(
        itemIndex: number,
        field: K,
        value: DeliveryOrderCargoDraftItem[K]
    ) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? (
                        field === 'qtyKoli'
                            ? toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                ...item,
                                pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                                shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                            }, value as number))
                            : field === 'weightInputValue' && shouldLockOrderItemWeight(item)
                                ? item
                            : field === 'volumeInputValue' && shouldLockOrderItemVolume(item)
                                ? item
                            : { ...item, [field]: value }
                    )
                    : item
            )),
        }));
    };

    const updateSelectedExistingShipperReferenceItemDraft = <K extends keyof DeliveryOrderCargoDraftItem>(
        itemIndex: number,
        field: K,
        value: DeliveryOrderCargoDraftItem[K]
    ) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? (
                        field === 'qtyKoli'
                            ? {
                                ...item,
                                ...toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                    ...item,
                                    pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                                    shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                                }, value as number)),
                            }
                            : field === 'weightInputValue' && shouldLockOrderItemWeight(item)
                                ? item
                            : field === 'volumeInputValue' && shouldLockOrderItemVolume(item)
                                ? item
                            : { ...item, [field]: value }
                    )
                    : item
            )),
        }));
    };

    const addSelectedShipperReferenceItemDraft = () => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: [
                ...(previous[selectedShipperReferenceDraft.draftKey] || []),
                createDefaultDeliveryOrderCargoDraftItem(),
            ],
        }));
    };

    const removeSelectedShipperReferenceItemDraft = (itemIndex: number) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).filter((_, currentIndex) => currentIndex !== itemIndex),
        }));
    };

    const applySelectedShipperReferenceItemProduct = (itemIndex: number, nextProductRef: string) => {
        if (!selectedShipperReferenceDraft) return;
        const selectedProduct = deliveryOrderCustomerProducts.find(product => product._id === nextProductRef);
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                        ...item,
                        pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                        shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                    }, selectedProduct))
                    : item
            )),
        }));
    };

    const applySelectedExistingShipperReferenceItemProduct = (itemIndex: number, nextProductRef: string) => {
        if (!selectedShipperReferenceDraft) return;
        const selectedProduct = deliveryOrderCustomerProducts.find(product => product._id === nextProductRef);
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? {
                        ...item,
                        ...toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                            ...item,
                            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                            shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                        }, selectedProduct)),
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    }
                    : item
            )),
        }));
    };

    const updateSelectedShipperReferenceItemWeightUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['weightInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                        ...item,
                        pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                        shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                    }, nextUnit))
                    : item
            )),
        }));
    };

    const updateSelectedExistingShipperReferenceItemWeightUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['weightInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? {
                        ...item,
                        ...toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                            ...item,
                            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                            shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                        }, nextUnit)),
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    }
                    : item
            )),
        }));
    };

    const updateSelectedShipperReferenceItemVolumeUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['volumeInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                        ...item,
                        pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                        shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                    }, nextUnit))
                    : item
            )),
        }));
    };

    const updateSelectedExistingShipperReferenceItemVolumeUnit = (itemIndex: number, nextUnit: DeliveryOrderCargoDraftItem['volumeInputUnit']) => {
        if (!selectedShipperReferenceDraft) return;
        setShipperReferenceExistingItemDraftMap(previous => ({
            ...previous,
            [selectedShipperReferenceDraft.draftKey]: (previous[selectedShipperReferenceDraft.draftKey] || []).map((item, currentIndex) => (
                currentIndex === itemIndex
                    ? {
                        ...item,
                        ...toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                            ...item,
                            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
                            shipperReferenceNumber: selectedShipperReferenceDraft.referenceNumber,
                        }, nextUnit)),
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    }
                    : item
            )),
        }));
    };

    const getCustomerRecipientOptions = (customerRef?: string) => {
        const normalizedCustomerRef = customerRef?.trim();
        return customerRecipients.filter(recipient =>
            recipient.active !== false &&
            (!normalizedCustomerRef || recipient.customerRef === normalizedCustomerRef)
        );
    };

    const formatCustomerRecipientLabel = (recipient: CustomerRecipient) => {
        const targetName = recipient.receiverCompany || recipient.receiverName || recipient.label;
        return `${recipient.label}${targetName && targetName !== recipient.label ? ` - ${targetName}` : ''}`;
    };

    const normalizeRecipientComparable = (value?: string) => value?.trim().toLowerCase() || '';

    const resolveMatchingRecipientId = (
        customerRef: string | undefined,
        target: {
            receiverName?: string;
            receiverPhone?: string;
            receiverCompany?: string;
            receiverAddress?: string;
        }
    ) => {
        const options = getCustomerRecipientOptions(customerRef);
        if (options.length === 0) {
            return '';
        }

        const targetName = normalizeRecipientComparable(target.receiverName);
        const targetPhone = normalizeRecipientComparable(target.receiverPhone);
        const targetCompany = normalizeRecipientComparable(target.receiverCompany);
        const targetAddress = normalizeRecipientComparable(target.receiverAddress);

        const matchedRecipient = options.find(recipient => {
            const score =
                (targetAddress && normalizeRecipientComparable(recipient.receiverAddress) === targetAddress ? 2 : 0) +
                (targetCompany && normalizeRecipientComparable(recipient.receiverCompany) === targetCompany ? 1 : 0) +
                (targetName && normalizeRecipientComparable(recipient.receiverName) === targetName ? 1 : 0) +
                (targetPhone && normalizeRecipientComparable(recipient.receiverPhone) === targetPhone ? 1 : 0);
            return score >= 2;
        });

        return matchedRecipient?._id || '';
    };

    const getDefaultCargoDraftPickupKey = () => (
        pickupStopList.length === 1 ? pickupStopList[0]._key : ''
    );

    const closeCargoModal = () => {
        if (savingCargo) return;
        setShowCargoModal(false);
        setEditingCargoItemId(null);
        setCargoDraftGroups([createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey())]);
    };

    const updateCargoDraftGroup = <K extends keyof Pick<DeliveryOrderCargoDraftGroup, 'pickupStopKey' | 'shipperReferenceNumber'>>(
        groupId: string,
        field: K,
        value: DeliveryOrderCargoDraftGroup[K]
    ) => {
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, [field]: value }
                : group
        )));
    };

    const updateCargoDraftItem = <K extends keyof DeliveryOrderCargoDraftItem>(
        groupId: string,
        itemIndex: number,
        field: K,
        value: DeliveryOrderCargoDraftItem[K]
    ) => {
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? {
                    ...group,
                    items: group.items.map((item, currentIndex) => (
                        currentIndex === itemIndex
                            ? (
                                field === 'qtyKoli'
                                    ? toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                                        ...item,
                                        pickupStopKey: group.pickupStopKey,
                                        shipperReferenceNumber: group.shipperReferenceNumber,
                                    }, value as number))
                                    : field === 'weightInputValue' && shouldLockOrderItemWeight(item)
                                        ? item
                                    : field === 'volumeInputValue' && shouldLockOrderItemVolume(item)
                                        ? item
                                    : { ...item, [field]: value }
                            )
                            : item
                    )),
                }
                : group
        )));
    };

    const applyCargoDraftProductSelection = (groupId: string, itemIndex: number, nextProductRef: string) => {
        const selectedProduct = deliveryOrderCustomerProducts.find(product => product._id === nextProductRef);
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? {
                    ...group,
                    items: group.items.map((item, currentIndex) => (
                        currentIndex === itemIndex
                            ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                                ...item,
                                pickupStopKey: group.pickupStopKey,
                                shipperReferenceNumber: group.shipperReferenceNumber,
                            }, selectedProduct))
                            : item
                    )),
                }
                : group
        )));
    };

    const addCargoDraftGroup = () => {
        setCargoDraftGroups(previous => [
            ...previous,
            createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey()),
        ]);
    };

    const removeCargoDraftGroup = (groupId: string) => {
        setCargoDraftGroups(previous => {
            const nextGroups = previous.filter(group => group.id !== groupId);
            return nextGroups.length > 0
                ? nextGroups
                : [createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey())];
        });
    };

    const addCargoDraftItem = (groupId: string) => {
        setCargoDraftGroups(previous => previous.map(group => (
            group.id === groupId
                ? { ...group, items: [...group.items, createDefaultDeliveryOrderCargoDraftItem()] }
                : group
        )));
    };

    const removeCargoDraftItem = (groupId: string, itemIndex: number) => {
        setCargoDraftGroups(previous => previous.map(group => {
            if (group.id !== groupId) {
                return group;
            }
            const nextItems = group.items.filter((_, currentIndex) => currentIndex !== itemIndex);
            return {
                ...group,
                items: nextItems.length > 0 ? nextItems : [createDefaultDeliveryOrderCargoDraftItem()],
            };
        }));
    };

    const openTripFeeEditor = () => {
        if (!canManageTripFee || linkedVoucherBonNumber) return;
        setEditingTarip(true);
        if (typeof window !== 'undefined') {
            window.requestAnimationFrame(() => {
                document.getElementById('delivery-order-trip-fee-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    };

    const buildPartialHoldContinuationDrafts = (
        sourceDOData: DeliveryOrder | null,
        sourceDoItems: DeliveryOrderItem[],
        baseCargoItems: ActualCargoDraft[]
    ) => {
        const partialHoldSuratJalanRefs = new Set(
            suratJalanDocuments
                .filter(document =>
                    document.tripStatus === 'PARTIAL_HOLD' ||
                    (document.holdCargo?.qtyKoli || 0) > 0 ||
                    (document.holdCargo?.weightKg || 0) > 0 ||
                    (document.holdCargo?.volumeM3 || 0) > 0
                )
                .map(document => document._id)
        );
        const actualDropPointSource = sourceDOData?.actualDropPoints || [];
        if (!sourceDOData?._id || partialHoldSuratJalanRefs.size === 0 || actualDropPointSource.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const getItemSuratJalanRef = (item: DeliveryOrderItem) =>
            `${sourceDOData._id}:${item.shipperReferenceKey || item.shipperReferenceNumber || 'primary'}`;
        const itemsById = new Map(sourceDoItems.map(item => [item._id, item]));
        const partialHoldItemIds = new Set(
            sourceDoItems
                .filter(item => partialHoldSuratJalanRefs.has(getItemSuratJalanRef(item)))
                .map(item => item._id)
        );
        const getPointItemIds = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => {
            const explicitItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].filter((value): value is string => Boolean(value));
            if (explicitItemRefs.length > 0) {
                return explicitItemRefs.filter(itemId => partialHoldItemIds.has(itemId));
            }

            const pointReferenceKey = (point.shipperReferenceKey || '').trim();
            const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
            const matchingItems = sourceDoItems.filter(item => {
                if (!partialHoldItemIds.has(item._id)) {
                    return false;
                }
                return (
                    (pointReferenceKey && (item.shipperReferenceKey || '').trim() === pointReferenceKey) ||
                    (pointReferenceNumber && (item.shipperReferenceNumber || '').trim().toUpperCase() === pointReferenceNumber)
                );
            });
            return matchingItems.length === 1 ? [matchingItems[0]._id] : [];
        };

        const continuableHoldPoints = actualDropPointSource.filter(point => (
            (point.stopType === 'HOLD' || point.stopType === 'TRANSIT') &&
            getPointItemIds(point).length > 0
        ));
        if (continuableHoldPoints.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const holdDraftByItemId = new Map<string, ActualCargoItemValueDraft>();
        continuableHoldPoints.forEach(point => {
            const pointItemIds = getPointItemIds(point);
            pointItemIds.forEach(itemId => {
                const sourceItem = itemsById.get(itemId);
                if (!sourceItem) {
                    return;
                }
                const current = holdDraftByItemId.get(itemId);
                const weightInputUnit = point.weightInputUnit || sourceItem.actualWeightInputUnit || sourceItem.orderItemWeightInputUnit || 'KG';
                const volumeInputUnit = point.volumeInputUnit || sourceItem.actualVolumeInputUnit || sourceItem.orderItemVolumeInputUnit || 'M3';
                const currentWeightKg = current
                    ? convertWeightToKg(parseFormattedNumberish(current.actualWeightInputValue || 0), current.actualWeightInputUnit)
                    : 0;
                const currentVolumeM3 = current
                    ? convertVolumeToM3(parseFormattedNumberish(current.actualVolumeInputValue || 0), current.actualVolumeInputUnit)
                    : 0;
                const nextWeightKg = currentWeightKg + convertWeightToKg(point.weightInputValue ?? point.weightKg ?? 0, weightInputUnit);
                const nextVolumeM3 = currentVolumeM3 + convertVolumeToM3(point.volumeInputValue ?? point.volumeM3 ?? 0, volumeInputUnit);
                holdDraftByItemId.set(itemId, {
                    actualQtyKoli: String(parseFormattedNumberish(current?.actualQtyKoli || 0) + parseFormattedNumberish(point.qtyKoli || 0)),
                    actualWeightInputValue: nextWeightKg > 0 ? String(convertKgToWeightInputValue(nextWeightKg, weightInputUnit)) : '',
                    actualWeightInputUnit: weightInputUnit,
                    actualVolumeInputValue: formatActualDropDraftNumber(
                        nextVolumeM3 > 0 ? convertM3ToVolumeInputValue(nextVolumeM3, volumeInputUnit) : undefined,
                        volumeInputUnit === 'LITER' ? 0 : 3
                    ),
                    actualVolumeInputUnit: volumeInputUnit,
                });
            });
        });

        const continuationCargoItems = baseCargoItems.map(item => {
            const holdDraft = holdDraftByItemId.get(item.deliveryOrderItemRef);
            return holdDraft ? { ...item, ...holdDraft } : item;
        });
        return {
            actualCargoItems: continuationCargoItems,
            sourceDropPoints: [] as DeliveryOrder['actualDropPoints'],
            itemRefs: Array.from(holdDraftByItemId.keys()),
        };
    };

    const openStatusModal = async (requestedStatus?: string, fromDriverRequest: boolean = false, driverRequest?: PendingDriverStatusRequest) => {
        if (!canManageDeliveryStatus) return;
        const hydratingDriverDeliveredRequest = fromDriverRequest && requestedStatus === 'DELIVERED';
        let statusModalDOData = doData;
        let statusModalDoItems = doItems;
        let pendingDriverActualCargoItems = hydratingDriverDeliveredRequest ? (driverRequest?.actualCargoItems || doData?.pendingDriverActualCargoItems) : undefined;
        let pendingDriverActualDropPoints = hydratingDriverDeliveredRequest ? (driverRequest?.actualDropPoints || doData?.pendingDriverActualDropPoints) : undefined;

        if (hydratingDriverDeliveredRequest && doId) {
            try {
                const latestTripDetail = await fetchAdminData<TripDetailSnapshot | null>(
                    `/api/data?entity=trip-detail&id=${doId}`,
                    'Gagal memuat permintaan driver terbaru'
                );
                if (latestTripDetail?.deliveryOrder) {
                    const snapshotState = await applyTripDetailSnapshot(latestTripDetail);
                    statusModalDOData = snapshotState.resolvedDeliveryOrder;
                    statusModalDoItems = snapshotState.deliveryOrderItems;
                    const latestDriverRequest = driverRequest?.requestId
                        ? (latestTripDetail.deliveryOrder.pendingDriverRequests || []).find(request => request.requestId === driverRequest.requestId)
                        : null;
                    pendingDriverActualCargoItems = latestDriverRequest?.actualCargoItems || latestTripDetail.deliveryOrder.pendingDriverActualCargoItems;
                    pendingDriverActualDropPoints = latestDriverRequest?.actualDropPoints || latestTripDetail.deliveryOrder.pendingDriverActualDropPoints;
                }
            } catch {
                addToast('warning', 'Permintaan driver terbaru belum sempat disegarkan. Modal memakai data yang sudah terbuka.');
            }
        }

        const defaultPodName =
            (fromDriverRequest ? (driverRequest?.podReceiverName?.trim() || statusModalDOData?.pendingDriverPodReceiverName?.trim()) : '')
            || statusModalDOData?.podReceiverName?.trim()
            || statusModalDOData?.receiverName?.trim()
            || statusModalDOData?.receiverCompany?.trim()
            || '';
        const driverRequestPodDate =
            driverRequest?.podReceivedDate?.trim() ||
            statusModalDOData?.pendingDriverPodReceivedDate?.trim() ||
            '';
        const defaultPodDate = fromDriverRequest
            ? (driverRequestPodDate ? driverRequestPodDate.slice(0, 10) : getBusinessDateValue())
            : getBusinessDateValue();
        const defaultPodNote = (fromDriverRequest ? (driverRequest?.podNote || statusModalDOData?.pendingDriverPodNote) : '') || statusModalDOData?.podNote || '';

        setNewStatus(requestedStatus || '');
        const pendingDriverStatusSuratJalanRefs = fromDriverRequest
            ? (driverRequest?.targetSuratJalanRefs || statusModalDOData?.pendingDriverStatusSuratJalanRefs || [])
            : [];
        setSelectedStatusSuratJalanRefs(
            requestedStatus
                ? pendingDriverStatusSuratJalanRefs.length > 0
                    ? pendingDriverStatusSuratJalanRefs
                    : suratJalanDocuments
                    .filter(document =>
                        getNextDeliveryOrderStatuses(document.tripStatus || (tripData?.status || statusModalDOData?.status || doData?.status || ''))
                            .filter(status => status === 'CREATED' || status === 'CANCELLED' || hasTripResourcesAssigned)
                            .includes(requestedStatus)
                    )
                    .map(document => document._id)
                : []
        );
        setStatusNote(fromDriverRequest ? (driverRequest?.note || statusModalDOData?.pendingDriverStatusNote || '') : '');
        setReviewingDriverRequest(fromDriverRequest);
        setReviewingDriverRequestId(fromDriverRequest ? (driverRequest?.requestId || '') : '');
        setPodName(defaultPodName);
        setPodDate(defaultPodDate);
        setPodNote(defaultPodNote);
        const baseActualCargoItems = buildActualCargoDrafts(
            statusModalDoItems,
            hydratingDriverDeliveredRequest ? pendingDriverActualCargoItems : undefined
        );
        const shouldPrepareHoldContinuation =
            requestedStatus === 'DELIVERED' ||
            (!requestedStatus && availableBatchStatuses.includes('DELIVERED'));
        const continuationDrafts = !hydratingDriverDeliveredRequest && shouldPrepareHoldContinuation
            ? buildPartialHoldContinuationDrafts(statusModalDOData, statusModalDoItems, baseActualCargoItems)
            : {
                actualCargoItems: baseActualCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        const nextActualCargoItems = continuationDrafts.actualCargoItems;
        const isPartialHoldContinuation = !hydratingDriverDeliveredRequest && continuationDrafts.itemRefs.length > 0;
        const driverReviewDropHydration = hydratingDriverDeliveredRequest
            ? buildDriverReviewActualDropHydration(pendingDriverActualDropPoints || [], nextActualCargoItems)
            : { groupedDrafts: [] as ActualDropDraft[], itemValueMap: {} as Record<string, ActualDropItemValueDraft> };
        const nextActualDropPoints = hydratingDriverDeliveredRequest
            ? driverReviewDropHydration.groupedDrafts
            : buildDefaultActualDropDrafts(
                statusModalDOData,
                nextActualCargoItems,
                isPartialHoldContinuation
                    ? []
                    : continuationDrafts.sourceDropPoints || []
            );
        const isDriverReviewDefaultDrop =
            hydratingDriverDeliveredRequest &&
            (pendingDriverActualDropPoints || []).length === 1 &&
            !((pendingDriverActualDropPoints || [])[0]?.deliveryOrderItemRef || '').trim();
        const shouldUseAdvancedDropEditor =
            !isDriverReviewDefaultDrop &&
            !isPartialHoldContinuation &&
            shouldOpenAdvancedDropEditor(statusModalDOData, nextActualDropPoints);
        const hydratedDriverDropItemValueMap = hydratingDriverDeliveredRequest
            ? driverReviewDropHydration.itemValueMap
            : {};
        const hydratedDriverActualCargoItemValueMap = hydratingDriverDeliveredRequest
            ? nextActualCargoItems.reduce<Record<string, ActualCargoItemValueDraft>>((map, item) => {
                map[item.deliveryOrderItemRef] = {
                    actualQtyKoli: item.actualQtyKoli,
                    actualWeightInputValue: item.actualWeightInputValue,
                    actualWeightInputUnit: item.actualWeightInputUnit,
                    actualVolumeInputValue: item.actualVolumeInputValue,
                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                };
                return map;
            }, {})
            : {};
        setActualCargoItems(nextActualCargoItems);
        setActualCargoSetupSnapshot(nextActualCargoItems);
        setPartialHoldContinuationItemRefs(continuationDrafts.itemRefs);
        setActualDropPoints(nextActualDropPoints);
        setActualCargoItemValueMap(hydratedDriverActualCargoItemValueMap);
        setActualDropItemValueMap(hydratedDriverDropItemValueMap);
        driverReviewDropEditedRef.current = false;
        setShowAdvancedDropEditor(shouldUseAdvancedDropEditor);
        setShowActualCargoFinalizationModal(false);
        setActiveFinalizationCargoItemRef('');
        setActiveFinalizationDropKey('');
        setShowStatusModal(true);
    };

    const rejectDriverStatusRequest = async () => {
        if (!canReviewDriverRequest) return;
        setRejectingRequest(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'reject-driver-status-request',
                    data: {
                        id: doData?._id,
                        pendingDriverRequestId: reviewingDriverRequestId || undefined,
                        note: rejectRequestNote,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menolak permintaan driver');
                return;
            }
            setShowRejectRequestModal(false);
            setRejectRequestNote('');
            setReviewingDriverRequestId('');
            await refreshTripDetail();
            addToast('success', 'Permintaan driver ditolak');
        } catch {
            addToast('error', 'Gagal menolak permintaan driver');
        } finally {
            setRejectingRequest(false);
        }
    };

    const saveCargoDrafts = async () => {
        if (!canEditDeliveryCargo || !doData?._id) return;
        if (cargoDraftItemCount === 0) {
            addToast('error', 'Isi minimal 1 barang sebelum disimpan ke Surat Jalan.');
            return;
        }

        const normalizedGroups = cargoDraftGroupsWithItems.map(group => ({
            ...group,
            resolvedPickupStopKey: group.pickupStopKey || (pickupStopList.length === 1 ? pickupStopList[0]._key : ''),
            resolvedShipperReferenceNumber: group.shipperReferenceNumber.trim().toUpperCase(),
        }));
        const invalidReferenceIndex = normalizedGroups.findIndex(group => group.draftItems.length > 0 && !group.resolvedShipperReferenceNumber);
        if (invalidReferenceIndex >= 0) {
            addToast('error', `No. SJ pengirim wajib diisi pada SJ ${invalidReferenceIndex + 1}`);
            return;
        }
        const invalidPickupIndex = normalizedGroups.findIndex(group => pickupStopList.length > 0 && !group.resolvedPickupStopKey);
        if (invalidPickupIndex >= 0) {
            addToast('error', `Titik pickup wajib dipilih pada SJ ${invalidPickupIndex + 1}`);
            return;
        }
        const duplicateGroupReferenceNumber = (() => {
            const seen = new Set<string>();
            for (const group of normalizedGroups) {
                if (seen.has(group.resolvedShipperReferenceNumber)) {
                    return group.resolvedShipperReferenceNumber;
                }
                seen.add(group.resolvedShipperReferenceNumber);
            }
            return '';
        })();
        if (duplicateGroupReferenceNumber) {
            addToast('error', `No. SJ pengirim ${duplicateGroupReferenceNumber} ditulis lebih dari sekali. Tambahkan barangnya di SJ yang sama, bukan membuat grup SJ baru.`);
            return;
        }
        if (editingCargoItemId) {
            if (normalizedGroups.length !== 1 || normalizedGroups[0].draftItems.length !== 1) {
                addToast('error', 'Mode edit barang hanya menerima 1 SJ dan 1 barang dalam satu kali simpan.');
                return;
            }
        }

        setSavingCargo(true);
        try {
            const action = editingCargoItemId ? 'update-cargo-item' : 'append-cargo-items';
            const existingShipperReferences = Array.isArray(doData.shipperReferences)
                ? doData.shipperReferences
                : [];
            const existingReferenceNumbers = new Set(
                existingShipperReferences
                    .map(reference => reference.referenceNumber?.trim().toUpperCase() || '')
                    .filter(Boolean)
            );
            const appendedShipperReferences = normalizedGroups
                .filter(group => !existingReferenceNumbers.has(group.resolvedShipperReferenceNumber))
                .map(group => ({
                    referenceNumber: group.resolvedShipperReferenceNumber,
                    pickupStopKey: group.resolvedPickupStopKey || undefined,
                }));
            const payloadData = editingCargoItemId
                ? {
                    id: doData._id,
                    deliveryOrderItemId: editingCargoItemId,
                    cargoItem: {
                        ...normalizedGroups[0].draftItems[0],
                        shipperReferenceNumber: normalizedGroups[0].resolvedShipperReferenceNumber,
                        pickupStopKey: normalizedGroups[0].resolvedPickupStopKey || undefined,
                    },
                }
                : {
                    id: doData._id,
                    shipperReferences: [
                        ...existingShipperReferences,
                        ...appendedShipperReferences,
                    ],
                    cargoItems: normalizedGroups.flatMap(group =>
                        group.draftItems.map(item => ({
                            ...item,
                            shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                            pickupStopKey: group.resolvedPickupStopKey || undefined,
                        }))
                    ),
                };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action,
                    data: payloadData,
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || (editingCargoItemId ? 'Gagal memperbarui barang Surat Jalan' : 'Gagal menambah barang ke Surat Jalan'));
                return;
            }
            setShowCargoModal(false);
            setEditingCargoItemId(null);
            setCargoDraftGroups([createDefaultDeliveryOrderCargoDraftGroup(getDefaultCargoDraftPickupKey())]);
            await refreshTripDetail();
            addToast(
                'success',
                editingCargoItemId
                    ? 'Barang Surat Jalan berhasil diperbarui'
                    : `${result.data?.appendedCount || cargoDraftItemCount} barang ditambahkan ke Surat Jalan`
            );
        } catch {
            addToast('error', editingCargoItemId ? 'Gagal memperbarui barang Surat Jalan' : 'Gagal menambah barang ke Surat Jalan');
        } finally {
            setSavingCargo(false);
        }
    };

    const toggleTripClosure = async (preferredOdometer?: number) => {
        if (!canManageDeliveryStatus || !doData?._id) return;
        const nextClosed = !isTripClosedByAdmin;
        setPendingTripClosure(nextClosed);
        if (!nextClosed) {
            setTripClosureTires([]);
            return;
        }
        let vehicle = vehicles.find(item => item._id === doData.vehicleRef) || null;
        if (!vehicle && doData.vehicleRef) {
            try {
                vehicle = await fetchAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${doData.vehicleRef}`, 'Gagal memuat odometer kendaraan');
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat odometer kendaraan');
            }
        }
        if (vehicle && !vehicle.oilNextServiceOdometer && vehicle.serviceRef) {
            try {
                const service = await fetchAdminData<Service | null>(`/api/data?entity=services&id=${vehicle.serviceRef}`, 'Gagal memuat interval servis oli');
                const interval = service?.oilMaintenanceKm || vehicle.oilMaintenanceIntervalKm || 0;
                if (interval > 0) {
                    const lastOilServiceOdometer = vehicle.oilLastServiceOdometer || vehicle.lastOdometer || 0;
                    vehicle = {
                        ...vehicle,
                        oilMaintenanceIntervalKm: interval,
                        oilLastServiceOdometer: lastOilServiceOdometer,
                        oilNextServiceOdometer: lastOilServiceOdometer + interval,
                    };
                }
            } catch {
                // Keep the odometer modal usable even if the category interval cannot be loaded.
            }
        }
        if (vehicle) {
            const resolvedVehicle = vehicle;
            setVehicles(current =>
                current.some(item => item._id === resolvedVehicle._id)
                    ? current.map(item => item._id === resolvedVehicle._id ? { ...item, ...resolvedVehicle } : item)
                    : [...current, resolvedVehicle]
            );
        }
        setTripClosureOdometer(Math.max(preferredOdometer || 0, vehicle?.lastOdometer || doData.tripEndOdometerKm || 0));
        if (!doData.vehicleRef) {
            setTripClosureTires([]);
            return;
        }
        setLoadingTripClosureTires(true);
        try {
            const filter = encodeURIComponent(JSON.stringify({ vehicleRef: doData.vehicleRef }));
            const tires = await fetchAdminCollectionData<TireEvent[]>(`/api/data?entity=tire-events&filter=${filter}&sortField=slotCode&sortDir=asc`, 'Gagal memuat ban unit');
            setTripClosureTires(tires || []);
        } catch (error) {
            setTripClosureTires([]);
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat ban unit');
        } finally {
            setLoadingTripClosureTires(false);
        }
    };

    const confirmTripClosure = async () => {
        if (!canManageDeliveryStatus || !doData?._id || pendingTripClosure === null) return;
        const nextClosed = pendingTripClosure;
        setTogglingTripClosure(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-trip-closure',
                    data: {
                        id: doData._id,
                        closed: nextClosed,
                        newOdometer: nextClosed ? tripClosureOdometer : undefined,
                        pendingDriverRequestId: reviewingDriverRequestId || undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal memperbarui status penutupan trip');
                return;
            }
            setPendingTripClosure(null);
            setReviewingDriverRequestId('');
            await refreshTripDetail();
            addToast('success', nextClosed ? 'Trip ditutup oleh admin' : 'Trip dibuka kembali');
        } catch {
            addToast('error', 'Gagal memperbarui status penutupan trip');
        } finally {
            setTogglingTripClosure(false);
        }
    };

    const removeCargoItemNow = async (deliveryOrderItemId: string) => {
        if (!canEditDeliveryCargo || !doData?._id) return;
        setRemovingCargoItemId(deliveryOrderItemId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'remove-cargo-item',
                    data: {
                        id: doData._id,
                        deliveryOrderItemId,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus barang dari Surat Jalan');
                return;
            }
            await refreshTripDetail();
            addToast('success', 'Barang Surat Jalan berhasil dihapus');
        } catch {
            addToast('error', 'Gagal menghapus barang dari Surat Jalan');
        } finally {
            setRemovingCargoItemId(null);
        }
    };

    const deleteShipperReferenceNow = async (reference: ResolvedShipperReferenceEntry) => {
        if (!canEditShipperReference || !doData?._id) return;
        if (isTripClosedByAdmin) {
            addToast('error', 'Trip ini sudah ditutup admin. Buka kembali trip jika masih ingin menghapus SJ.');
            return;
        }
        const referenceLabel = reference.referenceNumber || 'Surat Jalan ini';
        const referenceIdentity = reference.referenceKey || reference.draftKey || reference.referenceNumber;
        const remainingReferences = shipperReferenceDisplayList.filter(candidate => {
            const sameKey = reference.referenceKey && candidate.referenceKey === reference.referenceKey;
            const sameDraft = reference.draftKey && candidate.draftKey === reference.draftKey;
            const sameNumber = candidate.referenceNumber.trim().toUpperCase() === reference.referenceNumber.trim().toUpperCase();
            return !(sameKey || sameDraft || sameNumber);
        });
        if (remainingReferences.length === 0) {
            addToast('error', 'Minimal 1 Surat Jalan harus tersisa di trip ini. Ubah nomornya lewat Edit Surat Jalan jika perlu.');
            return;
        }

        const itemsForReference = doItems.filter(item => matchesShipperReferenceDraft(reference, doData, item));
        const lockedItems = itemsForReference.filter(item => !editableCargoItemMap[item._id]);
        if (lockedItems.length > 0) {
            addToast('error', `SJ ${referenceLabel} punya barang yang sudah terkunci atau berasal dari order utama, jadi tidak bisa dihapus langsung.`);
            return;
        }
        if (itemsForReference.length > 0 && !canEditDeliveryCargo) {
            addToast('error', 'Anda tidak punya akses menghapus barang pada SJ ini.');
            return;
        }

        const deleteLockReason = getShipperReferenceDeleteLockReason(reference);
        if (deleteLockReason) {
            addToast('error', deleteLockReason);
            return;
        }

        setDeletingShipperReferenceKey(referenceIdentity);
        try {
            const referenceRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-shipper-reference',
                    data: {
                        id: doData._id,
                        shipperReferences: remainingReferences.map((entry, index) => ({
                            _key: entry.referenceKey || undefined,
                            sequence: index + 1,
                            referenceNumber: entry.referenceNumber,
                            pickupStopKey: entry.pickupStopKey || undefined,
                            billingCustomerRef: entry.billingCustomerRef || undefined,
                            billingCustomerName: entry.billingCustomerName || undefined,
                            receiverName: entry.receiverName || undefined,
                            receiverPhone: entry.receiverPhone || undefined,
                            receiverAddress: entry.receiverAddress || undefined,
                            receiverCompany: entry.receiverCompany || undefined,
                        })),
                        removeLinkedCargoItemsForRemovedShipperReferences: true,
                    },
                }),
            });
            const referenceResult = await referenceRes.json();
            if (!referenceRes.ok) {
                addToast('error', referenceResult.error || `Gagal menghapus data SJ ${referenceLabel}. Refresh lalu cek ulang.`);
                return;
            }

            await refreshTripDetail();
            addToast('success', `SJ ${referenceLabel} berhasil dihapus`);
        } catch {
            addToast('error', `Gagal menghapus SJ ${referenceLabel}`);
        } finally {
            setDeletingShipperReferenceKey(null);
        }
    };

    const deleteShipperReference = (reference: ResolvedShipperReferenceEntry) => {
        if (!canEditShipperReference || !doData?._id) return;
        const itemsForReference = doItems.filter(item => matchesShipperReferenceDraft(reference, doData, item));
        const lockReason = getShipperReferenceDeleteLockReason(reference);
        setPendingDeleteAction({
            type: 'shipper-reference',
            reference,
            itemCount: itemsForReference.length,
            deleteLocked: Boolean(lockReason),
            lockReason,
        });
    };

    const confirmPendingDeleteAction = async () => {
        if (!pendingDeleteAction) return;
        const action = pendingDeleteAction;
        setPendingDeleteAction(null);
        if (action.type === 'cargo-item') {
            await removeCargoItemNow(action.deliveryOrderItemId);
            return;
        }
        if (action.deleteLocked) {
            addToast('error', action.lockReason || 'SJ ini tidak bisa dihapus.');
            return;
        }
        await deleteShipperReferenceNow(action.reference);
    };

    const getDisplayedActualCargoItemForManualEdit = (item: ActualCargoDraft): ActualCargoDraft => {
        const manualValues = actualCargoItemValueMap[item.deliveryOrderItemRef];
        if (manualValues) {
            return { ...item, ...manualValues };
        }
        if (!showAdvancedDropEditor) {
            return item;
        }

        const realizationAllocations = actualDropPoints
            .filter(drop => isDeliveryOrderBillableDropType(drop.stopType))
            .map(drop => pickActualDropItemValues(getActualDropAllocationForItem(drop, item)))
            .filter(values => hasActualDropItemValues(values));
        if (realizationAllocations.length === 0) {
            return item;
        }

        const actualQtyKoli = realizationAllocations.reduce(
            (sum, values) => sum + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
            0
        );
        const actualWeightKg = realizationAllocations.reduce(
            (sum, values) => sum + convertWeightToKg(
                parseFormattedNumberish(values.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                }),
                values.weightInputUnit
            ),
            0
        );
        const actualVolumeM3 = realizationAllocations.reduce(
            (sum, values) => sum + convertVolumeToM3(
                parseFormattedNumberish(values.volumeInputValue || 0, {
                    maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                values.volumeInputUnit
            ),
            0
        );

        return {
            ...item,
            actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
            actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
            actualVolumeInputValue: formatActualDropDraftNumber(
                actualVolumeM3 > 0 ? convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit) : undefined,
                item.actualVolumeInputUnit === 'LITER' ? 0 : 3
            ),
        };
    };

    const updateActualCargoDraft = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        const currentItem = actualCargoItems.find(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
        const buildNextItem = (item: ActualCargoDraft) => {
            if (field === 'actualQtyKoli') {
                return applyActualCargoAutoWeightFromQty(item, value);
            }
            return { ...item, [field]: value };
        };
        if (currentItem) {
            const displayedItem = getDisplayedActualCargoItemForManualEdit(currentItem);
            const nextItem = buildNextItem(displayedItem);
            setActualCargoItemValueMap(previous => {
                const nextManualValues = Object.assign({
                    actualQtyKoli: displayedItem.actualQtyKoli,
                    actualWeightInputValue: displayedItem.actualWeightInputValue,
                    actualWeightInputUnit: displayedItem.actualWeightInputUnit,
                    actualVolumeInputValue: displayedItem.actualVolumeInputValue,
                    actualVolumeInputUnit: displayedItem.actualVolumeInputUnit,
                }, previous[deliveryOrderItemRef] || {}) as ActualCargoItemValueDraft;
                return {
                    ...previous,
                    [deliveryOrderItemRef]: {
                        ...nextManualValues,
                        actualQtyKoli: nextItem.actualQtyKoli,
                        actualWeightInputValue: nextItem.actualWeightInputValue,
                        actualWeightInputUnit: nextItem.actualWeightInputUnit,
                        actualVolumeInputValue: nextItem.actualVolumeInputValue,
                        actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                    },
                };
            });
        }
        if (showAdvancedDropEditor) {
            return;
        }
        setActualCargoItems(previous =>
            previous.map(item =>
                item.deliveryOrderItemRef === deliveryOrderItemRef
                    ? buildNextItem(item)
                    : item
            )
        );
    };

    const updateActualCargoWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        if (showAdvancedDropEditor) {
            const currentItem = actualCargoItems.find(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
            if (!currentItem) {
                return;
            }
            const displayedItem = getDisplayedActualCargoItemForManualEdit(currentItem);
            const currentWeightInputValue = parseFormattedNumberish(displayedItem.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(displayedItem.actualWeightInputUnit),
            });
            const currentWeightKg = currentWeightInputValue > 0
                ? convertWeightToKg(currentWeightInputValue, displayedItem.actualWeightInputUnit)
                : 0;
            const nextItem = {
                ...displayedItem,
                actualWeightInputUnit: nextUnit,
                actualWeightInputValue: currentWeightKg > 0
                    ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit))
                    : '',
            };
            setActualCargoItemValueMap(current => ({
                ...current,
                [deliveryOrderItemRef]: {
                    actualQtyKoli: nextItem.actualQtyKoli,
                    actualWeightInputValue: nextItem.actualWeightInputValue,
                    actualWeightInputUnit: nextItem.actualWeightInputUnit,
                    actualVolumeInputValue: nextItem.actualVolumeInputValue,
                    actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                },
            }));
            return;
        }
        setActualCargoItems(previous =>
            previous.map(item => {
                if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                    return item;
                }
                const currentWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                });
                const currentWeightKg = currentWeightInputValue > 0
                    ? convertWeightToKg(currentWeightInputValue, item.actualWeightInputUnit)
                    : 0;
                const nextItem = {
                    ...item,
                    actualWeightInputUnit: nextUnit,
                    actualWeightInputValue: currentWeightKg > 0
                        ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit))
                        : '',
                };
                setActualCargoItemValueMap(current => ({
                    ...current,
                    [deliveryOrderItemRef]: {
                        actualQtyKoli: nextItem.actualQtyKoli,
                        actualWeightInputValue: nextItem.actualWeightInputValue,
                        actualWeightInputUnit: nextItem.actualWeightInputUnit,
                        actualVolumeInputValue: nextItem.actualVolumeInputValue,
                        actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                    },
                }));
                return nextItem;
            })
        );
    };

    const updateActualCargoVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        if (showAdvancedDropEditor) {
            const currentItem = actualCargoItems.find(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
            if (!currentItem) {
                return;
            }
            const displayedItem = getDisplayedActualCargoItemForManualEdit(currentItem);
            const nextItem = updateActualCargoDraftVolumeUnit(displayedItem, nextUnit);
            setActualCargoItemValueMap(current => ({
                ...current,
                [deliveryOrderItemRef]: {
                    actualQtyKoli: nextItem.actualQtyKoli,
                    actualWeightInputValue: nextItem.actualWeightInputValue,
                    actualWeightInputUnit: nextItem.actualWeightInputUnit,
                    actualVolumeInputValue: nextItem.actualVolumeInputValue,
                    actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                },
            }));
            return;
        }
        setActualCargoItems(previous =>
            previous.map(item => {
                if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                    return item;
                }
                const nextItem = updateActualCargoDraftVolumeUnit(item, nextUnit);
                setActualCargoItemValueMap(current => ({
                    ...current,
                    [deliveryOrderItemRef]: {
                        actualQtyKoli: nextItem.actualQtyKoli,
                        actualWeightInputValue: nextItem.actualWeightInputValue,
                        actualWeightInputUnit: nextItem.actualWeightInputUnit,
                        actualVolumeInputValue: nextItem.actualVolumeInputValue,
                        actualVolumeInputUnit: nextItem.actualVolumeInputUnit,
                    },
                }));
                return nextItem;
            })
        );
    };

    const getDeliveryOrderItemsForSuratJalanDocument = (document: SuratJalanDocument) => {
        const deliveryOrderId = doData?._id || '';
        const customerDoNumber = doData?.customerDoNumber || '';
        const documentReferenceKey = (document.referenceKey || '').trim();
        const documentNumber = (document.suratJalanNumber || '').trim().toUpperCase();
        const documentRefSuffix = deliveryOrderId && document._id.startsWith(`${deliveryOrderId}:`)
            ? document._id.slice(`${deliveryOrderId}:`.length)
            : '';

        return doItems.filter(item => {
            const itemReferenceKey = (item.shipperReferenceKey || '').trim();
            const itemReferenceNumber = (item.shipperReferenceNumber || customerDoNumber).trim().toUpperCase();
            return (
                (documentReferenceKey && documentReferenceKey !== 'primary' && itemReferenceKey === documentReferenceKey) ||
                (documentRefSuffix && documentRefSuffix !== 'primary' && itemReferenceKey === documentRefSuffix) ||
                (documentNumber && itemReferenceNumber === documentNumber) ||
                ((documentReferenceKey === 'primary' || documentRefSuffix === 'primary' || (!documentReferenceKey && !documentNumber)) && !itemReferenceKey && !itemReferenceNumber)
            );
        });
    };

    const getActualEditDropPointItemRefs = (point: { deliveryOrderItemRef?: string; deliveryOrderItemRefs?: string[] }) => [
        (point.deliveryOrderItemRef || '').trim(),
        ...((Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : [])
            .map(ref => (ref || '').trim())),
    ].filter((ref): ref is string => Boolean(ref));

    const getSuratJalanActualEditDropSourcePoints = (
        document: SuratJalanDocument,
        documentItems: DeliveryOrderItem[]
    ): NonNullable<DeliveryOrder['actualDropPoints']> => {
        const itemIds = new Set(documentItems.map(item => item._id));
        const itemReferenceKeys = new Set(documentItems.map(item => (item.shipperReferenceKey || '').trim()).filter(Boolean));
        const itemReferenceNumbers = new Set(
            documentItems
                .map(item => (item.shipperReferenceNumber || doData?.customerDoNumber || '').trim().toUpperCase())
                .filter(Boolean)
        );
        const documentReferenceKey = (document.referenceKey || '').trim();
        const documentNumber = (document.suratJalanNumber || '').trim().toUpperCase();

        return (doData?.actualDropPoints || []).filter(point => {
            if (!isDeliveryOrderBillableDropType(point.stopType)) {
                return false;
            }
            const pointItemRefs = getActualEditDropPointItemRefs(point);
            if (pointItemRefs.some(ref => itemIds.has(ref))) {
                return true;
            }
            const pointReferenceKey = (point.shipperReferenceKey || '').trim();
            const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
            return Boolean(
                (pointReferenceKey && (pointReferenceKey === documentReferenceKey || itemReferenceKeys.has(pointReferenceKey))) ||
                (pointReferenceNumber && (pointReferenceNumber === documentNumber || itemReferenceNumbers.has(pointReferenceNumber)))
            );
        });
    };

    const getFreightNotaItemRefs = (item: Pick<FreightNotaItem, 'deliveryOrderItemRef' | 'deliveryOrderItemRefs'>) => {
        const refs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
            ? item.deliveryOrderItemRefs
            : item.deliveryOrderItemRef
                ? [item.deliveryOrderItemRef]
                : [];
        return [...new Set(refs.map(ref => (ref || '').trim()).filter(Boolean))];
    };

    const tripFreightNotaById = new Map(tripFreightNotas.map(nota => [nota._id, nota]));
    const getFreightNotaItemDisplayNumber = (item: Pick<FreightNotaItem, 'notaRef'>) => {
        const nota = item.notaRef ? tripFreightNotaById.get(item.notaRef) : null;
        return nota?.notaDisplayNumber || nota?.notaNumber || item.notaRef || 'invoice terkait';
    };
    const getFreightNotaLinksForItems = (items: FreightNotaItem[]) => {
        const notaRefs = [...new Set(items.map(item => item.notaRef).filter(Boolean))];
        return notaRefs.map(notaRef => {
            const nota = tripFreightNotaById.get(notaRef);
            return {
                _id: notaRef,
                label: nota?.notaDisplayNumber || nota?.notaNumber || notaRef,
            };
        });
    };
    const renderFreightNotaLinks = (items: FreightNotaItem[]) => {
        const invoiceLinks = getFreightNotaLinksForItems(items);
        if (invoiceLinks.length === 0) {
            return null;
        }
        return (
            <span>
                {invoiceLinks.map((invoiceLink, index) => (
                    <span key={invoiceLink._id}>
                        {index > 0 ? ', ' : ''}
                        <Link href={withReturnTo(`/invoices/${invoiceLink._id}`)} style={{ color: 'var(--color-primary)' }}>
                            {invoiceLink.label}
                        </Link>
                    </span>
                ))}
            </span>
        );
    };
    const getFreightNotaItemsForActualDropPoint = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => {
        const pointKey = (point._key || '').trim();
        const pointItemRefs = new Set([
            point.deliveryOrderItemRef,
            ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
        ].map(ref => (ref || '').trim()).filter(Boolean));
        const pointNoSJ = (point.shipperReferenceNumber || '').trim().toUpperCase();
        return tripFreightNotaItems.filter(item => {
            const itemDropKey = (item.actualDropPointKey || '').trim();
            if (pointKey && itemDropKey && pointKey === itemDropKey) {
                return true;
            }
            const itemRefs = getFreightNotaItemRefs(item);
            if (itemRefs.some(ref => pointItemRefs.has(ref))) {
                return true;
            }
            const itemNoSJ = (item.noSJ || '').trim().toUpperCase();
            return Boolean(itemNoSJ && pointNoSJ && itemNoSJ === pointNoSJ);
        });
    };

    const getSuratJalanActualEditInvoiceLockItem = (document: SuratJalanDocument) => {
        const documentItems = getDeliveryOrderItemsForSuratJalanDocument(document);
        const documentItemIds = new Set(documentItems.map(item => item._id));
        const documentNumbers = new Set(
            [
                document.suratJalanNumber,
                ...documentItems.map(item => item.shipperReferenceNumber),
            ]
                .map(value => (value || '').trim().toUpperCase())
                .filter(Boolean)
        );
        const dropPointKeys = new Set<string>();
        getSuratJalanActualEditDropSourcePoints(document, documentItems).forEach((point, index) => {
            const explicitKey = (point._key || '').trim();
            if (explicitKey) {
                dropPointKeys.add(explicitKey);
            }
            if (point.sequence) {
                dropPointKeys.add(String(point.sequence));
            } else if (!explicitKey) {
                dropPointKeys.add(String(index));
            }
        });

        return tripFreightNotaItems.find(item => {
            if (item.status === 'VOID') {
                return false;
            }
            const itemRefs = getFreightNotaItemRefs(item);
            if (itemRefs.some(ref => documentItemIds.has(ref))) {
                return true;
            }
            const itemNoSJ = (item.noSJ || '').trim().toUpperCase();
            if (itemNoSJ && documentNumbers.has(itemNoSJ)) {
                return true;
            }
            const dropPointKey = (item.actualDropPointKey || '').trim();
            if (dropPointKey && dropPointKeys.has(dropPointKey)) {
                return true;
            }
            return itemRefs.length === 0 && !itemNoSJ && !dropPointKey;
        }) || null;
    };

    const getSuratJalanActualEditInvoiceLockMessage = (document: SuratJalanDocument) => {
        const lockItem = getSuratJalanActualEditInvoiceLockItem(document);
        return lockItem
            ? `SJ ini sudah masuk invoice ${getFreightNotaItemDisplayNumber(lockItem)}. Revisi atau batalkan invoice dulu jika data final perlu dikoreksi.`
            : '';
    };

    const openSuratJalanActualEditModal = (document?: SuratJalanDocument) => {
        if (!canManageDeliveryStatus || isTripClosedByAdmin) {
            return;
        }
        const targetDocument = document || suratJalanActualEditDocumentOptions[0];
        if (!targetDocument || targetDocument.tripStatus !== 'DELIVERED') {
            addToast('error', 'Pilih SJ delivered yang punya muatan aktual.');
            return;
        }
        openSuratJalanActualEditDocument(targetDocument);
    };

    const openSuratJalanActualEditDocument = (document: SuratJalanDocument) => {
        const invoiceLockMessage = getSuratJalanActualEditInvoiceLockMessage(document);
        if (invoiceLockMessage) {
            addToast('error', invoiceLockMessage);
            return;
        }
        const documentItems = getDeliveryOrderItemsForSuratJalanDocument(document);
        if (documentItems.length === 0) {
            addToast('error', 'Item SJ tidak ditemukan untuk diedit.');
            return;
        }
        const actualItemRefs = new Set(documentItems.filter(hasDeliveryOrderItemActualCargo).map(item => item._id));
        const editableItems = buildActualCargoDrafts(documentItems);
        const editableDropPoints = buildDefaultActualDropDrafts(
            doData,
            editableItems,
            getSuratJalanActualEditDropSourcePoints(document, documentItems)
        );
        const firstActualItem = editableItems.find(item => actualItemRefs.has(item.deliveryOrderItemRef));
        if (!firstActualItem) {
            addToast('error', 'SJ ini belum punya item terkirim aktual yang bisa diedit.');
            return;
        }
        setSelectedSuratJalanActualEditDocument(document);
        setSuratJalanActualEditItems(editableItems);
        setSuratJalanActualEditDropPoints(editableDropPoints);
        setSelectedSuratJalanActualEditItemRef(firstActualItem.deliveryOrderItemRef);
        setShowSuratJalanActualEditModal(true);
    };

    const closeSuratJalanActualEditModal = () => {
        if (savingSuratJalanActualEdit) {
            return;
        }
        setShowSuratJalanActualEditModal(false);
        setSelectedSuratJalanActualEditDocument(null);
        setSuratJalanActualEditItems([]);
        setSuratJalanActualEditDropPoints([]);
        setSelectedSuratJalanActualEditItemRef('');
    };

    const selectSuratJalanActualEditDocument = (documentId: string) => {
        const document = suratJalanActualEditDocumentOptions.find(item => item._id === documentId);
        if (document) {
            openSuratJalanActualEditDocument(document);
        }
    };

    const updateSuratJalanActualEditItem = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        setSuratJalanActualEditItems(previous => previous.map(item => {
            if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                return item;
            }
            if (field === 'actualQtyKoli') {
                return applyActualCargoAutoWeightFromQty(item, value);
            }
            return { ...item, [field]: value };
        }));
    };

    const updateSuratJalanActualEditWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        setSuratJalanActualEditItems(previous => previous.map(item => {
            if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                return item;
            }
            const currentWeightKg = convertWeightToKg(
                parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                }),
                item.actualWeightInputUnit
            );
            return {
                ...item,
                actualWeightInputUnit: nextUnit,
                actualWeightInputValue: currentWeightKg > 0 ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit)) : '',
            };
        }));
    };

    const updateSuratJalanActualEditVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        setSuratJalanActualEditItems(previous => previous.map(item => {
            if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                return item;
            }
            const currentVolumeM3 = convertVolumeToM3(
                parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                item.actualVolumeInputUnit
            );
            return {
                ...item,
                actualVolumeInputUnit: nextUnit,
                actualVolumeInputValue: formatActualDropDraftNumber(
                    currentVolumeM3 > 0 ? convertM3ToVolumeInputValue(currentVolumeM3, nextUnit) : undefined,
                    nextUnit === 'LITER' ? 0 : 3
                ),
            };
        }));
    };

    const updateSuratJalanActualEditDropPoint = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit'>,
        value: string
    ) => {
        setSuratJalanActualEditDropPoints(previous => previous.map(point => {
            if (point.draftKey !== draftKey) {
                return point;
            }
            const cargoItem = suratJalanActualEditItems.find(item => item.deliveryOrderItemRef === point.deliveryOrderItemRef);
            if (field === 'qtyKoli') {
                return applyActualDropAutoWeightFromQty(point, cargoItem, value);
            }
            if (field === 'weightInputUnit') {
                const currentWeightKg = convertWeightToKg(
                    parseFormattedNumberish(point.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                    }),
                    point.weightInputUnit
                );
                return {
                    ...point,
                    weightInputUnit: value as ActualDropDraft['weightInputUnit'],
                    weightInputValue: currentWeightKg > 0
                        ? String(convertKgToWeightInputValue(currentWeightKg, value as ActualDropDraft['weightInputUnit']))
                        : '',
                };
            }
            if (field === 'volumeInputUnit') {
                const nextUnit = value as ActualDropDraft['volumeInputUnit'];
                const currentVolumeM3 = convertVolumeToM3(
                    parseFormattedNumberish(point.volumeInputValue || 0, {
                        maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    point.volumeInputUnit
                );
                return {
                    ...point,
                    volumeInputUnit: nextUnit,
                    volumeInputValue: formatActualDropDraftNumber(
                        currentVolumeM3 > 0 ? convertM3ToVolumeInputValue(currentVolumeM3, nextUnit) : undefined,
                        nextUnit === 'LITER' ? 0 : 3
                    ),
                };
            }
            return { ...point, [field]: value };
        }));
    };

    const summarizeSuratJalanActualEditDropPointsForItem = (
        deliveryOrderItemRef: string,
        fallbackItem: ActualCargoDraft
    ) => {
        const itemDropPoints = suratJalanActualEditDropPoints.filter(point =>
            isDeliveryOrderBillableDropType(point.stopType) &&
            getActualEditDropPointItemRefs(point).includes(deliveryOrderItemRef)
        );
        if (itemDropPoints.length === 0) {
            return null;
        }
        const actualQtyKoli = itemDropPoints.reduce(
            (sum, point) => sum + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
            0
        );
        const actualWeightKg = itemDropPoints.reduce(
            (sum, point) => sum + convertWeightToKg(
                parseFormattedNumberish(point.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                }),
                point.weightInputUnit
            ),
            0
        );
        const actualVolumeM3 = itemDropPoints.reduce(
            (sum, point) => sum + convertVolumeToM3(
                parseFormattedNumberish(point.volumeInputValue || 0, {
                    maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                point.volumeInputUnit
            ),
            0
        );

        return {
            ...fallbackItem,
            actualQtyKoli: actualQtyKoli > 0 ? String(roundToPrecision(actualQtyKoli, 2)) : '',
            actualWeightInputValue: actualWeightKg > 0
                ? String(convertKgToWeightInputValue(actualWeightKg, fallbackItem.actualWeightInputUnit))
                : '',
            actualVolumeInputValue: actualVolumeM3 > 0
                ? formatActualDropDraftNumber(
                    convertM3ToVolumeInputValue(actualVolumeM3, fallbackItem.actualVolumeInputUnit),
                    fallbackItem.actualVolumeInputUnit === 'LITER' ? 0 : 3
                )
                : '',
        };
    };

    const buildSuratJalanActualEditItemPayload = () => {
        const canSendDropPointPayload = suratJalanActualEditSelectableItems.length > 0 && suratJalanActualEditSelectableItems.every(item =>
            suratJalanActualEditDropPoints.some(point =>
                isDeliveryOrderBillableDropType(point.stopType) &&
                getActualEditDropPointItemRefs(point).includes(item.deliveryOrderItemRef)
            )
        );
        const shouldSendDropPoints = suratJalanActualEditSelectableItems.some(item =>
            suratJalanActualEditDropPoints.filter(point =>
                isDeliveryOrderBillableDropType(point.stopType) &&
                getActualEditDropPointItemRefs(point).includes(item.deliveryOrderItemRef)
            ).length > 1
        ) && canSendDropPointPayload;
        const items = suratJalanActualEditItems.map(item =>
            shouldSendDropPoints
                ? summarizeSuratJalanActualEditDropPointsForItem(item.deliveryOrderItemRef, item) || item
                : item
        );

        return {
            shouldSendDropPoints,
            items,
        };
    };

    const saveSuratJalanActualEdit = async () => {
        if (!doData || !selectedSuratJalanActualEditDocument || !canManageDeliveryStatus || isTripClosedByAdmin) {
            return;
        }
        const actualEditPayload = buildSuratJalanActualEditItemPayload();
        const invalidItemIndex = actualEditPayload.items.findIndex(item => {
            const qty = parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 });
            const weight = convertWeightToKg(
                parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                }),
                item.actualWeightInputUnit
            );
            const volume = convertVolumeToM3(
                parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                item.actualVolumeInputUnit
            );
            return qty <= 0 && weight <= 0 && volume <= 0;
        });
        if (invalidItemIndex >= 0) {
            addToast('error', `Aktual item baris ${invalidItemIndex + 1} perlu isi qty, berat, atau volume.`);
            return;
        }

        setSavingSuratJalanActualEdit(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-surat-jalan-actual-cargo',
                    data: {
                        id: doData._id,
                        suratJalanRef: selectedSuratJalanActualEditDocument._id,
                        actualItems: actualEditPayload.items.map(item => ({
                            deliveryOrderItemRef: item.deliveryOrderItemRef,
                            actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                            actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue || 0, {
                                maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                            }),
                            actualWeightInputUnit: item.actualWeightInputUnit,
                            actualVolumeInputValue: parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                                maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                            }),
                            actualVolumeInputUnit: item.actualVolumeInputUnit,
                        })),
                        ...(actualEditPayload.shouldSendDropPoints
                            ? {
                                actualDropPoints: suratJalanActualEditDropPoints.map((point, index) => ({
                                    _key: point.draftKey,
                                    sequence: index + 1,
                                    stopType: point.stopType,
                                    deliveryOrderItemRef: point.deliveryOrderItemRef || undefined,
                                    shipperReferenceKey: point.shipperReferenceKey || undefined,
                                    shipperReferenceNumber: point.shipperReferenceNumber || undefined,
                                    billingCustomerRef: point.billingCustomerRef || undefined,
                                    billingCustomerName: point.billingCustomerName || undefined,
                                    originLocationName: point.originLocationName || undefined,
                                    originLocationAddress: point.originLocationAddress || undefined,
                                    locationName: point.locationName,
                                    locationAddress: point.locationAddress,
                                    qtyKoli: parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                                    weightInputValue: parseFormattedNumberish(point.weightInputValue || 0, {
                                        maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                                    }),
                                    weightInputUnit: point.weightInputUnit,
                                    volumeInputValue: parseFormattedNumberish(point.volumeInputValue || 0, {
                                        maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                                    }),
                                    volumeInputUnit: point.volumeInputUnit,
                                    note: point.note || undefined,
                                })),
                            }
                            : {}),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan aktual item SJ');
                return;
            }
            setShowSuratJalanActualEditModal(false);
            setSelectedSuratJalanActualEditDocument(null);
            setSuratJalanActualEditItems([]);
            setSuratJalanActualEditDropPoints([]);
            setSelectedSuratJalanActualEditItemRef('');
            await refreshTripDetail();
            addToast('success', 'Aktual item SJ berhasil diperbarui');
        } catch {
            addToast('error', 'Gagal menyimpan aktual item SJ');
        } finally {
            setSavingSuratJalanActualEdit(false);
        }
    };

    const updateActualDropDraft = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'shipperReferenceKey' | 'shipperReferenceNumber' | 'billingCustomerRef' | 'billingCustomerName' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        const buildNextDrop = (drop: ActualDropDraft) => {
            const selectedCargoItem = drop.deliveryOrderItemRef
                ? actualCargoItems.find(item => item.deliveryOrderItemRef === drop.deliveryOrderItemRef)
                : undefined;
            if (field === 'qtyKoli') {
                return applyActualDropAutoWeightFromQty(drop, selectedCargoItem, value);
            }
            if (field === 'weightInputUnit') {
                return updateActualDropDraftWeightUnit(drop, value as ActualDropDraft['weightInputUnit']);
            }
            return { ...drop, [field]: value };
        };
        if (field === 'qtyKoli' || field === 'weightInputValue' || field === 'weightInputUnit' || field === 'volumeInputValue' || field === 'volumeInputUnit') {
            const currentDrop = actualDropPoints.find(item => item.draftKey === draftKey);
            if (currentDrop?.deliveryOrderItemRef) {
                const nextDrop = buildNextDrop(currentDrop);
                const valueKey = buildActualDropItemValueKey(draftKey, currentDrop.deliveryOrderItemRef);
                setActualDropItemValueMap(previous => ({
                    ...previous,
                    [valueKey]: pickActualDropItemValues(nextDrop),
                }));
            }
        }
        setActualDropPoints(previous =>
            previous.map(item => (item.draftKey === draftKey ? buildNextDrop(item) : item))
        );
    };

    function getActualDropAllocationForItem(drop: ActualDropDraft, cargoItem: ActualCargoDraft): ActualDropDraft {
        const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        const cachedValues = actualDropItemValueMap[valueKey];
        const baseDrop = {
            ...drop,
            deliveryOrderItemRef: cargoItem.deliveryOrderItemRef,
            shipperReferenceKey: cargoItem.shipperReferenceKey || drop.shipperReferenceKey,
            shipperReferenceNumber: cargoItem.shipperReferenceNumber || drop.shipperReferenceNumber,
        };
        const dropReferenceKey = drop.shipperReferenceKey.trim();
        const dropReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
        const cargoReferenceKey = cargoItem.shipperReferenceKey.trim();
        const cargoReferenceNumber = cargoItem.shipperReferenceNumber.trim().toUpperCase();
        const hasDropReferenceTarget = Boolean(dropReferenceKey || dropReferenceNumber);
        const dropReferenceMatchesCargo =
            !hasDropReferenceTarget ||
            (dropReferenceKey && cargoReferenceKey === dropReferenceKey) ||
            (dropReferenceNumber && cargoReferenceNumber === dropReferenceNumber);
        if (!drop.deliveryOrderItemRef && !dropReferenceMatchesCargo) {
            return {
                ...baseDrop,
                qtyKoli: '',
                weightInputValue: '',
                volumeInputValue: '',
            };
        }
        if (Object.prototype.hasOwnProperty.call(actualDropItemValueMap, valueKey) && cachedValues) {
            return { ...baseDrop, ...cachedValues };
        }
        if (drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef) {
            return baseDrop;
        }
        if (drop.deliveryOrderItemRef && drop.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef) {
            return {
                ...baseDrop,
                qtyKoli: '',
                weightInputValue: '',
                volumeInputValue: '',
            };
        }
        const remainingValues = getRemainingActualDropValuesForCargoItem(cargoItem, drop, drop.draftKey);
        return {
            ...baseDrop,
            ...remainingValues,
        };
    }

    const updateActualDropAllocationForItem = (
        drop: ActualDropDraft,
        cargoItem: ActualCargoDraft,
        field: keyof ActualDropItemValueDraft,
        value: string
    ) => {
        if (reviewingDriverRequest) {
            driverReviewDropEditedRef.current = true;
        }
        const currentAllocation = getActualDropAllocationForItem(drop, cargoItem);
        const nextAllocation =
            field === 'qtyKoli'
                ? applyActualDropAutoWeightFromQty(currentAllocation, cargoItem, value)
                : field === 'weightInputUnit'
                    ? updateActualDropDraftWeightUnit(currentAllocation, value as ActualDropDraft['weightInputUnit'])
                    : field === 'volumeInputUnit'
                        ? updateActualDropDraftVolumeUnit(currentAllocation, value as ActualDropDraft['volumeInputUnit'])
                    : { ...currentAllocation, [field]: value };
        const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        setActualDropItemValueMap(previous => ({
            ...previous,
            [valueKey]: pickActualDropItemValues(nextAllocation),
        }));
        setActualDropPoints(previous => previous.map(item =>
            item.draftKey === drop.draftKey && item.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef
                ? { ...item, ...pickActualDropItemValues(nextAllocation) }
                : item
        ));
    };

    const persistActualDropAllocationsForItems = (
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => {
        const nextAllocationEntries = cargoItems
            .map(cargoItem => ({
                itemRef: cargoItem.deliveryOrderItemRef,
                values: pickActualDropItemValues(getActualDropAllocationForItem(drop, cargoItem)),
            }))
            .filter(entry => hasActualDropItemInput(entry.values));
        const nextAllocationByItemRef = new Map(
            nextAllocationEntries.map(entry => [entry.itemRef, entry.values])
        );
        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            cargoItems.forEach(cargoItem => {
                const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
                const allocationValues = nextAllocationByItemRef.get(cargoItem.deliveryOrderItemRef);
                if (allocationValues) {
                    next[valueKey] = allocationValues;
                } else {
                    delete next[valueKey];
                }
            });
            return next;
        });
        setActualDropPoints(previous => previous.map(item => {
            if (item.draftKey !== drop.draftKey) {
                return item;
            }
            const visibleItemRef =
                item.deliveryOrderItemRef && nextAllocationByItemRef.has(item.deliveryOrderItemRef)
                    ? item.deliveryOrderItemRef
                    : Array.from(nextAllocationByItemRef.keys())[0] || item.deliveryOrderItemRef;
            const visibleAllocation = visibleItemRef ? nextAllocationByItemRef.get(visibleItemRef) : undefined;
            return visibleAllocation
                ? { ...item, deliveryOrderItemRef: visibleItemRef, ...visibleAllocation }
                : item;
        }));
    };

    const buildActualDropAllocationEntriesForItems = (
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[],
        valueMap: Record<string, ActualDropItemValueDraft> = actualDropItemValueMap,
        sourceDropPoints: ActualDropDraft[] = actualDropPoints
    ) =>
        cargoItems
            .map(cargoItem => {
                const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
                const existingValues = valueMap[valueKey];
                const values = existingValues && hasActualDropItemInput(existingValues)
                    ? existingValues
                    : drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef && hasActualDropItemInput(pickActualDropItemValues(drop))
                        ? pickActualDropItemValues(drop)
                        : getRemainingActualDropValuesForCargoItem(cargoItem, drop, drop.draftKey, sourceDropPoints, valueMap);
                return {
                    itemRef: cargoItem.deliveryOrderItemRef,
                    valueKey,
                    isExplicit: Boolean(
                        (existingValues && hasActualDropItemInput(existingValues)) ||
                        (
                            drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef &&
                            hasActualDropItemInput(pickActualDropItemValues(drop))
                        )
                    ),
                    values,
                };
            })
            .filter(entry => entry.isExplicit || hasActualDropItemValues(entry.values));

    const ensureActualDropAllocationsForItems = (
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => {
        const allocationEntries = buildActualDropAllocationEntriesForItems(drop, cargoItems);
        const firstAllocatedItemRef = allocationEntries[0]?.itemRef || '';

        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            allocationEntries.forEach(entry => {
                next[entry.valueKey] = entry.values;
            });
            return next;
        });
        setActualDropPoints(previous => previous.map(item => {
            if (item.draftKey !== drop.draftKey || !firstAllocatedItemRef) {
                return item;
            }
            const firstVisibleEntry =
                allocationEntries.find(entry => hasActualDropItemValues(entry.values)) ||
                allocationEntries[0];
            const firstAllocation = firstVisibleEntry?.values;
            return firstAllocation
                ? { ...item, deliveryOrderItemRef: firstVisibleEntry.itemRef, ...firstAllocation }
                : item;
        }));
    };

    const materializeImplicitActualDropAllocations = (
        drops: ActualDropDraft[],
        cargoItems: ActualCargoDraft[]
    ) => {
        const nextValueMap = { ...actualDropItemValueMap };
        const nextDrops = drops.map(drop => {
            const allocationEntries = buildActualDropAllocationEntriesForItems(drop, cargoItems, nextValueMap, drops);
            const firstVisibleEntry =
                allocationEntries.find(entry => hasActualDropItemValues(entry.values)) ||
                allocationEntries[0];
            const firstAllocatedItemRef = firstVisibleEntry?.itemRef || '';
            const firstAllocation = firstVisibleEntry?.values;

            allocationEntries.forEach(entry => {
                nextValueMap[entry.valueKey] = entry.values;
            });

            return firstAllocatedItemRef && firstAllocation
                ? {
                    ...drop,
                    deliveryOrderItemRef: firstAllocatedItemRef,
                    ...firstAllocation,
                }
                : drop;
        });

        return { drops: nextDrops, valueMap: nextValueMap };
    };

    const getDefaultFinalizationCargoItemRef = (
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => (
        cargoItems.find(cargoItem =>
            hasActualDropItemValues(pickActualDropItemValues(getActualDropAllocationForItem(drop, cargoItem)))
        ) || cargoItems[0]
    )?.deliveryOrderItemRef || '';

    const getRemainingActualDropValuesForCargoItem = (
        cargoItem: ActualCargoDraft,
        fallback: Pick<ActualDropDraft, 'weightInputUnit' | 'volumeInputUnit'>,
        excludeDraftKey = '',
        sourceDropPoints: ActualDropDraft[] = actualDropPoints,
        sourceValueMap: Record<string, ActualDropItemValueDraft> = actualDropItemValueMap
    ) => {
        const weightInputUnit = cargoItem.actualWeightInputUnit || fallback.weightInputUnit;
        const volumeInputUnit = cargoItem.actualVolumeInputUnit || fallback.volumeInputUnit;
        const baseQtyKoli = parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 });
        const baseWeightKg = convertWeightToKg(
            parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(cargoItem.actualWeightInputUnit),
            }),
            cargoItem.actualWeightInputUnit
        );
        const baseVolumeM3 = convertVolumeToM3(
            parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            cargoItem.actualVolumeInputUnit
        );
        const usedAllocationByKey = new Map<string, ActualDropItemValueDraft>();
        sourceDropPoints.forEach(drop => {
            if (drop.draftKey === excludeDraftKey || drop.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef) {
                return;
            }
            const values = pickActualDropItemValues(drop);
            if (hasActualDropItemValues(values)) {
                usedAllocationByKey.set(buildActualDropItemValueKey(drop.draftKey, drop.deliveryOrderItemRef), values);
            }
        });
        Object.entries(sourceValueMap).forEach(([valueKey, cachedValues]) => {
            const parsedKey = parseActualDropItemValueKey(valueKey);
            if (
                !parsedKey ||
                parsedKey.draftKey === excludeDraftKey ||
                parsedKey.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef
            ) {
                return;
            }
            if (hasActualDropItemValues(cachedValues)) {
                usedAllocationByKey.set(valueKey, cachedValues);
            } else {
                usedAllocationByKey.delete(valueKey);
            }
        });
        const used = Array.from(usedAllocationByKey.values())
            .reduce((sum, values) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(values.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                    }),
                    values.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(values.volumeInputValue || 0, {
                        maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    values.volumeInputUnit
                ),
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const remainingQtyKoli = Math.max(baseQtyKoli - used.qtyKoli, 0);
        const remainingWeightKg = Math.max(baseWeightKg - used.weightKg, 0);
        const remainingVolumeM3 = Math.max(baseVolumeM3 - used.volumeM3, 0);

        return {
            qtyKoli: remainingQtyKoli > 0 ? String(remainingQtyKoli) : '',
            weightInputValue: remainingWeightKg > 0 ? String(convertKgToWeightInputValue(remainingWeightKg, weightInputUnit)) : '',
            weightInputUnit,
            volumeInputValue: formatActualDropDraftNumber(
                remainingVolumeM3 > 0 ? convertM3ToVolumeInputValue(remainingVolumeM3, volumeInputUnit) : undefined,
                volumeInputUnit === 'LITER' ? 0 : 3
            ),
            volumeInputUnit,
        };
    };

    const toggleAdvancedDropEditor = () => {
        if (showAdvancedDropEditor) {
            setShowAdvancedDropEditor(false);
            return;
        }
        setShowAdvancedDropEditor(true);
    };

    const addActualDropDraft = () => {
        const nextDraft = createEmptyActualDropDraft();
        const candidateCargoItems = selectedActualCargoItems.length > 0
            ? selectedActualCargoItems
            : actualCargoItems;
        const materialized = materializeImplicitActualDropAllocations(actualDropPoints, candidateCargoItems);
        const firstCargoItem =
            candidateCargoItems.find(cargoItem =>
                hasActualDropItemValues(getRemainingActualDropValuesForCargoItem(
                    cargoItem,
                    nextDraft,
                    nextDraft.draftKey,
                    materialized.drops,
                    materialized.valueMap
                ))
            ) || candidateCargoItems[0];
        const selectedReference = firstCargoItem
            ? selectedActualDropShipperReferenceOptions.find(reference =>
                (reference.referenceKey && reference.referenceKey === firstCargoItem.shipperReferenceKey) ||
                (reference.referenceNumber && reference.referenceNumber.trim().toUpperCase() === firstCargoItem.shipperReferenceNumber.trim().toUpperCase())
            ) || selectedActualDropShipperReferenceOptions[0]
            : selectedActualDropShipperReferenceOptions[0];
        const baseDraft = selectedReference
            ? {
                ...nextDraft,
                locationName:
                    selectedReference.receiverCompany?.trim()
                    || selectedReference.receiverName?.trim()
                    || selectedReference.receiverAddress?.trim()
                    || nextDraft.locationName,
                locationAddress: selectedReference.receiverAddress || nextDraft.locationAddress,
            }
            : nextDraft;
        const allocationEntries = buildActualDropAllocationEntriesForItems(
            baseDraft,
            candidateCargoItems,
            materialized.valueMap,
            materialized.drops
        );
        const firstVisibleEntry =
            allocationEntries.find(entry => hasActualDropItemValues(entry.values)) ||
            allocationEntries[0];
        const nextVisibleDraft = firstVisibleEntry
            ? {
                ...baseDraft,
                deliveryOrderItemRef: firstVisibleEntry.itemRef,
                ...firstVisibleEntry.values,
            }
            : baseDraft;
        setActualDropPoints([
            ...materialized.drops,
            nextVisibleDraft,
        ]);
        setActualDropItemValueMap(() => {
            const next = { ...materialized.valueMap };
            allocationEntries.forEach(entry => {
                next[entry.valueKey] = entry.values;
            });
            return next;
        });
    };

    const removeActualDropDraft = (draftKey: string) => {
        setActualDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            Object.keys(next)
                .filter(key => key.startsWith(`${draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}`))
                .forEach(key => {
                    delete next[key];
                });
            return next;
        });
    };

    useEffect(() => {
        void loadDO('initial');
    }, [loadDO]);

    const rememberStatusModalScrollPosition = useCallback(() => {
        statusModalScrollTopRef.current = statusModalBodyRef.current?.scrollTop ?? statusModalScrollTopRef.current;
    }, []);

    const reopenStatusModalWithSavedScroll = useCallback(() => {
        shouldRestoreStatusModalScrollRef.current = true;
        setShowStatusModal(true);
    }, []);

    const rememberActualCargoModalScrollPosition = useCallback(() => {
        actualCargoModalScrollTopRef.current = actualCargoModalBodyRef.current?.scrollTop ?? actualCargoModalScrollTopRef.current;
    }, []);

    const restoreActualCargoModalScrollOnNextFrame = useCallback(() => {
        shouldRestoreActualCargoModalScrollRef.current = true;
    }, []);

    const restoreActualCargoModalScroll = useCallback(() => {
        const scrollTop = actualCargoModalScrollTopRef.current;
        const restore = () => {
            if (actualCargoModalBodyRef.current) {
                actualCargoModalBodyRef.current.scrollTop = scrollTop;
            }
        };
        window.requestAnimationFrame(() => {
            restore();
            window.requestAnimationFrame(restore);
        });
    }, []);

    useEffect(() => {
        if (!showStatusModal || !shouldRestoreStatusModalScrollRef.current) {
            return;
        }

        const animationFrameId = window.requestAnimationFrame(() => {
            if (statusModalBodyRef.current) {
                statusModalBodyRef.current.scrollTop = statusModalScrollTopRef.current;
            }
            shouldRestoreStatusModalScrollRef.current = false;
        });

        return () => window.cancelAnimationFrame(animationFrameId);
    }, [showStatusModal]);

    useEffect(() => {
        if (!showActualCargoFinalizationModal || !shouldRestoreActualCargoModalScrollRef.current) {
            return;
        }

        const animationFrameId = window.requestAnimationFrame(() => {
            restoreActualCargoModalScroll();
            shouldRestoreActualCargoModalScrollRef.current = false;
        });

        return () => window.cancelAnimationFrame(animationFrameId);
    }, [showActualCargoFinalizationModal, activeFinalizationDropKey, restoreActualCargoModalScroll]);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            if (editingTaripRef.current || hasOpenModal || document.hidden) {
                return;
            }
            void loadDO();
        }, 15000);

        return () => window.clearInterval(intervalId);
    }, [hasOpenModal, loadDO]);

    const updateDOStatus = async () => {
        if (!newStatus) return;
        const completingDelivery = newStatus === 'DELIVERED';
        const selectedCount = selectedStatusSuratJalanRefs.length;
        setUpdatingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-surat-jalan-status-batch',
                    data: {
                        id: doData?._id,
                        status: newStatus,
                        note: statusNote,
                        targetSuratJalanRefs: selectedStatusSuratJalanRefs,
                        approveDriverRequest: reviewingDriverRequest,
                        pendingDriverRequestId: reviewingDriverRequestId || undefined,
                        closeTripOnApprove: false,
                        ...(completingDelivery
                            ? {
                                podReceiverName: podName,
                                podReceivedDate: podDate,
                                podNote,
                                actualItems: selectedDerivedActualCargoItems.map(item => ({
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli),
                                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue, {
                                        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                                    }),
                                    actualWeightInputUnit: item.actualWeightInputUnit,
                                    actualVolumeInputValue: item.actualVolumeInputValue.trim()
                                        ? parseFormattedNumberish(item.actualVolumeInputValue, {
                                            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                        })
                                        : 0,
                                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                                })),
                                actualDropPoints: selectedSubmissionActualDropPoints.map(item => ({
                                    stopType: item.stopType,
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    deliveryOrderItemRefs: Array.isArray((item as ActualDropDraft & { deliveryOrderItemRefs?: string[] }).deliveryOrderItemRefs)
                                        ? (item as ActualDropDraft & { deliveryOrderItemRefs?: string[] }).deliveryOrderItemRefs
                                        : undefined,
                                    actualDropGroupKey: reviewingDriverRequest ? (item.actualDropGroupKey || item.draftKey) : undefined,
                                    shipperReferenceKey: item.shipperReferenceKey,
                                    shipperReferenceNumber: item.shipperReferenceNumber,
                                    billingCustomerRef: item.billingCustomerRef,
                                    billingCustomerName: item.billingCustomerName,
                                    originLocationName: item.originLocationName,
                                    originLocationAddress: item.originLocationAddress,
                                    locationName: item.locationName,
                                    locationAddress: item.locationAddress,
                                    qtyKoli: item.qtyKoli.trim() ? parseFormattedNumberish(item.qtyKoli) : 0,
                                    weightInputValue: item.weightInputValue.trim()
                                        ? parseFormattedNumberish(item.weightInputValue, {
                                            maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                                        })
                                        : 0,
                                    weightInputUnit: item.weightInputUnit,
                                    volumeInputValue: item.volumeInputValue.trim()
                                        ? parseFormattedNumberish(item.volumeInputValue, {
                                            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                                        })
                                        : 0,
                                    volumeInputUnit: item.volumeInputUnit,
                                    note: item.note,
                                })),
                            }
                            : {}),
                    },
                }),
            });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal memperbarui status surat jalan');
                return;
            }

            setShowStatusModal(false);
            setShowActualCargoFinalizationModal(false);
            setNewStatus('');
            setStatusNote('');
            setReviewingDriverRequest(false);
            setReviewingDriverRequestId('');
            setActiveFinalizationCargoItemRef('');
            setActiveFinalizationDropKey('');
            if (completingDelivery) {
                setPodName('');
                setPodDate(getBusinessDateValue());
                setPodNote('');
            }
            setSelectedStatusSuratJalanRefs([]);
            await refreshTripDetail();
            addToast(
                'success',
                completingDelivery
                    ? `${selectedCount} SJ berhasil difinalkan dan POD tersimpan`
                    : `${selectedCount} SJ berhasil dipindahkan ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`
            );
        } catch {
            addToast('error', 'Gagal memperbarui batch surat jalan');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const cancelTrip = async () => {
        if (!doData?._id || !canManageDeliveryStatus) return;
        const shouldSubmitCancelExpense = canRecordCancelTripExpense && cancelTripExpenseForm.amount > 0;
        if (shouldSubmitCancelExpense && !cancelTripExpenseForm.categoryRef) {
            addToast('error', 'Pilih kategori pengeluaran biaya batal trip');
            return;
        }
        if (shouldSubmitCancelExpense && !cancelTripExpenseForm.bankAccountRef) {
            addToast('error', 'Pilih kas / bank untuk biaya batal trip');
            return;
        }
        const cancelExpenseDescription =
            cancelTripExpenseForm.description.trim() ||
            `Biaya pembatalan trip ${displayTripNumber}`;
        setCancellingTrip(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'cancel-trip',
                    data: {
                        id: doData._id,
                        note: cancelTripNote,
                        ...(shouldSubmitCancelExpense
                            ? {
                                cancelExpenseDate: cancelTripExpenseForm.expenseDate,
                                cancelExpenseCategoryRef: cancelTripExpenseForm.categoryRef,
                                cancelExpenseBankAccountRef: cancelTripExpenseForm.bankAccountRef,
                                cancelExpenseDescription,
                                cancelExpenseAmount: cancelTripExpenseForm.amount,
                            }
                            : {}),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal membatalkan trip');
                return;
            }
            setShowCancelTripModal(false);
            setCancelTripNote('');
            setCancelTripExpenseForm(createDefaultCancelTripExpenseForm());
            await refreshTripDetail();
            const cancelledCount = Number(result.data?.cancelledSuratJalanCount || 0);
            const cancelExpenseAmount = Number(result.data?.cancelExpenseAmount || 0);
            addToast(
                'success',
                `Trip dibatalkan${cancelledCount > 0 ? `, ${cancelledCount} SJ ikut batal` : ''}${cancelExpenseAmount > 0 ? `, biaya batal ${formatCurrency(cancelExpenseAmount)} masuk pengeluaran` : ''}`
            );
        } catch {
            addToast('error', 'Gagal membatalkan trip');
        } finally {
            setCancellingTrip(false);
        }
    };

    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan cetak surat jalan...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const company = resolveDocumentIssuerProfile(doData, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({
                title: 'Surat Jalan',
                subtitle: displayTripNumber,
                company,
                targetWindow: printWindow,
                bodyHtml: doData ? buildDeliveryOrderPrintHtml(doData, doItems, trackingLogs) : '',
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const handleExportPDF = async () => {
        try {
            const companyData = await fetchCompanyProfile().catch(() => null);
            const issuerCompany = resolveDocumentIssuerProfile(doData, companyData as CompanyProfile | null);
            if (!issuerCompany) {
                throw new Error('Profil perusahaan tidak tersedia');
            }
            generateDOPdf(doData!, doItems, issuerCompany);
            addToast('success', 'PDF Surat Jalan berhasil di-download');
        } catch (err) {
            console.error('PDF Export Error:', err);
            addToast('error', `Gagal membuat PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
    };

    const saveTaripBorongan = async () => {
        setSavingTarip(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update',
                    data: buildDeliveryOrderTripFeeUpdateData({
                        id: doData?._id,
                        tripRouteRateRef,
                        tripOriginArea,
                        tripDestinationArea,
                        taripBorongan: matchedTripRouteRate?.rate ?? taripBorongan,
                        keteranganBorongan,
                    }),
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan upah trip');
                return;
            }
            setEditingTarip(false);
            await refreshTripDetail();
            addToast('success', 'Upah trip disimpan');
        } catch {
            addToast('error', 'Gagal menyimpan upah trip');
        } finally {
            setSavingTarip(false);
        }
    };

    const updateManualOvertonaseWeightUnit = (nextUnit: WeightInputUnit) => {
        const currentWeightKg = convertWeightToKg(
            parseFormattedNumberish(manualOvertonaseWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(manualOvertonaseWeightInputUnit),
            }),
            manualOvertonaseWeightInputUnit
        );
        setManualOvertonaseWeightInputUnit(nextUnit);
        setManualOvertonaseWeightInputValue(currentWeightKg > 0 ? convertKgToWeightInputValue(currentWeightKg, nextUnit) : 0);
    };

    const getManualOvertonasePreview = (clearManualValue = false) => {
        if (!doData) {
            return null;
        }
        const inputWeight = parseFormattedNumberish(manualOvertonaseWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(manualOvertonaseWeightInputUnit),
        });
        const manualWeightKg = clearManualValue
            ? 0
            : roundToPrecision(convertWeightToKg(inputWeight, manualOvertonaseWeightInputUnit), 2);
        const actualTotalWeightKg = doData.actualTotalWeightKg || 0;
        const serviceMaxPayloadKg = doData.serviceMaxPayloadKg || 0;
        const automaticOvertonaseWeightKg =
            actualTotalWeightKg > 0 && serviceMaxPayloadKg > 0
                ? Math.max(roundToPrecision(actualTotalWeightKg - serviceMaxPayloadKg, 2), 0)
                : 0;
        const nextOvertonaseWeightKg = manualWeightKg > 0 ? manualWeightKg : automaticOvertonaseWeightKg;
        const nextPayableTon = Math.floor(nextOvertonaseWeightKg / 1000);
        const currentPayableTon = Math.floor((doData.overtonaseWeightKg || 0) / 1000);
        const ratePerKg = doData.overtonaseDriverRatePerKg || 0;
        const ratePerTon = Math.round(ratePerKg * 1000);
        const nextDriverAmount = nextPayableTon > 0 && ratePerKg > 0
            ? Math.round(nextPayableTon * 1000 * ratePerKg)
            : 0;
        const baseFee = doData.baseTaripBorongan ?? doData.taripBorongan ?? 0;

        return {
            manualWeightKg,
            automaticOvertonaseWeightKg,
            nextOvertonaseWeightKg,
            nextPayableTon,
            currentPayableTon,
            ratePerTon,
            nextDriverAmount,
            currentDriverAmount: doData.overtonaseDriverAmount || 0,
            baseFee,
            currentTripFee: doData.taripBorongan || 0,
            nextTripFee: baseFee > 0 ? baseFee + nextDriverAmount : nextDriverAmount,
            modeLabel: manualWeightKg > 0 ? 'Manual' : 'Otomatis',
        };
    };

    const openManualOvertonaseReview = (clearManualValue = false) => {
        if (!doData?._id || !canManageTripFee || isTripClosedByAdmin) return;
        setManualOvertonaseWeightInputUnit('KG');
        setManualOvertonaseWeightInputValue(clearManualValue ? 0 : doData.manualOvertonaseWeightKg || 0);
        setManualOvertonaseReviewMode(clearManualValue ? 'automatic' : 'manual');
    };

    const saveManualOvertonase = async (clearManualValue = false) => {
        if (!doData?._id || !canManageTripFee || isTripClosedByAdmin) return;
        const preview = getManualOvertonasePreview(clearManualValue);
        if (!clearManualValue && (!preview || preview.manualWeightKg <= 0)) {
            addToast('error', 'Isi berat manual lebih dari 0, atau gunakan mode otomatis.');
            return;
        }
        setSavingManualOvertonase(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-manual-overtonase',
                    data: {
                        id: doData._id,
                        manualOvertonaseWeightInputValue: clearManualValue ? 0 : manualOvertonaseWeightInputValue,
                        manualOvertonaseWeightInputUnit,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan overtonase manual');
                return;
            }
            setManualOvertonaseReviewMode(null);
            await refreshTripDetail();
            const warning = result.data?.settledVoucherOvertonageWarning;
            if (warning) {
                addToast('warning', warning);
            } else if (result.data?.linkedVoucherAdjustmentSummary) {
                addToast('success', `Overtonase disimpan, ${result.data.linkedVoucherAdjustmentSummary}`);
            } else {
                addToast('success', clearManualValue ? 'Overtonase kembali ke hitungan otomatis' : 'Overtonase manual disimpan');
            }
        } catch {
            addToast('error', 'Gagal menyimpan overtonase manual');
        } finally {
            setSavingManualOvertonase(false);
        }
    };

    const saveTripResources = async () => {
        if (!tripVehicleRef && !tripDriverRef) {
            addToast('error', 'Pilih kendaraan dan/atau supir untuk trip ini');
            return;
        }

        setSavingTripResources(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'assign-trip-resources',
                    data: {
                        id: doData?._id,
                        vehicleRef: tripVehicleRef || undefined,
                        driverRef: tripDriverRef || undefined,
                        vehicleCategoryOverrideReason: requiresTripVehicleOverrideReason
                            ? tripVehicleOverrideReason
                            : undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal melengkapi armada trip');
                return;
            }
            setShowTripResourcesModal(false);
            await refreshTripDetail();
            addToast('success', 'Armada trip berhasil diperbarui');
        } catch {
            addToast('error', 'Gagal melengkapi armada trip');
        } finally {
            setSavingTripResources(false);
        }
    };

    const handleIssueTripCash = async () => {
        if (!doData || !canCreateTripCash || linkedVoucher || linkedTripCashLink) return;
        if (!tripCashIssueForm.vehicleRef) {
            addToast('error', 'Pilih kendaraan trip');
            return;
        }
        if (!tripCashIssueForm.driverRef) {
            addToast('error', 'Pilih supir trip');
            return;
        }
        if (!tripCashIssueForm.issueBankRef) {
            addToast('error', 'Pilih kas / bank uang jalan');
            return;
        }
        if (!tripCashIssueForm.cashGiven || tripCashIssueForm.cashGiven <= 0) {
            addToast('error', 'Uang jalan awal wajib diisi');
            return;
        }

        const selectedVehicle = vehicles.find(vehicle => vehicle._id === tripCashIssueForm.vehicleRef) || null;
        const requiresOverride = shouldRequireTripVehicleOverrideReason(doData, selectedVehicle);
        if (requiresOverride && !tripCashIssueForm.vehicleCategoryOverrideReason.trim()) {
            addToast('error', 'Alasan override armada wajib diisi');
            return;
        }

        const matchedRate = findMatchingTripRouteRate(tripRouteRates, {
            originArea: tripCashIssueForm.tripOriginArea,
            destinationArea: tripCashIssueForm.tripDestinationArea,
            serviceRef: doData.serviceRef,
        });
        const nextTripFee = matchedRate?.rate ?? tripCashIssueForm.taripBorongan;
        if (!Number.isFinite(nextTripFee) || nextTripFee <= 0) {
            addToast('error', 'Upah borongan wajib diisi');
            return;
        }

        setIssuingTripCash(true);
        try {
            const nextOverrideReason = requiresOverride
                ? tripCashIssueForm.vehicleCategoryOverrideReason.trim()
                : '';
            const resourceChanged =
                tripCashIssueForm.vehicleRef !== (doData.vehicleRef || '') ||
                tripCashIssueForm.driverRef !== (doData.driverRef || '') ||
                nextOverrideReason !== (doData.vehicleCategoryOverrideReason || '');

            if (resourceChanged) {
                const resourceRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'assign-trip-resources',
                        data: {
                            id: doData._id,
                            vehicleRef: tripCashIssueForm.vehicleRef,
                            driverRef: tripCashIssueForm.driverRef,
                            vehicleCategoryOverrideReason: requiresOverride
                                ? nextOverrideReason
                                : undefined,
                        },
                    }),
                });
                const resourceResult = await resourceRes.json();
                if (!resourceRes.ok) {
                    addToast('error', resourceResult.error || 'Gagal menyimpan armada trip');
                    return;
                }
            }

            const nextTripRouteRateRef = matchedRate?._id || tripCashIssueForm.tripRouteRateRef || '';
            const currentBaseTripFee = (doData.baseTaripBorongan ?? doData.taripBorongan) || 0;
            const feeChanged =
                (tripCashIssueForm.tripOriginArea || '') !== (doData.tripOriginArea || '') ||
                (tripCashIssueForm.tripDestinationArea || '') !== (doData.tripDestinationArea || '') ||
                nextTripRouteRateRef !== (doData.tripRouteRateRef || '') ||
                Math.abs(nextTripFee - currentBaseTripFee) > 0.01 ||
                (tripCashIssueForm.keteranganBorongan || '') !== (doData.keteranganBorongan || '');

            if (feeChanged) {
                const feeRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'update',
                        data: buildDeliveryOrderTripFeeUpdateData({
                            id: doData._id,
                            tripRouteRateRef: nextTripRouteRateRef,
                            tripOriginArea: tripCashIssueForm.tripOriginArea,
                            tripDestinationArea: tripCashIssueForm.tripDestinationArea,
                            taripBorongan: nextTripFee,
                            keteranganBorongan: tripCashIssueForm.keteranganBorongan,
                        }),
                    }),
                });
                const feeResult = await feeRes.json();
                if (!feeRes.ok) {
                    addToast('error', feeResult.error || 'Gagal menyimpan upah borongan');
                    return;
                }
            }

            const voucherRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    data: {
                        deliveryOrderRef: doData._id,
                        issuedDate: tripCashIssueForm.issuedDate,
                        cashGiven: tripCashIssueForm.cashGiven,
                        issueBankRef: tripCashIssueForm.issueBankRef,
                        notes: tripCashIssueForm.notes || undefined,
                    },
                }),
            });
            const voucherResult = await voucherRes.json();
            if (!voucherRes.ok) {
                addToast('error', voucherResult.error || 'Gagal menerbitkan uang jalan trip');
                return;
            }

            setShowTripCashIssueModal(false);
            setTripCashIssueForm(createDefaultTripCashIssueForm());
            await refreshTripDetail();
            addToast('success', `Bon ${voucherResult.data?.bonNumber || ''} berhasil diterbitkan`);
        } catch {
            addToast('error', 'Gagal menerbitkan uang jalan trip');
        } finally {
            setIssuingTripCash(false);
        }
    };

    const openTripCashTopUpModal = async () => {
        if (!linkedVoucher || linkedVoucher.status === 'SETTLED' || !canManageTripCashCosts) return;
        const defaultBankRef = linkedVoucher.issueBankRef || '';
        setTripCashTopUpForm(createDefaultDriverVoucherTopUpForm(defaultBankRef));
        setShowTripCashTopUpModal(true);
        await loadTripCashBankAccounts();
    };

    const handleTripCashTopUp = async () => {
        if (!linkedVoucher || linkedVoucher.status === 'SETTLED' || !canManageTripCashCosts) return;
        if (!tripCashTopUpForm.bankAccountRef) {
            addToast('error', 'Pilih rekening sumber tambahan bon');
            return;
        }
        if (!tripCashTopUpForm.amount || tripCashTopUpForm.amount <= 0) {
            addToast('error', 'Jumlah tambahan bon wajib diisi');
            return;
        }

        setToppingUpTripCash(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    action: 'top-up',
                    data: {
                        id: linkedVoucher._id,
                        date: tripCashTopUpForm.date,
                        amount: tripCashTopUpForm.amount,
                        bankAccountRef: tripCashTopUpForm.bankAccountRef,
                        note: tripCashTopUpForm.note || undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menambah uang jalan');
                return;
            }

            setShowTripCashTopUpModal(false);
            setTripCashTopUpForm(createDefaultDriverVoucherTopUpForm(linkedVoucher.issueBankRef || ''));
            await refreshTripDetail();
            addToast('success', 'Tambahan uang jalan berhasil dicatat');
        } catch {
            addToast('error', 'Gagal menambah uang jalan');
        } finally {
            setToppingUpTripCash(false);
        }
    };

    const openTripCashSettleModal = async () => {
        if (!linkedVoucher || linkedVoucher.status === 'SETTLED' || !canSettleTripCash) return;
        setTripCashSettlementDate(getBusinessDateValue());
        setTripCashSettlementBankRef(linkedVoucher.settlementBankRef || linkedVoucher.issueBankRef || '');
        setShowTripCashSettleModal(true);
        await loadTripCashBankAccounts();
    };

    const handleTripCashSettle = async () => {
        if (!linkedVoucher || linkedVoucher.status === 'SETTLED' || !canSettleTripCash) return;
        setSettlingTripCash(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    action: 'settle',
                    data: {
                        id: linkedVoucher._id,
                        date: tripCashSettlementDate,
                        settlementBankRef: tripCashSettlementBankRef || linkedVoucher.issueBankRef || undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyelesaikan uang jalan trip');
                return;
            }

            setShowTripCashSettleModal(false);
            await refreshTripDetail();
            addToast('success', 'Uang jalan trip berhasil diselesaikan');
        } catch {
            addToast('error', 'Gagal menyelesaikan uang jalan trip');
        } finally {
            setSettlingTripCash(false);
        }
    };

    const openTripCashExpenseModal = () => {
        if (!linkedVoucher || linkedVoucher.status === 'SETTLED' || !canManageTripCashCosts) return;
        setTripCashExpenseForm(createDefaultDriverVoucherItemForm());
        setShowTripCashExpenseModal(true);
    };

    const handleTripCashExpenseCreate = async () => {
        if (!linkedVoucher || linkedVoucher.status === 'SETTLED' || !canManageTripCashCosts) return;
        if (!tripCashExpenseForm.amount || tripCashExpenseForm.amount <= 0) {
            addToast('error', 'Nominal biaya lain-lain wajib diisi');
            return;
        }

        setSavingTripCashExpense(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-voucher-items',
                    data: {
                        voucherRef: linkedVoucher._id,
                        expenseDate: tripCashExpenseForm.expenseDate,
                        category: tripCashExpenseForm.category,
                        description: tripCashExpenseForm.description,
                        amount: tripCashExpenseForm.amount,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menambah biaya lain-lain');
                return;
            }

            setShowTripCashExpenseModal(false);
            setTripCashExpenseForm(createDefaultDriverVoucherItemForm());
            await refreshTripDetail();
            addToast('success', 'Biaya lain-lain berhasil dicatat');
        } catch {
            addToast('error', 'Gagal menambah biaya lain-lain');
        } finally {
            setSavingTripCashExpense(false);
        }
    };

    const saveShipperReference = async () => {
        const normalizeDraftValue = (value: unknown) => String(value ?? '').trim();
        const normalizedReferences = shipperReferenceDrafts
            .map(entry => ({
                referenceKey: entry.referenceKey.trim(),
                referenceNumber: entry.referenceNumber.trim().toUpperCase(),
                date: entry.date.trim() || getBusinessDateValue(),
                pickupStopKey: entry.pickupStopKey.trim(),
                pickupAddress: entry.pickupAddress.trim(),
                billingCustomerRef: '',
                billingCustomerName: '',
                receiverName: '',
                receiverPhone: '',
                receiverAddress: '',
                receiverCompany: '',
            }))
            .filter(entry => Boolean(entry.referenceNumber));
        if (normalizedReferences.length === 0) {
            addToast('error', 'Minimal 1 SJ pengirim wajib diisi');
            return;
        }
        if (shipperReferencePickupOptions.length > 1) {
            const invalidPickupIndex = normalizedReferences.findIndex(entry => !entry.pickupStopKey && !entry.pickupAddress);
            if (invalidPickupIndex >= 0) {
                addToast('error', `Titik pickup wajib dipilih pada SJ pengirim baris ${invalidPickupIndex + 1}`);
                return;
            }
        }
        const duplicateReferenceNumber = (() => {
            const seen = new Set<string>();
            for (const reference of normalizedReferences) {
                if (seen.has(reference.referenceNumber)) {
                    return reference.referenceNumber;
                }
                seen.add(reference.referenceNumber);
            }
            return '';
        })();
        if (duplicateReferenceNumber) {
            addToast('error', `No. SJ pengirim ${duplicateReferenceNumber} terisi lebih dari sekali. Pakai 1 baris SJ saja lalu lengkapi datanya di baris itu.`);
            return;
        }

        const normalizedSelectedItemDrafts = selectedShipperReferenceItemDrafts
            .map(item => ({
                ...item,
                customerProductRef: normalizeDraftValue(item.customerProductRef),
                description: normalizeDraftValue(item.description),
                qtyKoli: normalizeDraftValue(item.qtyKoli),
                weightInputValue: normalizeDraftValue(item.weightInputValue),
                volumeInputValue: normalizeDraftValue(item.volumeInputValue),
            }))
            .filter(item =>
                Boolean(
                    item.customerProductRef ||
                    item.description ||
                    item.qtyKoli ||
                    item.weightInputValue ||
                    item.volumeInputValue
                )
            );
        const invalidSelectedItemIndex = normalizedSelectedItemDrafts.findIndex(item =>
            !item.description && !item.customerProductRef
        );
        if (invalidSelectedItemIndex >= 0) {
            addToast('error', `Barang baru baris ${invalidSelectedItemIndex + 1} perlu deskripsi atau master barang.`);
            return;
        }
        const invalidSelectedItemCargoIndex = normalizedSelectedItemDrafts.findIndex(item =>
            !item.qtyKoli && !item.weightInputValue && !item.volumeInputValue
        );
        if (invalidSelectedItemCargoIndex >= 0) {
            addToast('error', `Barang baru baris ${invalidSelectedItemCargoIndex + 1} perlu isi koli, berat, atau volume.`);
            return;
        }
        if (normalizedSelectedItemDrafts.length > 0 && !selectedShipperReferenceDraft?.referenceNumber.trim()) {
            addToast('error', 'No. SJ pengirim wajib diisi sebelum menambah barang baru.');
            return;
        }
        const normalizedExistingItemDrafts = (isCreatingNewShipperReference
            ? []
            : Object.entries(shipperReferenceExistingItemDraftMap))
            .flatMap(([draftKey, items]) => {
                const matchingDraft = shipperReferenceDrafts.find(entry => entry.draftKey === draftKey);
                if (!matchingDraft) {
                    return [];
                }
                return items.map(item => ({
                    deliveryOrderItemId: item.deliveryOrderItemId,
                    customerProductRef: normalizeDraftValue(item.customerProductRef),
                    description: normalizeDraftValue(item.description),
                    qtyKoli: normalizeDraftValue(item.qtyKoli),
                    weightInputValue: normalizeDraftValue(item.weightInputValue),
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: normalizeDraftValue(item.volumeInputValue),
                    volumeInputUnit: item.volumeInputUnit,
                    shipperReferenceNumber: matchingDraft.referenceNumber.trim().toUpperCase(),
                    pickupStopKey: matchingDraft.pickupStopKey.trim() || undefined,
                }));
            })
            .filter(item => Boolean(item.deliveryOrderItemId));
        const invalidExistingItemIndex = normalizedExistingItemDrafts.findIndex(item =>
            !item.description && !item.customerProductRef
        );
        if (invalidExistingItemIndex >= 0) {
            addToast('error', `Barang tersimpan baris ${invalidExistingItemIndex + 1} perlu deskripsi atau master barang.`);
            return;
        }
        const invalidExistingItemCargoIndex = normalizedExistingItemDrafts.findIndex(item =>
            !item.qtyKoli && !item.weightInputValue && !item.volumeInputValue
        );
        if (invalidExistingItemCargoIndex >= 0) {
            addToast('error', `Barang tersimpan baris ${invalidExistingItemCargoIndex + 1} perlu isi koli, berat, atau volume.`);
            return;
        }

        setSavingShipperReference(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-shipper-reference',
                    data: {
                        id: doData?._id,
                        shipperReferences: normalizedReferences.map(reference => ({
                            _key: reference.referenceKey || undefined,
                            referenceNumber: reference.referenceNumber,
                            date: reference.date || undefined,
                            pickupStopKey: pickupStopMap.has(reference.pickupStopKey) ? reference.pickupStopKey : undefined,
                            pickupAddress: reference.pickupAddress || undefined,
                            billingCustomerRef: reference.billingCustomerRef || undefined,
                            billingCustomerName: reference.billingCustomerName || undefined,
                            receiverName: reference.receiverName || undefined,
                            receiverPhone: reference.receiverPhone || undefined,
                            receiverAddress: reference.receiverAddress || undefined,
                            receiverCompany: reference.receiverCompany || undefined,
                        })),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan SJ pengirim');
                return;
            }
            if (normalizedSelectedItemDrafts.length > 0 && selectedShipperReferenceDraft) {
                const selectedReferenceAfterSave = normalizedReferences.find(reference =>
                    reference.referenceKey === selectedShipperReferenceDraft.referenceKey.trim() ||
                    reference.referenceNumber === selectedShipperReferenceDraft.referenceNumber.trim().toUpperCase()
                );
                const cargoRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'append-cargo-items',
                        data: {
                            id: doData?._id,
                            cargoItems: normalizedSelectedItemDrafts.map(item => ({
                                ...item,
                                shipperReferenceNumber: selectedReferenceAfterSave?.referenceNumber || selectedShipperReferenceDraft.referenceNumber.trim().toUpperCase(),
                                pickupStopKey: (selectedReferenceAfterSave?.pickupStopKey || selectedShipperReferenceDraft.pickupStopKey || '').trim() || undefined,
                            })),
                        },
                    }),
                });
                const cargoResult = await cargoRes.json();
                if (!cargoRes.ok) {
                    addToast('error', cargoResult.error || 'SJ tersimpan, tapi gagal menambah barang baru.');
                    return;
                }
            }
            for (const item of normalizedExistingItemDrafts) {
                const cargoUpdateRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'update-cargo-item',
                        data: {
                            id: doData?._id,
                            deliveryOrderItemId: item.deliveryOrderItemId,
                            cargoItem: {
                                customerProductRef: item.customerProductRef || undefined,
                                description: item.description,
                                qtyKoli: item.qtyKoli,
                                weightInputValue: item.weightInputValue,
                                weightInputUnit: item.weightInputUnit,
                                volumeInputValue: item.volumeInputValue,
                                volumeInputUnit: item.volumeInputUnit,
                                shipperReferenceNumber: item.shipperReferenceNumber,
                                pickupStopKey: item.pickupStopKey,
                            },
                        },
                    }),
                });
                const cargoUpdateResult = await cargoUpdateRes.json();
                if (!cargoUpdateRes.ok) {
                    addToast('error', cargoUpdateResult.error || 'SJ tersimpan, tapi gagal memperbarui barang terdaftar.');
                    return;
                }
            }
            for (const itemId of deletedShipperReferenceItemIds) {
                const cargoDeleteRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'remove-cargo-item',
                        data: {
                            id: doData?._id,
                            deliveryOrderItemId: itemId,
                        },
                    }),
                });
                if (!cargoDeleteRes.ok) {
                    const cargoDeleteResult = await cargoDeleteRes.json();
                    addToast('error', cargoDeleteResult.error || 'Gagal menghapus beberapa barang lama.');
                    return;
                }
            }
            setShowShipperReferenceModal(false);
            setShipperReferenceExistingItemDraftMap({});
            setShipperReferenceItemDraftMap({});
            await refreshTripDetail();
            addToast(
                'success',
                normalizedSelectedItemDrafts.length > 0 || normalizedExistingItemDrafts.length > 0
                    ? 'Dokumen Surat Jalan dan barang berhasil diperbarui'
                    : 'Dokumen Surat Jalan berhasil diperbarui'
            );
        } catch {
            addToast('error', 'Gagal menyimpan SJ pengirim');
        } finally {
            setSavingShipperReference(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!doData) return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Trip tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;

    const hasTripResourcesAssigned = Boolean(doData.vehicleRef && doData.driverRef);
    const displayTripStatus = tripData?.status || doData.status;
    const tripResourceActionLabel = getTripResourceActionLabel(doData);
    const tripResourceBusyIds = buildTripResourceBusyIds({
        activeDeliveryOrders: activeTrips,
        activeOrders,
        currentDeliveryOrderId: doData._id,
    });
    const assignableVehicles = getAssignableTripVehicles({
        vehicles,
        busyVehicleIds: tripResourceBusyIds.busyVehicleIds,
        currentVehicleRef: doData.vehicleRef,
        requestedServiceRef: doData.serviceRef,
    });
    const assignableDrivers = getAssignableTripDrivers({
        drivers,
        busyDriverIds: tripResourceBusyIds.busyDriverIds,
        currentDriverRef: doData.driverRef,
    });
    const resolvedShipperReferenceEntries = buildResolvedShipperReferenceEntries(doData, doItems);
    const selectedTripVehicle = assignableVehicles.find(vehicle => vehicle._id === tripVehicleRef) || null;
    const currentTripVehicle = vehicles.find(vehicle => vehicle._id === doData.vehicleRef) || null;
    const tripClosureOldOdometer = currentTripVehicle?.lastOdometer || doData.tripEndOdometerKm || 0;
    const tripClosureDistanceKm = Math.max((tripClosureOdometer || 0) - tripClosureOldOdometer, 0);
    const tripClosureOdometerInvalid = pendingTripClosure === true && Boolean(currentTripVehicle) && tripClosureOdometer < tripClosureOldOdometer;
    const tripClosureOilIntervalKm = currentTripVehicle?.oilMaintenanceIntervalKm || 0;
    const tripClosureOilTargetOdometer = currentTripVehicle?.oilNextServiceOdometer ||
        (tripClosureOilIntervalKm > 0
            ? (currentTripVehicle?.oilLastServiceOdometer || tripClosureOldOdometer) + tripClosureOilIntervalKm
            : 0);
    const tripClosureOilRemainingAfterTrip = tripClosureOilTargetOdometer > 0
        ? Math.max(tripClosureOilTargetOdometer - (tripClosureOdometer || 0), 0)
        : 0;
    const tripClosureNeedsOilMaintenance = tripClosureOilTargetOdometer > 0 && tripClosureOilRemainingAfterTrip <= 0;
    const requiresTripVehicleOverrideReason = shouldRequireTripVehicleOverrideReason(doData, selectedTripVehicle);
    const selectedTripCashIssueVehicle = assignableVehicles.find(vehicle => vehicle._id === tripCashIssueForm.vehicleRef) || null;
    const requiresTripCashIssueVehicleOverrideReason = shouldRequireTripVehicleOverrideReason(doData, selectedTripCashIssueVehicle);
    const tripCashIssueOriginAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'originArea', {
        serviceRef: doData.serviceRef,
    });
    const tripCashIssueDestinationAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
        originArea: tripCashIssueForm.tripOriginArea,
        serviceRef: doData.serviceRef,
    });
    const tripCashIssueMatchedRate = findMatchingTripRouteRate(tripRouteRates, {
        originArea: tripCashIssueForm.tripOriginArea,
        destinationArea: tripCashIssueForm.tripDestinationArea,
        serviceRef: doData.serviceRef,
    });
    const tripCashIssueFeeValue = tripCashIssueMatchedRate?.rate ?? tripCashIssueForm.taripBorongan;
    const isCompletingDelivery = newStatus === 'DELIVERED';
    const pendingDriverStatusMeta = doData.pendingDriverStatus ? DO_STATUS_MAP[doData.pendingDriverStatus] : null;
    const shipperReferenceList = Array.from(new Set(resolvedShipperReferenceEntries.map(reference => reference.referenceNumber)));
    const hasShipperReference = shipperReferenceList.length > 0;
    const normalizedShipperReferenceFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
    const shipperReferenceExample = `${normalizedShipperReferenceFormat}/27032026/001`;
    const pickupStopList = (doData.pickupStops || [])
        .map((pickupStop, index) => ({
            _key: pickupStop._key || `pickup-stop-${index + 1}`,
            sequence: pickupStop.sequence || index + 1,
            pickupLabel: pickupStop.pickupLabel || '',
            pickupAddress: pickupStop.pickupAddress || '',
        }))
        .sort((left, right) => left.sequence - right.sequence);
    const pickupStopMap = new Map(pickupStopList.map(stop => [stop._key, stop]));
    const formatPickupStopDisplayName = (stop: { sequence: number; pickupLabel?: string; pickupAddress?: string }) =>
        stop.pickupLabel?.trim() || stop.pickupAddress?.trim() || `Pickup ${stop.sequence}`;
    const normalPickupOptions = pickupStopList.map(stop => ({
        key: stop._key,
        name: `Pickup ${stop.sequence}${stop.pickupLabel ? ` - ${stop.pickupLabel}` : ''}`,
        address: stop.pickupAddress,
        source: 'pickup-stop' as const,
    }));
    const shipperReferencePickupOptions = normalPickupOptions;
    const shipperReferencePickupOptionMap = new Map(shipperReferencePickupOptions.map(option => [option.key, option]));
    const defaultShipperReferencePickupOption =
        shipperReferencePickupOptions.length === 1 ? shipperReferencePickupOptions[0] : null;
    const pickupTripDisplayList = pickupStopList.length > 0
        ? pickupStopList.map(stop => ({
            key: stop._key,
            name: formatPickupStopDisplayName(stop),
            address: stop.pickupAddress,
        }))
        : doData.pickupAddress
            ? [{ key: 'fallback-pickup', name: doData.pickupAddress, address: '' }]
            : [];
    const isCreatingNewShipperReference = shipperReferenceModalMode === 'create';
    const selectedShipperReferenceDraft =
        shipperReferenceDrafts.find(entry => entry.draftKey === selectedShipperReferenceDraftKey)
        || (isCreatingNewShipperReference ? shipperReferenceDrafts[0] || null : null);
    const selectedShipperReferenceItemDrafts = selectedShipperReferenceDraft
        ? (shipperReferenceItemDraftMap[selectedShipperReferenceDraft.draftKey] || [])
        : [];
    const selectedShipperReferenceExistingItemDrafts = selectedShipperReferenceDraft
        ? (shipperReferenceExistingItemDraftMap[selectedShipperReferenceDraft.draftKey] || [])
        : [];
    const shipperReferenceDisplayList = resolvedShipperReferenceEntries.map(reference => ({
        ...reference,
        pickupLabel: (() => {
            const pickupStop = reference.pickupStopKey ? pickupStopMap.get(reference.pickupStopKey) : null;
            return pickupStop ? formatPickupStopDisplayName(pickupStop) : reference.pickupLabel;
        })(),
        pickupAddress: (() => {
            const pickupStop = reference.pickupStopKey ? pickupStopMap.get(reference.pickupStopKey) : null;
            return pickupStop?.pickupAddress || reference.pickupAddress;
        })(),
    }));
    const suratJalanDocumentByReferenceKey = new Map(
        suratJalanDocuments
            .map(document => [document.referenceKey || 'primary', document] as const)
    );
    const getSuratJalanOperationalStatus = (referenceKey?: string) => {
        const document = suratJalanDocumentByReferenceKey.get(referenceKey || 'primary') || null;
        const rawStatus = document?.tripStatus || displayTripStatus;
        const hasHoldCargo = Boolean(
            document &&
            (
                (document.holdCargo?.qtyKoli || 0) > 0 ||
                (document.holdCargo?.weightKg || 0) > 0 ||
                (document.holdCargo?.volumeM3 || 0) > 0
            )
        );
        const status = hasHoldCargo && rawStatus === 'DELIVERED' ? 'PARTIAL_HOLD' : rawStatus;
        return {
            document,
            status,
            meta: DO_STATUS_MAP[status] || displayStatusMeta,
        };
    };
    const hasSuratJalanHoldIndicator = (document?: SuratJalanDocument | null) =>
        Boolean(
            document &&
            (
                document.tripStatus === 'PARTIAL_HOLD' ||
                (document.holdCargo?.qtyKoli || 0) > 0 ||
                (document.holdCargo?.weightKg || 0) > 0 ||
                (document.holdCargo?.volumeM3 || 0) > 0
            )
        );
    const hasSuratJalanCargoAllocation = (document?: SuratJalanDocument | null) =>
        Boolean(
            document &&
            (
                document.tripStatus === 'DELIVERED' ||
                document.tripStatus === 'PARTIAL_HOLD' ||
                (document.billableCargo?.qtyKoli || 0) > 0 ||
                (document.billableCargo?.weightKg || 0) > 0 ||
                (document.billableCargo?.volumeM3 || 0) > 0 ||
                (document.holdCargo?.qtyKoli || 0) > 0 ||
                (document.holdCargo?.weightKg || 0) > 0 ||
                (document.holdCargo?.volumeM3 || 0) > 0 ||
                (document.returnCargo?.qtyKoli || 0) > 0 ||
                (document.returnCargo?.weightKg || 0) > 0 ||
                (document.returnCargo?.volumeM3 || 0) > 0
            )
        );
    const getShipperReferenceDeleteLockReason = (reference: ResolvedShipperReferenceEntry) => {
        const document = suratJalanDocumentByReferenceKey.get(reference.referenceKey || 'primary') || null;
        if (hasSuratJalanCargoAllocation(document)) {
            return 'SJ ini sudah punya aktual drop/hold atau status final, jadi tidak bisa dihapus.';
        }
        return '';
    };
    const selectedShipperReferenceDeleteLockReason = selectedShipperReferenceDraft
        ? getShipperReferenceDeleteLockReason({
            draftKey: selectedShipperReferenceDraft.draftKey,
            referenceKey: selectedShipperReferenceDraft.referenceKey,
            referenceNumber: selectedShipperReferenceDraft.referenceNumber,
            date: selectedShipperReferenceDraft.date,
            pickupStopKey: selectedShipperReferenceDraft.pickupStopKey,
            pickupLabel: '',
            pickupAddress: selectedShipperReferenceDraft.pickupAddress,
            billingCustomerRef: selectedShipperReferenceDraft.billingCustomerRef,
            billingCustomerName: selectedShipperReferenceDraft.billingCustomerName,
            receiverName: selectedShipperReferenceDraft.receiverName,
            receiverPhone: selectedShipperReferenceDraft.receiverPhone,
            receiverAddress: selectedShipperReferenceDraft.receiverAddress,
            receiverCompany: selectedShipperReferenceDraft.receiverCompany,
        })
        : '';
    const formatSuratJalanDisplayNumber = (
        number: string,
        document?: SuratJalanDocument | null
    ) => `${number}${hasSuratJalanHoldIndicator(document) ? ' (HOLD)' : ''}`;
    const customerProductById = new Map(customerProducts.map(item => [item._id, item]));
    const getDeliveryOrderItemIdentity = (item?: Pick<DeliveryOrderItem, '_id' | 'orderItemRef' | 'orderItemDescription'> | null) => {
        const linkedOrderItem = item?.orderItemRef ? linkedOrderItemDetailMap[item.orderItemRef] : undefined;
        const product = linkedOrderItem?.customerProductRef ? customerProductById.get(linkedOrderItem.customerProductRef) : undefined;
        return {
            code: linkedOrderItem?.customerProductCode || product?.code || '',
            name: linkedOrderItem?.customerProductName || product?.name || item?.orderItemDescription || '',
        };
    };
    const getActualEditItemLabel = (item: Pick<ActualCargoDraft, 'deliveryOrderItemRef' | 'description'>, fallbackIndex?: number) => {
        const deliveryOrderItem = doItems.find(row => row._id === item.deliveryOrderItemRef);
        const identity = getDeliveryOrderItemIdentity(deliveryOrderItem);
        return formatItemCodeNameLabel(identity.code, identity.name || item.description, fallbackIndex !== undefined ? `Item ${fallbackIndex + 1}` : item.deliveryOrderItemRef);
    };
    const suratJalanActualEditCandidateDocumentOptions = suratJalanDocuments.filter(document =>
        document.tripStatus === 'DELIVERED' &&
        getDeliveryOrderItemsForSuratJalanDocument(document).some(hasDeliveryOrderItemActualCargo)
    );
    const lockedSuratJalanActualEditDocumentCount = suratJalanActualEditCandidateDocumentOptions.filter(document =>
        Boolean(getSuratJalanActualEditInvoiceLockItem(document))
    ).length;
    const suratJalanActualEditDocumentOptions = suratJalanActualEditCandidateDocumentOptions.filter(document =>
        !getSuratJalanActualEditInvoiceLockItem(document)
    );
    const suratJalanActualEditLockInvoiceLabel = getFreightNotaLinksForItems(tripFreightNotaItems)
        .map(item => item.label)
        .join(', ');
    const suratJalanActualEditUnavailableReason = suratJalanActualEditCandidateDocumentOptions.length === 0
        ? 'Belum ada SJ delivered dengan muatan aktual'
        : lockedSuratJalanActualEditDocumentCount === suratJalanActualEditCandidateDocumentOptions.length
            ? `Semua SJ delivered yang punya muatan aktual sudah masuk invoice${suratJalanActualEditLockInvoiceLabel ? ` ${suratJalanActualEditLockInvoiceLabel}` : ''}. Revisi atau batalkan invoice dulu jika data final perlu dikoreksi.`
            : 'Belum ada SJ delivered yang bisa diedit';
    const selectedSuratJalanActualEditItemRefs = new Set(
        selectedSuratJalanActualEditDocument
            ? getDeliveryOrderItemsForSuratJalanDocument(selectedSuratJalanActualEditDocument)
                .filter(hasDeliveryOrderItemActualCargo)
                .map(item => item._id)
            : []
    );
    const suratJalanActualEditSelectableItems = suratJalanActualEditItems.filter(item =>
        selectedSuratJalanActualEditItemRefs.has(item.deliveryOrderItemRef)
    );
    const selectedSuratJalanActualEditItem =
        suratJalanActualEditItems.find(item => item.deliveryOrderItemRef === selectedSuratJalanActualEditItemRef) ||
        suratJalanActualEditSelectableItems[0] ||
        null;
    const selectedSuratJalanActualEditDropRows = selectedSuratJalanActualEditItem
        ? suratJalanActualEditDropPoints.filter(point =>
            isDeliveryOrderBillableDropType(point.stopType) &&
            getActualEditDropPointItemRefs(point).includes(selectedSuratJalanActualEditItem.deliveryOrderItemRef)
        )
        : [];
    const canUseSuratJalanActualEditDropRows = suratJalanActualEditSelectableItems.length > 0 && suratJalanActualEditSelectableItems.every(item =>
        suratJalanActualEditDropPoints.some(point =>
            isDeliveryOrderBillableDropType(point.stopType) &&
            getActualEditDropPointItemRefs(point).includes(item.deliveryOrderItemRef)
        )
    );
    const showSuratJalanActualEditDropRows = canUseSuratJalanActualEditDropRows && selectedSuratJalanActualEditDropRows.length > 1;
    const isTripClosedByAdmin = Boolean(doData.tripClosedByAdminAt);
    const pendingDriverRequests: PendingDriverStatusRequest[] = Array.isArray(doData.pendingDriverRequests) && doData.pendingDriverRequests.length > 0
        ? doData.pendingDriverRequests.filter(request => request && request.requestId && request.status)
        : doData.pendingDriverStatus
            ? [{
                requestId: `${doData._id}:legacy-pending-driver-request`,
                status: doData.pendingDriverStatus,
                requestedAt: doData.pendingDriverStatusRequestedAt,
                requestedBy: doData.pendingDriverStatusRequestedBy,
                requestedByName: doData.pendingDriverStatusRequestedByName,
                note: doData.pendingDriverStatusNote,
                targetSuratJalanRefs: doData.pendingDriverStatusSuratJalanRefs || [],
                podReceiverName: doData.pendingDriverPodReceiverName,
                podReceivedDate: doData.pendingDriverPodReceivedDate,
                podNote: doData.pendingDriverPodNote,
                actualCargoItems: doData.pendingDriverActualCargoItems || [],
                actualDropPoints: doData.pendingDriverActualDropPoints || [],
                tripEndOdometerKm: doData.tripEndOdometerKm,
                closeTripOnly: Boolean(doData.tripEndOdometerKm && !(doData.pendingDriverActualCargoItems || []).length),
            }]
            : [];
    const activeReviewingDriverRequest = reviewingDriverRequestId
        ? pendingDriverRequests.find(request => request.requestId === reviewingDriverRequestId) || null
        : null;
    const isPendingDriverTripClosureRequest = (request?: PendingDriverStatusRequest | null) =>
        Boolean(
            request?.status === 'DELIVERED' &&
            (request.closeTripOnly || request.tripEndOdometerKm) &&
            doData.status === 'DELIVERED' &&
            suratJalanDocuments.length > 0 &&
            suratJalanDocuments.every(document =>
                document.tripStatus === 'DELIVERED' &&
                !hasSuratJalanHoldIndicator(document)
            )
        );
    const suratJalanStatusSortWeight: Record<string, number> = {
        PARTIAL_HOLD: 0,
        CREATED: 0,
        ON_DELIVERY: 2,
        ARRIVED: 3,
        DELIVERED: 4,
        CANCELLED: 5,
    };
    const sortedShipperReferenceDisplayList = [...shipperReferenceDisplayList].sort((left, right) => {
        const leftStatus = getSuratJalanOperationalStatus(left.referenceKey).status;
        const rightStatus = getSuratJalanOperationalStatus(right.referenceKey).status;
        const weightDiff = (suratJalanStatusSortWeight[leftStatus] ?? 999) - (suratJalanStatusSortWeight[rightStatus] ?? 999);
        if (weightDiff !== 0) {
            return weightDiff;
        }
        return left.referenceNumber.localeCompare(right.referenceNumber);
    });
    const filteredShipperReferenceDisplayList = suratJalanStatusFilter
        ? sortedShipperReferenceDisplayList.filter(reference =>
            getSuratJalanOperationalStatus(reference.referenceKey).status === suratJalanStatusFilter
        )
        : sortedShipperReferenceDisplayList;
    const suratJalanStatusSummary = sortedShipperReferenceDisplayList.reduce<Map<string, number>>((acc, reference) => {
        const status = getSuratJalanOperationalStatus(reference.referenceKey).status;
        acc.set(status, (acc.get(status) || 0) + 1);
        return acc;
    }, new Map());
    const actualDropShipperReferenceOptions = shipperReferenceDisplayList.map(reference => {
            const optionValue = `sj:${reference.referenceKey || reference.draftKey || reference.referenceNumber}`;
            return {
                ...reference,
                optionValue,
                optionLabel: `${reference.referenceNumber}${reference.receiverCompany || reference.receiverName ? ` - ${reference.receiverCompany || reference.receiverName}` : ''}`,
            };
        });
    const resolveActualDropShipperReferenceValue = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>
    ) => {
        const itemCargo = drop.deliveryOrderItemRef
            ? actualCargoItems.find(item => item.deliveryOrderItemRef === drop.deliveryOrderItemRef)
            : null;
        const matchedReference = shipperReferenceDisplayList.find(reference =>
            (itemCargo?.shipperReferenceKey && reference.referenceKey === itemCargo.shipperReferenceKey) ||
            (itemCargo?.shipperReferenceNumber && reference.referenceNumber === itemCargo.shipperReferenceNumber) ||
            (drop.shipperReferenceKey && reference.referenceKey === drop.shipperReferenceKey) ||
            (drop.shipperReferenceNumber && reference.referenceNumber === drop.shipperReferenceNumber)
        );
        const referenceValue = matchedReference?.referenceKey || matchedReference?.draftKey || matchedReference?.referenceNumber;
        return referenceValue ? `sj:${referenceValue}` : '';
    };
    const getActualDropRecipientOptions = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber' | 'billingCustomerRef'>
    ) => {
        const selectedReferenceValue = resolveActualDropShipperReferenceValue(drop);
        const selectedReference = actualDropShipperReferenceOptions.find(reference => reference.optionValue === selectedReferenceValue);
        return getCustomerRecipientOptions(drop.billingCustomerRef || selectedReference?.billingCustomerRef || doData?.customerRef);
    };
    const getActualDropBillingCustomerValue = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber' | 'billingCustomerRef'>
    ) => {
        const selectedReferenceValue = resolveActualDropShipperReferenceValue(drop);
        const selectedReference = actualDropShipperReferenceOptions.find(reference => reference.optionValue === selectedReferenceValue);
        return drop.billingCustomerRef || selectedReference?.billingCustomerRef || doData?.customerRef || '';
    };
    const resolveActualDropRecipientValue = (
        drop: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber' | 'billingCustomerRef' | 'locationName' | 'locationAddress'>
    ) => {
        const recipientOptions = getActualDropRecipientOptions(drop);
        if (recipientOptions.length === 0) {
            return '';
        }
        const dropLocationName = normalizeRecipientComparable(drop.locationName);
        const dropLocationAddress = normalizeRecipientComparable(drop.locationAddress);
        return recipientOptions.find(recipient => {
            const recipientName = normalizeRecipientComparable(recipient.receiverCompany || recipient.receiverName || recipient.label);
            const recipientAddress = normalizeRecipientComparable(recipient.receiverAddress);
            return Boolean(
                (dropLocationAddress && recipientAddress === dropLocationAddress) ||
                (dropLocationName && recipientName === dropLocationName)
            );
        })?._id || '';
    };
    const applyActualDropRecipient = (draftKey: string, recipientId: string) => {
        const recipient = customerRecipients.find(item => item._id === recipientId);
        if (!recipient) {
            return;
        }
        const locationName = recipient.receiverCompany || recipient.receiverName || recipient.label;
        setActualDropPoints(previous => previous.map(item => (
            item.draftKey === draftKey
                ? {
                    ...item,
                    locationName,
                    locationAddress: recipient.receiverAddress || item.locationAddress,
                }
                : item
        )));
    };
    const cargoGroups = (() => {
        const groups = new Map<string, {
            key: string;
            shipperReferenceNumber: string;
            document: SuratJalanDocument | null;
            pickupLabels: string[];
            pickupAddresses: string[];
            items: DeliveryOrderItem[];
        }>();

        const findSuratJalanDocumentForCargoItem = (item: DeliveryOrderItem) => {
            const customerDoNumber = doData.customerDoNumber || '';
            const itemReferenceKey = (item.shipperReferenceKey || '').trim();
            const itemReferenceNumber = (item.shipperReferenceNumber || customerDoNumber).trim().toUpperCase();
            return suratJalanDocuments.find(document => {
                const documentReferenceKey = (document.referenceKey || '').trim();
                const documentNumber = (document.suratJalanNumber || '').trim().toUpperCase();
                const documentRefSuffix = doData._id && document._id.startsWith(`${doData._id}:`)
                    ? document._id.slice(`${doData._id}:`.length)
                    : '';
                return (
                    (itemReferenceKey && documentReferenceKey && documentReferenceKey === itemReferenceKey) ||
                    (itemReferenceKey && documentRefSuffix && documentRefSuffix === itemReferenceKey) ||
                    (itemReferenceNumber && documentNumber && documentNumber === itemReferenceNumber) ||
                    (!itemReferenceKey && !itemReferenceNumber && (documentReferenceKey === 'primary' || documentRefSuffix === 'primary' || (!documentReferenceKey && !documentNumber)))
                );
            }) || null;
        };

        const appendUnique = (values: string[], value: string) => {
            const normalized = value.trim();
            if (normalized && !values.includes(normalized)) {
                values.push(normalized);
            }
        };

        for (const item of doItems) {
            const document = findSuratJalanDocumentForCargoItem(item);
            const shipperReferenceNumber = item.shipperReferenceNumber?.trim() || doData.customerDoNumber || 'TANPA-SJ';
            const pickupStop = item.pickupStopKey ? pickupStopMap.get(item.pickupStopKey) : null;
            const pickupLabel = pickupStop
                ? formatPickupStopDisplayName(pickupStop)
                : item.pickupAddress
                    ? item.pickupAddress
                    : '';
            const pickupAddress = pickupStop?.pickupAddress || item.pickupAddress || '';
            const key = document?._id ||
                (item.shipperReferenceKey ? `key:${item.shipperReferenceKey}` : `number:${shipperReferenceNumber}`);
            const current = groups.get(key);
            if (current) {
                current.items.push(item);
                appendUnique(current.pickupLabels, pickupLabel);
                appendUnique(current.pickupAddresses, pickupAddress);
                continue;
            }
            const pickupLabels: string[] = [];
            const pickupAddresses: string[] = [];
            appendUnique(pickupLabels, pickupLabel);
            appendUnique(pickupAddresses, pickupAddress);
            groups.set(key, {
                key,
                shipperReferenceNumber,
                document,
                pickupLabels,
                pickupAddresses,
                items: [item],
            });
        }
        return [...groups.values()];
    })();
    const flattenedCargoDraftItems = flattenDeliveryOrderCargoDraftGroups(cargoDraftGroups);
    const cargoDraftGroupsWithItems = getDraftDeliveryOrderCargoGroups(cargoDraftGroups);
    const cargoDraftSummary = summarizeDraftOrderCargo(flattenedCargoDraftItems);
    const cargoDraftItemCount = cargoDraftGroupsWithItems.reduce((sum, group) => sum + getDeliveryOrderCargoDraftItems(group).length, 0);
    const cargoDraftSelectedProductRefs = new Set(
        flattenedCargoDraftItems
            .map(item => item.customerProductRef.trim())
            .filter(Boolean)
    );
    const deliveryOrderCustomerProducts = customerProducts.filter(product =>
        product.customerRef === doData.customerRef ||
        cargoDraftSelectedProductRefs.has(product._id)
    );
    const isEditingCargoItem = Boolean(editingCargoItemId);
    const canAppendCargoToDo =
        canEditDeliveryCargo &&
        ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED', 'PARTIAL_HOLD'].includes(doData.status) &&
        pendingDriverRequests.length === 0 &&
        !doData.pendingDriverStatus &&
        !isTripClosedByAdmin;
    const linkedVoucherSummary = linkedVoucher ? getDriverVoucherFinancialSummary(linkedVoucher) : null;
    const linkedVoucherCashBreakdown = linkedVoucher && linkedVoucherSummary
        ? buildDriverVoucherCashBreakdown(linkedVoucherDisbursements, {
            initialCashGiven: linkedVoucherSummary.initialCashGiven,
            topUpAmount: linkedVoucherSummary.topUpAmount,
        })
        : '';
    const linkedVoucherSettlementDisplay = linkedVoucher && linkedVoucherSummary
        ? buildDriverVoucherSettlementDisplay({
            balance: linkedVoucherSummary.balance,
            disbursements: linkedVoucherDisbursements,
            fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                ...linkedVoucher,
                topUpAmount: linkedVoucherSummary.topUpAmount,
            }),
            initialCashGiven: linkedVoucherSummary.initialCashGiven,
            topUpAmount: linkedVoucherSummary.topUpAmount,
            totalIssuedAmount: linkedVoucherSummary.totalIssuedAmount,
            totalClaimAmount: linkedVoucherSummary.totalClaimAmount,
        })
        : null;
    const linkedVoucherSettlementLabel = linkedVoucherSettlementDisplay?.description || '';
    const linkedVoucherSettlementPrimaryLabel = linkedVoucherSettlementDisplay?.primaryActionLabel || 'Selesaikan Bon';
    const linkedTripCashVoucherId = linkedVoucher?._id || linkedTripCashLink?.voucherId || '';
    const linkedTripCashBonNumber = linkedVoucher?.bonNumber || linkedTripCashLink?.bonNumber || linkedVoucherBonNumber;
    const linkedTripCashIssuedDate = linkedVoucher?.issuedDate || linkedTripCashLink?.issuedDate || '';
    const linkedTripCashStatus = linkedVoucher?.status || linkedTripCashLink?.status || null;
    const hasLinkedTripCash = Boolean(linkedTripCashVoucherId || linkedTripCashBonNumber);
    const canTopUpLinkedTripCash = Boolean(linkedVoucher && linkedVoucher.status !== 'SETTLED' && canManageTripCashCosts);
    const canAddLinkedTripCashExpense = canTopUpLinkedTripCash;
    const canRecordCancelTripExpense = canManageDeliveryStatus && normalizedRole !== 'DRIVER';
    const cancelTripExpenseCategories = expenseCategories.filter(isOperationalCancelExpenseCategory);
    const canSettleLinkedTripCash = Boolean(
        linkedVoucher &&
        linkedVoucher.status !== 'SETTLED' &&
        canSettleTripCash &&
        ((linkedVoucherSummary?.totalSpent || 0) > 0 || (linkedVoucherSummary?.driverFeeAmount || 0) > 0)
    );
    const linkedVoucherStatusMeta = linkedTripCashStatus
        ? ({
            DRAFT: { label: 'Draft', cls: 'badge-gray' },
            ISSUED: { label: 'Belum Diselesaikan', cls: 'badge-info' },
            SETTLED: { label: 'Selesai', cls: 'badge-success' },
        }[linkedTripCashStatus || 'DRAFT'])
        : null;
    const baseTripFee = doData.baseTaripBorongan ?? doData.taripBorongan ?? 0;
    const overtonaseDriverAmount = doData.overtonaseDriverAmount || 0;
    const totalTripFee = doData.taripBorongan || 0;
    const hasOvertonase = (doData.overtonaseWeightKg || 0) > 0;
    const hasManualOvertonase = (doData.manualOvertonaseWeightKg || 0) > 0;
    const payableOvertonaseTon = Math.floor((doData.overtonaseWeightKg || 0) / 1000);
    const manualOvertonasePendingPreview = manualOvertonaseReviewMode
        ? getManualOvertonasePreview(manualOvertonaseReviewMode === 'automatic')
        : null;
    const exceedsVehicleCapacity = (doData.vehicleCapacityExceededKg || 0) > 0;
    const effectiveOvertonaseLimitKg = doData.serviceMaxPayloadKg || 0;
    const overtonaseDriverRatePerTon = doData.overtonaseDriverRatePerKg
        ? Math.round(doData.overtonaseDriverRatePerKg * 1000)
        : 0;
    const formatWeightKg = (value?: number | null) =>
        value && value > 0 ? `${formatQuantity(value, 0)} kg` : '-';
    const tripFeeRowStyle = {
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, 1fr) minmax(120px, auto)',
        alignItems: 'baseline',
        gap: '0.75rem',
        padding: '0.45rem 0',
        borderBottom: '1px solid var(--color-gray-100)',
    } as const;
    const tripFeeValueStyle = {
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
    } as const;
    const shouldOpenTripFeeCard = !doData.taripBorongan || hasOvertonase || hasManualOvertonase || exceedsVehicleCapacity;
    const settledVoucherNeedsManualAdjustment = Boolean(
        linkedVoucher?.status === 'SETTLED' &&
        totalTripFee > 0 &&
        Math.abs((linkedVoucher.driverFeeAmount || 0) - totalTripFee) > 0.01
    );
    const voucherIssueBlockingReasons = [
        !['CREATED', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(doData.status)
            ? 'status Trip tidak bisa diterbitkan ke uang jalan trip'
            : null,
    ].filter((value): value is string => Boolean(value));
    const voucherIssueDraftNotes = [
        !doData.driverRef ? 'supir trip bisa dipilih saat terbit bon' : null,
        !doData.vehicleRef && !doData.vehiclePlate ? 'kendaraan trip bisa dipilih saat terbit bon' : null,
        !doData.taripBorongan || doData.taripBorongan <= 0 ? 'upah borongan bisa diisi saat terbit bon' : null,
    ].filter((value): value is string => Boolean(value));
    const canIssueVoucherFromDo =
        canCreateTripCash &&
        !hasLinkedTripCash &&
        voucherIssueBlockingReasons.length === 0;
    const canShowTripManager =
        canAssignTripResources ||
        canEditShipperReference ||
        canManageTripFee ||
        canCreateTripCash ||
        canOpenTripCashPage ||
        canManageDeliveryStatus;
    const {
        actualDropSummary,
        hasLiveCoordinates,
        trackingMapUrl,
        mapEmbedUrl,
    } = buildDeliveryOrderDetailState({
        doData,
        actualCargoItems,
        actualDropPoints,
        showAdvancedDropEditor,
    });
    const displayStatusMeta = DO_STATUS_MAP[displayTripStatus] || getDeliveryOrderDisplayStatusMeta(doData);
    const completionOutcome = deriveDeliveryOrderCompletionOutcome(doData);
    const billableCargoSummary = getDeliveryOrderBillableCargoSummary(doData);
    const holdCargoSummary = getDeliveryOrderHoldCargoSummary(doData);
    const displayTripNumber = tripData?.tripNumber || formatInternalDeliveryOrderNumber(doData);
    const suratJalanStatusOptions = suratJalanDocuments.filter(document => document.itemCount > 0);
    const getEligibleStatusesForSuratJalan = (document: SuratJalanDocument) =>
        getNextDeliveryOrderStatuses(getSuratJalanOperationalStatus(document.referenceKey).status).filter(status =>
            status === 'CREATED' ||
            status === 'CANCELLED' ||
            hasTripResourcesAssigned
        );
    const availableBatchStatuses = BATCH_SURAT_JALAN_STATUS_OPTIONS.filter(status =>
        suratJalanStatusOptions.some(document => getEligibleStatusesForSuratJalan(document).includes(status))
    );
    const cancelableSuratJalanDocuments = suratJalanDocuments.filter(document => {
        const currentStatus = document.tripStatus || displayTripStatus;
        return currentStatus !== 'CANCELLED' && currentStatus !== 'DELIVERED' && currentStatus !== 'PARTIAL_HOLD';
    });
    const hasFinalizedCargoOutcome =
        Boolean(doData.cargoFinalizedAt) ||
        (Array.isArray(doData.actualDropPoints) && doData.actualDropPoints.length > 0);
    const canCancelTripFromDetail =
        canManageDeliveryStatus &&
        normalizedRole !== 'DRIVER' &&
        !doData.pendingDriverStatus &&
        !hasFinalizedCargoOutcome &&
        displayTripStatus !== 'CANCELLED' &&
        displayTripStatus !== 'DELIVERED' &&
        displayTripStatus !== 'PARTIAL_HOLD' &&
        (suratJalanDocuments.length === 0 || cancelableSuratJalanDocuments.length > 0);

    const openCancelTripModal = async () => {
        if (!canCancelTripFromDetail) return;
        setCancelTripNote('');
        const { categories, accounts } = await loadCancelTripExpenseReferences();
        setCancelTripExpenseForm({
            ...createDefaultCancelTripExpenseForm(),
            categoryRef: getDefaultCancelExpenseCategoryRef(categories),
            bankAccountRef: accounts[0]?._id || '',
            description: `Biaya pembatalan trip ${displayTripNumber}`,
        });
        setShowCancelTripModal(true);
    };
    const eligibleStatusSuratJalanDocuments = newStatus
        ? suratJalanStatusOptions.filter(document => getEligibleStatusesForSuratJalan(document).includes(newStatus))
        : [];
    const selectedStatusSuratJalanSet = new Set(selectedStatusSuratJalanRefs);
    const selectedStatusSuratJalanDocuments = suratJalanDocuments.filter(document =>
        selectedStatusSuratJalanSet.has(document._id)
    );
    const getSuratJalanRefSuffix = (documentId: string) => (
        documentId.startsWith(`${doData._id}:`)
            ? documentId.slice(`${doData._id}:`.length)
            : ''
    );
    const hasSelectedPrimarySuratJalan = selectedStatusSuratJalanDocuments.some(document => !document.referenceKey);
    const selectedStatusReferenceKeys = new Set(
        selectedStatusSuratJalanDocuments
            .flatMap(document => [
                (document.referenceKey || '').trim(),
                getSuratJalanRefSuffix(document._id),
            ])
            .filter(value => value && value !== 'primary')
            .filter(Boolean)
    );
    const selectedStatusReferenceNumbers = new Set(
        selectedStatusSuratJalanDocuments
            .map(document => (document.suratJalanNumber || '').trim().toUpperCase())
            .filter(Boolean)
    );
    const matchesSelectedStatusSuratJalan = (shipperReferenceKey?: string, shipperReferenceNumber?: string) => {
        const normalizedKey = (shipperReferenceKey || '').trim();
        const normalizedNumber = (shipperReferenceNumber || '').trim().toUpperCase();
        if (normalizedKey && selectedStatusReferenceKeys.has(normalizedKey)) {
            return true;
        }
        if (normalizedNumber && selectedStatusReferenceNumbers.has(normalizedNumber)) {
            return true;
        }
        return hasSelectedPrimarySuratJalan && !normalizedKey && !normalizedNumber;
    };
    const partialHoldContinuationItemRefSet = new Set(partialHoldContinuationItemRefs);
    const selectedPartialHoldSuratJalanRefSet = new Set(
        selectedStatusSuratJalanDocuments
            .filter(document =>
                document.tripStatus === 'PARTIAL_HOLD' ||
                (document.holdCargo?.qtyKoli || 0) > 0 ||
                (document.holdCargo?.weightKg || 0) > 0 ||
                (document.holdCargo?.volumeM3 || 0) > 0
            )
            .map(document => document._id)
    );
    const getActualCargoItemSuratJalanRef = (item: ActualCargoDraft) =>
        `${doData._id}:${item.shipperReferenceKey || item.shipperReferenceNumber || 'primary'}`;
    const selectedActualCargoItems = actualCargoItems.filter(item =>
        matchesSelectedStatusSuratJalan(item.shipperReferenceKey, item.shipperReferenceNumber) &&
        (
            reviewingDriverRequest ||
            newStatus !== 'DELIVERED' ||
            !selectedPartialHoldSuratJalanRefSet.has(getActualCargoItemSuratJalanRef(item)) ||
            partialHoldContinuationItemRefSet.has(item.deliveryOrderItemRef)
        )
    );
    const selectedActualCargoItemRefs = new Set(selectedActualCargoItems.map(item => item.deliveryOrderItemRef));
    const selectedActualDropPoints = actualDropPoints.filter(drop => {
        const hasDropTarget =
            Boolean(drop.deliveryOrderItemRef) ||
            Boolean(drop.shipperReferenceKey) ||
            Boolean(drop.shipperReferenceNumber);
        return (
            selectedActualCargoItemRefs.has(drop.deliveryOrderItemRef) ||
            matchesSelectedStatusSuratJalan(drop.shipperReferenceKey, drop.shipperReferenceNumber) ||
            !hasDropTarget
        );
    });
    const expandActualDropPointAllocations = (drop: ActualDropDraft, cargoItems: ActualCargoDraft[]) =>
        cargoItems
            .map(cargoItem => {
                const allocation = getActualDropAllocationForItem(drop, cargoItem);
                const values = pickActualDropItemValues(allocation);
                if (!hasActualDropItemValues(values)) {
                    return null;
                }
                const isVisibleItem = drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef;
                const expandedDrop: ActualDropDraft = {
                    ...drop,
                    ...values,
                    actualDropGroupKey: drop.actualDropGroupKey,
                    draftKey: isVisibleItem
                        ? drop.draftKey
                        : `${drop.draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}${cargoItem.deliveryOrderItemRef}`,
                    deliveryOrderItemRef: cargoItem.deliveryOrderItemRef,
                    shipperReferenceKey: cargoItem.shipperReferenceKey || drop.shipperReferenceKey,
                    shipperReferenceNumber: cargoItem.shipperReferenceNumber || drop.shipperReferenceNumber,
                };
                return expandedDrop;
            })
            .filter((drop): drop is ActualDropDraft => Boolean(drop));
    const selectedWorkingActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }

        return selectedActualDropPoints.flatMap(drop =>
            expandActualDropPointAllocations(drop, selectedActualCargoItems)
        );
    })();
    const getActualCargoSuratJalanGroupKey = (item: ActualCargoDraft) => {
        const referenceKey = item.shipperReferenceKey.trim();
        const referenceNumber = item.shipperReferenceNumber.trim().toUpperCase();
        if (selectedStatusSuratJalanDocuments.length === 1) {
            return `document:${selectedStatusSuratJalanDocuments[0]._id}`;
        }
        const matchedDocument = selectedStatusSuratJalanDocuments.find(document => {
            const documentReferenceKey = (document.referenceKey || '').trim();
            const documentNumber = (document.suratJalanNumber || '').trim().toUpperCase();
            return (
                (referenceKey && documentReferenceKey && referenceKey === documentReferenceKey) ||
                (referenceNumber && documentNumber && referenceNumber === documentNumber)
            );
        });
        if (matchedDocument) {
            return `document:${matchedDocument._id}`;
        }
        if (referenceKey) {
            return `key:${referenceKey}`;
        }
        if (referenceNumber) {
            return `number:${referenceNumber}`;
        }
        return 'primary';
    };
    const selectedEffectiveActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }

        return selectedWorkingActualDropPoints;
    })();
    const shouldDeriveSelectedActualCargoFromDropAllocations =
        showAdvancedDropEditor &&
        selectedEffectiveActualDropPoints.some(point =>
            Boolean(point.deliveryOrderItemRef) &&
            isDeliveryOrderBillableDropType(point.stopType)
        );
    const selectedDerivedActualCargoItems = selectedActualCargoItems.map(item => {
        const manualValues = actualCargoItemValueMap[item.deliveryOrderItemRef];
        if (manualValues && !shouldDeriveSelectedActualCargoFromDropAllocations) {
            return manualValues ? { ...item, ...manualValues } : item;
        }
        if (!shouldDeriveSelectedActualCargoFromDropAllocations) {
            return item;
        }
        const itemRealizationAllocations = selectedEffectiveActualDropPoints
            .filter(point => point.deliveryOrderItemRef === item.deliveryOrderItemRef)
            .filter(point => isDeliveryOrderBillableDropType(point.stopType))
            .map(point => pickActualDropItemValues(point))
            .filter(values => hasActualDropItemValues(values));
        const actualQtyKoli = itemRealizationAllocations.reduce(
            (sum, values) => sum + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
            0
        );
        const actualWeightKg = itemRealizationAllocations.reduce(
            (sum, values) => sum + convertWeightToKg(
                parseFormattedNumberish(values.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                }),
                values.weightInputUnit
            ),
            0
        );
        const actualVolumeM3 = itemRealizationAllocations.reduce(
            (sum, values) => sum + convertVolumeToM3(
                parseFormattedNumberish(values.volumeInputValue || 0, {
                    maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                values.volumeInputUnit
            ),
            0
        );
        return {
            ...item,
            actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
            actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
            actualVolumeInputValue: formatActualDropDraftNumber(
                actualVolumeM3 > 0 ? convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit) : undefined,
                item.actualVolumeInputUnit === 'LITER' ? 0 : 3
            ),
        };
    });
    const selectedActualCargoTotals = selectedDerivedActualCargoItems.reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(item.actualWeightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
            }),
            item.actualWeightInputUnit
        ),
        volumeM3: sum.volumeM3 + convertVolumeToM3(
            parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
            }),
            item.actualVolumeInputUnit
        ),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const selectedActualCargoDisplaySummary = selectedDerivedActualCargoItems.length === 1
        ? {
            ...selectedActualCargoTotals,
            weightInputValue: selectedDerivedActualCargoItems[0].actualWeightInputValue,
            weightInputUnit: selectedDerivedActualCargoItems[0].actualWeightInputUnit,
            volumeInputValue: selectedDerivedActualCargoItems[0].actualVolumeInputValue,
            volumeInputUnit: selectedDerivedActualCargoItems[0].actualVolumeInputUnit,
        }
        : selectedActualCargoTotals;
    const selectedActualDropTotals = selectedEffectiveActualDropPoints.reduce((sum, point) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(point.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
            }),
            point.weightInputUnit
        ),
        volumeM3: sum.volumeM3 + convertVolumeToM3(
            parseFormattedNumberish(point.volumeInputValue || 0, {
                maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            point.volumeInputUnit
        ),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const selectedBatchSuratJalanCargoTotals =
        showAdvancedDropEditor && selectedEffectiveActualDropPoints.length > 0
            ? selectedActualDropTotals
            : selectedActualCargoTotals;
    const selectedActualDropShipperReferenceOptions = actualDropShipperReferenceOptions.filter(reference =>
        matchesSelectedStatusSuratJalan(reference.referenceKey, reference.referenceNumber)
    );
    const {
        autoActualDropDraft: selectedAutoActualDropDraft,
        actualDropAmbiguityMessage: selectedActualDropAmbiguityMessage,
    } = buildDeliveryOrderDetailState({
        doData,
        actualCargoItems: selectedDerivedActualCargoItems,
        actualDropPoints: selectedEffectiveActualDropPoints,
        showAdvancedDropEditor,
    });
    const selectedActualDropBillingCustomerRef = (() => {
        if (!showAdvancedDropEditor) {
            return getActualDropBillingCustomerValue(selectedAutoActualDropDraft);
        }
        const selectedRefs = Array.from(new Set(
            selectedActualDropPoints.map(drop => getActualDropBillingCustomerValue(drop)).filter(Boolean)
        ));
        return selectedRefs.length === 1 ? selectedRefs[0] : '';
    })();
    const updateSelectedActualDropBillingCustomer = (customerRef: string) => {
        const nextCustomer = billingCustomers.find(customer => customer._id === customerRef);
        const selectedDropKeys = new Set(
            showAdvancedDropEditor
                ? selectedActualDropPoints.map(drop => drop.draftKey)
                : [selectedAutoActualDropDraft.draftKey]
        );
        setActualDropPoints(previous => previous.map(item => (
            selectedDropKeys.has(item.draftKey)
                ? {
                    ...item,
                    billingCustomerRef: customerRef,
                    billingCustomerName: nextCustomer?.name || '',
                }
                : item
        )));
    };
    const selectedSubmissionActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            const selectedItemRefs = selectedDerivedActualCargoItems.map(item => item.deliveryOrderItemRef).filter(Boolean);
            const selectedReferenceKeys = Array.from(new Set(
                selectedDerivedActualCargoItems
                    .map(item => item.shipperReferenceKey)
                    .filter(Boolean)
            ));
            const selectedReferenceNumbers = Array.from(new Set(
                selectedDerivedActualCargoItems
                    .map(item => item.shipperReferenceNumber)
                    .filter(Boolean)
            ));

            const scopedAutoDrop = {
                ...selectedAutoActualDropDraft,
                deliveryOrderItemRef: selectedItemRefs.length === 1 ? selectedItemRefs[0] : selectedAutoActualDropDraft.deliveryOrderItemRef,
                shipperReferenceKey: selectedReferenceKeys.length === 1 ? selectedReferenceKeys[0] : selectedAutoActualDropDraft.shipperReferenceKey,
                shipperReferenceNumber: selectedReferenceNumbers.length === 1 ? selectedReferenceNumbers[0] : selectedAutoActualDropDraft.shipperReferenceNumber,
                qtyKoli: formatFormattedNumberValue(selectedActualCargoTotals.qtyKoli, true, 2, true),
                weightInputValue: formatFormattedNumberValue(selectedActualCargoTotals.weightKg, true, 2, true),
                weightInputUnit: 'KG' as const,
                volumeInputValue: formatFormattedNumberValue(selectedActualCargoTotals.volumeM3, true, 3, true),
                volumeInputUnit: 'M3' as const,
            } as ActualDropDraft & { deliveryOrderItemRefs?: string[] };
            if (selectedItemRefs.length > 1) {
                scopedAutoDrop.deliveryOrderItemRefs = selectedItemRefs;
                scopedAutoDrop.deliveryOrderItemRef = '';
            }
            return [scopedAutoDrop];
        }

        const adjustedDropPoints = [...selectedEffectiveActualDropPoints];
        if (reviewingDriverRequest) {
            return adjustedDropPoints.filter(point => (
                parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
                parseFormattedNumberish(point.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                }) > 0 ||
                parseFormattedNumberish(point.volumeInputValue || 0, {
                    maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                }) > 0
            ));
        }

        return adjustedDropPoints.filter(point => (
            parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
            parseFormattedNumberish(point.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
            }) > 0 ||
            parseFormattedNumberish(point.volumeInputValue || 0, {
                maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
            }) > 0
        ));
    })();
    const selectedSubmissionBillableActualDropTotals = selectedSubmissionActualDropPoints
        .filter(point => isDeliveryOrderBillableDropType(point.stopType))
        .reduce((sum, point) => ({
            qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
            weightKg: sum.weightKg + convertWeightToKg(
                parseFormattedNumberish(point.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                }),
                point.weightInputUnit
            ),
            volumeM3: sum.volumeM3 + convertVolumeToM3(
                parseFormattedNumberish(point.volumeInputValue || 0, {
                    maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                point.volumeInputUnit
            ),
        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const selectedActualDropMismatchMessage =
        reviewingDriverRequest
            ? null
            : selectedActualCargoTotals.qtyKoli > 0 && Math.abs(selectedSubmissionBillableActualDropTotals.qtyKoli - selectedActualCargoTotals.qtyKoli) > 0.01
            ? 'Total qty titik DROP harus sama dengan qty aktual barang SJ.'
            : selectedActualCargoTotals.weightKg > 0 && Math.abs(selectedSubmissionBillableActualDropTotals.weightKg - selectedActualCargoTotals.weightKg) > 0.01
                ? 'Total berat titik DROP harus sama dengan berat aktual barang SJ.'
                : selectedActualCargoTotals.volumeM3 > 0 && Math.abs(selectedSubmissionBillableActualDropTotals.volumeM3 - selectedActualCargoTotals.volumeM3) > 0.001
                    ? 'Total volume titik DROP harus sama dengan volume aktual barang SJ.'
                    : null;
    const selectedPhysicalActualDropPoints = showAdvancedDropEditor ? selectedActualDropPoints : selectedEffectiveActualDropPoints;
    const selectedBillableDropCount = selectedPhysicalActualDropPoints.filter(point => isDeliveryOrderBillableDropType(point.stopType)).length;
    const selectedHoldDropCount = selectedPhysicalActualDropPoints.filter(point => isDeliveryOrderHoldDropType(point.stopType)).length;
    const selectedReturnDropCount = selectedPhysicalActualDropPoints.filter(point => isDeliveryOrderReturnDropType(point.stopType)).length;
    const selectedBillableInvoiceDropCount = showAdvancedDropEditor
        ? selectedEffectiveActualDropPoints.filter(point => isDeliveryOrderBillableDropType(point.stopType)).length
        : selectedBillableDropCount;
    const selectedDropModeLabel = showAdvancedDropEditor ? `${selectedPhysicalActualDropPoints.length} titik aktual` : 'Trip normal / 1 tujuan';
    const selectedSuratJalanLabelMap = new Map(
        selectedStatusSuratJalanDocuments.flatMap(document => {
            const labels: Array<[string, string]> = [];
            const label = document.suratJalanNumber || 'Surat Jalan';
            labels.push([`document:${document._id}`, label]);
            if (document.referenceKey) {
                labels.push([`key:${document.referenceKey}`, label]);
            }
            if (document.suratJalanNumber) {
                labels.push([`number:${document.suratJalanNumber.trim().toUpperCase()}`, label]);
            }
            if (!document.referenceKey && !document.suratJalanNumber) {
                labels.push(['primary', label]);
            }
            return labels;
        })
    );
    const selectedDerivedActualCargoGroupMap = selectedDerivedActualCargoItems.reduce<Map<string, {
        key: string;
        label: string;
        items: ActualCargoDraft[];
    }>>((groups, item) => {
        const groupKey = getActualCargoSuratJalanGroupKey(item);
        const fallbackLabel = item.shipperReferenceNumber || 'Surat Jalan';
        const current = groups.get(groupKey) || {
            key: groupKey,
            label: selectedSuratJalanLabelMap.get(groupKey) || fallbackLabel,
            items: [],
        };
        current.items.push(item);
        groups.set(groupKey, current);
        return groups;
    }, new Map());
    const selectedDerivedActualCargoGroups = Array.from(selectedDerivedActualCargoGroupMap.values());
    const selectedDerivedActualCargoTabItems = selectedDerivedActualCargoGroups.flatMap(group =>
        group.items.map(item => ({
            ...item,
            groupLabel: group.label,
        }))
    );
    const selectedActualCargoGroupMap = selectedActualCargoItems.reduce<Map<string, {
        key: string;
        label: string;
        items: ActualCargoDraft[];
    }>>((groups, item) => {
        const groupKey = getActualCargoSuratJalanGroupKey(item);
        const fallbackLabel = item.shipperReferenceNumber || 'Surat Jalan';
        const current = groups.get(groupKey) || {
            key: groupKey,
            label: selectedSuratJalanLabelMap.get(groupKey) || fallbackLabel,
            items: [],
        };
        current.items.push(item);
        groups.set(groupKey, current);
        return groups;
    }, new Map());
    const selectedActualCargoTabItems = Array.from(selectedActualCargoGroupMap.values()).flatMap(group =>
        group.items.map(item => ({
            ...item,
            groupLabel: group.label,
        }))
    );
    const selectedActualDropPointSjGroups = Array.from(selectedActualCargoGroupMap.values()).map(group => ({
        ...group,
        items: group.items.map(item => ({
            ...item,
            groupLabel: group.label,
        })),
    }));
    const summarizeHeldCargoForItem = (item: ActualCargoDraft) => {
        const sourceItem = doItems.find(doItem => doItem._id === item.deliveryOrderItemRef);
        return {
            qtyKoli: parseFormattedNumberish(sourceItem?.heldQtyKoli || 0, { maxFractionDigits: 2 }),
            weightKg: parseFormattedNumberish(sourceItem?.heldWeight || 0, { maxFractionDigits: 2 }),
            volumeM3: parseFormattedNumberish(sourceItem?.heldVolume || 0, { maxFractionDigits: 3 }),
        };
    };
    const summarizeHeldCargoForItems = (items: ActualCargoDraft[]) =>
        items.map(summarizeHeldCargoForItem).reduce((sum, summary) => ({
            qtyKoli: sum.qtyKoli + summary.qtyKoli,
            weightKg: sum.weightKg + summary.weightKg,
            volumeM3: sum.volumeM3 + summary.volumeM3,
        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const getActualDropAllocationSummaryRows = (drop: ActualDropDraft) =>
        selectedActualCargoItems
            .map(cargoItem => {
                const allocation = getActualDropAllocationForItem(drop, cargoItem);
                const allocatedSummary = {
                    qtyKoli: parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: convertWeightToKg(
                        parseFormattedNumberish(allocation.weightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                        }),
                        allocation.weightInputUnit
                    ),
                    volumeM3: convertVolumeToM3(
                        parseFormattedNumberish(allocation.volumeInputValue || 0, {
                            maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        allocation.volumeInputUnit
                    ),
                };
                const totalSummary = {
                    qtyKoli: parseFormattedNumberish(cargoItem.plannedQtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: cargoItem.plannedWeightKg || convertWeightToKg(
                        parseFormattedNumberish(cargoItem.plannedWeightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(cargoItem.plannedWeightInputUnit || 'KG'),
                        }),
                        cargoItem.plannedWeightInputUnit || 'KG'
                    ),
                    volumeM3: cargoItem.plannedVolumeM3 || convertVolumeToM3(
                        parseFormattedNumberish(cargoItem.plannedVolumeInputValue || 0, {
                            maxFractionDigits: (cargoItem.plannedVolumeInputUnit || 'M3') === 'LITER' ? 0 : 3,
                        }),
                        cargoItem.plannedVolumeInputUnit || 'M3'
                    ),
                };
                return {
                    key: cargoItem.deliveryOrderItemRef,
                    label: cargoItem.description || 'Barang',
                    allocatedSummary,
                    totalSummary,
                    hasAllocation: allocatedSummary.qtyKoli > 0 || allocatedSummary.weightKg > 0 || allocatedSummary.volumeM3 > 0,
                };
            })
            .filter(row => row.hasAllocation);
    const getExplicitActualDropItemValues = (drop: ActualDropDraft, cargoItem: ActualCargoDraft): ActualDropItemValueDraft | null => {
        const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        const cachedValues = actualDropItemValueMap[valueKey];
        if (cachedValues && hasActualDropItemValues(cachedValues)) {
            return cachedValues;
        }
        if (drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef) {
            const values = pickActualDropItemValues(drop);
            return hasActualDropItemValues(values) ? values : null;
        }
        return null;
    };
    const summarizeExplicitActualDropItemValues = (drop: ActualDropDraft, cargoItem: ActualCargoDraft) => {
        const explicitValues = getExplicitActualDropItemValues(drop, cargoItem);
        return explicitValues
            ? summarizeActualDropItemValues({
                qtyKoli: explicitValues.qtyKoli,
                weightInputValue: explicitValues.weightInputValue,
                weightInputUnit: explicitValues.weightInputUnit,
                volumeInputValue: explicitValues.volumeInputValue,
                volumeInputUnit: explicitValues.volumeInputUnit,
            })
            : { qtyKoli: 0, weightKg: 0, volumeM3: 0 };
    };
    const getDriverSubmittedAllocationTargetSummary = (cargoItem: ActualCargoDraft) => {
        const sourceDropPoints =
            activeReviewingDriverRequest?.actualDropPoints ||
            doData.pendingDriverActualDropPoints ||
            [];
        const cargoReferenceKey = cargoItem.shipperReferenceKey.trim();
        const cargoReferenceNumber = cargoItem.shipperReferenceNumber.trim().toUpperCase();
        const matchingPoints = sourceDropPoints
            .filter(point => {
                const pointItemRefs = [
                    point.deliveryOrderItemRef,
                    ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
                ].map(value => (value || '').trim()).filter(Boolean);
                if (pointItemRefs.length > 0) {
                    return pointItemRefs.includes(cargoItem.deliveryOrderItemRef);
                }
                const pointReferenceKey = (point.shipperReferenceKey || '').trim();
                const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
                return Boolean(
                    (cargoReferenceKey && pointReferenceKey === cargoReferenceKey) ||
                    (cargoReferenceNumber && pointReferenceNumber === cargoReferenceNumber)
                );
            });
        const summary = matchingPoints.reduce((sum, point) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(point.weightInputValue ?? point.weightKg ?? 0, {
                        maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit || 'KG'),
                    }),
                    point.weightInputUnit || 'KG'
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(point.volumeInputValue ?? point.volumeM3 ?? 0, {
                        maxFractionDigits: (point.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3,
                    }),
                    point.volumeInputUnit || 'M3'
                ),
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        return {
            summary,
            hasSubmittedAllocation: matchingPoints.length > 0,
        };
    };
    const getActualDropAllocationTargetSummary = (cargoItem: ActualCargoDraft) => {
        const baselineTarget = summarizeActualCargoDraftAsCargoSummary(cargoItem);
        if (!reviewingDriverRequest) {
            return baselineTarget;
        }
        const submittedTarget = getDriverSubmittedAllocationTargetSummary(cargoItem);
        return submittedTarget.hasSubmittedAllocation
            ? submittedTarget.summary
            : baselineTarget;
    };
    const getActualDropItemHelper = (drop: ActualDropDraft, cargoItem: ActualCargoDraft) => {
        const currentValues = getExplicitActualDropItemValues(drop, cargoItem);
        const currentSummary = summarizeExplicitActualDropItemValues(drop, cargoItem);
        const otherSummary = selectedActualDropPoints
            .filter(point => point.draftKey !== drop.draftKey)
            .map(point => summarizeExplicitActualDropItemValues(point, cargoItem))
            .reduce((sum, summary) => ({
                qtyKoli: sum.qtyKoli + summary.qtyKoli,
                weightKg: sum.weightKg + summary.weightKg,
                volumeM3: sum.volumeM3 + summary.volumeM3,
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const itemActualSummary = getActualDropAllocationTargetSummary(cargoItem);
        const availableForThisDrop = subtractCargoSummary(itemActualSummary, otherSummary);
        const remainingAfterCurrent = subtractCargoSummary(availableForThisDrop, currentSummary);
        const hasAllocation = Boolean(currentValues);
        return {
            currentSummary,
            otherSummary,
            remainingAfterCurrent,
            hasAllocation,
            badgeLabel: hasAllocation ? 'Terisi' : 'Kosong',
            badgeColor: hasAllocation ? 'var(--color-success)' : 'var(--color-gray-500)',
            badgeBackground: hasAllocation ? 'var(--color-success-soft)' : 'var(--color-gray-100)',
        };
    };
    const getExplicitActualDropItemSummary = (
        cargoItem: ActualCargoDraft,
        includeDrop: (drop: ActualDropDraft) => boolean = () => true
    ) =>
        selectedActualDropPoints
            .filter(includeDrop)
            .map(drop => getExplicitActualDropItemValues(drop, cargoItem))
            .filter((values): values is ActualDropItemValueDraft => Boolean(values))
            .map(values => summarizeActualDropItemValues({
                qtyKoli: values.qtyKoli,
                weightInputValue: values.weightInputValue,
                weightInputUnit: values.weightInputUnit,
                volumeInputValue: values.volumeInputValue,
                volumeInputUnit: values.volumeInputUnit,
            }))
            .reduce((sum, summary) => ({
                qtyKoli: sum.qtyKoli + summary.qtyKoli,
                weightKg: sum.weightKg + summary.weightKg,
                volumeM3: sum.volumeM3 + summary.volumeM3,
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const getActualDropAllocationIncompleteItems = () =>
        selectedActualCargoItems.filter(cargoItem => {
            const target = getActualDropAllocationTargetSummary(cargoItem);
            const allocated = getExplicitActualDropItemSummary(cargoItem);
            const qtyRequired = cargoItem.requireQty || target.qtyKoli > 0;
            const weightRequired = cargoItem.requireWeight || target.weightKg > 0;
            const volumeRequired = cargoItem.requireVolume || target.volumeM3 > 0;
            return (
                (qtyRequired && Math.abs(allocated.qtyKoli - target.qtyKoli) > 0.01) ||
                (weightRequired && Math.abs(allocated.weightKg - target.weightKg) > 0.01) ||
                (volumeRequired && Math.abs(allocated.volumeM3 - target.volumeM3) > 0.001)
            );
        });
    const selectedActualDropIncompleteItems = showAdvancedDropEditor ? getActualDropAllocationIncompleteItems() : [];
    const selectedActualDropAllocationComplete =
        !showAdvancedDropEditor ||
        (selectedActualCargoItems.length > 0 && selectedActualDropIncompleteItems.length === 0);
    const activeFinalizationDrop = activeFinalizationDropKey
        ? selectedActualDropPoints.find(drop => drop.draftKey === activeFinalizationDropKey) || null
        : null;
    const activeFinalizationReviewDrop =
        selectedActualDropPoints.find(drop => drop.draftKey === activeFinalizationReviewDropKey) ||
        selectedActualDropPoints[0] ||
        null;
    const showingDropFinalizationReview = showAdvancedDropEditor && !activeFinalizationDrop;
    const finalizationCargoTabItems = activeFinalizationDrop && activeFinalizationCargoItemRef
        ? selectedActualCargoTabItems.filter(item => item.deliveryOrderItemRef === activeFinalizationCargoItemRef)
        : activeFinalizationDrop
            ? selectedActualCargoTabItems.slice(0, 1)
            : selectedDerivedActualCargoTabItems;
    const activeFinalizationCargoItem =
        finalizationCargoTabItems.find(item => item.deliveryOrderItemRef === activeFinalizationCargoItemRef)
        || finalizationCargoTabItems[0]
        || null;
    const activeFinalizationDropAllocation =
        activeFinalizationDrop && activeFinalizationCargoItem
            ? getActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem)
            : null;
    const summarizeActualCargoDraft = (item: ActualCargoDraft) => {
        const actualWeightInputValue = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        });
        const actualVolumeInputValue = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
        return formatCargoSummary({
            qtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
            weightKg: convertWeightToKg(actualWeightInputValue, item.actualWeightInputUnit),
            weightInputValue: item.actualWeightInputValue,
            weightInputUnit: item.actualWeightInputUnit,
            volumeM3: convertVolumeToM3(actualVolumeInputValue, item.actualVolumeInputUnit),
            volumeInputValue: item.actualVolumeInputValue,
            volumeInputUnit: item.actualVolumeInputUnit,
        });
    };
    const summarizeActualDropPointsForItemByType = (cargoItem: ActualCargoDraft, stopTypes: string[]) => {
        const stopTypeSet = new Set(stopTypes);
        const itemReferenceNumber = cargoItem.shipperReferenceNumber.trim().toUpperCase();
        const summarySourceDropPoints = activeFinalizationDrop
            ? selectedEffectiveActualDropPoints
            : selectedSubmissionActualDropPoints;
        const totals = summarySourceDropPoints
            .filter(point => stopTypeSet.has(point.stopType))
            .reduce((sum, point) => {
                if (point.deliveryOrderItemRef) {
                    if (point.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef) {
                        return sum;
                    }
                    return {
                        qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                        weightKg: sum.weightKg + convertWeightToKg(
                            parseFormattedNumberish(point.weightInputValue || 0, {
                                maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                            }),
                            point.weightInputUnit
                        ),
                        volumeM3: sum.volumeM3 + convertVolumeToM3(
                            parseFormattedNumberish(point.volumeInputValue || 0, {
                                maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                            }),
                            point.volumeInputUnit
                        ),
                    };
                }
                const pointItemRefs = Array.isArray((point as ActualDropDraft & { deliveryOrderItemRefs?: string[] }).deliveryOrderItemRefs)
                    ? (point as ActualDropDraft & { deliveryOrderItemRefs?: string[] }).deliveryOrderItemRefs || []
                    : [];
                if (pointItemRefs.length > 0) {
                    if (!pointItemRefs.includes(cargoItem.deliveryOrderItemRef)) {
                        return sum;
                    }
                    const itemSummary = summarizeActualCargoDraftAsCargoSummary(cargoItem);
                    return {
                        qtyKoli: sum.qtyKoli + itemSummary.qtyKoli,
                        weightKg: sum.weightKg + itemSummary.weightKg,
                        volumeM3: sum.volumeM3 + itemSummary.volumeM3,
                    };
                }
                const matchesReference = (() => {
                if (point.shipperReferenceKey) {
                    return point.shipperReferenceKey === cargoItem.shipperReferenceKey;
                }
                return Boolean(point.shipperReferenceNumber && point.shipperReferenceNumber.trim().toUpperCase() === itemReferenceNumber);
                })();
                if (!matchesReference) {
                    return sum;
                }
                const siblingItemCount = selectedActualCargoItems.filter(item => {
                    const siblingReferenceNumber = item.shipperReferenceNumber.trim().toUpperCase();
                    return (
                        (cargoItem.shipperReferenceKey && item.shipperReferenceKey === cargoItem.shipperReferenceKey) ||
                        (itemReferenceNumber && siblingReferenceNumber === itemReferenceNumber)
                    );
                }).length;
                if (siblingItemCount > 1) {
                    const itemSummary = summarizeActualCargoDraftAsCargoSummary(cargoItem);
                    return {
                        qtyKoli: sum.qtyKoli + itemSummary.qtyKoli,
                        weightKg: sum.weightKg + itemSummary.weightKg,
                        volumeM3: sum.volumeM3 + itemSummary.volumeM3,
                    };
                }
                return {
                    qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: sum.weightKg + convertWeightToKg(
                        parseFormattedNumberish(point.weightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
                        }),
                        point.weightInputUnit
                    ),
                    volumeM3: sum.volumeM3 + convertVolumeToM3(
                        parseFormattedNumberish(point.volumeInputValue || 0, {
                            maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        point.volumeInputUnit
                    ),
                };
            }, { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        if (totals.qtyKoli <= 0 && totals.weightKg <= 0 && totals.volumeM3 <= 0) {
            return '-';
        }
        return formatCargoSummary(totals);
    };
    const selectedActualCargoReady = selectedDerivedActualCargoItems.length > 0 && selectedDerivedActualCargoItems.every(item => {
        if (shouldDeriveSelectedActualCargoFromDropAllocations) {
            const hasBillableAllocation = selectedEffectiveActualDropPoints.some(point =>
                point.deliveryOrderItemRef === item.deliveryOrderItemRef &&
                isDeliveryOrderBillableDropType(point.stopType) &&
                hasActualDropItemValues(pickActualDropItemValues(point))
            );
            if (!hasBillableAllocation) {
                return true;
            }
        }
        const qty = parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 });
        const weight = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        });
        const volume = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
        return (
            (!item.requireQty || qty > 0) &&
            (!item.requireWeight || weight > 0) &&
            (!item.requireVolume || volume > 0) &&
            ((item.requireQty && qty > 0) || weight > 0 || volume > 0)
        );
    });
    const selectedActualDropReady =
        !selectedActualDropMismatchMessage &&
        !selectedActualDropAmbiguityMessage &&
        selectedEffectiveActualDropPoints.length > 0 &&
        selectedEffectiveActualDropPoints.every(item => {
            const qty = parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 });
            const weight = parseFormattedNumberish(item.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
            });
            const volume = parseFormattedNumberish(item.volumeInputValue || 0, {
                maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
            });
            return Boolean(item.locationName.trim() || item.locationAddress.trim()) && (qty > 0 || weight > 0 || volume > 0);
        });
    const getActualCargoStepBlockMessages = () => {
        const messages: ActualCargoStepBlockMessage[] = [];
        if (!newStatus) {
            messages.push({
                kind: 'setup',
                title: 'Status batch SJ belum dipilih',
                detail: 'Pilih status tujuan sebelum masuk ke aktual barang.',
            });
        }
        if (selectedStatusSuratJalanRefs.length === 0) {
            messages.push({
                kind: 'setup',
                title: 'Belum ada SJ yang dipilih',
                detail: 'Pilih minimal satu SJ yang akan diproses.',
            });
        }
        if (!podName.trim()) {
            messages.push({
                kind: 'setup',
                title: 'Nama penerima POD belum diisi',
                detail: 'Isi nama penerima barang/POD terlebih dahulu.',
            });
        }
        if (!podDate) {
            messages.push({
                kind: 'setup',
                title: 'Tanggal POD belum diisi',
                detail: 'Isi tanggal barang diterima.',
            });
        }
        if (selectedActualDropPoints.length === 0) {
            messages.push({
                kind: 'drop',
                title: 'Belum ada titik drop atau hold',
                detail: 'Tambahkan minimal satu titik tujuan untuk alokasi barang.',
            });
        }
        selectedActualDropPoints.forEach((drop, index) => {
            if (!drop.locationName.trim() && !drop.locationAddress.trim()) {
                messages.push({
                    kind: 'drop',
                    title: `Titik ${index + 1} belum punya lokasi`,
                    detail: 'Isi nama lokasi atau alamat titik ini.',
                });
            }
        });
        if (selectedActualDropAmbiguityMessage) {
            messages.push({
                kind: 'drop',
                title: 'Alokasi titik drop belum jelas',
                detail: selectedActualDropAmbiguityMessage,
            });
        }
        if (showAdvancedDropEditor && selectedActualDropIncompleteItems.length > 0) {
            selectedActualDropIncompleteItems.forEach(item => {
                const target = getActualDropAllocationTargetSummary(item);
                const allocated = getExplicitActualDropItemSummary(item);
                messages.push({
                    kind: 'allocation',
                    title: item.description || item.deliveryOrderItemRef,
                    detail: `No SJ: ${item.shipperReferenceNumber || item.shipperReferenceKey || '-'}`,
                    target: formatCargoSummary(target),
                    allocated: formatCargoSummary(allocated),
                });
            });
        }
        return messages;
    };
    const openActualCargoFinalizationStep = () => {
        const blockMessages = getActualCargoStepBlockMessages();
        if (blockMessages.length > 0) {
            setActualCargoStepBlockMessages(blockMessages);
            return;
        }
        rememberStatusModalScrollPosition();
        setActualDropEditSnapshot(null);
        setActiveFinalizationCargoItemRef(showAdvancedDropEditor ? '' : getDefaultFinalizationCargoItemRef(selectedAutoActualDropDraft, selectedDerivedActualCargoTabItems));
        setActiveFinalizationDropKey('');
        setActiveFinalizationReviewDropKey(showAdvancedDropEditor ? (selectedActualDropPoints[0]?.draftKey || '') : '');
        setActualCargoModalReturnTarget('status');
        setShowStatusModal(false);
        setShowActualCargoFinalizationModal(true);
    };
    const selectedDropOutcomeSummary = [
        selectedBillableInvoiceDropCount > 0 ? `${selectedBillableInvoiceDropCount} drop invoice` : null,
        selectedHoldDropCount > 0 ? `${selectedHoldDropCount} hold` : null,
        selectedReturnDropCount > 0 ? `${selectedReturnDropCount} return` : null,
    ].filter(Boolean).join(' • ') || 'Semua muatan mengikuti tujuan default';
    const getSuratJalanStatusRowCargoSummary = (document: SuratJalanDocument) => {
        const holdCargo = document.holdCargo || { qtyKoli: 0, weightKg: 0, volumeM3: 0 };
        const hasHoldCargo =
            (holdCargo.qtyKoli || 0) > 0 ||
            (holdCargo.weightKg || 0) > 0 ||
            (holdCargo.volumeM3 || 0) > 0;

        return hasHoldCargo
            ? `Sisa hold ${formatCargoSummary(holdCargo)}`
            : formatCargoSummary(document.cargoSummary);
    };
    const getItemHoldContinuationPickups = (item: DeliveryOrderItem) => {
        const itemReferenceNumber = (item.shipperReferenceNumber || doData.customerDoNumber || '').trim().toUpperCase();
        const itemReferenceKey = (item.shipperReferenceKey || '').trim();
        return Array.from(new Set(
            (doData.actualDropPoints || [])
                .filter(point => {
                    const pointItemRefs = [
                        point.deliveryOrderItemRef,
                        ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
                    ].map(value => (value || '').trim()).filter(Boolean);
                    const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
                    const pointReferenceKey = (point.shipperReferenceKey || '').trim();
                    return Boolean(
                        (point.originLocationName || point.originLocationAddress) &&
                        (
                            pointItemRefs.includes(item._id) ||
                            (itemReferenceKey && pointReferenceKey === itemReferenceKey) ||
                            (itemReferenceNumber && pointReferenceNumber === itemReferenceNumber)
                        )
                    );
                })
                .map(point => {
                    const origin = point.originLocationName || point.originLocationAddress || '';
                    const destination = point.locationName || point.locationAddress || '';
                    return destination ? `${origin} -> ${destination}` : origin;
                })
                .filter(Boolean)
        ));
    };
    const isPartialSuratJalanBatchFinalize =
        newStatus === 'DELIVERED' &&
        eligibleStatusSuratJalanDocuments.length > 1 &&
        selectedStatusSuratJalanRefs.length > 0 &&
        selectedStatusSuratJalanRefs.length < eligibleStatusSuratJalanDocuments.length;
    const billableDropCount = actualDropSummary.filter(point => isDeliveryOrderBillableDropType(point.stopType)).length;
    const holdDropCount = actualDropSummary.filter(point => isDeliveryOrderHoldDropType(point.stopType)).length;
    const returnDropCount = actualDropSummary.filter(point => isDeliveryOrderReturnDropType(point.stopType)).length;
    type ActualDropSummaryPoint = NonNullable<DeliveryOrder['actualDropPoints']>[number];
    const getActualDropPointCargoSummary = (point: ActualDropSummaryPoint) => ({
        qtyKoli: point.qtyKoli,
        weightKg: point.weightKg,
        weightInputValue: point.weightInputValue,
        weightInputUnit: point.weightInputUnit,
        volumeM3: point.volumeM3,
        volumeInputValue: point.volumeInputValue,
        volumeInputUnit: point.volumeInputUnit,
    });
    const getActualDropPointItemRefs = (point: ActualDropSummaryPoint) => Array.from(new Set([
        point.deliveryOrderItemRef,
        ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
    ].map(value => (value || '').trim()).filter(Boolean)));
    const getActualDropPointItems = (point: ActualDropSummaryPoint) => {
        const itemRefs = getActualDropPointItemRefs(point);
        if (itemRefs.length > 0) {
            const itemRefSet = new Set(itemRefs);
            return doItems.filter(item => itemRefSet.has(item._id));
        }

        const pointReferenceKey = (point.shipperReferenceKey || '').trim();
        const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
        if (!pointReferenceKey && !pointReferenceNumber) {
            return [];
        }

        return doItems.filter(item => {
            const itemReferenceKey = (item.shipperReferenceKey || '').trim();
            const itemReferenceNumber = (item.shipperReferenceNumber || '').trim().toUpperCase();
            return (
                (pointReferenceKey && itemReferenceKey === pointReferenceKey) ||
                (pointReferenceNumber && itemReferenceNumber === pointReferenceNumber)
            );
        });
    };
    const getDeliveryOrderItemPlannedCargoBase = (item: DeliveryOrderItem) => ({
        qtyKoli: item.orderItemQtyKoli || item.actualQtyKoli || 0,
        weightKg: item.orderItemWeight || item.actualWeightKg || 0,
        volumeM3: item.orderItemVolumeM3 || item.actualVolumeM3 || 0,
    });
    const getDeliveryOrderItemActualDropAllocationBase = (point: ActualDropSummaryPoint, item: DeliveryOrderItem) => {
        const plannedBase = getDeliveryOrderItemPlannedCargoBase(item);
        if (!isDeliveryOrderHoldDropType(point.stopType)) {
            return plannedBase;
        }

        return {
            qtyKoli: item.heldQtyKoli || plannedBase.qtyKoli,
            weightKg: item.heldWeight || plannedBase.weightKg,
            volumeM3: item.heldVolume || plannedBase.volumeM3,
        };
    };
    const getAllocatedActualDropCargoSummary = (
        point: ActualDropSummaryPoint,
        groupItems: DeliveryOrderItem[],
        allPointItems: DeliveryOrderItem[]
    ) => {
        const pointSummary = getActualDropPointCargoSummary(point);
        if (allPointItems.length <= 1) {
            return pointSummary;
        }

        const getRatio = (field: 'qtyKoli' | 'weightKg' | 'volumeM3') => {
            const allTotal = allPointItems.reduce((sum, item) => sum + getDeliveryOrderItemActualDropAllocationBase(point, item)[field], 0);
            const groupTotal = groupItems.reduce((sum, item) => sum + getDeliveryOrderItemActualDropAllocationBase(point, item)[field], 0);
            if (allTotal > 0) {
                return groupTotal / allTotal;
            }
            return groupItems.length / allPointItems.length;
        };

        const qtyKoli = (point.qtyKoli || 0) * getRatio('qtyKoli');
        const weightKg = (point.weightKg || 0) * getRatio('weightKg');
        const volumeM3 = (point.volumeM3 || 0) * getRatio('volumeM3');
        return {
            qtyKoli: qtyKoli > 0 ? qtyKoli : undefined,
            weightKg: weightKg > 0 ? weightKg : undefined,
            weightInputValue: undefined,
            weightInputUnit: undefined,
            volumeM3: volumeM3 > 0 ? volumeM3 : undefined,
            volumeInputValue: undefined,
            volumeInputUnit: undefined,
        };
    };
    const getDeliveryOrderItemSjNumber = (item: DeliveryOrderItem) => {
        const itemNumber = (item.shipperReferenceNumber || '').trim();
        if (itemNumber) {
            return itemNumber;
        }
        return 'SJ tidak terpetakan';
    };
    const getActualDropPointSjNumber = (point: ActualDropSummaryPoint, items: DeliveryOrderItem[]) => {
        const explicitNumber = (point.shipperReferenceNumber || '').trim();
        if (explicitNumber) {
            return explicitNumber;
        }
        const itemNumbers = Array.from(new Set(
            items
                .map(item => (item.shipperReferenceNumber || '').trim())
                .filter(Boolean)
        ));
        if (itemNumbers.length === 1) {
            return itemNumbers[0];
        }
        if (itemNumbers.length > 1) {
            return 'Gabungan SJ';
        }
        return doData.customerDoNumber || 'SJ utama';
    };
    const getActualDropPointSjEntries = (point: ActualDropSummaryPoint) => {
        const matchedItems = getActualDropPointItems(point);
        const explicitItemRefs = getActualDropPointItemRefs(point);
        if (matchedItems.length <= 1) {
            const sjNumber = getActualDropPointSjNumber(point, matchedItems);
            return [{
                key: `${point.shipperReferenceKey || sjNumber}-${sjNumber}`,
                sjNumber,
                label: matchedItems.length === 1
                    ? (() => {
                        const item = matchedItems[0];
                        const identity = getDeliveryOrderItemIdentity(item);
                        return formatItemCodeNameLabel(identity.code, identity.name || item.orderItemDescription || '', 'Item 1');
                    })()
                    : 'Muatan aktual titik ini',
                cargoSummary: getActualDropPointCargoSummary(point),
            }];
        }
        if (explicitItemRefs.length > 1) {
            return matchedItems.map((item, index) => {
                const sjNumber = getDeliveryOrderItemSjNumber(item);
                const identity = getDeliveryOrderItemIdentity(item);
                return {
                    key: `${item.shipperReferenceKey || sjNumber}-${sjNumber}`,
                    sjNumber,
                    label: formatItemCodeNameLabel(identity.code, identity.name || item.orderItemDescription || '', `Item ${index + 1}`),
                    cargoSummary: getAllocatedActualDropCargoSummary(point, [item], matchedItems),
                };
            });
        }

        const groupedItems = matchedItems.reduce((map, item) => {
            const sjNumber = getDeliveryOrderItemSjNumber(item);
            const key = `${item.shipperReferenceKey || sjNumber}-${sjNumber}`;
            const current = map.get(key) || {
                key,
                sjNumber,
                items: [] as DeliveryOrderItem[],
            };
            current.items.push(item);
            map.set(key, current);
            return map;
        }, new Map<string, { key: string; sjNumber: string; items: DeliveryOrderItem[] }>());

        return Array.from(groupedItems.values()).map(group => ({
            key: group.key,
            sjNumber: group.sjNumber,
            label: group.items.map((item, index) => {
                const identity = getDeliveryOrderItemIdentity(item);
                return formatItemCodeNameLabel(identity.code, identity.name || item.orderItemDescription || '', `Item ${index + 1}`);
            }).join(', '),
            cargoSummary: getAllocatedActualDropCargoSummary(point, group.items, matchedItems),
        }));
    };
    const getActualDropPointPodInfo = (point: ActualDropSummaryPoint) => ({
        receiverName: (point.podReceiverName || '').trim() || doData.podReceiverName || '',
        receivedDate: (point.podReceivedDate || '').trim() || doData.podReceivedDate || '',
        note: (point.podNote || '').trim() || '',
    });
    const getActualDropDisplayGroupKey = (point: ActualDropSummaryPoint) => {
        const groupKey = (point.actualDropGroupKey || '').trim();
        const podInfo = getActualDropPointPodInfo(point);
        return [
            groupKey || point.sequence,
            point.stopType,
            point.billingCustomerRef || '',
            point.billingCustomerName || '',
            point.originLocationName || '',
            point.originLocationAddress || '',
            point.locationName || '',
            point.locationAddress || '',
            podInfo.receiverName,
            podInfo.receivedDate,
            podInfo.note,
            point.note || '',
        ].join('|');
    };
    const actualDropDisplayGroups = Array.from(
        actualDropSummary
            .slice()
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .reduce((groups, point) => {
                const key = getActualDropDisplayGroupKey(point);
                const current = groups.get(key);
                if (current) {
                    current.points.push(point);
                    current.sequence = Math.min(current.sequence, point.sequence || current.sequence);
                } else {
                    groups.set(key, {
                        key,
                        sequence: point.sequence || groups.size + 1,
                        points: [point],
                    });
                }
                return groups;
            }, new Map<string, { key: string; sequence: number; points: ActualDropSummaryPoint[] }>())
            .values()
    ).map(group => {
        const sortedPoints = group.points.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        const firstPoint = sortedPoints[0];
        const totals = sortedPoints.reduce((sum, point) => ({
            qtyKoli: sum.qtyKoli + (point.qtyKoli || 0),
            weightKg: sum.weightKg + (point.weightKg || 0),
            volumeM3: sum.volumeM3 + (point.volumeM3 || 0),
        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const sjGroups = Array.from(sortedPoints.reduce((map, point) => {
            getActualDropPointSjEntries(point).forEach(entry => {
                const current = map.get(entry.key) || {
                    key: entry.key,
                    sjNumber: entry.sjNumber,
                    rows: [] as Array<{
                        key: string;
                        label: string;
                        cargoSummary: ReturnType<typeof getActualDropPointCargoSummary>;
                        note: string;
                    }>,
                };
                current.rows.push({
                    key: `${point._key || point.sequence}-${entry.key}-${current.rows.length}`,
                    label: entry.label,
                    cargoSummary: entry.cargoSummary,
                    note: point.note || '',
                });
                map.set(entry.key, current);
            });
            return map;
        }, new Map<string, {
            key: string;
            sjNumber: string;
            rows: Array<{
                key: string;
                label: string;
                cargoSummary: ReturnType<typeof getActualDropPointCargoSummary>;
                note: string;
            }>;
        }>()).values());

        return {
            ...group,
            firstPoint,
            sortedPoints,
            totals,
            podInfo: getActualDropPointPodInfo(firstPoint),
            sjGroups,
        };
    });
    const auditTrailEntityRefs = Array.from(new Set([
        doData._id,
        tripData?._id,
        linkedVoucher?._id,
        linkedTripCashLink?.voucherId,
        ...suratJalanDocuments.map(document => document._id),
        ...doItems.map(item => item._id),
    ].filter((ref): ref is string => Boolean(ref))));
    const summarizeHeldDeliveryOrderItem = (item: DeliveryOrderItem) => ({
        qtyKoli: parseFormattedNumberish(item.heldQtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: parseFormattedNumberish(item.heldWeight || 0, { maxFractionDigits: 2 }),
        volumeM3: parseFormattedNumberish(item.heldVolume || 0, { maxFractionDigits: 3 }),
    });
    const summarizeHeldDeliveryOrderItems = (items: DeliveryOrderItem[]) =>
        items.map(summarizeHeldDeliveryOrderItem).reduce((sum, summary) => ({
            qtyKoli: sum.qtyKoli + summary.qtyKoli,
            weightKg: sum.weightKg + summary.weightKg,
            volumeM3: sum.volumeM3 + summary.volumeM3,
        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const renderCargoItemRow = (item: DeliveryOrderItem) => {
        const holdContinuationPickups = getItemHoldContinuationPickups(item);
        const itemHoldSummary = summarizeHeldDeliveryOrderItem(item);
        return (
            <tr key={item._id}>
                <td>
                    <div className="font-medium">
                        {item.pickupStopKey && pickupStopMap.get(item.pickupStopKey)
                            ? formatPickupStopDisplayName(pickupStopMap.get(item.pickupStopKey)!)
                            : item.pickupAddress || '-'}
                    </div>
                    <div className="text-muted text-xs">{item.pickupAddress || pickupStopMap.get(item.pickupStopKey || '')?.pickupAddress || '-'}</div>
                    {holdContinuationPickups.length > 0 && (
                        <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>
                            Pickup tambahan hold: {holdContinuationPickups.join(', ')}
                        </div>
                    )}
                </td>
                <td>
                    {(() => {
                        const identity = getDeliveryOrderItemIdentity(item);
                        return (
                            <>
                                <div className="font-mono text-xs text-muted">{identity.code || '-'}</div>
                                <div className="font-medium">{identity.name || item.orderItemDescription || '-'}</div>
                            </>
                        );
                    })()}
                </td>
                <td>
                    <div className="text-muted text-xs">Rencana Trip (Estimasi)</div>
                    <div className="font-medium">{item.orderItemQtyKoli && item.orderItemQtyKoli > 0 ? `${item.orderItemQtyKoli} koli` : '-'}</div>
                    <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual Final</div>
                    <div className="font-medium" style={{ color: item.actualQtyKoli !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                        {item.actualQtyKoli !== undefined
                            ? `${item.actualQtyKoli} koli`
                            : item.orderItemQtyKoli && item.orderItemQtyKoli > 0
                                ? 'Belum final'
                                : '-'}
                    </div>
                    <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Hold</div>
                    <div className="font-medium">
                        {hasCargoSummaryValue(itemHoldSummary) ? `${itemHoldSummary.qtyKoli} koli` : '-'}
                    </div>
                </td>
                <td>
                    <div className="text-muted text-xs">Rencana Trip (Estimasi)</div>
                    <div className="font-medium">
                        {formatCargoSummary({
                            qtyKoli: item.orderItemQtyKoli,
                            weightKg: item.orderItemWeight,
                            weightInputValue: item.orderItemWeightInputValue,
                            weightInputUnit: item.orderItemWeightInputUnit,
                            volumeM3: item.orderItemVolumeM3,
                            volumeInputValue: item.orderItemVolumeInputValue,
                            volumeInputUnit: item.orderItemVolumeInputUnit,
                        })}
                    </div>
                    <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual Final</div>
                    <div className="font-medium" style={{ color: item.actualQtyKoli !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                        {item.actualQtyKoli !== undefined || item.actualWeightKg !== undefined || item.actualVolumeM3 !== undefined
                            ? formatCargoSummary({
                                qtyKoli: item.actualQtyKoli,
                                weightKg: item.actualWeightKg,
                                weightInputValue: item.actualWeightInputValue,
                                weightInputUnit: item.actualWeightInputUnit,
                                volumeM3: item.actualVolumeM3,
                                volumeInputValue: item.actualVolumeInputValue,
                                volumeInputUnit: item.actualVolumeInputUnit,
                            })
                            : 'Belum final'}
                    </div>
                    <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Hold</div>
                    <div className="font-medium">
                        {hasCargoSummaryValue(itemHoldSummary) ? formatCargoSummary(itemHoldSummary) : '-'}
                    </div>
                </td>
            </tr>
        );
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/trips" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            {displayTripNumber}
                            <span className={`badge badge-${displayStatusMeta.color}`}>
                                <span className="badge-dot" /> {displayStatusMeta.label}
                            </span>
                        </h1>
                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                            Status trip ini dibaca otomatis dari progres seluruh Surat Jalan di bawahnya.
                        </div>
                    </div>
                </div>
                <div className="page-actions">
                    {availableBatchStatuses.length > 0 && canManageDeliveryStatus && (
                        <button className="btn btn-primary" onClick={() => openStatusModal()}>
                            <Truck size={16} /> Update Batch SJ
                        </button>
                    )}
                    {canManageDeliveryStatus && (
                        <button className="btn btn-secondary" onClick={() => void toggleTripClosure()} disabled={togglingTripClosure}>
                            {togglingTripClosure
                                ? 'Menyimpan...'
                                : isTripClosedByAdmin
                                    ? 'Buka Kembali Trip'
                                    : 'Tutup Trip'}
                        </button>
                    )}
                    {canExportDeliveryOrder && <button className="btn btn-secondary" onClick={handleExportPDF}>
                        <FileDown size={16} /> Export PDF
                    </button>}
                    {canPrintDeliveryOrder && <button className="btn btn-secondary" onClick={handlePrint}>
                        <Printer size={16} /> Print
                    </button>}
                </div>
            </div>

            {doData.status === 'CREATED' && (!doData.vehicleRef || !doData.driverRef) && (
                <div className="card" style={{ marginBottom: 'var(--space-4)', border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-soft)' }}>
                    <div className="card-body">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'grid', gap: '0.35rem' }}>
                                <div className="form-section-title" style={{ marginBottom: 0 }}>Armada Trip Belum Lengkap</div>
                                <div className="detail-value">
                                    {!doData.vehicleRef && !doData.driverRef
                                        ? 'Kendaraan dan supir belum dipilih. Lengkapi dulu sebelum trip diteruskan ke workflow operasional berikutnya.'
                                        : !doData.vehicleRef
                                            ? 'Kendaraan trip belum dipilih. Lengkapi dulu sebelum trip diteruskan ke workflow operasional berikutnya.'
                                            : 'Supir trip belum dipilih. Lengkapi dulu sebelum trip diteruskan ke workflow operasional berikutnya.'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {pendingDriverRequests.length > 0 && (
                <div style={{ display: 'grid', gap: '0.75rem', marginBottom: 'var(--space-4)' }}>
                    {pendingDriverRequests.map(request => {
                        const requestMeta = DO_STATUS_MAP[request.status] || pendingDriverStatusMeta;
                        const requestIsTripClosure = isPendingDriverTripClosureRequest(request);
                        const requestSuratJalanLinks = (request.targetSuratJalanRefs || [])
                            .map(ref => {
                                const document = suratJalanDocuments.find(item => item._id === ref);
                                return {
                                    id: document?._id || '',
                                    label: document?.suratJalanNumber || ref.split(':').pop() || ref,
                                };
                            })
                            .filter(Boolean);
                        return (
                            <div key={request.requestId} className="card" style={{ border: '1px solid var(--color-warning-light)', background: 'var(--color-warning-soft)' }}>
                                <div className="card-body">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                        <div style={{ display: 'grid', gap: '0.35rem' }}>
                                            <div className="form-section-title" style={{ marginBottom: 0 }}>Permintaan Driver Menunggu Approval</div>
                                            <div className="detail-value">
                                                {requestIsTripClosure ? 'Driver mengajukan tutup trip' : 'Driver mengajukan progres batch SJ ke status'}{' '}
                                                {!requestIsTripClosure && (
                                                    <span className={`badge badge-${requestMeta?.color || 'warning'}`}>
                                                        <span className="badge-dot" /> {requestMeta?.label || request.status}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-muted text-sm">
                                                {(request.requestedByName || doData.pendingDriverStatusRequestedByName || 'Driver')} | {formatDateTime(request.requestedAt || doData.pendingDriverStatusRequestedAt)}
                                            </div>
                                            {requestSuratJalanLinks.length > 0 && (
                                                <div className="text-muted text-sm" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <span>SJ:</span>
                                                    {requestSuratJalanLinks.map((link, index) => (
                                                        link.id ? (
                                                            <Link key={link.id} href={withReturnTo(`/surat-jalan/${encodeURIComponent(link.id)}`)} style={{ color: 'var(--color-primary)' }}>
                                                                {link.label}
                                                            </Link>
                                                        ) : (
                                                            <span key={`${link.label}-${index}`}>{link.label}</span>
                                                        )
                                                    ))}
                                                </div>
                                            )}
                                            {request.note && (
                                                <div className="text-muted text-sm">Catatan driver: {request.note}</div>
                                            )}
                                            {request.tripEndOdometerKm ? (
                                                <div className="text-muted text-sm">
                                                    Odometer akhir diajukan: {formatQuantity(request.tripEndOdometerKm, 0)} km
                                                </div>
                                            ) : null}
                                        </div>
                                        {canReviewDriverRequest ? (
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <button
                                                    className="btn btn-success"
                                                    onClick={() => {
                                                        setReviewingDriverRequestId(request.requestId);
                                                        if (requestIsTripClosure) {
                                                            void toggleTripClosure(request.tripEndOdometerKm || undefined);
                                                            return;
                                                        }
                                                        openStatusModal(request.status, true, request);
                                                    }}
                                                >
                                                    <Save size={16} /> {requestIsTripClosure ? 'Review Tutup Trip' : 'Review & Approve'}
                                                </button>
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => {
                                                        setReviewingDriverRequestId(request.requestId);
                                                        setRejectRequestNote('');
                                                        setShowRejectRequestModal(true);
                                                    }}
                                                >
                                                    Tolak
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="text-muted text-sm">Menunggu review owner / operasional.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {canShowTripManager && (
                <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="card-header">
                        <span className="card-header-title">Kelola Trip</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '0.85rem' }}>
                        <div className="text-muted text-sm">
                            Kelola armada, dokumen SJ, dan uang jalan dari halaman ini. Progres status operasional mengikuti batch SJ.
                        </div>
                        <div className="text-muted text-sm">
                            {displayTripStatus === 'CANCELLED'
                                ? 'Trip sudah dibatalkan. SJ tertaut ikut dibatalkan dan order/resi tetap aktif.'
                                : isTripClosedByAdmin
                                ? `Trip sudah ditutup admin${doData.tripClosedByAdminName ? ` oleh ${doData.tripClosedByAdminName}` : ''}. Tambah SJ dan edit muatan SJ dikunci sampai trip dibuka kembali.`
                                : 'Trip masih terbuka. Admin masih bisa menambah SJ baru walaupun seluruh SJ sebelumnya sudah selesai.'}
                        </div>
                        <div className="detail-action-group" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {doData.status === 'CREATED' && canAssignTripResources && !hasLinkedTripCash && (
                                <button className="btn btn-secondary btn-sm" onClick={() => void openTripResourcesModal()}>
                                    <Truck size={14} /> Edit Trip / Armada
                                </button>
                            )}
                            {canAppendCargoToDo && (
                                <button className="btn btn-secondary btn-sm" onClick={() => openShipperReferenceModal('create')}>
                                    <Plus size={14} /> Tambah SJ
                                </button>
                            )}
                            {canCancelTripFromDetail && (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => void openCancelTripModal()}
                                >
                                    Batalkan Trip
                                </button>
                            )}
                            {canManageDeliveryStatus && (
                                <button className="btn btn-secondary btn-sm" onClick={() => void toggleTripClosure()} disabled={togglingTripClosure}>
                                    {togglingTripClosure
                                        ? 'Menyimpan...'
                                        : isTripClosedByAdmin
                                            ? 'Buka Kembali Trip'
                                            : 'Tutup Trip'}
                                </button>
                            )}
                            {canManageTripFee && !hasLinkedTripCash && !editingTarip && (
                                <button className="btn btn-secondary btn-sm" onClick={openTripFeeEditor}>
                                    <Edit size={14} /> {doData.taripBorongan ? 'Edit Upah Trip' : 'Isi Upah Trip'}
                                </button>
                            )}
                        </div>
                        {!hasLinkedTripCash && canCreateTripCash && voucherIssueBlockingReasons.length > 0 && (
                            <div className="text-muted text-sm">
                                Uang jalan trip belum bisa diterbitkan: {voucherIssueBlockingReasons.join('; ')}.
                            </div>
                        )}
                        {linkedTripCashBonNumber && (
                            <div className="text-muted text-sm">
                            Trip ini sudah terhubung ke uang jalan trip {linkedTripCashBonNumber}. Armada trip dan upah trip dikunci supaya penyelesaian uang jalan tidak berubah diam-diam.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {(canViewTripCash || canCreateTripCash || hasLinkedTripCash) && (
                <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Uang Jalan Trip</span>
                        <div className="detail-action-group" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {canAddLinkedTripCashExpense && (
                                <button className="btn btn-secondary btn-sm" onClick={openTripCashExpenseModal}>
                                    <Plus size={14} /> Biaya Lain-lain
                                </button>
                            )}
                            {canTopUpLinkedTripCash && (
                                <button className="btn btn-secondary btn-sm" onClick={() => void openTripCashTopUpModal()}>
                                    <Plus size={14} /> Tambah Uang Jalan
                                </button>
                            )}
                            {canSettleLinkedTripCash && (
                                <button className="btn btn-primary btn-sm" onClick={() => void openTripCashSettleModal()}>
                                    <CheckCircle size={14} /> Selesaikan Bon
                                </button>
                            )}
                            {linkedTripCashVoucherId && canOpenTripCashPage && (
                                <Link className="btn btn-secondary btn-sm" href={withReturnTo(`/driver-vouchers/${linkedTripCashVoucherId}`)}>
                                    <Wallet size={14} /> Buka Detail Bon
                                </Link>
                            )}
                            {!hasLinkedTripCash && canIssueVoucherFromDo && (
                                <button className="btn btn-primary btn-sm" onClick={() => void openTripCashIssueModal()}>
                                    <Wallet size={14} /> Terbitkan Uang Jalan
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="card-body">
                        {linkedVoucher && linkedVoucherSummary ? (
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div className="detail-label">Bon Terkait</div>
                                        <div className="detail-value font-mono">
                                            {canOpenTripCashPage ? <Link href={withReturnTo(`/driver-vouchers/${linkedVoucher._id}`)}>{linkedVoucher.bonNumber}</Link> : linkedVoucher.bonNumber}
                                        </div>
                                    </div>
                                    {linkedVoucherStatusMeta && (
                                        <span className={`badge ${linkedVoucherStatusMeta.cls}`}>{linkedVoucherStatusMeta.label}</span>
                                    )}
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Tanggal Bon</div>
                                        <div className="detail-value">{formatDate(linkedVoucher.issuedDate)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Sumber Dana</div>
                                        <div className="detail-value">{linkedVoucher.issueBankName || '-'}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Uang Jalan Awal</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.initialCashGiven)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Top Up Uang Jalan</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.topUpAmount)}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Biaya Lain-lain</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.totalSpent)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Upah Borongan</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.driverFeeAmount)}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Total Biaya</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.totalClaimAmount)}</div>
                                    </div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Total Uang Diberikan</div>
                                        <div className="detail-value">{formatCurrency(linkedVoucherSummary.totalIssuedAmount)}</div>
                                        {linkedVoucherCashBreakdown && (
                                            <div className="text-muted text-sm">{linkedVoucherCashBreakdown}</div>
                                        )}
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">{linkedVoucherSettlementDisplay?.label || 'Penyelesaian Uang Jalan'}</div>
                                        <div
                                            className="detail-value"
                                            style={{ color: linkedVoucherSummary.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}
                                        >
                                            {formatCurrency(linkedVoucherSettlementDisplay?.amount ?? Math.abs(linkedVoucherSummary.balance))}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {linkedVoucherSettlementDisplay?.description || ''}
                                        </div>
                                        {linkedVoucherSettlementDisplay && linkedVoucherSettlementDisplay.amount !== linkedVoucherSettlementDisplay.settlementAmount && (
                                            <div className="text-muted text-sm">Sisa dicairkan saat penutupan: {formatCurrency(linkedVoucherSettlementDisplay.settlementAmount)}</div>
                                        )}
                                    </div>
                                </div>
                                <div className="text-muted text-sm">
                                    Bon ini melekat ke trip ini. Tambahan uang jalan dan biaya lain-lain bisa dicatat dari halaman ini.
                                </div>
                            </div>
                        ) : hasLinkedTripCash ? (
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div className="detail-label">Bon Terkait</div>
                                        <div className="detail-value font-mono">{linkedTripCashBonNumber || '-'}</div>
                                    </div>
                                    {linkedVoucherStatusMeta && (
                                        <span className={`badge ${linkedVoucherStatusMeta.cls}`}>{linkedVoucherStatusMeta.label}</span>
                                    )}
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item">
                                        <div className="detail-label">Tanggal Bon</div>
                                        <div className="detail-value">{formatDate(linkedTripCashIssuedDate)}</div>
                                    </div>
                                    <div className="detail-item">
                                        <div className="detail-label">Akses Detail Bon</div>
                                        <div className="detail-value">{canOpenTripCashPage ? 'Tersedia' : 'Role ini hanya melihat keterkaitan DO dengan bon'}</div>
                                    </div>
                                </div>
                                <div className="text-muted text-sm">
                                    Trip ini sudah punya uang jalan trip. Armada dan upah borongan dikunci agar penyelesaian uang jalan tidak berubah diam-diam.
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                <div className="detail-value">Belum ada uang jalan trip yang terbit untuk trip ini.</div>
                                <div className="text-muted text-sm">
                                    Terbitkan uang jalan dari trip ini setelah trip siap jalan.
                                </div>
                                {canCreateTripCash && voucherIssueDraftNotes.length > 0 && voucherIssueBlockingReasons.length === 0 && (
                                    <div className="text-muted text-sm">
                                        Bisa dilengkapi saat terbit bon: {voucherIssueDraftNotes.join('; ')}.
                                    </div>
                                )}
                                {canCreateTripCash && voucherIssueBlockingReasons.length > 0 && (
                                    <div className="text-muted text-sm">
                                        Yang masih perlu dilengkapi: {voucherIssueBlockingReasons.join('; ')}.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Informasi Trip</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Trip Internal</div><div className="detail-value font-mono"><Link href={`/trips/${doData._id}`}>{displayTripNumber}</Link></div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal Trip</div><div className="detail-value">{formatDate(doData.date)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{canOpenVehiclePage && doData.vehicleRef ? <Link href={withReturnTo(`/fleet/vehicles/${doData.vehicleRef}`)}>{doData.vehiclePlate || '-'}</Link> : (doData.vehiclePlate || '-')}</div></div>
                            <div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{canOpenDriverPage && doData.driverRef ? <Link href={withReturnTo(`/fleet/drivers/${doData.driverRef}`)}>{doData.driverName || '-'}</Link> : (doData.driverName || '-')}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{canOpenCustomerPage && doData.customerRef ? <Link href={withReturnTo(`/customers/${doData.customerRef}`)}>{doData.customerName || '-'}</Link> : (doData.customerName || '-')}</div></div>
                            <div className="detail-item"><div className="detail-label">Master Resi</div><div className="detail-value">{canOpenSourceOrderPage ? <Link href={withReturnTo(`/orders/${doData.orderRef}`)}>{doData.masterResi}</Link> : doData.masterResi}</div></div>
                        </div>
                        {shipperReferenceDisplayList.length > 0 && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Surat Jalan Terkait</div>
                                    <div className="detail-value" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {shipperReferenceDisplayList.map(reference => {
                                            const document = suratJalanDocumentByReferenceKey.get(reference.referenceKey || 'primary');
                                            return document ? (
                                                <Link key={document._id} href={withReturnTo(`/surat-jalan/${encodeURIComponent(document._id)}`)}>
                                                    {formatSuratJalanDisplayNumber(reference.referenceNumber, document)}
                                                </Link>
                                            ) : (
                                                <span key={reference.draftKey || reference.referenceKey || reference.referenceNumber}>{formatSuratJalanDisplayNumber(reference.referenceNumber, document)}</span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Armada Diminta</div><div className="detail-value">{doData.serviceName || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Armada Aktual</div><div className="detail-value">{doData.vehicleServiceName || doData.serviceName || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Alasan Override Armada</div><div className="detail-value">{doData.vehicleCategoryOverrideReason || '-'}</div></div>
                            <div className="detail-item detail-full">
                                <div className="detail-label">Pickup Trip</div>
                                {pickupTripDisplayList.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem' }}>
                                        {pickupTripDisplayList.map((pickup, index) => (
                                            <div
                                                key={pickup.key || `pickup-${index + 1}`}
                                                style={{
                                                    border: '1px solid var(--color-gray-200)',
                                                    borderRadius: '0.65rem',
                                                    padding: '0.65rem 0.75rem',
                                                    background: 'var(--color-gray-50)',
                                                    minWidth: 0,
                                                }}
                                            >
                                                <div className="detail-value" style={{ overflowWrap: 'anywhere' }}>{pickup.name}</div>
                                                {pickup.address && pickup.address !== pickup.name && (
                                                    <div className="text-muted text-sm" style={{ marginTop: '0.15rem', overflowWrap: 'anywhere' }}>
                                                        {pickup.address}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="detail-value">-</div>
                                )}
                            </div>
                        </div>
                        {doData.cargoFinalizedAt && (
                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Muatan Aktual Final</div>
                                    <div className="detail-value">{formatDateTime(doData.cargoFinalizedAt)}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Difinalkan Oleh</div>
                                    <div className="detail-value">{doData.cargoFinalizedByName || '-'}</div>
                                </div>
                            </div>
                        )}
                        {doData.notes && <div className="mt-2"><div className="detail-label">Catatan Trip</div><div className="detail-value">{doData.notes}</div></div>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span className="card-header-title">Dokumen Surat Jalan</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            {canManageDeliveryStatus && !isTripClosedByAdmin && (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => openSuratJalanActualEditModal()}
                                    disabled={savingSuratJalanActualEdit || suratJalanActualEditDocumentOptions.length === 0}
                                    title={suratJalanActualEditDocumentOptions.length === 0 ? suratJalanActualEditUnavailableReason : 'Edit aktual barang SJ'}
                                >
                                    <Edit size={14} /> Edit Aktual
                                </button>
                            )}
                            {canEditShipperReference && !isTripClosedByAdmin && (
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => openShipperReferenceModal()}
                                    disabled={savingShipperReference}
                                >
                                    <Edit size={14} /> {hasShipperReference ? 'Edit Surat Jalan' : 'Isi Surat Jalan'}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="text-muted text-sm" style={{ marginBottom: '0.85rem' }}>
                            Satu trip bisa membawa satu atau beberapa nomor Surat Jalan pengirim. Daftar dokumen di bawah ini adalah dokumen yang menempel ke trip ini.
                        </div>
                        {suratJalanStatusSummary.size > 0 && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                                <button
                                    type="button"
                                    className={`btn btn-sm ${suratJalanStatusFilter ? 'btn-secondary' : 'btn-primary'}`}
                                    onClick={() => setSuratJalanStatusFilter('')}
                                >
                                    Semua
                                </button>
                                {[...suratJalanStatusSummary.entries()].map(([status, count]) => {
                                    const meta = DO_STATUS_MAP[status] || displayStatusMeta;
                                    const isActive = suratJalanStatusFilter === status;
                                    return (
                                        <button
                                            key={status}
                                            type="button"
                                            className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setSuratJalanStatusFilter(current => current === status ? '' : status)}
                                            title={`Tampilkan hanya SJ dengan status ${meta.label}`}
                                        >
                                            <span className={`badge badge-${meta.color}`} style={{ marginRight: '0.45rem' }}>
                                                <span className="badge-dot" />
                                            </span>
                                            {count} {meta.label.toLowerCase()}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        <div className="detail-item">
                            <div className="detail-label">SJ Pengirim</div>
                            {shipperReferenceDisplayList.length > 0 ? (
                                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                                        {filteredShipperReferenceDisplayList.length === 0 && (
                                            <div className="text-muted text-sm">Tidak ada SJ dengan status yang sedang difilter.</div>
                                        )}
                                        {filteredShipperReferenceDisplayList.map(reference => (
                                            <div key={reference.draftKey || reference.referenceKey || `${reference.pickupStopKey || 'tanpa-pickup'}::${reference.referenceNumber}`} style={{
                                                border: '1px solid var(--color-gray-200)',
                                                borderRadius: '0.75rem',
                                                padding: '0.6rem 0.75rem',
                                                background: 'var(--color-gray-50)',
                                            }}>
                                                {(() => {
                                                    const { document, meta: documentStatusMeta } = getSuratJalanOperationalStatus(reference.referenceKey);
                                                    return (
                                                        <>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                                {document ? (
                                                                    <Link
                                                                        className="detail-value font-mono"
                                                                        style={{ color: 'var(--color-primary)' }}
                                                                        href={withReturnTo(`/surat-jalan/${encodeURIComponent(document._id)}`)}
                                                                    >
                                                                        {formatSuratJalanDisplayNumber(reference.referenceNumber, document)}
                                                                    </Link>
                                                                ) : (
                                                                    <div className="detail-value font-mono">{formatSuratJalanDisplayNumber(reference.referenceNumber, document)}</div>
                                                                )}
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                                                    <span className={`badge badge-${documentStatusMeta.color}`}>
                                                                        <span className="badge-dot" /> {documentStatusMeta.label}
                                                                    </span>
                                                                    {canEditShipperReference && !isTripClosedByAdmin && (
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-ghost btn-sm"
                                                                            onClick={() => void deleteShipperReference(reference)}
                                                                            disabled={Boolean(deletingShipperReferenceKey) || savingShipperReference}
                                                                            style={{ color: 'var(--color-danger)' }}
                                                                            title="Hapus SJ ini dari trip"
                                                                        >
                                                                            <Trash2 size={14} /> {deletingShipperReferenceKey === (reference.referenceKey || reference.draftKey || reference.referenceNumber) ? 'Menghapus...' : 'Hapus'}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                                Status SJ: {documentStatusMeta.label}
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                                {(() => {
                                                    const document = suratJalanDocumentByReferenceKey.get(reference.referenceKey || 'primary') || null;
                                                    const shouldUseHoldPickup = hasSuratJalanHoldIndicator(document) && Boolean(document?.pickupAddress);
                                                    const pickupLabel = shouldUseHoldPickup
                                                        ? document?.pickupAddress || ''
                                                        : reference.pickupLabel;
                                                    const pickupAddress = shouldUseHoldPickup
                                                        ? ''
                                                        : reference.pickupAddress;
                                                    return pickupLabel ? (
                                                        <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                            {pickupLabel}{pickupAddress ? ` | ${pickupAddress}` : ''}
                                                        </div>
                                                    ) : null;
                                                })()}
                                            {reference.billingCustomerName && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                    Invoice: {reference.billingCustomerName}
                                                </div>
                                            )}
                                            {(reference.receiverAddress || reference.receiverName || reference.receiverCompany) && (
                                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                    Tujuan Dokumen: {reference.receiverAddress || reference.receiverCompany || reference.receiverName}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="detail-value font-mono">{formatShipperDeliveryOrderNumber(doData)}</div>
                            )}
                        </div>
                    </div>
                </div>

            </div>

            <div style={{ display: 'grid', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            <CollapsibleCard title="Muatan & Realisasi Trip">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Hasil Realisasi</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{completionOutcome?.label || displayStatusMeta.label}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                {actualDropSummary.length > 0
                                    ? `${actualDropDisplayGroups.length} titik drop aktual, ${billableDropCount} masuk invoice${holdDropCount > 0 ? ` • ${holdDropCount} hold/transit` : ''}${returnDropCount > 0 ? ` • ${returnDropCount} retur` : ''}`
                                    : 'Belum ada realisasi drop'}
                            </div>
                        </div>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Masuk Invoice</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{formatCargoSummary(billableCargoSummary)}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Hanya DROP dan EXTRA_DROP yang ikut invoice.</div>
                            {tripFreightNotaItems.length > 0 && (
                                <div className="text-sm" style={{ marginTop: '0.35rem' }}>
                                    Invoice terkait: {renderFreightNotaLinks(tripFreightNotaItems)}
                                </div>
                            )}
                        </div>
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                            <div className="detail-label">Hold / Transit</div>
                            <div className="detail-value" style={{ marginTop: '0.25rem' }}>{formatCargoSummary(holdCargoSummary)}</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Barang ini tidak ikut invoice sampai dikirim lagi.</div>
                        </div>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Asal Invoice</div>
                            <div className="detail-value">{doData.pickupAddress || '-'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Tujuan Invoice</div>
                            <div className="detail-value">{doData.receiverAddress || '-'}</div>
                        </div>
                    </div>
                    <div style={{ marginTop: '1rem' }}>
                        <div className="detail-label" style={{ marginBottom: '0.5rem' }}>
                            Detail Titik Drop Aktual {actualDropDisplayGroups.length > 0 ? `(${actualDropDisplayGroups.length})` : ''}
                        </div>
                        {actualDropSummary.length === 0 ? (
                            <div className="text-muted text-sm">Belum ada realisasi drop. Saat DO diselesaikan, sistem akan mencatat tujuan aktual per titik.</div>
                        ) : (
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {actualDropDisplayGroups
                                    .slice()
                                    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
                                    .map((group, index) => {
                                        const point = group.firstPoint;
                                        const stopTypeLabels = Array.from(new Set(group.sortedPoints.map(item => DO_ACTUAL_DROP_TYPE_MAP[item.stopType]?.label || item.stopType)));
                                        const groupInvoiceItems = Array.from(new Map(
                                            group.sortedPoints
                                                .flatMap(item => getFreightNotaItemsForActualDropPoint(item))
                                                .map(item => [item._id, item] as const)
                                        ).values());
                                        return (
                                            <div key={group.key} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)', display: 'grid', gap: '0.85rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <div style={{ fontWeight: 600 }}>
                                                        Titik {index + 1}: {point.locationName || 'Lokasi belum diisi'}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <span className={`badge badge-${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.color || 'gray'}`}>
                                                            {stopTypeLabels.join(', ')}
                                                        </span>
                                                        <span className={`badge badge-${isDeliveryOrderBillableDropType(point.stopType) ? 'success' : isDeliveryOrderReturnDropType(point.stopType) ? 'danger' : 'warning'}`}>
                                                            {isDeliveryOrderBillableDropType(point.stopType) ? 'Masuk Invoice' : isDeliveryOrderReturnDropType(point.stopType) ? 'Retur / Tidak Masuk Invoice' : 'Hold / Tidak Masuk Invoice'}
                                                        </span>
                                                    </div>
                                                </div>
                                                {groupInvoiceItems.length > 0 && (
                                                    <div className="text-sm">
                                                        Invoice titik ini: {renderFreightNotaLinks(groupInvoiceItems)}
                                                    </div>
                                                )}
                                                <div className="detail-row">
                                                    <div className="detail-item">
                                                        <div className="detail-label">Nama Drop Point</div>
                                                        <div className="detail-value">{point.locationName || '-'}</div>
                                                    </div>
                                                    <div className="detail-item">
                                                        <div className="detail-label">Alamat Drop Point</div>
                                                        <div className="detail-value">{point.locationAddress || '-'}</div>
                                                    </div>
                                                    <div className="detail-item">
                                                        <div className="detail-label">Total Aktual Titik</div>
                                                        <div className="detail-value">{formatCargoSummary(group.totals)}</div>
                                                    </div>
                                                </div>
                                                <div className="detail-row">
                                                    <div className="detail-item">
                                                        <div className="detail-label">POD Diterima Oleh</div>
                                                        <div className="detail-value">{group.podInfo.receiverName || '-'}</div>
                                                    </div>
                                                    <div className="detail-item">
                                                        <div className="detail-label">Tanggal POD</div>
                                                        <div className="detail-value">{group.podInfo.receivedDate ? formatDate(group.podInfo.receivedDate) : '-'}</div>
                                                    </div>
                                                    <div className="detail-item">
                                                        <div className="detail-label">Catatan POD</div>
                                                        <div className="detail-value">{group.podInfo.note || '-'}</div>
                                                    </div>
                                                </div>
                                                {group.sjGroups.length === 0 ? (
                                                    <div className="text-muted text-sm">Belum ada rincian SJ untuk titik ini.</div>
                                                ) : (
                                                    <div style={{ display: 'grid', gap: '0.6rem' }}>
                                                        {group.sjGroups.map(sjGroup => (
                                                            <div key={sjGroup.key} style={{ border: '1px solid var(--color-gray-100)', borderRadius: '0.65rem', padding: '0.75rem', background: 'var(--color-gray-50)' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                                    <div>
                                                                        <div className="detail-label">Surat Jalan</div>
                                                                        <div className="detail-value font-mono">{sjGroup.sjNumber}</div>
                                                                    </div>
                                                                    <span className="badge badge-gray">{sjGroup.rows.length} rincian barang</span>
                                                                </div>
                                                                <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.65rem' }}>
                                                                    {sjGroup.rows.map(row => (
                                                                        <div key={row.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(12rem, auto)', gap: '0.75rem', alignItems: 'start', paddingTop: '0.45rem', borderTop: '1px solid var(--color-gray-200)' }}>
                                                                            <div>
                                                                                <div className="font-medium">{row.label}</div>
                                                                                {row.note && <div className="text-muted text-xs" style={{ marginTop: '0.2rem' }}>Catatan: {row.note}</div>}
                                                                            </div>
                                                                            <div style={{ textAlign: 'right' }}>
                                                                                <div className="detail-label">Aktual Cargo Load</div>
                                                                                <div className="detail-value">{formatCargoSummary(row.cargoSummary)}</div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
            </CollapsibleCard>

            <CollapsibleCard title="Tracking Driver" defaultOpen={doData.trackingState === 'ACTIVE'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                        <div className="detail-label" style={{ marginBottom: 0 }}>Status Tracking</div>
                        <span className={`badge ${doData.trackingState === 'ACTIVE' ? 'badge-info' : doData.trackingState === 'PAUSED' ? 'badge-warning' : 'badge-gray'}`}>
                            <Radio size={12} /> {doData.trackingState || 'IDLE'}
                        </span>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Posisi terakhir</div>
                            <div className="detail-value">{doData.trackingLastSeenAt ? formatDateTime(doData.trackingLastSeenAt) : 'Belum ada update dari driver app'}</div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Akurasi GPS</div>
                            <div className="detail-value">{typeof doData.trackingLastAccuracyM === 'number' ? `${Math.round(doData.trackingLastAccuracyM)} meter` : '-'}</div>
                        </div>
                    </div>
                    <div className="detail-row">
                        <div className="detail-item">
                            <div className="detail-label">Koordinat</div>
                            <div className="detail-value">
                                {hasLiveCoordinates ? `${doData.trackingLastLat?.toFixed(6)}, ${doData.trackingLastLng?.toFixed(6)}` : '-'}
                            </div>
                        </div>
                        <div className="detail-item">
                            <div className="detail-label">Kecepatan terakhir</div>
                            <div className="detail-value">{typeof doData.trackingLastSpeedKph === 'number' ? `${doData.trackingLastSpeedKph} km/jam` : '-'}</div>
                        </div>
                    </div>
                    {trackingMapUrl && (
                        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
                            <a href={trackingMapUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ width: 'fit-content' }}>
                                <MapPin size={14} /> Buka di Google Maps
                            </a>
                            {mapEmbedUrl && (
                                <iframe
                                    title="Peta posisi driver"
                                    src={mapEmbedUrl}
                                    style={{ width: '100%', minHeight: 260, border: '1px solid var(--color-gray-200)', borderRadius: '12px' }}
                                    loading="lazy"
                                />
                            )}
                        </div>
                    )}
            </CollapsibleCard>

            <div id="delivery-order-trip-fee-card">
            <CollapsibleCard title="Trip Overtonase & Upah Driver" defaultOpen={shouldOpenTripFeeCard}>
                    {!editingTarip ? (
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                                <div>
                                    <div className="detail-label">Total Upah Driver</div>
                                    <div className="font-semibold" style={{ color: totalTripFee ? 'var(--color-primary)' : 'var(--color-gray-400)', fontSize: '1.35rem', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                                        {totalTripFee ? formatCurrency(totalTripFee) : 'Belum diisi'}
                                    </div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                        {hasOvertonase
                                            ? `${formatCurrency(baseTripFee)} + ${formatCurrency(overtonaseDriverAmount)} overtonase`
                                            : baseTripFee
                                                ? 'Tidak ada tambahan overtonase'
                                                : 'Upah dasar belum diisi'}
                                    </div>
                                </div>
                                {canManageTripFee && !hasLinkedTripCash && !canShowTripManager && (
                                    <button className="btn btn-secondary btn-sm" onClick={openTripFeeEditor}>
                                        <Edit size={14} /> {doData.taripBorongan ? 'Edit Upah' : 'Isi Upah'}
                                    </button>
                                )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1rem' }}>
                                <section>
                                    <div className="font-semibold" style={{ marginBottom: '0.35rem' }}>Kapasitas & Muatan</div>
                                    <div style={tripFeeRowStyle}>
                                        <span className="text-muted text-sm">Kapasitas layanan</span>
                                        <strong style={tripFeeValueStyle}>{formatWeightKg(effectiveOvertonaseLimitKg)}</strong>
                                    </div>
                                    <div style={tripFeeRowStyle}>
                                        <span className="text-muted text-sm">Muatan aktual</span>
                                        <strong style={tripFeeValueStyle}>{doData.actualTotalWeightKg ? formatWeightKg(doData.actualTotalWeightKg) : 'Belum final'}</strong>
                                    </div>
                                    <div style={{ ...tripFeeRowStyle, borderBottom: 0 }}>
                                        <span className="text-muted text-sm">Berat overtonase</span>
                                        <strong style={{ ...tripFeeValueStyle, color: hasOvertonase ? 'var(--color-warning)' : 'var(--color-gray-500)' }}>
                                            {formatWeightKg(doData.overtonaseWeightKg)}
                                        </strong>
                                    </div>
                                </section>

                                <section>
                                    <div className="font-semibold" style={{ marginBottom: '0.35rem' }}>Perhitungan Overtonase</div>
                                    <div style={tripFeeRowStyle}>
                                        <span className="text-muted text-sm">Mode hitung</span>
                                        <strong style={tripFeeValueStyle}>{hasManualOvertonase ? 'Manual' : 'Otomatis'}</strong>
                                    </div>
                                    <div style={tripFeeRowStyle}>
                                        <span className="text-muted text-sm">Rate / ton</span>
                                        <strong style={tripFeeValueStyle}>{overtonaseDriverRatePerTon ? formatCurrency(overtonaseDriverRatePerTon) : '-'}</strong>
                                    </div>
                                    <div style={{ ...tripFeeRowStyle, borderBottom: 0 }}>
                                        <span className="text-muted text-sm">Ton dibayar</span>
                                        <strong style={tripFeeValueStyle}>{hasOvertonase ? `${payableOvertonaseTon} ton` : '-'}</strong>
                                    </div>
                                </section>

                                <section>
                                    <div className="font-semibold" style={{ marginBottom: '0.35rem' }}>Upah Driver</div>
                                    <div style={tripFeeRowStyle}>
                                        <span className="text-muted text-sm">Upah dasar</span>
                                        <strong style={tripFeeValueStyle}>{baseTripFee ? formatCurrency(baseTripFee) : 'Belum diisi'}</strong>
                                    </div>
                                    <div style={tripFeeRowStyle}>
                                        <span className="text-muted text-sm">Tambahan overtonase</span>
                                        <strong style={{ ...tripFeeValueStyle, color: hasOvertonase ? 'var(--color-warning)' : 'var(--color-gray-500)' }}>
                                            {hasOvertonase ? formatCurrency(overtonaseDriverAmount) : '-'}
                                        </strong>
                                    </div>
                                    <div style={{ ...tripFeeRowStyle, borderBottom: 0 }}>
                                        <span className="text-muted text-sm">Total final</span>
                                        <strong style={{ ...tripFeeValueStyle, color: totalTripFee ? 'var(--color-primary)' : 'var(--color-gray-400)' }}>
                                            {totalTripFee ? formatCurrency(totalTripFee) : 'Belum diisi'}
                                        </strong>
                                    </div>
                                </section>
                            </div>

                            <div style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: '0.85rem', display: 'grid', gap: '0.45rem' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)', gap: '0.75rem' }}>
                                    <span className="text-muted text-sm">Rute tarif</span>
                                    <span className="text-sm">
                                        {[doData.tripOriginArea || '-', doData.tripDestinationArea || '-'].join(' -> ')}
                                    </span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)', gap: '0.75rem' }}>
                                    <span className="text-muted text-sm">Master tarif</span>
                                    <span className="text-sm">
                                        {matchedTripRouteRate
                                            ? formatTripRouteRateLabel(matchedTripRouteRate)
                                            : doData.tripRouteRateRef
                                                ? (canManageTripFee ? 'Master tidak ditemukan' : 'Tersambung ke master tarif')
                                                : '-'}
                                    </span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)', gap: '0.75rem' }}>
                                    <span className="text-muted text-sm">Keterangan</span>
                                    <span className="text-sm">{doData.keteranganBorongan || '-'}</span>
                                </div>
                            </div>
                            {canManageTripFee && !isTripClosedByAdmin && (
                                <div style={{ padding: '0.85rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.5rem', background: 'var(--color-gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 220 }}>
                                        <div className="font-semibold">Manual Overtonase</div>
                                        <div className="text-muted text-sm">
                                            {hasManualOvertonase
                                                ? `Aktif: ${doData.manualOvertonaseWeightKg} kg`
                                                : 'Mengikuti hitungan otomatis dari muatan aktual'}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => openManualOvertonaseReview(false)}
                                        disabled={savingManualOvertonase}
                                    >
                                        <Edit size={14} /> Atur Overtonase
                                    </button>
                                </div>
                            )}
                            {exceedsVehicleCapacity && (
                                <div className="text-danger text-sm">
                                    Berat aktual final melebihi kapasitas kendaraan sebesar {doData.vehicleCapacityExceededKg} kg. Ini bukan sekadar overtonase tarif, tapi sudah melewati batas armada dan perlu evaluasi operasional.
                                </div>
                            )}
                            {linkedTripCashBonNumber && (
                                <div className="text-muted text-sm">
                                    Upah trip sudah terkunci karena DO ini sudah punya uang jalan trip {linkedTripCashBonNumber}. Untuk menjaga penyelesaian uang jalan tetap konsisten, nominal dan master rute tidak bisa diubah lagi dari DO.
                                </div>
                            )}
                            {settledVoucherNeedsManualAdjustment && (
                                <div className="text-muted text-sm">
                                    Bon {linkedTripCashBonNumber || linkedVoucher?.bonNumber} sudah selesai. Tambahan overtonase hanya tercermin di DO ini dan tidak mengubah penyelesaian uang jalan lama secara otomatis.
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Asal Area Trip</label>
                                    <select className="form-select" value={tripOriginArea} onChange={e => handleTripOriginAreaChange(e.target.value)}>
                                        <option value="">Pilih asal area</option>
                                        {tripOriginAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tujuan Area Trip</label>
                                    <select className="form-select" value={tripDestinationArea} onChange={e => handleTripDestinationAreaChange(e.target.value)} disabled={!tripOriginArea}>
                                        <option value="">Pilih tujuan area</option>
                                        {tripDestinationAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                            </div>
                            {matchedTripRouteRate && (
                                <div
                                    style={{
                                        background: 'var(--color-primary-50)',
                                        border: '1px solid var(--color-primary-100)',
                                        borderRadius: '0.75rem',
                                        padding: '0.85rem 1rem',
                                        marginBottom: '1rem',
                                    }}
                                >
                                    <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-primary-700)' }}>
                                        Tarif master ditemukan
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-primary-700)' }}>
                                        {formatTripRouteRateLabel(matchedTripRouteRate)} | {formatCurrency(matchedTripRouteRate.rate)}
                                        {matchedTripRouteRate.notes ? ` | ${matchedTripRouteRate.notes}` : ''}
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Upah Dasar Trip per DO (Rp) <span className="required">*</span></label>
                                    <FormattedNumberInput allowDecimal={false}
                                        value={matchedTripRouteRate?.rate ?? taripBorongan}
                                        onValueChange={value => setTaripBorongan(value)}
                                        placeholder={isTripFeeLockedToMaster ? 'Mengikuti master biaya rute trip' : 'Ketik upah trip per DO'}
                                        disabled={isTripFeeLockedToMaster}
                                    />
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        {isTripFeeLockedToMaster
                                            ? 'Upah dasar trip terkunci mengikuti master biaya rute trip yang dipilih.'
                                            : 'Jika belum ada master rute yang cocok, upah dasar trip masih boleh diisi manual sebelum voucher diterbitkan.'}
                                    </div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        Tambahan overtonase dihitung otomatis dari berat aktual final saat DO diselesaikan, jadi field ini hanya untuk upah dasar.
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Keterangan</label>
                                    <input className="form-input" value={keteranganBorongan} onChange={e => setKeteranganBorongan(e.target.value)} placeholder="Opsional..." />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn btn-primary btn-sm" onClick={saveTaripBorongan} disabled={savingTarip}>
                                    <Save size={14} /> {savingTarip ? 'Menyimpan...' : 'Simpan Upah'}
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => {
                                        setTripRouteRateRef(doData.tripRouteRateRef || '');
                                        setTripOriginArea(doData.tripOriginArea || '');
                                        setTripDestinationArea(doData.tripDestinationArea || '');
                                        setTaripBorongan((doData.baseTaripBorongan ?? doData.taripBorongan) || 0);
                                        setKeteranganBorongan(doData.keteranganBorongan || '');
                                        setEditingTarip(false);
                                    }}
                                >
                                    Batal
                                </button>
                            </div>
                        </div>
                    )}
            </CollapsibleCard>
            </div>

            {/* Items */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span className="card-header-title">Item dalam DO ({doItems.length})</span>
                    {!canShowTripManager && canAppendCargoToDo && (
                        <button className="btn btn-secondary btn-sm" onClick={() => openShipperReferenceModal('create')}>
                            <Plus size={14} /> Tambah SJ
                        </button>
                    )}
                </div>
                {doItems.length === 0 ? (
                    <div className="card-body">
                        <div className="empty-state" style={{ padding: '1rem 0' }}>
                            <div className="empty-state-title">Muatan Surat Jalan belum diisi</div>
                            <div className="empty-state-text">Barang masih bisa ditambahkan sebelum finalisasi trip diajukan.</div>
                        </div>
                    </div>
                ) : (
                    <div className="card-body">
                        <div className="trip-sj-accordion-list">
                            {cargoGroups.map(group => {
                                const statusDetails = group.document
                                    ? getSuratJalanOperationalStatus(group.document.referenceKey)
                                    : { status: displayTripStatus, meta: displayStatusMeta };
                                const plannedSummary = formatCargoSummary({
                                    qtyKoli: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0), 0),
                                    weightKg: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0), 0),
                                    volumeM3: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
                                });
                                const hasActualFinal = group.items.some(item =>
                                    item.actualQtyKoli !== undefined ||
                                    item.actualWeightKg !== undefined ||
                                    item.actualVolumeM3 !== undefined
                                );
                                const actualSummary = hasActualFinal
                                    ? formatCargoSummary({
                                        qtyKoli: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli ?? 0), 0),
                                        weightKg: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualWeightKg ?? 0), 0),
                                        volumeM3: group.items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
                                    })
                                    : 'Belum final';
                                const holdSummary = summarizeHeldDeliveryOrderItems(group.items);
                                const displayReferenceNumber = group.document
                                    ? formatSuratJalanDisplayNumber(group.document.suratJalanNumber, group.document)
                                    : group.shipperReferenceNumber;
                                return (
                                    <details key={group.key} className="trip-sj-accordion" open>
                                        <summary className="trip-sj-accordion-summary">
                                            <div className="trip-sj-accordion-title-row">
                                                <div>
                                                    <div className="detail-label">Surat Jalan</div>
                                                    <div className="detail-value font-mono">
                                                        {group.document ? (
                                                            <Link
                                                                href={withReturnTo(`/surat-jalan/${encodeURIComponent(group.document._id)}`)}
                                                                onClick={event => event.stopPropagation()}
                                                                style={{ color: 'var(--color-primary)' }}
                                                            >
                                                                {displayReferenceNumber}
                                                            </Link>
                                                        ) : displayReferenceNumber}
                                                    </div>
                                                </div>
                                                <span className={`badge badge-${statusDetails.meta.color}`}>
                                                    <span className="badge-dot" /> {statusDetails.meta.label}
                                                </span>
                                            </div>
                                            <div className="trip-sj-accordion-meta">
                                                <span>{group.items.length} item</span>
                                                <span>Rencana: {plannedSummary}</span>
                                                <span>Aktual: {actualSummary}</span>
                                                <span>Hold: {hasCargoSummaryValue(holdSummary) ? formatCargoSummary(holdSummary) : '-'}</span>
                                                <span>Pickup: {group.pickupLabels.length > 0 ? group.pickupLabels.join(', ') : '-'}</span>
                                            </div>
                                            {group.pickupAddresses.length > 0 && (
                                                <div className="text-muted text-xs">
                                                    {group.pickupAddresses.join(' | ')}
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <ChevronDown className="foldable-chevron" size={18} />
                                            </div>
                                        </summary>
                                        <div className="trip-sj-accordion-body">
                                            <div className="table-wrapper">
                                                <table className="trip-cargo-table">
                                                    <colgroup>
                                                        <col className="trip-cargo-table-pickup" />
                                                        <col className="trip-cargo-table-description" />
                                                        <col className="trip-cargo-table-koli" />
                                                        <col className="trip-cargo-table-summary" />
                                                    </colgroup>
                                                    <thead>
                                                        <tr>
                                                            <th>Pickup</th>
                                                            <th>Deskripsi</th>
                                                            <th>Koli</th>
                                                            <th>Muatan</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {group.items.map(renderCargoItemRow)}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </details>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <CollapsibleCard title="Riwayat Tracking">
                    {trackingLogs.length === 0 ? (
                        <p className="text-muted text-sm text-center" style={{ padding: '1rem' }}>Belum ada tracking log</p>
                    ) : (
                        <div className="timeline">
                            {trackingLogs.map((log, idx) => (
                                <div key={log._id || idx} className="timeline-item">
                                    <div className={`timeline-dot ${log.status === 'DELIVERED' ? 'success' : ['ON_DELIVERY', 'ARRIVED'].includes(log.status) ? 'active' : ''}`} />
                                    <div className="timeline-content">
                                        <div className="timeline-title">{DO_STATUS_MAP[log.status]?.label || log.status}</div>
                                        <div className="timeline-meta">{formatDateTime(log.timestamp)} {log.locationText ? `- ${log.locationText}` : ''}</div>
                                        {log.note && <div className="timeline-text">{log.note}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
            </CollapsibleCard>

            <AuditTrailCard
                title="Riwayat Perubahan Trip / SJ"
                subtitle="Mencatat update admin dan driver yang terkait trip ini."
                entityRefs={auditTrailEntityRefs}
            />
            </div>

            {manualOvertonaseReviewMode && manualOvertonasePendingPreview && (
                <div className="modal-overlay" onClick={() => { if (!savingManualOvertonase) setManualOvertonaseReviewMode(null); }}>
                    <div className="modal" style={{ maxWidth: 760 }} onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Review Perubahan Overtonase</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                    {manualOvertonaseReviewMode === 'automatic'
                                        ? 'Kembali ke hitungan otomatis dari muatan aktual'
                                        : 'Simpan koreksi berat overtonase manual'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setManualOvertonaseReviewMode(null)} disabled={savingManualOvertonase}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ padding: '0.85rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.65rem', marginBottom: '0.85rem' }}>
                                <div>
                                    <div className="font-semibold">Input Overtonase</div>
                                    <div className="text-muted text-sm">
                                        Isi berat manual jika perlu koreksi. Gunakan otomatis untuk kembali ke hitungan dari muatan aktual. Pembayaran tetap dibulatkan turun per ton.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: '1 1 220px' }}>
                                        <label className="form-label">Berat Manual</label>
                                        <FormattedNumberInput
                                            min={0}
                                            maxFractionDigits={getWeightInputFractionDigits(manualOvertonaseWeightInputUnit)}
                                            value={manualOvertonaseWeightInputValue}
                                            onValueChange={value => {
                                                setManualOvertonaseWeightInputValue(value);
                                                setManualOvertonaseReviewMode('manual');
                                            }}
                                            disabled={savingManualOvertonase || manualOvertonaseReviewMode === 'automatic'}
                                            placeholder="0"
                                        />
                                    </div>
                                    <div style={{ flex: '0 0 110px' }}>
                                        <label className="form-label">Unit</label>
                                        <select
                                            className="form-select"
                                            value={manualOvertonaseWeightInputUnit}
                                            onChange={event => {
                                                updateManualOvertonaseWeightUnit(event.target.value as WeightInputUnit);
                                                setManualOvertonaseReviewMode('manual');
                                            }}
                                            disabled={savingManualOvertonase || manualOvertonaseReviewMode === 'automatic'}
                                        >
                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        className={manualOvertonaseReviewMode === 'manual' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                                        onClick={() => setManualOvertonaseReviewMode('manual')}
                                        disabled={savingManualOvertonase}
                                    >
                                        Manual
                                    </button>
                                    <button
                                        type="button"
                                        className={manualOvertonaseReviewMode === 'automatic' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                                        onClick={() => setManualOvertonaseReviewMode('automatic')}
                                        disabled={savingManualOvertonase}
                                    >
                                        Otomatis
                                    </button>
                                </div>
                            </div>

                            <div className="detail-row">
                                <div className="detail-item">
                                    <div className="detail-label">Mode Sekarang</div>
                                    <div className="detail-value">{hasManualOvertonase ? 'Manual' : 'Otomatis'}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Mode Baru</div>
                                    <div className="detail-value">{manualOvertonasePendingPreview.modeLabel}</div>
                                </div>
                            </div>

                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                <div className="detail-item">
                                    <div className="detail-label">Berat Overtonase Sekarang</div>
                                    <div className="detail-value">{doData.overtonaseWeightKg ? `${doData.overtonaseWeightKg} kg` : '-'}</div>
                                    <div className="text-muted text-sm">Dibayar {manualOvertonasePendingPreview.currentPayableTon} ton penuh</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Berat Overtonase Baru</div>
                                    <div className="detail-value">{manualOvertonasePendingPreview.nextOvertonaseWeightKg ? `${manualOvertonasePendingPreview.nextOvertonaseWeightKg} kg` : '-'}</div>
                                    <div className="text-muted text-sm">Dibayar {manualOvertonasePendingPreview.nextPayableTon} ton penuh</div>
                                </div>
                            </div>

                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                <div className="detail-item">
                                    <div className="detail-label">Tambahan Driver Sekarang</div>
                                    <div className="detail-value">{manualOvertonasePendingPreview.currentDriverAmount ? formatCurrency(manualOvertonasePendingPreview.currentDriverAmount) : '-'}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Tambahan Driver Baru</div>
                                    <div className="detail-value">{manualOvertonasePendingPreview.nextDriverAmount ? formatCurrency(manualOvertonasePendingPreview.nextDriverAmount) : '-'}</div>
                                </div>
                            </div>

                            <div className="detail-row" style={{ marginTop: '0.75rem' }}>
                                <div className="detail-item">
                                    <div className="detail-label">Total Upah Sekarang</div>
                                    <div className="detail-value">{manualOvertonasePendingPreview.currentTripFee ? formatCurrency(manualOvertonasePendingPreview.currentTripFee) : '-'}</div>
                                </div>
                                <div className="detail-item">
                                    <div className="detail-label">Total Upah Baru</div>
                                    <div className="detail-value">{manualOvertonasePendingPreview.nextTripFee ? formatCurrency(manualOvertonasePendingPreview.nextTripFee) : '-'}</div>
                                </div>
                            </div>

                            <div style={{ marginTop: '0.85rem', padding: '0.85rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.35rem' }}>
                                <div className="text-sm">
                                    Dasar upah: <strong>{manualOvertonasePendingPreview.baseFee ? formatCurrency(manualOvertonasePendingPreview.baseFee) : '-'}</strong>
                                </div>
                                <div className="text-sm">
                                    Rate overtonase: <strong>{manualOvertonasePendingPreview.ratePerTon ? formatCurrency(manualOvertonasePendingPreview.ratePerTon) : '-'}</strong> / ton
                                </div>
                                <div className="text-sm">
                                    Hitungan otomatis dari muatan aktual saat ini: <strong>{manualOvertonasePendingPreview.automaticOvertonaseWeightKg} kg</strong>
                                </div>
                            </div>

                            {linkedVoucher?.status === 'SETTLED' ? (
                                <div className="alert alert-warning" style={{ marginTop: '0.85rem' }}>
                                    Uang Jalan Trip sudah selesai. Perubahan ini menyimpan overtonase di trip, tapi penyelesaian uang jalan lama tidak otomatis berubah.
                                </div>
                            ) : linkedVoucher ? (
                                <div className="alert alert-info" style={{ marginTop: '0.85rem' }}>
                                    Uang Jalan Trip yang belum selesai akan disinkronkan ke total upah baru.
                                </div>
                            ) : null}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setManualOvertonaseReviewMode(null)} disabled={savingManualOvertonase}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={() => void saveManualOvertonase(manualOvertonaseReviewMode === 'automatic')}
                                disabled={savingManualOvertonase}
                            >
                                <Save size={16} /> {savingManualOvertonase ? 'Menyimpan...' : 'Konfirmasi Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripCashIssueModal && (
                <div className="modal-overlay" onClick={() => { if (!issuingTripCash) setShowTripCashIssueModal(false); }}>
                    <div className="modal" style={{ maxWidth: 920 }} onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Terbitkan Uang Jalan Trip</h3>
                            <button className="modal-close" onClick={() => setShowTripCashIssueModal(false)} disabled={issuingTripCash}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kendaraan <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={tripCashIssueForm.vehicleRef}
                                        onChange={event => setTripCashIssueForm(previous => ({ ...previous, vehicleRef: event.target.value }))}
                                        disabled={loadingTripResources || issuingTripCash}
                                    >
                                        <option value="">{loadingTripResources ? 'Memuat kendaraan...' : 'Pilih kendaraan'}</option>
                                        {assignableVehicles.map(vehicle => (
                                            <option key={vehicle._id} value={vehicle._id}>
                                                {vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}{vehicle.plateNumber || '-'}{vehicle.serviceName ? ` (${vehicle.serviceName})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Supir <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={tripCashIssueForm.driverRef}
                                        onChange={event => setTripCashIssueForm(previous => ({ ...previous, driverRef: event.target.value }))}
                                        disabled={loadingTripResources || issuingTripCash}
                                    >
                                        <option value="">{loadingTripResources ? 'Memuat supir...' : 'Pilih supir'}</option>
                                        {assignableDrivers.map(driver => (
                                            <option key={driver._id} value={driver._id}>
                                                {driver.name}{driver.phone ? ` | ${driver.phone}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {requiresTripCashIssueVehicleOverrideReason && (
                                <div className="form-group">
                                    <label className="form-label">Alasan Override Armada <span className="required">*</span></label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={tripCashIssueForm.vehicleCategoryOverrideReason}
                                        onChange={event => setTripCashIssueForm(previous => ({ ...previous, vehicleCategoryOverrideReason: event.target.value }))}
                                        disabled={issuingTripCash}
                                        placeholder="Armada sesuai layanan tidak tersedia atau load harus dipecah"
                                    />
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Asal Area Trip</label>
                                    <select
                                        className="form-select"
                                        value={tripCashIssueForm.tripOriginArea}
                                        onChange={event => handleTripCashIssueOriginChange(event.target.value)}
                                        disabled={issuingTripCash}
                                    >
                                        <option value="">Pilih asal area</option>
                                        {tripCashIssueOriginAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tujuan Area Trip</label>
                                    <select
                                        className="form-select"
                                        value={tripCashIssueForm.tripDestinationArea}
                                        onChange={event => handleTripCashIssueDestinationChange(event.target.value)}
                                        disabled={issuingTripCash || !tripCashIssueForm.tripOriginArea}
                                    >
                                        <option value="">Pilih tujuan area</option>
                                        {tripCashIssueDestinationAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Upah Borongan <span className="required">*</span></label>
                                    <FormattedNumberInput
                                        allowDecimal={false}
                                        value={tripCashIssueFeeValue}
                                        onValueChange={value => setTripCashIssueForm(previous => ({ ...previous, taripBorongan: value }))}
                                        placeholder="Isi upah borongan"
                                        disabled={issuingTripCash || Boolean(tripCashIssueMatchedRate)}
                                    />
                                    {tripCashIssueMatchedRate && (
                                        <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                            {formatTripRouteRateLabel(tripCashIssueMatchedRate)} | {formatCurrency(tripCashIssueMatchedRate.rate)}
                                        </div>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Bon</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={tripCashIssueForm.issuedDate}
                                        onChange={event => setTripCashIssueForm(previous => ({ ...previous, issuedDate: event.target.value }))}
                                        disabled={issuingTripCash}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kas / Bank Uang Jalan <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={tripCashIssueForm.issueBankRef}
                                        onChange={event => setTripCashIssueForm(previous => ({ ...previous, issueBankRef: event.target.value }))}
                                        disabled={loadingTripCashOptions || issuingTripCash}
                                    >
                                        <option value="">{loadingTripCashOptions ? 'Memuat kas / bank...' : 'Pilih sumber uang jalan'}</option>
                                        {bankAccounts.map(account => (
                                            <option key={account._id} value={account._id}>
                                                {account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Uang Jalan Awal <span className="required">*</span></label>
                                    <FormattedNumberInput
                                        allowDecimal={false}
                                        value={tripCashIssueForm.cashGiven}
                                        onValueChange={value => setTripCashIssueForm(previous => ({ ...previous, cashGiven: value }))}
                                        placeholder="Isi uang jalan awal"
                                        disabled={issuingTripCash}
                                    />
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Keterangan Upah / Bon</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={tripCashIssueForm.keteranganBorongan}
                                    onChange={event => setTripCashIssueForm(previous => ({ ...previous, keteranganBorongan: event.target.value }))}
                                    disabled={issuingTripCash}
                                    placeholder="Catatan upah borongan"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan Bon</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={tripCashIssueForm.notes}
                                    onChange={event => setTripCashIssueForm(previous => ({ ...previous, notes: event.target.value }))}
                                    disabled={issuingTripCash}
                                    placeholder="Catatan opsional"
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTripCashIssueModal(false)} disabled={issuingTripCash}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleIssueTripCash}
                                disabled={
                                    issuingTripCash ||
                                    loadingTripResources ||
                                    loadingTripCashOptions ||
                                    !tripCashIssueForm.vehicleRef ||
                                    !tripCashIssueForm.driverRef ||
                                    !tripCashIssueForm.issueBankRef ||
                                    !tripCashIssueForm.cashGiven ||
                                    tripCashIssueFeeValue <= 0 ||
                                    (requiresTripCashIssueVehicleOverrideReason && !tripCashIssueForm.vehicleCategoryOverrideReason.trim())
                                }
                            >
                                <Wallet size={16} /> {issuingTripCash ? 'Menerbitkan...' : 'Terbitkan Bon'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripCashTopUpModal && linkedVoucher && (
                <div className="modal-overlay" onClick={() => { if (!toppingUpTripCash) setShowTripCashTopUpModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tambah Uang Jalan</h3>
                            <button className="modal-close" onClick={() => setShowTripCashTopUpModal(false)} disabled={toppingUpTripCash}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Tanggal Tambahan</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={tripCashTopUpForm.date}
                                    onChange={event => setTripCashTopUpForm(previous => ({ ...previous, date: event.target.value }))}
                                    disabled={toppingUpTripCash}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kas / Bank Sumber <span className="required">*</span></label>
                                <select
                                    className="form-select"
                                    value={tripCashTopUpForm.bankAccountRef}
                                    onChange={event => setTripCashTopUpForm(previous => ({ ...previous, bankAccountRef: event.target.value }))}
                                    disabled={loadingTripCashOptions || toppingUpTripCash}
                                >
                                    <option value="">{loadingTripCashOptions ? 'Memuat kas / bank...' : 'Pilih kas / bank'}</option>
                                    {bankAccounts.map(account => (
                                        <option key={account._id} value={account._id}>
                                            {account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Jumlah Tambahan <span className="required">*</span></label>
                                <FormattedNumberInput
                                    allowDecimal={false}
                                    value={tripCashTopUpForm.amount}
                                    onValueChange={value => setTripCashTopUpForm(previous => ({ ...previous, amount: value }))}
                                    placeholder="Ketik nominal tambahan bon"
                                    disabled={toppingUpTripCash}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={tripCashTopUpForm.note}
                                    onChange={event => setTripCashTopUpForm(previous => ({ ...previous, note: event.target.value }))}
                                    placeholder="Alasan tambahan bon"
                                    disabled={toppingUpTripCash}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTripCashTopUpModal(false)} disabled={toppingUpTripCash}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleTripCashTopUp}
                                disabled={toppingUpTripCash || loadingTripCashOptions || !tripCashTopUpForm.bankAccountRef || !tripCashTopUpForm.amount}
                            >
                                <Plus size={16} /> {toppingUpTripCash ? 'Memproses...' : 'Tambah Uang Jalan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripCashExpenseModal && linkedVoucher && (
                <div className="modal-overlay" onClick={() => { if (!savingTripCashExpense) setShowTripCashExpenseModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tambah Biaya Lain-lain</h3>
                            <button className="modal-close" onClick={() => setShowTripCashExpenseModal(false)} disabled={savingTripCashExpense}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Tanggal Biaya</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={tripCashExpenseForm.expenseDate}
                                    onChange={event => setTripCashExpenseForm(previous => ({ ...previous, expenseDate: event.target.value }))}
                                    disabled={savingTripCashExpense}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori</label>
                                <select
                                    className="form-select"
                                    value={tripCashExpenseForm.category}
                                    onChange={event => setTripCashExpenseForm(previous => ({ ...previous, category: event.target.value }))}
                                    disabled={savingTripCashExpense}
                                >
                                    {DRIVER_VOUCHER_EXPENSE_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Deskripsi</label>
                                <input
                                    className="form-input"
                                    value={tripCashExpenseForm.description}
                                    onChange={event => setTripCashExpenseForm(previous => ({ ...previous, description: event.target.value }))}
                                    placeholder="Keterangan pengeluaran"
                                    disabled={savingTripCashExpense}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Jumlah <span className="required">*</span></label>
                                <FormattedNumberInput
                                    allowDecimal={false}
                                    value={tripCashExpenseForm.amount}
                                    onValueChange={value => setTripCashExpenseForm(previous => ({ ...previous, amount: value }))}
                                    placeholder="Ketik nominal biaya"
                                    disabled={savingTripCashExpense}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTripCashExpenseModal(false)} disabled={savingTripCashExpense}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleTripCashExpenseCreate}
                                disabled={savingTripCashExpense || !tripCashExpenseForm.amount}
                            >
                                <Save size={16} /> {savingTripCashExpense ? 'Menyimpan...' : 'Simpan Biaya'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripCashSettleModal && linkedVoucher && linkedVoucherSummary && (
                <div className="modal-overlay" onClick={() => { if (!settlingTripCash) setShowTripCashSettleModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Selesaikan Bon</h3>
                            <button className="modal-close" onClick={() => setShowTripCashSettleModal(false)} disabled={settlingTripCash}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', border: '1px solid var(--color-gray-200)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                                    <div>
                                        <div className="text-muted text-sm">Total Uang Diberikan</div>
                                        <div className="font-semibold">{formatCurrency(linkedVoucherSummary.totalIssuedAmount)}</div>
                                        {linkedVoucherCashBreakdown && <div className="text-muted text-sm">{linkedVoucherCashBreakdown}</div>}
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Biaya Lain-lain</div>
                                        <div className="font-semibold">{formatCurrency(linkedVoucherSummary.totalSpent)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Upah Borongan</div>
                                        <div className="font-semibold">{formatCurrency(linkedVoucherSummary.driverFeeAmount)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Total Biaya</div>
                                        <div className="font-semibold">{formatCurrency(linkedVoucherSummary.totalClaimAmount)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">{linkedVoucherSettlementDisplay?.label || 'Penyelesaian Uang Jalan'}</div>
                                        <div className="font-semibold" style={{ color: linkedVoucherSummary.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                            {formatCurrency(linkedVoucherSettlementDisplay?.amount ?? Math.abs(linkedVoucherSummary.balance))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Selesai</label>
                                <input
                                    type="date"
                                    className="form-input"
                                    value={tripCashSettlementDate}
                                    onChange={event => setTripCashSettlementDate(event.target.value)}
                                    disabled={settlingTripCash}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">{linkedVoucherSettlementDisplay?.bankFieldLabel || 'Rekening / Kas Penyelesaian'} {linkedVoucherSummary.balance !== 0 ? <span className="required">*</span> : null}</label>
                                <select
                                    className="form-select"
                                    value={tripCashSettlementBankRef}
                                    onChange={event => setTripCashSettlementBankRef(event.target.value)}
                                    disabled={loadingTripCashOptions || settlingTripCash}
                                >
                                    <option value="">{loadingTripCashOptions ? 'Memuat kas / bank...' : 'Pilih kas / bank'}</option>
                                    {bankAccounts.map(account => (
                                        <option key={account._id} value={account._id}>
                                            {account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}
                                        </option>
                                    ))}
                                </select>
                                {linkedVoucherSettlementLabel && <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>{linkedVoucherSettlementLabel}</div>}
                            </div>
                            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.6rem', padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Total Uang Diberikan</span><strong>{formatCurrency(linkedVoucherSummary.totalIssuedAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Biaya Lain-lain</span><strong>- {formatCurrency(linkedVoucherSummary.totalSpent)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Upah Borongan</span><strong>- {formatCurrency(linkedVoucherSummary.driverFeeAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', borderTop: '1px solid var(--color-gray-200)', paddingTop: '0.5rem' }}><span>Total Biaya</span><strong>{formatCurrency(linkedVoucherSummary.totalClaimAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-gray-200)', paddingTop: '0.5rem', marginBottom: linkedVoucherSettlementDisplay && linkedVoucherSettlementDisplay.amount !== linkedVoucherSettlementDisplay.settlementAmount ? '0.35rem' : 0 }}>
                                    <span>{linkedVoucherSettlementDisplay?.label || 'Penyelesaian Uang Jalan'}</span>
                                    <strong style={{ color: linkedVoucherSummary.balance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(linkedVoucherSettlementDisplay?.amount ?? Math.abs(linkedVoucherSummary.balance))}</strong>
                                </div>
                                {linkedVoucherSettlementDisplay && linkedVoucherSettlementDisplay.amount !== linkedVoucherSettlementDisplay.settlementAmount && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Sisa dicairkan saat penutupan</span><strong>{formatCurrency(linkedVoucherSettlementDisplay.settlementAmount)}</strong></div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTripCashSettleModal(false)} disabled={settlingTripCash}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleTripCashSettle}
                                disabled={settlingTripCash || loadingTripCashOptions || (linkedVoucherSummary.balance !== 0 && !tripCashSettlementBankRef)}
                            >
                                <CheckCircle size={16} /> {settlingTripCash ? 'Memproses...' : linkedVoucherSettlementPrimaryLabel}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripResourcesModal && (
                <div className="modal-overlay" onClick={() => { if (!savingTripResources) setShowTripResourcesModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{tripResourceActionLabel}</h3>
                            <button className="modal-close" onClick={() => setShowTripResourcesModal(false)} disabled={savingTripResources}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kendaraan</label>
                                    <select
                                        className="form-select"
                                        value={tripVehicleRef}
                                        onChange={e => setTripVehicleRef(e.target.value)}
                                        disabled={loadingTripResources || savingTripResources}
                                    >
                                        <option value="">{loadingTripResources ? 'Memuat kendaraan...' : 'Pilih kendaraan untuk trip ini'}</option>
                                        {assignableVehicles.map(vehicle => (
                                            <option key={vehicle._id} value={vehicle._id}>
                                                {vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}{vehicle.plateNumber || '-'}{vehicle.serviceName ? ` (${vehicle.serviceName})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {!loadingTripResources && assignableVehicles.length === 0 && (
                                        <div className="detail-value" style={{ color: 'var(--color-warning-dark)', marginTop: '0.5rem' }}>
                                            Tidak ada kendaraan kosong. Semua armada operasional sedang terikat di DO aktif lain.
                                        </div>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Supir</label>
                                    <select
                                        className="form-select"
                                        value={tripDriverRef}
                                        onChange={e => setTripDriverRef(e.target.value)}
                                        disabled={loadingTripResources || savingTripResources}
                                    >
                                        <option value="">{loadingTripResources ? 'Memuat supir...' : 'Pilih supir untuk trip ini'}</option>
                                        {assignableDrivers.map(driver => (
                                            <option key={driver._id} value={driver._id}>
                                                {driver.name}{driver.phone ? ` | ${driver.phone}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {!loadingTripResources && assignableDrivers.length === 0 && (
                                        <div className="detail-value" style={{ color: 'var(--color-warning-dark)', marginTop: '0.5rem' }}>
                                            Tidak ada supir kosong. Semua supir aktif sedang terikat di DO aktif lain.
                                        </div>
                                    )}
                                </div>
                            </div>
                            {requiresTripVehicleOverrideReason && (
                                <div className="form-group">
                                    <label className="form-label">Alasan Override Armada <span className="required">*</span></label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={tripVehicleOverrideReason}
                                        onChange={e => setTripVehicleOverrideReason(e.target.value)}
                                        disabled={savingTripResources}
                                        placeholder="Contoh: armada sesuai kategori sedang penuh, trip ini harus tetap jalan."
                                    />
                                </div>
                            )}
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.82rem', color: 'var(--color-gray-600)' }}>
                                Perubahan armada hanya diizinkan saat status trip masih <strong>Dibuat</strong> dan belum masuk uang jalan / penyelesaian trip.
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowTripResourcesModal(false)} disabled={savingTripResources}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={saveTripResources}
                                disabled={
                                    loadingTripResources ||
                                    savingTripResources ||
                                    (requiresTripVehicleOverrideReason && !tripVehicleOverrideReason.trim())
                                }
                            >
                                <Save size={16} /> {savingTripResources ? 'Menyimpan...' : 'Simpan Armada Trip'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCancelTripModal && (
                <div className="modal-overlay" onClick={() => { if (!cancellingTrip) setShowCancelTripModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Batalkan Trip</h3>
                            <button className="modal-close" onClick={() => setShowCancelTripModal(false)} disabled={cancellingTrip}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', marginBottom: '1rem' }}>
                                Trip {displayTripNumber} akan dibatalkan. {cancelableSuratJalanDocuments.length} SJ tertaut ikut batal. Order/resi tetap aktif.
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan Pembatalan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={cancelTripNote}
                                    onChange={event => setCancelTripNote(event.target.value)}
                                    placeholder="Mis. trip batal karena armada diganti"
                                    disabled={cancellingTrip}
                                />
                            </div>
                            {canRecordCancelTripExpense && (
                                <div style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: '1rem', marginTop: '1rem' }}>
                                    <div className="font-semibold" style={{ marginBottom: '0.35rem' }}>Pengeluaran Operasional Opsional</div>
                                    <div className="text-muted" style={{ marginBottom: '0.75rem' }}>
                                        Isi hanya jika pembatalan trip menimbulkan biaya. Biaya ini masuk menu Pengeluaran, bukan bon driver.
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Tanggal</label>
                                            <input
                                                type="date"
                                                className="form-input"
                                                value={cancelTripExpenseForm.expenseDate}
                                                onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, expenseDate: event.target.value }))}
                                                disabled={cancellingTrip}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Kategori</label>
                                            <select
                                                className="form-select"
                                                value={cancelTripExpenseForm.categoryRef}
                                                onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, categoryRef: event.target.value }))}
                                                disabled={cancellingTrip || loadingTripCashOptions || cancelTripExpenseCategories.length === 0}
                                            >
                                                {cancelTripExpenseCategories.length === 0 ? (
                                                    <option value="">Tidak ada kategori pengeluaran umum aktif</option>
                                                ) : (
                                                    cancelTripExpenseCategories.map(category => (
                                                        <option key={category._id} value={category._id}>{category.name}</option>
                                                    ))
                                                )}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Kas / Bank</label>
                                        <select
                                            className="form-select"
                                            value={cancelTripExpenseForm.bankAccountRef}
                                            onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, bankAccountRef: event.target.value }))}
                                            disabled={cancellingTrip || loadingTripCashOptions || bankAccounts.length === 0}
                                        >
                                            {bankAccounts.length === 0 ? (
                                                <option value="">Tidak ada kas / bank aktif</option>
                                            ) : (
                                                bankAccounts.map(account => (
                                                    <option key={account._id} value={account._id}>
                                                        {account.bankName}{account.accountNumber ? ` - ${account.accountNumber}` : ''}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}
                                                    </option>
                                                ))
                                            )}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Deskripsi</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={cancelTripExpenseForm.description}
                                            onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, description: event.target.value }))}
                                            placeholder="Mis. solar ke lokasi pickup"
                                            disabled={cancellingTrip}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Nominal</label>
                                        <FormattedNumberInput
                                            allowDecimal={false}
                                            min={0}
                                            className="form-input"
                                            value={cancelTripExpenseForm.amount}
                                            onValueChange={value => setCancelTripExpenseForm(prev => ({ ...prev, amount: value }))}
                                            placeholder="Isi jika ada biaya keluar"
                                            disabled={cancellingTrip}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowCancelTripModal(false)} disabled={cancellingTrip}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={cancelTrip}
                                disabled={
                                    cancellingTrip ||
                                    (cancelTripExpenseForm.amount > 0 && (!cancelTripExpenseForm.categoryRef || !cancelTripExpenseForm.bankAccountRef))
                                }
                                style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                            >
                                {cancellingTrip ? 'Membatalkan...' : 'Batalkan Trip'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Status Modal */}
            {showStatusModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) { setShowStatusModal(false); setReviewingDriverRequestId(''); } }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCompletingDelivery ? (reviewingDriverRequest ? 'Review Finalisasi Batch SJ' : 'Finalisasi Batch SJ') : 'Update Status Batch SJ'}</h3>
                            <button className="modal-close" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); setReviewingDriverRequestId(''); }} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div
                            className="modal-body"
                            ref={statusModalBodyRef}
                            onScroll={rememberStatusModalScrollPosition}
                        >
                            {newStatus && eligibleStatusSuratJalanDocuments.length > 0 && (
                                <div className="form-group">
                                    <label className="form-label">Pilih Batch Surat Jalan yang Memenuhi Syarat</label>
                                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                                        {eligibleStatusSuratJalanDocuments.map(document => (
                                            <label
                                                key={document._id}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.6rem',
                                                    padding: '0.7rem 0.85rem',
                                                    border: '1px solid var(--color-gray-200)',
                                                    borderRadius: '0.75rem',
                                                    background: 'var(--color-white)',
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedStatusSuratJalanSet.has(document._id)}
                                                    onChange={event => {
                                                        setSelectedStatusSuratJalanRefs(previous => {
                                                            if (event.target.checked) {
                                                                return [...new Set([...previous, document._id])];
                                                            }
                                                            return previous.filter(item => item !== document._id);
                                                        });
                                                    }}
                                                    disabled={updatingStatus}
                                                />
                                                <div style={{ display: 'grid', gap: '0.15rem' }}>
                                                    <div className="font-semibold">{formatSuratJalanDisplayNumber(document.suratJalanNumber, document)}</div>
                                                    <div className="text-muted text-sm">
                                                        Status sekarang {DO_STATUS_MAP[document.tripStatus || displayTripStatus]?.label || document.tripStatus || displayTripStatus} | {document.itemCount} item | {getSuratJalanStatusRowCargoSummary(document)}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Status Tujuan</label>
                                {reviewingDriverRequest && (activeReviewingDriverRequest?.status || doData.pendingDriverStatus) ? (
                                    <div className="detail-value">
                                        <span className={`badge badge-${DO_STATUS_MAP[activeReviewingDriverRequest?.status || doData.pendingDriverStatus || '']?.color || pendingDriverStatusMeta?.color || 'warning'}`}>
                                            <span className="badge-dot" /> {DO_STATUS_MAP[activeReviewingDriverRequest?.status || doData.pendingDriverStatus || '']?.label || activeReviewingDriverRequest?.status || doData.pendingDriverStatus}
                                        </span>
                                    </div>
                                ) : (
                                    <select
                                        className="form-select"
                                        value={newStatus}
                                        onChange={e => {
                                            const nextStatus = e.target.value;
                                            setNewStatus(nextStatus);
                                            if (!nextStatus) {
                                                setSelectedStatusSuratJalanRefs([]);
                                                return;
                                            }
                                            const nextEligibleRefs = suratJalanStatusOptions
                                                .filter(document => getEligibleStatusesForSuratJalan(document).includes(nextStatus))
                                                .map(document => document._id);
                                            setSelectedStatusSuratJalanRefs(nextEligibleRefs);
                                        }}
                                        disabled={updatingStatus}
                                    >
                                        <option value="">Pilih status</option>
                                        {availableBatchStatuses.map(s => <option key={s} value={s}>{DO_STATUS_MAP[s]?.label || s}</option>)}
                                    </select>
                                )}
                            </div>
                            {newStatus && eligibleStatusSuratJalanDocuments.length === 0 && (
                                <div style={{ background: 'var(--color-warning-soft)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '0.75rem', border: '1px solid var(--color-warning-light)', color: 'var(--color-warning-dark)', fontSize: '0.82rem' }}>
                                    Belum ada SJ dalam trip ini yang bisa dipindahkan ke <strong>{DO_STATUS_MAP[newStatus]?.label || newStatus}</strong>.
                                </div>
                            )}
                            {reviewingDriverRequest && (activeReviewingDriverRequest?.note || doData.pendingDriverStatusNote) && (
                                <div className="form-group">
                                    <label className="form-label">Catatan Driver</label>
                                    <div className="detail-value">{activeReviewingDriverRequest?.note || doData.pendingDriverStatusNote}</div>
                                </div>
                            )}
                            {reviewingDriverRequest && isCompletingDelivery && (activeReviewingDriverRequest?.tripEndOdometerKm || doData.tripEndOdometerKm) ? (
                                <div className="form-group">
                                    <label className="form-label">Odometer Akhir Driver</label>
                                    <div className="detail-value">
                                        {formatQuantity(activeReviewingDriverRequest?.tripEndOdometerKm || doData.tripEndOdometerKm, 0)} km
                                    </div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                        Approval ini akan menutup trip dan mengupdate odometer kendaraan.
                                    </div>
                                </div>
                            ) : null}
                            {isCompletingDelivery && (
                                <>
                                    {isPartialSuratJalanBatchFinalize && (
                                        <div style={{ background: 'var(--color-info-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                            Hanya SJ yang dicentang yang akan dipindahkan ke status <strong>{DO_STATUS_MAP[newStatus]?.label || newStatus}</strong>. SJ lain tetap berada di statusnya sekarang.
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item dalam batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{selectedActualCargoItems.length} item</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedActualCargoItems.length > 0 ? formatCargoSummary(selectedBatchSuratJalanCargoTotals) : 'Belum diisi'}
                                            </div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Mode drop</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedDropModeLabel}
                                            </div>
                                            <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>{selectedDropOutcomeSummary}</div>
                                        </div>
                                    </div>
                                    {billingCustomers.length > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Customer Invoice</label>
                                            <select
                                                className="form-select"
                                                value={selectedActualDropBillingCustomerRef}
                                                onChange={event => updateSelectedActualDropBillingCustomer(event.target.value)}
                                                disabled={updatingStatus}
                                            >
                                                <option value={doData?.customerRef || ''}>Ikuti customer order / resi</option>
                                                {selectedActualDropBillingCustomerRef === '' && (
                                                    <option value="" disabled>Pilih customer invoice</option>
                                                )}
                                                {billingCustomers.map(customer => (
                                                    <option key={customer._id} value={customer._id}>
                                                        {customer.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <div className="form-group">
                                        <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                        <input className="form-input" value={podName} onChange={e => setPodName(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                        <input type="date" className="form-input" value={podDate} onChange={e => setPodDate(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catatan POD</label>
                                        <textarea className="form-textarea" rows={2} value={podNote} onChange={e => setPodNote(e.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group" style={{ marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '1rem', padding: '1rem', background: 'var(--color-white)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.2rem' }}>Langkah 1</div>
                                                    <label className="form-label" style={{ marginBottom: 0 }}>Tentukan Realisasi Titik Drop <span className="required">*</span></label>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={toggleAdvancedDropEditor}
                                                    disabled={updatingStatus}
                                                >
                                                    {showAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold'}
                                                </button>
                                            </div>
                                            <div style={{ background: 'var(--color-info-light)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                                Pilih dulu barang batch SJ ini turun ke mana. Kalau semua selesai di satu tujuan, sistem otomatis pakai <strong>{selectedAutoActualDropDraft.locationName || 'Tujuan Invoice'}</strong>. Buka detail ini hanya kalau ada multi-drop, hold, atau return.
                                            </div>
                                            {selectedActualDropMismatchMessage && (
                                                <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                                    {selectedActualDropMismatchMessage} Muatan aktual {formatCargoSummary(selectedActualCargoDisplaySummary)} tetapi alokasi drop baru {formatCargoSummary(selectedSubmissionBillableActualDropTotals)}.
                                                </div>
                                            )}
                                            {selectedActualDropAmbiguityMessage && (
                                                <div style={{ background: 'var(--color-warning-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                                    {selectedActualDropAmbiguityMessage}
                                                </div>
                                            )}
                                            {!showAdvancedDropEditor ? (
                                                (() => {
                                                    const recipientOptions = getActualDropRecipientOptions(selectedAutoActualDropDraft);
                                                    const selectedRecipientId = resolveActualDropRecipientValue(selectedAutoActualDropDraft);
                                                    return (
                                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                                            {recipientOptions.length > 0 && (
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">Tujuan dari Master Customer</label>
                                                                    <select
                                                                        className="form-select"
                                                                        value={selectedRecipientId}
                                                                        onChange={event => applyActualDropRecipient(selectedAutoActualDropDraft.draftKey, event.target.value)}
                                                                        disabled={updatingStatus}
                                                                    >
                                                                        <option value="">Pilih tujuan final...</option>
                                                                        {recipientOptions.map(recipient => (
                                                                            <option key={recipient._id} value={recipient._id}>
                                                                                {formatCustomerRecipientLabel(recipient)}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            )}
                                                            <div className="form-row">
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">Nama Lokasi Drop <span className="required">*</span></label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={selectedAutoActualDropDraft.locationName}
                                                                        onChange={event => updateActualDropDraft(selectedAutoActualDropDraft.draftKey, 'locationName', event.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Mis. Gudang Customer Surabaya"
                                                                    />
                                                                </div>
                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                    <label className="form-label">Alamat Drop</label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={selectedAutoActualDropDraft.locationAddress}
                                                                        onChange={event => updateActualDropDraft(selectedAutoActualDropDraft.draftKey, 'locationAddress', event.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Opsional"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'grid', gap: '0.55rem' }}>
                                                                <div className="font-semibold">Barang Realisasi Default</div>
                                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.55rem' }}>
                                                                    <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.65rem 0.75rem', background: 'var(--color-white)' }}>
                                                                        <div className="text-muted text-sm">Total akan direalisasikan</div>
                                                                        <div className="font-semibold" style={{ marginTop: '0.15rem' }}>{formatCargoSummary(selectedActualCargoDisplaySummary)}</div>
                                                                    </div>
                                                                </div>
                                                                <div style={{ display: 'grid', gap: '0.6rem' }}>
                                                                    {selectedActualDropPointSjGroups.map(group => {
                                                                        const groupHoldSummary = summarizeHeldCargoForItems(group.items);
                                                                        return (
                                                                        <details
                                                                            key={`default-drop-${group.key}`}
                                                                            open
                                                                            style={{
                                                                                border: '1px solid var(--color-gray-200)',
                                                                                borderRadius: '0.65rem',
                                                                                background: 'var(--color-white)',
                                                                                overflow: 'hidden',
                                                                            }}
                                                                        >
                                                                            <summary
                                                                                style={{
                                                                                    alignItems: 'center',
                                                                                    cursor: 'pointer',
                                                                                    display: 'flex',
                                                                                    gap: '0.5rem',
                                                                                    justifyContent: 'space-between',
                                                                                    listStyle: 'none',
                                                                                    padding: '0.7rem 0.8rem',
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    <span className="font-semibold">{group.label}</span>
                                                                                    <span className="text-muted text-sm" style={{ marginLeft: '0.45rem' }}>{group.items.length} barang</span>
                                                                                    {hasCargoSummaryValue(groupHoldSummary) && (
                                                                                        <span className="text-muted text-sm" style={{ marginLeft: '0.45rem' }}>Total hold: {formatCargoSummary(groupHoldSummary)}</span>
                                                                                    )}
                                                                                </span>
                                                                                <ChevronDown className="foldable-chevron" size={16} />
                                                                            </summary>
                                                                            <div style={{ borderTop: '1px solid var(--color-gray-100)', display: 'grid', gap: '0.55rem', padding: '0.75rem' }}>
                                                                                {group.items.map(cargoItem => {
                                                                                    const itemHoldSummary = summarizeHeldCargoForItem(cargoItem);
                                                                                    return (
                                                                                    <div
                                                                                        key={`admin-default-drop-${cargoItem.deliveryOrderItemRef}`}
                                                                                        style={{
                                                                                            display: 'grid',
                                                                                            gap: '0.22rem',
                                                                                            padding: '0.65rem 0.75rem',
                                                                                            border: '1px solid var(--color-gray-100)',
                                                                                            borderRadius: '0.6rem',
                                                                                            background: 'var(--color-gray-50)',
                                                                                        }}
                                                                                    >
                                                                                        <div className="font-medium">{cargoItem.description || 'Barang'}</div>
                                                                                        <div className="text-muted text-sm">No SJ: {cargoItem.shipperReferenceNumber || group.label || '-'}</div>
                                                                                        <div className="text-muted text-sm">
                                                                                            Rencana awal SJ: {formatCargoSummary({
                                                                                                qtyKoli: cargoItem.plannedQtyKoli,
                                                                                                weightKg: cargoItem.plannedWeightKg,
                                                                                                weightInputValue: cargoItem.plannedWeightInputValue,
                                                                                                weightInputUnit: cargoItem.plannedWeightInputUnit,
                                                                                                volumeM3: cargoItem.plannedVolumeM3,
                                                                                                volumeInputValue: cargoItem.plannedVolumeInputValue,
                                                                                                volumeInputUnit: cargoItem.plannedVolumeInputUnit,
                                                                                            })}
                                                                                        </div>
                                                                                        <div className="text-muted text-sm">Akan direalisasikan: {summarizeActualCargoDraft(cargoItem)}</div>
                                                                                        <div className="text-muted text-sm">Hold tersimpan: {hasCargoSummaryValue(itemHoldSummary) ? formatCargoSummary(itemHoldSummary) : '-'}</div>
                                                                                        <div className="text-muted text-sm">
                                                                                            Tipe realisasi: {DO_ACTUAL_DROP_TYPE_MAP[selectedAutoActualDropDraft.stopType]?.label || selectedAutoActualDropDraft.stopType}
                                                                                        </div>
                                                                                    </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </details>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()
                                            ) : (
                                                <>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                        <div className="text-muted text-sm">
                                                            Tentukan per titik apakah barang turun, hold, return, atau lanjut ke titik lain.
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                        {selectedActualDropPoints.map((item, index) => (
                                                            (() => {
                                                                const allocationSummaryRows = getActualDropAllocationSummaryRows(item);
                                                                const recipientOptions = getActualDropRecipientOptions(item);
                                                                const selectedRecipientId = resolveActualDropRecipientValue(item);
                                                                return (
                                                            <div key={item.draftKey} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                                    <div>
                                                                        <div style={{ fontWeight: 600 }}>Titik Drop {index + 1}</div>
                                                                        <div className="text-muted text-sm">Barang untuk titik ini diatur dari tombol ini.</div>
                                                                    </div>
                                                                    {selectedActualDropPoints.length > 1 && (
                                                                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeActualDropDraft(item.draftKey)} disabled={updatingStatus}>
                                                                            Hapus
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.7rem 0.8rem', background: 'var(--color-white)', marginBottom: '0.75rem' }}>
                                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.45rem' }}>
                                                                        Total alokasi {DO_ACTUAL_DROP_TYPE_MAP[item.stopType]?.label || item.stopType} di titik ini
                                                                    </div>
                                                                    {allocationSummaryRows.length > 0 ? (
                                                                        <div style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem' }}>
                                                                            <div>{formatCargoSummary(allocationSummaryRows.reduce((sum, row) => ({
                                                                                qtyKoli: sum.qtyKoli + row.allocatedSummary.qtyKoli,
                                                                                weightKg: sum.weightKg + row.allocatedSummary.weightKg,
                                                                                volumeM3: sum.volumeM3 + row.allocatedSummary.volumeM3,
                                                                            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 }))}</div>
                                                                            <div className="text-muted text-sm">{allocationSummaryRows.length} barang terisi di titik ini.</div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-muted text-sm">Belum ada barang dialokasikan.</div>
                                                                    )}
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Tipe Titik</label>
                                                                        <select
                                                                            className="form-select"
                                                                            value={item.stopType}
                                                                            onChange={e => updateActualDropDraft(item.draftKey, 'stopType', e.target.value)}
                                                                            disabled={updatingStatus}
                                                                        >
                                                                            {Object.entries(DO_ACTUAL_DROP_TYPE_MAP).filter(([value]) => !['EXTRA_DROP', 'TRANSIT', 'RETURN'].includes(value)).map(([value, meta]) => (
                                                                                <option key={value} value={value}>{meta.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    {recipientOptions.length > 0 && (
                                                                        <div className="form-group">
                                                                            <label className="form-label">Tujuan Master Customer</label>
                                                                            <select
                                                                                className="form-select"
                                                                                value={selectedRecipientId}
                                                                                onChange={e => applyActualDropRecipient(item.draftKey, e.target.value)}
                                                                                disabled={updatingStatus}
                                                                            >
                                                                                <option value="">Pilih tujuan final...</option>
                                                                                {recipientOptions.map(recipient => (
                                                                                    <option key={recipient._id} value={recipient._id}>
                                                                                        {formatCustomerRecipientLabel(recipient)}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    )}
                                                                    <div className="form-group">
                                                                        <label className="form-label">Nama Lokasi <span className="required">*</span></label>
                                                                        <input
                                                                            className="form-input"
                                                                            value={item.locationName}
                                                                            onChange={e => updateActualDropDraft(item.draftKey, 'locationName', e.target.value)}
                                                                            disabled={updatingStatus}
                                                                            placeholder="Mis. Gudang Transit Malang"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Alamat Lokasi</label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={item.locationAddress}
                                                                        onChange={e => updateActualDropDraft(item.draftKey, 'locationAddress', e.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Opsional, isi jika berbeda dari tujuan invoice"
                                                                    />
                                                                </div>
                                                                <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '0.75rem' }}>
                                                                    {selectedActualDropPointSjGroups.map(group => {
                                                                        const groupHoldSummary = summarizeHeldCargoForItems(group.items);
                                                                        return (
                                                                        <details
                                                                            key={`${item.draftKey}-${group.key}`}
                                                                            open
                                                                            style={{
                                                                                border: '1px solid var(--color-gray-200)',
                                                                                borderRadius: '0.65rem',
                                                                                background: 'var(--color-white)',
                                                                                overflow: 'hidden',
                                                                            }}
                                                                        >
                                                                            <summary
                                                                                style={{
                                                                                    alignItems: 'center',
                                                                                    cursor: 'pointer',
                                                                                    display: 'flex',
                                                                                    gap: '0.5rem',
                                                                                    justifyContent: 'space-between',
                                                                                    listStyle: 'none',
                                                                                    padding: '0.7rem 0.8rem',
                                                                                }}
                                                                            >
                                                                                <span>
                                                                                    <span className="font-semibold">{group.label}</span>
                                                                                    <span className="text-muted text-sm" style={{ marginLeft: '0.45rem' }}>{group.items.length} barang</span>
                                                                                    {hasCargoSummaryValue(groupHoldSummary) && (
                                                                                        <span className="text-muted text-sm" style={{ marginLeft: '0.45rem' }}>Total hold: {formatCargoSummary(groupHoldSummary)}</span>
                                                                                    )}
                                                                                </span>
                                                                                <ChevronDown className="foldable-chevron" size={16} />
                                                                            </summary>
                                                                            <div style={{ borderTop: '1px solid var(--color-gray-100)', display: 'grid', gap: '0.55rem', padding: '0.75rem' }}>
                                                                                {group.items.map(cargoItem => {
                                                                                    const helper = getActualDropItemHelper(item, cargoItem);
                                                                                    const itemHoldSummary = summarizeHeldCargoForItem(cargoItem);
                                                                                    return (
                                                                                        <div
                                                                                            key={`${item.draftKey}-${cargoItem.deliveryOrderItemRef}`}
                                                                                            style={{
                                                                                                border: '1px solid var(--color-gray-100)',
                                                                                                borderRadius: '0.6rem',
                                                                                                display: 'grid',
                                                                                                gap: '0.55rem',
                                                                                                padding: '0.65rem 0.75rem',
                                                                                                background: 'var(--color-gray-50)',
                                                                                            }}
                                                                                        >
                                                                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.65rem', flexWrap: 'wrap' }}>
                                                                                                <div style={{ minWidth: 0 }}>
                                                                                                    <div className="font-medium">{cargoItem.description || 'Barang'}</div>
                                                                                                    <div className="text-muted text-sm">No SJ: {cargoItem.shipperReferenceNumber || group.label || '-'}</div>
                                                                                                </div>
                                                                                                <span
                                                                                                    style={{
                                                                                                        background: helper.badgeBackground,
                                                                                                        borderRadius: '999px',
                                                                                                        color: helper.badgeColor,
                                                                                                        fontSize: '0.72rem',
                                                                                                        fontWeight: 700,
                                                                                                        padding: '0.18rem 0.55rem',
                                                                                                    }}
                                                                                                >
                                                                                                    {helper.badgeLabel}
                                                                                                </span>
                                                                                            </div>
                                                                                            <div style={{ display: 'grid', gap: '0.22rem', color: 'var(--color-gray-700)', fontSize: '0.8rem' }}>
                                                                                                <div>Rencana awal SJ: {formatCargoSummary({
                                                                                                    qtyKoli: cargoItem.plannedQtyKoli,
                                                                                                    weightKg: cargoItem.plannedWeightKg,
                                                                                                    weightInputValue: cargoItem.plannedWeightInputValue,
                                                                                                    weightInputUnit: cargoItem.plannedWeightInputUnit,
                                                                                                    volumeM3: cargoItem.plannedVolumeM3,
                                                                                                    volumeInputValue: cargoItem.plannedVolumeInputValue,
                                                                                                    volumeInputUnit: cargoItem.plannedVolumeInputUnit,
                                                                                                })}</div>
                                                                                                <div>Hold tersimpan: {hasCargoSummaryValue(itemHoldSummary) ? formatCargoSummary(itemHoldSummary) : '-'}</div>
                                                                                                <div>{item.stopType === 'HOLD' ? 'Hold di titik ini' : 'Alokasi titik ini'}: {formatCargoSummary(helper.currentSummary)}</div>
                                                                                                <div>Total alokasi titik lain: {formatCargoSummary(helper.otherSummary)}</div>
                                                                                                <div>Sisa setelah titik ini: {formatCargoSummary(helper.remainingAfterCurrent)}</div>
                                                                                            </div>
                                                                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                                                                <button
                                                                                                    type="button"
                                                                                                    className="btn btn-primary btn-sm"
                                                                                                    onClick={() => {
                                                                                                        rememberStatusModalScrollPosition();
                                                                                                        setActualDropEditSnapshot({
                                                                                                            points: actualDropPoints.map(point => ({ ...point })),
                                                                                                            itemValueMap: { ...actualDropItemValueMap },
                                                                                                        });
                                                                                                        ensureActualDropAllocationsForItems(item, [cargoItem]);
                                                                                                        setActualCargoModalReturnTarget('status');
                                                                                                        setActiveFinalizationCargoItemRef(cargoItem.deliveryOrderItemRef);
                                                                                                        setActiveFinalizationDropKey(item.draftKey);
                                                                                                        setShowStatusModal(false);
                                                                                                        setShowActualCargoFinalizationModal(true);
                                                                                                    }}
                                                                                                    disabled={
                                                                                                        !newStatus ||
                                                                                                        updatingStatus ||
                                                                                                        selectedStatusSuratJalanRefs.length === 0
                                                                                                    }
                                                                                                >
                                                                                                    Tentukan Barang
                                                                                                </button>
                                                                                            </div>
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </details>
                                                                        );
                                                                    })}
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Catatan Titik Drop</label>
                                                                    <textarea
                                                                        className="form-textarea"
                                                                        rows={2}
                                                                        value={item.note}
                                                                        onChange={e => updateActualDropDraft(item.draftKey, 'note', e.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Mis. 30 koli turun di Malang, sisa lanjut ke Ponorogo"
                                                                    />
                                                                </div>
                                                            </div>
                                                                );
                                                            })()
                                                        ))}
                                                        <button
                                                            type="button"
                                                            className="btn btn-secondary btn-sm"
                                                            onClick={addActualDropDraft}
                                                            disabled={updatingStatus}
                                                            style={{ justifySelf: 'flex-start' }}
                                                        >
                                                            + Tambah Titik Drop
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                            {showAdvancedDropEditor
                                                ? 'Klik Lanjut Aktual Barang untuk review aktual per titik drop. Setiap titik akan menampilkan SJ dan barang dengan muatan masing-masing.'
                                                : 'Langkah berikutnya akan membuka modal aktual barang. Setiap item dibuka sebagai tab supaya koreksi per barang tetap fokus.'}
                                    </div>
                                    {showAdvancedDropEditor && !selectedActualDropAllocationComplete && (
                                        <div style={{ background: 'var(--color-warning-soft)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                            Lengkapi alokasi semua barang sebelum lanjut aktual barang. Belum lengkap: {selectedActualDropIncompleteItems.map(item => item.description || item.deliveryOrderItemRef).join(', ')}.
                                        </div>
                                    )}
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} placeholder={isCompletingDelivery ? 'Catatan finalisasi batch SJ...' : 'Catatan progres batch SJ...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowStatusModal(false); setReviewingDriverRequest(false); setReviewingDriverRequestId(''); }} disabled={updatingStatus}>Batal</button>
                            {isCompletingDelivery ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={openActualCargoFinalizationStep}
                                    disabled={updatingStatus}
                                >
                                    Lanjut Aktual Barang
                                </button>
                            ) : (
                                <button className="btn btn-primary" onClick={updateDOStatus} disabled={!newStatus || updatingStatus || selectedStatusSuratJalanRefs.length === 0}>
                                    <Save size={16} /> {updatingStatus ? 'Menyimpan...' : 'Simpan Batch SJ'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {actualCargoStepBlockMessages.length > 0 && (
                <div className="modal-overlay" onClick={() => setActualCargoStepBlockMessages([])}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Belum Bisa Lanjut Aktual Barang</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                    {reviewingDriverRequest ? 'Review & approve driver' : 'Update batch SJ'} membutuhkan beberapa perbaikan dulu.
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setActualCargoStepBlockMessages([])}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                {(['setup', 'drop', 'allocation'] as const).map(kind => {
                                    const groupMessages = actualCargoStepBlockMessages.filter(message => message.kind === kind);
                                    if (groupMessages.length === 0) {
                                        return null;
                                    }
                                    const groupLabel = kind === 'setup'
                                        ? 'Data wajib'
                                        : kind === 'drop'
                                            ? 'Titik drop / hold'
                                            : 'Alokasi barang';
                                    const groupHelp = kind === 'allocation'
                                        ? 'Target harus sama dengan total alokasi drop/hold untuk setiap barang.'
                                        : kind === 'drop'
                                            ? 'Pastikan setiap titik punya tujuan.'
                                            : 'Lengkapi data dasar sebelum lanjut ke aktual barang.';
                                    return (
                                        <section
                                            key={kind}
                                            style={{
                                                border: '1px solid var(--color-gray-200)',
                                                borderRadius: '0.75rem',
                                                background: 'var(--color-white)',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    alignItems: 'center',
                                                    background: 'var(--color-gray-50)',
                                                    borderBottom: '1px solid var(--color-gray-100)',
                                                    display: 'flex',
                                                    gap: '0.65rem',
                                                    justifyContent: 'space-between',
                                                    padding: '0.75rem 0.9rem',
                                                }}
                                            >
                                                <div>
                                                    <div className="font-semibold">{groupLabel}</div>
                                                    <div className="text-muted text-sm" style={{ marginTop: '0.15rem' }}>{groupHelp}</div>
                                                </div>
                                                <span
                                                    style={{
                                                        background: 'var(--color-warning-soft)',
                                                        borderRadius: '999px',
                                                        color: 'var(--color-warning-dark)',
                                                        fontSize: '0.72rem',
                                                        fontWeight: 700,
                                                        padding: '0.18rem 0.55rem',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {groupMessages.length} masalah
                                                </span>
                                            </div>
                                            <div style={{ display: 'grid', gap: '0.55rem', padding: '0.75rem' }}>
                                                {groupMessages.map((message, index) => (
                                                    <div
                                                        key={`${kind}-${index}-${message.title}`}
                                                        style={{
                                                            border: '1px solid var(--color-gray-100)',
                                                            borderRadius: '0.65rem',
                                                            background: 'var(--color-gray-50)',
                                                            padding: '0.7rem 0.8rem',
                                                        }}
                                                    >
                                                        <div className="font-medium">{message.title}</div>
                                                        {message.detail && (
                                                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                                {message.detail}
                                                            </div>
                                                        )}
                                                        {message.kind === 'allocation' && (
                                                            <div
                                                                style={{
                                                                    display: 'grid',
                                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                                                    gap: '0.5rem',
                                                                    marginTop: '0.65rem',
                                                                }}
                                                            >
                                                                <div style={{ borderRadius: '0.55rem', background: 'var(--color-white)', padding: '0.55rem 0.65rem' }}>
                                                                    <div className="text-muted text-sm">Target</div>
                                                                    <div className="font-semibold" style={{ marginTop: '0.15rem' }}>{message.target}</div>
                                                                </div>
                                                                <div style={{ borderRadius: '0.55rem', background: 'var(--color-white)', padding: '0.55rem 0.65rem' }}>
                                                                    <div className="text-muted text-sm">Teralokasi</div>
                                                                    <div className="font-semibold" style={{ marginTop: '0.15rem' }}>{message.allocated}</div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-primary" onClick={() => setActualCargoStepBlockMessages([])}>
                                Tutup
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showActualCargoFinalizationModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) setShowActualCargoFinalizationModal(false); }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">
                                    {activeFinalizationDrop
                                        ? 'Tentukan Barang Titik Drop'
                                        : showingDropFinalizationReview
                                            ? 'Aktual Barang per Titik Drop'
                                            : (reviewingDriverRequest ? 'Review Aktual Barang SJ' : 'Aktual Barang SJ')}
                                </h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                    {activeFinalizationDrop
                                        ? 'Alokasi titik drop'
                                        : showingDropFinalizationReview
                                            ? `Review ${selectedActualDropPoints.length} titik drop`
                                            : 'Langkah 2 dari 2'} | {showingDropFinalizationReview ? selectedActualCargoTabItems.length : finalizationCargoTabItems.length} item dalam batch SJ
                                    {activeFinalizationDrop ? ` | ${activeFinalizationDrop.locationName || activeFinalizationDrop.locationAddress || 'Titik Drop'}` : ''}
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setShowActualCargoFinalizationModal(false)} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body" ref={actualCargoModalBodyRef}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">{activeFinalizationDrop ? 'Muatan aktual saat ini' : 'Muatan realisasi'}</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                        {formatCargoSummary(selectedActualCargoDisplaySummary)}
                                    </div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Realisasi drop</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>{selectedDropModeLabel}</div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>{selectedDropOutcomeSummary}</div>
                                </div>
                            </div>

                            {!activeFinalizationDrop && selectedActualDropMismatchMessage && (
                                <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                    {selectedActualDropMismatchMessage} Muatan aktual {formatCargoSummary(selectedActualCargoDisplaySummary)} tetapi alokasi drop baru {formatCargoSummary(selectedSubmissionBillableActualDropTotals)}.
                                </div>
                            )}

                            {!activeFinalizationDrop && !selectedActualCargoReady && (
                                <div style={{ background: 'var(--color-warning-soft)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                    Lengkapi aktual barang yang bertanda wajib sebelum finalisasi SJ disimpan.
                                </div>
                            )}

                            {showingDropFinalizationReview && (
                                <>
                                    <div style={{ background: 'var(--color-info-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                        Aktual barang di bawah ini dipisah per titik drop. Nilai final dikirim dari alokasi barang di setiap titik, bukan dari input aktual gabungan.
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', borderBottom: '1px solid var(--color-gray-200)', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                                        {selectedActualDropPoints.map((drop, index) => {
                                            const isActive = activeFinalizationReviewDrop?.draftKey === drop.draftKey;
                                            const allocationSummaryRows = getActualDropAllocationSummaryRows(drop);
                                            const dropSummary = allocationSummaryRows.reduce((sum, row) => ({
                                                qtyKoli: sum.qtyKoli + row.allocatedSummary.qtyKoli,
                                                weightKg: sum.weightKg + row.allocatedSummary.weightKg,
                                                volumeM3: sum.volumeM3 + row.allocatedSummary.volumeM3,
                                            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
                                            return (
                                                <button
                                                    key={`final-review-drop-tab-${drop.draftKey}`}
                                                    type="button"
                                                    className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setActiveFinalizationReviewDropKey(drop.draftKey)}
                                                    disabled={updatingStatus}
                                                    title={`${drop.locationName || drop.locationAddress || `Titik Drop ${index + 1}`} | ${formatCargoSummary(dropSummary)}`}
                                                    style={{
                                                        alignItems: 'flex-start',
                                                        display: 'grid',
                                                        gap: '0.15rem',
                                                        minWidth: 170,
                                                        textAlign: 'left',
                                                        whiteSpace: 'normal',
                                                    }}
                                                >
                                                    <span>Titik {index + 1}</span>
                                                    <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }}>
                                                        {formatCargoSummary(dropSummary)}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {activeFinalizationReviewDrop ? (
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                            <div>
                                                <div className="font-semibold">{activeFinalizationReviewDrop.locationName || `Titik Drop ${selectedActualDropPoints.findIndex(drop => drop.draftKey === activeFinalizationReviewDrop.draftKey) + 1}`}</div>
                                                <div className="text-muted text-sm">{activeFinalizationReviewDrop.locationAddress || 'Alamat belum diisi'} | {DO_ACTUAL_DROP_TYPE_MAP[activeFinalizationReviewDrop.stopType]?.label || activeFinalizationReviewDrop.stopType}</div>
                                            </div>
                                            {selectedActualDropPointSjGroups.map(group => {
                                                const groupHoldSummary = summarizeHeldCargoForItems(group.items);
                                                return (
                                                <details
                                                    key={`final-review-${activeFinalizationReviewDrop.draftKey}-${group.key}`}
                                                    open
                                                    style={{
                                                        border: '1px solid var(--color-gray-200)',
                                                        borderRadius: '0.65rem',
                                                        background: 'var(--color-white)',
                                                        overflow: 'hidden',
                                                    }}
                                                >
                                                    <summary
                                                        style={{
                                                            alignItems: 'center',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            gap: '0.5rem',
                                                            justifyContent: 'space-between',
                                                            listStyle: 'none',
                                                            padding: '0.7rem 0.8rem',
                                                        }}
                                                    >
                                                        <span>
                                                            <span className="font-semibold">{group.label}</span>
                                                            <span className="text-muted text-sm" style={{ marginLeft: '0.45rem' }}>{group.items.length} barang</span>
                                                            {hasCargoSummaryValue(groupHoldSummary) && (
                                                                <span className="text-muted text-sm" style={{ marginLeft: '0.45rem' }}>Total hold: {formatCargoSummary(groupHoldSummary)}</span>
                                                            )}
                                                        </span>
                                                        <ChevronDown className="foldable-chevron" size={16} />
                                                    </summary>
                                                    <div style={{ borderTop: '1px solid var(--color-gray-100)', display: 'grid', gap: '0.55rem', padding: '0.75rem' }}>
                                                        {group.items.map(cargoItem => {
                                                            const helper = getActualDropItemHelper(activeFinalizationReviewDrop, cargoItem);
                                                            const itemHoldSummary = summarizeHeldCargoForItem(cargoItem);
                                                            return (
                                                                <div
                                                                    key={`final-review-${activeFinalizationReviewDrop.draftKey}-${cargoItem.deliveryOrderItemRef}`}
                                                                    style={{
                                                                        border: '1px solid var(--color-gray-100)',
                                                                        borderRadius: '0.6rem',
                                                                        display: 'grid',
                                                                        gap: '0.55rem',
                                                                        padding: '0.65rem 0.75rem',
                                                                        background: 'var(--color-gray-50)',
                                                                    }}
                                                                >
                                                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.65rem', flexWrap: 'wrap' }}>
                                                                        <div style={{ minWidth: 0 }}>
                                                                            <div className="font-medium">{cargoItem.description || 'Barang'}</div>
                                                                            <div className="text-muted text-sm">No SJ: {cargoItem.shipperReferenceNumber || group.label || '-'}</div>
                                                                        </div>
                                                                        <span
                                                                            style={{
                                                                                background: helper.badgeBackground,
                                                                                borderRadius: '999px',
                                                                                color: helper.badgeColor,
                                                                                fontSize: '0.72rem',
                                                                                fontWeight: 700,
                                                                                padding: '0.18rem 0.55rem',
                                                                            }}
                                                                        >
                                                                            {helper.badgeLabel}
                                                                        </span>
                                                                    </div>
                                                                    <div style={{ display: 'grid', gap: '0.22rem', color: 'var(--color-gray-700)', fontSize: '0.8rem' }}>
                                                                        <div>Hold tersimpan: {hasCargoSummaryValue(itemHoldSummary) ? formatCargoSummary(itemHoldSummary) : '-'}</div>
                                                                        <div>{activeFinalizationReviewDrop.stopType === 'HOLD' ? 'Aktual hold titik ini' : 'Aktual drop titik ini'}: {formatCargoSummary(helper.currentSummary)}</div>
                                                                    </div>
                                                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-secondary btn-sm"
                                                                            onClick={() => {
                                                                                rememberActualCargoModalScrollPosition();
                                                                                setActualDropEditSnapshot({
                                                                                    points: actualDropPoints.map(point => ({ ...point })),
                                                                                    itemValueMap: { ...actualDropItemValueMap },
                                                                                });
                                                                                ensureActualDropAllocationsForItems(activeFinalizationReviewDrop, [cargoItem]);
                                                                                setActualCargoModalReturnTarget('review');
                                                                                setActiveFinalizationCargoItemRef(cargoItem.deliveryOrderItemRef);
                                                                                setActiveFinalizationDropKey(activeFinalizationReviewDrop.draftKey);
                                                                            }}
                                                                            disabled={updatingStatus}
                                                                        >
                                                                            Edit Aktual Barang
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </details>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="empty-state">
                                            <div className="empty-state-title">Belum ada titik drop dalam batch SJ ini</div>
                                        </div>
                                    )}
                                </>
                            )}

                            {!showingDropFinalizationReview && !activeFinalizationDrop && (
                            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', borderBottom: '1px solid var(--color-gray-200)', marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                                {finalizationCargoTabItems.map((item, index) => {
                                    const isActive = activeFinalizationCargoItem?.deliveryOrderItemRef === item.deliveryOrderItemRef;
                                    const allocationValues = activeFinalizationDrop
                                        ? pickActualDropItemValues(getActualDropAllocationForItem(activeFinalizationDrop, item))
                                        : null;
                                    const tabHasValue = allocationValues
                                        ? hasActualDropItemValues(allocationValues)
                                        : Boolean(
                                            parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }) > 0 ||
                                            parseFormattedNumberish(item.actualWeightInputValue || 0, {
                                                maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                                            }) > 0 ||
                                            parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                                                maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                            }) > 0
                                        );
                                    const tabValueSummary = allocationValues
                                        ? formatCargoSummary({
                                            qtyKoli: parseFormattedNumberish(allocationValues.qtyKoli || 0, { maxFractionDigits: 2 }),
                                            weightInputValue: allocationValues.weightInputValue,
                                            weightInputUnit: allocationValues.weightInputUnit,
                                            volumeInputValue: allocationValues.volumeInputValue,
                                            volumeInputUnit: allocationValues.volumeInputUnit,
                                        })
                                        : formatCargoSummary({
                                            qtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                                            weightInputValue: item.actualWeightInputValue,
                                            weightInputUnit: item.actualWeightInputUnit,
                                            volumeInputValue: item.actualVolumeInputValue,
                                            volumeInputUnit: item.actualVolumeInputUnit,
                                        });
                                    return (
                                        <button
                                            key={item.deliveryOrderItemRef}
                                            type="button"
                                            className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setActiveFinalizationCargoItemRef(item.deliveryOrderItemRef)}
                                            disabled={updatingStatus}
                                            title={`${item.groupLabel} | ${item.description} | ${tabHasValue ? tabValueSummary : 'Belum diisi'}`}
                                            style={{
                                                alignItems: 'flex-start',
                                                display: 'grid',
                                                gap: '0.15rem',
                                                minWidth: 150,
                                                textAlign: 'left',
                                                whiteSpace: 'normal',
                                            }}
                                        >
                                            <span>Item {index + 1}</span>
                                            <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.85 }}>
                                                {tabHasValue ? tabValueSummary : 'Belum diisi'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            )}

                            {!showingDropFinalizationReview && activeFinalizationCargoItem ? (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                    {(() => {
                                        return (
                                            <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                        <div>
                                            <div className="text-muted text-sm">{activeFinalizationCargoItem.groupLabel}</div>
                                            <div style={{ fontWeight: 700, marginTop: '0.2rem' }}>{activeFinalizationCargoItem.description}</div>
                                        </div>
                                    </div>
                                    {!activeFinalizationCargoItem.requireQty && (
                                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                            Item ini tidak memakai basis koli. Isi realisasi berat dan/atau volume aktual lapangan.
                                        </div>
                                    )}
                                    {activeFinalizationDrop && (
                                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                            Isi alokasi barang untuk titik <strong>{activeFinalizationDrop.locationName || activeFinalizationDrop.locationAddress || 'ini'}</strong>. Nilai ini menjadi sumber aktual barang untuk finalisasi multi-drop.
                                        </div>
                                    )}
                                    {!activeFinalizationDrop && showAdvancedDropEditor && (
                                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                            Aktual barang dihitung otomatis dari alokasi setiap titik drop. Ubah nilai dari langkah titik drop jika perlu koreksi.
                                        </div>
                                    )}
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">{activeFinalizationDrop ? 'Koli Alokasi' : 'Koli Aktual'} {activeFinalizationCargoItem.requireQty && <span className="required">*</span>}</label>
                                            <FormattedNumberInput
                                                min={0}
                                                maxFractionDigits={2}
                                                value={parseFormattedNumberish((activeFinalizationDropAllocation?.qtyKoli ?? activeFinalizationCargoItem.actualQtyKoli) || 0, { maxFractionDigits: 2 })}
                                                onValueChange={value => {
                                                    if (activeFinalizationDrop) {
                                                        updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'qtyKoli', String(value));
                                                        return;
                                                    }
                                                    updateActualCargoDraft(activeFinalizationCargoItem.deliveryOrderItemRef, 'actualQtyKoli', String(value));
                                                }}
                                                disabled={updatingStatus || !activeFinalizationCargoItem.requireQty || (showAdvancedDropEditor && !activeFinalizationDrop)}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">{activeFinalizationDrop ? 'Berat Alokasi' : 'Berat Aktual'} {activeFinalizationCargoItem.requireWeight && <span className="required">*</span>}</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                <SplitDecimalNumberInput
                                                    min={0}
                                                    maxFractionDigits={getWeightInputFractionDigits(activeFinalizationDropAllocation?.weightInputUnit || activeFinalizationCargoItem.actualWeightInputUnit)}
                                                    value={(activeFinalizationDropAllocation?.weightInputValue ?? activeFinalizationCargoItem.actualWeightInputValue) || 0}
                                                    onValueChange={value => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'weightInputValue', String(value));
                                                            return;
                                                        }
                                                        updateActualCargoDraft(activeFinalizationCargoItem.deliveryOrderItemRef, 'actualWeightInputValue', String(value));
                                                    }}
                                                    disabled={updatingStatus || (!activeFinalizationDrop && showAdvancedDropEditor)}
                                                />
                                                <select
                                                    className="form-select"
                                                    value={activeFinalizationDropAllocation?.weightInputUnit || activeFinalizationCargoItem.actualWeightInputUnit}
                                                    onChange={e => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'weightInputUnit', e.target.value);
                                                            return;
                                                        }
                                                        updateActualCargoWeightUnit(activeFinalizationCargoItem.deliveryOrderItemRef, e.target.value as ActualCargoDraft['actualWeightInputUnit']);
                                                    }}
                                                    disabled={updatingStatus || (!activeFinalizationDrop && showAdvancedDropEditor)}
                                                >
                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">{activeFinalizationDrop ? 'Volume Alokasi' : 'Volume Aktual'} {activeFinalizationCargoItem.requireVolume && <span className="required">*</span>}</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                <SplitDecimalNumberInput
                                                    min={0}
                                                    maxFractionDigits={(activeFinalizationDropAllocation?.volumeInputUnit || activeFinalizationCargoItem.actualVolumeInputUnit) === 'LITER' ? 0 : 3}
                                                    value={(activeFinalizationDropAllocation?.volumeInputValue ?? activeFinalizationCargoItem.actualVolumeInputValue) || 0}
                                                    onValueChange={value => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'volumeInputValue', String(value));
                                                            return;
                                                        }
                                                        updateActualCargoDraft(activeFinalizationCargoItem.deliveryOrderItemRef, 'actualVolumeInputValue', String(value));
                                                    }}
                                                    disabled={updatingStatus || (showAdvancedDropEditor && !activeFinalizationDrop)}
                                                />
                                                <select
                                                    className="form-select"
                                                    value={activeFinalizationDropAllocation?.volumeInputUnit || activeFinalizationCargoItem.actualVolumeInputUnit}
                                                    onChange={e => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'volumeInputUnit', e.target.value);
                                                            return;
                                                        }
                                                        updateActualCargoVolumeUnit(activeFinalizationCargoItem.deliveryOrderItemRef, e.target.value as ActualCargoDraft['actualVolumeInputUnit']);
                                                    }}
                                                    disabled={updatingStatus || (showAdvancedDropEditor && !activeFinalizationDrop)}
                                                >
                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem', background: 'var(--color-white)', marginTop: '0.75rem', display: 'grid', gap: '0.55rem' }}>
                                        <div className="font-semibold">{activeFinalizationDrop ? 'Detail Alokasi Item' : 'Detail Item Aktual'}</div>
                                        <div
                                            style={{
                                                display: 'grid',
                                                gap: '0.18rem',
                                                padding: '0.65rem 0.75rem',
                                                border: '1px solid var(--color-gray-100)',
                                                borderRadius: '0.65rem',
                                                background: 'var(--color-gray-50)',
                                            }}
                                        >
                                            <div className="font-medium">{activeFinalizationCargoItem.description || 'Barang'}</div>
                                            <div className="text-muted text-sm">No SJ: {activeFinalizationCargoItem.shipperReferenceNumber || activeFinalizationCargoItem.groupLabel || '-'}</div>
                                            <div className="text-muted text-sm">
                                                Rencana awal SJ: {formatCargoSummary({
                                                    qtyKoli: activeFinalizationCargoItem.plannedQtyKoli,
                                                    weightKg: activeFinalizationCargoItem.plannedWeightKg,
                                                    weightInputValue: activeFinalizationCargoItem.plannedWeightInputValue,
                                                    weightInputUnit: activeFinalizationCargoItem.plannedWeightInputUnit,
                                                    volumeM3: activeFinalizationCargoItem.plannedVolumeM3,
                                                    volumeInputValue: activeFinalizationCargoItem.plannedVolumeInputValue,
                                                    volumeInputUnit: activeFinalizationCargoItem.plannedVolumeInputUnit,
                                                })}
                                            </div>
                                            {activeFinalizationDrop ? (
                                                <>
                                                    <div className="text-muted text-sm">
                                                        {(activeFinalizationDrop.stopType === 'HOLD' ? 'Akan di-hold di titik ini' : 'Akan dialokasikan di titik ini')}: {formatCargoSummary({
                                                            qtyKoli: parseFormattedNumberish(activeFinalizationDropAllocation?.qtyKoli || 0, { maxFractionDigits: 2 }),
                                                            weightInputValue: activeFinalizationDropAllocation?.weightInputValue,
                                                            weightInputUnit: activeFinalizationDropAllocation?.weightInputUnit,
                                                            volumeInputValue: activeFinalizationDropAllocation?.volumeInputValue,
                                                            volumeInputUnit: activeFinalizationDropAllocation?.volumeInputUnit,
                                                        })}
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="text-muted text-sm">Akan direalisasikan: {summarizeActualCargoDraft(activeFinalizationCargoItem)}</div>
                                                    <div className="text-muted text-sm">Total alokasi drop: {summarizeActualCargoDraft(activeFinalizationCargoItem)}</div>
                                                    <div className="text-muted text-sm">Total alokasi hold: {summarizeActualDropPointsForItemByType(activeFinalizationCargoItem, ['HOLD'])}</div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            ) : !showingDropFinalizationReview ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Belum ada item barang dalam batch SJ ini</div>
                                </div>
                            ) : null}

                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    if (activeFinalizationDrop && actualDropEditSnapshot) {
                                        setActualDropPoints(actualDropEditSnapshot.points.map(point => ({ ...point })));
                                        setActualDropItemValueMap({ ...actualDropEditSnapshot.itemValueMap });
                                        setActualDropEditSnapshot(null);
                                    }
                                    if (activeFinalizationDrop && actualCargoModalReturnTarget === 'review') {
                                        setActiveFinalizationReviewDropKey(activeFinalizationDrop.draftKey);
                                        setActiveFinalizationDropKey('');
                                        return;
                                    }
                                    if (!activeFinalizationDrop && !showAdvancedDropEditor && actualCargoSetupSnapshot.length > 0) {
                                        setActualCargoItems(actualCargoSetupSnapshot);
                                        setActualCargoItemValueMap({});
                                    }
                                    setActiveFinalizationDropKey('');
                                    setActualCargoModalReturnTarget('status');
                                    setShowActualCargoFinalizationModal(false);
                                    reopenStatusModalWithSavedScroll();
                                }}
                                disabled={updatingStatus}
                            >
                                {activeFinalizationDrop && actualCargoModalReturnTarget === 'review' ? 'Kembali ke Review' : 'Kembali ke Titik Drop'}
                            </button>
                            {activeFinalizationDrop ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        if (actualCargoModalReturnTarget !== 'review') {
                                            rememberActualCargoModalScrollPosition();
                                        }
                                        if (activeFinalizationDrop) {
                                            persistActualDropAllocationsForItems(
                                                activeFinalizationDrop,
                                                finalizationCargoTabItems
                                            );
                                        }
                                        setActiveFinalizationReviewDropKey(activeFinalizationDrop.draftKey);
                                        setActiveFinalizationDropKey('');
                                        setActualDropEditSnapshot(null);
                                        restoreActualCargoModalScrollOnNextFrame();
                                        if (actualCargoModalReturnTarget === 'status') {
                                            setShowActualCargoFinalizationModal(false);
                                            reopenStatusModalWithSavedScroll();
                                        }
                                    }}
                                    disabled={updatingStatus}
                                >
                                    Simpan Aktual Barang
                                </button>
                            ) : (
                                <button
                                    className="btn btn-success"
                                    onClick={updateDOStatus}
                                    disabled={!newStatus || updatingStatus || selectedStatusSuratJalanRefs.length === 0 || !podName.trim() || !podDate || !selectedActualDropReady || !selectedActualCargoReady}
                                >
                                    <Save size={16} /> {updatingStatus ? 'Menyimpan...' : (reviewingDriverRequest ? 'Approve Batch SJ' : 'Finalkan Batch SJ')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showRejectRequestModal && (
                <div className="modal-overlay" onClick={() => { if (!rejectingRequest) { setShowRejectRequestModal(false); setReviewingDriverRequestId(''); } }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tolak Permintaan Driver</h3>
                            <button className="modal-close" onClick={() => { setShowRejectRequestModal(false); setReviewingDriverRequestId(''); }} disabled={rejectingRequest}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Alasan Penolakan <span className="required">*</span></label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={rejectRequestNote}
                                    onChange={e => setRejectRequestNote(e.target.value)}
                                    disabled={rejectingRequest}
                                    placeholder="Mis. POD belum lengkap atau barang belum benar-benar diterima."
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowRejectRequestModal(false); setReviewingDriverRequestId(''); }} disabled={rejectingRequest}>Batal</button>
                            <button className="btn btn-danger" onClick={rejectDriverStatusRequest} disabled={rejectingRequest || !rejectRequestNote.trim()}>
                                <Save size={16} /> {rejectingRequest ? 'Menyimpan...' : 'Tolak Permintaan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showSuratJalanActualEditModal && (
                <div className="modal-overlay" onClick={closeSuratJalanActualEditModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">Edit Aktual Barang SJ</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                    {selectedSuratJalanActualEditDocument
                                        ? formatSuratJalanDisplayNumber(selectedSuratJalanActualEditDocument.suratJalanNumber, selectedSuratJalanActualEditDocument)
                                        : 'Surat Jalan'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeSuratJalanActualEditModal} disabled={savingSuratJalanActualEdit}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {suratJalanActualEditItems.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Belum ada item barang dalam SJ ini</div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                    <div className="form-group">
                                        <label className="form-label">Surat Jalan Delivered</label>
                                        <select
                                            className="form-select"
                                            value={selectedSuratJalanActualEditDocument?._id || ''}
                                            onChange={event => selectSuratJalanActualEditDocument(event.target.value)}
                                            disabled={savingSuratJalanActualEdit || suratJalanActualEditDocumentOptions.length <= 1}
                                        >
                                            {suratJalanActualEditDocumentOptions.map(document => (
                                                <option key={document._id} value={document._id}>
                                                    {formatSuratJalanDisplayNumber(document.suratJalanNumber, document)}
                                                </option>
                                            ))}
                                        </select>
                                        {lockedSuratJalanActualEditDocumentCount > 0 && (
                                            <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                                {lockedSuratJalanActualEditDocumentCount} SJ sudah masuk invoice dan tidak ditampilkan di pilihan edit.
                                            </div>
                                        )}
                                    </div>
                                    {suratJalanActualEditSelectableItems.length === 0 || !selectedSuratJalanActualEditItem ? (
                                        <div className="empty-state">
                                            <div className="empty-state-title">Belum ada item terkirim aktual yang bisa diedit</div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="form-group">
                                                <label className="form-label">Item Terkirim Aktual</label>
                                                <select
                                                    className="form-select"
                                                    value={selectedSuratJalanActualEditItem.deliveryOrderItemRef}
                                                    onChange={event => setSelectedSuratJalanActualEditItemRef(event.target.value)}
                                                    disabled={savingSuratJalanActualEdit}
                                                >
                                                    {suratJalanActualEditSelectableItems.map((item, index) => (
                                                        <option key={item.deliveryOrderItemRef} value={item.deliveryOrderItemRef}>
                                                            {getActualEditItemLabel(item, index)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            {(() => {
                                                const item = selectedSuratJalanActualEditItem;
                                                const deliveryOrderItem = doItems.find(row => row._id === item.deliveryOrderItemRef);
                                                const identity = getDeliveryOrderItemIdentity(deliveryOrderItem);
                                                return (
                                                    <div key={item.deliveryOrderItemRef} style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem', background: 'var(--color-gray-50)', borderRadius: '0.75rem', border: '1px solid var(--color-gray-200)' }}>
                                            <div>
                                                {identity.code ? <div className="font-mono text-xs text-muted">{identity.code}</div> : null}
                                                <div className="font-semibold">{identity.name || item.description || '-'}</div>
                                                <div className="text-muted text-sm">
                                                    {showSuratJalanActualEditDropRows ? 'Muatan aktual per titik drop' : 'Muatan aktual item yang dipilih'}
                                                </div>
                                            </div>
                                            {showSuratJalanActualEditDropRows ? (
                                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                    {selectedSuratJalanActualEditDropRows.map((drop, dropIndex) => (
                                                        <div key={drop.draftKey} style={{ display: 'grid', gap: '0.65rem', padding: '0.75rem', background: 'var(--color-white)', borderRadius: '0.65rem', border: '1px solid var(--color-gray-200)' }}>
                                                            <div>
                                                                <div className="font-semibold">Titik Drop {dropIndex + 1}</div>
                                                                <div className="text-muted text-sm">{drop.locationName || drop.locationAddress || 'Tujuan Invoice'}</div>
                                                                {drop.locationAddress && drop.locationAddress !== drop.locationName ? (
                                                                    <div className="text-muted text-xs">{drop.locationAddress}</div>
                                                                ) : null}
                                                            </div>
                                                            <div className="form-row">
                                                                <div className="form-group">
                                                                    <label className="form-label">Qty Aktual</label>
                                                                    <FormattedNumberInput
                                                                        key={`${drop.draftKey}-qty`}
                                                                        min={0}
                                                                        maxFractionDigits={2}
                                                                        value={parseFormattedNumberish(drop.qtyKoli || 0, { maxFractionDigits: 2 })}
                                                                        onValueChange={value => updateSuratJalanActualEditDropPoint(drop.draftKey, 'qtyKoli', String(value))}
                                                                        disabled={savingSuratJalanActualEdit}
                                                                    />
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Berat Aktual</label>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                        <SplitDecimalNumberInput
                                                                            key={`${drop.draftKey}-weight`}
                                                                            min={0}
                                                                            maxFractionDigits={getWeightInputFractionDigits(drop.weightInputUnit)}
                                                                            value={drop.weightInputValue || 0}
                                                                            onValueChange={value => updateSuratJalanActualEditDropPoint(drop.draftKey, 'weightInputValue', String(value))}
                                                                            disabled={savingSuratJalanActualEdit}
                                                                        />
                                                                        <select
                                                                            className="form-select"
                                                                            value={drop.weightInputUnit}
                                                                            onChange={event => updateSuratJalanActualEditDropPoint(drop.draftKey, 'weightInputUnit', event.target.value)}
                                                                            disabled={savingSuratJalanActualEdit}
                                                                        >
                                                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Volume Aktual</label>
                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                                        <SplitDecimalNumberInput
                                                                            key={`${drop.draftKey}-volume`}
                                                                            min={0}
                                                                            maxFractionDigits={drop.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                            value={drop.volumeInputValue || 0}
                                                                            onValueChange={value => updateSuratJalanActualEditDropPoint(drop.draftKey, 'volumeInputValue', String(value))}
                                                                            disabled={savingSuratJalanActualEdit}
                                                                        />
                                                                        <select
                                                                            className="form-select"
                                                                            value={drop.volumeInputUnit}
                                                                            onChange={event => updateSuratJalanActualEditDropPoint(drop.draftKey, 'volumeInputUnit', event.target.value)}
                                                                            disabled={savingSuratJalanActualEdit}
                                                                        >
                                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Qty Aktual</label>
                                                        <FormattedNumberInput
                                                            key={`${item.deliveryOrderItemRef}-qty`}
                                                            min={0}
                                                            maxFractionDigits={2}
                                                            value={parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 })}
                                                            onValueChange={value => updateSuratJalanActualEditItem(item.deliveryOrderItemRef, 'actualQtyKoli', String(value))}
                                                            disabled={savingSuratJalanActualEdit}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Berat Aktual</label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                            <SplitDecimalNumberInput
                                                                key={`${item.deliveryOrderItemRef}-weight`}
                                                                min={0}
                                                                maxFractionDigits={getWeightInputFractionDigits(item.actualWeightInputUnit)}
                                                                value={item.actualWeightInputValue || 0}
                                                                onValueChange={value => updateSuratJalanActualEditItem(item.deliveryOrderItemRef, 'actualWeightInputValue', String(value))}
                                                                disabled={savingSuratJalanActualEdit || shouldLockActualCargoVolume(item)}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={item.actualWeightInputUnit}
                                                                onChange={event => updateSuratJalanActualEditWeightUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualWeightInputUnit'])}
                                                                disabled={savingSuratJalanActualEdit}
                                                            >
                                                                {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Volume Aktual</label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                            <SplitDecimalNumberInput
                                                                key={`${item.deliveryOrderItemRef}-volume`}
                                                                min={0}
                                                                maxFractionDigits={item.actualVolumeInputUnit === 'LITER' ? 0 : 3}
                                                                value={item.actualVolumeInputValue || 0}
                                                                onValueChange={value => updateSuratJalanActualEditItem(item.deliveryOrderItemRef, 'actualVolumeInputValue', String(value))}
                                                                disabled={savingSuratJalanActualEdit}
                                                            />
                                                            <select
                                                                className="form-select"
                                                                value={item.actualVolumeInputUnit}
                                                                onChange={event => updateSuratJalanActualEditVolumeUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualVolumeInputUnit'])}
                                                                disabled={savingSuratJalanActualEdit}
                                                            >
                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                                );
                                            })()}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeSuratJalanActualEditModal} disabled={savingSuratJalanActualEdit}>Batal</button>
                            <button className="btn btn-primary" onClick={() => void saveSuratJalanActualEdit()} disabled={savingSuratJalanActualEdit || suratJalanActualEditItems.length === 0 || !selectedSuratJalanActualEditItem}>
                                <Save size={16} /> {savingSuratJalanActualEdit ? 'Menyimpan...' : 'Simpan Aktual'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showShipperReferenceModal && (
                <div className="modal-overlay" onClick={() => { if (!savingShipperReference) setShowShipperReferenceModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCreatingNewShipperReference ? 'Tambah Surat Jalan' : 'Edit Surat Jalan'}</h3>
                            <button className="modal-close" onClick={() => { setShowShipperReferenceModal(false); setShipperReferenceItemDraftMap({}); setShipperReferenceExistingItemDraftMap({}); }} disabled={savingShipperReference}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {!isCreatingNewShipperReference && (
                                <div className="form-group">
                                    <label className="form-label">Pilih Surat Jalan</label>
                                    <select
                                        className="form-select"
                                        value={selectedShipperReferenceDraft?.draftKey || ''}
                                        onChange={event => setSelectedShipperReferenceDraftKey(event.target.value)}
                                        disabled={savingShipperReference || shipperReferenceDrafts.length === 0}
                                    >
                                        <option value="">Pilih Surat Jalan...</option>
                                        {shipperReferenceDrafts.map((entry, index) => (
                                            <option
                                                key={entry.draftKey}
                                                value={entry.draftKey}
                                                disabled={getSuratJalanOperationalStatus(entry.referenceKey).status === 'DELIVERED'}
                                            >
                                                {formatSuratJalanDisplayNumber(entry.referenceNumber || `SJ ${index + 1}`, getSuratJalanOperationalStatus(entry.referenceKey).document)}
                                                {getSuratJalanOperationalStatus(entry.referenceKey).status === 'DELIVERED' ? ' (Delivered)' : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Pilih nomor SJ yang ingin dibetulkan. SJ yang sudah delivered tidak bisa dipilih.
                                    </div>
                                </div>
                            )}
                            {!isCreatingNewShipperReference && !selectedShipperReferenceDraft && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                    Belum ada SJ yang bisa diedit dari daftar ini.
                                </div>
                            )}
                            {isCreatingNewShipperReference && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                    Lengkapi form di bawah untuk membuat Surat Jalan baru pada trip ini.
                                </div>
                            )}
                            {selectedShipperReferenceDraft && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'minmax(0, 1fr) minmax(10rem, 0.42fr) auto', alignItems: 'center' }}>
                                        <input
                                            className="form-input"
                                            value={selectedShipperReferenceDraft.referenceNumber}
                                            onChange={event => {
                                                const nextValue = event.target.value.toUpperCase();
                                                updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { referenceNumber: nextValue });
                                            }}
                                            placeholder={`Contoh: ${shipperReferenceExample}`}
                                            disabled={savingShipperReference}
                                        />
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={selectedShipperReferenceDraft.date || getBusinessDateValue()}
                                            onChange={event => updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, { date: event.target.value })}
                                            disabled={savingShipperReference}
                                            title="Tanggal SJ"
                                        />
                                        {!isCreatingNewShipperReference && shipperReferenceDrafts.length > 1 && (
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-icon-only"
                                                onClick={() => removeShipperReferenceDraft(selectedShipperReferenceDraft.draftKey)}
                                                disabled={savingShipperReference || Boolean(selectedShipperReferenceDeleteLockReason)}
                                                title={selectedShipperReferenceDeleteLockReason || 'Hapus SJ pengirim'}
                                            >
                                                &times;
                                            </button>
                                        )}
                                    </div>
                                    {shipperReferencePickupOptions.length > 1 && (
                                        <div>
                                            <label className="form-label">Titik Pickup</label>
                                            <select
                                                className="form-select"
                                                value={selectedShipperReferenceDraft.pickupStopKey}
                                                onChange={event => {
                                                    const selectedPickupOption = shipperReferencePickupOptionMap.get(event.target.value);
                                                    updateShipperReferenceDraft(selectedShipperReferenceDraft.draftKey, {
                                                        pickupStopKey: event.target.value,
                                                        pickupAddress: selectedPickupOption?.address || '',
                                                    });
                                                }}
                                                disabled={savingShipperReference}
                                            >
                                                <option value="">Pilih pickup untuk SJ ini</option>
                                                {shipperReferencePickupOptions.map(option => (
                                                    <option key={option.key} value={option.key}>
                                                        {option.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {shipperReferencePickupOptions.length === 1 && (
                                        <div className="text-muted text-sm">
                                            Pickup: {shipperReferencePickupOptions[0].name}
                                        </div>
                                    )}
                                    {(shipperReferencePickupOptionMap.get(selectedShipperReferenceDraft.pickupStopKey)?.address || selectedShipperReferenceDraft.pickupAddress || pickupStopMap.get(selectedShipperReferenceDraft.pickupStopKey)?.pickupAddress) && (
                                        <div className="text-muted text-sm">
                                            {shipperReferencePickupOptionMap.get(selectedShipperReferenceDraft.pickupStopKey)?.address || selectedShipperReferenceDraft.pickupAddress || pickupStopMap.get(selectedShipperReferenceDraft.pickupStopKey)?.pickupAddress}
                                        </div>
                                    )}
                                    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.35rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div>
                                                <div className="form-label" style={{ marginBottom: 0 }}>Item Surat Jalan</div>
                                                <div className="text-muted text-sm">
                                                    {isCreatingNewShipperReference
                                                        ? 'Isi barang untuk SJ baru ini langsung dari form di bawah.'
                                                        : 'Barang tersimpan tampil di bawah. Tambahkan item baru langsung dari form ini.'}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={addSelectedShipperReferenceItemDraft}
                                                disabled={savingShipperReference}
                                            >
                                                <Plus size={14} /> Tambah Item
                                            </button>
                                        </div>

                                        {!isCreatingNewShipperReference && selectedShipperReferenceExistingItemDrafts.length > 0 && (
                                            <div style={{ display: 'grid', gap: '0.45rem', padding: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem' }}>
                                                <div className="text-muted text-sm">Barang tersimpan di dokumen ini. Ubah langsung dari form ini atau hapus jika tidak dipakai.</div>
                                                {selectedShipperReferenceExistingItemDrafts.map((item, itemIndex) => (
                                                    <div key={item.deliveryOrderItemId} style={{ display: 'grid', gap: 12, padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                                                Barang Tersimpan {itemIndex + 1}
                                                            </div>
                                                            {editableCargoItemMap[item.deliveryOrderItemId] ? (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-ghost btn-sm"
                                                                    onClick={() => {
                                                                        setShipperReferenceExistingItemDraftMap(prev => {
                                                                            const next = { ...prev };
                                                                            if (selectedShipperReferenceDraft && next[selectedShipperReferenceDraft.draftKey]) {
                                                                                next[selectedShipperReferenceDraft.draftKey] = next[selectedShipperReferenceDraft.draftKey].filter(i => i.deliveryOrderItemId !== item.deliveryOrderItemId);
                                                                            }
                                                                            return next;
                                                                        });
                                                                        setDeletedShipperReferenceItemIds(prev => [...prev, item.deliveryOrderItemId]);
                                                                    }}
                                                                    disabled={savingShipperReference}
                                                                    style={{ color: 'var(--color-danger-700)' }}
                                                                    title="Hapus barang ini dari Surat Jalan (disimpan saat klik Simpan)"
                                                                >
                                                                    Hapus
                                                                </button>
                                                            ) : (
                                                                <span className="text-muted text-sm">Tidak bisa dihapus</span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                            <div style={{ flex: '1 1 240px' }}>
                                                                <label className="form-label">Barang Customer</label>
                                                                <select
                                                                    className="form-select"
                                                                    value={item.customerProductRef}
                                                                    onChange={e => applySelectedExistingShipperReferenceItemProduct(itemIndex, e.target.value)}
                                                                    disabled={savingShipperReference || !doData?.customerRef}
                                                                >
                                                                    <option value="">{deliveryOrderCustomerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                                    {deliveryOrderCustomerProducts.map(product => (
                                                                        <option key={product._id} value={product._id}>
                                                                            {product.code ? `${product.code} - ` : ''}{product.name}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div style={{ flex: '2 1 260px' }}>
                                                                <label className="form-label">Deskripsi Barang</label>
                                                                <input
                                                                    className="form-input"
                                                                    value={item.description}
                                                                    onChange={e => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'description', e.target.value)}
                                                                    placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                                    disabled={savingShipperReference}
                                                                />
                                                            </div>
                                                            <div style={{ flex: '0 1 110px' }}>
                                                                <label className="form-label">Koli</label>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    allowDecimal={false}
                                                                    value={item.qtyKoli}
                                                                    onValueChange={value => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'qtyKoli', value)}
                                                                    disabled={savingShipperReference}
                                                                />
                                                            </div>
                                                            <div style={{ flex: '1 1 180px' }}>
                                                                <label className="form-label">Berat</label>
                                                                <div style={{ display: 'flex', gap: 8 }}>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)}
                                                                        value={item.weightInputValue}
                                                                        onValueChange={value => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'weightInputValue', value)}
                                                                        disabled={savingShipperReference || shouldLockOrderItemVolume(item)}
                                                                    />
                                                                    <select
                                                                        className="form-select"
                                                                        value={item.weightInputUnit}
                                                                        onChange={e => updateSelectedExistingShipperReferenceItemWeightUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['weightInputUnit'])}
                                                                        style={{ width: 92 }}
                                                                        disabled={savingShipperReference}
                                                                    >
                                                                        {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                            <div style={{ flex: '1 1 180px' }}>
                                                                <label className="form-label">Volume</label>
                                                                <div style={{ display: 'flex', gap: 8 }}>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                        value={item.volumeInputValue}
                                                                        onValueChange={value => updateSelectedExistingShipperReferenceItemDraft(itemIndex, 'volumeInputValue', value)}
                                                                        disabled={savingShipperReference}
                                                                    />
                                                                    <select
                                                                        className="form-select"
                                                                        value={item.volumeInputUnit}
                                                                        onChange={e => updateSelectedExistingShipperReferenceItemVolumeUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit'])}
                                                                        style={{ width: 92 }}
                                                                        disabled={savingShipperReference}
                                                                    >
                                                                        {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {selectedShipperReferenceItemDrafts.length === 0 && (
                                            <div className="text-muted text-sm" style={{ padding: '0.75rem', border: '1px dashed var(--color-gray-300)', borderRadius: '0.75rem', background: 'var(--color-white)' }}>
                                                {isCreatingNewShipperReference
                                                    ? <>Belum ada barang untuk SJ baru ini. Klik <strong>Tambah Item</strong> untuk mulai isi barang.</>
                                                    : <>Belum ada item baru. Klik <strong>Tambah Item</strong> jika dokumen ini perlu tambahan barang.</>}
                                            </div>
                                        )}

                                        {selectedShipperReferenceItemDrafts.map((item, itemIndex) => (
                                            <div key={`${selectedShipperReferenceDraft.draftKey}-new-item-${itemIndex}`} style={{ display: 'grid', gap: 12, padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                                        Barang Baru {itemIndex + 1}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => removeSelectedShipperReferenceItemDraft(itemIndex)}
                                                        disabled={savingShipperReference}
                                                        title="Hapus item ini"
                                                        style={{
                                                            color: 'var(--color-danger-700)',
                                                            borderColor: 'var(--color-danger-200)',
                                                            background: 'var(--color-danger-50)',
                                                        }}
                                                    >
                                                        <Trash2 size={14} /> Hapus Item
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                                <div style={{ flex: '1 1 240px' }}>
                                                    <label className="form-label">Barang Customer</label>
                                                    <select
                                                        className="form-select"
                                                        value={item.customerProductRef}
                                                        onChange={e => applySelectedShipperReferenceItemProduct(itemIndex, e.target.value)}
                                                        disabled={savingShipperReference || !doData?.customerRef}
                                                    >
                                                        <option value="">{deliveryOrderCustomerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                        {deliveryOrderCustomerProducts.map(product => (
                                                            <option key={product._id} value={product._id}>
                                                                {product.code ? `${product.code} - ` : ''}{product.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div style={{ flex: '2 1 260px' }}>
                                                    <label className="form-label">Deskripsi Barang</label>
                                                    <input
                                                        className="form-input"
                                                        value={item.description}
                                                        onChange={e => updateSelectedShipperReferenceItemDraft(itemIndex, 'description', e.target.value)}
                                                        placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                        disabled={savingShipperReference}
                                                    />
                                                </div>
                                                <div style={{ flex: '0 1 110px' }}>
                                                    <label className="form-label">Koli</label>
                                                    <FormattedNumberInput
                                                        min={0}
                                                        allowDecimal={false}
                                                        value={item.qtyKoli}
                                                        onValueChange={value => updateSelectedShipperReferenceItemDraft(itemIndex, 'qtyKoli', value)}
                                                        disabled={savingShipperReference}
                                                    />
                                                </div>
                                                <div style={{ flex: '1 1 180px' }}>
                                                    <label className="form-label">Berat</label>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)}
                                                            value={item.weightInputValue}
                                                            onValueChange={value => updateSelectedShipperReferenceItemDraft(itemIndex, 'weightInputValue', value)}
                                                            disabled={savingShipperReference || shouldLockOrderItemVolume(item)}
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={item.weightInputUnit}
                                                            onChange={e => updateSelectedShipperReferenceItemWeightUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['weightInputUnit'])}
                                                            style={{ width: 92 }}
                                                            disabled={savingShipperReference}
                                                        >
                                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div style={{ flex: '1 1 180px' }}>
                                                    <label className="form-label">Volume</label>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <FormattedNumberInput
                                                            min={0}
                                                            maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                            value={item.volumeInputValue}
                                                            onValueChange={value => updateSelectedShipperReferenceItemDraft(itemIndex, 'volumeInputValue', value)}
                                                            disabled={savingShipperReference}
                                                        />
                                                        <select
                                                            className="form-select"
                                                            value={item.volumeInputUnit}
                                                            onChange={e => updateSelectedShipperReferenceItemVolumeUnit(itemIndex, e.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit'])}
                                                            style={{ width: 92 }}
                                                            disabled={savingShipperReference}
                                                        >
                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowShipperReferenceModal(false); setShipperReferenceItemDraftMap({}); setShipperReferenceExistingItemDraftMap({}); }} disabled={savingShipperReference}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={saveShipperReference}
                                disabled={
                                    savingShipperReference
                                    || shipperReferenceDrafts.every(entry => !entry.referenceNumber.trim())
                                    || (!isCreatingNewShipperReference && !selectedShipperReferenceDraft)
                                }
                            >
                                <Save size={16} /> {savingShipperReference ? 'Menyimpan...' : (isCreatingNewShipperReference ? 'Buat SJ' : 'Simpan')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingTripClosure !== null && (
                <div className="modal-overlay" onClick={() => {
                    if (!togglingTripClosure) {
                        setPendingTripClosure(null);
                    }
                }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                {pendingTripClosure ? 'Tutup Trip' : 'Buka Kembali Trip'}
                            </h3>
                            <button
                                className="modal-close"
                                onClick={() => setPendingTripClosure(null)}
                                disabled={togglingTripClosure}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="text-muted text-sm">
                                {pendingTripClosure
                                    ? 'Setelah trip ditutup admin, tambah SJ dan edit muatan SJ akan dikunci sampai trip dibuka kembali.'
                                    : 'Setelah trip dibuka kembali, admin bisa menambah SJ baru dan mengubah muatan SJ lagi.'}
                            </div>
                            {pendingTripClosure && (
                                <div style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Odometer Sebelum Trip</label>
                                            <div className="form-input" style={{ display: 'flex', alignItems: 'center', background: 'var(--color-gray-50)' }}>
                                                {formatQuantity(tripClosureOldOdometer, 0)} km
                                            </div>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Odometer Akhir Trip</label>
                                            <FormattedNumberInput
                                                allowDecimal={false}
                                                value={tripClosureOdometer}
                                                onValueChange={value => setTripClosureOdometer(Math.max(value, tripClosureOldOdometer))}
                                                onBlur={() => setTripClosureOdometer(current => Math.max(current, tripClosureOldOdometer))}
                                                disabled={togglingTripClosure}
                                            />
                                            {tripClosureOdometerInvalid && (
                                                <div className="text-danger text-sm" style={{ marginTop: '0.35rem' }}>Odometer akhir tidak boleh lebih kecil dari odometer sebelumnya.</div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                                            <div className="text-muted text-sm">Jarak Trip</div>
                                            <div className="font-semibold">{formatQuantity(tripClosureDistanceKm, 0)} km</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                                            <div className="text-muted text-sm">Sisa Servis Oli Setelah Trip</div>
                                            <div className="font-semibold">{tripClosureOilTargetOdometer ? `${formatQuantity(tripClosureOilRemainingAfterTrip, 0)} km` : '-'}</div>
                                        </div>
                                        <div style={{ border: `1px solid ${tripClosureNeedsOilMaintenance ? 'var(--color-danger)' : 'var(--color-success)'}`, borderRadius: '0.5rem', padding: '0.75rem', background: tripClosureNeedsOilMaintenance ? 'var(--color-danger-light)' : 'var(--color-success-light)' }}>
                                            <div className="text-muted text-sm">Status Servis Oli</div>
                                            <div className="font-semibold" style={{ color: tripClosureNeedsOilMaintenance ? 'var(--color-danger)' : 'var(--color-success)' }}>
                                                {tripClosureOilIntervalKm > 0
                                                    ? tripClosureNeedsOilMaintenance ? 'Perlu maintenance' : 'Aman'
                                                    : 'Interval belum diset'}
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-medium" style={{ marginBottom: '0.5rem' }}>Ban Unit Sebelum / Setelah Trip</div>
                                        {loadingTripClosureTires ? (
                                            <div className="skeleton skeleton-text" />
                                        ) : tripClosureTires.length === 0 ? (
                                            <div className="text-muted text-sm">Belum ada ban yang tercatat pada unit ini.</div>
                                        ) : (
                                            <div className="table-wrapper">
                                                <table>
                                                    <thead><tr><th>Ban</th><th>Posisi</th><th>Sebelum</th><th>Setelah</th></tr></thead>
                                                    <tbody>
                                                        {tripClosureTires.map(tire => {
                                                            const beforeKm = tire.accumulatedKm || 0;
                                                            const afterKm = beforeKm + (tire.status === 'IN_USE' ? tripClosureDistanceKm : 0);
                                                            return (
                                                                <tr key={tire._id}>
                                                                    <td className="font-mono">{tire.tireCode}</td>
                                                                    <td>{tire.slotLabel || tire.posisi || '-'}</td>
                                                                    <td>{formatQuantity(beforeKm, 0)} km</td>
                                                                    <td>{formatQuantity(afterKm, 0)} km</td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setPendingTripClosure(null)}
                                disabled={togglingTripClosure}
                            >
                                Batal
                            </button>
                            <button
                                className={pendingTripClosure ? 'btn btn-danger' : 'btn btn-primary'}
                                onClick={() => void confirmTripClosure()}
                                disabled={togglingTripClosure || loadingTripClosureTires || tripClosureOdometerInvalid}
                            >
                                {togglingTripClosure ? 'Menyimpan...' : (pendingTripClosure ? 'Tutup Trip' : 'Buka Kembali')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {pendingDeleteAction && (
                <div className="modal-overlay" onClick={() => {
                    if (!removingCargoItemId && !deletingShipperReferenceKey) {
                        setPendingDeleteAction(null);
                    }
                }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                {pendingDeleteAction.type === 'cargo-item' ? 'Hapus Barang Surat Jalan' : 'Hapus Surat Jalan'}
                            </h3>
                            <button
                                className="modal-close"
                                onClick={() => setPendingDeleteAction(null)}
                                disabled={Boolean(removingCargoItemId) || Boolean(deletingShipperReferenceKey)}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="text-muted text-sm">
                                {pendingDeleteAction.type === 'cargo-item'
                                    ? `Barang "${pendingDeleteAction.itemLabel}" akan dihapus dari Surat Jalan ini.`
                                    : pendingDeleteAction.deleteLocked
                                        ? pendingDeleteAction.lockReason || `SJ ${pendingDeleteAction.reference.referenceNumber || 'ini'} tidak bisa dihapus karena sudah punya aktual muatan.`
                                        : `SJ ${pendingDeleteAction.reference.referenceNumber || 'ini'}${pendingDeleteAction.itemCount > 0 ? ` beserta ${pendingDeleteAction.itemCount} barangnya` : ''} akan dihapus dari trip ini.`}
                            </div>
                            {pendingDeleteAction.type === 'shipper-reference' && !pendingDeleteAction.deleteLocked && (
                                <div
                                    className="text-sm"
                                    style={{
                                        marginTop: '0.85rem',
                                        padding: '0.75rem',
                                        border: '1px solid var(--color-warning)',
                                        borderRadius: '0.5rem',
                                        background: 'var(--color-warning-light)',
                                        color: 'var(--color-warning)',
                                    }}
                                >
                                    Pastikan SJ ini belum pernah dipakai untuk drop atau hold. Setelah dikonfirmasi, barang yang terkait SJ ini ikut dihapus.
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setPendingDeleteAction(null)}
                                disabled={Boolean(removingCargoItemId) || Boolean(deletingShipperReferenceKey)}
                            >
                                Batal
                            </button>
                            <button
                                className="btn btn-danger"
                                onClick={() => void confirmPendingDeleteAction()}
                                disabled={
                                    Boolean(removingCargoItemId) ||
                                    Boolean(deletingShipperReferenceKey) ||
                                    (pendingDeleteAction.type === 'shipper-reference' && pendingDeleteAction.deleteLocked)
                                }
                            >
                                <Trash2 size={16} /> Hapus
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCargoModal && (
                <div className="modal-overlay" onClick={closeCargoModal}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">{isEditingCargoItem ? 'Edit Barang / SJ' : 'Tambah Barang / SJ'}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                    {isEditingCargoItem
                                        ? 'Koreksi 1 barang yang sudah tersimpan.'
                                        : 'Input SJ pengirim lalu isi barangnya.'}
                                </div>
                            </div>
                            <button className="modal-close" onClick={closeCargoModal} disabled={savingCargo}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Draft SJ</div>
                                    <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{cargoDraftGroups.length} SJ</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Barang dicatat</div>
                                    <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{cargoDraftItemCount} barang</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Muatan tambahan</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                        {cargoDraftItemCount > 0 ? formatCargoSummary(cargoDraftSummary) : 'Belum ada barang'}
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {cargoDraftGroups.map((group, groupIndex) => {
                                    const draftItemsInGroup = getDeliveryOrderCargoDraftItems(group);
                                    const normalizedGroupReference = group.shipperReferenceNumber.trim().toUpperCase();
                                    const existingItemsInGroup = normalizedGroupReference
                                        ? doItems.filter(item => (item.shipperReferenceNumber || doData?.customerDoNumber || '').trim().toUpperCase() === normalizedGroupReference)
                                        : [];
                                    const finalizedItemsInGroup = existingItemsInGroup.filter(existingItem =>
                                        existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined
                                    );
                                    return (
                                        <div key={group.id} style={{ display: 'grid', gap: '0.85rem', padding: '1rem', background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div>
                                                    <div className="font-semibold">SJ {groupIndex + 1}</div>
                                                    <div className="text-muted text-sm">{draftItemsInGroup.length} barang</div>
                                                    {existingItemsInGroup.length > 0 && (
                                                        <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                            {existingItemsInGroup.length} barang tersimpan • {finalizedItemsInGroup.length} final • {existingItemsInGroup.length - finalizedItemsInGroup.length} belum final
                                                        </div>
                                                    )}
                                                </div>
                                                {!isEditingCargoItem && cargoDraftGroups.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCargoDraftGroup(group.id)} disabled={savingCargo}>
                                                        <X size={14} /> Hapus SJ
                                                    </button>
                                                )}
                                            </div>

                                            {existingItemsInGroup.length > 0 && (
                                                <div style={{ display: 'grid', gap: '0.45rem', padding: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem' }}>
                                                    <div className="text-muted text-sm">Barang tersimpan di SJ ini</div>
                                                    {existingItemsInGroup.map(existingItem => (
                                                        <div key={existingItem._id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                                                            <span className="font-medium">{existingItem.orderItemDescription || 'Barang'}</span>
                                                            <span className="text-muted">
                                                                {formatCargoSummary({
                                                                    qtyKoli: existingItem.orderItemQtyKoli,
                                                                    weightKg: existingItem.orderItemWeight,
                                                                    weightInputValue: existingItem.orderItemWeightInputValue,
                                                                    weightInputUnit: existingItem.orderItemWeightInputUnit,
                                                                    volumeM3: existingItem.orderItemVolumeM3,
                                                                    volumeInputValue: existingItem.orderItemVolumeInputValue,
                                                                    volumeInputUnit: existingItem.orderItemVolumeInputUnit,
                                                                })}
                                                            </span>
                                                            <span style={{ color: existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                                                {existingItem.actualQtyKoli !== undefined || existingItem.actualWeightKg !== undefined ? 'Sudah final' : 'Belum final'}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {pickupStopList.length > 0 && (
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Titik Pickup</label>
                                                    <select
                                                        className="form-select"
                                                        value={group.pickupStopKey}
                                                        onChange={e => updateCargoDraftGroup(group.id, 'pickupStopKey', e.target.value)}
                                                        disabled={savingCargo}
                                                    >
                                                        <option value="">Pilih titik pickup</option>
                                                        {pickupStopList.map(stop => (
                                                            <option key={stop._key} value={stop._key}>
                                                                {`Pickup ${stop.sequence}${stop.pickupLabel ? ` - ${stop.pickupLabel}` : ''}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">No. SJ Pengirim</label>
                                                <input
                                                    className="form-input"
                                                    value={group.shipperReferenceNumber}
                                                    onChange={e => updateCargoDraftGroup(group.id, 'shipperReferenceNumber', e.target.value.toUpperCase())}
                                                    placeholder={`Mis. ${shipperReferenceExample}`}
                                                    disabled={savingCargo}
                                                />
                                            </div>

                                            <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                {group.items.map((item, itemIndex) => (
                                                    <div key={`${group.id}-item-${itemIndex}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: 12, background: 'var(--color-white)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                        <div style={{ flex: '1 1 240px' }}>
                                                            <label className="form-label">Barang Customer</label>
                                                            <select
                                                                className="form-select"
                                                                value={item.customerProductRef}
                                                                onChange={e => applyCargoDraftProductSelection(group.id, itemIndex, e.target.value)}
                                                                disabled={savingCargo || !doData?.customerRef}
                                                            >
                                                                <option value="">{deliveryOrderCustomerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                                {deliveryOrderCustomerProducts.map(product => (
                                                                    <option key={product._id} value={product._id}>
                                                                        {product.code ? `${product.code} - ` : ''}{product.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div style={{ flex: '2 1 260px' }}>
                                                            <label className="form-label">Deskripsi Barang</label>
                                                            <input
                                                                className="form-input"
                                                                value={item.description}
                                                                onChange={e => updateCargoDraftItem(group.id, itemIndex, 'description', e.target.value)}
                                                                placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                                disabled={savingCargo}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '0 1 110px' }}>
                                                            <label className="form-label">Koli</label>
                                                            <FormattedNumberInput
                                                                min={0}
                                                                allowDecimal={false}
                                                                value={item.qtyKoli}
                                                                onValueChange={value => updateCargoDraftItem(group.id, itemIndex, 'qtyKoli', value)}
                                                                disabled={savingCargo}
                                                            />
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Berat</label>
                                                            <div style={{ display: 'flex', gap: 8 }}>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)}
                                                                    value={item.weightInputValue}
                                                                    onValueChange={value => updateCargoDraftItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                    disabled={savingCargo || shouldLockOrderItemVolume(item)}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.weightInputUnit}
                                                                    onChange={e => setCargoDraftGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((groupItem, currentItemIndex) => (
                                                                                    currentItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                                                                                            ...groupItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, e.target.value as DeliveryOrderCargoDraftItem['weightInputUnit']))
                                                                                        : groupItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    style={{ width: 92 }}
                                                                    disabled={savingCargo}
                                                                >
                                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div style={{ flex: '1 1 180px' }}>
                                                            <label className="form-label">Volume</label>
                                                            <div style={{ display: 'flex', gap: 8 }}>
                                                                <FormattedNumberInput
                                                                    min={0}
                                                                    maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3}
                                                                    value={item.volumeInputValue}
                                                                    onValueChange={value => updateCargoDraftItem(group.id, itemIndex, 'volumeInputValue', value)}
                                                                    disabled={savingCargo}
                                                                />
                                                                <select
                                                                    className="form-select"
                                                                    value={item.volumeInputUnit}
                                                                    onChange={e => setCargoDraftGroups(previous => previous.map(entry => (
                                                                        entry.id === group.id
                                                                            ? {
                                                                                ...entry,
                                                                                items: entry.items.map((groupItem, currentItemIndex) => (
                                                                                    currentItemIndex === itemIndex
                                                                                        ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                                                                                            ...groupItem,
                                                                                            pickupStopKey: entry.pickupStopKey,
                                                                                            shipperReferenceNumber: entry.shipperReferenceNumber,
                                                                                        }, e.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit']))
                                                                                        : groupItem
                                                                                )),
                                                                            }
                                                                            : entry
                                                                    )))}
                                                                    style={{ width: 92 }}
                                                                    disabled={savingCargo}
                                                                >
                                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                </select>
                                                            </div>
                                                        </div>
                                                        {!isEditingCargoItem && group.items.length > 1 && (
                                                            <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeCargoDraftItem(group.id, itemIndex)} disabled={savingCargo} style={{ marginBottom: 4 }}>
                                                                <X size={18} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                {!isEditingCargoItem ? (
                                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => addCargoDraftItem(group.id)} disabled={savingCargo}>
                                                        <Plus size={14} /> Tambah Barang di SJ Ini
                                                    </button>
                                                ) : <span />}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                <div className="text-muted text-sm">
                                    {isEditingCargoItem
                                        ? 'Perubahan langsung sinkron ke manifest trip dan penagihan per SJ.'
                                        : 'Satu trip bisa memuat beberapa SJ.'}
                                </div>
                                {!isEditingCargoItem && (
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addCargoDraftGroup} disabled={savingCargo}>
                                        <Plus size={14} /> Tambah Pickup / SJ
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeCargoModal} disabled={savingCargo}>Batal</button>
                            <button className="btn btn-primary" onClick={saveCargoDrafts} disabled={savingCargo}>
                                <Save size={16} /> {savingCargo ? 'Menyimpan...' : (isEditingCargoItem ? 'Simpan Perubahan' : 'Simpan Barang')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

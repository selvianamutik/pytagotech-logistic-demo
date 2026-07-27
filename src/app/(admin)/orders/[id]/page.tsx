'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '../../layout';
import { Truck, FileText, Edit, Eye, Plus, Trash2, X } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { fetchAdminCollectionData, fetchAdminData, fetchOptionalAdminCollectionData, fetchOptionalAdminData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderDisplayStatusMeta,
    getDeliveryOrderHoldCargoSummary,
    getDeliveryOrderReturnCargoSummary,
} from '@/lib/delivery-order-completion';
import { formatDate, formatCurrency, formatNumber, getReceivableNetAmount, ORDER_STATUS_MAP, ITEM_STATUS_MAP, DO_STATUS_MAP, INVOICE_STATUS_MAP, formatInternalDeliveryOrderNumber } from '@/lib/utils';
import {
    formatCargoSummary,
    formatVolumeDisplay,
    getWeightInputFractionDigits,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import { calculateWeightPortion, roundQuantity } from '@/lib/order-item-progress';
import {
    buildBusyAssignmentIds,
    buildCreateDeliveryOrderItems,
    buildCreateDeliveryOrderRequestData,
    buildDefaultShipmentSelection,
    buildHoldFormState,
    buildOrderDetailMetrics,
    addCargoAggregate,
    buildSelectedNonKoliCargo,
    createCargoAggregate,
    formatProgressLine,
    getAvailableVehicles,
    hasCargoAggregate,
    shouldRequireVehicleOverrideReason,
    sortOrderDetailVehicles,
    type SelectedShipmentMap,
    summarizeSelectedShipments,
} from '@/lib/order-detail-support';
import {
    applyCustomerProductToOrderItem,
    applyOrderItemAutoWeightFromQty,
    getDraftOrderItems,
    shouldLockOrderItemVolume,
    shouldLockOrderItemWeight,
    summarizeDraftOrderCargo,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
} from '@/lib/order-create-page-support';
import {
    createDefaultCancelTripExpenseForm,
    getDefaultCancelExpenseCategoryRef,
    isOperationalCancelExpenseCategory,
    type CancelTripExpenseFormState,
} from '@/lib/cancel-trip-expense-support';
import {
    buildDeliveryOrderShipperReferenceLinks,
    formatDeliveryOrderShipperReferencePreview,
    getDeliveryOrderShipperReferenceNumbers,
} from '@/lib/order-detail-shipper-reference-support';
import {
    createDefaultDirectCargoGroup,
    createDefaultDirectCargoGroupItem,
    createDefaultTripDraftForm,
    flattenDirectCargoGroups,
    getDirectCargoGroupDraftItems,
    toDirectCargoGroupItem,
    type DirectCargoGroup,
    type DirectCargoGroupItem,
    type TripDraftForm,
} from '@/lib/order-detail-direct-cargo-support';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import { hasDeliveryOrderBillableCargo } from '@/lib/delivery-order-completion';
import {
    buildNotaRowsFromDeliveryOrder,
    getFreightNotaItemCoverageKeys,
    getInvoiceRowAvailabilityCoverageKeys,
} from '@/lib/invoice-create-page-support';
import { buildServiceCapacityRangeMap, formatUnitCapacityLabel } from '@/lib/service-capacity-support';
import { buildTripRateAreaOptions, findMatchingTripRouteRate, formatTripRouteRateLabel } from '@/lib/trip-route-rate-support';
import type { BankAccount, Customer, CustomerPickupLocation, CustomerProduct, Driver, Order, OrderItem, DeliveryOrder, DeliveryOrderItem, ExpenseCategory, FreightNota, FreightNotaItem, Service, TripRouteRate, Vehicle } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { useApp } from '../../layout';
import AuditTrailCard from '../../_components/AuditTrailCard';

type TripPlanModalMode = 'create' | 'edit' | 'delete';

export default function OrderDetailPage() {
    const params = useParams();
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const orderId = params.id as string;
    const [order, setOrder] = useState<Order | null>(null);
    const [items, setItems] = useState<OrderItem[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [doItems, setDoItems] = useState<DeliveryOrderItem[]>([]);
    const [notas, setNotas] = useState<FreightNota[]>([]);
    const [notaItems, setNotaItems] = useState<FreightNotaItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [showDOModal, setShowDOModal] = useState(false);
    const [selectedOrderTripPlanKey, setSelectedOrderTripPlanKey] = useState('');
    const [creatingDO, setCreatingDO] = useState(false);
    const [orderService, setOrderService] = useState<Service | null>(null);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    // DO form
    const [doDate, setDoDate] = useState(getBusinessDateValue());
    const [doCustomerDoNumber, setDoCustomerDoNumber] = useState('');
    const [doVehicle, setDoVehicle] = useState('');
    const [doVehicleOverrideReason, setDoVehicleOverrideReason] = useState('');
    const [doNotes, setDoNotes] = useState('');
    const [selectedPickupStopKeys, setSelectedPickupStopKeys] = useState<string[]>([]);
    const [shipperReferenceFormat, setShipperReferenceFormat] = useState('SJ');
    const [selectedShipments, setSelectedShipments] = useState<SelectedShipmentMap>({});
    const [directCargoGroups, setDirectCargoGroups] = useState<DirectCargoGroup[]>([createDefaultDirectCargoGroup()]);
    const [vehicles, setVehicles] = useState<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [tripRouteRates, setTripRouteRates] = useState<TripRouteRate[]>([]);
    const [busyVehicleIds, setBusyVehicleIds] = useState<string[]>([]);
    const [busyDriverIds, setBusyDriverIds] = useState<string[]>([]);
    const [showAddTripModal, setShowAddTripModal] = useState(false);
    const [showTripPlanActionModal, setShowTripPlanActionModal] = useState(false);
    const [savingTripPlan, setSavingTripPlan] = useState(false);
    const [tripDraft, setTripDraft] = useState<TripDraftForm>(createDefaultTripDraftForm());
    const [tripDraftPickupToAdd, setTripDraftPickupToAdd] = useState('');
    const [tripPlanModalMode, setTripPlanModalMode] = useState<TripPlanModalMode>('create');
    const [selectedTripPlanActionKey, setSelectedTripPlanActionKey] = useState('');
    const [editingTripPlanKey, setEditingTripPlanKey] = useState('');
    const [deletingTripPlanKey, setDeletingTripPlanKey] = useState('');
    const [showCancelTripModal, setShowCancelTripModal] = useState(false);
    const [cancelTripPlanKey, setCancelTripPlanKey] = useState('');
    const [cancelTripNote, setCancelTripNote] = useState('');
    const [cancelTripExpenseForm, setCancelTripExpenseForm] = useState<CancelTripExpenseFormState>(createDefaultCancelTripExpenseForm());
    const [cancelTripExpenseCategories, setCancelTripExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [loadingCancelExpenseRefs, setLoadingCancelExpenseRefs] = useState(false);
    const [cancellingTripPlan, setCancellingTripPlan] = useState(false);
    const [showCancelOrderModal, setShowCancelOrderModal] = useState(false);
    const [cancelOrderNote, setCancelOrderNote] = useState('');
    const [cancellingOrder, setCancellingOrder] = useState(false);
    const [showHoldModal, setShowHoldModal] = useState(false);
    const [holdingItem, setHoldingItem] = useState<OrderItem | null>(null);
    const [holdQtyKoli, setHoldQtyKoli] = useState('');
    const [holdWeightInputValue, setHoldWeightInputValue] = useState('');
    const [holdWeightInputUnit, setHoldWeightInputUnit] = useState<WeightInputUnit>('KG');
    const [holdVolumeInputValue, setHoldVolumeInputValue] = useState('');
    const [holdVolumeInputUnit, setHoldVolumeInputUnit] = useState<VolumeInputUnit>('M3');
    const [holdReason, setHoldReason] = useState('');
    const [holdLocation, setHoldLocation] = useState('');
    const [savingHold, setSavingHold] = useState(false);
    const loadedReferenceSignatureRef = useRef<string>('');
    const loadedVehicleOptionsRef = useRef(false);
    const loadedTripPlanSupportRef = useRef(false);
    const canCreateInvoice = user ? hasPermission(user, 'invoices', 'create') : false;
    const canViewFreightNotas = user ? hasPermission(user, 'invoices', 'view') : false;
    const canManageOrderTrips = user ? hasPermission(user, 'orders', 'update') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user, 'customers') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user, 'vehicles') : false;
    const hasOpenModal = showDOModal || showAddTripModal || showTripPlanActionModal || showCancelTripModal || showCancelOrderModal || showHoldModal;
    const currentPath = pathname || `/orders/${orderId}`;
    const withReturnTo = (href: string) => `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(currentPath)}`;

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

    const loadOrderReferenceData = useCallback(async (orderData: Order | null) => {
        const optionalFetchOptions = { onError: (message: string) => addToast('error', message), silentAccessDenied: true };
        const [customerData, serviceData, customerProductData, customerPickupData] = await Promise.all([
            orderData?.customerRef
                ? fetchOptionalAdminData<Pick<Customer, 'deliveryOrderPrefix'> | null>(`/api/data?entity=customers&id=${orderData.customerRef}`, 'Gagal memuat detail order', optionalFetchOptions)
                : Promise.resolve(null),
            orderData?.serviceRef
                ? fetchOptionalAdminData<Service | null>(`/api/data?entity=services&id=${orderData.serviceRef}`, 'Gagal memuat detail order', optionalFetchOptions)
                : Promise.resolve(null),
            orderData?.customerRef
                ? fetchOptionalAdminCollectionData<CustomerProduct>(
                    `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: orderData.customerRef, active: true }))}`,
                    'Gagal memuat detail order',
                    undefined,
                    optionalFetchOptions
                )
                : Promise.resolve([] as CustomerProduct[]),
            orderData?.customerRef
                ? fetchOptionalAdminCollectionData<CustomerPickupLocation>(
                    `/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef: orderData.customerRef, active: true }))}&sortField=label&sortDir=asc`,
                    'Gagal memuat master pickup customer',
                    undefined,
                    optionalFetchOptions
                )
                : Promise.resolve([] as CustomerPickupLocation[]),
        ]);

        setShipperReferenceFormat((customerData?.deliveryOrderPrefix || 'SJ').toUpperCase());
        setOrderService(serviceData || null);
        setCustomerProducts((customerProductData || []).filter(product => product.active !== false));
        setCustomerPickups((customerPickupData || []).filter(pickup => pickup.active !== false));
        loadedReferenceSignatureRef.current = `${orderData?.customerRef || ''}|${orderData?.serviceRef || ''}`;
    }, [addToast]);

    const refreshOrderCoreState = useCallback(async (fallbackMessage: string = 'Gagal memuat ulang detail order') => {
        try {
            const [orderData, itemData] = await Promise.all([
                fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, fallbackMessage),
                fetchAdminCollectionData<OrderItem[]>(
                    `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`,
                    fallbackMessage
                ),
            ]);
            setOrder(orderData);
            setItems(itemData || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : fallbackMessage);
        }
    }, [addToast, orderId]);

    const refreshOrderDeliveryState = useCallback(async (
        fallbackMessage: string = 'Gagal memuat ulang data pengiriman order',
        options: { includeNotas?: boolean } = {}
    ) => {
        try {
            const includeNotas = options.includeNotas === true;
            const [orderData, itemData, deliveryOrders, activeDeliveryOrders, activeOrders] = await Promise.all([
                fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, fallbackMessage),
                fetchAdminCollectionData<OrderItem[]>(
                    `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`,
                    fallbackMessage
                ),
                fetchAdminCollectionData<DeliveryOrder[]>(
                    `/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`,
                    fallbackMessage
                ),
                fetchAdminCollectionData<DeliveryOrder[]>(
                    `/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'PARTIAL_HOLD', 'DELIVERED'] }))}`,
                    fallbackMessage
                ),
                fetchAdminCollectionData<Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>>(
                    `/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ status: ['OPEN', 'PARTIAL'] }))}`,
                    fallbackMessage
                ),
            ]);
            const deliveryOrderIds = (deliveryOrders || []).map(item => item._id);
            const [deliveryOrderItems, notaItems] = await Promise.all([
                deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<DeliveryOrderItem[]>(
                        `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`,
                        fallbackMessage
                    )
                    : Promise.resolve([] as DeliveryOrderItem[]),
                includeNotas && deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<FreightNotaItem[]>(
                        `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: deliveryOrderIds }))}`,
                        fallbackMessage
                    )
                    : Promise.resolve([] as FreightNotaItem[]),
            ]);

            setOrder(orderData);
            setItems(itemData || []);
            setDos([...(deliveryOrders || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setDoItems(deliveryOrderItems || []);
            if (includeNotas) {
                setNotaItems(notaItems || []);
            }
            const {
                busyVehicleIds: nextBusyVehicleIds,
                busyDriverIds: nextBusyDriverIds,
            } = buildBusyAssignmentIds({
                deliveryOrders: activeDeliveryOrders || [],
                orders: activeOrders || [],
            });
            setBusyVehicleIds(nextBusyVehicleIds);
            setBusyDriverIds(nextBusyDriverIds);

            if (includeNotas) {
                const notaIds = [...new Set((notaItems || []).map(item => item.notaRef).filter(Boolean))];
                const orderNotas = notaIds.length > 0
                    ? await fetchAdminCollectionData<FreightNota[]>(
                        `/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: notaIds }))}`,
                        fallbackMessage
                    )
                    : [];
                setNotas([...(orderNotas || [])].sort((a, b) => `${b.issueDate || ''}-${b._id}`.localeCompare(`${a.issueDate || ''}-${a._id}`)));
            }

            const shouldReloadReferences = loadedReferenceSignatureRef.current !== `${orderData?.customerRef || ''}|${orderData?.serviceRef || ''}`;
            if (shouldReloadReferences) {
                await loadOrderReferenceData(orderData);
            }
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : fallbackMessage);
        }
    }, [addToast, loadOrderReferenceData, orderId]);

    const loadVehicleOptions = useCallback(async () => {
        const vehicleData = await fetchAdminCollectionData<Array<Pick<Vehicle, '_id' | 'unitCode' | 'plateNumber' | 'serviceRef' | 'serviceName' | 'capacityMin' | 'capacityMax' | 'capacityKg'>>>(
            `/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ status: ['ACTIVE', 'IN_SERVICE'] }))}`,
            'Gagal memuat detail order'
        );
        setVehicles(vehicleData || []);
        loadedVehicleOptionsRef.current = true;
    }, []);

    const loadTripPlanSupportOptions = useCallback(async () => {
        const [driverData, bankData, tripRateData] = await Promise.all([
            fetchAdminCollectionData<Driver[]>('/api/data?entity=drivers', 'Gagal memuat form trip'),
            fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat form trip'),
            fetchAdminCollectionData<TripRouteRate[]>(
                `/api/data?entity=trip-route-rates&filter=${encodeURIComponent(JSON.stringify({ active: true }))}`,
                'Gagal memuat form trip'
            ),
        ]);
        setDrivers((driverData || []).filter(driver => driver.active !== false));
        setBankAccounts((bankData || []).filter(account => account.active !== false));
        setTripRouteRates((tripRateData || []).filter(rate => rate.active !== false));
        loadedTripPlanSupportRef.current = true;
    }, []);

    const loadCancelTripExpenseReferences = useCallback(async () => {
        setLoadingCancelExpenseRefs(true);
        try {
            const [categoryRows, accountRows] = await Promise.all([
                fetchAdminCollectionData<ExpenseCategory[]>('/api/data?entity=expense-categories', 'Gagal memuat kategori pengeluaran'),
                fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat kas / bank pengeluaran'),
            ]);
            const activeCategories = (categoryRows || []).filter(category => category.active !== false);
            const activeAccounts = (accountRows || []).filter(account => account.active !== false);
            setCancelTripExpenseCategories(activeCategories);
            setBankAccounts(activeAccounts);
            return { categories: activeCategories, accounts: activeAccounts };
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat referensi biaya batal trip');
            return { categories: cancelTripExpenseCategories, accounts: bankAccounts };
        } finally {
            setLoadingCancelExpenseRefs(false);
        }
    }, [addToast, bankAccounts, cancelTripExpenseCategories]);

    const loadOrderDetail = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
        if (mode === 'initial') {
            setLoading(true);
            setLoadNotice(null);
        }
        try {
            const optionalFetchOptions = { onError: (message: string) => addToast('error', message), silentAccessDenied: true };
            const [orderData, itemData, deliveryOrders, activeDeliveryOrders, activeOrders] = await Promise.all([
                fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat detail order'),
                fetchAdminCollectionData<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat detail order'),
                canManageOrderTrips
                    ? fetchAdminCollectionData<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ status: ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'PARTIAL_HOLD', 'DELIVERED'] }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as DeliveryOrder[]),
                canManageOrderTrips
                    ? fetchAdminCollectionData<Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>>(`/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ status: ['OPEN', 'PARTIAL'] }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as Array<Pick<Order, '_id' | 'masterResi' | 'status' | 'tripPlans'>>),
            ]);
            const deliveryOrderIds = (deliveryOrders || []).map(item => item._id);
            const [deliveryOrderItems, notaItems] = await Promise.all([
                deliveryOrderIds.length > 0
                    ? fetchAdminCollectionData<DeliveryOrderItem[]>(`/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderIds }))}`, 'Gagal memuat detail order')
                    : Promise.resolve([] as DeliveryOrderItem[]),
                canViewFreightNotas && deliveryOrderIds.length > 0
                    ? fetchOptionalAdminCollectionData<FreightNotaItem>(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: deliveryOrderIds }))}`, 'Gagal memuat detail invoice order', undefined, optionalFetchOptions)
                    : Promise.resolve([] as FreightNotaItem[]),
            ]);
            const notaIds = [...new Set((notaItems || []).map(item => item.notaRef).filter(Boolean))];
            const orderNotas = canViewFreightNotas && notaIds.length > 0
                ? await fetchOptionalAdminCollectionData<FreightNota>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: notaIds }))}`, 'Gagal memuat detail invoice order', undefined, optionalFetchOptions)
                : [];

            setOrder(orderData);
            setItems(itemData || []);
            setDos([...(deliveryOrders || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setDoItems(deliveryOrderItems);
            setNotaItems(notaItems || []);
            setNotas([...(orderNotas || [])].sort((a, b) => `${b.issueDate || ''}-${b._id}`.localeCompare(`${a.issueDate || ''}-${a._id}`)));
            const {
                busyVehicleIds: nextBusyVehicleIds,
                busyDriverIds: nextBusyDriverIds,
            } = buildBusyAssignmentIds({
                deliveryOrders: activeDeliveryOrders || [],
                orders: activeOrders || [],
            });
            setBusyVehicleIds(nextBusyVehicleIds);
            setBusyDriverIds(nextBusyDriverIds);

            if (canManageOrderTrips && (mode === 'initial' || !loadedVehicleOptionsRef.current)) {
                await loadVehicleOptions();
            }
            const shouldReloadReferences =
                mode === 'initial' ||
                loadedReferenceSignatureRef.current !== `${orderData?.customerRef || ''}|${orderData?.serviceRef || ''}`;
            if (shouldReloadReferences) {
                await loadOrderReferenceData(orderData);
            }
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail order');
            if (mode === 'initial') {
                setLoadNotice(buildAdminLoadNotice(
                    message,
                    'Order',
                    'Halaman ini hanya bisa dilihat oleh role yang punya akses Order / Resi.'
                ));
            }
            addToast('error', message);
        } finally {
            if (mode === 'initial') {
                setLoading(false);
            }
        }
    }, [addToast, canManageOrderTrips, canViewFreightNotas, loadOrderReferenceData, loadVehicleOptions, orderId]);

    useEffect(() => {
        void loadOrderDetail('initial');
    }, [loadOrderDetail]);

    const sortedVehicles = sortOrderDetailVehicles(vehicles, order);
    const availableVehicles = getAvailableVehicles(sortedVehicles, busyVehicleIds);
    const activeIssueBankAccounts = bankAccounts.filter(account => account.active !== false);
    const serviceCapacityRangeMap = buildServiceCapacityRangeMap(
        orderService
            ? [orderService]
            : order?.serviceRef
                ? [{ _id: order.serviceRef, _type: 'service', code: '', name: order.serviceName || '', description: '', active: true }]
                : []
    );
    const requestedServiceCapacityLabel = order?.serviceRef
        ? serviceCapacityRangeMap[order.serviceRef] || 'Kapasitas belum diisi'
        : 'Kategori order belum diisi';
    const internalDoPreviewPeriod = /^\d{4}-\d{2}-\d{2}$/.test(doDate)
        ? `${doDate.slice(8, 10)}${doDate.slice(5, 7)}${doDate.slice(0, 4)}`
        : 'ddmmyyyy';
    const normalizedShipperReferenceFormat = shipperReferenceFormat.trim().toUpperCase() || 'SJ';
    const shipperReferenceExample = `${normalizedShipperReferenceFormat}/27032026/001`;

    const {
        activeAssignmentByItemId,
        doItemByOrderItemId,
        itemProgressById,
        deliveredActualCargoByItemId,
        activePlannedCargoByItemId,
        availableItems,
        totalOrderCargo,
        totalHeldCargo,
        totalPendingCargo,
        totalDeliveredActualCargo,
        totalActivePlannedCargo,
        doPlannedCargoById,
        doActualCargoById,
        progress,
    } = buildOrderDetailMetrics(items, dos, doItems);
    const isReadyForFreightNota = (deliveryOrder: DeliveryOrder) =>
        deliveryOrder.status === 'DELIVERED' ||
        (deliveryOrder.status !== 'CANCELLED' && hasDeliveryOrderBillableCargo(deliveryOrder));
    const activeNotaItems = notaItems.filter(item => item.status !== 'VOID');
    const notaById = new Map(notas.map(nota => [nota._id, nota]));
    const doById = new Map(dos.map(deliveryOrder => [deliveryOrder._id, deliveryOrder]));
    const usedNotaCoverageKeySet = new Set(activeNotaItems.flatMap(item =>
        getFreightNotaItemCoverageKeys(item, item.doRef ? doById.get(item.doRef) : null)
    ));
    const getAvailableFreightNotaRowsForDeliveryOrder = (deliveryOrder: DeliveryOrder) =>
        buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: order ? [order] : [],
            deliveryOrderItems: doItems,
        }).filter(row => {
            const rowCoverageKeys = getInvoiceRowAvailabilityCoverageKeys(row, deliveryOrder);
            return !rowCoverageKeys.some(key => usedNotaCoverageKeySet.has(key));
        });
    const billableReadyDoCount = dos.filter(deliveryOrder =>
        isReadyForFreightNota(deliveryOrder) &&
        getAvailableFreightNotaRowsForDeliveryOrder(deliveryOrder).length > 0
    ).length;
    const canStartFreightNota = canCreateInvoice && billableReadyDoCount > 0;
    const createFreightNotaHref = withReturnTo(`/invoices/new?orderRef=${encodeURIComponent(orderId)}`);
    const getActiveInvoiceLinksForDeliveryOrder = (deliveryOrderId: string) => {
        const notaRefs = [...new Set(
            activeNotaItems
                .filter(item => item.doRef === deliveryOrderId && item.notaRef)
                .map(item => item.notaRef)
        )];
        return notaRefs
            .map(notaRef => notaById.get(notaRef))
            .filter((nota): nota is FreightNota => Boolean(nota));
    };

    const createDefaultShipmentSelection = useCallback(
        (item: OrderItem): SelectedShipmentMap[string] => buildDefaultShipmentSelection(item, itemProgressById[item._id]),
        [itemProgressById]
    );

    const selectAllAvailableItems = () => {
        const nextSelections: SelectedShipmentMap = {};
        for (const item of availableItems) {
            nextSelections[item._id] = createDefaultShipmentSelection(item);
        }
        setSelectedShipments(nextSelections);
    };

    const updateDirectCargoGroup = <K extends keyof Pick<DirectCargoGroup, 'pickupStopKey' | 'shipperReferenceNumber'>>(
        groupId: string,
        field: K,
        value: DirectCargoGroup[K]
    ) => {
        setDirectCargoGroups(previous =>
            previous.map(group => (
                group.id === groupId
                    ? { ...group, [field]: value }
                    : group
            ))
        );
    };

    const updateDirectCargoGroupItem = <K extends keyof DirectCargoGroupItem>(
        groupId: string,
        itemIndex: number,
        field: K,
        value: DirectCargoGroupItem[K]
    ) => {
        setDirectCargoGroups(previous =>
            previous.map(group => (
                group.id === groupId
                    ? {
                        ...group,
                        items: group.items.map((item, index) => (
                            index === itemIndex
                                ? (
                                    field === 'qtyKoli'
                                        ? toDirectCargoGroupItem(applyOrderItemAutoWeightFromQty({
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
            ))
        );
    };

    const addDirectCargoGroup = () => {
        const defaultPickupStopKey = selectedTripPickupStops[0]?._key || selectedPickupStopKeys[0] || '';
        setDirectCargoGroups(previous => [...previous, createDefaultDirectCargoGroup(defaultPickupStopKey)]);
    };

    const removeDirectCargoGroup = (groupId: string) => {
        setDirectCargoGroups(previous => {
            const next = previous.filter(group => group.id !== groupId);
            return next.length > 0 ? next : [createDefaultDirectCargoGroup(selectedTripPickupStops[0]?._key || selectedPickupStopKeys[0] || '')];
        });
    };

    const addDirectCargoGroupItem = (groupId: string) => {
        setDirectCargoGroups(previous =>
            previous.map(group => (
                group.id === groupId
                    ? { ...group, items: [...group.items, createDefaultDirectCargoGroupItem()] }
                    : group
            ))
        );
    };

    const removeDirectCargoGroupItem = (groupId: string, itemIndex: number) => {
        setDirectCargoGroups(previous =>
            previous.map(group => {
                if (group.id !== groupId) {
                    return group;
                }
                const nextItems = group.items.filter((_, index) => index !== itemIndex);
                return {
                    ...group,
                    items: nextItems.length > 0 ? nextItems : [createDefaultDirectCargoGroupItem()],
                };
            })
        );
    };

    const applyDirectCargoProductSelection = (groupId: string, itemIndex: number, nextProductRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === nextProductRef);
        setDirectCargoGroups(previous =>
            previous.map(group => (
                group.id === groupId
                    ? {
                        ...group,
                        items: group.items.map((item, index) => (
                            index === itemIndex
                                ? applyCustomerProductToOrderItem({
                                    ...item,
                                    pickupStopKey: group.pickupStopKey,
                                    shipperReferenceNumber: group.shipperReferenceNumber,
                                }, selectedProduct)
                                : { ...item, pickupStopKey: group.pickupStopKey, shipperReferenceNumber: group.shipperReferenceNumber }
                        )).map(item => toDirectCargoGroupItem(item)),
                    }
                    : group
            ))
        );
    };

    const updateTripDraftField = <K extends keyof TripDraftForm>(field: K, value: TripDraftForm[K]) => {
        setTripDraft(current => ({ ...current, [field]: value }));
    };

    const toggleTripDraftPickupStop = (pickupStopKey: string, checked: boolean) => {
        setTripDraft(current => ({
            ...current,
            pickupStopKeys: checked
                ? Array.from(new Set([...current.pickupStopKeys, pickupStopKey]))
                : current.pickupStopKeys.filter(value => value !== pickupStopKey),
        }));
    };

    const addTripDraftPickupStop = () => {
        if (!tripDraftPickupToAdd) {
            addToast('error', 'Pilih pickup yang ingin ditambahkan ke rencana trip.');
            return;
        }
        setTripDraft(current => ({
            ...current,
            pickupStopKeys: Array.from(new Set([...current.pickupStopKeys, tripDraftPickupToAdd])),
        }));
        setTripDraftPickupToAdd('');
    };

    const updateTripDraftRouteSelection = (nextOriginArea: string, nextDestinationArea: string) => {
        const matchedRate = findMatchingTripRouteRate(tripRouteRates, {
            originArea: nextOriginArea,
            destinationArea: nextDestinationArea,
            serviceRef: order?.serviceRef,
        });
        setTripDraft(current => ({
            ...current,
            tripOriginArea: nextOriginArea,
            tripDestinationArea: nextDestinationArea,
            tripRouteRateRef: matchedRate?._id || '',
            tripFee: matchedRate?.rate || current.tripFee,
        }));
    };

    const populateTripDraftFromTripPlan = (tripPlan: NonNullable<Order['tripPlans']>[number]) => {
        setTripDraft({
            id: tripPlan._key || crypto.randomUUID(),
            pickupStopKeys: Array.isArray(tripPlan.pickupStopKeys) ? tripPlan.pickupStopKeys.filter(Boolean) : [],
            vehicleRef: tripPlan.vehicleRef || '',
            driverRef: tripPlan.driverRef || '',
            tripOriginArea: tripPlan.tripOriginArea || '',
            tripDestinationArea: tripPlan.tripDestinationArea || '',
            tripRouteRateRef: tripPlan.tripRouteRateRef || '',
            tripFee: tripPlan.taripBorongan || 0,
            vehicleOverrideReason: tripPlan.vehicleCategoryOverrideReason || '',
            issueBankRef: tripPlan.issueBankRef || '',
            cashGiven: tripPlan.cashGiven || 0,
            notes: tripPlan.notes || '',
            date: tripPlan.date || getBusinessDateValue(),
        });
        setTripDraftPickupToAdd('');
    };

    const resetTripPlanModalState = () => {
        setTripPlanModalMode('create');
        setSelectedTripPlanActionKey('');
        setEditingTripPlanKey('');
        setTripDraft(createDefaultTripDraftForm());
        setTripDraftPickupToAdd('');
    };

    const closeTripPlanModal = () => {
        setShowAddTripModal(false);
        resetTripPlanModalState();
    };

    const closeTripPlanActionModal = () => {
        setShowTripPlanActionModal(false);
        setTripPlanModalMode('create');
        setSelectedTripPlanActionKey('');
    };

    const openAddTripModal = () => {
        resetTripPlanModalState();
        setShowAddTripModal(true);
        if (!loadedTripPlanSupportRef.current) {
            void loadTripPlanSupportOptions().catch(error => {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat form trip');
            });
        }
    };

    const openTripPlanActionModal = (nextMode: Exclude<TripPlanModalMode, 'create'>) => {
        setTripPlanModalMode(nextMode);
        setSelectedTripPlanActionKey('');
        setEditingTripPlanKey('');
        setTripDraft(createDefaultTripDraftForm());
        setTripDraftPickupToAdd('');
        if (nextMode === 'edit') {
            setShowAddTripModal(true);
            if (!loadedTripPlanSupportRef.current) {
                void loadTripPlanSupportOptions().catch(error => {
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat form trip');
                });
            }
            return;
        }
        setShowTripPlanActionModal(true);
    };

    const selectTripPlanForModalAction = (tripPlanKey: string) => {
        setSelectedTripPlanActionKey(tripPlanKey);
        if (tripPlanModalMode !== 'edit' || !tripPlanKey) {
            if (tripPlanModalMode === 'edit') {
                setEditingTripPlanKey('');
                setTripDraft(createDefaultTripDraftForm());
                setTripDraftPickupToAdd('');
            }
            return;
        }
        const tripPlan = editableOrderTripPlans.find(plan => plan._key === tripPlanKey);
        if (!tripPlan) {
            return;
        }
        setEditingTripPlanKey(tripPlan._key || '');
        populateTripDraftFromTripPlan(tripPlan);
    };

    const continueSelectedTripPlanAction = () => {
        if (!selectedTripPlanForAction) {
            addToast('error', 'Pilih rencana trip terlebih dahulu.');
            return;
        }
        if (tripPlanModalMode === 'edit') {
            setEditingTripPlanKey(selectedTripPlanForAction._key || '');
            populateTripDraftFromTripPlan(selectedTripPlanForAction);
            setShowTripPlanActionModal(false);
            setShowAddTripModal(true);
            if (!loadedTripPlanSupportRef.current) {
                void loadTripPlanSupportOptions().catch(error => {
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat form trip');
                });
            }
            return;
        }
        if (tripPlanModalMode === 'delete') {
            void deleteTripPlan(selectedTripPlanForAction);
        }
    };

    const deleteTripPlan = async (tripPlan: NonNullable<Order['tripPlans']>[number]) => {
        if (!order?._id || !tripPlan._key) return;
        if (tripPlan.linkedDeliveryOrderRef) {
            addToast('error', 'Rencana trip yang sudah punya SJ tidak bisa dihapus dari sini.');
            return;
        }

        setDeletingTripPlanKey(tripPlan._key);
        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: 'delete-trip-plan',
                    data: {
                        id: order._id,
                        tripPlanKey: tripPlan._key,
                    },
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                addToast('error', result.error || 'Gagal menghapus rencana trip');
                return;
            }
            await refreshOrderDeliveryState('Gagal memuat ulang rencana trip order');
            addToast('success', `Rencana Trip ${tripPlan.sequence} dihapus`);
            closeTripPlanActionModal();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menghapus rencana trip');
        } finally {
            setDeletingTripPlanKey('');
        }
    };

    const closeCancelTripModal = () => {
        if (cancellingTripPlan) return;
        setShowCancelTripModal(false);
        setCancelTripPlanKey('');
        setCancelTripNote('');
        setCancelTripExpenseForm(createDefaultCancelTripExpenseForm());
    };

    const openCancelTripModal = async (tripPlan: NonNullable<Order['tripPlans']>[number]) => {
        if (!tripPlan._key || !order?._id) return;
        const linkedDeliveryOrder = tripPlan.linkedDeliveryOrderRef
            ? deliveryOrderById.get(tripPlan.linkedDeliveryOrderRef)
            : undefined;
        if (!canCancelTripPlanFromOrder(tripPlan, linkedDeliveryOrder)) {
            addToast('error', 'Trip ini sudah punya progres final atau tidak bisa dibatalkan dari halaman order.');
            return;
        }
        setCancelTripPlanKey(tripPlan._key);
        setCancelTripNote('');
        const { categories, accounts } = await loadCancelTripExpenseReferences();
        setCancelTripExpenseForm({
            ...createDefaultCancelTripExpenseForm(),
            categoryRef: getDefaultCancelExpenseCategoryRef(categories),
            bankAccountRef: accounts[0]?._id || '',
            description: `Biaya pembatalan Trip ${tripPlan.sequence || ''}${order.masterResi ? ` ${order.masterResi}` : ''}`.trim(),
        });
        setShowCancelTripModal(true);
    };

    const cancelTripFromOrder = async () => {
        if (!order?._id || !selectedCancelTripPlan?._key) return;
        const linkedDeliveryOrder = selectedCancelDeliveryOrder;
        if (!canCancelTripPlanFromOrder(selectedCancelTripPlan, linkedDeliveryOrder)) {
            addToast('error', 'Trip ini sudah berubah atau sudah punya progres final. Refresh lalu cek ulang.');
            return;
        }
        const shouldSubmitCancelExpense = cancelTripExpenseForm.amount > 0;
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
            `Biaya pembatalan Trip ${selectedCancelTripPlan.sequence || ''}${order.masterResi ? ` ${order.masterResi}` : ''}`.trim();

        setCancellingTripPlan(true);
        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: linkedDeliveryOrder ? 'delivery-orders' : 'orders',
                    action: linkedDeliveryOrder ? 'cancel-trip' : 'cancel-trip-plan',
                    data: {
                        id: linkedDeliveryOrder?._id || order._id,
                        tripPlanKey: linkedDeliveryOrder ? undefined : selectedCancelTripPlan._key,
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
            const result = await response.json();
            if (!response.ok) {
                addToast('error', result.error || 'Gagal membatalkan trip');
                return;
            }
            const cancelExpenseAmount = Number(result.data?.cancelExpenseAmount || 0);
            const cancelledSuratJalanCount = Number(result.data?.cancelledSuratJalanCount || 0);
            setShowCancelTripModal(false);
            setCancelTripPlanKey('');
            setCancelTripNote('');
            setCancelTripExpenseForm(createDefaultCancelTripExpenseForm());
            await refreshOrderDeliveryState('Gagal memuat ulang order setelah trip dibatalkan');
            addToast(
                'success',
                `Trip ${selectedCancelTripPlan.sequence} dibatalkan${cancelledSuratJalanCount > 0 ? `, ${cancelledSuratJalanCount} SJ ikut batal` : ''}${cancelExpenseAmount > 0 ? `, biaya ${formatCurrency(cancelExpenseAmount)} masuk Pengeluaran` : ''}`
            );
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal membatalkan trip');
        } finally {
            setCancellingTripPlan(false);
        }
    };

    const cancelOrder = async () => {
        if (!order?._id || cancellingOrder) return;
        setCancellingOrder(true);
        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: 'cancel-order',
                    data: {
                        id: order._id,
                        note: cancelOrderNote,
                    },
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                addToast('error', result.error || 'Gagal membatalkan order/resi');
                return;
            }
            setShowCancelOrderModal(false);
            setCancelOrderNote('');
            await refreshOrderCoreState('Gagal memuat ulang order setelah dibatalkan');
            addToast('success', 'Order/resi berhasil dibatalkan');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal membatalkan order/resi');
        } finally {
            setCancellingOrder(false);
        }
    };

    const openCreateDOModal = (tripPlanKey?: string) => {
        const tripPlan = orderTripPlans.find(plan => plan._key === tripPlanKey) || null;
        const defaultPickupStopKey = tripPlan?.pickupStopKeys[0] || resolvedOrderPickupStops[0]?._key || '';
        setSelectedShipments({});
        setDirectCargoGroups([createDefaultDirectCargoGroup(defaultPickupStopKey)]);
        setSelectedPickupStopKeys(
            tripPlan?.pickupStopKeys && tripPlan.pickupStopKeys.length > 0
                ? tripPlan.pickupStopKeys
                : resolvedOrderPickupStops.map(stop => stop._key)
        );
        setDoDate(tripPlan?.date || getBusinessDateValue());
        setDoVehicle(tripPlan?.vehicleRef || '');
        setDoVehicleOverrideReason(tripPlan?.vehicleCategoryOverrideReason || '');
        setDoNotes(tripPlan?.notes || '');
        setSelectedOrderTripPlanKey(tripPlan?._key || '');
        setDoCustomerDoNumber('');
        if (!isHeaderOnlyOrder && !doCustomerDoNumber.trim() && normalizedShipperReferenceFormat !== 'SJ') {
            setDoCustomerDoNumber(normalizedShipperReferenceFormat);
        }
        setShowDOModal(true);
    };

    const clearSelectedShipments = () => {
        setSelectedShipments({});
    };

    const {
        totals: selectedShipmentTotals,
        itemCount: selectedShipmentItemCount,
        holdCount: selectedHoldCount,
    } = summarizeSelectedShipments(availableItems, selectedShipments, itemProgressById);
    const isHeaderOnlyOrder = resolveOrderCargoEntryMode(order, items) === 'DELIVERY_ORDER';
    const orderPickupStops = (order?.pickupStops || [])
        .map((stop, index) => {
            const pickupAddress = stop.pickupAddress?.trim();
            if (!pickupAddress) {
                return null;
            }
            return {
                _key: stop._key || `pickup-stop-${index + 1}`,
                sequence: stop.sequence || index + 1,
                customerPickupRef: stop.customerPickupRef || '',
                pickupLabel: stop.pickupLabel || '',
                pickupAddress,
                notes: stop.notes || '',
            };
        })
        .filter((stop): stop is { _key: string; sequence: number; customerPickupRef: string; pickupLabel: string; pickupAddress: string; notes: string } => Boolean(stop))
        .sort((left, right) => left.sequence - right.sequence);
    const resolvedOrderPickupStops =
        orderPickupStops.length > 0
            ? orderPickupStops
            : order?.pickupAddress
                ? [{
                    _key: 'pickup-stop-1',
                    sequence: 1,
                    customerPickupRef: '',
                    pickupLabel: '',
                    pickupAddress: order.pickupAddress,
                    notes: '',
                }]
                : [];
    const existingPickupMasterRefs = new Set(resolvedOrderPickupStops.map(stop => stop.customerPickupRef).filter(Boolean));
    const existingPickupAddresses = new Set(resolvedOrderPickupStops.map(stop => stop.pickupAddress.trim().toLowerCase()).filter(Boolean));
    const extraPickupStopOptions = customerPickups
        .filter(pickup => !existingPickupMasterRefs.has(pickup._id))
        .filter(pickup => !existingPickupAddresses.has((pickup.pickupAddress || '').trim().toLowerCase()))
        .map((pickup, index) => ({
            _key: `customer-pickup:${pickup._id}`,
            sequence: resolvedOrderPickupStops.length + index + 1,
            customerPickupRef: pickup._id,
            pickupLabel: pickup.label || '',
            pickupAddress: pickup.pickupAddress || '',
            notes: pickup.notes || '',
            fromMaster: true,
        }))
        .filter(stop => stop.pickupAddress.trim());
    const selectablePickupStops = [...resolvedOrderPickupStops, ...extraPickupStopOptions];
    const orderTripPlans = ((order?.tripPlans || []) as NonNullable<Order['tripPlans']>)
        .map((plan, index) => ({
            ...plan,
            _key: plan._key || `order-trip-${index + 1}`,
            sequence: plan.sequence || index + 1,
            pickupStopKeys: Array.isArray(plan.pickupStopKeys) ? plan.pickupStopKeys.filter(Boolean) : [],
        }))
        .filter(plan => plan.vehicleRef && plan.driverRef && plan.issueBankRef && Number(plan.cashGiven || 0) > 0)
        .sort((left, right) => left.sequence - right.sequence);
    const editableOrderTripPlans = orderTripPlans.filter(plan => !plan.linkedDeliveryOrderRef);
    const selectedTripPlanForAction = editableOrderTripPlans.find(plan => plan._key === selectedTripPlanActionKey) || null;
    const reservedPlannedVehicleIds = orderTripPlans
        .filter(plan => !plan.linkedDeliveryOrderRef)
        .map(plan => plan.vehicleRef)
        .filter((value): value is string => Boolean(value));
    const reservedPlannedDriverIds = orderTripPlans
        .filter(plan => !plan.linkedDeliveryOrderRef)
        .map(plan => plan.driverRef)
        .filter((value): value is string => Boolean(value));
    const availableTripDraftVehicles = sortedVehicles.filter(
        vehicle => (!busyVehicleIds.includes(vehicle._id) && !reservedPlannedVehicleIds.includes(vehicle._id)) || vehicle._id === tripDraft.vehicleRef
    );
    const availableTripDraftDrivers = drivers.filter(
        driver => (
            (!busyDriverIds.includes(driver._id) && !reservedPlannedDriverIds.includes(driver._id)) ||
            driver._id === tripDraft.driverRef
        ) && driver.active !== false
    );
    const selectedTripDraftVehicle = vehicles.find(vehicle => vehicle._id === tripDraft.vehicleRef) || null;
    const requiresTripDraftOverrideReason = Boolean(
        order?.serviceRef &&
        selectedTripDraftVehicle &&
        (!selectedTripDraftVehicle.serviceRef || selectedTripDraftVehicle.serviceRef !== order.serviceRef)
    );
    const tripDraftOriginAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'originArea', {
        serviceRef: order?.serviceRef,
    });
    const tripDraftDestinationAreaOptions = buildTripRateAreaOptions(tripRouteRates, 'destinationArea', {
        originArea: tripDraft.tripOriginArea,
        serviceRef: order?.serviceRef,
    });
    const matchedTripDraftRate = findMatchingTripRouteRate(tripRouteRates, {
        originArea: tripDraft.tripOriginArea,
        destinationArea: tripDraft.tripDestinationArea,
        serviceRef: order?.serviceRef,
    });
    const isTripDraftFeeLockedToMaster = Boolean(matchedTripDraftRate);
    const selectedOrderTripPlan = orderTripPlans.find(plan => plan._key === selectedOrderTripPlanKey) || null;
    const effectiveDoVehicleRef = selectedOrderTripPlan?.vehicleRef || doVehicle;
    const selectedVehicleData = vehicles.find(vehicle => vehicle._id === effectiveDoVehicleRef);
    const selectedVehicleCapacityLabel = selectedVehicleData
        ? formatUnitCapacityLabel(selectedVehicleData)
        : 'Belum dipilih';
    const requiresVehicleOverrideReason = !selectedOrderTripPlan && shouldRequireVehicleOverrideReason(order, selectedVehicleData);
    const deliveryOrderById = new Map(dos.map(deliveryOrder => [deliveryOrder._id, deliveryOrder]));
    const hasPlannedTrips = orderTripPlans.length > 0;
    const linkedTripDoIds = new Set(
        orderTripPlans
            .map(plan => plan.linkedDeliveryOrderRef)
            .filter((value): value is string => Boolean(value))
    );
    const unplannedDos = dos.filter(deliveryOrder => !linkedTripDoIds.has(deliveryOrder._id));
    const nonCancelledDos = dos.filter(deliveryOrder => deliveryOrder.status !== 'CANCELLED');
    const hasDeliveredOrderProgress = items.some(item =>
        (item.deliveredQtyKoli || 0) > 0 ||
        (item.deliveredWeight || 0) > 0 ||
        (item.deliveredVolume || 0) > 0 ||
        item.status === 'DELIVERED' ||
        item.status === 'PARTIAL'
    );
    const orderIsCancelled = order?.status === 'CANCELLED';
    const canCancelOrder =
        canManageOrderTrips &&
        !orderIsCancelled &&
        nonCancelledDos.length === 0 &&
        notas.length === 0 &&
        !hasDeliveredOrderProgress;
    const selectedCancelTripPlan = orderTripPlans.find(plan => plan._key === cancelTripPlanKey) || null;
    const selectedCancelDeliveryOrder =
        selectedCancelTripPlan?.linkedDeliveryOrderRef
            ? deliveryOrderById.get(selectedCancelTripPlan.linkedDeliveryOrderRef)
            : undefined;
    const cancelTripOperationalCategories = cancelTripExpenseCategories.filter(isOperationalCancelExpenseCategory);
    const cancelTripBankAccounts = bankAccounts.filter(account => account.active !== false);
    const canCancelTripPlanFromOrder = (
        tripPlan: NonNullable<Order['tripPlans']>[number],
        linkedDeliveryOrder?: DeliveryOrder
    ) => {
        if (!canManageOrderTrips) {
            return false;
        }
        if (!tripPlan.linkedDeliveryOrderRef) {
            return true;
        }
        if (!linkedDeliveryOrder) {
            return false;
        }
        const hasFinalizedCargo =
            linkedDeliveryOrder.status === 'DELIVERED' ||
            linkedDeliveryOrder.status === 'PARTIAL_HOLD' ||
            Boolean(linkedDeliveryOrder.cargoFinalizedAt) ||
            (Array.isArray(linkedDeliveryOrder.actualDropPoints) && linkedDeliveryOrder.actualDropPoints.length > 0);
        return (
            !linkedDeliveryOrder.pendingDriverStatus &&
            !hasFinalizedCargo &&
            linkedDeliveryOrder.status !== 'CANCELLED'
        );
    };
    useEffect(() => {
        if (!requiresVehicleOverrideReason && doVehicleOverrideReason) {
            setDoVehicleOverrideReason('');
        }
    }, [requiresVehicleOverrideReason, doVehicleOverrideReason]);

    useEffect(() => {
        if (!requiresTripDraftOverrideReason && tripDraft.vehicleOverrideReason) {
            setTripDraft(current => ({ ...current, vehicleOverrideReason: '' }));
        }
    }, [requiresTripDraftOverrideReason, tripDraft.vehicleOverrideReason]);

    useEffect(() => {
        if (!selectedOrderTripPlan && doVehicle && busyVehicleIds.includes(doVehicle)) {
            setDoVehicle('');
            setDoVehicleOverrideReason('');
        }
    }, [busyVehicleIds, doVehicle, selectedOrderTripPlan]);
    const usesExistingItemsForDeliveryOrder = !isHeaderOnlyOrder;
    const canCreateDeliveryOrder =
        !orderIsCancelled &&
        (
            isHeaderOnlyOrder ||
            (!usesExistingItemsForDeliveryOrder || (availableItems.length > 0 && nonCancelledDos.length === 0))
        );
    const primaryDeliveryOrderButtonLabel =
        isHeaderOnlyOrder && nonCancelledDos.length > 0
            ? 'Tambah Surat Jalan'
            : 'Buat Surat Jalan';
    const canShowPrimaryDeliveryOrderButton =
        !orderIsCancelled &&
        !hasPlannedTrips &&
        (isHeaderOnlyOrder || nonCancelledDos.length === 0);
    const flattenedDirectCargoItems = flattenDirectCargoGroups(directCargoGroups);
    const draftDirectCargoItems = getDraftOrderItems(flattenedDirectCargoItems);
    const draftDirectCargoGroups = directCargoGroups
        .map(group => ({
            ...group,
            draftItems: getDirectCargoGroupDraftItems(group),
        }))
        .filter(group => group.shipperReferenceNumber.trim() || group.draftItems.length > 0);
    const directCargoSummary = summarizeDraftOrderCargo(flattenedDirectCargoItems);
    const selectedTripPickupStops = selectablePickupStops.filter(stop => selectedPickupStopKeys.includes(stop._key));
    const selectedTripDraftPickupStops = selectablePickupStops.filter(stop => tripDraft.pickupStopKeys.includes(stop._key));
    const availableTripDraftPickupStops = selectablePickupStops.filter(stop => !tripDraft.pickupStopKeys.includes(stop._key));
    const headerOnlyManifestByDo = isHeaderOnlyOrder
        ? nonCancelledDos.map(deliveryOrder => {
            const pickupMap = new Map(
                (deliveryOrder.pickupStops || []).map((pickupStop, index) => [
                    pickupStop._key || pickupStop.orderPickupStopKey || `pickup-stop-${index + 1}`,
                    pickupStop,
                ])
            );
            const manifestMap = new Map<string, {
                referenceNumber: string;
                pickupLabel?: string;
                pickupAddress?: string;
                itemCount: number;
                cargo: ReturnType<typeof createCargoAggregate>;
                items: DeliveryOrderItem[];
            }>();
            const ensureManifestEntry = (referenceNumber: string, pickupStopKey?: string, pickupAddress?: string) => {
                const matchedPickup = pickupStopKey ? pickupMap.get(pickupStopKey) : undefined;
                const manifestKey = `${referenceNumber}::${pickupStopKey || pickupAddress || ''}`;
                if (!manifestMap.has(manifestKey)) {
                    manifestMap.set(manifestKey, {
                        referenceNumber,
                        pickupLabel: matchedPickup ? `Pickup ${matchedPickup.sequence}${matchedPickup.pickupLabel ? ` - ${matchedPickup.pickupLabel}` : ''}` : undefined,
                        pickupAddress: matchedPickup?.pickupAddress || pickupAddress,
                        itemCount: 0,
                        cargo: createCargoAggregate(),
                        items: [],
                    });
                }
                return manifestMap.get(manifestKey)!;
            };

            (deliveryOrder.shipperReferences || []).forEach(reference => {
                ensureManifestEntry(reference.referenceNumber, reference.pickupStopKey, reference.pickupAddress);
            });

            doItems
                .filter(item => item.deliveryOrderRef === deliveryOrder._id)
                .forEach(item => {
                    const referenceNumber = item.shipperReferenceNumber?.trim() || deliveryOrder.customerDoNumber || 'TANPA-SJ';
                    const manifestEntry = ensureManifestEntry(referenceNumber, item.pickupStopKey, item.pickupAddress);
                    manifestEntry.itemCount += 1;
                    manifestEntry.items.push(item);
                    manifestEntry.cargo = addCargoAggregate(
                        manifestEntry.cargo,
                        deliveryOrder.status === 'DELIVERED'
                            ? {
                                qtyKoli: item.actualQtyKoli ?? item.orderItemQtyKoli,
                                weightKg: item.actualWeightKg ?? item.orderItemWeight,
                                volumeM3: item.actualVolumeM3 ?? item.orderItemVolumeM3,
                            }
                            : {
                                qtyKoli: item.orderItemQtyKoli,
                                weightKg: item.orderItemWeight,
                                volumeM3: item.orderItemVolumeM3,
                            }
                    );
                });

            return {
                deliveryOrder,
                shipperManifests: Array.from(manifestMap.values()),
            };
        }).filter(entry => entry.shipperManifests.length > 0)
        : [];
    const persistedShipperManifestCount = headerOnlyManifestByDo.reduce(
        (sum, entry) => sum + entry.shipperManifests.length,
        0
    );
    const displayedDoList = hasPlannedTrips ? unplannedDos : dos;
    const headerOnlyDeliveredMatchesTotal =
        isHeaderOnlyOrder &&
        totalDeliveredActualCargo.qtyKoli === totalOrderCargo.qtyKoli &&
        totalDeliveredActualCargo.weightKg === totalOrderCargo.weightKg &&
        totalDeliveredActualCargo.volumeM3 === totalOrderCargo.volumeM3;
    const progressSummaryLabel = hasCargoAggregate(totalOrderCargo)
        ? headerOnlyDeliveredMatchesTotal
            ? `${formatCargoSummary({
                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                weightKg: totalDeliveredActualCargo.weightKg,
                volumeM3: totalDeliveredActualCargo.volumeM3,
            })} (${progress}%)`
            : `${formatCargoSummary({
                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                weightKg: totalDeliveredActualCargo.weightKg,
                volumeM3: totalDeliveredActualCargo.volumeM3,
            })} / ${formatCargoSummary({
                qtyKoli: totalOrderCargo.qtyKoli,
                weightKg: totalOrderCargo.weightKg,
                volumeM3: totalOrderCargo.volumeM3,
            })} (${progress}%)`
        : 'Belum ada muatan tercatat';

    const handleAddTripPlan = async () => {
        if (!order) {
            addToast('error', 'Detail order belum siap');
            return;
        }
        if (tripDraft.pickupStopKeys.length === 0) {
            addToast('error', 'Pilih minimal 1 titik pickup untuk trip ini');
            return;
        }
        if (!tripDraft.vehicleRef) {
            addToast('error', 'Kendaraan wajib dipilih');
            return;
        }
        if (!tripDraft.driverRef) {
            addToast('error', 'Supir wajib dipilih');
            return;
        }
        if (!tripDraft.issueBankRef) {
            addToast('error', 'Rekening atau kas sumber wajib dipilih');
            return;
        }
        if (!tripDraft.cashGiven || tripDraft.cashGiven <= 0) {
            addToast('error', 'Nominal uang jalan awal wajib diisi');
            return;
        }
        if (!tripDraft.tripFee || tripDraft.tripFee <= 0) {
            addToast('error', 'Upah trip wajib diisi');
            return;
        }
        if (requiresTripDraftOverrideReason && !tripDraft.vehicleOverrideReason.trim()) {
            addToast('error', 'Isi alasan override armada jika trip ini memakai kendaraan dengan kategori berbeda');
            return;
        }

        setSavingTripPlan(true);
        try {
            const extraPickupRefs = tripDraft.pickupStopKeys
                .filter(key => key.startsWith('customer-pickup:'))
                .map(key => key.replace('customer-pickup:', ''));
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action: editingTripPlanKey ? 'update-trip-plan' : 'append-trip-plan',
                    data: {
                        id: order._id,
                        tripPlanKey: editingTripPlanKey || undefined,
                        customerRef: order.customerRef,
                        pickupStopKeys: tripDraft.pickupStopKeys,
                        extraPickupRefs,
                        vehicleRef: tripDraft.vehicleRef,
                        driverRef: tripDraft.driverRef,
                        tripRouteRateRef: tripDraft.tripRouteRateRef || undefined,
                        tripOriginArea: tripDraft.tripOriginArea || undefined,
                        tripDestinationArea: tripDraft.tripDestinationArea || undefined,
                        taripBorongan: tripDraft.tripFee,
                        vehicleCategoryOverrideReason: requiresTripDraftOverrideReason ? tripDraft.vehicleOverrideReason.trim() : undefined,
                        issueBankRef: tripDraft.issueBankRef,
                        cashGiven: tripDraft.cashGiven,
                        notes: tripDraft.notes.trim() || undefined,
                        date: tripDraft.date,
                    },
                }),
            });
            const result = await response.json();
            if (!response.ok) {
                addToast('error', result.error || (editingTripPlanKey ? 'Gagal mengubah rencana trip' : 'Gagal menambah rencana trip'));
                return;
            }

            addToast('success', editingTripPlanKey ? `Rencana trip diperbarui untuk ${order.masterResi}` : `Rencana trip baru disimpan untuk ${order.masterResi}`);
            closeTripPlanModal();
            await refreshOrderDeliveryState('Gagal memuat ulang rencana trip order');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : (editingTripPlanKey ? 'Gagal mengubah rencana trip' : 'Gagal menambah rencana trip'));
        } finally {
            setSavingTripPlan(false);
        }
    };

    const handleCreateDO = async () => {
        const selectedItems = usesExistingItemsForDeliveryOrder
            ? buildCreateDeliveryOrderItems(
                availableItems,
                selectedShipments,
                itemProgressById
            )
            : [];

        if (!effectiveDoVehicleRef) {
            addToast('error', 'Pilih kendaraan sebelum membuat surat jalan');
            return;
        }
        if (selectablePickupStops.length > 0 && selectedPickupStopKeys.length === 0) {
            addToast('error', 'Pilih minimal 1 titik pickup untuk trip ini');
            return;
        }
        if (isHeaderOnlyOrder && !usesExistingItemsForDeliveryOrder) {
            const invalidReferenceGroup = draftDirectCargoGroups.findIndex(group => group.draftItems.length > 0 && !group.shipperReferenceNumber.trim());
            if (invalidReferenceGroup >= 0) {
                addToast('error', `No. SJ pengirim wajib diisi pada SJ ${invalidReferenceGroup + 1}`);
                return;
            }
            if (draftDirectCargoItems.length === 0 && !draftDirectCargoGroups.some(group => group.shipperReferenceNumber.trim())) {
                addToast('error', 'Isi minimal 1 No. SJ pengirim untuk barang menyusul');
                return;
            }
            const invalidPickupGroup = draftDirectCargoGroups.findIndex(group => {
                const resolvedPickupStopKey = group.pickupStopKey || (selectedTripPickupStops.length === 1 ? selectedTripPickupStops[0]._key : '');
                return selectablePickupStops.length > 0 && !resolvedPickupStopKey;
            });
            if (invalidPickupGroup >= 0) {
                addToast('error', `Titik pickup wajib dipilih pada SJ ${invalidPickupGroup + 1}`);
                return;
            }
            const outOfScopePickupGroup = draftDirectCargoGroups.findIndex(group => {
                const resolvedPickupStopKey = group.pickupStopKey || (selectedTripPickupStops.length === 1 ? selectedTripPickupStops[0]._key : '');
                return Boolean(
                    resolvedPickupStopKey &&
                    selectedPickupStopKeys.length > 0 &&
                    !selectedPickupStopKeys.includes(resolvedPickupStopKey)
                );
            });
            if (outOfScopePickupGroup >= 0) {
                addToast('error', `Titik pickup pada SJ ${outOfScopePickupGroup + 1} belum dicentang di trip ini`);
                return;
            }
        }
        if (usesExistingItemsForDeliveryOrder && selectedItems.length === 0) {
            addToast('error', 'Pilih minimal 1 item untuk surat jalan');
            return;
        }
        if (requiresVehicleOverrideReason && !doVehicleOverrideReason.trim()) {
            addToast('error', 'Isi alasan override armada jika trip ini memakai kendaraan dengan kategori berbeda');
            return;
        }
        const selVeh = vehicles.find(v => v._id === effectiveDoVehicleRef);
        const normalizedDirectCargoGroups = draftDirectCargoGroups.map(group => ({
            ...group,
            resolvedPickupStopKey: group.pickupStopKey || (selectedTripPickupStops.length === 1 ? selectedTripPickupStops[0]._key : ''),
            resolvedShipperReferenceNumber: group.shipperReferenceNumber.trim().toUpperCase(),
        }));
        const extraPickupRefs = selectedPickupStopKeys
            .filter(key => key.startsWith('customer-pickup:'))
            .map(key => key.replace('customer-pickup:', ''))
            .filter(Boolean);
        const deliveryOrderPayload = (isHeaderOnlyOrder && !usesExistingItemsForDeliveryOrder
            ? {
                orderRef: order?._id,
                orderTripPlanKey: selectedOrderTripPlan?._key,
                masterResi: order?.masterResi,
                customerDoNumber: normalizedDirectCargoGroups[0]?.resolvedShipperReferenceNumber,
                pickupStopKeys: selectedPickupStopKeys,
                shipperReferences: normalizedDirectCargoGroups.map(group => ({
                    referenceNumber: group.resolvedShipperReferenceNumber,
                    pickupStopKey: group.resolvedPickupStopKey,
                })),
                vehicleRef: effectiveDoVehicleRef || undefined,
                vehiclePlate: selVeh?.plateNumber || '',
                driverRef: selectedOrderTripPlan?.driverRef || undefined,
                vehicleCategoryOverrideReason: selectedOrderTripPlan?.vehicleCategoryOverrideReason || (requiresVehicleOverrideReason ? doVehicleOverrideReason.trim() : undefined),
                tripRouteRateRef: selectedOrderTripPlan?.tripRouteRateRef || undefined,
                tripOriginArea: selectedOrderTripPlan?.tripOriginArea || undefined,
                tripDestinationArea: selectedOrderTripPlan?.tripDestinationArea || undefined,
                taripBorongan: selectedOrderTripPlan?.taripBorongan,
                issueBankRef: selectedOrderTripPlan?.issueBankRef || undefined,
                cashGiven: selectedOrderTripPlan?.cashGiven,
                date: doDate,
                notes: doNotes,
                customerName: order?.customerName,
                cargoItems: normalizedDirectCargoGroups.flatMap(group =>
                    group.draftItems.map(item => ({
                        ...item,
                        shipperReferenceNumber: group.resolvedShipperReferenceNumber,
                        pickupStopKey: group.resolvedPickupStopKey,
                    }))
                ),
            }
            : buildCreateDeliveryOrderRequestData({
                order,
                items: selectedItems,
                customerDoNumber: doCustomerDoNumber,
                pickupStopKeys: selectedPickupStopKeys,
                vehicleRef: effectiveDoVehicleRef,
                selectedVehicle: selVeh,
                date: doDate,
                notes: doNotes,
                requiresVehicleOverrideReason,
                vehicleOverrideReason: doVehicleOverrideReason,
            })) as Record<string, unknown>;
        if (extraPickupRefs.length > 0) {
            deliveryOrderPayload.extraPickupRefs = extraPickupRefs;
        }
        if (selectedOrderTripPlan) {
            deliveryOrderPayload.orderTripPlanKey = selectedOrderTripPlan._key;
            deliveryOrderPayload.driverRef = selectedOrderTripPlan.driverRef;
            deliveryOrderPayload.tripRouteRateRef = selectedOrderTripPlan.tripRouteRateRef || undefined;
            deliveryOrderPayload.tripOriginArea = selectedOrderTripPlan.tripOriginArea || undefined;
            deliveryOrderPayload.tripDestinationArea = selectedOrderTripPlan.tripDestinationArea || undefined;
            deliveryOrderPayload.taripBorongan = selectedOrderTripPlan.taripBorongan;
            deliveryOrderPayload.issueBankRef = selectedOrderTripPlan.issueBankRef;
            deliveryOrderPayload.cashGiven = selectedOrderTripPlan.cashGiven;
            deliveryOrderPayload.vehicleCategoryOverrideReason = selectedOrderTripPlan.vehicleCategoryOverrideReason || undefined;
        }

        setCreatingDO(true);
        try {
            const doRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'create-with-items',
                    data: deliveryOrderPayload,
                }),
            });
            const doData = await doRes.json();
            if (!doRes.ok) {
                addToast('error', doData.error || 'Gagal membuat surat jalan');
                return;
            }

            const createdShipperReferences = getDeliveryOrderShipperReferenceNumbers(doData.data || {});
            addToast(
                'success',
                `Trip dibuat: ${formatInternalDeliveryOrderNumber(doData.data || {})}${createdShipperReferences.length > 0 ? ` | ${createdShipperReferences.length} SJ: ${formatDeliveryOrderShipperReferencePreview(doData.data || {}, [], 3)}` : ''}${isHeaderOnlyOrder && draftDirectCargoItems.length === 0 ? ' | Barang menyusul' : ''}`
            );
            setShowDOModal(false);
            setSelectedShipments({});
            setDirectCargoGroups([createDefaultDirectCargoGroup()]);
            setDoCustomerDoNumber('');
            setDoVehicle('');
            setDoVehicleOverrideReason('');
            setDoNotes('');
            setDoDate(getBusinessDateValue());
            setSelectedOrderTripPlanKey('');
            await refreshOrderDeliveryState('Gagal memuat ulang trip order setelah surat jalan dibuat');
        } catch {
            addToast('error', 'Gagal membuat surat jalan');
        } finally {
            setCreatingDO(false);
        }
    };

    const openHoldModal = (item: OrderItem) => {
        const progress = itemProgressById[item._id];
        const nextHoldState = buildHoldFormState(item, progress);
        setHoldingItem(item);
        setHoldQtyKoli(nextHoldState.holdQtyKoli);
        setHoldWeightInputValue(nextHoldState.holdWeightInputValue);
        setHoldWeightInputUnit(nextHoldState.holdWeightInputUnit);
        setHoldVolumeInputValue(nextHoldState.holdVolumeInputValue);
        setHoldVolumeInputUnit(nextHoldState.holdVolumeInputUnit);
        setHoldReason(nextHoldState.holdReason);
        setHoldLocation(nextHoldState.holdLocation);
        setShowHoldModal(true);
    };

    const saveHoldQuantity = async () => {
        if (!holdingItem) {
            return;
        }
        setSavingHold(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'order-items',
                    action: 'set-hold-quantity',
                    data: {
                        id: holdingItem._id,
                        holdQtyKoli: parseFormattedNumberish(holdQtyKoli),
                        holdWeightInputValue: holdWeightInputValue.trim()
                            ? parseFormattedNumberish(holdWeightInputValue, {
                                maxFractionDigits: getWeightInputFractionDigits(holdWeightInputUnit),
                            })
                            : 0,
                        holdWeightInputUnit,
                        holdVolumeInputValue: holdVolumeInputValue.trim()
                            ? parseFormattedNumberish(holdVolumeInputValue, {
                                maxFractionDigits: holdVolumeInputUnit === 'LITER' ? 0 : 3,
                            })
                            : 0,
                        holdVolumeInputUnit,
                        holdReason,
                        holdLocation,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan hold qty');
                return;
            }
            addToast('success', 'Sisa item berhasil di-hold');
            setShowHoldModal(false);
            setHoldingItem(null);
            setHoldQtyKoli('');
            setHoldWeightInputValue('');
            setHoldWeightInputUnit('KG');
            setHoldVolumeInputValue('');
            setHoldVolumeInputUnit('M3');
            setHoldReason('');
            setHoldLocation('');
            await refreshOrderCoreState('Gagal memuat ulang hold item');
        } catch {
            addToast('error', 'Gagal menyimpan hold qty');
        } finally {
            setSavingHold(false);
        }
    };

    const releaseHoldQuantity = async (item: OrderItem) => {
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'order-items', action: 'release-hold', data: { id: item._id } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal melepas hold item');
                return;
            }
            addToast('success', 'Hold item berhasil dilepas');
            await refreshOrderCoreState('Gagal memuat ulang item setelah hold dilepas');
        } catch {
            addToast('error', 'Gagal melepas hold item');
        }
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    }

    if (!order) {
        return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Order tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;
    }

    const auditTrailEntityRefs = Array.from(new Set([
        order._id,
        ...items.map(item => item._id),
        ...dos.map(deliveryOrder => deliveryOrder._id),
        ...doItems.map(item => item._id),
        ...notas.map(nota => nota._id),
    ].filter((ref): ref is string => Boolean(ref))));

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/orders" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            {order.masterResi}
                            <span className={`badge badge-${ORDER_STATUS_MAP[order.status]?.color || 'gray'}`}>
                                <span className="badge-dot" /> {ORDER_STATUS_MAP[order.status]?.label}
                            </span>
                        </h1>
                    </div>
                </div>
                <div className="page-actions">
                    {canShowPrimaryDeliveryOrderButton && (
                        <button className="btn btn-primary" onClick={() => openCreateDOModal()} disabled={!canCreateDeliveryOrder}>
                            <Truck size={16} /> {primaryDeliveryOrderButtonLabel}
                        </button>
                    )}
                    {canCreateInvoice && (
                        <button
                            className="btn btn-secondary"
                            onClick={() => router.push(createFreightNotaHref)}
                            disabled={!canStartFreightNota}
                            title={!canStartFreightNota ? 'Belum ada SJ siap tagih pada order ini' : 'Buat invoice dari SJ siap tagih pada order ini'}
                        >
                                                <FileText size={16} /> Invoice SJ Siap Tagih
                        </button>
                    )}
                    <button
                        className="btn btn-ghost"
                        onClick={() => router.push(`/orders/${order._id}/edit`)}
                        title={dos.length > 0 ? 'Order ini sudah punya surat jalan. Hanya catatan yang bisa diubah.' : 'Edit order'}
                    >
                        <Edit size={16} /> Edit
                    </button>
                    {canManageOrderTrips && order.status !== 'CANCELLED' && (
                        <button
                            className="btn btn-ghost"
                            onClick={() => setShowCancelOrderModal(true)}
                            disabled={!canCancelOrder}
                            title={
                                nonCancelledDos.length > 0
                                    ? 'Batalkan semua trip aktif dulu sebelum membatalkan order/resi'
                                    : notas.length > 0
                                        ? 'Order/resi sudah masuk invoice'
                                        : hasDeliveredOrderProgress
                                            ? 'Order/resi sudah punya muatan terkirim'
                                            : 'Batalkan order/resi'
                            }
                            style={{ color: 'var(--color-danger)' }}
                        >
                            <X size={16} /> Batalkan Order
                        </button>
                    )}
                </div>
            </div>

            {/* Progress Bar */}
            <div className="card mb-6">
                <div className="card-body">
                    {isHeaderOnlyOrder && (
                        <div style={{ marginBottom: '0.85rem', padding: '0.85rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)', fontSize: '0.82rem', color: 'var(--color-gray-700)' }}>
                            {dos.length > 0
                                ? 'Manifest barang tersimpan per Surat Jalan, bukan di header order.'
                                : 'Barang akan dicatat saat Surat Jalan pertama dibuat.'}
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 'var(--font-size-sm)' }}>
                        <span className="font-semibold">Progress Pengiriman Aktual</span>
                        <span className="text-muted">{progressSummaryLabel}</span>
                    </div>
                    <div className="progress-bar">
                        <div className={`progress-bar-fill ${progress === 100 ? 'success' : ''}`} style={{ width: `${progress}%` }} />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem 1rem', marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--color-success)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                                weightKg: totalDeliveredActualCargo.weightKg,
                                volumeM3: totalDeliveredActualCargo.volumeM3,
                            })} terkirim
                        </span>
                        <span style={{ color: 'var(--color-primary)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalActivePlannedCargo.qtyKoli,
                                weightKg: totalActivePlannedCargo.weightKg,
                                volumeM3: totalActivePlannedCargo.volumeM3,
                            })} dalam DO
                        </span>
                        <span style={{ color: 'var(--color-warning)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalHeldCargo.qtyKoli,
                                weightKg: totalHeldCargo.weightKg,
                                volumeM3: totalHeldCargo.volumeM3,
                            })} ditahan
                        </span>
                        <span>
                            {formatCargoSummary({
                                qtyKoli: totalPendingCargo.qtyKoli,
                                weightKg: totalPendingCargo.weightKg,
                                volumeM3: totalPendingCargo.volumeM3,
                            })} pending
                        </span>
                    </div>
                </div>
            </div>

            <div className="detail-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">{isHeaderOnlyOrder ? 'Muatan Tercatat di DO' : 'Target Order Saat Ini'}</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            {hasCargoAggregate(totalOrderCargo)
                                ? formatCargoSummary({
                                    qtyKoli: totalOrderCargo.qtyKoli,
                                    weightKg: totalOrderCargo.weightKg,
                                    volumeM3: totalOrderCargo.volumeM3,
                                })
                                : 'Belum dicatat'}
                        </div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Aktual Terkirim</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-success)' }}>
                            {formatCargoSummary({
                                qtyKoli: totalDeliveredActualCargo.qtyKoli,
                                weightKg: totalDeliveredActualCargo.weightKg,
                                volumeM3: totalDeliveredActualCargo.volumeM3,
                            })}
                        </div>
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Rencana dalam DO Aktif</span></div>
                    <div className="card-body">
                        <div className="detail-value" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                            {hasCargoAggregate(totalActivePlannedCargo)
                                ? formatCargoSummary({
                                    qtyKoli: totalActivePlannedCargo.qtyKoli,
                                    weightKg: totalActivePlannedCargo.weightKg,
                                    volumeM3: totalActivePlannedCargo.volumeM3,
                                })
                                : '-'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Order Info */}
            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Order</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item">
                                <div className="detail-label">Master Resi</div>
                                <div className="detail-value font-mono">{order.masterResi}</div>
                                {(dos.length > 0 || notas.length > 0) && (
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                        {dos.length > 0 && <a href="#order-surat-jalan-section" style={{ color: 'var(--color-primary)' }}>{dos.length} trip / SJ terkait</a>}
                                        {notas.length > 0 && <a href="#invoice-section" style={{ color: 'var(--color-primary)' }}>{notas.length} nota terkait</a>}
                                    </div>
                                )}
                            </div>
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(order.createdAt)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Customer / Pengirim / Penagih</div><div className="detail-value">{canOpenCustomerPage && order.customerRef ? <Link href={withReturnTo(`/customers/${order.customerRef}`)}>{order.customerName}</Link> : order.customerName}</div></div>
                            <div className="detail-item"><div className="detail-label">Kategori Truk / Armada</div><div className="detail-value">{order.serviceName || '-'}</div></div>
                        </div>
                        <div className="mt-2">
                            <div className="detail-label">Titik Pickup</div>
                            {resolvedOrderPickupStops.length === 0 ? (
                                <div className="detail-value">-</div>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.65rem' }}>
                                    {resolvedOrderPickupStops.map((pickupStop, index) => (
                                        <div key={pickupStop._key} style={{ padding: '0.8rem 0.9rem', borderRadius: '0.75rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)' }}>
                                            <div className="detail-label">Pickup {index + 1}{pickupStop.pickupLabel ? ` · ${pickupStop.pickupLabel}` : ''}</div>
                                            <div className="detail-value">{pickupStop.pickupAddress}</div>
                                            {pickupStop.notes && <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>{pickupStop.notes}</div>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {order.notes && <div className="mt-2"><div className="detail-label">Catatan</div><div className="detail-value">{order.notes}</div></div>}
                    </div>
                </div>
            </div>

            {isHeaderOnlyOrder && !hasPlannedTrips && !orderIsCancelled && (
                <div className="card mt-6">
                    <div className="card-body" style={{ padding: '0.9rem 1rem', border: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ fontWeight: 700 }}>Belum ada rencana trip</div>
                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                Tambahkan trip dari detail order tanpa mengubah customer order.
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={openAddTripModal}>
                                <Plus size={14} /> Tambah Trip
                            </button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTripPlanActionModal('edit')} disabled={editableOrderTripPlans.length === 0}>
                                <Edit size={14} /> Edit Trip
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openTripPlanActionModal('delete')} disabled={editableOrderTripPlans.length === 0} style={{ color: 'var(--color-danger)' }}>
                                <Trash2 size={14} /> Hapus Trip
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {hasPlannedTrips && (
                <div className="card mt-6" id="order-surat-jalan-section">
                    <div className="card-header">
                        <span className="card-header-title">Rencana Trip ({orderTripPlans.length})</span>
                        {isHeaderOnlyOrder && !orderIsCancelled && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={openAddTripModal}>
                                    <Plus size={14} /> Tambah Trip
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openTripPlanActionModal('edit')} disabled={editableOrderTripPlans.length === 0}>
                                    <Edit size={14} /> Edit Trip
                                </button>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openTripPlanActionModal('delete')} disabled={editableOrderTripPlans.length === 0} style={{ color: 'var(--color-danger)' }}>
                                    <Trash2 size={14} /> Hapus Trip
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '1rem' }}>
                        {orderTripPlans.map(tripPlan => {
                            const linkedDeliveryOrder = tripPlan.linkedDeliveryOrderRef ? deliveryOrderById.get(tripPlan.linkedDeliveryOrderRef) : undefined;
                            const tripPlanPickupStops = resolvedOrderPickupStops.filter(stop => tripPlan.pickupStopKeys.includes(stop._key));
                            const linkedShipperReferenceItems = linkedDeliveryOrder ? doItems.filter(item => item.deliveryOrderRef === linkedDeliveryOrder._id) : [];
                            const linkedShipperReferenceCount = linkedDeliveryOrder ? getDeliveryOrderShipperReferenceNumbers(linkedDeliveryOrder, linkedShipperReferenceItems).length : 0;
                            const linkedShipperReferencePreview = linkedDeliveryOrder ? formatDeliveryOrderShipperReferencePreview(linkedDeliveryOrder, linkedShipperReferenceItems, 3) : null;
                            const linkedShipperReferenceLinks = linkedDeliveryOrder ? buildDeliveryOrderShipperReferenceLinks(linkedDeliveryOrder, linkedShipperReferenceItems) : [];
                            const canInputSuratJalan =
                                !linkedDeliveryOrder;
                            const canCancelCurrentTrip = canCancelTripPlanFromOrder(tripPlan, linkedDeliveryOrder);
                            return (
                                <div
                                    key={tripPlan._key}
                                    style={{
                                        display: 'grid',
                                        gap: '0.85rem',
                                        padding: '1rem',
                                        border: '1px solid var(--color-gray-200)',
                                        borderRadius: '0.9rem',
                                        background: 'var(--color-gray-50)',
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 700 }}>Trip {tripPlan.sequence}</div>
                                        {linkedDeliveryOrder ? (
                                            <span className={`badge badge-${DO_STATUS_MAP[linkedDeliveryOrder.status]?.color || 'gray'}`}>
                                                <span className="badge-dot" /> {linkedDeliveryOrder.status === 'CANCELLED' ? 'Dibatalkan' : `Sudah jadi DO ${formatInternalDeliveryOrderNumber(linkedDeliveryOrder)}`}
                                            </span>
                                        ) : (
                                            <span className="badge badge-blue"><span className="badge-dot" /> Siap input Surat Jalan</span>
                                        )}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                        <div>
                                            <div className="detail-label">Kendaraan</div>
                                            <div className="detail-value">{tripPlan.vehiclePlate || '-'}</div>
                                        </div>
                                        <div>
                                            <div className="detail-label">Supir</div>
                                            <div className="detail-value">{tripPlan.driverName || '-'}</div>
                                        </div>
                                        <div>
                                            <div className="detail-label">Upah Trip</div>
                                            <div className="detail-value">{formatCurrency(tripPlan.taripBorongan || 0)}</div>
                                        </div>
                                        <div>
                                            <div className="detail-label">Uang Jalan Awal</div>
                                            <div className="detail-value">{formatCurrency(tripPlan.cashGiven || 0)}</div>
                                        </div>
                                    </div>
                                    {linkedDeliveryOrder && (
                                        <div style={{ padding: '0.8rem 0.9rem', borderRadius: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)' }}>
                                            <div className="detail-label">SJ Pengirim</div>
                                            <div className="detail-value">
                                                {linkedShipperReferenceCount > 0 ? `${formatNumber(linkedShipperReferenceCount)} SJ tercatat` : 'Belum ada SJ pengirim'}
                                            </div>
                                            {linkedShipperReferencePreview && (
                                                <div className="text-muted text-sm font-mono" style={{ marginTop: '0.25rem', wordBreak: 'break-word', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                    {linkedShipperReferenceLinks.length > 0
                                                        ? linkedShipperReferenceLinks.slice(0, 3).map(link => (
                                                            <Link key={link.id} href={withReturnTo(`/surat-jalan/${encodeURIComponent(link.id)}`)} style={{ color: 'var(--color-primary)' }}>
                                                                {link.label}
                                                            </Link>
                                                        ))
                                                        : linkedShipperReferencePreview}
                                                    {linkedShipperReferenceLinks.length > 3 && <span>+{linkedShipperReferenceLinks.length - 3} SJ</span>}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div>
                                        <div className="detail-label">Pickup Trip</div>
                                        <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.45rem' }}>
                                            {(tripPlanPickupStops.length > 0 ? tripPlanPickupStops : resolvedOrderPickupStops).map((pickupStop, index) => (
                                                <div key={`${tripPlan._key}-${pickupStop._key}`} style={{ padding: '0.7rem 0.85rem', borderRadius: '0.75rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)' }}>
                                                    <div className="detail-label">Pickup {index + 1}{pickupStop.pickupLabel ? ` · ${pickupStop.pickupLabel}` : ''}</div>
                                                    <div className="detail-value">{pickupStop.pickupAddress}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                        <div className="text-muted text-sm">
                                            {tripPlan.tripOriginArea || tripPlan.tripDestinationArea
                                                ? `${tripPlan.tripOriginArea || '-'} → ${tripPlan.tripDestinationArea || '-'}`
                                                : 'Area trip belum diisi'}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {linkedDeliveryOrder && (
                                                <Link href={withReturnTo(`/delivery-orders/${linkedDeliveryOrder._id}`)} className="btn btn-secondary btn-sm">
                                                    <Eye size={14} /> Kelola Trip / SJ
                                                </Link>
                                            )}
                                            {canInputSuratJalan && (
                                                <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateDOModal(tripPlan._key)}>
                                                    <Truck size={14} /> Input Surat Jalan
                                                </button>
                                            )}
                                            {canCancelCurrentTrip && (
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={() => void openCancelTripModal(tripPlan)}
                                                    disabled={cancellingTripPlan && cancelTripPlanKey === tripPlan._key}
                                                    style={{ color: 'var(--color-danger)' }}
                                                >
                                                    Batalkan Trip
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Items */}
            <div className="card mt-6">
                <div className="card-header">
                    <span className="card-header-title">{isHeaderOnlyOrder ? `Manifest Tersimpan per Trip (${persistedShipperManifestCount})` : `Item / Koli (${items.length})`}</span>
                </div>
                {isHeaderOnlyOrder ? (
                    <div className="card-body">
                        {headerOnlyManifestByDo.length === 0 ? (
                            <div style={{ padding: '1rem 1.1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)', fontSize: '0.85rem', color: 'var(--color-gray-700)' }}>
                                {dos.length > 0
                                    ? 'Trip sudah ada, tapi nomor SJ atau barangnya belum dicatat.'
                                    : 'Belum ada item target di order ini. Barang akan dicatat saat admin membuat Surat Jalan berdasarkan dokumen dari pengirim.'}
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '1rem' }}>
                                {headerOnlyManifestByDo.map(({ deliveryOrder, shipperManifests }) => (
                                    <div key={deliveryOrder._id} style={{ display: 'grid', gap: '0.85rem', padding: '1rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.9rem', background: 'var(--color-gray-50)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                            <div>
                                                <Link href={withReturnTo(`/delivery-orders/${deliveryOrder._id}`)} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                                    {formatInternalDeliveryOrderNumber(deliveryOrder)}
                                                </Link>
                                                <div className="text-muted text-sm">
                                                    {deliveryOrder.driverName || '-'}{deliveryOrder.vehiclePlate ? ` / ${deliveryOrder.vehiclePlate}` : ''}
                                                </div>
                                            </div>
                                            <div className="text-muted text-sm">{shipperManifests.length} SJ pengirim</div>
                                        </div>
                                        <div style={{ display: 'grid', gap: '0.75rem' }}>
                                            {shipperManifests.map(manifest => {
                                                const manifestLink = buildDeliveryOrderShipperReferenceLinks(deliveryOrder, manifest.items)
                                                    .find(link => link.label.trim().toUpperCase() === manifest.referenceNumber.trim().toUpperCase());
                                                return (
                                                <div key={`${deliveryOrder._id}-${manifest.referenceNumber}-${manifest.pickupAddress || '-'}`} style={{ padding: '0.85rem 1rem', borderRadius: '0.8rem', background: 'var(--color-white)', border: '1px solid var(--color-gray-200)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                        <div className="font-semibold font-mono">
                                                            {manifestLink ? (
                                                                <Link href={withReturnTo(`/surat-jalan/${encodeURIComponent(manifestLink.id)}`)} style={{ color: 'var(--color-primary)' }}>
                                                                    {manifest.referenceNumber}
                                                                </Link>
                                                            ) : manifest.referenceNumber}
                                                        </div>
                                                        <div className="text-muted text-sm">{manifest.itemCount} barang</div>
                                                    </div>
                                                    {(manifest.pickupLabel || manifest.pickupAddress) && (
                                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                                            {manifest.pickupLabel || 'Pickup'}{manifest.pickupAddress ? ` · ${manifest.pickupAddress}` : ''}
                                                        </div>
                                                    )}
                                                    <div style={{ marginTop: '0.35rem', fontWeight: 600 }}>
                                                        {hasCargoAggregate(manifest.cargo) ? formatCargoSummary(manifest.cargo) : 'Barang belum dicatat'}
                                                    </div>
                                                    {manifest.items.length > 0 && (
                                                        <details style={{ marginTop: '0.75rem' }}>
                                                            <summary
                                                                className="text-sm font-medium"
                                                                style={{
                                                                    cursor: 'pointer',
                                                                    color: 'var(--color-primary)',
                                                                    userSelect: 'none',
                                                                }}
                                                            >
                                                                Lihat daftar barang ({manifest.items.length})
                                                            </summary>
                                                            <div style={{ display: 'grid', gap: '0.55rem', marginTop: '0.65rem' }}>
                                                                {manifest.items.map(item => {
                                                                    const manifestItemCargo = deliveryOrder.status === 'DELIVERED'
                                                                        ? {
                                                                            qtyKoli: item.actualQtyKoli ?? item.orderItemQtyKoli,
                                                                            weightKg: item.actualWeightKg ?? item.orderItemWeight,
                                                                            weightInputValue: item.actualWeightInputValue,
                                                                            weightInputUnit: item.actualWeightInputUnit,
                                                                            volumeM3: item.actualVolumeM3 ?? item.orderItemVolumeM3,
                                                                            volumeInputValue: item.actualVolumeInputValue,
                                                                            volumeInputUnit: item.actualVolumeInputUnit,
                                                                        }
                                                                        : {
                                                                            qtyKoli: item.orderItemQtyKoli,
                                                                            weightKg: item.orderItemWeight,
                                                                            weightInputValue: item.orderItemWeightInputValue,
                                                                            weightInputUnit: item.orderItemWeightInputUnit,
                                                                            volumeM3: item.orderItemVolumeM3,
                                                                            volumeInputValue: item.orderItemVolumeInputValue,
                                                                            volumeInputUnit: item.orderItemVolumeInputUnit,
                                                                        };
                                                                    return (
                                                                        <div
                                                                            key={item._id}
                                                                            style={{
                                                                                padding: '0.65rem 0.75rem',
                                                                                border: '1px solid var(--color-gray-200)',
                                                                                borderRadius: '0.55rem',
                                                                                background: 'var(--color-gray-50)',
                                                                            }}
                                                                        >
                                                                            <div className="font-medium">{item.orderItemDescription || 'Barang tanpa nama'}</div>
                                                                            <div className="text-sm" style={{ marginTop: '0.35rem', fontWeight: 600 }}>
                                                                                {formatCargoSummary(manifestItemCargo)}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </details>
                                                    )}
                                                </div>
                                            );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="table-wrapper">
                        <table>
                            <thead><tr><th>Deskripsi</th><th>Koli</th><th>Muatan</th><th>Progress</th><th>Status</th><th>Aksi</th></tr></thead>
                            <tbody>
                                {items.map(item => {
                                const activeAssignment = activeAssignmentByItemId[item._id];
                                const doItem = doItemByOrderItemId[item._id];
                                const progressInfo = itemProgressById[item._id];
                                const deliveredActualCargo = deliveredActualCargoByItemId[item._id] || createCargoAggregate();
                                const activePlannedCargo = activePlannedCargoByItemId[item._id] || createCargoAggregate();
                                const usesQtyBasis = progressInfo.totalQtyKoli > 0;
                                const progressLines = [
                                    formatProgressLine('Aktual terkirim', deliveredActualCargo),
                                    formatProgressLine('Rencana dalam DO', activePlannedCargo),
                                    formatProgressLine('Hold', {
                                        qtyKoli: progressInfo.heldQtyKoli,
                                        weightKg: progressInfo.heldWeight,
                                        volumeM3: progressInfo.heldVolume,
                                    }),
                                    formatProgressLine('Belum ditugaskan', {
                                        qtyKoli: progressInfo.pendingQtyKoli,
                                        weightKg: progressInfo.pendingWeight,
                                        volumeM3: progressInfo.pendingVolume,
                                    }),
                                    formatProgressLine('Sisa siap kirim', {
                                        qtyKoli: progressInfo.pendingQtyKoli,
                                        weightKg: progressInfo.pendingWeight,
                                        volumeM3: progressInfo.pendingVolume,
                                    }),
                                ].filter((line): line is string => Boolean(line));
                                return (
                                <tr key={item._id}>
                                    <td>
                                        <div className="font-medium">{item.description}</div>
                                        {(item.customerProductCode || item.customerProductName) && (
                                            <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                                {item.customerProductCode ? `${item.customerProductCode} - ` : ''}{item.customerProductName || 'Master barang customer'}
                                            </div>
                                        )}
                                    </td>
                                    <td>
                                        <div className="font-medium">{item.qtyKoli > 0 ? item.qtyKoli : '-'}</div>
                                        <div className="text-muted text-sm">
                                            Aktual terkirim: {deliveredActualCargo.qtyKoli > 0 ? formatNumber(deliveredActualCargo.qtyKoli) : '-'}
                                        </div>
                                    </td>
                                    <td>
                                        <div className="text-muted text-xs">Target / order</div>
                                        <div className="font-medium">
                                            {formatCargoSummary({
                                                qtyKoli: item.qtyKoli,
                                                weightKg: item.weight,
                                                weightInputValue: item.weightInputValue,
                                                weightInputUnit: item.weightInputUnit,
                                                volumeM3: item.volume,
                                                volumeInputValue: item.volumeInputValue,
                                                volumeInputUnit: item.volumeInputUnit,
                                            })}
                                        </div>
                                        <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Aktual terkirim</div>
                                        <div className="font-medium" style={{ color: hasCargoAggregate(deliveredActualCargo) ? 'var(--color-success)' : 'var(--color-gray-500)' }}>
                                            {hasCargoAggregate(deliveredActualCargo)
                                                ? formatCargoSummary({
                                                    qtyKoli: deliveredActualCargo.qtyKoli,
                                                    weightKg: deliveredActualCargo.weightKg,
                                                    volumeM3: deliveredActualCargo.volumeM3,
                                                })
                                                : 'Belum ada realisasi'}
                                        </div>
                                        {hasCargoAggregate(activePlannedCargo) && (
                                            <>
                                                <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>Dalam DO aktif</div>
                                                <div className="font-medium" style={{ color: 'var(--color-primary)' }}>
                                                    {formatCargoSummary({
                                                        qtyKoli: activePlannedCargo.qtyKoli,
                                                        weightKg: activePlannedCargo.weightKg,
                                                        volumeM3: activePlannedCargo.volumeM3,
                                                    })}
                                                </div>
                                            </>
                                        )}
                                    </td>
                                    <td>
                                        <div style={{ display: 'grid', gap: '0.25rem', minWidth: 220 }}>
                                            {progressLines.map(line => (
                                                <div key={line} style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{line}</div>
                                            ))}
                                            {item.holdReason && (
                                                <div style={{ fontSize: '0.76rem', color: 'var(--color-warning-dark)' }}>
                                                    Alasan hold: {item.holdReason}{item.holdLocation ? ` (${item.holdLocation})` : ''}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`badge badge-${ITEM_STATUS_MAP[item.status]?.color || 'gray'}`}>
                                            <span className="badge-dot" /> {ITEM_STATUS_MAP[item.status]?.label}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="table-actions">
                                            {((usesQtyBasis && progressInfo.pendingQtyKoli > 0) || (!usesQtyBasis && (progressInfo.pendingWeight > 0 || progressInfo.pendingVolume > 0))) && (
                                                <button className="table-action-btn" onClick={() => openHoldModal(item)}>
                                                    {activeAssignment ? 'Tahan Sisa' : 'Set Hold'}
                                                </button>
                                            )}
                                            {((usesQtyBasis && progressInfo.heldQtyKoli > 0) || (!usesQtyBasis && (progressInfo.heldWeight > 0 || progressInfo.heldVolume > 0))) && (
                                                <button className="table-action-btn" onClick={() => void releaseHoldQuantity(item)}>Lepas Hold</button>
                                            )}
                                            {activeAssignment && (
                                                <Link href={withReturnTo(`/delivery-orders/${activeAssignment._id}`)} className="table-action-btn" title="Item ini sudah masuk surat jalan aktif">
                                                    <Eye size={14} /> {activeAssignment.doNumber || 'Lihat DO'}{doItem?.orderItemQtyKoli ? ` (${formatNumber(doItem.orderItemQtyKoli)} koli)` : ''}
                                                </Link>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                );
                            })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* DOs */}
            {(!hasPlannedTrips || unplannedDos.length > 0) && (
            <div className="card mt-6" id={hasPlannedTrips ? undefined : 'order-surat-jalan-section'}>
                <div className="card-header"><span className="card-header-title">Trip / DO Internal ({displayedDoList.length})</span></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Trip / DO Internal</th><th>SJ Pengirim</th><th>Tanggal</th><th>Kendaraan</th><th>Muatan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {displayedDoList.length === 0 ? (
                                <tr><td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada trip / DO internal</td></tr>
                            ) : displayedDoList.map(d => {
                                const relatedDeliveryOrderItems = doItems.filter(item => item.deliveryOrderRef === d._id);
                                const shipperReferenceNumbers = getDeliveryOrderShipperReferenceNumbers(d, relatedDeliveryOrderItems);
                                const shipperReferencePreview = formatDeliveryOrderShipperReferencePreview(d, relatedDeliveryOrderItems, 3);
                                const shipperReferenceLinks = buildDeliveryOrderShipperReferenceLinks(d, relatedDeliveryOrderItems);
                                const doStatusMeta = getDeliveryOrderDisplayStatusMeta(d);
                                const billableCargoSummary = hasDeliveryOrderBillableCargo(d) ? getDeliveryOrderBillableCargoSummary(d) : null;
                                const holdCargoSummary = d.status === 'DELIVERED' || d.status === 'PARTIAL_HOLD' ? getDeliveryOrderHoldCargoSummary(d) : null;
                                const returnCargoSummary = d.status === 'DELIVERED' || d.status === 'PARTIAL_HOLD' ? getDeliveryOrderReturnCargoSummary(d) : null;
                                const hasBillableCargo = Boolean(
                                    billableCargoSummary &&
                                    (billableCargoSummary.qtyKoli > 0 || billableCargoSummary.weightKg > 0 || billableCargoSummary.volumeM3 > 0)
                                );
                                const hasHoldCargo = Boolean(
                                    holdCargoSummary &&
                                    (holdCargoSummary.qtyKoli > 0 || holdCargoSummary.weightKg > 0 || holdCargoSummary.volumeM3 > 0)
                                );
                                const hasReturnCargo = Boolean(
                                    returnCargoSummary &&
                                    (returnCargoSummary.qtyKoli > 0 || returnCargoSummary.weightKg > 0 || returnCargoSummary.volumeM3 > 0)
                                );
                                const activeInvoiceLinks = getActiveInvoiceLinksForDeliveryOrder(d._id);
                                return (
                                <tr key={d._id}>
                                    <td>
                                        <Link href={withReturnTo(`/delivery-orders/${d._id}`)} className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                                            {formatInternalDeliveryOrderNumber(d)}
                                        </Link>
                                        <div className="text-muted text-sm">
                                            {d.driverName || '-'}{d.vehiclePlate ? ` / ${d.vehiclePlate}` : ''}
                                        </div>
                                    </td>
                                    <td>
                                        {shipperReferenceNumbers.length > 0 ? (
                                            <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                <div className="font-medium">{formatNumber(shipperReferenceNumbers.length)} SJ pengirim</div>
                                                {shipperReferenceLinks.length > 0 ? (
                                                    <div className="text-sm font-mono" style={{ wordBreak: 'break-word', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        {shipperReferenceLinks.map(link => (
                                                            <Link key={link.id} href={withReturnTo(`/surat-jalan/${encodeURIComponent(link.id)}`)} style={{ color: 'var(--color-primary)' }}>
                                                                {link.label}
                                                            </Link>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="text-muted text-sm font-mono" style={{ wordBreak: 'break-word' }}>
                                                        {shipperReferencePreview}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-muted text-sm">Belum diinput</span>
                                        )}
                                    </td>
                                    <td>{formatDate(d.date)}</td>
                                    <td>{canOpenVehiclePage && d.vehicleRef ? <Link href={withReturnTo(`/fleet/vehicles/${d.vehicleRef}`)} style={{ color: 'var(--color-primary)' }}>{d.vehiclePlate || '-'}</Link> : (d.vehiclePlate || '-')}</td>
                                    <td>
                                        <div className="font-medium">
                                            {formatCargoSummary(
                                                d.status === 'DELIVERED'
                                                    ? {
                                                        qtyKoli: doActualCargoById[d._id]?.qtyKoli,
                                                        weightKg: doActualCargoById[d._id]?.weightKg,
                                                        volumeM3: doActualCargoById[d._id]?.volumeM3,
                                                    }
                                                    : {
                                                        qtyKoli: doPlannedCargoById[d._id]?.qtyKoli,
                                                        weightKg: doPlannedCargoById[d._id]?.weightKg,
                                                        volumeM3: doPlannedCargoById[d._id]?.volumeM3,
                                                    }
                                            )}
                                        </div>
                                        <div className="text-muted text-sm">
                                            {d.status === 'DELIVERED' ? 'Aktual final' : 'Rencana Trip (estimasi)'}
                                        </div>
                                        {(hasBillableCargo || hasHoldCargo || hasReturnCargo) && (
                                            <div style={{ display: 'grid', gap: '0.15rem', marginTop: '0.35rem' }}>
                                                {hasBillableCargo && (
                                                    <div className="text-muted text-sm">
                                                        Masuk invoice: {formatCargoSummary(billableCargoSummary || {})}
                                                        {activeInvoiceLinks.length > 0 && (
                                                            <span>
                                                                {' '}(
                                                                {activeInvoiceLinks.map((nota, index) => (
                                                                    <span key={nota._id}>
                                                                        {index > 0 ? ', ' : ''}
                                                                        <Link href={withReturnTo(`/invoices/${nota._id}`)} style={{ color: 'var(--color-primary)' }}>
                                                                            {nota.notaDisplayNumber || nota.notaNumber}
                                                                        </Link>
                                                                    </span>
                                                                ))}
                                                                )
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {hasHoldCargo && (
                                                    <div className="text-muted text-sm">
                                                        Hold / transit: {formatCargoSummary(holdCargoSummary || {})}
                                                    </div>
                                                )}
                                                {hasReturnCargo && (
                                                    <div className="text-muted text-sm">
                                                        Retur: {formatCargoSummary(returnCargoSummary || {})}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                    <td><span className={`badge badge-${doStatusMeta.color}`}><span className="badge-dot" /> {doStatusMeta.label}</span></td>
                                    <td><Link href={withReturnTo(`/delivery-orders/${d._id}`)} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* Notas */}
            <div className="card mt-6">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                        <span className="card-header-title">Invoice Ongkos ({notas.length})</span>
                </div>
                <div className="table-wrapper">
                    <table>
                                <thead><tr><th>No. Invoice</th><th>Tanggal</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {notas.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>
                                        {billableReadyDoCount === 0 ? 'Belum ada SJ siap tagih pada order ini' : 'Belum ada invoice untuk order ini'}
                                    </td>
                                </tr>
                            ) : notas.map(nota => (
                                <tr key={nota._id}>
                                    <td><Link href={withReturnTo(`/invoices/${nota._id}`)} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{nota.notaNumber}</Link></td>
                                    <td>{formatDate(nota.issueDate)}</td>
                                    <td className="font-medium">{formatCurrency(getReceivableNetAmount(nota))}</td>
                                    <td><span className={`badge badge-${INVOICE_STATUS_MAP[nota.status]?.color}`}><span className="badge-dot" /> {INVOICE_STATUS_MAP[nota.status]?.label}</span></td>
                                    <td><Link href={withReturnTo(`/invoices/${nota._id}`)} className="table-action-btn"><Eye size={14} /> Lihat</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <AuditTrailCard
                title="Riwayat Perubahan Order / Trip"
                subtitle="Mencatat perubahan order, trip, item, dan invoice terkait order ini."
                entityRefs={auditTrailEntityRefs}
            />

            {showAddTripModal && (
                <div className="modal-overlay" onClick={() => { if (!savingTripPlan && !deletingTripPlanKey) closeTripPlanModal(); }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                {tripPlanModalMode === 'edit' ? 'Edit Rencana Trip' : 'Tambah Rencana Trip'}
                            </h3>
                            <button className="modal-close" onClick={closeTripPlanModal} disabled={savingTripPlan || Boolean(deletingTripPlanKey)}>&times;</button>
                        </div>
                        <div className="modal-body" style={{ display: 'grid', gap: '1rem' }}>
                            <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}>
                                <div className="text-muted text-sm">Customer order</div>
                                <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{order?.customerName || '-'}</div>
                                <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                    Customer mengikuti order ini dan tidak bisa diubah dari form tambah trip.
                                </div>
                            </div>

                            {tripPlanModalMode === 'edit' && (
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Pilih Trip yang Diedit <span className="required">*</span></label>
                                    <select
                                        className="form-select"
                                        value={selectedTripPlanActionKey}
                                        onChange={event => selectTripPlanForModalAction(event.target.value)}
                                        disabled={savingTripPlan}
                                    >
                                        <option value="">Pilih rencana trip yang belum punya SJ</option>
                                        {editableOrderTripPlans.map(tripPlan => (
                                            <option key={tripPlan._key} value={tripPlan._key}>
                                                Trip {tripPlan.sequence} - {tripPlan.vehiclePlate || 'Tanpa kendaraan'} / {tripPlan.driverName || 'Tanpa supir'}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        Ganti pilihan di sini untuk langsung memuat trip lain tanpa menutup form.
                                    </div>
                                </div>
                            )}

                            {tripPlanModalMode === 'edit' && !editingTripPlanKey ? (
                                <div style={{ border: '1px dashed var(--color-gray-300)', borderRadius: '0.75rem', padding: '0.95rem 1rem', background: 'var(--color-gray-50)' }}>
                                    <div className="font-semibold">Pilih trip dulu untuk diedit</div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>
                                        Setelah dipilih, form edit akan muncul di bawah dropdown ini.
                                    </div>
                                </div>
                            ) : (
                                <>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Pickup untuk Trip Ini <span className="required">*</span></label>
                                <div style={{ display: 'grid', gap: '0.6rem' }}>
                                    {selectedTripDraftPickupStops.length === 0 ? (
                                        <div style={{ border: '1px dashed var(--color-gray-300)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-gray-50)' }}>
                                            <div className="text-muted text-sm">Belum ada pickup di rencana trip ini. Tambahkan pickup satu per satu agar form tetap ringkas.</div>
                                        </div>
                                    ) : (
                                        selectedTripDraftPickupStops.map((pickupStop, index) => (
                                            <div
                                                key={pickupStop._key}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'flex-start',
                                                    gap: '0.75rem',
                                                    padding: '0.75rem 0.9rem',
                                                    borderRadius: '0.75rem',
                                                    border: '1px solid var(--color-primary)',
                                                    background: 'var(--color-primary-50)',
                                                }}
                                            >
                                                <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                    <span style={{ fontWeight: 600 }}>
                                                        Pickup {index + 1}{pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}{'fromMaster' in pickupStop && pickupStop.fromMaster ? ' (Master)' : ''}
                                                    </span>
                                                    <span className="text-muted text-sm">{pickupStop.pickupAddress || '-'}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-ghost btn-icon-only"
                                                    onClick={() => toggleTripDraftPickupStop(pickupStop._key, false)}
                                                    disabled={savingTripPlan}
                                                    title="Hapus pickup dari rencana trip"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <select
                                            className="form-select"
                                            style={{ flex: '1 1 260px' }}
                                            value={tripDraftPickupToAdd}
                                            onChange={event => setTripDraftPickupToAdd(event.target.value)}
                                            disabled={savingTripPlan || availableTripDraftPickupStops.length === 0}
                                        >
                                            <option value="">
                                                {availableTripDraftPickupStops.length > 0 ? 'Pilih pickup untuk ditambahkan' : 'Semua pickup sudah ditambahkan'}
                                            </option>
                                            {availableTripDraftPickupStops.map((pickupStop, index) => (
                                                <option key={pickupStop._key} value={pickupStop._key}>
                                                    Pickup {index + 1}{pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}{pickupStop.pickupAddress ? ` | ${pickupStop.pickupAddress}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={addTripDraftPickupStop}
                                            disabled={savingTripPlan || !tripDraftPickupToAdd}
                                        >
                                            <Plus size={16} /> Tambah Pickup
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kendaraan <span className="required">*</span></label>
                                    <select className="form-select" value={tripDraft.vehicleRef} onChange={event => updateTripDraftField('vehicleRef', event.target.value)} disabled={savingTripPlan}>
                                        <option value="">Pilih kendaraan</option>
                                        {availableTripDraftVehicles.map(vehicle => (
                                            <option key={vehicle._id} value={vehicle._id}>
                                                {vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}{vehicle.plateNumber || vehicle._id}
                                                {vehicle.serviceName ? ` (${vehicle.serviceName})` : ''} | {formatUnitCapacityLabel(vehicle)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Supir <span className="required">*</span></label>
                                    <select className="form-select" value={tripDraft.driverRef} onChange={event => updateTripDraftField('driverRef', event.target.value)} disabled={savingTripPlan}>
                                        <option value="">Pilih supir</option>
                                        {availableTripDraftDrivers.map(driver => (
                                            <option key={driver._id} value={driver._id}>
                                                {driver.name}{driver.phone ? ` - ${driver.phone}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {requiresTripDraftOverrideReason && (
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Alasan Override Armada <span className="required">*</span></label>
                                    <textarea
                                        className="form-textarea"
                                        rows={2}
                                        value={tripDraft.vehicleOverrideReason}
                                        onChange={event => updateTripDraftField('vehicleOverrideReason', event.target.value)}
                                        placeholder="Mis. armada sesuai tidak tersedia atau load harus dipecah"
                                        disabled={savingTripPlan}
                                    />
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Asal Area Trip</label>
                                    <select
                                        className="form-select"
                                        value={tripDraft.tripOriginArea}
                                        onChange={event => updateTripDraftRouteSelection(event.target.value, '')}
                                        disabled={savingTripPlan}
                                    >
                                        <option value="">Pilih asal area</option>
                                        {tripDraftOriginAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tujuan Area Trip</label>
                                    <select
                                        className="form-select"
                                        value={tripDraft.tripDestinationArea}
                                        onChange={event => updateTripDraftRouteSelection(tripDraft.tripOriginArea, event.target.value)}
                                        disabled={savingTripPlan || !tripDraft.tripOriginArea}
                                    >
                                        <option value="">Pilih tujuan area</option>
                                        {tripDraftDestinationAreaOptions.map(area => <option key={area} value={area}>{area}</option>)}
                                    </select>
                                </div>
                            </div>

                            {matchedTripDraftRate && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--color-primary-700)', background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)', padding: '0.75rem 0.9rem', borderRadius: '0.75rem' }}>
                                    Tarif master: {formatTripRouteRateLabel(matchedTripDraftRate)} | {matchedTripDraftRate.rate.toLocaleString('id-ID')}
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Upah Trip <span className="required">*</span></label>
                                    <FormattedNumberInput
                                        allowDecimal={false}
                                        value={isTripDraftFeeLockedToMaster ? (matchedTripDraftRate?.rate || 0) : tripDraft.tripFee}
                                        onValueChange={value => updateTripDraftField('tripFee', value)}
                                        placeholder="Isi upah trip"
                                        disabled={savingTripPlan || isTripDraftFeeLockedToMaster}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Trip</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={tripDraft.date}
                                        onChange={event => updateTripDraftField('date', event.target.value)}
                                        disabled={savingTripPlan}
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kas / Bank Uang Jalan <span className="required">*</span></label>
                                    <select className="form-select" value={tripDraft.issueBankRef} onChange={event => updateTripDraftField('issueBankRef', event.target.value)} disabled={savingTripPlan}>
                                        <option value="">Pilih sumber uang jalan</option>
                                        {activeIssueBankAccounts.map(account => (
                                            <option key={account._id} value={account._id}>
                                                {account.bankName}{account.accountNumber ? ` - ${account.accountNumber}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Uang Jalan Awal <span className="required">*</span></label>
                                    <FormattedNumberInput
                                        allowDecimal={false}
                                        value={tripDraft.cashGiven}
                                        onValueChange={value => updateTripDraftField('cashGiven', value)}
                                        placeholder="Isi uang jalan awal"
                                        disabled={savingTripPlan}
                                    />
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Catatan Trip</label>
                                <input
                                    className="form-input"
                                    value={tripDraft.notes}
                                    onChange={event => updateTripDraftField('notes', event.target.value)}
                                    placeholder="Catatan opsional"
                                    disabled={savingTripPlan}
                                />
                            </div>
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeTripPlanModal} disabled={savingTripPlan || Boolean(deletingTripPlanKey)}>Batal</button>
                            <button className="btn btn-primary" onClick={handleAddTripPlan} disabled={savingTripPlan || (tripPlanModalMode === 'edit' && !editingTripPlanKey)}>
                                <Plus size={16} /> {savingTripPlan ? 'Menyimpan Trip...' : (editingTripPlanKey ? 'Simpan Perubahan Trip' : 'Simpan Rencana Trip')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTripPlanActionModal && (
                <div className="modal-overlay" onClick={() => { if (!deletingTripPlanKey) closeTripPlanActionModal(); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{tripPlanModalMode === 'delete' ? 'Pilih Trip untuk Dihapus' : 'Pilih Trip untuk Diedit'}</h3>
                            <button className="modal-close" onClick={closeTripPlanActionModal} disabled={Boolean(deletingTripPlanKey)}>&times;</button>
                        </div>
                        <div className="modal-body" style={{ display: 'grid', gap: '1rem' }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Rencana Trip <span className="required">*</span></label>
                                <select
                                    className="form-select"
                                    value={selectedTripPlanActionKey}
                                    onChange={event => selectTripPlanForModalAction(event.target.value)}
                                    disabled={Boolean(deletingTripPlanKey)}
                                >
                                    <option value="">Pilih rencana trip yang belum punya SJ</option>
                                    {editableOrderTripPlans.map(tripPlan => (
                                        <option key={tripPlan._key} value={tripPlan._key}>
                                            Trip {tripPlan.sequence} - {tripPlan.vehiclePlate || 'Tanpa kendaraan'} / {tripPlan.driverName || 'Tanpa supir'}
                                        </option>
                                    ))}
                                </select>
                                {editableOrderTripPlans.length === 0 && (
                                    <div className="text-muted text-sm" style={{ marginTop: '0.35rem' }}>
                                        Tidak ada rencana trip yang bisa diedit atau dihapus karena semuanya sudah memiliki SJ.
                                    </div>
                                )}
                            </div>

                            {tripPlanModalMode === 'delete' && selectedTripPlanForAction && (
                                <div style={{ padding: '0.8rem 0.9rem', borderRadius: '0.75rem', background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}>
                                    Trip {selectedTripPlanForAction.sequence} akan dihapus dari order ini.
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeTripPlanActionModal} disabled={Boolean(deletingTripPlanKey)}>Batal</button>
                            {tripPlanModalMode === 'delete' ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={continueSelectedTripPlanAction}
                                    disabled={!selectedTripPlanForAction || Boolean(deletingTripPlanKey)}
                                    style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                                >
                                    <Trash2 size={16} /> {deletingTripPlanKey ? 'Menghapus Trip...' : 'Hapus Trip Terpilih'}
                                </button>
                            ) : (
                                <div className="text-muted text-sm">Pilih trip untuk langsung membuka form edit.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showCancelOrderModal && (
                <div className="modal-overlay" onClick={() => { if (!cancellingOrder) setShowCancelOrderModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Batalkan Order/Resi</h3>
                            <button className="modal-close" onClick={() => setShowCancelOrderModal(false)} disabled={cancellingOrder}>&times;</button>
                        </div>
                        <div className="modal-body" style={{ display: 'grid', gap: '1rem' }}>
                            <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}>
                                Order/resi {order.masterResi} akan ditandai dibatalkan. Data order, trip yang sudah dibatalkan, dan riwayat audit tetap tersimpan.
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Catatan Pembatalan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={cancelOrderNote}
                                    onChange={event => setCancelOrderNote(event.target.value)}
                                    placeholder="Mis. customer membatalkan order / resi salah input"
                                    disabled={cancellingOrder}
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowCancelOrderModal(false)} disabled={cancellingOrder}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={() => void cancelOrder()}
                                disabled={cancellingOrder || !canCancelOrder}
                                style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                            >
                                <X size={16} /> {cancellingOrder ? 'Membatalkan...' : 'Batalkan Order'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showCancelTripModal && (
                <div className="modal-overlay" onClick={closeCancelTripModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Batalkan Trip</h3>
                            <button className="modal-close" onClick={closeCancelTripModal} disabled={cancellingTripPlan}>&times;</button>
                        </div>
                        <div className="modal-body" style={{ display: 'grid', gap: '1rem' }}>
                            <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-danger-light)', border: '1px solid var(--color-danger)', color: 'var(--color-danger)' }}>
                                {selectedCancelDeliveryOrder
                                    ? `Trip ${selectedCancelTripPlan?.sequence || '-'} dan ${formatInternalDeliveryOrderNumber(selectedCancelDeliveryOrder)} akan dibatalkan. Order/resi tetap aktif.`
                                    : `Rencana Trip ${selectedCancelTripPlan?.sequence || '-'} akan dibatalkan sebelum SJ dibuat. Order/resi tetap aktif.`}
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Catatan Pembatalan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={cancelTripNote}
                                    onChange={event => setCancelTripNote(event.target.value)}
                                    placeholder="Mis. muatan batal / armada diganti"
                                    disabled={cancellingTripPlan}
                                />
                            </div>
                            <div style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: '1rem' }}>
                                <div className="font-semibold" style={{ marginBottom: '0.35rem' }}>Pengeluaran Operasional Opsional</div>
                                <div className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>
                                    Isi hanya jika pembatalan menimbulkan biaya. Biaya ini masuk menu Pengeluaran, bukan bon driver.
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Tanggal</label>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={cancelTripExpenseForm.expenseDate}
                                            onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, expenseDate: event.target.value }))}
                                            disabled={cancellingTripPlan}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Kategori</label>
                                        <select
                                            className="form-select"
                                            value={cancelTripExpenseForm.categoryRef}
                                            onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, categoryRef: event.target.value }))}
                                            disabled={cancellingTripPlan || loadingCancelExpenseRefs || cancelTripOperationalCategories.length === 0}
                                        >
                                            {cancelTripOperationalCategories.length === 0 ? (
                                                <option value="">Tidak ada kategori pengeluaran umum aktif</option>
                                            ) : (
                                                cancelTripOperationalCategories.map(category => (
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
                                        disabled={cancellingTripPlan || loadingCancelExpenseRefs || cancelTripBankAccounts.length === 0}
                                    >
                                        {cancelTripBankAccounts.length === 0 ? (
                                            <option value="">Tidak ada kas / bank aktif</option>
                                        ) : (
                                            cancelTripBankAccounts.map(account => (
                                                <option key={account._id} value={account._id}>
                                                    {account.bankName}{account.accountNumber ? ` - ${account.accountNumber}` : ''}
                                                </option>
                                            ))
                                        )}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Deskripsi</label>
                                    <input
                                        className="form-input"
                                        value={cancelTripExpenseForm.description}
                                        onChange={event => setCancelTripExpenseForm(prev => ({ ...prev, description: event.target.value }))}
                                        placeholder="Mis. solar perjalanan ke pickup"
                                        disabled={cancellingTripPlan}
                                    />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Nominal</label>
                                    <FormattedNumberInput
                                        allowDecimal={false}
                                        min={0}
                                        className="form-input"
                                        value={cancelTripExpenseForm.amount}
                                        onValueChange={value => setCancelTripExpenseForm(prev => ({ ...prev, amount: value }))}
                                        placeholder="Isi jika ada biaya keluar"
                                        disabled={cancellingTripPlan}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeCancelTripModal} disabled={cancellingTripPlan}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={cancelTripFromOrder}
                                disabled={
                                    cancellingTripPlan ||
                                    (cancelTripExpenseForm.amount > 0 && (!cancelTripExpenseForm.categoryRef || !cancelTripExpenseForm.bankAccountRef))
                                }
                                style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                            >
                                {cancellingTripPlan ? 'Membatalkan...' : 'Batalkan Trip'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create DO Modal */}
            {showDOModal && (
                <div className="modal-overlay" onClick={() => { if (!creatingDO) { setShowDOModal(false); setSelectedOrderTripPlanKey(''); } }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{selectedOrderTripPlan ? `Input Surat Jalan Trip ${selectedOrderTripPlan.sequence}` : 'Buat Surat Jalan'}</h3>
                            <button className="modal-close" onClick={() => { setShowDOModal(false); setSelectedOrderTripPlanKey(''); }} disabled={creatingDO}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal</label>
                                    <input type="date" className="form-input" value={doDate} onChange={e => setDoDate(e.target.value)} disabled={creatingDO} />
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        No. DO internal otomatis mengikuti tanggal ini: <strong>{internalDoPreviewPeriod}</strong>.
                                    </div>
                                </div>
                                {!isHeaderOnlyOrder && (
                                    <div className="form-group">
                                        <label className="form-label">No. SJ Pengirim</label>
                                        <input
                                            className="form-input"
                                            value={doCustomerDoNumber}
                                            onChange={e => setDoCustomerDoNumber(e.target.value.toUpperCase())}
                                            placeholder="Isi sesuai surat jalan dari pengirim"
                                            disabled={creatingDO}
                                        />
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            Boleh dikosongkan dulu. Format referensi customer: <strong>{normalizedShipperReferenceFormat}</strong>, misalnya <strong>{shipperReferenceExample}</strong>.
                                        </div>
                                    </div>
                                )}
                            </div>
                            {selectedOrderTripPlan && (
                                <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Kendaraan</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{selectedOrderTripPlan.vehiclePlate || '-'}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Supir</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{selectedOrderTripPlan.driverName || '-'}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Upah Trip</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{formatCurrency(selectedOrderTripPlan.taripBorongan || 0)}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Uang Jalan Awal</div>
                                            <div className="font-semibold" style={{ marginTop: '0.2rem' }}>{formatCurrency(selectedOrderTripPlan.cashGiven || 0)}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {selectablePickupStops.length > 0 && (
                                <div className="form-group">
                                    <label className="form-label">Titik Pickup untuk Trip Ini</label>
                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                        <select
                                            className="form-select"
                                            value=""
                                            disabled={creatingDO || selectablePickupStops.every(pickupStop => selectedPickupStopKeys.includes(pickupStop._key))}
                                            onChange={event => {
                                                const nextKey = event.target.value;
                                                if (!nextKey) {
                                                    return;
                                                }
                                                setSelectedPickupStopKeys(previous => (
                                                    previous.includes(nextKey) ? previous : [...previous, nextKey]
                                                ));
                                            }}
                                        >
                                            <option value="">Tambah titik pickup dari master...</option>
                                            {selectablePickupStops
                                                .filter(pickupStop => !selectedPickupStopKeys.includes(pickupStop._key))
                                                .map((pickupStop, index) => (
                                                    <option key={pickupStop._key} value={pickupStop._key}>
                                                        {`Pickup ${index + 1}${pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}${'fromMaster' in pickupStop && pickupStop.fromMaster ? ' (Master)' : ''} - ${pickupStop.pickupAddress}`}
                                                    </option>
                                                ))}
                                        </select>
                                        {selectedTripPickupStops.length === 0 ? (
                                            <div className="text-muted text-sm">Belum ada titik pickup dipilih.</div>
                                        ) : (
                                            <div style={{ display: 'grid', gap: '0.5rem' }}>
                                                {selectedTripPickupStops.map((pickupStop, index) => (
                                                    <div
                                                        key={pickupStop._key}
                                                        style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            gap: '0.75rem',
                                                            padding: '0.85rem 1rem',
                                                            borderRadius: '0.75rem',
                                                            border: '1px solid var(--color-primary)',
                                                            background: 'var(--color-primary-50)',
                                                        }}
                                                    >
                                                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                                                            <span style={{ fontWeight: 600 }}>
                                                                Pickup {index + 1}{pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}
                                                                {'fromMaster' in pickupStop && pickupStop.fromMaster ? ' (Master)' : ''}
                                                            </span>
                                                            <span className="text-muted text-sm">{pickupStop.pickupAddress}</span>
                                                            {pickupStop.notes && <span className="text-muted text-sm">{pickupStop.notes}</span>}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-icon-only"
                                                            onClick={() => setSelectedPickupStopKeys(previous => previous.filter(value => value !== pickupStop._key))}
                                                            disabled={creatingDO}
                                                            title="Hapus pickup dari trip ini"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {/*
                                            const checked = selectedPickupStopKeys.includes(pickupStop._key);
                                            return (
                                                <label
                                                    key={pickupStop._key}
                                                    style={{
                                                        display: 'grid',
                                                        gap: '0.25rem',
                                                        padding: '0.85rem 1rem',
                                                        borderRadius: '0.75rem',
                                                        border: checked ? '1px solid var(--color-primary)' : '1px solid var(--color-gray-200)',
                                                        background: checked ? 'var(--color-primary-50)' : 'var(--color-gray-50)',
                                                        cursor: creatingDO ? 'default' : 'pointer',
                                                    }}
                                                >
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={creatingDO}
                                                            onChange={event => {
                                                                setSelectedPickupStopKeys(previous => (
                                                                    event.target.checked
                                                                        ? [...previous, pickupStop._key]
                                                                        : previous.filter(value => value !== pickupStop._key)
                                                                ));
                                                            }}
                                                        />
                                                        <span style={{ fontWeight: 600 }}>Pickup {index + 1}{pickupStop.pickupLabel ? ` · ${pickupStop.pickupLabel}` : ''}</span>
                                                    </span>
                                                    <span className="text-muted text-sm">{pickupStop.pickupAddress}</span>
                                                    {pickupStop.notes && <span className="text-muted text-sm">{pickupStop.notes}</span>}
                                                </label>
                                            );
                                        */}
                                    </div>
                                </div>
                            )}
                            {!selectedOrderTripPlan && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kendaraan</label>
                                        <select className="form-select" value={doVehicle} onChange={e => setDoVehicle(e.target.value)} disabled={creatingDO}>
                                            <option value="">Pilih kendaraan</option>
                                            {availableVehicles.map(vehicle => (
                                                <option key={vehicle._id} value={vehicle._id}>
                                                    {vehicle.unitCode ? `${vehicle.unitCode} - ` : ''}{vehicle.plateNumber}
                                                    {vehicle.serviceName ? ` (${vehicle.serviceName})` : ' (Kategori belum diisi)'} | {formatUnitCapacityLabel(vehicle)}
                                                </option>
                                            ))}
                                        </select>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            {availableVehicles.length === 0
                                                ? 'Tidak ada kendaraan kosong. Semua kendaraan operasional sedang dipakai DO aktif atau belum selesai.'
                                                : order.serviceRef
                                                    ? `Order meminta kategori ${order.serviceName || '-'} dengan batas muatan ${requestedServiceCapacityLabel}. Kendaraan kosong yang cocok ditampilkan lebih dulu, tetapi override tetap boleh jika alasannya dicatat.`
                                                    : 'Hanya kendaraan yang sedang kosong yang ditampilkan. Order ini belum punya kategori armada, jadi semua kendaraan operasional yang tidak sedang dipakai tetap tersedia.'}
                                        </div>
                                        {selectedVehicleData && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary-700)', marginTop: '0.35rem', fontWeight: 600 }}>
                                                Kendaraan terpilih: {selectedVehicleCapacityLabel}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            {!selectedOrderTripPlan && requiresVehicleOverrideReason && (
                                <div
                                    style={{
                                        background: 'var(--color-warning-light)',
                                        border: '1px solid rgba(234, 179, 8, 0.35)',
                                        borderRadius: '0.75rem',
                                        padding: '0.85rem 1rem',
                                        marginBottom: '1rem',
                                    }}
                                >
                                    <div style={{ fontWeight: 600, color: 'var(--color-warning-dark)', marginBottom: '0.35rem' }}>
                                        Armada aktual berbeda dari armada order
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-warning-dark)', marginBottom: '0.75rem' }}>
                                        Order meminta <strong>{order.serviceName || '-'}</strong>, tetapi trip ini memakai <strong>{selectedVehicleData?.serviceName || 'kendaraan tanpa kategori'}</strong>.
                                        Ini boleh untuk pengiriman parsial, asalkan alasannya dicatat.
                                    </div>
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">Alasan Override Armada</label>
                                        <textarea
                                            className="form-textarea"
                                            rows={2}
                                            value={doVehicleOverrideReason}
                                            onChange={e => setDoVehicleOverrideReason(e.target.value)}
                                            placeholder="Mis. sisa muatan lebih besar, armada awal tidak tersedia, atau permintaan customer berubah"
                                            disabled={creatingDO}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={doNotes} onChange={e => setDoNotes(e.target.value)} placeholder="Catatan opsional..." disabled={creatingDO} />
                            </div>
                            <div className="form-section-title">{isHeaderOnlyOrder && !usesExistingItemsForDeliveryOrder ? 'Input Barang Surat Jalan' : 'Pilih Item untuk DO'}</div>
                            {isHeaderOnlyOrder && !usesExistingItemsForDeliveryOrder ? (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Draft SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{directCargoGroups.length} SJ</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Barang dicatat</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{draftDirectCargoItems.length} barang</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan rencana</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {draftDirectCargoItems.length > 0 ? formatCargoSummary(directCargoSummary) : 'Belum ada barang'}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gap: '0.85rem' }}>
                                        {directCargoGroups.map((group, groupIndex) => {
                                            const draftItemsInGroup = getDirectCargoGroupDraftItems(group);
                                            return (
                                                <div key={group.id} style={{ display: 'grid', gap: '0.85rem', padding: '1rem', background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-gray-200)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <div>
                                                            <div className="font-semibold">SJ {groupIndex + 1}</div>
                                                            <div className="text-muted text-sm">{draftItemsInGroup.length} barang</div>
                                                        </div>
                                                        {directCargoGroups.length > 1 && (
                                                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeDirectCargoGroup(group.id)} disabled={creatingDO}>
                                                                <X size={14} /> Hapus SJ
                                                            </button>
                                                        )}
                                                    </div>
                                                    {resolvedOrderPickupStops.length > 0 && (
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">Titik Pickup</label>
                                                            <select
                                                                className="form-select"
                                                                value={group.pickupStopKey}
                                                                onChange={e => updateDirectCargoGroup(group.id, 'pickupStopKey', e.target.value)}
                                                                disabled={creatingDO}
                                                            >
                                                                <option value="">Pilih titik pickup</option>
                                                                {selectedTripPickupStops.map((pickupStop, pickupIndex) => (
                                                                    <option key={pickupStop._key} value={pickupStop._key}>
                                                                        {`Pickup ${pickupIndex + 1}${pickupStop.pickupLabel ? ` - ${pickupStop.pickupLabel}` : ''}`}
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
                                                            onChange={e => updateDirectCargoGroup(group.id, 'shipperReferenceNumber', e.target.value.toUpperCase())}
                                                            placeholder={`Mis. ${shipperReferenceExample}`}
                                                            disabled={creatingDO}
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
                                                                        onChange={e => applyDirectCargoProductSelection(group.id, itemIndex, e.target.value)}
                                                                        disabled={creatingDO || !order.customerRef}
                                                                    >
                                                                        <option value="">{customerProducts.length > 0 ? 'Pilih dari master barang customer (opsional)' : 'Belum ada master barang customer'}</option>
                                                                        {customerProducts.map(product => (
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
                                                                        onChange={e => updateDirectCargoGroupItem(group.id, itemIndex, 'description', e.target.value)}
                                                                        placeholder="Mis. Oli Diesel 10W-40 / Beras 50 kg / Keramik"
                                                                        disabled={creatingDO}
                                                                    />
                                                                </div>
                                                                <div style={{ flex: '0 1 110px' }}>
                                                                    <label className="form-label">Koli</label>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        allowDecimal={false}
                                                                        value={item.qtyKoli}
                                                                        onValueChange={value => updateDirectCargoGroupItem(group.id, itemIndex, 'qtyKoli', value)}
                                                                        disabled={creatingDO}
                                                                    />
                                                                </div>
                                                                <div style={{ flex: '1 1 180px' }}>
                                                                    <label className="form-label">Berat</label>
                                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                                        <FormattedNumberInput
                                                                            min={0}
                                                                            maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)}
                                                                            value={item.weightInputValue}
                                                                            onValueChange={value => updateDirectCargoGroupItem(group.id, itemIndex, 'weightInputValue', value)}
                                                                            disabled={creatingDO || shouldLockOrderItemWeight(item)}
                                                                        />
                                                                        <select
                                                                            className="form-select"
                                                                            value={item.weightInputUnit}
                                                                            onChange={e => setDirectCargoGroups(previous => previous.map(entry => (
                                                                                entry.id === group.id
                                                                                    ? {
                                                                                        ...entry,
                                                                                        items: entry.items.map((groupItem, currentItemIndex) => (
                                                                                            currentItemIndex === itemIndex
                                                                                                ? updateOrderItemWeightUnit({ ...groupItem, pickupStopKey: entry.pickupStopKey, shipperReferenceNumber: entry.shipperReferenceNumber }, e.target.value as WeightInputUnit)
                                                                                                : { ...groupItem, pickupStopKey: entry.pickupStopKey, shipperReferenceNumber: entry.shipperReferenceNumber }
                                                                                        )).map(groupItem => toDirectCargoGroupItem(groupItem)),
                                                                                    }
                                                                                    : entry
                                                                            )))}
                                                                            style={{ width: 92 }}
                                                                            disabled={creatingDO || shouldLockOrderItemVolume(item)}
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
                                                                            onValueChange={value => updateDirectCargoGroupItem(group.id, itemIndex, 'volumeInputValue', value)}
                                                                            disabled={creatingDO}
                                                                        />
                                                                        <select
                                                                            className="form-select"
                                                                            value={item.volumeInputUnit}
                                                                            onChange={e => setDirectCargoGroups(previous => previous.map(entry => (
                                                                                entry.id === group.id
                                                                                    ? {
                                                                                        ...entry,
                                                                                        items: entry.items.map((groupItem, currentItemIndex) => (
                                                                                            currentItemIndex === itemIndex
                                                                                                ? updateOrderItemVolumeUnit({ ...groupItem, pickupStopKey: entry.pickupStopKey, shipperReferenceNumber: entry.shipperReferenceNumber }, e.target.value as VolumeInputUnit)
                                                                                                : { ...groupItem, pickupStopKey: entry.pickupStopKey, shipperReferenceNumber: entry.shipperReferenceNumber }
                                                                                        )).map(groupItem => toDirectCargoGroupItem(groupItem)),
                                                                                    }
                                                                                    : entry
                                                                            )))}
                                                                            style={{ width: 92 }}
                                                                            disabled={creatingDO}
                                                                        >
                                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                                {group.items.length > 1 && (
                                                                    <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeDirectCargoGroupItem(group.id, itemIndex)} disabled={creatingDO} style={{ marginBottom: 4 }}>
                                                                        <X size={18} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => addDirectCargoGroupItem(group.id)} disabled={creatingDO}>
                                                            <Plus size={14} /> Tambah Barang di SJ Ini
                                                        </button>
                                                        <div className="text-muted text-sm">Satu SJ bisa berisi banyak barang.</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                                        <div className="text-muted text-sm">
                                            Kalau manifest belum final, buat trip dulu lalu lengkapi SJ dan barang dari detail DO.
                                        </div>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={addDirectCargoGroup} disabled={creatingDO}>
                                            <Plus size={14} /> Tambah SJ
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item dipilih</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{selectedShipmentItemCount} item</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan trip ini</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedShipmentItemCount > 0 ? formatCargoSummary(selectedShipmentTotals) : 'Belum ada item dipilih'}
                                            </div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item ditahan</div>
                                            <div className="font-semibold" style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{selectedHoldCount} item</div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                                        <div className="text-muted text-sm">
                                            {selectedShipmentItemCount > 0
                                                ? 'Trip ini sudah siap dibuat. Koreksi hanya item yang memang perlu parsial atau hold.'
                                                : 'Belum ada item dipilih. Untuk trip normal, gunakan pilih semua yang siap jalan.'}
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={selectAllAvailableItems} disabled={creatingDO || availableItems.length === 0}>
                                                Pilih Semua Siap Jalan
                                            </button>
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedShipments} disabled={creatingDO || selectedShipmentItemCount === 0}>
                                                Kosongkan Pilihan
                                            </button>
                                        </div>
                                    </div>
                                    {availableItems.length === 0 ? (
                                        <p className="text-muted text-sm">Semua item sudah masuk surat jalan</p>
                                    ) : (
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                                            <table>
                                                <thead><tr><th style={{ width: 40 }}></th><th>Item</th><th>Progress</th><th>Rencana Kirim</th><th>Tahan Sisa (Opsional)</th></tr></thead>
                                                <tbody>
                                                    {availableItems.map(item => {
                                                const selection = selectedShipments[item._id];
                                                const progressInfo = itemProgressById[item._id];
                                                const hasHeldCargo =
                                                    progressInfo.heldQtyKoli > 0 ||
                                                    progressInfo.heldWeight > 0 ||
                                                    progressInfo.heldVolume > 0;
                                                const usesQtyBasis = progressInfo.totalQtyKoli > 0;
                                                const selectedQty = parseFormattedNumberish(selection?.qtyKoli || 0, { maxFractionDigits: 2 });
                                                const shippedWeightPreview = selectedQty > 0
                                                    ? calculateWeightPortion(progressInfo.totalWeight, progressInfo.totalQtyKoli, selectedQty)
                                                    : 0;
                                                const selectedNonKoliCargo = buildSelectedNonKoliCargo(selection);
                                                const plannedNonKoliCargo = selection
                                                    ? selectedNonKoliCargo
                                                    : {
                                                        qtyKoli: 0,
                                                        weightKg: progressInfo.pendingWeight,
                                                        volumeM3: progressInfo.pendingVolume,
                                                    };
                                                const remainingAfterShipment = roundQuantity(Math.max(progressInfo.pendingQtyKoli - selectedQty, 0));
                                                const remainingNonKoliCargo = {
                                                    qtyKoli: 0,
                                                    weightKg: roundQuantity(Math.max(progressInfo.pendingWeight - selectedNonKoliCargo.weightKg, 0)),
                                                    volumeM3: roundQuantity(Math.max(progressInfo.pendingVolume - selectedNonKoliCargo.volumeM3, 0), 3),
                                                };
                                                const hasNonKoliRemaining = hasCargoAggregate(remainingNonKoliCargo);
                                                return (
                                                    <tr key={item._id}>
                                                        <td>
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(selection)}
                                                                disabled={creatingDO}
                                                                onChange={e => {
                                                                    if (e.target.checked) {
                                                                        setSelectedShipments(prev => ({
                                                                            ...prev,
                                [item._id]: createDefaultShipmentSelection(item),
                                                                        }));
                                                                    } else {
                                                                        setSelectedShipments(prev => {
                                                                            const next = { ...prev };
                                                                            delete next[item._id];
                                                                            return next;
                                                                        });
                                                                    }
                                                                }}
                                                            />
                                                        </td>
                                                        <td>
                                                            <div className="font-medium">{item.description}</div>
                                                            {hasHeldCargo && (
                                                                <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                                    <span className="badge badge-warning"><span className="badge-dot" /> Hold / Inap di SJ asal</span>
                                                                    {item.holdLocation && <span className="text-muted text-sm">{item.holdLocation}</span>}
                                                                </div>
                                                            )}
                                                            {(item.customerProductCode || item.customerProductName) && (
                                                                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                                                    {item.customerProductCode ? `${item.customerProductCode} - ` : ''}{item.customerProductName || 'Master barang customer'}
                                                                </div>
                                                            )}
                                                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                                                                Total {formatCargoSummary({
                                                                    qtyKoli: progressInfo.totalQtyKoli,
                                                                    weightKg: item.weight,
                                                                    weightInputValue: item.weightInputValue,
                                                                    weightInputUnit: item.weightInputUnit,
                                                                    volumeM3: item.volume,
                                                                    volumeInputValue: item.volumeInputValue,
                                                                    volumeInputUnit: item.volumeInputUnit,
                                                                })}
                                                            </div>
                                                        </td>
                                                        <td style={{ minWidth: 180 }}>
                                                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                                <div>
                                                                    Terkirim:{' '}
                                                                    {formatCargoSummary({
                                                                        qtyKoli: progressInfo.deliveredQtyKoli,
                                                                        weightKg: progressInfo.deliveredWeight,
                                                                        volumeM3: progressInfo.deliveredVolume,
                                                                    })}
                                                                </div>
                                                                <div>
                                                                    Ditahan:{' '}
                                                                    {formatCargoSummary({
                                                                        qtyKoli: progressInfo.heldQtyKoli,
                                                                        weightKg: progressInfo.heldWeight,
                                                                        volumeM3: progressInfo.heldVolume,
                                                                    })}
                                                                </div>
                                                                <div>
                                                                    Pending siap trip:{' '}
                                                                    {formatCargoSummary({
                                                                        qtyKoli: progressInfo.pendingQtyKoli,
                                                                        weightKg: progressInfo.pendingWeight,
                                                                        volumeM3: progressInfo.pendingVolume,
                                                                    })}
                                                                </div>
                                                                {hasHeldCargo && (
                                                                    <div>
                                                                        Terkunci di SJ asal:{' '}
                                                                        {formatCargoSummary({
                                                                            qtyKoli: progressInfo.heldQtyKoli,
                                                                            weightKg: progressInfo.heldWeight,
                                                                            volumeM3: progressInfo.heldVolume,
                                                                        })} hold{item.holdReason ? ` - ${item.holdReason}` : ''}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td style={{ minWidth: 180 }}>
                                                            {usesQtyBasis ? (
                                                                <>
                                                                    <FormattedNumberInput
                                                                        min={0}
                                                                        maxFractionDigits={2}
                                                                        value={parseFormattedNumberish(selection?.qtyKoli || 0, { maxFractionDigits: 2 })}
                                                                        disabled={!selection || creatingDO}
                                                                onValueChange={value => {
                                                                            setSelectedShipments(prev => ({
                                                                                ...prev,
                                                                                [item._id]: {
                                    ...(prev[item._id] || createDefaultShipmentSelection(item)),
                                                                                    qtyKoli: String(value),
                                                                                },
                                                                            }));
                                                                        }}
                                                                    />
                                                                    {selection && (
                                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                                                            Perkiraan berat kirim: {formatNumber(shippedWeightPreview)} kg
                                                                            {((item.volumeInputValue || 0) > 0 || (item.volume || 0) > 0) && (
                                                                                <> | Volume referensi: {formatVolumeDisplay({
                                                                                    volumeM3: item.volume,
                                                                                    volumeInputValue: item.volumeInputValue,
                                                                                    volumeInputUnit: item.volumeInputUnit,
                                                                                    includeCanonical: true,
                                                                                })}</>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </>
                                                            ) : (
                                                                <div style={{ display: 'grid', gap: '0.35rem' }}>
                                                                    {selection ? (
                                                                        <>
                                                                            {progressInfo.pendingWeight > 0 && (
                                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                                    <label className="form-label">Berat Kirim</label>
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                                                        <FormattedNumberInput
                                                                                            min={0}
                                                                                            maxFractionDigits={getWeightInputFractionDigits(selection.weightInputUnit || 'KG')}
                                                                                            value={parseFormattedNumberish(selection.weightInputValue || 0, {
                                                                                                maxFractionDigits: getWeightInputFractionDigits(selection.weightInputUnit || 'KG'),
                                                                                            })}
                                                                                            disabled={!selection || creatingDO}
                                                                                            onValueChange={value => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        weightInputValue: String(value),
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        />
                                                                                        <select
                                                                                            className="form-select"
                                                                                            value={selection.weightInputUnit || 'KG'}
                                                                                            disabled={creatingDO}
                                                                                            onChange={e => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        weightInputUnit: e.target.value as WeightInputUnit,
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        >
                                                                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                                        </select>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                            {progressInfo.pendingVolume > 0 && (
                                                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                                                    <label className="form-label">Volume Kirim</label>
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                                                        <FormattedNumberInput
                                                                                            min={0}
                                                                                            maxFractionDigits={(selection.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3}
                                                                                            value={parseFormattedNumberish(selection.volumeInputValue || 0, {
                                                                                                maxFractionDigits: (selection.volumeInputUnit || 'M3') === 'LITER' ? 0 : 3,
                                                                                            })}
                                                                                            disabled={!selection || creatingDO}
                                                                                            onValueChange={value => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        volumeInputValue: String(value),
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        />
                                                                                        <select
                                                                                            className="form-select"
                                                                                            value={selection.volumeInputUnit || 'M3'}
                                                                                            disabled={creatingDO}
                                                                                            onChange={e => {
                                                                                                setSelectedShipments(prev => ({
                                                                                                    ...prev,
                                                                                                    [item._id]: {
                                                                                                        ...prev[item._id],
                                                                                                        volumeInputUnit: e.target.value as VolumeInputUnit,
                                                                                                    },
                                                                                                }));
                                                                                            }}
                                                                                        >
                                                                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                                                        </select>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                            <div className="detail-value" style={{ color: 'var(--color-primary)' }}>
                                                                                Yang ikut trip ini: {formatCargoSummary(plannedNonKoliCargo)}
                                                                            </div>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <div className="detail-value">Centang item untuk isi berat/volume yang ikut trip ini</div>
                                                                            <div className="text-muted text-sm">
                                                                                Item ini tidak memakai basis koli, jadi parsialnya dihitung dari berat dan/atau volume.
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td style={{ minWidth: 220 }}>
                                                            {selection ? (
                                                                <div style={{ display: 'grid', gap: '0.4rem' }}>
                                                                    {usesQtyBasis ? (
                                                                        <>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={selection.holdRemaining}
                                                                                    disabled={creatingDO || remainingAfterShipment <= 0}
                                                                                    onChange={e => {
                                                                                        setSelectedShipments(prev => ({
                                                                                            ...prev,
                                                                                            [item._id]: {
                                                                                                ...prev[item._id],
                                                                                                holdRemaining: e.target.checked,
                                                                                            },
                                                                                        }));
                                                                                    }}
                                                                                />
                                                                                Tahan sisa {formatNumber(remainingAfterShipment)} koli
                                                                            </label>
                                                                            {selection.holdRemaining && remainingAfterShipment > 0 && (
                                                                                <>
                                                                                    <input
                                                                                        className="form-input"
                                                                                        placeholder="Alasan hold, mis. gudang tujuan penuh"
                                                                                        value={selection.holdReason}
                                                                                        disabled={creatingDO}
                                                                                        onChange={e => {
                                                                                            const value = e.target.value;
                                                                                            setSelectedShipments(prev => ({
                                                                                                ...prev,
                                                                                                [item._id]: {
                                                                                                    ...prev[item._id],
                                                                                                    holdReason: value,
                                                                                                },
                                                                                            }));
                                                                                        }}
                                                                                    />
                                                                                    <input
                                                                                        className="form-input"
                                                                                        placeholder="Lokasi hold, mis. gudang transit"
                                                                                        value={selection.holdLocation}
                                                                                        disabled={creatingDO}
                                                                                        onChange={e => {
                                                                                            const value = e.target.value;
                                                                                            setSelectedShipments(prev => ({
                                                                                                ...prev,
                                                                                                [item._id]: {
                                                                                                    ...prev[item._id],
                                                                                                    holdLocation: value,
                                                                                                },
                                                                                            }));
                                                                                        }}
                                                                                    />
                                                                                </>
                                                                            )}
                                                                            {!selection.holdRemaining && remainingAfterShipment > 0 && (
                                                                                <span className="text-muted text-sm">Biarkan kosong kalau seluruh sisa pending tetap belum ditugaskan.</span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={selection.holdRemaining}
                                                                                    disabled={creatingDO || !hasNonKoliRemaining}
                                                                                    onChange={e => {
                                                                                        setSelectedShipments(prev => ({
                                                                                            ...prev,
                                                                                            [item._id]: {
                                                                                                ...prev[item._id],
                                                                                                holdRemaining: e.target.checked,
                                                                                            },
                                                                                        }));
                                                                                    }}
                                                                                />
                                                                                {hasNonKoliRemaining
                                                                                    ? `Tahan sisa ${formatCargoSummary(remainingNonKoliCargo)}`
                                                                                    : 'Semua sisa ikut trip ini'}
                                                                            </label>
                                                                            {selection.holdRemaining && hasNonKoliRemaining && (
                                                                                <>
                                                                                    <input
                                                                                        className="form-input"
                                                                                        placeholder="Alasan hold, mis. gudang tujuan penuh"
                                                                                        value={selection.holdReason}
                                                                                        disabled={creatingDO}
                                                                                        onChange={e => {
                                                                                            const value = e.target.value;
                                                                                            setSelectedShipments(prev => ({
                                                                                                ...prev,
                                                                                                [item._id]: {
                                                                                                    ...prev[item._id],
                                                                                                    holdReason: value,
                                                                                                },
                                                                                            }));
                                                                                        }}
                                                                                    />
                                                                                    <input
                                                                                        className="form-input"
                                                                                        placeholder="Lokasi hold, mis. gudang transit"
                                                                                        value={selection.holdLocation}
                                                                                        disabled={creatingDO}
                                                                                        onChange={e => {
                                                                                            const value = e.target.value;
                                                                                            setSelectedShipments(prev => ({
                                                                                                ...prev,
                                                                                                [item._id]: {
                                                                                                    ...prev[item._id],
                                                                                                    holdLocation: value,
                                                                                                },
                                                                                            }));
                                                                                        }}
                                                                                    />
                                                                                </>
                                                                            )}
                                                                            {!selection.holdRemaining && hasNonKoliRemaining && (
                                                                                <span className="text-muted text-sm">Biarkan kosong kalau sisa berat/volume pending tetap belum ditugaskan.</span>
                                                                            )}
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-muted text-sm">-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowDOModal(false); setSelectedOrderTripPlanKey(''); }} disabled={creatingDO}>Batal</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateDO}
                                disabled={creatingDO || (usesExistingItemsForDeliveryOrder && Object.keys(selectedShipments).length === 0)}
                            >
                                <Truck size={16} /> {creatingDO
                                    ? 'Membuat Surat Jalan...'
                                    : selectedOrderTripPlan
                                        ? (draftDirectCargoItems.length > 0 ? `Input Surat Jalan (${draftDirectCargoItems.length} barang)` : 'Input Surat Jalan (barang menyusul)')
                                          : isHeaderOnlyOrder && !usesExistingItemsForDeliveryOrder
                                            ? (draftDirectCargoItems.length > 0 ? `Buat Surat Jalan (${draftDirectCargoItems.length} barang)` : 'Buat Surat Jalan (barang menyusul)')
                                            : `Buat Surat Jalan (${Object.keys(selectedShipments).length} item)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showHoldModal && holdingItem && (
                <div className="modal-overlay" onClick={() => { if (!savingHold) { setShowHoldModal(false); setHoldingItem(null); } }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Tahan Sisa Item</h3>
                            <button className="modal-close" onClick={() => { setShowHoldModal(false); setHoldingItem(null); }} disabled={savingHold}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {(() => {
                                const progress = itemProgressById[holdingItem._id];
                                const usesQtyBasis = progress.totalQtyKoli > 0;
                                return (
                                    <>
                            <div className="form-group">
                                <label className="form-label">Item</label>
                                <div className="detail-value">{holdingItem.description}</div>
                            </div>
                            {usesQtyBasis ? (
                                <div className="form-group">
                                    <label className="form-label">Qty hold (koli)</label>
                                    <FormattedNumberInput
                                        min={0}
                                        maxFractionDigits={2}
                                        value={parseFormattedNumberish(holdQtyKoli || 0, { maxFractionDigits: 2 })}
                                        onValueChange={value => setHoldQtyKoli(String(value))}
                                        disabled={savingHold}
                                    />
                                </div>
                            ) : (
                                <>
                                    {progress.pendingWeight > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Berat Hold</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                <FormattedNumberInput
                                                    min={0}
                                                    maxFractionDigits={getWeightInputFractionDigits(holdWeightInputUnit)}
                                                    value={parseFormattedNumberish(holdWeightInputValue || 0, {
                                                        maxFractionDigits: getWeightInputFractionDigits(holdWeightInputUnit),
                                                    })}
                                                    onValueChange={value => setHoldWeightInputValue(String(value))}
                                                    disabled={savingHold}
                                                />
                                                <select className="form-select" value={holdWeightInputUnit} onChange={e => setHoldWeightInputUnit(e.target.value as WeightInputUnit)} disabled={savingHold}>
                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                    {progress.pendingVolume > 0 && (
                                        <div className="form-group">
                                            <label className="form-label">Volume Hold</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: '0.5rem' }}>
                                                <FormattedNumberInput
                                                    min={0}
                                                    maxFractionDigits={holdVolumeInputUnit === 'LITER' ? 0 : 3}
                                                    value={parseFormattedNumberish(holdVolumeInputValue || 0, {
                                                        maxFractionDigits: holdVolumeInputUnit === 'LITER' ? 0 : 3,
                                                    })}
                                                    onValueChange={value => setHoldVolumeInputValue(String(value))}
                                                    disabled={savingHold}
                                                />
                                                <select className="form-select" value={holdVolumeInputUnit} onChange={e => setHoldVolumeInputUnit(e.target.value as VolumeInputUnit)} disabled={savingHold}>
                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Alasan hold</label>
                                <input className="form-input" value={holdReason} onChange={e => setHoldReason(e.target.value)} disabled={savingHold} placeholder="Mis. gudang tujuan penuh" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Lokasi hold</label>
                                <input className="form-input" value={holdLocation} onChange={e => setHoldLocation(e.target.value)} disabled={savingHold} placeholder="Mis. gudang transit Surabaya" />
                            </div>
                                    </>
                                );
                            })()}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowHoldModal(false); setHoldingItem(null); }} disabled={savingHold}>Batal</button>
                            <button className="btn btn-primary" onClick={() => void saveHoldQuantity()} disabled={savingHold}>
                                {savingHold ? 'Menyimpan Hold...' : 'Simpan Hold'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

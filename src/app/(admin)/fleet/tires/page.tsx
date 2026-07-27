'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp, useToast } from '../../layout';
import { Plus, Search, Disc3, CheckCircle, Warehouse, History, Wrench } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import SortableTableHeader, { type SortDirection } from '@/components/SortableTableHeader';
import { getBusinessDateValue } from '@/lib/business-date';
import { fetchAdminCollectionData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildTiresQuery,
    createDefaultTireForm,
    getSelectableInternalTireSlotOptions,
    getSelectableTireVehiclesByVehicleCategory,
    getSelectableVehicleCategories,
    getVehicleCategoryValue,
    resolveFleetTireEvents,
    TIRE_TYPES,
    type ResolvedFleetTireEvent,
    type TireFormState,
} from '@/lib/fleet-asset-page-support';
import { isTireTrackedWarehouseItem, WAREHOUSE_ITEM_TRACKING_MODE_LABELS } from '@/lib/inventory';
import { formatCurrency, formatDate, formatQuantity, TIRE_ASSET_STATUS_MAP } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import {
    formatTireSlotLabel,
    getSuggestedVehicleTireLayout,
    resolveTireSlotCode,
    TIRE_HOLDER_TYPE_OPTIONS,
    TIRE_STATUS_OPTIONS,
    type TireAssetStatus,
    type TireHolderType,
} from '@/lib/tire-slots';
import { normalizeTireType } from '@/lib/tire-types';
import { getTireHistoryActionColor, getTireHistoryActionLabel, getTireHistoryTransitionLabel } from '@/lib/tire-history';
import type { TireEvent, TireHistoryLog, Vehicle, WarehouseItem } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { formatDateTime } from '@/lib/utils';

type TireInstallFormState = {
    tireSource: 'WAREHOUSE' | 'UNIT';
    sourceVehicleRef: string;
    tireEventRef: string;
    vehicleCategory: string;
    vehicleRef: string;
    slotCode: string;
    sourceTireUsagePercent: number | null;
    oldTireUsagePercent: number | null;
    oldTireDestination: 'WAREHOUSE' | 'SCRAPPED';
    technicianCost: number;
    technicianVendor: string;
    maintenanceDate: string;
    note: string;
};

const CATAT_BAN_HOLDER_TYPE_OPTIONS = TIRE_HOLDER_TYPE_OPTIONS.filter(option => option.value !== 'EXTERNAL_VEHICLE');
const CATAT_BAN_STATUS_OPTIONS = TIRE_STATUS_OPTIONS.filter(option => option.value !== 'LOANED_OUT');
const BAN_LIST_STATUS_FILTER_OPTIONS = TIRE_STATUS_OPTIONS.filter(option => option.value !== 'LOANED_OUT');

function createDefaultInstallForm(): TireInstallFormState {
    return {
        tireSource: 'WAREHOUSE',
        sourceVehicleRef: '',
        tireEventRef: '',
        vehicleCategory: '',
        vehicleRef: '',
        slotCode: '',
        sourceTireUsagePercent: null,
        oldTireUsagePercent: null,
        oldTireDestination: 'WAREHOUSE',
        technicianCost: 0,
        technicianVendor: '',
        maintenanceDate: getBusinessDateValue(),
        note: '',
    };
}

export default function TiresPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const searchParams = useSearchParams();
    const [events, setEvents] = useState<TireEvent[]>([]);
    const [allTireEvents, setAllTireEvents] = useState<TireEvent[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterVehicle, setFilterVehicle] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | TireAssetStatus>('all');
    const [page, setPage] = useState(1);
    const [filteredTotalTires, setFilteredTotalTires] = useState(0);
    const [mountedCount, setMountedCount] = useState(0);
    const [spareCount, setSpareCount] = useState(0);
    const [warehouseCount, setWarehouseCount] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [editTarget, setEditTarget] = useState<TireEvent | null>(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<TireFormState>(createDefaultTireForm());
    const [installForm, setInstallForm] = useState<TireInstallFormState>(createDefaultInstallForm());
    const [historyTarget, setHistoryTarget] = useState<ResolvedFleetTireEvent | null>(null);
    const [historyRows, setHistoryRows] = useState<TireHistoryLog[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [openedEditParam, setOpenedEditParam] = useState('');
    const [dateSortDir, setDateSortDir] = useState<SortDirection | null>(null);
    const [vehicleCategoryFilter, setVehicleCategoryFilter] = useState('');
    const canCreateTires = user ? hasPermission(user, 'tires', 'create') : false;
    const canManageTires = user ? hasPermission(user, 'tires', 'update') : false;
    const canOpenPurchases = user ? hasPageAccess(user, 'purchases') : false;
    const canOpenItems = user ? hasPageAccess(user, 'warehouseItems') : false;
    const linkedWarehouseItemLocked = Boolean(editTarget?.linkedWarehouseItemRef || editTarget?.sourcePurchaseRef);

    useEffect(() => {
        setPage(1);
    }, [search, filterVehicle, filterStatus]);

    const buildCurrentTiresQuery = useCallback(
        (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
            buildTiresQuery({
                page: targetPage,
                pageSize: targetPageSize,
                search,
                filterVehicle,
                filterStatus,
                sortField: dateSortDir ? 'installDate' : undefined,
                sortDir: dateSortDir || undefined,
        }),
        [dateSortDir, filterStatus, filterVehicle, page, search]
    );

    const fetchAllMatchingTires = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: TireEvent[] = [];

        do {
            const res = await fetch(`/api/data?${buildCurrentTiresQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat data ban');
            }

            const nextItems = (payload.data || []) as TireEvent[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCurrentTiresQuery]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const fetchEntity = async <T,>(url: string) => {
                const res = await fetch(url);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat data ban');
                }
                return payload as { data: T; meta?: { total?: number } };
            };

            const [tirePayload, vehiclePayload, matchingTires, allTireRows, warehouseItemRows] = await Promise.all([
                fetchEntity<TireEvent[]>(`/api/data?${buildCurrentTiresQuery()}`),
                fetchAdminCollectionData<Vehicle[]>('/api/data?entity=vehicles', 'Gagal memuat data ban'),
                fetchAllMatchingTires(),
                fetchAllAdminCollectionData<TireEvent>('/api/data?entity=tire-events', 'Gagal memuat data ban'),
                fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=200', 'Gagal memuat data ban'),
            ]);

            const nextCounts = matchingTires.reduce(
                (totals, tire) => {
                    const resolvedTire = resolveFleetTireEvents([tire])[0];
                    const slotCode = resolvedTire?.slotCode || '';
                    if (resolvedTire?.status === 'IN_USE' && slotCode.startsWith('SP')) {
                        totals.spare += 1;
                    } else if (resolvedTire?.status === 'IN_USE') {
                        totals.mounted += 1;
                    } else if (resolvedTire?.status === 'IN_WAREHOUSE') {
                        totals.warehouse += 1;
                    }
                    return totals;
                },
                { mounted: 0, spare: 0, warehouse: 0 }
            );
            setEvents(tirePayload.data || []);
            setAllTireEvents(allTireRows || []);
            setFilteredTotalTires(tirePayload.meta?.total || 0);
            setVehicles(vehiclePayload || []);
            setWarehouseItems((warehouseItemRows || []).filter(item => item.active !== false));
            setMountedCount(nextCounts.mounted);
            setSpareCount(nextCounts.spare);
            setWarehouseCount(nextCounts.warehouse);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data ban');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentTiresQuery, fetchAllMatchingTires]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const resolvedEvents = resolveFleetTireEvents(events);
    const vehicleCategoryOptions = useMemo(
        () => getSelectableVehicleCategories(vehicles, editTarget),
        [editTarget, vehicles]
    );
    const selectableVehicles = useMemo(
        () => getSelectableTireVehiclesByVehicleCategory(vehicles, editTarget, vehicleCategoryFilter || undefined),
        [editTarget, vehicleCategoryFilter, vehicles]
    );
    const trackedTireItems = useMemo(
        () => warehouseItems.filter(item => isTireTrackedWarehouseItem(item)),
        [warehouseItems]
    );
    const selectedLinkedWarehouseItem = useMemo(
        () => trackedTireItems.find(item => item._id === form.linkedWarehouseItemRef) || null,
        [form.linkedWarehouseItemRef, trackedTireItems]
    );
    const selectedVehicle = useMemo(
        () => vehicles.find(vehicle => vehicle._id === form.vehicleRef) || null,
        [form.vehicleRef, vehicles]
    );
    const slotOptions = useMemo(
        () => getSelectableInternalTireSlotOptions({
            vehicle: selectedVehicle,
            tireEvents: allTireEvents,
            editTargetId: editTarget?._id,
        }),
        [allTireEvents, editTarget?._id, selectedVehicle]
    );
    const visibleSlotOptions = useMemo(
        () => editTarget ? slotOptions : slotOptions.filter(option => !option.occupied),
        [editTarget, slotOptions]
    );
    const occupiedSlotCount = slotOptions.filter(option => option.occupied).length;
    const availableSlotCount = slotOptions.length - occupiedSlotCount;
    const selectedVehicleLayoutSummary = useMemo(() => {
        if (!selectedVehicle) {
            return null;
        }

        const vehicleTires = resolveFleetTireEvents(allTireEvents).filter(event =>
            event.vehicleRef === selectedVehicle._id &&
            event.holderType === 'INTERNAL_VEHICLE' &&
            event.status === 'IN_USE' &&
            Boolean(event.slotCode)
        );
        const layout = getSuggestedVehicleTireLayout(
            selectedVehicle.vehicleType,
            selectedVehicle.serviceName,
            vehicleTires.map(event => event.slotCode || '').filter(Boolean),
            selectedVehicle.tireLayoutConfig
        );
        const occupiedSlots = new Set(
            vehicleTires
                .filter(event => event._id !== editTarget?._id)
                .map(event => event.slotCode || '')
                .filter(Boolean)
        );

        return {
            roadTotal: layout.roadSlots.length,
            roadFilled: layout.roadSlots.filter(slotCode => occupiedSlots.has(slotCode)).length,
            spareTotal: layout.spareSlots.length,
            spareFilled: layout.spareSlots.filter(slotCode => occupiedSlots.has(slotCode)).length,
        };
    }, [allTireEvents, editTarget?._id, selectedVehicle]);
    const resolvedEditTarget = useMemo(
        () => editTarget ? resolveFleetTireEvents([editTarget])[0] : null,
        [editTarget]
    );
    const requiresUsagePercentOnExit = Boolean(
        editTarget &&
        resolvedEditTarget?.holderType === 'INTERNAL_VEHICLE' &&
        editTarget.vehicleRef &&
        Number(editTarget.maintenanceCostPostedPercent || 0) < 100 &&
        (form.holderType !== 'INTERNAL_VEHICLE' || form.vehicleRef !== editTarget.vehicleRef)
    );
    const remainingPercentBeforeExit = Math.max(100 - Number(editTarget?.totalUsedPercent || 0), 0);
    const usagePercentPreview = typeof form.usagePercentOnExit === 'number' ? form.usagePercentOnExit : 0;
    const usageCostPreview = Math.round(Number(form.originalCost || 0) * usagePercentPreview / 100);
    const remainingPercentAfterPreview = Math.max(remainingPercentBeforeExit - usagePercentPreview, 0);
    const remainingValueAfterPreview = Math.round(Number(form.originalCost || 0) * remainingPercentAfterPreview / 100);
    const installVehicleCategoryOptions = useMemo(
        () => getSelectableVehicleCategories(vehicles, null),
        [vehicles]
    );
    const installSelectableVehicles = useMemo(
        () => getSelectableTireVehiclesByVehicleCategory(vehicles, null, installForm.vehicleCategory || undefined),
        [installForm.vehicleCategory, vehicles]
    );
    const installSelectedVehicle = useMemo(
        () => vehicles.find(vehicle => vehicle._id === installForm.vehicleRef) || null,
        [installForm.vehicleRef, vehicles]
    );
    const installSlotOptions = useMemo(
        () => getSelectableInternalTireSlotOptions({
            vehicle: installSelectedVehicle,
            tireEvents: allTireEvents,
            editTargetId: installForm.tireEventRef,
        }).map(option => ({ ...option, disabled: false })),
        [allTireEvents, installForm.tireEventRef, installSelectedVehicle]
    );
    const availableInstallTires = useMemo(
        () => resolveFleetTireEvents(allTireEvents)
            .filter(event => {
                if (!installSelectedVehicle) return false;
                if (event.status === 'SCRAPPED') return false;
                if (event.vehicleRef === installForm.vehicleRef) return false;
                if (installForm.tireSource === 'WAREHOUSE') {
                    if (event.holderType !== 'WAREHOUSE' || event.status !== 'IN_WAREHOUSE') return false;
                } else if (
                    event.holderType !== 'INTERNAL_VEHICLE' ||
                    event.status !== 'IN_USE' ||
                    !event.vehicleRef
                ) {
                    return false;
                } else if (installForm.sourceVehicleRef && event.vehicleRef !== installForm.sourceVehicleRef) {
                    return false;
                }
                return true;
            })
            .sort((left, right) => left.tireCodeLabel.localeCompare(right.tireCodeLabel, 'id-ID')),
        [allTireEvents, installForm.sourceVehicleRef, installForm.tireSource, installForm.vehicleRef, installSelectedVehicle]
    );
    const installSourceUnitOptions = useMemo(
        () => resolveFleetTireEvents(allTireEvents)
            .filter(event =>
                installSelectedVehicle &&
                event.holderType === 'INTERNAL_VEHICLE' &&
                event.status === 'IN_USE' &&
                event.vehicleRef &&
                event.vehicleRef !== installForm.vehicleRef
            )
            .reduce<Array<{ value: string; label: string; tireCount: number }>>((options, event) => {
                const existing = options.find(option => option.value === event.vehicleRef);
                if (existing) {
                    existing.tireCount += 1;
                    return options;
                }
                options.push({
                    value: event.vehicleRef || '',
                    label: event.vehiclePlate || event.vehicleRef || 'Unit tanpa plat',
                    tireCount: 1,
                });
                return options;
            }, [])
            .sort((left, right) => left.label.localeCompare(right.label, 'id-ID')),
        [allTireEvents, installForm.vehicleRef, installSelectedVehicle]
    );
    const selectedInstallTire = useMemo(
        () => availableInstallTires.find(event => event._id === installForm.tireEventRef) || null,
        [availableInstallTires, installForm.tireEventRef]
    );
    const oldTireInInstallSlot = useMemo(
        () => resolveFleetTireEvents(allTireEvents).find(event =>
            event.vehicleRef === installForm.vehicleRef &&
            event.holderType === 'INTERNAL_VEHICLE' &&
            event.status === 'IN_USE' &&
            event.slotCode === installForm.slotCode &&
            event._id !== installForm.tireEventRef
        ) || null,
        [allTireEvents, installForm.slotCode, installForm.tireEventRef, installForm.vehicleRef]
    );
    const installPostedPercent = Math.max(100 - Number(selectedInstallTire?.maintenanceCostPostedPercent || 0), 0);
    const selectedInstallOriginalCost = Number(selectedInstallTire?.originalCost ?? selectedInstallTire?.purchaseCost ?? 0);
    const selectedInstallRemainingPercent = Math.max(100 - Number(selectedInstallTire?.totalUsedPercent || 0), 0);
    const selectedInstallRemainingValue = Number(selectedInstallTire?.remainingValue ?? Math.round(selectedInstallOriginalCost * selectedInstallRemainingPercent / 100));
    const installCostPreview = Math.round(selectedInstallOriginalCost * installPostedPercent / 100);
    const requiresInstallSourceUsagePercent = Boolean(selectedInstallTire?.holderType === 'INTERNAL_VEHICLE' && selectedInstallTire.vehicleRef && selectedInstallTire.vehicleRef !== installForm.vehicleRef);
    const sourceInstallUsagePercentPreview = Number(installForm.sourceTireUsagePercent || 0);
    const sourceInstallUsageCostPreview = Math.round(selectedInstallOriginalCost * sourceInstallUsagePercentPreview / 100);
    const sourceInstallRemainingPercentAfter = Math.max(selectedInstallRemainingPercent - sourceInstallUsagePercentPreview, 0);
    const sourceInstallRemainingValueAfter = Math.round(selectedInstallOriginalCost * sourceInstallRemainingPercentAfter / 100);
    const oldRemainingPercent = Math.max(100 - Number(oldTireInInstallSlot?.totalUsedPercent || 0), 0);
    const oldInstallOriginalCost = Number(oldTireInInstallSlot?.originalCost ?? oldTireInInstallSlot?.purchaseCost ?? 0);
    const oldInstallUsedBefore = Number(oldTireInInstallSlot?.totalUsedPercent || 0);
    const oldUsagePercentPreview = Number(installForm.oldTireUsagePercent || 0);
    const oldInstallRemainingValueBefore = Number(oldTireInInstallSlot?.remainingValue ?? Math.round(oldInstallOriginalCost * oldRemainingPercent / 100));
    const oldUsageCostPreview = Math.round(oldInstallOriginalCost * oldUsagePercentPreview / 100);
    const installTotalCostPreview = oldUsageCostPreview + installCostPreview;

    const resetForm = () => setForm(createDefaultTireForm());
    const resetInstallForm = () => setInstallForm(createDefaultInstallForm());

    const openAdd = () => {
        if (!canCreateTires) return;
        setEditTarget(null);
        setVehicleCategoryFilter('');
        resetForm();
        setShowModal(true);
    };

    const openInstall = () => {
        if (!canManageTires) return;
        resetInstallForm();
        setShowInstallModal(true);
    };

    const openEdit = useCallback((event: TireEvent) => {
        if (!canManageTires) return;
        const resolvedEvent = resolvedEvents.find(item => item._id === event._id);
        const holderType = resolvedEvent?.holderType || 'INTERNAL_VEHICLE';
        const status = resolvedEvent?.status || 'IN_USE';
        const slotCode = resolvedEvent?.slotCode || resolveTireSlotCode(event) || '';
        const nextVehicle = vehicles.find(item => item._id === event.vehicleRef) || null;
        setEditTarget(event);
        setVehicleCategoryFilter(nextVehicle ? getVehicleCategoryValue(nextVehicle) : '');
        setForm({
            tireCode: event.tireCode || '',
            holderType,
            status,
            vehicleRef: event.vehicleRef || '',
            slotCode,
            linkedWarehouseItemRef: event.linkedWarehouseItemRef || '',
            tireType: normalizeTireType(event.tireType),
            tireBrand: event.tireBrand,
            tireSize: event.tireSize,
            installDate: event.installDate,
            originalCost: event.originalCost ?? event.purchaseCost ?? 0,
            totalUsedPercent: event.totalUsedPercent || 0,
            usagePercentOnExit: null,
            accumulatedKm: event.accumulatedKm || 0,
            notes: event.notes || '',
            externalPartyName: event.externalPartyName || '',
            externalPlateNumber: event.externalPlateNumber || '',
        });
        setShowModal(true);
    }, [canManageTires, resolvedEvents, vehicles]);

    useEffect(() => {
        const editId = searchParams.get('edit');
        if (!editId || editId === openedEditParam || loading || showModal) {
            return;
        }
        const target = allTireEvents.find(event => event._id === editId) || events.find(event => event._id === editId);
        if (target) {
            setOpenedEditParam(editId);
            openEdit(target);
        }
    }, [allTireEvents, events, loading, openEdit, openedEditParam, searchParams, showModal]);

    const openHistory = async (event: ResolvedFleetTireEvent) => {
        setHistoryTarget(event);
        setHistoryRows([]);
        setLoadingHistory(true);
        try {
            const filter = encodeURIComponent(JSON.stringify({ tireEventRef: event._id }));
            const rows = await fetchAdminCollectionData<TireHistoryLog[]>(
                `/api/data?entity=tire-history-logs&filter=${filter}`,
                'Gagal memuat riwayat ban'
            );
            setHistoryRows(rows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat riwayat ban');
        } finally {
            setLoadingHistory(false);
        }
    };

    const updateForm = <K extends keyof TireFormState>(key: K, value: TireFormState[K]) => {
        setForm(prev => ({ ...prev, [key]: value }));
    };

    const updateLinkedWarehouseItemRef = (itemRef: string) => {
        const linkedItem = trackedTireItems.find(item => item._id === itemRef) || null;
        setForm(prev => ({
            ...prev,
            linkedWarehouseItemRef: itemRef,
            tireBrand: linkedItem?.tireBrandDefault || prev.tireBrand,
            tireSize: linkedItem?.tireSizeDefault || prev.tireSize,
            tireType: normalizeTireType(linkedItem?.tireTypeDefault || prev.tireType),
            originalCost: linkedItem?.defaultPurchasePrice || prev.originalCost,
        }));
    };

    const updateInstallForm = <K extends keyof TireInstallFormState>(key: K, value: TireInstallFormState[K]) => {
        setInstallForm(prev => ({ ...prev, [key]: value }));
    };

    useEffect(() => {
        if (form.holderType !== 'INTERNAL_VEHICLE') {
            return;
        }

        const selectedVehicleStillVisible = selectableVehicles.some(vehicle => vehicle._id === form.vehicleRef);
        if (!selectedVehicleStillVisible && form.vehicleRef) {
            setForm(prev => ({ ...prev, vehicleRef: '', slotCode: '' }));
        }
    }, [form.holderType, form.vehicleRef, selectableVehicles]);

    useEffect(() => {
        if (form.holderType !== 'INTERNAL_VEHICLE') {
            return;
        }

        const preferredSlot = slotOptions.find(option => !option.disabled)?.value || '';
        if (!preferredSlot) {
            if (form.slotCode) {
                setForm(prev => ({ ...prev, slotCode: '' }));
            }
            return;
        }

        const activeSlotStillValid = slotOptions.some(option => option.value === form.slotCode && !option.disabled);
        if (!activeSlotStillValid && preferredSlot !== form.slotCode) {
            setForm(prev => ({ ...prev, slotCode: preferredSlot }));
        }
    }, [form.holderType, form.slotCode, slotOptions]);

    useEffect(() => {
        if (!selectedLinkedWarehouseItem) {
            return;
        }
        setForm(prev => {
            const nextBrand = prev.tireBrand || selectedLinkedWarehouseItem.tireBrandDefault || prev.tireBrand;
            const nextSize = prev.tireSize || selectedLinkedWarehouseItem.tireSizeDefault || prev.tireSize;
            const nextType = normalizeTireType(selectedLinkedWarehouseItem.tireTypeDefault || prev.tireType);
            const nextOriginalCost = prev.originalCost || selectedLinkedWarehouseItem.defaultPurchasePrice || prev.originalCost;
            if (nextBrand === prev.tireBrand && nextSize === prev.tireSize && nextType === prev.tireType && nextOriginalCost === prev.originalCost) {
                return prev;
            }
            return {
                ...prev,
                tireBrand: nextBrand,
                tireSize: nextSize,
                tireType: nextType,
                originalCost: nextOriginalCost,
            };
        });
    }, [selectedLinkedWarehouseItem]);

    useEffect(() => {
        if (!showInstallModal) {
            return;
        }
        const vehicleStillVisible = installSelectableVehicles.some(vehicle => vehicle._id === installForm.vehicleRef);
        if (!vehicleStillVisible && installForm.vehicleRef) {
            setInstallForm(prev => ({ ...prev, vehicleRef: '', slotCode: '' }));
        }
    }, [installForm.vehicleRef, installSelectableVehicles, showInstallModal]);

    useEffect(() => {
        if (!showInstallModal || !installSelectedVehicle) {
            return;
        }
        const preferredSlot = installSlotOptions.find(option => option.value === installForm.slotCode)?.value || installSlotOptions[0]?.value || '';
        if (preferredSlot !== installForm.slotCode) {
            setInstallForm(prev => ({ ...prev, slotCode: preferredSlot }));
        }
    }, [installForm.slotCode, installSelectedVehicle, installSlotOptions, showInstallModal]);

    useEffect(() => {
        if (!showInstallModal || !installForm.tireEventRef) {
            return;
        }
        const tireStillAvailable = availableInstallTires.some(event => event._id === installForm.tireEventRef);
        if (!tireStillAvailable) {
            setInstallForm(prev => ({ ...prev, tireEventRef: '' }));
        }
    }, [availableInstallTires, installForm.tireEventRef, showInstallModal]);

    const handleSave = async () => {
        if (!form.tireCode) { addToast('error', 'Isi kode ban'); return; }
        if (!form.tireBrand) { addToast('error', 'Isi merk/tipe ban'); return; }
        if (!form.tireSize) { addToast('error', 'Isi ukuran ban'); return; }
        if (!form.linkedWarehouseItemRef) {
            addToast('error', 'Pilih master barang gudang untuk referensi aset ban');
            return;
        }
        if (form.holderType === 'INTERNAL_VEHICLE' && !form.vehicleRef) { addToast('error', 'Pilih kendaraan'); return; }
        if (form.holderType === 'INTERNAL_VEHICLE' && !form.slotCode) { addToast('error', 'Pilih slot ban'); return; }
        if (!editTarget && form.holderType === 'INTERNAL_VEHICLE' && availableSlotCount <= 0) {
            addToast('error', 'Kendaraan ini tidak punya slot ban kosong');
            return;
        }
        if (!editTarget && form.holderType === 'INTERNAL_VEHICLE' && !slotOptions.some(option => option.value === form.slotCode && !option.occupied)) {
            addToast('error', 'Pilih slot ban yang masih kosong');
            return;
        }
        if (form.totalUsedPercent < 0 || form.totalUsedPercent > 100) {
            addToast('error', 'Total pemakaian ban harus 0-100%');
            return;
        }
        if (requiresUsagePercentOnExit) {
            if (form.usagePercentOnExit === null || !Number.isFinite(form.usagePercentOnExit)) {
                addToast('error', 'Isi persentase pemakaian ban di unit sebelumnya');
                return;
            }
            if (form.usagePercentOnExit < 0 || form.usagePercentOnExit > remainingPercentBeforeExit) {
                addToast('error', `Persentase pemakaian ban harus 0-${remainingPercentBeforeExit}%`);
                return;
            }
        }

        setSaving(true);
        try {
            const vehicle = vehicles.find(item => item._id === form.vehicleRef);
            const effectiveHolderType = form.holderType;
            const effectiveStatus = editTarget
                ? form.status
                : effectiveHolderType === 'INTERNAL_VEHICLE'
                    ? 'IN_USE'
                    : 'IN_WAREHOUSE';
            const payload = {
                ...form,
                holderType: effectiveHolderType,
                status: effectiveStatus,
                vehicleRef: effectiveHolderType === 'INTERNAL_VEHICLE' ? form.vehicleRef : '',
                vehiclePlate: effectiveHolderType === 'INTERNAL_VEHICLE' ? vehicle?.plateNumber : undefined,
                slotCode: effectiveHolderType === 'INTERNAL_VEHICLE' ? form.slotCode : '',
                slotLabel: effectiveHolderType === 'INTERNAL_VEHICLE' && form.slotCode ? formatTireSlotLabel(form.slotCode) : undefined,
                linkedWarehouseItemRef: form.linkedWarehouseItemRef || undefined,
                purchaseCost: form.originalCost,
                originalCost: form.originalCost,
                totalUsedPercent: form.totalUsedPercent,
                usagePercentOnExit: requiresUsagePercentOnExit ? form.usagePercentOnExit : undefined,
            };

            if (editTarget) {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'tire-events', action: 'update', data: { id: editTarget._id, updates: payload } }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal memperbarui data ban');
                    return;
                }
                addToast('success', 'Data ban berhasil diperbarui');
            } else {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'tire-events', data: payload }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal mencatat ban');
                    return;
                }
                addToast('success', 'Ban berhasil dicatat');
            }
            setShowModal(false);
            resetForm();
            if (page !== 1) {
                setPage(1);
            } else {
                await loadData();
            }
        } catch {
            addToast('error', 'Gagal menyimpan data ban');
        } finally {
            setSaving(false);
        }
    };

    const handleInstallSave = async () => {
        if (!installForm.tireEventRef) { addToast('error', 'Pilih ban sumber'); return; }
        if (!installForm.vehicleRef) { addToast('error', 'Pilih kendaraan'); return; }
        if (!installForm.slotCode) { addToast('error', 'Pilih slot ban'); return; }
        if (!selectedInstallTire) { addToast('error', 'Ban pengganti tidak ditemukan'); return; }
        if ((selectedInstallTire.originalCost ?? selectedInstallTire.purchaseCost ?? 0) <= 0) {
            addToast('error', 'Ban pengganti harus punya harga/original cost');
            return;
        }
        if (requiresInstallSourceUsagePercent) {
            if (installForm.sourceTireUsagePercent === null || !Number.isFinite(installForm.sourceTireUsagePercent)) {
                addToast('error', 'Isi persentase pemakaian ban di unit sumber');
                return;
            }
            if (installForm.sourceTireUsagePercent < 0 || installForm.sourceTireUsagePercent > selectedInstallRemainingPercent) {
                addToast('error', `Persentase ban sumber harus 0-${selectedInstallRemainingPercent}%`);
                return;
            }
        }
        if (oldTireInInstallSlot) {
            if (installForm.oldTireUsagePercent === null || !Number.isFinite(installForm.oldTireUsagePercent)) {
                addToast('error', 'Isi persentase pemakaian ban lama');
                return;
            }
            if (installForm.oldTireUsagePercent < 0 || installForm.oldTireUsagePercent > oldRemainingPercent) {
                addToast('error', `Persentase ban lama harus 0-${oldRemainingPercent}%`);
                return;
            }
        }

        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'tire-events',
                    action: 'install-to-slot',
                    data: {
                        tireEventRef: installForm.tireEventRef,
                        vehicleRef: installForm.vehicleRef,
                        slotCode: installForm.slotCode,
                        sourceTireUsagePercent: requiresInstallSourceUsagePercent ? installForm.sourceTireUsagePercent : undefined,
                        oldTireUsagePercent: oldTireInInstallSlot ? installForm.oldTireUsagePercent : undefined,
                        oldTireDestination: oldTireInInstallSlot ? installForm.oldTireDestination : undefined,
                        maintenanceDate: installForm.maintenanceDate,
                        note: installForm.note,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal memasang ban');
                return;
            }
            const tireCostLines = [
                ...(selectedInstallTire ? [{
                    warehouseItemRef: `tire:${selectedInstallTire._id}`,
                    itemCode: selectedInstallTire.tireCodeLabel || selectedInstallTire.tireCode,
                    itemName: `Pasang ban pengganti ${selectedInstallTire.tireCodeLabel || selectedInstallTire.tireCode || ''}`.trim(),
                    subtotalCost: Number(result.summary?.installCost ?? installCostPreview),
                    note: `Dipasang ke ${installSelectedVehicle?.plateNumber || '-'} slot ${installForm.slotCode}`,
                }] : []),
                ...(oldTireInInstallSlot ? [{
                    warehouseItemRef: `tire:${oldTireInInstallSlot._id}`,
                    itemCode: oldTireInInstallSlot.tireCodeLabel || oldTireInInstallSlot.tireCode,
                    itemName: `Pemakaian ban lama ${oldTireInInstallSlot.tireCodeLabel || oldTireInInstallSlot.tireCode || ''}`.trim(),
                    subtotalCost: Number(result.summary?.oldTireUsageCost ?? oldUsageCostPreview),
                    note: `${oldUsagePercentPreview}% pemakaian di ${installSelectedVehicle?.plateNumber || '-'}`,
                }] : []),
            ];
            const technicianRes = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'maintenances',
                    action: 'record-tire-technician-cost',
                    data: {
                        vehicleRef: installForm.vehicleRef,
                        completedDate: installForm.maintenanceDate,
                        vendor: installForm.technicianVendor.trim() || undefined,
                        laborCost: installForm.technicianCost,
                        maintenanceType: oldTireInInstallSlot ? 'Ganti Ban' : 'Pasang Ban',
                        tireContext: `${oldTireInInstallSlot ? 'Ganti' : 'Pasang'} ban ${selectedInstallTire?.tireCodeLabel || selectedInstallTire?.tireCode || '-'} ke ${installSelectedVehicle?.plateNumber || '-'} slot ${installForm.slotCode}${oldTireInInstallSlot ? `, ban lama ${oldTireInInstallSlot.tireCodeLabel || oldTireInInstallSlot.tireCode}` : ''}`,
                        tireCostLines,
                        completionNotes: installForm.note.trim() || undefined,
                    },
                }),
            });
            const technicianPayload = await technicianRes.json();
            if (!technicianRes.ok) {
                addToast('error', technicianPayload.error || 'Ban berhasil dipasang, tapi catatan maintenance ban gagal dibuat');
                await loadData();
                return;
            }
            addToast('success', `Ban berhasil dipasang. Biaya ban ${formatCurrency(result.summary?.totalMaintenanceCost ?? installTotalCostPreview)}`);
            setShowInstallModal(false);
            resetInstallForm();
            await loadData();
        } catch {
            addToast('error', 'Gagal memasang ban');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Audit Semua Ban</h1>
                </div>
                <div className="page-actions">
                    {canManageTires && <button className="btn btn-secondary" onClick={openInstall}><Wrench size={16} /> Pasang Ban</button>}
                    {canCreateTires && <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Catat Ban</button>}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><CheckCircle size={20} /></div><div className="kpi-content"><div className="kpi-label">Terpasang</div><div className="kpi-value">{mountedCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Serep</div><div className="kpi-value">{spareCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Di Gudang</div><div className="kpi-value">{warehouseCount}</div></div></div>
            </div>

            <div className="info-banner" style={{ marginBottom: '1.5rem' }}>
                <div className="info-banner-title">Integrasi Ban dan Inventory</div>
                <div className="info-banner-text">
                    Harga pembelian ban dikelola di modul inventory dan pembelian supplier. Halaman ini fokus pada histori aset ban, posisi unit, dan pergerakan ban tanpa menampilkan harga.
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari kode ban, plat, lokasi, merk..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto' }} value={filterVehicle} onChange={e => setFilterVehicle(e.target.value)}>
                            <option value="">Semua Kendaraan</option>
                            {vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all' | TireAssetStatus)}>
                            <option value="all">Semua Status</option>
                            {BAN_LIST_STATUS_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Kode Ban</th>
                                <th>Lokasi Saat Ini</th>
                                <th>Status</th>
                                <th>Nilai Ban</th>
                                <th>Merk & Ukuran</th>
                                <th>Sumber</th>
                                <th><SortableTableHeader label="Tgl Catat" direction={dateSortDir} onToggle={() => setDateSortDir(current => current === 'desc' ? 'asc' : 'desc')} /></th>
                                <th>Catatan</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalTires === 0 ? (
                                    <tr><td colSpan={9}>
                                        <div className="empty-state">
                                            <Disc3 size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada ban tercatat</div>
                                        </div>
                                    </td></tr>
                                ) : resolvedEvents.map(event => (
                                    <tr key={event._id}>
                                        <td>
                                            <Link href={`/fleet/tires/${event._id}`} className="font-medium" style={{ color: 'var(--color-primary)' }}>{event.tireCodeLabel}</Link>
                                            <div className="text-muted text-sm">{event.tireType}</div>
                                        </td>
                                        <td>
                                            <div className="font-medium">{event.placementLabel}</div>
                                            {event.slotCode && <div className="text-muted text-sm">{event.slotCode} - {event.slotLabel || formatTireSlotLabel(event.slotCode)}</div>}
                                        </td>
                                        <td>
                                            <span className={`badge badge-${TIRE_ASSET_STATUS_MAP[event.status]?.color || 'gray'}`}>
                                                <span className="badge-dot" /> {TIRE_ASSET_STATUS_MAP[event.status]?.label || event.status}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="font-medium">{formatCurrency(event.originalCost ?? event.purchaseCost ?? 0)}</div>
                                            <div className="text-muted text-sm">Sisa {formatQuantity(event.remainingPercent ?? Math.max(100 - Number(event.totalUsedPercent || 0), 0), 2)}%</div>
                                            <div className="text-muted text-sm">{formatCurrency(event.remainingValue ?? 0)}</div>
                                        </td>
                                        <td>
                                            <div className="font-medium">{event.tireBrand}</div>
                                            <div className="font-mono text-sm">{event.tireSize}</div>
                                        </td>
                                        <td>
                                            {event.sourcePurchaseNumber ? (
                                                <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                    <div className="text-sm">
                                                        {canOpenPurchases ? (
                                                            <Link href={`/inventory/purchases/${event.sourcePurchaseRef}`} style={{ color: 'var(--color-primary)' }}>
                                                                {event.sourcePurchaseNumber}
                                                            </Link>
                                                        ) : event.sourcePurchaseNumber}
                                                    </div>
                                                    <div className="text-muted text-sm">
                                                        {canOpenItems && event.linkedWarehouseItemRef ? (
                                                            <Link href={`/inventory/items/${event.linkedWarehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>
                                                                {event.linkedWarehouseItemCode || event.linkedWarehouseItemName || '-'}
                                                            </Link>
                                                        ) : (event.linkedWarehouseItemCode || event.linkedWarehouseItemName || '-')}
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-muted">{event.linkedWarehouseItemCode || '-'}</span>
                                            )}
                                        </td>
                                        <td className="text-muted">{formatDate(event.installDate)}</td>
                                        <td className="text-muted">
                                            <div>{event.notes || '-'}</div>
                                            <div className="text-sm">{formatQuantity(event.accumulatedKm || 0, 0)} km</div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <Link className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} href={`/fleet/tires/${event._id}`}>
                                                    Detail
                                                </Link>
                                                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openHistory(event)}>
                                                    <History size={13} /> Riwayat
                                                </button>
                                                {canManageTires && <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(event)}>Edit</button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalTires === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada ban tercatat</div>
                            </div>
                        ) : resolvedEvents.map(event => (
                            <div key={event._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <Link href={`/fleet/tires/${event._id}`} className="mobile-record-title" style={{ color: 'var(--color-primary)' }}>{event.tireCodeLabel}</Link>
                                        <div className="mobile-record-subtitle">{event.tireBrand} | {event.tireSize}</div>
                                    </div>
                                    <span className={`badge badge-${TIRE_ASSET_STATUS_MAP[event.status]?.color || 'gray'}`}>
                                        <span className="badge-dot" /> {TIRE_ASSET_STATUS_MAP[event.status]?.label || event.status}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Lokasi Saat Ini</span>
                                        <span className="mobile-record-value">{event.placementLabel}</span>
                                    </div>
                                    {event.slotCode && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Slot</span>
                                            <span className="mobile-record-value">{event.slotCode} - {event.slotLabel || formatTireSlotLabel(event.slotCode)}</span>
                                        </div>
                                    )}
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tanggal Catat</span>
                                        <span className="mobile-record-value">{formatDate(event.installDate)}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Km Ban</span>
                                        <span className="mobile-record-value">{formatQuantity(event.accumulatedKm || 0, 0)} km</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Nilai Ban</span>
                                        <span className="mobile-record-value">
                                            {formatCurrency(event.remainingValue ?? 0)} tersisa dari {formatCurrency(event.originalCost ?? event.purchaseCost ?? 0)}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Sumber</span>
                                        <span className="mobile-record-value">
                                            {event.sourcePurchaseNumber || event.linkedWarehouseItemCode || '-'}
                                        </span>
                                    </div>
                                    {event.notes && (
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Catatan</span>
                                            <span className="mobile-record-value">{event.notes}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => openHistory(event)}>Riwayat</button>
                                    {canManageTires && <button className="btn btn-secondary" onClick={() => openEdit(event)}>Edit</button>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {filteredTotalTires > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalTires}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} ban | {mountedCount} terpasang | {spareCount} serep | {warehouseCount} gudang
                            </>
                        )}
                    />
                )}
            </div>

            {(canCreateTires || canManageTires) && showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editTarget ? 'Edit Ban' : 'Catat Ban'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Ban</label>
                                    <input className="form-input" value={form.tireCode} onChange={e => updateForm('tireCode', e.target.value.toUpperCase())} placeholder="cth: BAN-0001" disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jenis Ban</label>
                                    <select className="form-select" value={form.tireType} onChange={e => updateForm('tireType', e.target.value as TireFormState['tireType'])} disabled={saving}>
                                        {TIRE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
                            </div>

                            {!editTarget && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Lokasi Awal Ban</label>
                                        <select
                                            className="form-select"
                                            value={form.holderType}
                                            onChange={e => {
                                                const nextHolderType = e.target.value as TireHolderType;
                                                setForm(prev => ({
                                                    ...prev,
                                                    holderType: nextHolderType,
                                                    status: nextHolderType === 'INTERNAL_VEHICLE' ? 'IN_USE' : 'IN_WAREHOUSE',
                                                    vehicleRef: nextHolderType === 'INTERNAL_VEHICLE' ? prev.vehicleRef : '',
                                                    slotCode: nextHolderType === 'INTERNAL_VEHICLE' ? prev.slotCode : '',
                                                    externalPartyName: '',
                                                    externalPlateNumber: '',
                                                }));
                                            }}
                                            disabled={saving}
                                        >
                                            <option value="WAREHOUSE">Gudang Ban</option>
                                            <option value="INTERNAL_VEHICLE">Unit</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Status Awal</label>
                                        <input
                                            className="form-input"
                                            value={form.holderType === 'INTERNAL_VEHICLE' ? 'Terpasang di Unit' : 'Di Gudang Ban'}
                                            readOnly
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Master Barang Gudang</label>
                                    <select
                                        className="form-select"
                                        value={form.linkedWarehouseItemRef}
                                        onChange={e => updateLinkedWarehouseItemRef(e.target.value)}
                                        disabled={saving || linkedWarehouseItemLocked}
                                    >
                                        <option value="">Pilih master barang gudang</option>
                                        {trackedTireItems.map(item => (
                                            <option key={item._id} value={item._id}>
                                                {item.itemCode} - {item.name}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>
                                        {form.holderType === 'INTERNAL_VEHICLE'
                                            ? 'Wajib. Ban unit harus terhubung ke master barang ban tertracking agar histori aset dan sumber inventory tetap satu.'
                                            : 'Wajib. Ban baru di Gudang Ban harus terhubung ke master barang agar stok gudang ban tertracking ikut tersinkron.'}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Mode Tracking</label>
                                    <input
                                        className="form-input"
                                        value={selectedLinkedWarehouseItem ? WAREHOUSE_ITEM_TRACKING_MODE_LABELS[selectedLinkedWarehouseItem.trackingMode || 'STANDARD'] : 'Belum terkait stok'}
                                        readOnly
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Harga Ban / Original Cost</label>
                                    <FormattedNumberInput allowDecimal={false} value={form.originalCost} onValueChange={value => updateForm('originalCost', value)} placeholder="Ketik harga ban" disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Total Pemakaian (%)</label>
                                    <FormattedNumberInput allowDecimal maxFractionDigits={2} value={form.totalUsedPercent} onValueChange={value => updateForm('totalUsedPercent', Math.min(Math.max(value, 0), 100))} placeholder="0 - 100" disabled={saving || requiresUsagePercentOnExit} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Sisa Nilai Saat Ini</label>
                                    <input
                                        className="form-input"
                                        value={formatCurrency(Math.round(Number(form.originalCost || 0) * Math.max(100 - Number(form.totalUsedPercent || 0), 0) / 100))}
                                        readOnly
                                    />
                                </div>
                            </div>

                            {editTarget?.sourcePurchaseNumber && (
                                <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                    <div className="info-banner-title">Sumber Pembelian</div>
                                    <div className="info-banner-text">
                                        Ban ini terdaftar dari pembelian {editTarget.sourcePurchaseNumber}.
                                        {canOpenPurchases && editTarget.sourcePurchaseRef && (
                                            <>
                                                {' '}
                                                <Link href={`/inventory/purchases/${editTarget.sourcePurchaseRef}`} style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
                                                    Buka pembelian
                                                </Link>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {editTarget ? (
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Lokasi Saat Ini</label>
                                    <select
                                        className="form-select"
                                        value={form.holderType}
                                        onChange={e => {
                                            const nextHolderType = e.target.value as TireHolderType;
                                            const nextStatus = nextHolderType === 'WAREHOUSE'
                                                ? 'IN_WAREHOUSE'
                                                : (form.status === 'IN_WAREHOUSE' || form.status === 'LOANED_OUT' ? 'IN_USE' : form.status);
                                            setForm(prev => ({
                                                ...prev,
                                                holderType: nextHolderType,
                                                status: nextStatus,
                                                vehicleRef: nextHolderType === 'INTERNAL_VEHICLE' ? prev.vehicleRef : '',
                                                slotCode: nextHolderType === 'INTERNAL_VEHICLE' ? prev.slotCode : '',
                                                externalPartyName: '',
                                                externalPlateNumber: '',
                                            }));
                                        }}
                                        disabled={saving}
                                    >
                                        {CATAT_BAN_HOLDER_TYPE_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.value === 'WAREHOUSE' ? 'Gudang Ban' : 'Unit'}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select
                                        className="form-select"
                                        value={form.status}
                                        onChange={e => {
                                            const nextStatus = e.target.value as TireAssetStatus;
                                            setForm(prev => ({
                                                ...prev,
                                                status: nextStatus,
                                                holderType: nextStatus === 'IN_WAREHOUSE'
                                                    ? 'WAREHOUSE'
                                                    : nextStatus === 'SCRAPPED'
                                                        ? 'WAREHOUSE'
                                                        : 'INTERNAL_VEHICLE',
                                                slotCode: nextStatus === 'IN_USE'
                                                    ? (prev.slotCode || '1L')
                                                    : '',
                                                externalPartyName: '',
                                                externalPlateNumber: '',
                                            }));
                                        }}
                                        disabled={saving}
                                    >
                                        {CATAT_BAN_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            ) : (
                                <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                    <div className="info-banner-title">{form.holderType === 'INTERNAL_VEHICLE' ? 'Dicatat Langsung ke Unit' : 'Dicatat ke Gudang Ban'}</div>
                                    <div className="info-banner-text">
                                        {form.holderType === 'INTERNAL_VEHICLE'
                                            ? 'Ban baru dicatat sebagai aset yang sudah terpasang pada slot kosong. Ini tidak membuat catatan maintenance atau biaya teknisi.'
                                            : 'Ban baru masuk daftar gudang. Pasang atau ganti ban dilakukan dari detail kendaraan.'}
                                    </div>
                                </div>
                            )}

                            {selectedLinkedWarehouseItem && form.holderType === 'WAREHOUSE' && (
                                <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                    <div className="info-banner-title">Sinkron Stok Gudang Ban</div>
                                    <div className="info-banner-text">
                                        Ban ini terhubung ke {selectedLinkedWarehouseItem.itemCode} - {selectedLinkedWarehouseItem.name}. Saat ban masuk gudang stok akan bertambah, dan saat ban keluar ke unit stok akan berkurang otomatis.
                                    </div>
                                </div>
                            )}

                            {form.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kategori Armada</label>
                                        <select
                                            className="form-select"
                                            value={vehicleCategoryFilter}
                                            onChange={e => {
                                                const nextCategory = e.target.value;
                                                setVehicleCategoryFilter(nextCategory);
                                                if (nextCategory && form.vehicleRef) {
                                                    const currentVehicle = vehicles.find(vehicle => vehicle._id === form.vehicleRef) || null;
                                                    if (currentVehicle && getVehicleCategoryValue(currentVehicle) !== nextCategory) {
                                                        setForm(prev => ({ ...prev, vehicleRef: '', slotCode: '' }));
                                                    }
                                                }
                                            }}
                                            disabled={saving}
                                        >
                                            <option value="">Semua kategori</option>
                                            {vehicleCategoryOptions.map(option => (
                                                <option key={option.value} value={option.value}>{option.label} ({option.vehicleCount} unit)</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Kendaraan</label>
                                        <select
                                            className="form-select"
                                            value={form.vehicleRef}
                                            onChange={e => {
                                                const nextVehicle = selectableVehicles.find(vehicle => vehicle._id === e.target.value) || null;
                                                if (nextVehicle) {
                                                    setVehicleCategoryFilter(getVehicleCategoryValue(nextVehicle));
                                                }
                                                setForm(prev => ({ ...prev, vehicleRef: e.target.value, slotCode: '' }));
                                            }}
                                            disabled={saving}
                                        >
                                            <option value="">Pilih kendaraan</option>
                                            {selectableVehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {form.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Slot Ban</label>
                                        <select
                                            className="form-select"
                                            value={form.slotCode}
                                            onChange={e => updateForm('slotCode', e.target.value)}
                                            disabled={saving || !selectedVehicle || slotOptions.length === 0}
                                        >
                                            {!selectedVehicle && <option value="">Pilih kendaraan dulu</option>}
                                            {selectedVehicle && visibleSlotOptions.length === 0 && <option value="">Tidak ada slot kosong</option>}
                                            {visibleSlotOptions.map(option => (
                                                <option key={option.value} value={option.value} disabled={option.disabled}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        <div style={{ fontSize: '0.76rem', color: 'var(--color-gray-600)', marginTop: '0.4rem' }}>
                                            {selectedVehicle
                                                ? `${occupiedSlotCount}/${slotOptions.length} slot terisi, ${availableSlotCount} slot tersedia.`
                                                : 'Slot akan menyesuaikan jumlah roda kendaraan yang dipilih.'}
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Info Layout</label>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.75rem 0.9rem', background: 'var(--color-gray-50)', minHeight: '100%' }}>
                                            <div className="font-medium" style={{ marginBottom: '0.35rem' }}>
                                                {selectedVehicle ? `${selectedVehicle.plateNumber} - ${selectedVehicle.serviceName || selectedVehicle.vehicleType || 'Tanpa kategori'}` : 'Pilih kendaraan'}
                                            </div>
                                            <div className="text-muted text-sm">
                                                {selectedVehicle
                                                    ? `Slot tampil otomatis mengikuti kategori/unit ini, dan tiap slot diberi status kosong atau terisi.`
                                                    : 'Pilih kendaraan agar jumlah slot mengikuti kategori armada.'}
                                            </div>
                                            {selectedVehicleLayoutSummary && (
                                                <div style={{ display: 'grid', gap: '0.2rem', marginTop: '0.55rem', fontSize: '0.76rem', color: 'var(--color-gray-700)' }}>
                                                    <div>Ban jalan: {selectedVehicleLayoutSummary.roadFilled}/{selectedVehicleLayoutSummary.roadTotal} slot terisi</div>
                                                    <div>Ban serep: {selectedVehicleLayoutSummary.spareFilled}/{selectedVehicleLayoutSummary.spareTotal} slot terisi</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {requiresUsagePercentOnExit && (
                                <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                    <div className="info-banner-title">Alokasi Biaya Pemakaian Ban</div>
                                    <div className="info-banner-text" style={{ display: 'grid', gap: '0.65rem' }}>
                                        <div>
                                            Ban keluar dari {resolvedEditTarget?.vehiclePlate || editTarget?.vehiclePlate || 'unit sebelumnya'}. Isi persen pemakaian selama ban berada di unit tersebut.
                                        </div>
                                        <div className="form-row" style={{ marginBottom: 0 }}>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Persentase Pemakaian di Unit Ini</label>
                                                <FormattedNumberInput
                                                    allowDecimal
                                                    maxFractionDigits={2}
                                                    value={form.usagePercentOnExit}
                                                    onValueChange={value => updateForm('usagePercentOnExit', value)}
                                                    placeholder={`Maks ${remainingPercentBeforeExit}%`}
                                                    disabled={saving}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Preview Biaya</label>
                                                <input
                                                    className="form-input"
                                                    value={`${formatCurrency(usageCostPreview)} | sisa ${formatQuantity(remainingPercentAfterPreview, 2)}% (${formatCurrency(remainingValueAfterPreview)})`}
                                                    readOnly
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Merk / Model</label>
                                    <input className="form-input" value={form.tireBrand} onChange={e => updateForm('tireBrand', e.target.value)} disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Ukuran</label>
                                    <input className="form-input" value={form.tireSize} onChange={e => updateForm('tireSize', e.target.value)} placeholder="295/80R22.5" disabled={saving} />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Catat</label>
                                    <input type="date" className="form-input" value={form.installDate} onChange={e => updateForm('installDate', e.target.value)} disabled={saving} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Kilometer Pemakaian Ban</label>
                                    <FormattedNumberInput allowDecimal={false} value={form.accumulatedKm} onValueChange={value => updateForm('accumulatedKm', value)} disabled={saving} />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={form.notes} onChange={e => updateForm('notes', e.target.value)} disabled={saving} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

            {showInstallModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowInstallModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Pasang Ban</h3>
                            <button className="modal-close" onClick={() => setShowInstallModal(false)} disabled={saving}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kategori Armada</label>
                                    <select
                                        className="form-select"
                                        value={installForm.vehicleCategory}
                                        onChange={e => setInstallForm(prev => ({ ...prev, vehicleCategory: e.target.value, vehicleRef: '', slotCode: '' }))}
                                        disabled={saving}
                                    >
                                        <option value="">Semua kategori</option>
                                        {installVehicleCategoryOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label} ({option.vehicleCount} unit)</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Kendaraan</label>
                                    <select
                                        className="form-select"
                                        value={installForm.vehicleRef}
                                        onChange={e => {
                                            const nextVehicle = installSelectableVehicles.find(vehicle => vehicle._id === e.target.value) || null;
                                            setInstallForm(prev => ({
                                                ...prev,
                                                vehicleRef: e.target.value,
                                                vehicleCategory: nextVehicle ? getVehicleCategoryValue(nextVehicle) : prev.vehicleCategory,
                                                slotCode: '',
                                                sourceVehicleRef: '',
                                                tireEventRef: '',
                                                sourceTireUsagePercent: null,
                                            }));
                                        }}
                                        disabled={saving}
                                    >
                                        <option value="">Pilih kendaraan</option>
                                        {installSelectableVehicles.map(vehicle => (
                                            <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Sumber Ban</label>
                                    <select
                                        className="form-select"
                                        value={installForm.tireSource}
                                        onChange={e => setInstallForm(prev => ({
                                            ...prev,
                                            tireSource: e.target.value as TireInstallFormState['tireSource'],
                                            sourceVehicleRef: '',
                                            tireEventRef: '',
                                            sourceTireUsagePercent: null,
                                        }))}
                                        disabled={saving || !installSelectedVehicle}
                                    >
                                        <option value="WAREHOUSE">Gudang Ban</option>
                                        <option value="UNIT">Unit Lain</option>
                                    </select>
                                </div>
                                {installForm.tireSource === 'UNIT' && (
                                    <div className="form-group">
                                        <label className="form-label">Unit Sumber</label>
                                        <select
                                            className="form-select"
                                            value={installForm.sourceVehicleRef}
                                            onChange={e => setInstallForm(prev => ({
                                                ...prev,
                                                sourceVehicleRef: e.target.value,
                                                tireEventRef: '',
                                                sourceTireUsagePercent: null,
                                            }))}
                                            disabled={saving || !installSelectedVehicle}
                                        >
                                            <option value="">{installSelectedVehicle ? 'Pilih unit sumber' : 'Pilih kendaraan tujuan dulu'}</option>
                                            {installSourceUnitOptions.map(option => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label} ({option.tireCount} ban)
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">{installForm.tireSource === 'WAREHOUSE' ? 'Ban dari Gudang' : 'Ban dari Unit'}</label>
                                    <select className="form-select" value={installForm.tireEventRef} onChange={e => updateInstallForm('tireEventRef', e.target.value)} disabled={saving || !installSelectedVehicle || (installForm.tireSource === 'UNIT' && !installForm.sourceVehicleRef)}>
                                        <option value="">{installSelectedVehicle ? (installForm.tireSource === 'WAREHOUSE' ? 'Pilih ban dari gudang' : installForm.sourceVehicleRef ? 'Pilih ban dari unit' : 'Pilih unit sumber dulu') : 'Pilih kendaraan dulu'}</option>
                                        {availableInstallTires.map(event => (
                                            <option key={event._id} value={event._id}>
                                                {event.tireCodeLabel} - {event.tireBrand} {event.tireSize} ({event.placementLabel})
                                            </option>
                                        ))}
                                    </select>
                                    {installSelectedVehicle && availableInstallTires.length === 0 && (
                                        <div style={{ fontSize: '0.76rem', color: 'var(--color-gray-600)', marginTop: '0.4rem' }}>
                                            {installForm.tireSource === 'WAREHOUSE'
                                                ? 'Tidak ada ban gudang yang tersedia.'
                                                : installForm.sourceVehicleRef
                                                    ? 'Tidak ada ban di unit sumber yang tersedia.'
                                                    : 'Pilih unit sumber untuk melihat ban yang tersedia.'}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Slot Ban</label>
                                    <select className="form-select" value={installForm.slotCode} onChange={e => updateInstallForm('slotCode', e.target.value)} disabled={saving || !installSelectedVehicle}>
                                        {!installSelectedVehicle && <option value="">Pilih kendaraan dulu</option>}
                                        {installSlotOptions.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Pasang</label>
                                    <input type="date" className="form-input" value={installForm.maintenanceDate} onChange={e => updateInstallForm('maintenanceDate', e.target.value)} disabled={saving} />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Ban Lama Dipindahkan Ke</label>
                                    <select className="form-select" value={installForm.oldTireDestination} onChange={e => updateInstallForm('oldTireDestination', e.target.value as TireInstallFormState['oldTireDestination'])} disabled={saving || !oldTireInInstallSlot}>
                                        <option value="WAREHOUSE">Gudang Ban</option>
                                        <option value="SCRAPPED">Afkir</option>
                                    </select>
                                </div>
                            </div>

                            {requiresInstallSourceUsagePercent && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Pemakaian Ban di Unit Sumber</label>
                                        <FormattedNumberInput
                                            allowDecimal
                                            maxFractionDigits={2}
                                            value={installForm.sourceTireUsagePercent}
                                            onValueChange={value => updateInstallForm('sourceTireUsagePercent', value)}
                                            placeholder={`Maks ${formatQuantity(selectedInstallRemainingPercent, 2)}%`}
                                            disabled={saving}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Preview Biaya Unit Sumber</label>
                                        <input className="form-input" value={`${formatCurrency(sourceInstallUsageCostPreview)} | sisa ${formatQuantity(sourceInstallRemainingPercentAfter, 2)}% (${formatCurrency(sourceInstallRemainingValueAfter)})`} readOnly />
                                    </div>
                                </div>
                            )}

                            {oldTireInInstallSlot && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Pemakaian Ban Lama di Unit Ini</label>
                                        <FormattedNumberInput
                                            allowDecimal
                                            maxFractionDigits={2}
                                            value={installForm.oldTireUsagePercent}
                                            onValueChange={value => updateInstallForm('oldTireUsagePercent', value)}
                                            placeholder={`Maks ${formatQuantity(oldRemainingPercent, 2)}%`}
                                            disabled={saving}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="form-row">
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.5rem', padding: '0.85rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.55rem' }}>
                                    {oldTireInInstallSlot ? (
                                        <>
                                            <div className="font-medium">{oldTireInInstallSlot.tireCodeLabel} - {oldTireInInstallSlot.tireBrand || '-'} {oldTireInInstallSlot.tireSize || ''}</div>
                                            <div className="text-sm">Posisi terakhir: {oldTireInInstallSlot.placementLabel}</div>
                                            <div className="text-sm">Terpakai {formatQuantity(oldInstallUsedBefore, 2)}% | Sisa {formatQuantity(oldRemainingPercent, 2)}% ({formatCurrency(oldInstallRemainingValueBefore)})</div>
                                        </>
                                    ) : (
                                        <div className="text-muted text-sm">Tidak ada biaya ban lama karena slot belum berisi ban.</div>
                                    )}
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.5rem', padding: '0.85rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.55rem' }}>
                                    {selectedInstallTire ? (
                                        <>
                                            <div className="font-medium">{selectedInstallTire.tireCodeLabel} - {selectedInstallTire.tireBrand || '-'} {selectedInstallTire.tireSize || ''}</div>
                                            <div className="text-sm">Posisi terakhir: {selectedInstallTire.placementLabel}</div>
                                            <div className="text-sm">Terpakai {formatQuantity(selectedInstallTire.totalUsedPercent || 0, 2)}% | Sisa {formatQuantity(selectedInstallRemainingPercent, 2)}% ({formatCurrency(selectedInstallRemainingValue)})</div>
                                        </>
                                    ) : (
                                        <div className="text-muted text-sm">Pilih ban untuk melihat persentase dan biaya yang akan masuk maintenance.</div>
                                    )}
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Total Biaya Ban</label>
                                    <input className="form-input" value={formatCurrency(installTotalCostPreview)} readOnly />
                                </div>
                            </div>

                            <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                <div>
                                    <div className="font-medium">Biaya Teknisi</div>
                                    <div className="text-muted text-sm">Isi 0 kalau tidak ada biaya teknisi.</div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Biaya Teknisi</label>
                                        <FormattedNumberInput allowDecimal={false} value={installForm.technicianCost} onValueChange={value => updateInstallForm('technicianCost', value)} disabled={saving} zeroAsEmpty />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Teknisi / Bengkel</label>
                                        <input className="form-input" value={installForm.technicianVendor} onChange={e => updateInstallForm('technicianVendor', e.target.value)} placeholder="Opsional" disabled={saving} />
                                    </div>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={installForm.note} onChange={e => updateInstallForm('note', e.target.value)} disabled={saving} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowInstallModal(false)} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleInstallSave} disabled={saving}>{saving ? 'Memasang...' : 'Pasang Ban'}</button>
                        </div>
                    </div>
                </div>
            )}

            {historyTarget && (
                <div className="modal-overlay" onClick={() => { if (!loadingHistory) setHistoryTarget(null); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Riwayat Ban {historyTarget.tireCodeLabel}</h3>
                            <button className="modal-close" onClick={() => setHistoryTarget(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ marginBottom: '1rem', color: 'var(--color-gray-600)' }}>
                                {historyTarget.tireBrand} | {historyTarget.tireSize} | {historyTarget.placementLabel}
                            </div>
                            <div style={{ display: 'grid', gap: '0.85rem' }}>
                                {loadingHistory ? (
                                    [1, 2, 3].map(item => <div key={item} className="skeleton skeleton-card" style={{ height: 72 }} />)
                                ) : historyRows.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-title">Belum ada riwayat ban</div>
                                        <div className="empty-state-text">Riwayat akan tercatat otomatis saat ban dibuat atau dipindahkan.</div>
                                    </div>
                                ) : historyRows.map(log => (
                                    <div key={log._id} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.85rem', padding: '0.95rem 1rem', background: 'var(--color-gray-50)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                                            <span className={`badge badge-${getTireHistoryActionColor(log.actionType)}`}>
                                                <span className="badge-dot" /> {getTireHistoryActionLabel(log.actionType)}
                                            </span>
                                            <div className="text-muted text-sm">{formatDateTime(log.timestamp)}</div>
                                        </div>
                                        <div className="font-medium" style={{ marginBottom: '0.25rem' }}>{getTireHistoryTransitionLabel(log)}</div>
                                        <div className="text-muted text-sm" style={{ marginBottom: '0.25rem' }}>{log.note || '-'}</div>
                                        {typeof log.usageCost === 'number' && (
                                            <div className="text-muted text-sm" style={{ marginBottom: '0.25rem' }}>
                                                Pemakaian {formatQuantity(log.usagePercent || 0, 2)}% oleh {log.costSourceVehiclePlate || '-'} = {formatCurrency(log.usageCost)}. Sisa {formatQuantity(log.remainingPercentAfter || 0, 2)}% ({formatCurrency(log.remainingValueAfter || 0)}).
                                            </div>
                                        )}
                                        <div className="text-muted text-sm">Oleh: {log.actorUserName || '-'}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setHistoryTarget(null)}>Tutup</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

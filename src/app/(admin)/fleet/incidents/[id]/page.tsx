'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Pencil, Plus, Printer, ReceiptText, Save, Trash2, Wrench, XCircle } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData, fetchAllAdminCollectionData, fetchOptionalAdminCollectionData, fetchOptionalAdminData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import {
    buildIncidentPrintHtml,
    canDeleteIncidentSettlementLine,
    canEditIncidentSettlementLine,
    canMarkIncidentRecoveryPosted,
    canPostIncidentSettlementLine,
    createDefaultIncidentExpensePostForm,
    createDefaultIncidentSettlementForm,
    getAvailableIncidentStatusesForContext,
    getIncidentSettlementCategoryOptions,
    hasUnsettledIncidentSettlementLines,
    sortIncidentActionLogs,
    sortIncidentSettlementLines,
    summarizeIncidentSettlements,
} from '@/lib/fleet-incident-detail-support';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import { hasPermission } from '@/lib/rbac';
import { getExpenseCategoryScopeLabel, inferExpenseCategoryScope } from '@/lib/expense-category-scope';
import { getBusinessDateValue } from '@/lib/business-date';
import { INVENTORY_UNIT_OPTIONS, isTireTrackedWarehouseItem } from '@/lib/inventory';
import { resolveFleetTireEvents } from '@/lib/fleet-asset-page-support';
import { DEFAULT_TIRE_TYPE, normalizeTireType, TIRE_TYPE_OPTIONS } from '@/lib/tire-types';
import { compareTireSlotCodes, formatTireSlotLabel, getSuggestedVehicleTireLayout, resolveTireSlotCode } from '@/lib/tire-slots';
import type {
    BankAccount,
    ExpenseCategory,
    Incident,
    IncidentActionLog,
    IncidentExpenseRoute,
    IncidentSettlementCategory,
    IncidentSettlementLine,
    IncidentSettlementLineType,
    InventoryUnit,
    TireEvent,
    TireType,
    Vehicle,
    WarehouseItem,
} from '@/lib/types';
import {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatQuantity,
    INCIDENT_SETTLEMENT_CATEGORY_MAP,
    INCIDENT_SETTLEMENT_LINE_TYPE_MAP,
    INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP,
    INCIDENT_SETTLEMENT_STATUS_MAP,
    INCIDENT_STATUS_MAP,
    INCIDENT_TYPE_MAP,
    URGENCY_MAP,
} from '@/lib/utils';
import { useApp, useToast } from '../../../layout';

const TYPE_OPTIONS: Array<{ value: IncidentSettlementLineType; label: string }> = [
    { value: 'COST', label: 'Biaya' },
    { value: 'COMPENSATION', label: 'Santunan' },
    { value: 'RECOVERY', label: 'Recovery' },
];
const RECIPIENT_OPTIONS = ['DRIVER', 'KERNET', 'THIRD_PARTY', 'FAMILY', 'VENDOR', 'INSURANCE', 'INTERNAL', 'OTHER'] as const;
const INCIDENT_EXPENSE_ROUTE_OPTIONS: Array<{ value: IncidentExpenseRoute; label: string; hint: string }> = [
    {
        value: 'DRIVER_VOUCHER',
        label: 'Masuk Uang Jalan Driver',
        hint: 'Supir memakai uang jalan atau perlu reimburse lewat bon trip.',
    },
    {
        value: 'COMPANY_EXPENSE',
        label: 'Pengeluaran Perusahaan',
        hint: 'Perusahaan membayar toko, bengkel, vendor, ban, atau sparepart.',
    },
];
type IncidentTireFollowUpForm = {
    linkedWarehouseItemRef: string;
    tireCode: string;
    tireType: TireType;
    tireBrand: string;
    tireSize: string;
    installDate: string;
    originalCost: number;
    notes: string;
};

function createDefaultIncidentTireFollowUpForm(): IncidentTireFollowUpForm {
    return {
        linkedWarehouseItemRef: '',
        tireCode: '',
        tireType: DEFAULT_TIRE_TYPE,
        tireBrand: '',
        tireSize: '',
        installDate: '',
        originalCost: 0,
        notes: '',
    };
}

type IncidentTireInstallForm = {
    slotCode: string;
    maintenanceDate: string;
    oldTireUsagePercent: number | null;
    oldTireDestination: 'WAREHOUSE' | 'SCRAPPED';
    note: string;
};

function createDefaultIncidentTireInstallForm(): IncidentTireInstallForm {
    return {
        slotCode: '',
        maintenanceDate: '',
        oldTireUsagePercent: null,
        oldTireDestination: 'WAREHOUSE',
        note: '',
    };
}

type IncidentMaintenanceSourceMode = 'WAREHOUSE_STOCK' | 'DIRECT_PURCHASE';

type IncidentHandlingWarehouseLine = {
    rowId: string;
    warehouseItemRef: string;
    quantity: number;
    attachToVehicle: boolean;
    componentLabel: string;
    note: string;
};

type IncidentHandlingDirectLine = {
    rowId: string;
    linkedWarehouseItemRef: string;
    itemName: string;
    unit: InventoryUnit;
    quantity: number;
    unitCost: number;
    attachToVehicle: boolean;
    componentLabel: string;
    note: string;
    leftoverWarehouseItemRef: string;
    leftoverQty: number;
};

type IncidentHandlingForm = {
    sourceMode: IncidentMaintenanceSourceMode;
    settlementLineRef: string;
    completedDate: string;
    odometerAtService: number;
    vendor: string;
    maintenanceType: string;
    completionNotes: string;
    warehouseMaterials: IncidentHandlingWarehouseLine[];
    directMaterials: IncidentHandlingDirectLine[];
};

function createEmptyIncidentHandlingWarehouseLine(): IncidentHandlingWarehouseLine {
    return {
        rowId: crypto.randomUUID(),
        warehouseItemRef: '',
        quantity: 0,
        attachToVehicle: false,
        componentLabel: '',
        note: '',
    };
}

function createEmptyIncidentHandlingDirectLine(): IncidentHandlingDirectLine {
    return {
        rowId: crypto.randomUUID(),
        linkedWarehouseItemRef: '',
        itemName: '',
        unit: 'PCS',
        quantity: 0,
        unitCost: 0,
        attachToVehicle: false,
        componentLabel: '',
        note: '',
        leftoverWarehouseItemRef: '',
        leftoverQty: 0,
    };
}

function createDefaultIncidentHandlingForm(
    incident?: Pick<Incident, 'odometer'> | null,
    sourceMode: IncidentMaintenanceSourceMode = 'WAREHOUSE_STOCK',
    line?: IncidentSettlementLine | null
): IncidentHandlingForm {
    return {
        sourceMode,
        settlementLineRef: line?._id || '',
        completedDate: line?.date || getBusinessDateValue(),
        odometerAtService: typeof incident?.odometer === 'number' ? incident.odometer : 0,
        vendor: line?.payeeName || '',
        maintenanceType: sourceMode === 'DIRECT_PURCHASE'
            ? line?.category === 'REPAIR'
                ? 'Penanganan Perbaikan Insiden'
                : 'Penanganan Sparepart Insiden'
            : 'Pemakaian Barang Gudang Insiden',
        completionNotes: line?.description || '',
        warehouseMaterials: [createEmptyIncidentHandlingWarehouseLine()],
        directMaterials: line?.category === 'REPAIR' ? [] : [createEmptyIncidentHandlingDirectLine()],
    };
}

function getTireRemainingPercent(tire: Pick<TireEvent, 'remainingPercent' | 'totalUsedPercent'> | null | undefined) {
    const explicit = Number(tire?.remainingPercent);
    if (Number.isFinite(explicit)) return Math.max(explicit, 0);
    return Math.max(100 - Number(tire?.totalUsedPercent || 0), 0);
}

function getTireOriginalCost(tire: Pick<TireEvent, 'originalCost' | 'purchaseCost'> | null | undefined) {
    return Number(tire?.originalCost ?? tire?.purchaseCost ?? 0) || 0;
}

function getIncidentExpenseRouteLabel(route?: string) {
    if (route === 'DRIVER_VOUCHER') return 'Masuk biaya lain-lain uang jalan';
    if (route === 'COMPANY_EXPENSE') return 'Masuk pengeluaran perusahaan';
    return '';
}

function getExpenseCategoryRouteScopes(route: IncidentExpenseRoute | '') {
    if (route === 'DRIVER_VOUCHER') return new Set(['TRIP', 'INCIDENT']);
    if (route === 'COMPANY_EXPENSE') return new Set(['INCIDENT', 'MAINTENANCE']);
    return new Set<string>();
}

function categoryNameIncludes(category: ExpenseCategory, keywords: string[]) {
    const name = String(category.name || '').toLowerCase();
    return keywords.some(keyword => name.includes(keyword));
}

function findSuggestedIncidentExpenseCategory(
    categories: ExpenseCategory[],
    line: IncidentSettlementLine,
    route: IncidentExpenseRoute | ''
) {
    const options = categories.filter(category =>
        getExpenseCategoryRouteScopes(route).has(inferExpenseCategoryScope(category))
    );
    const findByName = (keywords: string[]) => options.find(category => categoryNameIncludes(category, keywords));
    if (route === 'COMPANY_EXPENSE') {
        if (line.category === 'TIRE') return findByName(['ban'])?._id || '';
        if (line.category === 'SPAREPART') return findByName(['sparepart', 'oli'])?._id || '';
        if (line.category === 'REPAIR') return findByName(['servis', 'service', 'maintenance', 'perbaikan'])?._id || '';
    }
    if (line.category === 'TOWING') return findByName(['towing', 'evakuasi'])?._id || '';
    if (line.category === 'ACCOMMODATION') return findByName(['menginap', 'hotel', 'akomodasi'])?._id || '';
    if (line.category === 'CARGO_HANDLING') return findByName(['bongkar', 'handling'])?._id || '';
    if (line.category === 'REPAIR' || line.category === 'SPAREPART' || line.category === 'TIRE') return findByName(['perbaikan', 'darurat'])?._id || '';
    return findByName(['lain-lain', 'lain lain'])?._id || options[0]?._id || '';
}

export default function IncidentDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const incidentId = params.id as string;
    const canManageIncident = user ? hasPermission(user, 'incidents', 'update') : false;
    const canCreateExpense = user ? hasPermission(user, 'expenses', 'create') : false;
    const canCreateTires = user ? hasPermission(user, 'tires', 'create') : false;
    const canInstallTires = user ? hasPermission(user, 'tires', 'update') : false;
    const canCreateMaintenance = user ? hasPermission(user, 'maintenance', 'create') : false;

    const [incident, setIncident] = useState<Incident | null>(null);
    const [logs, setLogs] = useState<IncidentActionLog[]>([]);
    const [lines, setLines] = useState<IncidentSettlementLine[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
    const [trackedTireWarehouseItems, setTrackedTireWarehouseItems] = useState<WarehouseItem[]>([]);
    const [incidentVehicle, setIncidentVehicle] = useState<Vehicle | null>(null);
    const [tireEvents, setTireEvents] = useState<TireEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [actionNote, setActionNote] = useState('');
    const [savingStatus, setSavingStatus] = useState(false);
    const [showLineModal, setShowLineModal] = useState(false);
    const [editingLine, setEditingLine] = useState<IncidentSettlementLine | null>(null);
    const [lineForm, setLineForm] = useState(createDefaultIncidentSettlementForm());
    const [savingLine, setSavingLine] = useState(false);
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [postingLine, setPostingLine] = useState<IncidentSettlementLine | null>(null);
    const [expenseForm, setExpenseForm] = useState(createDefaultIncidentExpensePostForm());
    const [postingExpense, setPostingExpense] = useState(false);
    const [showTireFollowUpModal, setShowTireFollowUpModal] = useState(false);
    const [tireFollowUpLine, setTireFollowUpLine] = useState<IncidentSettlementLine | null>(null);
    const [tireFollowUpForm, setTireFollowUpForm] = useState(createDefaultIncidentTireFollowUpForm());
    const [savingTireFollowUp, setSavingTireFollowUp] = useState(false);
    const [showTireInstallModal, setShowTireInstallModal] = useState(false);
    const [tireInstallLine, setTireInstallLine] = useState<IncidentSettlementLine | null>(null);
    const [tireInstallForm, setTireInstallForm] = useState(createDefaultIncidentTireInstallForm());
    const [savingTireInstall, setSavingTireInstall] = useState(false);
    const [showHandlingModal, setShowHandlingModal] = useState(false);
    const [handlingLine, setHandlingLine] = useState<IncidentSettlementLine | null>(null);
    const [handlingForm, setHandlingForm] = useState(createDefaultIncidentHandlingForm());
    const [savingHandling, setSavingHandling] = useState(false);
    const [creatingMaintenanceLineRef, setCreatingMaintenanceLineRef] = useState('');

    const loadDetail = useCallback(async () => {
        setLoading(true);
        setLoadNotice(null);
        try {
            const filter = encodeURIComponent(JSON.stringify({ incidentRef: incidentId }));
            const optionalFetchOptions = { onError: (message: string) => addToast('error', message), silentAccessDenied: true };
            const tasks: Array<Promise<unknown>> = [
                fetchAdminData<Incident | null>(`/api/data?entity=incidents&id=${incidentId}`, 'Gagal memuat insiden'),
                fetchAllAdminCollectionData<IncidentActionLog>(`/api/data?entity=incident-action-logs&filter=${filter}`, 'Gagal memuat log insiden'),
                fetchAllAdminCollectionData<IncidentSettlementLine>(`/api/data?entity=incident-settlement-lines&filter=${filter}`, 'Gagal memuat detail biaya insiden'),
                canCreateExpense
                    ? fetchOptionalAdminCollectionData<ExpenseCategory>('/api/data?entity=expense-categories', 'Gagal memuat referensi pengeluaran', undefined, optionalFetchOptions)
                    : Promise.resolve([]),
                canCreateExpense
                    ? fetchOptionalAdminCollectionData<BankAccount>('/api/data?entity=bank-accounts', 'Gagal memuat referensi pengeluaran', undefined, optionalFetchOptions)
                    : Promise.resolve([]),
                (canCreateTires || canCreateMaintenance)
                    ? fetchOptionalAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items', 'Gagal memuat master barang gudang', undefined, optionalFetchOptions)
                    : Promise.resolve([]),
            ];
            const [incidentData, actionLogs, lineRows, categoryRows, accountRows, warehouseRows] = await Promise.all(tasks);
            const nextIncident = (incidentData as Incident | null) || null;
            const [vehicleData, tireRows] = canInstallTires
                ? await Promise.all([
                    nextIncident?.vehicleRef
                        ? fetchOptionalAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${nextIncident.vehicleRef}`, 'Gagal memuat unit insiden', optionalFetchOptions)
                        : Promise.resolve(null),
                    fetchOptionalAdminCollectionData<TireEvent>('/api/data?entity=tire-events', 'Gagal memuat data ban', undefined, optionalFetchOptions),
                ])
                : [null, []];
            setIncident(nextIncident);
            setLogs(sortIncidentActionLogs((actionLogs as IncidentActionLog[]) || []));
            setLines(sortIncidentSettlementLines((lineRows as IncidentSettlementLine[]) || []));
            setExpenseCategories(canCreateExpense
                ? (((categoryRows as ExpenseCategory[]) || []).filter(item => {
                    const scope = inferExpenseCategoryScope(item);
                    return item.active !== false && (scope === 'INCIDENT' || scope === 'TRIP' || scope === 'MAINTENANCE');
                }))
                : []
            );
            setBankAccounts(canCreateExpense ? (((accountRows as BankAccount[]) || []).filter(item => item.active !== false)) : []);
            setWarehouseItems(canCreateTires || canCreateMaintenance ? (((warehouseRows as WarehouseItem[]) || []).filter(item => item.active !== false)) : []);
            setTrackedTireWarehouseItems(canCreateTires
                ? (((warehouseRows as WarehouseItem[]) || []).filter(item => item.active !== false && isTireTrackedWarehouseItem(item)))
                : []
            );
            setIncidentVehicle((vehicleData as Vehicle | null) || null);
            setTireEvents(canInstallTires ? ((tireRows as TireEvent[]) || []) : []);
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail insiden');
            setLoadNotice(buildAdminLoadNotice(
                message,
                'Insiden',
                'Halaman ini hanya bisa dilihat oleh role yang punya akses Insiden.'
            ));
            addToast('error', message);
        } finally {
            setLoading(false);
        }
    }, [addToast, canCreateExpense, canCreateMaintenance, canCreateTires, canInstallTires, incidentId]);

    useEffect(() => { void loadDetail(); }, [loadDetail]);

    const summary = useMemo(() => summarizeIncidentSettlements(lines), [lines]);
    const grossExposure = summary.totalCost + summary.totalCompensation;
    const netExposure = grossExposure - summary.postedRecovery;
    const hasPendingSettlement = useMemo(() => hasUnsettledIncidentSettlementLines(lines), [lines]);
    const availableStatuses = incident ? getAvailableIncidentStatusesForContext(incident.status) : [];
    const lineCategories = getIncidentSettlementCategoryOptions(lineForm.lineType);
    const incidentClosed = incident?.status === 'CLOSED';
    const hasPendingDriverResolution = Boolean(
        incident?.pendingDriverResolutionRequestedAt
    );
    const expenseCategoryOptions = useMemo(() => {
        const allowedScopes = getExpenseCategoryRouteScopes(expenseForm.incidentExpenseRoute);
        return expenseCategories.filter(category => allowedScopes.has(inferExpenseCategoryScope(category)));
    }, [expenseCategories, expenseForm.incidentExpenseRoute]);
    const selectedTireWarehouseItem = useMemo(
        () => trackedTireWarehouseItems.find(item => item._id === tireFollowUpForm.linkedWarehouseItemRef) || null,
        [tireFollowUpForm.linkedWarehouseItemRef, trackedTireWarehouseItems]
    );
    const standardWarehouseItems = useMemo(
        () => warehouseItems.filter(item => item.active !== false && !isTireTrackedWarehouseItem(item)),
        [warehouseItems]
    );
    const stockedStandardWarehouseItems = useMemo(
        () => standardWarehouseItems.filter(item => Number(item.currentStockQty || 0) > 0),
        [standardWarehouseItems]
    );
    const directPurchaseLineOptions = useMemo(
        () => lines.filter(line =>
            line.lineType === 'COST' &&
            (line.category === 'REPAIR' || line.category === 'SPAREPART') &&
            line.status === 'POSTED' &&
            Boolean(line.linkedExpenseRef) &&
            !line.linkedMaintenanceRef
        ),
        [lines]
    );
    const selectedHandlingLine = useMemo(
        () => handlingForm.settlementLineRef
            ? lines.find(line => line._id === handlingForm.settlementLineRef) || null
            : handlingLine,
        [handlingForm.settlementLineRef, handlingLine, lines]
    );
    const directAllocatedTotal = useMemo(
        () => handlingForm.directMaterials.reduce((sum, row) => {
            const quantity = Number(row.quantity || 0);
            const leftoverQty = Number(row.leftoverQty || 0);
            const unitCost = Number(row.unitCost || 0);
            return sum + Math.max(quantity, 0) * Math.max(unitCost, 0) + Math.max(leftoverQty, 0) * Math.max(unitCost, 0);
        }, 0),
        [handlingForm.directMaterials]
    );
    const directExpenseAmount = Math.max(Number(selectedHandlingLine?.linkedExpenseAmount ?? selectedHandlingLine?.amount ?? 0) || 0, 0);
    const directUnallocatedAmount = Math.max(directExpenseAmount - directAllocatedTotal, 0);
    const directOverAllocatedAmount = Math.max(directAllocatedTotal - directExpenseAmount, 0);
    const resolvedTireEvents = useMemo(() => resolveFleetTireEvents(tireEvents), [tireEvents]);
    const tireById = useMemo(
        () => new Map(resolvedTireEvents.map(tire => [tire._id, tire])),
        [resolvedTireEvents]
    );
    const getLinkedTireForLine = useCallback(
        (line: IncidentSettlementLine) => line.linkedTireEventRef ? tireById.get(line.linkedTireEventRef) || null : null,
        [tireById]
    );
    const installTargetTire = tireInstallLine ? getLinkedTireForLine(tireInstallLine) : null;
    const installedVehicleTires = useMemo(
        () => resolvedTireEvents
            .filter(tire =>
                tire.vehicleRef === incident?.vehicleRef &&
                tire.holderType === 'INTERNAL_VEHICLE' &&
                tire.status === 'IN_USE' &&
                Boolean(resolveTireSlotCode(tire))
            ),
        [incident?.vehicleRef, resolvedTireEvents]
    );
    const incidentTireSlotOptions = useMemo(() => {
        if (!incidentVehicle) return [];
        const layout = getSuggestedVehicleTireLayout(
            incidentVehicle.vehicleType,
            incidentVehicle.serviceName,
            installedVehicleTires.map(tire => resolveTireSlotCode(tire)).filter((slot): slot is string => Boolean(slot)),
            incidentVehicle.tireLayoutConfig
        );
        return layout.allSlots.slice().sort(compareTireSlotCodes);
    }, [incidentVehicle, installedVehicleTires]);
    const oldTireInInstallSlot = useMemo(() => {
        const selectedSlot = tireInstallForm.slotCode.trim();
        if (!selectedSlot) return null;
        return installedVehicleTires.find(tire =>
            tire._id !== installTargetTire?._id &&
            resolveTireSlotCode(tire) === selectedSlot
        ) || null;
    }, [installTargetTire?._id, installedVehicleTires, tireInstallForm.slotCode]);
    const oldTireRemainingPercent = getTireRemainingPercent(oldTireInInstallSlot);
    const oldTireUsagePercent = typeof tireInstallForm.oldTireUsagePercent === 'number' ? tireInstallForm.oldTireUsagePercent : 0;
    const oldTireUsageCostPreview = Math.round(getTireOriginalCost(oldTireInInstallSlot) * oldTireUsagePercent / 100);
    const oldTireRemainingPercentAfter = Math.max(oldTireRemainingPercent - oldTireUsagePercent, 0);
    const oldTireRemainingValueAfter = Math.round(getTireOriginalCost(oldTireInInstallSlot) * oldTireRemainingPercentAfter / 100);

    const resetLineModal = () => {
        setShowLineModal(false);
        setEditingLine(null);
        setLineForm(createDefaultIncidentSettlementForm());
    };

    const openStatusModal = () => {
        setNewStatus(availableStatuses[0] || '');
        setActionNote('');
        setShowStatusModal(true);
    };

    const openLineModal = (line?: IncidentSettlementLine) => {
        if (line) {
            setEditingLine(line);
            setLineForm({
                lineType: line.lineType,
                category: line.category,
                date: line.date,
                amount: line.amount,
                description: line.description,
                payeeName: line.payeeName || '',
                recipientType: line.recipientType || '',
                note: line.note || '',
            });
        } else {
            setEditingLine(null);
            setLineForm(createDefaultIncidentSettlementForm());
        }
        setShowLineModal(true);
    };

    const setLineType = (lineType: IncidentSettlementLineType) => {
        const categories = getIncidentSettlementCategoryOptions(lineType);
        setLineForm(prev => ({ ...prev, lineType, category: categories[0] as IncidentSettlementCategory, recipientType: lineType === 'COMPENSATION' ? prev.recipientType : '' }));
    };

    const handleIncidentStatusSave = async () => {
        if (!incident?._id || !incident._rev || !newStatus || !actionNote.trim()) {
            addToast('error', 'Status dan catatan wajib diisi');
            return;
        }
        setSavingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incidents', action: 'set-status', data: { id: incident._id, revision: incident._rev, status: newStatus, note: actionNote.trim() } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal memperbarui status insiden');
            addToast('success', 'Status insiden diperbarui');
            setShowStatusModal(false);
            setNewStatus('');
            setActionNote('');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal memperbarui status insiden');
        } finally {
            setSavingStatus(false);
        }
    };

    const approveDriverResolution = async () => {
        if (!incident?._id || !incident._rev) {
            addToast('error', 'Data insiden tidak lengkap. Refresh lalu coba lagi.');
            return;
        }
        setSavingStatus(true);
        try {
            const note = incident.pendingDriverResolutionNote
                ? `Admin menyetujui pengajuan selesai driver: ${incident.pendingDriverResolutionNote}`
                : 'Admin menyetujui pengajuan selesai driver';
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incidents', action: 'set-status', data: { id: incident._id, revision: incident._rev, status: 'RESOLVED', note } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal menyetujui pengajuan selesai driver');
            addToast('success', 'Pengajuan selesai driver disetujui');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal menyetujui pengajuan selesai driver');
        } finally {
            setSavingStatus(false);
        }
    };

    const handleLineSave = async () => {
        if (!incident?._id || !lineForm.description.trim() || lineForm.amount <= 0) return addToast('error', 'Deskripsi dan nominal wajib diisi');
        if (lineForm.lineType === 'COMPENSATION' && (!lineForm.payeeName.trim() || !lineForm.recipientType)) return addToast('error', 'Penerima santunan dan jenis penerima wajib diisi');
        if (lineForm.lineType === 'RECOVERY' && !lineForm.payeeName.trim()) return addToast('error', 'Sumber recovery wajib diisi');
        setSavingLine(true);
        try {
            const body = editingLine
                ? { entity: 'incident-settlement-lines', action: 'update', data: { id: editingLine._id, revision: editingLine._rev, updates: { ...lineForm, payeeName: lineForm.payeeName || undefined, recipientType: lineForm.recipientType || undefined, note: lineForm.note || undefined } } }
                : { entity: 'incident-settlement-lines', data: { incidentRef: incident._id, ...lineForm, payeeName: lineForm.payeeName || undefined, recipientType: lineForm.recipientType || undefined, note: lineForm.note || undefined } };
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal menyimpan detail insiden');
            addToast('success', editingLine ? 'Detail insiden diperbarui' : 'Detail insiden ditambahkan');
            resetLineModal();
            await loadDetail();
        } catch {
            addToast('error', 'Gagal menyimpan detail insiden');
        } finally {
            setSavingLine(false);
        }
    };

    const updateLineStatus = async (line: IncidentSettlementLine, status: string) => {
        if (!line._rev) return addToast('error', 'Revisi detail insiden tidak tersedia. Refresh halaman lalu coba lagi.');
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incident-settlement-lines', action: 'set-status', data: { id: line._id, revision: line._rev, status } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal mengubah status detail insiden');
            addToast('success', 'Status detail insiden diperbarui');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal mengubah status detail insiden');
        }
    };

    const deleteLine = async (line: IncidentSettlementLine) => {
        if (!line._rev) return addToast('error', 'Revisi detail insiden tidak tersedia. Refresh halaman lalu coba lagi.');
        if (!window.confirm('Hapus detail insiden draft ini?')) return;
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incident-settlement-lines', action: 'delete', data: { id: line._id, revision: line._rev } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal menghapus detail insiden');
            addToast('success', 'Detail insiden dihapus');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal menghapus detail insiden');
        }
    };

    const openExpenseModal = (line: IncidentSettlementLine) => {
        setPostingLine(line);
        setExpenseForm({ date: line.date, incidentExpenseRoute: '', categoryRef: '', bankAccountRef: '', note: line.note || line.payeeName || '', description: line.description || '' });
        setShowExpenseModal(true);
    };

    const openTireFollowUpModal = (line: IncidentSettlementLine) => {
        setTireFollowUpLine(line);
        setTireFollowUpForm({
            ...createDefaultIncidentTireFollowUpForm(),
            installDate: line.date,
            originalCost: line.amount || 0,
            notes: line.note || '',
        });
        setShowTireFollowUpModal(true);
    };

    const closeTireFollowUpModal = (force = false) => {
        if (savingTireFollowUp && !force) return;
        setShowTireFollowUpModal(false);
        setTireFollowUpLine(null);
        setTireFollowUpForm(createDefaultIncidentTireFollowUpForm());
    };

    const updateTireFollowUpWarehouseItem = (warehouseItemRef: string) => {
        const item = trackedTireWarehouseItems.find(row => row._id === warehouseItemRef) || null;
        setTireFollowUpForm(prev => ({
            ...prev,
            linkedWarehouseItemRef: warehouseItemRef,
            tireBrand: prev.tireBrand || item?.tireBrandDefault || '',
            tireSize: prev.tireSize || item?.tireSizeDefault || '',
            tireType: normalizeTireType(item?.tireTypeDefault || prev.tireType),
            originalCost: prev.originalCost || item?.defaultPurchasePrice || 0,
        }));
    };

    const canInstallIncidentTire = useCallback((line: IncidentSettlementLine) => {
        const tire = getLinkedTireForLine(line);
        return Boolean(
            canInstallTires &&
            incident?.vehicleRef &&
            line.lineType === 'COST' &&
            line.category === 'TIRE' &&
            line.status === 'POSTED' &&
            line.linkedExpenseRef &&
            line.linkedTireEventRef &&
            tire &&
            tire.holderType === 'WAREHOUSE' &&
            tire.status === 'IN_WAREHOUSE'
        );
    }, [canInstallTires, getLinkedTireForLine, incident?.vehicleRef]);

    const openTireInstallModal = (line: IncidentSettlementLine) => {
        const tire = getLinkedTireForLine(line);
        if (!incident?.vehicleRef) {
            addToast('error', 'Kendaraan insiden tidak tersedia untuk pemasangan ban');
            return;
        }
        if (!incidentVehicle) {
            addToast('error', 'Data unit armada belum termuat. Refresh halaman lalu coba lagi.');
            return;
        }
        if (!tire) {
            addToast('error', 'Aset ban insiden belum ditemukan. Refresh halaman lalu coba lagi.');
            return;
        }
        if (tire.holderType !== 'WAREHOUSE' || tire.status !== 'IN_WAREHOUSE') {
            addToast('error', 'Aset ban ini tidak berada di Gudang Ban, jadi tidak bisa dipasang dari insiden.');
            return;
        }
        const occupiedSlots = new Set(installedVehicleTires.map(row => resolveTireSlotCode(row)).filter(Boolean));
        const defaultSlot = incidentTireSlotOptions.find(slot => !occupiedSlots.has(slot)) || incidentTireSlotOptions[0] || '';
        setTireInstallLine(line);
        setTireInstallForm({
            ...createDefaultIncidentTireInstallForm(),
            slotCode: defaultSlot,
            maintenanceDate: line.date,
            note: `Pasang ban ${tire.tireCodeLabel || tire.tireCode || ''} dari insiden ${incident.incidentNumber || ''}`.trim(),
        });
        setShowTireInstallModal(true);
    };

    const closeTireInstallModal = (force = false) => {
        if (savingTireInstall && !force) return;
        setShowTireInstallModal(false);
        setTireInstallLine(null);
        setTireInstallForm(createDefaultIncidentTireInstallForm());
    };

    const saveTireInstall = async () => {
        if (!tireInstallLine?.linkedTireEventRef) return addToast('error', 'Aset ban insiden belum tertaut');
        if (!incident?.vehicleRef) return addToast('error', 'Kendaraan insiden tidak tersedia untuk pemasangan ban');
        if (!tireInstallForm.slotCode) return addToast('error', 'Pilih slot ban tujuan');
        if (!tireInstallForm.maintenanceDate) return addToast('error', 'Tanggal pasang wajib diisi');
        if (!installTargetTire || installTargetTire.holderType !== 'WAREHOUSE' || installTargetTire.status !== 'IN_WAREHOUSE') {
            return addToast('error', 'Ban sumber harus berada di Gudang Ban sebelum dipasang');
        }
        if (oldTireInInstallSlot) {
            if (tireInstallForm.oldTireUsagePercent === null || !Number.isFinite(tireInstallForm.oldTireUsagePercent)) {
                return addToast('error', 'Isi persentase pemakaian ban lama di slot tujuan');
            }
            if (tireInstallForm.oldTireUsagePercent < 0 || tireInstallForm.oldTireUsagePercent > oldTireRemainingPercent) {
                return addToast('error', `Persentase ban lama harus 0-${formatQuantity(oldTireRemainingPercent, 2)}%`);
            }
        }

        setSavingTireInstall(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'tire-events',
                    action: 'install-to-slot',
                    data: {
                        tireEventRef: tireInstallLine.linkedTireEventRef,
                        vehicleRef: incident.vehicleRef,
                        slotCode: tireInstallForm.slotCode,
                        oldTireUsagePercent: oldTireInInstallSlot ? tireInstallForm.oldTireUsagePercent : undefined,
                        oldTireDestination: oldTireInInstallSlot ? tireInstallForm.oldTireDestination : undefined,
                        maintenanceDate: tireInstallForm.maintenanceDate,
                        note: tireInstallForm.note.trim() || undefined,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal memasang ban insiden ke unit');
            addToast('success', 'Ban insiden berhasil dipasang ke unit armada');
            closeTireInstallModal(true);
            await loadDetail();
        } catch {
            addToast('error', 'Gagal memasang ban insiden ke unit');
        } finally {
            setSavingTireInstall(false);
        }
    };

    const openHandlingModal = (line?: IncidentSettlementLine, sourceMode: IncidentMaintenanceSourceMode = 'WAREHOUSE_STOCK') => {
        const nextLine = sourceMode === 'DIRECT_PURCHASE'
            ? line || directPurchaseLineOptions[0] || null
            : null;
        setHandlingLine(nextLine);
        setHandlingForm(createDefaultIncidentHandlingForm(incident, sourceMode, nextLine));
        setShowHandlingModal(true);
    };

    const closeHandlingModal = (force = false) => {
        if (savingHandling && !force) return;
        setShowHandlingModal(false);
        setHandlingLine(null);
        setHandlingForm(createDefaultIncidentHandlingForm(incident));
    };

    const switchHandlingSourceMode = (sourceMode: IncidentMaintenanceSourceMode) => {
        const nextLine = sourceMode === 'DIRECT_PURCHASE'
            ? selectedHandlingLine || directPurchaseLineOptions[0] || null
            : null;
        setHandlingLine(nextLine);
        setHandlingForm(prev => ({
            ...createDefaultIncidentHandlingForm(incident, sourceMode, nextLine),
            completedDate: prev.completedDate || getBusinessDateValue(),
            odometerAtService: prev.odometerAtService,
            vendor: sourceMode === 'DIRECT_PURCHASE' ? (nextLine?.payeeName || prev.vendor) : prev.vendor,
            completionNotes: prev.completionNotes,
            warehouseMaterials: prev.warehouseMaterials.length > 0 ? prev.warehouseMaterials : [createEmptyIncidentHandlingWarehouseLine()],
            directMaterials: sourceMode === 'DIRECT_PURCHASE'
                ? (prev.directMaterials.length > 0 ? prev.directMaterials : (nextLine?.category === 'REPAIR' ? [] : [createEmptyIncidentHandlingDirectLine()]))
                : prev.directMaterials,
        }));
    };

    const selectHandlingSettlementLine = (settlementLineRef: string) => {
        const line = directPurchaseLineOptions.find(item => item._id === settlementLineRef) || null;
        setHandlingLine(line);
        setHandlingForm(prev => ({
            ...prev,
            settlementLineRef,
            completedDate: line?.date || prev.completedDate,
            vendor: line?.payeeName || prev.vendor,
            maintenanceType: line?.category === 'REPAIR' ? 'Penanganan Perbaikan Insiden' : 'Penanganan Sparepart Insiden',
            completionNotes: line?.description || prev.completionNotes,
            directMaterials: line?.category === 'REPAIR' ? prev.directMaterials : (prev.directMaterials.length > 0 ? prev.directMaterials : [createEmptyIncidentHandlingDirectLine()]),
        }));
    };

    const updateWarehouseHandlingLine = (rowId: string, updates: Partial<IncidentHandlingWarehouseLine>) => {
        setHandlingForm(prev => ({
            ...prev,
            warehouseMaterials: prev.warehouseMaterials.map(row => {
                if (row.rowId !== rowId) return row;
                const next = { ...row, ...updates };
                if (updates.warehouseItemRef) {
                    const item = standardWarehouseItems.find(option => option._id === updates.warehouseItemRef);
                    if (item && !next.componentLabel) next.componentLabel = item.name;
                }
                return next;
            }),
        }));
    };

    const updateDirectHandlingLine = (rowId: string, updates: Partial<IncidentHandlingDirectLine>) => {
        setHandlingForm(prev => ({
            ...prev,
            directMaterials: prev.directMaterials.map(row => {
                if (row.rowId !== rowId) return row;
                const next = { ...row, ...updates };
                const linkedItem = updates.linkedWarehouseItemRef
                    ? standardWarehouseItems.find(option => option._id === updates.linkedWarehouseItemRef)
                    : null;
                const leftoverItem = updates.leftoverWarehouseItemRef
                    ? standardWarehouseItems.find(option => option._id === updates.leftoverWarehouseItemRef)
                    : null;
                const item = linkedItem || leftoverItem;
                if (item) {
                    next.itemName = next.itemName || item.name;
                    next.unit = item.unit || next.unit;
                    next.unitCost = next.unitCost || item.defaultPurchasePrice || 0;
                    if (!next.componentLabel) next.componentLabel = item.name;
                }
                return next;
            }),
        }));
    };

    const addWarehouseHandlingLine = () => {
        setHandlingForm(prev => ({
            ...prev,
            warehouseMaterials: [...prev.warehouseMaterials, createEmptyIncidentHandlingWarehouseLine()],
        }));
    };

    const removeWarehouseHandlingLine = (rowId: string) => {
        setHandlingForm(prev => ({
            ...prev,
            warehouseMaterials: prev.warehouseMaterials.length > 1
                ? prev.warehouseMaterials.filter(row => row.rowId !== rowId)
                : [createEmptyIncidentHandlingWarehouseLine()],
        }));
    };

    const addDirectHandlingLine = () => {
        setHandlingForm(prev => ({
            ...prev,
            directMaterials: [...prev.directMaterials, createEmptyIncidentHandlingDirectLine()],
        }));
    };

    const removeDirectHandlingLine = (rowId: string) => {
        setHandlingForm(prev => ({
            ...prev,
            directMaterials: prev.directMaterials.filter(row => row.rowId !== rowId),
        }));
    };

    const saveIncidentHandling = async () => {
        if (!incident?._id || !incident._rev) return addToast('error', 'Data insiden perlu direfresh sebelum mencatat penanganan');
        if (!incident.vehicleRef) return addToast('error', 'Kendaraan insiden tidak tersedia untuk maintenance');
        if (!handlingForm.completedDate) return addToast('error', 'Tanggal penanganan wajib diisi');

        const warehouseMaterials = handlingForm.warehouseMaterials
            .filter(row => row.warehouseItemRef || row.quantity > 0)
            .map(row => ({
                warehouseItemRef: row.warehouseItemRef,
                quantity: row.quantity,
                attachToVehicle: row.attachToVehicle,
                componentLabel: row.componentLabel.trim() || undefined,
                note: row.note.trim() || undefined,
            }));
        const directMaterials = handlingForm.directMaterials
            .filter(row => row.linkedWarehouseItemRef || row.leftoverWarehouseItemRef || row.itemName.trim() || row.quantity > 0 || row.leftoverQty > 0 || row.unitCost > 0)
            .map(row => ({
                linkedWarehouseItemRef: row.linkedWarehouseItemRef || undefined,
                itemName: row.itemName.trim() || undefined,
                unit: row.unit,
                quantity: row.quantity,
                unitCost: row.unitCost,
                attachToVehicle: row.attachToVehicle,
                componentLabel: row.componentLabel.trim() || undefined,
                note: row.note.trim() || undefined,
                leftoverWarehouseItemRef: row.leftoverWarehouseItemRef || undefined,
                leftoverQty: row.leftoverQty,
            }));

        if (handlingForm.sourceMode === 'WAREHOUSE_STOCK' && warehouseMaterials.length === 0) {
            return addToast('error', 'Minimal satu barang gudang wajib dipilih');
        }
        if (handlingForm.sourceMode === 'DIRECT_PURCHASE') {
            if (!selectedHandlingLine?._id || !selectedHandlingLine._rev) {
                return addToast('error', 'Detail biaya posted wajib dipilih dan direfresh');
            }
            if (selectedHandlingLine.category === 'SPAREPART' && directMaterials.length === 0) {
                return addToast('error', 'Sparepart beli lokal wajib mencatat barang dipakai atau sisa masuk gudang');
            }
            if (directOverAllocatedAmount > 0) {
                return addToast('error', 'Total alokasi material tidak boleh melebihi biaya insiden yang sudah diposting');
            }
        }

        setSavingHandling(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'incidents',
                    action: 'record-maintenance-handling',
                    data: {
                        incidentRef: incident._id,
                        revision: incident._rev,
                        sourceMode: handlingForm.sourceMode,
                        settlementLineRef: handlingForm.sourceMode === 'DIRECT_PURCHASE' ? selectedHandlingLine?._id : undefined,
                        settlementLineRevision: handlingForm.sourceMode === 'DIRECT_PURCHASE' ? selectedHandlingLine?._rev : undefined,
                        completedDate: handlingForm.completedDate,
                        odometerAtService: handlingForm.odometerAtService || undefined,
                        vendor: handlingForm.vendor.trim() || undefined,
                        maintenanceType: handlingForm.maintenanceType.trim() || undefined,
                        completionNotes: handlingForm.completionNotes.trim() || undefined,
                        warehouseMaterials: handlingForm.sourceMode === 'WAREHOUSE_STOCK' ? warehouseMaterials : undefined,
                        directMaterials: handlingForm.sourceMode === 'DIRECT_PURCHASE' ? directMaterials : undefined,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal mencatat penanganan insiden');
            addToast('success', 'Penanganan maintenance insiden dicatat');
            closeHandlingModal(true);
            await loadDetail();
        } catch {
            addToast('error', 'Gagal mencatat penanganan insiden');
        } finally {
            setSavingHandling(false);
        }
    };

    const chooseIncidentExpenseRoute = (route: IncidentExpenseRoute) => {
        setExpenseForm(prev => ({
            ...prev,
            incidentExpenseRoute: route,
            categoryRef: postingLine ? findSuggestedIncidentExpenseCategory(expenseCategories, postingLine, route) : '',
            bankAccountRef: route === 'DRIVER_VOUCHER' ? '' : prev.bankAccountRef,
        }));
    };

    const postExpense = async () => {
        if (!incident?._id || !postingLine?._id || !postingLine._rev) return addToast('error', 'Detail insiden tidak valid untuk diposting');
        if (!expenseForm.incidentExpenseRoute) return addToast('error', 'Pilih sumber biaya insiden');
        if (!expenseForm.categoryRef) return addToast('error', 'Kategori pengeluaran wajib dipilih');
        if (expenseForm.incidentExpenseRoute === 'COMPANY_EXPENSE' && !expenseForm.bankAccountRef) return addToast('error', 'Rekening / kas pembayaran wajib dipilih untuk pengeluaran perusahaan');
        setPostingExpense(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expenses', data: { categoryRef: expenseForm.categoryRef, date: expenseForm.date, amount: postingLine.amount, note: expenseForm.note || undefined, description: expenseForm.description || undefined, bankAccountRef: expenseForm.incidentExpenseRoute === 'COMPANY_EXPENSE' ? expenseForm.bankAccountRef || undefined : undefined, incidentExpenseRoute: expenseForm.incidentExpenseRoute, relatedIncidentRef: incident._id, relatedIncidentSettlementLineRef: postingLine._id, relatedIncidentSettlementLineRevision: postingLine._rev } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal memposting pengeluaran insiden');
            addToast('success', 'Pengeluaran insiden berhasil diposting');
            setShowExpenseModal(false);
            setPostingLine(null);
            setExpenseForm(createDefaultIncidentExpensePostForm());
            await loadDetail();
        } catch {
            addToast('error', 'Gagal memposting pengeluaran insiden');
        } finally {
            setPostingExpense(false);
        }
    };

    const saveTireFollowUp = async () => {
        if (!tireFollowUpLine?._id || !tireFollowUpLine._rev) {
            return addToast('error', 'Detail biaya insiden perlu direfresh sebelum mencatat aset ban');
        }
        if (!tireFollowUpForm.linkedWarehouseItemRef || !tireFollowUpForm.tireCode.trim() || !tireFollowUpForm.tireBrand.trim() || !tireFollowUpForm.tireSize.trim()) {
            return addToast('error', 'Master barang, kode, merk, dan ukuran ban wajib diisi');
        }
        if (tireFollowUpForm.originalCost <= 0) {
            return addToast('error', 'Nilai awal aset ban harus lebih besar dari 0');
        }
        setSavingTireFollowUp(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'incident-settlement-lines',
                    action: 'create-tire-follow-up',
                    data: {
                        id: tireFollowUpLine._id,
                        revision: tireFollowUpLine._rev,
                        ...tireFollowUpForm,
                        tireCode: tireFollowUpForm.tireCode.trim(),
                        tireBrand: tireFollowUpForm.tireBrand.trim(),
                        tireSize: tireFollowUpForm.tireSize.trim(),
                        notes: tireFollowUpForm.notes.trim() || undefined,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal mencatat aset ban dari insiden');
            addToast('success', 'Aset ban insiden dicatat ke gudang ban');
            closeTireFollowUpModal(true);
            await loadDetail();
        } catch {
            addToast('error', 'Gagal mencatat aset ban dari insiden');
        } finally {
            setSavingTireFollowUp(false);
        }
    };

    const createMaintenanceFollowUp = async (line: IncidentSettlementLine) => {
        if (!line._rev) return addToast('error', 'Detail biaya insiden perlu direfresh sebelum membuat follow-up maintenance');
        if (!window.confirm('Buat jadwal maintenance dari detail biaya insiden ini? Biaya yang sudah diposting dari insiden tidak akan diposting ulang.')) return;
        setCreatingMaintenanceLineRef(line._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'incident-settlement-lines',
                    action: 'create-maintenance-follow-up',
                    data: {
                        id: line._id,
                        revision: line._rev,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal membuat follow-up maintenance');
            addToast('success', 'Follow-up maintenance insiden dibuat');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal membuat follow-up maintenance');
        } finally {
            setCreatingMaintenanceLineRef('');
        }
    };

    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan cetak insiden...');
        if (!printWindow) return addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
        try {
            const company = resolveDocumentIssuerProfile(incident, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({ title: 'Laporan Insiden Armada', subtitle: incident?.incidentNumber, company, targetWindow: printWindow, bodyHtml: buildIncidentPrintHtml(incident as Incident, logs, lines) });
        } catch {
            try { printWindow.close(); } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const renderActions = (line: IncidentSettlementLine) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {canManageIncident && !incidentClosed && canEditIncidentSettlementLine(line) && <button className="table-action-btn" onClick={() => openLineModal(line)}><Pencil size={14} /> Edit</button>}
            {canManageIncident && !incidentClosed && line.status === 'DRAFT' && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'APPROVED')}><CheckCircle2 size={14} /> Setujui</button>}
            {canManageIncident && !incidentClosed && line.status === 'APPROVED' && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'DRAFT')}><XCircle size={14} /> Draft</button>}
            {canCreateExpense && canPostIncidentSettlementLine(line) && <button className="table-action-btn" onClick={() => openExpenseModal(line)}><ReceiptText size={14} /> Post Expense</button>}
            {canCreateTires && line.lineType === 'COST' && line.category === 'TIRE' && line.status === 'POSTED' && line.linkedExpenseRef && !line.linkedTireEventRef && <button className="table-action-btn" onClick={() => openTireFollowUpModal(line)}><Plus size={14} /> Catat Aset Ban</button>}
            {canInstallIncidentTire(line) && <button className="table-action-btn" onClick={() => openTireInstallModal(line)}><Wrench size={14} /> Pasang Ban</button>}
            {canCreateMaintenance && !incidentClosed && line.lineType === 'COST' && (line.category === 'REPAIR' || line.category === 'SPAREPART') && line.status === 'POSTED' && line.linkedExpenseRef && !line.linkedMaintenanceRef && <button className="table-action-btn" onClick={() => openHandlingModal(line, 'DIRECT_PURCHASE')}><Wrench size={14} /> Catat Penanganan</button>}
            {canCreateMaintenance && line.lineType === 'COST' && line.category === 'TIRE' && line.status === 'POSTED' && line.linkedExpenseRef && !line.linkedMaintenanceRef && <button className="table-action-btn" onClick={() => void createMaintenanceFollowUp(line)} disabled={creatingMaintenanceLineRef === line._id}><Wrench size={14} /> {creatingMaintenanceLineRef === line._id ? 'Membuat...' : 'Follow-up Maintenance'}</button>}
            {canManageIncident && canMarkIncidentRecoveryPosted(line) && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'POSTED')}><CheckCircle2 size={14} /> Tandai Diterima</button>}
            {canManageIncident && line.status !== 'VOID' && line.status !== 'POSTED' && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'VOID')}><XCircle size={14} /> Tolak</button>}
            {canManageIncident && !incidentClosed && canDeleteIncidentSettlementLine(line) && <button className="table-action-btn danger" onClick={() => void deleteLine(line)}><Trash2 size={14} /> Hapus</button>}
        </div>
    );

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 260 }} /></div>;
    if (!incident) return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Insiden tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/incidents" />
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {incident.incidentNumber}
                        <span className={`badge badge-${INCIDENT_STATUS_MAP[incident.status]?.color}`}>{INCIDENT_STATUS_MAP[incident.status]?.label}</span>
                        <span className={`badge badge-${URGENCY_MAP[incident.urgency]?.color}`}>{URGENCY_MAP[incident.urgency]?.label}</span>
                    </h1>
                </div>
                <div className="page-actions">
                    {canManageIncident && availableStatuses.length > 0 && <button className="btn btn-primary" onClick={openStatusModal}><Save size={16} /> Ubah Status</button>}
                    {canManageIncident && !incidentClosed && <button className="btn btn-secondary" onClick={() => openLineModal()}><Plus size={16} /> Tambah Detail Biaya</button>}
                    {canCreateMaintenance && !incidentClosed && <button className="btn btn-secondary" onClick={() => openHandlingModal(undefined, 'WAREHOUSE_STOCK')}><Wrench size={16} /> Catat Pemakaian</button>}
                    <button className="btn btn-secondary" onClick={handlePrint}><Printer size={16} /> Print</button>
                </div>
            </div>

            {hasPendingDriverResolution && (
                <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--color-warning)', background: 'rgba(245, 158, 11, 0.08)' }}>
                    <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <AlertTriangle size={20} style={{ color: 'var(--color-warning)', flex: '0 0 auto' }} />
                        <div style={{ flex: '1 1 240px' }}>
                            <div className="font-semibold">Menunggu review admin dari pengajuan driver</div>
                            <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                                {incident.pendingDriverResolutionRequestedByName || incident.driverName || 'Driver'} mengajukan penyelesaian insiden
                                {incident.pendingDriverResolutionNote ? `: ${incident.pendingDriverResolutionNote}` : ''}
                            </div>
                        </div>
                        {canManageIncident && incident.status === 'IN_PROGRESS' && (
                            <button className="btn btn-primary" onClick={() => void approveDriverResolution()} disabled={savingStatus}>
                                <CheckCircle2 size={16} /> {savingStatus ? 'Menyetujui...' : 'Setujui Selesai'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            <div className="detail-grid">
                <div className="card"><div className="card-header"><span className="card-header-title">Detail Insiden</span></div><div className="card-body">
                    <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{INCIDENT_TYPE_MAP[incident.incidentType] || incident.incidentType}</div></div><div className="detail-item"><div className="detail-label">Waktu</div><div className="detail-value">{formatDateTime(incident.dateTime)}</div></div></div>
                    <div className="detail-row"><div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value font-semibold">{incident.vehiclePlate}</div></div><div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{incident.driverName || '-'}</div></div></div>
                    <div className="detail-row"><div className="detail-item"><div className="detail-label">Lokasi</div><div className="detail-value">{incident.locationText}</div></div><div className="detail-item"><div className="detail-label">Odometer</div><div className="detail-value">{incident.odometer ? `${formatQuantity(incident.odometer, 0)} km` : '-'}</div></div></div>
                    {incident.relatedDONumber && <div className="mt-2"><div className="detail-label">DO Internal Terkait</div><div className="detail-value"><a href={`/delivery-orders/${incident.relatedDeliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{incident.relatedDONumber}</a></div></div>}
                </div></div>
                <div className="card"><div className="card-header"><span className="card-header-title">Kronologi</span></div><div className="card-body"><p style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.8 }}>{incident.description}</p></div></div>
            </div>

            <div className="kpi-grid" style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Biaya</div><div className="kpi-value" style={{ color: 'var(--color-danger)', fontSize: '1.05rem' }}>{formatCurrency(summary.totalCost)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Santunan</div><div className="kpi-value" style={{ color: 'var(--color-warning)', fontSize: '1.05rem' }}>{formatCurrency(summary.totalCompensation)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Recovery Diterima</div><div className="kpi-value" style={{ color: 'var(--color-success)', fontSize: '1.05rem' }}>{formatCurrency(summary.postedRecovery)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Net Exposure</div><div className="kpi-value" style={{ fontSize: '1.05rem' }}>{formatCurrency(netExposure)}</div></div></div>
            </div>

            <div className="card" style={{ marginBottom: '1.5rem' }}><div className="card-header"><span className="card-header-title">Ringkasan Finansial</span></div><div className="card-body">
                <div className="detail-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <div className="detail-item"><div className="detail-label">Gross Exposure</div><div className="detail-value font-semibold">{formatCurrency(grossExposure)}</div></div>
                    <div className="detail-item"><div className="detail-label">Biaya Sudah Diposting</div><div className="detail-value">{formatCurrency(summary.postedCost)}</div></div>
                    <div className="detail-item"><div className="detail-label">Biaya Belum Diposting</div><div className="detail-value">{formatCurrency(summary.openCost)}</div></div>
                    <div className="detail-item"><div className="detail-label">Recovery Belum Diterima</div><div className="detail-value">{formatCurrency(summary.pendingRecovery)}</div></div>
                </div>
                <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>Recovery baru mengurangi exposure ketika statusnya sudah ditandai diterima.</div>
                {incident.status === 'RESOLVED' && hasPendingSettlement && (
                    <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--color-warning)' }}>
                        Insiden belum bisa ditutup karena masih ada detail biaya, santunan, atau recovery yang belum diposting atau ditolak.
                    </div>
                )}
            </div></div>

            <div className="card mt-6"><div className="card-header"><span className="card-header-title">Detail Biaya, Santunan, dan Recovery</span></div><div className="card-body">
                <div className="table-wrapper table-desktop-only"><table><thead><tr><th>Tanggal</th><th>Tipe</th><th>Kategori</th><th>Deskripsi</th><th>Pihak</th><th>Status</th><th>Nominal</th><th>Aksi</th></tr></thead><tbody>
                    {lines.length === 0 ? <tr><td colSpan={8}><div className="empty-state"><div className="empty-state-title">Belum ada detail biaya insiden</div><div className="empty-state-text">Tambahkan biaya, santunan, atau recovery supaya settlement insiden bisa ditracking dari halaman ini.</div></div></td></tr> : lines.map(line => (
                        <tr key={line._id}>
                            <td className="text-muted">{formatDate(line.date)}</td>
                            <td><span className={`badge badge-${INCIDENT_SETTLEMENT_LINE_TYPE_MAP[line.lineType]?.color}`}>{INCIDENT_SETTLEMENT_LINE_TYPE_MAP[line.lineType]?.label}</span></td>
                            <td>{INCIDENT_SETTLEMENT_CATEGORY_MAP[line.category] || line.category}</td>
                            <td><div className="font-semibold">{line.description}</div>{line.note && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>{line.note}</div>}{line.linkedExpenseRef && <div style={{ fontSize: '0.72rem', color: 'var(--color-success)', marginTop: '0.25rem' }}>Expense {line.linkedExpenseRef}</div>}{(line.linkedDriverVoucherItemRef || line.linkedExpenseRoute) && <div style={{ fontSize: '0.72rem', color: 'var(--color-success)', marginTop: '0.15rem' }}>{line.linkedDriverVoucherItemRef ? 'Masuk biaya lain-lain uang jalan' : getIncidentExpenseRouteLabel(line.linkedExpenseRoute)}</div>}{line.linkedTireEventRef && <div style={{ fontSize: '0.72rem', color: 'var(--color-primary)', marginTop: '0.15rem' }}><a href={`/fleet/tires/${line.linkedTireEventRef}`}>Aset ban {line.linkedTireCode || line.linkedTireEventRef}</a></div>}{line.linkedMaintenanceRef && <div style={{ fontSize: '0.72rem', color: 'var(--color-primary)', marginTop: '0.15rem' }}><a href="/fleet/maintenance">Maintenance {line.linkedMaintenanceType || line.linkedMaintenanceRef}</a></div>}</td>
                            <td><div>{line.payeeName || '-'}</div>{line.recipientType && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP[line.recipientType] || line.recipientType}</div>}</td>
                            <td><span className={`badge badge-${INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.color}`}>{INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.label}</span></td>
                            <td className="font-semibold">{formatCurrency(line.amount)}</td>
                            <td>{renderActions(line)}</td>
                        </tr>
                    ))}
                </tbody></table></div>
                <div className="mobile-record-list">
                    {lines.length === 0 ? <div className="mobile-record-card"><div className="mobile-record-title">Belum ada detail biaya insiden</div><div className="mobile-record-subtitle">Tambahkan dari halaman ini.</div></div> : lines.map(line => (
                        <div key={line._id} className="mobile-record-card">
                            <div className="mobile-record-header"><div><div className="mobile-record-title">{line.description}</div><div className="mobile-record-subtitle">{formatDate(line.date)} | {INCIDENT_SETTLEMENT_CATEGORY_MAP[line.category] || line.category}</div></div><div className="text-right"><div className="font-semibold">{formatCurrency(line.amount)}</div><div style={{ marginTop: 4 }}><span className={`badge badge-${INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.color}`}>{INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.label}</span></div></div></div>
                            <div className="mobile-record-meta"><div className="mobile-record-kv"><span className="mobile-record-label">Tipe</span><span className="mobile-record-value">{INCIDENT_SETTLEMENT_LINE_TYPE_MAP[line.lineType]?.label}</span></div><div className="mobile-record-kv"><span className="mobile-record-label">Pihak</span><span className="mobile-record-value">{line.payeeName || '-'}</span></div>{line.recipientType && <div className="mobile-record-kv"><span className="mobile-record-label">Kategori Pihak</span><span className="mobile-record-value">{INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP[line.recipientType] || line.recipientType}</span></div>}{line.note && <div className="mobile-record-kv"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{line.note}</span></div>}{line.linkedTireEventRef && <div className="mobile-record-kv"><span className="mobile-record-label">Aset Ban</span><span className="mobile-record-value">{line.linkedTireCode || line.linkedTireEventRef}</span></div>}{line.linkedMaintenanceRef && <div className="mobile-record-kv"><span className="mobile-record-label">Maintenance</span><span className="mobile-record-value">{line.linkedMaintenanceType || line.linkedMaintenanceRef}</span></div>}</div>
                            {(canManageIncident || canCreateExpense || canCreateTires || canCreateMaintenance) && <div className="mobile-record-actions">{renderActions(line)}</div>}
                        </div>
                    ))}
                </div>
            </div></div>

            <div className="card mt-6"><div className="card-header"><span className="card-header-title">Timeline Penanganan</span></div><div className="card-body"><div className="timeline">{logs.map((item, idx) => <div key={item._id} className="timeline-item"><div className={`timeline-dot ${idx === logs.length - 1 ? 'active' : ''}`} /><div className="timeline-content"><div className="timeline-title">{item.note}</div><div className="timeline-meta">{formatDateTime(item.timestamp)} {item.userName ? `oleh ${item.userName}` : ''}</div></div></div>)}</div></div></div>

            {showStatusModal && <div className="modal-overlay" onClick={() => { if (!savingStatus) setShowStatusModal(false); }}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Ubah Status Insiden</h3></div><div className="modal-body"><div className="form-group"><label className="form-label">Status Baru</label><select className="form-select" value={newStatus} onChange={event => setNewStatus(event.target.value)}>{availableStatuses.map(status => <option key={status} value={status}>{INCIDENT_STATUS_MAP[status]?.label}</option>)}</select></div><div className="form-group"><label className="form-label">Catatan <span className="required">*</span></label><textarea className="form-textarea" rows={3} value={actionNote} onChange={event => setActionNote(event.target.value)} placeholder="Jelaskan tindakan yang dilakukan..." /></div></div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowStatusModal(false)} disabled={savingStatus}>Batal</button><button className="btn btn-primary" onClick={handleIncidentStatusSave} disabled={savingStatus || !newStatus || !actionNote.trim()}><Save size={16} /> {savingStatus ? 'Menyimpan...' : 'Simpan'}</button></div></div></div>}

            {showLineModal && <div className="modal-overlay" onClick={() => { if (!savingLine) resetLineModal(); }}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">{editingLine ? 'Edit Detail Insiden' : 'Tambah Detail Insiden'}</h3></div><div className="modal-body">
                <div className="form-row"><div className="form-group"><label className="form-label">Tipe Detail</label><select className="form-select" value={lineForm.lineType} onChange={event => setLineType(event.target.value as IncidentSettlementLineType)}>{TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={lineForm.date} onChange={event => setLineForm(prev => ({ ...prev, date: event.target.value }))} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Kategori</label><select className="form-select" value={lineForm.category} onChange={event => setLineForm(prev => ({ ...prev, category: event.target.value as IncidentSettlementCategory }))}>{lineCategories.map(category => <option key={category} value={category}>{INCIDENT_SETTLEMENT_CATEGORY_MAP[category]}</option>)}</select></div><div className="form-group"><label className="form-label">Nominal</label><FormattedNumberInput allowDecimal={false} value={lineForm.amount} onValueChange={value => setLineForm(prev => ({ ...prev, amount: value }))} placeholder="Masukkan nominal" /></div></div>
                <div className="form-group"><label className="form-label">Deskripsi <span className="required">*</span></label><input className="form-input" value={lineForm.description} onChange={event => setLineForm(prev => ({ ...prev, description: event.target.value }))} placeholder="Contoh: Derek ke bengkel, santunan driver, recovery asuransi" /></div>
                <div className="form-row"><div className="form-group"><label className="form-label">{lineForm.lineType === 'COMPENSATION' ? 'Penerima Santunan' : lineForm.lineType === 'RECOVERY' ? 'Sumber Recovery' : 'Vendor / Pihak Terkait'}{lineForm.lineType !== 'COST' && <span className="required"> *</span>}</label><input className="form-input" value={lineForm.payeeName} onChange={event => setLineForm(prev => ({ ...prev, payeeName: event.target.value }))} placeholder={lineForm.lineType === 'RECOVERY' ? 'Contoh: PT Asuransi ABC' : 'Nama pihak terkait'} /></div>{lineForm.lineType === 'COMPENSATION' && <div className="form-group"><label className="form-label">Jenis Penerima <span className="required">*</span></label><select className="form-select" value={lineForm.recipientType} onChange={event => setLineForm(prev => ({ ...prev, recipientType: event.target.value }))}><option value="">Pilih</option>{RECIPIENT_OPTIONS.map(option => <option key={option} value={option}>{INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP[option]}</option>)}</select></div>}</div>
                <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={lineForm.note} onChange={event => setLineForm(prev => ({ ...prev, note: event.target.value }))} placeholder="Keterangan tambahan, nomor kuitansi, atau konteks approval" /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={resetLineModal} disabled={savingLine}>Batal</button><button className="btn btn-primary" onClick={handleLineSave} disabled={savingLine}><Save size={16} /> {savingLine ? 'Menyimpan...' : 'Simpan'}</button></div></div></div>}

            {showExpenseModal && postingLine && <div className="modal-overlay" onClick={() => { if (!postingExpense) { setShowExpenseModal(false); setPostingLine(null); } }}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Posting Biaya Insiden</h3></div><div className="modal-body">
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', marginBottom: '1rem' }}><div style={{ fontWeight: 700 }}>{postingLine.description}</div><div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>{INCIDENT_SETTLEMENT_CATEGORY_MAP[postingLine.category]} | {formatCurrency(postingLine.amount)}</div></div>
                <div className="form-group"><label className="form-label">Sumber Penyelesaian Biaya <span className="required">*</span></label><div style={{ display: 'grid', gap: '0.5rem' }}>{INCIDENT_EXPENSE_ROUTE_OPTIONS.map(option => <button key={option.value} type="button" className={expenseForm.incidentExpenseRoute === option.value ? 'btn btn-primary' : 'btn btn-secondary'} style={{ justifyContent: 'flex-start', textAlign: 'left', alignItems: 'flex-start', flexDirection: 'column', gap: 4 }} onClick={() => chooseIncidentExpenseRoute(option.value)} disabled={postingExpense || (option.value === 'DRIVER_VOUCHER' && !incident.relatedDeliveryOrderRef)}><span>{option.label}</span><span style={{ fontSize: '0.75rem', fontWeight: 400, opacity: 0.8 }}>{option.hint}</span></button>)}</div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Tanggal Posting</label><input type="date" className="form-input" value={expenseForm.date} onChange={event => setExpenseForm(prev => ({ ...prev, date: event.target.value }))} /></div><div className="form-group"><label className="form-label">Kategori Pengeluaran <span className="required">*</span></label><select className="form-select" value={expenseForm.categoryRef} onChange={event => setExpenseForm(prev => ({ ...prev, categoryRef: event.target.value }))} disabled={!expenseForm.incidentExpenseRoute}><option value="">Pilih kategori</option>{expenseCategoryOptions.map(category => <option key={category._id} value={category._id}>{category.name} ({getExpenseCategoryScopeLabel(inferExpenseCategoryScope(category))})</option>)}</select></div></div>
                {expenseForm.incidentExpenseRoute === 'COMPANY_EXPENSE' ? <div className="form-group"><label className="form-label">Bayar dari Rekening / Kas <span className="required">*</span></label><select className="form-select" value={expenseForm.bankAccountRef} onChange={event => setExpenseForm(prev => ({ ...prev, bankAccountRef: event.target.value }))}><option value="">Pilih rekening atau kas</option>{bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}</select></div> : expenseForm.incidentExpenseRoute === 'DRIVER_VOUCHER' ? <div style={{ padding: '0.75rem 0.85rem', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>Tidak memakai rekening / kas di posting ini. Biaya akan masuk biaya lain-lain uang jalan driver pada bon trip terkait.</div> : null}
                <div className="form-group"><label className="form-label">Catatan Pengeluaran</label><input className="form-input" value={expenseForm.note} onChange={event => setExpenseForm(prev => ({ ...prev, note: event.target.value }))} placeholder="Catatan singkat pengeluaran" /></div>
                <div className="form-group"><label className="form-label">Deskripsi Pengeluaran</label><textarea className="form-textarea" rows={3} value={expenseForm.description} onChange={event => setExpenseForm(prev => ({ ...prev, description: event.target.value }))} placeholder="Deskripsi yang akan tersimpan di modul pengeluaran" /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => { setShowExpenseModal(false); setPostingLine(null); }} disabled={postingExpense}>Batal</button><button className="btn btn-primary" onClick={postExpense} disabled={postingExpense || !expenseForm.incidentExpenseRoute || !expenseForm.categoryRef || (expenseForm.incidentExpenseRoute === 'COMPANY_EXPENSE' && !expenseForm.bankAccountRef)}><ReceiptText size={16} /> {postingExpense ? 'Memposting...' : 'Posting Pengeluaran'}</button></div></div></div>}

            {showHandlingModal && <div className="modal-overlay" onClick={() => closeHandlingModal()}><div className="modal modal-lg" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Catat Penanganan Maintenance Insiden</h3></div><div className="modal-body">
                <div className="form-group"><label className="form-label">Sumber Material</label><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" className={handlingForm.sourceMode === 'WAREHOUSE_STOCK' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => switchHandlingSourceMode('WAREHOUSE_STOCK')} disabled={savingHandling}><Wrench size={16} /> Ambil dari Gudang</button><button type="button" className={handlingForm.sourceMode === 'DIRECT_PURCHASE' ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => switchHandlingSourceMode('DIRECT_PURCHASE')} disabled={savingHandling || directPurchaseLineOptions.length === 0}><ReceiptText size={16} /> Beli di Lokasi</button></div></div>
                {handlingForm.sourceMode === 'DIRECT_PURCHASE' && <div className="form-group"><label className="form-label">Detail Biaya Posted <span className="required">*</span></label><select className="form-select" value={handlingForm.settlementLineRef} onChange={event => selectHandlingSettlementLine(event.target.value)} disabled={savingHandling}><option value="">Pilih detail biaya</option>{directPurchaseLineOptions.map(line => <option key={line._id} value={line._id}>{INCIDENT_SETTLEMENT_CATEGORY_MAP[line.category]} - {line.description} ({formatCurrency(line.linkedExpenseAmount ?? line.amount)})</option>)}</select>{selectedHandlingLine && <div className={directOverAllocatedAmount > 0 ? 'text-danger' : 'text-muted'} style={{ fontSize: '0.75rem', marginTop: 4 }}>Alokasi material {formatCurrency(directAllocatedTotal)} dari {formatCurrency(directExpenseAmount)}{directOverAllocatedAmount > 0 ? ` - melebihi ${formatCurrency(directOverAllocatedAmount)}` : directUnallocatedAmount > 0 ? ` - sisa biaya/jasa ${formatCurrency(directUnallocatedAmount)}` : ' - pas'}</div>}</div>}
                <div className="form-row"><div className="form-group"><label className="form-label">Tanggal Penanganan</label><input type="date" className="form-input" value={handlingForm.completedDate} onChange={event => setHandlingForm(prev => ({ ...prev, completedDate: event.target.value }))} disabled={savingHandling} /></div><div className="form-group"><label className="form-label">Odometer</label><FormattedNumberInput allowDecimal={false} value={handlingForm.odometerAtService} onValueChange={value => setHandlingForm(prev => ({ ...prev, odometerAtService: value || 0 }))} disabled={savingHandling} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Vendor / Bengkel</label><input className="form-input" value={handlingForm.vendor} onChange={event => setHandlingForm(prev => ({ ...prev, vendor: event.target.value }))} disabled={savingHandling} /></div><div className="form-group"><label className="form-label">Tipe Maintenance</label><input className="form-input" value={handlingForm.maintenanceType} onChange={event => setHandlingForm(prev => ({ ...prev, maintenanceType: event.target.value }))} disabled={savingHandling} /></div></div>

                {handlingForm.sourceMode === 'WAREHOUSE_STOCK' && <div className="form-group"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}><label className="form-label" style={{ marginBottom: 0 }}>Barang Gudang <span className="required">*</span></label><button type="button" className="btn btn-secondary" onClick={addWarehouseHandlingLine} disabled={savingHandling}><Plus size={16} /> Tambah Barang</button></div><div style={{ display: 'grid', gap: 10 }}>{handlingForm.warehouseMaterials.map((row, index) => { const selectedItem = standardWarehouseItems.find(item => item._id === row.warehouseItemRef); return <div key={row.rowId} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}><div className="form-row"><div className="form-group"><label className="form-label">Barang #{index + 1}</label><select className="form-select" value={row.warehouseItemRef} onChange={event => updateWarehouseHandlingLine(row.rowId, { warehouseItemRef: event.target.value })} disabled={savingHandling}><option value="">Pilih barang</option>{stockedStandardWarehouseItems.map(item => <option key={item._id} value={item._id}>{item.itemCode} - {item.name} | Stok {formatQuantity(item.currentStockQty || 0, 3)} {item.unit}</option>)}</select>{selectedItem && <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>Stok tersedia {formatQuantity(selectedItem.currentStockQty || 0, 3)} {selectedItem.unit}</div>}</div><div className="form-group"><label className="form-label">Qty Dipakai</label><FormattedNumberInput allowDecimal maxFractionDigits={3} value={row.quantity} onValueChange={value => updateWarehouseHandlingLine(row.rowId, { quantity: value || 0 })} disabled={savingHandling} /></div></div><div className="form-row"><div className="form-group"><label className="form-label">Komponen Unit</label><input className="form-input" value={row.componentLabel} onChange={event => updateWarehouseHandlingLine(row.rowId, { componentLabel: event.target.value })} disabled={savingHandling || !row.attachToVehicle} /></div><div className="form-group"><label className="form-label">Catatan</label><input className="form-input" value={row.note} onChange={event => updateWarehouseHandlingLine(row.rowId, { note: event.target.value })} disabled={savingHandling} /></div></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}><input type="checkbox" checked={row.attachToVehicle} onChange={event => updateWarehouseHandlingLine(row.rowId, { attachToVehicle: event.target.checked })} disabled={savingHandling} /> Digunakan di unit</label><button type="button" className="table-action-btn danger" onClick={() => removeWarehouseHandlingLine(row.rowId)} disabled={savingHandling}><Trash2 size={14} /> Hapus</button></div></div>; })}</div></div>}

                {handlingForm.sourceMode === 'DIRECT_PURCHASE' && <div className="form-group"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}><label className="form-label" style={{ marginBottom: 0 }}>Material Beli Lokal</label><button type="button" className="btn btn-secondary" onClick={addDirectHandlingLine} disabled={savingHandling}><Plus size={16} /> Tambah Material</button></div>{handlingForm.directMaterials.length === 0 ? <div className="empty-state" style={{ padding: '1rem' }}><div className="empty-state-title">Tanpa material</div><div className="empty-state-text">Gunakan untuk perbaikan jasa saja.</div></div> : <div style={{ display: 'grid', gap: 10 }}>{handlingForm.directMaterials.map((row, index) => <div key={row.rowId} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12 }}><div className="form-row"><div className="form-group"><label className="form-label">Acuan Barang #{index + 1}</label><select className="form-select" value={row.linkedWarehouseItemRef} onChange={event => updateDirectHandlingLine(row.rowId, { linkedWarehouseItemRef: event.target.value })} disabled={savingHandling}><option value="">Tidak ada acuan</option>{standardWarehouseItems.map(item => <option key={item._id} value={item._id}>{item.itemCode} - {item.name}</option>)}</select></div><div className="form-group"><label className="form-label">Nama Barang</label><input className="form-input" value={row.itemName} onChange={event => updateDirectHandlingLine(row.rowId, { itemName: event.target.value })} disabled={savingHandling} /></div></div><div className="form-row"><div className="form-group"><label className="form-label">Satuan</label><select className="form-select" value={row.unit} onChange={event => updateDirectHandlingLine(row.rowId, { unit: event.target.value as InventoryUnit })} disabled={savingHandling}>{INVENTORY_UNIT_OPTIONS.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></div><div className="form-group"><label className="form-label">Harga Satuan</label><FormattedNumberInput allowDecimal={false} value={row.unitCost} onValueChange={value => updateDirectHandlingLine(row.rowId, { unitCost: value || 0 })} disabled={savingHandling} /></div></div><div className="form-row"><div className="form-group"><label className="form-label">Qty Dipakai</label><FormattedNumberInput allowDecimal maxFractionDigits={3} value={row.quantity} onValueChange={value => updateDirectHandlingLine(row.rowId, { quantity: value || 0 })} disabled={savingHandling} /></div><div className="form-group"><label className="form-label">Qty Sisa Masuk Gudang</label><FormattedNumberInput allowDecimal maxFractionDigits={3} value={row.leftoverQty} onValueChange={value => updateDirectHandlingLine(row.rowId, { leftoverQty: value || 0 })} disabled={savingHandling} /><div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>Isi jumlah barang sisa, bukan nominal rupiah.</div></div></div><div className="form-row"><div className="form-group"><label className="form-label">Barang Gudang Tujuan Sisa</label><select className="form-select" value={row.leftoverWarehouseItemRef} onChange={event => updateDirectHandlingLine(row.rowId, { leftoverWarehouseItemRef: event.target.value })} disabled={savingHandling || row.leftoverQty <= 0}><option value="">Pilih jika ada sisa</option>{standardWarehouseItems.map(item => <option key={item._id} value={item._id}>{item.itemCode} - {item.name}</option>)}</select></div><div className="form-group"><label className="form-label">Komponen Unit</label><input className="form-input" value={row.componentLabel} onChange={event => updateDirectHandlingLine(row.rowId, { componentLabel: event.target.value })} disabled={savingHandling || !row.attachToVehicle} /></div></div><div className="form-row"><div className="form-group"><label className="form-label">Catatan</label><input className="form-input" value={row.note} onChange={event => updateDirectHandlingLine(row.rowId, { note: event.target.value })} disabled={savingHandling} /></div><div className="form-group"><label className="form-label">Subtotal Material</label><input className="form-input" value={formatCurrency((Math.max(row.quantity, 0) + Math.max(row.leftoverQty, 0)) * Math.max(row.unitCost, 0))} readOnly /></div></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}><input type="checkbox" checked={row.attachToVehicle} onChange={event => updateDirectHandlingLine(row.rowId, { attachToVehicle: event.target.checked })} disabled={savingHandling} /> Digunakan di unit</label><button type="button" className="table-action-btn danger" onClick={() => removeDirectHandlingLine(row.rowId)} disabled={savingHandling}><Trash2 size={14} /> Hapus</button></div></div>)}</div>}</div>}

                <div className="form-group"><label className="form-label">Catatan Selesai</label><textarea className="form-textarea" rows={3} value={handlingForm.completionNotes} onChange={event => setHandlingForm(prev => ({ ...prev, completionNotes: event.target.value }))} disabled={savingHandling} /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => closeHandlingModal()} disabled={savingHandling}>Batal</button><button className="btn btn-primary" onClick={saveIncidentHandling} disabled={savingHandling || !handlingForm.completedDate || (handlingForm.sourceMode === 'DIRECT_PURCHASE' && (!selectedHandlingLine || directOverAllocatedAmount > 0))}><Save size={16} /> {savingHandling ? 'Menyimpan...' : 'Simpan Penanganan'}</button></div></div></div>}

            {showTireFollowUpModal && tireFollowUpLine && <div className="modal-overlay" onClick={() => closeTireFollowUpModal()}><div className="modal modal-lg" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Catat Aset Ban dari Insiden</h3></div><div className="modal-body">
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 700 }}>{tireFollowUpLine.description}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                        Biaya sudah diposting dari insiden. Form ini hanya mencatat aset ban tertracking ke Gudang Ban agar perpindahan, pemasangan, dan persentase pemakaiannya tetap ditangani modul Ban.
                    </div>
                </div>
                <div className="form-row"><div className="form-group"><label className="form-label">Master Barang Ban Tertracking <span className="required">*</span></label><select className="form-select" value={tireFollowUpForm.linkedWarehouseItemRef} onChange={event => updateTireFollowUpWarehouseItem(event.target.value)} disabled={savingTireFollowUp}><option value="">Pilih master barang</option>{trackedTireWarehouseItems.map(item => <option key={item._id} value={item._id}>{item.itemCode} - {item.name}</option>)}</select>{selectedTireWarehouseItem && <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>Stok aktif {selectedTireWarehouseItem.currentStockQty || 0} {selectedTireWarehouseItem.unit || ''}. Pencatatan aset ban baru akan menambah stok gudang ban tertracking.</div>}</div><div className="form-group"><label className="form-label">Kode Ban <span className="required">*</span></label><input className="form-input" value={tireFollowUpForm.tireCode} onChange={event => setTireFollowUpForm(prev => ({ ...prev, tireCode: event.target.value.toUpperCase() }))} placeholder="Contoh: BAN-INC-0001" disabled={savingTireFollowUp} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Jenis Ban</label><select className="form-select" value={tireFollowUpForm.tireType} onChange={event => setTireFollowUpForm(prev => ({ ...prev, tireType: event.target.value as IncidentTireFollowUpForm['tireType'] }))} disabled={savingTireFollowUp}>{TIRE_TYPE_OPTIONS.map(type => <option key={type} value={type}>{type}</option>)}</select></div><div className="form-group"><label className="form-label">Tanggal Pencatatan</label><input type="date" className="form-input" value={tireFollowUpForm.installDate} onChange={event => setTireFollowUpForm(prev => ({ ...prev, installDate: event.target.value }))} disabled={savingTireFollowUp} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Merk Ban <span className="required">*</span></label><input className="form-input" value={tireFollowUpForm.tireBrand} onChange={event => setTireFollowUpForm(prev => ({ ...prev, tireBrand: event.target.value }))} disabled={savingTireFollowUp} /></div><div className="form-group"><label className="form-label">Ukuran Ban <span className="required">*</span></label><input className="form-input" value={tireFollowUpForm.tireSize} onChange={event => setTireFollowUpForm(prev => ({ ...prev, tireSize: event.target.value }))} disabled={savingTireFollowUp} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Nilai Awal Aset Ban</label><FormattedNumberInput allowDecimal={false} value={tireFollowUpForm.originalCost} onValueChange={value => setTireFollowUpForm(prev => ({ ...prev, originalCost: value }))} disabled={savingTireFollowUp} /></div><div className="form-group"><label className="form-label">Lokasi Awal</label><input className="form-input" value="Gudang Ban" readOnly /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Sumber Aset Ban</label><input className="form-input" value="Ban mandiri / beli saat DO" readOnly /></div><div className="form-group"><label className="form-label">Status Awal</label><input className="form-input" value="Masuk Gudang Ban tertracking" readOnly /></div></div>
                <div className="form-group"><label className="form-label">Catatan Aset</label><textarea className="form-textarea" rows={3} value={tireFollowUpForm.notes} onChange={event => setTireFollowUpForm(prev => ({ ...prev, notes: event.target.value }))} placeholder="Opsional: nomor nota toko, kondisi ban, konteks pemasangan di perjalanan" disabled={savingTireFollowUp} /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => closeTireFollowUpModal()} disabled={savingTireFollowUp}>Batal</button><button className="btn btn-primary" onClick={saveTireFollowUp} disabled={savingTireFollowUp || !tireFollowUpForm.linkedWarehouseItemRef || !tireFollowUpForm.tireCode.trim() || !tireFollowUpForm.tireBrand.trim() || !tireFollowUpForm.tireSize.trim() || tireFollowUpForm.originalCost <= 0}><Save size={16} /> {savingTireFollowUp ? 'Menyimpan...' : 'Catat Aset Ban'}</button></div></div></div>}
            {showTireInstallModal && tireInstallLine && installTargetTire && <div className="modal-overlay" onClick={() => closeTireInstallModal()}><div className="modal modal-lg" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Pasang Ban dari Insiden</h3></div><div className="modal-body">
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 700 }}>{installTargetTire.tireCodeLabel || installTargetTire.tireCode} - {installTargetTire.tireBrand} {installTargetTire.tireSize}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
                        Biaya pembelian ban sudah diposting dari insiden. Pemasangan ini hanya memindahkan aset ban ke unit armada, mencatat slot, riwayat, dan persentase pemakaian ban lama bila slot sudah terisi.
                    </div>
                </div>
                <div className="form-row"><div className="form-group"><label className="form-label">Unit Armada</label><input className="form-input" value={incidentVehicle ? `${incidentVehicle.plateNumber || incident?.vehiclePlate || '-'}${incidentVehicle.unitCode ? ` - ${incidentVehicle.unitCode}` : ''}` : (incident?.vehiclePlate || '-')} readOnly /></div><div className="form-group"><label className="form-label">Tanggal Pasang</label><input type="date" className="form-input" value={tireInstallForm.maintenanceDate} onChange={event => setTireInstallForm(prev => ({ ...prev, maintenanceDate: event.target.value }))} disabled={savingTireInstall} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Slot Ban <span className="required">*</span></label><select className="form-select" value={tireInstallForm.slotCode} onChange={event => setTireInstallForm(prev => ({ ...prev, slotCode: event.target.value, oldTireUsagePercent: null }))} disabled={savingTireInstall}><option value="">Pilih slot</option>{incidentTireSlotOptions.map(slotCode => { const occupied = installedVehicleTires.find(tire => resolveTireSlotCode(tire) === slotCode); return <option key={slotCode} value={slotCode}>{slotCode} - {formatTireSlotLabel(slotCode)}{occupied ? ` | Terisi ${occupied.tireCodeLabel}` : ' | Kosong'}</option>; })}</select></div><div className="form-group"><label className="form-label">Sumber Aset Ban</label><input className="form-input" value="Ban mandiri / beli saat DO" readOnly /></div></div>
                {oldTireInInstallSlot && <div className="info-banner" style={{ marginBottom: '1rem' }}><div className="info-banner-title">Slot tujuan sudah berisi ban lama</div><div className="info-banner-text" style={{ display: 'grid', gap: '0.65rem' }}><div>{oldTireInInstallSlot.tireCodeLabel || oldTireInInstallSlot.tireCode} akan keluar dari slot {tireInstallForm.slotCode}. Isi pemakaian ban lama sebelum diganti agar sisa nilai dan histori tetap benar.</div><div className="form-row" style={{ marginBottom: 0 }}><div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Ban Lama Dipindahkan Ke</label><select className="form-select" value={tireInstallForm.oldTireDestination} onChange={event => setTireInstallForm(prev => ({ ...prev, oldTireDestination: event.target.value as IncidentTireInstallForm['oldTireDestination'] }))} disabled={savingTireInstall}><option value="WAREHOUSE">Gudang Ban</option><option value="SCRAPPED">Afkir</option></select></div><div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Persentase Pemakaian Ban Lama</label><FormattedNumberInput allowDecimal maxFractionDigits={2} value={tireInstallForm.oldTireUsagePercent} onValueChange={value => setTireInstallForm(prev => ({ ...prev, oldTireUsagePercent: value }))} placeholder={`Maks ${formatQuantity(oldTireRemainingPercent, 2)}%`} disabled={savingTireInstall} /></div></div><div className="form-row" style={{ marginBottom: 0 }}><div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Preview Biaya Ban Lama</label><input className="form-input" value={`${formatCurrency(oldTireUsageCostPreview)} | sisa ${formatQuantity(oldTireRemainingPercentAfter, 2)}% (${formatCurrency(oldTireRemainingValueAfter)})`} readOnly /></div></div></div></div>}
                <div className="form-group"><label className="form-label">Catatan Pemasangan</label><textarea className="form-textarea" rows={3} value={tireInstallForm.note} onChange={event => setTireInstallForm(prev => ({ ...prev, note: event.target.value }))} placeholder="Opsional: lokasi pemasangan, kondisi ban lama, atau nomor kuitansi" disabled={savingTireInstall} /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => closeTireInstallModal()} disabled={savingTireInstall}>Batal</button><button className="btn btn-primary" onClick={saveTireInstall} disabled={savingTireInstall || !tireInstallForm.slotCode || !tireInstallForm.maintenanceDate || Boolean(oldTireInInstallSlot && tireInstallForm.oldTireUsagePercent === null)}><Save size={16} /> {savingTireInstall ? 'Memasang...' : 'Pasang Ban'}</button></div></div></div>}
        </div>
    );
}

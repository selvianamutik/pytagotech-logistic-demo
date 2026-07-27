'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useApp, useToast } from '../../../layout';
import { Car, Wrench, AlertTriangle, Truck, Edit, Plus, Disc3, Warehouse, ExternalLink, Save, History } from 'lucide-react';
import {
    VEHICLE_STATUS_MAP,
    MAINTENANCE_STATUS_MAP,
    INCIDENT_STATUS_MAP,
    DO_STATUS_MAP,
    TIRE_ASSET_STATUS_MAP,
    formatDate,
    formatDateTime,
    formatCurrency,
    getShipperReferenceCount,
    formatShipperDeliveryOrderNumber,
    formatInternalDeliveryOrderNumber,
    formatQuantity,
} from '@/lib/utils';
import {
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderHoldCargoSummary,
} from '@/lib/delivery-order-completion';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import { formatCargoSummary } from '@/lib/measurement';
import {
    formatTireSlotLabel,
    resolveTireSlotCode,
} from '@/lib/tire-slots';
import type { Vehicle, Maintenance, Incident, DeliveryOrder, DeliveryOrderItem, TireEvent, TireHistoryLog, Expense, IncidentSettlementLine } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import {
    buildVehicleTireDetailState,
    createDefaultVehicleTireForm,
    getVehicleTabs,
    type NormalizedVehicleTireRow,
    type VehicleTireFormState,
    VEHICLE_TIRE_TYPE_OPTIONS,
} from '@/lib/vehicle-detail-page-support';
import { VEHICLE_OWNERSHIP_LABELS } from '@/lib/fleet-vehicle-page-support';
import {
    getInstalledVehicleComponentRows,
    getMaintenanceMaterialOverflowCount,
    getMaintenanceMaterialPreview,
    getMaintenanceRecordedCost,
    isWarehouseStockMaintenanceMaterialUsage,
} from '@/lib/maintenance';
import { getTireHistoryActionColor, getTireHistoryActionLabel } from '@/lib/tire-history';

function isTripOrDriverExpense(expense: Expense) {
    return Boolean(expense.voucherRef || expense.boronganRef) || expense.categoryScope === 'TRIP' || expense.categoryScope === 'DRIVER_FEE';
}

function isIncidentExpense(expense: Expense) {
    if (expense.relatedIncidentRef || expense.relatedIncidentSettlementLineRef) return true;
    if (expense.categoryScope === 'INCIDENT') return true;

    const category = String(expense.categoryName || '').toLowerCase();
    return /insiden|kecelakaan|santunan|towing|evakuasi|darurat|mogok|klaim kerusakan/.test(category);
}

function isVehicleMaintenanceExpense(expense: Expense) {
    if (isTripOrDriverExpense(expense)) return false;
    if (isIncidentExpense(expense)) return false;
    if (expense.relatedMaintenanceRef) return true;
    if (expense.categoryScope === 'MAINTENANCE') return true;

    const category = String(expense.categoryName || '').toLowerCase();
    return /maintenance|servis|service|oli|ban|sparepart/.test(category);
}

function formatDeliveryOrderTripRoute(deliveryOrder: DeliveryOrder) {
    const origin =
        deliveryOrder.tripOriginArea ||
        deliveryOrder.pickupStops?.[0]?.pickupAddress ||
        deliveryOrder.pickupAddress ||
        '';
    const destination =
        deliveryOrder.tripDestinationArea ||
        deliveryOrder.receiverAddress ||
        '';

    if (origin && destination) return `${origin} -> ${destination}`;
    return origin || destination || '-';
}

function summarizeIncidentFinancials(lines: IncidentSettlementLine[], postedExpenseAmount: number) {
    const activeLines = lines.filter(line => line.status !== 'VOID');
    const costLines = activeLines.filter(line => line.lineType !== 'RECOVERY');
    const recoveryLines = activeLines.filter(line => line.lineType === 'RECOVERY');
    const grossCost = costLines.reduce((sum, line) => sum + line.amount, 0) || postedExpenseAmount;
    const postedCost = costLines
        .filter(line => line.status === 'POSTED')
        .reduce((sum, line) => sum + line.amount, 0) || postedExpenseAmount;
    const pendingCost = Math.max(0, grossCost - postedCost);
    const recovery = recoveryLines.reduce((sum, line) => sum + line.amount, 0);

    return {
        grossCost,
        postedCost,
        pendingCost,
        recovery,
        netCost: Math.max(0, grossCost - recovery),
    };
}

export default function VehicleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const vehicleId = params.id as string;
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [maints, setMaints] = useState<Maintenance[]>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [incidentSettlementLines, setIncidentSettlementLines] = useState<IncidentSettlementLine[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [doItemsByDeliveryOrderRef, setDoItemsByDeliveryOrderRef] = useState<Record<string, DeliveryOrderItem[]>>({});
    const [tireEvents, setTireEvents] = useState<TireEvent[]>([]);
    const [allTireEvents, setAllTireEvents] = useState<TireEvent[]>([]);
    const [tireUsageCostRows, setTireUsageCostRows] = useState<TireHistoryLog[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [tab, setTab] = useState('profil');
    const [showTireModal, setShowTireModal] = useState(false);
    const [tireForm, setTireForm] = useState<VehicleTireFormState>(createDefaultVehicleTireForm());
    const [editingTire, setEditingTire] = useState<TireEvent | null>(null);
    const [savingTire, setSavingTire] = useState(false);
    const [slotHistoryCode, setSlotHistoryCode] = useState<string | null>(null);
    const [slotHistoryRows, setSlotHistoryRows] = useState<TireHistoryLog[]>([]);
    const [loadingSlotHistory, setLoadingSlotHistory] = useState(false);
    const canUpdateVehicle = user ? hasPermission(user, 'vehicles', 'update') : false;
    const canViewExpenses = user ? hasPermission(user, 'expenses', 'view') : false;
    const canManageVehicle = canUpdateVehicle;
    const canCreateMaintenance = user ? hasPermission(user, 'maintenance', 'create') : false;
    const canCreateIncident = user ? hasPermission(user, 'incidents', 'create') : false;
    const canManageTires = user ? hasPermission(user, 'tires', 'update') : false;
    const canViewVehicleExpenses = user ? hasPermission(user, 'expenses', 'view') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user, 'customers') : false;
    const canOpenDeliveryOrderPage = user ? hasPageAccess(user, 'deliveryOrders') : false;
    const canOpenWarehouseItems = user ? hasPageAccess(user, 'warehouseItems') : false;
    const vehicleTabs = getVehicleTabs(canViewExpenses);

    const loadVehicleDetail = useCallback(async () => {
        setLoading(true);
        setLoadNotice(null);
        try {
            const vehicleFilter = encodeURIComponent(JSON.stringify({ vehicleRef: vehicleId }));
            const expenseFilter = encodeURIComponent(JSON.stringify({ relatedVehicleRef: vehicleId }));
            const tireUsageCostFilter = encodeURIComponent(JSON.stringify({ costSourceVehicleRef: vehicleId }));
            const [vehicleData, maintenanceRows, incidentRows, doRows, tireRows, allTireRows, tireUsageCostLogs, expenseRows] = await Promise.all([
                fetch(`/api/data?entity=vehicles&id=${vehicleId}`).then(async res => {
                    const payload = await res.json();
                    if (!res.ok) throw new Error(payload.error || 'Gagal memuat kendaraan');
                    return payload.data as Vehicle | null;
                }),
                fetchAllAdminCollectionData<Maintenance>(`/api/data?entity=maintenances&filter=${vehicleFilter}`, 'Gagal memuat maintenance'),
                fetchAllAdminCollectionData<Incident>(`/api/data?entity=incidents&filter=${vehicleFilter}`, 'Gagal memuat insiden'),
                fetchAllAdminCollectionData<DeliveryOrder>(`/api/data?entity=delivery-orders&filter=${vehicleFilter}`, 'Gagal memuat riwayat trip'),
                fetchAllAdminCollectionData<TireEvent>(`/api/data?entity=tire-events&filter=${vehicleFilter}`, 'Gagal memuat catatan ban'),
                fetchAllAdminCollectionData<TireEvent>('/api/data?entity=tire-events', 'Gagal memuat master ban'),
                fetchAllAdminCollectionData<TireHistoryLog>(`/api/data?entity=tire-history-logs&filter=${tireUsageCostFilter}`, 'Gagal memuat biaya pemakaian ban'),
                canViewVehicleExpenses
                    ? fetchAllAdminCollectionData<Expense>(`/api/data?entity=expenses&filter=${expenseFilter}`, 'Gagal memuat biaya maintenance unit')
                    : Promise.resolve([] as Expense[]),
            ]);
            const sortedIncidents = [...(incidentRows || [])].sort((a, b) => `${b.dateTime || ''}-${b._id}`.localeCompare(`${a.dateTime || ''}-${a._id}`));
            const incidentRefs = sortedIncidents.map(incident => incident._id).filter(Boolean);
            const settlementRows = incidentRefs.length > 0
                ? await fetchAllAdminCollectionData<IncidentSettlementLine>(
                    `/api/data?entity=incident-settlement-lines&filter=${encodeURIComponent(JSON.stringify({ incidentRef: incidentRefs }))}`,
                    'Gagal memuat biaya insiden'
                )
                : [];
            const deliveryOrderRefs = (doRows || []).map(row => row._id).filter(Boolean);
            const deliveryOrderItems = deliveryOrderRefs.length > 0
                ? await fetchAllAdminCollectionData<DeliveryOrderItem>(
                    `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderRefs }))}`,
                    'Gagal memuat ringkasan barang trip'
                )
                : [];
            const nextDoItemsByRef = deliveryOrderItems.reduce<Record<string, DeliveryOrderItem[]>>((map, item) => {
                if (!item.deliveryOrderRef) return map;
                map[item.deliveryOrderRef] = [...(map[item.deliveryOrderRef] || []), item];
                return map;
            }, {});

            setVehicle(vehicleData);
            setMaints([...(maintenanceRows || [])].sort((a, b) => `${b.plannedDate || ''}-${b._id}`.localeCompare(`${a.plannedDate || ''}-${a._id}`)));
            setIncidents(sortedIncidents);
            setIncidentSettlementLines([...(settlementRows || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setDos([...(doRows || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
            setDoItemsByDeliveryOrderRef(nextDoItemsByRef);
            setTireEvents(tireRows || []);
            setAllTireEvents(allTireRows || []);
            setTireUsageCostRows([...(tireUsageCostLogs || [])].sort((a, b) => `${b.timestamp || ''}-${b._id}`.localeCompare(`${a.timestamp || ''}-${a._id}`)));
            setExpenses([...(expenseRows || [])].sort((a, b) => `${b.date || ''}-${b._id}`.localeCompare(`${a.date || ''}-${a._id}`)));
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail kendaraan');
            setLoadNotice(buildAdminLoadNotice(
                message,
                'Kendaraan',
                'Halaman ini hanya bisa dilihat oleh role yang punya akses Kendaraan.'
            ));
            addToast('error', message);
        } finally {
            setLoading(false);
        }
    }, [addToast, canViewVehicleExpenses, vehicleId]);

    useEffect(() => {
        void loadVehicleDetail();
    }, [loadVehicleDetail]);

    useEffect(() => {
        const requestedTab = searchParams.get('tab');
        if (requestedTab && vehicleTabs.includes(requestedTab)) {
            setTab(requestedTab);
            return;
        }
        setTab('profil');
    }, [searchParams, vehicleTabs]);

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    if (!vehicle) return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Kendaraan tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;

    const incidentExpenses = expenses.filter(isIncidentExpense);
    const incidentExpenseTotalByRef = incidentExpenses.reduce((map, expense) => {
        const incidentRef = expense.relatedIncidentRef;
        if (!incidentRef) return map;
        map.set(incidentRef, (map.get(incidentRef) || 0) + expense.amount);
        return map;
    }, new Map<string, number>());
    const incidentSettlementLinesByRef = incidentSettlementLines.reduce((map, line) => {
        const rows = map.get(line.incidentRef) || [];
        rows.push(line);
        map.set(line.incidentRef, rows);
        return map;
    }, new Map<string, IncidentSettlementLine[]>());
    const maintenanceRefsWithRecordedCost = new Set(
        maints
            .filter(maintenance => maintenance.status === 'DONE' && getMaintenanceRecordedCost(maintenance) > 0)
            .map(maintenance => maintenance._id)
    );
    const vehicleMaintenanceExpenses = expenses.filter(expense =>
        isVehicleMaintenanceExpense(expense) &&
        (!expense.relatedMaintenanceRef || !maintenanceRefsWithRecordedCost.has(expense.relatedMaintenanceRef))
    );
    const installedComponentRows = getInstalledVehicleComponentRows(maints);

    const renderMaintenanceMaterialUsage = (item: Maintenance) => {
        if (item.status !== 'DONE') {
            return <span>Belum dicatat</span>;
        }

        const materialPreview = getMaintenanceMaterialPreview(item);
        if (materialPreview.length === 0) {
            return <span className="text-muted text-sm">Tanpa material gudang</span>;
        }

        const overflowCount = getMaintenanceMaterialOverflowCount(item);
        return (
            <div style={{ display: 'grid', gap: '0.2rem' }}>
                {materialPreview.map((usage) => {
                    const usageLabel = `${usage.displayLabel} ${formatQuantity(usage.quantity, 3)} ${usage.unit}${usage.attachedToVehicle ? ' | Terpasang di unit' : ''}`;
                    const usageContent = (
                        <span>
                            {usageLabel}
                            {typeof usage.subtotalCost === 'number' && usage.subtotalCost > 0 ? ` - ${formatCurrency(usage.subtotalCost)}${usage.costAlreadyPosted ? ' (biaya insiden)' : ''}` : ''}
                        </span>
                    );
                    return canOpenWarehouseItems && isWarehouseStockMaintenanceMaterialUsage(usage) ? (
                        <Link
                            key={`${item._id}-${usage.warehouseItemRef}`}
                            href={`/inventory/items/${usage.warehouseItemRef}`}
                            className="text-sm font-medium"
                            style={{ color: 'var(--color-primary)', wordBreak: 'break-word' }}
                        >
                            {usageContent}
                        </Link>
                    ) : (
                        <span key={`${item._id}-${usage.warehouseItemRef}`} className="text-sm" style={{ wordBreak: 'break-word' }}>
                            {usageContent}
                        </span>
                    );
                })}
                {overflowCount > 0 && <div className="text-muted text-xs">+{overflowCount} material lain</div>}
            </div>
        );
    };

    const renderMaintenanceCostDescription = (maintenance: Maintenance) => {
        const materialCost = typeof maintenance.materialCostTotal === 'number' ? maintenance.materialCostTotal : 0;
        const laborCost = typeof maintenance.laborCost === 'number' ? maintenance.laborCost : 0;
        return (
            <div style={{ display: 'grid', gap: '0.2rem' }}>
                <div>{maintenance.type}</div>
                {maintenance.materialUsageCount ? (
                    <div className="text-muted text-sm">{renderMaintenanceMaterialUsage(maintenance)}</div>
                ) : null}
                {(materialCost > 0 || laborCost > 0) && (
                    <div className="text-muted text-sm">
                        {materialCost > 0 ? `Material ${formatCurrency(materialCost)}` : ''}
                        {materialCost > 0 && laborCost > 0 ? ' | ' : ''}
                        {laborCost > 0 ? `Jasa ${formatCurrency(laborCost)}` : ''}
                    </div>
                )}
            </div>
        );
    };

    const maintenanceCostRows = maints
        .filter((maintenance) => maintenance.status === 'DONE' && getMaintenanceRecordedCost(maintenance) > 0)
        .flatMap((maintenance) => {
            const allTireLines = (maintenance.materialUsages || []).filter(usage =>
                typeof usage.warehouseItemRef === 'string' &&
                usage.warehouseItemRef.startsWith('tire:')
            );
            const tireLines = allTireLines.filter(usage =>
                /pemakaian ban lama|ban lama/i.test(`${usage.itemName || ''} ${usage.note || ''}`) &&
                typeof usage.subtotalCost === 'number' &&
                usage.subtotalCost > 0
            );
            if (allTireLines.length > 0) {
                const laborCost = typeof maintenance.laborCost === 'number' ? maintenance.laborCost : 0;
                return [
                    ...tireLines.map((usage, index) => ({
                    id: `maintenance-${maintenance._id}-tire-${index}`,
                    date: maintenance.completedDate || maintenance.plannedDate || '',
                    source: <Link href={`/fleet/maintenance?vehicleRef=${vehicle._id}`} style={{ color: 'var(--color-primary)' }}>Maintenance Ban</Link>,
                    description: (
                        <div style={{ display: 'grid', gap: '0.2rem' }}>
                            <div>{usage.itemName || usage.itemCode || maintenance.type}</div>
                            <div className="text-muted text-sm">{maintenance.type}</div>
                            {usage.note && <div className="text-muted text-sm">{usage.note}</div>}
                        </div>
                    ),
                    amount: usage.subtotalCost || 0,
                    })),
                    ...(laborCost > 0 ? [{
                        id: `maintenance-${maintenance._id}-technician`,
                        date: maintenance.completedDate || maintenance.plannedDate || '',
                        source: <Link href={`/fleet/maintenance?vehicleRef=${vehicle._id}`} style={{ color: 'var(--color-primary)' }}>Maintenance Ban</Link>,
                        description: (
                            <div style={{ display: 'grid', gap: '0.2rem' }}>
                                <div>Biaya teknisi ban</div>
                                <div className="text-muted text-sm">{maintenance.vendor || maintenance.type}</div>
                            </div>
                        ),
                        amount: laborCost,
                    }] : []),
                ];
            }

            return [{
                id: `maintenance-${maintenance._id}`,
                date: maintenance.completedDate || maintenance.plannedDate || '',
                source: <Link href={`/fleet/maintenance?vehicleRef=${vehicle._id}`} style={{ color: 'var(--color-primary)' }}>Maintenance</Link>,
                description: renderMaintenanceCostDescription(maintenance),
                amount: getMaintenanceRecordedCost(maintenance),
            }];
        });
    const tireUsageVehicleCostRows = tireUsageCostRows
        .filter(row =>
            Number(row.usageCost || 0) > 0 &&
            (!row.relatedMaintenanceRef || !maintenanceRefsWithRecordedCost.has(row.relatedMaintenanceRef))
        )
        .map(row => ({
            id: `tire-usage-${row._id}`,
            date: row.timestamp || '',
            source: <Link href={`/fleet/tires/${row.tireEventRef}`} style={{ color: 'var(--color-primary)' }}>Pemakaian Ban</Link>,
            description: (
                <div style={{ display: 'grid', gap: '0.2rem' }}>
                    <div>{row.tireCode || row.tireEventRef}</div>
                    <div className="text-muted text-sm">{row.fromPlacementLabel || '-'} -&gt; {row.toPlacementLabel || '-'}</div>
                    <div className="text-muted text-sm">Pemakaian {formatQuantity(row.usagePercent || 0, 2)}% | sisa {formatQuantity(row.remainingPercentAfter || 0, 2)}% ({formatCurrency(row.remainingValueAfter || 0)})</div>
                </div>
            ),
            amount: Number(row.usageCost || 0),
        }));
    const renderIncidentCostSummary = (incident: Incident) => {
        const summary = summarizeIncidentFinancials(
            incidentSettlementLinesByRef.get(incident._id) || [],
            incidentExpenseTotalByRef.get(incident._id) || 0
        );

        if (summary.grossCost <= 0 && summary.recovery <= 0) {
            return <span className="text-muted">-</span>;
        }

        return (
            <div style={{ display: 'grid', gap: '0.2rem' }}>
                <div className="font-medium">{formatCurrency(summary.netCost)}</div>
                <div className="text-muted text-sm">
                    Gross {formatCurrency(summary.grossCost)}
                    {summary.recovery > 0 ? ` | Klaim ${formatCurrency(summary.recovery)}` : ''}
                </div>
                {summary.pendingCost > 0 && <div className="text-muted text-sm">Belum diposting {formatCurrency(summary.pendingCost)}</div>}
            </div>
        );
    };
    const renderDeliveryOrderCargoSummary = (deliveryOrder: DeliveryOrder) => {
        const deliveryOrderItems = doItemsByDeliveryOrderRef[deliveryOrder._id] || [];
        const totalCargo = deliveryOrderItems.reduce((summary, item) => ({
            qtyKoli: summary.qtyKoli + parseFormattedNumberish(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 0, { maxFractionDigits: 2 }),
            weightKg: summary.weightKg + parseFormattedNumberish(item.orderItemWeight ?? item.shippedWeight ?? 0),
            volumeM3: summary.volumeM3 + parseFormattedNumberish(item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }),
        }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const holdCargo = getDeliveryOrderHoldCargoSummary(deliveryOrder);
        const dropCargo = getDeliveryOrderBillableCargoSummary(deliveryOrder);

        return (
            <div className="trip-cargo-history-summary">
                <div><span className="text-muted">Total:</span> {formatCargoSummary(totalCargo)}</div>
                <div><span className="text-muted">Hold:</span> {formatCargoSummary(holdCargo)}</div>
                <div><span className="text-muted">Drop:</span> {formatCargoSummary(dropCargo)}</div>
            </div>
        );
    };
    const activeDeliveryOrder = dos.find(deliveryOrder => ['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(deliveryOrder.status));
    const totalTireUsageCost = tireUsageCostRows.reduce((sum, row) => sum + Number(row.usageCost || 0), 0);
    const {
        normalizedAllTireRows,
        layout,
        mountedSlots,
        spareSlots,
        filledSlotCount,
        emptySlotCount,
        externalAuditTires,
        selectedRegisteredTire,
        availableRegisteredTires,
    } = buildVehicleTireDetailState({
        vehicle,
        tireEvents,
        allTireEvents,
        tireForm,
        editingTire,
    });
    const sourceUnitOptions = normalizedAllTireRows
        .filter(row =>
            row.holderType === 'INTERNAL_VEHICLE' &&
            row.status === 'IN_USE' &&
            row.vehicleRef &&
            row.vehicleRef !== vehicle._id
        )
        .reduce<Array<{ value: string; label: string; tireCount: number }>>((options, row) => {
            const existing = options.find(option => option.value === row.vehicleRef);
            if (existing) {
                existing.tireCount += 1;
                return options;
            }
            options.push({
                value: row.vehicleRef || '',
                label: row.vehiclePlate || row.vehicleRef || 'Unit tanpa plat',
                tireCount: 1,
            });
            return options;
        }, [])
        .sort((left, right) => left.label.localeCompare(right.label, 'id-ID'));
    const registeredTireDetailLocked = Boolean(selectedRegisteredTire);
    const currentVehicleTireCostRows = [...mountedSlots, ...spareSlots]
        .filter((slot): slot is { slotCode: string; event: NormalizedVehicleTireRow } => Boolean(slot.event))
        .map(slot => {
            const tire = slot.event;
            const originalCost = Number(tire.originalCost ?? tire.purchaseCost ?? 0);
            const totalUsedPercent = Number(tire.totalUsedPercent || 0);
            const remainingPercent = Math.max(100 - totalUsedPercent, 0);
            const remainingValue = Number(tire.remainingValue ?? Math.round(originalCost * remainingPercent / 100));

            return {
                id: `current-tire-${tire._id}`,
                date: tire.installDate || '',
                source: 'Ban Terpasang',
                description: (
                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                        <div>{tire.tireCodeLabel} - {slot.slotCode} ({formatTireSlotLabel(slot.slotCode)})</div>
                        <div className="text-muted text-sm">
                            Original {formatCurrency(originalCost)} | Terpakai {formatQuantity(totalUsedPercent, 2)}% | Sisa {formatQuantity(remainingPercent, 2)}% ({formatCurrency(remainingValue)})
                        </div>
                        <div className="text-muted text-sm">
                            Nilai ban terpasang dihitung dari sisa persentase ban saat ini.
                        </div>
                    </div>
                ),
                amount: remainingValue,
            };
        });
    const vehicleCostRows = [
        ...vehicleMaintenanceExpenses.map((expense) => {
            const source = expense.relatedMaintenanceRef ? (
                <Link href={`/fleet/maintenance?vehicleRef=${vehicle._id}`} style={{ color: 'var(--color-primary)' }}>
                    Maintenance
                </Link>
            ) : (
                expense.categoryName || 'Maintenance'
            );
            const documentLink = expense.relatedMaintenanceRef ? (
                <Link href={`/fleet/maintenance?vehicleRef=${vehicle._id}`} style={{ color: 'var(--color-primary)' }}>
                    Lihat maintenance
                </Link>
            ) : null;

            return {
                id: expense._id,
                date: expense.date || '',
                source,
                description: (
                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                        <div>{expense.note || expense.description || '-'}</div>
                        {documentLink && <div className="text-muted text-sm">{documentLink}</div>}
                    </div>
                ),
                amount: expense.amount,
            };
        }),
        ...maintenanceCostRows,
        ...tireUsageVehicleCostRows,
        ...currentVehicleTireCostRows,
    ].sort((left, right) => `${right.date}-${right.id}`.localeCompare(`${left.date}-${left.id}`));
    const totalMaintenanceExpense = vehicleCostRows.reduce((sum, row) => sum + row.amount, 0);
    const requiresSourceTireUsagePercent = Boolean(
        selectedRegisteredTire?.holderType === 'INTERNAL_VEHICLE' &&
        selectedRegisteredTire.vehicleRef &&
        selectedRegisteredTire.vehicleRef !== vehicle._id
    );
    const sourceTireRemainingPercentBeforeExit = Math.max(100 - Number(selectedRegisteredTire?.totalUsedPercent || 0), 0);
    const sourceTireUsagePercentPreview = typeof tireForm.sourceTireUsagePercent === 'number' ? tireForm.sourceTireUsagePercent : 0;
    const sourceTireUsageCostPreview = Math.round(Number(tireForm.originalCost || 0) * sourceTireUsagePercentPreview / 100);
    const sourceTireRemainingPercentAfterPreview = Math.max(sourceTireRemainingPercentBeforeExit - sourceTireUsagePercentPreview, 0);
    const sourceTireRemainingValueAfterPreview = Math.round(Number(tireForm.originalCost || 0) * sourceTireRemainingPercentAfterPreview / 100);
    const requiresOldTireUsagePercent = Boolean(editingTire);
    const oldTireRemainingPercentBeforeExit = Math.max(100 - Number(editingTire?.totalUsedPercent || 0), 0);
    const oldTireOriginalCost = Number(editingTire?.originalCost ?? editingTire?.purchaseCost ?? 0);
    const oldTireUsagePercentPreview = typeof tireForm.oldTireUsagePercent === 'number' ? tireForm.oldTireUsagePercent : 0;
    const oldTireUsageCostPreview = Math.round(oldTireOriginalCost * oldTireUsagePercentPreview / 100);
    const oldTireRemainingPercentAfterPreview = Math.max(oldTireRemainingPercentBeforeExit - oldTireUsagePercentPreview, 0);
    const oldTireRemainingValueAfterPreview = Math.round(oldTireOriginalCost * oldTireRemainingPercentAfterPreview / 100);
    const updateTireForm = <K extends keyof VehicleTireFormState>(key: K, value: VehicleTireFormState[K]) => {
        setTireForm(prev => ({ ...prev, [key]: value }));
    };

    const closeTireModal = () => {
        if (savingTire) return;
        setShowTireModal(false);
        setEditingTire(null);
        setTireForm(createDefaultVehicleTireForm(layout.allSlots[0] || '1L'));
    };

    const openNewTire = (slotCode: string) => {
        setEditingTire(null);
        setTireForm(createDefaultVehicleTireForm(slotCode));
        setShowTireModal(true);
    };

    const openVehicleMaintenance = () => {
        router.push(`/fleet/maintenance?vehicleRef=${vehicle._id}&open=1`);
    };


    const openVehicleIncident = () => {
        const params = new URLSearchParams({ vehicleRef: vehicle._id, open: '1' });
        if (activeDeliveryOrder?._id) {
            params.set('deliveryOrderRef', activeDeliveryOrder._id);
        }
        router.push(`/fleet/incidents?${params.toString()}`);
    };

    const openEditTire = (event: TireEvent) => {
        const resolvedSlot = resolveTireSlotCode(event) || layout.allSlots[0] || '1L';
        setEditingTire(event);
        setTireForm({
            ...createDefaultVehicleTireForm(resolvedSlot),
            registeredTireId: '',
            tireCode: '',
            slotCode: resolvedSlot,
            usagePercentOnExit: null,
            sourceTireUsagePercent: null,
            oldTireUsagePercent: null,
            oldTireDestination: 'WAREHOUSE',
        });
        setShowTireModal(true);
    };

    const openTireHistory = async (slotCode: string) => {
        setSlotHistoryCode(slotCode);
        setSlotHistoryRows([]);
        setLoadingSlotHistory(true);
        try {
            const orFilters = encodeURIComponent(JSON.stringify([
                { fields: ['fromVehicleRef', 'toVehicleRef'], value: vehicle._id },
            ]));
            const rows = await fetchAllAdminCollectionData<TireHistoryLog>(
                `/api/data?entity=tire-history-logs&orFilters=${orFilters}`,
                'Gagal memuat riwayat ban'
            );
            const filteredRows = (rows || []).filter(log => (
                (log.fromVehicleRef === vehicle._id && log.fromSlotCode === slotCode) ||
                (log.toVehicleRef === vehicle._id && log.toSlotCode === slotCode)
            ));
            setSlotHistoryRows(filteredRows);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat riwayat ban');
        } finally {
            setLoadingSlotHistory(false);
        }
    };

    const handleRegisteredTireChange = (registeredTireId: string) => {
        if (!registeredTireId) {
            setTireForm(prev => ({
                ...createDefaultVehicleTireForm(prev.slotCode),
                slotCode: prev.slotCode,
                tireSource: prev.tireSource,
                sourceVehicleRef: prev.sourceVehicleRef,
                installDate: prev.installDate,
            }));
            return;
        }

        const pickedTire = normalizedAllTireRows.find(row => row._id === registeredTireId);
        if (!pickedTire) {
            return;
        }

        setTireForm(prev => ({
            ...prev,
            registeredTireId,
            tireCode: pickedTire.tireCode || '',
            tireType: pickedTire.tireType,
            tireBrand: pickedTire.tireBrand,
            tireSize: pickedTire.tireSize,
            originalCost: pickedTire.originalCost ?? pickedTire.purchaseCost ?? 0,
            totalUsedPercent: pickedTire.totalUsedPercent || 0,
            usagePercentOnExit: null,
            sourceTireUsagePercent: null,
            oldTireUsagePercent: null,
            notes: pickedTire.notes || prev.notes,
        }));
    };

    const handleTabChange = (nextTab: string) => {
        setTab(nextTab);
        const nextParams = new URLSearchParams(searchParams.toString());
        if (nextTab === 'profil') {
            nextParams.delete('tab');
        } else {
            nextParams.set('tab', nextTab);
        }
        const nextQuery = nextParams.toString();
        router.replace(nextQuery ? `/fleet/vehicles/${vehicleId}?${nextQuery}` : `/fleet/vehicles/${vehicleId}`, { scroll: false });
    };

    const handleSaveTire = async () => {
        if (editingTire && !tireForm.registeredTireId) { addToast('error', 'Pilih ban sumber untuk mengganti ban lama'); return; }
        if (tireForm.tireSource === 'UNIT' && !tireForm.registeredTireId) { addToast('error', 'Pilih ban dari unit lain'); return; }
        if (!tireForm.registeredTireId) {
            addToast('error', 'Pilih ban tertracking dari gudang atau unit sumber. Catat aset ban baru dari halaman Ban terlebih dahulu.');
            return;
        }
        if (!tireForm.tireCode.trim()) { addToast('error', 'Isi kode ban'); return; }
        if (!tireForm.tireBrand.trim()) { addToast('error', 'Isi merk/tipe ban'); return; }
        if (!tireForm.tireSize.trim()) { addToast('error', 'Isi ukuran ban'); return; }
        if (!tireForm.slotCode.trim()) { addToast('error', 'Pilih slot ban'); return; }
        if (tireForm.totalUsedPercent < 0 || tireForm.totalUsedPercent > 100) {
            addToast('error', 'Total pemakaian ban harus 0-100%');
            return;
        }
        if (requiresSourceTireUsagePercent) {
            if (tireForm.sourceTireUsagePercent === null || !Number.isFinite(tireForm.sourceTireUsagePercent)) {
                addToast('error', 'Isi persentase pemakaian ban di unit sumber');
                return;
            }
            if (tireForm.sourceTireUsagePercent < 0 || tireForm.sourceTireUsagePercent > sourceTireRemainingPercentBeforeExit) {
                addToast('error', `Persentase pemakaian ban sumber harus 0-${sourceTireRemainingPercentBeforeExit}%`);
                return;
            }
        }
        if (requiresOldTireUsagePercent) {
            if (tireForm.oldTireUsagePercent === null || !Number.isFinite(tireForm.oldTireUsagePercent)) {
                addToast('error', 'Isi persentase pemakaian ban lama di slot tujuan');
                return;
            }
            if (tireForm.oldTireUsagePercent < 0 || tireForm.oldTireUsagePercent > oldTireRemainingPercentBeforeExit) {
                addToast('error', `Persentase ban lama harus 0-${oldTireRemainingPercentBeforeExit}%`);
                return;
            }
        }

        const normalizedSlotCode = tireForm.slotCode.trim().toUpperCase();
        const payload = {
            tireCode: tireForm.tireCode.trim().toUpperCase().replace(/\s+/g, '-'),
            holderType: 'INTERNAL_VEHICLE',
            status: 'IN_USE',
            vehicleRef: vehicle._id,
            slotCode: normalizedSlotCode,
            tireType: tireForm.tireType,
            tireBrand: tireForm.tireBrand.trim(),
            tireSize: tireForm.tireSize.trim(),
            installDate: tireForm.installDate,
            purchaseCost: tireForm.originalCost,
            originalCost: tireForm.originalCost,
            totalUsedPercent: tireForm.totalUsedPercent,
            notes: tireForm.notes.trim() || undefined,
        };

        setSavingTire(true);
        try {
            const targetTireId = editingTire?._id || tireForm.registeredTireId;
            const shouldUseTireInstallWorkflow = Boolean(tireForm.registeredTireId);
            if (shouldUseTireInstallWorkflow) {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'tire-events',
                        action: 'install-to-slot',
                        data: {
                            tireEventRef: tireForm.registeredTireId,
                            vehicleRef: vehicle._id,
                            slotCode: normalizedSlotCode,
                            sourceTireUsagePercent: requiresSourceTireUsagePercent ? tireForm.sourceTireUsagePercent : undefined,
                            oldTireUsagePercent: editingTire ? tireForm.oldTireUsagePercent : undefined,
                            oldTireDestination: editingTire ? tireForm.oldTireDestination : undefined,
                            maintenanceDate: tireForm.installDate,
                            note: tireForm.notes.trim() || undefined,
                        },
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal memasang ban');
                    return;
                }
                const tireCostLines = [
                    ...(selectedRegisteredTire ? [{
                        warehouseItemRef: `tire:${selectedRegisteredTire._id}`,
                        itemCode: selectedRegisteredTire.tireCodeLabel || selectedRegisteredTire.tireCode,
                        itemName: `Pasang ban pengganti ${selectedRegisteredTire.tireCodeLabel || selectedRegisteredTire.tireCode || ''}`.trim(),
                        subtotalCost: Number(result.summary?.installCost ?? selectedRegisteredTire.originalCost ?? selectedRegisteredTire.purchaseCost ?? 0),
                        note: `Dipasang ke slot ${normalizedSlotCode}`,
                    }] : []),
                    ...(editingTire ? [{
                        warehouseItemRef: `tire:${editingTire._id}`,
                        itemCode: editingTire.tireCode,
                        itemName: `Pemakaian ban lama ${editingTire.tireCode || ''}`.trim(),
                        subtotalCost: Number(result.summary?.oldTireUsageCost ?? oldTireUsageCostPreview),
                        note: `${oldTireUsagePercentPreview}% pemakaian di ${vehicle.plateNumber}`,
                    }] : []),
                ];
                const technicianRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'maintenances',
                        action: 'record-tire-technician-cost',
                        data: {
                            vehicleRef: vehicle._id,
                            completedDate: tireForm.installDate,
                            vendor: tireForm.technicianVendor.trim() || undefined,
                            laborCost: tireForm.technicianCost,
                            maintenanceType: editingTire ? 'Ganti Ban' : 'Pasang Ban',
                            tireContext: `${editingTire ? 'Ganti' : 'Pasang'} ban ${selectedRegisteredTire?.tireCodeLabel || tireForm.tireCode || '-'} ke slot ${normalizedSlotCode}${editingTire ? `, ban lama ${editingTire.tireCode || editingTire._id}` : ''}`,
                            tireCostLines,
                            completionNotes: tireForm.notes.trim() || undefined,
                        },
                    }),
                });
                const technicianPayload = await technicianRes.json();
                if (!technicianRes.ok) {
                    addToast('error', technicianPayload.error || 'Ban berhasil dipasang, tapi catatan maintenance ban gagal dibuat');
                    await loadVehicleDetail();
                    return;
                }
                addToast('success', editingTire ? 'Ban berhasil diganti dan riwayat ban dicatat' : 'Ban berhasil dipasang dan riwayat ban dicatat');
                closeTireModal();
                await loadVehicleDetail();
                return;
            }
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    targetTireId
                        ? { entity: 'tire-events', action: 'update', data: { id: targetTireId, updates: payload } }
                        : { entity: 'tire-events', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan ban');
                return;
            }
            addToast('success', targetTireId ? 'Ban pada unit berhasil diperbarui' : 'Ban berhasil dipasang ke unit');
            closeTireModal();
            await loadVehicleDetail();
        } catch {
            addToast('error', 'Gagal menyimpan ban');
        } finally {
            setSavingTire(false);
        }
    };

    const renderSlotCard = (slotCode: string, event?: NormalizedVehicleTireRow) => (
        <div
            key={slotCode}
            style={{
                border: '1px solid var(--color-gray-200)',
                borderRadius: '0.9rem',
                padding: '1rem',
                display: 'grid',
                gap: '0.65rem',
                background: event ? 'var(--color-white)' : 'var(--color-gray-50)',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ fontWeight: 700 }}>{slotCode}</div>
                    <div className="text-muted text-sm">{formatTireSlotLabel(slotCode)}</div>
                </div>
                <span className={`badge badge-${event ? (TIRE_ASSET_STATUS_MAP[event.status]?.color || 'gray') : 'gray'}`}>
                    <span className="badge-dot" /> {event ? (TIRE_ASSET_STATUS_MAP[event.status]?.label || event.status) : 'Belum Diisi'}
                </span>
            </div>

            {event ? (
                <>
                    <div>
                        <Link href={`/fleet/tires/${event._id}`} className="font-medium" style={{ color: 'var(--color-primary)' }}>{event.tireCodeLabel}</Link>
                        <div className="text-muted text-sm">{event.tireBrand} • {event.tireSize}</div>
                        <div className="text-muted text-sm">{event.tireType} • dicatat {formatDate(event.installDate)}</div>
                        <div className="text-muted text-sm">Sisa nilai {formatCurrency(event.remainingValue ?? 0)} dari {formatCurrency(event.originalCost ?? event.purchaseCost ?? 0)}</div>
                    </div>
                    <div className="text-muted text-sm">{event.notes || 'Belum ada catatan tambahan.'}</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary" type="button" onClick={() => openTireHistory(slotCode)}>
                            <History size={14} /> Riwayat
                        </button>
                        {canManageTires && <button className="btn btn-secondary" type="button" onClick={() => openEditTire(event)}>
                            <Edit size={14} /> Ganti Ban
                        </button>}
                    </div>
                </>
            ) : (
                <>
                    {canManageTires && <div>
                        <button className="btn btn-primary" type="button" onClick={() => openNewTire(slotCode)}>
                            <Plus size={14} /> Pasang Ban
                        </button>
                    </div>}
                </>
            )}
        </div>
    );

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/vehicles" />
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {vehicle.plateNumber}
                        <span className={`badge badge-${VEHICLE_STATUS_MAP[vehicle.status]?.color}`}><span className="badge-dot" /> {VEHICLE_STATUS_MAP[vehicle.status]?.label}</span>
                    </h1>
                    <p className="page-subtitle">{vehicle.brandModel} - {vehicle.unitCode}</p>
                </div>
                <div className="page-actions">
                    {canCreateMaintenance && <button className="btn btn-secondary" onClick={openVehicleMaintenance}>
                        <Wrench size={16} /> Jadwalkan Servis
                    </button>}
                    {canCreateIncident && <button className="btn btn-secondary" onClick={openVehicleIncident}>
                        <AlertTriangle size={16} /> Laporkan Insiden
                    </button>}
                    {canManageVehicle && <button className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicle._id}/edit`)}>
                        <Edit size={16} /> Edit Kendaraan
                    </button>}
                </div>
            </div>

            <div className="tabs">
                {vehicleTabs.map(t => (
                    <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => handleTabChange(t)}>
                        {t === 'profil' ? 'Profil' : t === 'do' ? 'Trip' : t === 'maintenance' ? 'Maintenance' : t === 'ban' ? 'Ban' : t === 'insiden' ? 'Insiden' : 'Biaya Maintenance'}
                    </button>
                ))}
            </div>

            {tab === 'profil' && (
                <div className="card">
                    <div className="card-body">
                        <div className="detail-grid">
                            <div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kode Unit</div><div className="detail-value font-mono">{vehicle.unitCode}</div></div><div className="detail-item"><div className="detail-label">Plat Nomor</div><div className="detail-value font-semibold">{vehicle.plateNumber}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{vehicle.vehicleType}</div></div><div className="detail-item"><div className="detail-label">Tahun</div><div className="detail-value">{vehicle.year}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kategori Truk / Armada</div><div className="detail-value">{vehicle.serviceName || '-'}</div></div><div className="detail-item"><div className="detail-label">Base</div><div className="detail-value">{vehicle.base || '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Merk/Model</div><div className="detail-value">{vehicle.brandModel}</div></div><div className="detail-item"><div className="detail-label">Ukuran</div><div className="detail-value">{vehicle.size || '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Dimensi</div><div className="detail-value">{vehicle.dimension || '-'}</div></div><div className="detail-item"><div className="detail-label">Kapasitas (ton)</div><div className="detail-value">{vehicle.capacityMin || vehicle.capacityMax ? `${vehicle.capacityMin || '-'} - ${vehicle.capacityMax || '-'}` : '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kapasitas Vol (m3)</div><div className="detail-value">{vehicle.capacityVolume || '-'}</div></div><div className="detail-item"><div className="detail-label">Tanggal Masuk Unit</div><div className="detail-value">{formatDate(vehicle.registeredDate)}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kepemilikan</div><div className="detail-value">{VEHICLE_OWNERSHIP_LABELS[vehicle.ownershipType || 'COMPANY'] || '-'}</div></div><div className="detail-item"><div className="detail-label">Pemilik Mitra</div><div className="detail-value">{vehicle.ownershipType === 'PARTNER' ? vehicle.partnerOwnerName || '-' : '-'}</div></div></div>
                                {vehicle.ownershipType === 'PARTNER' && <div className="detail-row"><div className="detail-item"><div className="detail-label">Kontak Pemilik</div><div className="detail-value">{vehicle.partnerOwnerPhone || '-'}</div></div><div className="detail-item"><div className="detail-label">Catatan Kepemilikan</div><div className="detail-value">{vehicle.partnerNotes || '-'}</div></div></div>}
                                {canUpdateVehicle && <div className="detail-row"><div className="detail-item"><div className="detail-label">No. Rangka</div><div className="detail-value font-mono">{vehicle.chassisNumber || '-'}</div></div><div className="detail-item"><div className="detail-label">No. Mesin</div><div className="detail-value font-mono">{vehicle.engineNumber || '-'}</div></div></div>}
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Odometer Terakhir</div><div className="detail-value">{vehicle.lastOdometer ? `${formatQuantity(vehicle.lastOdometer, 0)} km` : '-'}</div></div><div className="detail-item"><div className="detail-label">Jarak Trip Terakhir</div><div className="detail-value">{typeof vehicle.lastTripOdometerDeltaKm === 'number' ? `${formatQuantity(vehicle.lastTripOdometerDeltaKm, 0)} km` : '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Servis Oli Berikutnya</div><div className="detail-value">{vehicle.oilNextServiceOdometer ? `${formatQuantity(vehicle.oilNextServiceOdometer, 0)} km` : '-'}</div></div><div className="detail-item"><div className="detail-label">Sisa Servis Oli</div><div className="detail-value">{typeof vehicle.oilServiceRemainingKm === 'number' ? `${formatQuantity(vehicle.oilServiceRemainingKm, 0)} km` : '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Servis Oli Terakhir</div><div className="detail-value">{vehicle.oilLastServiceOdometer ? `${formatQuantity(vehicle.oilLastServiceOdometer, 0)} km` : '-'}</div></div><div className="detail-item"><div className="detail-label">Catatan</div><div className="detail-value">{vehicle.notes || '-'}</div></div></div>
                            </div>
                            <div>
                                {activeDeliveryOrder && (
                                    <div style={{ marginBottom: '1rem', padding: '0.9rem 1rem', borderRadius: '0.8rem', border: '1px solid var(--color-primary-soft)', background: 'var(--color-primary-surface)' }}>
                                        <div className="text-muted text-sm">Trip Aktif Kendaraan</div>
                                        <div className="font-medium" style={{ marginTop: '0.2rem' }}>
                                            {canOpenDeliveryOrderPage ? <Link href={`/delivery-orders/${activeDeliveryOrder._id}`}>{formatInternalDeliveryOrderNumber(activeDeliveryOrder)}</Link> : formatInternalDeliveryOrderNumber(activeDeliveryOrder)}
                                            {' - '}
                                            {canOpenCustomerPage && activeDeliveryOrder.customerRef ? <Link href={`/customers/${activeDeliveryOrder.customerRef}`}>{activeDeliveryOrder.customerName}</Link> : activeDeliveryOrder.customerName}
                                        </div>
                                        {getShipperReferenceCount(activeDeliveryOrder) > 0 && (
                                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                                SJ Pengirim: {formatShipperDeliveryOrderNumber(activeDeliveryOrder)}
                                            </div>
                                        )}
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Status {DO_STATUS_MAP[activeDeliveryOrder.status]?.label || activeDeliveryOrder.status}. Gunakan tombol servis atau insiden di atas jika ada kejadian pada trip ini.
                                        </div>
                                    </div>
                                )}
                                <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                    <div className="kpi-card"><div className="kpi-icon info"><Truck size={20} /></div><div className="kpi-content"><div className="kpi-label">Total Trip</div><div className="kpi-value">{dos.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon warning"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Maintenance</div><div className="kpi-value">{maints.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon danger"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Insiden</div><div className="kpi-value">{incidents.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon success"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Slot Ban Terisi</div><div className="kpi-value">{filledSlotCount}/{layout.allSlots.length}</div></div></div>
                                    {canViewExpenses && <div className="kpi-card"><div className="kpi-icon primary"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Biaya Maintenance</div><div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(totalMaintenanceExpense)}</div></div></div>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'do' && (
                <div className="card">
                    <div className="card-header">
                        <div>
                            <span className="card-header-title">Riwayat Trip Unit</span>
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="table-wrapper table-desktop-only"><table>
                            <thead><tr><th>Trip / DO</th><th>Tanggal</th><th>Supir</th><th>Rute Trip</th><th>Customer</th><th>Barang</th><th>Status</th></tr></thead>
                            <tbody>{dos.length === 0 ? <tr><td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada riwayat trip</td></tr> : dos.map(d => (
                                <tr key={d._id}><td><a href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{formatInternalDeliveryOrderNumber(d)}</a>{getShipperReferenceCount(d) > 0 && <div className="text-muted text-sm font-mono">{formatShipperDeliveryOrderNumber(d)}</div>}</td><td>{formatDate(d.date)}</td><td>{d.driverName || '-'}</td><td>{formatDeliveryOrderTripRoute(d)}</td><td>{d.customerName}</td><td>{renderDeliveryOrderCargoSummary(d)}</td><td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>{DO_STATUS_MAP[d.status]?.label}</span></td></tr>
                            ))}</tbody>
                        </table></div>
                        <div className="mobile-record-list">
                            {dos.length === 0 ? (
                                <div className="mobile-record-card">
                                    <div className="mobile-record-title">Belum ada riwayat trip</div>
                                </div>
                            ) : dos.map(d => (
                                <div key={d._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{formatInternalDeliveryOrderNumber(d)}</div>
                                            <div className="mobile-record-subtitle">{d.customerName}</div>
                                        </div>
                                        <span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>{DO_STATUS_MAP[d.status]?.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        {getShipperReferenceCount(d) > 0 && (
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">SJ Pengirim</span>
                                                <span className="mobile-record-value">{formatShipperDeliveryOrderNumber(d)}</span>
                                            </div>
                                        )}
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tanggal</span>
                                            <span className="mobile-record-value">{formatDate(d.date)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Driver</span>
                                            <span className="mobile-record-value">{d.driverName || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Rute Trip</span>
                                            <span className="mobile-record-value">{formatDeliveryOrderTripRoute(d)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Barang</span>
                                            <div className="mobile-record-value">{renderDeliveryOrderCargoSummary(d)}</div>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => router.push(`/delivery-orders/${d._id}`)}>Lihat Trip</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'maintenance' && (
                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">Komponen Terpasang dari Maintenance</span>
                        </div>
                        <div className="card-body">
                            {installedComponentRows.length === 0 ? (
                                <div className="text-muted">Belum ada material maintenance yang ditandai terpasang di unit.</div>
                            ) : (
                                <>
                                    <div className="table-wrapper table-desktop-only">
                                        <table>
                                            <thead><tr><th>Tanggal Pasang</th><th>Komponen</th><th>Qty</th><th>Nilai Snapshot</th><th>Odometer</th><th>Sumber</th><th>Catatan</th></tr></thead>
                                            <tbody>
                                                {installedComponentRows.map((row) => (
                                                    <tr key={row.id}>
                                                        <td>{row.installedDate ? formatDate(row.installedDate) : '-'}</td>
                                                        <td>
                                                            <div className="font-medium">{row.displayLabel}</div>
                                                            <div className="text-muted text-sm">{row.itemCode || row.warehouseItemRef}</div>
                                                        </td>
                                                        <td>{formatQuantity(row.quantity, 3)} {row.unit}</td>
                                                        <td>{Number(row.subtotalCost || 0) > 0 ? formatCurrency(Number(row.subtotalCost || 0)) : '-'}</td>
                                                        <td>{row.installedOdometer ? `${formatQuantity(row.installedOdometer, 0)} km` : '-'}</td>
                                                        <td><Link href={`/fleet/maintenance?vehicleRef=${vehicle._id}`} style={{ color: 'var(--color-primary)' }}>{row.maintenanceType}</Link></td>
                                                        <td>{row.note || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="mobile-record-list">
                                        {installedComponentRows.map((row) => (
                                            <div key={row.id} className="mobile-record-card">
                                                <div className="mobile-record-header">
                                                    <div>
                                                        <div className="mobile-record-title">{row.displayLabel}</div>
                                                        <div className="mobile-record-subtitle">{row.installedDate ? formatDate(row.installedDate) : '-'} | {row.itemCode || row.warehouseItemRef}</div>
                                                    </div>
                                                </div>
                                                <div className="mobile-record-meta">
                                                    <div className="mobile-record-kv"><span className="mobile-record-label">Qty</span><span className="mobile-record-value">{formatQuantity(row.quantity, 3)} {row.unit}</span></div>
                                                    <div className="mobile-record-kv"><span className="mobile-record-label">Nilai Snapshot</span><span className="mobile-record-value">{Number(row.subtotalCost || 0) > 0 ? formatCurrency(Number(row.subtotalCost || 0)) : '-'}</span></div>
                                                    <div className="mobile-record-kv"><span className="mobile-record-label">Odometer</span><span className="mobile-record-value">{row.installedOdometer ? `${formatQuantity(row.installedOdometer, 0)} km` : '-'}</span></div>
                                                    <div className="mobile-record-kv"><span className="mobile-record-label">Sumber</span><span className="mobile-record-value">{row.maintenanceType}</span></div>
                                                    <div className="mobile-record-kv"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{row.note || '-'}</span></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                            <div>
                                <span className="card-header-title">Servis & Maintenance</span>
                            </div>
                            {canCreateMaintenance && <button className="btn btn-primary" onClick={openVehicleMaintenance}>
                                <Plus size={16} /> Jadwalkan Servis
                            </button>}
                        </div>
                        <div className="card-body">
                            <div className="table-wrapper table-desktop-only"><table>
                                <thead><tr><th>Tipe</th><th>Jadwal</th><th>Status</th><th>Material Gudang</th><th>Odometer</th><th>Vendor</th>{canViewExpenses && <th>Biaya Internal</th>}</tr></thead>
                                <tbody>{maints.length === 0 ? <tr><td colSpan={canViewExpenses ? 7 : 6} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada maintenance</td></tr> : maints.map(m => {
                                    return (
                                    <tr key={m._id}><td>{m.type}</td><td>{m.scheduleType === 'DATE' ? formatDate(m.plannedDate) : `${formatQuantity(m.plannedOdometer || 0, 0)} km`}</td><td><span className={`badge badge-${MAINTENANCE_STATUS_MAP[m.status]?.color}`}>{MAINTENANCE_STATUS_MAP[m.status]?.label}</span></td><td>{renderMaintenanceMaterialUsage(m)}</td><td>{m.odometerAtService ? `${formatQuantity(m.odometerAtService, 0)} km` : '-'}</td><td>{m.vendor || '-'}</td>{canViewExpenses && <td>{m.status === 'DONE' ? formatCurrency(getMaintenanceRecordedCost(m)) : '-'}</td>}</tr>
                                    );
                                })}</tbody>
                            </table></div>
                            <div className="mobile-record-list">
                                {maints.length === 0 ? (
                                    <div className="mobile-record-card">
                                        <div className="mobile-record-title">Belum ada jadwal maintenance</div>
                                    </div>
                                ) : maints.map(m => (
                                    <div key={m._id} className="mobile-record-card">
                                        <div className="mobile-record-header">
                                            <div>
                                                <div className="mobile-record-title">{m.type}</div>
                                                <div className="mobile-record-subtitle">{m.scheduleType === 'DATE' ? formatDate(m.plannedDate) : `${formatQuantity(m.plannedOdometer || 0, 0)} km`}</div>
                                            </div>
                                            <span className={`badge badge-${MAINTENANCE_STATUS_MAP[m.status]?.color}`}>{MAINTENANCE_STATUS_MAP[m.status]?.label}</span>
                                        </div>
                                        <div className="mobile-record-meta">
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Vendor</span>
                                                <span className="mobile-record-value">{m.vendor || '-'}</span>
                                            </div>
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Odometer</span>
                                                <span className="mobile-record-value">{m.odometerAtService ? `${formatQuantity(m.odometerAtService, 0)} km` : '-'}</span>
                                            </div>
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Material Gudang</span>
                                                <div className="mobile-record-value">{renderMaintenanceMaterialUsage(m)}</div>
                                            </div>
                                            {canViewExpenses && m.status === 'DONE' && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Biaya Internal</span>
                                                    <span className="mobile-record-value">{formatCurrency(getMaintenanceRecordedCost(m))}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'ban' && (
                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div className="card">
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <div style={{ display: 'grid', gap: '0.35rem' }}>
                                    <div className="form-section-title" style={{ marginBottom: 0 }}>Layout Ban Unit</div>
                                </div>
                                <button className="btn btn-secondary" type="button" onClick={() => router.push('/fleet/tires')}>
                                    <ExternalLink size={14} /> Audit Semua Ban
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="kpi-grid">
                        <div className="kpi-card"><div className="kpi-icon success"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Slot Terisi</div><div className="kpi-value">{filledSlotCount}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon warning"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Slot Belum Diisi</div><div className="kpi-value">{emptySlotCount}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon info"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Serep Unit</div><div className="kpi-value">{spareSlots.filter(slot => Boolean(slot.event)).length}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Catatan Audit Lain</div><div className="kpi-value">{externalAuditTires.length}</div></div></div>
                        <div className="kpi-card"><div className="kpi-icon danger"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Biaya Pakai Ban</div><div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(totalTireUsageCost)}</div></div></div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Posisi Jalan</span></div>
                        <div className="card-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                                {mountedSlots.map(slot => renderSlotCard(slot.slotCode, slot.event))}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Serep Unit</span></div>
                        <div className="card-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                                {spareSlots.map(slot => renderSlotCard(slot.slotCode, slot.event))}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Biaya Pemakaian Ban Unit</span></div>
                        <div className="card-body">
                            {tireUsageCostRows.length === 0 ? (
                                <div className="empty-state" style={{ padding: '1rem 0' }}>
                                    <div className="empty-state-title">Belum ada biaya pemakaian ban</div>
                                    <div className="empty-state-text">Biaya muncul saat ban keluar dari unit ini dan persentase pemakaian dicatat.</div>
                                </div>
                            ) : (
                                <div className="table-wrapper">
                                    <table>
                                        <thead><tr><th>Tanggal</th><th>Ban</th><th>Perpindahan</th><th>Pemakaian</th><th>Biaya</th><th>Sisa Setelah Pindah</th></tr></thead>
                                        <tbody>
                                            {tireUsageCostRows.map(row => (
                                                <tr key={row._id}>
                                                    <td>{formatDateTime(row.timestamp)}</td>
                                                    <td><Link href={`/fleet/tires/${row.tireEventRef}`} style={{ color: 'var(--color-primary)' }}>{row.tireCode}</Link></td>
                                                    <td>{row.fromPlacementLabel || '-'} -&gt; {row.toPlacementLabel || '-'}</td>
                                                    <td>{formatQuantity(row.usagePercent || 0, 2)}%</td>
                                                    <td className="font-medium">{formatCurrency(row.usageCost || 0)}</td>
                                                    <td>{formatQuantity(row.remainingPercentAfter || 0, 2)}% | {formatCurrency(row.remainingValueAfter || 0)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    {externalAuditTires.length > 0 && (
                        <div className="card">
                            <div className="card-header"><span className="card-header-title">Catatan Audit Ban di Luar Slot Unit</span></div>
                            <div className="card-body">
                                <div className="table-wrapper">
                                    <table>
                                        <thead><tr><th>Kode Ban</th><th>Lokasi Saat Ini</th><th>Status</th><th>Merk & Ukuran</th><th>Tanggal</th><th>Catatan</th></tr></thead>
                                        <tbody>
                                            {externalAuditTires.map(te => (
                                                <tr key={te._id}>
                                                    <td>
                                                        <div className="font-medium">{te.tireCodeLabel}</div>
                                                        <div className="text-muted text-sm">{te.tireType}</div>
                                                    </td>
                                                    <td>{te.placementLabel}</td>
                                                    <td><span className={`badge badge-${TIRE_ASSET_STATUS_MAP[te.status]?.color || 'gray'}`}>{TIRE_ASSET_STATUS_MAP[te.status]?.label || te.status}</span></td>
                                                    <td><div className="font-medium">{te.tireBrand}</div><div className="font-mono text-sm">{te.tireSize}</div></td>
                                                    <td>{formatDate(te.installDate)}</td>
                                                    <td>{te.notes || '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === 'insiden' && (
                <div className="card">
                    <div className="card-header" style={{ justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                        <div>
                            <span className="card-header-title">Insiden Kendaraan</span>
                            <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>Kalau ada kendala di perjalanan atau di pool, laporkan langsung dari halaman unit ini.</div>
                        </div>
                        {canCreateIncident && <button className="btn btn-danger" onClick={openVehicleIncident}>
                            <AlertTriangle size={16} /> Laporkan Insiden
                        </button>}
                    </div>
                    <div className="card-body">
                        <div className="table-wrapper table-desktop-only"><table>
                            <thead><tr><th>No.</th><th>Tanggal</th><th>Tipe</th><th>Lokasi</th><th>Biaya Insiden</th><th>Status</th></tr></thead>
                            <tbody>{incidents.length === 0 ? <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>Tidak ada insiden</td></tr> : incidents.map(i => (
                                <tr key={i._id}><td><a href={`/fleet/incidents/${i._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{i.incidentNumber}</a></td><td>{formatDate(i.dateTime)}</td><td>{i.incidentType}</td><td>{i.locationText}</td><td>{renderIncidentCostSummary(i)}</td><td><span className={`badge badge-${INCIDENT_STATUS_MAP[i.status]?.color}`}>{INCIDENT_STATUS_MAP[i.status]?.label}</span></td></tr>
                            ))}</tbody>
                        </table></div>
                        <div className="mobile-record-list">
                            {incidents.length === 0 ? (
                                <div className="mobile-record-card">
                                    <div className="mobile-record-title">Tidak ada insiden</div>
                                </div>
                            ) : incidents.map(i => (
                                <div key={i._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{i.incidentNumber}</div>
                                            <div className="mobile-record-subtitle">{formatDate(i.dateTime)} - {i.locationText || '-'}</div>
                                        </div>
                                        <span className={`badge badge-${INCIDENT_STATUS_MAP[i.status]?.color}`}>{INCIDENT_STATUS_MAP[i.status]?.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tipe</span>
                                            <span className="mobile-record-value">{i.incidentType}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">DO Terkait</span>
                                            <span className="mobile-record-value">{i.relatedDONumber || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Biaya Insiden</span>
                                            <div className="mobile-record-value">{renderIncidentCostSummary(i)}</div>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => router.push(`/fleet/incidents/${i._id}`)}>Lihat Insiden</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {tab === 'biaya' && canViewExpenses && (
                <div className="card">
                    <div className="card-header">
                        <div>
                            <span className="card-header-title">Biaya Maintenance Unit</span>
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="table-wrapper"><table>
                            <thead><tr><th>Tanggal</th><th>Sumber</th><th>Deskripsi</th><th>Jumlah</th></tr></thead>
                            <tbody>{vehicleCostRows.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada biaya maintenance</td></tr> : vehicleCostRows.map(row => (
                                <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.source}</td><td>{row.description}</td><td className="font-medium">{formatCurrency(row.amount)}</td></tr>
                            ))}</tbody>
                        </table></div>
                    </div>
                </div>
            )}

            {canManageTires && showTireModal && (
                <div className="modal-overlay" onClick={closeTireModal}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editingTire ? `Ganti Ban ${tireForm.slotCode}` : `Pasang Ban ${tireForm.slotCode}`}</h3>
                            <button className="modal-close" onClick={closeTireModal} disabled={savingTire}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gap: '1rem' }}>
                                <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}>
                                    <div className="text-muted text-sm">Unit</div>
                                    <div className="font-medium">{vehicle.plateNumber} - {vehicle.unitCode}</div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Slot Ban</label>
                                        <select className="form-select" value={tireForm.slotCode} onChange={e => updateTireForm('slotCode', e.target.value)} disabled={savingTire}>
                                            {layout.allSlots.map(slotCode => (
                                                <option key={slotCode} value={slotCode}>{slotCode} - {formatTireSlotLabel(slotCode)}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Sumber Ban</label>
                                        <select
                                            className="form-select"
                                            value={tireForm.tireSource}
                                            onChange={e => setTireForm(prev => ({
                                                ...createDefaultVehicleTireForm(prev.slotCode),
                                                tireSource: e.target.value as VehicleTireFormState['tireSource'],
                                                sourceVehicleRef: '',
                                                slotCode: prev.slotCode,
                                                installDate: prev.installDate,
                                                oldTireDestination: prev.oldTireDestination,
                                            }))}
                                            disabled={savingTire}
                                        >
                                            <option value="WAREHOUSE">Gudang Ban</option>
                                            <option value="UNIT">Unit Lain</option>
                                        </select>
                                    </div>
                                </div>

                                {tireForm.tireSource === 'UNIT' && (
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Unit Sumber</label>
                                            <select
                                                className="form-select"
                                                value={tireForm.sourceVehicleRef}
                                                onChange={e => setTireForm(prev => ({
                                                    ...prev,
                                                    sourceVehicleRef: e.target.value,
                                                    registeredTireId: '',
                                                    tireCode: '',
                                                    tireBrand: '',
                                                    tireSize: '',
                                                    originalCost: 0,
                                                    totalUsedPercent: 0,
                                                    sourceTireUsagePercent: null,
                                                }))}
                                                disabled={savingTire}
                                            >
                                                <option value="">Pilih unit sumber</option>
                                                {sourceUnitOptions.map(option => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label} ({option.tireCount} ban)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">{tireForm.tireSource === 'WAREHOUSE' ? 'Ban dari Gudang' : 'Ban dari Unit'}</label>
                                        <select
                                            className="form-select"
                                            value={tireForm.registeredTireId}
                                            onChange={e => handleRegisteredTireChange(e.target.value)}
                                            disabled={savingTire || (tireForm.tireSource === 'UNIT' && !tireForm.sourceVehicleRef)}
                                        >
                                            <option value="">{tireForm.tireSource === 'WAREHOUSE' ? 'Pilih ban dari gudang' : tireForm.sourceVehicleRef ? 'Pilih ban dari unit' : 'Pilih unit sumber dulu'}</option>
                                            {availableRegisteredTires.map(registeredTire => (
                                                <option key={registeredTire._id} value={registeredTire._id}>
                                                    {registeredTire.tireCodeLabel} - {registeredTire.tireBrand} {registeredTire.tireSize} ({registeredTire.placementLabel})
                                                </option>
                                        ))}
                                        </select>
                                    </div>
                                </div>

                                {tireForm.tireSource === 'WAREHOUSE' && availableRegisteredTires.length === 0 && (
                                    <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                        <div className="info-banner-title">Belum Ada Ban Tertracking Siap Pasang</div>
                                        <div className="info-banner-text" style={{ display: 'grid', gap: '0.65rem' }}>
                                            <div>
                                                Catat atau terima aset ban tertracking dulu dari halaman Ban atau pembelian inventory. Setelah ban berada di Gudang Ban, ban akan muncul di pilihan ini.
                                            </div>
                                            <div>
                                                <Link href="/fleet/tires" className="btn btn-secondary" style={{ width: 'fit-content' }}>
                                                    <Disc3 size={14} /> Buka Halaman Ban
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {tireForm.tireSource === 'UNIT' && availableRegisteredTires.length === 0 && (
                                    <div style={{ fontSize: '0.76rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                        {tireForm.sourceVehicleRef
                                            ? 'Tidak ada ban di unit sumber yang tersedia.'
                                            : 'Pilih unit sumber untuk melihat ban yang tersedia.'}
                                    </div>
                                )}

                                {editingTire && (
                                    <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}>
                                        <div className="text-muted text-sm">Ban Lama di Slot Ini</div>
                                        <div className="font-medium">{editingTire.tireCode || '-'} - {editingTire.tireBrand} {editingTire.tireSize}</div>
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Terpakai {formatQuantity(editingTire.totalUsedPercent || 0, 2)}% | Sisa {formatQuantity(oldTireRemainingPercentBeforeExit, 2)}% ({formatCurrency(editingTire.remainingValue ?? Math.round(Number(editingTire.originalCost ?? editingTire.purchaseCost ?? 0) * oldTireRemainingPercentBeforeExit / 100))})
                                        </div>
                                    </div>
                                )}

                                {selectedRegisteredTire && (
                                    <div style={{ padding: '0.85rem 1rem', borderRadius: '0.75rem', background: 'var(--color-gray-50)', border: '1px solid var(--color-gray-200)' }}>
                                        <div className="text-muted text-sm">Ban Terpilih</div>
                                        <div className="font-medium">{selectedRegisteredTire.tireCodeLabel} - {selectedRegisteredTire.tireBrand} {selectedRegisteredTire.tireSize}</div>
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Posisi terakhir: {selectedRegisteredTire.placementLabel}
                                        </div>
                                        <div className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                                            Terpakai {formatQuantity(selectedRegisteredTire.totalUsedPercent || 0, 2)}% | Sisa {formatQuantity(selectedRegisteredTire.remainingPercent ?? Math.max(100 - Number(selectedRegisteredTire.totalUsedPercent || 0), 0), 2)}% ({formatCurrency(selectedRegisteredTire.remainingValue ?? Math.round(Number(selectedRegisteredTire.originalCost ?? selectedRegisteredTire.purchaseCost ?? 0) * Math.max(100 - Number(selectedRegisteredTire.totalUsedPercent || 0), 0) / 100))})
                                        </div>
                                    </div>
                                )}

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kode Ban</label>
                                        <input className="form-input" value={tireForm.tireCode} onChange={e => updateTireForm('tireCode', e.target.value.toUpperCase())} placeholder="cth: BAN-0012" disabled={savingTire || !selectedRegisteredTire || registeredTireDetailLocked} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Harga Ban / Original Cost</label>
                                        <FormattedNumberInput allowDecimal={false} value={tireForm.originalCost} onValueChange={value => updateTireForm('originalCost', value)} disabled={savingTire || !selectedRegisteredTire || registeredTireDetailLocked} />
                                    </div>
                                </div>

                                {!editingTire && (
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Total Pemakaian (%)</label>
                                            <FormattedNumberInput allowDecimal maxFractionDigits={2} value={tireForm.totalUsedPercent} onValueChange={value => updateTireForm('totalUsedPercent', Math.min(Math.max(value, 0), 100))} disabled={savingTire || !selectedRegisteredTire || requiresSourceTireUsagePercent || registeredTireDetailLocked} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Sisa Nilai Saat Ini</label>
                                            <input className="form-input" value={formatCurrency(Math.round(Number(tireForm.originalCost || 0) * Math.max(100 - Number(tireForm.totalUsedPercent || 0), 0) / 100))} readOnly />
                                        </div>
                                    </div>
                                )}

                                {requiresSourceTireUsagePercent && (
                                    <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                        <div className="info-banner-title">Pemakaian Ban di Unit Sumber</div>
                                        <div className="info-banner-text" style={{ display: 'grid', gap: '0.65rem' }}>
                                            <div>
                                                Ban keluar dari {selectedRegisteredTire?.vehiclePlate || 'unit sumber'} menuju {vehicle.plateNumber}. Isi persen pemakaian selama di unit sumber.
                                            </div>
                                            <div className="form-row" style={{ marginBottom: 0 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Persentase Pemakaian di Unit Sumber</label>
                                                    <FormattedNumberInput allowDecimal maxFractionDigits={2} value={tireForm.sourceTireUsagePercent} onValueChange={value => updateTireForm('sourceTireUsagePercent', value)} placeholder={`Maks ${sourceTireRemainingPercentBeforeExit}%`} disabled={savingTire} />
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Preview Biaya</label>
                                                    <input className="form-input" value={`${formatCurrency(sourceTireUsageCostPreview)} | sisa ${formatQuantity(sourceTireRemainingPercentAfterPreview, 2)}% (${formatCurrency(sourceTireRemainingValueAfterPreview)})`} readOnly />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {requiresOldTireUsagePercent && (
                                    <div className="info-banner" style={{ marginBottom: '1rem' }}>
                                        <div className="info-banner-title">Ban Lama di Slot Tujuan</div>
                                        <div className="info-banner-text" style={{ display: 'grid', gap: '0.65rem' }}>
                                            <div>
                                                Slot {tireForm.slotCode} sudah berisi ban lama. Pilih tujuan ban lama dan isi pemakaian selama di {vehicle.plateNumber}.
                                            </div>
                                            <div className="form-row" style={{ marginBottom: 0 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Ban Lama Dipindahkan Ke</label>
                                                    <select className="form-select" value={tireForm.oldTireDestination} onChange={e => updateTireForm('oldTireDestination', e.target.value as VehicleTireFormState['oldTireDestination'])} disabled={savingTire}>
                                                        <option value="WAREHOUSE">Gudang Ban</option>
                                                        <option value="SCRAPPED">Afkir</option>
                                                    </select>
                                                </div>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Persentase Pemakaian Ban Lama</label>
                                                    <FormattedNumberInput allowDecimal maxFractionDigits={2} value={tireForm.oldTireUsagePercent} onValueChange={value => updateTireForm('oldTireUsagePercent', value)} placeholder={`Maks ${oldTireRemainingPercentBeforeExit}%`} disabled={savingTire} />
                                                </div>
                                            </div>
                                            <div className="form-row" style={{ marginBottom: 0 }}>
                                                <div className="form-group" style={{ marginBottom: 0 }}>
                                                    <label className="form-label">Preview Biaya Ban Lama</label>
                                                    <input className="form-input" value={`${formatCurrency(oldTireUsageCostPreview)} | sisa ${formatQuantity(oldTireRemainingPercentAfterPreview, 2)}% (${formatCurrency(oldTireRemainingValueAfterPreview)})`} readOnly />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Jenis Ban</label>
                                        <select className="form-select" value={tireForm.tireType} onChange={e => updateTireForm('tireType', e.target.value as VehicleTireFormState['tireType'])} disabled={savingTire || !selectedRegisteredTire || registeredTireDetailLocked}>
                                            {VEHICLE_TIRE_TYPE_OPTIONS.map(type => <option key={type} value={type}>{type}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Catat</label>
                                        <input type="date" className="form-input" value={tireForm.installDate} onChange={e => updateTireForm('installDate', e.target.value)} disabled={savingTire} />
                                    </div>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Merk / Model Ban</label>
                                        <input className="form-input" value={tireForm.tireBrand} onChange={e => updateTireForm('tireBrand', e.target.value)} placeholder="cth: Bridgestone R150" disabled={savingTire || !selectedRegisteredTire || registeredTireDetailLocked} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Ukuran</label>
                                        <input className="form-input" value={tireForm.tireSize} onChange={e => updateTireForm('tireSize', e.target.value)} placeholder="cth: 11.00-20 / 295-80R22.5" disabled={savingTire || !selectedRegisteredTire || registeredTireDetailLocked} />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <textarea className="form-textarea" rows={3} value={tireForm.notes} onChange={e => updateTireForm('notes', e.target.value)} placeholder="Mis. ban baru, hasil rotasi, kondisi khusus, atau alasan pindah slot." disabled={savingTire} />
                                </div>

                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                    <div>
                                        <div className="font-medium">Biaya Teknisi</div>
                                        <div className="text-muted text-sm">Isi 0 kalau tidak ada biaya teknisi.</div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Biaya Teknisi</label>
                                            <FormattedNumberInput allowDecimal={false} value={tireForm.technicianCost} onValueChange={value => updateTireForm('technicianCost', value)} disabled={savingTire} zeroAsEmpty />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Teknisi / Bengkel</label>
                                            <input className="form-input" value={tireForm.technicianVendor} onChange={e => updateTireForm('technicianVendor', e.target.value)} placeholder="Opsional" disabled={savingTire} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer" style={{ justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-secondary" onClick={closeTireModal} disabled={savingTire}>Batal</button>
                                <button type="button" className="btn btn-primary" onClick={handleSaveTire} disabled={savingTire}>
                                    <Save size={16} /> {savingTire ? 'Menyimpan...' : editingTire ? 'Ganti Ban' : 'Pasang Ban'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {slotHistoryCode && (
                <div className="modal-overlay" onClick={() => { if (!loadingSlotHistory) setSlotHistoryCode(null); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Riwayat Slot {slotHistoryCode} - {vehicle.plateNumber}</h3>
                            <button className="modal-close" onClick={() => setSlotHistoryCode(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ marginBottom: '1rem', color: 'var(--color-gray-600)' }}>
                                Menampilkan histori khusus untuk slot {slotHistoryCode} pada kendaraan ini, jadi tiap slot punya riwayatnya sendiri.
                            </div>
                            {loadingSlotHistory ? (
                                <div className="table-wrapper">
                                    <table>
                                        <tbody>
                                            {[1, 2, 3].map(item => <tr key={item}><td><div className="skeleton skeleton-text" /></td></tr>)}
                                        </tbody>
                                    </table>
                                </div>
                            ) : slotHistoryRows.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Belum ada histori untuk slot ini</div>
                                    <div className="empty-state-text">Histori akan muncul setelah ada ban yang pernah masuk atau keluar dari slot {slotHistoryCode}.</div>
                                </div>
                            ) : (
                                <div className="table-wrapper">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Waktu</th>
                                                <th>Ban</th>
                                                <th>Aksi</th>
                                                <th>Perpindahan</th>
                                                <th>Dari</th>
                                                <th>Ke</th>
                                                <th>Catatan</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {slotHistoryRows.map(log => {
                                                const enteredSlot = log.toVehicleRef === vehicle._id && log.toSlotCode === slotHistoryCode;
                                                const leftSlot = log.fromVehicleRef === vehicle._id && log.fromSlotCode === slotHistoryCode;
                                                const movementLabel =
                                                    enteredSlot && leftSlot
                                                        ? `Update di slot ${slotHistoryCode}`
                                                        : enteredSlot
                                                            ? `Masuk ke slot ${slotHistoryCode}`
                                                            : `Keluar dari slot ${slotHistoryCode}`;

                                                return (
                                                    <tr key={log._id}>
                                                        <td>{formatDateTime(log.timestamp)}</td>
                                                        <td>
                                                            <div className="font-medium">{log.tireCode || '-'}</div>
                                                            <div className="text-muted text-sm">{log.tireBrand || '-'} | {log.tireSize || '-'}</div>
                                                        </td>
                                                        <td>
                                                            <span className={`badge badge-${getTireHistoryActionColor(log.actionType)}`}>
                                                                <span className="badge-dot" /> {getTireHistoryActionLabel(log.actionType)}
                                                            </span>
                                                        </td>
                                                        <td>{movementLabel}</td>
                                                        <td>{log.fromPlacementLabel || '-'}</td>
                                                        <td>{log.toPlacementLabel || '-'}</td>
                                                        <td>{log.note || '-'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setSlotHistoryCode(null)}>Tutup</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

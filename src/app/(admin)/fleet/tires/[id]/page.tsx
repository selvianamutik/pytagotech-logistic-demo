'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit, History, Truck, Warehouse } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchOptionalAdminCollectionData, fetchOptionalAdminData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import {
    getSelectableInternalTireSlotOptions,
    getSelectableTireVehiclesByVehicleCategory,
    getSelectableVehicleCategories,
    getVehicleCategoryValue,
    resolveFleetTireEvents,
    TIRE_TYPES,
} from '@/lib/fleet-asset-page-support';
import { isTireTrackedWarehouseItem, WAREHOUSE_ITEM_TRACKING_MODE_LABELS } from '@/lib/inventory';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { getTireHistoryActionColor, getTireHistoryActionLabel, getTireHistoryTransitionLabel } from '@/lib/tire-history';
import { DEFAULT_TIRE_TYPE, normalizeTireType } from '@/lib/tire-types';
import { formatTireSlotLabel, resolveTireSlotCode, TIRE_HOLDER_TYPE_OPTIONS, TIRE_STATUS_OPTIONS, type TireAssetStatus, type TireHolderType } from '@/lib/tire-slots';
import { TIRE_ASSET_STATUS_MAP, formatCurrency, formatDate, formatDateTime, formatQuantity } from '@/lib/utils';
import { useApp, useToast } from '../../../layout';
import type { TireEvent, TireHistoryLog, Vehicle, WarehouseItem } from '@/lib/types';

type TireDetailEditForm = {
    tireCode: string;
    holderType: TireHolderType;
    status: TireAssetStatus;
    vehicleCategory: string;
    vehicleRef: string;
    slotCode: string;
    linkedWarehouseItemRef: string;
    tireType: TireEvent['tireType'];
    tireBrand: string;
    tireSize: string;
    installDate: string;
    replaceDate: string;
    originalCost: number;
    totalUsedPercent: number;
    usagePercentOnExit: number | null;
    accumulatedKm: number;
    notes: string;
};

const BAN_DETAIL_HOLDER_TYPE_OPTIONS = TIRE_HOLDER_TYPE_OPTIONS.filter(option => option.value !== 'EXTERNAL_VEHICLE');
const BAN_DETAIL_STATUS_OPTIONS = TIRE_STATUS_OPTIONS.filter(option => option.value !== 'LOANED_OUT');

export default function TireDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const tireId = params.id as string;
    const [loading, setLoading] = useState(true);
    const [tire, setTire] = useState<TireEvent | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [warehouseItem, setWarehouseItem] = useState<WarehouseItem | null>(null);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
    const [allTireEvents, setAllTireEvents] = useState<TireEvent[]>([]);
    const [historyRows, setHistoryRows] = useState<TireHistoryLog[]>([]);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editForm, setEditForm] = useState<TireDetailEditForm>({
        tireCode: '',
        holderType: 'WAREHOUSE',
        status: 'IN_WAREHOUSE',
        vehicleCategory: '',
        vehicleRef: '',
        slotCode: '',
        linkedWarehouseItemRef: '',
        tireType: DEFAULT_TIRE_TYPE,
        tireBrand: '',
        tireSize: '',
        installDate: '',
        replaceDate: '',
        originalCost: 0,
        totalUsedPercent: 0,
        usagePercentOnExit: null,
        accumulatedKm: 0,
        notes: '',
    });
    const canOpenVehicles = user ? hasPageAccess(user, 'vehicles') : false;
    const canOpenItems = user ? hasPageAccess(user, 'warehouseItems') : false;
    const canManageTires = user ? hasPermission(user, 'tires', 'update') : false;

    const reloadHistory = async () => {
        const historyFilter = encodeURIComponent(JSON.stringify({ tireEventRef: tireId }));
        const rows = await fetchAdminCollectionData<TireHistoryLog[]>(
            `/api/data?entity=tire-history-logs&filter=${historyFilter}&sortField=timestamp&sortDir=desc`,
            'Gagal memuat riwayat ban'
        );
        setHistoryRows(rows || []);
    };

    useEffect(() => {
        const loadDetail = async () => {
            setLoading(true);
            setLoadNotice(null);
            try {
                const tireData = await fetchAdminData<TireEvent | null>(`/api/data?entity=tire-events&id=${tireId}`, 'Ban tidak ditemukan');
                if (!tireData) {
                    throw new Error('Ban tidak ditemukan');
                }
                const historyFilter = encodeURIComponent(JSON.stringify({ tireEventRef: tireId }));
                const optionalFetchOptions = { onError: (message: string) => addToast('error', message), silentAccessDenied: true };
                const [vehicleData, warehouseItemData, historyData, vehicleRows, warehouseItemRows, tireRows] = await Promise.all([
                    tireData.vehicleRef
                        ? fetchOptionalAdminData<Vehicle | null>(`/api/data?entity=vehicles&id=${tireData.vehicleRef}`, 'Gagal memuat kendaraan ban', optionalFetchOptions)
                        : Promise.resolve(null),
                    tireData.linkedWarehouseItemRef
                        ? fetchOptionalAdminData<WarehouseItem | null>(`/api/data?entity=warehouse-items&id=${tireData.linkedWarehouseItemRef}`, 'Gagal memuat item gudang ban', optionalFetchOptions)
                        : Promise.resolve(null),
                    fetchOptionalAdminCollectionData<TireHistoryLog>(
                        `/api/data?entity=tire-history-logs&filter=${historyFilter}&sortField=timestamp&sortDir=desc`,
                        'Gagal memuat riwayat ban',
                        undefined,
                        optionalFetchOptions
                    ),
                    canManageTires
                        ? fetchOptionalAdminCollectionData<Vehicle>('/api/data?entity=vehicles&pageSize=500', 'Gagal memuat data kendaraan', undefined, optionalFetchOptions)
                        : Promise.resolve([] as Vehicle[]),
                    canManageTires
                        ? fetchOptionalAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&pageSize=500', 'Gagal memuat data gudang', undefined, optionalFetchOptions)
                        : Promise.resolve([] as WarehouseItem[]),
                    canManageTires
                        ? fetchOptionalAdminCollectionData<TireEvent>('/api/data?entity=tire-events&pageSize=500', 'Gagal memuat master ban', undefined, optionalFetchOptions)
                        : Promise.resolve([] as TireEvent[]),
                ]);
                setTire(tireData);
                setVehicle(vehicleData);
                setWarehouseItem(warehouseItemData);
                setHistoryRows(historyData || []);
                setVehicles(vehicleRows || []);
                setWarehouseItems((warehouseItemRows || []).filter(item => item.active !== false));
                setAllTireEvents(tireRows || []);
            } catch (error) {
                const message = getAdminErrorMessage(error, 'Gagal memuat detail ban');
                setLoadNotice(buildAdminLoadNotice(
                    message,
                    'Ban',
                    'Halaman ini hanya bisa dilihat oleh role yang punya akses Ban.'
                ));
                addToast('error', message);
            } finally {
                setLoading(false);
            }
        };

        void loadDetail();
    }, [addToast, canManageTires, tireId]);

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 260 }} /></div>;
    }
    if (!tire) {
        return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Ban tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;
    }

    const resolvedTire = resolveFleetTireEvents([tire])[0];
    const statusMeta = TIRE_ASSET_STATUS_MAP[resolvedTire.status];
    const placementLabel = resolvedTire.placementLabel || '-';
    const slotLabel = resolvedTire.slotCode ? `${resolvedTire.slotCode} - ${resolvedTire.slotLabel || formatTireSlotLabel(resolvedTire.slotCode)}` : '-';
    const resolvedEditTire = resolveFleetTireEvents([tire])[0];
    const trackedTireItems = warehouseItems.filter(item => isTireTrackedWarehouseItem(item));
    const selectedEditVehicle = vehicles.find(item => item._id === editForm.vehicleRef) || null;
    const vehicleCategoryOptions = getSelectableVehicleCategories(vehicles, tire);
    const selectableVehicles = getSelectableTireVehiclesByVehicleCategory(vehicles, tire, editForm.vehicleCategory || undefined);
    const slotOptions = getSelectableInternalTireSlotOptions({
        vehicle: selectedEditVehicle,
        tireEvents: allTireEvents,
        editTargetId: tire._id,
    });
    const selectedLinkedWarehouseItem = trackedTireItems.find(item => item._id === editForm.linkedWarehouseItemRef) || null;
    const linkedWarehouseItemLocked = Boolean(tire.linkedWarehouseItemRef || tire.sourcePurchaseRef);
    const requiresUsagePercentOnExit = Boolean(
        resolvedEditTire.holderType === 'INTERNAL_VEHICLE' &&
        tire.vehicleRef &&
        Number(tire.maintenanceCostPostedPercent || 0) < 100 &&
        (editForm.holderType !== 'INTERNAL_VEHICLE' || editForm.vehicleRef !== tire.vehicleRef)
    );
    const remainingPercentBeforeExit = Math.max(100 - Number(tire.totalUsedPercent || 0), 0);
    const editRemainingPercent = Math.max(100 - Number(editForm.totalUsedPercent || 0), 0);
    const editRemainingValue = Math.round(Number(editForm.originalCost || 0) * editRemainingPercent / 100);
    const usagePercentPreview = Number(editForm.usagePercentOnExit || 0);
    const usageCostPreview = Math.round(Number(editForm.originalCost || 0) * usagePercentPreview / 100);

    const openEditModal = () => {
        const editResolvedTire = resolveFleetTireEvents([tire])[0];
        setEditForm({
            tireCode: tire.tireCode || '',
            holderType: editResolvedTire.holderType,
            status: editResolvedTire.status,
            vehicleCategory: vehicle ? getVehicleCategoryValue(vehicle) : '',
            vehicleRef: tire.vehicleRef || '',
            slotCode: editResolvedTire.slotCode || resolveTireSlotCode(tire) || '',
            linkedWarehouseItemRef: tire.linkedWarehouseItemRef || '',
            tireType: normalizeTireType(tire.tireType),
            tireBrand: tire.tireBrand || '',
            tireSize: tire.tireSize || '',
            installDate: tire.installDate || '',
            replaceDate: tire.replaceDate || '',
            originalCost: tire.originalCost ?? tire.purchaseCost ?? 0,
            totalUsedPercent: tire.totalUsedPercent || 0,
            usagePercentOnExit: null,
            accumulatedKm: tire.accumulatedKm || 0,
            notes: tire.notes || '',
        });
        setShowEditModal(true);
    };

    const saveEdit = async () => {
        if (!editForm.tireCode.trim()) {
            addToast('error', 'Kode ban wajib diisi');
            return;
        }
        if (!editForm.tireBrand.trim() || !editForm.tireSize.trim()) {
            addToast('error', 'Merk dan ukuran ban wajib diisi');
            return;
        }
        if (!editForm.linkedWarehouseItemRef) {
            addToast('error', 'Pilih master barang gudang ban tertracking');
            return;
        }
        if (editForm.holderType === 'INTERNAL_VEHICLE' && !editForm.vehicleRef) {
            addToast('error', 'Pilih kendaraan');
            return;
        }
        if (editForm.holderType === 'INTERNAL_VEHICLE' && !editForm.slotCode) {
            addToast('error', 'Pilih slot ban');
            return;
        }
        if (editForm.totalUsedPercent < 0 || editForm.totalUsedPercent > 100) {
            addToast('error', 'Total pemakaian ban harus 0-100%');
            return;
        }
        if (requiresUsagePercentOnExit) {
            if (editForm.usagePercentOnExit === null || !Number.isFinite(editForm.usagePercentOnExit)) {
                addToast('error', 'Isi persentase pemakaian ban di unit sebelumnya');
                return;
            }
            if (editForm.usagePercentOnExit < 0 || editForm.usagePercentOnExit > remainingPercentBeforeExit) {
                addToast('error', `Persentase pemakaian ban harus 0-${remainingPercentBeforeExit}%`);
                return;
            }
        }
        setSavingEdit(true);
        try {
            const targetVehicle = vehicles.find(item => item._id === editForm.vehicleRef) || null;
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'tire-events',
                    action: 'update',
                    data: {
                        id: tire._id,
                        updates: {
                            tireCode: editForm.tireCode,
                            holderType: editForm.holderType,
                            status: editForm.status,
                            vehicleRef: editForm.holderType === 'INTERNAL_VEHICLE' ? editForm.vehicleRef : '',
                            vehiclePlate: editForm.holderType === 'INTERNAL_VEHICLE' ? targetVehicle?.plateNumber : undefined,
                            slotCode: editForm.holderType === 'INTERNAL_VEHICLE' ? editForm.slotCode : '',
                            slotLabel: editForm.holderType === 'INTERNAL_VEHICLE' && editForm.slotCode ? formatTireSlotLabel(editForm.slotCode) : undefined,
                            linkedWarehouseItemRef: editForm.linkedWarehouseItemRef || '',
                            tireType: editForm.tireType,
                            tireBrand: editForm.tireBrand,
                            tireSize: editForm.tireSize,
                            installDate: editForm.installDate,
                            replaceDate: editForm.replaceDate || undefined,
                            purchaseCost: editForm.originalCost,
                            originalCost: editForm.originalCost,
                            totalUsedPercent: editForm.totalUsedPercent,
                            usagePercentOnExit: requiresUsagePercentOnExit ? editForm.usagePercentOnExit : undefined,
                            accumulatedKm: editForm.accumulatedKm,
                            notes: editForm.notes,
                            externalPartyName: '',
                            externalPlateNumber: '',
                        },
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memperbarui ban');
            }
            const updatedTire = payload.data as TireEvent | undefined;
            if (updatedTire) {
                setTire(updatedTire);
                setVehicle(targetVehicle);
                setWarehouseItem(selectedLinkedWarehouseItem);
            } else {
                const refreshed = await fetchAdminData<TireEvent | null>(`/api/data?entity=tire-events&id=${tire._id}`, 'Gagal memuat ulang ban');
                if (refreshed) {
                    setTire(refreshed);
                    setVehicle(targetVehicle);
                    setWarehouseItem(selectedLinkedWarehouseItem);
                }
            }
            await reloadHistory();
            setShowEditModal(false);
            addToast('success', 'Ban diperbarui');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui ban');
        } finally {
            setSavingEdit(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/tires" />
                    <div>
                        <h1 className="page-title">{resolvedTire.tireCodeLabel}</h1>
                        <div className="text-muted">Detail aset ban dan riwayat pergerakan</div>
                    </div>
                </div>
                <div className="page-actions">
                    <Link className="btn btn-secondary" href="/fleet/tires">
                        <ArrowLeft size={16} /> Daftar Ban
                    </Link>
                    {canManageTires && (
                        <button className="btn btn-primary" type="button" onClick={openEditModal}>
                            <Edit size={16} /> Edit
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><History size={20} /></div><div className="kpi-content"><div className="kpi-label">Km Ban</div><div className="kpi-value">{formatQuantity(tire.accumulatedKm || 0, 0)} km</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Truck size={20} /></div><div className="kpi-content"><div className="kpi-label">Odometer Unit Terakhir</div><div className="kpi-value">{tire.lastOdometerKm ? `${formatQuantity(tire.lastOdometerKm, 0)} km` : '-'}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon primary"><Warehouse size={20} /></div><div className="kpi-content"><div className="kpi-label">Status</div><div className="kpi-value">{statusMeta?.label || resolvedTire.status}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><History size={20} /></div><div className="kpi-content"><div className="kpi-label">Sisa Nilai Ban</div><div className="kpi-value">{formatCurrency(tire.remainingValue ?? 0)}</div></div></div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Profil Ban</span></div>
                    <div className="card-body">
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kode Ban</div><div className="detail-value font-mono">{resolvedTire.tireCodeLabel}</div></div><div className="detail-item"><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${statusMeta?.color || 'gray'}`}>{statusMeta?.label || resolvedTire.status}</span></div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Merk</div><div className="detail-value">{tire.tireBrand}</div></div><div className="detail-item"><div className="detail-label">Ukuran</div><div className="detail-value font-mono">{tire.tireSize}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{resolvedTire.tireType}</div></div><div className="detail-item"><div className="detail-label">Tanggal Catat</div><div className="detail-value">{formatDate(tire.installDate)}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Lokasi Saat Ini</div><div className="detail-value">{placementLabel}</div></div><div className="detail-item"><div className="detail-label">Slot</div><div className="detail-value">{slotLabel}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kilometer Pemakaian</div><div className="detail-value">{formatQuantity(tire.accumulatedKm || 0, 0)} km</div></div><div className="detail-item"><div className="detail-label">Update Km Terakhir</div><div className="detail-value">{formatDateTime(tire.lastKmUpdateAt)}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Harga Ban</div><div className="detail-value">{formatCurrency(tire.originalCost ?? tire.purchaseCost ?? 0)}</div></div><div className="detail-item"><div className="detail-label">Pemakaian / Sisa</div><div className="detail-value">{formatQuantity(tire.totalUsedPercent || 0, 2)}% terpakai | {formatQuantity(tire.remainingPercent ?? Math.max(100 - Number(tire.totalUsedPercent || 0), 0), 2)}% tersisa</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Catatan</div><div className="detail-value">{tire.notes || '-'}</div></div><div className="detail-item"><div className="detail-label">Tanggal Ganti</div><div className="detail-value">{formatDate(tire.replaceDate)}</div></div></div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Relasi</span></div>
                    <div className="card-body">
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{vehicle ? (canOpenVehicles ? <Link href={`/fleet/vehicles/${vehicle._id}`}>{vehicle.plateNumber}</Link> : vehicle.plateNumber) : tire.vehiclePlate || '-'}</div></div><div className="detail-item"><div className="detail-label">Item Gudang</div><div className="detail-value">{warehouseItem ? (canOpenItems ? <Link href={`/inventory/items/${warehouseItem._id}`}>{warehouseItem.itemCode || warehouseItem.name}</Link> : warehouseItem.itemCode || warehouseItem.name) : tire.linkedWarehouseItemCode || tire.linkedWarehouseItemName || '-'}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Sumber Pembelian</div><div className="detail-value">{tire.sourcePurchaseNumber || '-'}</div></div></div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-header"><span className="card-header-title">Riwayat Ban</span></div>
                <div className="card-body">
                    {historyRows.length === 0 ? (
                        <div className="empty-state"><div className="empty-state-title">Belum ada riwayat</div></div>
                    ) : (
                        <div className="table-wrapper">
                            <table>
                                <thead><tr><th>Waktu</th><th>Aksi</th><th>Perubahan</th><th>Odometer</th><th>Biaya Pemakaian</th><th>Catatan</th><th>User</th></tr></thead>
                                <tbody>
                                    {historyRows.map(row => (
                                        <tr key={row._id}>
                                            <td>{formatDateTime(row.timestamp)}</td>
                                            <td><span className={`badge badge-${getTireHistoryActionColor(row.actionType)}`}>{getTireHistoryActionLabel(row.actionType)}</span></td>
                                            <td>{getTireHistoryTransitionLabel(row)}</td>
                                            <td>{typeof row.distanceKm === 'number' ? `${formatQuantity(row.distanceKm, 0)} km` : '-'}</td>
                                            <td>
                                                {typeof row.usageCost === 'number' ? (
                                                    <div style={{ display: 'grid', gap: '0.2rem' }}>
                                                        <div className="font-medium">{formatCurrency(row.usageCost)}</div>
                                                        <div className="text-muted text-sm">{formatQuantity(row.usagePercent || 0, 2)}% dari {row.costSourceVehiclePlate || '-'}</div>
                                                        <div className="text-muted text-sm">Sisa {formatQuantity(row.remainingPercentAfter || 0, 2)}% | {formatCurrency(row.remainingValueAfter || 0)}</div>
                                                    </div>
                                                ) : '-'}
                                            </td>
                                            <td>{row.note || '-'}</td>
                                            <td>{row.actorUserName || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {showEditModal && (
                <div className="modal-overlay" onClick={() => { if (!savingEdit) setShowEditModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Ban</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)} disabled={savingEdit}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Item Gudang Ban</label>
                                    <select
                                        className="form-select"
                                        value={editForm.linkedWarehouseItemRef}
                                        onChange={event => setEditForm(current => ({ ...current, linkedWarehouseItemRef: event.target.value }))}
                                        disabled={savingEdit || linkedWarehouseItemLocked}
                                    >
                                        <option value="">Pilih master barang ban tertracking</option>
                                        {trackedTireItems.map(item => (
                                            <option key={item._id} value={item._id}>
                                                {item.itemCode} - {item.name}
                                            </option>
                                        ))}
                                    </select>
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
                                    <label className="form-label">Lokasi Saat Ini</label>
                                    <select
                                        className="form-select"
                                        value={editForm.holderType}
                                        onChange={event => {
                                            const nextHolderType = event.target.value as TireHolderType;
                                            const nextStatus = nextHolderType === 'WAREHOUSE'
                                                ? 'IN_WAREHOUSE'
                                                : (editForm.status === 'IN_WAREHOUSE' || editForm.status === 'LOANED_OUT' ? 'IN_USE' : editForm.status);
                                            setEditForm(current => ({
                                                ...current,
                                                holderType: nextHolderType,
                                                status: nextStatus,
                                                vehicleRef: nextHolderType === 'INTERNAL_VEHICLE' ? current.vehicleRef : '',
                                                slotCode: nextHolderType === 'INTERNAL_VEHICLE' ? current.slotCode || '1L' : '',
                                            }));
                                        }}
                                        disabled={savingEdit}
                                    >
                                        {BAN_DETAIL_HOLDER_TYPE_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.value === 'WAREHOUSE' ? 'Gudang Ban' : option.value === 'INTERNAL_VEHICLE' ? 'Unit' : option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select
                                        className="form-select"
                                        value={editForm.status}
                                        onChange={event => {
                                            const nextStatus = event.target.value as TireAssetStatus;
                                            setEditForm(current => ({
                                                ...current,
                                                status: nextStatus,
                                                holderType: nextStatus === 'IN_WAREHOUSE'
                                                    ? 'WAREHOUSE'
                                                    : nextStatus === 'SCRAPPED'
                                                        ? 'WAREHOUSE'
                                                        : 'INTERNAL_VEHICLE',
                                                vehicleRef: nextStatus === 'IN_USE' ? current.vehicleRef : '',
                                                slotCode: nextStatus === 'IN_USE' ? current.slotCode || '1L' : '',
                                            }));
                                        }}
                                        disabled={savingEdit}
                                    >
                                        {BAN_DETAIL_STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            {editForm.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Kategori Armada</label>
                                        <select
                                            className="form-select"
                                            value={editForm.vehicleCategory}
                                            onChange={event => {
                                                const nextCategory = event.target.value;
                                                setEditForm(current => {
                                                    const currentVehicle = vehicles.find(item => item._id === current.vehicleRef) || null;
                                                    const shouldResetVehicle = Boolean(nextCategory && currentVehicle && getVehicleCategoryValue(currentVehicle) !== nextCategory);
                                                    return {
                                                        ...current,
                                                        vehicleCategory: nextCategory,
                                                        vehicleRef: shouldResetVehicle ? '' : current.vehicleRef,
                                                        slotCode: shouldResetVehicle ? '' : current.slotCode,
                                                    };
                                                });
                                            }}
                                            disabled={savingEdit}
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
                                            value={editForm.vehicleRef}
                                            onChange={event => {
                                                const nextVehicle = selectableVehicles.find(item => item._id === event.target.value) || null;
                                                setEditForm(current => ({
                                                    ...current,
                                                    vehicleRef: event.target.value,
                                                    vehicleCategory: nextVehicle ? getVehicleCategoryValue(nextVehicle) : current.vehicleCategory,
                                                    slotCode: '',
                                                }));
                                            }}
                                            disabled={savingEdit}
                                        >
                                            <option value="">Pilih kendaraan</option>
                                            {selectableVehicles.map(item => <option key={item._id} value={item._id}>{item.plateNumber} - {item.brandModel}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}
                            {editForm.holderType === 'INTERNAL_VEHICLE' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Slot Ban</label>
                                        <select
                                            className="form-select"
                                            value={editForm.slotCode}
                                            onChange={event => setEditForm(current => ({ ...current, slotCode: event.target.value }))}
                                            disabled={savingEdit || !selectedEditVehicle}
                                        >
                                            {!selectedEditVehicle && <option value="">Pilih kendaraan dulu</option>}
                                            {slotOptions.map(option => (
                                                <option key={option.value} value={option.value} disabled={option.disabled}>
                                                    {option.label}{option.occupiedBy ? ` - terisi ${option.occupiedBy}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Ringkasan Slot</label>
                                        <input className="form-input" value={selectedEditVehicle ? `${selectedEditVehicle.plateNumber} - ${selectedEditVehicle.serviceName || selectedEditVehicle.vehicleType || 'Tanpa kategori'}` : 'Pilih kendaraan'} readOnly />
                                    </div>
                                </div>
                            )}
                            {requiresUsagePercentOnExit && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Pemakaian di Unit Sebelumnya</label>
                                        <FormattedNumberInput
                                            allowDecimal
                                            maxFractionDigits={2}
                                            value={editForm.usagePercentOnExit}
                                            onValueChange={value => setEditForm(current => ({ ...current, usagePercentOnExit: value }))}
                                            placeholder={`Maks ${formatQuantity(remainingPercentBeforeExit, 2)}%`}
                                            disabled={savingEdit}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Biaya Pemakaian</label>
                                        <input className="form-input" value={`${formatQuantity(usagePercentPreview, 2)}% = ${formatCurrency(usageCostPreview)}`} readOnly />
                                    </div>
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Ban</label>
                                    <input className="form-input" value={editForm.tireCode} onChange={event => setEditForm(current => ({ ...current, tireCode: event.target.value.toUpperCase() }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jenis Ban</label>
                                    <select className="form-select" value={editForm.tireType} onChange={event => setEditForm(current => ({ ...current, tireType: event.target.value as TireEvent['tireType'] }))} disabled={savingEdit}>
                                        {TIRE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Merk / Model</label>
                                    <input className="form-input" value={editForm.tireBrand} onChange={event => setEditForm(current => ({ ...current, tireBrand: event.target.value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Ukuran</label>
                                    <input className="form-input" value={editForm.tireSize} onChange={event => setEditForm(current => ({ ...current, tireSize: event.target.value }))} disabled={savingEdit} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Catat</label>
                                    <input type="date" className="form-input" value={editForm.installDate} onChange={event => setEditForm(current => ({ ...current, installDate: event.target.value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Ganti</label>
                                    <input type="date" className="form-input" value={editForm.replaceDate} onChange={event => setEditForm(current => ({ ...current, replaceDate: event.target.value }))} disabled={savingEdit} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Harga Ban / Original Cost</label>
                                    <FormattedNumberInput allowDecimal={false} value={editForm.originalCost} onValueChange={value => setEditForm(current => ({ ...current, originalCost: value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Total Pemakaian (%)</label>
                                    <FormattedNumberInput allowDecimal maxFractionDigits={2} value={editForm.totalUsedPercent} onValueChange={value => setEditForm(current => ({ ...current, totalUsedPercent: Math.min(Math.max(value, 0), 100) }))} disabled={savingEdit || requiresUsagePercentOnExit} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Sisa Persentase</label>
                                    <input className="form-input" value={`${formatQuantity(editRemainingPercent, 2)}%`} readOnly />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Sisa Nilai Saat Ini</label>
                                    <input className="form-input" value={formatCurrency(editRemainingValue)} readOnly />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kilometer Pemakaian</label>
                                    <FormattedNumberInput allowDecimal={false} value={editForm.accumulatedKm} onValueChange={value => setEditForm(current => ({ ...current, accumulatedKm: value }))} disabled={savingEdit} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={editForm.notes} onChange={event => setEditForm(current => ({ ...current, notes: event.target.value }))} disabled={savingEdit} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={savingEdit}>Batal</button>
                            <button className="btn btn-primary" onClick={() => void saveEdit()} disabled={savingEdit}>{savingEdit ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

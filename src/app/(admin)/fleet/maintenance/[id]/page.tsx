'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApp } from '../../../layout';
import { ArrowLeft, Calendar, Gauge, Tag, Wrench } from 'lucide-react';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, isNotFoundMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import {
    getMaintenanceMaterialPreview,
    getMaintenanceRecordedCost,
    isWarehouseStockMaintenanceMaterialUsage,
} from '@/lib/maintenance';
import { getMaintenanceNextAction } from '@/lib/fleet-queue-page-support';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import type { BankAccount, Maintenance, Vehicle } from '@/lib/types';
import { formatCurrency, formatDate, formatQuantity, MAINTENANCE_STATUS_MAP } from '@/lib/utils';

export default function MaintenanceDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const maintenanceId = params.id as string;
    const [maintenance, setMaintenance] = useState<Maintenance | null>(null);
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [laborBankAccount, setLaborBankAccount] = useState<BankAccount | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);

    const canViewMaintenanceCost = user ? hasPermission(user, 'expenses', 'view') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user, 'vehicles') : false;
    const canOpenWarehouseItems = user ? hasPageAccess(user, 'warehouseItems') : false;
    const canOpenIncidentPage = user ? hasPageAccess(user, 'incidents') : false;
    const canOpenExpensesPage = user ? hasPageAccess(user, 'expenses') : false;
    const canOpenDeliveryOrdersPage = user ? hasPageAccess(user, 'trips') : false;
    const canOpenBankAccountPage = user ? hasPageAccess(user, 'bankAccounts') : false;

    useEffect(() => {
        const loadMaintenance = async () => {
            setLoading(true);
            setLoadNotice(null);
            try {
                const item = await fetchAdminData<Maintenance | null>(`/api/data?entity=maintenances&id=${maintenanceId}`, 'Gagal memuat data maintenance');
                if (!item) {
                    setMaintenance(null);
                    setLoadNotice({
                        title: 'Maintenance tidak ditemukan',
                        text: 'Data maintenance tidak tersedia atau hak akses Anda dibatasi.',
                    });
                    return;
                }
                const [vehicleRows, accountRows] = await Promise.all([
                    item.vehicleRef
                        ? fetchAdminData<Vehicle[]>(`/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ _id: [item.vehicleRef] }))}`, 'Gagal memuat data kendaraan').catch(() => [] as Vehicle[])
                        : Promise.resolve([] as Vehicle[]),
                    item.laborBankAccountRef
                        ? fetchAdminData<BankAccount[]>(`/api/data?entity=bank-accounts&filter=${encodeURIComponent(JSON.stringify({ _id: [item.laborBankAccountRef] }))}`, 'Gagal memuat data rekening').catch(() => [] as BankAccount[])
                        : Promise.resolve([] as BankAccount[]),
                ]);
                setMaintenance(item);
                setVehicle(vehicleRows?.[0] || null);
                setLaborBankAccount(accountRows?.[0] || null);
            } catch (error) {
                const message = getAdminErrorMessage(error, 'Gagal memuat data maintenance');
                setMaintenance(null);
                setLoadNotice(isNotFoundMessage(message)
                    ? { title: 'Maintenance tidak ditemukan', text: 'Data maintenance tidak tersedia atau hak akses Anda dibatasi.' }
                    : buildAdminLoadNotice(message, 'maintenance', 'Hubungi pemilik usaha untuk mendapatkan akses maintenance.'));
            } finally {
                setLoading(false);
            }
        };
        void loadMaintenance();
    }, [maintenanceId]);

    const materialUsages = useMemo(() => {
        if (!maintenance || maintenance.status !== 'DONE') return [];
        return getMaintenanceMaterialPreview(maintenance, 100);
    }, [maintenance]);

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    }

    if (!maintenance) {
        return (
            <div className="empty-state">
                <div className="empty-state-title">{loadNotice?.title || 'Maintenance tidak ditemukan'}</div>
                {loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}
                <Link className="btn btn-secondary" href="/fleet/maintenance" style={{ marginTop: 'var(--space-4)' }}>
                    <ArrowLeft size={16} /> Kembali ke Maintenance
                </Link>
            </div>
        );
    }

    const statusMeta = MAINTENANCE_STATUS_MAP[maintenance.status];
    const scheduleLabel = maintenance.scheduleType === 'DATE'
        ? (maintenance.plannedDate ? formatDate(maintenance.plannedDate) : '-')
        : (maintenance.plannedOdometer ? `${formatQuantity(maintenance.plannedOdometer, 0)} km` : '-');
    const laborAccountLabel = laborBankAccount
        ? `${laborBankAccount.bankName} - ${laborBankAccount.accountNumber}${laborBankAccount.accountType === 'CASH' ? ' (Kas Tunai)' : ''}`
        : [maintenance.laborBankAccountName, maintenance.laborBankAccountNumber].filter(Boolean).join(' - ');
    const recordedCost = getMaintenanceRecordedCost(maintenance);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/maintenance" />
                    <div>
                        <h1 className="page-title">Detail Maintenance</h1>
                        <div className="text-muted">{maintenance.type}</div>
                    </div>
                </div>
                <div className="page-actions">
                    <Link className="btn btn-secondary" href="/fleet/maintenance">
                        <ArrowLeft size={16} /> Daftar Maintenance
                    </Link>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon primary"><Wrench size={20} /></div>
                    <div className="kpi-content"><div className="kpi-label">Status</div><div className="kpi-value"><span className={`badge badge-${statusMeta?.color || 'gray'}`}><span className="badge-dot" /> {statusMeta?.label || maintenance.status}</span></div></div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Calendar size={20} /></div>
                    <div className="kpi-content"><div className="kpi-label">Jadwal</div><div className="kpi-value">{scheduleLabel}</div></div>
                </div>
                {canViewMaintenanceCost && recordedCost > 0 && (
                    <div className="kpi-card">
                        <div className="kpi-icon danger"><Tag size={20} /></div>
                        <div className="kpi-content"><div className="kpi-label">Biaya Internal</div><div className="kpi-value">{formatCurrency(recordedCost)}</div></div>
                    </div>
                )}
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Gauge size={20} /></div>
                    <div className="kpi-content"><div className="kpi-label">Odometer Servis</div><div className="kpi-value">{maintenance.odometerAtService ? `${formatQuantity(maintenance.odometerAtService, 0)} km` : (maintenance.triggerOdometer ? `${formatQuantity(maintenance.triggerOdometer, 0)} km` : '-')}</div></div>
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Profil Maintenance</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{vehicle ? (canOpenVehiclePage ? <Link href={`/fleet/vehicles/${vehicle._id}?tab=maintenance`}>{vehicle.plateNumber}</Link> : vehicle.plateNumber) : (maintenance.vehiclePlate || maintenance.vehicleRef)}</div></div>
                            <div className="detail-item"><div className="detail-label">Jenis</div><div className="detail-value">{maintenance.type}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Status</div><div className="detail-value"><span className={`badge badge-${statusMeta?.color || 'gray'}`}><span className="badge-dot" /> {statusMeta?.label || maintenance.status}</span></div></div>
                            <div className="detail-item"><div className="detail-label">Tindak Lanjut</div><div className="detail-value">{getMaintenanceNextAction(maintenance)}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Jadwal Berdasarkan</div><div className="detail-value">{scheduleLabel}</div></div>
                            <div className="detail-item"><div className="detail-label">Sumber</div><div className="detail-value">{maintenance.source || 'MANUAL'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Bengkel / Vendor</div><div className="detail-value">{maintenance.vendor || '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Tanggal Selesai</div><div className="detail-value">{maintenance.completedDate ? formatDate(maintenance.completedDate) : '-'}</div></div>
                        </div>
                        {maintenance.notes && (
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Catatan Jadwal</div><div className="detail-value">{maintenance.notes}</div></div>
                                <div className="detail-item" />
                            </div>
                        )}
                        {maintenance.completionNotes && (
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Catatan Penyelesaian</div><div className="detail-value">{maintenance.completionNotes}</div></div>
                                <div className="detail-item" />
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Dokumen Terkait</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Insiden</div><div className="detail-value">{maintenance.relatedIncidentRef ? (canOpenIncidentPage ? <Link href={`/fleet/incidents/${maintenance.relatedIncidentRef}`}>{maintenance.relatedIncidentNumber || maintenance.relatedIncidentRef}</Link> : (maintenance.relatedIncidentNumber || maintenance.relatedIncidentRef)) : '-'}</div></div>
                            <div className="detail-item"><div className="detail-label">Pengeluaran</div><div className="detail-value">{maintenance.relatedExpenseRef ? (canOpenExpensesPage ? <Link href={`/expenses/${maintenance.relatedExpenseRef}`}>{maintenance.relatedExpenseRef}</Link> : maintenance.relatedExpenseRef) : (maintenance.relatedIncidentExpenseRef ? (canOpenExpensesPage ? <Link href={`/expenses/${maintenance.relatedIncidentExpenseRef}`}>{maintenance.relatedIncidentExpenseRef}</Link> : maintenance.relatedIncidentExpenseRef) : '-')}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Delivery Order</div><div className="detail-value">{maintenance.relatedDeliveryOrderRef ? (canOpenDeliveryOrdersPage ? <Link href={`/delivery-orders/${maintenance.relatedDeliveryOrderRef}`}>{maintenance.relatedDeliveryOrderRef}</Link> : maintenance.relatedDeliveryOrderRef) : '-'}</div></div>
                            <div className="detail-item" />
                        </div>
                        {maintenance.laborExpenseRef && (
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Pengeluaran Jasa</div><div className="detail-value">{canOpenExpensesPage ? <Link href={`/expenses/${maintenance.laborExpenseRef}`}>{maintenance.laborExpenseRef}</Link> : maintenance.laborExpenseRef}</div></div>
                                <div className="detail-item" />
                            </div>
                        )}
                    </div>
                </div>

                {canViewMaintenanceCost && (
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Biaya</span></div>
                        <div className="card-body">
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Material</div><div className="detail-value">{formatCurrency(maintenance.materialCostTotal || 0)}</div></div>
                                <div className="detail-item"><div className="detail-label">Jasa</div><div className="detail-value">{formatCurrency(maintenance.laborCost || 0)}</div></div>
                            </div>
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Total Biaya</div><div className="detail-value">{formatCurrency(recordedCost)}</div></div>
                                {laborAccountLabel ? (
                                    <div className="detail-item"><div className="detail-label">Sumber Dana Jasa</div><div className="detail-value">{canOpenBankAccountPage && maintenance.laborBankAccountRef ? <Link href={`/bank-accounts/${maintenance.laborBankAccountRef}`}>{laborAccountLabel}</Link> : laborAccountLabel}</div></div>
                                ) : (
                                    <div className="detail-item" />
                                )}
                            </div>
                            {maintenance.inventoryReceiptCostTotal ? (
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Biaya Material (Penerimaan)</div><div className="detail-value">{formatCurrency(maintenance.inventoryReceiptCostTotal)}</div></div>
                                    <div className="detail-item" />
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            {maintenance.status === 'DONE' && (
                <div className="card" style={{ marginTop: '1.5rem' }}>
                    <div className="card-header"><span className="card-header-title">Material Gudang Terpakai</span></div>
                    <div className="card-body">
                        {materialUsages.length === 0 && <div className="text-muted">Tanpa material gudang.</div>}
                        {materialUsages.length > 0 && (
                            <div className="table-wrapper">
                                <table className="table">
                                    <thead><tr><th>Material</th><th>Qty</th><th>Satuan</th>{canViewMaintenanceCost && <th>Biaya</th>}<th>Status</th></tr></thead>
                                    <tbody>
                                        {materialUsages.map((usage, index) => {
                                            const cost = typeof usage.subtotalCost === 'number' && usage.subtotalCost > 0 ? usage.subtotalCost : null;
                                            const isWarehouse = isWarehouseStockMaintenanceMaterialUsage(usage);
                                            return (
                                                <tr key={`${usage.warehouseItemRef}-${index}`}>
                                                    <td className="font-medium" style={{ wordBreak: 'break-word' }}>
                                                        {isWarehouse && canOpenWarehouseItems && usage.warehouseItemRef ? <Link href={`/inventory/items/${usage.warehouseItemRef}`}>{usage.displayLabel}</Link> : usage.displayLabel}
                                                    </td>
                                                    <td>{formatQuantity(usage.quantity, 3)}</td>
                                                    <td>{usage.unit}</td>
                                                    {canViewMaintenanceCost && <td>{cost !== null ? formatCurrency(cost) : '-'}</td>}
                                                    <td>{usage.attachedToVehicle || usage.attachmentStatus === 'INSTALLED' ? 'Terpasang di unit' : (usage.costAlreadyPosted ? 'Biaya insiden' : '')}</td>
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
    );
}
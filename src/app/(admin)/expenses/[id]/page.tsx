'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApp } from '../../layout';
import { ArrowLeft, Calendar, Tag, Wallet } from 'lucide-react';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, isNotFoundMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { hasPageAccess } from '@/lib/rbac';
import type { BankAccount, DriverBorongan, DriverVoucher, Expense, Incident, Maintenance, Vehicle } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
    fetchExpenseReferences,
    fetchOptionalCollection,
    getExpenseAccountLabel,
    getExpenseDescriptionLabel,
    getExpenseRelatedDocuments,
    getExpenseVehicleLabel,
    mapById,
    type ExpenseLinkPermissions,
    type ExpenseReferenceMaps,
} from '@/lib/expense-related-docs';

export default function ExpenseDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const expenseId = params.id as string;
    const [expense, setExpense] = useState<Expense | null>(null);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [driverVouchers, setDriverVouchers] = useState<DriverVoucher[]>([]);
    const [driverBorongans, setDriverBorongans] = useState<DriverBorongan[]>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);

    const canOpenVehiclePage = user ? hasPageAccess(user, 'vehicles') : false;
    const canOpenBankAccountPage = user ? hasPageAccess(user, 'bankAccounts') : false;
    const canOpenOrderPage = user ? hasPageAccess(user, 'orders') : false;
    const canOpenDriverVoucherPage = user ? hasPageAccess(user, 'driverVouchers') : false;
    const canOpenDriverBoronganPage = user ? hasPageAccess(user, 'driverBorongans') : false;
    const canOpenIncidentPage = user ? hasPageAccess(user, 'incidents') : false;
    const canOpenMaintenancePage = user ? hasPageAccess(user, 'maintenance') : false;

    const vehicleMap = useMemo(() => mapById(vehicles), [vehicles]);
    const accountMap = useMemo(() => mapById(bankAccounts), [bankAccounts]);
    const voucherMap = useMemo(() => mapById(driverVouchers), [driverVouchers]);
    const boronganMap = useMemo(() => mapById(driverBorongans), [driverBorongans]);
    const incidentMap = useMemo(() => mapById(incidents), [incidents]);
    const maintenanceMap = useMemo(() => mapById(maintenances), [maintenances]);
    const referenceMaps = useMemo<ExpenseReferenceMaps>(() => ({
        accountMap,
        boronganMap,
        incidentMap,
        maintenanceMap,
        vehicleMap,
        voucherMap,
    }), [accountMap, boronganMap, incidentMap, maintenanceMap, vehicleMap, voucherMap]);
    const linkPermissions = useMemo<ExpenseLinkPermissions>(() => ({
        canOpenBankAccountPage,
        canOpenDriverBoronganPage,
        canOpenDriverVoucherPage,
        canOpenIncidentPage,
        canOpenMaintenancePage,
        canOpenVehiclePage,
    }), [canOpenBankAccountPage, canOpenDriverBoronganPage, canOpenDriverVoucherPage, canOpenIncidentPage, canOpenMaintenancePage, canOpenVehiclePage]);

    useEffect(() => {
        const loadExpense = async () => {
            setLoading(true);
            setLoadNotice(null);
            try {
                const item = await fetchAdminData<Expense | null>(`/api/data?entity=expenses&id=${expenseId}`, 'Gagal memuat data pengeluaran');
                if (!item) {
                    setExpense(null);
                    setLoadNotice({
                        title: 'Pengeluaran tidak ditemukan',
                        text: 'Data pengeluaran tidak tersedia atau hak akses Anda dibatasi.',
                    });
                    return;
                }
                const referenceRows = await fetchExpenseReferences([item]);
                const [vehicleRows, accountRows] = await Promise.all([
                    item.relatedVehicleRef
                        ? fetchOptionalCollection<Vehicle[]>(`/api/data?entity=vehicles&filter=${encodeURIComponent(JSON.stringify({ _id: [item.relatedVehicleRef] }))}`, [])
                        : Promise.resolve([] as Vehicle[]),
                    item.bankAccountRef
                        ? fetchOptionalCollection<BankAccount[]>(`/api/data?entity=bank-accounts&filter=${encodeURIComponent(JSON.stringify({ _id: [item.bankAccountRef] }))}`, [])
                        : Promise.resolve([] as BankAccount[]),
                ]);
                setExpense(item);
                setVehicles(vehicleRows || []);
                setBankAccounts(accountRows || []);
                setDriverVouchers(referenceRows.voucherRows);
                setDriverBorongans(referenceRows.boronganRows);
                setIncidents(referenceRows.incidentRows);
                setMaintenances(referenceRows.maintenanceRows);
            } catch (error) {
                const message = getAdminErrorMessage(error, 'Gagal memuat data pengeluaran');
                setExpense(null);
                setLoadNotice(isNotFoundMessage(message)
                    ? { title: 'Pengeluaran tidak ditemukan', text: 'Data pengeluaran tidak tersedia atau hak akses Anda dibatasi.' }
                    : buildAdminLoadNotice(message, 'pengeluaran', 'Hubungi pemilik usaha untuk mendapatkan akses pengeluaran.'));
            } finally {
                setLoading(false);
            }
        };
        void loadExpense();
    }, [expenseId]);

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    }

    if (!expense) {
        return (
            <div className="empty-state">
                <div className="empty-state-title">{loadNotice?.title || 'Pengeluaran tidak ditemukan'}</div>
                {loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}
                {(
                    <Link className="btn btn-secondary" href="/expenses" style={{ marginTop: 'var(--space-4)' }}>
                        <ArrowLeft size={16} /> Kembali ke Pengeluaran
                    </Link>
                )}
            </div>
        );
    }

    const vehicleLabel = getExpenseVehicleLabel(expense, vehicleMap);
    const accountLabel = getExpenseAccountLabel(expense, accountMap);
    const relatedDocuments = getExpenseRelatedDocuments(expense, referenceMaps, linkPermissions);
    const descriptionLabel = getExpenseDescriptionLabel(expense);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/expenses" />
                    <div>
                        <h1 className="page-title">Detail Pengeluaran</h1>
                        <div className="text-muted">Ringkasan transaksi pengeluaran</div>
                    </div>
                </div>
                <div className="page-actions">
                    <Link className="btn btn-secondary" href="/expenses">
                        <ArrowLeft size={16} /> Daftar Pengeluaran
                    </Link>
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Wallet size={20} /></div>
                    <div className="kpi-content"><div className="kpi-label">Jumlah Pengeluaran</div><div className="kpi-value">{formatCurrency(expense.amount || 0)}</div></div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Calendar size={20} /></div>
                    <div className="kpi-content"><div className="kpi-label">Tanggal</div><div className="kpi-value">{formatDate(expense.date)}</div></div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon primary"><Tag size={20} /></div>
                    <div className="kpi-content"><div className="kpi-label">Kategori</div><div className="kpi-value">{expense.categoryName || expense.categoryRef || '-'}</div></div>
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Keterangan Pengeluaran</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Deskripsi</div><div className="detail-value">{descriptionLabel}</div></div>
                            <div className="detail-item"><div className="detail-label">Kategori</div><div className="detail-value">{expense.categoryName || expense.categoryRef || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Tanggal</div><div className="detail-value">{formatDate(expense.date)}</div></div>
                            <div className="detail-item"><div className="detail-label">Jumlah</div><div className="detail-value">{formatCurrency(expense.amount || 0)}</div></div>
                        </div>
                        {expense.privacyLevel && (
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Privasi</div><div className="detail-value"><span className={`badge badge-${expense.privacyLevel === 'ownerOnly' ? 'danger' : 'gray'}`}>{expense.privacyLevel === 'ownerOnly' ? 'Internal Owner' : 'Internal'}</span></div></div>
                                <div className="detail-item" />
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Pembayaran</span></div>
                    <div className="card-body">
                        <div className="detail-row">
                            {accountLabel ? (
                                <div className="detail-item"><div className="detail-label">Sumber Dana</div><div className="detail-value">{canOpenBankAccountPage && expense.bankAccountRef ? <Link href={`/bank-accounts/${expense.bankAccountRef}`}>{accountLabel}</Link> : accountLabel}</div></div>
                            ) : (
                                <div className="detail-item"><div className="detail-label">Sumber Dana</div><div className="detail-value">-</div></div>
                            )}
                            <div className="detail-item"><div className="detail-label">Order</div><div className="detail-value">{canOpenOrderPage && expense.relatedOrderRef ? <Link href={`/orders/${expense.relatedOrderRef}`}>{expense.relatedOrderNumber || '-'}</Link> : (expense.relatedOrderNumber || '-')}</div></div>
                        </div>
                        {expense.bankAccountRef && !accountLabel && (
                            <div className="detail-row"><div className="detail-item"><div className="detail-label">Referensi Rekening</div><div className="detail-value">{canOpenBankAccountPage ? <Link href={`/bank-accounts/${expense.bankAccountRef}`}>{expense.bankAccountRef}</Link> : expense.bankAccountRef}</div></div><div className="detail-item" /></div>
                        )}
                        {expense.receiptUrl && (
                            <div className="detail-row">
                                <div className="detail-item"><div className="detail-label">Bukti Pembayaran</div><div className="detail-value"><Link className="btn btn-secondary" href={expense.receiptUrl} target="_blank" rel="noreferrer">Lihat Bukti</Link></div></div>
                                <div className="detail-item" />
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Dokumen Terkait</span></div>
                    <div className="card-body">
                        {relatedDocuments.length === 0 && <div className="text-muted">Tidak ada dokumen terkait.</div>}
                        {relatedDocuments.length > 0 && (
                            <div className="table-wrapper">
                                <table className="table">
                                    <thead><tr><th>Jenis</th><th>Referensi</th></tr></thead>
                                    <tbody>
                                        {relatedDocuments.map(doc => (
                                            <tr key={doc.key}>
                                                <td>{doc.kind}</td>
                                                <td>{doc.href ? <Link href={doc.href}>{doc.label}</Link> : doc.label}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {vehicleLabel && (
                            <div className="detail-row" style={{ marginTop: 'var(--space-4)' }}>
                                <div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value">{canOpenVehiclePage && expense.relatedVehicleRef ? <Link href={`/fleet/vehicles/${expense.relatedVehicleRef}`}>{vehicleLabel}</Link> : vehicleLabel}</div></div>
                                <div className="detail-item"><div className="detail-label">Delivery Order</div><div className="detail-value">{expense.relatedDeliveryOrderNumber || '-'}</div></div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
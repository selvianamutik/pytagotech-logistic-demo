'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Building2, Edit, FileDown, Plus, RefreshCw, Save, Search, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { exportToExcel } from '@/lib/export';
import { getMasterDataImportExportColumns } from '@/lib/master-data-import-config';
import { getMonthPrefix } from '@/lib/inventory-material-usage';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPermission } from '@/lib/rbac';
import { buildSupplierOwnerSummaryMap } from '@/lib/supplier-purchase-support';
import type { Purchase, Supplier } from '@/lib/types';
import { formatCurrency, formatDate, formatSupplierTerm } from '@/lib/utils';

import { useApp, useToast } from '../layout';

type SupplierFormState = {
    supplierCode: string;
    name: string;
    contactPerson: string;
    phone: string;
    address: string;
    defaultTermDays: number;
    notes: string;
    active: boolean;
};

const createDefaultForm = (supplier?: Partial<Supplier>): SupplierFormState => ({
    supplierCode: supplier?.supplierCode || '',
    name: supplier?.name || '',
    contactPerson: supplier?.contactPerson || '',
    phone: supplier?.phone || '',
    address: supplier?.address || '',
    defaultTermDays: typeof supplier?.defaultTermDays === 'number' ? supplier.defaultTermDays : 14,
    notes: supplier?.notes || '',
    active: supplier?.active !== false,
});

export default function SuppliersPage() {
    const searchParams = useSearchParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState(searchParams.get('q') || '');
    const [page, setPage] = useState(1);
    const [filteredTotal, setFilteredTotal] = useState(0);
    const [totalSuppliers, setTotalSuppliers] = useState(0);
    const [inactiveSuppliers, setInactiveSuppliers] = useState(0);
    const [allPurchases, setAllPurchases] = useState<Purchase[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
    const [saving, setSaving] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [form, setForm] = useState<SupplierFormState>(createDefaultForm());

    const canManage = user ? hasPermission(user, 'suppliers', 'create') || hasPermission(user, 'suppliers', 'update') : false;
    const canExportSuppliers = user ? hasPermission(user, 'suppliers', 'export') : false;
    const activeSuppliers = totalSuppliers - inactiveSuppliers;
    const today = getBusinessDateValue();
    const currentMonthPrefix = getMonthPrefix(today);

    const buildQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'suppliers',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'supplierCode',
            sortDir: 'asc',
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'supplierCode,name,contactPerson,phone,address,notes');
        }
        return params.toString();
    }, [page, search]);

    const loadSuppliers = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, totalRes, inactiveRes, purchaseRows] = await Promise.all([
                fetch(`/api/data?${buildQuery()}`),
                fetch('/api/data?entity=suppliers&countOnly=1'),
                fetch(`/api/data?entity=suppliers&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ active: false }))}`),
                fetchAllAdminCollectionData<Purchase>('/api/data?entity=purchases&pageSize=200&sortField=orderDate&sortDir=desc', 'Gagal memuat pembelian supplier', 200),
            ]);
            const [listPayload, totalPayload, inactivePayload] = await Promise.all([
                listRes.json(),
                totalRes.json(),
                inactiveRes.json(),
            ]);
            if (!listRes.ok) throw new Error(listPayload.error || 'Gagal memuat supplier');
            if (!totalRes.ok) throw new Error(totalPayload.error || 'Gagal memuat total supplier');
            if (!inactiveRes.ok) throw new Error(inactivePayload.error || 'Gagal memuat supplier nonaktif');
            setSuppliers((listPayload.data || []) as Supplier[]);
            setFilteredTotal(listPayload.meta?.total || 0);
            setTotalSuppliers(totalPayload.meta?.total || 0);
            setInactiveSuppliers(inactivePayload.meta?.total || 0);
            setAllPurchases(purchaseRows || []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat supplier');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildQuery]);

    const supplierSummaryMap = useMemo(
        () => buildSupplierOwnerSummaryMap(allPurchases, today),
        [allPurchases, today],
    );
    const suppliersWithOutstanding = useMemo(
        () => Object.values(supplierSummaryMap).filter((summary) => summary.outstandingAmount > 0).length,
        [supplierSummaryMap],
    );
    const supplierOutstandingTotal = useMemo(
        () => Object.values(supplierSummaryMap).reduce((sum, summary) => sum + summary.outstandingAmount, 0),
        [supplierSummaryMap],
    );
    const purchasesThisMonth = useMemo(
        () => allPurchases.filter((purchase) => String(purchase.orderDate || '').startsWith(currentMonthPrefix)),
        [allPurchases, currentMonthPrefix],
    );
    const purchaseAmountThisMonth = useMemo(
        () => purchasesThisMonth.reduce((sum, purchase) => sum + Number(purchase.totalAmount || 0), 0),
        [purchasesThisMonth],
    );

    useEffect(() => {
        void loadSuppliers();
    }, [loadSuppliers]);

    const handleExport = async () => {
        if (!canExportSuppliers) return;
        try {
            const rows = await fetchAllAdminCollectionData<Supplier>(
                `/api/data?${buildQuery(1, 500)}`,
                'Gagal memuat supplier untuk export',
                500,
            );
            await exportToExcel(
                rows.map((supplier) => ({
                    supplierCode: supplier.supplierCode,
                    name: supplier.name,
                    contactPerson: supplier.contactPerson || '',
                    phone: supplier.phone || '',
                    address: supplier.address || '',
                    defaultTermDays: supplier.defaultTermDays,
                    notes: supplier.notes || '',
                    active: supplier.active !== false ? 'Aktif' : 'Nonaktif',
                })),
                getMasterDataImportExportColumns('suppliers').map((column, index) => ({
                    ...column,
                    width: [16, 30, 22, 18, 35, 14, 28, 12][index] || 18,
                })),
                `supplier-${new Date().toISOString().slice(0, 10)}`,
                'Supplier',
                {
                    title: 'Daftar Supplier',
                    subtitle: search.trim() ? `Hasil pencarian: ${search.trim()}` : 'Semua supplier',
                },
            );
            addToast('success', 'Excel supplier berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel supplier');
        }
    };

    useEffect(() => {
        setPage(1);
    }, [search]);

    useEffect(() => {
        const nextSearch = searchParams.get('q') || '';
        setSearch(current => current === nextSearch ? current : nextSearch);
    }, [searchParams]);

    const closeModal = () => {
        if (saving) return;
        setShowModal(false);
        setEditSupplier(null);
        setForm(createDefaultForm());
    };

    const openCreate = () => {
        setEditSupplier(null);
        setForm(createDefaultForm());
        setShowModal(true);
    };

    const openEdit = (supplier: Supplier) => {
        setEditSupplier(supplier);
        setForm(createDefaultForm(supplier));
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!canManage) {
            addToast('error', 'Anda tidak punya hak mengubah supplier');
            return;
        }
        if (!form.supplierCode || !form.name) {
            addToast('error', 'Kode dan nama supplier wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                supplierCode: form.supplierCode,
                name: form.name,
                contactPerson: form.contactPerson,
                phone: form.phone,
                address: form.address,
                defaultTermDays: form.defaultTermDays,
                notes: form.notes,
                active: form.active,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editSupplier
                        ? { entity: 'suppliers', action: 'update', data: { id: editSupplier._id, updates: payload } }
                        : { entity: 'suppliers', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Gagal menyimpan supplier');
            addToast('success', editSupplier ? 'Supplier diperbarui' : 'Supplier ditambahkan');
            setShowModal(false);
            setEditSupplier(null);
            setForm(createDefaultForm());
            if (!editSupplier && page !== 1) {
                setPage(1);
            } else {
                await loadSuppliers();
            }
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan supplier');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (supplier: Supplier) => {
        if (!canManage) {
            addToast('error', 'Anda tidak punya hak mengubah status supplier');
            return;
        }
        setTogglingId(supplier._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'suppliers',
                    action: 'update',
                    data: {
                        id: supplier._id,
                        updates: { active: supplier.active === false },
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Gagal memperbarui status supplier');
            addToast('success', supplier.active === false ? 'Supplier diaktifkan' : 'Supplier dinonaktifkan');
            await loadSuppliers();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui status supplier');
        } finally {
            setTogglingId((current) => current === supplier._id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Supplier</h1>
                </div>
                <div className="page-actions">
                    {canExportSuppliers && <button className="btn btn-secondary" onClick={() => void handleExport()}><FileDown size={18} /> Excel</button>}
                    {canManage && (
                        <button className="btn btn-primary" onClick={openCreate}>
                            <Plus size={18} /> Tambah Supplier
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid employees-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Supplier Aktif</div>
                        <div className="kpi-value">{activeSuppliers}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Supplier Ada Tagihan</div>
                        <div className="kpi-value">{suppliersWithOutstanding}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Sisa Tagihan Supplier</div>
                        <div className="kpi-value">{formatCurrency(supplierOutstandingTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Pembelian Bulan Ini</div>
                        <div className="kpi-value">{formatCurrency(purchaseAmountThisMonth)}</div>
                        <div className="kpi-sub">{purchasesThisMonth.length} dokumen pembelian</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                placeholder="Cari kode, nama, PIC, telepon..."
                                value={search}
                                onChange={event => setSearch(event.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Kode</th>
                                <th>Nama Supplier</th>
                                <th>PIC</th>
                                <th>Termin</th>
                                <th>Sisa Tagihan</th>
                                <th>Pembelian Terakhir</th>
                                <th>Status</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(index => (
                                <tr key={index}>
                                    {[1, 2, 3, 4, 5, 6, 7, 8].map(cell => (
                                        <td key={cell}><div className="skeleton skeleton-text" /></td>
                                    ))}
                                </tr>
                            )) : filteredTotal === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <Building2 size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada master supplier</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : suppliers.map(supplier => {
                                const summary = supplierSummaryMap[supplier._id];
                                return (
                                <tr key={supplier._id}>
                                    <td className="font-mono">{supplier.supplierCode}</td>
                                    <td>
                                        <div className="font-semibold">
                                            <Link href={`/suppliers/${supplier._id}`} style={{ color: 'var(--color-primary)' }}>
                                                {supplier.name}
                                            </Link>
                                        </div>
                                        <div className="text-muted text-xs">{supplier.address || 'Tanpa alamat'}</div>
                                    </td>
                                    <td>
                                        <div>{supplier.contactPerson || '-'}</div>
                                        <div className="text-muted text-xs">{supplier.phone || 'Tanpa telepon'}</div>
                                    </td>
                                    <td>{formatSupplierTerm(supplier.defaultTermDays)}</td>
                                    <td>
                                        <div>{formatCurrency(summary?.outstandingAmount || 0)}</div>
                                        <div className="text-muted text-xs">
                                            {summary?.purchaseCount ? `${summary.purchaseCount} pembelian` : 'Belum ada pembelian'}
                                        </div>
                                    </td>
                                    <td>{summary?.lastPurchaseDate ? formatDate(summary.lastPurchaseDate) : '-'}</td>
                                    <td>
                                        <span className={`badge ${supplier.active !== false ? 'badge-success' : 'badge-gray'}`}>
                                            {supplier.active !== false ? 'Aktif' : 'Nonaktif'}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="table-actions">
                                            {canManage ? (
                                                <>
                                                    <Link href={`/suppliers/${supplier._id}`} className="table-action-btn">
                                                        Lihat Detail
                                                    </Link>
                                                    <button className="table-action-btn" onClick={() => openEdit(supplier)}>
                                                        <Edit size={14} /> Edit
                                                    </button>
                                                    <button
                                                        className="table-action-btn"
                                                        onClick={() => toggleActive(supplier)}
                                                        disabled={togglingId === supplier._id}
                                                    >
                                                        <RefreshCw size={14} />
                                                        {togglingId === supplier._id
                                                            ? 'Menyimpan...'
                                                            : supplier.active !== false ? 'Nonaktifkan' : 'Aktifkan'}
                                                    </button>
                                                </>
                                            ) : (
                                                <Link href={`/suppliers/${supplier._id}`} className="table-action-btn">
                                                    Lihat Detail
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

                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotal === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada master supplier</div>
                                <div className="mobile-record-subtitle">Tambahkan supplier sebelum membuat pembelian barang gudang.</div>
                            </div>
                        ) : suppliers.map(supplier => (
                            <div key={supplier._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">
                                            <Link href={`/suppliers/${supplier._id}`} style={{ color: 'var(--color-primary)' }}>
                                                {supplier.name}
                                            </Link>
                                        </div>
                                        <div className="mobile-record-subtitle">{supplier.supplierCode}</div>
                                    </div>
                                    <span className={`badge ${supplier.active !== false ? 'badge-success' : 'badge-gray'}`}>
                                        {supplier.active !== false ? 'Aktif' : 'Nonaktif'}
                                    </span>
                                </div>
                                <div className="mobile-record-grid">
                                    <div className="mobile-record-field">
                                        <span className="mobile-record-label">PIC</span>
                                        <span className="mobile-record-value">{supplier.contactPerson || '-'}</span>
                                    </div>
                                    <div className="mobile-record-field">
                                        <span className="mobile-record-label">Termin</span>
                                        <span className="mobile-record-value">{formatSupplierTerm(supplier.defaultTermDays)}</span>
                                    </div>
                                    <div className="mobile-record-field">
                                        <span className="mobile-record-label">Sisa Tagihan</span>
                                        <span className="mobile-record-value">{formatCurrency(supplierSummaryMap[supplier._id]?.outstandingAmount || 0)}</span>
                                    </div>
                                    <div className="mobile-record-field">
                                        <span className="mobile-record-label">Pembelian Terakhir</span>
                                        <span className="mobile-record-value">{supplierSummaryMap[supplier._id]?.lastPurchaseDate ? formatDate(supplierSummaryMap[supplier._id]?.lastPurchaseDate) : '-'}</span>
                                    </div>
                                    <div className="mobile-record-field mobile-record-field-full">
                                        <span className="mobile-record-label">Kontak</span>
                                        <span className="mobile-record-value">{supplier.phone || supplier.address || '-'}</span>
                                    </div>
                                </div>
                                {canManage && (
                                    <div className="mobile-record-actions">
                                        <Link href={`/suppliers/${supplier._id}`} className="btn btn-secondary">
                                            Lihat Detail
                                        </Link>
                                        <button className="btn btn-secondary" onClick={() => openEdit(supplier)}>
                                            <Edit size={14} /> Edit
                                        </button>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => toggleActive(supplier)}
                                            disabled={togglingId === supplier._id}
                                        >
                                            <RefreshCw size={14} />
                                            {togglingId === supplier._id ? 'Menyimpan...' : supplier.active !== false ? 'Nonaktifkan' : 'Aktifkan'}
                                        </button>
                                    </div>
                                )}
                                {!canManage && (
                                    <div className="mobile-record-actions">
                                        <Link href={`/suppliers/${supplier._id}`} className="btn btn-secondary">
                                            Lihat Detail
                                        </Link>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {filteredTotal > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotal}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} supplier</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editSupplier ? 'Edit Supplier' : 'Tambah Supplier'}</h3>
                            <button className="modal-close" onClick={closeModal} disabled={saving}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Supplier</label>
                                    <input className="form-input" value={form.supplierCode} onChange={event => setForm(current => ({ ...current, supplierCode: event.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Nama Supplier</label>
                                    <input className="form-input" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">PIC</label>
                                    <input className="form-input" value={form.contactPerson} onChange={event => setForm(current => ({ ...current, contactPerson: event.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Termin Default (hari)</label>
                                    <FormattedNumberInput allowDecimal={false} min={0} value={form.defaultTermDays} onValueChange={value => setForm(current => ({ ...current, defaultTermDays: value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={form.active ? 'active' : 'inactive'} onChange={event => setForm(current => ({ ...current, active: event.target.value === 'active' }))}>
                                        <option value="active">Aktif</option>
                                        <option value="inactive">Nonaktif</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat</label>
                                <textarea className="form-textarea" rows={3} value={form.address} onChange={event => setForm(current => ({ ...current, address: event.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeModal} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

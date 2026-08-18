'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp, useToast } from '../layout';
import { Plus, Search, Edit, Trash2, Users, Save, X, FileDown } from 'lucide-react';
import AppPagination from '@/components/AppPagination';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatCreditLimitCurrency } from '@/lib/customer-credit-limit';
import { exportToExcel } from '@/lib/export';
import { getMasterDataImportExportColumns } from '@/lib/master-data-import-config';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminData, fetchAdminListPayload } from '@/lib/api/admin-client';
import type { Customer } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';

export default function CustomersPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Customer[]>([]);
    const [customerProductCounts, setCustomerProductCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalCustomers, setFilteredTotalCustomers] = useState(0);
    const [totalCustomers, setTotalCustomers] = useState(0);
    const [totalProducts, setTotalProducts] = useState(0);
    const [customersNeedingCatalog, setCustomersNeedingCatalog] = useState(0);
    const [customersWithCustomPrefix, setCustomersWithCustomPrefix] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editItem, setEditItem] = useState<Customer | null>(null);
    const [form, setForm] = useState({ name: '', address: '', contactPerson: '', phone: '', email: '', defaultPaymentTerm: 14, creditLimitAmount: 0, npwp: '', deliveryOrderPrefix: 'SJ' });
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const canCreateCustomers = user ? hasPermission(user, 'customers', 'create') : false;
    const canManageCustomers = user ? hasPermission(user, 'customers', 'update') : false;
    const canExportCustomers = user ? hasPermission(user, 'customers', 'export') : false;

    const buildCustomersQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'customers',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'name',
            sortDir: 'asc',
        });

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'name,contactPerson,deliveryOrderPrefix');
        }

        return params.toString();
    }, [page, search]);

    const fetchAllMatchingCustomers = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Customer[] = [];

        do {
            const payload = await fetchAdminListPayload<Customer>(
                `/api/data?${buildCustomersQuery(currentPage, pageSize)}`,
                'Gagal memuat customer'
            );
            const nextItems = (payload.data || []) as Customer[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCustomersQuery]);

    const loadCustomers = useCallback(async () => {
        setLoading(true);
        try {
            const [listPayload, matchingCustomers] = await Promise.all([
                fetchAdminListPayload<Customer>(`/api/data?${buildCustomersQuery()}`, 'Gagal memuat customer'),
                fetchAllMatchingCustomers(),
            ]);

            const customers = (listPayload.data || []) as Customer[];
            const idsParam = matchingCustomers.map(customer => customer._id).join(',');
            const summaryPayload = await fetchAdminData<{
                productCounts?: Record<string, number>;
            }>(`/api/data?entity=customers-summary${idsParam ? `&ids=${encodeURIComponent(idsParam)}` : ''}`, 'Gagal memuat ringkasan customer');

            const nextProductCounts = (summaryPayload.productCounts || {}) as Record<string, number>;
            const nextCustomersWithCustomPrefix = matchingCustomers.reduce((sum, customer) => (
                customer.deliveryOrderPrefix &&
                customer.deliveryOrderPrefix.trim() !== '' &&
                customer.deliveryOrderPrefix !== 'SJ'
                    ? sum + 1
                    : sum
            ), 0);
            const nextCustomersNeedingCatalog = matchingCustomers.reduce((sum, customer) => (
                (nextProductCounts[customer._id] || 0) === 0 ? sum + 1 : sum
            ), 0);
            const nextTotalProducts = Object.values(nextProductCounts).reduce<number>((sum, count) => sum + count, 0);

            setItems(customers);
            setFilteredTotalCustomers(listPayload.meta?.total || 0);
            setCustomerProductCounts(nextProductCounts);
            setTotalCustomers(matchingCustomers.length);
            setTotalProducts(nextTotalProducts);
            setCustomersNeedingCatalog(nextCustomersNeedingCatalog);
            setCustomersWithCustomPrefix(nextCustomersWithCustomPrefix);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat customer');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCustomersQuery, fetchAllMatchingCustomers]);

    useEffect(() => {
        void loadCustomers();
    }, [loadCustomers]);

    useEffect(() => {
        setPage(1);
    }, [search]);

    const handleExport = async () => {
        if (!canExportCustomers) return;
        try {
            const rows = await fetchAllMatchingCustomers();
            await exportToExcel(
                rows.map((customer) => ({
                    name: customer.name,
                    address: customer.address || '',
                    contactPerson: customer.contactPerson || '',
                    phone: customer.phone || '',
                    email: customer.email || '',
                    defaultPaymentTerm: customer.defaultPaymentTerm,
                    creditLimitAmount: customer.creditLimitAmount || 0,
                    npwp: customer.npwp || '',
                    deliveryOrderPrefix: customer.deliveryOrderPrefix || 'SJ',
                    active: customer.active !== false ? 'Aktif' : 'Nonaktif',
                })),
                getMasterDataImportExportColumns('customers').map((column, index) => ({
                    ...column,
                    width: [30, 35, 22, 18, 26, 14, 18, 22, 12, 12][index] || 18,
                    ...(column.key === 'creditLimitAmount' ? { formatter: (value: unknown) => Number(value || 0).toLocaleString('id-ID') } : {}),
                })),
                `customer-${new Date().toISOString().slice(0, 10)}`,
                'Customer',
                {
                    title: 'Daftar Customer',
                    subtitle: search.trim() ? `Hasil pencarian: ${search.trim()}` : 'Semua customer',
                },
            );
            addToast('success', 'Excel customer berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel customer');
        }
    };

    const openNew = () => {
        setEditItem(null);
        setForm({ name: '', address: '', contactPerson: '', phone: '', email: '', defaultPaymentTerm: 14, creditLimitAmount: 0, npwp: '', deliveryOrderPrefix: 'SJ' });
        setShowModal(true);
    };

    const openEdit = (customer: Customer) => {
        setEditItem(customer);
        setForm({
            name: customer.name,
            address: customer.address,
            contactPerson: customer.contactPerson,
            phone: customer.phone,
            email: customer.email,
            defaultPaymentTerm: customer.defaultPaymentTerm,
            creditLimitAmount: customer.creditLimitAmount || 0,
            npwp: customer.npwp || '',
            deliveryOrderPrefix: customer.deliveryOrderPrefix || 'SJ',
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.name) {
            addToast('error', 'Nama customer wajib diisi');
            return;
        }

        setSaving(true);
        try {
            if (editItem) {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customers',
                        action: 'update',
                        data: { id: editItem._id, updates: { ...form, active: true } },
                    }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal memperbarui customer');
                    return;
                }
                await loadCustomers();
                addToast('success', 'Customer diperbarui');
            } else {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'customers', data: { ...form, active: true } }),
                });
                const result = await res.json();
                if (!res.ok) {
                    addToast('error', result.error || 'Gagal menambahkan customer');
                    return;
                }
                if (page !== 1) {
                    setPage(1);
                } else {
                    await loadCustomers();
                }
                addToast('success', 'Customer ditambahkan');
            }
            setShowModal(false);
        } catch {
            addToast('error', editItem ? 'Gagal memperbarui customer' : 'Gagal menambahkan customer');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', action: 'delete', data: { id } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus customer');
                setDeleteId(null);
                return;
            }
            if (page > 1 && items.length === 1) {
                setPage(current => Math.max(1, current - 1));
            } else {
                await loadCustomers();
            }
            setDeleteId(null);
            addToast('success', 'Customer dihapus');
        } catch {
            addToast('error', 'Gagal menghapus customer');
            setDeleteId(null);
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Customer</h1>
                </div>
                <div className="page-actions">
                    {canExportCustomers && <button className="btn btn-secondary" onClick={() => void handleExport()}><FileDown size={18} /> Excel</button>}
                    {canCreateCustomers && <button className="btn btn-primary" onClick={openNew}>
                        <Plus size={18} /> Tambah Customer
                    </button>}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Users size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Customer</div>
                        <div className="kpi-value">{totalCustomers}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Users size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Master Barang</div>
                        <div className="kpi-value">{totalProducts}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Users size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Butuh Setup Barang</div>
                        <div className="kpi-value">{customersNeedingCatalog}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon neutral"><Users size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Format Khusus</div>
                        <div className="kpi-value">{customersWithCustomPrefix}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari customer, PIC, format SJ..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Nama</th>
                                <th>PIC</th>
                                <th>Telepon</th>
                                <th>Email</th>
                                <th>Format SJ</th>
                                <th>Limit Piutang</th>
                                <th>Master Barang</th>
                                <th>Status Setup</th>
                                <th>Termin</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(i => (
                                    <tr key={i}>
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => (
                                            <td key={j}><div className="skeleton skeleton-text" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filteredTotalCustomers === 0 ? (
                                <tr>
                                    <td colSpan={10}>
                                        <div className="empty-state">
                                            <Users size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada customer</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                items.map(customer => (
                                    <tr key={customer._id}>
                                        <td className="font-semibold">
                                            <Link href={`/customers/${customer._id}`} style={{ color: 'var(--color-primary)' }}>
                                                {customer.name}
                                            </Link>
                                        </td>
                                        <td>{customer.contactPerson}</td>
                                        <td>{customer.phone}</td>
                                        <td className="text-muted">{customer.email}</td>
                                        <td className="font-mono">{customer.deliveryOrderPrefix || 'SJ'}</td>
                                        <td>{customer.creditLimitAmount ? formatCreditLimitCurrency(customer.creditLimitAmount) : 'Tanpa limit'}</td>
                                        <td><span className="badge badge-info">{customerProductCounts[customer._id] || 0} barang</span></td>
                                        <td>
                                            {(customerProductCounts[customer._id] || 0) > 0 ? (
                                                <span className="badge badge-success">Siap dipakai</span>
                                            ) : (
                                                <span className="badge badge-warning">Perlu setup barang</span>
                                            )}
                                        </td>
                                        <td>{customer.defaultPaymentTerm} hari</td>
                                        <td>
                                            <div className="table-actions">
                                                <Link href={`/customers/${customer._id}`} className="table-action-btn">Detail & Barang</Link>
                                                {canManageCustomers && <button className="table-action-btn" onClick={() => openEdit(customer)}><Edit size={14} /> Edit</button>}
                                                {canManageCustomers && <button className="table-action-btn danger" onClick={() => setDeleteId(customer._id)}><Trash2 size={14} /> Hapus</button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalCustomers === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada customer</div>
                                <div className="mobile-record-subtitle">Tambahkan customer baru untuk mulai membuat order, surat jalan, dan master barang khusus customer.</div>
                                <div className="mobile-record-actions">
                                {canCreateCustomers && <button className="btn btn-primary" onClick={openNew}>
                                    <Plus size={16} /> Tambah Customer
                                </button>}
                                </div>
                            </div>
                        ) : items.map(customer => (
                            <div key={customer._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{customer.name}</div>
                                        <div className="mobile-record-subtitle">{customer.contactPerson || '-'} | {customer.phone || '-'}</div>
                                    </div>
                                    <span className="badge badge-info">{customer.deliveryOrderPrefix || 'SJ'}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Email</span>
                                        <span className="mobile-record-value">{customer.email || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Master Barang</span>
                                        <span className="mobile-record-value">{customerProductCounts[customer._id] || 0} barang</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Limit Piutang</span>
                                        <span className="mobile-record-value">{customer.creditLimitAmount ? formatCreditLimitCurrency(customer.creditLimitAmount) : 'Tanpa limit'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Status Setup</span>
                                        <span className="mobile-record-value">
                                            {(customerProductCounts[customer._id] || 0) > 0 ? 'Siap dipakai' : 'Perlu setup barang'}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Termin</span>
                                        <span className="mobile-record-value">{customer.defaultPaymentTerm} hari</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <Link href={`/customers/${customer._id}`} className="btn btn-secondary">Detail & Barang</Link>
                                    {canManageCustomers && <button className="btn btn-secondary" onClick={() => openEdit(customer)}>
                                        <Edit size={14} /> Edit
                                    </button>}
                                    {canManageCustomers && <button className="btn btn-danger" onClick={() => setDeleteId(customer._id)}>
                                        <Trash2 size={14} /> Hapus
                                    </button>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {filteredTotalCustomers > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalCustomers}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} customer</>
                        )}
                    />
                )}
            </div>

            {canManageCustomers && showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editItem ? 'Edit Customer' : 'Tambah Customer'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama <span className="required">*</span></label>
                                    <input className="form-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">PIC</label>
                                    <input className="form-input" value={form.contactPerson} onChange={event => setForm({ ...form, contactPerson: event.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat</label>
                                <textarea className="form-textarea" rows={2} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input className="form-input" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Termin Pembayaran (hari)</label>
                                    <FormattedNumberInput allowDecimal={false} value={form.defaultPaymentTerm} onValueChange={value => setForm({ ...form, defaultPaymentTerm: value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Limit Piutang</label>
                                    <FormattedNumberInput allowDecimal={false} value={form.creditLimitAmount} onValueChange={value => setForm({ ...form, creditLimitAmount: value })} placeholder="0 = tanpa limit" />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">NPWP</label>
                                    <input className="form-input" value={form.npwp} onChange={event => setForm({ ...form, npwp: event.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Awalan Referensi SJ Pengirim</label>
                                <input className="form-input" value={form.deliveryOrderPrefix} onChange={event => setForm({ ...form, deliveryOrderPrefix: event.target.value.toUpperCase() })} placeholder="Contoh: SJ / BK / ARW" />
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Dipakai sebagai awalan referensi nomor SJ dari pengirim, misalnya `{form.deliveryOrderPrefix || 'SJ'}-27032026-001`. Nomor final tetap diinput manual saat membuat surat jalan.
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

            {canManageCustomers && deleteId && (
                <div className="modal-overlay" onClick={() => { if (!deletingId) setDeleteId(null); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Konfirmasi Hapus</h3></div>
                        <div className="modal-body"><p>Apakah Anda yakin ingin menghapus customer ini?</p></div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>Batal</button>
                            <button className="btn btn-danger" onClick={() => handleDelete(deleteId)} disabled={deletingId === deleteId}>
                                <Trash2 size={16} /> {deletingId === deleteId ? 'Menghapus...' : 'Hapus'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

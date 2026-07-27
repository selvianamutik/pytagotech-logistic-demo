'use client';

import { useCallback, useEffect, useState } from 'react';
import { Edit, Plus, RefreshCw, Save, Search, Trash2, Users, X } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import { getBusinessDateValue } from '@/lib/business-date';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminListPayload } from '@/lib/api/admin-client';
import { hasPermission } from '@/lib/rbac';
import type { Employee } from '@/lib/types';

import { useApp, useToast } from '../layout';

type EmployeeFormState = {
    employeeCode: string;
    name: string;
    phone: string;
    position: string;
    division: string;
    joinDate: string;
    notes: string;
    active: boolean;
};

const createDefaultForm = (employee?: Partial<Employee>): EmployeeFormState => ({
    employeeCode: employee?.employeeCode || '',
    name: employee?.name || '',
    phone: employee?.phone || '',
    position: employee?.position || '',
    division: employee?.division || '',
    joinDate: employee?.joinDate || getBusinessDateValue(),
    notes: employee?.notes || '',
    active: employee?.active !== false,
});

export default function EmployeesPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [filteredTotalEmployees, setFilteredTotalEmployees] = useState(0);
    const [totalEmployees, setTotalEmployees] = useState(0);
    const [inactiveEmployees, setInactiveEmployees] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
    const [saving, setSaving] = useState(false);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [form, setForm] = useState<EmployeeFormState>(createDefaultForm());

    const canCreateEmployees = user ? hasPermission(user, 'employees', 'create') : false;
    const canUpdateEmployees = user ? hasPermission(user, 'employees', 'update') : false;
    const canDeleteEmployees = user ? hasPermission(user, 'employees', 'delete') : false;
    const canManageEmployees = canCreateEmployees || canUpdateEmployees || canDeleteEmployees;
    const activeEmployees = totalEmployees - inactiveEmployees;

    const buildEmployeesQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'employees',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortField: 'employeeCode',
            sortDir: 'asc',
        });
        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'employeeCode,name,position,division,phone');
        }
        return params.toString();
    }, [page, search]);

    const loadEmployees = useCallback(async () => {
        setLoading(true);
        try {
            const [listPayload, totalPayload, inactivePayload] = await Promise.all([
                fetchAdminListPayload<Employee>(`/api/data?${buildEmployeesQuery()}`, 'Gagal memuat data karyawan'),
                fetchAdminListPayload<Employee>('/api/data?entity=employees&countOnly=1', 'Gagal memuat total karyawan'),
                fetchAdminListPayload<Employee>(
                    `/api/data?entity=employees&countOnly=1&filter=${encodeURIComponent(JSON.stringify({ active: false }))}`,
                    'Gagal memuat karyawan nonaktif'
                ),
            ]);

            setEmployees((listPayload.data || []) as Employee[]);
            setFilteredTotalEmployees(listPayload.meta?.total || 0);
            setTotalEmployees(totalPayload.meta?.total || 0);
            setInactiveEmployees(inactivePayload.meta?.total || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data karyawan');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildEmployeesQuery]);

    useEffect(() => {
        void loadEmployees();
    }, [loadEmployees]);

    useEffect(() => {
        setPage(1);
    }, [search]);

    const openCreate = () => {
        setEditEmployee(null);
        setForm(createDefaultForm());
        setShowModal(true);
    };

    const openEdit = (employee: Employee) => {
        setEditEmployee(employee);
        setForm(createDefaultForm(employee));
        setShowModal(true);
    };

    const closeModal = () => {
        if (saving) return;
        setShowModal(false);
        setEditEmployee(null);
    };

    const handleSave = async () => {
        const canSaveEmployee = editEmployee ? canUpdateEmployees : canCreateEmployees;
        if (!canSaveEmployee) {
            addToast('error', 'Anda tidak punya hak mengubah master karyawan');
            return;
        }

        if (!form.employeeCode || !form.name || !form.position || !form.division) {
            addToast('error', 'Kode, nama, jabatan, dan divisi wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                employeeCode: form.employeeCode,
                name: form.name,
                phone: form.phone,
                position: form.position,
                division: form.division,
                joinDate: form.joinDate,
                notes: form.notes,
                active: form.active,
            };

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editEmployee
                        ? { entity: 'employees', action: 'update', data: { id: editEmployee._id, updates: payload } }
                        : { entity: 'employees', data: payload }
                ),
            });
            const response = await res.json();
            if (!res.ok) {
                throw new Error(response.error || 'Gagal menyimpan karyawan');
            }

            addToast('success', editEmployee ? 'Karyawan diperbarui' : 'Karyawan ditambahkan');
            setShowModal(false);
            setEditEmployee(null);
            setForm(createDefaultForm());
            if (!editEmployee && page !== 1) {
                setPage(1);
            } else {
                await loadEmployees();
            }
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan karyawan');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (employee: Employee) => {
        if (!canUpdateEmployees) {
            addToast('error', 'Anda tidak punya hak mengubah status karyawan');
            return;
        }

        setTogglingId(employee._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'employees',
                    action: 'update',
                    data: {
                        id: employee._id,
                        updates: { active: employee.active === false },
                    },
                }),
            });
            const response = await res.json();
            if (!res.ok) {
                throw new Error(response.error || 'Gagal memperbarui status karyawan');
            }

            addToast('success', employee.active === false ? 'Karyawan diaktifkan' : 'Karyawan dinonaktifkan');
            await loadEmployees();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui status karyawan');
        } finally {
            setTogglingId(current => current === employee._id ? null : current);
        }
    };

    const handleDelete = async (id: string) => {
        if (!canDeleteEmployees) {
            addToast('error', 'Anda tidak punya hak menghapus karyawan');
            return;
        }

        setDeletingId(id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'employees', action: 'delete', data: { id } }),
            });
            const response = await res.json();
            if (!res.ok) {
                throw new Error(response.error || 'Gagal menghapus karyawan');
            }

            setDeleteId(null);
            addToast('success', 'Karyawan dihapus');
            if (page > 1 && employees.length === 1) {
                setPage(current => Math.max(1, current - 1));
            } else {
                await loadEmployees();
            }
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menghapus karyawan');
        } finally {
            setDeletingId(current => current === id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Karyawan</h1>
                </div>
                <div className="page-actions">
                    {canCreateEmployees && (
                        <button className="btn btn-primary" onClick={openCreate}>
                            <Plus size={18} /> Tambah Karyawan
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid employees-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Karyawan Aktif</div>
                        <div className="kpi-value">{activeEmployees}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Karyawan Nonaktif</div>
                        <div className="kpi-value">{inactiveEmployees}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Hak Kelola</div>
                        <div className="kpi-value">{canManageEmployees ? 'Aktif' : 'Lihat Saja'}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input
                                placeholder="Cari kode, nama, jabatan, divisi..."
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
                                <th>Nama</th>
                                <th>Jabatan</th>
                                <th>Divisi</th>
                                <th>Tanggal Masuk</th>
                                <th>Status</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(index => (
                                <tr key={index}>
                                    {[1, 2, 3, 4, 5, 6, 7].map(cell => (
                                        <td key={cell}><div className="skeleton skeleton-text" /></td>
                                    ))}
                                </tr>
                            )) : filteredTotalEmployees === 0 ? (
                                <tr>
                                    <td colSpan={7}>
                                        <div className="empty-state">
                                            <Users size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada master karyawan</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : employees.map(employee => (
                                <tr key={employee._id}>
                                    <td className="font-mono">{employee.employeeCode}</td>
                                    <td>
                                        <div className="font-semibold">{employee.name}</div>
                                        <div className="text-muted text-xs">{employee.phone || 'Tanpa nomor HP'}</div>
                                    </td>
                                    <td>{employee.position || '-'}</td>
                                    <td>{employee.division || '-'}</td>
                                    <td className="text-muted">{employee.joinDate || '-'}</td>
                                    <td>
                                        <span className={`badge ${employee.active !== false ? 'badge-success' : 'badge-gray'}`}>
                                            {employee.active !== false ? 'Aktif' : 'Nonaktif'}
                                        </span>
                                    </td>
                                    <td>
                                        <div className="table-actions">
                                            {canUpdateEmployees || canDeleteEmployees ? (
                                                <>
                                                    {canUpdateEmployees && <button className="table-action-btn" onClick={() => openEdit(employee)}>
                                                        <Edit size={14} /> Edit
                                                    </button>}
                                                    {canUpdateEmployees && <button
                                                        className="table-action-btn"
                                                        onClick={() => toggleActive(employee)}
                                                        disabled={togglingId === employee._id}
                                                    >
                                                        <RefreshCw size={14} />
                                                        {togglingId === employee._id
                                                            ? 'Menyimpan...'
                                                            : employee.active !== false
                                                                ? 'Nonaktifkan'
                                                                : 'Aktifkan'}
                                                    </button>}
                                                    {canDeleteEmployees && <button
                                                        className="table-action-btn danger"
                                                        onClick={() => setDeleteId(employee._id)}
                                                        disabled={deletingId === employee._id}
                                                    >
                                                        <Trash2 size={14} />
                                                        {deletingId === employee._id ? 'Menghapus...' : 'Hapus'}
                                                    </button>}
                                                </>
                                            ) : (
                                                <span className="text-muted">Lihat saja</span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalEmployees === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada master karyawan</div>
                                <div className="mobile-record-subtitle">Tambahkan data karyawan agar absensi bisa dicatat per tanggal.</div>
                            </div>
                        ) : employees.map(employee => (
                            <div key={employee._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{employee.name}</div>
                                        <div className="mobile-record-subtitle">{employee.employeeCode}</div>
                                    </div>
                                    <span className={`badge ${employee.active !== false ? 'badge-success' : 'badge-gray'}`}>
                                        {employee.active !== false ? 'Aktif' : 'Nonaktif'}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jabatan</span>
                                        <span className="mobile-record-value">{employee.position || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Divisi</span>
                                        <span className="mobile-record-value">{employee.division || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tanggal Masuk</span>
                                        <span className="mobile-record-value">{employee.joinDate || '-'}</span>
                                    </div>
                                </div>
                                {(canUpdateEmployees || canDeleteEmployees) && (
                                    <div className="mobile-record-actions">
                                        {canUpdateEmployees && <button className="btn btn-secondary" onClick={() => openEdit(employee)}>
                                            <Edit size={14} /> Edit
                                        </button>}
                                        {canUpdateEmployees && <button
                                            className="btn btn-secondary"
                                            onClick={() => toggleActive(employee)}
                                            disabled={togglingId === employee._id}
                                        >
                                            <RefreshCw size={14} />
                                            {togglingId === employee._id
                                                ? 'Menyimpan...'
                                                : employee.active !== false
                                                    ? 'Nonaktifkan'
                                                    : 'Aktifkan'}
                                        </button>}
                                        {canDeleteEmployees && <button
                                            className="btn btn-danger"
                                            onClick={() => setDeleteId(employee._id)}
                                            disabled={deletingId === employee._id}
                                        >
                                            <Trash2 size={14} /> {deletingId === employee._id ? 'Menghapus...' : 'Hapus'}
                                        </button>}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {filteredTotalEmployees > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalEmployees}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} karyawan</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editEmployee ? 'Edit Karyawan' : 'Tambah Karyawan'}</h3>
                            <button className="modal-close" onClick={closeModal} disabled={saving}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">Kode Karyawan <span className="required">*</span></label>
                                    <input
                                        className="form-input"
                                        value={form.employeeCode}
                                        onChange={event => setForm(current => ({ ...current, employeeCode: event.target.value.toUpperCase() }))}
                                        placeholder="Contoh: KRY-001"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Nama Karyawan <span className="required">*</span></label>
                                    <input
                                        className="form-input"
                                        value={form.name}
                                        onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">Jabatan <span className="required">*</span></label>
                                    <input
                                        className="form-input"
                                        value={form.position}
                                        onChange={event => setForm(current => ({ ...current, position: event.target.value }))}
                                        placeholder="Contoh: Admin Gudang"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Divisi <span className="required">*</span></label>
                                    <input
                                        className="form-input"
                                        value={form.division}
                                        onChange={event => setForm(current => ({ ...current, division: event.target.value }))}
                                        placeholder="Contoh: Operasional"
                                    />
                                </div>
                            </div>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label className="form-label">No. HP</label>
                                    <input
                                        className="form-input"
                                        value={form.phone}
                                        onChange={event => setForm(current => ({ ...current, phone: event.target.value }))}
                                        placeholder="Contoh: 081234567890"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Masuk</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={form.joinDate}
                                        onChange={event => setForm(current => ({ ...current, joinDate: event.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={3}
                                    value={form.notes}
                                    onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
                                    placeholder="Catatan internal karyawan"
                                />
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

            {canDeleteEmployees && deleteId && (
                <div className="modal-overlay" onClick={() => { if (!deletingId) setDeleteId(null); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Konfirmasi Hapus</h3>
                            <button className="modal-close" onClick={() => setDeleteId(null)} disabled={deletingId === deleteId}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Hapus karyawan ini secara permanen?</p>
                            <p className="text-muted text-sm" style={{ marginTop: '0.5rem' }}>
                                Karyawan yang sudah punya riwayat absensi tidak bisa dihapus dan harus dinonaktifkan.
                            </p>
                        </div>
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

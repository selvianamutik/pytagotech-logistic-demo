'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../layout';
import { Plus, Edit, Save, X, RefreshCw } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAdminData, fetchAdminListPayload } from '@/lib/api/admin-client';
import type { User } from '@/lib/types';
import { INTERNAL_USER_ROLE_OPTIONS, type InternalUserRole } from '@/lib/rbac';
import type { AppModule } from '@/lib/rbac';
import ModulePermissionsEditor from '@/app/(admin)/_components/ModulePermissionsEditor';

type InternalUser = User & { role: InternalUserRole };

const getUserNextAction = (user: InternalUser) => {
    if (user.active === false) return 'Aktifkan bila pengguna dipakai lagi';
    if (user.role === 'OWNER') return 'Pastikan akun owner tetap aman';
    if (user.role === 'FINANCE') return 'Siap dipakai tim finance';
    if (user.role === 'ARMADA') return 'Siap dipakai tim armada';
    return 'Siap dipakai tim operasional';
};

const ROLE_LABELS: Record<InternalUserRole, string> = {
    OWNER: 'OWNER',
    OPERASIONAL: 'OPERASIONAL',
    FINANCE: 'FINANCE',
    ARMADA: 'ARMADA',
};

export default function UsersPage() {
    const { addToast } = useToast();
    const [users, setUsers] = useState<InternalUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalUsers, setTotalUsers] = useState(0);
    const [inactiveUsers, setInactiveUsers] = useState(0);
    const [ownerUsers, setOwnerUsers] = useState(0);
    const [operationalUsers, setOperationalUsers] = useState(0);
    const [financeUsers, setFinanceUsers] = useState(0);
    const [armadaUsers, setArmadaUsers] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [editUser, setEditUser] = useState<InternalUser | null>(null);
    const [saving, setSaving] = useState(false);
    const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', email: '', role: 'OPERASIONAL' as InternalUserRole, password: '', overrides: {} as Partial<Record<AppModule, boolean>>, permissionsReset: false });
    const activeUsers = totalUsers - inactiveUsers;

    const internalRoleFilter = JSON.stringify({ role: INTERNAL_USER_ROLE_OPTIONS });

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const [listPayload, summaryPayload] = await Promise.all([
                fetchAdminListPayload<User>(`/api/data?entity=users&page=${page}&pageSize=${DEFAULT_PAGE_SIZE}&filter=${encodeURIComponent(internalRoleFilter)}`, 'Gagal memuat data pengguna'),
                fetchAdminData<{
                    total?: number;
                    inactive?: number;
                    owner?: number;
                    operational?: number;
                    finance?: number;
                    armada?: number;
                }>('/api/data?entity=users-summary', 'Gagal memuat ringkasan pengguna'),
            ]);

            setUsers((listPayload.data || []).filter((item: User): item is InternalUser => item.role !== 'DRIVER'));
            setTotalUsers(summaryPayload.total || 0);
            setInactiveUsers(summaryPayload.inactive || 0);
            setOwnerUsers(summaryPayload.owner || 0);
            setOperationalUsers(summaryPayload.operational || 0);
            setFinanceUsers(summaryPayload.finance || 0);
            setArmadaUsers(summaryPayload.armada || 0);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data pengguna');
        } finally {
            setLoading(false);
        }
    }, [addToast, page, internalRoleFilter]);

    useEffect(() => {
        void loadUsers();
    }, [loadUsers]);

    const openNew = () => { setEditUser(null); setForm({ name: '', email: '', role: 'OPERASIONAL', password: '', overrides: {}, permissionsReset: false }); setShowModal(true); };
    const openEdit = (u: InternalUser) => {
        const stored = u.modulePermissions ?? {};
        const overrides: Partial<Record<AppModule, boolean>> = {};
        for (const [mod, val] of Object.entries(stored)) {
            if (typeof val === 'boolean' && mod !== 'profile') {
                overrides[mod as AppModule] = val;
            }
        }
        setEditUser(u);
        setForm({ name: u.name, email: u.email, role: u.role, password: '', overrides, permissionsReset: false });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.name || !form.email) { addToast('error', 'Nama dan email wajib'); return; }
        if (!editUser && !form.password) { addToast('error', 'Password wajib untuk pengguna baru'); return; }
        if (form.password && form.password.length < 8) { addToast('error', 'Password minimal 8 karakter'); return; }
        setSaving(true);
        try {
            if (editUser) {
                const updates: Record<string, unknown> = { name: form.name, email: form.email, role: form.role };
                if (form.password) updates.password = form.password;

                if (form.permissionsReset || Object.keys(form.overrides).length === 0) {
                    // Reset: clear all explicit module assignments — send empty object,
                    // server will delete modulePermissions from extra_data entirely
                    updates.modulePermissions = {};
                } else {
                    // Send the full overrides — server stores true/false as-is
                    updates.modulePermissions = { ...form.overrides };
                }
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'users', action: 'update', data: { id: editUser._id, updates } }),
                });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal memperbarui pengguna');
                    return;
                }
                await loadUsers();
                addToast('success', 'Pengguna diperbarui');
            } else {
                const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'users', data: { name: form.name, email: form.email, role: form.role, password: form.password } }),
                });
                const payload = await res.json();
                if (!res.ok) {
                    addToast('error', payload.error || 'Gagal menambah pengguna');
                    return;
                }
                if (page !== 1) {
                    setPage(1);
                } else {
                    await loadUsers();
                }
                addToast('success', 'Pengguna ditambahkan');
            }
            setShowModal(false);
        } catch {
            addToast('error', editUser ? 'Gagal memperbarui pengguna' : 'Gagal menambah pengguna');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (u: User) => {
        const currentlyActive = u.active !== false;
        setTogglingUserId(u._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'users', action: 'update', data: { id: u._id, updates: { active: !currentlyActive } } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal memperbarui status pengguna');
                return;
            }
            await loadUsers();
            addToast('success', `Pengguna ${currentlyActive ? 'dinonaktifkan' : 'diaktifkan'}`);
        } catch {
            addToast('error', 'Gagal memperbarui status pengguna');
        } finally {
            setTogglingUserId(current => current === u._id ? null : current);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengguna Internal</h1></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={openNew}><Plus size={18} /> Tambah Pengguna</button></div></div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Pengguna Aktif</div><div className="kpi-value">{activeUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Pengguna Nonaktif</div><div className="kpi-value">{inactiveUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Owner</div><div className="kpi-value">{ownerUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Operasional</div><div className="kpi-value">{operationalUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Finance</div><div className="kpi-value">{financeUsers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Armada</div><div className="kpi-value">{armadaUsers}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody suppressHydrationWarning>
                            {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                totalUsers === 0 ? (
                                    <tr><td colSpan={6}><div className="empty-state"><div className="empty-state-title">Belum ada pengguna internal</div></div></td></tr>
                                ) : users.map(u => (
                                    <tr key={u._id}>
                                        <td className="font-semibold">{u.name}</td><td>{u.email}</td>
                                        <td><span className={`badge ${u.role === 'OWNER' ? 'badge-purple' : 'badge-info'}`}>{ROLE_LABELS[u.role]}</span></td>
                                        <td><span className={`badge ${u.active !== false ? 'badge-success' : 'badge-gray'}`}>{u.active !== false ? 'Aktif' : 'Non-Aktif'}</span></td>
                                        <td>{getUserNextAction(u)}</td>
                                        <td><div className="table-actions">
                                            <button className="table-action-btn" onClick={() => openEdit(u)} disabled={togglingUserId === u._id}><Edit size={14} /> Edit</button>
                                            <button className="table-action-btn" onClick={() => toggleActive(u)} disabled={togglingUserId === u._id}><RefreshCw size={14} /> {togglingUserId === u._id ? 'Menyimpan...' : (u.active !== false ? 'Nonaktifkan' : 'Aktifkan')}</button>
                                        </div></td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {totalUsers === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada pengguna internal</div>
                                <div className="mobile-record-subtitle">Tambahkan pengguna admin atau owner baru untuk akses internal sistem.</div>
                            </div>
                        ) : users.map(u => (
                            <div key={u._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{u.name}</div>
                                        <div className="mobile-record-subtitle">{u.email}</div>
                                    </div>
                                    <span className={`badge ${u.active !== false ? 'badge-success' : 'badge-gray'}`}>{u.active !== false ? 'Aktif' : 'Non-Aktif'}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Role</span>
                                        <span className="mobile-record-value">{ROLE_LABELS[u.role]}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getUserNextAction(u)}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => openEdit(u)} disabled={togglingUserId === u._id}>
                                        <Edit size={14} /> Edit
                                    </button>
                                    <button className="btn btn-secondary" onClick={() => toggleActive(u)} disabled={togglingUserId === u._id}>
                                        <RefreshCw size={14} /> {togglingUserId === u._id ? 'Menyimpan...' : (u.active !== false ? 'Nonaktifkan' : 'Aktifkan')}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {totalUsers > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalUsers}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} pengguna</>
                        )}
                    />
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editUser ? 'Edit Pengguna' : 'Tambah Pengguna'}</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Nama <span className="required">*</span></label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoComplete="name" /></div>
                            <div className="form-group"><label className="form-label">Email <span className="required">*</span></label><input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="username" /></div>
                            <div className="form-group"><label className="form-label">Role</label>
                                <select className="form-select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value as InternalUserRole })}>
                                    {INTERNAL_USER_ROLE_OPTIONS.map(role => (
                                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">{editUser ? 'Reset Password (kosongkan jika tidak diubah)' : 'Password *'}</label><input className="form-input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" /><div className="form-hint">Minimal 8 karakter</div></div>
                            <ModulePermissionsEditor
                                role={form.role}
                                overrides={form.overrides}
                                onChange={overrides => setForm(f => ({ ...f, overrides, permissionsReset: false }))}
                                onReset={() => setForm(f => ({ ...f, overrides: {}, permissionsReset: true }))}
                            />
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}

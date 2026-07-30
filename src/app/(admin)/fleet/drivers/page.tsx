'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp, useToast } from '../../layout';
import { Plus, Search, UserCircle, Save, X, Edit2, ToggleLeft, ToggleRight, Smartphone } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import { buildDriverScoreSummaryMap, buildDriverScoresQuery, DRIVER_SCORE_TYPE_META, getDriverScoreStatusMeta } from '@/lib/driver-scoring-support';
import {
    buildDriverAccountMap,
    buildDriversQuery,
    createDefaultDriverAccessForm,
    createDefaultDriverForm,
    isDriverAccountActive,
    isDriverActive,
    type DriverMobileAccount,
} from '@/lib/fleet-asset-page-support';
import { formatDate, formatDateTime } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import type { Driver, DriverScore } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';

export default function DriversPage() {
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<Driver[]>([]);
    const [accounts, setAccounts] = useState<DriverMobileAccount[]>([]);
    const [scores, setScores] = useState<DriverScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalDrivers, setTotalDrivers] = useState(0);
    const [activeDrivers, setActiveDrivers] = useState(0);
    const [mobileReadyDrivers, setMobileReadyDrivers] = useState(0);
    const [inactiveDrivers, setInactiveDrivers] = useState(0);
    const [showModal, setShowModal] = useState(false);
    const [showAccessModal, setShowAccessModal] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [accessDriver, setAccessDriver] = useState<Driver | null>(null);
    const [savingDriver, setSavingDriver] = useState(false);
    const [savingAccess, setSavingAccess] = useState(false);
    const [togglingDriverId, setTogglingDriverId] = useState<string | null>(null);
    const [form, setForm] = useState(createDefaultDriverForm());
    const [accountForm, setAccountForm] = useState(createDefaultDriverAccessForm());
    const canCreateDrivers = user ? hasPermission(user, 'drivers', 'create') : false;
    const canManageDrivers = user ? hasPermission(user, 'drivers', 'update') : false;
    const canViewDriverScores = user ? hasPermission(user, 'driverScores', 'view') : false;
    const canViewDriverAccounts = user ? hasPermission(user, 'drivers', 'view') : false;
    const canManageDriverAccounts = canViewDriverAccounts && canManageDrivers;

    useEffect(() => {
        setPage(1);
    }, [search]);

    const buildCurrentDriversQuery = useCallback(
        (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
            buildDriversQuery({ page: targetPage, pageSize: targetPageSize, search }),
        [page, search]
    );

    const fetchAllMatchingDrivers = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Driver[] = [];

        do {
            const res = await fetch(`/api/data?${buildCurrentDriversQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat data supir');
            }

            const nextItems = (payload.data || []) as Driver[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildCurrentDriversQuery]);

    const loadDrivers = useCallback(async () => {
        setLoading(true);
        try {
            const [listRes, matchingDrivers] = await Promise.all([
                fetch(`/api/data?${buildCurrentDriversQuery()}`),
                fetchAllMatchingDrivers(),
            ]);
            const listPayload = await listRes.json();
            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat data supir');
            }

            const drivers = (listPayload.data || []) as Driver[];
            let matchingAccounts: DriverMobileAccount[] = [];
            let scoreRows: DriverScore[] = [];
            if (canViewDriverAccounts) {
                const accountsRes = await fetch('/api/driver/accounts');
                const accountsPayload = await accountsRes.json();
                if (!accountsRes.ok) {
                    throw new Error(accountsPayload.error || 'Gagal memuat akses mobile driver');
                }
                matchingAccounts = (accountsPayload.data || []) as DriverMobileAccount[];
            }
            scoreRows = await fetchAllAdminCollectionData<DriverScore>(
                `/api/data?${buildDriverScoresQuery({ page: 1, pageSize: 500 })}`,
                'Gagal memuat scoring supir'
            );

            const matchingDriverRefs = new Set(matchingDrivers.map(driver => driver._id));
            const activeMatchingDrivers = matchingDrivers.filter(driver => driver.active !== false).length;
            const inactiveMatchingDrivers = matchingDrivers.length - activeMatchingDrivers;
            const mobileReadyMatchingDrivers = canViewDriverAccounts
                ? matchingAccounts.filter(account => account.driverRef && matchingDriverRefs.has(account.driverRef) && account.active !== false).length
                : 0;

            setItems(drivers);
            setTotalDrivers(listPayload.meta?.total || 0);
            setAccounts(canViewDriverAccounts ? matchingAccounts : []);
            setScores(scoreRows);
            setActiveDrivers(activeMatchingDrivers);
            setInactiveDrivers(inactiveMatchingDrivers);
            setMobileReadyDrivers(mobileReadyMatchingDrivers);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data supir');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildCurrentDriversQuery, canViewDriverAccounts, fetchAllMatchingDrivers]);

    useEffect(() => {
        void loadDrivers();
    }, [loadDrivers]);

    const accountByDriverRef = buildDriverAccountMap(accounts);
    const scoreByDriverRef = buildDriverScoreSummaryMap(scores);

    const closeModal = () => {
        if (savingDriver) return;
        setShowModal(false);
        setEditId(null);
        setForm(createDefaultDriverForm());
    };

    const handleSave = async () => {
        if (!form.name || !form.phone) {
            addToast('error', 'Nama dan no. HP wajib diisi');
            return;
        }
        setSavingDriver(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editId
                        ? { entity: 'drivers', action: 'update', data: { id: editId, updates: form } }
                        : { entity: 'drivers', data: form }
                ),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyimpan data supir');
                return;
            }
            if (!editId && page !== 1) {
                setPage(1);
            } else {
                await loadDrivers();
            }
            addToast('success', editId ? 'Supir diperbarui' : 'Supir ditambahkan');
            closeModal();
        } catch {
            addToast('error', 'Gagal menyimpan data supir');
        } finally {
            setSavingDriver(false);
        }
    };

    const toggleActive = async (driver: Driver) => {
        const currentlyActive = isDriverActive(driver);
        setTogglingDriverId(driver._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'drivers', action: 'update', data: { id: driver._id, updates: { active: !currentlyActive } } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal memperbarui status supir');
                return;
            }

            await loadDrivers();

            if (currentlyActive) {
                const stoppedTrackingCount = typeof payload.meta?.stoppedTrackingCount === 'number' ? payload.meta.stoppedTrackingCount : 0;
                const disabledAccounts = Array.isArray(payload.meta?.disabledDriverAccountIds) ? payload.meta.disabledDriverAccountIds.length : 0;
                const messageParts = ['Supir dinon-aktifkan'];
                if (disabledAccounts > 0) {
                    messageParts.push(`${disabledAccounts} akun mobile ikut dinonaktifkan`);
                }
                if (stoppedTrackingCount > 0) {
                    messageParts.push(`${stoppedTrackingCount} tracking aktif dihentikan`);
                }
                addToast('success', messageParts.join(' | '));
            } else {
                addToast('success', 'Supir diaktifkan');
            }
        } catch {
            addToast('error', 'Gagal memperbarui status supir');
        } finally {
            setTogglingDriverId(current => current === driver._id ? null : current);
        }
    };

    const openAccessModal = (driver: Driver) => {
        if (!canManageDriverAccounts) {
            addToast('error', 'Akses akun mobile driver hanya untuk owner dan armada');
            return;
        }
        if (!isDriverActive(driver)) {
            addToast('error', 'Aktifkan supir dulu sebelum mengatur akses mobile');
            return;
        }
        const existingAccount = accountByDriverRef.get(driver._id);
        setAccessDriver(driver);
        setAccountForm({
            accountId: existingAccount?._id || '',
            name: existingAccount?.name || driver.name,
            email: existingAccount?.email || '',
            password: '',
            active: existingAccount?.active ?? true,
        });
        setShowAccessModal(true);
    };

    const closeAccessModal = () => {
        if (savingAccess) return;
        setShowAccessModal(false);
        setAccessDriver(null);
        setAccountForm(createDefaultDriverAccessForm());
    };

    const saveDriverAccess = async () => {
        if (!accessDriver) {
            addToast('error', 'Data supir tidak ditemukan');
            return;
        }
        if (!accountForm.name || !accountForm.email) {
            addToast('error', 'Nama dan email akun driver wajib diisi');
            return;
        }
        if (!accountForm.accountId && accountForm.password.length < 8) {
            addToast('error', 'Password minimal 8 karakter untuk akun driver baru');
            return;
        }
        if (accountForm.password && accountForm.password.length < 8) {
            addToast('error', 'Password minimal 8 karakter');
            return;
        }

        setSavingAccess(true);
        try {
            const res = await fetch('/api/driver/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: accountForm.accountId ? 'update' : 'create',
                    id: accountForm.accountId || undefined,
                    driverRef: accessDriver._id,
                    name: accountForm.name,
                    email: accountForm.email,
                    password: accountForm.password || undefined,
                    active: accountForm.active,
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyimpan akses mobile driver');
                return;
            }

            await loadDrivers();
            const stoppedTrackingCount = typeof payload.meta?.stoppedTrackingCount === 'number' ? payload.meta.stoppedTrackingCount : 0;
            const successMessage = accountForm.accountId
                ? stoppedTrackingCount > 0
                    ? `Akses mobile driver diperbarui | ${stoppedTrackingCount} tracking aktif dihentikan`
                    : 'Akses mobile driver diperbarui'
                : 'Akun mobile driver dibuat';
            addToast('success', successMessage);
            closeAccessModal();
        } catch {
            addToast('error', 'Gagal menyimpan akses mobile driver');
        } finally {
            setSavingAccess(false);
        }
    };

    const openEdit = (driver: Driver) => {
        setEditId(driver._id);
        setForm({
            name: driver.name,
            phone: driver.phone,
            licenseNumber: driver.licenseNumber,
            ktpNumber: driver.ktpNumber || '',
            simExpiry: driver.simExpiry || '',
            address: driver.address || '',
            active: driver.active !== false,
        });
        setShowModal(true);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Supir</h1></div>
                <div className="page-actions">
                    {canViewDriverScores && <Link className="btn btn-secondary" href="/fleet/drivers/skors">Skors Supir</Link>}
                    {canCreateDrivers && <button className="btn btn-primary" onClick={() => { setEditId(null); setShowModal(true); }}><Plus size={18} /> Tambah Supir</button>}
                </div></div>
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Supir Aktif</div><div className="kpi-value">{activeDrivers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">{canViewDriverAccounts ? 'Siap App Driver' : 'Total Supir'}</div><div className="kpi-value">{canViewDriverAccounts ? mobileReadyDrivers : totalDrivers}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Supir Nonaktif</div><div className="kpi-value">{inactiveDrivers}</div></div></div>
            </div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari nama, HP, SIM..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Nama</th><th>No. HP</th><th>No. SIM</th><th>SIM Berlaku</th><th>Scoring</th><th>Akses Mobile</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                totalDrivers === 0 ? <tr><td colSpan={8}><div className="empty-state"><UserCircle size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada supir</div></div></td></tr> :
                                    items.map(driver => {
                                        const account = accountByDriverRef.get(driver._id);
                                        const scoreSummary = scoreByDriverRef.get(driver._id) || null;
                                        const scoreStatusMeta = scoreSummary ? getDriverScoreStatusMeta(scoreSummary.score) : null;
                                        return (
                                            <tr key={driver._id}>
                                                <td>
                                                    <Link href={`/fleet/drivers/${driver._id}`} className="font-medium" style={{ color: 'var(--color-primary)' }}>
                                                        {driver.name}
                                                    </Link>
                                                </td>
                                                <td>{driver.phone}</td>
                                                <td>{driver.licenseNumber || '-'}</td>
                                                <td className="text-muted">{driver.simExpiry || '-'}</td>
                                                <td>
                                                    {scoreSummary && scoreStatusMeta ? (
                                                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                                                            <div className="font-medium">{DRIVER_SCORE_TYPE_META[scoreSummary.score.scoreType].label}</div>
                                                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                                <span className={`badge ${scoreStatusMeta.badgeClass}`}>{scoreStatusMeta.label}</span>
                                                                <span className="text-muted text-sm">Sampai {formatDate(scoreSummary.score.dueDate)}</span>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted">Belum ada scoring</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {!canViewDriverAccounts ? (
                                                        <span className="text-muted">Hanya owner / armada</span>
                                                    ) : account ? (
                                                        <div>
                                                            <div className="font-medium" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                                <Smartphone size={14} /> {account.email}
                                                            </div>
                                                            <div className="text-muted text-sm">
                                                                {isDriverAccountActive(account) ? 'Aktif' : 'Non-aktif'}
                                                                {account.lastLoginAt ? ` | Login terakhir ${formatDateTime(account.lastLoginAt)}` : ' | Belum pernah login'}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted">Belum ada akun mobile</span>
                                                    )}
                                                </td>
                                                <td><span className={`badge ${isDriverActive(driver) ? 'badge-success' : 'badge-gray'}`}>{isDriverActive(driver) ? 'Aktif' : 'Non-aktif'}</span></td>
                                                <td>
                                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                        <Link className="btn btn-ghost btn-sm" href={`/fleet/drivers/${driver._id}`} title="Lihat detail">
                                                            Detail
                                                        </Link>
                                                        {canManageDrivers && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(driver)} title="Edit"><Edit2 size={14} /></button>}
                                                        {canManageDriverAccounts && <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => openAccessModal(driver)}
                                                            title={isDriverActive(driver) ? 'Atur akses mobile' : 'Aktifkan supir dulu untuk mengatur akses mobile'}
                                                            disabled={!isDriverActive(driver) || togglingDriverId === driver._id}
                                                        >
                                                            <Smartphone size={14} />
                                                        </button>}
                                                        {canManageDrivers && <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(driver)} title={isDriverActive(driver) ? 'Nonaktifkan' : 'Aktifkan'} disabled={togglingDriverId === driver._id}>
                                                            {isDriverActive(driver) ? <ToggleRight size={14} className="text-green" /> : <ToggleLeft size={14} />}
                                                        </button>}
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
                        {totalDrivers === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada supir</div>
                            </div>
                        ) : items.map(driver => {
                            const account = accountByDriverRef.get(driver._id);
                            const scoreSummary = scoreByDriverRef.get(driver._id) || null;
                            const scoreStatusMeta = scoreSummary ? getDriverScoreStatusMeta(scoreSummary.score) : null;
                            return (
                                <div key={driver._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">
                                                <Link href={`/fleet/drivers/${driver._id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                                                    {driver.name}
                                                </Link>
                                            </div>
                                            <div className="mobile-record-subtitle">{driver.phone} | {driver.licenseNumber || 'SIM belum diisi'}</div>
                                        </div>
                                        <span className={`badge ${isDriverActive(driver) ? 'badge-success' : 'badge-gray'}`}>{isDriverActive(driver) ? 'Aktif' : 'Non-aktif'}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Scoring</span>
                                            <span className="mobile-record-value">
                                                {scoreSummary && scoreStatusMeta
                                                    ? `${DRIVER_SCORE_TYPE_META[scoreSummary.score.scoreType].label} | ${scoreStatusMeta.label} | s.d. ${formatDate(scoreSummary.score.dueDate)}`
                                                    : 'Belum ada scoring'}
                                            </span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">SIM Berlaku</span>
                                            <span className="mobile-record-value">{driver.simExpiry || '-'}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Akses Mobile</span>
                                            <span className="mobile-record-value">
                                                {!canViewDriverAccounts
                                                    ? 'Hanya owner / armada'
                                                    : account
                                                        ? `${account.email} | ${isDriverAccountActive(account) ? 'Aktif' : 'Non-aktif'}${account.lastLoginAt ? ` | Login ${formatDateTime(account.lastLoginAt)}` : ''}`
                                                        : 'Belum ada akun mobile'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <Link className="btn btn-secondary" href={`/fleet/drivers/${driver._id}`}>
                                            Detail
                                        </Link>
                                        {canViewDriverScores && <Link className="btn btn-secondary" href={`/fleet/drivers/skors?driverRef=${driver._id}`}>
                                            Skors
                                        </Link>}
                                        {canManageDrivers && <button className="btn btn-secondary" onClick={() => openEdit(driver)}>
                                            <Edit2 size={14} /> Edit
                                        </button>}
                                        {canManageDriverAccounts && <button
                                            className="btn btn-secondary"
                                            onClick={() => openAccessModal(driver)}
                                            disabled={!isDriverActive(driver) || togglingDriverId === driver._id}
                                        >
                                            <Smartphone size={14} /> Akses Mobile
                                        </button>}
                                        {canManageDrivers && <button className="btn btn-secondary" onClick={() => toggleActive(driver)} disabled={togglingDriverId === driver._id}>
                                            {isDriverActive(driver) ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                            {togglingDriverId === driver._id ? 'Menyimpan...' : (isDriverActive(driver) ? 'Nonaktifkan' : 'Aktifkan')}
                                        </button>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {totalDrivers > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalDrivers}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} supir</>
                        )}
                    />
                )}
            </div>

            {(canManageDrivers || canCreateDrivers) && showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editId ? 'Edit Supir' : 'Tambah Supir'}</h3><button className="modal-close" onClick={closeModal} disabled={savingDriver}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                Isi data identitas supir dulu. Akses mobile bisa diatur setelah data supir tersimpan.
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Nama <span className="required">*</span></label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">No. HP <span className="required">*</span></label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">No. SIM</label><input className="form-input" value={form.licenseNumber} onChange={e => setForm({ ...form, licenseNumber: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">SIM Berlaku Sampai</label><input type="date" className="form-input" value={form.simExpiry} onChange={e => setForm({ ...form, simExpiry: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">No. KTP</label><input className="form-input" value={form.ktpNumber} onChange={e => setForm({ ...form, ktpNumber: e.target.value })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeModal} disabled={savingDriver}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={savingDriver}><Save size={16} /> {savingDriver ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}

            {canManageDrivers && showAccessModal && accessDriver && (
                <div className="modal-overlay" onClick={closeAccessModal}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Akses Mobile Driver</h3>
                            <button className="modal-close" onClick={closeAccessModal} disabled={savingAccess}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                Gunakan bagian ini hanya jika supir memang perlu login ke aplikasi driver. Menonaktifkan akun mobile tidak menghapus data supir, hanya memutus akses login.
                            </div>
                            <div className="form-group">
                                <label className="form-label">Supir</label>
                                <input className="form-input" value={accessDriver.name} disabled />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Nama Akun Driver <span className="required">*</span></label>
                                <input className="form-input" value={accountForm.name} onChange={e => setAccountForm({ ...accountForm, name: e.target.value })} autoComplete="name" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Email Login Driver <span className="required">*</span></label>
                                <input className="form-input" type="email" value={accountForm.email} onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} autoComplete="username" placeholder="contoh: driver.andi@company.local" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">{accountForm.accountId ? 'Reset Password (opsional)' : 'Password Awal *'}</label>
                                <input className="form-input" type="password" value={accountForm.password} onChange={e => setAccountForm({ ...accountForm, password: e.target.value })} autoComplete="new-password" />
                                <div className="form-hint">Minimal 8 karakter. Driver login dari aplikasi mobile.</div>
                            </div>
                            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" checked={accountForm.active} onChange={e => setAccountForm({ ...accountForm, active: e.target.checked })} />
                                Akun mobile aktif
                            </label>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={closeAccessModal} disabled={savingAccess}>Batal</button>
                            <button className="btn btn-primary" onClick={saveDriverAccess} disabled={savingAccess}><Save size={16} /> {savingAccess ? 'Menyimpan...' : 'Simpan Akses'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

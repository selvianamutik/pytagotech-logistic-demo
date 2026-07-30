'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Edit2, Plus, Save, Search, Trash2, UserCircle, X } from 'lucide-react';

import FormattedNumberInput from '@/components/FormattedNumberInput';
import { useApp, useToast } from '../../../layout';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildDriverScoresQuery,
    computeDriverScoreDueDate,
    createDefaultDriverScoreForm,
    DRIVER_SCORE_TYPE_META,
    DRIVER_SCORE_TYPE_OPTIONS,
    getDriverScoreStatusMeta,
    parseDriverScoreDayCount,
    resolveDriverScoreStatus,
} from '@/lib/driver-scoring-support';
import { buildDriversQuery, isDriverActive } from '@/lib/fleet-asset-page-support';
import { hasPermission } from '@/lib/rbac';
import type { Driver, DriverScore } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DriverSkorsPage() {
    const searchParams = useSearchParams();
    const initialDriverRef = searchParams.get('driverRef') || '';
    const { user } = useApp();
    const { addToast } = useToast();
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [scores, setScores] = useState<DriverScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterDriverRef, setFilterDriverRef] = useState(initialDriverRef);
    const [showModal, setShowModal] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [form, setForm] = useState(createDefaultDriverScoreForm(initialDriverRef));

    const canCreateScores = user ? hasPermission(user, 'driverScores', 'create') : false;
    const canManageScores = user ? hasPermission(user, 'driverScores', 'update') : false;
    const canDeleteScores = user ? hasPermission(user, 'driverScores', 'delete') : false;

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [driverRows, scoreRows] = await Promise.all([
                fetchAllAdminCollectionData<Driver>(
                    `/api/data?${buildDriversQuery({ page: 1, pageSize: 500 })}`,
                    'Gagal memuat data supir'
                ),
                fetchAllAdminCollectionData<DriverScore>(
                    `/api/data?${buildDriverScoresQuery({ page: 1, pageSize: 500 })}`,
                    'Gagal memuat data skors supir'
                ),
            ]);
            setDrivers(driverRows);
            setScores(scoreRows);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data skors supir');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const activeDrivers = useMemo(
        () => drivers.filter(isDriverActive).sort((left, right) => left.name.localeCompare(right.name, 'id-ID')),
        [drivers]
    );

    const filteredScores = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        return scores.filter(score => {
            if (filterDriverRef && score.driverRef !== filterDriverRef) {
                return false;
            }
            if (!keyword) {
                return true;
            }
            return `${score.driverName || ''} ${score.notes || ''} ${score.scoreType}`.toLowerCase().includes(keyword);
        });
    }, [filterDriverRef, scores, search]);

    const activeScoreCount = useMemo(
        () => scores.filter(score => {
            const status = resolveDriverScoreStatus(score);
            return status === 'ACTIVE' || status === 'DUE_TODAY';
        }).length,
        [scores]
    );

    const dueDatePreview = useMemo(() => {
        if (form.scoreType === 'WARNING') {
            return form.effectiveDate;
        }
        const durationDays = parseDriverScoreDayCount(form.durationDays);
        if (!Number.isFinite(durationDays) || durationDays <= 0) {
            return '';
        }
        return computeDriverScoreDueDate(form.effectiveDate, durationDays);
    }, [form.durationDays, form.effectiveDate, form.scoreType]);

    const resetForm = useCallback((driverRef = filterDriverRef || initialDriverRef) => {
        setEditId(null);
        setForm(createDefaultDriverScoreForm(driverRef));
    }, [filterDriverRef, initialDriverRef]);

    const openCreateModal = useCallback(() => {
        resetForm();
        setShowModal(true);
    }, [resetForm]);

    const openEditModal = useCallback((score: DriverScore) => {
        setEditId(score._id);
        setForm({
            driverRef: score.driverRef,
            scoreType: score.scoreType,
            effectiveDate: score.effectiveDate,
            durationDays: score.scoreType === 'DAYS' ? `${score.durationDays}` : undefined,
            notes: score.notes || '',
        });
        setShowModal(true);
    }, []);

    const closeModal = useCallback(() => {
        if (saving) return;
        setShowModal(false);
        resetForm();
    }, [resetForm, saving]);

    const handleSave = useCallback(async () => {
        if (!form.driverRef) {
            addToast('error', 'Pilih supir aktif yang akan diberi warning atau skors');
            return;
        }

        if (form.scoreType !== 'WARNING' && form.scoreType !== 'DAYS') {
            addToast('error', 'Jenis skors supir wajib dipilih');
            return;
        }

        const durationDays = form.scoreType === 'WARNING' ? 1 : parseDriverScoreDayCount(form.durationDays);
        if (form.scoreType === 'DAYS' && (!Number.isFinite(durationDays) || durationDays <= 0)) {
            addToast('error', 'Durasi skors harus lebih besar dari 0 hari');
            return;
        }

        if (!form.effectiveDate) {
            addToast('error', 'Tanggal mulai skors wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const payloadBody = {
                driverRef: form.driverRef,
                scoreType: form.scoreType,
                effectiveDate: form.effectiveDate,
                ...(form.scoreType === 'DAYS' ? { durationDays } : {}),
                notes: form.notes,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editId
                        ? { entity: 'driver-scores', action: 'update', data: { id: editId, updates: payloadBody } }
                        : { entity: 'driver-scores', data: payloadBody }
                ),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyimpan data skors supir');
                return;
            }

            await loadData();
            addToast('success', editId ? 'Skors supir diperbarui' : 'Skors supir ditambahkan');
            closeModal();
        } catch {
            addToast('error', 'Gagal menyimpan data skors supir');
        } finally {
            setSaving(false);
        }
    }, [addToast, closeModal, editId, form, loadData]);

    const handleEndEarly = useCallback(async (score: DriverScore) => {
        const confirmMessage = score.scoreType === 'WARNING' 
            ? 'Selesaikan warning ini? Supir tidak akan melihat warning ini lagi.' 
            : 'Akhiri skors ini lebih awal? Supir akan langsung bisa mengakses aplikasi lagi.';
        
        if (!window.confirm(confirmMessage)) return;

        setLoading(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-scores',
                    action: 'end-early',
                    data: { id: score._id }
                }),
            });

            if (!res.ok) throw new Error('Gagal memperbarui status skors');

            await loadData();
            addToast('success', 'Skors telah diselesaikan lebih awal');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Terjadi kesalahan');
        } finally {
            setLoading(false);
        }
    }, [addToast, loadData]);

    const handleDelete = useCallback(async (score: DriverScore) => {
        const scoreLabel = score.scoreType === 'WARNING' ? 'warning' : 'skors';
        const confirmMessage = score.scoreType === 'WARNING'
            ? `Hapus warning untuk ${score.driverName || 'supir ini'}? Riwayat warning ini akan hilang permanen.`
            : `Hapus skors untuk ${score.driverName || 'supir ini'}? Skors yang sudah selesai pun akan dihapus dari riwayat.`;

        if (!window.confirm(confirmMessage)) return;

        setDeletingId(score._id);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-scores',
                    action: 'delete',
                    data: { id: score._id },
                }),
            });

            const payload = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(payload?.error || `Gagal menghapus ${scoreLabel} supir`);
            }

            await loadData();
            addToast('success', `${score.scoreType === 'WARNING' ? 'Warning' : 'Skors'} supir dihapus`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : `Gagal menghapus ${scoreLabel} supir`);
        } finally {
            setDeletingId(null);
        }
    }, [addToast, loadData]);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Warning & Skors Supir</h1>
                    <p className="page-subtitle">Kelola warning dan skors driver langsung dari area Supir.</p>
                </div>
                <div className="page-actions">
                    <Link className="btn btn-secondary" href="/fleet/drivers">Kembali ke Supir</Link>
                    {(canCreateScores || canManageScores) && (
                        <button className="btn btn-primary" onClick={openCreateModal}>
                            <Plus size={18} /> Tambah Skors
                        </button>
                    )}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Supir Aktif</div><div className="kpi-value">{activeDrivers.length}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Warning / Skors Aktif</div><div className="kpi-value">{activeScoreCount}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Riwayat</div><div className="kpi-value">{scores.length}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input placeholder="Cari nama supir atau catatan..." value={search} onChange={event => setSearch(event.target.value)} />
                        </div>
                        <select className="form-input" value={filterDriverRef} onChange={event => setFilterDriverRef(event.target.value)} style={{ minWidth: 220 }}>
                            <option value="">Semua supir</option>
                            {drivers.map(driver => (
                                <option key={driver._id} value={driver._id}>{driver.name}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead>
                            <tr>
                                <th>Supir</th>
                                <th>Jenis</th>
                                <th>Mulai Berlaku</th>
                                <th>Durasi</th>
                                <th>Sampai</th>
                                <th>Status</th>
                                <th>Catatan</th>
                                <th>Aksi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                [1, 2, 3].map(index => (
                                    <tr key={index}>{[1, 2, 3, 4, 5, 6, 7, 8].map(cell => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
                                ))
                            ) : filteredScores.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className="empty-state">
                                            <UserCircle size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada warning atau skors supir</div>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredScores.map(score => {
                                const status = resolveDriverScoreStatus(score);
                                const statusMeta = getDriverScoreStatusMeta(score);
                                return (
                                    <tr key={score._id}>
                                        <td><div className="font-medium">{score.driverName || '-'}</div></td>
                                        <td><span className={`badge ${DRIVER_SCORE_TYPE_META[score.scoreType].badgeClass}`}>{DRIVER_SCORE_TYPE_META[score.scoreType].label}</span></td>
                                        <td>{formatDate(score.effectiveDate)}</td>
                                        <td>{score.scoreType === 'WARNING' ? '-' : `${score.durationDays} hari`}</td>
                                        <td>{formatDate(score.dueDate)}</td>
                                        <td><span className={`badge ${statusMeta.badgeClass}`}>{statusMeta.label}</span></td>
                                        <td className="text-muted">{score.notes || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                {canManageScores && (status === 'ACTIVE' || status === 'DUE_TODAY') && (
                                                    <button 
                                                        className="btn btn-ghost btn-sm text-success" 
                                                        onClick={() => handleEndEarly(score)}
                                                        title="Selesaikan Sekarang"
                                                    >
                                                        <CheckCircle2 size={14} />
                                                    </button>
                                                )}
                                                {canManageScores && (
                                                    <button className="btn btn-ghost btn-sm" onClick={() => openEditModal(score)}>
                                                        <Edit2 size={14} />
                                                    </button>
                                                )}
                                                {canDeleteScores && (
                                                    <button
                                                        className="btn btn-ghost btn-sm text-danger"
                                                        onClick={() => handleDelete(score)}
                                                        disabled={deletingId === score._id}
                                                        title="Hapus"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
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
                        {filteredScores.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada warning atau skors supir</div>
                            </div>
                        ) : filteredScores.map(score => {
                            const status = resolveDriverScoreStatus(score);
                            const statusMeta = getDriverScoreStatusMeta(score);
                            return (
                                <div key={score._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{score.driverName || '-'}</div>
                                            <div className="mobile-record-subtitle">{DRIVER_SCORE_TYPE_META[score.scoreType].label}</div>
                                        </div>
                                        <span className={`badge ${statusMeta.badgeClass}`}>{statusMeta.label}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Mulai</span>
                                            <span className="mobile-record-value">{formatDate(score.effectiveDate)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Sampai</span>
                                            <span className="mobile-record-value">{formatDate(score.dueDate)}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Durasi</span>
                                            <span className="mobile-record-value">{score.scoreType === 'WARNING' ? '-' : `${score.durationDays} hari`}</span>
                                        </div>
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Catatan</span>
                                            <span className="mobile-record-value">{score.notes || '-'}</span>
                                        </div>
                                    </div>
                                    {canManageScores && (
                                        <div className="mobile-record-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                                            {(status === 'ACTIVE' || status === 'DUE_TODAY') && (
                                                <button className="btn btn-secondary" style={{ flex: 1, color: 'var(--color-success-600)' }} onClick={() => handleEndEarly(score)}>
                                                    <CheckCircle2 size={14} /> Selesaikan
                                                </button>
                                            )}
                                            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => openEditModal(score)}>
                                                <Edit2 size={14} /> Edit
                                            </button>
                                            {canDeleteScores && (
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ flex: 1, color: 'var(--color-danger-600)' }}
                                                    onClick={() => handleDelete(score)}
                                                    disabled={deletingId === score._id}
                                                >
                                                    <Trash2 size={14} /> {deletingId === score._id ? 'Menghapus...' : 'Hapus'}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {(canCreateScores || canManageScores) && showModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editId ? 'Edit Warning / Skors Supir' : 'Tambah Warning / Skors Supir'}</h3>
                            <button className="modal-close" onClick={closeModal} disabled={saving}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                Warning hanya muncul sekali lalu hilang setelah dibaca driver. Skors hari akan memblokir aplikasi driver sampai masa berlakunya selesai.
                            </div>
                            <div className="form-group">
                                <label className="form-label">Supir Aktif <span className="required">*</span></label>
                                <select className="form-input" value={form.driverRef} onChange={event => setForm(current => ({ ...current, driverRef: event.target.value }))}>
                                    <option value="">Pilih supir</option>
                                    {activeDrivers.map(driver => (
                                        <option key={driver._id} value={driver._id}>{driver.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Jenis <span className="required">*</span></label>
                                    <select className="form-input" value={form.scoreType} onChange={event => setForm(current => ({
                                        ...current,
                                        scoreType: event.target.value as DriverScore['scoreType'],
                                        durationDays: event.target.value === 'WARNING' ? undefined : (current.durationDays || '1'),
                                    }))}>
                                        {DRIVER_SCORE_TYPE_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                {form.scoreType === 'DAYS' && (
                                    <div className="form-group">
                                        <label className="form-label">Durasi Skors (hari) <span className="required">*</span></label>
                                        <FormattedNumberInput allowDecimal={false} value={Number(form.durationDays || 0)} onValueChange={value => setForm(current => ({ ...current, durationDays: value > 0 ? String(value) : '' }))} placeholder="1" />
                                    </div>
                                )}
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Mulai Berlaku <span className="required">*</span></label>
                                    <input type="date" className="form-input" value={form.effectiveDate} onChange={event => setForm(current => ({ ...current, effectiveDate: event.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Sampai</label>
                                    <input className="form-input" value={dueDatePreview ? formatDate(dueDatePreview) : '-'} disabled />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} placeholder="Contoh: telat muat, pelanggaran SOP, atau alasan skors" />
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

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Edit, Plus, Save, Search, ShieldCheck, Tags, X } from 'lucide-react';

import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import Combobox from '@/components/Combobox';
import { hasPermission } from '@/lib/rbac';
import type { AccountingAccountType, AccountingNormalBalance, ChartOfAccount } from '@/lib/types';

import { useApp, useToast } from '../../layout';

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountingAccountType; label: string }> = [
  { value: 'ASSET', label: 'Aset' },
  { value: 'LIABILITY', label: 'Kewajiban' },
  { value: 'EQUITY', label: 'Ekuitas' },
  { value: 'REVENUE', label: 'Pendapatan' },
  { value: 'EXPENSE', label: 'Beban' },
  { value: 'CONTRA_REVENUE', label: 'Kontra Pendapatan' },
];

const NORMAL_BALANCE_OPTIONS: Array<{ value: AccountingNormalBalance; label: string }> = [
  { value: 'DEBIT', label: 'Debit' },
  { value: 'CREDIT', label: 'Kredit' },
];

function getDefaultNormalBalance(accountType: AccountingAccountType): AccountingNormalBalance {
  return accountType === 'ASSET' || accountType === 'EXPENSE' || accountType === 'CONTRA_REVENUE' ? 'DEBIT' : 'CREDIT';
}

export default function ChartOfAccountsPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<ChartOfAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountingAccountType>('ASSET');
  const [normalBalance, setNormalBalance] = useState<AccountingNormalBalance>('DEBIT');
  const [active, setActive] = useState(true);
  const [description, setDescription] = useState('');

  const canCreateAccounts = user ? hasPermission(user, 'reports', 'create') : false;
  const canUpdateAccounts = user ? hasPermission(user, 'reports', 'update') : false;
  const canManageAccounts = canCreateAccounts && canUpdateAccounts;

  useEffect(() => {
    async function load() {
      try {
        const rows = await fetchAllAdminCollectionData<ChartOfAccount>(
          '/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc',
          'Gagal memuat akun perkiraan',
        );
        setAccounts(rows || []);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const reload = async () => {
    const rows = await fetchAllAdminCollectionData<ChartOfAccount>(
      '/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc',
      'Gagal memuat akun perkiraan',
    );
    setAccounts(rows || []);
  };

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return accounts;
    return accounts.filter(account =>
      `${account.code} ${account.name} ${account.accountType} ${account.systemKey || ''}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [accounts, search]);

  const openNew = () => {
    if (!canManageAccounts) return;
    setEditItem(null);
    setCode('');
    setName('');
    setAccountType('ASSET');
    setNormalBalance('DEBIT');
    setActive(true);
    setDescription('');
    setShowModal(true);
  };

  const openEdit = (account: ChartOfAccount) => {
    if (!canUpdateAccounts) return;
    setEditItem(account);
    setCode(account.code);
    setName(account.name);
    setAccountType(account.accountType);
    setNormalBalance(account.normalBalance);
    setActive(account.active !== false);
    setDescription(account.description || '');
    setShowModal(true);
  };

  const handleTypeChange = (nextType: AccountingAccountType) => {
    setAccountType(nextType);
    if (!editItem || nextType !== editItem.accountType || editItem.normalBalance === getDefaultNormalBalance(editItem.accountType)) {
      setNormalBalance(getDefaultNormalBalance(nextType));
    }
  };

  const handleSave = async () => {
    if (!canManageAccounts) {
      addToast('error', 'Tidak punya hak mengubah akun perkiraan');
      return;
    }
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      addToast('error', 'Kode akun wajib diisi');
      return;
    }
    if (!trimmedName) {
      addToast('error', 'Nama akun wajib diisi');
      return;
    }
    const payloadData = {
      code: trimmedCode,
      name: trimmedName,
      accountType,
      normalBalance,
      active,
      description: description.trim() || undefined,
    };
    setSaving(true);
    try {
      if (editItem) {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity: 'chart-of-accounts',
            action: 'update',
            data: { id: editItem._id, ...payloadData },
          }),
        });
        const payload = await res.json();
        if (!res.ok) {
          addToast('error', payload.error || 'Gagal memperbarui akun perkiraan');
          return;
        }
        await reload();
        addToast('success', 'Akun perkiraan diperbarui');
      } else {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity: 'chart-of-accounts', data: payloadData }),
        });
        const payload = await res.json();
        if (!res.ok) {
          addToast('error', payload.error || 'Gagal menambah akun perkiraan');
          return;
        }
        await reload();
        addToast('success', 'Akun perkiraan ditambahkan');
      }
      setShowModal(false);
    } catch {
      addToast('error', editItem ? 'Gagal memperbarui akun perkiraan' : 'Gagal menambah akun perkiraan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Akun Perkiraan</h1>
        </div>
        <div className="page-actions">
          {canCreateAccounts && (
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={18} /> Tambah Akun
            </button>
          )}
        </div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left accounting-filter-toolbar">
            <label className="table-search accounting-search">
              <Search className="table-search-icon" />
              <input
                className="form-input"
                style={{ paddingLeft: '2.5rem' }}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari kode, akun, tipe..."
              />
            </label>
          </div>
        </div>

        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama Akun</th>
                <th>Tipe</th>
                <th>Saldo Normal</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>)
                : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <Tags size={48} className="empty-state-icon" />
                          <div className="empty-state-title">Tidak ada akun</div>
                        </div>
                      </td>
                    </tr>
                  ) : filtered.map(account => (
                      <tr key={account._id}>
                        <td style={{ fontWeight: 700 }}>{account.code}</td>
                        <td>
                          {account.name}
                          {account.systemKey && <span className="badge badge-gray" style={{ marginLeft: '0.5rem' }}><ShieldCheck size={12} /> Sistem</span>}
                        </td>
                        <td>{ACCOUNT_TYPE_OPTIONS.find(option => option.value === account.accountType)?.label || account.accountType}</td>
                        <td>{account.normalBalance === 'DEBIT' ? 'Debit' : 'Kredit'}</td>
                        <td>
                          <span className={`badge badge-${account.active === false ? 'secondary' : 'success'}`}>
                            {account.active === false ? 'Nonaktif' : 'Aktif'}
                          </span>
                        </td>
                        <td>
                          {canUpdateAccounts && !account.systemKey ? (
                            <div className="table-actions-col">
                              <button className="table-action-btn" onClick={() => openEdit(account)}><Edit size={14} /> Edit</button>
                            </div>
                          ) : <span className="text-muted">Sistem</span>}
                        </td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>

        <div className="mobile-record-list">
          {filtered.map(account => (
            <article key={account._id} className="mobile-record-card">
              <div style={{ flex: 1 }}>
                <p className="mobile-record-title">{account.code} - {account.name}</p>
                <p className="mobile-record-subtitle">{ACCOUNT_TYPE_OPTIONS.find(option => option.value === account.accountType)?.label || account.accountType} | {account.normalBalance === 'DEBIT' ? 'Debit' : 'Kredit'}{account.systemKey ? ' | Sistem' : ''}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                <span className={`badge badge-${account.active === false ? 'secondary' : 'success'}`}>
                  {account.active === false ? 'Nonaktif' : 'Aktif'}
                </span>
                {canUpdateAccounts && !account.systemKey && (
                  <button className="table-action-btn" onClick={() => openEdit(account)}><Edit size={14} /> Edit</button>
                )}
              </div>
            </article>
          ))}
          {!loading && filtered.length === 0 && (
            <article className="mobile-record-card">
              <p className="mobile-record-title">Tidak ada akun.</p>
            </article>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{editItem ? 'Edit' : 'Tambah'} Akun Perkiraan</h3>
              <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Kode Akun</label>
                  <input className="form-input" value={code} onChange={event => setCode(event.target.value)} autoFocus disabled={saving} placeholder="Contoh: 1100" />
                </div>
                <div className="form-group">
                  <label className="form-label">Nama Akun</label>
                  <input className="form-input" value={name} onChange={event => setName(event.target.value)} disabled={saving} placeholder="Contoh: Kas Kecil" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tipe Akun</label>
                  <Combobox className="form-select" value={accountType} onChange={(v: string) => handleTypeChange(v as AccountingAccountType)} options={ACCOUNT_TYPE_OPTIONS} disabled={saving} />
                </div>
                <div className="form-group">
                  <label className="form-label">Saldo Normal</label>
                  <Combobox className="form-select" value={normalBalance} onChange={(v: string) => setNormalBalance(v as AccountingNormalBalance)} options={NORMAL_BALANCE_OPTIONS} disabled={saving} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Deskripsi</label>
                <input className="form-input" value={description} onChange={event => setDescription(event.target.value)} disabled={saving} placeholder="Opsional" />
              </div>
              {editItem && (
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <Combobox className="form-select" value={active ? 'active' : 'inactive'} onChange={(v: string) => setActive(v === 'active')} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} disabled={saving} />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
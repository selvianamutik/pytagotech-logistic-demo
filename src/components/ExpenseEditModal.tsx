'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, X } from 'lucide-react';
import { useToast } from '@/app/(admin)/layout';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { getBusinessDateValue } from '@/lib/business-date';
import { isManualExpenseCategory } from '@/lib/expense-category-scope';
import { fetchOptionalCollection } from '@/lib/expense-related-docs';
import type { BankAccount, Expense, ExpenseCategory } from '@/lib/types';

type ExpenseEditForm = {
    categoryRef: string;
    date: string;
    amount: number;
    note: string;
    privacyLevel: 'internal' | 'ownerOnly';
    bankAccountRef: string;
    bankAccountName: string;
};

type ExpenseEditModalProps = {
    expense: Expense;
    open: boolean;
    isOwner: boolean;
    onClose: () => void;
    onSaved: (updated: Expense) => void;
};

function buildEditForm(expense: Expense): ExpenseEditForm {
    return {
        categoryRef: expense.categoryRef || '',
        date: expense.date || getBusinessDateValue(),
        amount: expense.amount || 0,
        note: expense.note || '',
        privacyLevel: expense.privacyLevel === 'ownerOnly' ? 'ownerOnly' : 'internal',
        bankAccountRef: expense.bankAccountRef || '',
        bankAccountName: expense.bankAccountName || '',
    };
}

export default function ExpenseEditModal({
    expense,
    open,
    isOwner,
    onClose,
    onSaved,
}: ExpenseEditModalProps) {
    const { addToast } = useToast();
    const [manualCategories, setManualCategories] = useState<ExpenseCategory[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loadingData, setLoadingData] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<ExpenseEditForm>(() => buildEditForm(expense));

    useEffect(() => {
        if (!open || !expense) return;
        setSaving(false);
        setForm(buildEditForm(expense));
        setManualCategories([]);
        setBankAccounts([]);
        setLoadingData(true);
        let cancelled = false;
        void Promise.all([
            fetchOptionalCollection<ExpenseCategory[]>('/api/data?entity=expense-categories', []),
            fetchOptionalCollection<BankAccount[]>('/api/data?entity=bank-accounts', []),
        ])
            .then(([categoryRows, accountRows]) => {
                if (cancelled) return;
                setManualCategories((categoryRows || []).filter(category => category.active !== false && isManualExpenseCategory(category)));
                setBankAccounts((accountRows || []).filter(account => account.active !== false));
            })
            .catch(() => {
                if (cancelled) return;
                setManualCategories([]);
                setBankAccounts([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingData(false);
            });
        return () => {
            cancelled = true;
        };
    }, [expense, open]);

    const accountOptions = useMemo(() => {
        const accounts = [...bankAccounts];
        if (expense?.bankAccountRef && !accounts.some(account => account._id === expense.bankAccountRef)) {
            accounts.push({
                _id: expense.bankAccountRef,
                bankName: expense.bankAccountName || 'Rekening',
                accountNumber: expense.bankAccountNumber || '',
                accountType: 'BANK',
                active: false,
            } as BankAccount);
        }
        return accounts;
    }, [bankAccounts, expense]);

    const selectedAccount = accountOptions.find(account => account._id === form.bankAccountRef);
    const hasValidBankRef = !form.bankAccountRef || Boolean(selectedAccount);
    const isFormValid = Boolean(
        form.categoryRef
        && manualCategories.some(category => category._id === form.categoryRef)
        && form.date
        && /^\d{4}-\d{2}-\d{2}$/.test(form.date)
        && Number(form.amount) > 0
        && hasValidBankRef
    );

    const handleSave = async () => {
        if (!expense) return;
        const category = manualCategories.find(item => item._id === form.categoryRef);
        if (!category) {
            addToast('error', 'Kategori tidak valid');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'expenses',
                    action: 'update',
                    data: {
                        _id: expense._id,
                        categoryRef: form.categoryRef,
                        categoryName: category.name,
                        date: form.date,
                        amount: form.amount,
                        note: form.note,
                        privacyLevel: form.privacyLevel,
                        bankAccountRef: form.bankAccountRef || '',
                        bankAccountName: selectedAccount?.bankName || '',
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal menyimpan perubahan pengeluaran');
                return;
            }
            addToast('success', 'Pengeluaran diperbarui');
            onSaved(payload.data as Expense);
            onClose();
        } catch {
            addToast('error', 'Gagal menyimpan perubahan pengeluaran');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-header"><h3 className="modal-title">Edit Pengeluaran</h3><button className="modal-close" onClick={onClose} disabled={saving}><X size={20} /></button></div>
                <div className="modal-body">
                    {loadingData && <div className="skeleton skeleton-text" style={{ marginBottom: '1rem' }} />}
                    <div className="form-group"><label className="form-label">Kategori <span className="required">*</span></label>
                        <select className="form-select" value={form.categoryRef} onChange={event => setForm({ ...form, categoryRef: event.target.value })} disabled={saving || loadingData}>
                            <option value="">Pilih kategori umum</option>{manualCategories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}
                        </select>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} disabled={saving} /></div>
                        <div className="form-group"><label className="form-label">Nominal <span className="required">*</span></label><FormattedNumberInput allowDecimal={false} value={form.amount} onValueChange={value => setForm({ ...form, amount: value })} disabled={saving} placeholder="Ketik nominal pengeluaran" /></div>
                    </div>
                    <div className="form-group"><label className="form-label">Catatan/Deskripsi</label><textarea className="form-textarea" rows={2} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} disabled={saving} /></div>
                    <div className="form-group"><label className="form-label">Sumber Dana</label>
                        <select className="form-select" value={form.bankAccountRef} onChange={event => {
                            const account = accountOptions.find(item => item._id === event.target.value);
                            setForm({ ...form, bankAccountRef: event.target.value, bankAccountName: account?.bankName || '' });
                        }} disabled={saving || loadingData}>
                            <option value="">Tanpa rekening (hutang biaya)</option>
                            {accountOptions.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}{account.active === false ? ' (non-aktif)' : ''}</option>)}
                        </select>
                        <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                            {form.bankAccountRef
                                ? 'Saldo rekening/kas akan terkoreksi mengikuti nominal baru.'
                                : 'Tidak mengurangi kas sekarang; masuk catatan hutang biaya.'}
                        </div>
                    </div>
                    {isOwner && <div className="form-group"><label className="form-label">Privacy Level</label>
                        <select className="form-select" value={form.privacyLevel} onChange={event => setForm({ ...form, privacyLevel: event.target.value as 'internal' | 'ownerOnly' })} disabled={saving}>
                            <option value="internal">Internal</option><option value="ownerOnly">Owner Only</option>
                        </select>
                    </div>}
                </div>
                <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving || loadingData || !isFormValid}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button></div>
            </div>
        </div>
    );
}
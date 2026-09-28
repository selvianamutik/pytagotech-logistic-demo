'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import Combobox from '@/components/Combobox';
import { useApp, useToast } from '@/app/(admin)/layout';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { getSuratJalanActualDropDestinations } from '@/lib/surat-jalan-destination';
import type { SuratJalanDocument } from '@/lib/trip-document-types';
import { hasPermission } from '@/lib/rbac';
import type { Customer } from '@/lib/types';

interface SuratJalanPostDeliveryEditButtonProps {
    row: SuratJalanDocument;
    onSaved?: () => void;
}

export default function SuratJalanPostDeliveryEditButton({ row, onSaved }: SuratJalanPostDeliveryEditButtonProps) {
    const { user } = useApp();
    const { addToast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([]);
    const [customerRef, setCustomerRef] = useState(row.customerRef || '');
    const [customerName, setCustomerName] = useState(row.customerName || '');
    const [dropPointName, setDropPointName] = useState(
        getSuratJalanActualDropDestinations(row)[0] || ''
    );

    const canEdit = row.tripStatus === 'DELIVERED' && (user ? hasPermission(user, 'suratJalan', 'update') : false);
    if (!canEdit) return null;

    const dropPointOptions = getSuratJalanActualDropDestinations(row).map(destination => ({
        value: destination,
        label: destination,
    }));

    async function openPicker() {
        if (loading) return;
        setLoading(true);
        try {
            const customers = await fetchAdminCollectionData<Customer[]>(
                '/api/data?entity=customers',
                'Gagal memuat daftar customer.'
            );
            setCustomerOptions(
                customers
                    .filter(customer => customer.active)
                    .map(customer => ({ value: customer._id, label: customer.name }))
            );
            setIsOpen(true);
        } catch {
            // Tanpa catch, penolakan ini jadi unhandled rejection karena
            // openPicker dipanggil dari onClick.
            addToast('error', 'Daftar customer tidak bisa dimuat.');
        } finally {
            setLoading(false);
        }
    }

    function handleCustomerChange(value: string) {
        setCustomerRef(value);
        const matched = customerOptions.find(option => option.value === value);
        setCustomerName(matched ? matched.label : '');
    }

    async function save() {
        if (saving || !customerRef || !customerName || !dropPointName) return;
        setSaving(true);
        try {
            const res = await fetch('/api/surat-jalan/edit-delivered', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sjRef: row._id,
                    customerRef,
                    customerName,
                    dropPointName,
                }),
            });
            const payload = await res.json().catch(() => null);
            if (!res.ok) {
                addToast('error', payload?.error || 'Gagal menyimpan perubahan.');
                return;
            }
            addToast('success', 'Customer dan drop point SJ diperbarui.');
            setIsOpen(false);
            onSaved?.();
        } catch {
            addToast('error', 'Gagal menyimpan perubahan.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <button
                type="button"
                className="table-action-btn"
                onClick={() => void openPicker()}
                disabled={loading}
                title="Edit customer dan drop point setelah SJ terkirim"
            >
                <Pencil size={14} /> {loading ? 'Memuat...' : 'Edit'}
            </button>

            {isOpen && (
                <div className="modal-overlay" onClick={() => { if (!saving) setIsOpen(false); }}>
                    <div className="modal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit SJ pasca terkirim</h3>
                            <button
                                type="button"
                                className="modal-close"
                                onClick={() => setIsOpen(false)}
                                aria-label="Tutup"
                                disabled={saving}
                            >
                                &times;
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Customer tujuan</label>
                                <Combobox
                                    value={customerName}
                                    onChange={handleCustomerChange}
                                    options={customerOptions}
                                    placeholder="Pilih customer..."
                                    allowCustomValue={false}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Drop point</label>
                                <Combobox
                                    value={dropPointName}
                                    onChange={setDropPointName}
                                    options={dropPointOptions}
                                    placeholder="Pilih atau ketik drop point..."
                                    allowCustomValue
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setIsOpen(false)}
                            >
                                Batal
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => void save()}
                                disabled={!customerRef || !customerName || !dropPointName || saving}
                            >
                                {saving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

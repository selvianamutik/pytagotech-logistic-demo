'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '../../layout';
import { Save } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import Combobox from '@/components/Combobox';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { buildDriverVoucherRouteLabel } from '@/lib/driver-voucher-route';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import type { BankAccount, Driver, DeliveryOrder, DriverVoucher, Order } from '@/lib/types';
import { formatCurrency, formatShipperDeliveryOrderNumber, getShipperReferenceCount } from '@/lib/utils';

export default function NewDriverVoucherPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { addToast } = useToast();
    const returnToParam = searchParams.get('returnTo') || '';
    const safeReturnTo =
        returnToParam && returnToParam.startsWith('/') && !returnToParam.startsWith('//')
            ? returnToParam
            : '';
    const fallbackHref = safeReturnTo || '/driver-vouchers';
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [usedVoucherDoRefs, setUsedVoucherDoRefs] = useState<string[]>([]);
    const [usedBoronganDoRefs, setUsedBoronganDoRefs] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const prefilledDeliveryOrderRef = searchParams.get('deliveryOrderRef') || '';
    const appliedPrefillRef = useRef(false);
    const [form, setForm] = useState({
        deliveryOrderRef: prefilledDeliveryOrderRef,
        issueBankRef: '',
        issuedDate: getBusinessDateValue(),
        cashGiven: 0,
        notes: '',
    });

    useEffect(() => {
        Promise.all([
            fetchAdminCollectionData<Driver[]>('/api/data?entity=drivers', 'Gagal memuat form uang jalan trip'),
            fetchAdminCollectionData<DeliveryOrder[]>('/api/data?entity=delivery-orders', 'Gagal memuat form uang jalan trip'),
            fetchAdminCollectionData<Order[]>('/api/data?entity=orders', 'Gagal memuat form uang jalan trip'),
            fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat form uang jalan trip'),
            fetchAdminCollectionData<DriverVoucher[]>('/api/data?entity=driver-vouchers', 'Gagal memuat form uang jalan trip'),
            fetch('/api/data?entity=driver-borongan-do-refs')
                .then(async response => {
                    const payload = await response.json();
                    if (!response.ok) {
                        throw new Error(payload.error || 'Gagal memuat form uang jalan trip');
                    }
                    return (payload.data?.doRefs || []) as string[];
                }),
        ]).then(([driverRows, deliveryOrders, orderRows, accountRows, voucherRows, boronganDoRefs]) => {
            const activeAccounts = (accountRows || []).filter((account) => account.active !== false);
            setDrivers((driverRows || []).filter((driver) => driver.active !== false));
            setDos((deliveryOrders || []).filter((deliveryOrder) => ['CREATED', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(deliveryOrder.status)));
            setOrders(orderRows || []);
            setBankAccounts(activeAccounts);
            setUsedVoucherDoRefs(
                (voucherRows || [])
                    .map(voucher => voucher.deliveryOrderRef)
                    .filter((value): value is string => Boolean(value))
            );
            setUsedBoronganDoRefs(boronganDoRefs || []);
            if (prefilledDeliveryOrderRef) {
                const matchedDo = (deliveryOrders || []).find(deliveryOrder => deliveryOrder._id === prefilledDeliveryOrderRef);
                const plannedCashGiven = parseFormattedNumberish(matchedDo?.plannedTripCashGiven ?? 0, { allowDecimal: false, maxFractionDigits: 0 });
                const plannedIssueBankRef = matchedDo?.plannedTripIssueBankRef || '';
                const hasPlannedIssueBank = plannedIssueBankRef
                    ? activeAccounts.some(account => account._id === plannedIssueBankRef)
                    : false;
                setForm(previous => ({
                    ...previous,
                    cashGiven: plannedCashGiven > 0 ? plannedCashGiven : previous.cashGiven,
                    issueBankRef: hasPlannedIssueBank ? plannedIssueBankRef : previous.issueBankRef,
                }));
            }
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form uang jalan trip');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast, prefilledDeliveryOrderRef]);

    const eligibleDos = dos
        .filter(deliveryOrder =>
            Boolean(deliveryOrder.driverRef) &&
            Boolean(deliveryOrder.vehicleRef || deliveryOrder.vehiclePlate) &&
            !usedVoucherDoRefs.includes(deliveryOrder._id) &&
            !usedBoronganDoRefs.includes(deliveryOrder._id)
        )
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    useEffect(() => {
        if (loading || appliedPrefillRef.current || !prefilledDeliveryOrderRef) {
            return;
        }

        appliedPrefillRef.current = true;

        const matchedEligibleDo = eligibleDos.find(deliveryOrder => deliveryOrder._id === prefilledDeliveryOrderRef);
        if (matchedEligibleDo) {
            return;
        }

        const matchedDo = dos.find(deliveryOrder => deliveryOrder._id === prefilledDeliveryOrderRef);
        if (!matchedDo) {
            addToast('error', 'Surat jalan yang dipilih tidak ditemukan atau sudah tidak bisa dipakai');
            return;
        }

        const blockingReasons = [
            usedVoucherDoRefs.includes(prefilledDeliveryOrderRef) ? 'DO ini sudah punya uang jalan trip' : null,
            usedBoronganDoRefs.includes(prefilledDeliveryOrderRef) ? 'DO ini sudah masuk arsip borongan' : null,
            !matchedDo.driverRef ? 'supir trip belum diisi' : null,
            !matchedDo.vehicleRef && !matchedDo.vehiclePlate ? 'kendaraan trip belum diisi' : null,
        ].filter((value): value is string => Boolean(value));

        addToast(
            'error',
            blockingReasons.length > 0
                ? `Surat jalan ini belum bisa dipakai: ${blockingReasons.join('; ')}`
                : 'Surat jalan ini belum bisa dipakai untuk uang jalan trip'
        );
    }, [
        addToast,
        dos,
        eligibleDos,
        loading,
        prefilledDeliveryOrderRef,
        usedBoronganDoRefs,
        usedVoucherDoRefs,
    ]);

    const selectedDeliveryOrderRef = eligibleDos.some(deliveryOrder => deliveryOrder._id === form.deliveryOrderRef)
        ? form.deliveryOrderRef
        : '';
    const selectedDo = eligibleDos.find((deliveryOrder) => deliveryOrder._id === form.deliveryOrderRef) || null;
    const selectedOrder = selectedDo?.orderRef
        ? orders.find((order) => order._id === selectedDo.orderRef)
        : null;
    const selectedDriver = selectedDo?.driverRef
        ? drivers.find((driver) => driver._id === selectedDo.driverRef)
        : null;
    const selectedDriverName = selectedDo?.driverName || selectedDriver?.name || '';
    const selectedVehicleLabel = selectedDo?.vehiclePlate || '';
    const selectedRoute = buildDriverVoucherRouteLabel(selectedDo, selectedOrder) || '';
    const effectiveTripFee = parseFormattedNumberish(selectedDo?.taripBorongan || 0);
    const plannedTripCashGiven = parseFormattedNumberish(selectedDo?.plannedTripCashGiven ?? 0, { allowDecimal: false, maxFractionDigits: 0 });

    const handleSave = async () => {
        if (!form.deliveryOrderRef) {
            addToast('error', 'Pilih DO internal / trip terlebih dahulu');
            return;
        }
        if (!form.cashGiven || form.cashGiven <= 0) {
            addToast('error', 'Nominal uang harus diisi');
            return;
        }
        if (!form.issueBankRef) {
            addToast('error', 'Pilih rekening sumber bon');
            return;
        }
        if (!selectedDo) {
            addToast('error', 'DO internal / trip tidak valid atau sudah tidak bisa dipakai');
            return;
        }
        if (effectiveTripFee <= 0) {
            addToast('error', 'Isi upah borongan terlebih dahulu');
            return;
        }

        setSaving(true);

        const voucherData = {
            deliveryOrderRef: form.deliveryOrderRef,
            issuedDate: form.issuedDate,
            cashGiven: form.cashGiven,
            issueBankRef: form.issueBankRef,
            notes: form.notes || undefined,
        };

        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'driver-vouchers', data: voucherData }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal membuat uang jalan trip');
                setSaving(false);
                return;
            }

            addToast('success', `Bon ${result.data?.bonNumber || ''} berhasil dibuat`);
            const detailHref = `/driver-vouchers/${result.data._id}${safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : ''}`;
            router.push(detailHref);
        } catch {
            addToast('error', 'Gagal membuat uang jalan trip');
            setSaving(false);
            return;
        }
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/driver-vouchers" />
                    <h1 className="page-title">Buat Uang Jalan Trip</h1>
                </div>
            </div>

            <div className="card">
                <div className="card-body">
                    <div className="form-section-title">Data Uang Jalan Trip</div>
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">DO Internal / Trip <span className="required">*</span></label>
                            <Combobox
                                className="form-select"
                                value={selectedDeliveryOrderRef}
                                onChange={(v: string) => {
                                    const deliveryOrderRef = v;
                                    const nextDo = eligibleDos.find(deliveryOrder => deliveryOrder._id === deliveryOrderRef) || null;
                                    const nextPlannedCashGiven = parseFormattedNumberish(nextDo?.plannedTripCashGiven ?? 0, { allowDecimal: false, maxFractionDigits: 0 });
                                    const nextPlannedIssueBankRef = nextDo?.plannedTripIssueBankRef || '';
                                    const hasNextPlannedIssueBank = nextPlannedIssueBankRef
                                        ? bankAccounts.some(account => account._id === nextPlannedIssueBankRef)
                                        : false;
                                    setForm(previous => ({
                                        ...previous,
                                        deliveryOrderRef,
                                        cashGiven: nextPlannedCashGiven > 0 ? nextPlannedCashGiven : 0,
                                        issueBankRef: hasNextPlannedIssueBank ? nextPlannedIssueBankRef : '',
                                    }));
                                }}
                                placeholder="Pilih DO internal / trip"
                                options={eligibleDos.map(deliveryOrder => {
                                    const order = deliveryOrder.orderRef
                                        ? orders.find(item => item._id === deliveryOrder.orderRef)
                                        : null;
                                    const route = buildDriverVoucherRouteLabel(deliveryOrder, order);
                                    return {
                                        value: deliveryOrder._id,
                                        label: `${deliveryOrder.doNumber}${getShipperReferenceCount(deliveryOrder) > 0 ? ` | SJ ${formatShipperDeliveryOrderNumber(deliveryOrder)}` : ''} | ${deliveryOrder.driverName || drivers.find(driver => driver._id === deliveryOrder.driverRef)?.name || '-'} | ${deliveryOrder.vehiclePlate || '-'}${route ? ` | ${route}` : ''}`,
                                    };
                                })}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Tanggal</label>
                            <input type="date" className="form-input" value={form.issuedDate} onChange={e => setForm({ ...form, issuedDate: e.target.value })} />
                        </div>
                    </div>
                    {selectedDo && (
                        <div className="card" style={{ marginTop: 'var(--space-4)', background: 'var(--color-bg-secondary)' }}>
                            <div className="card-body" style={{ padding: 'var(--space-4)' }}>
                                <div style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Trip Terpilih</div>
                                <div className="responsive-stat-grid">
                                    <div>
                                        <div className="detail-label">Supir</div>
                                        <div className="detail-value">{selectedDriverName || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="detail-label">Kendaraan</div>
                                        <div className="detail-value">{selectedVehicleLabel || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="detail-label">Rute</div>
                                        <div className="detail-value">{selectedRoute || '-'}</div>
                                    </div>
                                    <div>
                                        <div className="detail-label">Upah Borongan</div>
                                        <div className="detail-value">{effectiveTripFee > 0 ? formatCurrency(effectiveTripFee) : 'Belum diisi di DO'}</div>
                                    </div>
                                    <div>
                                        <div className="detail-label">Uang Jalan Awal Rencana</div>
                                        <div className="detail-value">{plannedTripCashGiven > 0 ? formatCurrency(plannedTripCashGiven) : 'Belum diisi di DO'}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="form-row" style={{ marginTop: 'var(--space-4)' }}>
                        <div className="form-group">
                            <label className="form-label">Rekening / Kas Sumber <span className="required">*</span></label>
                            <Combobox className="form-select" value={form.issueBankRef} onChange={(v: string) => setForm({ ...form, issueBankRef: v })} placeholder="Pilih rekening atau kas" options={bankAccounts.map(account => ({ value: account._id, label: `${account.bankName} - ${account.accountNumber}${account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}` }))} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Uang Jalan Awal <span className="required">*</span></label>
                            <FormattedNumberInput allowDecimal={false} value={form.cashGiven} onValueChange={value => setForm({ ...form, cashGiven: value })} placeholder="Ketik uang jalan awal" />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Upah Borongan <span className="required">*</span></label>
                        <input
                            className="form-input"
                            value={effectiveTripFee > 0 ? formatCurrency(effectiveTripFee) : 'Belum diisi di DO'}
                            readOnly
                        />
                        <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>
                            Upah borongan mengikuti DO dan master biaya rute trip. Untuk mengubah nominal ini, edit DO sebelum uang jalan trip diterbitkan.
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Catatan</label>
                        <textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Catatan tambahan..." />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: 'var(--space-4)' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => router.push(fallbackHref)}>Batal</button>
                        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Buat Uang Jalan Trip'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

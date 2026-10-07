'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../../layout';
import { Plus, Save, X } from 'lucide-react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import type { Order, Customer, CustomerPickupLocation, CustomerProduct, Service, DeliveryOrder, OrderItem } from '@/lib/types';
import {
    formatCargoSummary,
    getWeightInputFractionDigits,
    VOLUME_INPUT_UNIT_OPTIONS,
    WEIGHT_INPUT_UNIT_OPTIONS,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import {
    applyCustomerPickupMasterSelection,
    applyCustomerPickupToStop,
    applyOrderItemAutoWeightFromQty,
    createDefaultOrderItemForm,
    createDefaultPickupStopForm,
    findDefaultCustomerPickup,
    getDraftPickupStops,
    getPickupStopMasterValue,
    MANUAL_PICKUP_MASTER_LABEL,
    MANUAL_PICKUP_MASTER_VALUE,
    sortCustomerPickups,
    summarizePickupStopList,
    applyOrderItemPickerSelection,
    getOrderItemPickerValue,
    MANUAL_ITEM_OPTION_VALUE,
    shouldLockOrderItemVolume,
    shouldLockOrderItemWeight,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
    type OrderItemForm,
    type PickupStopForm,
} from '@/lib/order-create-page-support';
import {
    buildOrderEditForm,
    getOrderEditItems,
    hasOrderItemOperationalProgress,
    resolvePickupAddressForCustomer,
    summarizeOrderEditTargetCargo,
    type OrderEditFormState,
} from '@/lib/order-edit-page-support';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import Combobox from '@/components/Combobox';

function getPrimaryPickupStop(stops: PickupStopForm[]) {
    return getDraftPickupStops(stops)[0] || stops[0] || createDefaultPickupStopForm();
}

function syncPickupFields(form: OrderEditFormState, pickupStops: PickupStopForm[]): OrderEditFormState {
    const primaryStop = getPrimaryPickupStop(pickupStops);
    return {
        ...form,
        pickupStops,
        customerPickupRef: primaryStop.customerPickupRef || '',
        pickupAddress: primaryStop.pickupAddress || '',
    };
}

function buildPickupStopsPayload(stops: PickupStopForm[]) {
    return getDraftPickupStops(stops).map((stop, index) => ({
        _key: stop.id,
        sequence: index + 1,
        customerPickupRef: stop.customerPickupRef || undefined,
        pickupLabel: stop.pickupLabel.trim() || undefined,
        pickupAddress: stop.pickupAddress.trim(),
        notes: stop.notes.trim() || undefined,
    }));
}

export default function OrderEditPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const orderId = params.id as string;
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [customerScopedMastersLoaded, setCustomerScopedMastersLoaded] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [hasDeliveryOrders, setHasDeliveryOrders] = useState(false);
    const [hasOperationalProgress, setHasOperationalProgress] = useState(false);
    const [shouldAutoApplyDefaultPickup, setShouldAutoApplyDefaultPickup] = useState(false);
    const [revisionReason, setRevisionReason] = useState('');
    const [form, setForm] = useState<OrderEditFormState>(buildOrderEditForm(null));
    const [items, setItems] = useState<OrderItemForm[]>([]);

    useEffect(() => {
        Promise.all([
            fetchAdminData<Order | null>(`/api/data?entity=orders&id=${orderId}`, 'Gagal memuat form edit order'),
            fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat form edit order'),
            fetchAdminCollectionData<Service[]>('/api/data?entity=services', 'Gagal memuat form edit order'),
            fetchAdminCollectionData<DeliveryOrder[]>(`/api/data?entity=delivery-orders&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat form edit order'),
            fetchAdminCollectionData<OrderItem[]>(`/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: orderId }))}`, 'Gagal memuat form edit order'),
        ]).then(([order, customerRows, serviceRows, deliveryOrders, orderItems]) => {
            const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, orderItems || []);
            setForm({
                ...buildOrderEditForm(order),
                cargoEntryMode: resolvedCargoEntryMode,
            });
            setItems(resolvedCargoEntryMode === 'DELIVERY_ORDER' ? [] : getOrderEditItems(orderItems || []));
            setCustomers((customerRows || []).filter(customer => customer.active !== false || customer._id === order?.customerRef));
            setServices((serviceRows || []).filter(service => service.active !== false || service._id === order?.serviceRef));
            setHasDeliveryOrders((deliveryOrders || []).length > 0);
            setHasOperationalProgress(hasOrderItemOperationalProgress(orderItems || []));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form edit order');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast, orderId]);

    useEffect(() => {
        const scopedCustomerRefs = [form.customerRef, ...form.additionalCustomerRefs].filter(Boolean);
        if (scopedCustomerRefs.length === 0) {
            setCustomerProducts([]);
            setCustomerPickups([]);
            setCustomerScopedMastersLoaded(false);
            return;
        }

        let cancelled = false;
        setCustomerScopedMastersLoaded(false);
        const loadCustomerScopedMasters = async () => {
            try {
                // Masters are loaded per customer so items and pickups remain selectable for every
                // customer on the order, then merged and deduped.
                const [productsPerCustomer, pickupsPerCustomer] = await Promise.all([
                    Promise.all(scopedCustomerRefs.map(ref =>
                        fetchAdminCollectionData<CustomerProduct[]>(
                            `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: ref, active: true }))}`,
                            'Gagal memuat master customer'
                        )
                    )),
                    Promise.all(scopedCustomerRefs.map(ref =>
                        fetchAdminCollectionData<CustomerPickupLocation[]>(
                            `/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef: ref, active: true }))}`,
                            'Gagal memuat master customer'
                        )
                    )),
                ]);
                const mergeById = <T extends { _id: string }>(rowsPerCustomer: Array<T[] | null | undefined>) => Array.from(
                    new Map(
                        rowsPerCustomer
                            .flatMap(rows => rows || [])
                            .map(row => [row._id, row])
                    ).values()
                );
                if (!cancelled) {
                    setCustomerProducts(mergeById(productsPerCustomer));
                    setCustomerPickups(mergeById(pickupsPerCustomer));
                    setCustomerScopedMastersLoaded(true);
                }
            } catch (error) {
                if (!cancelled) {
                    setCustomerProducts([]);
                    setCustomerPickups([]);
                    setCustomerScopedMastersLoaded(true);
                    addToast('error', error instanceof Error ? error.message : 'Gagal memuat master customer');
                }
            }
        };

        void loadCustomerScopedMasters();
        return () => {
            cancelled = true;
        };
    }, [addToast, form.customerRef, form.additionalCustomerRefs]);

    useEffect(() => {
        const firstPickupStop = form.pickupStops[0];
        if (!customerScopedMastersLoaded || !shouldAutoApplyDefaultPickup || !form.customerRef || firstPickupStop?.customerPickupRef) {
            return;
        }
        // Only the primary customer's default pickup may seed the trip's first stop.
        const defaultPickup = findDefaultCustomerPickup(
            customerPickups.filter(pickup => pickup.customerRef === form.customerRef)
        );
        if (!defaultPickup) {
            setShouldAutoApplyDefaultPickup(false);
            return;
        }
        setForm(prev => {
            const nextStops = (prev.pickupStops.length > 0 ? prev.pickupStops : [createDefaultPickupStopForm()])
                .map((stop, index) => index === 0 ? applyCustomerPickupToStop(stop, defaultPickup) : stop);
            return syncPickupFields({
                ...prev,
                savePickupToMaster: false,
                savePickupAsDefault: false,
                pickupMasterLabel: '',
            }, nextStops);
        });
        setShouldAutoApplyDefaultPickup(false);
    }, [customerPickups, customerScopedMastersLoaded, form.customerRef, form.pickupStops, shouldAutoApplyDefaultPickup]);

    const updateItem = <K extends keyof OrderItemForm>(idx: number, field: K, value: OrderItemForm[K]) => {
        setItems(prev => prev.map((item, i) => {
            if (i !== idx) {
                return item;
            }
            if (field === 'qtyKoli') {
                return applyOrderItemAutoWeightFromQty(item, value as number | string);
            }
            if (field === 'weightInputValue' && shouldLockOrderItemWeight(item)) {
                return item;
            }
            if (field === 'volumeInputValue' && shouldLockOrderItemVolume(item)) {
                return item;
            }
            return { ...item, [field]: value };
        }));
    };

    const addItem = () => setItems(prev => [...prev, createDefaultOrderItemForm()]);
    const removeItem = (idx: number) => {
        setItems(prev => {
            const next = prev.filter((_, i) => i !== idx);
            return next.length > 0 ? next : [createDefaultOrderItemForm()];
        });
    };

    const handleCustomerChange = (nextCustomerRef: string) => {
        const nextCustomer = customers.find(customer => customer._id === nextCustomerRef);
        setForm(prev => ({
            ...syncPickupFields(prev, (() => {
                const draftStops = getDraftPickupStops(prev.pickupStops);
                const previousCustomer = customers.find(customer => customer._id === prev.customerRef);
                const previousCustomerAddress = previousCustomer?.address?.trim() || '';
                const shouldUseCustomerDefault =
                    draftStops.length === 0 ||
                    (draftStops.length === 1 && (!draftStops[0].pickupAddress.trim() || draftStops[0].pickupAddress.trim() === previousCustomerAddress));
                if (shouldUseCustomerDefault) {
                    return [createDefaultPickupStopForm(resolvePickupAddressForCustomer({
                        nextCustomerRef,
                        previousCustomerRef: prev.customerRef,
                        previousPickupAddress: prev.pickupAddress,
                        customers,
                    }) || nextCustomer?.address || '')];
                }
                return draftStops.map(stop => ({
                    ...stop,
                    customerPickupRef: '',
                    pickupLabel: '',
                }));
            })()),
            customerRef: nextCustomerRef,
            customerName: nextCustomer?.name || '',
            // The customer just promoted to primary cannot also stay in the extras list.
            additionalCustomerRefs: prev.additionalCustomerRefs.filter(ref => ref !== nextCustomerRef),
            savePickupToMaster: false,
            savePickupAsDefault: false,
            pickupMasterLabel: '',
        }));
        setShouldAutoApplyDefaultPickup(Boolean(nextCustomerRef));
        setItems(prev => prev.map(item => ({
            ...item,
            customerProductRef: '',
        })));
    };

    const addAdditionalCustomer = (nextCustomerRef: string) => {
        if (!nextCustomerRef || nextCustomerRef === form.customerRef) {
            return;
        }
        setForm(prev => (
            prev.additionalCustomerRefs.includes(nextCustomerRef)
                ? prev
                : { ...prev, additionalCustomerRefs: [...prev.additionalCustomerRefs, nextCustomerRef] }
        ));
    };

    const removeAdditionalCustomer = (targetCustomerRef: string) => {
        setForm(prev => ({
            ...prev,
            additionalCustomerRefs: prev.additionalCustomerRefs.filter(ref => ref !== targetCustomerRef),
        }));
        // Items sourced from the removed customer must not keep a product that is now out of scope.
        setItems(prev => prev.map(item => {
            const product = customerProducts.find(candidate => candidate._id === item.customerProductRef);
            return product && product.customerRef === targetCustomerRef
                ? { ...item, customerProductRef: '' }
                : item;
        }));
    };

    const updatePickupStop = <K extends keyof PickupStopForm>(index: number, field: K, value: PickupStopForm[K]) => {
        setShouldAutoApplyDefaultPickup(false);
        setForm(prev => {
            const nextStops = prev.pickupStops.map((stop, stopIndex) => (
                stopIndex === index ? { ...stop, [field]: value } : stop
            ));
            return syncPickupFields(prev, nextStops);
        });
    };

    const handleCustomerPickupChange = (index: number, nextPickupRef: string) => {
        setShouldAutoApplyDefaultPickup(false);
        setForm(prev => {
            const nextStops = prev.pickupStops.map((stop, stopIndex) => (
                stopIndex === index
                    ? applyCustomerPickupMasterSelection(stop, nextPickupRef, customerPickups)
                    : stop
            ));
            return syncPickupFields({
                ...prev,
                savePickupToMaster: false,
                savePickupAsDefault: false,
                pickupMasterLabel: '',
            }, nextStops);
        });
    };

    const updatePickupAddress = (index: number, value: string) => {
        setShouldAutoApplyDefaultPickup(false);
        setForm(prev => {
            const nextStops = prev.pickupStops.map((stop, stopIndex) => (
                stopIndex === index
                    ? {
                        ...stop,
                        customerPickupRef: '',
                        pickupLabel: stop.customerPickupRef ? '' : stop.pickupLabel,
                        pickupAddress: value,
                    }
                    : stop
            ));
            return syncPickupFields(prev, nextStops);
        });
    };

    const addPickupStop = () => {
        setShouldAutoApplyDefaultPickup(false);
        setForm(prev => syncPickupFields({
            ...prev,
            savePickupToMaster: false,
            savePickupAsDefault: false,
            pickupMasterLabel: '',
        }, [...prev.pickupStops, createDefaultPickupStopForm()]));
    };

    const removePickupStop = (index: number) => {
        setShouldAutoApplyDefaultPickup(false);
        setForm(prev => {
            const nextStops = prev.pickupStops.filter((_, stopIndex) => stopIndex !== index);
            const currentCustomer = customers.find(customer => customer._id === prev.customerRef);
            return syncPickupFields({
                ...prev,
                savePickupToMaster: false,
                savePickupAsDefault: false,
                pickupMasterLabel: '',
            }, nextStops.length > 0 ? nextStops : [createDefaultPickupStopForm(currentCustomer?.address || '')]);
        });
    };

    const applyCustomerProductSelection = (idx: number, nextProductRef: string) => {
        setItems(prev => prev.map((item, i) => (
            i === idx ? applyOrderItemPickerSelection(item, nextProductRef, customerProducts) : item
        )));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const usesDeliveryOrderCargoMode = form.cargoEntryMode === 'DELIVERY_ORDER';
        const isRevisionMode = !usesDeliveryOrderCargoMode && (hasDeliveryOrders || hasOperationalProgress);
        const headerFieldsLocked = usesDeliveryOrderCargoMode && hasDeliveryOrders;
        const canEditHeader = !isRevisionMode && !headerFieldsLocked;

        const hasTargetItems = !usesDeliveryOrderCargoMode && items.length > 0;
        const validItems = items.filter(item => item.description.trim() || item.customerProductRef);
        const draftPickupStops = getDraftPickupStops(form.pickupStops);
        if (canEditHeader && !form.customerRef) {
            addToast('error', 'Customer wajib dipilih');
            return;
        }
        if (canEditHeader && draftPickupStops.length === 0) {
            addToast('error', 'Minimal 1 titik pickup wajib diisi');
            return;
        }
        if (canEditHeader && draftPickupStops.some(stop => !stop.pickupAddress.trim())) {
            addToast('error', 'Alamat setiap titik pickup wajib diisi');
            return;
        }
        if (!isRevisionMode && hasTargetItems && validItems.length === 0) {
            addToast('error', 'Minimal 1 item order wajib diisi');
            return;
        }
        if (isRevisionMode && !revisionReason.trim()) {
            addToast('error', 'Alasan revisi order wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const action = usesDeliveryOrderCargoMode
                ? 'update-header-booking'
                : isRevisionMode
                    ? 'revise-targets'
                    : 'update-with-items';
            let pickupStopsForSubmit = buildPickupStopsPayload(form.pickupStops);
            if (canEditHeader && form.savePickupToMaster) {
                const singlePickupStop = draftPickupStops.length === 1 ? draftPickupStops[0] : null;
                if (!singlePickupStop || singlePickupStop.customerPickupRef) {
                    addToast('error', 'Simpan ke master hanya berlaku untuk 1 titik pickup manual');
                    setSaving(false);
                    return;
                }
                if (!form.pickupMasterLabel.trim()) {
                    addToast('error', 'Label master pickup wajib diisi jika ingin disimpan ke master');
                    setSaving(false);
                    return;
                }
                const pickupRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'customer-pickups',
                        data: {
                            customerRef: form.customerRef,
                            label: form.pickupMasterLabel,
                            pickupAddress: singlePickupStop.pickupAddress.trim(),
                            active: true,
                            isDefault: form.savePickupAsDefault,
                        },
                    }),
                });
                const pickupPayload = await pickupRes.json();
                if (!pickupRes.ok) {
                    throw new Error(pickupPayload.error || 'Gagal menyimpan master pickup');
                }
                const pickupRefForSubmit = pickupPayload.data?._id || pickupPayload.id || '';
                pickupStopsForSubmit = pickupStopsForSubmit.map((stop, index) => (
                    index === 0
                        ? {
                            ...stop,
                            customerPickupRef: pickupRefForSubmit || undefined,
                            pickupLabel: form.pickupMasterLabel.trim(),
                        }
                        : stop
                ));
            }
            const headerPayload = headerFieldsLocked
                ? {
                    customerRef: form.customerRef,
                    serviceRef: form.serviceRef,
                    notes: form.notes,
                }
                : {
                    customerRef: form.customerRef,
                    customerName: form.customerName,
                    customerRefs: orderCustomerRefs.length > 1 ? orderCustomerRefs : undefined,
                    customerPickupRef: pickupStopsForSubmit[0]?.customerPickupRef,
                    pickupAddress: pickupStopsForSubmit[0]?.pickupAddress || form.pickupAddress,
                    pickupStops: pickupStopsForSubmit,
                    serviceRef: form.serviceRef,
                    serviceName: form.serviceName,
                    notes: form.notes,
                };
            const payloadData = usesDeliveryOrderCargoMode
                ? {
                    id: orderId,
                    ...headerPayload,
                    items: [],
                }
                : isRevisionMode
                ? {
                    id: orderId,
                    notes: form.notes,
                    revisionReason,
                    items: items.map(item => ({
                        id: item.id,
                        qtyKoli: item.qtyKoli,
                        weightInputValue: item.weightInputValue,
                        weightInputUnit: item.weightInputUnit,
                        volumeInputValue: item.volumeInputValue,
                        volumeInputUnit: item.volumeInputUnit,
                    })),
                }
                : {
                    id: orderId,
                    ...headerPayload,
                    items: hasTargetItems ? validItems : [],
                };

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'orders',
                    action,
                    data: payloadData,
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal menyimpan perubahan order');
            }
            addToast('success', isRevisionMode ? 'Target order berhasil direvisi' : 'Order berhasil diperbarui');
            router.push(`/orders/${orderId}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    const usesDeliveryOrderCargoMode = form.cargoEntryMode === 'DELIVERY_ORDER';
    const isRevisionMode = !usesDeliveryOrderCargoMode && (hasDeliveryOrders || hasOperationalProgress);
    const headerFieldsLocked = usesDeliveryOrderCargoMode && hasDeliveryOrders;
    const isHeaderOnlyOrder = usesDeliveryOrderCargoMode;
    const targetCargo = summarizeOrderEditTargetCargo(items);
    const selectedCustomer = customers.find(customer => customer._id === form.customerRef) || null;
    // The primary always comes first; extras follow. Sent only when there is more than one.
    const orderCustomerRefs = form.customerRef
        ? [form.customerRef, ...form.additionalCustomerRefs]
        : [...form.additionalCustomerRefs];
    const additionalCustomerOptions = customers
        .filter(customer => customer.active !== false
            && customer._id !== form.customerRef
            && !form.additionalCustomerRefs.includes(customer._id))
        .map(customer => ({ value: customer._id, label: customer.name }));
    const selectedService = services.find(service => service._id === form.serviceRef) || null;
    const sortedCustomerPickups = sortCustomerPickups(customerPickups);
    const pickupSummary = summarizePickupStopList(form.pickupStops);
    const draftPickupStops = getDraftPickupStops(form.pickupStops);
    const canSavePickupToMaster = !isRevisionMode && !headerFieldsLocked && Boolean(form.customerRef) && draftPickupStops.length === 1 && !draftPickupStops[0].customerPickupRef;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href={`/orders/${orderId}`} />
                    <h1 className="page-title">{isRevisionMode ? 'Revisi Order / Resi' : 'Edit Order'}</h1>
                </div>
            </div>

            <div style={{ background: isRevisionMode ? 'rgba(245, 158, 11, 0.08)' : 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', border: isRevisionMode ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid var(--color-gray-200)', marginBottom: 'var(--space-6)' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem', color: isRevisionMode ? '#92400e' : 'inherit' }}>
                    {isRevisionMode
                        ? 'Mode revisi target order'
                        : isHeaderOnlyOrder
                            ? 'Mode edit header booking'
                            : 'Mode edit order biasa'}
                </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Customer</div>
                        <div className="kpi-value" style={{ fontSize: '1rem' }}>{selectedCustomer?.name || 'Belum dipilih'}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Kategori Armada</div>
                        <div className="kpi-value" style={{ fontSize: '1rem' }}>{selectedService?.name || 'Opsional'}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">Pickup</div>
                        <div className="kpi-value" style={{ fontSize: '0.95rem' }}>{pickupSummary}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-content">
                        <div className="kpi-label">{isRevisionMode ? 'Target Revisi' : (isHeaderOnlyOrder ? 'Muatan' : 'Muatan Target')}</div>
                        <div className="kpi-value" style={{ fontSize: '0.95rem' }}>
                            {isHeaderOnlyOrder ? 'Akan dicatat di Surat Jalan' : formatCargoSummary(targetCargo)}
                        </div>
                    </div>
                </div>
            </div>

            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Customer / Pengirim</span></div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">Customer / Pengirim / Penagih</label>
                                                                <Combobox
                                    value={form.customerRef}
                                    onChange={(v: string) => handleCustomerChange(v)}
                                    options={customers.map(c => ({ value: c._id, label: c.name }))}
                                    placeholder="Pilih Customer"
                                    disabled={isRevisionMode || headerFieldsLocked}
                                    className="form-select"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Customer Tambahan (opsional)</label>
                                <Combobox
                                    value=""
                                    onChange={(v: string) => addAdditionalCustomer(v)}
                                    options={additionalCustomerOptions}
                                    placeholder={additionalCustomerOptions.length > 0
                                        ? 'Tambah customer lain'
                                        : 'Tidak ada customer lain yang bisa ditambahkan'}
                                    disabled={isRevisionMode || headerFieldsLocked || additionalCustomerOptions.length === 0}
                                    className="form-select"
                                />
                                {form.additionalCustomerRefs.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                                        {form.additionalCustomerRefs.map(ref => {
                                            const additionalCustomer = customers.find(item => item._id === ref);
                                            return (
                                                <span key={ref} className="badge badge-info">
                                                    {additionalCustomer?.name || ref}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeAdditionalCustomer(ref)}
                                                        aria-label={`Hapus customer ${additionalCustomer?.name || ref}`}
                                                        disabled={isRevisionMode || headerFieldsLocked}
                                                        style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'inherit', fontWeight: 700, lineHeight: 1 }}
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    {headerFieldsLocked || isRevisionMode
                                        ? 'Customer terkunci karena order ini sudah punya Surat Jalan.'
                                        : 'Customer pertama tetap customer utama: pickup, barang, dan limit piutang mengikuti customer pertama. Maksimal 5 customer.'}
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori Truk / Armada</label>
                                                                <Combobox
                                    value={form.serviceRef}
                                    onChange={(v: string) => {
                                    const svc = services.find(s => s._id === v);
                                    setForm(prev => ({ ...prev, serviceRef: v, serviceName: svc?.name || '' }));
                                }}
                                    options={services.map(s => ({ value: s._id, label: `${s.code} - ${s.name}` }))}
                                    placeholder="Pilih kategori armada"
                                    disabled={isRevisionMode || headerFieldsLocked}
                                    className="form-select"
                                />
                            </div>
                            <div className="form-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                    <label className="form-label" style={{ marginBottom: 0 }}>Titik Pickup</label>
                                    {!isRevisionMode && !headerFieldsLocked && (
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={addPickupStop} disabled={!form.customerRef}>
                                            <Plus size={14} /> Tambah Pickup
                                        </button>
                                    )}
                                </div>
                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                    {form.pickupStops.map((stop, index) => (
                                        <div
                                            key={stop.id}
                                            style={{
                                                display: 'grid',
                                                gap: '0.75rem',
                                                padding: '0.85rem',
                                                border: '1px solid var(--color-gray-200)',
                                                borderRadius: '0.75rem',
                                                background: 'var(--color-gray-50)',
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <div style={{ fontWeight: 600 }}>Pickup {index + 1}</div>
                                                {!isRevisionMode && !headerFieldsLocked && form.pickupStops.length > 1 && (
                                                    <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removePickupStop(index)} title="Hapus pickup">
                                                        <X size={16} />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
<label className="form-label">Master Pickup Customer</label>
                                                                                            <Combobox
                                                    value={getPickupStopMasterValue(stop)}
                                                    onChange={(v: string) => handleCustomerPickupChange(index, v)}
                                                    options={[
                                                        { value: MANUAL_PICKUP_MASTER_VALUE, label: MANUAL_PICKUP_MASTER_LABEL },
                                                        ...sortedCustomerPickups.map(pickup => (
                                                            {
                                                                value: pickup._id,
                                                                label: `${pickup.isDefault ? '[Default] ' : ''}${pickup.label}${orderCustomerRefs.length > 1
                                                                    ? ` — ${customers.find(customer => customer._id === pickup.customerRef)?.name || 'Customer lain'}`
                                                                    : ''}`,
                                                            }
                                                        )),
                                                    ]}
                                                    placeholder={form.customerRef ? (customerPickups.length > 0 ? 'Pilih master pickup, atau tulis manual' : 'Tulis manual di bawah') : 'Pilih customer dulu'}
                                                    disabled={isRevisionMode || headerFieldsLocked || !form.customerRef}
                                                    className="form-select"
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Alamat Pickup <span className="required">*</span></label>
                                                <textarea
                                                    className="form-textarea"
                                                    rows={2}
                                                    value={stop.pickupAddress}
                                                    onChange={e => updatePickupAddress(index, e.target.value)}
                                                    disabled={isRevisionMode || headerFieldsLocked}
                                                    placeholder="Alamat lokasi pengambilan barang"
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Catatan Pickup</label>
                                                <input
                                                    className="form-input"
                                                    value={stop.notes}
                                                    onChange={e => updatePickupStop(index, 'notes', e.target.value)}
                                                    disabled={isRevisionMode || headerFieldsLocked}
                                                    placeholder="Opsional"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            {canSavePickupToMaster && (
                                <div style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem 1rem', border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', background: 'var(--color-gray-50)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={form.savePickupToMaster}
                                            onChange={e => setForm(prev => ({ ...prev, savePickupToMaster: e.target.checked }))}
                                        />
                                        <span>Simpan lokasi ambil ini ke customer</span>
                                    </label>
                                    {form.savePickupToMaster && (
                                        <>
                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">Label Lokasi Ambil <span className="required">*</span></label>
                                                <input
                                                    className="form-input"
                                                    value={form.pickupMasterLabel}
                                                    onChange={e => setForm(prev => ({ ...prev, pickupMasterLabel: e.target.value }))}
                                                    placeholder="Contoh: Gudang Gresik / Pabrik Waru"
                                                />
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={form.savePickupAsDefault}
                                                    onChange={e => setForm(prev => ({ ...prev, savePickupAsDefault: e.target.checked }))}
                                                />
                                                <span>Jadikan lokasi ambil default customer</span>
                                            </label>
                                        </>
                                    )}
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
                            </div>
                            {isRevisionMode && (
                                <div className="form-group">
                                    <label className="form-label">Alasan Revisi <span className="required">*</span></label>
                                    <textarea
                                        className="form-textarea"
                                        rows={3}
                                        value={revisionReason}
                                        onChange={e => setRevisionReason(e.target.value)}
                                        placeholder="Mis. hasil loading aktual berbeda, salah input target awal, atau hasil timbang final berubah"
                                    />
                                </div>
                            )}
                            {headerFieldsLocked && (
                                <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                    Header booking ini sudah punya Surat Jalan. Customer, asal/pickup, dan layanan armada dikunci supaya snapshot di Surat Jalan tidak berubah. Yang masih bisa diubah di sini hanya catatan umum.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Tujuan Surat Jalan</span></div>
                        <div className="card-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', fontSize: '0.85rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                {headerFieldsLocked
                                    ? 'Tujuan/penerima sekarang dikelola di Surat Jalan. Karena order ini sudah punya Surat Jalan, pembaruan tujuan dilakukan langsung dari detail Surat Jalan masing-masing.'
                                    : 'Order tidak lagi menyimpan tujuan/penerima. Saat Surat Jalan dibuat, admin bisa mengisi atau melengkapi tujuan/penerima langsung di dokumen Surat Jalan.'}
                            </div>
                        </div>
                    </div>
                </div>

                {isHeaderOnlyOrder ? (
                    <div className="card mt-6">
                        <div className="card-header">
                            <span className="card-header-title">Input Barang di Surat Jalan</span>
                        </div>
                        <div className="card-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '1rem 1.1rem', fontSize: '0.85rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                {headerFieldsLocked
                                    ? 'Order ini sudah punya Surat Jalan. Barang dan tujuan tetap mengikuti Surat Jalan, sedangkan halaman ini hanya dipakai untuk membetulkan catatan umum.'
                                    : 'Order ini memakai flow header booking. Driver, truk, upah trip, dan uang jalan awal mengikuti rencana trip order; barang dan tujuan/penerima dicatat saat Surat Jalan dibuat.'}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="card mt-6">
                        <div className="card-header">
                            <span className="card-header-title">{isRevisionMode ? 'Target Item / Koli / Muatan' : 'Item / Koli'}</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={addItem} disabled={isRevisionMode}>
                                <Plus size={14} /> Tambah Item
                            </button>
                        </div>
                        <div className="card-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                {isRevisionMode
                                    ? 'Di mode revisi, nama barang dan master barang customer tetap mengikuti histori awal. Yang kamu koreksi di sini hanya target koli, berat, dan volume.'
                                    : 'Gunakan master barang customer kalau tersedia supaya deskripsi dan muatan default terisi otomatis.'}
                            </div>
                            {items.map((item, idx) => (
                                <div key={item.id || idx} className="cargo-item-fields" style={{ marginBottom: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)' }}>
                                    {isRevisionMode ? (
                                        <div style={{ display: 'grid', gap: '0.35rem' }}>
                                            <label className="form-label">Item</label>
                                            <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.8rem 0.9rem', background: 'var(--color-white)' }}>
                                                <div className="font-medium">{item.description || '-'}</div>
                                                <div className="text-muted text-sm">
                                                    {item.customerProductRef
                                                        ? 'Master barang customer terhubung dan identitas item dikunci saat revisi.'
                                                        : 'Item ini tidak memakai master barang customer. Deskripsi tetap dikunci saat revisi.'}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="form-label">Barang Customer</label>
                                                                                                <Combobox
                                                    value={getOrderItemPickerValue(item)}
                                                    onChange={(v: string) => applyCustomerProductSelection(idx, v)}
                                                    options={[{ value: MANUAL_ITEM_OPTION_VALUE, label: "Tambah manual" }, ...(customerProducts.map(product => (
                                                        {
                                                            value: product._id,
                                                            // Name the owning customer so identical product names stay distinct.
                                                            label: `${product.code ? `${product.code} - ` : ''}${product.name}${orderCustomerRefs.length > 1
                                                                ? ` — ${customers.find(customer => customer._id === product.customerRef)?.name || 'Customer lain'}`
                                                                : ''}`,
                                                        }
                                                    )))]}
                                                    placeholder={form.customerRef ? 'Pilih dari master barang customer (opsional)' : 'Pilih customer dulu'}
                                                    disabled={!form.customerRef}
                                                    className="form-select"
                                                />
                                            </div>
                                            <div>
                                                <label className="form-label">Deskripsi</label>
                                                <input className="form-input" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} placeholder="Nama/deskripsi barang" />
                                            </div>
                                        </>
                                    )}
                                    <div>
                                        <label className="form-label">{isRevisionMode ? 'Target Koli (Opsional)' : 'Koli (Opsional)'}</label>
                                        <FormattedNumberInput min={0} allowDecimal={false} value={item.qtyKoli} onValueChange={value => updateItem(idx, 'qtyKoli', value)} disabled={false} />
                                    </div>
                                    <div>
                                        <label className="form-label">{isRevisionMode ? 'Target Berat' : 'Berat'}</label>
                                        <div className="cargo-item-pair">
                                            <FormattedNumberInput min={0} maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)} value={item.weightInputValue} onValueChange={value => updateItem(idx, 'weightInputValue', value)} disabled={shouldLockOrderItemWeight(item)} />
                                                                                        <div className="cargo-item-unit">
                                                <Combobox
                                                    value={item.weightInputUnit}
                                                    onChange={(v: string) => setItems(prev => prev.map((entry, i) => (
                                                    i === idx ? updateOrderItemWeightUnit(entry, v as WeightInputUnit) : entry
                                                )))}
                                                    options={WEIGHT_INPUT_UNIT_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                                                    className="form-select"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div>
                                        <label className="form-label">{isRevisionMode ? 'Target Volume' : 'Volume'}</label>
                                        <div className="cargo-item-pair">
                                            <FormattedNumberInput min={0} maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3} value={item.volumeInputValue} onValueChange={value => updateItem(idx, 'volumeInputValue', value)} disabled={shouldLockOrderItemVolume(item)} />
                                                                                        <div className="cargo-item-unit">
                                                <Combobox
                                                    value={item.volumeInputUnit}
                                                    onChange={(v: string) => setItems(prev => prev.map((entry, i) => (
                                                    i === idx ? updateOrderItemVolumeUnit(entry, v as VolumeInputUnit) : entry
                                                )))}
                                                    options={VOLUME_INPUT_UNIT_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                                                    className="form-select"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    {items.length > 1 && (
                                        <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeItem(idx)} style={{ marginBottom: 4 }} disabled={isRevisionMode}>
                                            <X size={18} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push(`/orders/${orderId}`)}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : (isRevisionMode ? 'Simpan Revisi' : 'Simpan Perubahan')}</button>
                </div>
            </form>
        </div>
    );
}

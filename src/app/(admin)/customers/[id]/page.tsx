'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp, useToast } from '../../layout';
import { Edit, Package, DollarSign, Plus, Save, Trash2, X } from 'lucide-react';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { fetchAdminData, fetchOptionalAdminCollectionData } from '@/lib/api/admin-client';
import { buildAdminLoadNotice, getAdminErrorMessage, type AdminLoadNotice } from '@/lib/admin-access-messages';
import { summarizeCustomerCreditUsage } from '@/lib/customer-credit-limit';
import { FREIGHT_NOTA_BILLING_MODE_OPTIONS, getFreightNotaBillingModeLabel } from '@/lib/freight-nota-billing';
import { buildPph23Label, DEFAULT_PPH23_RATE_PERCENT, PPH23_BASE_MODE_OPTIONS } from '@/lib/pph23';
import { formatDate, formatCurrency, getReceivableNetAmount } from '@/lib/utils';
import { formatCargoSummary, getWeightInputFractionDigits, VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS, type VolumeInputUnit, type WeightInputUnit } from '@/lib/measurement';
import type { Customer, CustomerBillingRate, CustomerBillingRateBasis, CustomerPickupLocation, CustomerProduct, CustomerRecipient, Order, FreightNota, Service } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';
import { hasPageAccess, hasPermission } from '@/lib/rbac';

type CustomerProductForm = {
    code: string;
    name: string;
    description: string;
    defaultQtyKoli: number;
    defaultWeightInputValue: number;
    defaultWeightInputUnit: WeightInputUnit;
    defaultVolumeInputValue: number;
    defaultVolumeInputUnit: VolumeInputUnit;
    notes: string;
    active: boolean;
};

type CustomerRecipientForm = {
    label: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
    notes: string;
    active: boolean;
    isDefault: boolean;
};

type CustomerPickupForm = {
    label: string;
    pickupAddress: string;
    notes: string;
    active: boolean;
    isDefault: boolean;
};

type CustomerBillingRateForm = {
    serviceRef: string;
    basis: CustomerBillingRateBasis;
    rate: number;
    routeFrom: string;
    routeTo: string;
    notes: string;
    active: boolean;
};

const DEFAULT_PRODUCT_FORM: CustomerProductForm = {
    code: '',
    name: '',
    description: '',
    defaultQtyKoli: 1,
    defaultWeightInputValue: 0,
    defaultWeightInputUnit: 'KG',
    defaultVolumeInputValue: 0,
    defaultVolumeInputUnit: 'M3',
    notes: '',
    active: true,
};

const DEFAULT_RECIPIENT_FORM: CustomerRecipientForm = {
    label: '',
    receiverName: '',
    receiverPhone: '',
    receiverAddress: '',
    receiverCompany: '',
    notes: '',
    active: true,
    isDefault: false,
};

const DEFAULT_PICKUP_FORM: CustomerPickupForm = {
    label: '',
    pickupAddress: '',
    notes: '',
    active: true,
    isDefault: false,
};

const DEFAULT_BILLING_RATE_FORM: CustomerBillingRateForm = {
    serviceRef: '',
    basis: 'PER_KG',
    rate: 0,
    routeFrom: '',
    routeTo: '',
    notes: '',
    active: true,
};

export default function CustomerDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const customerId = params.id as string;
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [customerBillingRates, setCustomerBillingRates] = useState<CustomerBillingRate[]>([]);
    const [customerRecipients, setCustomerRecipients] = useState<CustomerRecipient[]>([]);
    const [customerPickups, setCustomerPickups] = useState<CustomerPickupLocation[]>([]);
    const [services, setServices] = useState<Service[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [notas, setNotas] = useState<FreightNota[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showProductModal, setShowProductModal] = useState(false);
    const [showBillingRateModal, setShowBillingRateModal] = useState(false);
    const [savingProduct, setSavingProduct] = useState(false);
    const [savingBillingRate, setSavingBillingRate] = useState(false);
    const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
    const [deletingBillingRateId, setDeletingBillingRateId] = useState<string | null>(null);
    const [editProduct, setEditProduct] = useState<CustomerProduct | null>(null);
    const [editBillingRate, setEditBillingRate] = useState<CustomerBillingRate | null>(null);
    const [showRecipientModal, setShowRecipientModal] = useState(false);
    const [savingRecipient, setSavingRecipient] = useState(false);
    const [deletingRecipientId, setDeletingRecipientId] = useState<string | null>(null);
    const [editRecipient, setEditRecipient] = useState<CustomerRecipient | null>(null);
    const [showPickupModal, setShowPickupModal] = useState(false);
    const [savingPickup, setSavingPickup] = useState(false);
    const [deletingPickupId, setDeletingPickupId] = useState<string | null>(null);
    const [editPickup, setEditPickup] = useState<CustomerPickupLocation | null>(null);
    const [form, setForm] = useState({
        name: '',
        address: '',
        contactPerson: '',
        phone: '',
        email: '',
        creditLimitAmount: 0,
        npwp: '',
        deliveryOrderPrefix: 'SJ',
        defaultFreightNotaBillingMode: 'PER_KG' as CustomerBillingRateBasis,
        defaultPph23Enabled: false,
        defaultPph23RatePercent: DEFAULT_PPH23_RATE_PERCENT,
        defaultPph23BaseMode: 'BEFORE_CLAIM' as 'BEFORE_CLAIM' | 'AFTER_CLAIM',
    });
    const [productForm, setProductForm] = useState<CustomerProductForm>(DEFAULT_PRODUCT_FORM);
    const [billingRateForm, setBillingRateForm] = useState<CustomerBillingRateForm>(DEFAULT_BILLING_RATE_FORM);
    const [recipientForm, setRecipientForm] = useState<CustomerRecipientForm>(DEFAULT_RECIPIENT_FORM);
    const [pickupForm, setPickupForm] = useState<CustomerPickupForm>(DEFAULT_PICKUP_FORM);
    const canOpenCustomerOrderHistory = user ? hasPageAccess(user, 'orders') : false;
    const canManageCustomer = user ? hasPermission(user, 'customers', 'update') : false;

    useEffect(() => {
        const loadCustomerDetail = async () => {
            setLoading(true);
            setLoadNotice(null);
            try {
                const optionalFetchOptions = { onError: (message: string) => addToast('error', message), silentAccessDenied: true };
                const cust = await fetchAdminData<Customer | null>(`/api/data?entity=customers&id=${customerId}`, 'Gagal memuat data customer');
                const [productRows, billingRateRows, recipientRows, pickupRows, serviceRows, customerOrders, customerNotas] = await Promise.all([
                    fetchOptionalAdminCollectionData<CustomerProduct>(`/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat barang customer', undefined, optionalFetchOptions),
                    fetchOptionalAdminCollectionData<CustomerBillingRate>(`/api/data?entity=customer-billing-rates&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat tarif customer', undefined, optionalFetchOptions),
                    fetchOptionalAdminCollectionData<CustomerRecipient>(`/api/data?entity=customer-recipients&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat tujuan customer', undefined, optionalFetchOptions),
                    fetchOptionalAdminCollectionData<CustomerPickupLocation>(`/api/data?entity=customer-pickups&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat lokasi ambil customer', undefined, optionalFetchOptions),
                    canManageCustomer
                        ? fetchOptionalAdminCollectionData<Service>('/api/data?entity=services', 'Gagal memuat jenis armada', undefined, optionalFetchOptions)
                        : Promise.resolve([] as Service[]),
                    canOpenCustomerOrderHistory
                        ? fetchOptionalAdminCollectionData<Order>(`/api/data?entity=orders&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat riwayat order customer', undefined, optionalFetchOptions)
                        : Promise.resolve([] as Order[]),
                    fetchOptionalAdminCollectionData<FreightNota>(`/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ customerRef: customerId }))}`, 'Gagal memuat riwayat invoice customer', undefined, optionalFetchOptions),
                ]);

                setCustomer(cust);
                setCustomerProducts(productRows || []);
                setCustomerBillingRates(billingRateRows || []);
                setCustomerRecipients(recipientRows || []);
                setCustomerPickups(pickupRows || []);
                setServices((serviceRows || []).filter(service => service.active !== false));
                setOrders([...(customerOrders || [])].sort((a, b) => `${b.createdAt || ''}-${b._id}`.localeCompare(`${a.createdAt || ''}-${a._id}`)));
                setNotas([...(customerNotas || [])].sort((a, b) => `${b.dueDate || b.issueDate || ''}-${b._id}`.localeCompare(`${a.dueDate || a.issueDate || ''}-${a._id}`)));
                if (cust) {
                    setForm({
                        name: cust.name,
                        address: cust.address,
                        contactPerson: cust.contactPerson,
                        phone: cust.phone,
                        email: cust.email,
                        creditLimitAmount: cust.creditLimitAmount || 0,
                        npwp: cust.npwp || '',
                        deliveryOrderPrefix: cust.deliveryOrderPrefix || 'SJ',
                        defaultFreightNotaBillingMode: cust.defaultFreightNotaBillingMode || 'PER_KG',
                        defaultPph23Enabled: cust.defaultPph23Enabled === true,
                        defaultPph23RatePercent: typeof cust.defaultPph23RatePercent === 'number' ? cust.defaultPph23RatePercent : DEFAULT_PPH23_RATE_PERCENT,
                        defaultPph23BaseMode: cust.defaultPph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM',
                    });
                }
            } catch (error) {
                const message = getAdminErrorMessage(error, 'Gagal memuat data customer');
                setLoadNotice(buildAdminLoadNotice(
                    message,
                    'Customer',
                    'Halaman ini hanya bisa dilihat oleh role yang punya akses Customer.'
                ));
                addToast('error', message);
            } finally {
                setLoading(false);
            }
        };

        void loadCustomerDetail();
    }, [addToast, canManageCustomer, canOpenCustomerOrderHistory, customerId]);

    const openNewProduct = () => {
        setEditProduct(null);
        setProductForm(DEFAULT_PRODUCT_FORM);
        setShowProductModal(true);
    };

    const openEditProduct = (product: CustomerProduct) => {
        setEditProduct(product);
        setProductForm({
            code: product.code || '',
            name: product.name || '',
            description: product.description || '',
            defaultQtyKoli: product.defaultQtyKoli || 1,
            defaultWeightInputValue: product.defaultWeightInputValue || 0,
            defaultWeightInputUnit: product.defaultWeightInputUnit || 'KG',
            defaultVolumeInputValue: product.defaultVolumeInputValue || 0,
            defaultVolumeInputUnit: product.defaultVolumeInputUnit || 'M3',
            notes: product.notes || '',
            active: product.active !== false,
        });
        setShowProductModal(true);
    };

    const openNewBillingRate = () => {
        setEditBillingRate(null);
        setBillingRateForm(DEFAULT_BILLING_RATE_FORM);
        setShowBillingRateModal(true);
    };

    const openEditBillingRate = (rate: CustomerBillingRate) => {
        setEditBillingRate(rate);
        setBillingRateForm({
            serviceRef: rate.serviceRef || '',
            basis: rate.basis || 'PER_KG',
            rate: rate.rate || 0,
            routeFrom: rate.routeFrom || '',
            routeTo: rate.routeTo || '',
            notes: rate.notes || '',
            active: rate.active !== false,
        });
        setShowBillingRateModal(true);
    };

    const openNewRecipient = () => {
        setEditRecipient(null);
        setRecipientForm({ ...DEFAULT_RECIPIENT_FORM, isDefault: customerRecipients.length === 0 });
        setShowRecipientModal(true);
    };

    const openEditRecipient = (recipient: CustomerRecipient) => {
        setEditRecipient(recipient);
        setRecipientForm({
            label: recipient.label || '',
            receiverName: recipient.receiverName || '',
            receiverPhone: recipient.receiverPhone || '',
            receiverAddress: recipient.receiverAddress || '',
            receiverCompany: recipient.receiverCompany || '',
            notes: recipient.notes || '',
            active: recipient.active !== false,
            isDefault: recipient.isDefault === true,
        });
        setShowRecipientModal(true);
    };

    const openNewPickup = () => {
        setEditPickup(null);
        setPickupForm({ ...DEFAULT_PICKUP_FORM, isDefault: customerPickups.length === 0 });
        setShowPickupModal(true);
    };

    const openEditPickup = (pickup: CustomerPickupLocation) => {
        setEditPickup(pickup);
        setPickupForm({
            label: pickup.label || '',
            pickupAddress: pickup.pickupAddress || '',
            notes: pickup.notes || '',
            active: pickup.active !== false,
            isDefault: pickup.isDefault === true,
        });
        setShowPickupModal(true);
    };

    const handleSaveProduct = async () => {
        if (!productForm.name.trim()) {
            addToast('error', 'Nama barang customer wajib diisi');
            return;
        }

        setSavingProduct(true);
        try {
            const payload = {
                customerRef: customerId,
                ...productForm,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editProduct
                        ? { entity: 'customer-products', action: 'update', data: { id: editProduct._id, updates: payload } }
                        : { entity: 'customer-products', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan barang customer');
                return;
            }

            const savedProduct = result.data as CustomerProduct;
            setCustomerProducts(prev =>
                editProduct
                    ? prev.map(item => item._id === editProduct._id ? savedProduct : item)
                    : [savedProduct, ...prev]
            );
            setShowProductModal(false);
            addToast('success', editProduct ? 'Barang customer diperbarui' : 'Barang customer ditambahkan');
        } catch {
            addToast('error', 'Gagal menyimpan barang customer');
        } finally {
            setSavingProduct(false);
        }
    };

    const handleDeleteProduct = async (productId: string) => {
        setDeletingProductId(productId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customer-products', action: 'delete', data: { id: productId } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus barang customer');
                return;
            }
            setCustomerProducts(prev => prev.filter(item => item._id !== productId));
            addToast('success', 'Barang customer dihapus');
        } catch {
            addToast('error', 'Gagal menghapus barang customer');
        } finally {
            setDeletingProductId(null);
        }
    };

    const handleSaveBillingRate = async () => {
        if (!billingRateForm.rate || billingRateForm.rate <= 0) {
            addToast('error', 'Tarif customer harus lebih besar dari 0');
            return;
        }

        setSavingBillingRate(true);
        try {
            const selectedService = services.find(service => service._id === billingRateForm.serviceRef);
            const payload = {
                customerRef: customerId,
                ...billingRateForm,
                serviceName: selectedService?.name || undefined,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editBillingRate
                        ? { entity: 'customer-billing-rates', action: 'update', data: { id: editBillingRate._id, updates: payload } }
                        : { entity: 'customer-billing-rates', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan tarif customer');
                return;
            }

            const savedRate = result.data as CustomerBillingRate;
            setCustomerBillingRates(prev =>
                editBillingRate
                    ? prev.map(item => item._id === editBillingRate._id ? savedRate : item)
                    : [savedRate, ...prev]
            );
            setShowBillingRateModal(false);
            addToast('success', editBillingRate ? 'Tarif customer diperbarui' : 'Tarif customer ditambahkan');
        } catch {
            addToast('error', 'Gagal menyimpan tarif customer');
        } finally {
            setSavingBillingRate(false);
        }
    };

    const handleDeleteBillingRate = async (rateId: string) => {
        setDeletingBillingRateId(rateId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customer-billing-rates', action: 'delete', data: { id: rateId } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus tarif customer');
                return;
            }
            setCustomerBillingRates(prev => prev.filter(item => item._id !== rateId));
            addToast('success', 'Tarif customer dihapus');
        } catch {
            addToast('error', 'Gagal menghapus tarif customer');
        } finally {
            setDeletingBillingRateId(null);
        }
    };

    const handleSaveRecipient = async () => {
        if (!recipientForm.label.trim() || !recipientForm.receiverName.trim() || !recipientForm.receiverAddress.trim()) {
            addToast('error', 'Label, nama penerima, dan alamat wajib diisi');
            return;
        }

        setSavingRecipient(true);
        try {
            const payload = {
                customerRef: customerId,
                ...recipientForm,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editRecipient
                        ? { entity: 'customer-recipients', action: 'update', data: { id: editRecipient._id, updates: payload } }
                        : { entity: 'customer-recipients', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan master penerima');
                return;
            }

            const savedRecipient = result.data as CustomerRecipient;
            setCustomerRecipients(prev => {
                const next = editRecipient
                    ? prev.map(item => item._id === editRecipient._id ? savedRecipient : item)
                    : [savedRecipient, ...prev];
                return savedRecipient.isDefault ? next.map(item => item._id === savedRecipient._id ? item : { ...item, isDefault: false }) : next;
            });
            setShowRecipientModal(false);
            addToast('success', editRecipient ? 'Master penerima diperbarui' : 'Master penerima ditambahkan');
        } catch {
            addToast('error', 'Gagal menyimpan master penerima');
        } finally {
            setSavingRecipient(false);
        }
    };

    const handleDeleteRecipient = async (recipientId: string) => {
        setDeletingRecipientId(recipientId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customer-recipients', action: 'delete', data: { id: recipientId } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus master penerima');
                return;
            }
            setCustomerRecipients(prev => prev.filter(item => item._id !== recipientId));
            addToast('success', 'Master penerima dihapus');
        } catch {
            addToast('error', 'Gagal menghapus master penerima');
        } finally {
            setDeletingRecipientId(null);
        }
    };

    const handleSavePickup = async () => {
        if (!pickupForm.label.trim() || !pickupForm.pickupAddress.trim()) {
            addToast('error', 'Label dan alamat pickup wajib diisi');
            return;
        }

        setSavingPickup(true);
        try {
            const payload = {
                customerRef: customerId,
                ...pickupForm,
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    editPickup
                        ? { entity: 'customer-pickups', action: 'update', data: { id: editPickup._id, updates: payload } }
                        : { entity: 'customer-pickups', data: payload }
                ),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan master pickup');
                return;
            }

            const savedPickup = result.data as CustomerPickupLocation;
            setCustomerPickups(prev => {
                const next = editPickup
                    ? prev.map(item => item._id === editPickup._id ? savedPickup : item)
                    : [savedPickup, ...prev];
                return savedPickup.isDefault ? next.map(item => item._id === savedPickup._id ? item : { ...item, isDefault: false }) : next;
            });
            setShowPickupModal(false);
            addToast('success', editPickup ? 'Master pickup diperbarui' : 'Master pickup ditambahkan');
        } catch {
            addToast('error', 'Gagal menyimpan master pickup');
        } finally {
            setSavingPickup(false);
        }
    };

    const handleDeletePickup = async (pickupId: string) => {
        setDeletingPickupId(pickupId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customer-pickups', action: 'delete', data: { id: pickupId } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus master pickup');
                return;
            }
            setCustomerPickups(prev => prev.filter(item => item._id !== pickupId));
            addToast('success', 'Master pickup dihapus');
        } catch {
            addToast('error', 'Gagal menghapus master pickup');
        } finally {
            setDeletingPickupId(null);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', action: 'update', data: { id: customerId, updates: form } }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan perubahan customer');
                return;
            }
            setCustomer(prev => prev ? { ...prev, ...form } : prev);
            setEditing(false);
            addToast('success', 'Customer berhasil diperbarui');
        } catch { addToast('error', 'Gagal menyimpan'); }
        finally { setSaving(false); }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!customer) return <div className="empty-state"><div className="empty-state-title">{loadNotice?.title || 'Customer tidak ditemukan'}</div>{loadNotice?.text && <div className="empty-state-text">{loadNotice.text}</div>}</div>;

    const activeOrderCount = orders.filter(order => !['COMPLETE', 'CANCELLED'].includes(order.status)).length;
    const activeNotas = notas.filter(nota => nota.status !== 'VOID');
    const creditUsage = summarizeCustomerCreditUsage(customer, notas);
    const activeNotaCount = activeNotas.filter(nota => nota.status !== 'PAID').length;
    const totalNotaNetAmount = activeNotas.reduce((sum, nota) => sum + getReceivableNetAmount(nota), 0);
    const sortedRecipients = [...customerRecipients].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });
    const sortedPickups = [...customerPickups].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });
    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/customers" />
                    <div>
                        <h1 className="page-title">{customer.name}</h1>
                    </div>
                </div>
                <div className="page-actions">
                    {canManageCustomer && !editing && <button className="btn btn-secondary" onClick={openNewBillingRate}><Plus size={16} /> Tambah Tarif</button>}
                    {canManageCustomer && !editing && <button className="btn btn-secondary" onClick={openNewProduct}><Plus size={16} /> Tambah Barang</button>}
                    {canManageCustomer && !editing && <button className="btn btn-primary" onClick={() => setEditing(true)}><Edit size={16} /> Edit</button>}
                </div>
            </div>

            <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
            <div
                className="detail-grid"
                style={{
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    alignItems: 'start',
                }}
            >
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Informasi Customer</span></div>
                    <div className="card-body">
                        {editing ? (
                            <>
                                <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Contact Person</label><input className="form-input" value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">Telepon</label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                                </div>
                                <div className="form-row">
                                    <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                                    <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} /></div>
                                </div>
                                <div className="form-group" style={{ maxWidth: 280 }}>
                                    <label className="form-label">Limit Piutang</label>
                                    <FormattedNumberInput
                                        allowDecimal={false}
                                        value={form.creditLimitAmount}
                                        onValueChange={value => setForm({ ...form, creditLimitAmount: value })}
                                        placeholder="0 = tanpa limit"
                                    />
                                </div>
                                <div className="form-group" style={{ maxWidth: 320 }}>
                                    <label className="form-label">Default Basis Billing Invoice</label>
                                    <select
                                        className="form-select"
                                        value={form.defaultFreightNotaBillingMode}
                                        onChange={e => setForm({ ...form, defaultFreightNotaBillingMode: e.target.value as CustomerBillingRateBasis })}
                                    >
                                        {FREIGHT_NOTA_BILLING_MODE_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Default PPh 23</label>
                                        <select
                                            className="form-select"
                                            value={form.defaultPph23Enabled ? 'YA' : 'TIDAK'}
                                            onChange={e => setForm({
                                                ...form,
                                                defaultPph23Enabled: e.target.value === 'YA',
                                                defaultPph23RatePercent: e.target.value === 'YA'
                                                    ? (form.defaultPph23RatePercent || DEFAULT_PPH23_RATE_PERCENT)
                                                    : DEFAULT_PPH23_RATE_PERCENT,
                                            })}
                                        >
                                            <option value="TIDAK">Tidak dipotong</option>
                                            <option value="YA">Potong PPh 23</option>
                                        </select>
                                    </div>
                                    <div className="form-group" style={{ maxWidth: 180 }}>
                                        <label className="form-label">Tarif PPh 23 (%)</label>
                                        <FormattedNumberInput
                                            maxFractionDigits={2}
                                            value={form.defaultPph23RatePercent}
                                            onValueChange={value => setForm({ ...form, defaultPph23RatePercent: value })}
                                        />
                                    </div>
                                </div>
                                <div className="form-group" style={{ maxWidth: 280 }}>
                                    <label className="form-label">Basis Hitung PPh 23</label>
                                    <select
                                        className="form-select"
                                        value={form.defaultPph23BaseMode}
                                        onChange={e => setForm({ ...form, defaultPph23BaseMode: e.target.value as 'BEFORE_CLAIM' | 'AFTER_CLAIM' })}
                                    >
                                        {PPH23_BASE_MODE_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Awalan Referensi SJ Pengirim</label>
                                    <input className="form-input" value={form.deliveryOrderPrefix} onChange={e => setForm({ ...form, deliveryOrderPrefix: e.target.value.toUpperCase() })} />
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Dipakai sebagai awalan referensi nomor SJ dari pengirim. Nomor final tetap diinput manual saat membuat surat jalan.
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                                    <button className="btn btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Batal</button>
                                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Nama</div><div className="detail-value font-medium">{customer.name}</div></div>
                                    <div className="detail-item"><div className="detail-label">Contact Person</div><div className="detail-value">{customer.contactPerson}</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Telepon</div><div className="detail-value">{customer.phone}</div></div>
                                    <div className="detail-item"><div className="detail-label">Email</div><div className="detail-value">{customer.email}</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Default Basis Billing Invoice</div><div className="detail-value">{getFreightNotaBillingModeLabel(customer.defaultFreightNotaBillingMode || 'PER_KG')}</div></div>
                                    <div className="detail-item"><div className="detail-label">Default PPh 23</div><div className="detail-value">{buildPph23Label({
                                        enabled: customer.defaultPph23Enabled,
                                        ratePercent: customer.defaultPph23RatePercent,
                                        baseMode: customer.defaultPph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM',
                                    })}</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Awalan Referensi SJ Pengirim</div><div className="detail-value font-mono">{customer.deliveryOrderPrefix || 'SJ'}</div></div>
                                    <div className="detail-item"><div className="detail-label">Termin Default</div><div className="detail-value">{customer.defaultPaymentTerm || 0} hari</div></div>
                                </div>
                                <div className="detail-row">
                                    <div className="detail-item"><div className="detail-label">Limit Piutang</div><div className="detail-value">{customer.creditLimitAmount ? formatCurrency(customer.creditLimitAmount) : 'Tanpa limit'}</div></div>
                                    <div className="detail-item"><div className="detail-label">Outstanding Invoice</div><div className="detail-value" style={{ color: creditUsage.isBlocked ? 'var(--color-danger)' : undefined }}>{formatCurrency(creditUsage.outstandingAmount)}</div></div>
                                </div>
                                <div className="detail-item mt-2"><div className="detail-label">Alamat</div><div className="detail-value">{customer.address}</div></div>
                                {customer.npwp && <div className="detail-item mt-2"><div className="detail-label">NPWP</div><div className="detail-value font-mono">{customer.npwp}</div></div>}
                            </>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Ringkasan Kerja</span></div>
                    <div className="card-body">
                        <div className="responsive-stat-grid">
                            {canOpenCustomerOrderHistory && <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-primary-light)' }}><Package size={20} /></div><div className="kpi-value">{activeOrderCount}</div><div className="kpi-label">Order Aktif</div></div>}
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-success-light)' }}><DollarSign size={20} /></div><div className="kpi-value">{activeNotaCount}</div><div className="kpi-label">Invoice Belum Lunas</div></div>
                            <div className="kpi-card"><div className="kpi-icon" style={{ background: 'var(--color-warning-light)' }}><Package size={20} /></div><div className="kpi-value">{customerProducts.length}</div><div className="kpi-label">Master Barang</div></div>
                        </div>
                        {!canOpenCustomerOrderHistory && (
                            <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                Riwayat order customer hanya ditampilkan untuk role yang punya akses halaman order.
                            </div>
                        )}
                        <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            Total nilai invoice customer ini saat ini: <strong style={{ color: 'var(--color-gray-800)' }}>{formatCurrency(totalNotaNetAmount)}</strong>
                        </div>
                    </div>
                </div>
            </div>

            <CollapsibleCard
                title={`Lokasi Customer (${customerPickups.length + customerRecipients.length})`}
                defaultOpen
            >
                <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
                <section>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 600 }}>Tujuan / Penerima ({customerRecipients.length})</div>
                    {canManageCustomer && <button className="btn btn-primary btn-sm" onClick={openNewRecipient}>
                        <Plus size={14} /> Tambah Tujuan
                    </button>}
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Label Tujuan</th><th>Tujuan / Penerima</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {customerRecipients.length === 0 ? (
                                <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada tujuan tersimpan untuk customer ini</td></tr>
                            ) : (
                                sortedRecipients.map(recipient => (
                                    <tr key={recipient._id}>
                                        <td>
                                            <div style={{ fontWeight: 600, display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>{recipient.label}</span>
                                                {recipient.isDefault && <span className="badge badge-info">Default</span>}
                                            </div>
                                            {recipient.notes && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{recipient.notes}</div>
                                            )}
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{recipient.receiverName}</div>
                                            {recipient.receiverCompany && (
                                                <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{recipient.receiverCompany}</div>
                                            )}
                                            <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{recipient.receiverAddress}</div>
                                            {recipient.receiverPhone && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{recipient.receiverPhone}</div>
                                            )}
                                        </td>
                                        <td><span className={`badge ${recipient.active !== false ? 'badge-green' : 'badge-gray'}`}>{recipient.active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td>
                                            <div className="table-actions">
                                                {canManageCustomer && <button className="table-action-btn" onClick={() => openEditRecipient(recipient)}><Edit size={14} /> Edit</button>}
                                                {canManageCustomer && <button className="table-action-btn danger" onClick={() => handleDeleteRecipient(recipient._id)} disabled={deletingRecipientId === recipient._id}>
                                                    <Trash2 size={14} /> {deletingRecipientId === recipient._id ? 'Menghapus...' : 'Hapus'}
                                                </button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {customerRecipients.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada tujuan / penerima</div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-primary" onClick={openNewRecipient}>
                                    <Plus size={16} /> Tambah Tujuan
                                </button>}
                            </div>
                        </div>
                    ) : sortedRecipients.map(recipient => (
                        <div key={recipient._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{recipient.label}</div>
                                    <div className="mobile-record-subtitle">{recipient.receiverName}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    {recipient.isDefault && <span className="badge badge-info">Default</span>}
                                    <span className={`badge ${recipient.active !== false ? 'badge-green' : 'badge-gray'}`}>{recipient.active !== false ? 'Aktif' : 'Nonaktif'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Alamat</span>
                                    <span className="mobile-record-value">{recipient.receiverAddress}</span>
                                </div>
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Kontak</span>
                                    <span className="mobile-record-value">{recipient.receiverCompany || recipient.receiverPhone || '-'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-secondary" onClick={() => openEditRecipient(recipient)}>
                                    <Edit size={14} /> Edit
                                </button>}
                                {canManageCustomer && <button className="btn btn-danger" onClick={() => handleDeleteRecipient(recipient._id)} disabled={deletingRecipientId === recipient._id}>
                                    <Trash2 size={14} /> {deletingRecipientId === recipient._id ? 'Menghapus...' : 'Hapus'}
                                </button>}
                            </div>
                        </div>
                    ))}
                </div>
                </section>

                <section>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 600 }}>Lokasi Ambil ({customerPickups.length})</div>
                    {canManageCustomer && <button className="btn btn-primary btn-sm" onClick={openNewPickup}>
                        <Plus size={14} /> Tambah Lokasi Ambil
                    </button>}
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Label Lokasi</th><th>Alamat Ambil</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {customerPickups.length === 0 ? (
                                <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada lokasi ambil tersimpan untuk customer ini</td></tr>
                            ) : (
                                sortedPickups.map(pickup => (
                                    <tr key={pickup._id}>
                                        <td>
                                            <div style={{ fontWeight: 600, display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                <span>{pickup.label}</span>
                                                {pickup.isDefault && <span className="badge badge-info">Default</span>}
                                            </div>
                                            {pickup.notes && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{pickup.notes}</div>
                                            )}
                                        </td>
                                        <td>
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{pickup.pickupAddress}</div>
                                        </td>
                                        <td><span className={`badge ${pickup.active !== false ? 'badge-green' : 'badge-gray'}`}>{pickup.active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td>
                                            <div className="table-actions">
                                                {canManageCustomer && <button className="table-action-btn" onClick={() => openEditPickup(pickup)}><Edit size={14} /> Edit</button>}
                                                {canManageCustomer && <button className="table-action-btn danger" onClick={() => handleDeletePickup(pickup._id)} disabled={deletingPickupId === pickup._id}>
                                                    <Trash2 size={14} /> {deletingPickupId === pickup._id ? 'Menghapus...' : 'Hapus'}
                                                </button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {customerPickups.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada lokasi ambil</div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-primary" onClick={openNewPickup}>
                                    <Plus size={16} /> Tambah Lokasi
                                </button>}
                            </div>
                        </div>
                    ) : sortedPickups.map(pickup => (
                        <div key={pickup._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{pickup.label}</div>
                                    <div className="mobile-record-subtitle">{pickup.pickupAddress}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    {pickup.isDefault && <span className="badge badge-info">Default</span>}
                                    <span className={`badge ${pickup.active !== false ? 'badge-green' : 'badge-gray'}`}>{pickup.active !== false ? 'Aktif' : 'Nonaktif'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Alamat</span>
                                    <span className="mobile-record-value">{pickup.pickupAddress}</span>
                                </div>
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Catatan</span>
                                    <span className="mobile-record-value">{pickup.notes || '-'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-secondary" onClick={() => openEditPickup(pickup)}>
                                    <Edit size={14} /> Edit
                                </button>}
                                {canManageCustomer && <button className="btn btn-danger" onClick={() => handleDeletePickup(pickup._id)} disabled={deletingPickupId === pickup._id}>
                                    <Trash2 size={14} /> {deletingPickupId === pickup._id ? 'Menghapus...' : 'Hapus'}
                                </button>}
                            </div>
                        </div>
                    ))}
                </div>
                </section>
                </div>
            </CollapsibleCard>

            <CollapsibleCard
                title={`Tarif Billing Customer (${customerBillingRates.length})`}
                defaultOpen
            >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                    {canManageCustomer && <button className="btn btn-primary btn-sm" onClick={openNewBillingRate}>
                        <Plus size={14} /> Tambah Tarif
                    </button>}
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Jenis Armada</th><th>Basis</th><th>Tarif</th><th>Rute</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {customerBillingRates.length === 0 ? (
                                <tr><td colSpan={6} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada tarif billing untuk customer ini</td></tr>
                            ) : customerBillingRates.map(rate => (
                                <tr key={rate._id}>
                                    <td>{rate.serviceName || 'Semua jenis armada'}</td>
                                    <td>{getFreightNotaBillingModeLabel(rate.basis)}</td>
                                    <td className="font-medium">{formatCurrency(rate.rate)}</td>
                                    <td>{rate.routeFrom || rate.routeTo ? `${rate.routeFrom || '*'} -> ${rate.routeTo || '*'}` : 'Semua rute'}</td>
                                    <td><span className={`badge ${rate.active !== false ? 'badge-green' : 'badge-gray'}`}>{rate.active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
                                    <td>
                                        <div className="table-actions">
                                            {canManageCustomer && <button className="table-action-btn" onClick={() => openEditBillingRate(rate)}><Edit size={14} /> Edit</button>}
                                            {canManageCustomer && <button className="table-action-btn danger" onClick={() => handleDeleteBillingRate(rate._id)} disabled={deletingBillingRateId === rate._id}>
                                                <Trash2 size={14} /> {deletingBillingRateId === rate._id ? 'Menghapus...' : 'Hapus'}
                                            </button>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {customerBillingRates.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada tarif billing</div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-primary" onClick={openNewBillingRate}>
                                    <Plus size={16} /> Tambah Tarif
                                </button>}
                            </div>
                        </div>
                    ) : customerBillingRates.map(rate => (
                        <div key={rate._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{rate.serviceName || 'Semua jenis armada'}</div>
                                    <div className="mobile-record-subtitle">{getFreightNotaBillingModeLabel(rate.basis)} - {formatCurrency(rate.rate)}</div>
                                </div>
                                <span className={`badge ${rate.active !== false ? 'badge-green' : 'badge-gray'}`}>{rate.active !== false ? 'Aktif' : 'Nonaktif'}</span>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Rute</span>
                                    <span className="mobile-record-value">{rate.routeFrom || rate.routeTo ? `${rate.routeFrom || '*'} -> ${rate.routeTo || '*'}` : 'Semua rute'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-secondary" onClick={() => openEditBillingRate(rate)}><Edit size={14} /> Edit</button>}
                                {canManageCustomer && <button className="btn btn-danger" onClick={() => handleDeleteBillingRate(rate._id)} disabled={deletingBillingRateId === rate._id}>
                                    <Trash2 size={14} /> {deletingBillingRateId === rate._id ? 'Menghapus...' : 'Hapus'}
                                </button>}
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>

            <CollapsibleCard
                title={`Master Barang Customer (${customerProducts.length})`}
                defaultOpen
            >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                    {canManageCustomer && <button className="btn btn-primary btn-sm" onClick={openNewProduct}>
                        <Plus size={14} /> Tambah Barang
                    </button>}
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Kode</th><th>Nama Barang</th><th>Default Muatan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {customerProducts.length === 0 ? (
                                <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada master barang untuk customer ini</td></tr>
                            ) : (
                                customerProducts.map(product => (
                                    <tr key={product._id}>
                                        <td className="font-mono">{product.code || '-'}</td>
                                        <td>
                                            <div style={{ fontWeight: 600 }}>{product.name}</div>
                                            {product.description && product.description !== product.name && (
                                                <div className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>{product.description}</div>
                                            )}
                                            {product.notes && (
                                                <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>{product.notes}</div>
                                            )}
                                        </td>
                                        <td>{formatCargoSummary({
                                            qtyKoli: product.defaultQtyKoli,
                                            weightKg: product.defaultWeight,
                                            weightInputValue: product.defaultWeightInputValue,
                                            weightInputUnit: product.defaultWeightInputUnit,
                                            volumeM3: product.defaultVolume,
                                            volumeInputValue: product.defaultVolumeInputValue,
                                            volumeInputUnit: product.defaultVolumeInputUnit,
                                        })}</td>
                                        <td><span className={`badge ${product.active !== false ? 'badge-green' : 'badge-gray'}`}>{product.active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
                                        <td>
                                            <div className="table-actions">
                                                {canManageCustomer && <button className="table-action-btn" onClick={() => openEditProduct(product)}><Edit size={14} /> Edit</button>}
                                                {canManageCustomer && <button className="table-action-btn danger" onClick={() => handleDeleteProduct(product._id)} disabled={deletingProductId === product._id}>
                                                    <Trash2 size={14} /> {deletingProductId === product._id ? 'Menghapus...' : 'Hapus'}
                                                </button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {customerProducts.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada master barang</div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-primary" onClick={openNewProduct}>
                                    <Plus size={16} /> Tambah Barang
                                </button>}
                            </div>
                        </div>
                    ) : customerProducts.map(product => (
                        <div key={product._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{product.name}</div>
                                    <div className="mobile-record-subtitle">{product.code || 'Tanpa kode'}</div>
                                </div>
                                <span className={`badge ${product.active !== false ? 'badge-green' : 'badge-gray'}`}>{product.active !== false ? 'Aktif' : 'Nonaktif'}</span>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Muatan Default</span>
                                    <span className="mobile-record-value">{formatCargoSummary({
                                        qtyKoli: product.defaultQtyKoli,
                                        weightKg: product.defaultWeight,
                                        weightInputValue: product.defaultWeightInputValue,
                                        weightInputUnit: product.defaultWeightInputUnit,
                                        volumeM3: product.defaultVolume,
                                        volumeInputValue: product.defaultVolumeInputValue,
                                        volumeInputUnit: product.defaultVolumeInputUnit,
                                    })}</span>
                                </div>
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Catatan</span>
                                    <span className="mobile-record-value">{product.notes || product.description || '-'}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                {canManageCustomer && <button className="btn btn-secondary" onClick={() => openEditProduct(product)}>
                                    <Edit size={14} /> Edit
                                </button>}
                                {canManageCustomer && <button className="btn btn-danger" onClick={() => handleDeleteProduct(product._id)} disabled={deletingProductId === product._id}>
                                    <Trash2 size={14} /> {deletingProductId === product._id ? 'Menghapus...' : 'Hapus'}
                                </button>}
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>

            <CollapsibleCard title={canOpenCustomerOrderHistory ? `Order Terbaru (${orders.length})` : 'Order Terbaru'}>
                {canOpenCustomerOrderHistory ? (
                    <>
                        <div className="table-wrapper table-desktop-only">
                            <table>
                                <thead><tr><th>Resi</th><th>Penerima</th><th>Status</th><th>Tanggal</th></tr></thead>
                                <tbody>
                                    {orders.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada order</td></tr> :
                                        orders.slice(0, 10).map(o => (
                                            <tr key={o._id}>
                                                <td><Link href={`/orders/${o._id}`} style={{ color: 'var(--color-primary)' }}>{o.masterResi}</Link></td>
                                                <td>{o.receiverName}</td>
                                                <td>{o.status}</td>
                                                <td className="text-muted">{formatDate(o.createdAt)}</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="mobile-record-list">
                            {orders.length === 0 ? (
                                <div className="mobile-record-card">
                                    <div className="mobile-record-title">Belum ada order</div>
                                    <div className="mobile-record-subtitle">Customer ini belum punya order yang tercatat.</div>
                                </div>
                            ) : orders.slice(0, 10).map(order => (
                                <div key={order._id} className="mobile-record-card">
                                    <div className="mobile-record-header">
                                        <div>
                                            <div className="mobile-record-title">{order.masterResi}</div>
                                            <div className="mobile-record-subtitle">{order.receiverName}</div>
                                        </div>
                                        <span className="badge badge-info">{order.status}</span>
                                    </div>
                                    <div className="mobile-record-meta">
                                        <div className="mobile-record-kv">
                                            <span className="mobile-record-label">Tanggal</span>
                                            <span className="mobile-record-value">{formatDate(order.createdAt)}</span>
                                        </div>
                                    </div>
                                    <div className="mobile-record-actions">
                                        <Link href={`/orders/${order._id}`} className="btn btn-secondary">Lihat Order</Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="mobile-record-card">
                        <div className="mobile-record-title">Riwayat order tidak ditampilkan</div>
                        <div className="mobile-record-subtitle">Role Anda tidak punya akses ke halaman order, jadi detail order customer disembunyikan di sini.</div>
                    </div>
                )}
            </CollapsibleCard>

            <CollapsibleCard title={`Invoice Ongkos (${notas.length})`}>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>No. Invoice</th><th>Total</th><th>Status</th><th>Jatuh Tempo</th></tr></thead>
                        <tbody>
                            {notas.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada invoice</td></tr> :
                                notas.map(nota => (
                                    <tr key={nota._id}>
                                        <td><Link href={`/invoices/${nota._id}`} style={{ color: 'var(--color-primary)' }}>{nota.notaNumber}</Link></td>
                                        <td className="font-medium">{formatCurrency(getReceivableNetAmount(nota))}</td>
                                        <td>{nota.status}</td>
                                        <td className="text-muted">{formatDate(nota.dueDate)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {notas.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada invoice</div>
                        </div>
                    ) : notas.map(nota => (
                        <div key={nota._id} className="mobile-record-card">
                            <div className="mobile-record-header">
                                <div>
                                    <div className="mobile-record-title">{nota.notaNumber}</div>
                                    <div className="mobile-record-subtitle">Jatuh tempo {formatDate(nota.dueDate)}</div>
                                </div>
                                <span className="badge badge-info">{nota.status}</span>
                            </div>
                            <div className="mobile-record-meta">
                                <div className="mobile-record-kv">
                                    <span className="mobile-record-label">Invoice Final</span>
                                    <span className="mobile-record-value">{formatCurrency(getReceivableNetAmount(nota))}</span>
                                </div>
                            </div>
                            <div className="mobile-record-actions">
                                <Link href={`/invoices/${nota._id}`} className="btn btn-secondary">Lihat Invoice</Link>
                            </div>
                        </div>
                    ))}
                </div>
            </CollapsibleCard>
            </div>

            {canManageCustomer && showBillingRateModal && (
                <div className="modal-overlay" onClick={() => { if (!savingBillingRate) setShowBillingRateModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editBillingRate ? 'Edit Tarif Billing Customer' : 'Tambah Tarif Billing Customer'}</h3>
                            <button className="modal-close" onClick={() => setShowBillingRateModal(false)} disabled={savingBillingRate}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Jenis Armada</label>
                                    <select className="form-select" value={billingRateForm.serviceRef} onChange={e => setBillingRateForm(prev => ({ ...prev, serviceRef: e.target.value }))}>
                                        <option value="">Semua jenis armada</option>
                                        {services.map(service => (
                                            <option key={service._id} value={service._id}>{service.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Basis Tarif <span className="required">*</span></label>
                                    <select className="form-select" value={billingRateForm.basis} onChange={e => setBillingRateForm(prev => ({ ...prev, basis: e.target.value as CustomerBillingRateBasis }))}>
                                        {FREIGHT_NOTA_BILLING_MODE_OPTIONS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tarif <span className="required">*</span></label>
                                    <FormattedNumberInput allowDecimal={false} value={billingRateForm.rate} onValueChange={value => setBillingRateForm(prev => ({ ...prev, rate: value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={billingRateForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={e => setBillingRateForm(prev => ({ ...prev, active: e.target.value === 'ACTIVE' }))}>
                                        <option value="ACTIVE">Aktif</option>
                                        <option value="INACTIVE">Nonaktif</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Rute Dari</label>
                                    <input className="form-input" value={billingRateForm.routeFrom} onChange={e => setBillingRateForm(prev => ({ ...prev, routeFrom: e.target.value }))} placeholder="Kosong = semua asal" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Rute Tujuan</label>
                                    <input className="form-input" value={billingRateForm.routeTo} onChange={e => setBillingRateForm(prev => ({ ...prev, routeTo: e.target.value }))} placeholder="Kosong = semua tujuan" />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <input className="form-input" value={billingRateForm.notes} onChange={e => setBillingRateForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Opsional" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowBillingRateModal(false)} disabled={savingBillingRate}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSaveBillingRate} disabled={savingBillingRate}><Save size={16} /> {savingBillingRate ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

            {canManageCustomer && showRecipientModal && (
                <div className="modal-overlay" onClick={() => { if (!savingRecipient) setShowRecipientModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editRecipient ? 'Edit Tujuan / Penerima' : 'Tambah Tujuan / Penerima'}</h3>
                            <button className="modal-close" onClick={() => setShowRecipientModal(false)} disabled={savingRecipient}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Label Tujuan <span className="required">*</span></label>
                                <input className="form-input" value={recipientForm.label} onChange={e => setRecipientForm(prev => ({ ...prev, label: e.target.value }))} placeholder="Contoh: Gudang Gresik / Plant 2" />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Nama Penerima <span className="required">*</span></label>
                                    <input className="form-input" value={recipientForm.receiverName} onChange={e => setRecipientForm(prev => ({ ...prev, receiverName: e.target.value }))} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Telepon</label>
                                    <input className="form-input" value={recipientForm.receiverPhone} onChange={e => setRecipientForm(prev => ({ ...prev, receiverPhone: e.target.value }))} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Perusahaan Penerima</label>
                                <input className="form-input" value={recipientForm.receiverCompany} onChange={e => setRecipientForm(prev => ({ ...prev, receiverCompany: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Penerima <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={recipientForm.receiverAddress} onChange={e => setRecipientForm(prev => ({ ...prev, receiverAddress: e.target.value }))} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={recipientForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={e => setRecipientForm(prev => ({ ...prev, active: e.target.value === 'ACTIVE', isDefault: e.target.value === 'ACTIVE' ? prev.isDefault : false }))}>
                                        <option value="ACTIVE">Aktif</option>
                                        <option value="INACTIVE">Nonaktif</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Default</label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.65rem' }}>
                                        <input type="checkbox" checked={recipientForm.isDefault} onChange={e => setRecipientForm(prev => ({ ...prev, isDefault: e.target.checked, active: e.target.checked ? true : prev.active }))} />
                                        <span>Jadikan tujuan default customer</span>
                                    </label>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Catatan</label>
                                    <input className="form-input" value={recipientForm.notes} onChange={e => setRecipientForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Opsional" />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRecipientModal(false)} disabled={savingRecipient}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSaveRecipient} disabled={savingRecipient}><Save size={16} /> {savingRecipient ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

            {canManageCustomer && showPickupModal && (
                <div className="modal-overlay" onClick={() => { if (!savingPickup) setShowPickupModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editPickup ? 'Edit Lokasi Ambil' : 'Tambah Lokasi Ambil'}</h3>
                            <button className="modal-close" onClick={() => setShowPickupModal(false)} disabled={savingPickup}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Label Lokasi Ambil <span className="required">*</span></label>
                                <input className="form-input" value={pickupForm.label} onChange={e => setPickupForm(prev => ({ ...prev, label: e.target.value }))} placeholder="Contoh: Gudang Sidoarjo / Plant Waru" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Alamat Ambil <span className="required">*</span></label>
                                <textarea className="form-textarea" rows={3} value={pickupForm.pickupAddress} onChange={e => setPickupForm(prev => ({ ...prev, pickupAddress: e.target.value }))} />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={pickupForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={e => setPickupForm(prev => ({ ...prev, active: e.target.value === 'ACTIVE', isDefault: e.target.value === 'ACTIVE' ? prev.isDefault : false }))}>
                                        <option value="ACTIVE">Aktif</option>
                                        <option value="INACTIVE">Nonaktif</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Default</label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.65rem' }}>
                                        <input type="checkbox" checked={pickupForm.isDefault} onChange={e => setPickupForm(prev => ({ ...prev, isDefault: e.target.checked, active: e.target.checked ? true : prev.active }))} />
                                        <span>Jadikan lokasi ambil default customer</span>
                                    </label>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <input className="form-input" value={pickupForm.notes} onChange={e => setPickupForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Opsional" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPickupModal(false)} disabled={savingPickup}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSavePickup} disabled={savingPickup}><Save size={16} /> {savingPickup ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}

            {canManageCustomer && showProductModal && (
                <div className="modal-overlay" onClick={() => { if (!savingProduct) setShowProductModal(false); }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editProduct ? 'Edit Barang Customer' : 'Tambah Barang Customer'}</h3>
                            <button className="modal-close" onClick={() => setShowProductModal(false)} disabled={savingProduct}><X size={20} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kode Barang</label>
                                    <input className="form-input" value={productForm.code} onChange={e => setProductForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))} placeholder="Contoh: KRM-4040" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Nama Barang <span className="required">*</span></label>
                                    <input className="form-input" value={productForm.name} onChange={e => setProductForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Contoh: Keramik 40x40" />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Deskripsi Default</label>
                                <textarea className="form-textarea" rows={2} value={productForm.description} onChange={e => setProductForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Deskripsi item yang akan otomatis masuk ke order" />
                            </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Default Koli</label>
                                        <FormattedNumberInput min={0} allowDecimal={false} value={productForm.defaultQtyKoli} onValueChange={value => setProductForm(prev => ({ ...prev, defaultQtyKoli: value }))} />
                                    </div>
                                <div className="form-group">
                                    <label className="form-label">Status</label>
                                    <select className="form-select" value={productForm.active ? 'ACTIVE' : 'INACTIVE'} onChange={e => setProductForm(prev => ({ ...prev, active: e.target.value === 'ACTIVE' }))}>
                                        <option value="ACTIVE">Aktif</option>
                                        <option value="INACTIVE">Nonaktif</option>
                                    </select>
                                </div>
                            </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label className="form-label">Default Berat</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput
                                            min={0}
                                            maxFractionDigits={getWeightInputFractionDigits(productForm.defaultWeightInputUnit)}
                                            value={productForm.defaultWeightInputValue}
                                            onValueChange={value => setProductForm(prev => ({ ...prev, defaultWeightInputValue: value }))}
                                        />
                                        <select className="form-select" value={productForm.defaultWeightInputUnit} onChange={e => setProductForm(prev => ({ ...prev, defaultWeightInputUnit: e.target.value as WeightInputUnit }))} style={{ width: 100 }}>
                                            {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                    <div className="form-group">
                                        <label className="form-label">Default Volume</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                        <FormattedNumberInput
                                            min={0}
                                            allowDecimal={productForm.defaultVolumeInputUnit !== 'LITER'}
                                            maxFractionDigits={productForm.defaultVolumeInputUnit === 'LITER' ? 0 : 3}
                                            value={productForm.defaultVolumeInputValue}
                                            onValueChange={value => setProductForm(prev => ({ ...prev, defaultVolumeInputValue: value }))}
                                        />
                                        <select className="form-select" value={productForm.defaultVolumeInputUnit} onChange={e => setProductForm(prev => ({ ...prev, defaultVolumeInputUnit: e.target.value as VolumeInputUnit }))} style={{ width: 100 }}>
                                            {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan Internal</label>
                                <textarea className="form-textarea" rows={2} value={productForm.notes} onChange={e => setProductForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Catatan handling / catatan internal" />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowProductModal(false)} disabled={savingProduct}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSaveProduct} disabled={savingProduct}><Save size={16} /> {savingProduct ? 'Menyimpan...' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

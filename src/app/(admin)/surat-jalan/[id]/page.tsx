'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { FileText, MapPin, Plus, Save, Truck, X } from 'lucide-react';
import PageBackButton from '@/components/PageBackButton';
import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import SplitDecimalNumberInput from '@/components/SplitDecimalNumberInput';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    createDefaultDeliveryOrderCargoDraftItem,
    toDeliveryOrderCargoDraftItem,
    type DeliveryOrderCargoDraftItem,
} from '@/lib/delivery-order-cargo-draft-support';
import { getDeliveryOrderDisplayStatusMeta, isDeliveryOrderBillableDropType, isDeliveryOrderHoldDropType } from '@/lib/delivery-order-completion';
import {
    applyActualCargoAutoWeightFromQty,
    applyActualDropAutoWeightFromQty,
    buildActualCargoDrafts,
    buildDefaultActualDropDrafts,
    buildDeliveryOrderDetailState,
    createEmptyActualDropDraft,
    getActualCargoDraftsForDrop,
    getNextDeliveryOrderStatuses,
    shouldLockActualCargoVolume,
    shouldLockActualDropWeight,
    shouldLockActualDropVolume,
    shouldOpenAdvancedDropEditor,
    summarizeActualCargoDraftDescriptions,
    type ActualCargoDraft,
    type ActualDropDraft,
} from '@/lib/delivery-order-detail-support';
import { deriveSuratJalanDocumentStatus } from '@/lib/trip-document-mappers';
import { convertKgToWeightInputValue, convertM3ToVolumeInputValue, convertVolumeToM3, convertWeightToKg, formatCargoSummary, getWeightInputFractionDigits, VOLUME_INPUT_UNIT_OPTIONS, WEIGHT_INPUT_UNIT_OPTIONS } from '@/lib/measurement';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    applyCustomerProductToOrderItem,
    applyOrderItemAutoWeightFromQty,
    shouldLockOrderItemVolume,
    shouldLockOrderItemWeight,
    updateOrderItemVolumeUnit,
    updateOrderItemWeightUnit,
} from '@/lib/order-create-page-support';
import type { CustomerProduct, DeliveryOrder, DeliveryOrderItem, DeliveryOrderShipperReference, FreightNota, FreightNotaItem, Order, OrderItem } from '@/lib/types';
import type { SuratJalanDetailSnapshot, SuratJalanDocument, SuratJalanDocumentItem } from '@/lib/trip-document-types';
import { DO_ACTUAL_DROP_TYPE_MAP, DO_STATUS_MAP, formatDate, formatInternalDeliveryOrderNumber } from '@/lib/utils';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import {
    buildAdminLoadNotice,
    getAdminErrorMessage,
    isAccessDeniedMessage,
    isNotFoundMessage,
    type AdminLoadNotice,
} from '@/lib/admin-access-messages';
import { useApp, useToast } from '../../layout';

type ActualDropItemValueDraft = Pick<
    ActualDropDraft,
    'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit'
>;

type EditSuratJalanForm = {
    referenceNumber: string;
    pickupStopKey: string;
    billingCustomerRef: string;
    billingCustomerName: string;
    receiverName: string;
    receiverPhone: string;
    receiverCompany: string;
    receiverAddress: string;
};

type EditExistingCargoItem = DeliveryOrderCargoDraftItem & {
    deliveryOrderItemId: string;
};

const ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR = '::item::';

function buildActualDropItemValueKey(draftKey: string, deliveryOrderItemRef: string) {
    return `${draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}${deliveryOrderItemRef}`;
}

function parseActualDropItemValueKey(valueKey: string) {
    const separatorIndex = valueKey.indexOf(ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR);
    if (separatorIndex < 0) {
        return null;
    }
    return {
        draftKey: valueKey.slice(0, separatorIndex),
        deliveryOrderItemRef: valueKey.slice(separatorIndex + ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR.length),
    };
}

function pickActualDropItemValues(drop: ActualDropDraft): ActualDropItemValueDraft {
    return {
        qtyKoli: drop.qtyKoli,
        weightInputValue: drop.weightInputValue,
        weightInputUnit: drop.weightInputUnit,
        volumeInputValue: drop.volumeInputValue,
        volumeInputUnit: drop.volumeInputUnit,
    };
}

function hasActualDropItemValues(values: ActualDropItemValueDraft) {
    const qtyKoli = parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 });
    const weightKg = convertWeightToKg(
        parseFormattedNumberish(values.weightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
        }),
        values.weightInputUnit
    );
    const volumeM3 = convertVolumeToM3(
        parseFormattedNumberish(values.volumeInputValue || 0, {
            maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
        }),
        values.volumeInputUnit
    );
    return qtyKoli > 0 || weightKg > 0 || volumeM3 > 0;
}

function hasCargoSummaryValue(summary?: { qtyKoli?: number; weightKg?: number; volumeM3?: number }) {
    return Boolean(
        (summary?.qtyKoli || 0) > 0 ||
        (summary?.weightKg || 0) > 0 ||
        (summary?.volumeM3 || 0) > 0
    );
}

function formatItemCodeNameLabel(code: string, name: string, fallback: string) {
    const cleanCode = code.trim();
    const cleanName = name.trim();
    if (cleanCode && cleanName) return `${cleanCode} - ${cleanName}`;
    return cleanName || cleanCode || fallback;
}

export default function SuratJalanDetailPage() {
    const params = useParams();
    const pathname = usePathname();
    const { addToast } = useToast();
    const { user } = useApp();
    const id = decodeURIComponent((params.id as string) || '');
    const [suratJalanDocument, setSuratJalanDocument] = useState<SuratJalanDocument | null>(null);
    const [deliveryOrder, setDeliveryOrder] = useState<DeliveryOrder | null>(null);
    const [sourceOrder, setSourceOrder] = useState<Order | null>(null);
    const [documentItems, setDocumentItems] = useState<SuratJalanDocumentItem[]>([]);
    const [deliveryOrderItems, setDeliveryOrderItems] = useState<DeliveryOrderItem[]>([]);
    const [linkedOrderItems, setLinkedOrderItems] = useState<Array<Pick<OrderItem, '_id' | 'customerProductRef' | 'customerProductCode' | 'customerProductName'>>>([]);
    const [linkedFreightNotas, setLinkedFreightNotas] = useState<FreightNota[]>([]);
    const [customerProducts, setCustomerProducts] = useState<CustomerProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadNotice, setLoadNotice] = useState<AdminLoadNotice | null>(null);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showActualEditModal, setShowActualEditModal] = useState(false);
    const [showActualCargoFinalizationModal, setShowActualCargoFinalizationModal] = useState(false);
    const [activeFinalizationCargoItemRef, setActiveFinalizationCargoItemRef] = useState('');
    const [activeFinalizationDropKey, setActiveFinalizationDropKey] = useState('');
    const [newStatus, setNewStatus] = useState('');
    const [statusNote, setStatusNote] = useState('');
    const [podName, setPodName] = useState('');
    const [podDate, setPodDate] = useState(getBusinessDateValue());
    const [podNote, setPodNote] = useState('');
    const [actualCargoItems, setActualCargoItems] = useState<ActualCargoDraft[]>([]);
    const [actualDropPoints, setActualDropPoints] = useState<ActualDropDraft[]>([]);
    const [actualDropItemValueMap, setActualDropItemValueMap] = useState<Record<string, ActualDropItemValueDraft>>({});
    const [showAdvancedDropEditor, setShowAdvancedDropEditor] = useState(false);
    const [continuingHeldCargo, setContinuingHeldCargo] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [savingActualEdit, setSavingActualEdit] = useState(false);
    const [removingCargoItemId, setRemovingCargoItemId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<EditSuratJalanForm>({
        referenceNumber: '',
        pickupStopKey: '',
        billingCustomerRef: '',
        billingCustomerName: '',
        receiverName: '',
        receiverPhone: '',
        receiverCompany: '',
        receiverAddress: '',
    });
    const [editExistingItems, setEditExistingItems] = useState<EditExistingCargoItem[]>([]);
    const [editNewItems, setEditNewItems] = useState<DeliveryOrderCargoDraftItem[]>([]);
    const [actualEditItems, setActualEditItems] = useState<ActualCargoDraft[]>([]);
    const [selectedActualEditItemRef, setSelectedActualEditItemRef] = useState('');
    const canOpenTripPage = user ? hasPageAccess(user, 'deliveryOrders') : false;
    const canOpenOrderPage = user ? hasPageAccess(user, 'orders') : false;
    const canOpenCustomerPage = user ? hasPageAccess(user, 'customers') : false;
    const canOpenInvoicePage = user ? hasPageAccess(user, 'invoices') : false;
    const canViewFreightNotas = user ? hasPermission(user, 'invoices', 'view') : false;
    const canManageDeliveryStatus = user ? hasPermission(user, 'deliveryOrders', 'update') : false;
    const canEditSuratJalan = canManageDeliveryStatus;
    const currentPath = pathname || `/surat-jalan/${encodeURIComponent(id)}`;
    const withReturnTo = (href: string) => `${href}${href.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(currentPath)}`;
    const resolveDocumentItemDeliveryOrderItemRef = (item: SuratJalanDocumentItem) => {
        if (item.sourceDeliveryOrderItemRef?.trim()) {
            return item.sourceDeliveryOrderItemRef.trim();
        }
        const rawId = item._id || '';
        const separatorIndex = rawId.lastIndexOf(':');
        if (separatorIndex >= 0 && separatorIndex < rawId.length - 1) {
            return rawId.slice(separatorIndex + 1).trim();
        }
        return '';
    };
    const updateEditForm = (patch: Partial<EditSuratJalanForm>) => {
        setEditForm(current => ({ ...current, ...patch }));
    };
    const loadOptionalCollection = useCallback(async <T,>(url: string, fallbackMessage: string): Promise<T[]> => {
        try {
            return await fetchAdminCollectionData<T[]>(url, fallbackMessage);
        } catch (error) {
            const message = getAdminErrorMessage(error, fallbackMessage);
            if (!isAccessDeniedMessage(message)) {
                addToast('error', message);
            }
            return [];
        }
    }, [addToast]);
    const getFallbackShipperReference = (): DeliveryOrderShipperReference => ({
        _key: suratJalanDocument?.referenceKey && suratJalanDocument.referenceKey !== 'primary'
            ? suratJalanDocument.referenceKey
            : undefined,
        sequence: 1,
        referenceNumber: suratJalanDocument?.suratJalanNumber || deliveryOrder?.customerDoNumber || '',
        pickupStopKey: deliveryOrder?.pickupStops?.length === 1 ? deliveryOrder.pickupStops[0]._key : undefined,
        pickupAddress: suratJalanDocument?.pickupAddress || deliveryOrder?.pickupAddress,
        billingCustomerRef: suratJalanDocument?.customerRef || deliveryOrder?.customerRef,
        billingCustomerName: suratJalanDocument?.customerName || deliveryOrder?.customerName,
        receiverName: suratJalanDocument?.receiverName || deliveryOrder?.receiverName,
        receiverPhone: deliveryOrder?.receiverPhone,
        receiverAddress: suratJalanDocument?.receiverAddress || deliveryOrder?.receiverAddress,
        receiverCompany: suratJalanDocument?.receiverCompany || deliveryOrder?.receiverCompany,
    });
    const findCurrentReferenceIndex = (references: DeliveryOrderShipperReference[]) => {
        if (!suratJalanDocument) {
            return -1;
        }
        const referenceKey = (suratJalanDocument.referenceKey || '').trim();
        const referenceNumber = (suratJalanDocument.suratJalanNumber || '').trim().toUpperCase();
        return references.findIndex(reference =>
            (referenceKey && reference._key === referenceKey) ||
            (referenceNumber && reference.referenceNumber?.trim().toUpperCase() === referenceNumber)
        );
    };
    const getEditableShipperReferences = () => {
        const references = deliveryOrder?.shipperReferences?.length
            ? deliveryOrder.shipperReferences
            : [getFallbackShipperReference()];
        return references.map((reference, index) => ({
            ...reference,
            sequence: reference.sequence || index + 1,
        }));
    };
    const updateExistingItem = <K extends keyof DeliveryOrderCargoDraftItem>(itemIndex: number, field: K, value: DeliveryOrderCargoDraftItem[K]) => {
        setEditExistingItems(previous => previous.map((item, index) => {
            if (index !== itemIndex) return item;
            if (field === 'qtyKoli') {
                return {
                    ...item,
                    ...toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                        ...item,
                        pickupStopKey: editForm.pickupStopKey,
                        shipperReferenceNumber: editForm.referenceNumber,
                    }, value as number)),
                };
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
    const updateNewItem = <K extends keyof DeliveryOrderCargoDraftItem>(itemIndex: number, field: K, value: DeliveryOrderCargoDraftItem[K]) => {
        setEditNewItems(previous => previous.map((item, index) => {
            if (index !== itemIndex) return item;
            if (field === 'qtyKoli') {
                return toDeliveryOrderCargoDraftItem(applyOrderItemAutoWeightFromQty({
                    ...item,
                    pickupStopKey: editForm.pickupStopKey,
                    shipperReferenceNumber: editForm.referenceNumber,
                }, value as number));
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
    const applyExistingItemProduct = (itemIndex: number, productRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === productRef);
        setEditExistingItems(previous => previous.map((item, index) => (
            index === itemIndex
                ? {
                    ...item,
                    ...toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                        ...item,
                        pickupStopKey: editForm.pickupStopKey,
                        shipperReferenceNumber: editForm.referenceNumber,
                    }, selectedProduct)),
                    deliveryOrderItemId: item.deliveryOrderItemId,
                }
                : item
        )));
    };
    const applyNewItemProduct = (itemIndex: number, productRef: string) => {
        const selectedProduct = customerProducts.find(product => product._id === productRef);
        setEditNewItems(previous => previous.map((item, index) => (
            index === itemIndex
                ? toDeliveryOrderCargoDraftItem(applyCustomerProductToOrderItem({
                    ...item,
                    pickupStopKey: editForm.pickupStopKey,
                    shipperReferenceNumber: editForm.referenceNumber,
                }, selectedProduct))
                : item
        )));
    };
    const addNewItem = () => setEditNewItems(previous => [...previous, createDefaultDeliveryOrderCargoDraftItem()]);
    const removeNewItem = (itemIndex: number) => setEditNewItems(previous => previous.filter((_, index) => index !== itemIndex));
    const removeExistingItem = async (item: EditExistingCargoItem) => {
        if (!deliveryOrder || !canEditSuratJalan || deliveryOrder.tripClosedByAdminAt) return;
        const confirmed = window.confirm(`Hapus barang ${item.description || 'ini'} dari Surat Jalan?`);
        if (!confirmed) return;
        setRemovingCargoItemId(item.deliveryOrderItemId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'remove-cargo-item',
                    data: {
                        id: deliveryOrder._id,
                        deliveryOrderItemId: item.deliveryOrderItemId,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus barang dari Surat Jalan');
                return;
            }
            setEditExistingItems(previous => previous.filter(entry => entry.deliveryOrderItemId !== item.deliveryOrderItemId));
            await loadDocument();
            addToast('success', 'Barang Surat Jalan berhasil dihapus');
        } catch {
            addToast('error', 'Gagal menghapus barang dari Surat Jalan');
        } finally {
            setRemovingCargoItemId(null);
        }
    };
    const saveEdit = async () => {
        if (!deliveryOrder || !suratJalanDocument || !canEditSuratJalan || deliveryOrder.tripClosedByAdminAt) return;
        const nextReferenceNumber = editForm.referenceNumber.trim().toUpperCase();
        if (!nextReferenceNumber) {
            addToast('error', 'No. Surat Jalan wajib diisi');
            return;
        }

        const references = getEditableShipperReferences();
        const currentIndex = findCurrentReferenceIndex(references);
        const targetIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextReferences = references.map((reference, index) => (
            index === targetIndex
                ? {
                    ...reference,
                    referenceNumber: nextReferenceNumber,
                    pickupStopKey: editForm.pickupStopKey.trim() || undefined,
                    billingCustomerRef: '',
                    billingCustomerName: '',
                    receiverName: '',
                    receiverPhone: '',
                    receiverCompany: '',
                    receiverAddress: '',
                }
                : reference
        ));
        const normalizeDraftValue = (value: unknown) => String(value ?? '').trim();
        const normalizedExistingItems = editExistingItems.map(item => ({
            deliveryOrderItemId: item.deliveryOrderItemId,
            customerProductRef: normalizeDraftValue(item.customerProductRef),
            description: normalizeDraftValue(item.description),
            qtyKoli: normalizeDraftValue(item.qtyKoli),
            weightInputValue: normalizeDraftValue(item.weightInputValue),
            weightInputUnit: item.weightInputUnit,
            volumeInputValue: normalizeDraftValue(item.volumeInputValue),
            volumeInputUnit: item.volumeInputUnit,
        }));
        const normalizedNewItems = editNewItems
            .map(item => ({
                customerProductRef: normalizeDraftValue(item.customerProductRef),
                description: normalizeDraftValue(item.description),
                qtyKoli: normalizeDraftValue(item.qtyKoli),
                weightInputValue: normalizeDraftValue(item.weightInputValue),
                weightInputUnit: item.weightInputUnit,
                volumeInputValue: normalizeDraftValue(item.volumeInputValue),
                volumeInputUnit: item.volumeInputUnit,
            }))
            .filter(item => Boolean(item.customerProductRef || item.description || item.qtyKoli || item.weightInputValue || item.volumeInputValue));
        const invalidExistingItemIndex = normalizedExistingItems.findIndex(item => !item.description && !item.customerProductRef);
        if (invalidExistingItemIndex >= 0) {
            addToast('error', `Barang tersimpan baris ${invalidExistingItemIndex + 1} perlu deskripsi atau master barang.`);
            return;
        }
        const invalidExistingCargoIndex = normalizedExistingItems.findIndex(item => !item.qtyKoli && !item.weightInputValue && !item.volumeInputValue);
        if (invalidExistingCargoIndex >= 0) {
            addToast('error', `Barang tersimpan baris ${invalidExistingCargoIndex + 1} perlu isi koli, berat, atau volume.`);
            return;
        }
        const invalidNewItemIndex = normalizedNewItems.findIndex(item => !item.description && !item.customerProductRef);
        if (invalidNewItemIndex >= 0) {
            addToast('error', `Barang baru baris ${invalidNewItemIndex + 1} perlu deskripsi atau master barang.`);
            return;
        }
        const invalidNewCargoIndex = normalizedNewItems.findIndex(item => !item.qtyKoli && !item.weightInputValue && !item.volumeInputValue);
        if (invalidNewCargoIndex >= 0) {
            addToast('error', `Barang baru baris ${invalidNewCargoIndex + 1} perlu isi koli, berat, atau volume.`);
            return;
        }

        setSavingEdit(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-shipper-reference',
                    data: {
                        id: deliveryOrder._id,
                        customerDoNumber: nextReferences[0]?.referenceNumber,
                        shipperReferences: nextReferences.map(reference => ({
                            _key: reference._key,
                            referenceNumber: reference.referenceNumber,
                            pickupStopKey: reference.pickupStopKey,
                            billingCustomerRef: '',
                            billingCustomerName: '',
                            receiverName: '',
                            receiverPhone: '',
                            receiverCompany: '',
                            receiverAddress: '',
                        })),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan Surat Jalan');
                return;
            }
            for (const item of normalizedExistingItems) {
                const cargoUpdateRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'update-cargo-item',
                        data: {
                            id: deliveryOrder._id,
                            deliveryOrderItemId: item.deliveryOrderItemId,
                            cargoItem: {
                                customerProductRef: item.customerProductRef || undefined,
                                description: item.description,
                                qtyKoli: item.qtyKoli,
                                weightInputValue: item.weightInputValue,
                                weightInputUnit: item.weightInputUnit,
                                volumeInputValue: item.volumeInputValue,
                                volumeInputUnit: item.volumeInputUnit,
                                shipperReferenceNumber: nextReferenceNumber,
                                pickupStopKey: editForm.pickupStopKey.trim() || undefined,
                            },
                        },
                    }),
                });
                const cargoUpdateResult = await cargoUpdateRes.json();
                if (!cargoUpdateRes.ok) {
                    addToast('error', cargoUpdateResult.error || 'SJ tersimpan, tapi gagal memperbarui barang terdaftar.');
                    return;
                }
            }
            if (normalizedNewItems.length > 0) {
                const cargoRes = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        entity: 'delivery-orders',
                        action: 'append-cargo-items',
                        data: {
                            id: deliveryOrder._id,
                            cargoItems: normalizedNewItems.map(item => ({
                                ...item,
                                shipperReferenceNumber: nextReferenceNumber,
                                pickupStopKey: editForm.pickupStopKey.trim() || undefined,
                            })),
                        },
                    }),
                });
                const cargoResult = await cargoRes.json();
                if (!cargoRes.ok) {
                    addToast('error', cargoResult.error || 'SJ tersimpan, tapi gagal menambah barang baru.');
                    return;
                }
            }
            setShowEditModal(false);
            setEditNewItems([]);
            await loadDocument();
            addToast('success', 'Surat Jalan berhasil diperbarui');
        } catch {
            addToast('error', 'Gagal menyimpan Surat Jalan');
        } finally {
            setSavingEdit(false);
        }
    };

    const loadDocument = useCallback(async () => {
        setLoading(true);
        setLoadNotice(null);
        try {
            const detail = await fetchAdminData<SuratJalanDetailSnapshot | null>(
                `/api/data?entity=surat-jalan-detail&id=${encodeURIComponent(id)}`,
                'Gagal memuat detail surat jalan'
            );
            if (!detail?.suratJalanDocument || !detail.deliveryOrder) {
                setSuratJalanDocument(null);
                setDeliveryOrder(null);
                setSourceOrder(null);
                setDocumentItems([]);
                setDeliveryOrderItems([]);
                setLinkedOrderItems([]);
                setLinkedFreightNotas([]);
                return;
            }
            const loadedDeliveryOrderItems = await fetchAdminCollectionData<DeliveryOrderItem[]>(
                `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: detail.deliveryOrder._id }))}`,
                'Gagal memuat detail surat jalan'
            );
            const linkedOrderItemRefs = Array.from(new Set(
                (loadedDeliveryOrderItems || [])
                    .map(item => item.orderItemRef)
                    .filter((value): value is string => Boolean(value))
            ));
            const loadedLinkedOrderItems = linkedOrderItemRefs.length > 0
                ? await loadOptionalCollection<Pick<OrderItem, '_id' | 'customerProductRef' | 'customerProductCode' | 'customerProductName'>>(
                    `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ _id: linkedOrderItemRefs }))}`,
                    'Gagal memuat item order surat jalan'
                )
                : [];
            const productRows = detail.deliveryOrder.customerRef && canEditSuratJalan && canOpenCustomerPage
                ? await loadOptionalCollection<CustomerProduct>(
                    `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: detail.deliveryOrder.customerRef, active: true }))}`,
                    'Gagal memuat master barang customer'
                )
                : [];
            const invoiceItems = canViewFreightNotas
                ? await loadOptionalCollection<FreightNotaItem>(
                    `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ doRef: detail.deliveryOrder._id }))}`,
                    'Gagal memuat invoice surat jalan'
                )
                : [];
            const normalizedSuratJalanNumber = (detail.suratJalanDocument.suratJalanNumber || '').trim().toUpperCase();
            const activeInvoiceRefs = Array.from(new Set(
                (invoiceItems || [])
                    .filter(item => item.status !== 'VOID')
                    .filter(item => !normalizedSuratJalanNumber || (item.noSJ || '').trim().toUpperCase() === normalizedSuratJalanNumber)
                    .map(item => item.notaRef)
                    .filter((value): value is string => Boolean(value))
            ));
            const freightNotas = activeInvoiceRefs.length > 0
                ? await loadOptionalCollection<FreightNota>(
                    `/api/data?entity=freight-notas&filter=${encodeURIComponent(JSON.stringify({ _id: activeInvoiceRefs }))}`,
                    'Gagal memuat invoice surat jalan'
                )
                : [];
            setSuratJalanDocument(detail.suratJalanDocument);
            setDeliveryOrder(detail.deliveryOrder);
            setSourceOrder(detail.sourceOrder);
            setDocumentItems(detail.documentItems || []);
            setDeliveryOrderItems(loadedDeliveryOrderItems || []);
            setLinkedOrderItems(loadedLinkedOrderItems || []);
            setLinkedFreightNotas((freightNotas || []).filter(item => item.status !== 'VOID'));
            setCustomerProducts(productRows || []);
        } catch (error) {
            const message = getAdminErrorMessage(error, 'Gagal memuat detail surat jalan');
            if (!isNotFoundMessage(message)) {
                setLoadNotice(buildAdminLoadNotice(
                    message,
                    'detail Surat Jalan',
                    'Halaman ini hanya bisa dilihat oleh role yang punya akses Surat Jalan.'
                ));
            }
            addToast('error', message);
        } finally {
            setLoading(false);
        }
    }, [addToast, canEditSuratJalan, canOpenCustomerPage, canViewFreightNotas, id, loadOptionalCollection]);

    useEffect(() => {
        void loadDocument();
    }, [loadDocument]);

    if (loading) {
        return <div className="empty-state"><div className="empty-state-title">Memuat detail surat jalan...</div></div>;
    }

    if (!deliveryOrder || !suratJalanDocument) {
        if (loadNotice) {
            return (
                <div className="empty-state">
                    <FileText size={48} className="empty-state-icon" />
                    <div className="empty-state-title">{loadNotice.title}</div>
                    <div className="empty-state-text">{loadNotice.text}</div>
                </div>
            );
        }
        return <div className="empty-state"><div className="empty-state-title">Surat jalan tidak ditemukan</div></div>;
    }

    const hasSuratJalanHoldCargo =
        (suratJalanDocument.holdCargo?.qtyKoli || 0) > 0 ||
        (suratJalanDocument.holdCargo?.weightKg || 0) > 0 ||
        (suratJalanDocument.holdCargo?.volumeM3 || 0) > 0;
    const rawSuratJalanStatus = suratJalanDocument.tripStatus || deriveSuratJalanDocumentStatus(deliveryOrder.status || 'CREATED', suratJalanDocument);
    const effectiveSuratJalanStatus = hasSuratJalanHoldCargo && rawSuratJalanStatus === 'DELIVERED'
        ? 'PARTIAL_HOLD'
        : rawSuratJalanStatus;
    const tripStatusMeta = DO_STATUS_MAP[effectiveSuratJalanStatus] || getDeliveryOrderDisplayStatusMeta(deliveryOrder);
    const availableStatuses = getNextDeliveryOrderStatuses(effectiveSuratJalanStatus).filter(status =>
        status === 'CREATED' ||
        status === 'CANCELLED' ||
        Boolean(deliveryOrder.vehicleRef && deliveryOrder.driverRef)
    );
    const isDeliveredStatus = effectiveSuratJalanStatus === 'DELIVERED';
    const deliveredItemCount = documentItems.filter(item =>
        (item.actualCargo?.qtyKoli || 0) > 0 ||
        (item.actualCargo?.weightKg || 0) > 0 ||
        (item.actualCargo?.volumeM3 || 0) > 0
    ).length;
    const deliveredActualCargoSummary = documentItems.reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + (item.actualCargo?.qtyKoli || 0),
        weightKg: sum.weightKg + (item.actualCargo?.weightKg || 0),
        volumeM3: sum.volumeM3 + (item.actualCargo?.volumeM3 || 0),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const summarizeDocumentItemActualDrops = (
        item: SuratJalanDocumentItem,
        predicate: (stopType: NonNullable<DeliveryOrder['actualDropPoints']>[number]['stopType']) => boolean
    ) => {
        const itemReferenceNumber = item.suratJalanNumber.trim().toUpperCase();
        const summary = (deliveryOrder?.actualDropPoints || [])
            .filter(point => predicate(point.stopType))
            .filter(point => {
                if (point.deliveryOrderItemRef) {
                    return point.deliveryOrderItemRef === item.sourceDeliveryOrderItemRef;
                }
                if (Array.isArray(point.deliveryOrderItemRefs) && point.deliveryOrderItemRefs.length > 0) {
                    return point.deliveryOrderItemRefs.includes(item.sourceDeliveryOrderItemRef);
                }
                if (point.shipperReferenceKey) {
                    return point.shipperReferenceKey === item.referenceKey;
                }
                return Boolean(point.shipperReferenceNumber && point.shipperReferenceNumber.trim().toUpperCase() === itemReferenceNumber);
            })
            .reduce((sum, point) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + (
                    point.weightInputValue !== undefined
                        ? convertWeightToKg(
                            parseFormattedNumberish(point.weightInputValue || 0, {
                                maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit || 'KG'),
                            }),
                            point.weightInputUnit || 'KG'
                        )
                        : parseFormattedNumberish(point.weightKg || 0, { maxFractionDigits: 2 })
                ),
                volumeM3: sum.volumeM3 + (
                    point.volumeInputValue !== undefined
                        ? convertVolumeToM3(
                            parseFormattedNumberish(point.volumeInputValue || 0, {
                                maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
                            }),
                            point.volumeInputUnit || 'M3'
                        )
                        : parseFormattedNumberish(point.volumeM3 || 0, { maxFractionDigits: 3 })
                ),
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        return hasCargoSummaryValue(summary) ? formatCargoSummary(summary) : '-';
    };
    const isCompletingDelivery = newStatus === 'DELIVERED';
    const selectedDocumentItemRefs = new Set(
        documentItems
            .map(item => resolveDocumentItemDeliveryOrderItemRef(item))
            .filter(Boolean)
    );
    const deliveredDocumentItemRefs = new Set(
        documentItems
            .filter(item => hasCargoSummaryValue(item.actualCargo))
            .map(item => resolveDocumentItemDeliveryOrderItemRef(item))
            .filter(Boolean)
    );
    const selectedDeliveryOrderItems = deliveryOrderItems.filter(item => selectedDocumentItemRefs.has(item._id));
    const actualEditSelectableItems = actualEditItems.filter(item => deliveredDocumentItemRefs.has(item.deliveryOrderItemRef));
    const selectedActualEditItem =
        actualEditItems.find(item => item.deliveryOrderItemRef === selectedActualEditItemRef) ||
        actualEditSelectableItems[0] ||
        null;
    const linkedOrderItemById = new Map(linkedOrderItems.map(item => [item._id, item]));
    const customerProductById = new Map(customerProducts.map(item => [item._id, item]));
    const getDeliveryOrderItemIdentity = (item?: Pick<DeliveryOrderItem, '_id' | 'orderItemRef' | 'orderItemDescription'> | null) => {
        const linkedOrderItem = item?.orderItemRef ? linkedOrderItemById.get(item.orderItemRef) : undefined;
        const product = linkedOrderItem?.customerProductRef ? customerProductById.get(linkedOrderItem.customerProductRef) : undefined;
        return {
            code: linkedOrderItem?.customerProductCode || product?.code || '',
            name: linkedOrderItem?.customerProductName || product?.name || item?.orderItemDescription || '',
        };
    };
    const getActualEditItemLabel = (item: Pick<ActualCargoDraft, 'deliveryOrderItemRef' | 'description'>, fallbackIndex?: number) => {
        const deliveryOrderItem = deliveryOrderItems.find(row => row._id === item.deliveryOrderItemRef);
        const identity = getDeliveryOrderItemIdentity(deliveryOrderItem);
        return formatItemCodeNameLabel(identity.code, identity.name || item.description, fallbackIndex !== undefined ? `Item ${fallbackIndex + 1}` : item.deliveryOrderItemRef);
    };
    const matchesSelectedSuratJalan = (shipperReferenceKey?: string, shipperReferenceNumber?: string) => {
        const normalizedKey = (shipperReferenceKey || '').trim();
        const normalizedNumber = (shipperReferenceNumber || '').trim().toUpperCase();
        const documentKey = (suratJalanDocument.referenceKey || '').trim();
        const documentNumber = (suratJalanDocument.suratJalanNumber || '').trim().toUpperCase();
        return (
            (documentKey && normalizedKey === documentKey) ||
            (documentNumber && normalizedNumber === documentNumber) ||
            (!documentKey && !documentNumber && !normalizedKey && !normalizedNumber)
        );
    };
    const actualDropShipperReference = {
        referenceKey: suratJalanDocument.referenceKey || '',
        referenceNumber: suratJalanDocument.suratJalanNumber || '',
        receiverName: suratJalanDocument.receiverName || deliveryOrder.receiverName || '',
        receiverCompany: suratJalanDocument.receiverCompany || deliveryOrder.receiverCompany || '',
        receiverAddress: suratJalanDocument.receiverAddress || deliveryOrder.receiverAddress || '',
    };
    const getActualDropItemOptions = (
        drop?: Pick<ActualDropDraft, 'deliveryOrderItemRef' | 'shipperReferenceKey' | 'shipperReferenceNumber'>
    ) => {
        const baseItems = actualCargoItems.filter(item => matchesSelectedSuratJalan(item.shipperReferenceKey, item.shipperReferenceNumber));
        if (!drop) {
            return baseItems;
        }

        const deliveryOrderItemRef = drop.deliveryOrderItemRef.trim();
        if (deliveryOrderItemRef) {
            return baseItems.filter(item => item.deliveryOrderItemRef === deliveryOrderItemRef);
        }

        const shipperReferenceKey = drop.shipperReferenceKey.trim();
        const shipperReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
        if (!shipperReferenceKey && !shipperReferenceNumber) {
            return baseItems;
        }

        return baseItems.filter(item => (
            (shipperReferenceKey && item.shipperReferenceKey === shipperReferenceKey) ||
            (shipperReferenceNumber && item.shipperReferenceNumber.trim().toUpperCase() === shipperReferenceNumber)
        ));
    };
    const getActualCargoItemWeightKg = (item: ActualCargoDraft) => convertWeightToKg(
        parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        }),
        item.actualWeightInputUnit
    );
    const getActualCargoItemVolumeM3 = (item: ActualCargoDraft) => convertVolumeToM3(
        parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        }),
        item.actualVolumeInputUnit
    );
    const selectedActualCargoItems = actualCargoItems.filter(item => selectedDocumentItemRefs.has(item.deliveryOrderItemRef));
    const selectedActualDropPoints = actualDropPoints.filter(drop =>
        selectedDocumentItemRefs.has(drop.deliveryOrderItemRef) || matchesSelectedSuratJalan(drop.shipperReferenceKey, drop.shipperReferenceNumber)
    );
    const expandActualDropPointAllocations = (drop: ActualDropDraft, cargoItems: ActualCargoDraft[]) =>
        cargoItems
            .map(cargoItem => {
                const allocation = getActualDropAllocationForItem(drop, cargoItem);
                const values = pickActualDropItemValues(allocation);
                if (!hasActualDropItemValues(values)) {
                    return null;
                }
                const isVisibleItem = drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef;
                return {
                    ...drop,
                    ...values,
                    draftKey: isVisibleItem
                        ? drop.draftKey
                        : `${drop.draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}${cargoItem.deliveryOrderItemRef}`,
                    deliveryOrderItemRef: cargoItem.deliveryOrderItemRef,
                    shipperReferenceKey: cargoItem.shipperReferenceKey || drop.shipperReferenceKey,
                    shipperReferenceNumber: cargoItem.shipperReferenceNumber || drop.shipperReferenceNumber,
                };
            })
            .filter((drop): drop is ActualDropDraft => Boolean(drop));
    const selectedWorkingActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }
        return selectedActualDropPoints.flatMap(drop =>
            expandActualDropPointAllocations(drop, selectedActualCargoItems)
        );
    })();
    const selectedEffectiveActualDropPoints = (() => {
        if (!showAdvancedDropEditor) {
            return selectedActualDropPoints;
        }
        return selectedWorkingActualDropPoints;
    })();
    const selectedDerivedActualCargoItems = selectedActualCargoItems.map(item => {
        if (!showAdvancedDropEditor) {
            return item;
        }
        const itemRealizationAllocations = selectedActualDropPoints
            .map(point => pickActualDropItemValues(getActualDropAllocationForItem(point, item)))
            .filter(values => hasActualDropItemValues(values));
        const actualQtyKoli = itemRealizationAllocations.reduce(
            (sum, values) => sum + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
            0
        );
        const actualWeightKg = itemRealizationAllocations.reduce(
            (sum, values) => sum + convertWeightToKg(
                parseFormattedNumberish(values.weightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                }),
                values.weightInputUnit
            ),
            0
        );
        const actualVolumeM3 = itemRealizationAllocations.reduce(
            (sum, values) => sum + convertVolumeToM3(
                parseFormattedNumberish(values.volumeInputValue || 0, {
                    maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                }),
                values.volumeInputUnit
            ),
            0
        );
        return {
            ...item,
            actualQtyKoli: actualQtyKoli > 0 ? String(actualQtyKoli) : '',
            actualWeightInputValue: actualWeightKg > 0 ? String(convertKgToWeightInputValue(actualWeightKg, item.actualWeightInputUnit)) : '',
            actualVolumeInputValue: actualVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(actualVolumeM3, item.actualVolumeInputUnit)) : '',
        };
    });
    const getActualDropAllocationSummaryRows = (drop: ActualDropDraft) =>
        selectedActualCargoItems
            .map(cargoItem => {
                const allocation = getActualDropAllocationForItem(drop, cargoItem);
                const allocatedSummary = {
                    qtyKoli: parseFormattedNumberish(allocation.qtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: convertWeightToKg(
                        parseFormattedNumberish(allocation.weightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(allocation.weightInputUnit),
                        }),
                        allocation.weightInputUnit
                    ),
                    volumeM3: convertVolumeToM3(
                        parseFormattedNumberish(allocation.volumeInputValue || 0, {
                            maxFractionDigits: allocation.volumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        allocation.volumeInputUnit
                    ),
                };
                const totalSummary = {
                    qtyKoli: parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                    weightKg: convertWeightToKg(
                        parseFormattedNumberish(cargoItem.actualWeightInputValue || 0, {
                            maxFractionDigits: getWeightInputFractionDigits(cargoItem.actualWeightInputUnit),
                        }),
                        cargoItem.actualWeightInputUnit
                    ),
                    volumeM3: convertVolumeToM3(
                        parseFormattedNumberish(cargoItem.actualVolumeInputValue || 0, {
                            maxFractionDigits: cargoItem.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                        }),
                        cargoItem.actualVolumeInputUnit
                    ),
                };
                return {
                    key: cargoItem.deliveryOrderItemRef,
                    label: cargoItem.description || 'Barang',
                    allocatedSummary,
                    totalSummary,
                    hasAllocation: allocatedSummary.qtyKoli > 0 || allocatedSummary.weightKg > 0 || allocatedSummary.volumeM3 > 0,
                };
            })
            .filter(row => row.hasAllocation);
    const selectedDetailState = buildDeliveryOrderDetailState({
        doData: deliveryOrder,
        actualCargoItems: selectedDerivedActualCargoItems,
        actualDropPoints: selectedEffectiveActualDropPoints,
        showAdvancedDropEditor,
    });
    const selectedActualCargoTotals = selectedDetailState.actualCargoTotals;
    const selectedActualDropTotals = selectedEffectiveActualDropPoints.reduce((sum, point) => ({
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(point.qtyKoli || 0, { maxFractionDigits: 2 }),
        weightKg: sum.weightKg + convertWeightToKg(
            parseFormattedNumberish(point.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(point.weightInputUnit),
            }),
            point.weightInputUnit
        ),
        volumeM3: sum.volumeM3 + convertVolumeToM3(
            parseFormattedNumberish(point.volumeInputValue || 0, {
                maxFractionDigits: point.volumeInputUnit === 'LITER' ? 0 : 3,
            }),
            point.volumeInputUnit
        ),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
    const selectedActualDropMismatchMessage =
        selectedActualCargoTotals.qtyKoli > 0 && Math.abs(selectedActualDropTotals.qtyKoli - selectedActualCargoTotals.qtyKoli) > 0.01
            ? 'Total qty titik realisasi harus sama dengan qty aktual muatan.'
            : selectedActualCargoTotals.weightKg > 0 && Math.abs(selectedActualDropTotals.weightKg - selectedActualCargoTotals.weightKg) > 0.01
                ? 'Total berat titik realisasi harus sama dengan berat aktual muatan.'
                : selectedActualCargoTotals.volumeM3 > 0 && Math.abs(selectedActualDropTotals.volumeM3 - selectedActualCargoTotals.volumeM3) > 0.001
                    ? 'Total volume titik realisasi harus sama dengan volume aktual muatan.'
                    : null;
    const selectedBillableDropCount = selectedEffectiveActualDropPoints.filter(point => isDeliveryOrderBillableDropType(point.stopType)).length;
    const selectedHoldDropCount = selectedEffectiveActualDropPoints.filter(point => isDeliveryOrderHoldDropType(point.stopType)).length;
    const selectedDropModeLabel = showAdvancedDropEditor ? `${selectedActualDropPoints.length} titik aktual` : 'Trip normal / 1 tujuan';
    const selectedDropOutcomeSummary = [
        selectedBillableDropCount > 0 ? `${selectedBillableDropCount} drop invoice` : null,
        selectedHoldDropCount > 0 ? `${selectedHoldDropCount} hold` : null,
    ].filter(Boolean).join(' • ') || 'Semua muatan mengikuti tujuan default';

    const activeFinalizationCargoItem =
        selectedDerivedActualCargoItems.find(item => item.deliveryOrderItemRef === activeFinalizationCargoItemRef)
        || selectedDerivedActualCargoItems[0]
        || null;
    const activeFinalizationDrop = activeFinalizationDropKey
        ? selectedActualDropPoints.find(drop => drop.draftKey === activeFinalizationDropKey) || null
        : null;
    const activeFinalizationDropAllocation =
        activeFinalizationDrop && activeFinalizationCargoItem
            ? getActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem)
            : null;
    const selectedActualCargoReady = selectedDerivedActualCargoItems.length > 0 && selectedDerivedActualCargoItems.every(item => {
        const qty = parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 });
        const weight = parseFormattedNumberish(item.actualWeightInputValue || 0, {
            maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
        });
        const volume = parseFormattedNumberish(item.actualVolumeInputValue || 0, {
            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
        });
        return (
            (!item.requireQty || qty > 0) &&
            (!item.requireWeight || weight > 0) &&
            (!item.requireVolume || volume > 0) &&
            ((item.requireQty && qty > 0) || weight > 0 || volume > 0)
        );
    });
    const selectedActualDropReady =
        !selectedActualDropMismatchMessage &&
        !selectedDetailState.actualDropAmbiguityMessage &&
        selectedEffectiveActualDropPoints.length > 0 &&
        selectedEffectiveActualDropPoints.every(item => {
            const qty = parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 });
            const weight = parseFormattedNumberish(item.weightInputValue || 0, {
                maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
            });
            const volume = parseFormattedNumberish(item.volumeInputValue || 0, {
                maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
            });
            return Boolean(item.locationName.trim() || item.locationAddress.trim()) && (qty > 0 || weight > 0 || volume > 0);
        });
    const selectedActualDropSetupReady =
        selectedActualDropPoints.length > 0 &&
        selectedActualDropPoints.every(item => Boolean(item.locationName.trim() || item.locationAddress.trim())) &&
        !selectedDetailState.actualDropAmbiguityMessage;

    const suratJalanDisplayNumber = `${suratJalanDocument.suratJalanNumber}${(effectiveSuratJalanStatus === 'PARTIAL_HOLD' || hasSuratJalanHoldCargo) ? ' (HOLD)' : ''}`;

    const buildPartialHoldContinuationDrafts = (
        sourceDOData: DeliveryOrder | null,
        sourceDoItems: DeliveryOrderItem[],
        baseCargoItems: ActualCargoDraft[]
    ) => {
        const actualDropPointSource = sourceDOData?.actualDropPoints || [];
        if (!hasSuratJalanHoldCargo || !sourceDOData?._id || actualDropPointSource.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const itemsById = new Map(sourceDoItems.map(item => [item._id, item]));
        const selectedItemIds = new Set(sourceDoItems.map(item => item._id));
        const getPointItemIds = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => {
            const explicitItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].filter((value): value is string => Boolean(value));
            if (explicitItemRefs.length > 0) {
                return explicitItemRefs.filter(itemId => selectedItemIds.has(itemId));
            }

            const pointReferenceKey = (point.shipperReferenceKey || '').trim();
            const pointReferenceNumber = (point.shipperReferenceNumber || '').trim().toUpperCase();
            const matchingItems = sourceDoItems.filter(item => (
                (pointReferenceKey && (item.shipperReferenceKey || '').trim() === pointReferenceKey) ||
                (pointReferenceNumber && (item.shipperReferenceNumber || '').trim().toUpperCase() === pointReferenceNumber)
            ));
            return matchingItems.length === 1 ? [matchingItems[0]._id] : [];
        };

        const continuableHoldPoints = actualDropPointSource.filter(point => (
            (point.stopType === 'HOLD' || point.stopType === 'TRANSIT') &&
            getPointItemIds(point).length > 0
        ));
        if (continuableHoldPoints.length === 0) {
            return {
                actualCargoItems: baseCargoItems,
                sourceDropPoints: undefined as DeliveryOrder['actualDropPoints'] | undefined,
                itemRefs: [] as string[],
            };
        }

        const holdDraftByItemId = new Map<string, ActualDropItemValueDraft>();
        continuableHoldPoints.forEach(point => {
            const pointItemIds = getPointItemIds(point);
            pointItemIds.forEach(itemId => {
                const sourceItem = itemsById.get(itemId);
                if (!sourceItem) {
                    return;
                }
                const current = holdDraftByItemId.get(itemId);
                const weightInputUnit = point.weightInputUnit || sourceItem.actualWeightInputUnit || sourceItem.orderItemWeightInputUnit || 'KG';
                const volumeInputUnit = point.volumeInputUnit || sourceItem.actualVolumeInputUnit || sourceItem.orderItemVolumeInputUnit || 'M3';
                const currentWeightKg = current
                    ? convertWeightToKg(parseFormattedNumberish(current.weightInputValue || 0), current.weightInputUnit)
                    : 0;
                const currentVolumeM3 = current
                    ? convertVolumeToM3(parseFormattedNumberish(current.volumeInputValue || 0), current.volumeInputUnit)
                    : 0;
                const nextWeightKg = currentWeightKg + convertWeightToKg(point.weightInputValue ?? point.weightKg ?? 0, weightInputUnit);
                const nextVolumeM3 = currentVolumeM3 + convertVolumeToM3(point.volumeInputValue ?? point.volumeM3 ?? 0, volumeInputUnit);
                holdDraftByItemId.set(itemId, {
                    qtyKoli: String(parseFormattedNumberish(current?.qtyKoli || 0) + parseFormattedNumberish(point.qtyKoli || 0)),
                    weightInputValue: nextWeightKg > 0 ? String(convertKgToWeightInputValue(nextWeightKg, weightInputUnit)) : '',
                    weightInputUnit,
                    volumeInputValue: nextVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(nextVolumeM3, volumeInputUnit)) : '',
                    volumeInputUnit,
                });
            });
        });

        const continuationCargoItems = baseCargoItems.map(item => {
            const holdDraft = holdDraftByItemId.get(item.deliveryOrderItemRef);
            return holdDraft
                ? {
                    ...item,
                    actualQtyKoli: holdDraft.qtyKoli,
                    actualWeightInputValue: holdDraft.weightInputValue,
                    actualWeightInputUnit: holdDraft.weightInputUnit,
                    actualVolumeInputValue: holdDraft.volumeInputValue,
                    actualVolumeInputUnit: holdDraft.volumeInputUnit,
                }
                : item;
        });
        return {
            actualCargoItems: continuationCargoItems,
            sourceDropPoints: [] as DeliveryOrder['actualDropPoints'],
            itemRefs: Array.from(holdDraftByItemId.keys()),
        };
    };

    const updateActualCargoDraft = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        setActualCargoItems(previous =>
            previous.map(item => {
                if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                    return item;
                }
                if (field === 'actualQtyKoli') {
                    return applyActualCargoAutoWeightFromQty(item, value);
                }
                if (field === 'actualVolumeInputValue' && shouldLockActualCargoVolume(item)) {
                    return item;
                }
                return { ...item, [field]: value };
            })
        );
    };

    const updateActualCargoWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        setActualCargoItems(previous => previous.map(item =>
            item.deliveryOrderItemRef === deliveryOrderItemRef
                ? {
                    ...item,
                    actualWeightInputUnit: nextUnit,
                    actualWeightInputValue: (() => {
                        const currentWeightKg = getActualCargoItemWeightKg(item);
                        return currentWeightKg > 0 ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit)) : '';
                    })(),
                }
                : item
        ));
    };

    const updateActualCargoVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        setActualCargoItems(previous => previous.map(item =>
            item.deliveryOrderItemRef === deliveryOrderItemRef
                ? {
                    ...item,
                    actualVolumeInputUnit: nextUnit,
                    actualVolumeInputValue: (() => {
                        const currentVolumeM3 = getActualCargoItemVolumeM3(item);
                        return currentVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(currentVolumeM3, nextUnit)) : '';
                    })(),
                }
                : item
        ));
    };

    const updateActualEditItem = (
        deliveryOrderItemRef: string,
        field: keyof Pick<ActualCargoDraft, 'actualQtyKoli' | 'actualWeightInputValue' | 'actualWeightInputUnit' | 'actualVolumeInputValue' | 'actualVolumeInputUnit'>,
        value: string
    ) => {
        setActualEditItems(previous => previous.map(item => {
            if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                return item;
            }
            if (field === 'actualQtyKoli') {
                return applyActualCargoAutoWeightFromQty(item, value);
            }
            if (field === 'actualVolumeInputValue' && shouldLockActualCargoVolume(item)) {
                return item;
            }
            return { ...item, [field]: value };
        }));
    };

    const updateActualEditWeightUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualWeightInputUnit']) => {
        setActualEditItems(previous => previous.map(item => {
            if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                return item;
            }
            const currentWeightKg = convertWeightToKg(
                parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                }),
                item.actualWeightInputUnit
            );
            return {
                ...item,
                actualWeightInputUnit: nextUnit,
                actualWeightInputValue: currentWeightKg > 0 ? String(convertKgToWeightInputValue(currentWeightKg, nextUnit)) : '',
            };
        }));
    };

    const updateActualEditVolumeUnit = (deliveryOrderItemRef: string, nextUnit: ActualCargoDraft['actualVolumeInputUnit']) => {
        setActualEditItems(previous => previous.map(item => {
            if (item.deliveryOrderItemRef !== deliveryOrderItemRef) {
                return item;
            }
            const currentVolumeM3 = convertVolumeToM3(
                parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                item.actualVolumeInputUnit
            );
            return {
                ...item,
                actualVolumeInputUnit: nextUnit,
                actualVolumeInputValue: currentVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(currentVolumeM3, nextUnit)) : '',
            };
        }));
    };

    const saveActualEdit = async () => {
        if (!deliveryOrder || !suratJalanDocument || !canManageDeliveryStatus || deliveryOrder.tripClosedByAdminAt) return;
        const invalidItemIndex = actualEditItems.findIndex(item => {
            const qty = parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 });
            const weight = convertWeightToKg(
                parseFormattedNumberish(item.actualWeightInputValue || 0, {
                    maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                }),
                item.actualWeightInputUnit
            );
            const volume = convertVolumeToM3(
                parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                    maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                }),
                item.actualVolumeInputUnit
            );
            return qty <= 0 && weight <= 0 && volume <= 0;
        });
        if (invalidItemIndex >= 0) {
            addToast('error', `Aktual item baris ${invalidItemIndex + 1} perlu isi qty, berat, atau volume.`);
            return;
        }

        setSavingActualEdit(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'update-surat-jalan-actual-cargo',
                    data: {
                        id: deliveryOrder._id,
                        suratJalanRef: suratJalanDocument._id,
                        actualItems: actualEditItems.map(item => ({
                            deliveryOrderItemRef: item.deliveryOrderItemRef,
                            actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 }),
                            actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue || 0, {
                                maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                            }),
                            actualWeightInputUnit: item.actualWeightInputUnit,
                            actualVolumeInputValue: parseFormattedNumberish(item.actualVolumeInputValue || 0, {
                                maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                            }),
                            actualVolumeInputUnit: item.actualVolumeInputUnit,
                        })),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan aktual item SJ');
                return;
            }
            setShowActualEditModal(false);
            setSelectedActualEditItemRef('');
            await loadDocument();
            addToast('success', 'Aktual item SJ berhasil diperbarui');
        } catch {
            addToast('error', 'Gagal menyimpan aktual item SJ');
        } finally {
            setSavingActualEdit(false);
        }
    };

    const getRemainingActualDropValuesForCargoItem = (
        cargoItem: ActualCargoDraft,
        excludeDraftKey = ''
    ) => {
        const usedAllocationByKey = new Map<string, ActualDropItemValueDraft>();
        actualDropPoints.forEach(drop => {
            if (drop.draftKey === excludeDraftKey || drop.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef) {
                return;
            }
            const values = pickActualDropItemValues(drop);
            if (hasActualDropItemValues(values)) {
                usedAllocationByKey.set(buildActualDropItemValueKey(drop.draftKey, drop.deliveryOrderItemRef), values);
            }
        });
        Object.entries(actualDropItemValueMap).forEach(([valueKey, cachedValues]) => {
            const parsedKey = parseActualDropItemValueKey(valueKey);
            if (
                !parsedKey ||
                parsedKey.draftKey === excludeDraftKey ||
                parsedKey.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef
            ) {
                return;
            }
            if (hasActualDropItemValues(cachedValues)) {
                usedAllocationByKey.set(valueKey, cachedValues);
            } else {
                usedAllocationByKey.delete(valueKey);
            }
        });
        const used = Array.from(usedAllocationByKey.values())
            .reduce((sum, values) => ({
                qtyKoli: sum.qtyKoli + parseFormattedNumberish(values.qtyKoli || 0, { maxFractionDigits: 2 }),
                weightKg: sum.weightKg + convertWeightToKg(
                    parseFormattedNumberish(values.weightInputValue || 0, {
                        maxFractionDigits: getWeightInputFractionDigits(values.weightInputUnit),
                    }),
                    values.weightInputUnit
                ),
                volumeM3: sum.volumeM3 + convertVolumeToM3(
                    parseFormattedNumberish(values.volumeInputValue || 0, {
                        maxFractionDigits: values.volumeInputUnit === 'LITER' ? 0 : 3,
                    }),
                    values.volumeInputUnit
                ),
            }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
        const remainingQtyKoli = Math.max(parseFormattedNumberish(cargoItem.actualQtyKoli || 0, { maxFractionDigits: 2 }) - used.qtyKoli, 0);
        const remainingWeightKg = Math.max(getActualCargoItemWeightKg(cargoItem) - used.weightKg, 0);
        const remainingVolumeM3 = Math.max(getActualCargoItemVolumeM3(cargoItem) - used.volumeM3, 0);
        return {
            qtyKoli: remainingQtyKoli > 0 ? String(remainingQtyKoli) : '',
            weightInputValue: remainingWeightKg > 0 ? String(convertKgToWeightInputValue(remainingWeightKg, cargoItem.actualWeightInputUnit)) : '',
            weightInputUnit: cargoItem.actualWeightInputUnit,
            volumeInputValue: remainingVolumeM3 > 0 ? String(convertM3ToVolumeInputValue(remainingVolumeM3, cargoItem.actualVolumeInputUnit)) : '',
            volumeInputUnit: cargoItem.actualVolumeInputUnit,
        };
    };

    const updateActualDropDraft = (
        draftKey: string,
        field: keyof Pick<ActualDropDraft, 'stopType' | 'locationName' | 'locationAddress' | 'qtyKoli' | 'weightInputValue' | 'weightInputUnit' | 'volumeInputValue' | 'volumeInputUnit' | 'note'>,
        value: string
    ) => {
        const buildNextDrop = (drop: ActualDropDraft) => {
            const selectedCargoItem = drop.deliveryOrderItemRef
                ? actualCargoItems.find(item => item.deliveryOrderItemRef === drop.deliveryOrderItemRef)
                : undefined;
            if (field === 'qtyKoli') {
                return applyActualDropAutoWeightFromQty(drop, selectedCargoItem, value);
            }
            if ((field === 'weightInputValue' || field === 'weightInputUnit') && shouldLockActualDropWeight(selectedCargoItem)) {
                const nextUnit = field === 'weightInputUnit'
                    ? value as ActualDropDraft['weightInputUnit']
                    : drop.weightInputUnit;
                return applyActualDropAutoWeightFromQty(drop, selectedCargoItem, drop.qtyKoli, nextUnit);
            }
            if (field === 'volumeInputValue' && shouldLockActualDropVolume(selectedCargoItem)) {
                return drop;
            }
            return { ...drop, [field]: value };
        };
        if (field === 'qtyKoli' || field === 'weightInputValue' || field === 'weightInputUnit' || field === 'volumeInputValue' || field === 'volumeInputUnit') {
            const currentDrop = actualDropPoints.find(item => item.draftKey === draftKey);
            if (currentDrop?.deliveryOrderItemRef) {
                const nextDrop = buildNextDrop(currentDrop);
                const valueKey = buildActualDropItemValueKey(draftKey, currentDrop.deliveryOrderItemRef);
                setActualDropItemValueMap(previous => ({
                    ...previous,
                    [valueKey]: pickActualDropItemValues(nextDrop),
                }));
            }
        }
        setActualDropPoints(previous => previous.map(item => item.draftKey === draftKey ? buildNextDrop(item) : item));
    };

    function hasOtherSavedActualDropAllocationForItem(deliveryOrderItemRef: string, excludeDraftKey = '') {
        return Object.entries(actualDropItemValueMap).some(([valueKey, cachedValues]) => {
            const parsedKey = parseActualDropItemValueKey(valueKey);
            return Boolean(
                parsedKey &&
                parsedKey.draftKey !== excludeDraftKey &&
                parsedKey.deliveryOrderItemRef === deliveryOrderItemRef &&
                hasActualDropItemValues(cachedValues)
            );
        });
    }

    const getActualDropDraftIndex = (draftKey: string) =>
        actualDropPoints.findIndex(drop => drop.draftKey === draftKey);

    const isActualDropAfter = (candidateDraftKey: string, sourceDraftKey: string) => {
        const candidateIndex = getActualDropDraftIndex(candidateDraftKey);
        const sourceIndex = getActualDropDraftIndex(sourceDraftKey);
        return candidateIndex >= 0 && sourceIndex >= 0 && candidateIndex > sourceIndex;
    };

    const clearLaterActualDropAllocationsForItem = (draftKey: string, deliveryOrderItemRef: string) => {
        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            Object.keys(next).forEach(valueKey => {
                const parsedKey = parseActualDropItemValueKey(valueKey);
                if (
                    parsedKey &&
                    parsedKey.deliveryOrderItemRef === deliveryOrderItemRef &&
                    isActualDropAfter(parsedKey.draftKey, draftKey)
                ) {
                    delete next[valueKey];
                }
            });
            return next;
        });
    };

    function getActualDropAllocationForItem(drop: ActualDropDraft, cargoItem: ActualCargoDraft): ActualDropDraft {
        const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        const cachedValues = actualDropItemValueMap[valueKey];
        const baseDrop = {
            ...drop,
            deliveryOrderItemRef: cargoItem.deliveryOrderItemRef,
            shipperReferenceKey: cargoItem.shipperReferenceKey || drop.shipperReferenceKey,
            shipperReferenceNumber: cargoItem.shipperReferenceNumber || drop.shipperReferenceNumber,
        };
        const dropReferenceKey = drop.shipperReferenceKey.trim();
        const dropReferenceNumber = drop.shipperReferenceNumber.trim().toUpperCase();
        const cargoReferenceKey = cargoItem.shipperReferenceKey.trim();
        const cargoReferenceNumber = cargoItem.shipperReferenceNumber.trim().toUpperCase();
        const hasDropReferenceTarget = Boolean(dropReferenceKey || dropReferenceNumber);
        const dropReferenceMatchesCargo =
            !hasDropReferenceTarget ||
            (dropReferenceKey && cargoReferenceKey === dropReferenceKey) ||
            (dropReferenceNumber && cargoReferenceNumber === dropReferenceNumber);
        if (!drop.deliveryOrderItemRef && !dropReferenceMatchesCargo) {
            return {
                ...baseDrop,
                qtyKoli: '',
                weightInputValue: '',
                volumeInputValue: '',
            };
        }
        if (cachedValues && hasActualDropItemValues(cachedValues)) {
            return { ...baseDrop, ...cachedValues };
        }
        if (
            drop.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef &&
            !hasOtherSavedActualDropAllocationForItem(cargoItem.deliveryOrderItemRef, drop.draftKey)
        ) {
            return baseDrop;
        }
        if (drop.deliveryOrderItemRef && drop.deliveryOrderItemRef !== cargoItem.deliveryOrderItemRef) {
            return {
                ...baseDrop,
                qtyKoli: '',
                weightInputValue: '',
                volumeInputValue: '',
            };
        }
        const remainingValues = getRemainingActualDropValuesForCargoItem(cargoItem, drop.draftKey);
        return {
            ...baseDrop,
            ...remainingValues,
        };
    }

    const updateActualDropAllocationForItem = (
        drop: ActualDropDraft,
        cargoItem: ActualCargoDraft,
        field: keyof ActualDropItemValueDraft,
        value: string
    ) => {
        const currentAllocation = getActualDropAllocationForItem(drop, cargoItem);
        const nextAllocation =
            field === 'qtyKoli'
                ? applyActualDropAutoWeightFromQty(currentAllocation, cargoItem, value)
                : (field === 'weightInputValue' || field === 'weightInputUnit') && shouldLockActualDropWeight(cargoItem)
                    ? applyActualDropAutoWeightFromQty(
                        currentAllocation,
                        cargoItem,
                        currentAllocation.qtyKoli,
                        field === 'weightInputUnit' ? value as ActualDropDraft['weightInputUnit'] : currentAllocation.weightInputUnit
                    )
                    : field === 'volumeInputValue' && shouldLockActualDropVolume(cargoItem)
                        ? currentAllocation
                    : { ...currentAllocation, [field]: value };
        const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
        setActualDropItemValueMap(previous => ({
            ...previous,
            [valueKey]: pickActualDropItemValues(nextAllocation),
        }));
        clearLaterActualDropAllocationsForItem(drop.draftKey, cargoItem.deliveryOrderItemRef);
        setActualDropPoints(previous => previous.map(item =>
            item.draftKey === drop.draftKey && item.deliveryOrderItemRef === cargoItem.deliveryOrderItemRef
                ? { ...item, ...pickActualDropItemValues(nextAllocation) }
                : item
        ));
    };

    const persistActualDropAllocationsForItems = (
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => {
        const nextAllocationEntries = cargoItems
            .map(cargoItem => ({
                itemRef: cargoItem.deliveryOrderItemRef,
                values: pickActualDropItemValues(getActualDropAllocationForItem(drop, cargoItem)),
            }))
            .filter(entry => hasActualDropItemValues(entry.values));
        const nextAllocationByItemRef = new Map(
            nextAllocationEntries.map(entry => [entry.itemRef, entry.values])
        );
        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            cargoItems.forEach(cargoItem => {
                const valueKey = buildActualDropItemValueKey(drop.draftKey, cargoItem.deliveryOrderItemRef);
                const allocationValues = nextAllocationByItemRef.get(cargoItem.deliveryOrderItemRef);
                if (allocationValues) {
                    next[valueKey] = allocationValues;
                } else {
                    delete next[valueKey];
                }
            });
            return next;
        });
        setActualDropPoints(previous => previous.map(item => {
            if (item.draftKey !== drop.draftKey) {
                return item;
            }
            const visibleItemRef =
                item.deliveryOrderItemRef && nextAllocationByItemRef.has(item.deliveryOrderItemRef)
                    ? item.deliveryOrderItemRef
                    : Array.from(nextAllocationByItemRef.keys())[0] || item.deliveryOrderItemRef;
            const visibleAllocation = visibleItemRef ? nextAllocationByItemRef.get(visibleItemRef) : undefined;
            return visibleAllocation
                ? { ...item, deliveryOrderItemRef: visibleItemRef, ...visibleAllocation }
                : item;
        }));
    };

    const getDefaultFinalizationCargoItemRef = (
        drop: ActualDropDraft,
        cargoItems: ActualCargoDraft[]
    ) => (
        cargoItems.find(cargoItem =>
            hasActualDropItemValues(pickActualDropItemValues(getActualDropAllocationForItem(drop, cargoItem)))
        ) || cargoItems[0]
    )?.deliveryOrderItemRef || '';

    const expandActualDropDraftsBySelectedItems = (dropDrafts: ActualDropDraft[]) =>
        dropDrafts.map(drop => {
            if (drop.deliveryOrderItemRef) {
                return drop;
            }
            const firstItem = getActualDropItemOptions(drop)[0];
            return firstItem
                ? {
                    ...drop,
                    deliveryOrderItemRef: firstItem.deliveryOrderItemRef,
                    shipperReferenceKey: firstItem.shipperReferenceKey || drop.shipperReferenceKey,
                    shipperReferenceNumber: firstItem.shipperReferenceNumber || drop.shipperReferenceNumber,
                    ...getRemainingActualDropValuesForCargoItem(firstItem),
                }
                : drop;
        });

    const toggleAdvancedDropEditor = () => {
        if (showAdvancedDropEditor) {
            setShowAdvancedDropEditor(false);
            return;
        }
        setActualDropPoints(current => expandActualDropDraftsBySelectedItems(current));
        setShowAdvancedDropEditor(true);
    };

    const addActualDropDraft = () => {
        const firstCargoItem =
            selectedActualCargoItems.find(cargoItem =>
                hasActualDropItemValues(getRemainingActualDropValuesForCargoItem(cargoItem))
            ) || selectedActualCargoItems[0];
        const emptyDraft = createEmptyActualDropDraft();
        setActualDropPoints(previous => [
            ...previous,
            firstCargoItem
                ? {
                    ...emptyDraft,
                    deliveryOrderItemRef: firstCargoItem.deliveryOrderItemRef,
                    shipperReferenceKey: firstCargoItem.shipperReferenceKey || actualDropShipperReference.referenceKey,
                    shipperReferenceNumber: firstCargoItem.shipperReferenceNumber || actualDropShipperReference.referenceNumber,
                    locationName: actualDropShipperReference.receiverCompany || actualDropShipperReference.receiverName || 'Tujuan Dokumen',
                    locationAddress: actualDropShipperReference.receiverAddress,
                    ...getRemainingActualDropValuesForCargoItem(firstCargoItem),
                }
                : {
                    ...emptyDraft,
                    shipperReferenceKey: actualDropShipperReference.referenceKey,
                    shipperReferenceNumber: actualDropShipperReference.referenceNumber,
                    locationName: actualDropShipperReference.receiverCompany || actualDropShipperReference.receiverName || 'Tujuan Dokumen',
                    locationAddress: actualDropShipperReference.receiverAddress,
                },
        ]);
    };

    const removeActualDropDraft = (draftKey: string) => {
        setActualDropPoints(previous => previous.filter(item => item.draftKey !== draftKey));
        setActualDropItemValueMap(previous => {
            const next = { ...previous };
            Object.keys(next)
                .filter(key => key.startsWith(`${draftKey}${ACTUAL_DROP_ITEM_VALUE_KEY_SEPARATOR}`))
                .forEach(key => {
                    delete next[key];
                });
            return next;
        });
    };

    const openStatusModal = (requestedStatus?: string, continuationHold: boolean = false) => {
        setNewStatus(requestedStatus || '');
        setStatusNote('');
        setPodName(deliveryOrder.podReceiverName?.trim() || suratJalanDocument.receiverName || suratJalanDocument.receiverCompany || '');
        setPodDate(deliveryOrder.podReceivedDate?.trim()?.slice(0, 10) || getBusinessDateValue());
        setPodNote(deliveryOrder.podNote || '');
        const baseActualCargoItems = buildActualCargoDrafts(selectedDeliveryOrderItems);
        const shouldPrepareHoldContinuation =
            continuationHold ||
            requestedStatus === 'DELIVERED' ||
            (!requestedStatus && availableStatuses.includes('DELIVERED'));
        const continuationDrafts = shouldPrepareHoldContinuation
            ? buildPartialHoldContinuationDrafts(deliveryOrder, selectedDeliveryOrderItems, baseActualCargoItems)
            : {
                actualCargoItems: baseActualCargoItems,
                sourceDropPoints: (deliveryOrder.actualDropPoints || []).filter(point =>
                    matchesSelectedSuratJalan(point.shipperReferenceKey, point.shipperReferenceNumber)
                ) as DeliveryOrder['actualDropPoints'],
                itemRefs: [] as string[],
            };
        const nextActualCargoItems = continuationDrafts.actualCargoItems;
        const isPartialHoldContinuation = shouldPrepareHoldContinuation && continuationDrafts.itemRefs.length > 0;
        const nextActualDropPoints = isPartialHoldContinuation
            ? []
            : buildDefaultActualDropDrafts(deliveryOrder, nextActualCargoItems, continuationDrafts.sourceDropPoints || []);
        const nextShowAdvancedDropEditor = isPartialHoldContinuation || shouldOpenAdvancedDropEditor(deliveryOrder, nextActualDropPoints);
        setActualCargoItems(nextActualCargoItems);
        setActualDropPoints(nextShowAdvancedDropEditor ? expandActualDropDraftsBySelectedItems(nextActualDropPoints) : nextActualDropPoints);
        setActualDropItemValueMap({});
        setContinuingHeldCargo(isPartialHoldContinuation);
        setShowAdvancedDropEditor(nextShowAdvancedDropEditor);
        setShowActualCargoFinalizationModal(false);
        setActiveFinalizationCargoItemRef('');
        setActiveFinalizationDropKey('');
        setShowStatusModal(true);
    };

    const updateStatus = async () => {
        if (!newStatus) return;
        setUpdatingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'delivery-orders',
                    action: 'set-surat-jalan-status-batch',
                    data: {
                        id: deliveryOrder._id,
                        status: newStatus,
                        note: statusNote,
                        targetSuratJalanRefs: [suratJalanDocument._id],
                        ...(newStatus === 'DELIVERED'
                            ? {
                                podReceiverName: podName,
                                podReceivedDate: podDate,
                                podNote,
                                actualItems: selectedDerivedActualCargoItems.map(item => ({
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    actualQtyKoli: parseFormattedNumberish(item.actualQtyKoli),
                                    actualWeightInputValue: parseFormattedNumberish(item.actualWeightInputValue, {
                                        maxFractionDigits: getWeightInputFractionDigits(item.actualWeightInputUnit),
                                    }),
                                    actualWeightInputUnit: item.actualWeightInputUnit,
                                    actualVolumeInputValue: item.actualVolumeInputValue.trim()
                                        ? parseFormattedNumberish(item.actualVolumeInputValue, {
                                            maxFractionDigits: item.actualVolumeInputUnit === 'LITER' ? 0 : 3,
                                        })
                                        : 0,
                                    actualVolumeInputUnit: item.actualVolumeInputUnit,
                                })),
                                actualDropPoints: (showAdvancedDropEditor ? selectedEffectiveActualDropPoints : [selectedDetailState.autoActualDropDraft]).map(item => ({
                                    stopType: item.stopType,
                                    deliveryOrderItemRef: item.deliveryOrderItemRef,
                                    shipperReferenceKey: item.shipperReferenceKey,
                                    shipperReferenceNumber: item.shipperReferenceNumber,
                                    originLocationName: item.originLocationName,
                                    originLocationAddress: item.originLocationAddress,
                                    locationName: item.locationName,
                                    locationAddress: item.locationAddress,
                                    qtyKoli: item.qtyKoli.trim() ? parseFormattedNumberish(item.qtyKoli) : 0,
                                    weightInputValue: item.weightInputValue.trim()
                                        ? parseFormattedNumberish(item.weightInputValue, {
                                            maxFractionDigits: getWeightInputFractionDigits(item.weightInputUnit),
                                        })
                                        : 0,
                                    weightInputUnit: item.weightInputUnit,
                                    volumeInputValue: item.volumeInputValue.trim()
                                        ? parseFormattedNumberish(item.volumeInputValue, {
                                            maxFractionDigits: item.volumeInputUnit === 'LITER' ? 0 : 3,
                                        })
                                        : 0,
                                    volumeInputUnit: item.volumeInputUnit,
                                    note: item.note,
                                })),
                            }
                            : {}),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal memperbarui status SJ');
                return;
            }
            setShowStatusModal(false);
            setShowActualCargoFinalizationModal(false);
            setContinuingHeldCargo(false);
            setActiveFinalizationCargoItemRef('');
            setActiveFinalizationDropKey('');
            await loadDocument();
            addToast('success', newStatus === 'DELIVERED' ? 'SJ berhasil difinalkan' : `Status SJ diperbarui ke ${DO_STATUS_MAP[newStatus]?.label || newStatus}`);
        } catch {
            addToast('error', 'Gagal memperbarui status SJ');
        } finally {
            setUpdatingStatus(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/surat-jalan" />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            {suratJalanDisplayNumber}
                            <span className={`badge badge-${tripStatusMeta.color}`}>
                                <span className="badge-dot" /> {tripStatusMeta.label}
                            </span>
                        </h1>
                    </div>
                </div>
                <div className="page-actions">
                    {canManageDeliveryStatus && availableStatuses.length > 0 && (
                        <button className="btn btn-secondary" onClick={() => openStatusModal()}>
                            <Truck size={16} /> Update SJ Ini
                        </button>
                    )}
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Dokumen Surat Jalan</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Surat Jalan</div><div className="detail-value font-mono"><Link href={`/surat-jalan/${encodeURIComponent(suratJalanDocument._id)}`}>{suratJalanDisplayNumber}</Link></div></div>
                            <div className="detail-item"><div className="detail-label">Trip</div><div className="detail-value">{canOpenTripPage ? <Link href={withReturnTo(`/trips/${deliveryOrder._id}`)}>{suratJalanDocument.tripNumber}</Link> : suratJalanDocument.tripNumber}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Tanggal Trip</div><div className="detail-value">{formatDate(suratJalanDocument.tripDate)}</div></div>
                            <div className="detail-item"><div className="detail-label">Customer</div><div className="detail-value">{canOpenCustomerPage && suratJalanDocument.customerRef ? <Link href={withReturnTo(`/customers/${suratJalanDocument.customerRef}`)}>{suratJalanDocument.customerName || '-'}</Link> : (suratJalanDocument.customerName || '-')}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Order / Resi</div><div className="detail-value">{canOpenOrderPage && suratJalanDocument.orderRef ? <Link href={withReturnTo(`/orders/${suratJalanDocument.orderRef}`)}>{suratJalanDocument.masterResi || '-'}</Link> : (suratJalanDocument.masterResi || '-')}</div></div>
                            <div className="detail-item"><div className="detail-label">Pickup</div><div className="detail-value">{suratJalanDocument.pickupAddress || '-'}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Kendaraan / Driver</div><div className="detail-value">{`${suratJalanDocument.vehiclePlate || '-'} / ${suratJalanDocument.driverName || '-'}`}</div></div>
                        </div>
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">Penerima / Tujuan</div><div className="detail-value">{suratJalanDocument.receiverCompany || suratJalanDocument.receiverName || suratJalanDocument.receiverAddress || '-'}</div></div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <span className="card-header-title">Ringkasan Muatan Dokumen</span>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: '0.75rem' }}>
                        <div className="detail-item"><div className="detail-label">Total</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.cargoSummary)}</div></div>
                        <div className="detail-item"><div className="detail-label">Hold</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.holdCargo)}</div></div>
                        <div className="detail-item"><div className="detail-label">Masuk Invoice</div><div className="detail-value">{formatCargoSummary(suratJalanDocument.billableCargo)}</div></div>
                        {linkedFreightNotas.length > 0 && (
                            <div className="detail-item">
                                <div className="detail-label">Invoice Terkait</div>
                                <div className="detail-value" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {linkedFreightNotas.map(nota => (
                                        canOpenInvoicePage ? (
                                            <Link key={nota._id} href={withReturnTo(`/invoices/${nota._id}`)} style={{ color: 'var(--color-primary)' }}>
                                                {nota.notaDisplayNumber || nota.notaNumber}
                                            </Link>
                                        ) : (
                                            <span key={nota._id}>{nota.notaDisplayNumber || nota.notaNumber}</span>
                                        )
                                    ))}
                                </div>
                            </div>
                        )}
                        {isDeliveredStatus && (
                            <>
                                <div className="detail-item"><div className="detail-label">Item Terkirim Aktual</div><div className="detail-value">{deliveredItemCount} item</div></div>
                                <div className="detail-item"><div className="detail-label">Muatan Terkirim Aktual</div><div className="detail-value">{formatCargoSummary(deliveredActualCargoSummary)}</div></div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 'var(--space-4)' }}>
                <CollapsibleCard title={`Item Dokumen (${documentItems.length})`}>
                    {documentItems.length === 0 ? (
                        <div className="empty-state">
                            <FileText size={40} className="empty-state-icon" />
                            <div className="empty-state-title">Belum ada item pada dokumen ini</div>
                        </div>
                    ) : (
                        <div className="table-wrapper">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Deskripsi</th>
                                        <th>Ringkasan Item</th>
                                        {isDeliveredStatus && <th>Muatan Aktual Terkirim</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {documentItems.map(item => (
                                        <tr key={item._id}>
                                            <td>
                                                {(() => {
                                                    const deliveryOrderItem = deliveryOrderItems.find(row => row._id === resolveDocumentItemDeliveryOrderItemRef(item));
                                                    const identity = getDeliveryOrderItemIdentity(deliveryOrderItem);
                                                    return (
                                                        <>
                                                            <div className="font-mono text-xs text-muted">{identity.code || '-'}</div>
                                                            <div className="font-medium">{identity.name || item.orderItemDescription || '-'}</div>
                                                        </>
                                                    );
                                                })()}
                                            </td>
                                            <td>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gap: '0.25rem',
                                                        padding: '0.55rem 0.65rem',
                                                        border: '1px solid var(--color-gray-100)',
                                                        borderRadius: '0.6rem',
                                                        background: 'var(--color-gray-50)',
                                                    }}
                                                >
                                                    <div className="text-sm"><span className="text-muted">Total: </span>{formatCargoSummary(item.plannedCargo)}</div>
                                                    <div className="text-sm"><span className="text-muted">Drop: </span>{summarizeDocumentItemActualDrops(item, isDeliveryOrderBillableDropType)}</div>
                                                    <div className="text-sm"><span className="text-muted">Hold: </span>{summarizeDocumentItemActualDrops(item, isDeliveryOrderHoldDropType)}</div>
                                                </div>
                                            </td>
                                            {isDeliveredStatus && <td>{formatCargoSummary(item.actualCargo)}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CollapsibleCard>
            </div>

            {sourceOrder && (
                <div className="card" style={{ marginTop: 'var(--space-4)' }}>
                    <div className="card-header">
                        <span className="card-header-title">Konteks Order</span>
                    </div>
                    <div className="card-body">
                        <div className="detail-row">
                            <div className="detail-item"><div className="detail-label">No. Trip Internal</div><div className="detail-value">{canOpenTripPage ? <Link href={withReturnTo(`/trips/${deliveryOrder._id}`)}>{formatInternalDeliveryOrderNumber(deliveryOrder)}</Link> : formatInternalDeliveryOrderNumber(deliveryOrder)}</div></div>
                            <div className="detail-item"><div className="detail-label">Status Order</div><div className="detail-value">{sourceOrder.status || '-'}</div></div>
                        </div>
                    </div>
                </div>
            )}

            {showActualEditModal && (
                <div className="modal-overlay" onClick={() => { if (!savingActualEdit) { setShowActualEditModal(false); setSelectedActualEditItemRef(''); } }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Aktual Item SJ</h3>
                            <button className="modal-close" onClick={() => { setShowActualEditModal(false); setSelectedActualEditItemRef(''); }} disabled={savingActualEdit}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {actualEditSelectableItems.length === 0 || !selectedActualEditItem ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Belum ada item terkirim aktual yang bisa diedit</div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: '0.75rem' }}>
                                    <div className="form-group">
                                        <label className="form-label">Item Terkirim Aktual</label>
                                        <select
                                            className="form-select"
                                            value={selectedActualEditItem.deliveryOrderItemRef}
                                            onChange={event => setSelectedActualEditItemRef(event.target.value)}
                                            disabled={savingActualEdit}
                                        >
                                            {actualEditSelectableItems.map((item, index) => (
                                                <option key={item.deliveryOrderItemRef} value={item.deliveryOrderItemRef}>
                                                    {getActualEditItemLabel(item, index)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    {(() => {
                                        const item = selectedActualEditItem;
                                        return (
                                            <div key={item.deliveryOrderItemRef} style={{ display: 'grid', gap: '0.75rem', padding: '0.85rem', background: 'var(--color-gray-50)', borderRadius: '0.75rem', border: '1px solid var(--color-gray-200)' }}>
                                        <div>
                                            {(() => {
                                                const deliveryOrderItem = deliveryOrderItems.find(row => row._id === item.deliveryOrderItemRef);
                                                const identity = getDeliveryOrderItemIdentity(deliveryOrderItem);
                                                return (
                                                    <>
                                                        {identity.code ? <div className="font-mono text-xs text-muted">{identity.code}</div> : null}
                                                        <div className="font-semibold">{identity.name || item.description || '-'}</div>
                                                    </>
                                                );
                                            })()}
                                            <div className="text-muted text-sm">Muatan aktual item yang dipilih</div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label className="form-label">Qty Aktual</label>
                                                <FormattedNumberInput
                                                    key={`${item.deliveryOrderItemRef}-qty`}
                                                    min={0}
                                                    maxFractionDigits={2}
                                                    value={parseFormattedNumberish(item.actualQtyKoli || 0, { maxFractionDigits: 2 })}
                                                    onValueChange={value => updateActualEditItem(item.deliveryOrderItemRef, 'actualQtyKoli', String(value))}
                                                    disabled={savingActualEdit}
                                                />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Berat Aktual</label>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                    <SplitDecimalNumberInput
                                                        key={`${item.deliveryOrderItemRef}-weight`}
                                                        min={0}
                                                        maxFractionDigits={getWeightInputFractionDigits(item.actualWeightInputUnit)}
                                                        value={item.actualWeightInputValue || 0}
                                                        onValueChange={value => updateActualEditItem(item.deliveryOrderItemRef, 'actualWeightInputValue', String(value))}
                                                        disabled={savingActualEdit || shouldLockActualCargoVolume(item)}
                                                    />
                                                    <select
                                                        className="form-select"
                                                        value={item.actualWeightInputUnit}
                                                        onChange={event => updateActualEditWeightUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualWeightInputUnit'])}
                                                        disabled={savingActualEdit}
                                                    >
                                                        {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Volume Aktual</label>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                    <SplitDecimalNumberInput
                                                        key={`${item.deliveryOrderItemRef}-volume`}
                                                        min={0}
                                                        maxFractionDigits={item.actualVolumeInputUnit === 'LITER' ? 0 : 3}
                                                        value={item.actualVolumeInputValue || 0}
                                                        onValueChange={value => updateActualEditItem(item.deliveryOrderItemRef, 'actualVolumeInputValue', String(value))}
                                                        disabled={savingActualEdit}
                                                    />
                                                    <select
                                                        className="form-select"
                                                        value={item.actualVolumeInputUnit}
                                                        onChange={event => updateActualEditVolumeUnit(item.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualVolumeInputUnit'])}
                                                        disabled={savingActualEdit}
                                                    >
                                                        {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                        );
                                    })()}
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowActualEditModal(false); setSelectedActualEditItemRef(''); }} disabled={savingActualEdit}>Batal</button>
                            <button className="btn btn-primary" onClick={() => void saveActualEdit()} disabled={savingActualEdit || actualEditItems.length === 0 || !selectedActualEditItem}>
                                <Save size={16} /> {savingActualEdit ? 'Menyimpan...' : 'Simpan Aktual'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showEditModal && (
                <div className="modal-overlay" onClick={() => { if (!savingEdit) setShowEditModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Edit Surat Jalan</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)} disabled={savingEdit}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">No. Surat Jalan <span className="required">*</span></label>
                                <input
                                    className="form-input"
                                    value={editForm.referenceNumber}
                                    onChange={event => updateEditForm({ referenceNumber: event.target.value.toUpperCase() })}
                                    disabled={savingEdit}
                                />
                            </div>
                            {(deliveryOrder.pickupStops?.length || 0) > 1 && (
                                <div className="form-group">
                                    <label className="form-label">Titik Pickup</label>
                                    <select
                                        className="form-select"
                                        value={editForm.pickupStopKey}
                                        onChange={event => updateEditForm({ pickupStopKey: event.target.value })}
                                        disabled={savingEdit}
                                    >
                                        <option value="">Pilih pickup</option>
                                        {(deliveryOrder.pickupStops || []).map((stop, index) => (
                                            <option key={stop._key || `pickup-${index + 1}`} value={stop._key || ''}>
                                                {`Pickup ${stop.sequence || index + 1}${stop.pickupLabel ? ` - ${stop.pickupLabel}` : ''}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <div>
                                        <div className="form-label" style={{ marginBottom: 0 }}>Item Surat Jalan</div>
                                        <div className="text-muted text-sm">Barang tersimpan tampil di bawah. Tambahkan item baru langsung dari form ini.</div>
                                    </div>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={addNewItem} disabled={savingEdit}>
                                        <Plus size={14} /> Tambah Item
                                    </button>
                                </div>
                                {editExistingItems.length > 0 && (
                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                        {editExistingItems.map((item, itemIndex) => (
                                            <div key={item.deliveryOrderItemId} style={{ display: 'grid', gap: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Barang Tersimpan {itemIndex + 1}</div>
                                                    <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => void removeExistingItem(item)}
                                                        disabled={savingEdit || removingCargoItemId === item.deliveryOrderItemId}
                                                        style={{ color: 'var(--color-danger-700)' }}
                                                    >
                                                        {removingCargoItemId === item.deliveryOrderItemId ? 'Menghapus...' : 'Hapus'}
                                                    </button>
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Barang Customer</label>
                                                        <select className="form-select" value={item.customerProductRef} onChange={event => applyExistingItemProduct(itemIndex, event.target.value)} disabled={savingEdit || !deliveryOrder.customerRef}>
                                                            <option value="">{customerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                            {customerProducts.map(product => <option key={product._id} value={product._id}>{product.code ? `${product.code} - ` : ''}{product.name}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Deskripsi Barang</label>
                                                        <input className="form-input" value={item.description} onChange={event => updateExistingItem(itemIndex, 'description', event.target.value)} disabled={savingEdit} />
                                                    </div>
                                                </div>
                                                <div className="form-row">
                                                    <div className="form-group">
                                                        <label className="form-label">Koli</label>
                                                        <FormattedNumberInput min={0} allowDecimal={false} value={item.qtyKoli} onValueChange={value => updateExistingItem(itemIndex, 'qtyKoli', value)} disabled={savingEdit} />
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Berat</label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                    <FormattedNumberInput min={0} maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)} value={item.weightInputValue} onValueChange={value => updateExistingItem(itemIndex, 'weightInputValue', value)} disabled={savingEdit || shouldLockOrderItemWeight(item)} />
                                                            <select
                                                                className="form-select"
                                                                value={item.weightInputUnit}
                                                                onChange={event => setEditExistingItems(previous => previous.map((entry, index) => (
                                                                    index === itemIndex
                                                                        ? {
                                                                            ...entry,
                                                                            ...toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                                                                                ...entry,
                                                                                pickupStopKey: editForm.pickupStopKey,
                                                                                shipperReferenceNumber: editForm.referenceNumber,
                                                                            }, event.target.value as DeliveryOrderCargoDraftItem['weightInputUnit'])),
                                                                            deliveryOrderItemId: entry.deliveryOrderItemId,
                                                                        }
                                                                        : entry
                                                                )))}
                                                                disabled={savingEdit}
                                                            >
                                                                {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div className="form-group">
                                                        <label className="form-label">Volume</label>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                            <FormattedNumberInput min={0} maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3} value={item.volumeInputValue} onValueChange={value => updateExistingItem(itemIndex, 'volumeInputValue', value)} disabled={savingEdit || shouldLockOrderItemVolume(item)} />
                                                            <select
                                                                className="form-select"
                                                                value={item.volumeInputUnit}
                                                                onChange={event => setEditExistingItems(previous => previous.map((entry, index) => (
                                                                    index === itemIndex
                                                                        ? {
                                                                            ...entry,
                                                                            ...toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                                                                                ...entry,
                                                                                pickupStopKey: editForm.pickupStopKey,
                                                                                shipperReferenceNumber: editForm.referenceNumber,
                                                                            }, event.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit'])),
                                                                            deliveryOrderItemId: entry.deliveryOrderItemId,
                                                                        }
                                                                        : entry
                                                                )))}
                                                                disabled={savingEdit}
                                                            >
                                                                {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {editNewItems.map((item, itemIndex) => (
                                    <div key={`new-${itemIndex}`} style={{ display: 'grid', gap: 12, padding: 12, background: 'var(--color-gray-50)', borderRadius: '0.8rem', border: '1px solid var(--color-gray-200)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Barang Baru {itemIndex + 1}</div>
                                            <button type="button" className="btn btn-ghost btn-icon-only" onClick={() => removeNewItem(itemIndex)} disabled={savingEdit}>
                                                <X size={18} />
                                            </button>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label className="form-label">Barang Customer</label>
                                                <select className="form-select" value={item.customerProductRef} onChange={event => applyNewItemProduct(itemIndex, event.target.value)} disabled={savingEdit || !deliveryOrder.customerRef}>
                                                    <option value="">{customerProducts.length > 0 ? 'Pilih master barang' : 'Belum ada master barang'}</option>
                                                    {customerProducts.map(product => <option key={product._id} value={product._id}>{product.code ? `${product.code} - ` : ''}{product.name}</option>)}
                                                </select>
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Deskripsi Barang</label>
                                                <input className="form-input" value={item.description} onChange={event => updateNewItem(itemIndex, 'description', event.target.value)} disabled={savingEdit} />
                                            </div>
                                        </div>
                                        <div className="form-row">
                                            <div className="form-group">
                                                <label className="form-label">Koli</label>
                                                <FormattedNumberInput min={0} allowDecimal={false} value={item.qtyKoli} onValueChange={value => updateNewItem(itemIndex, 'qtyKoli', value)} disabled={savingEdit} />
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Berat</label>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                    <FormattedNumberInput min={0} maxFractionDigits={getWeightInputFractionDigits(item.weightInputUnit)} value={item.weightInputValue} onValueChange={value => updateNewItem(itemIndex, 'weightInputValue', value)} disabled={savingEdit || shouldLockOrderItemWeight(item)} />
                                                    <select
                                                        className="form-select"
                                                        value={item.weightInputUnit}
                                                        onChange={event => setEditNewItems(previous => previous.map((entry, index) => (
                                                            index === itemIndex
                                                                ? toDeliveryOrderCargoDraftItem(updateOrderItemWeightUnit({
                                                                    ...entry,
                                                                    pickupStopKey: editForm.pickupStopKey,
                                                                    shipperReferenceNumber: editForm.referenceNumber,
                                                                }, event.target.value as DeliveryOrderCargoDraftItem['weightInputUnit']))
                                                                : entry
                                                        )))}
                                                        disabled={savingEdit}
                                                    >
                                                        {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="form-group">
                                                <label className="form-label">Volume</label>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                    <FormattedNumberInput min={0} maxFractionDigits={item.volumeInputUnit === 'LITER' ? 0 : 3} value={item.volumeInputValue} onValueChange={value => updateNewItem(itemIndex, 'volumeInputValue', value)} disabled={savingEdit || shouldLockOrderItemVolume(item)} />
                                                    <select
                                                        className="form-select"
                                                        value={item.volumeInputUnit}
                                                        onChange={event => setEditNewItems(previous => previous.map((entry, index) => (
                                                            index === itemIndex
                                                                ? toDeliveryOrderCargoDraftItem(updateOrderItemVolumeUnit({
                                                                    ...entry,
                                                                    pickupStopKey: editForm.pickupStopKey,
                                                                    shipperReferenceNumber: editForm.referenceNumber,
                                                                }, event.target.value as DeliveryOrderCargoDraftItem['volumeInputUnit']))
                                                                : entry
                                                        )))}
                                                        disabled={savingEdit}
                                                    >
                                                        {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={savingEdit}>Batal</button>
                            <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit || !editForm.referenceNumber.trim()}>
                                <Save size={16} /> {savingEdit ? 'Menyimpan...' : 'Simpan Edit'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showStatusModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) { setShowStatusModal(false); setContinuingHeldCargo(false); } }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{isCompletingDelivery ? (continuingHeldCargo ? 'Finalisasi Sisa Hold SJ' : 'Finalisasi SJ') : 'Update Status SJ'}</h3>
                            <button className="modal-close" onClick={() => { setShowStatusModal(false); setContinuingHeldCargo(false); }} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Status Tujuan</label>
                                <select className="form-select" value={newStatus} onChange={event => setNewStatus(event.target.value)} disabled={updatingStatus}>
                                    <option value="">Pilih status</option>
                                    {availableStatuses.map(status => (
                                        <option key={status} value={status}>{DO_STATUS_MAP[status]?.label || status}</option>
                                    ))}
                                </select>
                            </div>
                            {isCompletingDelivery && (
                                <>
                                    <div style={{ background: 'var(--color-info-light)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                        {continuingHeldCargo
                                            ? <>Lanjutan hold ini hanya berlaku untuk <strong>{suratJalanDisplayNumber}</strong>. Muatan aktual diisi otomatis dari sisa hold SJ ini, lalu Anda bisa membagi ulang drop lanjutan seperti finalisasi hold di Trip Detail.</>
                                            : <>Finalisasi ini hanya berlaku untuk <strong>{suratJalanDisplayNumber}</strong>. Flow, hitungan, dan review-nya sama seperti finalisasi batch SJ di Trip Detail, hanya tanpa pilih batch karena di sini fokusnya satu SJ.</>}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">SJ yang difinalkan</div>
                                            <div className="font-semibold" style={{ fontSize: '1.05rem', marginTop: '0.2rem' }}>{suratJalanDisplayNumber}</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Item dalam batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '1.05rem', marginTop: '0.2rem' }}>{selectedActualCargoItems.length} item</div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Muatan batch SJ</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedActualCargoItems.length > 0 ? formatCargoSummary(selectedActualCargoTotals) : 'Belum diisi'}
                                            </div>
                                        </div>
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                            <div className="text-muted text-sm">Mode drop</div>
                                            <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>
                                                {selectedDropModeLabel}
                                            </div>
                                            <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>{selectedDropOutcomeSummary}</div>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Nama Penerima POD <span className="required">*</span></label>
                                        <input className="form-input" value={podName} onChange={event => setPodName(event.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Tanggal Terima POD <span className="required">*</span></label>
                                        <input type="date" className="form-input" value={podDate} onChange={event => setPodDate(event.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Catatan POD</label>
                                        <textarea className="form-textarea" rows={2} value={podNote} onChange={event => setPodNote(event.target.value)} disabled={updatingStatus} />
                                    </div>
                                    <div className="form-group">
                                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '1rem', padding: '1rem', background: 'var(--color-white)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                                <div>
                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.2rem' }}>Langkah 1</div>
                                                    <label className="form-label" style={{ marginBottom: 0 }}>Tentukan Realisasi Titik Drop <span className="required">*</span></label>
                                                </div>
                                                <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAdvancedDropEditor} disabled={updatingStatus}>
                                                    <MapPin size={14} /> {showAdvancedDropEditor ? 'Tutup Detail Drop' : 'Ada Multi-drop / Hold'}
                                                </button>
                                            </div>
                                            <div style={{ background: 'var(--color-info-light)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-info)' }}>
                                                Tentukan dulu titik drop aktual. Kalau semua selesai di satu tujuan, sistem otomatis pakai <strong>{selectedDetailState.autoActualDropDraft.locationName || 'Tujuan Invoice'}</strong>. Barang, qty, berat, dan volume diatur pada langkah berikutnya.
                                            </div>
                                            {selectedDetailState.actualDropAmbiguityMessage && (
                                                <div style={{ background: 'var(--color-warning-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                                    {selectedDetailState.actualDropAmbiguityMessage}
                                                </div>
                                            )}
                                            {!showAdvancedDropEditor ? (
                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                                    <div style={{ fontWeight: 600 }}>Realisasi Default</div>
                                                    <div className="form-row">
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">Nama Lokasi Drop <span className="required">*</span></label>
                                                            <input
                                                                className="form-input"
                                                                value={selectedDetailState.autoActualDropDraft.locationName}
                                                                onChange={event => updateActualDropDraft(selectedDetailState.autoActualDropDraft.draftKey, 'locationName', event.target.value)}
                                                                disabled={updatingStatus}
                                                                placeholder="Mis. Gudang Customer Surabaya"
                                                            />
                                                        </div>
                                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                                            <label className="form-label">Alamat Drop</label>
                                                            <input
                                                                className="form-input"
                                                                value={selectedDetailState.autoActualDropDraft.locationAddress}
                                                                onChange={event => updateActualDropDraft(selectedDetailState.autoActualDropDraft.draftKey, 'locationAddress', event.target.value)}
                                                                disabled={updatingStatus}
                                                                placeholder="Opsional"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.2rem' }}>
                                                        <div>Barang: {summarizeActualCargoDraftDescriptions(getActualCargoDraftsForDrop(selectedDetailState.autoActualDropDraft, selectedActualCargoItems))}</div>
                                                        <div>Muatan: {formatCargoSummary(selectedActualCargoTotals)}</div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                                        <div className="text-muted text-sm">
                                                            Tentukan per titik apakah barang turun atau hold.
                                                        </div>
                                                        <button type="button" className="btn btn-secondary btn-sm" onClick={addActualDropDraft} disabled={updatingStatus}>
                                                            + Tambah Titik Drop
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                                                    {selectedActualDropPoints.map((drop, index) => {
                                                        const allocationSummaryRows = getActualDropAllocationSummaryRows(drop);
                                                        return (
                                                            <div key={drop.draftKey} style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.9rem', padding: '0.9rem', background: 'var(--color-gray-50)', display: 'grid', gap: '0.75rem' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                                    <div>
                                                                        <div style={{ fontWeight: 600 }}>Titik Drop {index + 1}</div>
                                                                        <div className="text-muted text-sm">Barang untuk titik ini diatur dari tombol ini.</div>
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                                        <button
                                                                            type="button"
                                                                            className="btn btn-primary btn-sm"
                                                                            onClick={() => {
                                                                                setActiveFinalizationCargoItemRef(getDefaultFinalizationCargoItemRef(drop, selectedDerivedActualCargoItems));
                                                                                setActiveFinalizationDropKey(drop.draftKey);
                                                                                setShowStatusModal(false);
                                                                                setShowActualCargoFinalizationModal(true);
                                                                            }}
                                                                            disabled={!newStatus || updatingStatus || !podName.trim() || !podDate || !(drop.locationName.trim() || drop.locationAddress.trim())}
                                                                        >
                                                                            Tentukan Barang
                                                                        </button>
                                                                        {selectedActualDropPoints.length > 1 && (
                                                                            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeActualDropDraft(drop.draftKey)} disabled={updatingStatus}>
                                                                                Hapus
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.65rem', padding: '0.7rem 0.8rem', background: 'var(--color-white)' }}>
                                                                    <div className="text-muted text-sm" style={{ marginBottom: '0.45rem' }}>
                                                                        Alokasi {DO_ACTUAL_DROP_TYPE_MAP[drop.stopType]?.label || drop.stopType}
                                                                    </div>
                                                                    {allocationSummaryRows.length > 0 ? (
                                                                        <div style={{ display: 'grid', gap: '0.35rem' }}>
                                                                            {allocationSummaryRows.map(row => (
                                                                                <div key={row.key} style={{ display: 'grid', gap: '0.25rem', fontSize: '0.8rem' }}>
                                                                                    <div style={{ fontWeight: 600 }}>{row.label}</div>
                                                                                    <div style={{ display: 'grid', gap: '0.15rem', color: 'var(--color-gray-700)' }}>
                                                                                        <div>Dialokasikan: {formatCargoSummary(row.allocatedSummary)}</div>
                                                                                        <div>Total barang: {formatCargoSummary(row.totalSummary)}</div>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-muted text-sm">Belum ada barang dialokasikan.</div>
                                                                    )}
                                                                </div>
                                                                <div className="form-row">
                                                                    <div className="form-group">
                                                                        <label className="form-label">Tipe Titik</label>
                                                                        <select className="form-select" value={drop.stopType} onChange={event => updateActualDropDraft(drop.draftKey, 'stopType', event.target.value)} disabled={updatingStatus}>
                                                                            {Object.entries(DO_ACTUAL_DROP_TYPE_MAP).filter(([value]) => !['EXTRA_DROP', 'TRANSIT', 'RETURN'].includes(value)).map(([value, meta]) => (
                                                                                <option key={value} value={value}>{meta.label}</option>
                                                                            ))}
                                                                        </select>
                                                                    </div>
                                                                    <div className="form-group">
                                                                        <label className="form-label">Nama Lokasi <span className="required">*</span></label>
                                                                        <input
                                                                            className="form-input"
                                                                            value={drop.locationName}
                                                                            onChange={event => updateActualDropDraft(drop.draftKey, 'locationName', event.target.value)}
                                                                            disabled={updatingStatus}
                                                                            placeholder="Mis. Gudang Hold Malang"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Alamat Lokasi</label>
                                                                    <input
                                                                        className="form-input"
                                                                        value={drop.locationAddress}
                                                                        onChange={event => updateActualDropDraft(drop.draftKey, 'locationAddress', event.target.value)}
                                                                        disabled={updatingStatus}
                                                                        placeholder="Opsional, isi jika berbeda dari tujuan invoice"
                                                                    />
                                                                </div>
                                                                <div className="form-group">
                                                                    <label className="form-label">Catatan Titik Drop</label>
                                                                    <textarea className="form-textarea" rows={2} value={drop.note} onChange={event => updateActualDropDraft(drop.draftKey, 'note', event.target.value)} disabled={updatingStatus} placeholder="Mis. 30 koli turun di Malang, sisa lanjut ke Ponorogo" />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                        Setelah titik drop ditentukan, klik <strong>Tentukan Barang</strong>. Aktual barang akan dibuka di modal terpisah dengan tab per item.
                                    </div>
                                    <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--color-gray-700)', border: '1px solid var(--color-gray-200)' }}>
                                        Setelah disimpan, progres <strong>Trip {suratJalanDocument.tripNumber}</strong> akan mengikuti hasil SJ ini. Kalau masih ada SJ lain yang belum terkirim, trip belum dibaca sebagai tuntas penuh.
                                    </div>
                                </>
                            )}
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={3} value={statusNote} onChange={event => setStatusNote(event.target.value)} placeholder={isCompletingDelivery ? 'Catatan finalisasi batch SJ...' : 'Catatan progres batch SJ...'} disabled={updatingStatus} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowStatusModal(false)} disabled={updatingStatus}>Batal</button>
                            {isCompletingDelivery ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        setActiveFinalizationCargoItemRef(getDefaultFinalizationCargoItemRef(selectedDetailState.autoActualDropDraft, selectedDerivedActualCargoItems));
                                        setActiveFinalizationDropKey('');
                                        setShowStatusModal(false);
                                        setShowActualCargoFinalizationModal(true);
                                    }}
                                    disabled={!newStatus || updatingStatus || !podName.trim() || !podDate || !selectedActualDropSetupReady}
                                >
                                    Lanjut Aktual Barang
                                </button>
                            ) : (
                                <button className="btn btn-primary" onClick={updateStatus} disabled={!newStatus || updatingStatus}>
                                    <Save size={16} /> {updatingStatus ? 'Menyimpan...' : 'Simpan SJ'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showActualCargoFinalizationModal && (
                <div className="modal-overlay" onClick={() => { if (!updatingStatus) setShowActualCargoFinalizationModal(false); }}>
                    <div className="modal modal-lg" onClick={event => event.stopPropagation()}>
                        <div className="modal-header">
                            <div>
                                <h3 className="modal-title">{activeFinalizationDrop ? 'Tentukan Barang Titik Drop' : 'Aktual Barang SJ'}</h3>
                                <div className="text-muted text-sm" style={{ marginTop: '0.2rem' }}>
                                    {activeFinalizationDrop ? 'Alokasi titik drop' : 'Langkah 2 dari 2'} | {selectedDerivedActualCargoItems.length} item di {suratJalanDisplayNumber}
                                    {activeFinalizationDrop ? ` | ${activeFinalizationDrop.locationName || activeFinalizationDrop.locationAddress || 'Titik Drop'}` : ''}
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setShowActualCargoFinalizationModal(false)} disabled={updatingStatus}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">{activeFinalizationDrop ? 'Muatan aktual saat ini' : 'Muatan realisasi'}</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>{formatCargoSummary(selectedActualCargoTotals)}</div>
                                </div>
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.85rem 1rem', background: 'var(--color-white)' }}>
                                    <div className="text-muted text-sm">Realisasi drop</div>
                                    <div className="font-semibold" style={{ fontSize: '0.95rem', marginTop: '0.2rem' }}>{selectedDropModeLabel}</div>
                                    <div className="text-muted text-sm" style={{ marginTop: '0.3rem' }}>{selectedDropOutcomeSummary}</div>
                                </div>
                            </div>

                            {!activeFinalizationDrop && selectedActualDropMismatchMessage && (
                                <div style={{ background: 'var(--color-danger-light)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                                    {selectedActualDropMismatchMessage} Muatan aktual {formatCargoSummary(selectedActualCargoTotals)} tetapi alokasi drop baru {formatCargoSummary(selectedActualDropTotals)}.
                                </div>
                            )}

                            {!activeFinalizationDrop && !selectedActualCargoReady && (
                                <div style={{ background: 'var(--color-warning-soft)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: 'var(--color-warning-dark)' }}>
                                    Lengkapi aktual barang yang bertanda wajib sebelum finalisasi SJ disimpan.
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '0.35rem', overflowX: 'auto', borderBottom: '1px solid var(--color-gray-200)', marginBottom: '1rem', paddingBottom: '0.35rem' }}>
                                {selectedDerivedActualCargoItems.map((item, index) => {
                                    const isActive = activeFinalizationCargoItem?.deliveryOrderItemRef === item.deliveryOrderItemRef;
                                    return (
                                        <button
                                            key={item.deliveryOrderItemRef}
                                            type="button"
                                            className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setActiveFinalizationCargoItemRef(item.deliveryOrderItemRef)}
                                            disabled={updatingStatus}
                                            title={item.description}
                                            style={{ whiteSpace: 'nowrap' }}
                                        >
                                            Item {index + 1}
                                        </button>
                                    );
                                })}
                            </div>

                            {activeFinalizationCargoItem ? (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                        <div>
                                            <div className="text-muted text-sm">{suratJalanDisplayNumber}</div>
                                            <div style={{ fontWeight: 700, marginTop: '0.2rem' }}>{activeFinalizationCargoItem.description}</div>
                                        </div>
                                        <div className="text-muted text-sm">
                                            Rencana: {formatCargoSummary({
                                                qtyKoli: activeFinalizationCargoItem.plannedQtyKoli,
                                                weightKg: activeFinalizationCargoItem.plannedWeightKg,
                                                weightInputValue: activeFinalizationCargoItem.plannedWeightInputValue,
                                                weightInputUnit: activeFinalizationCargoItem.plannedWeightInputUnit,
                                                volumeM3: activeFinalizationCargoItem.plannedVolumeM3,
                                                volumeInputValue: activeFinalizationCargoItem.plannedVolumeInputValue,
                                                volumeInputUnit: activeFinalizationCargoItem.plannedVolumeInputUnit,
                                            })}
                                        </div>
                                    </div>
                                    {!activeFinalizationCargoItem.requireQty && (
                                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                                            Item ini tidak memakai basis koli. Isi realisasi berat dan/atau volume aktual lapangan.
                                        </div>
                                    )}
                                    {activeFinalizationDrop && (
                                        <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.85rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                            Isi alokasi barang untuk titik <strong>{activeFinalizationDrop.locationName || activeFinalizationDrop.locationAddress || 'ini'}</strong>. Nilai ini hanya rencana pembagian DROP, HOLD, RETURN, atau TRANSIT dan masih bisa diubah pada langkah Aktual Barang.
                                        </div>
                                    )}
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">{activeFinalizationDrop ? 'Koli Alokasi' : 'Koli Aktual'} {activeFinalizationCargoItem.requireQty && <span className="required">*</span>}</label>
                                            <FormattedNumberInput
                                                min={0}
                                                maxFractionDigits={2}
                                                value={parseFormattedNumberish((activeFinalizationDropAllocation?.qtyKoli ?? activeFinalizationCargoItem.actualQtyKoli) || 0, { maxFractionDigits: 2 })}
                                                onValueChange={value => {
                                                    if (activeFinalizationDrop) {
                                                        updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'qtyKoli', String(value));
                                                        return;
                                                    }
                                                    updateActualCargoDraft(activeFinalizationCargoItem.deliveryOrderItemRef, 'actualQtyKoli', String(value));
                                                }}
                                                disabled={updatingStatus || !activeFinalizationCargoItem.requireQty}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">{activeFinalizationDrop ? 'Berat Alokasi' : 'Berat Aktual'} {activeFinalizationCargoItem.requireWeight && <span className="required">*</span>}</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                <SplitDecimalNumberInput
                                                    min={0}
                                                    maxFractionDigits={getWeightInputFractionDigits(activeFinalizationDropAllocation?.weightInputUnit || activeFinalizationCargoItem.actualWeightInputUnit)}
                                                    value={(activeFinalizationDropAllocation?.weightInputValue ?? activeFinalizationCargoItem.actualWeightInputValue) || 0}
                                                    onValueChange={value => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'weightInputValue', String(value));
                                                            return;
                                                        }
                                                        updateActualCargoDraft(activeFinalizationCargoItem.deliveryOrderItemRef, 'actualWeightInputValue', String(value));
                                                    }}
                                                    disabled={updatingStatus || (activeFinalizationDrop ? shouldLockActualDropVolume(activeFinalizationCargoItem) : shouldLockActualCargoVolume(activeFinalizationCargoItem))}
                                                />
                                                <select
                                                    className="form-select"
                                                    value={activeFinalizationDropAllocation?.weightInputUnit || activeFinalizationCargoItem.actualWeightInputUnit}
                                                    onChange={event => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'weightInputUnit', event.target.value);
                                                            return;
                                                        }
                                                        updateActualCargoWeightUnit(activeFinalizationCargoItem.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualWeightInputUnit']);
                                                    }}
                                                    disabled={updatingStatus}
                                                >
                                                    {WEIGHT_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">{activeFinalizationDrop ? 'Volume Alokasi' : 'Volume Aktual'} {activeFinalizationCargoItem.requireVolume && <span className="required">*</span>}</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: '0.5rem' }}>
                                                <SplitDecimalNumberInput
                                                    min={0}
                                                    maxFractionDigits={(activeFinalizationDropAllocation?.volumeInputUnit || activeFinalizationCargoItem.actualVolumeInputUnit) === 'LITER' ? 0 : 3}
                                                    value={(activeFinalizationDropAllocation?.volumeInputValue ?? activeFinalizationCargoItem.actualVolumeInputValue) || 0}
                                                    onValueChange={value => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'volumeInputValue', String(value));
                                                            return;
                                                        }
                                                        updateActualCargoDraft(activeFinalizationCargoItem.deliveryOrderItemRef, 'actualVolumeInputValue', String(value));
                                                    }}
                                                    disabled={updatingStatus}
                                                />
                                                <select
                                                    className="form-select"
                                                    value={activeFinalizationDropAllocation?.volumeInputUnit || activeFinalizationCargoItem.actualVolumeInputUnit}
                                                    onChange={event => {
                                                        if (activeFinalizationDrop) {
                                                            updateActualDropAllocationForItem(activeFinalizationDrop, activeFinalizationCargoItem, 'volumeInputUnit', event.target.value);
                                                            return;
                                                        }
                                                        updateActualCargoVolumeUnit(activeFinalizationCargoItem.deliveryOrderItemRef, event.target.value as ActualCargoDraft['actualVolumeInputUnit']);
                                                    }}
                                                    disabled={updatingStatus}
                                                >
                                                    {VOLUME_INPUT_UNIT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <div className="empty-state-title">Belum ada item barang dalam SJ ini</div>
                                </div>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setShowActualCargoFinalizationModal(false);
                                    setShowStatusModal(true);
                                }}
                                disabled={updatingStatus}
                            >
                                Kembali ke Titik Drop
                            </button>
                            {activeFinalizationDrop ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => {
                                        if (activeFinalizationDrop) {
                                            persistActualDropAllocationsForItems(
                                                activeFinalizationDrop,
                                                selectedDerivedActualCargoItems
                                            );
                                        }
                                        setShowActualCargoFinalizationModal(false);
                                        setShowStatusModal(true);
                                    }}
                                    disabled={updatingStatus}
                                >
                                    Simpan Alokasi Barang
                                </button>
                            ) : (
                                <button
                                    className="btn btn-success"
                                    onClick={updateStatus}
                                    disabled={!newStatus || updatingStatus || !podName.trim() || !podDate || !selectedActualDropReady || !selectedActualCargoReady}
                                >
                                    <Save size={16} /> {updatingStatus ? 'Menyimpan...' : 'Finalkan SJ'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

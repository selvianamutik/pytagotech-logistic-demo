import type {
    DeliveryOrder,
    DeliveryOrderItem,
} from '@/lib/types';
import type { DeliveryOrderCargoDraftItem } from '@/lib/delivery-order-cargo-draft-support';

export type ShipperReferenceDraft = {
    draftKey: string;
    referenceKey: string;
    referenceNumber: string;
    date: string;
    pickupStopKey: string;
    pickupAddress: string;
    selectedRecipientId: string;
    billingCustomerRef: string;
    billingCustomerName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
};

export type ExistingShipperReferenceItemDraft = DeliveryOrderCargoDraftItem & {
    deliveryOrderItemId: string;
};

export type ResolvedShipperReferenceEntry = {
    draftKey: string;
    referenceKey: string;
    referenceNumber: string;
    date: string;
    pickupStopKey: string;
    pickupLabel: string;
    pickupAddress: string;
    billingCustomerRef: string;
    billingCustomerName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
};

export function buildResolvedShipperReferenceEntries(
    deliveryOrder: DeliveryOrder | null,
    doItems: DeliveryOrderItem[]
): ResolvedShipperReferenceEntry[] {
    if (!deliveryOrder) {
        return [];
    }

    const pickupStops = (deliveryOrder.pickupStops || [])
        .map((pickupStop, index) => ({
            _key: pickupStop._key || `pickup-stop-${index + 1}`,
            sequence: pickupStop.sequence || index + 1,
            pickupLabel: pickupStop.pickupLabel || '',
            pickupAddress: pickupStop.pickupAddress || '',
        }))
        .sort((left, right) => left.sequence - right.sequence);
    const pickupStopMap = new Map(pickupStops.map(stop => [stop._key, stop]));
    const entries = new Map<string, ResolvedShipperReferenceEntry>();
    const compositeIndex = new Map<string, string>();

    const upsertEntry = (
        referenceNumber: string,
        pickupStopKey = '',
        pickupAddress = '',
        draftKeyHint = '',
        referenceKeyHint = '',
        date = ''
    ) => {
        const normalizedReference = referenceNumber.trim();
        if (!normalizedReference) {
            return;
        }
        const matchedStop = pickupStopKey ? pickupStopMap.get(pickupStopKey) : null;
        const resolvedPickupLabel = matchedStop
            ? `Pickup ${matchedStop.sequence}${matchedStop.pickupLabel ? ` - ${matchedStop.pickupLabel}` : ''}`
            : '';
        const resolvedPickupAddress = matchedStop?.pickupAddress || pickupAddress || '';
        const compositeKey = `${pickupStopKey || 'tanpa-pickup'}::${normalizedReference}`;
        const resolvedEntryKey =
            (referenceKeyHint && entries.has(referenceKeyHint) && referenceKeyHint)
            || (draftKeyHint && entries.has(draftKeyHint) && draftKeyHint)
            || compositeIndex.get(compositeKey)
            || referenceKeyHint
            || draftKeyHint
            || compositeKey;
        if (entries.has(resolvedEntryKey)) {
            const current = entries.get(resolvedEntryKey)!;
            entries.set(resolvedEntryKey, {
                ...current,
                draftKey: current.draftKey || resolvedEntryKey,
                referenceKey: current.referenceKey || referenceKeyHint,
                referenceNumber: current.referenceNumber || normalizedReference,
                date: current.date || date,
                pickupStopKey: current.pickupStopKey || pickupStopKey,
                pickupLabel: current.pickupLabel || resolvedPickupLabel,
                pickupAddress: current.pickupAddress || resolvedPickupAddress,
            });
            compositeIndex.set(compositeKey, resolvedEntryKey);
            return;
        }
        entries.set(resolvedEntryKey, {
            draftKey: draftKeyHint || resolvedEntryKey,
            referenceKey: referenceKeyHint,
            referenceNumber: normalizedReference,
            date,
            pickupStopKey,
            pickupLabel: resolvedPickupLabel,
            pickupAddress: resolvedPickupAddress,
            billingCustomerRef: '',
            billingCustomerName: '',
            receiverName: '',
            receiverPhone: '',
            receiverAddress: '',
            receiverCompany: '',
        });
        compositeIndex.set(compositeKey, resolvedEntryKey);
    };

    (deliveryOrder.shipperReferences || []).forEach((reference, index) => {
        upsertEntry(
            reference.referenceNumber || '',
            reference.pickupStopKey || '',
            reference.pickupAddress || '',
            reference._key || `shipper-reference-${index + 1}`,
            reference._key || '',
            reference.date || ''
        );
        const entryKey =
            reference._key
            || compositeIndex.get(`${reference.pickupStopKey || 'tanpa-pickup'}::${(reference.referenceNumber || '').trim()}`)
            || `${reference.pickupStopKey || 'tanpa-pickup'}::${(reference.referenceNumber || '').trim()}`;
        const current = entries.get(entryKey);
        if (current) {
            entries.set(entryKey, {
                ...current,
                referenceKey: reference._key || current.referenceKey,
                date: reference.date || current.date,
                billingCustomerRef: reference.billingCustomerRef || current.billingCustomerRef,
                billingCustomerName: reference.billingCustomerName || current.billingCustomerName,
                receiverName: reference.receiverName || current.receiverName,
                receiverPhone: reference.receiverPhone || current.receiverPhone,
                receiverAddress: reference.receiverAddress || current.receiverAddress,
                receiverCompany: reference.receiverCompany || current.receiverCompany,
            });
        }
    });

    doItems.forEach(item => {
        upsertEntry(
            item.shipperReferenceNumber || '',
            item.pickupStopKey || '',
            item.pickupAddress || '',
            item.shipperReferenceKey || `delivery-order-item-${item._id}`,
            item.shipperReferenceKey || ''
        );
    });

    if (entries.size === 0 && deliveryOrder.customerDoNumber?.trim()) {
        upsertEntry(
            deliveryOrder.customerDoNumber,
            deliveryOrder.pickupStops?.[0]?._key || '',
            deliveryOrder.pickupAddress || '',
            'legacy-customer-do-number',
            ''
        );
    }

    return [...entries.values()];
}

export function matchesShipperReferenceDraft(
    draft: Pick<ShipperReferenceDraft, 'referenceKey' | 'referenceNumber'>,
    item: Pick<DeliveryOrderItem, 'shipperReferenceKey' | 'shipperReferenceNumber'>
) {
    const itemReferenceKey = (item.shipperReferenceKey || '').trim();
    const itemReferenceNumber = (item.shipperReferenceNumber || '').trim().toUpperCase();
    const selectedReferenceKey = draft.referenceKey.trim();
    const selectedReferenceNumber = draft.referenceNumber.trim().toUpperCase();
    if (selectedReferenceKey || selectedReferenceNumber) {
        return Boolean(
            (selectedReferenceKey && itemReferenceKey === selectedReferenceKey) ||
            (selectedReferenceNumber && itemReferenceNumber === selectedReferenceNumber)
        );
    }
    return !itemReferenceKey && !itemReferenceNumber;
}

import {
    isPlainObject,
    normalizeOptionalText,
    normalizeText,
} from './data-helpers';
import type { NormalizedOrderItemInput } from './order-workflow-support';

export function normalizeDeliveryOrderShipperReferencesForUpdate(
    deliveryOrder: {
        pickupStops?: Array<{
            _key?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            sequence?: number;
            referenceNumber?: string;
            date?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
            billingCustomerRef?: string;
            billingCustomerName?: string;
            receiverName?: string;
            receiverPhone?: string;
            receiverAddress?: string;
            receiverCompany?: string;
            notes?: string;
        }>;
    },
    rawShipperReferences: unknown,
) {
    const requestedReferences = Array.isArray(rawShipperReferences) ? rawShipperReferences : [];
    if (requestedReferences.length === 0) {
        return undefined;
    }

    const pickupStopByKey = new Map(
        (deliveryOrder.pickupStops || [])
            .map(stop => [normalizeOptionalText(stop._key), stop] as const)
            .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[0]))
    );
    const existingReferences = Array.isArray(deliveryOrder.shipperReferences)
        ? deliveryOrder.shipperReferences
        : [];

    const seenReferenceNumbers = new Set<string>();
    const usedExistingReferenceIndexes = new Set<number>();
    const usedReferenceKeys = new Set<string>();
    const normalizedReferences = requestedReferences
        .filter(isPlainObject)
        .map((reference, index) => {
            const referenceNumber = normalizeText(reference.referenceNumber).toUpperCase();
            if (!referenceNumber) {
                throw new Error(`No. SJ pengirim wajib diisi pada SJ ${index + 1}`);
            }
            if (seenReferenceNumbers.has(referenceNumber)) {
                throw new Error(`No. SJ pengirim ${referenceNumber} duplikat dalam daftar SJ`);
            }
            seenReferenceNumbers.add(referenceNumber);

            const requestedReferenceKey = normalizeOptionalText(reference._key);
            const findExistingReference = () => {
                const byRequestedKeyIndex = requestedReferenceKey
                    ? existingReferences.findIndex((item, candidateIndex) =>
                        !usedExistingReferenceIndexes.has(candidateIndex) &&
                        normalizeOptionalText(item._key) === requestedReferenceKey
                    )
                    : -1;
                if (byRequestedKeyIndex >= 0) {
                    return { reference: existingReferences[byRequestedKeyIndex], index: byRequestedKeyIndex };
                }

                const byNumberIndex = existingReferences.findIndex((item, candidateIndex) =>
                    !usedExistingReferenceIndexes.has(candidateIndex) &&
                    normalizeOptionalText(item.referenceNumber)?.toUpperCase() === referenceNumber
                );
                if (byNumberIndex >= 0) {
                    return { reference: existingReferences[byNumberIndex], index: byNumberIndex };
                }

                return { reference: undefined, index: -1 };
            };
            const existingReferenceMatch = findExistingReference();
            const existingReference = existingReferenceMatch.reference;
            if (existingReferenceMatch.index >= 0) {
                usedExistingReferenceIndexes.add(existingReferenceMatch.index);
            }
            let resolvedReferenceKey =
                normalizeOptionalText(existingReference?._key) ||
                crypto.randomUUID();
            if (usedReferenceKeys.has(resolvedReferenceKey)) {
                resolvedReferenceKey = crypto.randomUUID();
            }
            usedReferenceKeys.add(resolvedReferenceKey);

            const requestedPickupStopKey = normalizeOptionalText(reference.pickupStopKey);
            const resolvedPickupStopKey =
                requestedPickupStopKey
                || normalizeOptionalText(existingReference?.pickupStopKey)
                || ((deliveryOrder.pickupStops?.length || 0) === 1
                    ? normalizeOptionalText(deliveryOrder.pickupStops?.[0]?._key)
                    : undefined);
            const pickupStop = resolvedPickupStopKey ? pickupStopByKey.get(resolvedPickupStopKey) : undefined;
            const hasReferenceField = (field: string) => Object.prototype.hasOwnProperty.call(reference, field);
            const requestedPickupAddress = hasReferenceField('pickupAddress')
                ? normalizeOptionalText(reference.pickupAddress)
                : undefined;

            return {
                _key: resolvedReferenceKey,
                sequence: index + 1,
                referenceNumber,
                date:
                    hasReferenceField('date')
                        ? normalizeOptionalText(reference.date)
                        : normalizeOptionalText(existingReference?.date),
                pickupStopKey: pickupStop ? resolvedPickupStopKey : undefined,
                pickupAddress:
                    normalizeOptionalText(pickupStop?.pickupAddress)
                    || requestedPickupAddress
                    || normalizeOptionalText(existingReference?.pickupAddress),
                billingCustomerRef:
                    hasReferenceField('billingCustomerRef')
                        ? normalizeOptionalText(reference.billingCustomerRef)
                        : normalizeOptionalText(existingReference?.billingCustomerRef),
                billingCustomerName:
                    hasReferenceField('billingCustomerName')
                        ? normalizeOptionalText(reference.billingCustomerName)
                        : normalizeOptionalText(existingReference?.billingCustomerName),
                receiverName:
                    hasReferenceField('receiverName')
                        ? normalizeOptionalText(reference.receiverName)
                        : normalizeOptionalText(existingReference?.receiverName),
                receiverPhone:
                    hasReferenceField('receiverPhone')
                        ? normalizeOptionalText(reference.receiverPhone)
                        : normalizeOptionalText(existingReference?.receiverPhone),
                receiverAddress:
                    hasReferenceField('receiverAddress')
                        ? normalizeOptionalText(reference.receiverAddress)
                        : normalizeOptionalText(existingReference?.receiverAddress),
                receiverCompany:
                    hasReferenceField('receiverCompany')
                        ? normalizeOptionalText(reference.receiverCompany)
                        : normalizeOptionalText(existingReference?.receiverCompany),
                notes:
                    normalizeOptionalText(reference.notes)
                    || normalizeOptionalText(existingReference?.notes),
            };
        });

    return normalizedReferences;
}

export function areDeliveryOrderShipperReferencesEquivalent(
    left: Array<{
        referenceNumber?: string;
        date?: string;
        pickupStopKey?: string;
        billingCustomerRef?: string;
        billingCustomerName?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        notes?: string;
    }> | undefined,
    right: Array<{
        referenceNumber?: string;
        date?: string;
        pickupStopKey?: string;
        billingCustomerRef?: string;
        billingCustomerName?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        notes?: string;
    }> | undefined,
) {
    const normalizeReferences = (value: typeof left) =>
        (Array.isArray(value) ? value : [])
            .map((reference, index) => ({
                sequence: index + 1,
                referenceNumber: normalizeOptionalText(reference.referenceNumber)?.toUpperCase() || '',
                date: normalizeOptionalText(reference.date) || '',
                pickupStopKey: normalizeOptionalText(reference.pickupStopKey) || '',
                billingCustomerRef: normalizeOptionalText(reference.billingCustomerRef) || '',
                billingCustomerName: normalizeOptionalText(reference.billingCustomerName) || '',
                receiverName: normalizeOptionalText(reference.receiverName) || '',
                receiverPhone: normalizeOptionalText(reference.receiverPhone) || '',
                receiverAddress: normalizeOptionalText(reference.receiverAddress) || '',
                receiverCompany: normalizeOptionalText(reference.receiverCompany) || '',
                notes: normalizeOptionalText(reference.notes) || '',
            }))
            .filter(reference => reference.referenceNumber.length > 0);

    const normalizedLeft = normalizeReferences(left);
    const normalizedRight = normalizeReferences(right);

    return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function resolveDeliveryOrderCargoItemContext(
    item: Pick<NormalizedOrderItemInput, 'pickupStopKey' | 'pickupAddress' | 'shipperReferenceNumber'>,
    deliveryOrder: {
        pickupStops?: Array<{
            _key?: string;
            orderPickupStopKey?: string;
            pickupAddress?: string;
        }>;
        shipperReferences?: Array<{
            _key?: string;
            referenceNumber?: string;
            pickupStopKey?: string;
            pickupAddress?: string;
        }>;
    }
) {
    const requestedPickupStopKey = normalizeOptionalText(item.pickupStopKey);
    const requestedReferenceNumber = normalizeOptionalText(item.shipperReferenceNumber)?.toUpperCase();
    const pickupStops = Array.isArray(deliveryOrder.pickupStops) ? deliveryOrder.pickupStops : [];
    const shipperReferences = Array.isArray(deliveryOrder.shipperReferences) ? deliveryOrder.shipperReferences : [];

    const matchedReference =
        shipperReferences.find(reference =>
            requestedReferenceNumber &&
            normalizeOptionalText(reference.referenceNumber)?.toUpperCase() === requestedReferenceNumber
        ) ||
        (!requestedReferenceNumber
            ? shipperReferences.find(reference =>
                requestedPickupStopKey &&
                normalizeOptionalText(reference.pickupStopKey) === requestedPickupStopKey
            )
            : undefined);
    const resolvedPickupStopKey =
        normalizeOptionalText(matchedReference?.pickupStopKey) ||
        requestedPickupStopKey ||
        (pickupStops.length === 1 ? normalizeOptionalText(pickupStops[0]?._key) : undefined);
    const matchedPickupStop =
        pickupStops.find(stop =>
            resolvedPickupStopKey &&
            (
                normalizeOptionalText(stop._key) === resolvedPickupStopKey ||
                normalizeOptionalText(stop.orderPickupStopKey) === resolvedPickupStopKey
            )
        ) ||
        pickupStops.find(stop =>
            requestedPickupStopKey &&
            (
                normalizeOptionalText(stop._key) === requestedPickupStopKey ||
                normalizeOptionalText(stop.orderPickupStopKey) === requestedPickupStopKey
            )
        );

    return {
        // Key yang tidak match stop manapun dibuang, supaya tidak ada key yatim
        // yang nanti jatuh ke fallback alamat pickup lain.
        pickupStopKey: matchedPickupStop
            ? normalizeOptionalText(matchedPickupStop._key) || resolvedPickupStopKey
            : undefined,
        pickupAddress:
            normalizeOptionalText(matchedPickupStop?.pickupAddress) ||
            normalizeOptionalText(matchedReference?.pickupAddress) ||
            normalizeOptionalText(item.pickupAddress),
        shipperReferenceKey: normalizeOptionalText(matchedReference?._key),
        shipperReferenceNumber:
            normalizeOptionalText(matchedReference?.referenceNumber) ||
            requestedReferenceNumber,
    };
}

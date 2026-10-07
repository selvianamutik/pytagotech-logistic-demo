import type {
    Customer,
    CustomerProduct,
    CustomerRecipient,
    DeliveryActualDropPoint,
    DeliveryOrder,
    DeliveryOrderItem,
    DOStatus,
    DriverVoucher,
    Order,
    TripOwnership,
    TripRouteRate,
} from './types';

export interface CargoSummary {
    qtyKoli: number;
    weightKg: number;
    volumeM3: number;
}

export type TripStatus = DOStatus;

export interface TripShipperReferenceSummary {
    id: string;
    label: string;
    itemCount: number;
    cargoSummary: CargoSummary;
    billableCargo: CargoSummary;
    holdCargo: CargoSummary;
    returnCargo: CargoSummary;
}

export interface Trip {
    _id: string;
    _type: 'trip';
    sourceDeliveryOrderRef: string;
    tripNumber: string;
    orderRef: string;
    masterResi?: string;
    customerRef?: string;
    customerName?: string;
    vehicleRef?: string;
    vehiclePlate?: string;
    driverRef?: string;
    driverName?: string;
    date: string;
    status: TripStatus;
    pickupAddress?: string;
    receiverName?: string;
    receiverPhone?: string;
    receiverAddress?: string;
    receiverCompany?: string;
    serviceRef?: string;
    serviceName?: string;
    tripOwnership?: TripOwnership;
    vehicleServiceRef?: string;
    vehicleServiceName?: string;
    vehicleCategoryOverrideReason?: string;
    tripRouteRateRef?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    trackingState?: DeliveryOrder['trackingState'];
    trackingStartedAt?: string;
    trackingStoppedAt?: string;
    trackingLastSeenAt?: string;
    pendingDriverStatus?: DOStatus;
    tripClosedByAdminAt?: string;
    tripClosedByAdminRef?: string;
    tripClosedByAdminName?: string;
    cargoFinalizedAt?: string;
    taripBorongan?: number;
    notes?: string;
    shipperReferenceCount: number;
    shipperReferenceLinks: TripShipperReferenceSummary[];
    cargoSummary: CargoSummary;
    actualCargo: CargoSummary;
    billableCargo: CargoSummary;
    holdCargo: CargoSummary;
    returnCargo: CargoSummary;
}

export interface TripRecord {
    _id: string;
    _type: 'trip';
    deliveryOrderRef?: string;
    orderRef?: string;
    tripNumber: string;
    masterResi?: string;
    customerRef?: string;
    customerName?: string;
    vehicleRef?: string;
    vehiclePlate?: string;
    driverRef?: string;
    driverName?: string;
    tripDate: string;
    status: TripStatus;
    pickupAddress?: string;
    receiverName?: string;
    receiverPhone?: string;
    receiverAddress?: string;
    receiverCompany?: string;
    serviceRef?: string;
    serviceName?: string;
    tripOwnership?: TripOwnership;
    vehicleServiceRef?: string;
    vehicleServiceName?: string;
    vehicleCategoryOverrideReason?: string;
    tripRouteRateRef?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    trackingState?: DeliveryOrder['trackingState'];
    trackingStartedAt?: string;
    trackingStoppedAt?: string;
    trackingLastSeenAt?: string;
    pendingDriverStatus?: DOStatus;
    tripClosedByAdminAt?: string;
    tripClosedByAdminRef?: string;
    tripClosedByAdminName?: string;
    cargoFinalizedAt?: string;
    taripBorongan?: number;
    notes?: string;
}

export interface SuratJalanDocument {
    _id: string;
    _type: 'suratJalan';
    sourceDeliveryOrderRef: string;
    tripRef: string;
    tripNumber: string;
    orderRef?: string;
    masterResi?: string;
    customerRef?: string;
    customerName?: string;
    referenceKey?: string;
    suratJalanNumber: string;
    pickupAddress?: string;
    receiverName?: string;
    receiverCompany?: string;
    receiverAddress?: string;
    tripOriginArea?: string;
    tripDestinationArea?: string;
    tripDate?: string;
    tripStatus?: TripStatus;
    vehiclePlate?: string;
    driverName?: string;
    itemCount: number;
    cargoSummary: CargoSummary;
    billableCargo: CargoSummary;
    holdCargo: CargoSummary;
    returnCargo: CargoSummary;
    actualDropPoints?: DeliveryActualDropPoint[];
}

export interface SuratJalanRecord {
    _id: string;
    _type: 'suratJalan';
    tripRef: string;
    deliveryOrderRef?: string;
    orderRef?: string;
    customerRef?: string;
    customerName?: string;
    referenceKey?: string;
    suratJalanNumber: string;
    pickupAddress?: string;
    receiverName?: string;
    receiverCompany?: string;
    receiverAddress?: string;
    tripDate?: string;
    tripStatus?: TripStatus;
    vehiclePlate?: string;
    driverName?: string;
    itemCount: number;
    cargoSummary: CargoSummary;
    billableCargo: CargoSummary;
    holdCargo: CargoSummary;
    returnCargo: CargoSummary;
    /**
     * Ditandai saat customer + drop point SJ ini diedit setelah status DELIVERED.
     * Snapshot original hanya diisi pada edit pertama dan tidak pernah ditimpa.
     */
    editedAfterDelivery?: boolean;
    originalSJCustomerDrop?: {
        customerRef?: string;
        customerName?: string;
        dropPointName?: string;
        /** Nomor SJ sebelum diedit, supaya perubahan nomor tetap bisa ditelusuri. */
        suratJalanNumber?: string;
        editedAt?: string;
        editedBy?: string;
    };
}

export interface SuratJalanItemRecord {
    _id: string;
    _type: 'suratJalanItem';
    suratJalanRef: string;
    tripRef: string;
    deliveryOrderItemRef?: string;
    referenceKey?: string;
    suratJalanNumber: string;
    orderItemDescription?: string;
    plannedCargo: CargoSummary;
    actualCargo: CargoSummary;
}

export interface SuratJalanDocumentItem {
    _id: string;
    _type: 'suratJalanItem';
    suratJalanRef: string;
    tripRef: string;
    sourceDeliveryOrderItemRef: string;
    referenceKey?: string;
    suratJalanNumber: string;
    orderItemDescription?: string;
    plannedCargo: CargoSummary;
    actualCargo: CargoSummary;
}

export interface TripTrackingEvent {
    _id: string;
    _type: 'tripTrackingEvent';
    tripRef: string;
    sourceTrackingLogRef: string;
    status: string;
    note?: string;
    locationText?: string;
    timestamp: string;
    userRef?: string;
    userName?: string;
    latitude?: number;
    longitude?: number;
    accuracyM?: number;
    speedKph?: number;
    source?: 'ADMIN_PANEL' | 'DRIVER_APP';
}

export interface TripDetailSnapshot {
    _id: string;
    _type: 'tripDetail';
    trip: Trip | null;
    deliveryOrder: DeliveryOrder | null;
    sourceOrder: Order | null;
    deliveryOrderItems: DeliveryOrderItem[];
    suratJalanDocuments: SuratJalanDocument[];
    trackingEvents: TripTrackingEvent[];
    linkedVoucher: DriverVoucher | null;
    tripCashLink: TripCashLinkSummary | null;
}

export interface SuratJalanDetailSnapshot {
    _id: string;
    _type: 'suratJalanDetail';
    suratJalanDocument: SuratJalanDocument | null;
    trip: Trip | null;
    deliveryOrder: DeliveryOrder | null;
    sourceOrder: Order | null;
    documentItems: SuratJalanDocumentItem[];
}

export interface TripCashLinkSummary {
    hasVoucher: true;
    voucherId: string;
    bonNumber: string;
    status: DriverVoucher['status'];
    issuedDate?: string;
}

export interface TripDetailReferencesSnapshot {
    _id: string;
    _type: 'tripDetailReferences';
    customerData: Pick<Customer, 'deliveryOrderPrefix'> | null;
    billingCustomers: Array<Pick<Customer, '_id' | 'name' | 'active'>>;
    customerProducts: CustomerProduct[];
    customerRecipients: CustomerRecipient[];
    tripRouteRates: TripRouteRate[];
}

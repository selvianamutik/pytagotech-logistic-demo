/* ============================================================
   LOGISTIK — Type Definitions
   ============================================================ */

// ── Roles & Auth ──
import type { VolumeInputUnit, WeightInputUnit } from './measurement';

export type UserRole = 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER' | 'ADMIN';
export type ModuleAction = 'view' | 'create' | 'update' | 'delete' | 'export' | 'print';
export type ModulePermissions = Record<ModuleAction, boolean>;
export type PerUserModulePermissions = Partial<Record<string, boolean>>;
export type TireAxleLayoutMode = 'NONE' | 'SINGLE' | 'DUAL';

export interface TireLayoutConfig {
  axleLayouts: TireAxleLayoutMode[];
  spareCount: number;
}

export interface User {
  _id: string;
  _type: 'user';
  name: string;
  email: string;
  role: UserRole;
  driverRef?: string;
  driverName?: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
  modulePermissions?: PerUserModulePermissions;
}

export interface SessionUser {
  _id: string;
  name: string;
  email: string;
  role: UserRole;
  driverRef?: string;
  driverName?: string;
  modulePermissions?: PerUserModulePermissions;
}

export interface Employee {
  _id: string;
  _type: 'employee';
  employeeCode: string;
  name: string;
  phone?: string;
  position?: string;
  division?: string;
  joinDate?: string;
  active: boolean;
  userRef?: string;
  userName?: string;
  notes?: string;
}

export type EmployeeAttendanceStatus =
  | 'HADIR'
  | 'PULANG_LEBIH_AWAL'
  | 'IZIN'
  | 'SAKIT'
  | 'CUTI'
  | 'ALPHA'
  | 'LIBUR';

export interface EmployeeAttendanceRecord {
  _id: string;
  _type: 'employeeAttendanceRecord';
  employeeRef: string;
  employeeCode?: string;
  employeeName?: string;
  position?: string;
  division?: string;
  date: string;
  status: EmployeeAttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── Company Profile ──
export interface CompanyProfile {
  _id: string;
  _type: 'companyProfile';
  name: string;
  address: string;
  phone: string;
  email: string;
  npwp?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  logoUrl?: string;
  themeColor?: string;
  secondaryThemeColor?: string;
  headerStampUrl?: string;
  signatureStampUrl?: string;
  numberingSettings: {
    resiPrefix: string;
    resiCounter: number;
    resiPeriod?: string;
    doPrefix: string;
    doCounter: number;
    doPeriod?: string;
    invoicePrefix: string;
    invoiceCounter: number;
    invoicePeriod?: string;
    notaPrefix?: string;
    notaCounter?: number;
    notaPeriod?: string;
    notaSeriesCode?: string;
    receiptPrefix?: string;
    receiptCounter?: number;
    receiptPeriod?: string;
    boronganPrefix?: string;
    boronganCounter?: number;
    boronganPeriod?: string;
    bonPrefix?: string;
    bonCounter?: number;
    bonPeriod?: string;
    incidentPrefix: string;
    incidentCounter: number;
    incidentPeriod?: string;
  };
  invoiceSettings: {
    defaultTermDays: number;
    dueDateDays: number;
    footerNote: string;
    invoiceMode: 'ORDER' | 'DO';
    invoiceBankAccountRefs?: string[];
    defaultInvoiceBankAccountRef?: string;
  };
  documentSettings: {
    showContact: boolean;
    dateFormat: string;
  };
}

// ── Customer ──
export interface Customer {
  _id: string;
  _type: 'customer';
  name: string;
  address: string;
  contactPerson: string;
  phone: string;
  email: string;
  defaultPaymentTerm: number;
  creditLimitAmount?: number;
  npwp?: string;
  deliveryOrderPrefix?: string;
  deliveryOrderCounter?: number;
  deliveryOrderPeriod?: string;
  defaultFreightNotaBillingMode?: FreightNotaBillingMode;
  defaultPph23Enabled?: boolean;
  defaultPph23RatePercent?: number;
  defaultPph23BaseMode?: Pph23BaseMode;
  active: boolean;
}

export interface CustomerProduct {
  _id: string;
  _type: 'customerProduct';
  customerRef: string;
  customerName?: string;
  code?: string;
  name: string;
  description?: string;
  defaultQtyKoli?: number;
  defaultWeight?: number;
  defaultWeightInputValue?: number;
  defaultWeightInputUnit?: WeightInputUnit;
  defaultVolume?: number;
  defaultVolumeInputValue?: number;
  defaultVolumeInputUnit?: VolumeInputUnit;
  notes?: string;
  active: boolean;
}

export interface CustomerRecipient {
  _id: string;
  _type: 'customerRecipient';
  customerRef: string;
  customerName?: string;
  label: string;
  receiverName: string;
  receiverPhone?: string;
  receiverAddress: string;
  receiverCompany?: string;
  notes?: string;
  active: boolean;
  isDefault?: boolean;
}

export interface CustomerPickupLocation {
  _id: string;
  _type: 'customerPickupLocation';
  customerRef: string;
  customerName?: string;
  label: string;
  pickupAddress: string;
  notes?: string;
  active: boolean;
  isDefault?: boolean;
}

export type CustomerBillingRateBasis = 'PER_KG' | 'PER_TON' | 'PER_VOLUME' | 'PER_TRIP';

export interface CustomerBillingRate {
  _id: string;
  _type: 'customerBillingRate';
  customerRef: string;
  customerName?: string;
  serviceRef?: string;
  serviceName?: string;
  basis: CustomerBillingRateBasis;
  rate: number;
  routeFrom?: string;
  routeTo?: string;
  notes?: string;
  active: boolean;
}

export interface OrderPickupStop {
  _key?: string;
  sequence: number;
  customerPickupRef?: string;
  pickupLabel?: string;
  pickupAddress: string;
  notes?: string;
}

export interface OrderTripPlan {
  _key?: string;
  sequence: number;
  pickupStopKeys?: string[];
  vehicleRef: string;
  vehiclePlate?: string;
  vehicleServiceRef?: string;
  vehicleServiceName?: string;
  vehicleCategoryOverrideReason?: string;
  driverRef: string;
  driverName?: string;
  tripRouteRateRef?: string;
  tripOriginArea?: string;
  tripDestinationArea?: string;
  taripBorongan?: number;
  issueBankRef: string;
  issueBankName?: string;
  cashGiven: number;
  date: string;
  notes?: string;
  linkedDeliveryOrderRef?: string;
  linkedDeliveryOrderNumber?: string;
}

export interface DeliveryOrderPickupStop {
  _key?: string;
  sequence: number;
  orderPickupStopKey?: string;
  customerPickupRef?: string;
  pickupLabel?: string;
  pickupAddress: string;
  notes?: string;
}

export interface DeliveryOrderShipperReference {
  _key?: string;
  sequence: number;
  referenceNumber: string;
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
}

// ── Supplier & Inventory ──
export interface Supplier {
  _id: string;
  _type: 'supplier';
  supplierCode: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  defaultTermDays?: number;
  active: boolean;
  notes?: string;
}

export type InventoryUnit =
  | 'PCS'
  | 'UNIT'
  | 'BOX'
  | 'SET'
  | 'ROLL'
  | 'KG'
  | 'LITER'
  | 'METER';

export type WarehouseItemTrackingMode = 'STANDARD' | 'TIRE_ASSET';
export type TireType = 'ORI benang / nilon' | 'ORI kawat / radial' | 'kanisir';

export interface WarehouseItem {
  _id: string;
  _type: 'warehouseItem';
  itemCode: string;
  name: string;
  category?: string;
  unit: InventoryUnit;
  trackingMode?: WarehouseItemTrackingMode;
  minStockQty?: number;
  currentStockQty?: number;
  defaultSupplierRef?: string;
  defaultSupplierName?: string;
  defaultPurchasePrice?: number;
  tireTypeDefault?: TireType;
  tireBrandDefault?: string;
  tireSizeDefault?: string;
  active: boolean;
  notes?: string;
}

export interface SupplierItemPrice {
  _id: string;
  _type: 'supplierItemPrice';
  supplierRef: string;
  supplierCode?: string;
  supplierName?: string;
  warehouseItemRef: string;
  itemCode?: string;
  itemName?: string;
  itemUnit?: InventoryUnit;
  supplierSku?: string;
  supplierItemName?: string;
  defaultPurchasePrice: number;
  minOrderQty?: number;
  leadTimeDays?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
  active: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PurchaseStatus =
  | 'ORDERED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

export interface Purchase {
  _id: string;
  _type: 'purchase';
  purchaseNumber: string;
  supplierRef: string;
  supplierName?: string;
  orderDate: string;
  dueDate?: string;
  status: PurchaseStatus;
  notes?: string;
  totalAmount?: number;
  totalOrderedQty?: number;
  totalReceivedQty?: number;
  paidAmount?: number;
  outstandingAmount?: number;
  lineCount?: number;
  lastReceivedAt?: string;
  lastPaidAt?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseItem {
  _id: string;
  _type: 'purchaseItem';
  purchaseRef: string;
  warehouseItemRef: string;
  supplierItemPriceRef?: string;
  itemCode?: string;
  itemName?: string;
  itemUnit?: InventoryUnit;
  trackingMode?: WarehouseItemTrackingMode;
  tireTypeDefault?: TireType;
  tireBrandDefault?: string;
  tireSizeDefault?: string;
  orderedQty: number;
  receivedQty?: number;
  unitPrice: number;
  subtotal: number;
  priceSource?: 'SUPPLIER_PRICE' | 'WAREHOUSE_DEFAULT' | 'MANUAL';
  priceEffectiveDate?: string;
  originalUnitPrice?: number;
  priceOverridden?: boolean;
  priceOverrideReason?: string;
  notes?: string;
}

export interface PurchasePayment {
  _id: string;
  _type: 'purchasePayment';
  purchaseRef: string;
  purchaseNumber?: string;
  supplierRef?: string;
  supplierName?: string;
  date: string;
  amount: number;
  bankAccountRef: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankTransactionRef?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
}

export type StockMovementType = 'IN' | 'OUT' | 'ADJUSTMENT';
export type StockMovementSourceType =
  | 'PURCHASE_RECEIPT'
  | 'MANUAL_IN'
  | 'MANUAL_OUT'
  | 'ADJUSTMENT'
  | 'MAINTENANCE_USAGE'
  | 'TIRE_DEPLOYMENT'
  | 'TIRE_RETURN';
export type StockMovementCostMethod =
  | 'PURCHASE_PRICE'
  | 'MOVING_AVERAGE'
  | 'WAREHOUSE_DEFAULT'
  | 'MANUAL'
  | 'TIRE_ASSET'
  | 'NONE';

export interface StockMovement {
  _id: string;
  _type: 'stockMovement';
  warehouseItemRef: string;
  itemCode?: string;
  itemName?: string;
  unit?: InventoryUnit;
  movementDate: string;
  type: StockMovementType;
  sourceType: StockMovementSourceType;
  sourceRef?: string;
  sourceNumber?: string;
  quantity: number;
  balanceAfter?: number;
  unitCostSnapshot?: number;
  subtotalCost?: number;
  costMethod?: StockMovementCostMethod;
  note?: string;
  createdBy?: string;
  createdByName?: string;
}

export interface TripRouteRate {
  _id: string;
  _type: 'tripRouteRate';
  originArea: string;
  destinationArea: string;
  serviceRef?: string;
  serviceName?: string;
  rate: number;
  overtonaseDriverRatePerTon?: number;
  notes?: string;
  active: boolean;
}

// ── Service ──
export interface Service {
  _id: string;
  _type: 'service';
  code: string;
  name: string;
  description: string;
  maxPayloadKg?: number;
  oilMaintenanceKm?: number;
  tireLayoutConfig?: TireLayoutConfig;
  active: boolean;
}

// ── Expense Category ──
export interface ExpenseCategory {
  _id: string;
  _type: 'expenseCategory';
  name: string;
  scope?: 'GENERAL' | 'TRIP' | 'MAINTENANCE' | 'INCIDENT' | 'DRIVER_FEE';
  allowManual?: boolean;
  accountSystemKey?: string;
  sortOrder?: number;
  active: boolean;
}

// ── Driver ──
export interface Driver {
    _id: string;
    _type: 'driver';
    _rev?: string;
    name: string;
    phone: string;
    licenseNumber: string;
    ktpNumber?: string;
    simExpiry?: string;
    address?: string;
    active: boolean;
    activeTrackingDeliveryOrderRef?: string;
    activeTrackingUpdatedAt?: string;
}

export interface DriverScore {
    _id: string;
    _type: 'driverScore';
    driverRef: string;
    driverName?: string;
    scoreType: 'WARNING' | 'DAYS';
    effectiveDate: string;
    durationDays: number;
    dueDate: string;
    notes?: string;
    warningAcknowledgedAt?: string;
    warningAcknowledgedByDriverRef?: string;
    createdAt: string;
    createdBy?: string;
    createdByName?: string;
    updatedAt?: string;
    updatedBy?: string;
    updatedByName?: string;
}

// ── Driver Voucher (Bon Supir) ──
export type DriverVoucherStatus = 'DRAFT' | 'ISSUED' | 'SETTLED';

export interface DriverVoucher {
  _id: string;
  _type: 'driverVoucher';
  bonNumber: string;
  issuerCompanyName?: string;
  issuerCompanyAddress?: string;
  issuerCompanyPhone?: string;
  issuerCompanyEmail?: string;
  issuerCompanyLogoUrl?: string;
  driverRef: string;
  driverName?: string;
  deliveryOrderRef?: string;
  doNumber?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  route?: string;
  issuedDate: string;
  cashGiven: number;
  initialCashGiven?: number;
  totalIssuedAmount?: number;
  topUpCount?: number;
  driverFeeAmount?: number;
  totalClaimAmount?: number;
  issueBankRef?: string;
  issueBankName?: string;
  totalSpent: number;
  balance: number;
  status: DriverVoucherStatus;
  notes?: string;
  settledDate?: string;
  settledBy?: string;
  settledByName?: string;
  settlementBankRef?: string;
  settlementBankName?: string;
}

export type DriverVoucherDisbursementKind = 'INITIAL' | 'TOP_UP';
export type DriverVoucherDisbursementStatus = 'ACTIVE' | 'VOID';

export interface DriverVoucherDisbursement {
  _id: string;
  _type: 'driverVoucherDisbursement';
  _createdAt?: string;
  createdAt?: string;
  voucherRef: string;
  date: string;
  amount: number;
  kind: DriverVoucherDisbursementKind;
  bankAccountRef?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankTransactionRef?: string;
  note?: string;
  status?: DriverVoucherDisbursementStatus;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
  reversalBankTransactionRef?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  replacedBankTransactionRef?: string;
  adjustmentBankTransactionRef?: string;
  createdBy?: string;
  createdByName?: string;
}

export interface DriverVoucherItem {
  _id: string;
  _type: 'driverVoucherItem';
  voucherRef: string;
  expenseDate?: string;
  category: string;
  description: string;
  amount: number;
  relatedIncidentRef?: string;
  relatedIncidentSettlementLineRef?: string;
  linkedExpenseRef?: string;
  source?: 'MANUAL' | 'INCIDENT';
}

// ── Order ──
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'COMPLETE' | 'ON_HOLD' | 'CANCELLED';
export type OrderItemStatus = 'PENDING' | 'ASSIGNED' | 'ON_DELIVERY' | 'PARTIAL' | 'DELIVERED' | 'HOLD' | 'RETURNED';

export interface Order {
  _id: string;
  _type: 'order';
  masterResi: string;
  cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
  customerRef: string;
  customerName?: string;
  customerRecipientRef?: string;
  customerPickupRef?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  receiverCompany?: string;
  pickupAddress?: string;
  pickupStops?: OrderPickupStop[];
  tripPlans?: OrderTripPlan[];
  serviceRef: string;
  serviceName?: string;
  status: OrderStatus;
  notes?: string;
  createdAt: string;
  createdBy: string;
}

export interface OrderItem {
  _id: string;
  _type: 'orderItem';
  orderRef: string;
  entrySource?: 'ORDER' | 'DELIVERY_ORDER';
  sourceDeliveryOrderRef?: string;
  sourceDeliveryOrderNumber?: string;
  customerProductRef?: string;
  customerProductCode?: string;
  customerProductName?: string;
  description: string;
  qtyKoli: number;
  weight: number;
  volume?: number;
  weightInputValue?: number;
  weightInputUnit?: WeightInputUnit;
  volumeInputValue?: number;
  volumeInputUnit?: VolumeInputUnit;
  value?: number;
  deliveredQtyKoli?: number;
  deliveredWeight?: number;
  deliveredVolume?: number;
  assignedQtyKoli?: number;
  assignedWeight?: number;
  assignedVolume?: number;
  heldQtyKoli?: number;
  heldWeight?: number;
  heldVolume?: number;
  holdReason?: string;
  holdLocation?: string;
  status: OrderItemStatus;
}

// ── Delivery Order ──
export type DOStatus =
    | 'CREATED'
    | 'ON_DELIVERY'
    | 'ARRIVED'
    | 'PARTIAL_HOLD'
    | 'DELIVERED'
    | 'CANCELLED';

export type DeliveryActualDropType =
  | 'DROP'
  | 'HOLD'
  | 'TRANSIT'
  | 'EXTRA_DROP'
  | 'RETURN';

export interface DeliveryActualDropPoint {
  _key?: string;
  sequence: number;
  stopType: DeliveryActualDropType;
  deliveryOrderItemRef?: string;
  deliveryOrderItemRefs?: string[];
  actualDropGroupKey?: string;
  shipperReferenceKey?: string;
  shipperReferenceNumber?: string;
  billingCustomerRef?: string;
  billingCustomerName?: string;
  originLocationName?: string;
  originLocationAddress?: string;
  locationName: string;
  locationAddress?: string;
  qtyKoli?: number;
  weightKg?: number;
  weightInputValue?: number;
  weightInputUnit?: WeightInputUnit;
  volumeM3?: number;
  volumeInputValue?: number;
  volumeInputUnit?: VolumeInputUnit;
  podReceiverName?: string;
  podReceivedDate?: string;
  podNote?: string;
  note?: string;
}

export interface PendingDriverActualCargoItem {
  deliveryOrderItemRef: string;
  actualQtyKoli?: number;
  actualWeightInputValue?: number;
  actualWeightInputUnit?: WeightInputUnit;
  actualVolumeInputValue?: number;
  actualVolumeInputUnit?: VolumeInputUnit;
}

export interface DeliveryOrder {
  _id: string;
  _type: 'deliveryOrder';
  doNumber: string;
  issuerCompanyName?: string;
  issuerCompanyAddress?: string;
  issuerCompanyPhone?: string;
  issuerCompanyEmail?: string;
  issuerCompanyLogoUrl?: string;
  customerDoPrefix?: string;
  customerDoSequence?: number;
  customerDoPeriod?: string;
  customerDoNumber?: string;
  orderRef: string;
  masterResi?: string;
  customerRef?: string;
  vehicleRef?: string;
  vehiclePlate?: string;
  driverRef?: string;
  driverName?: string;
  date: string;
  status: DOStatus;
  notes?: string;
  podReceiverName?: string;
  podReceivedDate?: string;
  podNote?: string;
  podImageUrl?: string;
  customerName?: string;
  receiverName?: string;
  receiverPhone?: string;
  receiverAddress?: string;
  receiverCompany?: string;
  pickupAddress?: string;
  pickupStops?: DeliveryOrderPickupStop[];
  shipperReferences?: DeliveryOrderShipperReference[];
  serviceRef?: string;
  serviceName?: string;
  vehicleServiceRef?: string;
  vehicleServiceName?: string;
  vehicleCategoryOverrideReason?: string;
  tripRouteRateRef?: string;
  tripOriginArea?: string;
  tripDestinationArea?: string;
  orderTripPlanKey?: string;
  plannedTripIssueBankRef?: string;
  plannedTripIssueBankName?: string;
  plannedTripCashGiven?: number;
  baseTaripBorongan?: number;
  taripBorongan?: number;       // Tarif upah supir per DO/perjalanan
  keteranganBorongan?: string;  // Keterangan upah borongan
  actualTotalWeightKg?: number;
  serviceMaxPayloadKg?: number;
  vehicleCapacityKg?: number;
  manualOvertonaseWeightKg?: number;
  overtonaseWeightKg?: number;
  overtonaseDriverRatePerKg?: number;
  overtonaseDriverAmount?: number;
  vehicleCapacityExceededKg?: number;
  trackingState?: 'IDLE' | 'ACTIVE' | 'PAUSED' | 'STOPPED';
  trackingStartedAt?: string;
  trackingStoppedAt?: string;
  trackingLastSeenAt?: string;
  trackingLastLat?: number;
  trackingLastLng?: number;
  trackingLastAccuracyM?: number;
  trackingLastSpeedKph?: number;
  trackingLastSource?: 'DRIVER_APP';
  pendingDriverStatus?: DOStatus;
  tripClosedByAdminAt?: string;
  tripClosedByAdminRef?: string;
  tripClosedByAdminName?: string;
  tripStartOdometerKm?: number;
  tripEndOdometerKm?: number;
  tripDistanceKm?: number;
  odometerConfirmedAt?: string;
  odometerConfirmedByRef?: string;
  odometerConfirmedByName?: string;
  pendingDriverStatusRequestedAt?: string;
  pendingDriverStatusRequestedBy?: string;
  pendingDriverStatusRequestedByName?: string;
  pendingDriverStatusNote?: string;
  pendingDriverStatusSuratJalanRefs?: string[];
  pendingDriverPodReceiverName?: string;
  pendingDriverPodReceivedDate?: string;
  pendingDriverPodNote?: string;
  pendingDriverActualCargoItems?: PendingDriverActualCargoItem[];
  pendingDriverActualDropPoints?: DeliveryActualDropPoint[];
  pendingDriverRequests?: PendingDriverStatusRequest[];
  cargoFinalizedAt?: string;
  cargoFinalizedBy?: string;
  cargoFinalizedByName?: string;
  actualDropPoints?: DeliveryActualDropPoint[];
}

export interface PendingDriverStatusRequest {
  requestId: string;
  status: DOStatus;
  requestedAt?: string;
  requestedBy?: string;
  requestedByName?: string;
  note?: string;
  targetSuratJalanRefs?: string[];
  podReceiverName?: string;
  podReceivedDate?: string;
  podNote?: string;
  actualCargoItems?: PendingDriverActualCargoItem[];
  actualDropPoints?: DeliveryActualDropPoint[];
  tripEndOdometerKm?: number;
  closeTripOnly?: boolean;
}

export interface DeliveryOrderItem {
  _id: string;
  _type: 'deliveryOrderItem';
  deliveryOrderRef: string;
  orderItemRef: string;
  pickupStopKey?: string;
  pickupAddress?: string;
  shipperReferenceKey?: string;
  shipperReferenceNumber?: string;
  orderItemDescription?: string;
  orderItemQtyKoli?: number;
  orderItemWeight?: number;
  orderItemVolumeM3?: number;
  orderItemWeightInputValue?: number;
  orderItemWeightInputUnit?: WeightInputUnit;
  orderItemVolumeInputValue?: number;
  orderItemVolumeInputUnit?: VolumeInputUnit;
  heldQtyKoli?: number;
  heldWeight?: number;
  heldVolume?: number;
  shippedQtyKoli?: number;
  shippedWeight?: number;
  actualQtyKoli?: number;
  actualWeightKg?: number;
  actualVolumeM3?: number;
  actualWeightInputValue?: number;
  actualWeightInputUnit?: WeightInputUnit;
  actualVolumeInputValue?: number;
  actualVolumeInputUnit?: VolumeInputUnit;
}

// ── Tracking Log ──
export interface TrackingLog {
  _id: string;
  _type: 'trackingLog';
  refType: 'DO' | 'ORDER';
  refRef: string;
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

// ── Freight Invoice (Invoice Ongkos Angkut) ──
export type NotaStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'VOID';

export interface FreightNotaInstructionAccount {
  bankAccountRef?: string;
  bankName: string;
  accountNumber?: string;
  accountHolder?: string;
}

export type FreightNotaBillingMode = CustomerBillingRateBasis;
export type Pph23BaseMode = 'BEFORE_CLAIM' | 'AFTER_CLAIM';

export interface FreightNota {
  _id: string;
  _type: 'freightNota';
  notaNumber: string;
  notaDisplayNumber?: string;
  issuerCompanyName?: string;
  issuerCompanyAddress?: string;
  issuerCompanyPhone?: string;
  issuerCompanyEmail?: string;
  issuerCompanyLogoUrl?: string;
  issuerCompanySignatureStampUrl?: string;
  issuerCompanySignatureName?: string;
  issuerCompanyNpwp?: string;
  customerRef?: string;
  customerName: string;
  customerAddress?: string;
  customerContactPerson?: string;
  customerPhone?: string;
  issueDate: string;
  dueDate?: string;
  taxInvoiceNumber?: string;
  status: NotaStatus;
  totalAmount: number;
  totalAdjustmentAmount?: number;
  pph23Enabled?: boolean;
  pph23RatePercent?: number;
  pph23BaseMode?: Pph23BaseMode;
  pph23BaseAmount?: number;
  pph23Amount?: number;
  netAmount?: number;
  totalPaidEffective?: number;
  refundedOverpaymentAmount?: number;
  openOverpaymentAmount?: number;
  totalCollie: number;
  totalWeightKg: number;
  totalVolumeM3?: number;
  billingMode?: FreightNotaBillingMode;
  bankAccountRef?: string;
  instructionAccounts?: FreightNotaInstructionAccount[];
  footerNote?: string;
  notes?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

export interface FreightNotaItem {
  _id: string;
  _type: 'freightNotaItem';
  notaRef: string;
  doRef?: string;
  deliveryOrderItemRef?: string;
  deliveryOrderItemRefs?: string[];
  actualDropPointKey?: string;
  customerRef?: string;
  customerName?: string;
  doNumber?: string;
  vehiclePlate?: string;
  date: string;
  noSJ: string;
  dari: string;
  tujuan: string;
  barang?: string;
  collie?: number;
  beratKg: number;
  volumeM3?: number;
  tarip: number;
  taripSource?: 'MASTER' | 'MANUAL';
  customerBillingRateRef?: string;
  customerBillingRateName?: string;
  customerBillingRateSnapshot?: number;
  uangRp: number;
  ket?: string;
  plt?: string;
  pc?: string;
  kbl?: string;
  invoiceLineDate?: string;
  status?: 'ACTIVE' | 'VOID';
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

// ── Driver Borongan (Slip Upah Supir) ──
export type BoronganStatus = 'UNPAID' | 'PAID';

export interface DriverBorongan {
  _id: string;
  _type: 'driverBorongan';
  boronganNumber: string;
  issuerCompanyName?: string;
  issuerCompanyAddress?: string;
  issuerCompanyPhone?: string;
  issuerCompanyEmail?: string;
  issuerCompanyLogoUrl?: string;
  driverRef?: string;
  driverName: string;
  periodStart: string;
  periodEnd: string;
  status: BoronganStatus;
  totalAmount: number;
  totalCollie: number;
  totalWeightKg: number;
  notes?: string;
  paidDate?: string;
  paidMethod?: PaymentMethod;
  paidBankRef?: string;
  paidBankName?: string;
  paidBankNumber?: string;
}

export interface DriverBoronganItem {
  _id: string;
  _type: 'driverBoronganItem';
  boronganRef: string;
  doRef?: string;
  doNumber?: string;
  vehiclePlate?: string;
  date: string;
  noSJ: string;
  tujuan: string;
  barang?: string;
  collie?: number;
  beratKg: number;
  tarip: number;
  uangRp: number;
  ket?: string;
}

// ── Invoice (legacy, kept for existing data) ──
export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface Invoice {
  _id: string;
  _type: 'invoice';
  invoiceNumber: string;
  mode: 'ORDER' | 'DO';
  orderRef?: string;
  doRef?: string;
  customerRef?: string;
  customerName?: string;
  masterResi?: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalAmount: number;
  totalAdjustmentAmount?: number;
  pph23Enabled?: boolean;
  pph23RatePercent?: number;
  pph23BaseMode?: Pph23BaseMode;
  pph23BaseAmount?: number;
  pph23Amount?: number;
  netAmount?: number;
  notes?: string;
}

export interface InvoiceItem {
  _id: string;
  _type: 'invoiceItem';
  invoiceRef: string;
  description: string;
  qty?: number;
  price: number;
  subtotal: number;
}

// ── Payment ──
export type PaymentMethod = 'TRANSFER' | 'CASH' | 'OTHER';

export interface Payment {
  _id: string;
  _type: 'payment';
  invoiceRef: string;
  receiptRef?: string;
  receiptNumber?: string;
  bankAccountRef?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
  attachmentUrl?: string;
  editedAt?: string;
  editedBy?: string;
  editedByName?: string;
  reversalBankTransactionRef?: string;
  replacementBankTransactionRef?: string;
}

export interface CustomerReceipt {
  _id: string;
  _type: 'customerReceipt';
  receiptNumber: string;
  customerRef?: string;
  customerName: string;
  date: string;
  totalAmount: number;
  allocatedAmount?: number;
  unappliedAmount?: number;
  refundedOverpaymentAmount?: number;
  openOverpaymentAmount?: number;
  overpaymentStatus?: CustomerOverpaymentStatus;
  allocationCount: number;
  method: PaymentMethod;
  bankAccountRef?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  note?: string;
}

export type InvoiceAdjustmentKind =
  | 'DAMAGE_CLAIM'
  | 'SHORTAGE_CLAIM'
  | 'DISCOUNT'
  | 'PENALTY'
  | 'OTHER';

export type InvoiceAdjustmentStatus = 'APPROVED' | 'VOID';

export interface InvoiceAdjustment {
  _id: string;
  _type: 'invoiceAdjustment';
  invoiceRef: string;
  customerRef?: string;
  customerName?: string;
  date: string;
  amount: number;
  kind: InvoiceAdjustmentKind;
  status: InvoiceAdjustmentStatus;
  note?: string;
  createdBy?: string;
  createdByName?: string;
  editedAt?: string;
  editedBy?: string;
  editedByName?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
}

export type CustomerOverpaymentSourceType = 'RECEIPT_UNAPPLIED' | 'INVOICE_OVERPAID';
export type CustomerOverpaymentStatus = 'OPEN' | 'REFUNDED';

export interface CustomerOverpayment {
  _id: string;
  _type: 'customerOverpayment';
  sourceType: CustomerOverpaymentSourceType;
  status: CustomerOverpaymentStatus;
  customerRef?: string;
  customerName: string;
  sourceReceiptRef?: string;
  sourceReceiptNumber?: string;
  sourceInvoiceRef?: string;
  sourceInvoiceNumber?: string;
  detectedDate: string;
  amount: number;
  refundedAmount: number;
  remainingAmount: number;
  sourceLabel: string;
  sourceDescription: string;
}

export interface CustomerOverpaymentRefund {
  _id: string;
  _type: 'customerOverpaymentRefund';
  sourceType: CustomerOverpaymentSourceType;
  sourceReceiptRef?: string;
  sourceReceiptNumber?: string;
  sourceInvoiceRef?: string;
  sourceInvoiceNumber?: string;
  customerRef?: string;
  customerName?: string;
  date: string;
  amount: number;
  bankAccountRef: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankTransactionRef?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
}

// ── Income ──
export interface Income {
  _id: string;
  _type: 'income';
  sourceType: 'INVOICE_PAYMENT' | 'CUSTOMER_RECEIPT' | 'OTHER';
  paymentRef?: string;
  receiptRef?: string;
  date: string;
  amount: number;
  note?: string;
}

// ── Expense ──
export type PrivacyLevel = 'internal' | 'ownerOnly';

export interface Expense {
  _id: string;
  _type: 'expense';
  _rev?: string;
  categoryRef: string;
  categoryName?: string;
  categoryScope?: ExpenseCategory['scope'];
  accountSystemKey?: string;
  date: string;
  amount: number;
  note?: string;
  description?: string;
  receiptUrl?: string;
  privacyLevel: PrivacyLevel;
  bankAccountRef?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  relatedVehicleRef?: string;
  relatedVehiclePlate?: string;
  relatedIncidentRef?: string;
  relatedIncidentSettlementLineRef?: string;
  incidentExpenseRoute?: IncidentExpenseRoute;
  relatedMaintenanceRef?: string;
  relatedOrderRef?: string;
  relatedOrderNumber?: string;
  relatedDeliveryOrderRef?: string;
  relatedDeliveryOrderNumber?: string;
  boronganRef?: string;
  voucherRef?: string;
}

// ── Vehicle ──
export type VehicleStatus = 'ACTIVE' | 'IN_SERVICE' | 'OUT_OF_SERVICE' | 'SOLD';

export type VehicleOwnershipType = 'COMPANY' | 'PARTNER';

export interface Vehicle {
  _id: string;
  _type: 'vehicle';
  unitCode: string;
  plateNumber: string;
  vehicleType: string;
  brandModel: string;
  size?: string;
  dimension?: string;
  capacityMin?: string;
  capacityMax?: string;
  year: number;
  capacityKg?: number;
  capacityVolume?: number;
  serviceRef?: string;
  serviceName?: string;
  tireLayoutConfig?: TireLayoutConfig;
  chassisNumber?: string;   // ownerOnly
  engineNumber?: string;    // ownerOnly
  status: VehicleStatus;
  base?: string;
  registeredDate?: string;
  ownershipType?: VehicleOwnershipType;
  partnerOwnerName?: string;
  partnerOwnerPhone?: string;
  partnerNotes?: string;
  vehiclePhotoUrl?: string;
  notes?: string;
  lastOdometer?: number;
  lastOdometerAt?: string;
  oilMaintenanceIntervalKm?: number;
  oilLastServiceOdometer?: number;
  oilNextServiceOdometer?: number;
  oilServiceRemainingKm?: number;
  oilMaintenanceStatus?: 'OK' | 'DUE_SOON' | 'DUE';
  lastTripOdometerDeltaKm?: number;
}

// ── Maintenance ──
export type MaintenanceStatus = 'SCHEDULED' | 'DONE' | 'SKIPPED';
export type ScheduleType = 'DATE' | 'ODOMETER';
export type MaintenanceMaterialAttachmentStatus = 'CONSUMED' | 'INSTALLED';
export type MaintenanceMaterialSourceType = 'WAREHOUSE_STOCK' | 'DIRECT_PURCHASE';

export interface MaintenanceMaterialUsage {
  warehouseItemRef: string;
  sourceType?: MaintenanceMaterialSourceType;
  itemCode?: string;
  itemName?: string;
  category?: string;
  unit: InventoryUnit;
  quantity: number;
  unitCostSnapshot?: number;
  subtotalCost?: number;
  costAlreadyPosted?: boolean;
  stockMovementRef?: string;
  linkedWarehouseItemRef?: string;
  linkedWarehouseItemCode?: string;
  linkedWarehouseItemName?: string;
  relatedIncidentRef?: string;
  relatedIncidentSettlementLineRef?: string;
  relatedIncidentExpenseRef?: string;
  directPurchaseVendor?: string;
  directPurchaseRoute?: IncidentExpenseRoute;
  enteredInventoryWarehouseItemRef?: string;
  enteredInventoryStockMovementRef?: string;
  enteredInventoryQty?: number;
  enteredInventorySubtotalCost?: number;
  attachmentStatus?: MaintenanceMaterialAttachmentStatus;
  attachedToVehicle?: boolean;
  installedOnVehicleRef?: string;
  installedOnVehiclePlate?: string;
  installedAtMaintenanceRef?: string;
  installedDate?: string;
  installedOdometer?: number;
  componentLabel?: string;
  note?: string;
}

export interface Maintenance {
  _id: string;
  _type: 'maintenance';
  vehicleRef: string;
  vehiclePlate?: string;
  type: string;
  scheduleType: ScheduleType;
  plannedDate?: string;
  plannedOdometer?: number;
  status: MaintenanceStatus;
  completedDate?: string;
  odometerAtService?: number;
  vendor?: string;
  notes?: string;
  completionNotes?: string;
  attachmentUrls?: string[];
  materialUsages?: MaintenanceMaterialUsage[];
  materialUsageCount?: number;
  materialCostTotal?: number;
  laborCost?: number;
  laborExpenseRef?: string;
  laborBankAccountRef?: string;
  laborBankAccountName?: string;
  laborBankAccountNumber?: string;
  totalCost?: number;
  postedIncidentMaterialCostTotal?: number;
  postedIncidentServiceCostTotal?: number;
  inventoryReceiptCostTotal?: number;
  relatedExpenseRef?: string;
  cost?: number;
  source?: 'MANUAL' | 'ODOMETER_AUTO' | 'TIRE_REPLACEMENT' | 'INCIDENT_FOLLOW_UP';
  relatedDeliveryOrderRef?: string;
  relatedIncidentRef?: string;
  relatedIncidentNumber?: string;
  relatedIncidentSettlementLineRef?: string;
  relatedIncidentExpenseRef?: string;
  triggerOdometer?: number;
}

// ── Tire Event ──
export type TirePosition = 'FRONT_LEFT' | 'FRONT_RIGHT' | 'REAR_LEFT' | 'REAR_RIGHT' | 'SPARE';
export type TireAction = 'PATCH' | 'REPLACE_NEW' | 'ROTATE' | 'VULCANIZE';
export type TireCause = 'FLAT' | 'BLOWOUT' | 'WORN' | 'NAIL' | 'OTHER';
export type TireHolderType = 'INTERNAL_VEHICLE' | 'EXTERNAL_VEHICLE' | 'WAREHOUSE';
export type TireAssetStatus = 'IN_USE' | 'SPARE' | 'IN_WAREHOUSE' | 'LOANED_OUT' | 'SCRAPPED';
export type TireSourceCategory = 'PURCHASE' | 'INCIDENT_DO_PURCHASE' | 'MANUAL';

export interface TireEvent {
  _id: string;
  _type: 'tireEvent';
  tireCode: string;
  holderType: TireHolderType;
  status: TireAssetStatus;
  vehicleRef?: string;
  vehiclePlate?: string;
  posisi: string;
  positionKey?: string;
  slotCode?: string;
  slotLabel?: string;
  externalPartyName?: string;
  externalPlateNumber?: string;
  tireType: TireType;
  tireBrand: string;
  tireSize: string;
  linkedWarehouseItemRef?: string;
  linkedWarehouseItemCode?: string;
  linkedWarehouseItemName?: string;
  compatibleServiceRef?: string;
  compatibleServiceName?: string;
  sourcePurchaseRef?: string;
  sourcePurchaseNumber?: string;
  sourcePurchaseItemRef?: string;
  sourceReceiveDate?: string;
  sourceIncidentRef?: string;
  sourceIncidentNumber?: string;
  sourceIncidentSettlementLineRef?: string;
  sourceIncidentExpenseRef?: string;
  sourceCategory?: TireSourceCategory;
  sourceCategoryLabel?: string;
  installDate: string;
  replaceDate?: string;
  notes?: string;
  purchaseCost?: number;
  originalCost?: number;
  totalUsedPercent?: number;
  remainingPercent?: number;
  remainingValue?: number;
  maintenanceCostPostedPercent?: number;
  maintenanceCostPostedAmount?: number;
  lastMaintenanceCostRef?: string;
  accumulatedKm?: number;
  lastOdometerKm?: number;
  lastKmUpdateAt?: string;
}

export type TireHistoryActionType =
  | 'CREATED'
  | 'MOVED'
  | 'STATUS_CHANGED'
  | 'ODOMETER_UPDATED'
  | 'SCRAPPED'
  | 'UPDATED';

export interface TireHistoryLog {
  _id: string;
  _type: 'tireHistoryLog';
  tireEventRef: string;
  tireCode: string;
  tireBrand?: string;
  tireSize?: string;
  actionType: TireHistoryActionType;
  timestamp: string;
  actorUserRef?: string;
  actorUserName?: string;
  note?: string;
  fromHolderType?: TireHolderType;
  fromStatus?: TireAssetStatus;
  fromVehicleRef?: string;
  fromVehiclePlate?: string;
  fromSlotCode?: string;
  fromPlacementLabel?: string;
  toHolderType?: TireHolderType;
  toStatus?: TireAssetStatus;
  toVehicleRef?: string;
  toVehiclePlate?: string;
  toSlotCode?: string;
  toPlacementLabel?: string;
  odometerBeforeKm?: number;
  odometerAfterKm?: number;
  distanceKm?: number;
  usagePercent?: number;
  usageCost?: number;
  costAllocationType?: 'USAGE_ON_EXIT' | 'INSTALL_FULL';
  relatedMaintenanceRef?: string;
  costSourceVehicleRef?: string;
  costSourceVehiclePlate?: string;
  remainingPercentAfter?: number;
  remainingValueAfter?: number;
}

// ── Incident ──
export type IncidentType = 'BLOWOUT_TIRE' | 'ENGINE_TROUBLE' | 'ACCIDENT_MINOR' | 'ACCIDENT_MAJOR' | 'OTHER';
export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH';
export type IncidentStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Incident {
  _id: string;
  _type: 'incident';
  _rev?: string;
  incidentNumber: string;
  issuerCompanyName?: string;
  issuerCompanyAddress?: string;
  issuerCompanyPhone?: string;
  issuerCompanyEmail?: string;
  issuerCompanyLogoUrl?: string;
  dateTime: string;
  vehicleRef: string;
  vehiclePlate?: string;
  driverRef?: string;
  driverName?: string;
  relatedDeliveryOrderRef?: string;
  relatedDONumber?: string;
  incidentType: IncidentType;
  urgency: Urgency;
  locationText: string;
  odometer: number;
  description: string;
  status: IncidentStatus;
  attachmentUrls?: string[];
  assignedToUserRef?: string;
  assignedToUserName?: string;
  pendingDriverResolutionRequestedAt?: string;
  pendingDriverResolutionRequestedBy?: string;
  pendingDriverResolutionRequestedByName?: string;
  pendingDriverResolutionNote?: string;
  pendingDriverResolutionCostCount?: number;
  pendingDriverResolutionAmount?: number;
}

export interface IncidentActionLog {
  _id: string;
  _type: 'incidentActionLog';
  incidentRef: string;
  timestamp: string;
  note: string;
  userRef?: string;
  userName?: string;
}

export type IncidentSettlementLineType = 'COST' | 'COMPENSATION' | 'RECOVERY';
export type IncidentSettlementLineStatus = 'DRAFT' | 'APPROVED' | 'POSTED' | 'VOID';
export type IncidentExpenseRoute = 'DRIVER_VOUCHER' | 'COMPANY_EXPENSE';
export type IncidentSettlementRecipientType =
  | 'DRIVER'
  | 'KERNET'
  | 'THIRD_PARTY'
  | 'FAMILY'
  | 'VENDOR'
  | 'INSURANCE'
  | 'INTERNAL'
  | 'OTHER';
export type IncidentSettlementCategory =
  | 'TOWING'
  | 'REPAIR'
  | 'SPAREPART'
  | 'TIRE'
  | 'MEDICAL'
  | 'THIRD_PARTY_DAMAGE'
  | 'ADMINISTRATION'
  | 'POLICE_ADMIN'
  | 'ACCOMMODATION'
  | 'CARGO_HANDLING'
  | 'COMPENSATION_DRIVER'
  | 'COMPENSATION_CREW'
  | 'COMPENSATION_THIRD_PARTY'
  | 'COMPENSATION_FAMILY'
  | 'INSURANCE_CLAIM'
  | 'THIRD_PARTY_RECOVERY'
  | 'VENDOR_RECOVERY'
  | 'INTERNAL_RECOVERY'
  | 'OTHER';

export interface IncidentSettlementLine {
  _id: string;
  _type: 'incidentSettlementLine';
  _rev?: string;
  incidentRef: string;
  incidentNumber?: string;
  lineType: IncidentSettlementLineType;
  category: IncidentSettlementCategory;
  date: string;
  amount: number;
  description: string;
  payeeName?: string;
  recipientType?: IncidentSettlementRecipientType;
  note?: string;
  status: IncidentSettlementLineStatus;
  linkedExpenseRef?: string;
  linkedDriverVoucherItemRef?: string;
  linkedExpenseDate?: string;
  linkedExpenseAmount?: number;
  linkedExpenseCategoryRef?: string;
  linkedExpenseCategoryName?: string;
  linkedExpenseRoute?: IncidentExpenseRoute;
  linkedTireEventRef?: string;
  linkedTireCode?: string;
  linkedTireWarehouseItemRef?: string;
  linkedMaintenanceRef?: string;
  linkedMaintenanceType?: string;
  postedAt?: string;
  postedBy?: string;
  postedByName?: string;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
}

// ── Audit Log ──
export interface AuditLog {
  _id: string;
  _type: 'auditLog';
  _createdAt?: string;
  actorUserRef: string;
  actorUserName?: string;
  actorUserEmail?: string;
  actorUserRole?: UserRole;
  action: string;
  entityType: string;
  entityRef?: string;
  changesSummary: string;
  timestamp: string;
}

// Accounting Ledger
export type AccountingAccountType =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'REVENUE'
  | 'EXPENSE'
  | 'CONTRA_REVENUE';

export type AccountingNormalBalance = 'DEBIT' | 'CREDIT';
export type JournalEntryStatus = 'POSTED' | 'VOID';

export interface ChartOfAccount {
  _id: string;
  _type: 'chartOfAccount';
  code: string;
  name: string;
  accountType: AccountingAccountType;
  normalBalance: AccountingNormalBalance;
  systemKey?: string;
  parentRef?: string;
  active: boolean;
  description?: string;
}

export interface JournalEntry {
  _id: string;
  _type: 'journalEntry';
  entryNumber: string;
  entryDate: string;
  memo: string;
  sourceType?: string;
  sourceRef?: string;
  sourceEvent?: string;
  sourceNumber?: string;
  sourceLabel?: string;
  status: JournalEntryStatus;
  totalDebit: number;
  totalCredit: number;
  postedAt?: string;
  postedBy?: string;
  postedByName?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
}

export interface JournalLine {
  _id: string;
  _type: 'journalLine';
  journalEntryRef: string;
  lineNumber: number;
  accountRef: string;
  accountCode: string;
  accountName: string;
  accountType: AccountingAccountType;
  debit: number;
  credit: number;
  memo?: string;
  entityRef?: string;
  entityType?: string;
}

export interface AccountingPeriod {
  _id: string;
  _type: 'accountingPeriod';
  period: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED';
  closedAt?: string;
  closedBy?: string;
  closedByName?: string;
}

// ── Bank Account ──
export interface BankAccount {
  _id: string;
  _type: 'bankAccount';
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  accountType?: 'BANK' | 'CASH';
  systemKey?: string;
  initialBalance: number;
  currentBalance: number;
  active: boolean;
  notes?: string;
}

// ── Bank Transaction ──
export type BankTransactionType = 'CREDIT' | 'DEBIT' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export interface BankTransaction {
  _id: string;
  _type: 'bankTransaction';
  bankAccountRef: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  type: BankTransactionType;
  amount: number;
  date: string;
  description: string;
  balanceAfter: number;
  relatedPaymentRef?: string;
  relatedReceiptRef?: string;
  relatedExpenseRef?: string;
  relatedTransferRef?: string;
  relatedVoucherRef?: string;
  relatedOverpaymentRefundRef?: string;
  relatedPurchasePaymentRef?: string;
  relatedPurchaseRef?: string;
  reversesBankTransactionRef?: string;
  replacesBankTransactionRef?: string;
  _createdAt?: string;
}

// ── UI Helpers ──
export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

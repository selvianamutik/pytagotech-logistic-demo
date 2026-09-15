import type {
  BankTransaction,
  CustomerReceipt,
  CustomerOverpaymentRefund,
  Expense,
  Payment,
  Purchase,
} from "./types";

export type BankTransactionSourceLink = {
  href: string;
  label: string;
};

type TransactionLinkPermissions = {
  canOpenInvoices?: boolean;
  canOpenDriverVouchers?: boolean;
  canOpenDriverBorongans?: boolean;
  canOpenVehicles?: boolean;
  canOpenIncidents?: boolean;
  canOpenMaintenance?: boolean;
  canOpenPurchases?: boolean;
};

export function buildPaymentLookup(
  payments: Array<Pick<Payment, "_id" | "invoiceRef" | "receiptNumber">>,
) {
  return new Map(payments.map((payment) => [payment._id, payment]));
}

export function buildRefundLookup(
  refunds: Array<
    Pick<
      CustomerOverpaymentRefund,
      "_id" | "sourceInvoiceRef" | "sourceReceiptRef" | "sourceReceiptNumber" | "sourceType"
    >
  >,
) {
  return new Map(refunds.map((refund) => [refund._id, refund]));
}

export function buildCustomerReceiptLookup(
  receipts: Array<Pick<CustomerReceipt, "_id" | "receiptNumber">>,
) {
  return new Map(receipts.map((receipt) => [receipt._id, receipt]));
}

export function buildExpenseLookup(
  expenses: Array<
    Pick<
      Expense,
      "_id" | "voucherRef" | "boronganRef" | "relatedVehicleRef" | "relatedIncidentRef" | "relatedMaintenanceRef"
    >
  >,
) {
  return new Map(expenses.map((expense) => [expense._id, expense]));
}

export function buildPurchaseLookup(
  purchases: Array<Pick<Purchase, "_id" | "purchaseNumber" | "supplierName">>,
) {
  return new Map(purchases.map((purchase) => [purchase._id, purchase]));
}

export function resolveBankTransactionSourceLink(params: {
  transaction: Pick<
    BankTransaction,
    | "relatedPaymentRef"
    | "relatedReceiptRef"
    | "relatedExpenseRef"
    | "relatedVoucherRef"
    | "relatedOverpaymentRefundRef"
    | "relatedPurchaseRef"
  >;
  paymentsById?: Map<string, Pick<Payment, "_id" | "invoiceRef" | "receiptNumber">>;
  receiptsById?: Map<string, Pick<CustomerReceipt, "_id" | "receiptNumber">>;
  refundsById?: Map<
    string,
    Pick<
      CustomerOverpaymentRefund,
      "_id" | "sourceInvoiceRef" | "sourceReceiptRef" | "sourceReceiptNumber" | "sourceType"
    >
  >;
  expensesById?: Map<
    string,
    Pick<
      Expense,
      "_id" | "voucherRef" | "boronganRef" | "relatedVehicleRef" | "relatedIncidentRef" | "relatedMaintenanceRef"
    >
  >;
  purchasesById?: Map<
    string,
    Pick<Purchase, "_id" | "purchaseNumber" | "supplierName">
  >;
  invoiceIdsWithPages?: Set<string>;
  permissions?: TransactionLinkPermissions;
}): BankTransactionSourceLink | null {
  const {
    transaction,
    paymentsById,
    receiptsById,
    refundsById,
    expensesById,
    purchasesById,
    invoiceIdsWithPages,
    permissions,
  } = params;

  if (
    transaction.relatedPaymentRef &&
    paymentsById?.has(transaction.relatedPaymentRef)
  ) {
    const payment = paymentsById.get(transaction.relatedPaymentRef);
    if (
      payment?.invoiceRef &&
      permissions?.canOpenInvoices &&
      (!invoiceIdsWithPages || invoiceIdsWithPages.has(payment.invoiceRef))
    ) {
      return {
        href: `/invoices/${payment.invoiceRef}`,
        label: payment.receiptNumber
          ? `Buka Invoice dari ${payment.receiptNumber}`
          : "Buka Invoice",
      };
    }
  }

  if (
    transaction.relatedReceiptRef &&
    receiptsById?.has(transaction.relatedReceiptRef) &&
    permissions?.canOpenInvoices
  ) {
    const receipt = receiptsById.get(transaction.relatedReceiptRef);
    const query = encodeURIComponent(
      receipt?.receiptNumber || transaction.relatedReceiptRef,
    );
    return {
      href: `/invoices?q=${query}`,
      label: receipt?.receiptNumber
        ? `Buka Penerimaan ${receipt.receiptNumber}`
        : "Buka Penerimaan Customer",
    };
  }

  if (
    transaction.relatedOverpaymentRefundRef &&
    refundsById?.has(transaction.relatedOverpaymentRefundRef)
  ) {
    const refund = refundsById.get(transaction.relatedOverpaymentRefundRef);
    if (
      refund?.sourceInvoiceRef &&
      permissions?.canOpenInvoices &&
      (!invoiceIdsWithPages || invoiceIdsWithPages.has(refund.sourceInvoiceRef))
    ) {
      return {
        href: `/invoices/${refund.sourceInvoiceRef}`,
        label: "Buka Invoice Sumber Refund",
      };
    }
    if (refund?.sourceReceiptRef && permissions?.canOpenInvoices) {
      const query = encodeURIComponent(
        refund.sourceReceiptNumber || refund.sourceReceiptRef,
      );
      return {
        href: `/invoices?q=${query}`,
        label: "Buka Kelebihan Bayar Customer",
      };
    }
  }

  if (transaction.relatedVoucherRef && permissions?.canOpenDriverVouchers) {
    return {
      href: `/driver-vouchers/${transaction.relatedVoucherRef}`,
      label: "Buka Uang Jalan Trip",
    };
  }

  if (
    transaction.relatedPurchaseRef &&
    purchasesById?.has(transaction.relatedPurchaseRef) &&
    permissions?.canOpenPurchases
  ) {
    const purchase = purchasesById.get(transaction.relatedPurchaseRef);
    return {
      href: `/inventory/purchases/${transaction.relatedPurchaseRef}`,
      label: purchase?.purchaseNumber
        ? `Buka ${purchase.purchaseNumber}`
        : "Buka Pembelian Supplier",
    };
  }

  if (
    transaction.relatedExpenseRef &&
    expensesById?.has(transaction.relatedExpenseRef)
  ) {
    const expense = expensesById.get(transaction.relatedExpenseRef);
    if (expense?.voucherRef && permissions?.canOpenDriverVouchers) {
      return {
        href: `/driver-vouchers/${expense.voucherRef}`,
        label: "Buka Uang Jalan Trip",
      };
    }
    if (expense?.boronganRef && permissions?.canOpenDriverBorongans) {
      return {
        href: `/borongan/${expense.boronganRef}`,
        label: "Buka Borongan Supir",
      };
    }
    if (expense?.relatedIncidentRef && permissions?.canOpenIncidents) {
      return {
        href: `/fleet/incidents/${expense.relatedIncidentRef}`,
        label: "Buka Insiden",
      };
    }
    if (expense?.relatedMaintenanceRef && permissions?.canOpenMaintenance) {
      return {
        href: `/fleet/maintenance/${expense.relatedMaintenanceRef}`,
        label: "Buka Maintenance",
      };
    }
    if (expense?.relatedVehicleRef && permissions?.canOpenVehicles) {
      return {
        href: `/fleet/vehicles/${expense.relatedVehicleRef}`,
        label: "Buka Kendaraan",
      };
    }
  }

  return null;
}

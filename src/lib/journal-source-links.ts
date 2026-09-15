import type { JournalEntry } from "./types";

export type JournalSourceLink = {
  href: string;
  label: string;
};

type JournalSourceLinkPermissions = {
  canOpenInvoices?: boolean;
  canOpenExpenses?: boolean;
  canOpenDriverVouchers?: boolean;
  canOpenPurchases?: boolean;
  canOpenBankAccounts?: boolean;
  canOpenWarehouseItems?: boolean;
};

function splitCompoundRef(sourceRef: string) {
  const first = sourceRef.split(":")[0];
  return first || "";
}

export function resolveJournalSourceLink(
  entry: Pick<
    JournalEntry,
    "sourceType" | "sourceRef" | "sourceNumber" | "sourceLabel"
  >,
  permissions?: JournalSourceLinkPermissions,
): JournalSourceLink | null {
  const sourceType = entry.sourceType;
  const ref = entry.sourceRef;
  if (!sourceType || !ref) return null;

  switch (sourceType) {
    case "FREIGHT_NOTA":
    case "INVOICE":
      if (permissions?.canOpenInvoices) {
        const kind = sourceType === "FREIGHT_NOTA" ? "Nota Ongkir" : "Invoice";
        return {
          href: `/invoices/${encodeURIComponent(ref)}`,
          label: entry.sourceNumber
            ? `Buka ${kind} ${entry.sourceNumber}`
            : `Buka ${kind}`,
        };
      }
      break;
    case "PAYMENT":
    case "CUSTOMER_RECEIPT":
    case "CUSTOMER_OVERPAYMENT_REFUND":
      if (permissions?.canOpenInvoices && entry.sourceNumber) {
        return {
          href: `/invoices?q=${encodeURIComponent(entry.sourceNumber)}`,
          label: `Buka Penerimaan ${entry.sourceNumber}`,
        };
      }
      break;
    case "EXPENSE":
      if (permissions?.canOpenExpenses) {
        return {
          href: `/expenses/${encodeURIComponent(ref)}`,
          label: "Buka Pengeluaran",
        };
      }
      break;
    case "DRIVER_VOUCHER":
      if (permissions?.canOpenDriverVouchers) {
        return {
          href: `/driver-vouchers/${encodeURIComponent(ref)}`,
          label: entry.sourceNumber
            ? `Buka Uang Jalan ${entry.sourceNumber}`
            : "Buka Uang Jalan Trip",
        };
      }
      break;
    case "PURCHASE": {
      const purchaseRef = splitCompoundRef(ref);
      if (purchaseRef && permissions?.canOpenPurchases) {
        return {
          href: `/inventory/purchases/${encodeURIComponent(purchaseRef)}`,
          label: entry.sourceNumber
            ? `Buka ${entry.sourceNumber}`
            : "Buka Pembelian Supplier",
        };
      }
      break;
    }
    case "PURCHASE_PAYMENT":
      if (permissions?.canOpenPurchases && entry.sourceNumber) {
        return {
          href: `/inventory/purchases?q=${encodeURIComponent(entry.sourceNumber)}`,
          label: `Buka ${entry.sourceNumber}`,
        };
      }
      break;
    case "BANK_ACCOUNT":
      if (permissions?.canOpenBankAccounts) {
        return {
          href: `/bank-accounts/${encodeURIComponent(ref)}`,
          label: "Buka Rekening",
        };
      }
      break;
    case "BANK_TRANSFER":
      if (permissions?.canOpenBankAccounts) {
        return {
          href: "/bank-accounts",
          label: "Buka Rekening Bank",
        };
      }
      break;
    case "STOCK_MOVEMENT":
      if (permissions?.canOpenWarehouseItems && entry.sourceNumber) {
        return {
          href: `/inventory/items?q=${encodeURIComponent(entry.sourceNumber)}`,
          label: `Buka Item ${entry.sourceNumber}`,
        };
      }
      break;
    default:
      break;
  }

  return null;
}
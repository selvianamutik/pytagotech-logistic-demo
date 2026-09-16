import { loadScriptEnv } from './_env';

loadScriptEnv();

import { getAllDocuments } from '../src/lib/repositories/document-store';
import { computePurchaseSummary } from '../src/lib/inventory';
import { deriveReceivableStatus, getDriverVoucherFinancialSummary, getReceivableNetAmount } from '../src/lib/utils';
import type {
    BankAccount,
    BankTransaction,
    ChartOfAccount,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    DeliveryOrderItem,
    DriverVoucher,
    DriverVoucherDisbursement,
    DriverVoucherItem,
    Expense,
    FreightNota,
    FreightNotaItem,
    Income,
    Invoice,
    InvoiceAdjustment,
    JournalEntry,
    JournalLine,
    Payment,
    Purchase,
    PurchaseItem,
    PurchasePayment,
    StockMovement,
    WarehouseItem,
} from '../src/lib/types';

function money(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function quantity(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function sumBy<T>(rows: T[], selector: (row: T) => unknown) {
    return rows.reduce((sum, row) => sum + money(selector(row)), 0);
}

function bankDelta(transaction: BankTransaction) {
    const amount = money(transaction.amount);
    return transaction.type === 'DEBIT' || transaction.type === 'TRANSFER_OUT' || transaction.type === 'ADJUSTMENT_DEBIT' ? -amount : amount;
}

function bankTransactionOrderKey(transaction: BankTransaction) {
    return `${transaction.date || ''} ${transaction._createdAt || ''} ${transaction._id}`;
}

function groupBy<T>(rows: T[], selector: (row: T) => string | undefined | null) {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
        const key = selector(row);
        if (!key) continue;
        const current = grouped.get(key) || [];
        current.push(row);
        grouped.set(key, current);
    }
    return grouped;
}

function getFreightNota(ref: string, freightNotaById: Map<string, FreightNota>, invoiceById: Map<string, Invoice>) {
    return freightNotaById.get(ref) || invoiceById.get(ref);
}

function journalKey(sourceType: string, sourceRef: string, sourceEvent: string) {
    return `${sourceType}::${sourceRef}::${sourceEvent}`;
}

function bankPrimaryRef(transaction: BankTransaction) {
    const refs = [
        ['relatedPaymentRef', transaction.relatedPaymentRef],
        ['relatedReceiptRef', transaction.relatedReceiptRef],
        ['relatedExpenseRef', transaction.relatedExpenseRef],
        ['relatedTransferRef', transaction.relatedTransferRef],
        ['relatedVoucherRef', transaction.relatedVoucherRef],
        ['relatedOverpaymentRefundRef', transaction.relatedOverpaymentRefundRef],
        ['relatedPurchasePaymentRef', transaction.relatedPurchasePaymentRef],
        ['relatedAdjustmentRef', transaction.relatedAdjustmentRef],
    ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;
    return refs;
}

function journalAmount(
    lines: JournalLine[],
    accountById: Map<string, ChartOfAccount>,
    systemKeys: string[],
    side: 'debit' | 'credit',
) {
    return lines.reduce((sum, line) => {
        const account = accountById.get(line.accountRef);
        if (!account?.systemKey || !systemKeys.includes(account.systemKey)) return sum;
        return sum + money(line[side]);
    }, 0);
}

function journalBalance(
    lines: JournalLine[],
    accountById: Map<string, ChartOfAccount>,
    systemKeys: string[],
    normalSide: 'debit' | 'credit',
) {
    const debit = journalAmount(lines, accountById, systemKeys, 'debit');
    const credit = journalAmount(lines, accountById, systemKeys, 'credit');
    return normalSide === 'debit' ? debit - credit : credit - debit;
}

async function main() {
    const [
        accounts,
        journalLines,
        bankAccounts,
        bankTransactions,
        freightNotas,
        freightNotaItems,
        deliveryOrderItems,
        legacyInvoices,
        payments,
        incomes,
        customerReceipts,
        invoiceAdjustments,
        overpaymentRefunds,
        purchases,
        purchaseItems,
        purchasePayments,
        stockMovements,
        warehouseItems,
        driverVouchers,
        driverVoucherDisbursements,
        driverVoucherItems,
        expenses,
        journalEntries,
    ] = await Promise.all([
        getAllDocuments<ChartOfAccount>('chartOfAccount'),
        getAllDocuments<JournalLine>('journalLine'),
        getAllDocuments<BankAccount>('bankAccount'),
        getAllDocuments<BankTransaction>('bankTransaction'),
        getAllDocuments<FreightNota>('freightNota'),
        getAllDocuments<FreightNotaItem>('freightNotaItem'),
        getAllDocuments<DeliveryOrderItem>('deliveryOrderItem'),
        getAllDocuments<Invoice>('invoice'),
        getAllDocuments<Payment>('payment'),
        getAllDocuments<Income>('income'),
        getAllDocuments<CustomerReceipt>('customerReceipt'),
        getAllDocuments<InvoiceAdjustment>('invoiceAdjustment'),
        getAllDocuments<CustomerOverpaymentRefund>('customerOverpaymentRefund'),
        getAllDocuments<Purchase>('purchase'),
        getAllDocuments<PurchaseItem>('purchaseItem'),
        getAllDocuments<PurchasePayment>('purchasePayment'),
        getAllDocuments<StockMovement>('stockMovement'),
        getAllDocuments<WarehouseItem>('warehouseItem'),
        getAllDocuments<DriverVoucher>('driverVoucher'),
        getAllDocuments<DriverVoucherDisbursement>('driverVoucherDisbursement'),
        getAllDocuments<DriverVoucherItem>('driverVoucherItem'),
        getAllDocuments<Expense>('expense'),
        getAllDocuments<JournalEntry>('journalEntry'),
    ]);

    const accountById = new Map(accounts.map(row => [row._id, row]));
    const bankById = new Map(bankAccounts.map(row => [row._id, row]));
    const freightNotaById = new Map(freightNotas.map(row => [row._id, row]));
    const deliveryOrderItemById = new Map(deliveryOrderItems.map(row => [row._id, row]));
    const legacyInvoiceById = new Map(legacyInvoices.map(row => [row._id, row]));
    const receiptById = new Map(customerReceipts.map(row => [row._id, row]));
    const bankTransactionById = new Map(bankTransactions.map(row => [row._id, row]));
    const purchaseById = new Map(purchases.map(row => [row._id, row]));
    const purchasePaymentById = new Map(purchasePayments.map(row => [row._id, row]));
    const warehouseItemById = new Map(warehouseItems.map(row => [row._id, row]));
    const voucherById = new Map(driverVouchers.map(row => [row._id, row]));
    const disbursementById = new Map(driverVoucherDisbursements.map(row => [row._id, row]));
    const activeFreightNotas = freightNotas.filter(row => row.status !== 'VOID');
    const voidedFreightNotas = freightNotas.filter(row => row.status === 'VOID');
    const activeFreightNotaItems = freightNotaItems.filter(row => row.status !== 'VOID');
    const voidedFreightNotaItems = freightNotaItems.filter(row => row.status === 'VOID');
    const activeDriverVoucherDisbursements = driverVoucherDisbursements.filter(row => row.status !== 'VOID');
    const voidedDriverVoucherDisbursements = driverVoucherDisbursements.filter(row => row.status === 'VOID');
    const expenseById = new Map(expenses.map(row => [row._id, row]));
    const postedJournals = journalEntries.filter(row => row.status !== 'VOID');
    const journalLinesByEntry = groupBy(journalLines, row => row.journalEntryRef);
    const postedJournalLines = postedJournals.flatMap(row => journalLinesByEntry.get(row._id) || []);
    const postedJournalByKey = new Map(postedJournals.map(row => [
        journalKey(row.sourceType || '', row.sourceRef || '', row.sourceEvent || ''),
        row,
    ]));
    const getPostedJournalLines = (sourceType: string, sourceRef: string, sourceEvent: string, label: string) => {
        const entry = postedJournalByKey.get(journalKey(sourceType, sourceRef, sourceEvent));
        assert(entry, `Jurnal ${label} belum ada.`);
        return journalLinesByEntry.get(entry._id) || [];
    };
    const assertNoPostedJournal = (sourceType: string, sourceRef: string, sourceEvent: string, label: string) => {
        assert(!postedJournalByKey.has(journalKey(sourceType, sourceRef, sourceEvent)), `Jurnal ${label} seharusnya tidak aktif.`);
    };
    const assertJournalSide = (lines: JournalLine[], systemKeys: string | string[], side: 'debit' | 'credit', amount: number, label: string) => {
        const keys = Array.isArray(systemKeys) ? systemKeys : [systemKeys];
        const actual = journalAmount(lines, accountById, keys, side);
        assert(actual === money(amount), `Jurnal ${label} ${side} ${keys.join('/')} tidak sinkron: ${actual} vs ${money(amount)}.`);
    };

    const bankTransactionsByBank = groupBy(bankTransactions, row => row.bankAccountRef);
    for (const account of bankAccounts) {
        let runningBalance = money(account.initialBalance);
        const accountTransactions = [...(bankTransactionsByBank.get(account._id) || [])]
            .sort((left, right) => bankTransactionOrderKey(left).localeCompare(bankTransactionOrderKey(right)));
        for (const transaction of accountTransactions) {
            runningBalance += bankDelta(transaction);
            assert(
                money(transaction.balanceAfter) === runningBalance,
                `Saldo berjalan mutasi bank ${transaction._id} tidak sinkron: stored ${money(transaction.balanceAfter)}, expected ${runningBalance}.`
            );
        }
        assert(
            money(account.currentBalance) === runningBalance,
            `Saldo rekening ${account.bankName} tidak sesuai transaksi: stored ${money(account.currentBalance)}, expected ${runningBalance}.`
        );

        if (money(account.initialBalance) > 0) {
            const openingLines = getPostedJournalLines('BANK_ACCOUNT', account._id, 'OPENING_BALANCE', `saldo awal ${account.bankName}`);
            const cashBankAccount = account.accountType === 'CASH' || account.systemKey === 'cash-on-hand'
                ? 'cash_on_hand'
                : 'bank';
            assertJournalSide(openingLines, cashBankAccount, 'debit', account.initialBalance, `saldo awal ${account.bankName}`);
            assertJournalSide(openingLines, 'equity_capital', 'credit', account.initialBalance, `saldo awal ${account.bankName}`);
        } else {
            assertNoPostedJournal('BANK_ACCOUNT', account._id, 'OPENING_BALANCE', `saldo awal ${account.bankName}`);
        }
    }

    for (const transaction of bankTransactions) {
        assert(bankById.has(transaction.bankAccountRef), `Mutasi bank ${transaction._id} memakai rekening yang tidak ditemukan.`);
        assert(money(transaction.amount) > 0, `Mutasi bank ${transaction._id} nominalnya tidak valid.`);
        const primaryRefs = bankPrimaryRef(transaction);
        assert(primaryRefs.length === 1, `Mutasi bank ${transaction._id} harus punya tepat 1 referensi sumber utama.`);
        const [refKey, refValue] = primaryRefs[0];
        if (refKey === 'relatedAdjustmentRef') {
            assert(
                transaction.type === 'ADJUSTMENT' || transaction.type === 'ADJUSTMENT_DEBIT',
                `Mutasi penyesuaian ${transaction._id} harus ADJUSTMENT/ADJUSTMENT_DEBIT.`
            );
        } else if (refKey === 'relatedPaymentRef') {
            assert(payments.some(row => row._id === refValue), `Mutasi bank ${transaction._id} mengarah ke payment yang tidak ditemukan.`);
            if (transaction.type === 'DEBIT') {
                assert(
                    Boolean(transaction.reversesBankTransactionRef),
                    `Mutasi koreksi payment ${transaction._id} harus mereferensikan mutasi payment yang dibalik.`
                );
            } else {
                assert(transaction.type === 'CREDIT', `Mutasi bank payment ${transaction._id} harus CREDIT atau DEBIT koreksi.`);
            }
            if (transaction.reversesBankTransactionRef) {
                const reversed = bankTransactionById.get(transaction.reversesBankTransactionRef);
                assert(reversed, `Mutasi koreksi payment ${transaction._id} mengarah ke mutasi bank yang tidak ditemukan.`);
                assert(reversed.relatedPaymentRef === refValue, `Mutasi koreksi payment ${transaction._id} membalik payment yang berbeda.`);
            }
            if (transaction.replacesBankTransactionRef) {
                const replaced = bankTransactionById.get(transaction.replacesBankTransactionRef);
                assert(replaced, `Mutasi pengganti payment ${transaction._id} mengarah ke mutasi bank yang tidak ditemukan.`);
                assert(replaced.relatedPaymentRef === refValue, `Mutasi pengganti payment ${transaction._id} mengganti payment yang berbeda.`);
            }
        }
        if (refKey === 'relatedReceiptRef') {
            assert(receiptById.has(refValue), `Mutasi bank ${transaction._id} mengarah ke receipt yang tidak ditemukan.`);
            assert(transaction.type === 'CREDIT', `Mutasi bank receipt ${transaction._id} harus CREDIT.`);
        }
        if (refKey === 'relatedExpenseRef') {
            assert(expenseById.has(refValue), `Mutasi bank ${transaction._id} mengarah ke expense yang tidak ditemukan.`);
            assert(transaction.type === 'DEBIT', `Mutasi bank expense ${transaction._id} harus DEBIT.`);
        }
        if (refKey === 'relatedTransferRef') {
            assert(transaction.type === 'TRANSFER_IN' || transaction.type === 'TRANSFER_OUT', `Mutasi transfer ${transaction._id} harus TRANSFER_IN/TRANSFER_OUT.`);
        }
        if (refKey === 'relatedVoucherRef') {
            assert(voucherById.has(refValue), `Mutasi bank ${transaction._id} mengarah ke bon yang tidak ditemukan.`);
            assert(transaction.type === 'DEBIT' || transaction.type === 'CREDIT', `Mutasi bank bon ${transaction._id} harus DEBIT/CREDIT.`);
        }
        if (refKey === 'relatedOverpaymentRefundRef') {
            assert(overpaymentRefunds.some(row => row._id === refValue), `Mutasi bank ${transaction._id} mengarah ke refund overpayment yang tidak ditemukan.`);
            assert(transaction.type === 'DEBIT', `Mutasi refund overpayment ${transaction._id} harus DEBIT.`);
        }
        if (refKey === 'relatedPurchasePaymentRef') {
            const purchasePayment = purchasePaymentById.get(refValue);
            assert(purchasePayment, `Mutasi bank ${transaction._id} mengarah ke pembayaran supplier yang tidak ditemukan.`);
            assert(transaction.type === 'DEBIT', `Mutasi pembayaran supplier ${transaction._id} harus DEBIT.`);
            if (transaction.relatedPurchaseRef) {
                assert(purchaseById.has(transaction.relatedPurchaseRef), `Mutasi bank ${transaction._id} relatedPurchaseRef tidak ditemukan.`);
                assert(purchasePayment.purchaseRef === transaction.relatedPurchaseRef, `Mutasi bank ${transaction._id} relatedPurchaseRef tidak cocok dengan pembayaran supplier.`);
            }
        } else {
            assert(!transaction.relatedPurchaseRef, `Mutasi bank ${transaction._id} relatedPurchaseRef hanya boleh dipakai bersama relatedPurchasePaymentRef.`);
        }
    }

    const transferTransactionsByRef = groupBy(bankTransactions.filter(row => row.relatedTransferRef), row => row.relatedTransferRef);
    for (const [transferRef, rows] of transferTransactionsByRef.entries()) {
        const outs = rows.filter(row => row.type === 'TRANSFER_OUT');
        const ins = rows.filter(row => row.type === 'TRANSFER_IN');
        assert(rows.length === 2 && outs.length === 1 && ins.length === 1, `Transfer ${transferRef} harus punya 1 mutasi keluar dan 1 mutasi masuk.`);
        assert(outs[0].bankAccountRef !== ins[0].bankAccountRef, `Transfer ${transferRef} rekening asal dan tujuan tidak boleh sama.`);
        assert(money(outs[0].amount) === money(ins[0].amount), `Transfer ${transferRef} nominal keluar/masuk tidak sama.`);
    }

    const freightItemsByNota = groupBy(activeFreightNotaItems, row => row.notaRef);
    const billedItemTotals = new Map<string, { itemRef: string; invoiceRefs: Set<string>; collie: number; weightKg: number }>();
    const billedWholeSjKeys = new Map<string, string>();
    const billedItemSjKeys = new Map<string, string[]>();
    for (const item of activeFreightNotaItems) {
        const linkedNota = freightNotaById.get(item.notaRef);
        assert(linkedNota, `Item invoice ${item._id} mengarah ke invoice yang tidak ditemukan.`);
        assert(linkedNota.status !== 'VOID', `Item invoice aktif ${item._id} mengarah ke invoice yang sudah dibatalkan.`);
        assert(money(item.uangRp) > 0, `Item invoice ${item._id} nominalnya tidak valid.`);

        const itemRefs = Array.isArray(item.deliveryOrderItemRefs) && item.deliveryOrderItemRefs.length > 0
            ? item.deliveryOrderItemRefs
            : item.deliveryOrderItemRef
                ? [item.deliveryOrderItemRef]
                : [];
        const normalizedItemRefs = [...new Set(itemRefs.filter(Boolean))];

        if (normalizedItemRefs.length > 0) {
            assert(item.doRef, `Item invoice ${item._id} punya referensi barang DO tetapi tidak punya doRef.`);
            for (const itemRef of normalizedItemRefs) {
                const deliveryOrderItem = deliveryOrderItemById.get(itemRef);
                assert(deliveryOrderItem, `Item invoice ${item._id} mengarah ke barang DO ${itemRef} yang tidak ditemukan.`);
                assert(
                    deliveryOrderItem.deliveryOrderRef === item.doRef,
                    `Item invoice ${item._id} mengarah ke barang DO ${itemRef} yang bukan milik DO ${item.doRef}.`
                );
                if (deliveryOrderItem.shipperReferenceNumber && item.noSJ) {
                    assert(
                        deliveryOrderItem.shipperReferenceNumber === item.noSJ,
                        `Item invoice ${item._id} nomor SJ tidak cocok dengan barang DO ${itemRef}.`
                    );
                }

                const itemKey = `${item.doRef}::item::${itemRef}`;
                const currentBilledItemTotal = billedItemTotals.get(itemKey) || {
                    itemRef,
                    invoiceRefs: new Set<string>(),
                    collie: 0,
                    weightKg: 0,
                };
                currentBilledItemTotal.invoiceRefs.add(item.notaRef);
                currentBilledItemTotal.collie += quantity(item.collie);
                currentBilledItemTotal.weightKg += quantity(item.beratKg);
                billedItemTotals.set(itemKey, currentBilledItemTotal);

                const sjNumber = item.noSJ || deliveryOrderItem.shipperReferenceNumber;
                if (sjNumber) {
                    const sjKey = `${item.doRef}::sj::${sjNumber}`;
                    assert(
                        !billedWholeSjKeys.has(sjKey),
                        `SJ ${sjNumber} pada DO ${item.doRef} sudah ditagih penuh dan tidak boleh ditagih parsial juga.`
                    );
                    const current = billedItemSjKeys.get(sjKey) || [];
                    current.push(itemRef);
                    billedItemSjKeys.set(sjKey, current);
                }
            }
        } else if (item.doRef) {
            const sjKey = `${item.doRef}::sj::${item.noSJ || '-'}`;
            assert(!billedWholeSjKeys.has(sjKey), `SJ ${item.noSJ || '-'} pada DO ${item.doRef} tertagih dobel.`);
            assert(
                !(billedItemSjKeys.get(sjKey) || []).length,
                `SJ ${item.noSJ || '-'} pada DO ${item.doRef} sudah ditagih parsial per barang dan tidak boleh ditagih penuh juga.`
            );
            billedWholeSjKeys.set(sjKey, item.notaRef);
        }
    }

    for (const billedTotal of billedItemTotals.values()) {
        const deliveryOrderItem = deliveryOrderItemById.get(billedTotal.itemRef);
        assert(deliveryOrderItem, `Barang DO ${billedTotal.itemRef} pada audit invoice tidak ditemukan.`);

        const actualKoli = quantity(deliveryOrderItem.actualQtyKoli ?? deliveryOrderItem.shippedQtyKoli ?? deliveryOrderItem.orderItemQtyKoli);
        const actualWeightKg = quantity(deliveryOrderItem.actualWeightKg ?? deliveryOrderItem.shippedWeight ?? deliveryOrderItem.orderItemWeight);
        const invoiceRefs = [...billedTotal.invoiceRefs].join(', ');

        assert(
            actualKoli <= 0 || billedTotal.collie <= actualKoli + 0.0001,
            `Barang DO ${billedTotal.itemRef} tertagih melebihi koli aktual di invoice ${invoiceRefs}: ${billedTotal.collie} > ${actualKoli}.`
        );
        assert(
            actualWeightKg <= 0 || billedTotal.weightKg <= actualWeightKg + 0.0001,
            `Barang DO ${billedTotal.itemRef} tertagih melebihi berat aktual di invoice ${invoiceRefs}: ${billedTotal.weightKg} > ${actualWeightKg}.`
        );
    }

    const paymentsByInvoice = groupBy(payments, row => row.invoiceRef);
    const bankTransactionsByPayment = groupBy(bankTransactions, row => row.relatedPaymentRef);
    const bankTransactionsByReceipt = groupBy(bankTransactions, row => row.relatedReceiptRef);
    const bankTransactionsByOverpaymentRefund = groupBy(bankTransactions, row => row.relatedOverpaymentRefundRef);
    const adjustmentsByInvoice = groupBy(invoiceAdjustments, row => row.invoiceRef);
    const refundsByInvoice = overpaymentRefunds.filter(row => row.sourceType === 'INVOICE_OVERPAID');
    const refundsByInvoiceRef = groupBy(refundsByInvoice, row => row.sourceInvoiceRef);

    for (const item of voidedFreightNotaItems) {
        assert(Boolean(item.voidedAt), `Item invoice void ${item._id} belum punya voidedAt.`);
        assert(freightNotaById.has(item.notaRef), `Item invoice void ${item._id} mengarah ke invoice yang tidak ditemukan.`);
    }

    for (const nota of activeFreightNotas) {
        const grossFromItems = sumBy(freightItemsByNota.get(nota._id) || [], row => row.uangRp);
        assert(money(nota.totalAmount) === grossFromItems, `Invoice ${nota.notaNumber} totalAmount tidak sama dengan total item.`);
        const issueJournalLines = getPostedJournalLines('FREIGHT_NOTA', nota._id, 'ISSUE', `invoice ${nota.notaNumber}`);
        assertJournalSide(issueJournalLines, 'accounts_receivable', 'debit', nota.totalAmount, `invoice ${nota.notaNumber}`);
        assertJournalSide(issueJournalLines, 'freight_revenue', 'credit', nota.totalAmount, `invoice ${nota.notaNumber}`);

        const approvedAdjustments = (adjustmentsByInvoice.get(nota._id) || []).filter(row => row.status === 'APPROVED');
        const adjustmentTotal = sumBy(approvedAdjustments, row => row.amount);
        assert(money(nota.totalAdjustmentAmount) === adjustmentTotal, `Invoice ${nota.notaNumber} total klaim/potongan tidak sinkron.`);

        const netAmount = money(getReceivableNetAmount(nota));
        assert(money(nota.netAmount) === netAmount, `Invoice ${nota.notaNumber} netAmount tidak sinkron.`);
        if (money(nota.pph23Amount) > 0) {
            const pphLines = getPostedJournalLines('FREIGHT_NOTA', nota._id, 'PPH23', `PPh 23 invoice ${nota.notaNumber}`);
            assertJournalSide(pphLines, 'prepaid_pph23', 'debit', money(nota.pph23Amount), `PPh 23 invoice ${nota.notaNumber}`);
            assertJournalSide(pphLines, 'accounts_receivable', 'credit', money(nota.pph23Amount), `PPh 23 invoice ${nota.notaNumber}`);
        } else {
            assertNoPostedJournal('FREIGHT_NOTA', nota._id, 'PPH23', `PPh 23 invoice ${nota.notaNumber}`);
        }

        const rawPaid = sumBy(paymentsByInvoice.get(nota._id) || [], row => row.amount);
        const refunded = sumBy(refundsByInvoiceRef.get(nota._id) || [], row => row.amount);
        assert(refunded <= Math.max(rawPaid - netAmount, 0), `Refund overpayment invoice ${nota.notaNumber} melebihi nilai lebih bayar.`);

        const effectivePaid = Math.max(rawPaid - refunded, 0);
        assert(
            nota.status === deriveReceivableStatus(nota, effectivePaid),
            `Status invoice ${nota.notaNumber} tidak sesuai pembayaran efektif.`
        );
    }

    for (const nota of voidedFreightNotas) {
        assert(Boolean(nota.voidedAt), `Invoice void ${nota.notaNumber} belum punya voidedAt.`);
        assertNoPostedJournal('FREIGHT_NOTA', nota._id, 'ISSUE', `invoice void ${nota.notaNumber}`);
        assertNoPostedJournal('FREIGHT_NOTA', nota._id, 'PPH23', `PPh 23 invoice void ${nota.notaNumber}`);
        assert((paymentsByInvoice.get(nota._id) || []).length === 0, `Invoice void ${nota.notaNumber} masih punya pembayaran.`);
        assert((refundsByInvoiceRef.get(nota._id) || []).length === 0, `Invoice void ${nota.notaNumber} masih punya refund overpayment.`);
        assert(
            (adjustmentsByInvoice.get(nota._id) || []).filter(row => row.status === 'APPROVED').length === 0,
            `Invoice void ${nota.notaNumber} masih punya klaim/potongan aktif.`
        );
        assert(
            (freightNotaItems.filter(item => item.notaRef === nota._id)).every(item => item.status === 'VOID'),
            `Invoice void ${nota.notaNumber} masih punya item aktif.`
        );
    }

    for (const invoice of legacyInvoices) {
        const issueJournalLines = getPostedJournalLines('INVOICE', invoice._id, 'ISSUE', `invoice legacy ${invoice.invoiceNumber}`);
        assertJournalSide(issueJournalLines, 'accounts_receivable', 'debit', invoice.totalAmount, `invoice legacy ${invoice.invoiceNumber}`);
        assertJournalSide(issueJournalLines, 'freight_revenue', 'credit', invoice.totalAmount, `invoice legacy ${invoice.invoiceNumber}`);
        if (money(invoice.pph23Amount) > 0) {
            const pphLines = getPostedJournalLines('INVOICE', invoice._id, 'PPH23', `PPh 23 invoice legacy ${invoice.invoiceNumber}`);
            assertJournalSide(pphLines, 'prepaid_pph23', 'debit', money(invoice.pph23Amount), `PPh 23 invoice legacy ${invoice.invoiceNumber}`);
            assertJournalSide(pphLines, 'accounts_receivable', 'credit', money(invoice.pph23Amount), `PPh 23 invoice legacy ${invoice.invoiceNumber}`);
        } else {
            assertNoPostedJournal('INVOICE', invoice._id, 'PPH23', `PPh 23 invoice legacy ${invoice.invoiceNumber}`);
        }
    }

    for (const adjustment of invoiceAdjustments) {
        if (adjustment.status === 'APPROVED') {
            const lines = getPostedJournalLines('INVOICE_ADJUSTMENT', adjustment._id, 'APPROVE', `klaim/potongan ${adjustment._id}`);
            assertJournalSide(lines, 'sales_deduction', 'debit', adjustment.amount, `klaim/potongan ${adjustment._id}`);
            assertJournalSide(lines, 'accounts_receivable', 'credit', adjustment.amount, `klaim/potongan ${adjustment._id}`);
        } else {
            assertNoPostedJournal('INVOICE_ADJUSTMENT', adjustment._id, 'APPROVE', `klaim/potongan ${adjustment._id}`);
        }
    }

    const incomesByPayment = groupBy(incomes.filter(row => row.paymentRef), row => row.paymentRef);
    const incomesByReceipt = groupBy(incomes.filter(row => row.receiptRef), row => row.receiptRef);
    for (const income of incomes) {
        assert(money(income.amount) > 0, `Income ${income._id} nominalnya tidak valid.`);
        if (income.sourceType === 'INVOICE_PAYMENT') {
            assert(income.paymentRef && payments.some(row => row._id === income.paymentRef), `Income ${income._id} paymentRef tidak ditemukan.`);
        }
        if (income.sourceType === 'CUSTOMER_RECEIPT') {
            assert(income.receiptRef && receiptById.has(income.receiptRef), `Income ${income._id} receiptRef tidak ditemukan.`);
        }
    }

    for (const payment of payments) {
        const linkedInvoice = getFreightNota(payment.invoiceRef, freightNotaById, legacyInvoiceById);
        assert(linkedInvoice, `Payment ${payment._id} mengarah ke invoice yang tidak ditemukan.`);
        assert(!('status' in linkedInvoice) || linkedInvoice.status !== 'VOID', `Payment ${payment._id} mengarah ke invoice yang sudah dibatalkan.`);
        if (payment.receiptRef) {
            assert(receiptById.has(payment.receiptRef), `Payment alokasi ${payment._id} mengarah ke receipt yang tidak ditemukan.`);
            assert((bankTransactionsByPayment.get(payment._id) || []).length === 0, `Payment alokasi ${payment._id} tidak boleh punya mutasi bank sendiri.`);
            assertNoPostedJournal('PAYMENT', payment._id, 'RECEIVE', `payment alokasi receipt ${payment._id}`);
            assert((incomesByPayment.get(payment._id) || []).length === 0, `Payment alokasi receipt ${payment._id} tidak boleh punya income sendiri.`);
            const receipt = receiptById.get(payment.receiptRef);
            if (receipt?.bankAccountRef && payment.bankAccountRef) {
                assert(payment.bankAccountRef === receipt.bankAccountRef, `Payment alokasi ${payment._id} memakai rekening yang berbeda dari receipt.`);
            }
        } else {
            const linkedTransactions = bankTransactionsByPayment.get(payment._id) || [];
            const netBankMovement = sumBy(linkedTransactions, row => bankDelta(row));
            if (payment.bankAccountRef) {
                assert(linkedTransactions.length >= 1, `Payment ${payment._id} belum punya mutasi bank.`);
                assert(
                    netBankMovement === money(payment.amount),
                    `Net mutasi bank payment ${payment._id} tidak sama nominalnya: ${netBankMovement} vs ${money(payment.amount)}.`
                );
                assert(
                    linkedTransactions.some(row =>
                        row.bankAccountRef === payment.bankAccountRef &&
                        row.type === 'CREDIT' &&
                        money(row.amount) === money(payment.amount)
                    ),
                    `Payment ${payment._id} belum punya mutasi bank aktif sesuai nilai dan rekening terakhir.`
                );
            } else {
                assert(netBankMovement === 0, `Payment ${payment._id} tanpa rekening tidak boleh punya net mutasi bank.`);
            }
            const paymentJournalLines = getPostedJournalLines('PAYMENT', payment._id, 'RECEIVE', `payment ${payment._id}`);
            assertJournalSide(paymentJournalLines, ['cash_on_hand', 'bank'], 'debit', payment.amount, `payment ${payment._id}`);
            assertJournalSide(paymentJournalLines, 'accounts_receivable', 'credit', payment.amount, `payment ${payment._id}`);
            const incomeRows = incomesByPayment.get(payment._id) || [];
            assert(incomeRows.length === 1, `Payment ${payment._id} harus punya tepat 1 income.`);
            assert(money(incomeRows[0].amount) === money(payment.amount), `Income payment ${payment._id} nominalnya tidak sinkron.`);
        }
    }

    const paymentsByReceipt = groupBy(payments.filter(row => row.receiptRef), row => row.receiptRef);
    const refundsByReceipt = groupBy(overpaymentRefunds.filter(row => row.sourceType === 'RECEIPT_UNAPPLIED'), row => row.sourceReceiptRef);
    for (const receipt of customerReceipts) {
        const allocations = paymentsByReceipt.get(receipt._id) || [];
        const allocated = sumBy(allocations, row => row.amount);
        const unapplied = Math.max(money(receipt.totalAmount) - allocated, 0);
        const receiptIncomeRows = incomesByReceipt.get(receipt._id) || [];
        assert(receiptIncomeRows.length === 1, `Penerimaan ${receipt.receiptNumber} harus punya tepat 1 income.`);
        assert(money(receiptIncomeRows[0].amount) === money(receipt.totalAmount), `Income penerimaan ${receipt.receiptNumber} nominalnya tidak sinkron.`);
        assert(allocated <= money(receipt.totalAmount), `Penerimaan ${receipt.receiptNumber} alokasi melebihi total transfer.`);
        assert(money(receipt.allocatedAmount) === allocated, `Penerimaan ${receipt.receiptNumber} allocatedAmount tidak sinkron.`);
        assert(money(receipt.unappliedAmount) === unapplied, `Penerimaan ${receipt.receiptNumber} unappliedAmount tidak sinkron.`);
        assert(money(receipt.allocationCount) === allocations.length, `Penerimaan ${receipt.receiptNumber} allocationCount tidak sinkron.`);
        assert(sumBy(refundsByReceipt.get(receipt._id) || [], row => row.amount) <= unapplied, `Refund sisa penerimaan ${receipt.receiptNumber} melebihi unapplied.`);
        const receiptJournalLines = getPostedJournalLines('CUSTOMER_RECEIPT', receipt._id, 'RECEIVE', `penerimaan ${receipt.receiptNumber}`);
        assertJournalSide(receiptJournalLines, ['cash_on_hand', 'bank'], 'debit', receipt.totalAmount, `penerimaan ${receipt.receiptNumber}`);
        assertJournalSide(receiptJournalLines, 'customer_deposit', 'credit', receipt.totalAmount, `penerimaan ${receipt.receiptNumber}`);
        for (const allocation of allocations) {
            const allocationJournalLines = getPostedJournalLines('CUSTOMER_RECEIPT', `${receipt._id}:${allocation.invoiceRef}`, 'ALLOCATE', `alokasi ${receipt.receiptNumber} ke ${allocation.invoiceRef}`);
            assertJournalSide(allocationJournalLines, 'customer_deposit', 'debit', allocation.amount, `alokasi ${receipt.receiptNumber} ke ${allocation.invoiceRef}`);
            assertJournalSide(allocationJournalLines, 'accounts_receivable', 'credit', allocation.amount, `alokasi ${receipt.receiptNumber} ke ${allocation.invoiceRef}`);
        }
        const linkedTransactions = bankTransactionsByReceipt.get(receipt._id) || [];
        if (receipt.bankAccountRef) {
            assert(linkedTransactions.length === 1, `Penerimaan ${receipt.receiptNumber} harus punya tepat 1 mutasi bank/kas.`);
            assert(linkedTransactions[0].type === 'CREDIT', `Mutasi penerimaan ${receipt.receiptNumber} harus kredit kas/bank.`);
            assert(linkedTransactions[0].bankAccountRef === receipt.bankAccountRef, `Mutasi penerimaan ${receipt.receiptNumber} memakai rekening berbeda.`);
            assert(money(linkedTransactions[0].amount) === money(receipt.totalAmount), `Mutasi penerimaan ${receipt.receiptNumber} tidak sama nominalnya.`);
        } else {
            assert(linkedTransactions.length === 0, `Penerimaan ${receipt.receiptNumber} tanpa rekening tidak boleh punya mutasi bank.`);
        }
    }

    for (const refund of overpaymentRefunds) {
        assert(money(refund.amount) > 0, `Refund overpayment ${refund._id} nominalnya tidak valid.`);
        assert(bankById.has(refund.bankAccountRef), `Refund overpayment ${refund._id} memakai rekening yang tidak ditemukan.`);
        if (refund.sourceType === 'RECEIPT_UNAPPLIED') {
            assert(refund.sourceReceiptRef && receiptById.has(refund.sourceReceiptRef), `Refund overpayment ${refund._id} mengarah ke receipt yang tidak ditemukan.`);
        }
        if (refund.sourceType === 'INVOICE_OVERPAID') {
            const linkedInvoice = refund.sourceInvoiceRef
                ? getFreightNota(refund.sourceInvoiceRef, freightNotaById, legacyInvoiceById)
                : undefined;
            assert(linkedInvoice, `Refund overpayment ${refund._id} mengarah ke invoice yang tidak ditemukan.`);
            assert(!('status' in linkedInvoice) || linkedInvoice.status !== 'VOID', `Refund overpayment ${refund._id} mengarah ke invoice yang sudah dibatalkan.`);
        }
        assert(refund.bankTransactionRef, `Refund overpayment ${refund._id} belum punya bankTransactionRef.`);
        const linkedTransactions = bankTransactionsByOverpaymentRefund.get(refund._id) || [];
        assert(linkedTransactions.length === 1, `Refund overpayment ${refund._id} harus punya tepat 1 mutasi bank.`);
        assert(linkedTransactions[0]._id === refund.bankTransactionRef, `Refund overpayment ${refund._id} bankTransactionRef tidak sinkron.`);
        assert(linkedTransactions[0].type === 'DEBIT', `Refund overpayment ${refund._id} harus tercatat sebagai debit bank/kas.`);
        assert(linkedTransactions[0].bankAccountRef === refund.bankAccountRef, `Refund overpayment ${refund._id} memakai rekening mutasi berbeda.`);
        assert(money(linkedTransactions[0].amount) === money(refund.amount), `Mutasi refund overpayment ${refund._id} tidak sama nominalnya.`);
        const refundJournalLines = getPostedJournalLines('CUSTOMER_OVERPAYMENT_REFUND', refund._id, 'REFUND', `refund overpayment ${refund._id}`);
        assertJournalSide(refundJournalLines, 'customer_deposit', 'debit', refund.amount, `refund overpayment ${refund._id}`);
        assertJournalSide(refundJournalLines, ['cash_on_hand', 'bank'], 'credit', refund.amount, `refund overpayment ${refund._id}`);
    }

    const purchaseItemsByPurchase = groupBy(purchaseItems, row => row.purchaseRef);
    const purchasePaymentsByPurchase = groupBy(purchasePayments, row => row.purchaseRef);
    for (const purchase of purchases) {
        const summary = computePurchaseSummary({
            purchase,
            items: purchaseItemsByPurchase.get(purchase._id) || [],
            payments: purchasePaymentsByPurchase.get(purchase._id) || [],
        });
        assert(money(purchase.totalAmount) === summary.totalAmount, `Pembelian ${purchase.purchaseNumber} totalAmount tidak sinkron.`);
        assert(money(purchase.paidAmount) === summary.paidAmount, `Pembelian ${purchase.purchaseNumber} paidAmount tidak sinkron.`);
        assert(money(purchase.outstandingAmount) === summary.outstandingAmount, `Pembelian ${purchase.purchaseNumber} outstandingAmount tidak sinkron.`);
        assert(money(purchase.totalOrderedQty) === money(summary.totalOrderedQty), `Pembelian ${purchase.purchaseNumber} totalOrderedQty tidak sinkron.`);
        assert(money(purchase.totalReceivedQty) === money(summary.totalReceivedQty), `Pembelian ${purchase.purchaseNumber} totalReceivedQty tidak sinkron.`);
        assert(purchase.status === summary.status, `Status pembelian ${purchase.purchaseNumber} tidak sinkron.`);

        const receivedValue = sumBy(purchaseItemsByPurchase.get(purchase._id) || [], row => money(row.receivedQty) * money(row.unitPrice));
        const receiveJournalLines = postedJournals
            .filter(row => row.sourceType === 'PURCHASE' && row.sourceEvent === 'RECEIVE' && row.sourceNumber === purchase.purchaseNumber)
            .flatMap(row => journalLinesByEntry.get(row._id) || []);
        if (receivedValue > 0) {
            assert(receiveJournalLines.length > 0, `Pembelian ${purchase.purchaseNumber} sudah menerima barang tapi belum punya jurnal persediaan.`);
            assertJournalSide(receiveJournalLines, 'inventory', 'debit', receivedValue, `penerimaan barang ${purchase.purchaseNumber}`);
            assertJournalSide(receiveJournalLines, 'accounts_payable', 'credit', receivedValue, `penerimaan barang ${purchase.purchaseNumber}`);
        } else {
            assert(receiveJournalLines.length === 0, `Pembelian ${purchase.purchaseNumber} belum menerima barang tapi punya jurnal persediaan.`);
        }
    }

    for (const payment of purchasePayments) {
        assert(purchaseById.has(payment.purchaseRef), `Pembayaran supplier ${payment._id} mengarah ke pembelian yang tidak ditemukan.`);
        const linkedTransactions = bankTransactions.filter(row => row.relatedPurchasePaymentRef === payment._id);
        assert(linkedTransactions.length === 1, `Pembayaran supplier ${payment._id} harus punya tepat 1 mutasi bank.`);
        assert(money(linkedTransactions[0].amount) === money(payment.amount), `Mutasi bank pembayaran supplier ${payment._id} tidak sama nominalnya.`);
        const paymentJournalLines = getPostedJournalLines('PURCHASE_PAYMENT', payment._id, 'PAY', `pembayaran supplier ${payment._id}`);
        assertJournalSide(paymentJournalLines, 'accounts_payable', 'debit', payment.amount, `pembayaran supplier ${payment._id}`);
        assertJournalSide(paymentJournalLines, ['cash_on_hand', 'bank'], 'credit', payment.amount, `pembayaran supplier ${payment._id}`);
    }

    const stockMovementEvents = ['MANUAL_IN', 'MANUAL_OUT', 'MAINTENANCE_USAGE'];
    let expectedInventoryUsageDelta = 0;
    for (const movement of stockMovements) {
        const warehouseItem = warehouseItemById.get(movement.warehouseItemRef);
        assert(warehouseItem, `Mutasi stok ${movement._id} mengarah ke barang gudang yang tidak ditemukan.`);
        const movementQuantity = quantity(movement.quantity);
        assert(movementQuantity > 0, `Mutasi stok ${movement._id} quantity tidak valid.`);

        for (const event of stockMovementEvents) {
            if (event !== movement.sourceType) {
                assertNoPostedJournal('STOCK_MOVEMENT', movement._id, event, `mutasi stok stale ${movement._id}/${event}`);
            }
        }

        const unitValue = money(movement.unitCostSnapshot) > 0
            ? money(movement.unitCostSnapshot)
            : money(warehouseItem.defaultPurchasePrice);
        const snapshotValue = money(movement.subtotalCost);
        const movementValue = snapshotValue > 0 ? snapshotValue : money(movementQuantity * unitValue);
        if (snapshotValue > 0 && unitValue > 0) {
            assert(
                money(movementQuantity * unitValue) === snapshotValue,
                `Mutasi stok ${movement._id} subtotalCost tidak sinkron dengan quantity x unitCostSnapshot.`
            );
        }
        const shouldHaveUsageJournal = stockMovementEvents.includes(movement.sourceType) && movementValue > 0;
        if (!shouldHaveUsageJournal) continue;

        const movementLines = getPostedJournalLines('STOCK_MOVEMENT', movement._id, movement.sourceType, `mutasi stok ${movement._id}`);
        if (movement.type === 'IN' && movement.sourceType === 'MANUAL_IN') {
            expectedInventoryUsageDelta += movementValue;
            assertJournalSide(movementLines, 'inventory', 'debit', movementValue, `mutasi stok ${movement._id}`);
            assertJournalSide(movementLines, 'inventory_usage_expense', 'credit', movementValue, `mutasi stok ${movement._id}`);
        } else {
            expectedInventoryUsageDelta -= movementValue;
            assertJournalSide(movementLines, 'inventory_usage_expense', 'debit', movementValue, `mutasi stok ${movement._id}`);
            assertJournalSide(movementLines, 'inventory', 'credit', movementValue, `mutasi stok ${movement._id}`);
        }
    }

    const disbursementsByVoucher = groupBy(activeDriverVoucherDisbursements, row => row.voucherRef);
    const voucherItemsByVoucher = groupBy(driverVoucherItems, row => row.voucherRef);
    const expensesByVoucher = groupBy(expenses.filter(row => row.voucherRef), row => row.voucherRef);
    for (const voucher of driverVouchers) {
        const disbursements = disbursementsByVoucher.get(voucher._id) || [];
        const items = voucherItemsByVoucher.get(voucher._id) || [];
        const initialCashGiven = sumBy(disbursements.filter(row => row.kind === 'INITIAL'), row => row.amount);
        const totalIssuedAmount = sumBy(disbursements, row => row.amount);
        const totalSpent = sumBy(items, row => row.amount);
        const summary = getDriverVoucherFinancialSummary({
            initialCashGiven,
            cashGiven: initialCashGiven,
            totalIssuedAmount,
            totalSpent,
            driverFeeAmount: voucher.driverFeeAmount,
        });
        assert(money(voucher.initialCashGiven) === summary.initialCashGiven, `Bon ${voucher.bonNumber} initialCashGiven tidak sinkron.`);
        assert(money(voucher.totalIssuedAmount) === summary.totalIssuedAmount, `Bon ${voucher.bonNumber} totalIssuedAmount tidak sinkron.`);
        assert(money(voucher.totalSpent) === summary.totalSpent, `Bon ${voucher.bonNumber} totalSpent tidak sinkron.`);
        assert(money(voucher.totalClaimAmount) === summary.totalClaimAmount, `Bon ${voucher.bonNumber} totalClaimAmount tidak sinkron.`);
        assert(money(voucher.balance) === summary.balance, `Bon ${voucher.bonNumber} balance tidak sinkron.`);
        if (summary.initialCashGiven > 0) {
            const issueLines = getPostedJournalLines('DRIVER_VOUCHER', voucher._id, 'ISSUE', `pencairan awal bon ${voucher.bonNumber}`);
            assertJournalSide(issueLines, 'driver_advance', 'debit', summary.initialCashGiven, `pencairan awal bon ${voucher.bonNumber}`);
            assertJournalSide(issueLines, ['cash_on_hand', 'bank'], 'credit', summary.initialCashGiven, `pencairan awal bon ${voucher.bonNumber}`);
        }
        if (voucher.status === 'SETTLED') {
            assert(Boolean(voucher.settledDate), `Bon ${voucher.bonNumber} SETTLED tanpa settledDate.`);
            assert(sumBy(expensesByVoucher.get(voucher._id) || [], row => row.amount) === summary.totalClaimAmount, `Expense settlement bon ${voucher.bonNumber} tidak sama dengan total klaim.`);
            const settlementLines = getPostedJournalLines('DRIVER_VOUCHER', voucher._id, 'SETTLE', `settlement bon ${voucher.bonNumber}`);
            assertJournalSide(settlementLines, 'trip_misc_expense', 'debit', summary.totalSpent, `settlement bon ${voucher.bonNumber}`);
            assertJournalSide(settlementLines, 'driver_fee_expense', 'debit', money(voucher.driverFeeAmount), `settlement bon ${voucher.bonNumber}`);
            assertJournalSide(settlementLines, 'driver_advance', 'credit', summary.totalIssuedAmount, `settlement bon ${voucher.bonNumber}`);
            if (summary.balance > 0) {
                assertJournalSide(settlementLines, ['cash_on_hand', 'bank'], 'debit', summary.balance, `pengembalian sisa bon ${voucher.bonNumber}`);
            }
            if (summary.balance < 0) {
                assertJournalSide(settlementLines, ['cash_on_hand', 'bank'], 'credit', Math.abs(summary.balance), `kekurangan bon ${voucher.bonNumber}`);
            }
        }
    }

    for (const disbursement of activeDriverVoucherDisbursements) {
        assert(voucherById.has(disbursement.voucherRef), `Pencairan bon ${disbursement._id} mengarah ke voucher yang tidak ditemukan.`);
        if (disbursement.bankTransactionRef) {
            const transaction = bankTransactions.find(row => row._id === disbursement.bankTransactionRef);
            assert(transaction, `Pencairan bon ${disbursement._id} punya bankTransactionRef yang tidak ditemukan.`);
            assert(transaction?.type === 'DEBIT', `Pencairan bon ${disbursement._id} harus tercatat sebagai debit bank/kas.`);
            assert(money(transaction?.amount) === money(disbursement.amount), `Mutasi pencairan bon ${disbursement._id} tidak sama nominalnya.`);
        }
        if (disbursement.kind === 'TOP_UP') {
            const topUpLines = getPostedJournalLines('DRIVER_VOUCHER_DISBURSEMENT', disbursement._id, 'TOP_UP', `top up bon ${disbursement._id}`);
            assertJournalSide(topUpLines, 'driver_advance', 'debit', disbursement.amount, `top up bon ${disbursement._id}`);
            assertJournalSide(topUpLines, ['cash_on_hand', 'bank'], 'credit', disbursement.amount, `top up bon ${disbursement._id}`);
        }
    }

    for (const disbursement of voidedDriverVoucherDisbursements) {
        assert(voucherById.has(disbursement.voucherRef), `Pencairan bon void ${disbursement._id} mengarah ke voucher yang tidak ditemukan.`);
        assert(disbursement.kind === 'TOP_UP', `Pencairan bon void ${disbursement._id} harus berupa TOP_UP, bukan bon awal.`);
        assert(Boolean(disbursement.voidedAt), `Pencairan bon void ${disbursement._id} belum punya voidedAt.`);
        assertNoPostedJournal('DRIVER_VOUCHER_DISBURSEMENT', disbursement._id, 'TOP_UP', `top up void ${disbursement._id}`);
        if (disbursement.bankTransactionRef) {
            const originalTransaction = bankTransactionById.get(disbursement.bankTransactionRef);
            assert(originalTransaction, `Pencairan bon void ${disbursement._id} kehilangan mutasi bank awal.`);
            assert(originalTransaction.type === 'DEBIT', `Mutasi awal pencairan bon void ${disbursement._id} harus DEBIT.`);
            assert(money(originalTransaction.amount) === money(disbursement.amount), `Mutasi awal pencairan bon void ${disbursement._id} tidak sama nominalnya.`);
            assert(disbursement.reversalBankTransactionRef, `Pencairan bon void ${disbursement._id} belum punya mutasi pembalik.`);
            const reversalTransaction = bankTransactionById.get(disbursement.reversalBankTransactionRef);
            assert(reversalTransaction, `Mutasi pembalik pencairan bon void ${disbursement._id} tidak ditemukan.`);
            assert(reversalTransaction.type === 'CREDIT', `Mutasi pembalik pencairan bon void ${disbursement._id} harus CREDIT.`);
            assert(money(reversalTransaction.amount) === money(disbursement.amount), `Mutasi pembalik pencairan bon void ${disbursement._id} tidak sama nominalnya.`);
            assert(reversalTransaction.reversesBankTransactionRef === disbursement.bankTransactionRef, `Mutasi pembalik pencairan bon void ${disbursement._id} tidak mereferensikan mutasi awal.`);
        }
    }

    const bankTransactionsByExpense = groupBy(bankTransactions, row => row.relatedExpenseRef);
    for (const expense of expenses) {
        assert(money(expense.amount) > 0, `Pengeluaran ${expense._id} nominalnya tidak valid.`);
        if (expense.bankAccountRef) {
            const linkedTransactions = bankTransactionsByExpense.get(expense._id) || [];
            assert(linkedTransactions.length === 1, `Pengeluaran ${expense._id} harus punya tepat 1 mutasi bank.`);
            assert(linkedTransactions[0].type === 'DEBIT', `Mutasi pengeluaran ${expense._id} harus DEBIT.`);
            assert(linkedTransactions[0].bankAccountRef === expense.bankAccountRef, `Mutasi pengeluaran ${expense._id} memakai rekening berbeda.`);
            assert(money(linkedTransactions[0].amount) === money(expense.amount), `Mutasi pengeluaran ${expense._id} tidak sama nominalnya.`);
            const expenseJournalLines = getPostedJournalLines('EXPENSE', expense._id, 'CREATE', `pengeluaran ${expense._id}`);
            assertJournalSide(expenseJournalLines, ['operational_expense', 'trip_misc_expense', 'driver_fee_expense', 'maintenance_expense', 'incident_expense'], 'debit', expense.amount, `pengeluaran ${expense._id}`);
            assertJournalSide(expenseJournalLines, ['cash_on_hand', 'bank'], 'credit', expense.amount, `pengeluaran ${expense._id}`);
        }
    }

    for (const item of driverVoucherItems) {
        assert(voucherById.has(item.voucherRef), `Item bon ${item._id} mengarah ke voucher yang tidak ditemukan.`);
    }

    const expectedAccountsReceivable = sumBy(activeFreightNotas, row => getReceivableNetAmount(row))
        + sumBy(legacyInvoices, row => getReceivableNetAmount(row))
        - sumBy(payments.filter(row => getFreightNota(row.invoiceRef, freightNotaById, legacyInvoiceById)), row => row.amount);
    const actualAccountsReceivable = journalBalance(postedJournalLines, accountById, ['accounts_receivable'], 'debit');
    assert(
        actualAccountsReceivable === expectedAccountsReceivable,
        `Saldo buku besar piutang tidak sinkron: ledger ${actualAccountsReceivable}, expected ${expectedAccountsReceivable}.`
    );

    const expectedCustomerDeposit = sumBy(customerReceipts, row => row.totalAmount)
        - sumBy(payments.filter(row => row.receiptRef), row => row.amount)
        - sumBy(overpaymentRefunds.filter(row => row.sourceType === 'RECEIPT_UNAPPLIED'), row => row.amount);
    const actualCustomerDeposit = journalBalance(postedJournalLines, accountById, ['customer_deposit'], 'credit');
    assert(
        actualCustomerDeposit === expectedCustomerDeposit,
        `Saldo buku besar titipan customer tidak sinkron: ledger ${actualCustomerDeposit}, expected ${expectedCustomerDeposit}.`
    );

    const expectedAccountsPayable = sumBy(purchaseItems, row => money(row.receivedQty) * money(row.unitPrice))
        - sumBy(purchasePayments, row => row.amount);
    const actualAccountsPayable = journalBalance(postedJournalLines, accountById, ['accounts_payable'], 'credit');
    assert(
        actualAccountsPayable === expectedAccountsPayable,
        `Saldo buku besar hutang supplier tidak sinkron: ledger ${actualAccountsPayable}, expected ${expectedAccountsPayable}.`
    );

    const expectedInventoryBalance = sumBy(purchaseItems, row => money(row.receivedQty) * money(row.unitPrice))
        + expectedInventoryUsageDelta;
    const actualInventoryBalance = journalBalance(postedJournalLines, accountById, ['inventory'], 'debit');
    assert(
        actualInventoryBalance === expectedInventoryBalance,
        `Saldo buku besar inventory tidak sinkron: ledger ${actualInventoryBalance}, expected ${expectedInventoryBalance}.`
    );

    const expectedBankMovement = sumBy(bankAccounts, row => row.currentBalance);
    const actualBankMovement = journalBalance(postedJournalLines, accountById, ['cash_on_hand', 'bank'], 'debit');
    assert(
        actualBankMovement === expectedBankMovement,
        `Saldo buku besar kas/bank tidak sinkron: ledger ${actualBankMovement}, expected ${expectedBankMovement}.`
    );

    const expectedDriverAdvance = sumBy(driverVouchers.filter(row => row.status !== 'SETTLED'), row => row.totalIssuedAmount);
    const actualDriverAdvance = journalBalance(postedJournalLines, accountById, ['driver_advance'], 'debit');
    assert(
        actualDriverAdvance === expectedDriverAdvance,
        `Saldo buku besar uang muka supir tidak sinkron: ledger ${actualDriverAdvance}, expected ${expectedDriverAdvance}.`
    );

    for (const journal of journalEntries) {
        const sourceRef = journal.sourceRef;
        assert(sourceRef, `Jurnal ${journal.entryNumber} tidak punya sourceRef.`);
        if (journal.sourceType === 'PAYMENT') assert(payments.some(row => row._id === sourceRef), `Jurnal payment ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'CUSTOMER_RECEIPT') assert(receiptById.has(sourceRef.split(':')[0]), `Jurnal penerimaan ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'INVOICE_ADJUSTMENT') assert(invoiceAdjustments.some(row => row._id === sourceRef), `Jurnal adjustment ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'CUSTOMER_OVERPAYMENT_REFUND') assert(overpaymentRefunds.some(row => row._id === sourceRef), `Jurnal refund ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'EXPENSE') assert(expenseById.has(sourceRef), `Jurnal expense ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'PURCHASE_PAYMENT') assert(purchasePaymentById.has(sourceRef), `Jurnal pembayaran supplier ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'DRIVER_VOUCHER') assert(voucherById.has(sourceRef), `Jurnal bon ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'DRIVER_VOUCHER_DISBURSEMENT') assert(disbursementById.has(sourceRef), `Jurnal top up bon ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'FREIGHT_NOTA') assert(getFreightNota(sourceRef, freightNotaById, legacyInvoiceById), `Jurnal invoice ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'INVOICE') assert(legacyInvoiceById.has(sourceRef), `Jurnal invoice legacy ${journal.entryNumber} orphan.`);
        if (journal.sourceType === 'BANK_ACCOUNT') assert(bankById.has(sourceRef), `Jurnal saldo awal rekening ${journal.entryNumber} orphan.`);
    }

    console.log(JSON.stringify({
        ok: true,
        summary: {
            bankAccounts: bankAccounts.length,
            bankTransactions: bankTransactions.length,
            freightNotas: freightNotas.length,
            payments: payments.length,
            customerReceipts: customerReceipts.length,
            incomes: incomes.length,
            purchases: purchases.length,
            purchasePayments: purchasePayments.length,
            stockMovements: stockMovements.length,
            driverVouchers: driverVouchers.length,
            postedJournals: postedJournals.length,
        },
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});

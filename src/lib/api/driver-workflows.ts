import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import { buildDriverVoucherRouteLabel } from '@/lib/driver-voucher-route';
import {
    inferExpenseCategoryScope,
    resolveExpenseCategoryAccountKey,
} from '@/lib/expense-category-scope';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    createDocument,
    deleteDocument,
    getAllDocuments,
    getCompanyProfile,
    getDocumentById,
    getNextNumber,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import type { CompanyProfile, DriverVoucher, Expense } from '@/lib/types';
import { normalizeTripOwnership } from '@/lib/types';

import {
    assertIsoDate,
    computeLedgerDebitBalance,
    ensureCashAccount,
    extractRefId,
    getLedgerAccount,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizePaymentMethod,
    normalizeText,
    readLedgerBalance,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import { recomputeBankLedgerBalancesForAccounts } from './bank-balance-helpers';
import {
    computeDriverVoucherTotals,
    getDriverVoucherInitialCash,
    getDriverVoucherIssuedAmount,
    isDriverBoronganRowEmpty,
    summarizeBoronganDeliveryOrderItems,
    type DriverBoronganDeliveryOrderItemSummarySource,
} from './driver-workflow-support';
import { syncPostedIncidentSettlementLinesToDriverVoucher } from './incident-voucher-linking';
import {
    postDriverVoucherIssueJournal,
    postDriverVoucherSettlementJournal,
    postDriverVoucherTopUpJournal,
    postExpenseJournal,
    voidJournalEntryForSource,
} from './accounting-posting';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type NormalizedDriverBoronganRow = {
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
};

type DriverBoronganDeliveryOrderSource = {
    _id: string;
    _rev?: string;
    status?: string;
    orderRef?: unknown;
    doNumber?: string;
    customerDoNumber?: string;
    vehiclePlate?: string;
    driverRef?: unknown;
    receiverAddress?: string;
    date?: string;
    taripBorongan?: number;
    keteranganBorongan?: string;
};

type ExpenseCategoryOption = {
    _id: string;
    name?: string;
    active?: boolean;
    scope?: 'GENERAL' | 'TRIP' | 'MAINTENANCE' | 'INCIDENT' | 'DRIVER_FEE';
    allowManual?: boolean;
    accountSystemKey?: string;
};

type VoucherPostedExpense = {
    _id: string;
    categoryName?: string;
    amount?: number;
    description?: string;
    voucherRef?: string;
};

type VoucherBankTransaction = {
    _id: string;
    type?: string;
    amount?: number;
    description?: string;
    relatedVoucherRef?: string;
};

function formatAuditMoney(amount: number) {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function getExpenseCategoryKey(value: unknown) {
    return (normalizeOptionalText(value) || '').toLowerCase();
}

const DRIVER_VOUCHER_CATEGORY_ALIASES = new Map<string, string>([
    ['parkir', 'Tol & Parkir'],
    ['uang parkir', 'Tol & Parkir'],
    ['makan', 'Konsumsi Driver'],
    ['makan driver', 'Konsumsi Driver'],
    ['konsumsi', 'Konsumsi Driver'],
    ['menginap', 'Menginap Driver'],
    ['hotel', 'Menginap Driver'],
    ['perbaikan', 'Perbaikan Darurat Trip'],
    ['perbaikan darurat', 'Perbaikan Darurat Trip'],
    ['mogok', 'Perbaikan Darurat Trip'],
    ['towing', 'Towing / Evakuasi'],
    ['evakuasi', 'Towing / Evakuasi'],
    ['lain-lain', 'Lain-lain Trip'],
    ['lain lain', 'Lain-lain Trip'],
]);

function inferDriverVoucherRequestedCategoryScope(requestedName: string) {
    const key = getExpenseCategoryKey(requestedName);
    if (/borongan|upah|overtonase/.test(key)) return 'DRIVER_FEE';
    if (/perbaikan|darurat|mogok|towing|evakuasi|insiden|kecelakaan|santunan/.test(key)) return 'INCIDENT';
    return 'TRIP';
}

function resolveExpenseCategory(
    categories: ExpenseCategoryOption[],
    requestedName: string
) {
    const activeCategories = categories.filter(category => category.active !== false);
    const byName = new Map(
        activeCategories
            .map(category => [getExpenseCategoryKey(category.name), category] as const)
            .filter(([key]) => Boolean(key))
    );
    const requestedKey = getExpenseCategoryKey(requestedName);
    const aliasName = DRIVER_VOUCHER_CATEGORY_ALIASES.get(requestedKey);
    if (aliasName) {
        return byName.get(getExpenseCategoryKey(aliasName)) || null;
    }

    const exactMatch = byName.get(requestedKey);
    if (exactMatch) return exactMatch;

    const targetScope = inferDriverVoucherRequestedCategoryScope(requestedName);
    const scopedCandidates = activeCategories.filter(category =>
        inferExpenseCategoryScope({ ...category, name: category.name || requestedName }) === targetScope
    );
    return scopedCandidates.length === 1 ? scopedCandidates[0] : null;
}

function hasMatchingVoucherExpense(
    expenses: VoucherPostedExpense[],
    categoryName: string,
    amount: number,
    description: string
) {
    return expenses.some(expense =>
        getExpenseCategoryKey(expense.categoryName) === getExpenseCategoryKey(categoryName) &&
        normalizeNumber(expense.amount || 0, { maxFractionDigits: 0 }) === normalizeCurrencyNumber(amount) &&
        normalizeText(expense.description) === normalizeText(description)
    );
}

function hasMatchingVoucherBankTransaction(
    transactions: VoucherBankTransaction[],
    type: string,
    amount: number,
    description: string
) {
    return transactions.some(transaction =>
        transaction.type === type &&
        normalizeNumber(transaction.amount || 0, { maxFractionDigits: 0 }) === normalizeCurrencyNumber(amount) &&
        normalizeText(transaction.description) === normalizeText(description)
    );
}

type DriverBoronganOrderSource = {
    _id: string;
    receiverAddress?: string;
};

function validateIsoDateOrResponse(dateValue: string, label: string, fallbackMessage: string) {
    try {
        assertIsoDate(dateValue, label);
        return null;
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : fallbackMessage },
            { status: 400 }
        );
    }
}

function parseOptionalStrictBoronganRowNumber(
    value: unknown,
    label: string,
    options?: { allowDecimal?: boolean; maxFractionDigits?: number }
) {
    if (value === undefined || value === null) {
        return 0;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return 0;
        }
        if (!/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            throw new Error(label);
        }
    }

    const normalized = normalizeNumber(value, options);
    if (!Number.isFinite(normalized)) {
        throw new Error(label);
    }
    return normalized;
}

export async function handleDriverBoronganCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    let resolvedDriverRef = normalizeOptionalText(data.driverRef);
    const driverName = normalizeText(data.driverName);

    const periodStart = normalizeText(data.periodStart) || getBusinessDateValue();
    const periodStartError = validateIsoDateOrResponse(
        periodStart,
        'Periode mulai borongan',
        'Periode mulai borongan tidak valid'
    );
    if (periodStartError) {
        return periodStartError;
    }
    const periodEnd = normalizeText(data.periodEnd) || periodStart;
    const periodEndError = validateIsoDateOrResponse(
        periodEnd,
        'Periode akhir borongan',
        'Periode akhir borongan tidak valid'
    );
    if (periodEndError) {
        return periodEndError;
    }
    if (periodEnd < periodStart) {
        return NextResponse.json({ error: 'Periode akhir borongan tidak boleh sebelum periode mulai' }, { status: 400 });
    }

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    let rows: NormalizedDriverBoronganRow[];
    try {
        rows = rawRows
            .filter(isPlainObject)
            .filter(row => !isDriverBoronganRowEmpty(row))
            .map<NormalizedDriverBoronganRow>(row => {
                const date = normalizeText(row.date);
                const doRef = normalizeOptionalText(row.doRef);
                const doNumber = normalizeOptionalText(row.doNumber);
                const noSJ = normalizeText(row.noSJ);
                const tujuan = normalizeText(row.tujuan);
                const beratKg = normalizeNumber(row.beratKg);
                const tarip = normalizeCurrencyNumber(row.tarip);
                const collie = parseOptionalStrictBoronganRowNumber(
                    row.collie,
                    'Collie pada baris borongan tidak valid',
                    { maxFractionDigits: 2 }
                );

                if (date) {
                    assertIsoDate(date, 'Tanggal pada baris borongan');
                }
                if ((!date || !noSJ || !tujuan) && !doRef) {
                    throw new Error('Baris borongan wajib punya tanggal, nomor SJ, dan tujuan');
                }
                if (!Number.isFinite(beratKg) || beratKg < 0) {
                    throw new Error('Berat pada baris borongan tidak valid');
                }
                if ((!Number.isFinite(tarip) || tarip <= 0) && !doRef) {
                    throw new Error('Tarif borongan pada baris harus lebih besar dari 0');
                }
                if (!Number.isFinite(collie) || collie < 0) {
                    throw new Error('Collie pada baris borongan tidak valid');
                }

                return {
                    doRef,
                    doNumber,
                    vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                    date,
                    noSJ,
                    tujuan,
                    barang: normalizeOptionalText(row.barang),
                    collie: collie > 0 ? collie : undefined,
                    beratKg,
                    tarip,
                    uangRp: tarip,
                    ket: normalizeOptionalText(row.ket),
                };
            });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Baris borongan tidak valid' },
            { status: 400 }
        );
    }

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris borongan wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];
    if (uniqueDoRefs.length !== doRefs.length) {
        return NextResponse.json({ error: 'DO yang sama tidak boleh dimasukkan dua kali dalam slip borongan' }, { status: 400 });
    }

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await listDocumentsByFilter<DriverBoronganDeliveryOrderSource>('deliveryOrder', { _id: uniqueDoRefs })
        : [];

    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO borongan tidak ditemukan' }, { status: 404 });
    }

    const orderRefs = [...new Set(
        deliveryOrders
            .map(item => extractRefId(item.orderRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const sourceOrders = orderRefs.length > 0
        ? await listDocumentsByFilter<DriverBoronganOrderSource>('order', { _id: orderRefs })
        : [];
    const deliveryOrderItems = uniqueDoRefs.length > 0
        ? (await getAllDocuments<DriverBoronganDeliveryOrderItemSummarySource>('deliveryOrderItem'))
            .filter(item => {
                const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
                return Boolean(deliveryOrderRef && uniqueDoRefs.includes(deliveryOrderRef));
            })
        : [];

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(sourceOrders.map(order => [order._id, order]));
    const doItemMap = new Map<string, DriverBoronganDeliveryOrderItemSummarySource[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = doItemMap.get(deliveryOrderRef) || [];
        current.push(item);
        doItemMap.set(deliveryOrderRef, current);
    }

    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO borongan tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status !== 'DELIVERED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} belum selesai dikirim` }, { status: 409 });
        }
        if (resolvedDriverRef) {
            const deliveryOrderDriverRef = extractRefId(deliveryOrder.driverRef);
            if (deliveryOrderDriverRef && deliveryOrderDriverRef !== resolvedDriverRef) {
                return NextResponse.json(
                    { error: `DO ${deliveryOrder.doNumber || deliveryOrder._id} bukan milik supir yang dipilih` },
                    { status: 409 }
                );
            }
        }
        const orderRef = extractRefId(deliveryOrder.orderRef);
        const sourceOrder = orderRef ? orderMap.get(orderRef) : undefined;
        const itemSummary = summarizeBoronganDeliveryOrderItems(doItemMap.get(row.doRef) || []);

        row.doNumber = normalizeOptionalText(deliveryOrder.doNumber) || row.doNumber;
        row.noSJ =
            normalizeOptionalText(deliveryOrder.customerDoNumber) ||
            row.noSJ ||
            '';
        row.vehiclePlate = normalizeOptionalText(deliveryOrder.vehiclePlate) || row.vehiclePlate;
        row.date = normalizeOptionalText(deliveryOrder.date) || row.date || '';
        row.tujuan =
            normalizeOptionalText(deliveryOrder.receiverAddress) ||
            normalizeOptionalText(sourceOrder?.receiverAddress) ||
            row.tujuan ||
            '';
        row.barang = itemSummary.barang || row.barang || undefined;
        if (itemSummary.collie > 0) {
            row.collie = itemSummary.collie;
        } else if (!row.collie || row.collie <= 0) {
            row.collie = undefined;
        }
        if (itemSummary.beratKg > 0) {
            row.beratKg = itemSummary.beratKg;
        } else if (!Number.isFinite(row.beratKg) || row.beratKg <= 0) {
            row.beratKg = itemSummary.beratKg;
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            row.tarip = normalizeNumber(deliveryOrder.taripBorongan || 0);
        }
        row.ket = row.ket || normalizeOptionalText(deliveryOrder.keteranganBorongan);
        row.uangRp = row.tarip;
    }

    for (const row of rows) {
        if (!row.date || !row.noSJ || !row.tujuan) {
            return NextResponse.json(
                { error: `Baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} masih kurang tanggal, nomor SJ, atau tujuan` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.beratKg) || row.beratKg < 0) {
            return NextResponse.json(
                { error: `Berat pada baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            return NextResponse.json(
                { error: `Tarif borongan pada baris ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        row.uangRp = row.tarip;
    }

    if (uniqueDoRefs.length > 0) {
        const existingBoronganItems = await listDocumentsByFilter<Array<{ doRef?: string; doNumber?: string }>[number]>(
            'driverBoronganItem',
            { doRef: uniqueDoRefs }
        );
        if (existingBoronganItems.length > 0) {
            const duplicate = existingBoronganItems[0];
            return NextResponse.json(
                { error: `DO ${duplicate.doNumber || duplicate.doRef || ''} sudah tercantum di slip borongan lain` },
                { status: 409 }
            );
        }

        const existingVoucherTrips = await listDocumentsByFilter<Array<{ doNumber?: string; bonNumber?: string }>[number]>(
            'driverVoucher',
            { deliveryOrderRef: uniqueDoRefs }
        );
        if (existingVoucherTrips.length > 0) {
            const duplicateVoucher = existingVoucherTrips[0];
            return NextResponse.json(
                {
                    error: `DO ${duplicateVoucher.doNumber || ''} sudah memakai penyelesaian uang jalan di bon ${duplicateVoucher.bonNumber || ''}. Jangan dobel lewat slip borongan.`,
                },
                { status: 409 }
            );
        }
    }

    const inferredDriverRefs = [...new Set(
        deliveryOrders
            .map(deliveryOrder => extractRefId(deliveryOrder.driverRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    if (inferredDriverRefs.length > 1) {
        return NextResponse.json(
            { error: 'DO yang dipilih berasal dari supir berbeda. Pisahkan per slip borongan.' },
            { status: 409 }
        );
    }

    const inferredDriverRef = inferredDriverRefs[0];
    if (resolvedDriverRef && inferredDriverRef && resolvedDriverRef !== inferredDriverRef) {
        return NextResponse.json(
            { error: 'Supir borongan tidak cocok dengan DO yang dipilih' },
            { status: 409 }
        );
    }
    if (!resolvedDriverRef && inferredDriverRef) {
        resolvedDriverRef = inferredDriverRef;
    }

    const driverDerivedFromDo = Boolean(inferredDriverRef && inferredDriverRef === resolvedDriverRef && deliveryOrders.length > 0);
    let finalDriverName = driverName;
    let selectedDriver: { _id: string; name?: string; active?: boolean } | null = null;
    if (resolvedDriverRef) {
        const driverDoc = await getDocumentById<{ _id: string; name?: string; active?: boolean }>(resolvedDriverRef, 'driver');
        if (!driverDoc) {
            return NextResponse.json({ error: 'Supir borongan tidak ditemukan' }, { status: 404 });
        }
        selectedDriver = driverDoc;
        if (driverDoc.active === false && !driverDerivedFromDo) {
            return NextResponse.json({ error: 'Supir borongan tidak aktif untuk slip manual' }, { status: 409 });
        }
        if (driverDoc?.name) {
            finalDriverName = driverDoc.name;
        }
    }
    if (!finalDriverName) {
        return NextResponse.json({ error: 'Nama supir borongan wajib diisi' }, { status: 400 });
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.uangRp, 0);
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total borongan harus lebih besar dari 0' }, { status: 400 });
    }

    const boronganId = crypto.randomUUID();
    const boronganNumber = await getNextNumber('borong', periodEnd);
    const companyProfile = await getCompanyProfile<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'>>();
    const boronganDoc = {
        _id: boronganId,
        _type: 'driverBorongan',
        issuerCompanyName: companyProfile?.name,
        issuerCompanyAddress: companyProfile?.address,
        issuerCompanyPhone: companyProfile?.phone,
        issuerCompanyEmail: companyProfile?.email,
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
        driverRef: resolvedDriverRef,
        driverName: finalDriverName,
        periodStart,
        periodEnd,
        status: 'UNPAID',
        totalAmount,
        totalCollie,
        totalWeightKg,
        notes: normalizeOptionalText(data.notes),
        boronganNumber,
    };

    const mutationTimestamp = new Date().toISOString();
    await createDocument(boronganDoc);
    if (selectedDriver?._id) {
        await updateDocument(selectedDriver._id, { updatedAt: mutationTimestamp }, 'driver');
    }
    await Promise.all(rows.map(row => createDocument({
            _id: crypto.randomUUID(),
            _type: 'driverBoronganItem',
            boronganRef: boronganId,
            doRef: row.doRef,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
            tujuan: row.tujuan,
            barang: row.barang,
            collie: row.collie,
            beratKg: row.beratKg,
            tarip: row.tarip,
            uangRp: row.uangRp,
            ket: row.ket,
        })));
    if (uniqueDoRefs.length > 0) {
        await Promise.all(deliveryOrders.map(deliveryOrder =>
            updateDocument(deliveryOrder._id, { updatedAt: mutationTimestamp }, 'deliveryOrder')
        ));
    }
    await addAuditLog(session, 'CREATE', 'driver-borongans', boronganId, `Created driver-borongans: ${boronganNumber}`);
    return NextResponse.json({ data: boronganDoc, id: boronganId });
}

export async function handleDriverBoronganDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Borongan tidak valid' }, { status: 400 });
    }

    const borongan = await getDocumentById<{ _id: string; boronganNumber?: string; status?: string }>(id, 'driverBorongan');
    if (!borongan) {
        return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
    }
    if (borongan.status === 'PAID') {
        return NextResponse.json({ error: 'Slip borongan yang sudah dibayar tidak boleh dihapus' }, { status: 409 });
    }

    const existingExpense = (await listDocumentsByFilter<Array<{ _id: string }>[number]>('expense', { boronganRef: id }))[0] || null;
    if (existingExpense) {
        return NextResponse.json({ error: 'Slip borongan yang sudah punya pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    const itemDocs = await listDocumentsByFilter<Array<{ _id: string }>[number]>('driverBoronganItem', { boronganRef: id });
    for (const item of itemDocs) {
        await deleteDocument(item._id, 'driverBoronganItem');
    }
    await deleteDocument(id, 'driverBorongan');

    await addAuditLog(session, 'DELETE', 'driver-borongans', id, `Deleted driver-borongans ${borongan.boronganNumber || id}`);
    return NextResponse.json({ success: true });
}

export async function handleBoronganPayment(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const boronganId = typeof data.id === 'string' ? data.id : '';
    if (!boronganId) {
        return NextResponse.json({ error: 'Borongan tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran borongan tidak valid' }, { status: 400 });
    }

    const paymentMethod = normalizePaymentMethod(data.paymentMethod);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode pembayaran borongan tidak valid' }, { status: 400 });
    }
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paidDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    const paidDateError = validateIsoDateOrResponse(paidDate, 'Tanggal pembayaran', 'Tanggal pembayaran tidak valid');
    if (paidDateError) {
        return paidDateError;
    }
    const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined;
    const expenseId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();

    const borongan = await getDocumentById<{
        _id: string;
        boronganNumber: string;
        driverName: string;
        driverRef?: string;
        issuerCompanyAddress?: string;
        issuerCompanyEmail?: string;
        issuerCompanyLogoUrl?: string;
        issuerCompanyName?: string;
        issuerCompanyPhone?: string;
        notes?: string;
        periodEnd?: string;
        periodStart?: string;
        totalAmount: number;
        totalCollie?: number;
        totalWeightKg?: number;
        status: string;
        paidDate?: string;
        paidMethod?: string;
        paidBankRef?: string;
        paidBankName?: string;
        paidBankNumber?: string;
    }>(boronganId, 'driverBorongan');
    if (!borongan) {
        return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
    }
    if (borongan.status === 'PAID') {
        return NextResponse.json({ error: 'Borongan ini sudah dibayar' }, { status: 409 });
    }
    const [boronganItems, existingExpense] = await Promise.all([
        listDocumentsByFilter<Array<{ collie?: unknown; beratKg?: unknown; uangRp?: unknown }>[number]>(
            'driverBoronganItem',
            { boronganRef: boronganId }
        ),
        (await listDocumentsByFilter<Array<{ _id: string }>[number]>('expense', { boronganRef: boronganId }))[0] || null,
    ]);
    const derivedTotalAmount = boronganItems.reduce(
        (sum, item) => sum + Math.max(parseFormattedNumberish(item.uangRp ?? 0, { maxFractionDigits: 0 }), 0),
        0
    );
    const derivedTotalCollie = boronganItems.reduce(
        (sum, item) => sum + Math.max(parseFormattedNumberish(item.collie ?? 0, { maxFractionDigits: 2 }), 0),
        0
    );
    const derivedTotalWeightKg = boronganItems.reduce(
        (sum, item) => sum + Math.max(parseFormattedNumberish(item.beratKg ?? 0, { maxFractionDigits: 3 }), 0),
        0
    );
    if (derivedTotalAmount <= 0) {
        return NextResponse.json({ error: 'Total borongan tidak valid' }, { status: 409 });
    }
    if (amount !== derivedTotalAmount) {
        return NextResponse.json({ error: 'Pembayaran borongan harus sama dengan total borongan' }, { status: 400 });
    }
    if (existingExpense) {
        return NextResponse.json({ error: 'Pengeluaran borongan sudah pernah dicatat' }, { status: 409 });
    }

    let bankAccount: BankAccountSummary | null = null;
    if (selectedAccountRef) {
        bankAccount = await getLedgerAccount(selectedAccountRef);
        if (!bankAccount) {
            return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
        }
    } else if (paymentMethod === 'CASH') {
        bankAccount = await ensureCashAccount();
    }
    if (paymentMethod === 'TRANSFER' && bankAccount?.accountType === 'CASH') {
        return NextResponse.json(
            { error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' },
            { status: 400 }
        );
    }
    if (paymentMethod === 'CASH' && bankAccount?.accountType && bankAccount.accountType !== 'CASH') {
        return NextResponse.json(
            { error: 'Metode tunai harus memakai akun Kas Tunai, bukan rekening bank' },
            { status: 400 }
        );
    }
    if (bankAccount) {
        const { startingBalance, nextBalance } = computeLedgerDebitBalance(bankAccount.currentBalance, derivedTotalAmount);
        if (nextBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bankAccount.bankName} tidak cukup untuk pembayaran borongan. Saldo tersedia ${formatAuditMoney(startingBalance)}` },
                { status: 409 }
            );
        }
    }

    const bankAccountRef = bankAccount?._id;
    const expenseDoc: Expense & { paymentMethod?: string } = {
        _id: expenseId,
        _type: 'expense',
        categoryRef: 'driver-borongan',
        categoryName: 'Borongan Supir',
        categoryScope: 'DRIVER_FEE',
        accountSystemKey: 'driver_fee_expense',
        date: paidDate,
        amount: derivedTotalAmount,
        description: `Upah borongan supir ${borongan.driverName} - ${borongan.boronganNumber}`,
        note,
        privacyLevel: 'internal',
        paymentMethod,
        bankAccountRef,
        bankAccountName: bankAccount?.bankName,
        bankAccountNumber: bankAccount?.accountNumber,
        boronganRef: boronganId,
    };
    await createDocument(expenseDoc as unknown as { _type: string; [key: string]: unknown });
    await updateDocument(boronganId, {
        totalAmount: derivedTotalAmount,
        totalCollie: derivedTotalCollie,
        totalWeightKg: derivedTotalWeightKg,
        status: 'PAID',
        paidDate,
        paidMethod: paymentMethod,
        paidBankRef: bankAccountRef,
        paidBankName: bankAccount?.bankName,
        paidBankNumber: bankAccount?.accountNumber,
    }, 'driverBorongan');

    if (bankAccount && bankAccountRef) {
        const { nextBalance: newBalance } = computeLedgerDebitBalance(bankAccount.currentBalance, derivedTotalAmount);
        await createDocument({
            _id: bankTransactionId,
            _type: 'bankTransaction',
            bankAccountRef,
            bankAccountName: bankAccount.bankName,
            bankAccountNumber: bankAccount.accountNumber,
            type: 'DEBIT',
            amount: derivedTotalAmount,
            date: paidDate,
            description: `Pembayaran borongan ${borongan.boronganNumber}`,
            balanceAfter: newBalance,
            relatedExpenseRef: expenseId,
        });
        // Bank balance update via recompute to ensure consistency
        await recomputeBankLedgerBalancesForAccounts([bankAccountRef]);
    }
    await postExpenseJournal(session, expenseDoc, bankAccount);

    await addAuditLog(
        session,
        'CREATE',
        'driver-borongans',
        boronganId,
        `Pembayaran borongan dicatat: ${borongan.boronganNumber}`
    );
    return NextResponse.json({
        success: true,
        id: boronganId,
        expenseId,
    });
}

async function getDriverVoucherState(voucherId: string) {
    const voucher = await getDocumentById<{
        _id: string;
        _rev?: string;
        bonNumber: string;
        status: string;
        cashGiven: number;
        initialCashGiven?: number;
        totalIssuedAmount?: number;
        topUpCount?: number;
        driverFeeAmount?: number;
        totalClaimAmount?: number;
        issuedDate: string;
        issueBankRef?: string;
        issueBankName?: string;
        vehicleRef?: string;
        vehiclePlate?: string;
        driverName?: string;
        deliveryOrderRef?: string;
    }>(voucherId, 'driverVoucher');

    if (!voucher) {
        return { error: NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 }) };
    }

    const items = (await listDocumentsByFilter<Array<{
        _id: string;
        _rev?: string;
        category: string;
        description?: string;
        amount: number;
        expenseDate?: string;
        linkedExpenseRef?: string;
        relatedIncidentSettlementLineRef?: string;
        source?: string;
    }>[number]>(
        'driverVoucherItem',
        { voucherRef: voucherId }
    )).sort((left, right) => String(left.expenseDate || '').localeCompare(String(right.expenseDate || '')));

    const disbursements = (await listDocumentsByFilter<Array<{
        _id: string;
        _rev?: string;
        kind: 'INITIAL' | 'TOP_UP';
        status?: 'ACTIVE' | 'VOID';
        date: string;
        amount: number;
        bankAccountRef?: string;
        bankAccountName?: string;
        bankAccountNumber?: string;
        bankTransactionRef?: string;
        note?: string;
    }>[number]>('driverVoucherDisbursement', { voucherRef: voucherId }))
        .filter(disbursement => disbursement.status !== 'VOID')
        .sort((left, right) => String(left.date || '').localeCompare(String(right.date || '')));

    return { voucher, items, disbursements };
}

async function rejectIfVoucherDeliveryOrderCancelled(
    voucher: { bonNumber?: string; deliveryOrderRef?: string; doNumber?: string },
    actionLabel: string
) {
    const deliveryOrderRef = normalizeOptionalText(voucher.deliveryOrderRef);
    if (!deliveryOrderRef) return null;

    const deliveryOrder = await getDocumentById<{
        _id: string;
        doNumber?: string;
        status?: string;
    }>(deliveryOrderRef, 'deliveryOrder');
    if (deliveryOrder?.status !== 'CANCELLED') return null;

    const doNumber = deliveryOrder.doNumber || voucher.doNumber || deliveryOrderRef;
    return NextResponse.json(
        {
            error: `Trip ${doNumber} sudah dibatalkan. ${actionLabel} tidak boleh dicatat ke bon driver; biaya pembatalan harus masuk Pengeluaran perusahaan.`,
        },
        { status: 409 }
    );
}

export async function handleDriverVoucherCreate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const cashGiven = normalizeCurrencyNumber(data.cashGiven);
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
        return NextResponse.json({ error: 'Nominal uang jalan trip tidak valid' }, { status: 400 });
    }

    const deliveryOrderRef = typeof data.deliveryOrderRef === 'string' ? data.deliveryOrderRef : '';
    if (!deliveryOrderRef) {
        return NextResponse.json({ error: 'Bon supir wajib dikaitkan ke 1 surat jalan / trip' }, { status: 400 });
    }

    const issueBankRef = typeof data.issueBankRef === 'string' ? data.issueBankRef : '';
    if (!issueBankRef) {
        return NextResponse.json({ error: 'Rekening sumber bon wajib dipilih' }, { status: 400 });
    }

    const issueDate =
        typeof data.issuedDate === 'string' && data.issuedDate
            ? data.issuedDate
            : getBusinessDateValue();
    const issueDateError = validateIsoDateOrResponse(issueDate, 'Tanggal bon', 'Tanggal bon tidak valid');
    if (issueDateError) {
        return issueDateError;
    }

    const requestedDriverFeeAmount = normalizeCurrencyNumber(data.driverFeeAmount ?? 0);
    if (!Number.isFinite(requestedDriverFeeAmount) || requestedDriverFeeAmount < 0) {
        return NextResponse.json({ error: 'Upah borongan pada bon tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await getDocumentById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        driverRef?: unknown;
        driverName?: string;
        vehicleRef?: string;
        vehiclePlate?: string;
        receiverAddress?: string;
        pickupAddress?: string;
        shipperReferences?: Array<{
            receiverName?: string;
            receiverCompany?: string;
            receiverAddress?: string;
        }>;
        tripOriginArea?: string;
        tripDestinationArea?: string;
        taripBorongan?: number;
        tripOwnership?: string;
        orderRef?: unknown;
    }>(deliveryOrderRef, 'deliveryOrder');
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan bon tidak ditemukan' }, { status: 404 });
    }
    if (normalizeTripOwnership(deliveryOrder.tripOwnership) === 'MITRA') {
        return NextResponse.json(
            { error: 'Trip mitra tidak memakai uang jalan trip internal.' },
            { status: 409 }
        );
    }
    if (deliveryOrder.status && !['CREATED', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(deliveryOrder.status)) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || deliveryOrderRef} dengan status ${deliveryOrder.status} tidak bisa dipakai untuk uang jalan trip.` },
            { status: 409 }
        );
    }
    const driverRef = extractRefId(deliveryOrder.driverRef);
    if (!driverRef) {
        return NextResponse.json(
            { error: `Tetapkan supir pada DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    const driver = await getDocumentById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef, 'driver');
    if (!driver) {
        return NextResponse.json({ error: 'Supir trip tidak ditemukan' }, { status: 404 });
    }
    if (driver.active === false) {
        return NextResponse.json({ error: 'Supir trip tidak aktif' }, { status: 409 });
    }

    if (!deliveryOrder.vehicleRef && !deliveryOrder.vehiclePlate) {
        return NextResponse.json(
            { error: `Tetapkan kendaraan pada DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    const canonicalDriverName = driver.name || deliveryOrder.driverName || '';
    let canonicalDoNumber =
        typeof data.doNumber === 'string' && data.doNumber.trim()
            ? data.doNumber.trim()
            : undefined;
    let canonicalVehicleRef =
        typeof data.vehicleRef === 'string' && data.vehicleRef.trim()
            ? data.vehicleRef.trim()
            : undefined;
    let canonicalVehiclePlate =
        typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : undefined;
    let canonicalRoute =
        typeof data.route === 'string' && data.route.trim()
            ? data.route.trim()
            : undefined;

    if (
        canonicalVehicleRef &&
        deliveryOrder.vehicleRef &&
        canonicalVehicleRef !== deliveryOrder.vehicleRef
    ) {
        return NextResponse.json(
            { error: 'Kendaraan bon tidak cocok dengan kendaraan pada surat jalan' },
            { status: 409 }
        );
    }

    canonicalDoNumber = deliveryOrder.doNumber || canonicalDoNumber;
    canonicalVehicleRef = deliveryOrder.vehicleRef || canonicalVehicleRef || undefined;
    canonicalVehiclePlate = deliveryOrder.vehiclePlate || canonicalVehiclePlate || undefined;

    const orderRef = extractRefId(deliveryOrder.orderRef);
    const order = orderRef
        ? await getDocumentById<{ _id: string; pickupAddress?: string; receiverAddress?: string }>(orderRef, 'order')
        : null;
    canonicalRoute = buildDriverVoucherRouteLabel(deliveryOrder, order) || canonicalRoute;

    const existingVoucher = (await listDocumentsByFilter<Array<{ bonNumber?: string; status?: string }>[number]>(
        'driverVoucher',
        { deliveryOrderRef }
    ))[0] || null;
    if (existingVoucher) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || deliveryOrderRef} sudah punya bon ${existingVoucher.bonNumber || ''}. Gunakan satu bon per perjalanan agar penyelesaian uang jalan tidak bercampur.` },
            { status: 409 }
        );
    }

    const existingBoronganItem = (await listDocumentsByFilter<Array<{ doNumber?: string }>[number]>(
        'driverBoronganItem',
        { doRef: deliveryOrderRef }
    ))[0] || null;
    if (existingBoronganItem) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || deliveryOrderRef} sudah tercantum di slip borongan. Trip ini harus diselesaikan lewat Uang Jalan Trip, bukan dobel.` },
            { status: 409 }
        );
    }

    const deliveryOrderTripFee = normalizeNumber(deliveryOrder.taripBorongan || 0);
    if (requestedDriverFeeAmount > 0 && Math.abs(requestedDriverFeeAmount - deliveryOrderTripFee) > 0.01) {
        return NextResponse.json(
            { error: 'Upah borongan mengikuti snapshot DO. Ubah DO terlebih dahulu sebelum menerbitkan uang jalan trip.' },
            { status: 409 }
        );
    }
    const effectiveDriverFeeAmount = deliveryOrderTripFee;
    if (!Number.isFinite(effectiveDriverFeeAmount) || effectiveDriverFeeAmount <= 0) {
        return NextResponse.json(
            { error: `Isi upah borongan di DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    let linkedVehicle: { _id: string; _rev?: string; plateNumber?: string } | null = null;
    if (canonicalVehicleRef) {
        const vehicle = await getDocumentById<{ _id: string; _rev?: string; plateNumber?: string }>(canonicalVehicleRef, 'vehicle');
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan bon tidak ditemukan' }, { status: 404 });
        }
        linkedVehicle = vehicle;
        if (!canonicalVehiclePlate) {
            canonicalVehiclePlate = vehicle.plateNumber;
        }
    }

    const bonNumber = await getNextNumber('bon', issueDate);
    const voucherId = crypto.randomUUID();
    const initialDisbursementId = crypto.randomUUID();
    const issueTransactionId = crypto.randomUUID();
    const companyProfile = await getCompanyProfile<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'>>();
    const driverFeeAmount = normalizeCurrencyNumber(effectiveDriverFeeAmount);
    const voucherTotals = computeDriverVoucherTotals(cashGiven, 0, driverFeeAmount);

    const issueBank = await getLedgerAccount(issueBankRef);
    if (!issueBank) {
        return NextResponse.json({ error: 'Rekening sumber bon tidak ditemukan' }, { status: 404 });
    }

    const { startingBalance: issueStartingBalance, nextBalance: newBalance } = computeLedgerDebitBalance(issueBank.currentBalance, cashGiven);
    if (newBalance < 0) {
        return NextResponse.json(
            { error: `Saldo ${issueBank.bankName} tidak cukup untuk pencairan bon. Saldo tersedia ${formatAuditMoney(issueStartingBalance)}` },
            { status: 409 }
        );
    }
    const voucherDoc: DriverVoucher = {
        _id: voucherId,
        _type: 'driverVoucher',
        issuerCompanyName: companyProfile?.name,
        issuerCompanyAddress: companyProfile?.address,
        issuerCompanyPhone: companyProfile?.phone,
        issuerCompanyEmail: companyProfile?.email,
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
        driverRef,
        driverName: canonicalDriverName,
        deliveryOrderRef,
        doNumber: canonicalDoNumber,
        vehicleRef: canonicalVehicleRef,
        vehiclePlate: canonicalVehiclePlate,
        route: canonicalRoute,
        bonNumber,
        issuedDate: issueDate,
        cashGiven,
        initialCashGiven: cashGiven,
        totalIssuedAmount: cashGiven,
        topUpCount: 0,
        driverFeeAmount: voucherTotals.driverFeeAmount,
        totalClaimAmount: voucherTotals.totalClaimAmount,
        issueBankRef,
        issueBankName: issueBank.bankName,
        totalSpent: voucherTotals.totalSpent,
        balance: voucherTotals.balance,
        status: 'ISSUED',
        notes: normalizeOptionalText(data.notes),
    };

    const now = new Date().toISOString();
    await Promise.all([
        updateDocument(deliveryOrderRef, { updatedAt: now }, 'deliveryOrder'),
        updateDocument(driverRef, { updatedAt: now }, 'driver'),
    ]);
    await createDocument(voucherDoc as unknown as { _type: string; [key: string]: unknown });
    await createDocument({
        _id: initialDisbursementId,
        _type: 'driverVoucherDisbursement',
        voucherRef: voucherId,
        date: issueDate,
        amount: cashGiven,
        kind: 'INITIAL',
        status: 'ACTIVE',
        bankAccountRef: issueBankRef,
        bankAccountName: issueBank.bankName,
        bankAccountNumber: issueBank.accountNumber,
        bankTransactionRef: issueTransactionId,
        createdBy: session._id,
        createdByName: session.name,
    });
    await createDocument({
        _id: issueTransactionId,
        _type: 'bankTransaction',
        bankAccountRef: issueBankRef,
        bankAccountName: issueBank.bankName,
        bankAccountNumber: issueBank.accountNumber,
        type: 'DEBIT',
        amount: cashGiven,
        date: issueDate,
        description: `Pencairan uang jalan trip ${bonNumber}`,
        balanceAfter: newBalance,
        relatedVoucherRef: voucherId,
    });
    // Bank balance update via recompute to ensure consistency
    await recomputeBankLedgerBalancesForAccounts([issueBankRef]);
    if (linkedVehicle) {
        await updateDocument(linkedVehicle._id, { updatedAt: now }, 'vehicle');
    }
    const incidentSync = await syncPostedIncidentSettlementLinesToDriverVoucher({
        voucher: voucherDoc,
        deliveryOrderRef,
        issueDate,
    });
    await postDriverVoucherIssueJournal(session, voucherDoc, issueBank);

    await addAuditLog(
        session,
        'CREATE',
        'driver-vouchers',
        voucherId,
        incidentSync.linkedCount > 0
            ? `Bon trip diterbitkan: ${bonNumber} untuk DO ${canonicalDoNumber || deliveryOrderRef}; ${incidentSync.linkedCount} biaya insiden masuk biaya lain-lain`
            : `Bon trip diterbitkan: ${bonNumber} untuk DO ${canonicalDoNumber || deliveryOrderRef}`
    );
    return NextResponse.json({ data: incidentSync.voucher, id: voucherId });
}

export async function handleDriverVoucherTopUp(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    if (!voucherId) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal tambahan bon tidak valid' }, { status: 400 });
    }

    const bankAccountRef = typeof data.bankAccountRef === 'string' ? data.bankAccountRef : '';
    if (!bankAccountRef) {
        return NextResponse.json({ error: 'Rekening sumber tambahan bon wajib dipilih' }, { status: 400 });
    }

    const topUpDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    const topUpDateError = validateIsoDateOrResponse(topUpDate, 'Tanggal tambahan bon', 'Tanggal tambahan bon tidak valid');
    if (topUpDateError) {
        return topUpDateError;
    }

    const note = normalizeOptionalText(data.note);

    const state = await getDriverVoucherState(voucherId);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa ditambah lagi' }, { status: 409 });
    }
    const cancelledTripError = await rejectIfVoucherDeliveryOrderCancelled(
        state.voucher,
        'Tambahan uang jalan'
    );
    if (cancelledTripError) return cancelledTripError;

    const bank = await getLedgerAccount(bankAccountRef);
    if (!bank) {
        return NextResponse.json({ error: 'Rekening sumber tambahan bon tidak ditemukan' }, { status: 404 });
    }

    const nextIssuedAmount = getDriverVoucherIssuedAmount(state.voucher) + amount;
    const nextTopUpCount = Math.max(state.voucher.topUpCount || 0, 0) + 1;
    const totals = computeDriverVoucherTotals(
        nextIssuedAmount,
        state.items.reduce((sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }), 0),
        normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );
    const transactionId = crypto.randomUUID();
    const disbursementId = crypto.randomUUID();
    const { startingBalance: bankStartingBalance, nextBalance: nextBankBalance } = computeLedgerDebitBalance(bank.currentBalance, amount);
    if (nextBankBalance < 0) {
        return NextResponse.json(
            { error: `Saldo ${bank.bankName} tidak cukup untuk tambahan bon. Saldo tersedia ${formatAuditMoney(bankStartingBalance)}` },
            { status: 409 }
        );
    }

    await createDocument({
        _id: disbursementId,
        _type: 'driverVoucherDisbursement',
        voucherRef: voucherId,
        date: topUpDate,
        amount,
        kind: 'TOP_UP',
        status: 'ACTIVE',
        bankAccountRef,
        bankAccountName: bank.bankName,
        bankAccountNumber: bank.accountNumber,
        bankTransactionRef: transactionId,
        note,
        createdBy: session._id,
        createdByName: session.name,
    });
    await createDocument({
        _id: transactionId,
        _type: 'bankTransaction',
        bankAccountRef,
        bankAccountName: bank.bankName,
        bankAccountNumber: bank.accountNumber,
        type: 'DEBIT',
        amount,
        date: topUpDate,
        description: `Tambahan bon ${state.voucher.bonNumber}`,
        balanceAfter: nextBankBalance,
        relatedVoucherRef: voucherId,
    });
    // Bank balance update via recompute to ensure consistency
    await recomputeBankLedgerBalancesForAccounts([bankAccountRef]);
    await updateDocument(voucherId, {
        totalIssuedAmount: nextIssuedAmount,
        topUpCount: nextTopUpCount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    }, 'driverVoucher');
    await postDriverVoucherTopUpJournal(session, {
        voucherId,
        bonNumber: state.voucher.bonNumber,
        date: topUpDate,
        amount,
        disbursementId,
        bankAccount: bank,
    });

    const updatedVoucher = {
        ...state.voucher,
        totalIssuedAmount: nextIssuedAmount,
        topUpCount: nextTopUpCount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    };
    const disbursementDoc = {
        _id: disbursementId,
        _type: 'driverVoucherDisbursement' as const,
        voucherRef: voucherId,
        date: topUpDate,
        amount,
        kind: 'TOP_UP' as const,
        status: 'ACTIVE' as const,
        bankAccountRef,
        bankAccountName: bank.bankName,
        bankAccountNumber: bank.accountNumber,
        bankTransactionRef: transactionId,
        note,
        createdBy: session._id,
        createdByName: session.name,
    };

    await addAuditLog(
        session,
        'UPDATE',
        'driver-vouchers',
        voucherId,
        `Tambah bon ${state.voucher.bonNumber}: ${amount} dari ${bank.bankName}`
    );

    return NextResponse.json({
        data: disbursementDoc,
        voucher: updatedVoucher,
    });
}

export async function handleDriverVoucherItemCreate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherRef = typeof data.voucherRef === 'string' ? data.voucherRef : '';
    if (!voucherRef) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal item tidak valid' }, { status: 400 });
    }

    const expenseDate =
        typeof data.expenseDate === 'string' && data.expenseDate
            ? data.expenseDate
            : getBusinessDateValue();
    const expenseDateError = validateIsoDateOrResponse(
        expenseDate,
        'Tanggal biaya lain-lain',
        'Tanggal biaya lain-lain tidak valid'
    );
    if (expenseDateError) {
        return expenseDateError;
    }

    const state = await getDriverVoucherState(voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa diubah' }, { status: 409 });
    }
    const cancelledTripError = await rejectIfVoucherDeliveryOrderCancelled(
        state.voucher,
        'Biaya lain-lain'
    );
    if (cancelledTripError) return cancelledTripError;

    const itemId = crypto.randomUUID();
    const nextOperationalSpent = state.items.reduce(
        (sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }),
        0
    ) + amount;
    const nextTotals = computeDriverVoucherTotals(
        getDriverVoucherIssuedAmount(state.voucher),
        nextOperationalSpent,
        normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );
    const itemDoc = {
        _id: itemId,
        _type: 'driverVoucherItem',
        voucherRef,
        expenseDate,
        category: typeof data.category === 'string' && data.category.trim() ? data.category.trim() : 'Lain-lain Trip',
        description: typeof data.description === 'string' ? data.description.trim() : '',
        amount,
    };

    await createDocument(itemDoc);
    await updateDocument(voucherRef, {
        totalSpent: nextTotals.totalSpent,
        totalClaimAmount: nextTotals.totalClaimAmount,
        balance: nextTotals.balance,
    }, 'driverVoucher');

    await addAuditLog(
        session,
        'CREATE',
        'driver-voucher-items',
        itemId,
        `Menambah item bon ${state.voucher.bonNumber}: ${itemDoc.category} ${itemDoc.description ? `- ${itemDoc.description}` : ''} (${itemDoc.amount})`
    );
    return NextResponse.json({
        data: itemDoc,
        voucher: {
            ...state.voucher,
            totalSpent: nextTotals.totalSpent,
            totalClaimAmount: nextTotals.totalClaimAmount,
            balance: nextTotals.balance,
        },
    });
}

export async function handleDriverVoucherItemUpdate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const itemId = typeof data.id === 'string' ? data.id : '';
    const updates = isPlainObject(data.updates) ? data.updates : {};
    if (!itemId) {
        return NextResponse.json({ error: 'Item bon tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(updates.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal item tidak valid' }, { status: 400 });
    }

    const expenseDate =
        typeof updates.expenseDate === 'string' && updates.expenseDate
            ? updates.expenseDate
            : getBusinessDateValue();
    const expenseDateError = validateIsoDateOrResponse(
        expenseDate,
        'Tanggal biaya lain-lain',
        'Tanggal biaya lain-lain tidak valid'
    );
    if (expenseDateError) {
        return expenseDateError;
    }

    const initialItem = await getDocumentById<{ _id: string; voucherRef?: string }>(itemId, 'driverVoucherItem');
    if (!initialItem?.voucherRef) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan' }, { status: 404 });
    }

    const state = await getDriverVoucherState(initialItem.voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa diubah' }, { status: 409 });
    }
    const cancelledTripError = await rejectIfVoucherDeliveryOrderCancelled(
        state.voucher,
        'Biaya lain-lain'
    );
    if (cancelledTripError) return cancelledTripError;

    const existingItem = state.items.find(existing => existing._id === itemId);
    if (!existingItem) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan atau sudah berubah. Muat ulang lalu coba lagi.' }, { status: 404 });
    }

    const itemPatch = {
        expenseDate,
        category: normalizeText(updates.category) || 'Lain-lain Trip',
        description: normalizeText(updates.description),
        amount,
    };
    const nextOperationalSpent = state.items.reduce((sum, existing) => {
        const itemAmount = existing._id === itemId
            ? itemPatch.amount
            : normalizeNumber(existing.amount || 0, { maxFractionDigits: 0 });
        return sum + itemAmount;
    }, 0);
    const nextTotals = computeDriverVoucherTotals(
        getDriverVoucherIssuedAmount(state.voucher),
        nextOperationalSpent,
        normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );

    const updatedItem = await updateDocument(itemId, itemPatch, 'driverVoucherItem');
    await updateDocument(initialItem.voucherRef, {
        totalSpent: nextTotals.totalSpent,
        totalClaimAmount: nextTotals.totalClaimAmount,
        balance: nextTotals.balance,
    }, 'driverVoucher');

    await addAuditLog(
        session,
        'UPDATE',
        'driver-voucher-items',
        itemId,
        `Mengubah item bon ${state.voucher.bonNumber}: ${existingItem.category || 'Item'} (${existingItem.amount}) menjadi ${itemPatch.category} (${itemPatch.amount})`
    );
    return NextResponse.json({
        data: updatedItem,
        voucher: {
            ...state.voucher,
            totalSpent: nextTotals.totalSpent,
            totalClaimAmount: nextTotals.totalClaimAmount,
            balance: nextTotals.balance,
        },
    });
}

export async function handleDriverVoucherItemDelete(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const itemId = typeof data.id === 'string' ? data.id : '';
    if (!itemId) {
        return NextResponse.json({ error: 'Item bon tidak valid' }, { status: 400 });
    }

    const initialItem = await getDocumentById<{ _id: string; voucherRef: string }>(itemId, 'driverVoucherItem');
    if (!initialItem?.voucherRef) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan' }, { status: 404 });
    }

    const state = await getDriverVoucherState(initialItem.voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa diubah' }, { status: 409 });
    }

    const deletedItem = state.items.find(existing => existing._id === itemId);
    if (!deletedItem) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan atau sudah berubah. Muat ulang lalu coba lagi.' }, { status: 404 });
    }

    const nextOperationalSpent = state.items
        .filter(existing => existing._id !== itemId)
        .reduce((sum, existing) => sum + existing.amount, 0);
    const nextTotals = computeDriverVoucherTotals(
        getDriverVoucherIssuedAmount(state.voucher),
        nextOperationalSpent,
        normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );

    await deleteDocument(itemId, 'driverVoucherItem');
    await updateDocument(initialItem.voucherRef, {
        totalSpent: nextTotals.totalSpent,
        totalClaimAmount: nextTotals.totalClaimAmount,
        balance: nextTotals.balance,
    }, 'driverVoucher');

    await addAuditLog(
        session,
        'DELETE',
        'driver-voucher-items',
        itemId,
        `Menghapus item bon ${state.voucher.bonNumber}: ${deletedItem?.category || 'Item'}${deletedItem?.description ? ` - ${deletedItem.description}` : ''}`
    );
    return NextResponse.json({
        success: true,
        voucher: {
            ...state.voucher,
            totalSpent: nextTotals.totalSpent,
            totalClaimAmount: nextTotals.totalClaimAmount,
            balance: nextTotals.balance,
        },
    });
}

export async function handleDriverVoucherDisbursementDelete(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const disbursementId = typeof data.id === 'string' ? data.id : '';
    if (!disbursementId) {
        return NextResponse.json({ error: 'Tambahan bon tidak valid' }, { status: 400 });
    }

    const initialDisbursement = await getDocumentById<{
        _id: string;
        _rev?: string;
        voucherRef?: string;
        amount?: number;
        kind?: 'INITIAL' | 'TOP_UP';
        status?: 'ACTIVE' | 'VOID';
        bankAccountRef?: string;
        bankTransactionRef?: string;
        note?: string;
    }>(disbursementId, 'driverVoucherDisbursement');
    if (!initialDisbursement?.voucherRef) {
        return NextResponse.json({ error: 'Tambahan bon tidak ditemukan' }, { status: 404 });
    }
    if (initialDisbursement.kind !== 'TOP_UP') {
        return NextResponse.json({ error: 'Bon awal tidak bisa dihapus dari riwayat pencairan' }, { status: 409 });
    }
    if (initialDisbursement.status === 'VOID') {
        return NextResponse.json({ error: 'Tambahan bon sudah dibatalkan' }, { status: 404 });
    }

    const state = await getDriverVoucherState(initialDisbursement.voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa dikoreksi' }, { status: 409 });
    }

    const disbursement = state.disbursements.find(existing => existing._id === disbursementId);
    if (!disbursement) {
        return NextResponse.json({ error: 'Tambahan bon tidak ditemukan atau sudah berubah. Muat ulang lalu coba lagi.' }, { status: 404 });
    }
    if (disbursement.kind !== 'TOP_UP') {
        return NextResponse.json({ error: 'Bon awal tidak bisa dihapus dari riwayat pencairan' }, { status: 409 });
    }

    const amount = normalizeNumber(disbursement.amount || 0);
    if (amount <= 0) {
        return NextResponse.json({ error: 'Nominal tambahan bon tidak valid' }, { status: 409 });
    }

    let bank: BankAccountSummary | null = null;
    if (disbursement.bankAccountRef) {
        bank = await getDocumentById<BankAccountSummary>(disbursement.bankAccountRef, 'bankAccount');
        if (!bank) {
            return NextResponse.json({ error: 'Rekening historis tambahan bon tidak ditemukan' }, { status: 404 });
        }
    }

    const remainingDisbursements = state.disbursements.filter(existing => existing._id !== disbursementId);
    const nextIssuedAmount = Math.max(
        remainingDisbursements.reduce((sum, existing) => sum + normalizeNumber(existing.amount || 0, { maxFractionDigits: 0 }), 0),
        getDriverVoucherInitialCash(state.voucher)
    );
    const nextTopUpCount = remainingDisbursements.filter(existing =>
        existing.kind === 'TOP_UP' && normalizeNumber(existing.amount || 0, { maxFractionDigits: 0 }) > 0
    ).length;
    const totals = computeDriverVoucherTotals(
        nextIssuedAmount,
        state.items.reduce((sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }), 0),
        normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );

    let reversalBankTransactionRef: string | undefined;
    if (bank && disbursement.bankAccountRef && disbursement.bankTransactionRef) {
        const reversalTransactionId = `driver-voucher-disbursement-void-${disbursementId}`;
        const existingReversal = await getDocumentById<{ _id: string; balanceAfter?: number }>(
            reversalTransactionId,
            'bankTransaction'
        );
        const correctedBalance = existingReversal
            ? readLedgerBalance(existingReversal.balanceAfter)
            : readLedgerBalance(bank.currentBalance) + amount;

        if (!existingReversal) {
            await createDocument({
                _id: reversalTransactionId,
                _type: 'bankTransaction',
                bankAccountRef: disbursement.bankAccountRef,
                bankAccountName: bank.bankName,
                bankAccountNumber: bank.accountNumber,
                type: 'CREDIT',
                amount,
                date: getBusinessDateValue(),
                description: `Pembatalan tambahan bon ${state.voucher.bonNumber}`,
                balanceAfter: correctedBalance,
                relatedVoucherRef: initialDisbursement.voucherRef,
                reversesBankTransactionRef: disbursement.bankTransactionRef,
            });
        }

        if (readLedgerBalance(bank.currentBalance) !== correctedBalance) {
            await updateDocument(disbursement.bankAccountRef, {
                currentBalance: correctedBalance,
            }, 'bankAccount');
        }
        reversalBankTransactionRef = reversalTransactionId;
    }
    await updateDocument(initialDisbursement.voucherRef, {
        totalIssuedAmount: nextIssuedAmount,
        topUpCount: nextTopUpCount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    }, 'driverVoucher');
    await voidJournalEntryForSource(session, 'DRIVER_VOUCHER_DISBURSEMENT', disbursementId, 'TOP_UP');
    await updateDocument(disbursementId, {
        status: 'VOID',
        voidedAt: new Date().toISOString(),
        voidedBy: session._id,
        voidedByName: session.name,
        voidReason: 'Tambahan bon dibatalkan sebelum penyelesaian',
        reversalBankTransactionRef,
    }, 'driverVoucherDisbursement');

    const updatedVoucher = {
        ...state.voucher,
        totalIssuedAmount: nextIssuedAmount,
        topUpCount: nextTopUpCount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    };

    await addAuditLog(
        session,
        'DELETE',
        'driver-voucher-disbursements',
        disbursementId,
        `Menghapus tambahan bon ${state.voucher.bonNumber}${disbursement.note ? ` - ${disbursement.note}` : ''}`
    );

    return NextResponse.json({
        success: true,
        voucher: updatedVoucher,
    });
}

export async function handleDriverVoucherDisbursementUpdate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const disbursementId = typeof data.id === 'string' ? data.id : '';
    const updates = isPlainObject(data.updates) ? data.updates : {};
    if (!disbursementId) {
        return NextResponse.json({ error: 'Tambahan bon tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(updates.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal tambahan bon tidak valid' }, { status: 400 });
    }

    const bankAccountRef = typeof updates.bankAccountRef === 'string' ? updates.bankAccountRef : '';
    if (!bankAccountRef) {
        return NextResponse.json({ error: 'Rekening sumber tambahan bon wajib dipilih' }, { status: 400 });
    }

    const topUpDate =
        typeof updates.date === 'string' && updates.date
            ? updates.date
            : getBusinessDateValue();
    const topUpDateError = validateIsoDateOrResponse(topUpDate, 'Tanggal tambahan bon', 'Tanggal tambahan bon tidak valid');
    if (topUpDateError) {
        return topUpDateError;
    }
    const note = normalizeOptionalText(updates.note);

    const initialDisbursement = await getDocumentById<{
        _id: string;
        _rev?: string;
        voucherRef?: string;
        amount?: number;
        kind?: 'INITIAL' | 'TOP_UP';
        status?: 'ACTIVE' | 'VOID';
        date?: string;
        bankAccountRef?: string;
        bankTransactionRef?: string;
        note?: string;
    }>(disbursementId, 'driverVoucherDisbursement');
    if (!initialDisbursement?.voucherRef) {
        return NextResponse.json({ error: 'Tambahan bon tidak ditemukan' }, { status: 404 });
    }
    if (initialDisbursement.kind !== 'TOP_UP') {
        return NextResponse.json({ error: 'Bon awal tidak bisa diedit dari riwayat pencairan' }, { status: 409 });
    }
    if (initialDisbursement.status === 'VOID') {
        return NextResponse.json({ error: 'Tambahan bon sudah dibatalkan' }, { status: 404 });
    }

    const state = await getDriverVoucherState(initialDisbursement.voucherRef);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa dikoreksi' }, { status: 409 });
    }
    const cancelledTripError = await rejectIfVoucherDeliveryOrderCancelled(
        state.voucher,
        'Koreksi tambahan uang jalan'
    );
    if (cancelledTripError) return cancelledTripError;

    const disbursement = state.disbursements.find(existing => existing._id === disbursementId);
    if (!disbursement) {
        return NextResponse.json({ error: 'Tambahan bon tidak ditemukan atau sudah berubah. Muat ulang lalu coba lagi.' }, { status: 404 });
    }
    if (disbursement.kind !== 'TOP_UP') {
        return NextResponse.json({ error: 'Bon awal tidak bisa diedit dari riwayat pencairan' }, { status: 409 });
    }

    const previousAmount = normalizeNumber(disbursement.amount || 0, { maxFractionDigits: 0 });
    if (previousAmount <= 0) {
        return NextResponse.json({ error: 'Nominal tambahan bon lama tidak valid' }, { status: 409 });
    }
    if (!disbursement.bankAccountRef || !disbursement.bankTransactionRef) {
        return NextResponse.json({ error: 'Riwayat bank tambahan bon belum lengkap. Hapus dan input ulang tambahan bon.' }, { status: 409 });
    }

    const oldBank = await getDocumentById<BankAccountSummary>(disbursement.bankAccountRef, 'bankAccount');
    if (!oldBank) {
        return NextResponse.json({ error: 'Rekening historis tambahan bon tidak ditemukan' }, { status: 404 });
    }

    const newBank = await getLedgerAccount(bankAccountRef);
    if (!newBank) {
        return NextResponse.json({ error: 'Rekening sumber tambahan bon tidak ditemukan' }, { status: 404 });
    }

    const hasBankLedgerChange =
        bankAccountRef !== disbursement.bankAccountRef ||
        amount !== previousAmount ||
        topUpDate !== disbursement.date;
    let reversalTransactionId: string | undefined;
    let newTransactionId = disbursement.bankTransactionRef;
    const oldBankBalanceAfterReversal = readLedgerBalance(oldBank.currentBalance) + previousAmount;
    let newBankFinalBalance = readLedgerBalance(newBank.currentBalance);

    if (hasBankLedgerChange) {
        if (bankAccountRef === disbursement.bankAccountRef) {
            const nextSameBankBalance = oldBankBalanceAfterReversal - amount;
            if (nextSameBankBalance < 0) {
                return NextResponse.json(
                    { error: `Saldo ${newBank.bankName} tidak cukup untuk perubahan tambahan bon. Saldo tersedia ${formatAuditMoney(oldBankBalanceAfterReversal)}` },
                    { status: 409 }
                );
            }
            newBankFinalBalance = nextSameBankBalance;
        } else {
            newBankFinalBalance = readLedgerBalance(newBank.currentBalance) - amount;
            if (newBankFinalBalance < 0) {
                return NextResponse.json(
                    { error: `Saldo ${newBank.bankName} tidak cukup untuk perubahan tambahan bon. Saldo tersedia ${formatAuditMoney(readLedgerBalance(newBank.currentBalance))}` },
                    { status: 409 }
                );
            }
        }

        reversalTransactionId = `driver-voucher-disbursement-edit-reversal-${disbursementId}-${crypto.randomUUID()}`;
        newTransactionId = `driver-voucher-disbursement-edit-${disbursementId}-${crypto.randomUUID()}`;

        await createDocument({
            _id: reversalTransactionId,
            _type: 'bankTransaction',
            bankAccountRef: disbursement.bankAccountRef,
            bankAccountName: oldBank.bankName,
            bankAccountNumber: oldBank.accountNumber,
            type: 'CREDIT',
            amount: previousAmount,
            date: getBusinessDateValue(),
            description: `Koreksi tambahan bon ${state.voucher.bonNumber}`,
            balanceAfter: oldBankBalanceAfterReversal,
            relatedVoucherRef: initialDisbursement.voucherRef,
            reversesBankTransactionRef: disbursement.bankTransactionRef,
        });
        await createDocument({
            _id: newTransactionId,
            _type: 'bankTransaction',
            bankAccountRef,
            bankAccountName: newBank.bankName,
            bankAccountNumber: newBank.accountNumber,
            type: 'DEBIT',
            amount,
            date: topUpDate,
            description: `Koreksi tambahan bon ${state.voucher.bonNumber}`,
            balanceAfter: newBankFinalBalance,
            relatedVoucherRef: initialDisbursement.voucherRef,
            replacesBankTransactionRef: disbursement.bankTransactionRef,
        });
        // Bank balance update via recompute to ensure consistency
        const affectedAccounts = bankAccountRef === disbursement.bankAccountRef
            ? [bankAccountRef]
            : [disbursement.bankAccountRef, bankAccountRef];
        await recomputeBankLedgerBalancesForAccounts(affectedAccounts);
    }

    const nextIssuedAmount = Math.max(
        state.disbursements.reduce((sum, existing) => {
            const rowAmount = existing._id === disbursementId
                ? amount
                : normalizeNumber(existing.amount || 0, { maxFractionDigits: 0 });
            return sum + rowAmount;
        }, 0),
        getDriverVoucherInitialCash(state.voucher)
    );
    const nextTopUpCount = state.disbursements.filter(existing =>
        existing.kind === 'TOP_UP' && normalizeNumber(existing.amount || 0, { maxFractionDigits: 0 }) > 0
    ).length;
    const totals = computeDriverVoucherTotals(
        nextIssuedAmount,
        state.items.reduce((sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }), 0),
        normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
    );

    await updateDocument(initialDisbursement.voucherRef, {
        totalIssuedAmount: nextIssuedAmount,
        topUpCount: nextTopUpCount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    }, 'driverVoucher');
    await voidJournalEntryForSource(session, 'DRIVER_VOUCHER_DISBURSEMENT', disbursementId, 'TOP_UP');
    await postDriverVoucherTopUpJournal(session, {
        voucherId: initialDisbursement.voucherRef,
        bonNumber: state.voucher.bonNumber,
        date: topUpDate,
        amount,
        disbursementId,
        bankAccount: newBank,
    });

    const disbursementPatch = {
        date: topUpDate,
        amount,
        bankAccountRef,
        bankAccountName: newBank.bankName,
        bankAccountNumber: newBank.accountNumber,
        bankTransactionRef: newTransactionId,
        note,
        updatedAt: new Date().toISOString(),
        updatedBy: session._id,
        updatedByName: session.name,
        replacedBankTransactionRef: disbursement.bankTransactionRef,
        adjustmentBankTransactionRef: reversalTransactionId,
    };
    const updatedDisbursement = await updateDocument(disbursementId, disbursementPatch, 'driverVoucherDisbursement');
    const updatedVoucher = {
        ...state.voucher,
        totalIssuedAmount: nextIssuedAmount,
        topUpCount: nextTopUpCount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    };

    await addAuditLog(
        session,
        'UPDATE',
        'driver-voucher-disbursements',
        disbursementId,
        `Mengubah tambahan bon ${state.voucher.bonNumber}: ${previousAmount} menjadi ${amount}`
    );

    return NextResponse.json({
        data: updatedDisbursement,
        voucher: updatedVoucher,
    });
}

export async function handleDriverVoucherSettlement(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    if (!voucherId) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const settledDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    const settledDateError = validateIsoDateOrResponse(settledDate, 'Tanggal penyelesaian', 'Tanggal penyelesaian tidak valid');
    if (settledDateError) {
        return settledDateError;
    }

    const state = await getDriverVoucherState(voucherId);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon supir ini sudah selesai' }, { status: 409 });
    }
    const cancelledTripError = await rejectIfVoucherDeliveryOrderCancelled(
        state.voucher,
        'Penyelesaian uang jalan trip'
    );
    if (cancelledTripError) return cancelledTripError;
    const driverFeeAmount = normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 });
    if (state.items.length === 0 && driverFeeAmount <= 0) {
        return NextResponse.json({ error: 'Isi biaya lain-lain atau upah borongan sebelum penyelesaian trip' }, { status: 400 });
    }

    if (state.voucher.deliveryOrderRef) {
        const existingBoronganItem = (await listDocumentsByFilter<Array<{ doNumber?: string }>[number]>(
            'driverBoronganItem',
            { doRef: state.voucher.deliveryOrderRef }
        ))[0] || null;
        if (existingBoronganItem) {
            return NextResponse.json(
                { error: `DO ${existingBoronganItem.doNumber || state.voucher.deliveryOrderRef} sudah ada di slip borongan. Trip ini tidak boleh diselesaikan di dua workflow.` },
                { status: 409 }
            );
        }
    }

    const totalSpent = state.items.reduce(
        (sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }),
        0
    );
    const totals = computeDriverVoucherTotals(
        getDriverVoucherIssuedAmount(state.voucher),
        totalSpent,
        driverFeeAmount
    );
    const balance = totals.balance;
    const requestedSettlementBankRef =
        typeof data.settlementBankRef === 'string' && data.settlementBankRef
            ? data.settlementBankRef
            : undefined;
    const settlementBankRef =
        balance !== 0
            ? requestedSettlementBankRef || state.voucher.issueBankRef || ''
            : undefined;
    let settlementBank: BankAccountSummary | null = null;

    if (balance !== 0) {
        if (!settlementBankRef) {
            return NextResponse.json({ error: 'Rekening penyelesaian uang jalan wajib dipilih' }, { status: 400 });
        }

        settlementBank = await getLedgerAccount(settlementBankRef);
        if (!settlementBank) {
            return NextResponse.json(
                {
                    error: requestedSettlementBankRef
                        ? 'Rekening penyelesaian uang jalan tidak ditemukan'
                        : 'Pilih rekening penyelesaian uang jalan yang aktif',
                },
                { status: requestedSettlementBankRef ? 404 : 400 }
            );
        }
    }

    const expenseCategories = await listDocumentsByFilter<ExpenseCategoryOption>('expenseCategory', {});
    const existingVoucherExpenses = await listDocumentsByFilter<VoucherPostedExpense>('expense', { voucherRef: voucherId });
    const existingVoucherTransactions = await listDocumentsByFilter<VoucherBankTransaction>('bankTransaction', { relatedVoucherRef: voucherId });

    for (const item of state.items) {
        const expenseCategory = resolveExpenseCategory(expenseCategories, item.category);
        if (!expenseCategory) {
            return NextResponse.json(
                { error: 'Master kategori biaya belum tersedia untuk posting pengeluaran uang jalan trip' },
                { status: 409 }
            );
        }
        const expenseAmount = normalizeCurrencyNumber(item.amount);
        const expenseDescription = item.description || `Pengeluaran uang jalan trip ${state.voucher.bonNumber}`;

        // If already linked to an expense, skip creating new one
        if (item.linkedExpenseRef) {
            continue;
        }

        // Check for existing expense with same key (idempotency via category+amount+description)
        if (hasMatchingVoucherExpense(existingVoucherExpenses, expenseCategory.name || item.category, expenseAmount, expenseDescription)) {
            // Mark as linked to prevent duplicate creation on re-settlement
            await updateDocument(item._id, { linkedExpenseRef: 'pending' }, 'driverVoucherItem');
            continue;
        }

        // Create new expense
        const expenseId = crypto.randomUUID();
        await createDocument({
            _id: expenseId,
            _type: 'expense',
            categoryRef: expenseCategory._id,
            categoryName: expenseCategory.name || item.category,
            categoryScope: inferExpenseCategoryScope({ ...expenseCategory, name: expenseCategory.name || item.category }),
            accountSystemKey: resolveExpenseCategoryAccountKey({ ...expenseCategory, name: expenseCategory.name || item.category }),
            date: item.expenseDate || settledDate,
            amount: expenseAmount,
            description: expenseDescription,
            note: `Uang jalan trip ${state.voucher.bonNumber}`,
            privacyLevel: 'internal',
            relatedVehicleRef: state.voucher.vehicleRef,
            relatedVehiclePlate: state.voucher.vehiclePlate,
            voucherRef: voucherId,
        });

        // Link the voucher item to the created expense
        await updateDocument(item._id, { linkedExpenseRef: expenseId }, 'driverVoucherItem');
    }

    if (driverFeeAmount > 0) {
        const driverFeeCategory = resolveExpenseCategory(expenseCategories, 'Borongan Supir');
        if (!driverFeeCategory) {
            return NextResponse.json(
                { error: 'Master kategori Borongan Supir belum tersedia untuk posting upah trip' },
                { status: 409 }
            );
        }
        const driverFeeDescription = `Upah supir ${state.voucher.driverName || '-'} - ${state.voucher.bonNumber}`;
        if (!hasMatchingVoucherExpense(existingVoucherExpenses, driverFeeCategory.name || 'Borongan Supir', driverFeeAmount, driverFeeDescription)) {
            await createDocument({
                _id: crypto.randomUUID(),
                _type: 'expense',
                categoryRef: driverFeeCategory._id,
                categoryName: driverFeeCategory.name || 'Borongan Supir',
                categoryScope: 'DRIVER_FEE',
                accountSystemKey: 'driver_fee_expense',
                date: settledDate,
                amount: driverFeeAmount,
                description: driverFeeDescription,
                note: `Penyelesaian uang jalan trip ${state.voucher.bonNumber}`,
                privacyLevel: 'internal',
                relatedVehicleRef: state.voucher.vehicleRef,
                relatedVehiclePlate: state.voucher.vehiclePlate,
                voucherRef: voucherId,
            });
        }
    }

    if (settlementBank && settlementBankRef) {
        const adjustmentAmount = Math.abs(balance);
        const transactionType = balance > 0 ? 'CREDIT' : 'DEBIT';
        const transactionDescription =
            balance > 0
                ? `Pengembalian sisa bon ${state.voucher.bonNumber}`
                : `Kekurangan bon ${state.voucher.bonNumber}`;
        const alreadyPostedSettlementTransaction = hasMatchingVoucherBankTransaction(
            existingVoucherTransactions,
            transactionType,
            adjustmentAmount,
            transactionDescription
        );
        const nextBankBalance =
            balance > 0
                ? readLedgerBalance(settlementBank.currentBalance) + adjustmentAmount
                : computeLedgerDebitBalance(settlementBank.currentBalance, adjustmentAmount).nextBalance;
        if (!alreadyPostedSettlementTransaction && balance < 0 && nextBankBalance < 0) {
            const { startingBalance } = computeLedgerDebitBalance(settlementBank.currentBalance, adjustmentAmount);
            return NextResponse.json(
                { error: `Saldo ${settlementBank.bankName} tidak cukup untuk penyelesaian uang jalan. Saldo tersedia ${formatAuditMoney(startingBalance)}` },
                { status: 409 }
            );
        }
        if (!alreadyPostedSettlementTransaction) {
            await createDocument({
                _id: crypto.randomUUID(),
                _type: 'bankTransaction',
                bankAccountRef: settlementBankRef,
                bankAccountName: settlementBank.bankName,
                bankAccountNumber: settlementBank.accountNumber,
                type: transactionType,
                amount: adjustmentAmount,
                date: settledDate,
                description: transactionDescription,
                balanceAfter: nextBankBalance,
                relatedVoucherRef: voucherId,
            });
            // Bank balance update via recompute to ensure consistency
            await recomputeBankLedgerBalancesForAccounts([settlementBankRef]);
        }
    }

    await updateDocument(voucherId, {
        status: 'SETTLED',
        settledDate,
        settledBy: session._id,
        settledByName: session.name,
        totalSpent: totals.totalSpent,
        driverFeeAmount: totals.driverFeeAmount,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
        settlementBankRef,
        settlementBankName: settlementBank?.bankName,
    }, 'driverVoucher');

    const updatedVoucher = {
        ...state.voucher,
        status: 'SETTLED',
        settledDate,
        settledBy: session._id,
        settledByName: session.name,
        totalSpent: totals.totalSpent,
        driverFeeAmount: totals.driverFeeAmount,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
        settlementBankRef,
        settlementBankName: settlementBank?.bankName,
    };
    await postDriverVoucherSettlementJournal(session, updatedVoucher, settlementBank);

    await addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Bon supir selesai: ${state.voucher.bonNumber}`);
    return NextResponse.json({ data: updatedVoucher });
}

export async function handleDriverVoucherBatchSettlement(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const rawIds = Array.isArray(data.ids)
        ? data.ids
        : [];
    const ids = Array.from(new Set(
        rawIds
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map(value => value.trim())
    ));
    if (ids.length === 0) {
        return NextResponse.json({ error: 'Pilih minimal 1 uang jalan trip' }, { status: 400 });
    }
    if (ids.length > 100) {
        return NextResponse.json({ error: 'Maksimal 100 uang jalan trip per penyelesaian massal' }, { status: 400 });
    }

    const settledDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    const settledDateError = validateIsoDateOrResponse(settledDate, 'Tanggal penyelesaian', 'Tanggal penyelesaian tidak valid');
    if (settledDateError) {
        return settledDateError;
    }

    const requestedSettlementBankRef =
        typeof data.settlementBankRef === 'string' && data.settlementBankRef
            ? data.settlementBankRef
            : undefined;

    const settled: Array<{ id: string; bonNumber: string }> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
        try {
            const response = await handleDriverVoucherSettlement(
                session,
                { id, date: settledDate, settlementBankRef: requestedSettlementBankRef },
                addAuditLog
            );
            if (!response) {
                failed.push({ id, error: 'Terjadi kesalahan saat penyelesaian uang jalan trip' });
                continue;
            }
            const body = await response.json().catch(() => null);
            if (response.ok) {
                settled.push({ id, bonNumber: body?.data?.bonNumber || id });
            } else {
                failed.push({ id, error: body?.error || 'Gagal menyelesaikan uang jalan trip' });
            }
        } catch {
            failed.push({ id, error: 'Terjadi kesalahan saat penyelesaian uang jalan trip' });
        }
    }

    if (settled.length > 0) {
        await addAuditLog(
            session,
            'UPDATE',
            'driver-vouchers',
            ids[0],
            `Penyelesaian massal uang jalan trip: ${settled.length} selesai, ${failed.length} gagal`
        );
    }

    return NextResponse.json({ data: { settled, failed } });
}

export async function handleDriverVoucherIssueRepair(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    const issueBankRef = typeof data.issueBankRef === 'string' ? data.issueBankRef : '';
    if (!voucherId || !issueBankRef) {
        return NextResponse.json({ error: 'Data rekonsiliasi bon tidak lengkap' }, { status: 400 });
    }

    const voucher = await getDocumentById<{
            _id: string;
            _rev?: string;
            bonNumber: string;
            issuedDate: string;
            cashGiven: number;
            initialCashGiven?: number;
            totalIssuedAmount?: number;
            issueBankRef?: string;
        }>(voucherId, 'driverVoucher');
    if (!voucher) {
        return NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 });
    }
    if (voucher.issueBankRef) {
        return NextResponse.json({ error: 'Bon ini sudah punya rekening sumber' }, { status: 409 });
    }

    const existingTx = (await listDocumentsByFilter<Array<{ _id: string }>[number]>('bankTransaction', { relatedVoucherRef: voucherId }))[0] || null;
    if (existingTx) {
        return NextResponse.json({ error: 'Bon ini sudah punya mutasi bank terkait' }, { status: 409 });
    }

    const existingInitialDisbursement = (await listDocumentsByFilter<Array<{ _id: string }>[number]>(
        'driverVoucherDisbursement',
        { voucherRef: voucherId, kind: 'INITIAL' }
    ))[0] || null;

    const bank = await getLedgerAccount(issueBankRef);
    if (!bank) {
        return NextResponse.json({ error: 'Rekening sumber tidak ditemukan' }, { status: 404 });
    }

    const initialAmount = getDriverVoucherInitialCash(voucher);
    const { startingBalance: repairStartingBalance, nextBalance: newBalance } = computeLedgerDebitBalance(bank.currentBalance, initialAmount);
    if (newBalance < 0) {
        return NextResponse.json(
            { error: `Saldo ${bank.bankName} tidak cukup untuk rekonsiliasi pencairan bon. Saldo tersedia ${formatAuditMoney(repairStartingBalance)}` },
            { status: 409 }
        );
    }
    const repairTransactionId = crypto.randomUUID();
    await createDocument({
        _id: repairTransactionId,
        _type: 'bankTransaction',
        bankAccountRef: issueBankRef,
        bankAccountName: bank.bankName,
        bankAccountNumber: bank.accountNumber,
        type: 'DEBIT',
        amount: initialAmount,
        date: voucher.issuedDate,
        description: `Rekonsiliasi pencairan bon ${voucher.bonNumber}`,
        balanceAfter: newBalance,
        relatedVoucherRef: voucherId,
    });
    // Bank balance update via recompute to ensure consistency
    await recomputeBankLedgerBalancesForAccounts([issueBankRef]);
    await updateDocument(voucherId, {
        issueBankRef,
        issueBankName: bank.bankName,
        initialCashGiven: initialAmount,
        totalIssuedAmount: getDriverVoucherIssuedAmount(voucher),
    }, 'driverVoucher');
    if (!existingInitialDisbursement) {
        await createDocument({
            _id: crypto.randomUUID(),
            _type: 'driverVoucherDisbursement',
            voucherRef: voucherId,
            date: voucher.issuedDate,
            amount: initialAmount,
            kind: 'INITIAL',
            status: 'ACTIVE',
            bankAccountRef: issueBankRef,
            bankAccountName: bank.bankName,
            bankAccountNumber: bank.accountNumber,
            bankTransactionRef: repairTransactionId,
            createdBy: session._id,
            createdByName: session.name,
        });
    }

    const updatedVoucher = {
        ...voucher,
        issueBankRef,
        issueBankName: bank.bankName,
        initialCashGiven: initialAmount,
        totalIssuedAmount: getDriverVoucherIssuedAmount(voucher),
    };
    await postDriverVoucherIssueJournal(session, updatedVoucher, bank);

    await addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Rekonsiliasi pencairan bon: ${voucher.bonNumber}`);
    return NextResponse.json({ data: updatedVoucher });
}

export async function handleDriverVoucherCoreCorrection(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    if (!voucherId) {
        return NextResponse.json({ error: 'Data koreksi bon tidak lengkap' }, { status: 400 });
    }

    const hasFee = data.driverFeeAmount !== undefined && data.driverFeeAmount !== null && data.driverFeeAmount !== '';
    const hasCash = data.initialCashGiven !== undefined && data.initialCashGiven !== null && data.initialCashGiven !== '';
    const correctedDriverFeeAmount = hasFee ? normalizeCurrencyNumber(data.driverFeeAmount) : undefined;
    const correctedInitialCash = hasCash ? normalizeCurrencyNumber(data.initialCashGiven) : undefined;

    if (hasFee && (!Number.isFinite(correctedDriverFeeAmount) || (correctedDriverFeeAmount ?? 0) < 0)) {
        return NextResponse.json({ error: 'Upah borongan koreksi tidak valid' }, { status: 400 });
    }
    if (hasCash && (!Number.isFinite(correctedInitialCash) || (correctedInitialCash ?? 0) <= 0)) {
        return NextResponse.json({ error: 'Nominal uang jalan awal koreksi harus lebih dari 0' }, { status: 400 });
    }
    if (!hasFee && !hasCash) {
        return NextResponse.json({ error: 'Tidak ada nilai yang dikoreksi' }, { status: 400 });
    }

    const state = await getDriverVoucherState(voucherId);
    if ('error' in state) return state.error;
    if (state.voucher.status === 'SETTLED') {
        return NextResponse.json({ error: 'Bon yang sudah selesai tidak bisa dikoreksi' }, { status: 409 });
    }
    const cancelledTripError = await rejectIfVoucherDeliveryOrderCancelled(state.voucher, 'Koreksi bon');
    if (cancelledTripError) return cancelledTripError;

    const previousDriverFeeAmount = normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 });
    const previousInitialCash = getDriverVoucherInitialCash(state.voucher);
    const nextDriverFeeAmount = hasFee ? (correctedDriverFeeAmount ?? 0) : previousDriverFeeAmount;
    const nextInitialCash = hasCash ? (correctedInitialCash ?? 0) : previousInitialCash;

    const hasFeeChange = nextDriverFeeAmount !== previousDriverFeeAmount;
    const hasCashChange = nextInitialCash !== previousInitialCash;
    if (!hasFeeChange && !hasCashChange) {
        return NextResponse.json({ error: 'Nilai koreksi sama dengan kondisi saat ini' }, { status: 409 });
    }

    const initialDisbursement = state.disbursements.find(disbursement => disbursement.kind === 'INITIAL');
    let reversalTransactionId: string | undefined;
    let newTransactionId = initialDisbursement?.bankTransactionRef;
    let initialBank: BankAccountSummary | null = null;

    if (hasCashChange) {
        if (!initialDisbursement || !initialDisbursement.bankAccountRef || !initialDisbursement.bankTransactionRef) {
            return NextResponse.json(
                { error: 'Riwayat bank bon awal belum lengkap. Gunakan Rekonsiliasi pencairan bon untuk melengkapi rekening sumber.' },
                { status: 409 }
            );
        }
        if (previousInitialCash <= 0) {
            return NextResponse.json({ error: 'Nominal uang jalan awal bon tidak valid' }, { status: 409 });
        }
        initialBank = await getDocumentById<BankAccountSummary>(initialDisbursement.bankAccountRef, 'bankAccount');
        if (!initialBank) {
            return NextResponse.json({ error: 'Rekening historis bon awal tidak ditemukan' }, { status: 404 });
        }

        const oldBankBalanceAfterReversal = readLedgerBalance(initialBank.currentBalance) + previousInitialCash;
        const newBankFinalBalance = oldBankBalanceAfterReversal - nextInitialCash;
        if (newBankFinalBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${initialBank.bankName} tidak cukup untuk koreksi uang jalan bon. Saldo tersedia ${formatAuditMoney(oldBankBalanceAfterReversal)}` },
                { status: 409 }
            );
        }

        reversalTransactionId = `driver-voucher-core-correct-reversal-${voucherId}-${crypto.randomUUID()}`;
        newTransactionId = `driver-voucher-core-correct-${voucherId}-${crypto.randomUUID()}`;

        await createDocument({
            _id: reversalTransactionId,
            _type: 'bankTransaction',
            bankAccountRef: initialDisbursement.bankAccountRef,
            bankAccountName: initialBank.bankName,
            bankAccountNumber: initialBank.accountNumber,
            type: 'CREDIT',
            amount: previousInitialCash,
            date: getBusinessDateValue(),
            description: `Koreksi uang jalan bon ${state.voucher.bonNumber}`,
            balanceAfter: oldBankBalanceAfterReversal,
            relatedVoucherRef: voucherId,
            reversesBankTransactionRef: initialDisbursement.bankTransactionRef,
        });
        await createDocument({
            _id: newTransactionId,
            _type: 'bankTransaction',
            bankAccountRef: initialDisbursement.bankAccountRef,
            bankAccountName: initialBank.bankName,
            bankAccountNumber: initialBank.accountNumber,
            type: 'DEBIT',
            amount: nextInitialCash,
            date: state.voucher.issuedDate,
            description: `Koreksi uang jalan bon ${state.voucher.bonNumber}`,
            balanceAfter: newBankFinalBalance,
            relatedVoucherRef: voucherId,
            replacesBankTransactionRef: initialDisbursement.bankTransactionRef,
        });
        // Bank balance update via recompute to ensure consistency
        await recomputeBankLedgerBalancesForAccounts([initialDisbursement.bankAccountRef]);
    }

    const nextIssuedAmount = Math.max(
        state.disbursements.reduce((sum, existing) => {
            const rowAmount = existing._id === initialDisbursement?._id
                ? nextInitialCash
                : normalizeNumber(existing.amount || 0, { maxFractionDigits: 0 });
            return sum + rowAmount;
        }, 0),
        nextInitialCash
    );
    const totals = computeDriverVoucherTotals(
        nextIssuedAmount,
        state.items.reduce((sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }), 0),
        nextDriverFeeAmount
    );

    // Keep the linked DO taripBorongan snapshot in sync when upah is corrected
    if (hasFeeChange) {
        const deliveryOrderRef = normalizeOptionalText(state.voucher.deliveryOrderRef);
        if (deliveryOrderRef) {
            await updateDocument(deliveryOrderRef, { taripBorongan: nextDriverFeeAmount }, 'deliveryOrder');
        }
    }

    const voucherPatch: Record<string, unknown> = {
        driverFeeAmount: nextDriverFeeAmount,
        totalSpent: totals.totalSpent,
        totalClaimAmount: totals.totalClaimAmount,
        balance: totals.balance,
    };
    if (hasCashChange) {
        voucherPatch.cashGiven = nextInitialCash;
        voucherPatch.initialCashGiven = nextInitialCash;
        voucherPatch.totalIssuedAmount = nextIssuedAmount;
    }
    await updateDocument(voucherId, voucherPatch, 'driverVoucher');

    if (hasCashChange && initialDisbursement && initialBank) {
        await updateDocument(initialDisbursement._id, {
            date: state.voucher.issuedDate,
            amount: nextInitialCash,
            bankTransactionRef: newTransactionId,
            updatedAt: new Date().toISOString(),
            updatedBy: session._id,
            updatedByName: session.name,
            replacedBankTransactionRef: initialDisbursement.bankTransactionRef,
            adjustmentBankTransactionRef: reversalTransactionId,
        }, 'driverVoucherDisbursement');

        const updatedVoucher = {
            ...state.voucher,
            ...voucherPatch,
        };
        await voidJournalEntryForSource(session, 'DRIVER_VOUCHER', voucherId, 'ISSUE');
        await postDriverVoucherIssueJournal(session, updatedVoucher, initialBank);
    }

    const updatedVoucher = {
        ...state.voucher,
        ...voucherPatch,
    };

    const auditParts: string[] = [];
    if (hasCashChange) auditParts.push(`uang jalan awal ${formatAuditMoney(previousInitialCash)} menjadi ${formatAuditMoney(nextInitialCash)}`);
    if (hasFeeChange) auditParts.push(`upah borongan ${formatAuditMoney(previousDriverFeeAmount)} menjadi ${formatAuditMoney(nextDriverFeeAmount)}`);
    await addAuditLog(
        session,
        'UPDATE',
        'driver-vouchers',
        voucherId,
        `Koreksi bon ${state.voucher.bonNumber}: ${auditParts.join(', ')}`
    );

    return NextResponse.json({ data: updatedVoucher });
}

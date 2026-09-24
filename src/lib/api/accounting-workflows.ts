import { NextResponse } from 'next/server';

import { formatJournalNumber, normalizeLedgerAmount } from '@/lib/accounting';
import { assertAccountingPeriodOpen } from '@/lib/api/accounting-period-lock';
import {
    createDocument,
    getAllDocuments,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import { clearRelationalReadCache } from '@/lib/supabase-relational';
import type { AccountingAccountType, AccountingNormalBalance, AccountingPeriod, ChartOfAccount, JournalEntry, JournalLine } from '@/lib/types';

import {
    assertIsoDate,
    isPlainObject,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type NormalizedManualJournalLine = {
    accountRef: string;
    debit: number;
    credit: number;
    memo?: string;
};

const WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS = new Set([
    'cash_on_hand',
    'bank',
    'accounts_receivable',
    'accounts_payable',
    'inventory',
    'driver_advance',
    'customer_deposit',
]);

const WORKFLOW_CONTROL_ACCOUNT_LABELS: Record<string, string> = {
    cash_on_hand: 'Kas Tunai',
    bank: 'Bank',
    accounts_receivable: 'Piutang Usaha',
    accounts_payable: 'Hutang Dagang',
    inventory: 'Persediaan Barang Gudang',
    driver_advance: 'Uang Muka Supir / Bon',
    customer_deposit: 'Titipan / Kelebihan Bayar Customer',
};

function cleanAmount(value: unknown) {
    return Math.max(normalizeLedgerAmount(value), 0);
}

/**
 * Build journal number after collision - starts from lastAttemptedSequence + 1
 * to avoid reusing a number that just caused a collision.
 */
async function buildManualJournalNumberAfterCollision(entryDate: string, lastAttemptedSequence: number) {
    const monthPrefix = entryDate.replace(/-/g, '').slice(0, 6);
    const existingEntries = await getAllDocuments<JournalEntry>('journalEntry');
    const maxSequence = existingEntries.reduce((max, entry) => {
        const entryNumber = typeof entry.entryNumber === 'string' ? entry.entryNumber : '';
        if (!entryNumber.startsWith(`JRN-${monthPrefix}-`)) return max;
        const sequence = Number.parseInt(entryNumber.slice(`JRN-${monthPrefix}-`.length), 10);
        return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
    // After collision, MUST start from max+1 to avoid stale reads
    return formatJournalNumber(entryDate, Math.max(maxSequence + 1, lastAttemptedSequence + 1));
}

async function buildManualJournalNumber(entryDate: string) {
    return buildManualJournalNumberAfterCollision(entryDate, 0);
}

function isDuplicateJournalNumberError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /entry_number|journal_entries_entry_number|duplicate key|unique constraint|23505/i.test(message);
}

async function createManualJournalEntryWithRetry(entryDoc: JournalEntry, entryDate: string) {
    let lastError: unknown = null;
    let lastAttemptedSequence = 0;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        // After collision, rebuild from collision point to avoid stale reads
        const entryNumber = attempt === 0
            ? await buildManualJournalNumber(entryDate)
            : await buildManualJournalNumberAfterCollision(entryDate, lastAttemptedSequence);

        // Track sequence for next retry
        const match = entryNumber.match(/JRN-\d{6}-(\d+)/);
        lastAttemptedSequence = match ? Number.parseInt(match[1], 10) : lastAttemptedSequence + 1;

        const nextEntry = {
            ...entryDoc,
            entryNumber,
        };
        try {
            await createDocument(nextEntry as unknown as { _type: string; [key: string]: unknown });
            return nextEntry;
        } catch (error) {
            lastError = error;
            if (!isDuplicateJournalNumberError(error)) {
                throw error;
            }
            clearRelationalReadCache();
            // After collision, rebuild number from current max to avoid stale reads
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error('Gagal membuat nomor jurnal yang unik');
}

function normalizeManualLines(value: unknown) {
    if (!Array.isArray(value)) {
        throw new Error('Detail jurnal wajib diisi');
    }

    return value
        .filter(isPlainObject)
        .map((line): NormalizedManualJournalLine => ({
            accountRef: typeof line.accountRef === 'string' ? line.accountRef.trim() : '',
            debit: cleanAmount(line.debit),
            credit: cleanAmount(line.credit),
            memo: normalizeOptionalText(line.memo),
        }))
        .filter(line => line.accountRef || line.debit > 0 || line.credit > 0);
}

export async function handleManualJournalCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const entryDate = normalizeText(data.entryDate);
    try {
        assertIsoDate(entryDate, 'Tanggal jurnal');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal jurnal tidak valid' },
            { status: 400 },
        );
    }

    const memo = normalizeText(data.memo);
    if (!memo) {
        return NextResponse.json({ error: 'Memo jurnal wajib diisi' }, { status: 400 });
    }
    try {
        await assertAccountingPeriodOpen(entryDate, 'Jurnal manual');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Periode akuntansi sudah dikunci' },
            { status: 409 },
        );
    }

    let normalizedLines: ReturnType<typeof normalizeManualLines>;
    try {
        normalizedLines = normalizeManualLines(data.lines);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Detail jurnal tidak valid' },
            { status: 400 },
        );
    }

    if (normalizedLines.length < 2) {
        return NextResponse.json({ error: 'Jurnal minimal memiliki 2 baris akun' }, { status: 400 });
    }

    const totalDebit = normalizedLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = normalizedLines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit <= 0 || totalCredit <= 0) {
        return NextResponse.json({ error: 'Jurnal harus memiliki debit dan kredit' }, { status: 400 });
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return NextResponse.json(
            { error: `Jurnal belum balance. Debit ${totalDebit}, kredit ${totalCredit}` },
            { status: 400 },
        );
    }

    const accountCache = new Map<string, ChartOfAccount>();
    const resolvedLines: Array<typeof normalizedLines[number] & { account: ChartOfAccount }> = [];
    for (const line of normalizedLines) {
        if (!line.accountRef) {
            return NextResponse.json({ error: 'Semua baris jurnal wajib memilih akun' }, { status: 400 });
        }
        if (line.debit > 0 && line.credit > 0) {
            return NextResponse.json({ error: 'Satu baris jurnal hanya boleh berisi debit atau kredit' }, { status: 400 });
        }
        if (line.debit === 0 && line.credit === 0) {
            return NextResponse.json({ error: 'Nominal debit/kredit wajib diisi' }, { status: 400 });
        }

        let account = accountCache.get(line.accountRef);
        if (!account) {
            const loadedAccount = await getDocumentById<ChartOfAccount>(line.accountRef, 'chartOfAccount');
            if (!loadedAccount) {
                return NextResponse.json({ error: 'Akun jurnal tidak ditemukan' }, { status: 404 });
            }
            account = loadedAccount;
            if (account.active === false) {
                return NextResponse.json({ error: `Akun ${account.code} - ${account.name} tidak aktif` }, { status: 409 });
            }
            if (account.systemKey && WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS.has(account.systemKey)) {
                const accountLabel = WORKFLOW_CONTROL_ACCOUNT_LABELS[account.systemKey] || `${account.code} - ${account.name}`;
                return NextResponse.json(
                    { error: `Akun kontrol ${accountLabel} harus lewat workflow operasional terkait agar saldo rincian dan buku besar tetap sinkron.` },
                    { status: 409 },
                );
            }
            accountCache.set(line.accountRef, account);
        }
        resolvedLines.push({ ...line, account });
    }

    const entryId = `manual-journal-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const sourceNumber = normalizeOptionalText(data.sourceNumber);
    const entryDoc: JournalEntry = {
        _id: entryId,
        _type: 'journalEntry',
        entryNumber: '',
        entryDate,
        memo,
        sourceType: 'MANUAL_JOURNAL',
        sourceRef: entryId,
        sourceEvent: 'POST',
        sourceNumber,
        sourceLabel: 'Jurnal Manual',
        status: 'POSTED',
        totalDebit,
        totalCredit,
        postedAt: now,
        postedBy: session._id,
        postedByName: session.name,
    };

    const createdEntry = await createManualJournalEntryWithRetry(entryDoc, entryDate);
    for (const [index, line] of resolvedLines.entries()) {
        const lineDoc: JournalLine = {
            _id: `manual-journal-line-${crypto.randomUUID()}`,
            _type: 'journalLine',
            journalEntryRef: entryId,
            lineNumber: index + 1,
            accountRef: line.account._id,
            accountCode: line.account.code,
            accountName: line.account.name,
            accountType: line.account.accountType,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo,
        };
        await createDocument(lineDoc as unknown as { _type: string; [key: string]: unknown });
    }

    await addAuditLog(session, 'CREATE', 'journal-entries', entryId, `Jurnal manual ${createdEntry.entryNumber} dibuat`);
    return NextResponse.json({ data: createdEntry });
}

export async function handleManualJournalVoid(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const id = normalizeText(data.id);
    if (!id) {
        return NextResponse.json({ error: 'Jurnal tidak valid' }, { status: 400 });
    }

    const entry = await getDocumentById<JournalEntry>(id, 'journalEntry');
    if (!entry) {
        return NextResponse.json({ error: 'Jurnal tidak ditemukan' }, { status: 404 });
    }
    if (entry.sourceType !== 'MANUAL_JOURNAL') {
        return NextResponse.json({ error: 'Hanya jurnal manual yang boleh dibatalkan dari halaman ini' }, { status: 409 });
    }
    if (entry.status === 'VOID') {
        return NextResponse.json({ error: 'Jurnal sudah dibatalkan' }, { status: 409 });
    }

    const activeDuplicates = await listDocumentsByFilter<JournalEntry>('journalEntry', {
        sourceType: 'MANUAL_JOURNAL',
        sourceRef: entry.sourceRef || id,
        sourceEvent: entry.sourceEvent || 'POST',
    });
    if (activeDuplicates.filter(item => item.status !== 'VOID').length > 1) {
        return NextResponse.json({ error: 'Ada lebih dari satu jurnal manual aktif untuk referensi ini. Audit dulu sebelum dibatalkan.' }, { status: 409 });
    }
    try {
        await assertAccountingPeriodOpen(entry.entryDate, 'Pembatalan jurnal manual');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Periode akuntansi sudah dikunci' },
            { status: 409 },
        );
    }

    const updated = await updateDocument(id, {
        status: 'VOID',
        voidedAt: new Date().toISOString(),
        voidedBy: session._id,
        voidedByName: session.name,
    }, 'journalEntry');

    await addAuditLog(session, 'VOID', 'journal-entries', id, `Jurnal manual ${entry.entryNumber} dibatalkan`);
    return NextResponse.json({ data: updated });
}

export async function handleAccountingPeriodClose(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const period = normalizeText(data.period);
    const startDate = normalizeText(data.startDate);
    const endDate = normalizeText(data.endDate);

    if (!period) {
        return NextResponse.json({ error: 'Periode wajib diisi' }, { status: 400 });
    }
    try {
        assertIsoDate(startDate, 'Tanggal awal periode');
        assertIsoDate(endDate, 'Tanggal akhir periode');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal periode tidak valid' },
            { status: 400 },
        );
    }
    if (startDate > endDate) {
        return NextResponse.json({ error: 'Tanggal awal periode tidak boleh melebihi tanggal akhir' }, { status: 400 });
    }

    const existing = (await listDocumentsByFilter<AccountingPeriod>('accountingPeriod', { period }))[0] || null;
    const now = new Date().toISOString();
    const patch = {
        period,
        startDate,
        endDate,
        status: 'CLOSED' as const,
        closedAt: now,
        closedBy: session._id,
        closedByName: session.name,
    };

    const documentId = existing?._id || `accounting-period-${period.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const updated = existing
        ? await updateDocument(documentId, patch, 'accountingPeriod')
        : await createDocument({
            _id: documentId,
            _type: 'accountingPeriod',
            ...patch,
        });

    await addAuditLog(session, 'UPDATE', 'accounting-periods', documentId, `Periode ${period} dikunci`);
    return NextResponse.json({ data: updated });
}

export async function handleAccountingPeriodOpen(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const period = normalizeText(data.period);
    if (!period) {
        return NextResponse.json({ error: 'Periode wajib diisi' }, { status: 400 });
    }

    const existing = (await listDocumentsByFilter<AccountingPeriod>('accountingPeriod', { period }))[0] || null;
    if (!existing) {
        return NextResponse.json({ error: 'Periode belum pernah dikunci' }, { status: 404 });
    }

    const updated = await updateDocument(existing._id, {
        status: 'OPEN',
        closedAt: null,
        closedBy: null,
        closedByName: null,
    }, 'accountingPeriod');

    await addAuditLog(session, 'UPDATE', 'accounting-periods', existing._id, `Periode ${period} dibuka kembali`);
    return NextResponse.json({ data: updated });
}

const ACCOUNT_TYPES: AccountingAccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA_REVENUE'];
const NORMAL_BALANCES: AccountingNormalBalance[] = ['DEBIT', 'CREDIT'];

function normalizeAccountType(value: unknown): AccountingAccountType {
    const normalized = normalizeText(value).toUpperCase() as AccountingAccountType;
    if (!ACCOUNT_TYPES.includes(normalized)) {
        throw new Error(`Tipe akun tidak valid. Pilihan: ${ACCOUNT_TYPES.join(', ')}`);
    }
    return normalized;
}

function normalizeNormalBalance(value: unknown): AccountingNormalBalance {
    const normalized = normalizeText(value).toUpperCase() as AccountingNormalBalance;
    if (!NORMAL_BALANCES.includes(normalized)) {
        throw new Error(`Saldo normal tidak valid. Pilihan: ${NORMAL_BALANCES.join(', ')}`);
    }
    return normalized;
}

async function findExistingChartOfAccountByCode(code: string, excludeId?: string) {
    const existing = await listDocumentsByFilter<ChartOfAccount>('chartOfAccount', { code });
    return existing.find(account => account._id !== excludeId) || null;
}

export async function handleChartOfAccountCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const code = normalizeText(data.code);
    const name = normalizeText(data.name);
    if (!code) {
        return NextResponse.json({ error: 'Kode akun wajib diisi' }, { status: 400 });
    }
    if (!name) {
        return NextResponse.json({ error: 'Nama akun wajib diisi' }, { status: 400 });
    }

    let accountType: AccountingAccountType;
    let normalBalance: AccountingNormalBalance;
    try {
        accountType = normalizeAccountType(data.accountType);
        normalBalance = normalizeNormalBalance(data.normalBalance);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tipe akun tidak valid' },
            { status: 400 },
        );
    }

    const duplicate = await findExistingChartOfAccountByCode(code);
    if (duplicate) {
        return NextResponse.json({ error: `Kode akun ${code} sudah dipakai oleh ${duplicate.name}` }, { status: 409 });
    }

    const accountId = `chart-of-account-${crypto.randomUUID()}`;
    const accountDoc: ChartOfAccount = {
        _id: accountId,
        _type: 'chartOfAccount',
        code,
        name,
        accountType,
        normalBalance,
        active: true,
        description: normalizeOptionalText(data.description) || undefined,
    };

    await createDocument(accountDoc as unknown as { _type: string; [key: string]: unknown });
    await addAuditLog(session, 'CREATE', 'chart-of-accounts', accountId, `Akun perkiraan ${code} - ${name} dibuat`);
    return NextResponse.json({ data: accountDoc });
}

export async function handleChartOfAccountUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const id = normalizeText(data.id);
    if (!id) {
        return NextResponse.json({ error: 'Akun tidak valid' }, { status: 400 });
    }

    const existing = await getDocumentById<ChartOfAccount>(id, 'chartOfAccount');
    if (!existing) {
        return NextResponse.json({ error: 'Akun perkiraan tidak ditemukan' }, { status: 404 });
    }
    if (existing.systemKey) {
        return NextResponse.json(
            { error: `Akun sistem ${existing.code} - ${existing.name} tidak bisa diubah. Untuk menonaktifkan, hubungi proses migrasi data.` },
            { status: 409 },
        );
    }

    const nextCode = normalizeText(data.code);
    const nextName = normalizeText(data.name);
    if (!nextCode) {
        return NextResponse.json({ error: 'Kode akun wajib diisi' }, { status: 400 });
    }
    if (!nextName) {
        return NextResponse.json({ error: 'Nama akun wajib diisi' }, { status: 400 });
    }

    let accountType: AccountingAccountType;
    let normalBalance: AccountingNormalBalance;
    try {
        accountType = normalizeAccountType(data.accountType);
        normalBalance = normalizeNormalBalance(data.normalBalance);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tipe akun tidak valid' },
            { status: 400 },
        );
    }

    const duplicate = await findExistingChartOfAccountByCode(nextCode, id);
    if (duplicate) {
        return NextResponse.json({ error: `Kode akun ${nextCode} sudah dipakai oleh ${duplicate.name}` }, { status: 409 });
    }

    const description = normalizeOptionalText(data.description) || undefined;
    const nextActive = typeof data.active === 'boolean' ? data.active : existing.active;
    const patch: Partial<ChartOfAccount> = {
        code: nextCode,
        name: nextName,
        accountType,
        normalBalance,
        description,
        active: nextActive,
    };

    const updated = await updateDocument(id, patch, 'chartOfAccount');
    await addAuditLog(session, 'UPDATE', 'chart-of-accounts', id, `Akun perkiraan ${nextCode} - ${nextName} diubah`);
    return NextResponse.json({ data: updated });
}

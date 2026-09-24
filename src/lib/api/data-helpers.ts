import { createDocument, getCompanyProfile, getDocumentById, listDocumentsByFilter, updateDocument } from '@/lib/repositories/document-store';
import { parseFormattedNumberish, type FormattedNumberParseOptions } from '@/components/FormattedNumberInput.helpers';
import { normalizeUserRole } from '@/lib/rbac';
import type { CompanyProfile, PaymentMethod, PerUserModulePermissions, User } from '@/lib/types';

export type ApiSession = { _id: string; name: string; email?: string; role: User['role']; modulePermissions?: PerUserModulePermissions };
export type PublicUser = Omit<User, 'passwordHash'>;
export type AuditLogActor = Pick<ApiSession, '_id' | 'name'> & Partial<Pick<ApiSession, 'email' | 'role'>>;

export type BankAccountSummary = {
    _id: string;
    _rev?: string;
    currentBalance: number;
    bankName: string;
    accountNumber?: string;
    accountType?: 'BANK' | 'CASH';
    systemKey?: string;
    accountHolder?: string;
    active?: boolean;
};

export const CASH_ACCOUNT_SYSTEM_KEY = 'cash-on-hand';
export const PAYMENT_METHOD_SET = new Set<PaymentMethod>(['TRANSFER', 'CASH', 'OTHER']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeOptionalText(value: unknown) {
    const normalized = normalizeText(value);
    return normalized || undefined;
}

export function normalizeNumber(value: unknown, options?: FormattedNumberParseOptions) {
    return parseFormattedNumberish(value, options);
}

export function normalizeCurrencyNumber(value: unknown, options?: FormattedNumberParseOptions) {
    const normalized = normalizeNumber(value, options);
    if (!Number.isFinite(normalized)) {
        return normalized;
    }
    return Number.isInteger(normalized) ? normalized : Number.NaN;
}

export function normalizePaymentMethod(value: unknown) {
    return typeof value === 'string' && PAYMENT_METHOD_SET.has(value as PaymentMethod)
        ? value as PaymentMethod
        : undefined;
}

export function readLedgerBalance(value: unknown) {
    return Math.max(normalizeCurrencyNumber(value ?? 0, { maxFractionDigits: 0 }), 0);
}

export function computeLedgerDebitBalance(currentBalance: unknown, amount: number) {
    const startingBalance = readLedgerBalance(currentBalance);
    return {
        startingBalance,
        nextBalance: startingBalance - amount,
    };
}

export function assertIsoDate(value: string, label: string) {
    if (!ISO_DATE_RE.test(value)) {
        throw new Error(`${label} tidak valid`);
    }
}

export function assertIsoDateTime(value: string, label: string) {
    if (!ISO_DATE_TIME_RE.test(value)) {
        throw new Error(`${label} tidak valid`);
    }
}

export function extractRefId(value: unknown) {
    if (typeof value === 'string' && value) {
        return value;
    }

    if (isPlainObject(value) && typeof value._ref === 'string' && value._ref) {
        return value._ref;
    }

    return null;
}

export function sanitizeUserForClient(user: User): PublicUser {
    const { passwordHash, ...safeUser } = user;
    void passwordHash;
    return {
        ...safeUser,
        role: normalizeUserRole(user.role),
    };
}

function normalizeCompanyTermDays(value: unknown, fallback: number) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || !/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            return fallback;
        }
    }

    const normalized = normalizeNumber(value, { allowDecimal: false, maxFractionDigits: 0 });
    if (!Number.isFinite(normalized) || normalized < 0) {
        return fallback;
    }
    return Math.floor(normalized);
}

function normalizeCompanyInvoiceMode(value: unknown, fallback: 'DO' | 'ORDER' = 'DO') {
    const normalized = normalizeOptionalText(value)?.toUpperCase();
    return normalized === 'DO' || normalized === 'ORDER' ? normalized : fallback;
}

function normalizeCompanyDateFormat(value: unknown, fallback = 'DD/MM/YYYY') {
    const normalized = normalizeOptionalText(value);
    return normalized === 'DD/MM/YYYY' || normalized === 'dd/MM/yyyy' ? normalized : fallback;
}

export function sanitizeCompanyProfileForRole(
    company: CompanyProfile,
    role: User['role']
): CompanyProfile {
    const normalizedDefaultTermDays = normalizeCompanyTermDays(company.invoiceSettings?.defaultTermDays, 14);
    const normalizedDueDateDays = normalizeCompanyTermDays(company.invoiceSettings?.dueDateDays, normalizedDefaultTermDays);
    const normalizedInvoiceMode = normalizeCompanyInvoiceMode(company.invoiceSettings?.invoiceMode, 'DO');
    const normalizedDocumentShowContact =
        typeof company.documentSettings?.showContact === 'boolean'
            ? company.documentSettings.showContact
            : true;
    const normalizedDocumentDateFormat = normalizeCompanyDateFormat(company.documentSettings?.dateFormat);
    const normalizedCompany: CompanyProfile = {
        ...company,
        invoiceSettings: {
            ...company.invoiceSettings,
            defaultTermDays: normalizedDefaultTermDays,
            dueDateDays: normalizedDueDateDays,
            invoiceMode: normalizedInvoiceMode,
        },
        documentSettings: {
            ...company.documentSettings,
            showContact: normalizedDocumentShowContact,
            dateFormat: normalizedDocumentDateFormat,
        },
    };

    if (role === 'OWNER') {
        return normalizedCompany;
    }

    const normalizedRole = normalizeUserRole(role);
    const canSeeInvoiceFinanceContext = normalizedRole === 'OPERASIONAL' || normalizedRole === 'FINANCE';

    return {
        ...normalizedCompany,
        npwp: canSeeInvoiceFinanceContext ? normalizedCompany.npwp : undefined,
        bankName: canSeeInvoiceFinanceContext ? normalizedCompany.bankName : undefined,
        bankAccount: canSeeInvoiceFinanceContext ? normalizedCompany.bankAccount : undefined,
        bankHolder: canSeeInvoiceFinanceContext ? normalizedCompany.bankHolder : undefined,
        headerStampUrl: undefined,
        signatureStampUrl: undefined,
        numberingSettings: {
            resiPrefix: '',
            resiCounter: 0,
            resiPeriod: undefined,
            doPrefix: '',
            doCounter: 0,
            doPeriod: undefined,
            invoicePrefix: '',
            invoiceCounter: 0,
            invoicePeriod: undefined,
            notaPrefix: undefined,
            notaCounter: undefined,
            notaPeriod: undefined,
            notaSeriesCode: canSeeInvoiceFinanceContext ? normalizedCompany.numberingSettings?.notaSeriesCode : undefined,
            receiptPrefix: undefined,
            receiptCounter: undefined,
            receiptPeriod: undefined,
            boronganPrefix: undefined,
            boronganCounter: undefined,
            boronganPeriod: undefined,
            bonPrefix: undefined,
            bonCounter: undefined,
            bonPeriod: undefined,
            incidentPrefix: '',
            incidentCounter: 0,
            incidentPeriod: undefined,
        },
        invoiceSettings: {
            defaultTermDays: canSeeInvoiceFinanceContext ? normalizedDefaultTermDays : 0,
            dueDateDays: canSeeInvoiceFinanceContext ? normalizedDueDateDays : 0,
            footerNote: canSeeInvoiceFinanceContext ? normalizedCompany.invoiceSettings?.footerNote || '' : '',
            invoiceMode: canSeeInvoiceFinanceContext ? normalizedInvoiceMode : 'DO',
            invoiceBankAccountRefs: canSeeInvoiceFinanceContext
                ? Array.isArray(normalizedCompany.invoiceSettings?.invoiceBankAccountRefs)
                    ? normalizedCompany.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                    : []
                : [],
            defaultInvoiceBankAccountRef: canSeeInvoiceFinanceContext &&
                typeof normalizedCompany.invoiceSettings?.defaultInvoiceBankAccountRef === 'string'
                ? normalizedCompany.invoiceSettings.defaultInvoiceBankAccountRef
                : undefined,
        },
        documentSettings: {
            showContact: normalizedDocumentShowContact,
            dateFormat: normalizedDocumentDateFormat,
        },
    };
}

export async function ensureCashAccount() {
    const existing = (await listDocumentsByFilter<BankAccountSummary>('bankAccount', {
        systemKey: CASH_ACCOUNT_SYSTEM_KEY,
    }))[0] || null;
    if (existing) {
        if (existing.active === false) {
            return updateDocument<BankAccountSummary>(existing._id, { active: true });
        }
        return existing;
    }

    const company = await getCompanyProfile<{ name?: string }>();
    return createDocument<BankAccountSummary>({
        _id: 'bank-cash-on-hand',
        _type: 'bankAccount',
        bankName: 'Kas Tunai',
        accountNumber: 'CASH',
        accountHolder: company?.name || 'Perusahaan',
        accountType: 'CASH',
        systemKey: CASH_ACCOUNT_SYSTEM_KEY,
        initialBalance: 0,
        currentBalance: 0,
        active: true,
        notes: 'Akun sistem untuk mencatat kas tunai operasional.',
    });
}

export async function getLedgerAccount(accountRef: string) {
    const account = await getDocumentById<BankAccountSummary>(accountRef, 'bankAccount');
    if (!account || account.active === false) {
        return null;
    }
    return account;
}

export function isMutationConflictError(err: unknown) {
    const statusCode =
        isPlainObject(err) && typeof err.statusCode === 'number'
            ? err.statusCode
            : isPlainObject(err) && typeof err.status === 'number'
                ? err.status
                : undefined;
    const errorCode =
        isPlainObject(err) && typeof err.code === 'string'
            ? err.code
            : undefined;
    const message =
        err instanceof Error
            ? err.message
            : isPlainObject(err) && typeof err.message === 'string'
                ? err.message
                : '';

    return (
        statusCode === 409
        || errorCode === '23505'
        || /revision/i.test(message)
        || /conflict/i.test(message)
        || /duplicate key/i.test(message)
        || /already exists/i.test(message)
        || (/mutation failed/i.test(message) && /was not found/i.test(message))
    );
}

export async function writeAuditLog(
    actor: AuditLogActor,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) {
    try {
        await createDocument({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            actorUserEmail: normalizeOptionalText(actor.email),
            actorUserRole: actor.role ? normalizeUserRole(actor.role) : undefined,
            action,
            entityType,
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        }, { skipApiReadCacheClear: true, skipRelationalReadCacheClear: true });
    } catch (error) {
        console.warn('Audit log write failed', error);
    }
}

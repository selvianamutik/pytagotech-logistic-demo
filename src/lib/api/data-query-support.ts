import type { ApiSession } from '@/lib/api/data-helpers';
import { registerApiReadCacheInvalidator } from '@/lib/api/read-cache';
import { addDaysToDateValue, getBusinessCalendarDateParts, getBusinessDateValue } from '@/lib/business-date';
import { getDocumentById, listDocumentFieldsByFilter, listDocuments, listDocumentsByFilter } from '@/lib/repositories/document-store';
import {
    EMPLOYEE_ATTENDANCE_PERIOD_LABELS,
    summarizeEmployeeAttendanceRecords,
    getEmployeeAttendancePeriodRange,
    isDateWithinEmployeeAttendanceRange,
    normalizeEmployeeAttendanceStatus,
    type EmployeeAttendancePeriod,
} from '@/lib/employee-attendance';
import { filterExpensesByRole, hasPageAccess, hasPermission } from '@/lib/rbac';
import { getSuggestedVehicleTireLayout, resolveTireAssetStatus, resolveTireSlotCode } from '@/lib/tire-slots';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import {
    applyDerivedCustomerReceiptOverpaymentState,
    applyDerivedFreightNotaReceivableState,
    buildCustomerOverpaymentCases,
    getCustomerOverpaymentRefundTotals,
    getFreightNotaPaymentTotals,
    sortCustomerOverpaymentCases,
} from '@/lib/customer-overpayments';
import type {
    BankAccount,
    BankTransaction,
    CustomerOverpayment,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    DriverBorongan,
    DriverBoronganItem,
    DriverVoucherDisbursement,
    DriverVoucherItem,
    DriverVoucher,
    Expense,
    FreightNota,
    Employee,
    EmployeeAttendanceRecord,
    Payment,
    TireEvent,
    AuditLog,
    UserRole,
    Vehicle,
} from '@/lib/types';
import { getDriverVoucherFinancialSummary, getDriverVoucherIssuedAmount, getReceivableNetAmount } from '@/lib/utils';

function parseWholeMoneyLike(value: unknown) {
    return Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
}

async function getDocumentCount(docType: string, filterObj: Record<string, unknown> = {}) {
    const result = await listDocuments(docType, {
        filterObj,
        page: 1,
        pageSize: 1,
        countStrategy: 'estimated',
    });
    return result.total;
}

function isActiveDriverVoucherDisbursement(row: Pick<DriverVoucherDisbursement, 'status'>) {
    return row.status !== 'VOID';
}

function normalizeTextSearch(value: unknown) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function sortEmployeeAttendanceRecords(
    rows: EmployeeAttendanceRecord[],
    sortField?: string,
    sortDir?: 'asc' | 'desc',
) {
    const direction = sortDir === 'asc' ? 1 : -1;
    const field = sortField || 'date';

    return [...rows].sort((left, right) => {
        if (field === 'status') {
            return String(left.status || '').localeCompare(String(right.status || '')) * direction;
        }
        if (field === 'employeeCode') {
            return String(left.employeeCode || '').localeCompare(String(right.employeeCode || '')) * direction;
        }
        if (field === 'employeeName') {
            return String(left.employeeName || '').localeCompare(String(right.employeeName || '')) * direction;
        }
        if (field === 'division') {
            return String(left.division || '').localeCompare(String(right.division || '')) * direction;
        }
        if (field === 'checkInTime') {
            return String(left.checkInTime || '').localeCompare(String(right.checkInTime || '')) * direction;
        }
        const dateCompare = String(left.date || '').localeCompare(String(right.date || '')) * direction;
        if (dateCompare !== 0) return dateCompare;
        return String(left.employeeName || '').localeCompare(String(right.employeeName || '')) * direction;
    });
}

function buildNormalizedAttendanceRecord(
    record: EmployeeAttendanceRecord,
    employeesById: Map<string, Employee>,
) {
    const employee = record.employeeRef ? employeesById.get(record.employeeRef) : undefined;
    return {
        ...record,
        employeeCode: record.employeeCode || employee?.employeeCode || '',
        employeeName: record.employeeName || employee?.name || '',
        position: record.position || employee?.position || '',
        division: record.division || employee?.division || '',
    };
}

async function getEmployeeAttendanceDataset() {
    const [employees, attendanceRows] = await Promise.all([
        listDocumentsByFilter<Employee>('employee', {}),
        listDocumentsByFilter<EmployeeAttendanceRecord>('employeeAttendanceRecord', {}),
    ]);

    const employeesById = new Map(employees.map(employee => [employee._id, employee]));
    const normalizedRows = attendanceRows.map(record => buildNormalizedAttendanceRecord(record, employeesById));

    return {
        employees,
        employeesById,
        attendanceRows: normalizedRows,
    };
}

function filterEmployeeAttendanceRecords(
    rows: EmployeeAttendanceRecord[],
    params: Pick<EmployeeAttendanceListParams, 'search' | 'searchFields' | 'period' | 'date' | 'status' | 'employeeRef'>,
) {
    const search = normalizeTextSearch(params.search);
    const searchableFields = (params.searchFields || []).map(field => field.trim()).filter(Boolean);
    const period = normalizeEmployeeAttendancePeriod(params.period);
    const anchorDate = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : getBusinessDateValue();
    const range = getEmployeeAttendancePeriodRange(period, anchorDate);
    const status = normalizeEmployeeAttendanceStatus(params.status);
    const employeeRef = typeof params.employeeRef === 'string' ? params.employeeRef.trim() : '';
    const fields = searchableFields.length > 0
        ? searchableFields
        : ['employeeCode', 'employeeName', 'division', 'position', 'note', 'date'];

    return rows.filter(record => {
        if (!isDateWithinEmployeeAttendanceRange(record.date, range)) {
            return false;
        }
        if (status && record.status !== status) {
            return false;
        }
        if (employeeRef && record.employeeRef !== employeeRef) {
            return false;
        }
        if (!search) {
            return true;
        }

        return fields.some(field => {
            const value = (record as unknown as Record<string, unknown>)[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });
    });
}

function normalizeBusinessDateValue(value: string | undefined) {
    if (!value) return '';
    const parts = getBusinessCalendarDateParts(value);
    return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function buildInvoiceOverpaymentDetectedDateMap(
    rows: Array<{ invoiceRef?: string; date?: string; editedAt?: string }>
) {
    return rows.reduce<Record<string, string>>((acc, row) => {
        if (!row.invoiceRef) return acc;
        const candidate = normalizeBusinessDateValue(row.editedAt) || normalizeBusinessDateValue(row.date);
        if (!candidate) return acc;
        if (!acc[row.invoiceRef] || candidate > acc[row.invoiceRef]) {
            acc[row.invoiceRef] = candidate;
        }
        return acc;
    }, {});
}

function normalizeAuditActorRole(value: unknown): UserRole | undefined {
    return value === 'OWNER' || value === 'OPERASIONAL' || value === 'FINANCE' || value === 'ARMADA' || value === 'DRIVER' || value === 'ADMIN'
        ? value
        : undefined;
}

function inferAuditActorRoleFromIdentity(input: {
    actorUserRef?: unknown;
    actorUserEmail?: unknown;
    entityRef?: unknown;
}) {
    const ref = typeof input.actorUserRef === 'string'
        ? input.actorUserRef.trim().toLowerCase()
        : typeof input.entityRef === 'string'
            ? input.entityRef.trim().toLowerCase()
            : '';
    const email = typeof input.actorUserEmail === 'string' ? input.actorUserEmail.trim().toLowerCase() : '';
    const identity = `${ref} ${email}`;

    if (identity.includes('user-owner-') || email.startsWith('owner@')) return 'OWNER' satisfies UserRole;
    if (identity.includes('user-admin-') || email.startsWith('admin@')) return 'OPERASIONAL' satisfies UserRole;
    if (identity.includes('user-finance-') || email.startsWith('finance@')) return 'FINANCE' satisfies UserRole;
    if (identity.includes('user-armada-') || email.startsWith('armada@')) return 'ARMADA' satisfies UserRole;
    if (identity.includes('user-driver-') || email.startsWith('driver.')) return 'DRIVER' satisfies UserRole;
    return undefined;
}

function inferAuditActorEmailFromRef(actorUserRef: unknown, entityRef?: unknown) {
    const ref = typeof actorUserRef === 'string'
        ? actorUserRef.trim().toLowerCase()
        : typeof entityRef === 'string'
            ? entityRef.trim().toLowerCase()
            : '';
    if (ref.includes('user-owner-')) return 'owner@company.local';
    if (ref.includes('user-admin-')) return 'admin@company.local';
    if (ref.includes('user-finance-')) return 'finance@company.local';
    if (ref.includes('user-armada-')) return 'armada@company.local';
    return undefined;
}

export type AuditLogPeriod = 'today' | 'yesterday' | 'last7days' | 'thisMonth' | 'thisYear' | 'all';

function normalizeAuditLogPeriod(value?: string | null): AuditLogPeriod {
    if (
        value === 'today' ||
        value === 'yesterday' ||
        value === 'last7days' ||
        value === 'thisMonth' ||
        value === 'thisYear' ||
        value === 'all'
    ) {
        return value;
    }
    return 'today';
}

function getAuditLogBusinessDateValue(log: Pick<AuditLog, 'timestamp' | '_createdAt'>) {
    const parts = getBusinessCalendarDateParts(log.timestamp || log._createdAt || '');
    return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function matchesAuditLogPeriod(
    log: Pick<AuditLog, 'timestamp' | '_createdAt'>,
    period: AuditLogPeriod,
    today: string
) {
    if (period === 'all') return true;

    const businessDate = getAuditLogBusinessDateValue(log);
    if (!businessDate) return false;

    if (period === 'today') return businessDate === today;
    if (period === 'yesterday') return businessDate === addDaysToDateValue(today, -1);
    if (period === 'last7days') return businessDate >= addDaysToDateValue(today, -6) && businessDate <= today;
    if (period === 'thisMonth') return businessDate.slice(0, 7) === today.slice(0, 7);
    if (period === 'thisYear') return businessDate.slice(0, 4) === today.slice(0, 4);
    return true;
}

function getFirstDayOfNextMonth(dateValue: string) {
    const parts = getBusinessCalendarDateParts(dateValue);
    if (!parts) return '';
    const year = Number(parts.year);
    const month = Number(parts.month);
    const nextMonthDate = new Date(Date.UTC(year, month, 1));
    return `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function getFirstDayOfNextYear(dateValue: string) {
    const parts = getBusinessCalendarDateParts(dateValue);
    if (!parts) return '';
    return `${Number(parts.year) + 1}-01-01`;
}

function toJakartaMidnightUtcIso(dateValue: string) {
    const parts = getBusinessCalendarDateParts(dateValue);
    if (!parts) return '';
    return new Date(Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        -7,
        0,
        0,
        0
    )).toISOString();
}

function getAuditLogPeriodTimestampFilter(period: AuditLogPeriod, today: string) {
    if (period === 'all') return null;

    let startDate = today;
    let endDate = addDaysToDateValue(today, 1);

    if (period === 'yesterday') {
        startDate = addDaysToDateValue(today, -1);
        endDate = today;
    } else if (period === 'last7days') {
        startDate = addDaysToDateValue(today, -6);
    } else if (period === 'thisMonth') {
        startDate = `${today.slice(0, 7)}-01`;
        endDate = getFirstDayOfNextMonth(today);
    } else if (period === 'thisYear') {
        startDate = `${today.slice(0, 4)}-01-01`;
        endDate = getFirstDayOfNextYear(today);
    }

    const gte = toJakartaMidnightUtcIso(startDate);
    const lt = toJakartaMidnightUtcIso(endDate);
    return gte && lt ? { gte, lt } : null;
}

function sortAuditLogs(logs: AuditLog[], sortField?: string, sortDir?: 'asc' | 'desc') {
    const field = sortField?.trim() || 'timestamp';
    const direction = sortDir === 'asc' ? 'asc' : 'desc';
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...logs].sort((left, right) => {
        const leftValue = (left as unknown as Record<string, unknown>)[field];
        const rightValue = (right as unknown as Record<string, unknown>)[field];

        if (typeof leftValue === 'string' && typeof rightValue === 'string') {
            return leftValue.localeCompare(rightValue) * multiplier;
        }

        const fallbackLeft = (left.timestamp || left._createdAt || '');
        const fallbackRight = (right.timestamp || right._createdAt || '');
        return fallbackLeft.localeCompare(fallbackRight) * multiplier;
    });
}

const AUDIT_LOG_FILTER_CACHE_TTL_MS = Math.max(
    0,
    Number.parseInt(process.env.AUDIT_LOG_FILTER_CACHE_TTL_MS || '10000', 10) || 10000
);
const SUMMARY_READ_CACHE_TTL_MS = Math.max(
    0,
    Number.parseInt(process.env.SUMMARY_READ_CACHE_TTL_MS || '10000', 10) || 10000
);

const auditLogFilterCache = new Map<string, { expiresAt: number; logs: AuditLog[] }>();
const summaryReadCache = new Map<string, { expiresAt: number; value: unknown }>();

type ApiListReadParams = {
    page?: number;
    pageSize?: number;
    countOnly?: boolean;
};

type ApiListReadResult<T> = {
    items: T[];
    total: number;
};

export function clearAuditLogFilterCache() {
    auditLogFilterCache.clear();
    summaryReadCache.clear();
}

registerApiReadCacheInvalidator(clearAuditLogFilterCache);

function cloneSummaryValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getSummaryReadCache<T>(key: string): T | null {
    if (SUMMARY_READ_CACHE_TTL_MS <= 0) {
        return null;
    }
    const cached = summaryReadCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cloneSummaryValue(cached.value as T);
    }
    if (cached) {
        summaryReadCache.delete(key);
    }
    return null;
}

function setSummaryReadCache<T>(key: string, value: T) {
    if (SUMMARY_READ_CACHE_TTL_MS <= 0) {
        return;
    }
    summaryReadCache.set(key, {
        expiresAt: Date.now() + SUMMARY_READ_CACHE_TTL_MS,
        value: cloneSummaryValue(value),
    });
    while (summaryReadCache.size > 50) {
        const oldestKey = summaryReadCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        summaryReadCache.delete(oldestKey);
    }
}

function stableStringifyCacheValue(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringifyCacheValue).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableStringifyCacheValue(record[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value) ?? 'undefined';
}

function buildApiReadCacheKey(namespace: string, value: unknown) {
    return `${namespace}:${stableStringifyCacheValue(value)}`;
}

function buildPagedListResult<T>(items: T[], params: ApiListReadParams): ApiListReadResult<T> {
    const total = items.length;
    if (params.countOnly) {
        return { items: [], total };
    }

    if (!params.page || !params.pageSize) {
        return { items, total };
    }

    const offset = Math.max(params.page - 1, 0) * Math.max(params.pageSize, 1);
    return {
        items: items.slice(offset, offset + params.pageSize),
        total,
    };
}

function normalizeStringList(values?: Array<string | null | undefined>) {
    return Array.from(new Set(
        (values || [])
            .map(value => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean)
    ));
}

function buildAuditLogFilterCacheKey(params: {
    search?: string;
    searchFields?: string[];
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
    entityRef?: string | null;
    entityRefs?: string[];
    entityType?: string | null;
    entityTypes?: string[];
}) {
    return JSON.stringify({
        search: params.search?.trim().toLowerCase() || '',
        searchFields: normalizeStringList(params.searchFields).sort(),
        sortField: params.sortField?.trim() || 'timestamp',
        sortDir: params.sortDir === 'asc' ? 'asc' : 'desc',
        period: normalizeAuditLogPeriod(params.period),
        entityRefs: normalizeStringList([params.entityRef, ...(params.entityRefs ?? [])]).sort(),
        entityTypes: normalizeStringList([params.entityType, ...(params.entityTypes ?? [])]).sort(),
    });
}

async function getFilteredAuditLogs(params: {
    search?: string;
    searchFields?: string[];
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
    entityRef?: string | null;
    entityRefs?: string[];
    entityType?: string | null;
    entityTypes?: string[];
}) {
    const cacheKey = buildAuditLogFilterCacheKey(params);
    if (AUDIT_LOG_FILTER_CACHE_TTL_MS > 0) {
        const cached = auditLogFilterCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.logs.map(log => ({ ...log }));
        }
        if (cached) {
            auditLogFilterCache.delete(cacheKey);
        }
    }

    const entityRefFilters = normalizeStringList([params.entityRef, ...(params.entityRefs ?? [])]);
    const entityTypeFilters = normalizeStringList([params.entityType, ...(params.entityTypes ?? [])]);
    const today = getBusinessDateValue();
    const period = normalizeAuditLogPeriod(params.period);
    const rawLogFilter: Record<string, unknown> = {};
    if (entityRefFilters.length === 1) {
        rawLogFilter.entityRef = entityRefFilters[0];
    } else if (entityRefFilters.length > 1) {
        rawLogFilter.entityRef = entityRefFilters;
    }
    if (entityTypeFilters.length === 1) {
        rawLogFilter.entityType = entityTypeFilters[0];
    } else if (entityTypeFilters.length > 1) {
        rawLogFilter.entityType = entityTypeFilters;
    }

    const timestampFilter = getAuditLogPeriodTimestampFilter(period, today);
    if (timestampFilter) {
        rawLogFilter.timestamp = timestampFilter;
    }

    const rawLogs = await listDocumentsByFilter<AuditLog & { _createdAt?: string }>('auditLog', rawLogFilter);
    const needsUserHydration = rawLogs.some(log =>
        Boolean(log.actorUserRef) &&
        (!log.actorUserName || !log.actorUserEmail || !log.actorUserRole)
    );
    const users = needsUserHydration
        ? await listDocumentsByFilter<{ _id: string; name?: string; email?: string; role?: string }>('user', {})
        : [];
    const search = params.search?.trim().toLowerCase() || '';
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const searchableFields = searchFields.length > 0
        ? searchFields
        : ['changesSummary', 'actorUserName', 'actorUserRole', 'actorUserEmail', 'actorUserRef', 'entityType', 'entityRef', 'action'];
    const usersById = new Map(users.map(user => [user._id, user]));
    const entityRefs = new Set([
        params.entityRef,
        ...(params.entityRefs ?? []),
    ].map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean));
    const entityTypes = new Set([
        params.entityType,
        ...(params.entityTypes ?? []),
    ].map(value => (typeof value === 'string' ? value.trim() : '')).filter(Boolean));

    const normalizedLogs = rawLogs.map(log => {
        const actor = log.actorUserRef ? usersById.get(log.actorUserRef) : undefined;
        const actorEmail = log.actorUserEmail || actor?.email || inferAuditActorEmailFromRef(log.actorUserRef, log.entityRef);
        const actorRole =
            normalizeAuditActorRole(log.actorUserRole)
            || normalizeAuditActorRole(actor?.role)
            || inferAuditActorRoleFromIdentity({
                actorUserRef: log.actorUserRef,
                actorUserEmail: actorEmail,
                entityRef: log.entityRef,
            });
        return {
            ...log,
            actorUserName: log.actorUserName || actor?.name,
            actorUserEmail: actorEmail,
            actorUserRole: actorRole,
        };
    });

    const filtered = normalizedLogs.filter(log => {
        if (entityRefs.size > 0 && !entityRefs.has(log.entityRef || '')) {
            return false;
        }

        if (entityTypes.size > 0 && !entityTypes.has(log.entityType || '')) {
            return false;
        }

        if (!matchesAuditLogPeriod(log, period, today)) {
            return false;
        }

        if (!search) {
            return true;
        }

        return searchableFields.some(field => {
            const value = (log as unknown as Record<string, unknown>)[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });
    });

    const sorted = sortAuditLogs(filtered, params.sortField, params.sortDir);
    if (AUDIT_LOG_FILTER_CACHE_TTL_MS > 0) {
        auditLogFilterCache.set(cacheKey, {
            expiresAt: Date.now() + AUDIT_LOG_FILTER_CACHE_TTL_MS,
            logs: sorted.map(log => ({ ...log })),
        });
        while (auditLogFilterCache.size > 50) {
            const oldestKey = auditLogFilterCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            auditLogFilterCache.delete(oldestKey);
        }
    }

    return sorted;
}

export async function getAuditLogList(params: {
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
    entityRef?: string | null;
    entityRefs?: string[];
    entityType?: string | null;
    entityTypes?: string[];
    countOnly?: boolean;
}) {
    const filtered = await getFilteredAuditLogs(params);
    const total = filtered.length;

    if (params.countOnly) {
        return { items: [] as AuditLog[], total };
    }

    if (!params.page || !params.pageSize) {
        return { items: filtered, total };
    }

    const offset = Math.max(params.page - 1, 0) * Math.max(params.pageSize, 1);
    return {
        items: filtered.slice(offset, offset + params.pageSize),
        total,
    };
}

export async function getAuditLogsSummary(params?: {
    search?: string;
    searchFields?: string[];
    period?: string | null;
    entityRef?: string | null;
    entityRefs?: string[];
    entityType?: string | null;
    entityTypes?: string[];
}) {
    const logs = await getFilteredAuditLogs({
        search: params?.search,
        searchFields: params?.searchFields,
        period: params?.period,
        entityRef: params?.entityRef,
        entityRefs: params?.entityRefs,
        entityType: params?.entityType,
        entityTypes: params?.entityTypes,
    });

    const loginLogs = logs.filter(log => log.action === 'LOGIN' || log.action === 'LOGOUT').length;
    const mutationLogs = logs.filter(log => log.action === 'CREATE' || log.action === 'UPDATE' || log.action === 'DELETE').length;
    const actorCount = new Set(
        logs
            .map(log => log.actorUserRef || log.actorUserName || '')
            .filter(Boolean)
    ).size;

    return {
        totalLogs: logs.length,
        loginLogs,
        mutationLogs,
        actorCount,
        period: normalizeAuditLogPeriod(params?.period),
    };
}

export async function getUsersSummary() {
    const cacheKey = 'users-summary';
    const cached = getSummaryReadCache<{
        total: number;
        inactive: number;
        owner: number;
        operational: number;
        finance: number;
        armada: number;
    }>(cacheKey);
    if (cached) {
        return cached;
    }

    const rows = await listDocumentsByFilter<{
        role?: UserRole;
        active?: boolean;
    }>('user', {});
    const internalRows = rows.filter(row =>
        row.role === 'OWNER' ||
        row.role === 'OPERASIONAL' ||
        row.role === 'FINANCE' ||
        row.role === 'ARMADA'
    );

    const summary = internalRows.reduce(
        (summary, row) => {
            summary.total += 1;
            if (row.active === false) summary.inactive += 1;
            if (row.role === 'OWNER') summary.owner += 1;
            if (row.role === 'OPERASIONAL') summary.operational += 1;
            if (row.role === 'FINANCE') summary.finance += 1;
            if (row.role === 'ARMADA') summary.armada += 1;
            return summary;
        },
        {
            total: 0,
            inactive: 0,
            owner: 0,
            operational: 0,
            finance: 0,
            armada: 0,
        }
    );
    setSummaryReadCache(cacheKey, summary);
    return summary;
}

type EmployeeAttendanceListParams = {
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    period?: string | null;
    date?: string | null;
    status?: string | null;
    employeeRef?: string | null;
    countOnly?: boolean;
};

function normalizeEmployeeAttendancePeriod(value?: string | null): EmployeeAttendancePeriod {
    if (value === 'today' || value === 'thisWeek' || value === 'thisMonth' || value === 'thisYear') {
        return value;
    }
    return 'today';
}

export async function getEmployeeAttendanceList(params: EmployeeAttendanceListParams) {
    const { attendanceRows } = await getEmployeeAttendanceDataset();
    const filtered = filterEmployeeAttendanceRecords(attendanceRows, params);
    const sorted = sortEmployeeAttendanceRecords(filtered, params.sortField, params.sortDir);
    return buildPagedListResult<EmployeeAttendanceRecord>(sorted, params);
}

export async function getEmployeeAttendanceSummary(params?: {
    search?: string;
    searchFields?: string[];
    period?: string | null;
    date?: string | null;
    status?: string | null;
    employeeRef?: string | null;
}) {
    const { employees, attendanceRows } = await getEmployeeAttendanceDataset();
    const period = normalizeEmployeeAttendancePeriod(params?.period);
    const anchorDate = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : getBusinessDateValue();
    const range = getEmployeeAttendancePeriodRange(period, anchorDate);
    // KPI ringkasan harus mengikuti periode (dan opsi karyawan tertentu), bukan filter tabel seperti status/search.
    // Kalau tidak, "tercatat" dan "belum tercatat" akan ikut berubah hanya karena user sedang memfilter row.
    const records = filterEmployeeAttendanceRecords(attendanceRows, {
        period,
        date: anchorDate,
        employeeRef: params?.employeeRef,
    });
    const activeEmployees = employees.filter(employee => employee.active !== false);
    const activeEmployeeRefSet = new Set(activeEmployees.map(employee => employee._id));
    const recordedActiveEmployeeRefs = new Set(
        records
            .map(record => record.employeeRef)
            .filter((employeeRef): employeeRef is string => Boolean(employeeRef) && activeEmployeeRefSet.has(employeeRef))
    );
    const pendingEmployees = period === 'today'
        ? activeEmployees
            .filter(employee => !recordedActiveEmployeeRefs.has(employee._id))
            .map(employee => ({
                _id: employee._id,
                employeeCode: employee.employeeCode,
                name: employee.name,
                division: employee.division,
                position: employee.position,
            }))
        : [];
    const unrecordedEmployeeCount = Math.max(activeEmployees.length - recordedActiveEmployeeRefs.size, 0);
    const attendanceCounts = summarizeEmployeeAttendanceRecords(records);

    return {
        period,
        periodLabel: EMPLOYEE_ATTENDANCE_PERIOD_LABELS[period],
        startDate: range.startDate,
        endDate: range.endDate,
        activeEmployeeCount: activeEmployees.length,
        recordedEmployeeCount: recordedActiveEmployeeRefs.size,
        unrecordedEmployeeCount,
        totalRecords: records.length,
        presentCount: attendanceCounts.presentCount,
        earlyLeaveCount: attendanceCounts.earlyLeaveCount,
        permissionCount: attendanceCounts.permissionCount,
        sickCount: attendanceCounts.sickCount,
        leaveCount: attendanceCounts.leaveCount,
        absentCount: attendanceCounts.absentCount,
        offCount: attendanceCounts.offCount,
        pendingEmployees,
    };
}

export function applyDerivedFreightNotaStatus<T extends {
    _id: string;
    status?: string;
    totalAmount?: string | number | null;
    totalAdjustmentAmount?: string | number | null;
    netAmount?: string | number | null;
    issueDate?: string;
    _createdAt?: string;
}>(
    notas: T[],
    paymentTotalsByInvoice: Record<string, number>,
    invoiceRefundsByRef: Record<string, number> = {}
) {
    return applyDerivedFreightNotaReceivableState(notas, paymentTotalsByInvoice, invoiceRefundsByRef);
}

function isActiveFreightNota(nota: { status?: string | null }) {
    return nota.status !== 'VOID';
}

function filterRequestsFreightNotaStatus(filterObj: Record<string, unknown>, status: string) {
    const requestedStatus = filterObj.status;
    if (requestedStatus === status) {
        return true;
    }
    if (Array.isArray(requestedStatus)) {
        return requestedStatus.includes(status);
    }
    if (requestedStatus && typeof requestedStatus === 'object' && !Array.isArray(requestedStatus)) {
        const statusOperators = requestedStatus as Record<string, unknown>;
        return statusOperators.eq === status || (
            Array.isArray(statusOperators.in) &&
            statusOperators.in.includes(status)
        );
    }
    return false;
}

export function applyDerivedDriverVoucherFinancials<T extends {
    initialCashGiven?: number | string | null;
    topUpCount?: number | string | null;
    cashGiven?: number | string | null;
    totalIssuedAmount?: number | string | null;
    totalSpent?: number | string | null;
    driverFeeAmount?: number | string | null;
    totalClaimAmount?: number | string | null;
    balance?: number | string | null;
    status?: string | null;
    settledDate?: string | null;
    settledBy?: string | null;
    settlementBankRef?: string | null;
    settlementBankName?: string | null;
}>(vouchers: T[]) {
    return vouchers.map(voucher => {
        const summary = getDriverVoucherFinancialSummary(voucher);
        const hasSettlementMarker = Boolean(
            voucher.settledDate ||
            voucher.settledBy ||
            voucher.settlementBankRef ||
            voucher.settlementBankName
        );
        return {
            ...voucher,
            initialCashGiven: summary.initialCashGiven,
            totalIssuedAmount: summary.totalIssuedAmount,
            totalSpent: summary.totalSpent,
            driverFeeAmount: summary.driverFeeAmount,
            totalClaimAmount: summary.totalClaimAmount,
            balance: summary.balance,
            status: hasSettlementMarker
                ? 'SETTLED'
                : summary.totalIssuedAmount > 0
                    ? 'ISSUED'
                    : 'DRAFT',
        };
    });
}

export function applyDerivedDriverVoucherLedger<
    T extends {
        _id: string;
        initialCashGiven?: number | string | null;
        topUpCount?: number | string | null;
        cashGiven?: number | string | null;
        totalIssuedAmount?: number | string | null;
        totalSpent?: number | string | null;
        driverFeeAmount?: number | string | null;
        totalClaimAmount?: number | string | null;
        balance?: number | string | null;
        status?: string | null;
        settledDate?: string | null;
        settledBy?: string | null;
        settlementBankRef?: string | null;
        settlementBankName?: string | null;
    }
>(
    vouchers: T[],
    disbursementRows: Array<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>,
    itemRows: Array<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>
) {
    const disbursementTotalsByVoucher = disbursementRows.filter(isActiveDriverVoucherDisbursement).reduce<Record<string, { initialCashGiven: number; totalIssuedAmount: number; topUpCount: number }>>(
        (acc, row) => {
            if (!row.voucherRef) return acc;
            const current = acc[row.voucherRef] || { initialCashGiven: 0, totalIssuedAmount: 0, topUpCount: 0 };
            const amount = parseWholeMoneyLike(row.amount);
            current.totalIssuedAmount += amount;
            if (row.kind === 'INITIAL') {
                current.initialCashGiven += amount;
            }
            if (row.kind === 'TOP_UP' && amount > 0) {
                current.topUpCount += 1;
            }
            acc[row.voucherRef] = current;
            return acc;
        },
        {}
    );

    const spentByVoucher = itemRows.reduce<Record<string, number>>((acc, row) => {
        if (!row.voucherRef) return acc;
        acc[row.voucherRef] = (acc[row.voucherRef] || 0) + parseWholeMoneyLike(row.amount);
        return acc;
    }, {});

    return vouchers.map(voucher => {
        const fallback = getDriverVoucherFinancialSummary(voucher);
        const derivedDisbursement = disbursementTotalsByVoucher[voucher._id];
        const derivedTotalSpent = spentByVoucher[voucher._id];
        const initialCashGiven = derivedDisbursement ? derivedDisbursement.initialCashGiven : fallback.initialCashGiven;
        const totalIssuedAmount = derivedDisbursement ? derivedDisbursement.totalIssuedAmount : fallback.totalIssuedAmount;
        const totalSpent = derivedTotalSpent !== undefined ? derivedTotalSpent : fallback.totalSpent;
        const topUpCount = derivedDisbursement ? derivedDisbursement.topUpCount : Math.max(parseFormattedNumberish(voucher.topUpCount ?? 0, { maxFractionDigits: 0 }), 0);
        const driverFeeAmount = Math.max(parseFormattedNumberish(voucher.driverFeeAmount ?? fallback.driverFeeAmount, { maxFractionDigits: 0 }), 0);
        const hasSettlementMarker = Boolean(
            voucher.settledDate ||
            voucher.settledBy ||
            voucher.settlementBankRef ||
            voucher.settlementBankName
        );
        const summary = getDriverVoucherFinancialSummary({
            initialCashGiven,
            cashGiven: initialCashGiven,
            totalIssuedAmount,
            totalSpent,
            driverFeeAmount,
        });

        return {
            ...voucher,
            cashGiven: initialCashGiven,
            initialCashGiven,
            totalIssuedAmount: summary.totalIssuedAmount,
            topUpCount,
            totalSpent: summary.totalSpent,
            driverFeeAmount: summary.driverFeeAmount,
            totalClaimAmount: summary.totalClaimAmount,
            balance: summary.balance,
            status: hasSettlementMarker
                ? 'SETTLED'
                : summary.totalIssuedAmount > 0
                    ? 'ISSUED'
                    : 'DRAFT',
        };
    });
}

function getSignedBankTransactionDelta(type: BankTransaction['type'] | undefined, amount: unknown) {
    const numericAmount = parseWholeMoneyLike(amount);
    if (type === 'DEBIT' || type === 'TRANSFER_OUT') {
        return -numericAmount;
    }
    return numericAmount;
}

export function applyDerivedBankAccountBalances<
    T extends {
        _id: string;
        initialBalance?: number | string | null;
        currentBalance?: number | string | null;
    }
>(
    accounts: T[],
    transactionRows: Array<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>
) {
    const deltasByAccount = transactionRows.reduce<Record<string, number>>((acc, tx) => {
        if (!tx.bankAccountRef) return acc;
        acc[tx.bankAccountRef] = (acc[tx.bankAccountRef] || 0) + getSignedBankTransactionDelta(tx.type, tx.amount);
        return acc;
    }, {});

    return accounts.map(account => {
        const initialBalance = parseFormattedNumberish(account.initialBalance ?? 0, { maxFractionDigits: 0 });
        return {
            ...account,
            initialBalance,
            currentBalance: initialBalance + (deltasByAccount[account._id] || 0),
        };
    });
}

export function applyDerivedDriverBoronganTotals<
    T extends {
        _id: string;
        totalAmount?: number | string | null;
        totalCollie?: number | string | null;
        totalWeightKg?: number | string | null;
        totalBeratKg?: number | string | null;
        totalUangJalan?: number | string | null;
        status?: string | null;
        paidDate?: string | null;
        paidMethod?: string | null;
        paidBankRef?: string | null;
        paidBankName?: string | null;
        paidBankNumber?: string | null;
    }
>(
    borongans: T[],
    boronganItems: Array<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>
) {
    const totalsByBorongan = boronganItems.reduce<Record<string, { totalAmount: number; totalCollie: number; totalWeightKg: number }>>(
        (acc, item) => {
            if (!item.boronganRef) return acc;
            const current = acc[item.boronganRef] || { totalAmount: 0, totalCollie: 0, totalWeightKg: 0 };
            current.totalAmount += parseWholeMoneyLike(item.uangRp);
            current.totalCollie += Math.max(parseFormattedNumberish(item.collie ?? 0, { maxFractionDigits: 2 }), 0);
            current.totalWeightKg += Math.max(parseFormattedNumberish(item.beratKg ?? 0, { maxFractionDigits: 3 }), 0);
            acc[item.boronganRef] = current;
            return acc;
        },
        {}
    );

    return borongans.map(borongan => {
        const derived = totalsByBorongan[borongan._id];
        const hasPaymentMarker = Boolean(
            borongan.paidDate ||
            borongan.paidMethod ||
            borongan.paidBankRef ||
            borongan.paidBankName ||
            borongan.paidBankNumber
        );
        if (!derived) {
            const normalizedTotalAmount = parseWholeMoneyLike(borongan.totalAmount);
            const normalizedTotalWeightKg = Math.max(
                parseFormattedNumberish(borongan.totalWeightKg ?? borongan.totalBeratKg ?? 0, { maxFractionDigits: 3 }),
                0
            );
            return {
                ...borongan,
                totalAmount: normalizedTotalAmount,
                totalCollie: Math.max(parseFormattedNumberish(borongan.totalCollie ?? 0, { maxFractionDigits: 2 }), 0),
                totalWeightKg: normalizedTotalWeightKg,
                totalBeratKg: normalizedTotalWeightKg,
                totalUangJalan: normalizedTotalAmount,
                status: hasPaymentMarker ? 'PAID' : 'UNPAID',
            };
        }
        return {
            ...borongan,
            totalAmount: derived.totalAmount,
            totalCollie: derived.totalCollie,
            totalWeightKg: derived.totalWeightKg,
            totalBeratKg: derived.totalWeightKg,
            totalUangJalan: derived.totalAmount,
            status: hasPaymentMarker ? 'PAID' : 'UNPAID',
        };
    });
}

export function applyDerivedCustomerReceiptAllocations<
    T extends {
        _id: string;
        totalAmount?: number | string | null;
        allocatedAmount?: number | string | null;
        unappliedAmount?: number | string | null;
        allocationCount?: number | string | null;
    }
>(
    receipts: T[],
    allocationRows: Array<Pick<Payment, 'receiptRef' | 'amount'>>
) {
    const totalsByReceipt = allocationRows.reduce<Record<string, { allocatedAmount: number; allocationCount: number }>>(
        (acc, row) => {
            if (!row.receiptRef) return acc;
            const current = acc[row.receiptRef] || { allocatedAmount: 0, allocationCount: 0 };
            current.allocatedAmount += parseWholeMoneyLike(row.amount);
            current.allocationCount += 1;
            acc[row.receiptRef] = current;
            return acc;
        },
        {}
    );

    return receipts.map(receipt => {
        const totalAmount = parseWholeMoneyLike(receipt.totalAmount);
        const derived = totalsByReceipt[receipt._id] || { allocatedAmount: 0, allocationCount: 0 };
        const unappliedAmount = Math.max(totalAmount - derived.allocatedAmount, 0);
        return {
            ...receipt,
            totalAmount,
            allocatedAmount: derived.allocatedAmount,
            unappliedAmount,
            allocationCount: derived.allocationCount,
        };
    });
}

function isFilterOperatorObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compareFilterValues(left: unknown, right: unknown) {
    const normalizedLeft = left ?? '';
    const normalizedRight = right ?? '';

    if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
        return normalizedLeft - normalizedRight;
    }

    return String(normalizedLeft).localeCompare(String(normalizedRight));
}

function matchesScalarFilter(actualValue: unknown, expectedValue: unknown) {
    if (Array.isArray(expectedValue)) {
        return expectedValue.includes(actualValue as never);
    }
    if (isFilterOperatorObject(expectedValue)) {
        return Object.entries(expectedValue).every(([operator, operatorValue]) => {
            if (operatorValue === '' || operatorValue === null || operatorValue === undefined) {
                return true;
            }
            if (operator === 'in') {
                return Array.isArray(operatorValue) && operatorValue.includes(actualValue as never);
            }
            const comparison = compareFilterValues(actualValue, operatorValue);
            if (operator === 'eq') return comparison === 0;
            if (operator === 'neq') return comparison !== 0;
            if (operator === 'gt') return comparison > 0;
            if (operator === 'gte') return comparison >= 0;
            if (operator === 'lt') return comparison < 0;
            if (operator === 'lte') return comparison <= 0;
            return false;
        });
    }
    return actualValue === expectedValue;
}

function matchesFreightNotaFilter(
    nota: Record<string, unknown>,
    filterObj: Record<string, unknown>,
    orFilters: Array<{ fields: string[]; value: string | number | boolean }>,
    definedFields: string[],
    search: string,
    searchFields: string[]
) {
    const matchesSearch =
        !search ||
        searchFields.length === 0 ||
        searchFields.some(field => {
            const value = nota[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });

    if (!matchesSearch) return false;

    const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
        matchesScalarFilter(nota[key], expectedValue)
    );
    if (!matchesFilter) return false;

    const matchesDefinedFields = definedFields.every(field => {
        const value = nota[field];
        return value !== undefined && value !== null && value !== '';
    });
    if (!matchesDefinedFields) return false;

    const matchesOrFilters = orFilters.every(orFilter =>
        orFilter.fields.some(field => matchesScalarFilter(nota[field], orFilter.value))
    );

    return matchesOrFilters;
}

function compareFreightNotaValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
    const leftNumber = parseFormattedNumberish(left as string | number | undefined | null);
    const rightNumber = parseFormattedNumberish(right as string | number | undefined | null);
    const canCompareAsNumber = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    const multiplier = direction === 'asc' ? 1 : -1;

    if (canCompareAsNumber) {
        if (leftNumber === rightNumber) return 0;
        return leftNumber > rightNumber ? multiplier : -multiplier;
    }

    const leftText = typeof left === 'string' ? left : String(left ?? '');
    const rightText = typeof right === 'string' ? right : String(right ?? '');
    return leftText.localeCompare(rightText) * multiplier;
}

export async function getFreightNotaList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortPreset?: string | null;
    countOnly?: boolean;
}) {
    const cacheKey = buildApiReadCacheKey('freight-nota-list', params);
    const cached = getSummaryReadCache<ApiListReadResult<FreightNota>>(cacheKey);
    if (cached) {
        return cached;
    }

    const notaRows = await listDocumentsByFilter<Array<FreightNota & { _createdAt?: string }>[number]>('freightNota', {});
    const filterObj = params.filterObj ?? {};
    const includeVoidedNotas = filterRequestsFreightNotaStatus(filterObj, 'VOID');
    const visibleNotaRows = includeVoidedNotas ? notaRows : notaRows.filter(isActiveFreightNota);
    const notaIds = visibleNotaRows
        .map(nota => nota._id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const [paymentRows, refundRows] = await Promise.all([
        notaIds.length > 0
            ? listDocumentsByFilter<Array<{ invoiceRef?: string; amount?: unknown }>[number]>('payment', {
                invoiceRef: notaIds,
            })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>('customerOverpaymentRefund', {
                sourceType: 'INVOICE_OVERPAID',
                sourceInvoiceRef: notaIds,
            })
            : Promise.resolve([]),
    ]);

    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    const search = params.search?.trim().toLowerCase() || '';
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const withDerivedStatus = applyDerivedFreightNotaStatus(visibleNotaRows, paymentTotalsByInvoice, invoiceRefundsByRef);

    let filtered = withDerivedStatus.filter(nota =>
            matchesFreightNotaFilter(
            nota as unknown as Record<string, unknown>,
            filterObj,
            orFilters,
            definedFields,
            search,
            searchFields
        )
    );

    if (params.sortPreset === 'work-queue') {
        const statusRank: Record<string, number> = { UNPAID: 0, PARTIAL: 1, PAID: 2 };
        filtered = [...filtered].sort((left, right) => {
            const leftRank = statusRank[left.status] ?? 99;
            const rightRank = statusRank[right.status] ?? 99;
            if (leftRank !== rightRank) return leftRank - rightRank;
            const dateCompare = (left.issueDate || '').localeCompare(right.issueDate || '');
            if (dateCompare !== 0) return dateCompare;
            return (right._createdAt || '').localeCompare(left._createdAt || '');
        });
    } else if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) => {
            const leftValue = sortField === 'status' ? left.status : (left as unknown as Record<string, unknown>)[sortField];
            const rightValue = sortField === 'status' ? right.status : (right as unknown as Record<string, unknown>)[sortField];
            return compareFreightNotaValues(leftValue, rightValue, direction);
        });
    }

    const result = buildPagedListResult<FreightNota>(filtered, params);
    setSummaryReadCache(cacheKey, result);
    return result;
}

export async function getFreightNotaById(id: string) {
    const [nota, paymentRows, refundRows] = await Promise.all([
        getDocumentById<FreightNota & { _createdAt?: string }>(id, 'freightNota'),
        listDocumentsByFilter<Array<{ invoiceRef?: string; amount?: unknown }>[number]>('payment', { invoiceRef: id }),
        listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>('customerOverpaymentRefund', {
            sourceType: 'INVOICE_OVERPAID',
            sourceInvoiceRef: id,
        }),
    ]);

    if (!nota) return null;
    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(paymentRows);
    const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    return applyDerivedFreightNotaStatus([nota], paymentTotalsByInvoice, invoiceRefundsByRef)[0];
}

export async function getDriverVoucherById(id: string) {
    const [voucher, disbursements, items] = await Promise.all([
        getDocumentById<DriverVoucher>(id, 'driverVoucher'),
        listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', { voucherRef: id }),
        listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', { voucherRef: id }),
    ]);
    if (!voucher) return null;
    return applyDerivedDriverVoucherLedger([voucher], disbursements, items)[0];
}

export async function getDeliveryOrderTripCashLink(deliveryOrderRef: string) {
    const voucher = (await listDocumentsByFilter<DriverVoucher & { _createdAt?: string }>('driverVoucher', { deliveryOrderRef }))
        .sort((left, right) =>
            `${right.issuedDate || ''}${right._createdAt || ''}`.localeCompare(`${left.issuedDate || ''}${left._createdAt || ''}`)
        )[0] || null;

    if (!voucher) return null;

    const [disbursements, items] = await Promise.all([
        listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', { voucherRef: voucher._id }),
        listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', { voucherRef: voucher._id }),
    ]);

    const derivedVoucher = applyDerivedDriverVoucherLedger([voucher], disbursements, items)[0];

    return {
        hasVoucher: true,
        voucherId: derivedVoucher._id,
        bonNumber: derivedVoucher.bonNumber,
        status: derivedVoucher.status,
        issuedDate: derivedVoucher.issuedDate,
    };
}

function matchesDriverVoucherFilter(
    voucher: Record<string, unknown>,
    filterObj: Record<string, unknown>,
    orFilters: Array<{ fields: string[]; value: string | number | boolean }>,
    definedFields: string[],
    search: string,
    searchFields: string[]
) {
    const matchesSearch =
        !search ||
        searchFields.length === 0 ||
        searchFields.some(field => {
            const value = voucher[field];
            return typeof value === 'string' && value.toLowerCase().includes(search);
        });

    if (!matchesSearch) return false;

    const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
        matchesScalarFilter(voucher[key], expectedValue)
    );
    if (!matchesFilter) return false;

    const matchesDefinedFields = definedFields.every(field => {
        const value = voucher[field];
        return value !== undefined && value !== null && value !== '';
    });
    if (!matchesDefinedFields) return false;

    return orFilters.every(orFilter =>
        orFilter.fields.some(field => matchesScalarFilter(voucher[field], orFilter.value))
    );
}

function compareDriverVoucherValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
    const leftNumber = parseFormattedNumberish(left as string | number | undefined | null);
    const rightNumber = parseFormattedNumberish(right as string | number | undefined | null);
    const canCompareAsNumber = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
    const multiplier = direction === 'asc' ? 1 : -1;

    if (canCompareAsNumber) {
        if (leftNumber === rightNumber) return 0;
        return leftNumber > rightNumber ? multiplier : -multiplier;
    }

    const leftText = typeof left === 'string' ? left : String(left ?? '');
    const rightText = typeof right === 'string' ? right : String(right ?? '');
    return leftText.localeCompare(rightText) * multiplier;
}

export async function getDriverVoucherList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortPreset?: string | null;
    countOnly?: boolean;
}) {
    const cacheKey = buildApiReadCacheKey('driver-voucher-list', params);
    const cached = getSummaryReadCache<ApiListReadResult<DriverVoucher>>(cacheKey);
    if (cached) {
        return cached;
    }

    const voucherRows = await listDocumentsByFilter<DriverVoucher>('driverVoucher', {});
    const voucherIds = voucherRows.map(voucher => voucher._id).filter(Boolean);
    const [disbursementRows, itemRows] = await Promise.all([
        voucherIds.length > 0
            ? listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', {
                voucherRef: voucherIds,
            })
            : Promise.resolve([]),
        voucherIds.length > 0
            ? listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', {
                voucherRef: voucherIds,
            })
            : Promise.resolve([]),
    ]);

    const search = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    let filtered = applyDerivedDriverVoucherLedger(voucherRows, disbursementRows, itemRows).filter(voucher =>
        matchesDriverVoucherFilter(
            voucher as unknown as Record<string, unknown>,
            filterObj,
            orFilters,
            definedFields,
            search,
            searchFields
        )
    );

    if (params.sortPreset === 'work-queue') {
        const statusRank: Record<string, number> = { ISSUED: 0, DRAFT: 1, SETTLED: 2 };
        filtered = [...filtered].sort((left, right) => {
            const leftRank = statusRank[left.status || ''] ?? 99;
            const rightRank = statusRank[right.status || ''] ?? 99;
            if (leftRank !== rightRank) return leftRank - rightRank;
            return (right.issuedDate || '').localeCompare(left.issuedDate || '');
        });
    } else if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) => {
            const leftValue = (left as unknown as Record<string, unknown>)[sortField];
            const rightValue = (right as unknown as Record<string, unknown>)[sortField];
            return compareDriverVoucherValues(leftValue, rightValue, direction);
        });
    }

    const result = buildPagedListResult<DriverVoucher>(filtered, params);
    setSummaryReadCache(cacheKey, result);
    return result;
}

export async function getDriverBoronganById(id: string) {
    const [borongan, items] = await Promise.all([
        getDocumentById<DriverBorongan>(id, 'driverBorongan'),
        listDocumentsByFilter<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>('driverBoronganItem', { boronganRef: id }),
    ]);

    if (!borongan) return null;
    return applyDerivedDriverBoronganTotals([borongan], items)[0];
}

export async function getDriverBoronganList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    countOnly?: boolean;
}) {
    const cacheKey = buildApiReadCacheKey('driver-borongan-list', params);
    const cached = getSummaryReadCache<ApiListReadResult<DriverBorongan>>(cacheKey);
    if (cached) {
        return cached;
    }

    const docs = await listDocumentsByFilter<DriverBorongan>('driverBorongan', {});
    const boronganIds = docs.map(doc => doc._id).filter(Boolean);
    const itemTotals = boronganIds.length > 0
        ? await listDocumentsByFilter<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>('driverBoronganItem', {
            boronganRef: boronganIds,
        })
        : [];

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const withDerivedTotals = applyDerivedDriverBoronganTotals(docs, itemTotals);

    let filtered = withDerivedTotals.filter(item => {
        const matchesSearch =
            !query ||
            searchFields.length === 0 ||
            searchFields.some(field => {
                const value = (item as unknown as Record<string, unknown>)[field];
                return typeof value === 'string' && value.toLowerCase().includes(query);
            });
        if (!matchesSearch) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((item as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        const matchesDefinedFields = definedFields.every(field => {
            const value = (item as unknown as Record<string, unknown>)[field];
            return value !== undefined && value !== null && value !== '';
        });
        if (!matchesDefinedFields) return false;

        const matchesOrFilters = orFilters.every(orFilter =>
            orFilter.fields.some(field => matchesScalarFilter((item as unknown as Record<string, unknown>)[field], orFilter.value))
        );

        return matchesOrFilters;
    });

    if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) =>
            compareFreightNotaValues(
                (left as unknown as Record<string, unknown>)[sortField],
                (right as unknown as Record<string, unknown>)[sortField],
                direction
            )
        );
    }

    const result = buildPagedListResult<DriverBorongan>(filtered, params);
    setSummaryReadCache(cacheKey, result);
    return result;
}

export async function getCustomerReceiptById(id: string) {
    const [receipt, payments, refundRows] = await Promise.all([
        getDocumentById<CustomerReceipt>(id, 'customerReceipt'),
        listDocumentsByFilter<Pick<Payment, 'receiptRef' | 'amount'>>('payment', { receiptRef: id }),
        listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceReceiptRef' | 'amount'>>('customerOverpaymentRefund', {
            sourceType: 'RECEIPT_UNAPPLIED',
            sourceReceiptRef: id,
        }),
    ]);

    if (!receipt) return null;
    const { receiptRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    return applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations([receipt], payments),
        receiptRefundsByRef
    )[0];
}

export async function getCustomerReceiptList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    countOnly?: boolean;
}) {
    const cacheKey = buildApiReadCacheKey('customer-receipt-list', params);
    const cached = getSummaryReadCache<ApiListReadResult<CustomerReceipt>>(cacheKey);
    if (cached) {
        return cached;
    }

    const docs = await listDocumentsByFilter<CustomerReceipt>('customerReceipt', {});
    const receiptIds = docs.map(doc => doc._id).filter(Boolean);
    const [paymentRows, refundRows] = await Promise.all([
        receiptIds.length > 0
            ? listDocumentsByFilter<Pick<Payment, 'receiptRef' | 'amount'>>('payment', { receiptRef: receiptIds })
            : Promise.resolve([]),
        receiptIds.length > 0
            ? listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceReceiptRef' | 'amount'>>('customerOverpaymentRefund', {
                sourceType: 'RECEIPT_UNAPPLIED',
                sourceReceiptRef: receiptIds,
            })
            : Promise.resolve([]),
    ]);

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const { receiptRefundsByRef } = getCustomerOverpaymentRefundTotals(refundRows);
    const withDerivedAllocations = applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations(docs, paymentRows),
        receiptRefundsByRef
    );

    let filtered = withDerivedAllocations.filter(item => {
        const matchesSearch =
            !query ||
            searchFields.length === 0 ||
            searchFields.some(field => {
                const value = (item as unknown as Record<string, unknown>)[field];
                return typeof value === 'string' && value.toLowerCase().includes(query);
            });
        if (!matchesSearch) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((item as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        const matchesDefinedFields = definedFields.every(field => {
            const value = (item as unknown as Record<string, unknown>)[field];
            return value !== undefined && value !== null && value !== '';
        });
        if (!matchesDefinedFields) return false;

        const matchesOrFilters = orFilters.every(orFilter =>
            orFilter.fields.some(field => matchesScalarFilter((item as unknown as Record<string, unknown>)[field], orFilter.value))
        );

        return matchesOrFilters;
    });

    if (params.sortField) {
        const direction = params.sortDir === 'asc' ? 'asc' : 'desc';
        const sortField = params.sortField;
        filtered = [...filtered].sort((left, right) =>
            compareFreightNotaValues(
                (left as unknown as Record<string, unknown>)[sortField],
                (right as unknown as Record<string, unknown>)[sortField],
                direction
            )
        );
    }

    const result = buildPagedListResult<CustomerReceipt>(filtered, params);
    setSummaryReadCache(cacheKey, result);
    return result;
}

export async function getCustomerOverpaymentById(id: string) {
    const [receipts, notas] = await Promise.all([
        listDocumentsByFilter<CustomerReceipt>('customerReceipt', {}),
        listDocumentsByFilter<FreightNota>('freightNota', {}),
    ]);
    const receiptIds = receipts.map(item => item._id).filter(Boolean);
    const notaIds = notas.map(item => item._id).filter(Boolean);
    const [receiptPayments, invoicePayments, receiptRefunds, invoiceRefunds, invoiceAdjustments] = await Promise.all([
        receiptIds.length > 0
            ? listDocumentsByFilter<Pick<Payment, 'invoiceRef' | 'receiptRef' | 'amount'>>('payment', { receiptRef: receiptIds })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<Pick<Payment, 'invoiceRef' | 'receiptRef' | 'amount'>>('payment', { invoiceRef: notaIds })
            : Promise.resolve([]),
        receiptIds.length > 0
            ? listDocumentsByFilter<CustomerOverpaymentRefund>('customerOverpaymentRefund', {
                sourceType: 'RECEIPT_UNAPPLIED',
                sourceReceiptRef: receiptIds,
            })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<CustomerOverpaymentRefund>('customerOverpaymentRefund', {
                sourceType: 'INVOICE_OVERPAID',
                sourceInvoiceRef: notaIds,
            })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<Array<{ invoiceRef?: string; date?: string; editedAt?: string; status?: string }>[number]>('invoiceAdjustment', {
                invoiceRef: notaIds,
            })
            : Promise.resolve([]),
    ]);
    const payments = [...receiptPayments, ...invoicePayments];
    const refunds = [...receiptRefunds, ...invoiceRefunds];
    const activeInvoiceAdjustments = invoiceAdjustments.filter(row => row.status !== 'VOID' && row.invoiceRef);

    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(payments);
    const { receiptRefundsByRef, invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refunds);
    const invoiceDetectedDatesByRef = buildInvoiceOverpaymentDetectedDateMap(activeInvoiceAdjustments);
    const receiptRows = applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations(receipts, payments),
        receiptRefundsByRef
    );
    const notaRows = applyDerivedFreightNotaReceivableState(notas, paymentTotalsByInvoice, invoiceRefundsByRef);
    const item = buildCustomerOverpaymentCases({
        receipts: receiptRows,
        notas: notaRows,
        paymentTotalsByInvoice,
        receiptRefundsByRef,
        invoiceRefundsByRef,
        invoiceDetectedDatesByRef,
    }).find(entry => entry._id === id);

    return item || null;
}

export async function getCustomerOverpaymentList(params: {
    filterObj?: Record<string, unknown>;
    orFilters?: Array<{ fields: string[]; value: string | number | boolean }>;
    definedFields?: string[];
    search?: string;
    searchFields?: string[];
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    sortPreset?: string | null;
    countOnly?: boolean;
}) {
    const cacheKey = buildApiReadCacheKey('customer-overpayment-list', params);
    const cached = getSummaryReadCache<ApiListReadResult<CustomerOverpayment>>(cacheKey);
    if (cached) {
        return cached;
    }

    const [receipts, notas] = await Promise.all([
        listDocumentsByFilter<CustomerReceipt>('customerReceipt', {}),
        listDocumentsByFilter<FreightNota>('freightNota', {}),
    ]);
    const receiptIds = receipts.map(item => item._id).filter(Boolean);
    const notaIds = notas.map(item => item._id).filter(Boolean);
    const [receiptPayments, invoicePayments, receiptRefunds, invoiceRefunds, invoiceAdjustments] = await Promise.all([
        receiptIds.length > 0
            ? listDocumentsByFilter<Pick<Payment, 'invoiceRef' | 'receiptRef' | 'amount'>>('payment', { receiptRef: receiptIds })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<Pick<Payment, 'invoiceRef' | 'receiptRef' | 'amount'>>('payment', { invoiceRef: notaIds })
            : Promise.resolve([]),
        receiptIds.length > 0
            ? listDocumentsByFilter<CustomerOverpaymentRefund>('customerOverpaymentRefund', {
                sourceType: 'RECEIPT_UNAPPLIED',
                sourceReceiptRef: receiptIds,
            })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<CustomerOverpaymentRefund>('customerOverpaymentRefund', {
                sourceType: 'INVOICE_OVERPAID',
                sourceInvoiceRef: notaIds,
            })
            : Promise.resolve([]),
        notaIds.length > 0
            ? listDocumentsByFilter<Array<{ invoiceRef?: string; date?: string; editedAt?: string; status?: string }>[number]>('invoiceAdjustment', {
                invoiceRef: notaIds,
            })
            : Promise.resolve([]),
    ]);
    const payments = [...receiptPayments, ...invoicePayments];
    const refunds = [...receiptRefunds, ...invoiceRefunds];
    const activeInvoiceAdjustments = invoiceAdjustments.filter(row => row.status !== 'VOID' && row.invoiceRef);

    const query = params.search?.trim().toLowerCase() || '';
    const filterObj = params.filterObj ?? {};
    const orFilters = params.orFilters ?? [];
    const definedFields = params.definedFields ?? [];
    const searchFields = (params.searchFields ?? []).map(field => field.trim()).filter(Boolean);
    const paymentTotalsByInvoice = getFreightNotaPaymentTotals(payments);
    const { receiptRefundsByRef, invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(refunds);
    const invoiceDetectedDatesByRef = buildInvoiceOverpaymentDetectedDateMap(activeInvoiceAdjustments);
    const receiptRows = applyDerivedCustomerReceiptOverpaymentState(
        applyDerivedCustomerReceiptAllocations(receipts, payments),
        receiptRefundsByRef
    );
    const notaRows = applyDerivedFreightNotaReceivableState(notas, paymentTotalsByInvoice, invoiceRefundsByRef);
    const cases = buildCustomerOverpaymentCases({
        receipts: receiptRows,
        notas: notaRows,
        paymentTotalsByInvoice,
        receiptRefundsByRef,
        invoiceRefundsByRef,
        invoiceDetectedDatesByRef,
    });

    const searchableFields = searchFields.length > 0
        ? searchFields
        : ['customerName', 'sourceLabel', 'sourceDescription', 'sourceInvoiceNumber', 'sourceReceiptNumber'];

    let filtered = cases.filter(item => {
        const matchesSearch =
            !query ||
            searchableFields.some(field => {
                const value = (item as unknown as Record<string, unknown>)[field];
                return typeof value === 'string' && value.toLowerCase().includes(query);
            });
        if (!matchesSearch) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((item as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        const matchesDefinedFields = definedFields.every(field => {
            const value = (item as unknown as Record<string, unknown>)[field];
            return value !== undefined && value !== null && value !== '';
        });
        if (!matchesDefinedFields) return false;

        return orFilters.every(orFilter =>
            orFilter.fields.some(field => matchesScalarFilter((item as unknown as Record<string, unknown>)[field], orFilter.value))
        );
    });

    filtered = sortCustomerOverpaymentCases(filtered, params.sortField, params.sortDir, params.sortPreset);

    const result = buildPagedListResult<CustomerOverpayment>(filtered, params);
    setSummaryReadCache(cacheKey, result);
    return result;
}

export type DashboardSummary = {
    orderStats: { total: number; open: number; partial: number; complete: number; onHold: number };
    doStats: { total: number; onDelivery: number };
    notaStats: { unpaid: number; totalOutstanding: number };
    boronganStats: { unpaid: number; totalOutstanding: number };
    voucherStats: { unsettled: number; totalIssued: number };
    fleetStats: { openIncidents: number; maintenanceDue: number };
    recentOrders: Array<{ _id: string; masterResi?: string; customerName?: string; status?: string; createdAt?: string }>;
    recentNotas: Array<{
        _id: string;
        notaNumber?: string;
        customerName?: string;
        status?: string;
        totalAmount?: number;
        totalAdjustmentAmount?: number;
        pph23Enabled?: boolean;
        pph23RatePercent?: number;
        pph23BaseMode?: 'BEFORE_CLAIM' | 'AFTER_CLAIM';
        pph23Amount?: number;
        netAmount?: number;
    }>;
};

export async function getDashboardSummary(session: ApiSession): Promise<DashboardSummary> {
    const cacheKey = `dashboard-summary:${session.role}`;
    const cached = getSummaryReadCache<DashboardSummary>(cacheKey);
    if (cached) {
        return cached;
    }

    const canViewOrders = hasPageAccess(session.role, 'orders');
    const canViewDeliveryOrders = hasPermission(session, 'deliveryOrders', 'view');
    const canViewInvoices = hasPermission(session, 'invoices', 'view');
    const canViewTripCash = hasPermission(session, 'driverVouchers', 'view');
    const canViewFleet = hasPermission(session, 'incidents', 'view') || hasPermission(session, 'maintenance', 'view');
    const canSeeBorongan = hasPermission(session, 'driverBorongans', 'view');
    const [
        orderStats,
        doStats,
        unpaidNotas,
        borongans,
        vouchers,
        fleetStats,
        recentOrders,
        recentNotas,
    ] = await Promise.all([
        canViewOrders
            ? listDocumentFieldsByFilter<{ status?: string }>('order', ['status'], {})
                .then(rows => rows.reduce(
                    (acc, row) => {
                        acc.total += 1;
                        if (row.status === 'OPEN') acc.open += 1;
                        if (row.status === 'PARTIAL') acc.partial += 1;
                        if (row.status === 'ON_HOLD') acc.onHold += 1;
                        if (row.status === 'COMPLETE') acc.complete += 1;
                        return acc;
                    },
                    { total: 0, open: 0, partial: 0, complete: 0, onHold: 0 }
                ))
            : Promise.resolve({ total: 0, open: 0, partial: 0, complete: 0, onHold: 0 }),
        canViewDeliveryOrders
            ? listDocumentFieldsByFilter<{ status?: string }>('deliveryOrder', ['status'], {})
                .then(rows => ({
                    total: rows.length,
                    onDelivery: rows.filter(row => row.status === 'ON_DELIVERY').length,
                }))
            : Promise.resolve({ total: 0, onDelivery: 0 }),
        canViewInvoices
            ? listDocumentFieldsByFilter<Pick<FreightNota, '_id' | 'status' | 'totalAmount' | 'totalAdjustmentAmount' | 'pph23Enabled' | 'pph23RatePercent' | 'pph23BaseMode' | 'pph23Amount' | 'netAmount'>>(
                'freightNota',
                ['status', 'totalAmount', 'totalAdjustmentAmount', 'pph23Enabled', 'pph23RatePercent', 'pph23BaseMode', 'pph23Amount', 'netAmount'],
                { status: { neq: 'VOID' } },
            )
            : Promise.resolve([]),
        canSeeBorongan
            ? listDocumentFieldsByFilter<Pick<DriverBorongan, '_id' | 'status' | 'totalAmount' | 'totalCollie' | 'totalWeightKg' | 'paidDate' | 'paidMethod' | 'paidBankRef' | 'paidBankName' | 'paidBankNumber'>>(
                'driverBorongan',
                ['status', 'totalAmount', 'totalCollie', 'totalWeightKg', 'paidDate', 'paidMethod', 'paidBankRef', 'paidBankName', 'paidBankNumber'],
                {},
            )
            : Promise.resolve([]),
        canViewTripCash
            ? listDocumentFieldsByFilter<Pick<DriverVoucher, '_id' | 'status' | 'settledDate' | 'settledBy' | 'settlementBankRef' | 'settlementBankName' | 'cashGiven' | 'initialCashGiven' | 'topUpCount' | 'totalIssuedAmount' | 'totalSpent' | 'driverFeeAmount' | 'totalClaimAmount' | 'balance'>>(
                'driverVoucher',
                ['status', 'settledDate', 'settledBy', 'settlementBankRef', 'settlementBankName', 'cashGiven', 'initialCashGiven', 'topUpCount', 'totalIssuedAmount', 'totalSpent', 'driverFeeAmount', 'totalClaimAmount', 'balance'],
                {},
            )
            : Promise.resolve([]),
        canViewFleet
            ? Promise.all([
                getDocumentCount('incident', { status: ['OPEN', 'IN_PROGRESS'] }),
                getDocumentCount('maintenance', { status: 'SCHEDULED' }),
            ]).then(([openIncidents, maintenanceDue]) => ({
                openIncidents,
                maintenanceDue,
            }))
            : Promise.resolve({ openIncidents: 0, maintenanceDue: 0 }),
        canViewOrders
            ? listDocuments<DashboardSummary['recentOrders'][number]>('order', {
                page: 1,
                pageSize: 5,
                sortField: 'createdAt',
                sortDir: 'desc',
                countStrategy: 'none',
            }).then(result => result.items)
            : Promise.resolve([]),
        canViewInvoices
            ? listDocuments<DashboardSummary['recentNotas'][number]>('freightNota', {
                page: 1,
                pageSize: 5,
                sortField: 'issueDate',
                sortDir: 'desc',
                countStrategy: 'none',
            }).then(result => result.items)
            : Promise.resolve([]),
    ]);

    const activeUnpaidNotas = unpaidNotas.filter(isActiveFreightNota);
    const activeRecentNotas = recentNotas.filter(isActiveFreightNota);
    const invoiceIdsForDashboard = Array.from(
        new Set(
            [...activeUnpaidNotas, ...activeRecentNotas]
                .map(nota => nota._id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        )
    );
    const boronganIds = borongans
        .map(borongan => borongan._id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const voucherIds = vouchers
        .map(voucher => voucher._id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    const [
        notaPayments,
        notaRefunds,
        boronganItems,
        voucherDisbursements,
        voucherItems,
    ] = await Promise.all([
        canViewInvoices && invoiceIdsForDashboard.length > 0
            ? listDocumentsByFilter<Array<{ invoiceRef?: string; amount?: number }>[number]>('payment', {
                invoiceRef: invoiceIdsForDashboard,
            })
            : Promise.resolve([]),
        canViewInvoices && invoiceIdsForDashboard.length > 0
            ? listDocumentsByFilter<Pick<CustomerOverpaymentRefund, 'sourceType' | 'sourceInvoiceRef' | 'amount'>>('customerOverpaymentRefund', {
                sourceType: 'INVOICE_OVERPAID',
                sourceInvoiceRef: invoiceIdsForDashboard,
            })
            : Promise.resolve([]),
        canSeeBorongan && boronganIds.length > 0
            ? listDocumentsByFilter<Pick<DriverBoronganItem, 'boronganRef' | 'collie' | 'beratKg' | 'uangRp'>>('driverBoronganItem', {
                boronganRef: boronganIds,
            })
            : Promise.resolve([]),
        canViewTripCash && voucherIds.length > 0
            ? listDocumentsByFilter<Pick<DriverVoucherDisbursement, 'voucherRef' | 'amount' | 'kind' | 'status'>>('driverVoucherDisbursement', {
                voucherRef: voucherIds,
            })
            : Promise.resolve([]),
        canViewTripCash && voucherIds.length > 0
            ? listDocumentsByFilter<Pick<DriverVoucherItem, 'voucherRef' | 'amount'>>('driverVoucherItem', {
                voucherRef: voucherIds,
            })
            : Promise.resolve([]),
    ]);

    const notaPaymentTotals = getFreightNotaPaymentTotals(notaPayments);
    const { invoiceRefundsByRef } = getCustomerOverpaymentRefundTotals(notaRefunds);
    const derivedUnpaidNotas = applyDerivedFreightNotaStatus(activeUnpaidNotas, notaPaymentTotals, invoiceRefundsByRef).filter(nota => nota.status !== 'PAID');
    const recentNotasWithDerivedStatus = applyDerivedFreightNotaStatus(activeRecentNotas, notaPaymentTotals, invoiceRefundsByRef);
    const unpaidBorongansWithDerivedTotals = applyDerivedDriverBoronganTotals(borongans, boronganItems)
        .filter(borongan => borongan.status !== 'PAID');
    const openVouchersWithDerivedFinancials = applyDerivedDriverVoucherLedger(vouchers, voucherDisbursements, voucherItems)
        .filter(voucher => voucher.status !== 'SETTLED');
    const notaOutstanding = derivedUnpaidNotas.reduce((sum, nota) => {
        const refundedAmount = invoiceRefundsByRef[nota._id] || 0;
        const effectivePaidAmount = Math.max((notaPaymentTotals[nota._id] || 0) - refundedAmount, 0);
        return sum + Math.max(getReceivableNetAmount(nota) - effectivePaidAmount, 0);
    }, 0);
    const boronganOutstanding = unpaidBorongansWithDerivedTotals.reduce(
        (sum, borongan) => sum + parseWholeMoneyLike(borongan.totalAmount),
        0
    );
    const voucherIssued = openVouchersWithDerivedFinancials.reduce(
        (sum, voucher) => sum + getDriverVoucherIssuedAmount(voucher),
        0
    );
    const canSeeFinancialTotals = hasPermission(session, 'reports', 'view');

    const summary = {
        orderStats,
        doStats,
        notaStats: {
            unpaid: canViewInvoices ? derivedUnpaidNotas.length : 0,
            totalOutstanding: canViewInvoices && canSeeFinancialTotals ? notaOutstanding : 0,
        },
        boronganStats: {
            unpaid: canSeeBorongan ? unpaidBorongansWithDerivedTotals.length : 0,
            totalOutstanding: canSeeBorongan ? boronganOutstanding : 0,
        },
        voucherStats: {
            unsettled: canViewTripCash ? openVouchersWithDerivedFinancials.length : 0,
            totalIssued: canViewTripCash && canSeeFinancialTotals ? voucherIssued : 0,
        },
        fleetStats,
        recentOrders,
        recentNotas: recentNotasWithDerivedStatus,
    };
    setSummaryReadCache(cacheKey, summary);
    return summary;
}

export async function getCustomersSummary(ids: string[] = []) {
    const cacheKey = buildApiReadCacheKey('customers-summary', [...ids].sort());
    const cached = getSummaryReadCache<{
        totalCustomers: number;
        totalProducts: number;
        customersWithCustomPrefix: number;
        customersNeedingCatalog: number;
        productCounts: Record<string, number>;
    }>(cacheKey);
    if (cached) {
        return cached;
    }

    const [customers, customerProducts] = await Promise.all([
        listDocumentsByFilter<Array<Record<string, unknown>>[number]>('customer', {}),
        listDocumentsByFilter<Array<{ customerRef?: string }>[number]>('customerProduct', {}),
    ]);
    const productRefs = ids.length > 0
        ? customerProducts.filter(row => row.customerRef && ids.includes(row.customerRef))
        : [];
    const totalCustomers = customers.length;
    const totalProducts = customerProducts.length;
    const customersWithCustomPrefix = customers.filter(customer => {
        const deliveryOrderPrefix = typeof customer.deliveryOrderPrefix === 'string' ? customer.deliveryOrderPrefix : '';
        return deliveryOrderPrefix && deliveryOrderPrefix !== 'SJ';
    }).length;
    const customersWithProductsRaw = Array.from(new Set(customerProducts.map(product => product.customerRef).filter(Boolean)));

    const productCounts = productRefs.reduce<Record<string, number>>((acc, product) => {
        if (!product.customerRef) return acc;
        acc[product.customerRef] = (acc[product.customerRef] || 0) + 1;
        return acc;
    }, {});

    const customersWithProducts = Array.isArray(customersWithProductsRaw) ? customersWithProductsRaw.length : 0;

    const summary = {
        totalCustomers,
        totalProducts,
        customersWithCustomPrefix,
        customersNeedingCatalog: Math.max(totalCustomers - customersWithProducts, 0),
        productCounts,
    };
    setSummaryReadCache(cacheKey, summary);
    return summary;
}

type VehicleTireSummary = {
    filled: number;
    expected: number;
    missing: number;
};

type VehiclesSummary = {
    totalVehicles: number;
    activeVehicleCount: number;
    nonOperationalCount: number;
    incompleteTireCount: number;
    tireSummaries: Record<string, VehicleTireSummary>;
};

function buildVehicleTireSummary(
    vehicle: Pick<Vehicle, '_id' | 'vehicleType' | 'serviceName' | 'tireLayoutConfig'>,
    tireEventsOrActiveSlotCodes: Array<Pick<TireEvent, 'vehicleRef' | 'status' | 'holderType' | 'slotCode' | 'posisi' | 'vehiclePlate' | 'externalPartyName' | 'externalPlateNumber'>> | string[]
): VehicleTireSummary {
    const activeSlotCodes = typeof tireEventsOrActiveSlotCodes[0] === 'string'
        ? tireEventsOrActiveSlotCodes as string[]
        : Array.from(
            new Set(
                (tireEventsOrActiveSlotCodes as Array<Pick<TireEvent, 'vehicleRef' | 'status' | 'holderType' | 'slotCode' | 'posisi' | 'vehiclePlate' | 'externalPartyName' | 'externalPlateNumber'>>)
                    .filter(event => event.vehicleRef === vehicle._id && resolveTireAssetStatus(event) === 'IN_USE')
                    .map(event => resolveTireSlotCode(event) || '')
                    .filter(Boolean)
            )
        );
    const layout = getSuggestedVehicleTireLayout(vehicle.vehicleType, vehicle.serviceName, activeSlotCodes, vehicle.tireLayoutConfig);
    const filled = activeSlotCodes.length;
    const expected = layout.allSlots.length;
    return {
        filled,
        expected,
        missing: Math.max(expected - filled, 0),
    };
}

export async function getVehiclesSummary(ids: string[] = []): Promise<VehiclesSummary> {
    const cacheKey = `vehicles-summary:${[...ids].sort().join(',')}`;
    const cached = getSummaryReadCache<VehiclesSummary>(cacheKey);
    if (cached) {
        return cached;
    }

    const vehicles = await listDocumentsByFilter<Pick<Vehicle, '_id' | 'status' | 'vehicleType' | 'serviceName' | 'tireLayoutConfig'>>('vehicle', {});
    const vehicleIds = vehicles.map(vehicle => vehicle._id).filter(Boolean);
    const tireEvents = vehicleIds.length > 0
        ? await listDocumentsByFilter<Pick<TireEvent, 'vehicleRef' | 'status' | 'holderType' | 'slotCode' | 'posisi' | 'vehiclePlate' | 'externalPartyName' | 'externalPlateNumber'>>('tireEvent', {
            vehicleRef: vehicleIds,
        })
        : [];
    const filteredTireEvents = tireEvents.filter(event => Boolean(event.vehicleRef));
    const activeSlotCodesByVehicleRef = filteredTireEvents.reduce<Map<string, Set<string>>>((acc, event) => {
        if (!event.vehicleRef || resolveTireAssetStatus(event) !== 'IN_USE') {
            return acc;
        }
        const slotCode = resolveTireSlotCode(event) || '';
        if (!slotCode) {
            return acc;
        }
        const current = acc.get(event.vehicleRef) || new Set<string>();
        current.add(slotCode);
        acc.set(event.vehicleRef, current);
        return acc;
    }, new Map());
    const getActiveSlotCodes = (vehicleRef: string) =>
        Array.from(activeSlotCodesByVehicleRef.get(vehicleRef) || []);

    const vehicleMap = new Map(vehicles.map(vehicle => [vehicle._id, vehicle]));
    const tireSummaries = ids.reduce<Record<string, VehicleTireSummary>>((acc, id) => {
        const vehicle = vehicleMap.get(id);
        if (!vehicle) return acc;
        acc[id] = buildVehicleTireSummary(vehicle, getActiveSlotCodes(id));
        return acc;
    }, {});

    const totalVehicles = vehicles.length;
    const activeVehicleCount = vehicles.filter(vehicle => vehicle.status === 'ACTIVE').length;
    const incompleteTireCount = vehicles.reduce((sum, vehicle) => {
        const summary = buildVehicleTireSummary(vehicle, getActiveSlotCodes(vehicle._id));
        return sum + (summary.missing > 0 ? 1 : 0);
    }, 0);

    const summary = {
        totalVehicles,
        activeVehicleCount,
        nonOperationalCount: Math.max(totalVehicles - activeVehicleCount, 0),
        incompleteTireCount,
        tireSummaries,
    };
    setSummaryReadCache(cacheKey, summary);
    return summary;
}

type ExpenseListParams = {
    search?: string;
    searchFields?: string[];
    filterObj?: Record<string, unknown>;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDir?: 'asc' | 'desc';
    dateFrom?: string | null;
    dateTo?: string | null;
    countOnly?: boolean;
};

type ExpensesSummary = {
    grandTotal: number;
    transactionCount: number;
    avgAmount: number;
    categoryTotals: Array<{ name: string; total: number }>;
};

const DEFAULT_EXPENSE_SEARCH_FIELDS = [
    'note',
    'description',
    'categoryName',
    'relatedVehiclePlate',
    'bankAccountName',
    'bankAccountNumber',
];

function normalizeExpenseDateFilter(value?: string | null) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(0, 10) : '';
}

function compareExpenseValues(left: unknown, right: unknown, direction: 'asc' | 'desc') {
    const multiplier = direction === 'asc' ? 1 : -1;
    if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * multiplier;
    }
    return String(left ?? '').localeCompare(String(right ?? ''), 'id-ID', { numeric: true, sensitivity: 'base' }) * multiplier;
}

function sortExpenses(rows: Expense[], sortField?: string, sortDir?: 'asc' | 'desc') {
    const field = sortField?.trim() || 'date';
    const direction = sortDir === 'asc' ? 'asc' : 'desc';
    return [...rows].sort((left, right) => {
        const leftRecord = left as unknown as Record<string, unknown>;
        const rightRecord = right as unknown as Record<string, unknown>;
        const primary = compareExpenseValues(leftRecord[field], rightRecord[field], direction);
        if (primary !== 0) return primary;
        return compareExpenseValues(leftRecord._createdAt, rightRecord._createdAt, 'desc');
    });
}

function filterExpenseRows(rows: Expense[], params: ExpenseListParams, role: UserRole) {
    const visibleExpenses = filterExpensesByRole(rows, role);
    const query = params.search?.trim().toLowerCase() || '';
    const searchFields = params.searchFields && params.searchFields.length > 0
        ? params.searchFields
        : DEFAULT_EXPENSE_SEARCH_FIELDS;
    const filterObj = params.filterObj || {};
    const dateFrom = normalizeExpenseDateFilter(params.dateFrom);
    const dateTo = normalizeExpenseDateFilter(params.dateTo);

    return visibleExpenses.filter(expense => {
        const expenseDate = normalizeExpenseDateFilter(expense.date);
        if (dateFrom && (!expenseDate || expenseDate < dateFrom)) return false;
        if (dateTo && (!expenseDate || expenseDate > dateTo)) return false;

        const matchesFilter = Object.entries(filterObj).every(([key, expectedValue]) =>
            matchesScalarFilter((expense as unknown as Record<string, unknown>)[key], expectedValue)
        );
        if (!matchesFilter) return false;

        if (!query) return true;
        return searchFields.some(field => {
            const value = (expense as unknown as Record<string, unknown>)[field];
            return typeof value === 'string' && value.toLowerCase().includes(query);
        });
    });
}

export async function getExpenseList(session: ApiSession, params: ExpenseListParams = {}) {
    const cacheKey = buildApiReadCacheKey('expense-list', {
        role: session.role,
        params,
    });
    const cached = getSummaryReadCache<ApiListReadResult<Expense>>(cacheKey);
    if (cached) {
        return cached;
    }

    const expenseRows = await listDocumentsByFilter<Expense>('expense', {});
    const filteredExpenses = filterExpenseRows(expenseRows, params, session.role);
    const sortedExpenses = sortExpenses(filteredExpenses, params.sortField, params.sortDir);
    const result = buildPagedListResult<Expense>(sortedExpenses, params);
    setSummaryReadCache(cacheKey, result);
    return result;
}

export async function getExpensesSummary(session: ApiSession, paramsOrSearch: string | ExpenseListParams = ''): Promise<ExpensesSummary> {
    const params: ExpenseListParams = typeof paramsOrSearch === 'string'
        ? { search: paramsOrSearch }
        : paramsOrSearch;
    const cacheKey = `expenses-summary:${session.role}:${JSON.stringify({
        search: params.search?.trim().toLowerCase() || '',
        searchFields: normalizeStringList(params.searchFields).sort(),
        filterObj: params.filterObj || {},
        dateFrom: normalizeExpenseDateFilter(params.dateFrom),
        dateTo: normalizeExpenseDateFilter(params.dateTo),
    })}`;
    const cached = getSummaryReadCache<ExpensesSummary>(cacheKey);
    if (cached) {
        return cached;
    }

    const expenseRows = await listDocumentsByFilter<Expense>('expense', {});
    const filteredExpenses = filterExpenseRows(expenseRows, params, session.role);
    const grandTotal = filteredExpenses.reduce((sum, expense) => sum + parseWholeMoneyLike(expense.amount), 0);
    const categoryTotals = Object.entries(
        filteredExpenses.reduce<Record<string, number>>((acc, expense) => {
            const key = expense.categoryName || 'Lainnya';
            acc[key] = (acc[key] || 0) + parseWholeMoneyLike(expense.amount);
            return acc;
        }, {})
    )
        .sort((left, right) => right[1] - left[1])
        .map(([name, total]) => ({ name, total }));

    const summary = {
        grandTotal,
        transactionCount: filteredExpenses.length,
        avgAmount: filteredExpenses.length > 0 ? grandTotal / filteredExpenses.length : 0,
        categoryTotals,
    };
    setSummaryReadCache(cacheKey, summary);
    return summary;
}

type BankAccountsSummary = {
    totalAccounts: number;
    totalBalance: number;
    totalInitial: number;
    cashBalance: number;
    bankBalance: number;
};

export async function getBankAccountsSummary(): Promise<BankAccountsSummary> {
    const cacheKey = 'bank-accounts-summary';
    const cached = getSummaryReadCache<BankAccountsSummary>(cacheKey);
    if (cached) {
        return cached;
    }

    const accounts = await listDocumentsByFilter<Pick<BankAccount, '_id' | 'accountType' | 'systemKey' | 'initialBalance' | 'currentBalance' | 'active'>>('bankAccount', {
        active: true,
    });
    const accountIds = accounts.map(account => account._id).filter(Boolean);
    const transactionRows = accountIds.length > 0
        ? await listDocumentsByFilter<Pick<BankTransaction, 'bankAccountRef' | 'type' | 'amount'>>('bankTransaction', {
            bankAccountRef: accountIds,
        })
        : [];
    const filteredTransactionRows = transactionRows.filter(row => Boolean(row.bankAccountRef));
    const accountsWithDerivedBalances = applyDerivedBankAccountBalances(accounts, filteredTransactionRows);

    const isCash = (account: Pick<BankAccount, 'accountType' | 'systemKey'>) =>
        account.accountType === 'CASH' || account.systemKey === 'cash-on-hand';

    const totalBalance = accountsWithDerivedBalances.reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);
    const totalInitial = accountsWithDerivedBalances.reduce((sum, account) => sum + parseWholeMoneyLike(account.initialBalance), 0);
    const cashBalance = accountsWithDerivedBalances.filter(isCash).reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);
    const bankBalance = accountsWithDerivedBalances.filter(account => !isCash(account)).reduce((sum, account) => sum + parseWholeMoneyLike(account.currentBalance), 0);

    const summary = {
        totalAccounts: accountsWithDerivedBalances.length,
        totalBalance,
        totalInitial,
        cashBalance,
        bankBalance,
    };
    setSummaryReadCache(cacheKey, summary);
    return summary;
}

export async function getDriverBoronganDoRefsSummary() {
    const cacheKey = 'driver-borongan-do-refs-summary';
    const cached = getSummaryReadCache<{ doRefs: string[] }>(cacheKey);
    if (cached) {
        return cached;
    }

    const rows = (await listDocumentsByFilter<Array<{ doRef?: string }>[number]>('driverBoronganItem', {}))
        .filter(item => Boolean(item.doRef));

    const summary = {
        doRefs: Array.from(
            new Set(
                rows
                    .map(item => item.doRef)
                    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            )
        ),
    };
    setSummaryReadCache(cacheKey, summary);
    return summary;
}


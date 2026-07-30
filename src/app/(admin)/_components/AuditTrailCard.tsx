'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ScrollText } from 'lucide-react';

import CollapsibleCard from '@/components/CollapsibleCard';
import { fetchAdminListPayload } from '@/lib/api/admin-client';
import { getAuditLogTargetHref } from '@/lib/audit-log-target-links';
import { hasPermission } from '@/lib/rbac';
import type { AuditLog, UserRole } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';

import { useApp, useToast } from '../layout';

type AuditTrailCardProps = {
    title?: string;
    subtitle?: string;
    entityRefs: Array<string | null | undefined>;
    entityTypes?: string[];
    limit?: number;
    defaultOpen?: boolean;
};

const ACTION_COLORS: Record<string, string> = {
    CREATE: 'success',
    UPDATE: 'warning',
    DELETE: 'danger',
    LOGIN: 'info',
    LOGOUT: 'gray',
};

const ROLE_LABELS: Record<UserRole, string> = {
    OWNER: 'Owner',
    OPERASIONAL: 'Operasional',
    FINANCE: 'Finance',
    ARMADA: 'Armada',
    DRIVER: 'Driver',
    ADMIN: 'Admin',
};

function uniqueCleanValues(values: Array<string | null | undefined>) {
    return Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))));
}

function buildValuesKey(values: Array<string | null | undefined>) {
    return uniqueCleanValues(values).join(',');
}

function buildAuditTrailQuery(entityRefs: string[], entityTypes: string[], limit: number) {
    const params = new URLSearchParams({
        entity: 'audit-logs',
        period: 'all',
        page: '1',
        pageSize: String(limit),
        sortField: 'timestamp',
        sortDir: 'desc',
    });

    if (entityRefs.length > 0) {
        params.set('entityRefs', entityRefs.join(','));
    }

    if (entityTypes.length > 0) {
        params.set('entityTypes', entityTypes.join(','));
    }

    return `/api/data?${params.toString()}`;
}

function inferActorRole(log: AuditLog): UserRole | undefined {
    const actorRef = typeof log.actorUserRef === 'string'
        ? log.actorUserRef.trim().toLowerCase()
        : typeof log.entityRef === 'string'
            ? log.entityRef.trim().toLowerCase()
            : '';
    const actorEmail = typeof log.actorUserEmail === 'string' ? log.actorUserEmail.trim().toLowerCase() : '';
    const identity = `${actorRef} ${actorEmail}`;

    if (identity.includes('user-owner-') || actorEmail.startsWith('owner@')) return 'OWNER';
    if (identity.includes('user-admin-') || actorEmail.startsWith('admin@')) return 'OPERASIONAL';
    if (identity.includes('user-finance-') || actorEmail.startsWith('finance@')) return 'FINANCE';
    if (identity.includes('user-armada-') || actorEmail.startsWith('armada@')) return 'ARMADA';
    if (identity.includes('user-driver-') || actorEmail.startsWith('driver.')) return 'DRIVER';
    return undefined;
}

function getActorRoleLabel(log: AuditLog) {
    const resolvedRole = log.actorUserRole || inferActorRole(log);
    return resolvedRole ? ROLE_LABELS[resolvedRole] || resolvedRole : 'Role tidak tercatat';
}

function AuditTargetLink({ log }: { log: AuditLog }) {
    const target = log.entityRef || '-';
    const href = getAuditLogTargetHref(log);

    if (!href || target === '-') {
        return <span>{target}</span>;
    }

    return (
        <Link
            href={href}
            className="font-mono"
            style={{ color: 'var(--color-primary)', fontWeight: 600, wordBreak: 'break-all' }}
        >
            {target}
        </Link>
    );
}

export default function AuditTrailCard({
    title = 'Riwayat Perubahan',
    subtitle,
    entityRefs,
    entityTypes = [],
    limit = 12,
    defaultOpen = false,
}: AuditTrailCardProps) {
    const { user } = useApp();
    const { addToast } = useToast();
    const lastLoadedQueryRef = useRef('');
    const [auditData, setAuditData] = useState<{ queryKey: string; logs: AuditLog[]; total: number }>({
        queryKey: '',
        logs: [],
        total: 0,
    });
    const [shouldLoad, setShouldLoad] = useState(defaultOpen);

    const entityRefsKey = buildValuesKey(entityRefs);
    const entityTypesKey = buildValuesKey(entityTypes);
    const queryKey = `${entityRefsKey}|${entityTypesKey}|${limit}`;
    const canViewAuditLogs = user ? hasPermission(user, 'auditLogs', 'view') : false;
    const auditTrailUrl = shouldLoad && canViewAuditLogs && entityRefsKey
        ? buildAuditTrailQuery(
            entityRefsKey.split(',').filter(Boolean),
            entityTypesKey.split(',').filter(Boolean),
            limit
        )
        : '';
    const visibleLogs = auditData.queryKey === queryKey ? auditData.logs : [];
    const visibleTotal = auditData.queryKey === queryKey ? auditData.total : 0;

    useEffect(() => {
        if (!auditTrailUrl) {
            lastLoadedQueryRef.current = '';
            return;
        }
        if (lastLoadedQueryRef.current === queryKey) {
            return;
        }

        let cancelled = false;
        lastLoadedQueryRef.current = queryKey;
        fetchAdminListPayload<AuditLog>(auditTrailUrl, 'Gagal memuat riwayat perubahan')
            .then(payload => {
                if (cancelled) return;
                const items = payload.data || [];
                setAuditData({
                    queryKey,
                    logs: items,
                    total: payload.meta?.total || items.length,
                });
            })
            .catch(error => {
                if (cancelled) return;
                lastLoadedQueryRef.current = '';
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat riwayat perubahan');
            });

        return () => {
            cancelled = true;
        };
    }, [addToast, auditTrailUrl, queryKey]);

    if (!canViewAuditLogs || !entityRefsKey) {
        return null;
    }

    return (
        <CollapsibleCard
            title={visibleTotal > 0 ? `${title} (${visibleTotal})` : title}
            subtitle={subtitle}
            defaultOpen={defaultOpen}
            onOpenChange={open => {
                if (open) {
                    setShouldLoad(true);
                }
            }}
        >
            {visibleLogs.length === 0 ? (
                <div className="empty-state" style={{ padding: '1rem 0' }}>
                    <ScrollText size={36} className="empty-state-icon" />
                    <div className="empty-state-title">Belum ada riwayat tercatat</div>
                </div>
            ) : (
                <>
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead>
                                <tr>
                                    <th>Waktu</th>
                                    <th>User</th>
                                    <th>Aksi</th>
                                    <th>Entitas</th>
                                    <th>Ringkasan</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibleLogs.map(log => (
                                    <tr key={log._id}>
                                        <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                                            {formatDateTime(log.timestamp || log._createdAt)}
                                        </td>
                                        <td>
                                            <div className="font-medium">{log.actorUserName || 'User tidak diketahui'}</div>
                                            <div className="text-muted text-xs">{getActorRoleLabel(log)}</div>
                                        </td>
                                        <td>
                                            <span className={`badge badge-${ACTION_COLORS[log.action] || 'gray'}`}>{log.action}</span>
                                        </td>
                                        <td>
                                            <div>{log.entityType || '-'}</div>
                                            <div className="text-muted text-xs"><AuditTargetLink log={log} /></div>
                                        </td>
                                        <td className="text-muted" style={{ minWidth: 300, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                            {log.changesSummary || '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {visibleLogs.map(log => (
                            <div key={log._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{log.actorUserName || 'User tidak diketahui'}</div>
                                        <div className="mobile-record-subtitle">{`${getActorRoleLabel(log)} | ${formatDateTime(log.timestamp || log._createdAt)}`}</div>
                                    </div>
                                    <span className={`badge badge-${ACTION_COLORS[log.action] || 'gray'}`}>{log.action}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Entitas</span>
                                        <span className="mobile-record-value">{log.entityType || '-'}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Target</span>
                                        <span className="mobile-record-value"><AuditTargetLink log={log} /></span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Ringkasan</span>
                                        <span className="mobile-record-value">{log.changesSummary || '-'}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </CollapsibleCard>
    );
}

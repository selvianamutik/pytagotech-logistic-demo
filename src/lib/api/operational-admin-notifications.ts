import 'server-only';
import { after } from 'next/server';

const DEFAULT_CALLMEBOT_URL = 'https://api.callmebot.com/whatsapp.php';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_MESSAGE_LENGTH = 900;
const GREEN_API_PROVIDER_VALUES = new Set(['green_api', 'green-api', 'greenapi']);

const STATUS_LABELS: Record<string, string> = {
    CREATED: 'Dibuat',
    ON_DELIVERY: 'Dalam Pengiriman',
    ARRIVED: 'Tiba di Tujuan',
    PARTIAL_HOLD: 'Terkirim Sebagian / Hold',
    DELIVERED: 'Terkirim',
    CANCELLED: 'Dibatalkan',
};

const INCIDENT_SETTLEMENT_CATEGORY_LABELS: Record<string, string> = {
    TOWING: 'Towing / Evakuasi',
    REPAIR: 'Perbaikan',
    SPAREPART: 'Sparepart',
    TIRE: 'Ban',
    MEDICAL: 'Medis',
    THIRD_PARTY_DAMAGE: 'Kerusakan pihak ketiga',
    ADMINISTRATION: 'Administrasi',
    POLICE_ADMIN: 'Administrasi kepolisian',
    ACCOMMODATION: 'Akomodasi',
    CARGO_HANDLING: 'Handling barang',
    OTHER: 'Lain-lain',
};

type CallmeBotConfig =
    | {
        enabled: true;
        provider: 'callmebot';
        apiKey: string;
        phone: string;
        baseUrl: string;
        timeoutMs: number;
        dryRun: boolean;
    }
    | {
        enabled: false;
        provider?: 'callmebot' | 'green-api';
        reason: string;
    };

type GreenApiConfig = {
    enabled: true;
    provider: 'green-api';
    baseUrl: string;
    instanceId: string;
    apiToken: string;
    chatId: string;
    timeoutMs: number;
    dryRun: boolean;
};

type NotificationConfig = CallmeBotConfig | GreenApiConfig;

export type OperationalAdminNotificationResult = {
    ok: boolean;
    skipped: boolean;
    provider: 'callmebot' | 'green-api';
    reason?: string;
    statusCode?: number;
    responseText?: string;
    errorMessage?: string;
};

function readEnv(name: string) {
    return process.env[name]?.trim() || '';
}

function readAnyEnv(names: string[]) {
    return names.map(readEnv).find(Boolean) || '';
}

function readBooleanEnv(names: string[]) {
    const value = readAnyEnv(names).toLowerCase();
    if (!value) return undefined;
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return undefined;
}

export function normalizeWhatsAppPhoneNumber(value: string) {
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) {
        return `62${digits.slice(1)}`;
    }
    return digits;
}

export function normalizeGreenApiChatId(value: string) {
    const compacted = value.trim().replace(/\s+/g, '');
    if (/@(?:c|g)\.us$/i.test(compacted)) {
        return compacted;
    }
    const phone = normalizeWhatsAppPhoneNumber(compacted);
    return phone ? `${phone}@c.us` : '';
}

function readTimeoutMs() {
    const parsed = Number.parseInt(readAnyEnv([
        'GREEN_API_TIMEOUT_MS',
        'CALLMEBOT_TIMEOUT_MS',
        'OPERATIONAL_ADMIN_WHATSAPP_TIMEOUT_MS',
    ]), 10);
    if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
    return Math.min(Math.max(parsed, 1000), 30000);
}

export function getOperationalAdminWhatsAppConfig(): NotificationConfig {
    const explicitEnabled = readBooleanEnv(['CALLMEBOT_ENABLED', 'OPERATIONAL_ADMIN_WHATSAPP_ENABLED']);
    if (explicitEnabled === false) {
        return { enabled: false, reason: 'DISABLED' };
    }

    const providerValue = readAnyEnv(['WHATSAPP_PROVIDER', 'OPERATIONAL_ADMIN_WHATSAPP_PROVIDER']).toLowerCase();
    const hasGreenApiCredential = Boolean(readAnyEnv(['GREEN_API_INSTANCE_ID']) && readAnyEnv(['GREEN_API_TOKEN']));
    const useGreenApi = GREEN_API_PROVIDER_VALUES.has(providerValue) || (!providerValue && hasGreenApiCredential);

    if (useGreenApi) {
        const instanceId = readAnyEnv(['GREEN_API_INSTANCE_ID']);
        const apiToken = readAnyEnv(['GREEN_API_TOKEN', 'GREEN_API_API_TOKEN', 'GREEN_API_INSTANCE_TOKEN']);
        const chatId = normalizeGreenApiChatId(readAnyEnv([
            'GREEN_API_CHAT_ID',
            'OPERATIONAL_ADMIN_WHATSAPP_CHAT_ID',
            'OPERATIONAL_ADMIN_WA',
            'OPERATIONAL_ADMIN_WHATSAPP_PHONE',
            'CALLMEBOT_PHONE',
        ]));

        if (!instanceId || !apiToken || !chatId) {
            return { enabled: false, provider: 'green-api', reason: explicitEnabled ? 'MISSING_CREDENTIALS' : 'NOT_CONFIGURED' };
        }

        return {
            enabled: true,
            provider: 'green-api',
            baseUrl: readAnyEnv(['GREEN_API_URL', 'GREEN_API_BASE_URL']) || 'https://api.green-api.com',
            instanceId,
            apiToken,
            chatId,
            timeoutMs: readTimeoutMs(),
            dryRun: readBooleanEnv(['GREEN_API_DRY_RUN', 'OPERATIONAL_ADMIN_WHATSAPP_DRY_RUN']) === true,
        };
    }

    const apiKey = readAnyEnv(['CALLMEBOT_API_KEY', 'OPERATIONAL_ADMIN_WHATSAPP_API_KEY']);
    const phone = normalizeWhatsAppPhoneNumber(readAnyEnv(['CALLMEBOT_PHONE', 'OPERATIONAL_ADMIN_WHATSAPP_PHONE']));
    if (!apiKey || !phone) {
        return { enabled: false, provider: 'callmebot', reason: explicitEnabled ? 'MISSING_CREDENTIALS' : 'NOT_CONFIGURED' };
    }
    if (phone.length < 10) {
        return { enabled: false, provider: 'callmebot', reason: 'INVALID_PHONE' };
    }

    return {
        enabled: true,
        provider: 'callmebot',
        apiKey,
        phone,
        baseUrl: readAnyEnv(['CALLMEBOT_BASE_URL', 'OPERATIONAL_ADMIN_WHATSAPP_BASE_URL']) || DEFAULT_CALLMEBOT_URL,
        timeoutMs: readTimeoutMs(),
        dryRun: readBooleanEnv(['CALLMEBOT_DRY_RUN', 'OPERATIONAL_ADMIN_WHATSAPP_DRY_RUN']) === true,
    };
}

function normalizeBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, '');
}

function compactMessage(message: string) {
    const compacted = message
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    if (compacted.length <= MAX_MESSAGE_LENGTH) {
        return compacted;
    }
    return `${compacted.slice(0, MAX_MESSAGE_LENGTH - 3)}...`;
}

function getAbortSignal(timeoutMs: number) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return AbortSignal.timeout(timeoutMs);
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs).unref?.();
    return controller.signal;
}

function formatCurrency(amount: number) {
    return `Rp ${Math.max(amount, 0).toLocaleString('id-ID')}`;
}

function formatKm(value?: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? `${Math.round(value).toLocaleString('id-ID')} km`
        : '';
}

export function getDeliveryStatusLabel(status?: string) {
    return status ? STATUS_LABELS[status] || status : '-';
}

export function buildDriverIncidentCreatedMessage(params: {
    incidentNumber?: string;
    driverName?: string;
    doNumber?: string;
    vehiclePlate?: string;
    incidentType?: string;
    urgency?: string;
    locationText?: string;
    odometer?: number;
}) {
    return [
        '[Logistik Demo] Laporan insiden baru dari driver.',
        `Insiden: ${params.incidentNumber || '-'}`,
        `Driver: ${params.driverName || '-'}`,
        `DO: ${params.doNumber || '-'}`,
        `Unit: ${params.vehiclePlate || '-'}`,
        `Tipe/Urgensi: ${[params.incidentType, params.urgency].filter(Boolean).join(' / ') || '-'}`,
        params.locationText ? `Lokasi: ${params.locationText}` : '',
        formatKm(params.odometer) ? `Odometer: ${formatKm(params.odometer)}` : '',
    ].filter(Boolean).join('\n');
}

export function buildDriverIncidentResolutionMessage(params: {
    incidentNumber?: string;
    driverName?: string;
    doNumber?: string;
    costCount?: number;
    amount?: number;
    mode?: 'RESOLUTION' | 'COST_ADDITION';
}) {
    const costCount = Math.max(params.costCount || 0, 0);
    const amount = Math.max(params.amount || 0, 0);
    const isCostAddition = params.mode === 'COST_ADDITION';
    return [
        isCostAddition
            ? '[Logistik Demo] Driver menambahkan biaya insiden.'
            : '[Logistik Demo] Driver mengajukan penyelesaian insiden.',
        `Insiden: ${params.incidentNumber || '-'}`,
        `Driver: ${params.driverName || '-'}`,
        `DO: ${params.doNumber || '-'}`,
        `Biaya draft: ${costCount} baris / ${formatCurrency(amount)}`,
        isCostAddition
            ? 'Admin Operasional perlu review biaya draft.'
            : 'Admin Operasional perlu review.',
    ].join('\n');
}

export function buildDriverDeliveryStatusMessage(params: {
    driverName?: string;
    doNumber?: string;
    status?: string;
    targetCount?: number;
    note?: string;
}) {
    return [
        '[Logistik Demo] Update status SJ/trip dari driver.',
        `Driver: ${params.driverName || '-'}`,
        `DO: ${params.doNumber || '-'}`,
        `Status: ${getDeliveryStatusLabel(params.status)}`,
        params.targetCount ? `Jumlah SJ: ${params.targetCount.toLocaleString('id-ID')}` : '',
        params.note ? `Catatan: ${params.note}` : '',
    ].filter(Boolean).join('\n');
}

export function buildDriverTripClosureMessage(params: {
    driverName?: string;
    doNumber?: string;
    tripEndOdometerKm?: number;
    targetCount?: number;
    note?: string;
}) {
    return [
        '[Logistik Demo] Driver mengajukan tutup trip.',
        `Driver: ${params.driverName || '-'}`,
        `DO: ${params.doNumber || '-'}`,
        formatKm(params.tripEndOdometerKm) ? `Odometer akhir: ${formatKm(params.tripEndOdometerKm)}` : '',
        params.targetCount ? `Jumlah SJ: ${params.targetCount.toLocaleString('id-ID')}` : '',
        params.note ? `Catatan: ${params.note}` : '',
        'Admin Operasional perlu review.',
    ].filter(Boolean).join('\n');
}

export function getIncidentSettlementCategoryLabel(category?: string) {
    return category ? INCIDENT_SETTLEMENT_CATEGORY_LABELS[category] || category : '-';
}

export function buildIncidentSettlementActionRequiredMessage(params: {
    incidentNumber?: string;
    doNumber?: string;
    vehiclePlate?: string;
    category?: string;
    description?: string;
    amount?: number;
    statusLabel?: string;
    actionLabel: string;
}) {
    return [
        '[Logistik Demo] Tindak lanjut biaya insiden.',
        `Insiden: ${params.incidentNumber || '-'}`,
        `DO: ${params.doNumber || '-'}`,
        `Unit: ${params.vehiclePlate || '-'}`,
        `Kategori: ${getIncidentSettlementCategoryLabel(params.category)}`,
        params.description ? `Detail: ${params.description}` : '',
        `Nominal: ${formatCurrency(Math.max(params.amount || 0, 0))}`,
        params.statusLabel ? `Status: ${params.statusLabel}` : '',
        `Aksi: ${params.actionLabel}`,
    ].filter(Boolean).join('\n');
}

export async function sendOperationalAdminWhatsApp(message: string): Promise<OperationalAdminNotificationResult> {
    const config = getOperationalAdminWhatsAppConfig();
    if (!config.enabled) {
        return {
            ok: true,
            skipped: true,
            provider: config.provider || 'callmebot',
            reason: config.reason,
        };
    }

    const text = compactMessage(message);
    if (!text) {
        return {
            ok: true,
            skipped: true,
            provider: config.provider,
            reason: 'EMPTY_MESSAGE',
        };
    }

    if (config.dryRun) {
        return {
            ok: true,
            skipped: true,
            provider: config.provider,
            reason: 'DRY_RUN',
            responseText: text,
        };
    }

    try {
        if (config.provider === 'green-api') {
            const response = await fetch(
                `${normalizeBaseUrl(config.baseUrl)}/waInstance${encodeURIComponent(config.instanceId)}/sendMessage/${encodeURIComponent(config.apiToken)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chatId: config.chatId,
                        message: text,
                    }),
                    signal: getAbortSignal(config.timeoutMs),
                    cache: 'no-store',
                }
            );
            const responseText = (await response.text().catch(() => '')).trim();
            const providerRejected = /\b(error|invalid|not authorized|notauthorized|instance|token|forbidden)\b/i.test(responseText);
            if (!response.ok || providerRejected) {
                return {
                    ok: false,
                    skipped: false,
                    provider: 'green-api',
                    statusCode: response.status,
                    responseText,
                    reason: providerRejected ? 'PROVIDER_REJECTED' : 'HTTP_ERROR',
                };
            }

            return {
                ok: true,
                skipped: false,
                provider: 'green-api',
                statusCode: response.status,
                responseText,
            };
        }

        const url = new URL(config.baseUrl);
        url.searchParams.set('phone', config.phone);
        url.searchParams.set('text', text);
        url.searchParams.set('apikey', config.apiKey);

        const response = await fetch(url, {
            method: 'GET',
            signal: getAbortSignal(config.timeoutMs),
            cache: 'no-store',
        });
        const responseText = (await response.text().catch(() => '')).trim();
        const providerRejected = /\b(error|invalid|not allowed|apikey|api key)\b/i.test(responseText);
        if (!response.ok || providerRejected) {
            return {
                ok: false,
                skipped: false,
                provider: config.provider,
                statusCode: response.status,
                responseText,
                reason: providerRejected ? 'PROVIDER_REJECTED' : 'HTTP_ERROR',
            };
        }

        return {
            ok: true,
            skipped: false,
            provider: config.provider,
            statusCode: response.status,
            responseText,
        };
    } catch (error) {
        return {
            ok: false,
            skipped: false,
            provider: config.provider,
            reason: 'REQUEST_FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function notifyOperationalAdminWhatsApp(message: string) {
    const result = await sendOperationalAdminWhatsApp(message);
    if (!result.ok && !result.skipped) {
        console.warn('Operational admin WhatsApp notification failed', {
            provider: result.provider,
            reason: result.reason,
            statusCode: result.statusCode,
            responseText: result.responseText,
            errorMessage: result.errorMessage,
        });
    }
    return result;
}

function isAfterRequestScopeError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('outside a request scope') || message.includes('next-dynamic-api-wrong-context');
}

export function scheduleOperationalAdminWhatsApp(message: string) {
    const task = () => notifyOperationalAdminWhatsApp(message);
    try {
        after(task);
    } catch (error) {
        if (!isAfterRequestScopeError(error)) {
            throw error;
        }
        queueMicrotask(() => {
            void task();
        });
    }
}

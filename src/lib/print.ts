/* ============================================================
   LOGISTIK - Print Utility
   ============================================================ */

import DOMPurify from 'dompurify';
import { formatBusinessDate, getBusinessCalendarDateParts } from './business-date';
import {
    formatFreightNotaDisplayWeight,
    getFreightNotaRateColumnLabel,
    getFreightNotaWeightColumnLabel,
    normalizeFreightNotaBillingMode,
} from './freight-nota-billing';
import { buildFreightNotaDisplayNumberFromParts } from './nota-numbering';
import { buildPph23Label, calculatePph23Summary } from './pph23';
import { resolveCompanyLogoUrl } from './branding';
import { parseFormattedNumberish } from '@/components/FormattedNumberInput.helpers';
import type { BankAccount, CompanyProfile, Customer, FreightNota, FreightNotaInstructionAccount, FreightNotaItem, Payment } from './types';
import { getReceivableNetAmount, PAYMENT_METHOD_MAP, terbilang } from './utils';

let inFlightCompanyProfileRequest: Promise<CompanyProfile | null> | null = null;

export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
    if (!inFlightCompanyProfileRequest) {
        inFlightCompanyProfileRequest = fetch('/api/data?entity=company')
            .then(async res => {
                if (!res.ok) return null;
                const data = await res.json();
                return data.data || null;
            })
            .catch(() => null)
            .finally(() => {
                inFlightCompanyProfileRequest = null;
            });
    }
    return inFlightCompanyProfileRequest;
}

export type PrintableCompanyProfile = Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'>;

export type DocumentIssuerProfileSnapshot = {
    issuerCompanyName?: string;
    issuerCompanyAddress?: string;
    issuerCompanyPhone?: string;
    issuerCompanyEmail?: string;
    issuerCompanyLogoUrl?: string;
};

export function resolveDocumentIssuerProfile(
    snapshot?: DocumentIssuerProfileSnapshot | null,
    company?: PrintableCompanyProfile | null,
): PrintableCompanyProfile | null {
    const resolvedName = snapshot?.issuerCompanyName?.trim() || company?.name?.trim();
    const resolvedAddress = snapshot?.issuerCompanyAddress?.trim() || company?.address?.trim();
    const resolvedPhone = snapshot?.issuerCompanyPhone?.trim() || company?.phone?.trim();
    const resolvedEmail = snapshot?.issuerCompanyEmail?.trim() || company?.email?.trim();
    const resolvedLogoUrl = snapshot?.issuerCompanyLogoUrl?.trim() || company?.logoUrl?.trim();

    if (!resolvedName && !resolvedAddress && !resolvedPhone && !resolvedEmail && !resolvedLogoUrl) {
        return null;
    }

    return {
        name: resolvedName || 'PT Gading Mas Surya',
        address: resolvedAddress || '-',
        phone: resolvedPhone || '-',
        email: resolvedEmail || '-',
        logoUrl: resolvedLogoUrl || undefined,
    };
}

export type InvoiceInstructionAccount = {
    _id: string;
    bankName: string;
    accountNumber?: string;
    accountHolder?: string;
    accountType?: BankAccount['accountType'];
    active?: boolean;
};

export function resolveInvoiceInstructionAccounts(
    company: CompanyProfile | null | undefined,
    bankAccounts: InvoiceInstructionAccount[] = [],
    storedAccounts: FreightNotaInstructionAccount[] = [],
) {
    const snapshotAccounts = storedAccounts
        .map<InvoiceInstructionAccount>(account => ({
            _id: account.bankAccountRef || `snapshot-${account.bankName}-${account.accountNumber || '-'}`,
            bankName: account.bankName,
            accountNumber: account.accountNumber,
            accountHolder: account.accountHolder,
            accountType: 'BANK',
            active: true,
        }))
        .filter(account => Boolean(account.bankName?.trim()));

    if (snapshotAccounts.length > 0) {
        return snapshotAccounts;
    }

    const selectedRefs = Array.isArray(company?.invoiceSettings?.invoiceBankAccountRefs)
        ? company.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
    const eligibleAccounts = bankAccounts.filter(account => account.active !== false && account.accountType !== 'CASH');
    const accountMap = new Map(eligibleAccounts.map(account => [account._id, account]));
    const selectedAccounts = selectedRefs
        .map(ref => accountMap.get(ref))
        .filter((account): account is InvoiceInstructionAccount => Boolean(account));
    const uniqueSelectedAccounts = selectedAccounts.filter((account, index) =>
        selectedAccounts.findIndex(candidate => candidate._id === account._id) === index
    );

    if (uniqueSelectedAccounts.length > 0) {
        const defaultRef = typeof company?.invoiceSettings?.defaultInvoiceBankAccountRef === 'string'
            ? company.invoiceSettings.defaultInvoiceBankAccountRef
            : undefined;

        return uniqueSelectedAccounts.sort((left, right) => {
            if (defaultRef) {
                if (left._id === defaultRef) return -1;
                if (right._id === defaultRef) return 1;
            }
            return selectedRefs.indexOf(left._id) - selectedRefs.indexOf(right._id);
        });
    }

    const legacyBankName = company?.bankName?.trim();
    if (!legacyBankName) {
        return [];
    }

    return [{
        _id: 'legacy-company-bank',
        bankName: legacyBankName,
        accountNumber: company?.bankAccount?.trim() || '-',
        accountHolder: company?.bankHolder?.trim() || '-',
        accountType: 'BANK',
        active: true,
    }] satisfies InvoiceInstructionAccount[];
}

export function buildInvoiceInstructionAccountText(account: InvoiceInstructionAccount) {
    return [
        account.bankName || '-',
        account.accountNumber ? `A/C ${account.accountNumber}` : '',
        account.accountHolder ? `A/N ${account.accountHolder}` : '',
    ].filter(Boolean).join(' | ');
}

export function openPrintWindow(loadingTitle: string = 'Menyiapkan dokumen cetak...') {
    const w = window.open('', '_blank');
    if (!w) return null;
    try {
        w.opener = null;
    } catch {
        // Ignore cross-window hardening failures; print flow can continue.
    }

    const safeTitle = escapePrintHtml(loadingTitle);
    w.document.write(`<!DOCTYPE html><html><head><title>${safeTitle}</title><style>
        body { font-family: 'Segoe UI', -apple-system, sans-serif; padding: 2rem; color: #1e293b; }
        .print-loading { display: flex; align-items: center; gap: 0.75rem; font-size: 0.95rem; }
        .print-loading-dot { width: 0.75rem; height: 0.75rem; border-radius: 999px; background: #1e40af; animation: pulse 1s infinite alternate; }
        @keyframes pulse { from { opacity: 0.35; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
    </style></head><body><div class="print-loading"><div class="print-loading-dot"></div><div>${safeTitle}</div></div></body></html>`);
    w.document.close();
    return w;
}

export function openBrandedPrint(opts: {
    title: string;
    subtitle?: string;
    company: PrintableCompanyProfile | null;
    bodyHtml: string;
    extraStyles?: string;
    showCompanyHeader?: boolean;
    showFooter?: boolean;
    targetWindow?: Window | null;
    autoPrint?: boolean;
}) {
    const w = opts.targetWindow && !opts.targetWindow.closed
        ? opts.targetWindow
        : openPrintWindow(opts.title);
    if (!w) return;

    const {
        title,
        subtitle,
        company,
        bodyHtml,
        extraStyles,
        showCompanyHeader = true,
        showFooter = true,
        autoPrint = true,
        targetWindow: _targetWindow,
    } = opts;
    void _targetWindow;

    const companyName = company?.name || 'PT Gading Mas Surya';
    const companyLogo = resolveCompanyLogoUrl(company);
    const printDate = formatBusinessDate(new Date(), 'id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    });

    const browserTitle = `${title}${subtitle ? ` - ${subtitle}` : ''} - ${companyName}`;
    const safeBrowserTitle = escapePrintHtml(browserTitle);
    const safeCompanyName = escapePrintHtml(companyName);
    const safeSubtitle = subtitle ? escapePrintHtml(subtitle) : '';
    const safeTitle = escapePrintHtml(title);
    const safePrintDate = escapePrintHtml(printDate);
    const safeCompanyLogo = companyLogo ? escapePrintAttribute(companyLogo) : '';
    const safeBodyHtml = DOMPurify.sanitize(bodyHtml, {
        USE_PROFILES: { html: true },
    });

    w.document.write(`<!DOCTYPE html><html><head><title>${safeBrowserTitle}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', -apple-system, sans-serif; padding: 2rem; color: #1e293b; max-width: 900px; margin: 0 auto; font-size: 14px; }
        .print-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #1e293b; }
        .print-header img { height: 48px; width: auto; object-fit: contain; }
        .print-header .co-name { font-size: 1.3rem; font-weight: 800; color: #1e293b; }
        .print-header .co-sub { color: #64748b; font-size: 0.85rem; }
        .print-header .print-date { margin-left: auto; text-align: right; font-size: 0.72rem; color: #94a3b8; }
        .print-footer { margin-top: 1.5rem; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 0.75rem; display: flex; justify-content: space-between; }
        .print-preview-toolbar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: -2rem -2rem 1.25rem; padding: 0.85rem 2rem; background: #0f172a; color: white; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18); }
        .print-preview-title { font-weight: 700; letter-spacing: 0.01em; }
        .print-preview-subtitle { color: #cbd5e1; font-size: 0.78rem; margin-top: 0.1rem; }
        .print-preview-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: flex-end; }
        .print-preview-actions button { border: 0; border-radius: 8px; padding: 0.5rem 0.8rem; font-weight: 700; cursor: pointer; }
        .print-preview-actions .primary { background: #0f766e; color: white; }
        .print-preview-actions .secondary { background: #334155; color: white; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { padding: 0.5rem 0.65rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.82rem; }
        th { background: #f1f5f9; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
        .r { text-align: right; }
        .c { text-align: center; }
        .b { font-weight: 700; }
        .s { color: #16a34a; }
        .d { color: #dc2626; }
        .w { color: #d97706; }
        .p { color: #7c3aed; }
        .stats-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
        .stat-box { flex: 1; text-align: center; padding: 0.6rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
        .stat-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
        .stat-value { font-size: 1rem; font-weight: 700; margin-top: 0.15rem; }
        .section-title { font-size: 0.85rem; font-weight: 700; color: #1e293b; margin: 1rem 0 0.5rem; padding-bottom: 0.25rem; border-bottom: 1px solid #e2e8f0; }
        @media print { body { padding: 0.5rem; } .no-print { display: none !important; } }
        ${extraStyles || ''}
    </style></head><body>
        ${!autoPrint ? `
            <div class="print-preview-toolbar no-print">
                <div>
                    <div class="print-preview-title">Preview Cetak</div>
                    <div class="print-preview-subtitle">${safeBrowserTitle}</div>
                </div>
                <div class="print-preview-actions">
                    <button class="primary" onclick="window.print()">Download PDF</button>
                    <button class="secondary" onclick="window.print()">Print</button>
                    <button class="secondary" onclick="window.close()">Tutup</button>
                </div>
            </div>
        ` : ''}
        ${showCompanyHeader ? `
            <div class="print-header">
                ${safeCompanyLogo ? `<img src="${safeCompanyLogo}" />` : ''}
                <div>
                    <div class="co-name">${safeCompanyName}</div>
                    <div class="co-sub">${safeTitle}${safeSubtitle ? ` - ${safeSubtitle}` : ''}</div>
                </div>
                <div class="print-date">Dicetak:<br/>${safePrintDate}</div>
            </div>
        ` : ''}
        ${safeBodyHtml}
        ${showFooter ? `
            <div class="print-footer">
                <span>${safeCompanyName}</span>
                <span>Dicetak: ${safePrintDate}</span>
            </div>
        ` : ''}
    </body></html>`);
    w.document.close();
    if (autoPrint) {
        setTimeout(() => w.print(), 300);
    } else {
        setTimeout(() => w.focus(), 50);
    }
}

export function escapePrintHtml(value: unknown) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapePrintAttribute(value: unknown) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function fmtPrintDate(value?: string | Date) {
    if (!value) return '-';
    const parts = getBusinessCalendarDateParts(value);
    if (!parts) return typeof value === 'string' ? value : '';
    return `${parts.day}-${parts.month}-${parts.year}`;
}

function fmtLongPrintDate(value?: string | Date) {
    if (!value) return '-';
    return formatBusinessDate(value, 'id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

export function formatFreightNotaDisplayNumber(
    nota: Pick<FreightNota, 'notaNumber' | 'issueDate' | 'notaDisplayNumber'>,
    company?: CompanyProfile | null,
) {
    if (nota.notaDisplayNumber?.trim()) {
        return nota.notaDisplayNumber.trim();
    }
    return buildFreightNotaDisplayNumberFromParts(
        nota.notaNumber,
        nota.issueDate,
        company?.numberingSettings?.notaSeriesCode,
    );
}

export function resolveFreightNotaIssuerProfile(
    nota: Pick<FreightNota, 'issuerCompanyName' | 'issuerCompanyAddress' | 'issuerCompanyPhone' | 'issuerCompanyEmail' | 'issuerCompanyLogoUrl' | 'issuerCompanyNpwp'>,
    company?: CompanyProfile | null,
) {
    const resolvedIssuer = resolveDocumentIssuerProfile(nota, company);

    return {
        name: resolvedIssuer?.name || 'PT Gading Mas Surya',
        address: resolvedIssuer?.address || '',
        phone: resolvedIssuer?.phone || '',
        email: resolvedIssuer?.email || '',
        logoUrl: resolvedIssuer?.logoUrl,
        npwp: nota.issuerCompanyNpwp?.trim() || company?.npwp?.trim() || '',
    };
}

export function buildFreightNotaPrintDocument(opts: {
    nota: FreightNota;
    items: FreightNotaItem[];
    company: CompanyProfile | null;
    customer?: Pick<Customer, 'name' | 'address' | 'contactPerson' | 'phone'> | null;
    invoiceBankAccounts?: InvoiceInstructionAccount[];
}) {
    const { nota, items, company, customer, invoiceBankAccounts = [] } = opts;
    const issuerProfile = resolveFreightNotaIssuerProfile(nota, company);
    const displayNumber = formatFreightNotaDisplayNumber(nota, company);
    const grossAmount = parseFormattedNumberish(nota.totalAmount || 0);
    const adjustmentAmount = parseFormattedNumberish(nota.totalAdjustmentAmount || 0);
    const pph23Summary = calculatePph23Summary({
        grossAmount,
        claimAmount: adjustmentAmount,
        enabled: nota.pph23Enabled,
        ratePercent: nota.pph23RatePercent,
        baseMode: nota.pph23BaseMode,
    });
    const netAmount = getReceivableNetAmount(nota);
    const billingMode = normalizeFreightNotaBillingMode(nota.billingMode);
    const printDate = fmtLongPrintDate(new Date());
    const dueDateLabel = nota.dueDate ? fmtLongPrintDate(nota.dueDate) : '-';
    const taxInvoiceNumberLabel = nota.taxInvoiceNumber?.trim() || '-';
    const customerAddressLabel = nota.customerAddress?.trim() || customer?.address?.trim() || '';
    const customerContactLabel = [nota.customerContactPerson || customer?.contactPerson, nota.customerPhone || customer?.phone].filter(Boolean).join(' | ');
    const invoiceInstructionAccounts = resolveInvoiceInstructionAccounts(company, invoiceBankAccounts, nota.instructionAccounts || []);
    const footerNote = nota.footerNote?.trim() || company?.invoiceSettings?.footerNote?.trim() || '';
    const amountInWords = terbilang(Math.max(Math.round(netAmount), 0))
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, character => character.toUpperCase());
    const billedWeightLabel = formatFreightNotaDisplayWeight({
        beratKg: nota.totalWeightKg || 0,
        volumeM3: nota.totalVolumeM3 || 0,
        billingMode,
        includeCanonical: billingMode === 'PER_TON',
    });
    const signatureName =
        nota.issuerCompanySignatureName?.trim()
        || (invoiceInstructionAccounts[0]?.accountHolder && invoiceInstructionAccounts[0].accountHolder.trim().toLowerCase() !== issuerProfile.name.trim().toLowerCase()
            ? invoiceInstructionAccounts[0].accountHolder.trim()
            : 'Bagian Administrasi');

    const itemRowsHtml = items.map((item) => {
        const collie = parseFormattedNumberish(item.collie || 0);
        const tarip = parseFormattedNumberish(item.tarip || 0);
        const uangRp = parseFormattedNumberish(item.uangRp || 0);
        const qtyText = collie > 0 ? fmtNumber(collie) : '-';
        const weightText = formatFreightNotaDisplayWeight({
            beratKg: item.beratKg || 0,
            volumeM3: item.volumeM3 || 0,
            billingMode,
            includeCanonical: false,
        });

        return `
            <tr>
                <td>${escapePrintHtml(item.vehiclePlate || '-')}</td>
                <td class="c">${escapePrintHtml(fmtPrintDate(item.date))}</td>
                <td>${escapePrintHtml(item.noSJ || item.doNumber || '-')}</td>
                <td>${escapePrintHtml(item.dari || '-')}</td>
                <td>${escapePrintHtml(item.tujuan || '-')}</td>
                <td>${escapePrintHtml(item.barang || 'Jasa pengiriman')}</td>
                <td class="c">${escapePrintHtml(qtyText)}</td>
                <td class="r">${escapePrintHtml(weightText)}</td>
                <td class="r">${escapePrintHtml(fmtCurrency(tarip))}</td>
                <td class="r">${escapePrintHtml(fmtCurrency(uangRp))}</td>
                <td class="c">${escapePrintHtml(item.plt || '')}</td>
                <td class="c">${escapePrintHtml(item.pc || '')}</td>
                <td class="c">${escapePrintHtml(item.k || '')}</td>
                <td class="c">${escapePrintHtml(item.kbl || '')}</td>
                <td class="c">${escapePrintHtml(item.invoiceLineDate ? fmtPrintDate(item.invoiceLineDate) : '')}</td>
            </tr>
        `;
    }).join('');

    const fillerRowsHtml = Array.from({ length: Math.max(6 - items.length, 0) }, () => `
        <tr class="invoice-filler-row">
            ${Array.from({ length: 15 }, () => '<td>&nbsp;</td>').join('')}
        </tr>
    `).join('');

    const companyLogo = resolveCompanyLogoUrl({ logoUrl: issuerProfile.logoUrl });
    const logoHtml = `<img src="${escapePrintAttribute(companyLogo)}" alt="${escapePrintAttribute(issuerProfile.name || 'Logo perusahaan')}" class="invoice-logo" />`;
    const signatureStampUrl = nota.issuerCompanySignatureStampUrl?.trim() || company?.signatureStampUrl?.trim() || '';
    const signatureStampHtml = signatureStampUrl
        ? `<img src="${escapePrintAttribute(signatureStampUrl)}" alt="Tanda tangan" class="invoice-signature-image" />`
        : '';

    const invoiceInstructionHtml = invoiceInstructionAccounts.map(account => `
        <div class="invoice-payment-bank-item">
            <div class="invoice-payment-bank-name">${escapePrintHtml(account.bankName || '-')}</div>
            <div>${escapePrintHtml(account.accountNumber ? `No. Rekening: ${account.accountNumber}` : 'No. Rekening: -')}</div>
            <div>${escapePrintHtml(account.accountHolder ? `Atas Nama: ${account.accountHolder}` : 'Atas Nama: -')}</div>
        </div>
    `).join('');

    const bodyHtml = `
        <div class="invoice-sheet">
            <div class="invoice-brand-row">
                <div class="invoice-brand-left">
                    ${logoHtml}
                    <div>
                        <div class="invoice-brand-title">Invoice</div>
                    </div>
                </div>
                <div class="invoice-company-box">
                    <div class="invoice-company-name">${escapePrintHtml(issuerProfile.name)}</div>
                    ${issuerProfile.address ? `<div>${escapePrintHtml(issuerProfile.address)}</div>` : ''}
                    ${issuerProfile.phone ? `<div>Tel. ${escapePrintHtml(issuerProfile.phone)}</div>` : ''}
                    ${issuerProfile.email ? `<div>${escapePrintHtml(issuerProfile.email)}</div>` : ''}
                    ${issuerProfile.npwp ? `<div>NPWP: ${escapePrintHtml(issuerProfile.npwp)}</div>` : ''}
                </div>
            </div>

            <div class="invoice-top-grid">
                <div class="invoice-panel">
                    <div class="invoice-panel-title">Kepada Yth.</div>
                    <div class="invoice-recipient-name">${escapePrintHtml(nota.customerName)}</div>
                    ${customerAddressLabel ? `<div class="invoice-recipient-address">${escapePrintHtml(customerAddressLabel)}</div>` : ''}
                    ${customerContactLabel ? `<div class="invoice-recipient-contact">${escapePrintHtml(customerContactLabel)}</div>` : ''}
                </div>
                <div class="invoice-panel">
                    <table class="invoice-info-table">
                        <tbody>
                            <tr>
                                <td>Nomor Invoice</td>
                                <td>${escapePrintHtml(displayNumber)}</td>
                            </tr>
                            <tr>
                                <td>Tanggal Cetak</td>
                                <td>${escapePrintHtml(printDate)}</td>
                            </tr>
                            <tr>
                                <td>Jatuh Tempo</td>
                                <td>${escapePrintHtml(dueDateLabel)}</td>
                            </tr>
                            <tr>
                                <td>No Faktur Pajak</td>
                                <td>${escapePrintHtml(taxInvoiceNumberLabel)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="invoice-section-title">Perincian Jasa dan Harga</div>
            <table class="invoice-items-table">
                <thead>
                    <tr>
                        <th class="invoice-col-truck">No. Truck</th>
                        <th class="c invoice-col-date">Tanggal</th>
                        <th class="invoice-col-sj">No. SJ</th>
                        <th class="invoice-col-origin">Dari</th>
                        <th class="invoice-col-destination">Tujuan</th>
                        <th class="invoice-col-goods">Barang</th>
                        <th class="c invoice-col-qty">Collie</th>
                        <th class="r invoice-col-weight">${escapePrintHtml(getFreightNotaWeightColumnLabel(billingMode))}</th>
                        <th class="r invoice-col-price">${escapePrintHtml(getFreightNotaRateColumnLabel(billingMode))}</th>
                        <th class="r invoice-col-total">Uang Rp</th>
                        <th class="c invoice-col-plt">Plt</th>
                        <th class="c invoice-col-pc">Pc</th>
                        <th class="c invoice-col-k">K</th>
                        <th class="c invoice-col-kbl">Kbl</th>
                        <th class="c invoice-col-line-date">Tgl</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRowsHtml}
                    ${fillerRowsHtml}
                    <tr class="invoice-summary-row">
                        <td colspan="6" class="r"><strong>Jumlah</strong></td>
                        <td class="c"><strong>${escapePrintHtml(fmtNumber(parseFormattedNumberish(nota.totalCollie || 0)))}</strong></td>
                        <td class="r"><strong>${escapePrintHtml(billedWeightLabel)}</strong></td>
                        <td></td>
                        <td class="r"><strong>${escapePrintHtml(fmtCurrency(grossAmount))}</strong></td>
                        <td colspan="5"></td>
                    </tr>
                </tbody>
            </table>

            <div class="invoice-total-box">
                <table class="invoice-total-table">
                    <tbody>
                        <tr>
                            <td>Jumlah Total</td>
                            <td class="r">${escapePrintHtml(fmtCurrency(grossAmount))}</td>
                        </tr>
                        ${adjustmentAmount > 0 ? `
                            <tr>
                                <td>Potongan / Klaim</td>
                                <td class="r">(${escapePrintHtml(fmtCurrency(adjustmentAmount))})</td>
                            </tr>
                        ` : ''}
                        ${pph23Summary.amount > 0 ? `
                            <tr>
                                <td>${escapePrintHtml(buildPph23Label({
                                    enabled: pph23Summary.enabled,
                                    ratePercent: pph23Summary.ratePercent,
                                    baseMode: pph23Summary.baseMode,
                                }))}</td>
                                <td class="r">(${escapePrintHtml(fmtCurrency(pph23Summary.amount))})</td>
                            </tr>
                        ` : ''}
                        <tr class="invoice-grand-total-row">
                            <td>Invoice Transfer Final</td>
                            <td class="r">${escapePrintHtml(fmtCurrency(netAmount))}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="invoice-bottom-grid">
                <div class="invoice-panel">
                    <div class="invoice-bottom-label">Terbilang</div>
                    <div class="invoice-bottom-value"># ${escapePrintHtml(amountInWords)} Rupiah #</div>
                </div>
            </div>

            <div class="invoice-footer-grid">
                <div class="invoice-panel">
                    <div class="invoice-section-title compact">Petunjuk Pembayaran</div>
                    <div class="invoice-payment-line">Mohon lakukan pembayaran sebelum <strong>${escapePrintHtml(dueDateLabel)}</strong> dengan menyebutkan nomor invoice <strong>${escapePrintHtml(displayNumber)}</strong>.</div>
                    ${invoiceInstructionAccounts.length > 0 ? `
                        <div class="invoice-payment-subtitle">Pembayaran ditujukan ke:</div>
                        <div class="invoice-payment-bank-list">${invoiceInstructionHtml}</div>
                    ` : ''}
                    ${footerNote ? `<div class="invoice-payment-note">${escapePrintHtml(footerNote)}</div>` : ''}
                </div>
                <div class="invoice-signature-box">
                    <div class="invoice-signature-title">Hormat Kami,</div>
                    <div class="invoice-signature-company">${escapePrintHtml(issuerProfile.name)}</div>
                    <div class="invoice-signature-area">
                        ${signatureStampHtml}
                    </div>
                    <div class="invoice-signature-name">${escapePrintHtml(signatureName)}</div>
                    <div class="invoice-signature-role">Operasional / Finance</div>
                </div>
            </div>

        </div>
    `;

    const extraStyles = `
        body { font-family: "Times New Roman", Arial, serif; padding: 0.45rem 0.6rem; color: #111827; max-width: 194mm; margin: 0 auto; }
        .invoice-sheet { font-size: 11px; line-height: 1.28; color: #111827; }
        .invoice-brand-row { display: grid; grid-template-columns: 1.2fr 0.9fr; gap: 0.85rem; align-items: start; margin-bottom: 0.85rem; }
        .invoice-brand-left { display: flex; gap: 0.75rem; align-items: center; min-height: 68px; }
        .invoice-logo { width: 58px; height: 58px; object-fit: contain; }
        .invoice-logo-placeholder { display: flex; align-items: center; justify-content: center; border: 1px solid #4b5563; font-size: 1.45rem; font-weight: 700; width: 58px; height: 58px; }
        .invoice-brand-title { font-size: 1.5rem; font-weight: 700; letter-spacing: 0; }
        .invoice-company-box { padding: 0.1rem 0; font-size: 0.84rem; text-align: left; }
        .invoice-company-name { font-weight: 700; font-size: 1rem; margin-bottom: 0.2rem; text-transform: uppercase; }
        .invoice-top-grid { display: grid; grid-template-columns: 0.82fr 1.18fr; gap: 0.65rem; margin-bottom: 0.75rem; }
        .invoice-bottom-grid { display: grid; grid-template-columns: fit-content; gap: 0.65rem; margin-bottom: 0.75rem; justify-content: start; }
        .invoice-footer-grid { display: grid; grid-template-columns: 1fr 0.62fr; gap: 0.65rem; margin-bottom: 0.75rem; }
        .invoice-brand-row > *, .invoice-top-grid > *, .invoice-bottom-grid > *, .invoice-footer-grid > * { min-width: 0; }
        .invoice-company-box, .invoice-panel, .invoice-info-table td, .invoice-payment-bank-item, .invoice-signature-box { overflow-wrap: break-word; word-break: break-word; }
        .invoice-panel { border: 1px solid #4b5563; padding: 0.55rem 0.65rem; min-height: 100%; }
        .invoice-panel-title, .invoice-section-title { font-weight: 700; font-style: italic; margin-bottom: 0.35rem; }
        .invoice-section-title { margin: 0.75rem 0 0.3rem; padding-left: 0.2rem; }
        .invoice-section-title.compact { margin-top: 0; font-style: italic; }
        .invoice-recipient-name { font-weight: 700; font-size: 1rem; margin-bottom: 0.28rem; }
        .invoice-recipient-address { white-space: pre-line; }
        .invoice-recipient-contact { margin-top: 0.2rem; font-size: 0.82rem; }
        .invoice-info-table, .invoice-items-table, .invoice-total-table { width: 100%; border-collapse: collapse; }
        .invoice-info-table td { border: 1px solid #4b5563; padding: 0.3rem 0.4rem; vertical-align: top; }
        .invoice-info-table { table-layout: fixed; }
        .invoice-info-table td:first-child { width: 42%; font-weight: 600; background: #fff; }
        .invoice-items-table { table-layout: fixed; max-width: 100%; }
        .invoice-items-table th, .invoice-items-table td { border: 1px solid #4b5563; padding: 0.22rem 0.22rem; vertical-align: top; font-size: 0.62rem; word-break: break-word; }
        .invoice-items-table th { background: #fff; font-weight: 700; }
        .invoice-col-truck { width: 7.5%; }
        .invoice-col-date { width: 7.5%; }
        .invoice-col-sj { width: 10%; }
        .invoice-col-origin { width: 10.5%; }
        .invoice-col-destination { width: 6.5%; }
        .invoice-col-goods { width: 9%; }
        .invoice-col-qty { width: 5%; }
        .invoice-col-weight { width: 6.5%; }
        .invoice-col-price { width: 6.5%; }
        .invoice-col-total { width: 9%; }
        .invoice-col-plt, .invoice-col-pc, .invoice-col-k, .invoice-col-kbl { width: 3%; }
        .invoice-col-line-date { width: 7.5%; }
        .invoice-filler-row td { color: transparent; height: 34px; }
        .invoice-summary-row td { font-size: 0.7rem; }
        .invoice-total-box { display: flex; justify-content: flex-end; margin: 0 0 0.5rem; }
        .invoice-total-table { width: 290px; }
        .invoice-total-table td { border: 1px solid #4b5563; padding: 0.34rem 0.5rem; }
        .invoice-total-table td:first-child { width: 62%; }
        .invoice-grand-total-row td { font-weight: 700; font-size: 1rem; }
        .invoice-bottom-label { font-weight: 700; margin-bottom: 0.25rem; }
        .invoice-bottom-value { font-size: 0.92rem; }
        .invoice-payment-line { margin-bottom: 0.45rem; }
        .invoice-payment-subtitle { font-weight: 700; margin-bottom: 0.2rem; }
        .invoice-payment-bank-list { display: flex; flex-direction: column; gap: 0.3rem; }
        .invoice-payment-bank-item { border: 1px solid #4b5563; padding: 0.35rem 0.45rem; }
        .invoice-payment-bank-name { font-weight: 700; margin-bottom: 0.12rem; }
        .invoice-payment-note { margin-top: 0.35rem; color: #111827; }
        .invoice-signature-box { border: 1px solid #4b5563; padding: 0.55rem 0.65rem; display: flex; flex-direction: column; justify-content: space-between; }
        .invoice-signature-title { margin-bottom: 0.15rem; }
        .invoice-signature-company { font-weight: 700; text-transform: uppercase; margin-bottom: 0.45rem; }
        .invoice-signature-area { min-height: 95px; display: flex; align-items: flex-end; justify-content: center; }
        .invoice-signature-image { max-width: 150px; max-height: 92px; object-fit: contain; }
        .invoice-signature-name { font-weight: 700; text-transform: uppercase; margin-top: 0.3rem; border-top: 1px solid #4b5563; padding-top: 0.25rem; }
        .invoice-signature-role { color: #111827; font-size: 0.8rem; text-transform: uppercase; }
        .c { text-align: center; }
        .r { text-align: right; }
        @page { size: A4 portrait; margin: 8mm; }
        @media print { body { padding: 0; max-width: 100%; } }
    `;

    return {
        title: 'Invoice',
        subtitle: displayNumber,
        bodyHtml,
        extraStyles,
        showCompanyHeader: false,
        showFooter: false,
    };
}

export function buildPaymentReceiptPrintDocument(opts: {
    payment: Payment;
    nota: FreightNota;
    company: CompanyProfile | null;
    customer?: Pick<Customer, 'name' | 'address' | 'contactPerson' | 'phone'> | null;
}) {
    const { payment, nota, company } = opts;
    const issuerProfile = resolveFreightNotaIssuerProfile(nota, company);
    const invoiceNumber = formatFreightNotaDisplayNumber(nota, company);
    const receiptNumber = invoiceNumber;
    const amount = parseFormattedNumberish(payment.amount || 0);
    const amountInWords = terbilang(Math.max(Math.round(amount), 0))
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, character => character.toUpperCase());
    const paymentMethodLabel = PAYMENT_METHOD_MAP[payment.method] || payment.method || '-';
    const accountLabel = [
        payment.bankAccountName,
        payment.bankAccountNumber ? `No. ${payment.bankAccountNumber}` : '',
    ].filter(Boolean).join(' | ') || (payment.method === 'CASH' ? 'Kas Tunai' : '-');
    const companyLogo = resolveCompanyLogoUrl({ logoUrl: issuerProfile.logoUrl });
    const logoHtml = `<img src="${escapePrintAttribute(companyLogo)}" alt="${escapePrintAttribute(issuerProfile.name || 'Logo perusahaan')}" class="receipt-logo" />`;
    const paymentNote = payment.note?.trim();

    const bodyHtml = `
        <div class="receipt-sheet">
            <div class="receipt-header">
                <div class="receipt-brand">
                    ${logoHtml}
                    <div>
                        <div class="receipt-company">${escapePrintHtml(issuerProfile.name)}</div>
                        ${issuerProfile.address ? `<div class="receipt-company-line">${escapePrintHtml(issuerProfile.address)}</div>` : ''}
                        ${issuerProfile.phone ? `<div class="receipt-company-line">Tel. ${escapePrintHtml(issuerProfile.phone)}</div>` : ''}
                        ${issuerProfile.email ? `<div class="receipt-company-line">${escapePrintHtml(issuerProfile.email)}</div>` : ''}
                    </div>
                </div>
                <div class="receipt-title-box">
                    <div class="receipt-title">KWITANSI</div>
                    <div class="receipt-number">${escapePrintHtml(receiptNumber)}</div>
                </div>
            </div>

            <table class="receipt-main-table">
                <tbody>
                    <tr>
                        <td>No Kwitansi</td>
                        <td>${escapePrintHtml(receiptNumber)}</td>
                    </tr>
                    <tr>
                        <td>Tanggal Terima</td>
                        <td>${escapePrintHtml(fmtLongPrintDate(payment.date))}</td>
                    </tr>
                    <tr>
                        <td>Telah Terima Dari</td>
                        <td>
                            <strong>${escapePrintHtml(nota.customerName)}</strong>
                        </td>
                    </tr>
                    <tr>
                        <td>Uang Sejumlah</td>
                        <td class="receipt-amount">${escapePrintHtml(fmtCurrency(amount))}</td>
                    </tr>
                    <tr>
                        <td>Terbilang</td>
                        <td class="receipt-words"># ${escapePrintHtml(amountInWords)} Rupiah #</td>
                    </tr>
                    <tr>
                        <td>Metode</td>
                        <td>${escapePrintHtml(paymentMethodLabel)}</td>
                    </tr>
                    <tr>
                        <td>Rekening / Kas</td>
                        <td>${escapePrintHtml(accountLabel)}</td>
                    </tr>
                    ${paymentNote ? `
                        <tr>
                            <td>Catatan</td>
                            <td>${escapePrintHtml(paymentNote)}</td>
                        </tr>
                    ` : ''}
                </tbody>
            </table>

            <div class="receipt-footer-grid">
                <div class="receipt-note">
                    Kwitansi ini adalah bukti penerimaan pembayaran untuk invoice terkait. Simpan bersama dokumen invoice dan mutasi kas/bank.
                </div>
                <div class="receipt-signature">
                    <div>${escapePrintHtml(issuerProfile.name)}</div>
                    <div class="receipt-stamp-box">Materai</div>
                    <div class="receipt-signature-name">Bagian Administrasi</div>
                </div>
            </div>
        </div>
    `;

    const extraStyles = `
        body { font-family: "Times New Roman", Arial, serif; padding: 5mm; color: #111827; background: #fff; max-width: 210mm; }
        .receipt-sheet { width: 190mm; min-height: 88mm; box-sizing: border-box; border: 1px solid #111827; padding: 3mm 4mm; font-size: 9.2px; line-height: 1.1; background: #fff; }
        .receipt-header { display: grid; grid-template-columns: 1fr 0.3fr; gap: 0.55rem; align-items: start; padding-bottom: 1.5mm; border-bottom: 2px solid #111827; margin-bottom: 2mm; }
        .receipt-brand { display: flex; align-items: flex-start; gap: 0.42rem; }
        .receipt-logo { width: 34px; height: 34px; object-fit: contain; }
        .receipt-company { font-size: 0.82rem; font-weight: 800; text-transform: uppercase; margin-bottom: 0.06rem; }
        .receipt-company-line { font-size: 0.62rem; }
        .receipt-title-box { border: 1px solid #111827; text-align: center; padding: 0.25rem 0.35rem; }
        .receipt-title { font-size: 0.95rem; font-weight: 800; letter-spacing: 0.08em; }
        .receipt-number { margin-top: 0.1rem; font-weight: 700; font-size: 0.72rem; }
        .receipt-main-table { width: 100%; border-collapse: collapse; }
        .receipt-main-table td { border: 1px solid #4b5563; padding: 0.12rem 0.25rem; vertical-align: top; }
        .receipt-main-table td:first-child { width: 28%; font-weight: 700; background: #f8fafc; }
        .receipt-muted { margin-top: 0.1rem; color: #374151; font-size: 0.9em; }
        .receipt-amount { font-size: 0.92rem; font-weight: 800; }
        .receipt-words { font-style: italic; font-weight: 700; }
        .receipt-footer-grid { display: grid; grid-template-columns: 1fr 0.26fr; gap: 0.55rem; margin-top: 2mm; align-items: start; }
        .receipt-note { border: 1px solid #4b5563; padding: 0.25rem 0.35rem; min-height: 22mm; color: #374151; }
        .receipt-signature { border: 1px solid #4b5563; padding: 0.25rem 0.35rem; text-align: center; min-height: 36mm; display: flex; flex-direction: column; justify-content: space-between; }
        .receipt-stamp-box { width: 4.5cm; height: 3.2cm; max-width: 100%; margin: 0.08rem auto; border: 1px dashed #6b7280; display: flex; align-items: center; justify-content: center; color: #6b7280; font-size: 0.68rem; }
        .receipt-signature-name { border-top: 1px solid #111827; padding-top: 0.25rem; font-weight: 700; text-transform: uppercase; }
        @page { size: A4 portrait; margin: 8mm; }
        @media print { body { padding: 0; } .receipt-sheet { page-break-inside: avoid; } }
    `;

    return {
        title: 'Kwitansi Pembayaran',
        subtitle: receiptNumber,
        bodyHtml,
        extraStyles,
        showCompanyHeader: false,
        showFooter: false,
    };
}

export const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
    }).format(n);

export const fmtNumber = (n: number) => new Intl.NumberFormat('id-ID').format(n);

export const fmtDate = (d: string) => {
    try {
        return formatBusinessDate(d, 'id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return d;
    }
};

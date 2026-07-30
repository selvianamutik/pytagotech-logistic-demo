"use client";

import { Printer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchAdminData, fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import {
  buildBalanceSheetFromLedger,
  buildLedgerSummary,
  buildProfitLossFromLedger,
  formatAccountingCurrency,
  getJournalLinesForPeriod,
  getJournalLinesUntil,
  type LedgerAccountSummary,
} from "@/lib/accounting-reports";
import {
  buildFinancePeriodLabel,
  FINANCE_PERIOD_MONTH_NAMES,
  getDefaultFinanceCustomDateFrom,
  getDefaultFinanceCustomDateTo,
  getDefaultFinancePeriod,
  getFinancePeriodDateRange,
  getFinancePeriodYearOptions,
  isFinancePeriodRangeReady,
  type FinancePeriodMode,
} from "@/lib/finance-period";
import { escapePrintHtml, openBrandedPrint } from "@/lib/print";
import { hasPermission } from "@/lib/rbac";
import type { AccountingPeriod, ChartOfAccount, CompanyProfile, JournalEntry, JournalLine } from "@/lib/types";
import { useApp, useToast } from "../../layout";

type StatementTab = "profit-loss" | "balance-sheet";
type PeriodMode = Exclude<FinancePeriodMode, "all">;
const JOURNAL_LINE_ENTRY_ID_BATCH_SIZE = 75;

const MONTH_NAMES = FINANCE_PERIOD_MONTH_NAMES;

function formatStatementDateLabel(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(value => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return dateValue;
  }
  return `${day} ${MONTH_NAMES[Math.max(month - 1, 0)] || String(month)} ${year}`;
}

function buildStatementRowsHtml(rows: LedgerAccountSummary[]) {
  if (rows.length === 0) {
    return `<tr class="statement-empty-row"><td colspan="2">Tidak ada data</td></tr>`;
  }
  return rows
    .map(row => `<tr>
      <td>${escapePrintHtml(row.account.code)} - ${escapePrintHtml(row.account.name)}</td>
      <td class="r amount">${escapePrintHtml(formatAccountingCurrency(row.balance))}</td>
    </tr>`)
    .join("");
}

function buildStatementSectionHtml(title: string, total: number, rows: LedgerAccountSummary[]) {
  return `
    <tr class="statement-section-row">
      <td>${escapePrintHtml(title)}</td>
      <td class="r amount">${escapePrintHtml(formatAccountingCurrency(total))}</td>
    </tr>
    ${buildStatementRowsHtml(rows)}
  `;
}

function buildBalanceSheetPanelHtml(
  title: string,
  total: number,
  sections: Array<{ title?: string; total?: number; rows?: LedgerAccountSummary[]; lineLabel?: string; lineValue?: number }>,
) {
  return `
    <section class="balance-panel">
      <div class="balance-panel-title">
        <span>${escapePrintHtml(title)}</span>
        <strong>${escapePrintHtml(formatAccountingCurrency(total))}</strong>
      </div>
      <table class="balance-table">
        <tbody>
          ${sections.map(section => {
            if (section.lineLabel) {
              return `<tr>
                <td>${escapePrintHtml(section.lineLabel)}</td>
                <td class="r amount">${escapePrintHtml(formatAccountingCurrency(section.lineValue || 0))}</td>
              </tr>`;
            }

            return `
              <tr class="balance-section-row">
                <td>${escapePrintHtml(section.title || "")}</td>
                <td class="r amount">${escapePrintHtml(formatAccountingCurrency(section.total || 0))}</td>
              </tr>
              ${buildStatementRowsHtml(section.rows || [])}
            `;
          }).join("")}
        </tbody>
        <tfoot>
          <tr>
            <td>Total ${escapePrintHtml(title)}</td>
            <td class="r amount">${escapePrintHtml(formatAccountingCurrency(total))}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
}

function buildStatementMetaHtml(items: Array<{ label: string; value: string }>) {
  return `
    <div class="statement-meta-grid">
      ${items.map(item => `
        <div class="statement-meta-item">
          <div>${escapePrintHtml(item.label)}</div>
          <strong>${escapePrintHtml(item.value)}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function buildSummaryBoxHtml(label: string, value: number, tone: "neutral" | "success" | "danger" = "neutral") {
  return `
    <div class="stat-box statement-stat-box">
      <div class="stat-label">${escapePrintHtml(label)}</div>
      <div class="stat-value ${tone === "success" ? "s" : tone === "danger" ? "d" : ""}">
        ${escapePrintHtml(formatAccountingCurrency(value))}
      </div>
    </div>
  `;
}

const accountingStatementPrintStyles = `
  @page { size: A4; margin: 12mm; }
  body { max-width: none; font-size: 12px; color: #0f172a; }
  .print-header { margin-bottom: 1rem; padding-bottom: 0.75rem; }
  .print-footer { margin-top: 1rem; }
  .statement-print { margin-top: 0.25rem; }
  .statement-meta-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
    margin-bottom: 0.75rem;
  }
  .statement-meta-item {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 0.5rem 0.6rem;
    background: #f8fafc;
  }
  .statement-meta-item div {
    color: #64748b;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 0.15rem;
  }
  .statement-meta-item strong { font-size: 0.85rem; }
  .stats-row.statement-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.55rem;
    margin: 0 0 0.85rem;
  }
  .statement-stat-box {
    min-height: 58px;
    text-align: left;
    padding: 0.55rem 0.65rem;
    border-radius: 6px;
    background: #ffffff;
  }
  .statement-stat-box .stat-value {
    font-size: 1.05rem;
    line-height: 1.2;
    white-space: nowrap;
  }
  .statement-table {
    margin-top: 0;
    border: 1px solid #cbd5e1;
    table-layout: fixed;
  }
  .statement-table th,
  .statement-table td {
    padding: 0.48rem 0.6rem;
    vertical-align: top;
  }
  .statement-table th:first-child,
  .statement-table td:first-child { width: 68%; }
  .statement-table th:last-child,
  .statement-table td:last-child { width: 32%; }
  .statement-section-row td {
    background: #f1f5f9;
    font-weight: 800;
    color: #0f172a;
    border-top: 1px solid #cbd5e1;
  }
  .statement-empty-row td {
    color: #94a3b8;
    font-style: italic;
  }
  .statement-total-row td {
    background: #e2e8f0;
    border-top: 2px solid #0f172a;
    font-weight: 900;
    font-size: 0.9rem;
  }
  .balance-sheet-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    align-items: start;
  }
  .balance-panel {
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    overflow: hidden;
    background: #ffffff;
  }
  .balance-panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.62rem 0.7rem;
    background: #0f172a;
    color: #ffffff;
    font-weight: 900;
  }
  .balance-panel-title strong { white-space: nowrap; }
  .balance-table {
    margin: 0;
    border: 0;
    table-layout: fixed;
  }
  .balance-table td {
    padding: 0.46rem 0.6rem;
    vertical-align: top;
  }
  .balance-table td:first-child { width: 62%; }
  .balance-table td:last-child { width: 38%; }
  .balance-section-row td {
    background: #f1f5f9;
    font-weight: 800;
    color: #0f172a;
    border-top: 1px solid #cbd5e1;
  }
  .balance-table tfoot td {
    background: #e2e8f0;
    border-top: 2px solid #0f172a;
    font-weight: 900;
    font-size: 0.9rem;
  }
  .balance-check-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.75rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    background: #f8fafc;
    font-weight: 800;
  }
  .amount {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  @media print {
    body { padding: 0; }
    .statement-meta-item,
    .statement-stat-box,
    .balance-panel,
    .balance-check-row,
    .statement-table tr { break-inside: avoid; page-break-inside: avoid; }
    .statement-section-row { break-after: avoid; page-break-after: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

function buildAccountingPeriodKey(periodMode: PeriodMode, month: number, year: number) {
  if (periodMode === "custom") return "";
  if (periodMode === "year") return `YEAR-${year}`;
  return `MONTH-${year}-${String(month + 1).padStart(2, "0")}`;
}

function buildAccountingEntryUrl(endDate: string) {
  const params = new URLSearchParams({
    entity: "journal-entries",
    sortField: "entryDate",
    sortDir: "asc",
    filter: JSON.stringify({ entryDate: { lte: endDate } }),
  });
  return `/api/data?${params.toString()}`;
}

function buildJournalLinesUrl(entryIds: string[]) {
  const params = new URLSearchParams({
    entity: "journal-lines",
    sortField: "lineNumber",
    sortDir: "asc",
    filter: JSON.stringify({ journalEntryRef: entryIds }),
  });
  return `/api/data?${params.toString()}`;
}

async function fetchJournalLinesByEntryIds(entryIds: string[]) {
  if (entryIds.length === 0) return [];

  const batches: string[][] = [];
  for (let index = 0; index < entryIds.length; index += JOURNAL_LINE_ENTRY_ID_BATCH_SIZE) {
    batches.push(entryIds.slice(index, index + JOURNAL_LINE_ENTRY_ID_BATCH_SIZE));
  }

  const batchRows = await Promise.all(
    batches.map(batch =>
      fetchAllAdminCollectionData<JournalLine>(
        buildJournalLinesUrl(batch),
        "Gagal memuat detail jurnal",
      )
    )
  );

  return batchRows.flat();
}

function buildAccountingPeriodUrl(periodKey: string) {
  const params = new URLSearchParams({
    entity: "accounting-periods",
    filter: JSON.stringify({ period: periodKey }),
  });
  return `/api/data?${params.toString()}`;
}

export default function AccountingStatementsPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const defaultPeriod = useMemo(() => getDefaultFinancePeriod(), []);
  const [tab, setTab] = useState<StatementTab>("profit-loss");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [year, setYear] = useState(defaultPeriod.year);
  const [month, setMonth] = useState(defaultPeriod.monthIndex);
  const [dateFrom, setDateFrom] = useState(getDefaultFinanceCustomDateFrom());
  const [dateTo, setDateTo] = useState(getDefaultFinanceCustomDateTo());
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [accountingPeriod, setAccountingPeriod] = useState<AccountingPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodSaving, setPeriodSaving] = useState(false);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([...getFinancePeriodYearOptions(year), defaultPeriod.year, year]);
    entries.forEach(entry => {
      const parsed = Number(String(entry.entryDate || "").slice(0, 4));
      if (Number.isFinite(parsed)) years.add(parsed);
    });
    return [...years].sort((left, right) => right - left);
  }, [defaultPeriod.year, entries, year]);

  const period = useMemo(
    () => getFinancePeriodDateRange({ mode: periodMode, monthIndex: month, year, dateFrom, dateTo }),
    [dateFrom, dateTo, month, periodMode, year],
  );
  const isPeriodReady = isFinancePeriodRangeReady(periodMode, period.startDate, period.endDate);
  const periodKey = useMemo(() => buildAccountingPeriodKey(periodMode, month, year), [month, periodMode, year]);
  const canManagePeriod = user ? hasPermission(user, "reports", "update") : false;
  const periodLabel = useMemo(
    () => buildFinancePeriodLabel({ mode: periodMode, monthIndex: month, year, startDate: period.startDate, endDate: period.endDate }),
    [month, period.endDate, period.startDate, periodMode, year],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!isPeriodReady) {
        setEntries([]);
        setLines([]);
        setAccountingPeriod(null);
        return;
      }

      const [accountRows, entryRows, companyProfile, periodRows] = await Promise.all([
        fetchAllAdminCollectionData<ChartOfAccount>(
          "/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc",
          "Gagal memuat akun perkiraan",
        ),
        fetchAllAdminCollectionData<JournalEntry>(
          buildAccountingEntryUrl(period.endDate),
          "Gagal memuat jurnal",
        ),
        fetchAdminData<CompanyProfile | null>("/api/data?entity=company", "Gagal memuat profil perusahaan").catch(() => null),
        periodKey
          ? fetchAllAdminCollectionData<AccountingPeriod>(
            buildAccountingPeriodUrl(periodKey),
            "Gagal memuat status periode",
          ).catch(() => [])
          : Promise.resolve([]),
      ]);
      const postedEntries = (entryRows || []).filter(entry => entry.status !== "VOID");
      const entryIds = postedEntries.map(entry => entry._id).filter(Boolean);
      const lineRows = await fetchJournalLinesByEntryIds(entryIds);

      setAccounts(accountRows || []);
      setEntries(postedEntries);
      setLines(lineRows || []);
      setCompany(companyProfile || null);
      setAccountingPeriod((periodRows || [])[0] || null);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Gagal memuat laporan keuangan");
    } finally {
      setLoading(false);
    }
  }, [addToast, isPeriodReady, period.endDate, periodKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLines = useMemo(
    () => isPeriodReady ? getJournalLinesForPeriod(entries, lines, period.startDate, period.endDate) : [],
    [entries, isPeriodReady, lines, period.endDate, period.startDate],
  );

  const cumulativeLines = useMemo(
    () => isPeriodReady ? getJournalLinesUntil(entries, lines, period.endDate) : [],
    [entries, isPeriodReady, lines, period.endDate],
  );

  const pnlSummaries = useMemo(() => buildLedgerSummary(accounts, periodLines), [accounts, periodLines]);
  const balanceSummaries = useMemo(() => buildLedgerSummary(accounts, cumulativeLines), [accounts, cumulativeLines]);
  const profitLoss = useMemo(() => buildProfitLossFromLedger(pnlSummaries), [pnlSummaries]);
  const balanceSheet = useMemo(() => buildBalanceSheetFromLedger(balanceSummaries), [balanceSummaries]);

  const revenueRows = pnlSummaries.filter(row => row.account.accountType === "REVENUE" && row.balance !== 0);
  const deductionRows = pnlSummaries.filter(row => row.account.accountType === "CONTRA_REVENUE" && row.balance !== 0);
  const expenseRows = pnlSummaries.filter(row => row.account.accountType === "EXPENSE" && row.balance !== 0);
  const assetRows = balanceSummaries.filter(row => row.account.accountType === "ASSET" && row.balance !== 0);
  const liabilityRows = balanceSummaries.filter(row => row.account.accountType === "LIABILITY" && row.balance !== 0);
  const equityRows = balanceSummaries.filter(row => row.account.accountType === "EQUITY" && row.balance !== 0);
  const isCurrentPeriodClosed = accountingPeriod?.status === "CLOSED";

  const handleTogglePeriodLock = async () => {
    if (!periodKey || !isPeriodReady) {
      addToast("error", "Periode custom belum bisa dikunci. Pilih bulanan atau tahunan.");
      return;
    }
    setPeriodSaving(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "accounting-periods",
          action: isCurrentPeriodClosed ? "open-period" : "close-period",
          data: {
            period: periodKey,
            startDate: period.startDate,
            endDate: period.endDate,
          },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        addToast("error", payload.error || "Gagal mengubah status periode");
        return;
      }
      addToast("success", isCurrentPeriodClosed ? "Periode dibuka kembali" : "Periode dikunci");
      await load();
    } catch {
      addToast("error", "Gagal mengubah status periode");
    } finally {
      setPeriodSaving(false);
    }
  };

  const handlePrint = () => {
    if (!isPeriodReady) {
      addToast("error", "Rentang tanggal belum valid");
      return;
    }
    const isProfitLoss = tab === "profit-loss";
    const statementTitle = isProfitLoss ? "Laporan Laba Rugi" : "Neraca";
    const statementSubtitle = isProfitLoss ? periodLabel : `Per ${formatStatementDateLabel(period.endDate)}`;
    const bodyHtml = isProfitLoss
      ? `
        <div class="statement-print">
          ${buildStatementMetaHtml([
            { label: "Jenis Laporan", value: "Laba Rugi" },
            { label: "Periode", value: periodLabel },
            { label: "Rentang Tanggal", value: `${formatStatementDateLabel(period.startDate)} - ${formatStatementDateLabel(period.endDate)}` },
          ])}
          <div class="stats-row statement-summary">
            ${buildSummaryBoxHtml("Pendapatan Bersih", profitLoss.netRevenue, "success")}
            ${buildSummaryBoxHtml("Total Beban", profitLoss.expenses, "danger")}
            ${buildSummaryBoxHtml("Laba / Rugi", profitLoss.netProfit, profitLoss.netProfit >= 0 ? "success" : "danger")}
          </div>
          <table class="statement-table">
            <thead>
              <tr><th>Akun</th><th class="r">Nilai</th></tr>
            </thead>
            <tbody>
              ${buildStatementSectionHtml("Pendapatan", profitLoss.revenue, revenueRows)}
              ${buildStatementSectionHtml("Potongan / Klaim", profitLoss.deductions, deductionRows)}
              ${buildStatementSectionHtml("Beban", profitLoss.expenses, expenseRows)}
              <tr class="statement-total-row">
                <td>Laba / Rugi Bersih</td>
                <td class="r amount">${escapePrintHtml(formatAccountingCurrency(profitLoss.netProfit))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `
      : `
        <div class="statement-print">
          ${buildStatementMetaHtml([
            { label: "Jenis Laporan", value: "Neraca" },
            { label: "Posisi", value: formatStatementDateLabel(period.endDate) },
            { label: "Mode Periode", value: periodMode === "year" ? "Tahunan" : periodMode === "custom" ? "Rentang Tanggal" : "Bulanan" },
          ])}
          <div class="stats-row statement-summary">
            ${buildSummaryBoxHtml("Total Aktiva", balanceSheet.assets, "success")}
            ${buildSummaryBoxHtml("Total Pasiva", balanceSheet.liabilitiesAndEquity, "success")}
            ${buildSummaryBoxHtml("Selisih", balanceSheet.balanceGap, Math.abs(balanceSheet.balanceGap) <= 0.01 ? "success" : "danger")}
          </div>
          <div class="balance-sheet-grid">
            ${buildBalanceSheetPanelHtml("Aktiva", balanceSheet.assets, [
              { title: "Aktiva", total: balanceSheet.assets, rows: assetRows },
            ])}
            ${buildBalanceSheetPanelHtml("Pasiva", balanceSheet.liabilitiesAndEquity, [
              { title: "Hutang", total: balanceSheet.liabilities, rows: liabilityRows },
              { title: "Modal", total: balanceSheet.equity, rows: equityRows },
              { lineLabel: "Laba Tahun Berjalan", lineValue: balanceSheet.currentEarnings },
            ])}
          </div>
          <div class="balance-check-row">
            <span>Status Neraca</span>
            <span class="amount ${Math.abs(balanceSheet.balanceGap) <= 0.01 ? "s" : "d"}">
              ${Math.abs(balanceSheet.balanceGap) <= 0.01 ? "Seimbang" : `Selisih ${escapePrintHtml(formatAccountingCurrency(balanceSheet.balanceGap))}`}
            </span>
          </div>
        </div>
      `;

    openBrandedPrint({
      title: statementTitle,
      subtitle: statementSubtitle,
      company,
      bodyHtml,
      extraStyles: accountingStatementPrintStyles,
    });
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 260 }} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Laporan Keuangan</h1>
        </div>
        <div className="page-actions">
          {canManagePeriod && periodKey && (
            <button
              className={`btn ${isCurrentPeriodClosed ? "btn-secondary" : "btn-primary"} btn-sm`}
              onClick={handleTogglePeriodLock}
              disabled={periodSaving || !isPeriodReady}
            >
              {periodSaving
                ? "Memproses..."
                : isCurrentPeriodClosed
                  ? "Buka Periode"
                  : "Kunci Periode"}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handlePrint}>
            <Printer size={15} /> Print
          </button>
        </div>
      </div>
      {isCurrentPeriodClosed && (
        <div className="info-banner" style={{ marginBottom: "1rem" }}>
          <div className="info-banner-text">Periode {periodLabel} sedang dikunci. Revisi transaksi pada tanggal ini akan ditolak sampai periode dibuka kembali.</div>
        </div>
      )}

      <div className="page-toolbar">
        <div className="page-toolbar-main">
          <div className="segmented-tabs" aria-label="Jenis laporan">
            <button
              className={`segmented-tab ${tab === "profit-loss" ? "active" : ""}`}
              onClick={() => setTab("profit-loss")}
            >
              Laba Rugi
            </button>
            <button
              className={`segmented-tab ${tab === "balance-sheet" ? "active" : ""}`}
              onClick={() => setTab("balance-sheet")}
            >
              Neraca
            </button>
          </div>
        </div>
        <div className="page-toolbar-side">
          <div className="period-controls">
            <select className="form-select accounting-period-filter" value={periodMode} onChange={event => setPeriodMode(event.target.value as PeriodMode)}>
              <option value="month">Bulanan</option>
              <option value="year">Tahunan</option>
              <option value="custom">Rentang Tanggal</option>
            </select>
            {periodMode === "month" && (
              <select className="form-select accounting-period-filter" value={month} onChange={event => setMonth(Number(event.target.value))}>
                {MONTH_NAMES.map((name, index) => (
                  <option key={name} value={index}>{name}</option>
                ))}
              </select>
            )}
            {periodMode !== "custom" && (
              <select className="form-select accounting-period-filter" value={year} onChange={event => setYear(Number(event.target.value))}>
                {yearOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            )}
            {periodMode === "custom" && (
              <>
                <input className="form-input accounting-period-filter" type="date" value={dateFrom} onInput={event => setDateFrom(event.currentTarget.value)} onChange={event => setDateFrom(event.target.value)} />
                <input className="form-input accounting-period-filter" type="date" value={dateTo} onInput={event => setDateTo(event.currentTarget.value)} onChange={event => setDateTo(event.target.value)} />
              </>
            )}
          </div>
        </div>
      </div>
      {!isPeriodReady && (
        <div className="info-banner" style={{ marginBottom: "1rem" }}>
          <div className="info-banner-text">Lengkapi tanggal awal dan akhir, lalu pastikan tanggal awal tidak melebihi tanggal akhir.</div>
        </div>
      )}

      {tab === "profit-loss" ? (
        <div>
          <div className="kpi-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Pendapatan Bersih</p>
                <p className="kpi-value">{formatAccountingCurrency(profitLoss.netRevenue)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Total Beban</p>
                <p className="kpi-value">{formatAccountingCurrency(profitLoss.expenses)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Laba / Rugi</p>
                <p className="kpi-value">{formatAccountingCurrency(profitLoss.netProfit)}</p>
              </div>
            </div>
          </div>

          <div className="table-container">
            <div className="card-header">
              <span className="card-header-title">Laba Rugi {periodLabel}</span>
            </div>
            <StatementTable rows={revenueRows} title="Pendapatan" total={profitLoss.revenue} />
            <StatementTable rows={deductionRows} title="Potongan / Klaim" total={profitLoss.deductions} />
            <StatementTable rows={expenseRows} title="Beban" total={profitLoss.expenses} />
            <div className="statement-total-row">
              <span>Laba / Rugi Bersih</span>
              <strong>{formatAccountingCurrency(profitLoss.netProfit)}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="kpi-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Total Aktiva</p>
                <p className="kpi-value">{formatAccountingCurrency(balanceSheet.assets)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Total Pasiva</p>
                <p className="kpi-value">{formatAccountingCurrency(balanceSheet.liabilitiesAndEquity)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Selisih Neraca</p>
                <p className="kpi-value">{formatAccountingCurrency(balanceSheet.balanceGap)}</p>
              </div>
            </div>
          </div>

          <div className="table-container">
            <div className="card-header">
              <span className="card-header-title">Neraca per {period.endDate}</span>
            </div>
            <StatementTable rows={assetRows} title="Aktiva" total={balanceSheet.assets} />
            <StatementTable rows={liabilityRows} title="Hutang" total={balanceSheet.liabilities} />
            <StatementTable rows={equityRows} title="Modal" total={balanceSheet.equity} />
            <div className="statement-line-row">
              <span>Laba Tahun Berjalan</span>
              <strong>{formatAccountingCurrency(balanceSheet.currentEarnings)}</strong>
            </div>
            <div className="statement-total-row">
              <span>Total Pasiva</span>
              <strong>{formatAccountingCurrency(balanceSheet.liabilitiesAndEquity)}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementTable({ rows, title, total }: { rows: LedgerAccountSummary[]; title: string; total: number }) {
  return (
    <section className="statement-section">
      <div className="statement-total-row statement-section-title">
        <span>{title}</span>
        <strong>{formatAccountingCurrency(total)}</strong>
      </div>
      {rows.length === 0 ? (
        <div className="statement-empty">Tidak ada data</div>
      ) : (
        rows.map(row => (
          <div key={row.account._id} className="statement-line-row">
            <span>{row.account.code} - {row.account.name}</span>
            <strong>{formatAccountingCurrency(row.balance)}</strong>
          </div>
        ))
      )}
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import Combobox from "@/components/Combobox";
import {
  buildBalanceSheetFromLedger,
  buildJournalLineLookup,
  buildLedgerSummary,
  buildProfitLossFromLedger,
  formatAccountingCurrency,
  getJournalLinesForPeriod,
  getJournalLinesUntil,
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
import type { ChartOfAccount, JournalEntry, JournalLine } from "@/lib/types";
import { resolveJournalSourceLink } from "@/lib/journal-source-links";
import { hasPageAccess } from "@/lib/rbac";
import { useApp } from "../../layout";

type LedgerPeriodMode = Exclude<FinancePeriodMode, "all">;
const JOURNAL_LINE_ENTRY_ID_BATCH_SIZE = 75;

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

export default function LedgerPage() {
  const { user } = useApp();
  const defaultPeriod = useMemo(() => getDefaultFinancePeriod(), []);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [periodMode, setPeriodMode] = useState<LedgerPeriodMode>("year");
  const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
  const [year, setYear] = useState(defaultPeriod.year);
  const [dateFrom, setDateFrom] = useState(getDefaultFinanceCustomDateFrom());
  const [dateTo, setDateTo] = useState(getDefaultFinanceCustomDateTo());
  const [loading, setLoading] = useState(true);

  const journalSourcePermissions = {
    canOpenInvoices: user ? hasPageAccess(user, "invoices") : false,
    canOpenExpenses: user ? hasPageAccess(user, "expenses") : false,
    canOpenDriverVouchers: user ? hasPageAccess(user, "driverVouchers") : false,
    canOpenPurchases: user ? hasPageAccess(user, "purchases") : false,
    canOpenBankAccounts: user ? hasPageAccess(user, "bankAccounts") : false,
    canOpenWarehouseItems: user ? hasPageAccess(user, "warehouseItems") : false,
  };

  const yearOptions = useMemo(() => {
    const years = new Set<number>([...getFinancePeriodYearOptions(year), year]);
    entries.forEach(entry => {
      const parsed = Number(String(entry.entryDate || "").slice(0, 4));
      if (Number.isFinite(parsed)) years.add(parsed);
    });
    return [...years].sort((left, right) => right - left);
  }, [entries, year]);

  const period = useMemo(
    () => getFinancePeriodDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
    [dateFrom, dateTo, monthIndex, periodMode, year],
  );
  const isPeriodReady = isFinancePeriodRangeReady(periodMode, period.startDate, period.endDate);
  const periodLabel = useMemo(
    () => buildFinancePeriodLabel({ mode: periodMode, monthIndex, year, startDate: period.startDate, endDate: period.endDate }),
    [monthIndex, period.endDate, period.startDate, periodMode, year],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!isPeriodReady) {
        setEntries([]);
        setLines([]);
        return;
      }
      const [accountRows, entryRows] = await Promise.all([
        fetchAllAdminCollectionData<ChartOfAccount>(
          "/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc",
          "Gagal memuat akun",
        ),
        fetchAllAdminCollectionData<JournalEntry>(
          buildAccountingEntryUrl(period.endDate),
          "Gagal memuat jurnal",
        ),
      ]);
      const postedEntries = (entryRows || []).filter(entry => entry.status !== "VOID");
      const entryIds = postedEntries.map(entry => entry._id).filter(Boolean);
      const lineRows = await fetchJournalLinesByEntryIds(entryIds);
      setAccounts(accountRows || []);
      setEntries(postedEntries);
      setLines(lineRows || []);
    } finally {
      setLoading(false);
    }
  }, [isPeriodReady, period.endDate]);

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

  const periodSummaries = useMemo(() => buildLedgerSummary(accounts, periodLines), [accounts, periodLines]);
  const balanceSummaries = useMemo(() => buildLedgerSummary(accounts, cumulativeLines), [accounts, cumulativeLines]);

  const pnl = useMemo(() => buildProfitLossFromLedger(periodSummaries), [periodSummaries]);
  const balanceSheet = useMemo(() => buildBalanceSheetFromLedger(balanceSummaries), [balanceSummaries]);
  const recentLedgerLines = useMemo(
    () => buildJournalLineLookup(entries, periodLines)
      .sort((left, right) =>
        String(right.entryDate || "").localeCompare(String(left.entryDate || "")) ||
        String(right.entryNumber || "").localeCompare(String(left.entryNumber || "")) ||
        Number(left.lineNumber || 0) - Number(right.lineNumber || 0),
      )
      .slice(0, 40),
    [entries, periodLines],
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Buku Besar</h1>
        </div>
      </div>

      <div className="page-toolbar">
        <div className="page-toolbar-main">
          <span className="period-label-pill">{periodLabel}</span>
        </div>
        <div className="page-toolbar-side">
          <div className="period-controls">
            <Combobox className="form-select accounting-period-filter" value={periodMode} onChange={(v: string) => setPeriodMode(v as LedgerPeriodMode)} options={[{ value: 'month', label: 'Bulanan' }, { value: 'year', label: 'Tahunan' }, { value: 'custom', label: 'Rentang Tanggal' }]} />
            {periodMode === "month" && (
              <Combobox className="form-select accounting-period-filter" value={String(monthIndex)} onChange={(v: string) => setMonthIndex(Number(v))} options={FINANCE_PERIOD_MONTH_NAMES.map((name, index) => ({ value: String(index), label: name }))} />
            )}
            {periodMode !== "custom" && (
              <Combobox className="form-select accounting-period-filter" value={String(year)} onChange={(v: string) => setYear(Number(v))} options={yearOptions.map(option => ({ value: String(option), label: String(option) }))} />
            )}
            {periodMode === "custom" && (
              <>
                <input className="form-input accounting-period-filter" type="date" value={dateFrom} onInput={(event) => setDateFrom(event.currentTarget.value)} onChange={(event) => setDateFrom(event.target.value)} />
                <input className="form-input accounting-period-filter" type="date" value={dateTo} onInput={(event) => setDateTo(event.currentTarget.value)} onChange={(event) => setDateTo(event.target.value)} />
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

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Pendapatan Bersih</p>
            <p className="kpi-value">{formatAccountingCurrency(pnl.netRevenue)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Total Beban</p>
            <p className="kpi-value">{formatAccountingCurrency(pnl.expenses)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Laba / Rugi</p>
            <p className="kpi-value">{formatAccountingCurrency(pnl.netProfit)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Selisih Neraca per {period.endDate || "-"}</p>
            <p className="kpi-value" style={{ color: Math.abs(balanceSheet.balanceGap) > 0.01 ? "var(--color-danger)" : "var(--color-success)" }}>
              {formatAccountingCurrency(balanceSheet.balanceGap)}
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <h2 className="card-header-title">Mutasi Akun {periodLabel}</h2>
        </div>
        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr>
                <th>Akun</th>
                <th>Tipe</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Kredit</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {periodSummaries.map(summary => (
                <tr key={summary.account._id}>
                  <td style={{ fontWeight: 700 }}>{summary.account.code} - {summary.account.name}</td>
                  <td>{summary.account.accountType}</td>
                  <td style={{ textAlign: "right" }}>{formatAccountingCurrency(summary.debit)}</td>
                  <td style={{ textAlign: "right" }}>{formatAccountingCurrency(summary.credit)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{formatAccountingCurrency(summary.balance)}</td>
                </tr>
              ))}
              {!loading && periodSummaries.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Belum ada mutasi jurnal.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mobile-record-list">
          {periodSummaries.map(summary => (
            <article key={summary.account._id} className="mobile-record-card">
              <div>
                <p className="mobile-record-title">{summary.account.code} - {summary.account.name}</p>
                <p className="mobile-record-subtitle">{summary.account.accountType}</p>
              </div>
              <strong>{formatAccountingCurrency(summary.balance)}</strong>
            </article>
          ))}
          {!loading && periodSummaries.length === 0 && (
            <article className="mobile-record-card">
              <p className="mobile-record-title">Belum ada mutasi jurnal.</p>
            </article>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <h2 className="card-header-title">Mutasi Terakhir</h2>
        </div>
        <div className="table-wrapper table-desktop-only">
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Jurnal</th>
                <th>Akun</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Kredit</th>
              </tr>
            </thead>
            <tbody>
              {recentLedgerLines.map(line => {
                const sourceLink = resolveJournalSourceLink(line, journalSourcePermissions);
                return (
                  <tr key={line._id}>
                    <td>{line.entryDate || "-"}</td>
                    <td>
                      {line.entryNumber || "-"}
                      {sourceLink && (
                        <div style={{ fontSize: "0.75rem" }}>
                          <Link href={sourceLink.href} style={{ color: "var(--color-primary)", fontWeight: 600 }}>{line.sourceNumber || sourceLink.label}</Link>
                        </div>
                      )}
                    </td>
                    <td>{line.accountCode} - {line.accountName}</td>
                    <td style={{ textAlign: "right" }}>{line.debit ? formatAccountingCurrency(line.debit) : "-"}</td>
                    <td style={{ textAlign: "right" }}>{line.credit ? formatAccountingCurrency(line.credit) : "-"}</td>
                  </tr>
                );
              })}
              {!loading && recentLedgerLines.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Belum ada mutasi jurnal.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-record-list" style={{ padding: "var(--space-3)" }}>
          {recentLedgerLines.map(line => {
            const sourceLink = resolveJournalSourceLink(line, journalSourcePermissions);
            return (
              <article key={line._id} className="mobile-record-card">
                <div className="mobile-record-header">
                  <div>
                    <p className="mobile-record-title">{line.entryNumber || "-"}</p>
                    <p className="mobile-record-subtitle">{line.entryDate || "-"}</p>
                    {sourceLink && (
                      <Link href={sourceLink.href} style={{ color: "var(--color-primary)", fontWeight: 600, fontSize: "0.8rem" }}>{line.sourceNumber || sourceLink.label}</Link>
                    )}
                  </div>
                </div>
                <div className="mobile-record-meta">
                  <div className="mobile-record-kv">
                    <span className="mobile-record-label">Akun</span>
                    <span className="mobile-record-value">{line.accountCode} - {line.accountName}</span>
                  </div>
                  <div className="mobile-record-kv">
                    <span className="mobile-record-label">Debit</span>
                    <span className="mobile-record-value">{line.debit ? formatAccountingCurrency(line.debit) : "-"}</span>
                  </div>
                  <div className="mobile-record-kv">
                    <span className="mobile-record-label">Kredit</span>
                    <span className="mobile-record-value">{line.credit ? formatAccountingCurrency(line.credit) : "-"}</span>
                  </div>
                </div>
              </article>
            );
          })}
          {!loading && recentLedgerLines.length === 0 && (
            <article className="mobile-record-card">
              <p className="mobile-record-title">Belum ada mutasi jurnal.</p>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

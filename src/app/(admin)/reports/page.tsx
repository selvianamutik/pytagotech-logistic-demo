"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileDown,
  Landmark,
  Printer,
} from "lucide-react";
import { useApp, useToast } from "../layout";
import { openBrandedPrint } from "@/lib/print";
import { fetchAdminData, fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import {
  buildExpenseLookup,
  buildCustomerReceiptLookup,
  buildPaymentLookup,
  buildPurchaseLookup,
  buildRefundLookup,
  resolveBankTransactionSourceLink,
} from "@/lib/bank-transaction-links";
import {
  formatBusinessDate,
  getBusinessCalendarDateParts,
  getBusinessDateValue,
} from "@/lib/business-date";
import {
  buildCashflowExportRows,
  buildPeriodLabel,
  buildProfitLossExportRows,
  buildReportsSnapshot,
  resolveBankTransactionAccountName,
  type ReportPeriodMode,
} from "@/lib/reports-support";
import {
  formatCurrency,
  formatDate,
  getDriverVoucherFinancialSummary,
} from "@/lib/utils";
import { buildDriverVoucherSettlementDisplay, inferDriverVoucherDisbursementCount } from "@/lib/driver-voucher-detail-support";
import { exportToExcel } from "@/lib/export";
import { parseFormattedNumberish } from "@/components/FormattedNumberInput.helpers";
import type {
  BankAccount,
  BankTransaction,
  CompanyProfile,
  CustomerReceipt,
  CustomerOverpaymentRefund,
  DriverVoucher,
  Expense,
  FreightNota,
  Payment,
  Purchase,
} from "@/lib/types";
import { hasPageAccess } from "@/lib/rbac";

type Tab = "pnl" | "cashflow";

function extractYearFromDate(value: unknown) {
  if (typeof value !== "string" || value.length < 4) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export default function ReportsPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("pnl");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customerReceipts, setCustomerReceipts] = useState<CustomerReceipt[]>([]);
  const [overpaymentRefunds, setOverpaymentRefunds] = useState<CustomerOverpaymentRefund[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [freightNotas, setFreightNotas] = useState<FreightNota[]>([]);
  const [driverVouchers, setDriverVouchers] = useState<DriverVoucher[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allBankAccounts, setAllBankAccounts] = useState<BankAccount[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>(
    [],
  );
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const canOpenBankAccounts = user ? hasPageAccess(user, "bankAccounts") : false;
  const canOpenInvoices = user ? hasPageAccess(user, "invoices") : false;
  const canOpenDriverVouchers = user ? hasPageAccess(user, "driverVouchers") : false;
  const canOpenDriverBorongans = user ? hasPageAccess(user, "driverBorongans") : false;
  const canOpenVehicles = user ? hasPageAccess(user, "vehicles") : false;
  const canOpenIncidents = user ? hasPageAccess(user, "incidents") : false;
  const canOpenPurchases = user ? hasPageAccess(user, "purchases") : false;

  const businessToday = getBusinessCalendarDateParts() || {
    year: String(new Date().getFullYear()),
    month: String(new Date().getMonth() + 1).padStart(2, "0"),
    day: "01",
  };
  const defaultBusinessYear = Number(businessToday.year);
  const defaultBusinessMonthIndex = Math.max(
    Number(businessToday.month) - 1,
    0,
  );
  const [month, setMonth] = useState(defaultBusinessMonthIndex);
  const [year, setYear] = useState(defaultBusinessYear);
  const [periodMode, setPeriodMode] = useState<ReportPeriodMode>("month");
  const [dateFrom, setDateFrom] = useState(`${defaultBusinessYear}-${String(defaultBusinessMonthIndex + 1).padStart(2, "0")}-01`);
  const [dateTo, setDateTo] = useState(getBusinessDateValue());
  const monthNames = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const yearOptions = useMemo(() => {
    const years = [
      defaultBusinessYear,
      year,
      ...payments.map(item => extractYearFromDate(item.date)),
      ...customerReceipts.map(item => extractYearFromDate(item.date)),
      ...overpaymentRefunds.map(item => extractYearFromDate(item.date)),
      ...expenses.map(item => extractYearFromDate(item.date)),
      ...purchases.map(item => extractYearFromDate(item.orderDate)),
      ...freightNotas.map(item => extractYearFromDate(item.issueDate)),
      ...driverVouchers.map(item => extractYearFromDate(item.issuedDate)),
      ...bankTransactions.map(item => extractYearFromDate(item.date)),
    ].filter((item): item is number => typeof item === "number");
    const minYear = Math.min(...years) - 1;
    const maxYear = Math.max(...years) + 1;
    return Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index);
  }, [
    bankTransactions,
    customerReceipts,
    defaultBusinessYear,
    driverVouchers,
    expenses,
    freightNotas,
    overpaymentRefunds,
    payments,
    purchases,
    year,
  ]);

  useEffect(() => {
    async function loadReportData() {
      try {
        const [pay, receipts, refunds, exp, purchaseRows, nota, vouchers, banks, txs, companyProfile] =
          await Promise.all([
            fetchAllAdminCollectionData<Payment>("/api/data?entity=payments", "Gagal memuat payments"),
            fetchAllAdminCollectionData<CustomerReceipt>("/api/data?entity=customer-receipts", "Gagal memuat penerimaan customer"),
            fetchAllAdminCollectionData<CustomerOverpaymentRefund>("/api/data?entity=customer-overpayment-refunds", "Gagal memuat refund kelebihan bayar"),
            fetchAllAdminCollectionData<Expense>("/api/data?entity=expenses", "Gagal memuat expenses"),
            fetchAllAdminCollectionData<Purchase>("/api/data?entity=purchases", "Gagal memuat pembelian"),
            fetchAllAdminCollectionData<FreightNota>("/api/data?entity=freight-notas", "Gagal memuat freight-notas"),
            fetchAllAdminCollectionData<DriverVoucher>("/api/data?entity=driver-vouchers", "Gagal memuat driver-vouchers"),
            fetchAllAdminCollectionData<BankAccount>("/api/data?entity=bank-accounts", "Gagal memuat bank-accounts"),
            fetchAllAdminCollectionData<BankTransaction>("/api/data?entity=bank-transactions", "Gagal memuat bank-transactions"),
            fetchAdminData<CompanyProfile | null>("/api/data?entity=company", "Gagal memuat company").catch(() => null),
          ]);
        setPayments(pay || []);
        setCustomerReceipts(receipts || []);
        setOverpaymentRefunds(refunds || []);
        setExpenses(exp || []);
        setPurchases(purchaseRows || []);
        setFreightNotas(nota || []);
        setDriverVouchers(vouchers || []);
        setAllBankAccounts(banks || []);
        setBankAccounts(
          (banks || []).filter((account) => account.active !== false),
        );
        setBankTransactions(txs || []);
        setCompany(companyProfile || null);
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Gagal memuat laporan",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadReportData();
  }, [addToast]);
  const isPeriodReady = periodMode !== "custom" || Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  const periodLabel = buildPeriodLabel(periodMode, month, year, monthNames, dateFrom, dateTo);
  const {
    filteredPayments,
    filteredOverpaymentRefunds,
    filteredExpenses,
    sortedFilteredBankTx,
    totalRevenue,
    totalExpense,
    netProfit,
    totalNotaIssued,
    totalNotaOutstanding,
    openDriverVouchers,
    openVoucherCash,
    openVoucherOperationalSpent,
    openVoucherDriverFees,
    openVoucherClaims,
    openVoucherReturn,
    openVoucherShortage,
    sortedCategories,
    cashFlowByBank,
  } = buildReportsSnapshot({
    payments,
    overpaymentRefunds,
    expenses,
    freightNotas,
    driverVouchers,
    allBankAccounts,
    bankTransactions,
    periodMode,
    month,
    year,
    dateFrom,
    dateTo,
  });
  const paymentsById = useMemo(() => buildPaymentLookup(payments), [payments]);
  const receiptsById = useMemo(() => buildCustomerReceiptLookup(customerReceipts), [customerReceipts]);
  const refundsById = useMemo(
    () => buildRefundLookup(overpaymentRefunds),
    [overpaymentRefunds],
  );
  const expensesById = useMemo(() => buildExpenseLookup(expenses), [expenses]);
  const purchasesById = useMemo(() => buildPurchaseLookup(purchases), [purchases]);
  const invoiceIdsWithPages = useMemo(
    () => new Set(freightNotas.map((nota) => nota._id)),
    [freightNotas],
  );
  const fmtN = (n: number) => new Intl.NumberFormat("id-ID").format(n);
  const parseWholeMoneyLike = (value: unknown) =>
    Math.max(parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 }), 0);
  const cashflowSummaryAccounts = [
    ...bankAccounts,
    ...Object.entries(cashFlowByBank)
      .filter(([accountRef]) => !bankAccounts.some((account) => account._id === accountRef))
      .map(([accountRef, flow]) => ({
        _id: accountRef,
        bankName: flow.bankName,
        accountNumber: flow.bankAccountNumber,
        currentBalance: parseWholeMoneyLike(
          allBankAccounts.find((account) => account._id === accountRef)
            ?.currentBalance,
        ),
        accountType: "BANK" as const,
        active: false,
      })),
  ];

  const prevPeriod = () => {
    if (periodMode === "year") setYear((value) => value - 1);
    else if (periodMode === "month" && month === 0) {
      setMonth(11);
      setYear((value) => value - 1);
    } else if (periodMode === "month") setMonth((value) => value - 1);
  };
  const nextPeriod = () => {
    if (periodMode === "year") setYear((value) => value + 1);
    else if (periodMode === "month" && month === 11) {
      setMonth(0);
      setYear((value) => value + 1);
    } else if (periodMode === "month") setMonth((value) => value + 1);
  };

  const handleExportExcel = async () => {
    if (!isPeriodReady) {
      addToast("error", "Rentang tanggal belum valid");
      return;
    }
    try {
      if (tab === "pnl") {
        const rows = buildProfitLossExportRows(filteredPayments, filteredExpenses, filteredOverpaymentRefunds);
        await exportToExcel(
          rows as unknown as Record<string, unknown>[],
          [
            { header: "Tipe", key: "tipe", width: 15 },
            { header: "Tanggal", key: "tanggal", width: 15 },
            { header: "Deskripsi", key: "deskripsi", width: 35 },
            { header: "Jumlah", key: "jumlah", width: 18 },
          ],
          `kas-operasional-${periodLabel.replace(/\s/g, "-")}`,
          "Kas Operasional",
        );
      } else {
        const rows = buildCashflowExportRows(
          sortedFilteredBankTx,
          allBankAccounts,
        );
        await exportToExcel(
          rows as unknown as Record<string, unknown>[],
          [
            { header: "Bank", key: "bank", width: 15 },
            { header: "Tanggal", key: "tanggal", width: 15 },
            { header: "Tipe", key: "tipe", width: 15 },
            { header: "Deskripsi", key: "deskripsi", width: 30 },
            { header: "Jumlah", key: "jumlah", width: 18 },
            { header: "Saldo", key: "saldo", width: 18 },
          ],
          `arus-kas-${periodLabel.replace(/\s/g, "-")}`,
          "Arus Kas",
        );
      }
      addToast("success", "Excel berhasil di-download");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Gagal menyiapkan Excel laporan",
      );
    }
  };

  const handleBrandedPrint = () => {
    if (!isPeriodReady) {
      addToast("error", "Rentang tanggal belum valid");
      return;
    }
    try {
      const isPnl = tab === "pnl";
      openBrandedPrint({
        title: isPnl ? "Ringkasan Kas Operasional" : "Laporan Arus Kas",
        subtitle: periodLabel,
        company,
        bodyHtml: isPnl
          ? `<div class="stats-row"><div class="stat-box"><div class="stat-label">Kas Masuk</div><div class="stat-value s">${fmtN(totalRevenue)}</div></div><div class="stat-box"><div class="stat-label">Kas Keluar</div><div class="stat-value d">${fmtN(totalExpense)}</div></div><div class="stat-box"><div class="stat-label">Selisih Kas</div><div class="stat-value ${netProfit >= 0 ? "s" : "d"}">${netProfit >= 0 ? "+" : ""}${fmtN(netProfit)}</div></div></div><table><thead><tr><th>Kategori</th><th class="r">Jumlah</th><th class="r">%</th></tr></thead><tbody><tr class="b"><td>KAS MASUK</td><td class="r s">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr><tr><td style="padding-left:1.5rem">Pembayaran customer (${filteredPayments.length}x)</td><td class="r">${fmtN(filteredPayments.reduce((sum, item) => sum + parseWholeMoneyLike(item.amount), 0))}</td><td class="r">-</td></tr>${filteredOverpaymentRefunds.length > 0 ? `<tr><td style="padding-left:1.5rem">Refund kelebihan bayar invoice (${filteredOverpaymentRefunds.length}x)</td><td class="r d">-${fmtN(filteredOverpaymentRefunds.reduce((sum, item) => sum + parseWholeMoneyLike(item.amount), 0))}</td><td class="r">-</td></tr>` : ""}<tr class="b" style="border-top:2px solid #e2e8f0"><td>KAS KELUAR</td><td class="r d">${fmtN(totalExpense)}</td><td class="r">100%</td></tr>${sortedCategories.map(([cat, amt]) => `<tr><td style="padding-left:1.5rem">${cat}</td><td class="r">${fmtN(amt)}</td><td class="r">${totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : 0}%</td></tr>`).join("")}<tr class="b" style="border-top:2px solid #1e293b"><td>SELISIH KAS</td><td class="r ${netProfit >= 0 ? "s" : "d"}">${netProfit >= 0 ? "+" : ""}${fmtN(netProfit)}</td><td></td></tr></tbody></table>`
          : `<div class="stats-row">${Object.entries(cashFlowByBank)
              .map(
                ([, value]) =>
                  `<div class="stat-box"><div class="stat-label">${value.bankName}</div><div class="stat-value s">+${fmtN(value.inflow)}</div><div class="d" style="font-size:0.78rem;margin-top:0.15rem">-${fmtN(value.outflow)}</div></div>`,
              )
              .join(
                "",
              )}</div><table><thead><tr><th>Bank</th><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr></thead><tbody>${sortedFilteredBankTx
              .map((item) => {
                const isIn =
                  item.type === "CREDIT" || item.type === "TRANSFER_IN";
                const bankName = resolveBankTransactionAccountName(
                  item,
                  allBankAccounts,
                );
                const amount = parseWholeMoneyLike(item.amount);
                const balanceAfter = parseWholeMoneyLike(item.balanceAfter);
                return `<tr><td>${bankName}</td><td>${item.date ? formatBusinessDate(item.date, "id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</td><td>${item.type}</td><td>${item.description}</td><td class="r ${isIn ? "s" : "d"} b">${isIn ? "+" : "-"}${fmtN(amount)}</td><td class="r b">${fmtN(balanceAfter)}</td></tr>`;
              })
              .join("")}</tbody></table>`,
      });
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Gagal menyiapkan dokumen print laporan",
      );
    }
  };

  if (loading)
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Kas Operasional</h1>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportExcel}
          >
            <FileDown size={15} /> Excel
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleBrandedPrint}
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>
      <div className="page-toolbar">
        <div className="page-toolbar-main">
          <div className="segmented-tabs" aria-label="Jenis laporan">
            <button
              className={`segmented-tab ${tab === "pnl" ? "active" : ""}`}
              onClick={() => setTab("pnl")}
            >
              <DollarSign size={14} /> Kas Operasional
            </button>
            <button
              className={`segmented-tab ${tab === "cashflow" ? "active" : ""}`}
              onClick={() => setTab("cashflow")}
            >
              <Landmark size={14} /> Arus Kas
            </button>
          </div>
        </div>
        <div className="page-toolbar-side">
          <div className="period-controls">
          <select
            className="form-select"
            value={periodMode}
            onChange={(event) =>
              setPeriodMode(event.target.value as ReportPeriodMode)
            }
          >
            <option value="month">Bulanan</option>
            <option value="year">Tahunan</option>
            <option value="custom">Rentang Tanggal</option>
            <option value="all">Semua</option>
          </select>
          {periodMode === "month" && (
            <select
              className="form-select"
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {monthNames.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {periodMode === "custom" && (
            <>
              <input className="form-input" type="date" value={dateFrom} onInput={(event) => setDateFrom(event.currentTarget.value)} onChange={(event) => setDateFrom(event.target.value)} />
              <input className="form-input" type="date" value={dateTo} onInput={(event) => setDateTo(event.currentTarget.value)} onChange={(event) => setDateTo(event.target.value)} />
            </>
          )}
          {periodMode !== "all" && periodMode !== "custom" && (
            <div className="period-nav-group">
              <button
                className="btn btn-secondary btn-sm"
                onClick={prevPeriod}
                aria-label="Periode sebelumnya"
                title="Periode sebelumnya"
              >
                <ChevronLeft size={14} />
              </button>
              <select
                className="form-select period-year-select"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              >
                {yearOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <button
                className="btn btn-secondary btn-sm"
                onClick={nextPeriod}
                aria-label="Periode berikutnya"
                title="Periode berikutnya"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
            <span className="period-label-pill">{periodLabel}</span>
          </div>
        </div>
      </div>
      {!isPeriodReady && (
        <div className="info-banner" style={{ marginBottom: "1rem" }}>
          <div className="info-banner-text">Lengkapi tanggal awal dan akhir, lalu pastikan tanggal awal tidak melebihi tanggal akhir.</div>
        </div>
      )}

      {tab === "pnl" ? (
        <div>
          <div className="responsive-stat-grid" style={{ marginBottom: "1.5rem" }}>
            {[
              {
                label: "Kas Masuk",
                value: formatCurrency(totalRevenue),
                note: `${filteredPayments.length} pembayaran`,
                color: "var(--color-success)",
              },
              {
                label: "Kas Keluar",
                value: formatCurrency(totalExpense),
                note: `${filteredExpenses.length} transaksi`,
                color: "var(--color-danger)",
              },
              {
                label: "Selisih Kas",
                value: `${netProfit >= 0 ? "+" : ""}${formatCurrency(netProfit)}`,
                note: `${totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0"}% dari kas masuk`,
                color:
                  netProfit >= 0
                    ? "var(--color-success)"
                    : "var(--color-danger)",
              },
              {
                label: "Piutang Invoice Aktif",
                value: formatCurrency(totalNotaOutstanding),
                note: `Invoice terbit ${formatCurrency(totalNotaIssued)}`,
                color: "var(--color-warning)",
              },
              {
                label: "Uang Jalan Trip Belum Diselesaikan",
                value: formatCurrency(openVoucherClaims),
                note: `${openDriverVouchers.length} trip aktif`,
                color: "var(--color-primary)",
              },
            ].map((item) => (
              <div key={item.label} className="card">
                <div className="card-body">
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: "1.4rem",
                      fontWeight: 700,
                      color: item.color,
                    }}
                  >
                    {item.value}
                  </div>
                  <div
                    style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                  >
                    {item.note}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="card-header">
                <span className="card-header-title">Uang Jalan Trip yang Masih Berjalan</span>
            </div>
            <div className="card-body">
              <div className="responsive-stat-grid" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Total Uang Diberikan
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    {formatCurrency(openVoucherCash)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Biaya Perjalanan
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    {formatCurrency(openVoucherOperationalSpent)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Upah Trip Pending
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    {formatCurrency(openVoucherDriverFees)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Total Biaya Pending
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    {formatCurrency(openVoucherClaims)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Potensi Pengembalian Akhir
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-success)",
                    }}
                  >
                    {formatCurrency(openVoucherReturn)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Potensi Bon Penutupan
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    {formatCurrency(openVoucherShortage)}
                  </div>
                </div>
              </div>
              <div className="table-wrapper table-desktop-only" style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th>No. Bon</th>
                      <th>Tanggal</th>
                      <th>Supir</th>
                      <th>Rekening</th>
                      <th style={{ textAlign: "right" }}>Total Diberikan</th>
                      <th style={{ textAlign: "right" }}>Biaya</th>
                      <th style={{ textAlign: "right" }}>Upah Trip</th>
                      <th style={{ textAlign: "right" }}>Total Biaya</th>
                      <th style={{ textAlign: "right" }}>Penyelesaian Uang Jalan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openDriverVouchers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          style={{
                            textAlign: "center",
                            padding: "2rem 1rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          Tidak ada uang jalan trip yang masih aktif
                        </td>
                      </tr>
                    ) : (
                      openDriverVouchers.map((item) => {
                        const {
                          totalIssuedAmount,
                          totalSpent,
                          driverFeeAmount,
                          totalClaimAmount,
                          initialCashGiven,
                          topUpAmount,
                          balance,
                        } = getDriverVoucherFinancialSummary(item);
                        const settlementDisplay = buildDriverVoucherSettlementDisplay({
                          balance,
                          fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                            ...item,
                            topUpAmount,
                          }),
                          initialCashGiven,
                          totalIssuedAmount,
                          topUpAmount,
                          totalClaimAmount,
                        });
                        return (
                          <tr key={item._id}>
                            <td style={{ fontWeight: 600 }}>{item.bonNumber}</td>
                            <td>{formatDate(item.issuedDate)}</td>
                            <td>{item.driverName || "-"}</td>
                            <td>{item.issueBankName || "-"}</td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>
                              {formatCurrency(totalIssuedAmount)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {formatCurrency(totalSpent)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {formatCurrency(driverFeeAmount)}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>
                              {formatCurrency(totalClaimAmount)}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                fontWeight: 700,
                                color:
                                  balance < 0
                                    ? "var(--color-danger)"
                                    : "var(--color-success)",
                              }}
                            >
                              <div>{formatCurrency(balance < 0 ? settlementDisplay.amount : balance)}</div>
                              <div className="text-muted text-sm">{settlementDisplay.label}</div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {openDriverVouchers.length === 0 ? (
                  <div className="mobile-record-card">
                    <div className="mobile-record-title">
                      Tidak ada uang jalan trip yang masih aktif
                    </div>
                    <div className="mobile-record-subtitle">
                      Semua uang jalan trip pada periode ini sudah diselesaikan.
                    </div>
                  </div>
                ) : (
                  openDriverVouchers.map((item) => {
                    const {
                      totalIssuedAmount,
                      totalSpent,
                      driverFeeAmount,
                      totalClaimAmount,
                      initialCashGiven,
                      topUpAmount,
                      balance,
                    } = getDriverVoucherFinancialSummary(item);
                    const settlementDisplay = buildDriverVoucherSettlementDisplay({
                      balance,
                      fallbackDisbursementCount: inferDriverVoucherDisbursementCount({
                        ...item,
                        topUpAmount,
                      }),
                      initialCashGiven,
                      totalIssuedAmount,
                      topUpAmount,
                      totalClaimAmount,
                    });
                    return (
                      <div key={item._id} className="mobile-record-card">
                        <div className="mobile-record-header">
                          <div>
                            <div className="mobile-record-title">
                              {item.bonNumber}
                            </div>
                            <div className="mobile-record-subtitle">
                              {item.driverName || "-"} | {formatDate(item.issuedDate)}
                            </div>
                          </div>
                          <span className="badge badge-warning">Belum Diselesaikan</span>
                        </div>
                        <div className="mobile-record-meta">
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Rekening</span>
                            <span className="mobile-record-value">
                              {item.issueBankName || "-"}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Total Diberikan</span>
                            <span className="mobile-record-value">
                              {formatCurrency(totalIssuedAmount)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Biaya</span>
                            <span className="mobile-record-value">
                              {formatCurrency(totalSpent)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Upah Trip</span>
                            <span className="mobile-record-value">
                              {formatCurrency(driverFeeAmount)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Total Biaya</span>
                            <span className="mobile-record-value">
                              {formatCurrency(totalClaimAmount)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">{settlementDisplay.label}</span>
                            <span
                              className="mobile-record-value"
                              style={{
                                fontWeight: 700,
                                color:
                                  balance < 0
                                    ? "var(--color-danger)"
                                    : "var(--color-success)",
                              }}
                            >
                              {formatCurrency(balance < 0 ? settlementDisplay.amount : balance)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <div className="detail-grid">
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">Ringkasan Kas Operasional</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    background: "rgba(5,150,105,0.05)",
                    borderBottom: "1px solid var(--color-gray-100)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      color: "var(--color-success)",
                    }}
                  >
                    <span>PENDAPATAN</span>
                    <span>{formatCurrency(totalRevenue)}</span>
                  </div>
                </div>
                <div
                  style={{
                    padding: "0.5rem 1rem 0.5rem 2rem",
                    borderBottom: "1px solid var(--color-gray-100)",
                    fontSize: "0.82rem",
                  }}
                >
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span>Pembayaran Customer ({filteredPayments.length}x)</span>
                    <span style={{ fontWeight: 600 }}>
                      {formatCurrency(totalRevenue)}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    background: "rgba(220,38,38,0.05)",
                    borderBottom: "1px solid var(--color-gray-100)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    <span>PENGELUARAN</span>
                    <span>{formatCurrency(totalExpense)}</span>
                  </div>
                </div>
                {sortedCategories.map(([category, amount]) => (
                  <div
                    key={category}
                    style={{
                      padding: "0.5rem 1rem 0.5rem 2rem",
                      borderBottom: "1px solid var(--color-gray-100)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{category}</span>
                      <div style={{ display: "flex", gap: "1.5rem" }}>
                        <span style={{ fontWeight: 600 }}>
                          {formatCurrency(amount)}
                        </span>
                        <span
                          style={{
                            color: "var(--color-gray-400)",
                            fontSize: "0.72rem",
                            minWidth: 40,
                            textAlign: "right",
                          }}
                        >
                          {totalExpense > 0
                            ? ((amount / totalExpense) * 100).toFixed(1)
                            : 0}
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    padding: "1rem",
                    background: "var(--color-gray-50)",
                    borderTop: "2px solid var(--color-gray-300)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      fontSize: "1rem",
                    }}
                  >
                    <span>LABA / RUGI BERSIH</span>
                    <span
                      style={{
                        color:
                          netProfit >= 0
                            ? "var(--color-success)"
                            : "var(--color-danger)",
                      }}
                    >
                      {netProfit >= 0 ? "+" : ""}
                      {formatCurrency(netProfit)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">
                  Kas Keluar per Kategori
                </span>
              </div>
              <div className="card-body">
                {sortedCategories.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--color-gray-400)",
                      padding: "2rem 0",
                    }}
                  >
                    Tidak ada pengeluaran
                  </div>
                ) : (
                  sortedCategories.map(([category, amount]) => {
                    const pct =
                      totalExpense > 0 ? (amount / totalExpense) * 100 : 0;
                    return (
                      <div key={category} style={{ marginBottom: "0.75rem" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.82rem",
                            marginBottom: "0.2rem",
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{category}</span>
                          <span style={{ fontWeight: 600 }}>
                            {formatCurrency(amount)}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 6,
                            background: "var(--color-gray-100)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background:
                                "linear-gradient(90deg, var(--color-danger), #f87171)",
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: "0.68rem",
                            color: "var(--color-gray-400)",
                            marginTop: "0.1rem",
                          }}
                        >
                          {pct.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            {cashflowSummaryAccounts.map((account) => {
              const flow = cashFlowByBank[account._id] || {
                inflow: 0,
                outflow: 0,
              };
              return (
                <div key={account._id} className="card">
                  <div className="card-body">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.6rem",
                      }}
                    >
                      <Landmark
                        size={16}
                        style={{ color: "var(--color-primary)" }}
                      />
                      <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {account.bankName}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <span style={{ color: "var(--color-success)" }}>
                        Masuk
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--color-success)",
                        }}
                      >
                        +{formatCurrency(flow.inflow)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <span style={{ color: "var(--color-danger)" }}>
                        Keluar
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--color-danger)",
                        }}
                      >
                        -{formatCurrency(flow.outflow)}
                      </span>
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid var(--color-gray-100)",
                        marginTop: "0.3rem",
                        paddingTop: "0.3rem",
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Saldo</span>
                      <span style={{ fontWeight: 700 }}>
                        {formatCurrency(parseWholeMoneyLike(account.currentBalance))}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card">
            <div
              className="card-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="card-header-title">Transaksi Arus Kas</span>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                {sortedFilteredBankTx.length} transaksi
              </span>
            </div>
            <div className="table-wrapper table-desktop-only" style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 650 }}>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Bank</th>
                    <th>Tipe</th>
                    <th>Deskripsi</th>
                    <th style={{ textAlign: "right" }}>Jumlah</th>
                    <th style={{ textAlign: "right" }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredBankTx.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        style={{
                          textAlign: "center",
                          padding: "2.5rem 1rem",
                          color: "var(--color-gray-400)",
                        }}
                      >
                        Tidak ada transaksi dalam periode ini
                      </td>
                    </tr>
                  ) : (
                    sortedFilteredBankTx.map((item) => {
                      const isIn =
                        item.type === "CREDIT" || item.type === "TRANSFER_IN";
                      const bankName = resolveBankTransactionAccountName(
                        item,
                        allBankAccounts,
                      );
                      const amount = parseWholeMoneyLike(item.amount);
                      const balanceAfter = parseWholeMoneyLike(item.balanceAfter);
                      const sourceLink = resolveBankTransactionSourceLink({
                        transaction: item,
                        paymentsById,
                        receiptsById,
                        refundsById,
                        expensesById,
                        purchasesById,
                        invoiceIdsWithPages,
                        permissions: {
                          canOpenInvoices,
                          canOpenDriverVouchers,
                          canOpenDriverBorongans,
                          canOpenVehicles,
                          canOpenIncidents,
                          canOpenPurchases,
                        },
                      });
                      return (
                        <tr key={item._id}>
                          <td
                            style={{
                              whiteSpace: "nowrap",
                              fontSize: "0.82rem",
                            }}
                          >
                            {formatDate(item.date)}
                          </td>
                          <td style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                            {canOpenBankAccounts ? (
                              <Link href={`/bank-accounts/${item.bankAccountRef}`} style={{ color: "var(--color-primary)" }}>
                                {bankName}
                              </Link>
                            ) : (
                              bankName
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge badge-${isIn ? "success" : "danger"}`}
                              style={{ fontSize: "0.65rem" }}
                            >
                              {isIn ? "Masuk" : "Keluar"}
                            </span>
                          </td>
                          <td style={{ fontSize: "0.82rem" }}>
                            <div>{item.description}</div>
                            {sourceLink && (
                              <div style={{ marginTop: "0.2rem" }}>
                                <Link href={sourceLink.href} style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--color-primary)" }}>
                                  {sourceLink.label}
                                </Link>
                              </div>
                            )}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              fontWeight: 700,
                              color: isIn
                                ? "var(--color-success)"
                                : "var(--color-danger)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {isIn ? "+" : "-"}
                            {formatCurrency(amount)}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatCurrency(balanceAfter)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {sortedFilteredBankTx.length === 0 ? (
                <div className="mobile-record-card">
                  <div className="mobile-record-title">
                    Tidak ada transaksi dalam periode ini
                  </div>
                  <div className="mobile-record-subtitle">
                    Ubah periode untuk melihat mutasi bank atau kas lainnya.
                  </div>
                </div>
              ) : (
                sortedFilteredBankTx.map((item) => {
                  const isIn =
                    item.type === "CREDIT" || item.type === "TRANSFER_IN";
                  const bankName = resolveBankTransactionAccountName(
                    item,
                    allBankAccounts,
                  );
                  const amount = parseWholeMoneyLike(item.amount);
                  const balanceAfter = parseWholeMoneyLike(item.balanceAfter);
                  const sourceLink = resolveBankTransactionSourceLink({
                    transaction: item,
                    paymentsById,
                    receiptsById,
                    refundsById,
                    expensesById,
                    purchasesById,
                    invoiceIdsWithPages,
                    permissions: {
                      canOpenInvoices,
                      canOpenDriverVouchers,
                      canOpenDriverBorongans,
                      canOpenVehicles,
                      canOpenIncidents,
                      canOpenPurchases,
                    },
                  });
                  return (
                    <div key={item._id} className="mobile-record-card">
                      <div className="mobile-record-header">
                        <div>
                          <div className="mobile-record-title">
                            {canOpenBankAccounts ? (
                              <Link href={`/bank-accounts/${item.bankAccountRef}`} style={{ color: "var(--color-primary)" }}>
                                {bankName}
                              </Link>
                            ) : (
                              bankName
                            )}
                          </div>
                          <div className="mobile-record-subtitle">
                            {formatDate(item.date)} | {item.description}
                          </div>
                          {sourceLink && (
                            <div style={{ marginTop: "0.2rem" }}>
                              <Link href={sourceLink.href} style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--color-primary)" }}>
                                {sourceLink.label}
                              </Link>
                            </div>
                          )}
                        </div>
                        <span
                          className={`badge badge-${isIn ? "success" : "danger"}`}
                        >
                          {isIn ? "Masuk" : "Keluar"}
                        </span>
                      </div>
                      <div className="mobile-record-meta">
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Jumlah</span>
                          <span
                            className="mobile-record-value"
                            style={{
                              fontWeight: 700,
                              color: isIn
                                ? "var(--color-success)"
                                : "var(--color-danger)",
                            }}
                          >
                            {isIn ? "+" : "-"}
                            {formatCurrency(amount)}
                          </span>
                        </div>
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Saldo Setelah</span>
                          <span className="mobile-record-value">
                            {formatCurrency(balanceAfter)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

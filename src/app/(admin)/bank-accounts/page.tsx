"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  CircleDollarSign,
  Edit,
  Eye,
  FileDown,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import AppPagination from "@/components/AppPagination";
import BankLogo from "@/components/BankLogo";
import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
  BANK_PRESETS,
  buildBankAccountExportRows,
  buildBankAccountsQuery,
  buildBankAccountPrintHtml,
  createDefaultBankAccountForm,
  createDefaultBankAdjustmentForm,
  createDefaultBankTransferForm,
  formatBankAccountCurrency,
  getAccountNextAction,
  getBankPreset,
  isCashAccount,
  normalizeBankAccountAmount,
  sortBankAccountsForDisplay,
} from "@/lib/bank-account-page-support";
import { getBusinessDateValue } from "@/lib/business-date";
import { exportToExcel } from "@/lib/export";
import { openBrandedPrint, openPrintWindow } from "@/lib/print";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import type { BankAccount, CompanyProfile } from "@/lib/types";
import { hasPermission } from "@/lib/rbac";
import { useApp, useToast } from "../layout";

export default function BankAccountsPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [totalBalance, setTotalBalance] = useState(0);
  const [totalInitial, setTotalInitial] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const [bankBalance, setBankBalance] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
    null,
  );
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [form, setForm] = useState(createDefaultBankAccountForm());
  const [transferForm, setTransferForm] = useState(createDefaultBankTransferForm());
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustForm, setAdjustForm] = useState(createDefaultBankAdjustmentForm());
  const [adjustReview, setAdjustReview] = useState(false);
  const editingSystemCash = !!editAccount && isCashAccount(editAccount);
  const adjustAccount = accounts.find((account) => account._id === adjustForm.bankAccountRef) || null;
  const adjustDelta = adjustForm.direction === "in" ? adjustForm.amount : -adjustForm.amount;
  const adjustBalanceAfter = adjustAccount
    ? (normalizeBankAccountAmount(adjustAccount.currentBalance) || 0) + adjustDelta
    : 0;
  const canCreateBankAccounts = user ? hasPermission(user, "bankAccounts", "create") : false;
  const canManageBankAccounts = user ? hasPermission(user, "bankAccounts", "update") : false;
  const canDeleteBankAccounts = user ? hasPermission(user, "bankAccounts", "delete") : false;
  const canExportBankAccounts = user ? hasPermission(user, "bankAccounts", "export") : false;
  const canPrintBankAccounts = user ? hasPermission(user, "bankAccounts", "print") : false;
  const invoiceBankAccountRefs = Array.isArray(company?.invoiceSettings?.invoiceBankAccountRefs)
    ? company.invoiceSettings.invoiceBankAccountRefs.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const defaultInvoiceBankAccountRef =
    typeof company?.invoiceSettings?.defaultInvoiceBankAccountRef === "string"
      ? company.invoiceSettings.defaultInvoiceBankAccountRef
      : "";
  const buildAccountsQuery = useCallback(
    (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
      buildBankAccountsQuery({ page: targetPage, pageSize: targetPageSize }),
    [page],
  );

  const fetchAllAccounts = useCallback(async () => {
    const pageSize = 200;
    let currentPage = 1;
    let total = 0;
    const allItems: BankAccount[] = [];

    do {
      const res = await fetch(`/api/data?${buildAccountsQuery(currentPage, pageSize)}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Gagal memuat rekening bank");
      }
      const nextItems = (payload.data || []) as BankAccount[];
      total = payload.meta?.total || nextItems.length;
      allItems.push(...nextItems);
      if (nextItems.length === 0) break;
      currentPage += 1;
    } while (allItems.length < total);

    return sortBankAccountsForDisplay(allItems);
  }, [buildAccountsQuery]);

  const loadAccounts = useCallback(async () => {
    const [listRes, summaryRes] = await Promise.all([
      fetch(`/api/data?${buildAccountsQuery()}`),
      fetch("/api/data?entity=bank-accounts-summary"),
    ]);
    const [listPayload, summaryPayload] = await Promise.all([
      listRes.json(),
      summaryRes.json(),
    ]);
    if (!listRes.ok) {
      throw new Error(listPayload.error || "Gagal memuat rekening bank");
    }
    if (!summaryRes.ok) {
      throw new Error(summaryPayload.error || "Gagal memuat ringkasan rekening");
    }
    const nextAccounts = sortBankAccountsForDisplay((listPayload.data || []) as BankAccount[]);
    setAccounts(nextAccounts);
    setTotalAccounts(listPayload.meta?.total || 0);
    setTotalBalance(summaryPayload.data?.totalBalance || 0);
    setTotalInitial(summaryPayload.data?.totalInitial || 0);
    setCashBalance(summaryPayload.data?.cashBalance || 0);
    setBankBalance(summaryPayload.data?.bankBalance || 0);
  }, [buildAccountsQuery]);

  useEffect(() => {
    async function load() {
      try {
        const loadCompany = async () => {
          const res = await fetch("/api/data?entity=company");
          const payload = await res.json();
          if (!res.ok) {
            throw new Error(
              payload.error || "Gagal memuat profil perusahaan",
            );
          }
          return payload.data || null;
        };
        const [accountsRes, companyRes] = await Promise.all([
          loadAccounts(),
          loadCompany().catch(() => null),
        ]);
        void accountsRes;
        setCompany(companyRes);
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Gagal memuat rekening bank",
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [addToast, loadAccounts]);

  useEffect(() => {
    const activeAccountRefSet = new Set(accounts.map((account) => account._id));

    setTransferForm((current) => {
      let next = current;
      let changed = false;

      if (next.fromAccountRef && !activeAccountRefSet.has(next.fromAccountRef)) {
        next = { ...next, fromAccountRef: "" };
        changed = true;
      }

      if (next.toAccountRef && !activeAccountRefSet.has(next.toAccountRef)) {
        next = { ...next, toAccountRef: "" };
        changed = true;
      }

      if (next.fromAccountRef && next.toAccountRef && next.fromAccountRef === next.toAccountRef) {
        next = { ...next, toAccountRef: "" };
        changed = true;
      }

      return changed ? next : current;
    });
  }, [accounts]);

  const openNew = () => {
    setEditAccount(null);
    setForm(createDefaultBankAccountForm());
    setShowModal(true);
  };

  const openEdit = (account: BankAccount) => {
    setEditAccount(account);
    setForm({
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountHolder: account.accountHolder,
      initialBalance: account.initialBalance,
      notes: account.notes || "",
    });
    setShowModal(true);
  };

  const openAdjust = () => {
    setAdjustForm(createDefaultBankAdjustmentForm(accounts[0]?._id || ""));
    setAdjustReview(false);
    setShowAdjust(true);
  };

  const openAdjustFor = (accountRef: string) => {
    setAdjustForm(createDefaultBankAdjustmentForm(accountRef));
    setAdjustReview(false);
    setShowAdjust(true);
  };

  const refreshAccounts = async () => {
    try {
      await loadAccounts();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Gagal memuat rekening bank",
      );
    }
  };

  const handleSave = async () => {
    const normalizedForm = {
      ...form,
      bankName: form.bankName.trim(),
      accountNumber: form.accountNumber.trim(),
      accountHolder: form.accountHolder.trim(),
      notes: form.notes.trim(),
    };

    if (!normalizedForm.bankName || !normalizedForm.accountNumber || !normalizedForm.accountHolder) {
      addToast("error", "Nama bank, nomor rekening, dan atas nama wajib diisi");
      return;
    }

    const canEditInitialBalance =
      !editAccount || (editAccount.transactionCount ?? 0) === 0;

    const body = editAccount
      ? {
          entity: "bank-accounts",
          action: "update",
          data: {
            id: editAccount._id,
            updates: {
              ...(editingSystemCash
                ? {}
                : {
                    bankName: normalizedForm.bankName,
                    accountNumber: normalizedForm.accountNumber,
                    accountHolder: normalizedForm.accountHolder,
                  }),
              notes: normalizedForm.notes,
              ...(canEditInitialBalance
                ? { initialBalance: normalizedForm.initialBalance }
                : {}),
            },
          },
        }
      : { entity: "bank-accounts", data: { ...normalizedForm, active: true } };

    setSavingAccount(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast(
          "error",
          result.error ||
            (editAccount
              ? "Gagal memperbarui rekening"
              : "Gagal menambahkan rekening"),
        );
        return;
      }

      setShowModal(false);
      addToast(
        "success",
        editAccount ? "Rekening diperbarui" : "Rekening ditambahkan",
      );
      await refreshAccounts();
    } catch {
      addToast(
        "error",
        editAccount ? "Gagal memperbarui rekening" : "Gagal menambahkan rekening",
      );
    } finally {
      setSavingAccount(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingAccountId(id);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "bank-accounts",
          action: "delete",
          data: { id },
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast("error", result.error || "Gagal menonaktifkan rekening");
        return;
      }

      setDeleteConfirm(null);
      addToast("success", "Rekening dinonaktifkan");
      await refreshAccounts();
    } catch {
      addToast("error", "Gagal menonaktifkan rekening");
    } finally {
      setDeletingAccountId((current) => (current === id ? null : current));
    }
  };

  const handleTransfer = async () => {
    if (
      !transferForm.fromAccountRef ||
      !transferForm.toAccountRef ||
      transferForm.amount <= 0
    ) {
      addToast("error", "Lengkapi data transfer");
      return;
    }
    if (transferForm.fromAccountRef === transferForm.toAccountRef) {
      addToast("error", "Rekening sumber dan tujuan tidak boleh sama");
      return;
    }

    setTransferring(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "bank-transactions",
          action: "transfer",
          data: transferForm,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast("error", result.error || "Transfer gagal");
        return;
      }

      setShowTransfer(false);
      setTransferForm(createDefaultBankTransferForm());
      addToast("success", "Transfer berhasil");
      await refreshAccounts();
    } catch {
      addToast("error", "Transfer gagal");
    } finally {
      setTransferring(false);
    }
  };

  const handleAdjust = async () => {
    if (!adjustForm.bankAccountRef) {
      addToast("error", "Pilih rekening / kas terlebih dahulu");
      return;
    }
    if (!adjustForm.amount || adjustForm.amount <= 0) {
      addToast("error", "Nominal penyesuaian tidak valid");
      return;
    }
    if (!adjustForm.date) {
      addToast("error", "Tanggal penyesuaian wajib diisi");
      return;
    }
    setAdjusting(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "bank-transactions",
          action: "adjust",
          data: adjustForm,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast("error", result.error || "Penyesuaian saldo gagal");
        return;
      }

      setShowAdjust(false);
      setAdjustReview(false);
      setAdjustForm(createDefaultBankAdjustmentForm(accounts[0]?._id || ""));
      addToast("success", "Saldo berhasil disesuaikan");
      await refreshAccounts();
    } catch {
      addToast("error", "Penyesuaian saldo gagal");
    } finally {
      setAdjusting(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      const printableAccounts = await fetchAllAccounts();
      const rows = buildBankAccountExportRows(printableAccounts);
      await exportToExcel(
        rows as unknown as Record<string, unknown>[],
        [
          { header: "Tipe", key: "accountType", width: 12 },
          { header: "Bank", key: "bankName", width: 18 },
          { header: "No. Rekening", key: "accountNumber", width: 20 },
          { header: "Atas Nama", key: "accountHolder", width: 25 },
          { header: "Saldo Awal", key: "initialBalance", width: 18 },
          { header: "Saldo Saat Ini", key: "currentBalance", width: 18 },
        ],
        `rekening-dan-kas-${getBusinessDateValue()}`,
        "Rekening dan Kas",
      );
      addToast("success", "Excel berhasil di-download");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error
          ? error.message
          : "Gagal menyiapkan Excel rekening",
      );
    }
  };

  const handleBrandedPrint = async () => {
    const printWindow = openPrintWindow("Menyiapkan print rekening...");
    if (!printWindow) {
      addToast("error", "Popup browser diblok. Izinkan pop-up lalu coba print lagi.");
      return;
    }
    try {
      const printableAccounts = await fetchAllAccounts();
      const printableTotalBalance = printableAccounts.reduce(
        (sum, account) => sum + normalizeBankAccountAmount(account.currentBalance),
        0,
      );
      const printableTotalInitial = printableAccounts.reduce(
        (sum, account) => sum + normalizeBankAccountAmount(account.initialBalance),
        0,
      );
      openBrandedPrint({
        title: "Laporan Rekening dan Kas",
        company,
        targetWindow: printWindow,
        bodyHtml: buildBankAccountPrintHtml({
          accounts: printableAccounts,
          totalBalance: printableTotalBalance,
          totalInitial: printableTotalInitial,
        }),
      });
    } catch (error) {
      try {
        printWindow.close();
      } catch {}
      addToast(
        "error",
        error instanceof Error
          ? error.message
          : "Gagal menyiapkan dokumen print rekening",
      );
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Rekening &amp; Kas</h1>
        </div>
        <div className="page-actions">
          {canExportBankAccounts && <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportExcel}
          >
            <FileDown size={15} /> Excel
          </button>}
          {canPrintBankAccounts && <button
            className="btn btn-secondary btn-sm"
            onClick={handleBrandedPrint}
          >
            <Printer size={15} /> Print
          </button>}
          {canManageBankAccounts && (
            <button
              className="btn btn-secondary"
              onClick={openAdjust}
            >
              <CircleDollarSign size={16} /> Tambah Saldo
            </button>
          )}
          {canManageBankAccounts && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowTransfer(true)}
            >
              <ArrowRightLeft size={16} /> Transfer
            </button>
          )}
          {canCreateBankAccounts && (
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={18} /> Tambah Rekening
            </button>
          )}
        </div>
      </div>

      <div className="responsive-stat-grid" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Total Saldo
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {formatBankAccountCurrency(totalBalance)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Saldo Bank
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {formatBankAccountCurrency(bankBalance)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Saldo Kas Tunai
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {formatBankAccountCurrency(cashBalance)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Perubahan dari Saldo Awal
            </div>
            <div
              style={{
                fontSize: "1.6rem",
                fontWeight: 700,
                color:
                  totalBalance - totalInitial >= 0
                    ? "var(--success)"
                    : "var(--danger)",
              }}
            >
              {totalBalance - totalInitial >= 0 ? "+" : ""}
              {formatBankAccountCurrency(totalBalance - totalInitial)}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        {loading
          ? [1, 2, 3].map((i) => (
              <div key={i} className="card">
                <div className="card-body">
                  <div className="skeleton skeleton-title" />
                  <div className="skeleton skeleton-text" />
                  <div className="skeleton skeleton-text" />
                </div>
              </div>
            ))
          : accounts.map((account) => {
              const preset = isCashAccount(account)
                ? BANK_PRESETS.CASH
                : getBankPreset(account.bankName);
              const diff =
                normalizeBankAccountAmount(account.currentBalance) -
                normalizeBankAccountAmount(account.initialBalance);
              const systemCash = isCashAccount(account);
              const showsOnInvoice = invoiceBankAccountRefs.includes(account._id);
              const isDefaultInvoiceAccount =
                defaultInvoiceBankAccountRef === account._id;
              return (
                <div
                  key={account._id}
                  className="card"
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ height: 4, background: preset.gradient }} />
                  <div className="card-body" style={{ padding: "1.25rem" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginBottom: "1rem",
                      }}
                    >
                      <BankLogo name={account.bankName} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            flexWrap: "wrap",
                          }}
                        >
                          {account.bankName}
                          {systemCash && (
                            <span className="badge badge-success">
                              Kas Tunai
                            </span>
                          )}
                          {!systemCash && isDefaultInvoiceAccount && (
                            <span className="badge badge-primary">
                              Default Invoice
                            </span>
                          )}
                          {!systemCash &&
                            showsOnInvoice &&
                            !isDefaultInvoiceAccount && (
                              <span className="badge badge-info">
                                Tampil di Invoice
                              </span>
                            )}
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono, monospace)",
                          }}
                        >
                          {account.accountNumber}
                        </div>
                        {!systemCash && showsOnInvoice && (
                          <div
                            style={{
                              fontSize: "0.72rem",
                              color: "var(--text-muted)",
                              marginTop: "0.2rem",
                            }}
                          >
                            Dipakai di instruksi pembayaran invoice
                          </div>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "var(--text-muted)",
                        marginBottom: "0.5rem",
                      }}
                    >
                      a.n. {account.accountHolder}
                    </div>
                    <div
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        marginBottom: "0.75rem",
                        color: "var(--color-primary)",
                      }}
                    >
                      Tindak lanjut: {getAccountNextAction(account)}
                    </div>
                    <div
                      style={{
                        background: "var(--bg-secondary, #f8fafc)",
                        borderRadius: "0.5rem",
                        padding: "0.75rem 1rem",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          marginBottom: "0.2rem",
                        }}
                      >
                        Saldo
                      </div>
                      <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>
                        {formatBankAccountCurrency(account.currentBalance)}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: diff >= 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {diff >= 0 ? "+" : ""}
                        {formatBankAccountCurrency(diff)} dari saldo awal
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <Link
                        href={`/bank-accounts/${account._id}`}
                        className="btn btn-sm btn-secondary"
                        style={{ flex: 1, justifyContent: "center" }}
                      >
                        <Eye size={13} /> Detail
                      </Link>
                      {canManageBankAccounts && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => openEdit(account)}
                        >
                          <Edit size={13} />
                        </button>
                      )}
                      {canDeleteBankAccounts && !systemCash && (
                        <button
                          className="btn btn-sm"
                          style={{
                            color: "var(--danger)",
                            border: "1px solid var(--danger)",
                            background: "transparent",
                          }}
                          onClick={() => setDeleteConfirm(account._id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        {!loading && canCreateBankAccounts && (
          <div
            className="card"
            style={{
              border: "2px dashed var(--border-color)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 200,
            }}
            onClick={openNew}
          >
            <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
              <Plus
                size={32}
                style={{ marginBottom: "0.5rem", opacity: 0.5 }}
              />
                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                Tambah Rekening Bank
                </div>
            </div>
          </div>
        )}
      </div>
      {totalAccounts > 0 && (
        <AppPagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          totalItems={totalAccounts}
          onPageChange={setPage}
          info={({ startIndex, endIndex, totalItems }) => (
            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} rekening / kas</>
          )}
        />
      )}

      {(canManageBankAccounts || canCreateBankAccounts) && showModal && (
        <div className="modal-overlay" onClick={() => { if (!savingAccount) setShowModal(false); }}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editAccount
                  ? editingSystemCash
                    ? "Edit Kas Tunai"
                    : "Edit Rekening"
                  : "Tambah Rekening Baru"}
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
                disabled={savingAccount}
              >
                x
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Jenis Bank <span className="required">*</span>
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "0.4rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  {Object.entries(BANK_PRESETS)
                    .filter(([key]) => key !== "OTHER" && key !== "CASH")
                    .map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        disabled={editingSystemCash}
                        onClick={() =>
                          setForm({ ...form, bankName: preset.label })
                        }
                        style={{
                          padding: "0.45rem 0.25rem",
                          borderRadius: "0.5rem",
                          border:
                            form.bankName === preset.label
                              ? `2px solid ${preset.color}`
                              : "1px solid var(--border-color)",
                          background:
                            form.bankName === preset.label
                              ? `${preset.color}10`
                              : "var(--bg-primary)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "0.25rem",
                          fontSize: "0.65rem",
                          fontWeight: 600,
                        }}
                      >
                        <BankLogo name={key} />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "100%",
                          }}
                        >
                          {preset.label}
                        </span>
                      </button>
                    ))}
                </div>
                <input
                  className="form-input"
                  placeholder="Atau ketik nama bank manual..."
                  value={form.bankName}
                  disabled={editingSystemCash}
                  onChange={(event) =>
                    setForm({ ...form, bankName: event.target.value })
                  }
                />
                {editingSystemCash && (
                  <div className="form-hint">
                    Identitas Kas Tunai sistem tidak dapat diubah.
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Nomor Rekening <span className="required">*</span>
                  </label>
                  <input
                    className="form-input"
                    value={form.accountNumber}
                    disabled={editingSystemCash}
                    onChange={(event) =>
                      setForm({ ...form, accountNumber: event.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">
                    Atas Nama <span className="required">*</span>
                  </label>
                  <input
                    className="form-input"
                    value={form.accountHolder}
                    disabled={editingSystemCash}
                    onChange={(event) =>
                      setForm({ ...form, accountHolder: event.target.value })
                    }
                    placeholder="Nama pemilik rekening"
                  />
                </div>
              </div>
              {!editAccount || (editAccount.transactionCount ?? 0) === 0 ? (
                <div className="form-group">
                  <label className="form-label">Saldo Awal (Rp)</label>
                  <FormattedNumberInput allowDecimal={false}
                    value={form.initialBalance}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        initialBalance: value,
                      })
                    }
                    placeholder="Ketik saldo awal"
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Saldo Awal (Rp)</label>
                  <FormattedNumberInput allowDecimal={false}
                    value={form.initialBalance}
                    onValueChange={() => {}}
                    placeholder="Ketik saldo awal"
                    disabled
                  />
                  <div className="form-hint">
                    Saldo awal tidak dapat diubah karena sudah ada transaksi pada rekening / kas ini.
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Catatan</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  placeholder="Catatan opsional..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
                disabled={savingAccount}
              >
                Batal
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={savingAccount}
              >
                {savingAccount ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageBankAccounts && showTransfer && (
        <div className="modal-overlay" onClick={() => { if (!transferring) setShowTransfer(false); }}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 500 }}
          >
            <div className="modal-header">
              <h3
                className="modal-title"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <ArrowRightLeft size={18} /> Transfer Antar Rekening
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowTransfer(false)}
                disabled={transferring}
              >
                x
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Dari Rekening <span className="required">*</span>
                </label>
                <select
                  className="form-select"
                  value={transferForm.fromAccountRef}
                  disabled={transferring}
                  onChange={(event) =>
                    setTransferForm({
                      ...transferForm,
                      fromAccountRef: event.target.value,
                      toAccountRef:
                        transferForm.toAccountRef === event.target.value
                          ? ""
                          : transferForm.toAccountRef,
                    })
                  }
                >
                  <option value="">-- Pilih sumber --</option>
                  {accounts.map((account) => (
                    <option key={account._id} value={account._id}>
                      {account.bankName} - {account.accountNumber} (
                      {formatBankAccountCurrency(account.currentBalance || 0)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Ke Rekening <span className="required">*</span>
                </label>
                <select
                  className="form-select"
                  value={transferForm.toAccountRef}
                  disabled={transferring}
                  onChange={(event) =>
                    setTransferForm({
                      ...transferForm,
                      toAccountRef: event.target.value,
                    })
                  }
                >
                  <option value="">-- Pilih tujuan --</option>
                  {accounts
                    .filter(
                      (account) => account._id !== transferForm.fromAccountRef,
                    )
                    .map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.bankName} - {account.accountNumber} (
                        {formatBankAccountCurrency(account.currentBalance || 0)})
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Jumlah (Rp) <span className="required">*</span>
                  </label>
                  <FormattedNumberInput allowDecimal={false}
                    value={transferForm.amount}
                    disabled={transferring}
                    onValueChange={(value) =>
                      setTransferForm({
                        ...transferForm,
                        amount: value,
                      })
                    }
                    placeholder="Ketik nominal transfer"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tanggal</label>
                  <input
                    className="form-input"
                    type="date"
                    value={transferForm.date}
                    disabled={transferring}
                    onChange={(event) =>
                      setTransferForm({
                        ...transferForm,
                        date: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowTransfer(false)}
                  disabled={transferring}
                >
                Batal
              </button>
              <button className="btn btn-primary" onClick={handleTransfer} disabled={transferring}>
                <ArrowRightLeft size={16} /> {transferring ? "Memproses..." : "Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageBankAccounts && showAdjust && (
        <div className="modal-overlay" onClick={() => { if (!adjusting) { setShowAdjust(false); setAdjustReview(false); } }}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 500 }}
          >
            <div className="modal-header">
              <h3
                className="modal-title"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <CircleDollarSign size={18} /> {adjustReview ? "Konfirmasi Penyesuaian Saldo" : "Tambah Saldo"}
              </h3>
              <button
                className="modal-close"
                onClick={() => { setShowAdjust(false); setAdjustReview(false); }}
                disabled={adjusting}
              >
                x
              </button>
            </div>
            <div className="modal-body">
              {adjustReview ? (
                <div style={{ border: "1px solid var(--color-gray-200)", borderRadius: 12, padding: "1rem 1.1rem", background: "var(--color-gray-50)", display: "grid", gap: "0.75rem" }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Rekening / Kas</label>
                    <div className="font-medium">
                      {adjustAccount ? `${adjustAccount.bankName} - ${adjustAccount.accountNumber}` : "-"}
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Jenis Penyesuaian</label>
                    <div className="font-medium">
                      {adjustForm.direction === "in" ? "Tambah saldo (+)" : "Kurangi saldo (-)"}
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Nominal (Rp)</label>
                    <div className="font-medium">
                      {formatBankAccountCurrency(adjustForm.amount)}
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Tanggal</label>
                    <div className="font-medium">
                      {adjustForm.date || "-"}
                    </div>
                  </div>
                  {adjustForm.description && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Keterangan</label>
                      <div className="font-medium">{adjustForm.description}</div>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                    <div>Saldo saat ini</div>
                    <div className="font-medium">{formatBankAccountCurrency(adjustAccount?.currentBalance ?? 0)}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                    <div>Penyesuaian</div>
                    <div className="font-medium" style={{ color: adjustForm.direction === "in" ? "var(--color-success)" : "var(--color-danger)" }}>
                      {formatBankAccountCurrency(adjustForm.direction === "in" ? adjustForm.amount : -adjustForm.amount)}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", borderTop: "1px solid var(--color-gray-200)", paddingTop: "0.75rem", fontWeight: 700 }}>
                    <div>Saldo setelah penyesuaian</div>
                    <div>{formatBankAccountCurrency(adjustBalanceAfter)}</div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">
                      Rekening / Kas <span className="required">*</span>
                    </label>
                    <select
                      className="form-select"
                      value={adjustForm.bankAccountRef}
                      disabled={adjusting}
                      onChange={(event) =>
                        setAdjustForm({
                          ...adjustForm,
                          bankAccountRef: event.target.value,
                        })
                      }
                    >
                      <option value="">-- Pilih rekening / kas --</option>
                      {accounts.map((account) => (
                        <option key={account._id} value={account._id}>
                          {account.bankName} - {account.accountNumber} (
                          {formatBankAccountCurrency(account.currentBalance || 0)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Jenis Penyesuaian</label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem" }}>
                      <button
                        type="button"
                        className={adjustForm.direction === "in" ? "btn btn-success" : "btn btn-secondary"}
                        disabled={adjusting}
                        onClick={() => setAdjustForm({ ...adjustForm, direction: "in" })}
                      >
                        Tambah saldo (+)
                      </button>
                      <button
                        type="button"
                        className={adjustForm.direction === "out" ? "btn btn-danger" : "btn btn-secondary"}
                        disabled={adjusting}
                        onClick={() => setAdjustForm({ ...adjustForm, direction: "out" })}
                      >
                        Kurangi saldo (-)
                      </button>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">
                        Nominal (Rp) <span className="required">*</span>
                      </label>
                      <FormattedNumberInput allowDecimal={false}
                        value={adjustForm.amount}
                        disabled={adjusting}
                        onValueChange={(value) =>
                          setAdjustForm({
                            ...adjustForm,
                            amount: value,
                          })
                        }
                        placeholder="Ketik nominal penyesuaian"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Tanggal <span className="required">*</span>
                      </label>
                      <input
                        className="form-input"
                        type="date"
                        value={adjustForm.date}
                        disabled={adjusting}
                        onChange={(event) =>
                          setAdjustForm({
                            ...adjustForm,
                            date: event.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Keterangan</label>
                    <input
                      className="form-input"
                      type="text"
                      value={adjustForm.description}
                      disabled={adjusting}
                      onChange={(event) =>
                        setAdjustForm({
                          ...adjustForm,
                          description: event.target.value,
                        })
                      }
                      placeholder="Contoh: koreksi saldo awal, penyesuaian bank"
                    />
                  </div>
                  {adjustAccount && (
                    <div className="text-muted" style={{ fontSize: "0.8rem" }}>
                      Saldo saat ini: {formatBankAccountCurrency(adjustAccount.currentBalance ?? 0)} ·
                      Setelah penyesuaian: {formatBankAccountCurrency(adjustBalanceAfter)}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    if (adjustReview) {
                      setAdjustReview(false);
                    } else {
                      setShowAdjust(false);
                      setAdjustReview(false);
                    }
                  }}
                  disabled={adjusting}
                >
                {adjustReview ? "Kembali" : "Batal"}
              </button>
              {adjustReview ? (
                <button className="btn btn-primary" onClick={handleAdjust} disabled={adjusting || !adjustForm.bankAccountRef || !adjustForm.amount || adjustForm.amount <= 0}>
                  <CircleDollarSign size={16} /> {adjusting ? "Menyimpan..." : "Simpan Penyesuaian"}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => setAdjustReview(true)} disabled={!adjustForm.bankAccountRef || !adjustForm.amount || adjustForm.amount <= 0 || !adjustForm.date}>
                  Lanjutkan
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {canDeleteBankAccounts && deleteConfirm && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (deletingAccountId !== deleteConfirm) {
              setDeleteConfirm(null);
            }
          }}
        >
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 400 }}
          >
            <div className="modal-header">
              <h3 className="modal-title">Nonaktifkan Rekening?</h3>
            </div>
            <div className="modal-body">
              <p>
                Rekening akan dinonaktifkan. Data transaksi tetap tersimpan.
              </p>
            </div>
            <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deletingAccountId === deleteConfirm}
                >
                  Batal
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={deletingAccountId === deleteConfirm}
                >
                  {deletingAccountId === deleteConfirm ? "Menyimpan..." : "Nonaktifkan"}
                </button>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}

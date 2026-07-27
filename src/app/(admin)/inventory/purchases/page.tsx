'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, Plus, Receipt, Search } from 'lucide-react';

import AppPagination from '@/components/AppPagination';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import { exportToExcel } from '@/lib/export';
import {
  buildInventoryReportPeriodLabel,
  getDefaultInventoryReportPeriod,
  getInventoryReportDateRange,
  getInventoryReportYearOptions,
  INVENTORY_REPORT_MONTH_NAMES,
  isDateInInventoryReportRange,
  type InventoryReportPeriodMode,
} from '@/lib/inventory-report-period';
import {
  getDerivedPurchasePaymentStatus,
  getDerivedPurchaseReceiptStatus,
  getPurchasePaymentBadgeClass,
  getPurchaseReceiptBadgeClass,
  isCancelledPurchase,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
} from '@/lib/inventory';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import type { Purchase, PurchaseStatus } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

const STATUS_OPTIONS: Array<{ value: PurchaseStatus; label: string }> = [
  { value: 'ORDERED', label: PURCHASE_STATUS_LABELS.ORDERED },
  { value: 'PARTIALLY_RECEIVED', label: PURCHASE_STATUS_LABELS.PARTIALLY_RECEIVED },
  { value: 'RECEIVED', label: PURCHASE_STATUS_LABELS.RECEIVED },
  { value: 'PARTIALLY_PAID', label: PURCHASE_STATUS_LABELS.PARTIALLY_PAID },
  { value: 'PAID', label: PURCHASE_STATUS_LABELS.PAID },
  { value: 'CANCELLED', label: PURCHASE_STATUS_LABELS.CANCELLED },
];

function PurchaseLifecycleBadges({ purchase }: { purchase: Purchase }) {
  const receiptStatus = getDerivedPurchaseReceiptStatus(purchase);
  const paymentStatus = getDerivedPurchasePaymentStatus(purchase);

  return (
    <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'start' }}>
      <span className={`badge ${getPurchaseReceiptBadgeClass(receiptStatus)}`}>
        Terima: {PURCHASE_RECEIPT_STATUS_LABELS[receiptStatus]}
      </span>
      <span className={`badge ${getPurchasePaymentBadgeClass(paymentStatus)}`}>
        Bayar: {PURCHASE_PAYMENT_STATUS_LABELS[paymentStatus]}
      </span>
    </div>
  );
}

export default function PurchasesPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const defaultPeriod = getDefaultInventoryReportPeriod();
  const [allFilteredPurchases, setAllFilteredPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [periodMode, setPeriodMode] = useState<InventoryReportPeriodMode>('month');
  const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
  const [year, setYear] = useState(defaultPeriod.year);
  const [dateFrom, setDateFrom] = useState(`${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`);
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const canCreatePurchase = user ? hasPermission(user, 'purchases', 'create') : false;
  const canExportPurchases = user ? hasPermission(user, 'purchases', 'export') : false;
  const canOpenSuppliers = user ? hasPageAccess(user, 'suppliers') : false;
  const canOpenStockReport = user ? hasPageAccess(user, 'warehouseItems') : false;
  const today = getBusinessDateValue();
  const dateRange = useMemo(
    () => getInventoryReportDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
    [dateFrom, dateTo, monthIndex, periodMode, year],
  );
  const yearOptions = useMemo(() => getInventoryReportYearOptions(year), [year]);
  const isValidRange = Boolean(dateRange.startDate && dateRange.endDate && dateRange.startDate <= dateRange.endDate);
  const periodLabel = buildInventoryReportPeriodLabel({
    mode: periodMode,
    monthIndex,
    year,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });
  const periodPurchases = useMemo(
    () =>
      isValidRange
        ? allFilteredPurchases.filter((purchase) => isDateInInventoryReportRange(purchase.orderDate, dateRange.startDate, dateRange.endDate))
        : [],
    [allFilteredPurchases, dateRange.endDate, dateRange.startDate, isValidRange],
  );
  const filteredTotal = periodPurchases.length;
  const purchases = useMemo(
    () => periodPurchases.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE),
    [page, periodPurchases],
  );
  const openCount = useMemo(
    () =>
      periodPurchases.filter((purchase) =>
        !isCancelledPurchase(purchase)
        && getDerivedPurchasePaymentStatus(purchase) !== 'PAID'
        && Number(purchase.outstandingAmount || 0) > 0
      ).length,
    [periodPurchases]
  );
  const overdueCount = useMemo(
    () =>
      periodPurchases.filter((purchase) =>
        !isCancelledPurchase(purchase)
        && purchase.dueDate
        && purchase.dueDate < today
        && Number(purchase.outstandingAmount || 0) > 0
      ).length,
    [periodPurchases, today]
  );
  const outstandingTotal = useMemo(
    () =>
      periodPurchases.reduce(
        (sum, purchase) => sum + (isCancelledPurchase(purchase) ? 0 : Number(purchase.outstandingAmount || 0)),
        0
      ),
    [periodPurchases]
  );
  const paidCount = useMemo(
    () => periodPurchases.filter((purchase) => !isCancelledPurchase(purchase) && getDerivedPurchasePaymentStatus(purchase) === 'PAID').length,
    [periodPurchases]
  );
  const purchaseAmountForPeriod = useMemo(
    () => periodPurchases.reduce((sum, purchase) => sum + (isCancelledPurchase(purchase) ? 0 : Number(purchase.totalAmount || 0)), 0),
    [periodPurchases],
  );
  const activeSupplierCount = useMemo(
    () => new Set(periodPurchases.filter((purchase) => !isCancelledPurchase(purchase)).map((purchase) => purchase.supplierRef).filter(Boolean)).size,
    [periodPurchases],
  );

  const buildQuery = useCallback((targetPageSize = 500) => {
    const params = new URLSearchParams({ entity: 'purchases', page: '1', pageSize: String(targetPageSize), sortField: 'orderDate', sortDir: 'desc' });
    if (search.trim()) {
      params.set('q', search.trim());
      params.set('searchFields', 'purchaseNumber,supplierName,notes,status');
    }
    if (statusFilter) {
      params.set('filter', JSON.stringify({ status: statusFilter }));
    }
    return params.toString();
  }, [search, statusFilter]);

  const loadPurchases = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchAllAdminCollectionData<Purchase>(`/api/data?${buildQuery(500)}`, 'Gagal memuat pembelian', 500);
      setAllFilteredPurchases(rows || []);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal memuat pembelian');
    } finally {
      setLoading(false);
    }
  }, [addToast, buildQuery]);

  useEffect(() => { void loadPurchases(); }, [loadPurchases]);
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, monthIndex, periodMode, search, statusFilter, year]);

  const handleExport = async () => {
    if (!canExportPurchases) return;
    try {
      await exportToExcel(
        periodPurchases.map((purchase) => ({
          nomorPembelian: purchase.purchaseNumber,
          supplier: purchase.supplierName || '-',
          tanggalPembelian: purchase.orderDate,
          jatuhTempo: purchase.dueDate || '-',
          total: Number(purchase.totalAmount || 0),
          dibayar: Number(purchase.paidAmount || 0),
          outstanding: Number(purchase.outstandingAmount || 0),
          statusPenerimaan: PURCHASE_RECEIPT_STATUS_LABELS[getDerivedPurchaseReceiptStatus(purchase)],
          statusPembayaran: PURCHASE_PAYMENT_STATUS_LABELS[getDerivedPurchasePaymentStatus(purchase)],
          catatan: purchase.notes || '',
        })),
        [
          { header: 'Nomor Pembelian', key: 'nomorPembelian', width: 20 },
          { header: 'Supplier', key: 'supplier', width: 28 },
          { header: 'Tanggal Pembelian', key: 'tanggalPembelian', width: 16 },
          { header: 'Jatuh Tempo', key: 'jatuhTempo', width: 16 },
          { header: 'Total', key: 'total', width: 18 },
          { header: 'Dibayar', key: 'dibayar', width: 18 },
          { header: 'Sisa Tagihan', key: 'outstanding', width: 18 },
          { header: 'Status Penerimaan', key: 'statusPenerimaan', width: 20 },
          { header: 'Status Pembayaran', key: 'statusPembayaran', width: 20 },
          { header: 'Catatan', key: 'catatan', width: 30 },
        ],
        `pembelian-${periodLabel.replace(/\s+/g, '-')}`,
        'Pembelian',
        {
          title: 'Daftar Pembelian Supplier',
          subtitle: `${periodLabel} | Status: ${statusFilter ? PURCHASE_STATUS_LABELS[statusFilter as PurchaseStatus] : 'Semua status'}`,
        },
      );
      addToast('success', 'Excel pembelian berhasil di-download');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel pembelian');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left"><h1 className="page-title">Pembelian</h1></div>
        <div className="page-actions">
          {canOpenStockReport && <Link href="/inventory/stock-recap" className="btn btn-secondary">Laporan Stok</Link>}
          {canExportPurchases && <button className="btn btn-secondary" onClick={() => void handleExport()}><FileDown size={18} /> Excel</button>}
          {canCreatePurchase && <Link href="/inventory/purchases/new" className="btn btn-primary"><Plus size={18} /> Buat Pembelian</Link>}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Sisa Tagihan</div><div className="kpi-value">{formatCurrency(outstandingTotal)}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Belum Lunas</div><div className="kpi-value">{openCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Jatuh Tempo</div><div className="kpi-value">{overdueCount}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Pembelian Periode</div><div className="kpi-value">{formatCurrency(purchaseAmountForPeriod)}</div><div className="kpi-sub">{periodPurchases.length} dokumen</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Supplier Terlibat</div><div className="kpi-value">{activeSupplierCount}</div><div className="kpi-sub">{paidCount} pembelian sudah lunas</div></div></div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left purchase-filter-toolbar">
            <div className="table-search purchase-search">
              <Search size={16} className="table-search-icon" />
              <input
                className="table-search-input"
                placeholder="Cari nomor pembelian, supplier, catatan..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select className="form-select purchase-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Semua Status</option>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select className="form-select purchase-status-filter" value={periodMode} onChange={(event) => setPeriodMode(event.target.value as InventoryReportPeriodMode)}>
              <option value="month">Bulanan</option>
              <option value="year">Tahunan</option>
              <option value="custom">Rentang Tanggal</option>
            </select>
            {periodMode === 'month' && (
              <select className="form-select purchase-status-filter" value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))}>
                {INVENTORY_REPORT_MONTH_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
              </select>
            )}
            {periodMode !== 'custom' && (
              <select className="form-select purchase-status-filter" value={year} onChange={(event) => setYear(Number(event.target.value) || defaultPeriod.year)}>
                {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            )}
            {periodMode === 'custom' && (
              <>
                <input type="date" className="form-input purchase-status-filter" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                <input type="date" className="form-input purchase-status-filter" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </>
            )}
          </div>
        </div>
        {!isValidRange && (
          <div style={{ padding: '0 1.5rem 1rem' }}>
            <div className="info-banner">
              <div className="info-banner-title">Periode belum valid</div>
              <div className="info-banner-text">Lengkapi tanggal awal dan akhir, lalu pastikan tanggal awal tidak melebihi tanggal akhir.</div>
            </div>
          </div>
        )}

        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr><th>Nomor</th><th>Supplier</th><th>Tanggal</th><th>Jatuh Tempo</th><th>Total</th><th>Sisa Tagihan</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {loading ? [1, 2, 3].map((index) => <tr key={index}>{[1, 2, 3, 4, 5, 6, 7, 8].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>) : filteredTotal === 0 ? (
                <tr><td colSpan={8}><div className="empty-state"><Receipt size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada pembelian supplier</div></div></td></tr>
              ) : purchases.map((purchase) => (
                <tr key={purchase._id}>
                  <td className="font-mono">{purchase.purchaseNumber}</td>
                  <td>
                    <div className="font-semibold">
                      {canOpenSuppliers && purchase.supplierRef ? (
                        <Link href={`/suppliers/${purchase.supplierRef}`} style={{ color: 'var(--color-primary)' }}>
                          {purchase.supplierName || '-'}
                        </Link>
                      ) : (purchase.supplierName || '-')}
                    </div>
                    <div className="text-muted text-xs">{purchase.notes || 'Tanpa catatan'}</div>
                  </td>
                  <td>{formatDate(purchase.orderDate)}</td>
                  <td>{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</td>
                  <td>{formatCurrency(Number(purchase.totalAmount || 0))}</td>
                  <td>{formatCurrency(Number(purchase.outstandingAmount || 0))}</td>
                  <td><PurchaseLifecycleBadges purchase={purchase} /></td>
                  <td><Link href={`/inventory/purchases/${purchase._id}`} className="table-action-btn">Lihat Detail</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && (
          <div className="mobile-record-list">
            {filteredTotal === 0 ? (
              <div className="mobile-record-card"><div className="mobile-record-title">Belum ada pembelian supplier</div><div className="mobile-record-subtitle">Buat pembelian baru untuk mulai mencatat stok masuk dan hutang supplier.</div></div>
            ) : purchases.map((purchase) => (
              <div key={purchase._id} className="mobile-record-card">
                <div className="mobile-record-header">
                  <div>
                    <div className="mobile-record-title">{purchase.purchaseNumber}</div>
                    <div className="mobile-record-subtitle">
                      {canOpenSuppliers && purchase.supplierRef ? (
                        <Link href={`/suppliers/${purchase.supplierRef}`} style={{ color: 'var(--color-primary)' }}>
                          {purchase.supplierName || '-'}
                        </Link>
                      ) : (purchase.supplierName || '-')}
                    </div>
                  </div>
                  <PurchaseLifecycleBadges purchase={purchase} />
                </div>
                <div className="mobile-record-grid">
                  <div className="mobile-record-field"><span className="mobile-record-label">Tanggal</span><span className="mobile-record-value">{formatDate(purchase.orderDate)}</span></div>
                  <div className="mobile-record-field"><span className="mobile-record-label">Jatuh Tempo</span><span className="mobile-record-value">{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</span></div>
                  <div className="mobile-record-field"><span className="mobile-record-label">Total</span><span className="mobile-record-value">{formatCurrency(Number(purchase.totalAmount || 0))}</span></div>
                  <div className="mobile-record-field"><span className="mobile-record-label">Sisa Tagihan</span><span className="mobile-record-value">{formatCurrency(Number(purchase.outstandingAmount || 0))}</span></div>
                  <div className="mobile-record-field mobile-record-field-full"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{purchase.notes || '-'}</span></div>
                </div>
                <div className="mobile-record-actions"><Link href={`/inventory/purchases/${purchase._id}`} className="btn btn-secondary">Lihat Detail</Link></div>
              </div>
            ))}
          </div>
        )}

        {filteredTotal > 0 && (
          <AppPagination
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={filteredTotal}
            onPageChange={setPage}
            info={({ startIndex, endIndex, totalItems }) => <>Menampilkan {startIndex}-{endIndex} dari {totalItems} pembelian</>}
          />
        )}
      </div>
    </div>
  );
}

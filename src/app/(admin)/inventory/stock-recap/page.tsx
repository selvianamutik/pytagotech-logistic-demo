'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer, Search } from 'lucide-react';

import PageBackButton from '@/components/PageBackButton';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { exportToExcel } from '@/lib/export';
import {
  buildInventoryReportPeriodLabel,
  getDefaultInventoryReportPeriod,
  getInventoryReportDateRange,
  getInventoryReportYearOptions,
  INVENTORY_REPORT_MONTH_NAMES,
  type InventoryReportPeriodMode,
} from '@/lib/inventory-report-period';
import {
  buildInventoryStockRecapRows,
  formatStockRecapQty,
  INVENTORY_STOCK_RECAP_STATUS_BADGES,
  INVENTORY_STOCK_RECAP_STATUS_LABELS,
  summarizeInventoryStockRecapRows,
} from '@/lib/inventory-stock-recap';
import { hasPageAccess, hasPermission } from '@/lib/rbac';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, escapePrintHtml } from '@/lib/print';
import type { StockMovement, WarehouseItem } from '@/lib/types';

import { useApp, useToast } from '../../layout';

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status' },
  { value: 'OUT_OF_STOCK', label: 'Habis' },
  { value: 'LOW_STOCK', label: 'Menipis' },
  { value: 'OK', label: 'Aman' },
  { value: 'INACTIVE', label: 'Nonaktif' },
] as const;

export default function InventoryStockRecapPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const defaultPeriod = getDefaultInventoryReportPeriod();
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodMode, setPeriodMode] = useState<InventoryReportPeriodMode>('month');
  const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
  const [year, setYear] = useState(defaultPeriod.year);
  const [dateFrom, setDateFrom] = useState(`${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`);
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const canViewPage = user ? hasPageAccess(user, 'warehouseItems') : false;
  const canOpenItemDetail = user ? hasPageAccess(user, 'warehouseItems') : false;
  const canExport = user ? hasPermission(user, 'warehouseItems', 'export') : false;
  const canPrint = user ? hasPermission(user, 'warehouseItems', 'print') : false;

  useEffect(() => {
    async function loadData() {
      if (!user || !canViewPage) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [itemRows, movementRows] = await Promise.all([
          fetchAllAdminCollectionData<WarehouseItem>(
            '/api/data?entity=warehouse-items&sortField=itemCode&sortDir=asc',
            'Gagal memuat barang gudang',
            500,
          ),
          fetchAllAdminCollectionData<StockMovement>(
            '/api/data?entity=stock-movements&sortField=movementDate&sortDir=asc',
            'Gagal memuat mutasi stok',
            500,
          ),
        ]);
        setItems(itemRows || []);
        setMovements(movementRows || []);
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'Gagal memuat laporan stok gudang');
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [addToast, canViewPage, user]);

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
  const baseRows = useMemo(
    () =>
      isValidRange
        ? buildInventoryStockRecapRows({
            items,
            movements,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
          })
        : [],
    [dateRange.endDate, dateRange.startDate, isValidRange, items, movements],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.category).filter(Boolean) as string[])).sort((left, right) => left.localeCompare(right)),
    [items],
  );
  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return baseRows.filter((row) => {
      if (query && !`${row.itemCode} ${row.itemName} ${row.category}`.toLowerCase().includes(query)) return false;
      if (category && row.category !== category) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      return true;
    });
  }, [baseRows, category, search, statusFilter]);
  const summary = useMemo(() => summarizeInventoryStockRecapRows(filteredRows), [filteredRows]);

  const resetFilters = () => {
    setSearch('');
    setCategory('');
    setStatusFilter('');
  };

  const handleExport = async () => {
    if (!canExport) return;
    try {
      await exportToExcel(
        filteredRows.map((row) => ({
          kode: row.itemCode,
          barang: row.itemName,
          kategori: row.category,
          satuan: row.unit,
          stokAwal: row.openingStock,
          masuk: row.incomingQty,
          keluar: row.outgoingQty,
          adjustment: row.adjustmentQty,
          stokAkhir: row.endingStock,
          minStok: row.minStockQty,
          mutasi: row.movementCount,
          status: INVENTORY_STOCK_RECAP_STATUS_LABELS[row.status],
        })),
        [
          { header: 'Kode', key: 'kode', width: 16 },
          { header: 'Barang', key: 'barang', width: 30 },
          { header: 'Kategori', key: 'kategori', width: 18 },
          { header: 'Satuan', key: 'satuan', width: 12 },
          { header: 'Stok Awal', key: 'stokAwal', width: 14 },
          { header: 'Masuk', key: 'masuk', width: 14 },
          { header: 'Keluar', key: 'keluar', width: 14 },
          { header: 'Adjustment', key: 'adjustment', width: 14 },
          { header: 'Stok Akhir', key: 'stokAkhir', width: 14 },
          { header: 'Min Stok', key: 'minStok', width: 14 },
          { header: 'Mutasi', key: 'mutasi', width: 12 },
          { header: 'Status', key: 'status', width: 14 },
        ],
        `laporan-stok-gudang-${periodLabel.replace(/\s+/g, '-')}`,
        'Laporan Stok Gudang',
        {
          title: 'Laporan Stok Gudang',
          subtitle: periodLabel,
          metadata: [
            { label: 'Periode', value: periodLabel },
            { label: 'Jumlah Item', value: filteredRows.length },
          ],
          emptyMessage: 'Tidak ada barang gudang pada filter ini',
        },
      );
      addToast('success', 'Excel laporan stok gudang berhasil di-download');
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel laporan stok gudang');
    }
  };

  const buildPrintHtml = () => {
    const rowsHtml = filteredRows.length > 0
      ? filteredRows.map((row, index) => `
          <tr>
            <td class="c">${index + 1}</td>
            <td>
              <div class="b">${escapePrintHtml(row.itemName)}</div>
              <div class="muted">${escapePrintHtml(row.itemCode)}</div>
            </td>
            <td>${escapePrintHtml(row.category || '-')}</td>
            <td class="r">${escapePrintHtml(formatStockRecapQty(row.openingStock, row.unit))}</td>
            <td class="r">${escapePrintHtml(formatStockRecapQty(row.incomingQty, row.unit))}</td>
            <td class="r">${escapePrintHtml(formatStockRecapQty(row.outgoingQty, row.unit))}</td>
            <td class="r">${escapePrintHtml(formatStockRecapQty(row.adjustmentQty, row.unit))}</td>
            <td class="r b">${escapePrintHtml(formatStockRecapQty(row.endingStock, row.unit))}</td>
            <td class="r">${escapePrintHtml(formatStockRecapQty(row.minStockQty, row.unit))}</td>
            <td>${escapePrintHtml(INVENTORY_STOCK_RECAP_STATUS_LABELS[row.status])}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="10" class="c muted">Tidak ada data stok gudang pada filter ini.</td></tr>';

    return `
      <div class="stats-row">
        <div class="stat-box"><div class="stat-label">Item Aktif</div><div class="stat-value">${summary.activeItemCount}</div></div>
        <div class="stat-box"><div class="stat-label">Item Masuk</div><div class="stat-value">${summary.incomingItemCount}</div></div>
        <div class="stat-box"><div class="stat-label">Item Keluar</div><div class="stat-value">${summary.outgoingItemCount}</div></div>
        <div class="stat-box"><div class="stat-label">Stok Perlu Perhatian</div><div class="stat-value">${summary.lowStockCount + summary.outOfStockCount}</div></div>
      </div>
      <div class="report-meta">
        <div><span class="b">Periode:</span> ${escapePrintHtml(periodLabel)}</div>
        <div><span class="b">Kategori:</span> ${escapePrintHtml(category || 'Semua Kategori')}</div>
        <div><span class="b">Status:</span> ${escapePrintHtml(statusFilter ? INVENTORY_STOCK_RECAP_STATUS_LABELS[statusFilter as keyof typeof INVENTORY_STOCK_RECAP_STATUS_LABELS] : 'Semua Status')}</div>
        <div><span class="b">Pencarian:</span> ${escapePrintHtml(search.trim() || '-')}</div>
      </div>
      <div class="section-title">Rincian Stok Gudang</div>
      <table class="stock-report-table">
        <thead>
          <tr>
            <th class="c">No</th>
            <th>Barang</th>
            <th>Kategori</th>
            <th class="r">Stok Awal</th>
            <th class="r">Masuk</th>
            <th class="r">Keluar</th>
            <th class="r">Adjustment</th>
            <th class="r">Stok Akhir</th>
            <th class="r">Min Stok</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  };

  const handlePrintPreview = async () => {
    if (!canPrint) return;
    const printWindow = openPrintWindow('Menyiapkan preview laporan stok gudang...');
    if (!printWindow) {
      addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba print lagi.');
      return;
    }

    try {
      const company = await fetchCompanyProfile();
      openBrandedPrint({
        title: 'Laporan Stok Gudang',
        subtitle: periodLabel,
        company,
        targetWindow: printWindow,
        autoPrint: false,
        bodyHtml: buildPrintHtml(),
        extraStyles: `
          body { max-width: 1120px; }
          .report-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.35rem 1rem; margin-bottom: 1rem; color: #334155; font-size: 0.82rem; }
          .stock-report-table { table-layout: fixed; }
          .stock-report-table th, .stock-report-table td { font-size: 0.76rem; vertical-align: top; }
          .stock-report-table th:nth-child(1) { width: 5%; }
          .stock-report-table th:nth-child(2) { width: 22%; }
          .stock-report-table th:nth-child(3) { width: 12%; }
          .stock-report-table th:nth-child(10) { width: 10%; }
          .muted { color: #64748b; font-size: 0.72rem; margin-top: 0.1rem; }
          @page { size: A4 landscape; margin: 10mm; }
          @media print {
            body { max-width: none; }
            .report-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          }
        `,
      });
    } catch (error) {
      try { printWindow.close(); } catch {}
      addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan preview laporan stok gudang');
    }
  };

  if (!user || !canViewPage) {
    return (
      <div className="card">
        <div className="card-body">Role Anda tidak punya akses ke laporan stok gudang.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <PageBackButton href="/inventory" />
          <h1 className="page-title">Laporan Stok Gudang</h1>
        </div>
        <div className="page-actions">
          {canPrint && (
            <button className="btn btn-secondary" onClick={() => void handlePrintPreview()}>
              <Printer size={18} /> Print Preview
            </button>
          )}
          {canExport && (
            <button className="btn btn-secondary" onClick={() => void handleExport()}>
              <FileDown size={18} /> Excel
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Periode Laporan</span>
        </div>
        <div className="card-body">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Mode Periode</label>
              <select className="form-select" value={periodMode} onChange={(event) => setPeriodMode(event.target.value as InventoryReportPeriodMode)}>
                <option value="month">Bulanan</option>
                <option value="year">Tahunan</option>
                <option value="custom">Rentang Tanggal</option>
              </select>
            </div>
            {periodMode === 'month' && (
              <div className="form-group">
                <label className="form-label">Bulan</label>
                <select className="form-select" value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))}>
                  {INVENTORY_REPORT_MONTH_NAMES.map((name, index) => (
                    <option key={name} value={index}>{name}</option>
                  ))}
                </select>
              </div>
            )}
            {periodMode !== 'custom' && (
              <div className="form-group">
                <label className="form-label">Tahun</label>
                <select className="form-select" value={year} onChange={(event) => setYear(Number(event.target.value) || defaultPeriod.year)}>
                  {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
            )}
          </div>
          {periodMode === 'custom' && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Dari Tanggal</label>
                <input type="date" className="form-input" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Sampai Tanggal</label>
                <input type="date" className="form-input" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </div>
            </div>
          )}
          {!isValidRange && (
            <div className="info-banner" style={{ marginTop: '1rem' }}>
              <div className="info-banner-title">Periode belum valid</div>
              <div className="info-banner-text">Lengkapi tanggal awal dan akhir, lalu pastikan tanggal awal tidak melebihi tanggal akhir.</div>
            </div>
          )}
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Item Aktif</div><div className="kpi-value">{summary.activeItemCount}</div><div className="kpi-sub">{summary.itemCount} item tampil</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Item Masuk</div><div className="kpi-value">{summary.incomingItemCount}</div><div className="kpi-sub">{summary.movedItemCount} item bergerak</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Item Keluar</div><div className="kpi-value">{summary.outgoingItemCount}</div><div className="kpi-sub">{summary.adjustedItemCount} item adjustment</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Stok Perlu Perhatian</div><div className="kpi-value">{summary.lowStockCount + summary.outOfStockCount}</div><div className="kpi-sub">{summary.outOfStockCount} item habis</div></div></div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left purchase-filter-toolbar">
            <div className="table-search purchase-search">
              <Search size={16} className="table-search-icon" />
              <input className="table-search-input" placeholder="Cari kode, barang, kategori..." value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <select className="form-select purchase-status-filter" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Semua Kategori</option>
              {categoryOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select className="form-select purchase-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button className="btn btn-secondary" onClick={resetFilters}>Reset</button>
          </div>
        </div>

        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr>
                <th>Barang</th>
                <th>Kategori</th>
                <th>Stok Awal</th>
                <th>Masuk</th>
                <th>Keluar</th>
                <th>Adjustment</th>
                <th>Stok Akhir</th>
                <th>Min Stok</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? [1, 2, 3].map((index) => (
                <tr key={index}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((cell) => <td key={cell}><div className="skeleton skeleton-text" /></td>)}</tr>
              )) : filteredRows.length === 0 ? (
                <tr><td colSpan={9}><div className="empty-state"><div className="empty-state-title">Tidak ada data laporan stok gudang</div></div></td></tr>
              ) : filteredRows.map((row) => (
                <tr key={row.warehouseItemRef}>
                  <td>
                    <div className="font-semibold">
                      {canOpenItemDetail ? (
                        <Link href={`/inventory/items/${row.warehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>{row.itemName}</Link>
                      ) : row.itemName}
                    </div>
                    <div className="text-muted text-xs">{row.itemCode}</div>
                  </td>
                  <td>{row.category}</td>
                  <td>{formatStockRecapQty(row.openingStock, row.unit)}</td>
                  <td>{formatStockRecapQty(row.incomingQty, row.unit)}</td>
                  <td>{formatStockRecapQty(row.outgoingQty, row.unit)}</td>
                  <td>{formatStockRecapQty(row.adjustmentQty, row.unit)}</td>
                  <td className="font-semibold">{formatStockRecapQty(row.endingStock, row.unit)}</td>
                  <td>{formatStockRecapQty(row.minStockQty, row.unit)}</td>
                  <td><span className={`badge ${INVENTORY_STOCK_RECAP_STATUS_BADGES[row.status]}`}>{INVENTORY_STOCK_RECAP_STATUS_LABELS[row.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && (
          <div className="mobile-record-list">
            {filteredRows.length === 0 ? (
              <div className="mobile-record-card"><div className="mobile-record-title">Tidak ada data laporan stok gudang</div></div>
            ) : filteredRows.map((row) => (
              <div key={row.warehouseItemRef} className="mobile-record-card">
                <div className="mobile-record-header">
                  <div>
                    <div className="mobile-record-title">
                      {canOpenItemDetail ? <Link href={`/inventory/items/${row.warehouseItemRef}`}>{row.itemName}</Link> : row.itemName}
                    </div>
                    <div className="mobile-record-subtitle">{row.itemCode} - {row.category}</div>
                  </div>
                  <span className={`badge ${INVENTORY_STOCK_RECAP_STATUS_BADGES[row.status]}`}>{INVENTORY_STOCK_RECAP_STATUS_LABELS[row.status]}</span>
                </div>
                <div className="mobile-record-grid">
                  <div className="mobile-record-field"><span className="mobile-record-label">Stok Awal</span><span className="mobile-record-value">{formatStockRecapQty(row.openingStock, row.unit)}</span></div>
                  <div className="mobile-record-field"><span className="mobile-record-label">Masuk</span><span className="mobile-record-value">{formatStockRecapQty(row.incomingQty, row.unit)}</span></div>
                  <div className="mobile-record-field"><span className="mobile-record-label">Keluar</span><span className="mobile-record-value">{formatStockRecapQty(row.outgoingQty, row.unit)}</span></div>
                  <div className="mobile-record-field"><span className="mobile-record-label">Stok Akhir</span><span className="mobile-record-value">{formatStockRecapQty(row.endingStock, row.unit)}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

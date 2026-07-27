'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BarChart3 } from 'lucide-react';

import PageBackButton from '@/components/PageBackButton';
import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
  filterMaterialUsageRows,
  getMaintenanceMaterialUsageRows,
  summarizeMaterialUsageRows,
} from '@/lib/inventory-material-usage';
import {
  getDefaultInventoryReportPeriod,
  getInventoryReportDateRange,
  getInventoryReportYearOptions,
  INVENTORY_REPORT_MONTH_NAMES,
  type InventoryReportPeriodMode,
} from '@/lib/inventory-report-period';
import { formatInventoryQuantity } from '@/lib/inventory';
import { hasPageAccess } from '@/lib/rbac';
import type { Maintenance, Vehicle, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../../layout';

export default function InventoryMaterialUsagePage() {
  const searchParams = useSearchParams();
  const { user } = useApp();
  const { addToast } = useToast();
  const defaultPeriod = getDefaultInventoryReportPeriod();

  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodMode, setPeriodMode] = useState<InventoryReportPeriodMode>('month');
  const [monthIndex, setMonthIndex] = useState(defaultPeriod.monthIndex);
  const [year, setYear] = useState(defaultPeriod.year);
  const [dateFrom, setDateFrom] = useState(`${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`);
  const [dateTo, setDateTo] = useState('');
  const [vehicleRef, setVehicleRef] = useState('');
  const [category, setCategory] = useState('');
  const [itemRef, setItemRef] = useState(searchParams.get('itemRef') || '');

  const canOpenVehicles = user ? hasPageAccess(user, 'vehicles') : false;
  const canOpenItems = user ? hasPageAccess(user, 'warehouseItems') : false;
  const canViewPage = user ? hasPageAccess(user, 'maintenance') : false;

  useEffect(() => {
    setItemRef(searchParams.get('itemRef') || '');
  }, [searchParams]);

  useEffect(() => {
    async function loadData() {
      if (!user || !canViewPage) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [maintenanceRows, vehicleRows, itemRows] = await Promise.all([
          fetchAllAdminCollectionData<Maintenance>(
            `/api/data?entity=maintenances&filter=${encodeURIComponent(JSON.stringify({ status: 'DONE' }))}&sortField=completedDate&sortDir=desc`,
            'Gagal memuat pemakaian maintenance',
          ),
          canOpenVehicles
            ? fetchAllAdminCollectionData<Vehicle>('/api/data?entity=vehicles&sortField=plateNumber&sortDir=asc', 'Gagal memuat kendaraan')
            : Promise.resolve([]),
          canOpenItems
            ? fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&sortField=itemCode&sortDir=asc', 'Gagal memuat barang gudang')
            : Promise.resolve([]),
        ]);
        setMaintenances(maintenanceRows || []);
        setVehicles((vehicleRows || []).filter((vehicle) => vehicle.status !== 'SOLD'));
        setWarehouseItems((itemRows || []).filter((item) => item.active !== false));
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'Gagal memuat laporan pemakaian barang');
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [addToast, canOpenItems, canOpenVehicles, canViewPage, user]);

  const baseRows = useMemo(
    () => getMaintenanceMaterialUsageRows(maintenances),
    [maintenances],
  );
  const dateRange = useMemo(
    () => getInventoryReportDateRange({ mode: periodMode, monthIndex, year, dateFrom, dateTo }),
    [dateFrom, dateTo, monthIndex, periodMode, year],
  );
  const yearOptions = useMemo(() => getInventoryReportYearOptions(year), [year]);
  const isValidRange = Boolean(dateRange.startDate && dateRange.endDate && dateRange.startDate <= dateRange.endDate);
  const filteredRows = useMemo(
    () =>
      isValidRange
        ? filterMaterialUsageRows(baseRows, {
            dateFrom: dateRange.startDate,
            dateTo: dateRange.endDate,
            vehicleRef: vehicleRef || undefined,
            category: category || undefined,
            warehouseItemRef: itemRef || undefined,
          }).sort((left, right) =>
            `${right.completedDate}-${right.maintenanceId}-${right.warehouseItemRef}`.localeCompare(
              `${left.completedDate}-${left.maintenanceId}-${left.warehouseItemRef}`,
            ),
          )
        : [],
    [baseRows, category, dateRange.endDate, dateRange.startDate, isValidRange, itemRef, vehicleRef],
  );
  const summary = useMemo(
    () => summarizeMaterialUsageRows(filteredRows),
    [filteredRows],
  );
  const categoryOptions = useMemo(
    () =>
      Array.from(new Set(baseRows.map((row) => row.category).filter(Boolean) as string[])).sort((left, right) =>
        left.localeCompare(right),
      ),
    [baseRows],
  );
  const itemOptions = useMemo(() => {
    if (warehouseItems.length > 0) {
      return warehouseItems.map((item) => ({
        value: item._id,
        label: `${item.itemCode} - ${item.name}`,
      }));
    }
    return Array.from(
      new Map(
        baseRows.map((row) => [
          row.warehouseItemRef,
          `${row.itemCode || 'ITEM'} - ${row.itemName || 'Barang'}`,
        ]),
      ).entries(),
    )
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [baseRows, warehouseItems]);

  const resetFilters = () => {
    setPeriodMode('month');
    setMonthIndex(defaultPeriod.monthIndex);
    setYear(defaultPeriod.year);
    setDateFrom(`${defaultPeriod.year}-${String(defaultPeriod.monthIndex + 1).padStart(2, '0')}-01`);
    setDateTo('');
    setVehicleRef('');
    setCategory('');
    setItemRef('');
  };

  if (!user || !canViewPage) {
    return (
      <div className="card">
        <div className="card-body">
          Role Anda tidak punya akses ke laporan pemakaian barang.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <PageBackButton href="/inventory" />
          <h1 className="page-title">Laporan Pemakaian Barang</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Filter Laporan</span>
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
            <div className="info-banner" style={{ marginBottom: '1rem' }}>
              <div className="info-banner-title">Periode belum valid</div>
              <div className="info-banner-text">Lengkapi tanggal awal dan akhir, lalu pastikan tanggal awal tidak melebihi tanggal akhir.</div>
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Kendaraan</label>
              <select className="form-select" value={vehicleRef} onChange={(event) => setVehicleRef(event.target.value)}>
                <option value="">Semua Kendaraan</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle._id} value={vehicle._id}>
                    {vehicle.plateNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Kategori Barang</label>
              <select className="form-select" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Semua Kategori</option>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Barang</label>
              <select className="form-select" value={itemRef} onChange={(event) => setItemRef(event.target.value)}>
                <option value="">Semua Barang</option>
                {itemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={resetFilters}>
                Reset Filter
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Nilai Material Terpakai</div>
            <div className="kpi-value">{formatCurrency(summary.totalValue)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Aktivitas Pemakaian</div>
            <div className="kpi-value">{summary.rowCount}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Barang Terpakai</div>
            <div className="kpi-value">{summary.uniqueItemCount}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Unit Terdampak</div>
            <div className="kpi-value">{summary.uniqueVehicleCount}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Aktivitas Pemakaian Material</span>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="skeleton skeleton-text" style={{ height: 200 }} />
          ) : filteredRows.length === 0 ? (
            <div className="empty-state">
              <BarChart3 size={40} className="empty-state-icon" />
              <div className="empty-state-title">Belum ada pemakaian material pada filter ini</div>
            </div>
          ) : (
            <>
              <div className="table-wrapper table-desktop-only">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Kendaraan</th>
                      <th>Maintenance</th>
                      <th>Barang</th>
                      <th>Kategori</th>
                      <th>Qty</th>
                      <th>Nilai Material</th>
                      <th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={`${row.maintenanceId}-${row.warehouseItemRef}-${index}`}>
                        <td>{row.completedDate ? formatDate(row.completedDate) : '-'}</td>
                        <td>
                          {canOpenVehicles && row.vehicleRef ? (
                            <Link href={`/fleet/vehicles/${row.vehicleRef}?tab=maintenance`} style={{ color: 'var(--color-primary)' }}>
                              {row.vehiclePlate || '-'}
                            </Link>
                          ) : (
                            row.vehiclePlate || '-'
                          )}
                        </td>
                        <td>
                          <div>{row.maintenanceType || 'Maintenance'}</div>
                          {row.vendor ? <div className="text-muted text-xs">{row.vendor}</div> : null}
                        </td>
                        <td>
                          {canOpenItems ? (
                            <Link href={`/inventory/items/${row.warehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>
                              {[row.itemCode, row.itemName].filter(Boolean).join(' - ') || 'Barang'}
                            </Link>
                          ) : (
                            [row.itemCode, row.itemName].filter(Boolean).join(' - ') || 'Barang'
                          )}
                        </td>
                        <td>{row.category || '-'}</td>
                        <td>{formatInventoryQuantity(row.quantity)} {row.unit || '-'}</td>
                        <td>{formatCurrency(row.subtotalCost)}</td>
                        <td>{row.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobile-record-list">
                {filteredRows.map((row, index) => (
                  <div key={`${row.maintenanceId}-${row.warehouseItemRef}-${index}`} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenItems ? (
                            <Link href={`/inventory/items/${row.warehouseItemRef}`} style={{ color: 'var(--color-primary)' }}>
                              {[row.itemCode, row.itemName].filter(Boolean).join(' - ') || 'Barang'}
                            </Link>
                          ) : (
                            [row.itemCode, row.itemName].filter(Boolean).join(' - ') || 'Barang'
                          )}
                        </div>
                        <div className="mobile-record-subtitle">{row.maintenanceType || 'Maintenance'}</div>
                      </div>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Tanggal</span>
                        <span className="mobile-record-value">{row.completedDate ? formatDate(row.completedDate) : '-'}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Kendaraan</span>
                        <span className="mobile-record-value">
                          {canOpenVehicles && row.vehicleRef ? (
                            <Link href={`/fleet/vehicles/${row.vehicleRef}?tab=maintenance`} style={{ color: 'var(--color-primary)' }}>
                              {row.vehiclePlate || '-'}
                            </Link>
                          ) : (
                            row.vehiclePlate || '-'
                          )}
                        </span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Qty</span>
                        <span className="mobile-record-value">{formatInventoryQuantity(row.quantity)} {row.unit || '-'}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Nilai Material</span>
                        <span className="mobile-record-value">{formatCurrency(row.subtotalCost)}</span>
                      </div>
                      <div className="mobile-record-field mobile-record-field-full">
                        <span className="mobile-record-label">Kategori</span>
                        <span className="mobile-record-value">{row.category || '-'}</span>
                      </div>
                      {row.vendor ? (
                        <div className="mobile-record-field mobile-record-field-full">
                          <span className="mobile-record-label">Vendor</span>
                          <span className="mobile-record-value">{row.vendor}</span>
                        </div>
                      ) : null}
                      {row.note ? (
                        <div className="mobile-record-field mobile-record-field-full">
                          <span className="mobile-record-label">Catatan</span>
                          <span className="mobile-record-value">{row.note}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Catatan Owner</span>
        </div>
        <div className="card-body">
          <div className="mobile-record-list" style={{ display: 'grid' }}>
            <div className="mobile-record-card">
              <div className="mobile-record-header">
                <div>
                  <div className="mobile-record-title">Apa yang bisa dibaca dari halaman ini</div>
                </div>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-field mobile-record-field-full">
                  <span className="mobile-record-label">Pemakaian per periode</span>
                  <span className="mobile-record-value">Barang apa yang keluar, ke kendaraan mana, dan nilainya berapa.</span>
                </div>
                <div className="mobile-record-field mobile-record-field-full">
                  <span className="mobile-record-label">Batas halaman ini</span>
                  <span className="mobile-record-value">Belum menghitung full biaya maintenance eksternal. Fokusnya material gudang yang dipakai.</span>
                </div>
              </div>
            </div>
            <div className="mobile-record-card">
              <div className="mobile-record-header">
                <div>
                  <div className="mobile-record-title">Tindak lanjut yang disarankan</div>
                </div>
              </div>
              <div className="mobile-record-grid">
                <div className="mobile-record-field mobile-record-field-full">
                  <span className="mobile-record-label">Stok & pembelian</span>
                  <span className="mobile-record-value">
                    Cek kembali <Link href="/inventory" style={{ color: 'var(--color-primary)' }}>overview inventory</Link> jika ada barang yang sering dipakai tetapi stoknya mulai tipis.
                  </span>
                </div>
                <div className="mobile-record-field mobile-record-field-full">
                  <span className="mobile-record-label">Per item</span>
                  <span className="mobile-record-value">Buka detail barang untuk melihat riwayat beli, mutasi stok, dan kapan terakhir dipakai.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

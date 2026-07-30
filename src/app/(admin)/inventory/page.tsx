'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Package, Receipt, Truck } from 'lucide-react';

import { fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
  getMaintenanceMaterialUsageRows,
  getMonthPrefix,
  summarizeMaterialUsageRows,
  summarizePurchasesForMonth,
} from '@/lib/inventory-material-usage';
import {
  formatInventoryQuantity,
  getDerivedPurchasePaymentStatus,
  getDerivedPurchaseReceiptStatus,
  getPurchasePaymentBadgeClass,
  getPurchaseReceiptBadgeClass,
  isCancelledPurchase,
  PURCHASE_PAYMENT_STATUS_LABELS,
  PURCHASE_RECEIPT_STATUS_LABELS,
} from '@/lib/inventory';
import { hasPageAccess } from '@/lib/rbac';
import type { Maintenance, Purchase, Supplier, WarehouseItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

import { useApp, useToast } from '../layout';

type InventoryModuleCard = {
  href: string;
  title: string;
  description: string;
  icon: typeof Package;
};

const MODULES: InventoryModuleCard[] = [
  {
    href: '/suppliers',
    title: 'Supplier',
    description: 'Kelola pemasok aktif, termin default, dan data kontak pembelian.',
    icon: Truck,
  },
  {
    href: '/inventory/items',
    title: 'Barang Gudang',
    description: 'Pantau stok, stok minimum, supplier default, mutasi stok manual, dan master ban tertracking.',
    icon: Package,
  },
  {
    href: '/inventory/purchases',
    title: 'Pembelian',
    description: 'Buat pembelian supplier, terima barang, bayar supplier, dan cek outstanding.',
    icon: Receipt,
  },
  {
    href: '/inventory/material-usage',
    title: 'Laporan Pemakaian Barang',
    description: 'Lihat barang gudang yang dipakai ke maintenance/unit per periode secara ringkas.',
    icon: BarChart3,
  },
  {
    href: '/inventory/stock-recap',
    title: 'Laporan Stok Gudang',
    description: 'Laporan stok awal, barang masuk, keluar, dan stok akhir semua item per bulan, tahun, atau rentang tanggal.',
    icon: BarChart3,
  },
];

function canOpenModule(role: NonNullable<ReturnType<typeof useApp>['user']>['role'], href: string) {
  if (href === '/suppliers') return hasPageAccess(role, 'suppliers');
  if (href === '/inventory/items') return hasPageAccess(role, 'warehouseItems');
  if (href === '/inventory/purchases') return hasPageAccess(role, 'purchases');
  if (href === '/inventory/material-usage') return hasPageAccess(role, 'maintenance');
  if (href === '/inventory/stock-recap') return hasPageAccess(role, 'warehouseItems');
  return false;
}

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

export default function InventoryOverviewPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [maintenances, setMaintenances] = useState<Maintenance[]>([]);
  const today = getBusinessDateValue();
  const currentMonthPrefix = getMonthPrefix(today);

  const allowedModules = useMemo(
    () => MODULES.filter((module) => (user ? canOpenModule(user.role, module.href) : false)),
    [user],
  );
  const canOpenSuppliers = user ? hasPageAccess(user, 'suppliers') : false;
  const canOpenItems = user ? hasPageAccess(user, 'warehouseItems') : false;
  const canOpenPurchases = user ? hasPageAccess(user, 'purchases') : false;
  const canOpenMaintenance = user ? hasPageAccess(user, 'maintenance') : false;

  useEffect(() => {
    async function loadOverview() {
      if (!user) return;
      setLoading(true);
      try {
        const [purchaseRows, itemRows, supplierRows, maintenanceRows] = await Promise.all([
          canOpenPurchases
            ? fetchAllAdminCollectionData<Purchase>('/api/data?entity=purchases&sortField=orderDate&sortDir=desc', 'Gagal memuat pembelian inventory')
            : Promise.resolve([]),
          canOpenItems
            ? fetchAllAdminCollectionData<WarehouseItem>('/api/data?entity=warehouse-items&sortField=itemCode&sortDir=asc', 'Gagal memuat barang gudang')
            : Promise.resolve([]),
          canOpenSuppliers
            ? fetchAllAdminCollectionData<Supplier>('/api/data?entity=suppliers&sortField=supplierCode&sortDir=asc', 'Gagal memuat supplier')
            : Promise.resolve([]),
          canOpenMaintenance
            ? fetchAllAdminCollectionData<Maintenance>(`/api/data?entity=maintenances&filter=${encodeURIComponent(JSON.stringify({ status: 'DONE' }))}&sortField=completedDate&sortDir=desc`, 'Gagal memuat pemakaian maintenance')
            : Promise.resolve([]),
        ]);
        setPurchases(purchaseRows || []);
        setItems(itemRows || []);
        setSuppliers(supplierRows || []);
        setMaintenances(maintenanceRows || []);
      } catch (error) {
        addToast('error', error instanceof Error ? error.message : 'Gagal memuat ringkasan inventory');
      } finally {
        setLoading(false);
      }
    }

    void loadOverview();
  }, [addToast, canOpenItems, canOpenMaintenance, canOpenPurchases, canOpenSuppliers, user]);

  const outstandingPurchases = useMemo(
    () =>
      purchases.filter((purchase) =>
        !isCancelledPurchase(purchase)
        && getDerivedPurchasePaymentStatus(purchase) !== 'PAID'
        && Number(purchase.outstandingAmount || 0) > 0
      ),
    [purchases],
  );
  const overduePurchases = useMemo(
    () => outstandingPurchases.filter((purchase) => purchase.dueDate && purchase.dueDate < today),
    [outstandingPurchases, today],
  );
  const outstandingAmount = useMemo(
    () => outstandingPurchases.reduce((sum, purchase) => sum + Number(purchase.outstandingAmount || 0), 0),
    [outstandingPurchases],
  );
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active !== false).length,
    [suppliers],
  );
  const materialUsageRows = useMemo(
    () => getMaintenanceMaterialUsageRows(maintenances),
    [maintenances],
  );
  const materialUsageThisMonth = useMemo(
    () => summarizeMaterialUsageRows(materialUsageRows.filter((row) => row.completedDate.startsWith(currentMonthPrefix))),
    [currentMonthPrefix, materialUsageRows],
  );
  const purchasesThisMonth = useMemo(
    () => summarizePurchasesForMonth(purchases, currentMonthPrefix),
    [currentMonthPrefix, purchases],
  );
  const lowStockItems = useMemo(
    () => items.filter((item) => {
      if (item.active === false) return false;
      const current = Number(item.currentStockQty || 0);
      const min = Number(item.minStockQty || 0);
      return min > 0 && current <= min;
    }),
    [items],
  );
  const outOfStockItems = useMemo(
    () => items.filter((item) => item.active !== false && Number(item.currentStockQty || 0) <= 0),
    [items],
  );
  const itemsNeedingAction = useMemo(
    () => lowStockItems
      .slice()
      .sort((a, b) => Number(a.currentStockQty || 0) - Number(b.currentStockQty || 0))
      .slice(0, 5),
    [lowStockItems],
  );
  const purchasesNeedingAction = useMemo(
    () => overduePurchases
      .slice()
      .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
      .slice(0, 5),
    [overduePurchases],
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Inventory</h1>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-body">
          <div className="text-muted" style={{ maxWidth: 760, lineHeight: 1.7 }}>
            Pusat pembelian supplier dan stok gudang. Mulai dari master supplier, barang gudang,
            sampai pembelian yang terhubung ke penerimaan barang, pembayaran supplier, dan arus kas bank/kas.
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Sisa Tagihan Pembelian</div>
            <div className="kpi-value">{formatCurrency(outstandingAmount)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Stok Menipis</div>
            <div className="kpi-value">{lowStockItems.length}</div>
            <div className="kpi-sub">{outOfStockItems.length} item sudah habis</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Pemakaian Material Bulan Ini</div>
            <div className="kpi-value">{formatCurrency(materialUsageThisMonth.totalValue)}</div>
            <div className="kpi-sub">{materialUsageThisMonth.rowCount} aktivitas material</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <div className="kpi-label">Pembelian Bulan Ini</div>
            <div className="kpi-value">{formatCurrency(purchasesThisMonth.totalAmount)}</div>
            <div className="kpi-sub">{purchasesThisMonth.purchaseCount} dokumen pembelian</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Perlu Ditindaklanjuti</span>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ height: 120 }} />
            ) : purchasesNeedingAction.length === 0 ? (
              <div className="empty-state">
                <Receipt size={36} className="empty-state-icon" />
                <div className="empty-state-title">Tidak ada pembelian jatuh tempo</div>
              </div>
            ) : (
              <div className="mobile-record-list" style={{ display: 'grid' }}>
                {purchasesNeedingAction.map((purchase) => (
                  <div key={purchase._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenPurchases ? (
                            <Link href={`/inventory/purchases/${purchase._id}`} style={{ color: 'var(--color-primary)' }}>
                              {purchase.purchaseNumber}
                            </Link>
                          ) : purchase.purchaseNumber}
                        </div>
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
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Jatuh Tempo</span>
                        <span className="mobile-record-value">{purchase.dueDate ? formatDate(purchase.dueDate) : '-'}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Sisa Tagihan</span>
                        <span className="mobile-record-value">{formatCurrency(Number(purchase.outstandingAmount || 0))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Stok Perlu Perhatian</span>
          </div>
          <div className="card-body">
            {loading ? (
              <div className="skeleton skeleton-text" style={{ height: 120 }} />
            ) : itemsNeedingAction.length === 0 ? (
              <div className="empty-state">
                <Package size={36} className="empty-state-icon" />
                <div className="empty-state-title">Tidak ada stok menipis</div>
              </div>
            ) : (
              <div className="mobile-record-list" style={{ display: 'grid' }}>
                {itemsNeedingAction.map((item) => (
                  <div key={item._id} className="mobile-record-card">
                    <div className="mobile-record-header">
                      <div>
                        <div className="mobile-record-title">
                          {canOpenItems ? (
                            <Link href={`/inventory/items/${item._id}`} style={{ color: 'var(--color-primary)' }}>
                              {item.name}
                            </Link>
                          ) : item.name}
                        </div>
                        <div className="mobile-record-subtitle">{item.itemCode}</div>
                      </div>
                      <span className={`badge ${Number(item.currentStockQty || 0) <= 0 ? 'badge-danger' : 'badge-warning'}`}>
                        {Number(item.currentStockQty || 0) <= 0 ? 'Stok Habis' : 'Stok Menipis'}
                      </span>
                    </div>
                    <div className="mobile-record-grid">
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Stok</span>
                        <span className="mobile-record-value">{formatInventoryQuantity(item.currentStockQty || 0)} {item.unit}</span>
                      </div>
                      <div className="mobile-record-field">
                        <span className="mobile-record-label">Min. Stok</span>
                        <span className="mobile-record-value">{formatInventoryQuantity(item.minStockQty || 0)} {item.unit}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <span className="card-header-title">Snapshot Bulan Ini</span>
        </div>
        <div className="card-body">
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">Periode</span>
              <span className="detail-value">{currentMonthPrefix || '-'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Supplier Aktif</span>
              <span className="detail-value">{activeSuppliers}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Pembelian Jatuh Tempo</span>
              <span className="detail-value">{overduePurchases.length}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Barang Dipakai</span>
              <span className="detail-value">{materialUsageThisMonth.uniqueItemCount} item</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Unit Terdampak</span>
              <span className="detail-value">{materialUsageThisMonth.uniqueVehicleCount} kendaraan</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Tindak Lanjut Owner</span>
              <span className="detail-value">
                {canOpenItems ? (
                  <Link href="/inventory/stock-recap" style={{ color: 'var(--color-primary)' }}>
                    Buka laporan stok gudang
                  </Link>
                ) : (
                  'Lihat stok & pembelian'
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {outOfStockItems.length > 0 && (
        <div className="info-banner" style={{ marginBottom: '1.5rem' }}>
          <div className="info-banner-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} />
            Ada {outOfStockItems.length} barang gudang dengan stok habis
          </div>
          <div className="info-banner-text">
            Prioritaskan pembelian ulang atau penyesuaian stok untuk item yang sudah 0 agar operasional tidak terputus.
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
        }}
      >
        {allowedModules.map((module) => {
          const Icon = module.icon;
          return (
            <Link
              key={module.href}
              href={module.href}
              className="card"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                border: '1px solid var(--color-border)',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
            >
              <div className="card-body" style={{ display: 'grid', gap: '0.9rem' }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--color-primary-50)',
                    color: 'var(--color-primary)',
                  }}
                >
                  <Icon size={22} />
                </div>
                <div>
                  <div className="font-semibold" style={{ fontSize: '1.05rem', marginBottom: '0.35rem' }}>
                    {module.title}
                  </div>
                  <div className="text-muted" style={{ lineHeight: 1.6 }}>
                    {module.description}
                  </div>
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                  }}
                >
                  Buka modul
                  <ArrowRight size={16} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

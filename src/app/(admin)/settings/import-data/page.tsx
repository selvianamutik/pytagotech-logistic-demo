'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, CheckCircle, ChevronDown, Download, ListFilter, RefreshCw, RotateCcw, Save, Upload, XCircle } from 'lucide-react';

import {
  MASTER_DATA_IMPORT_MODES,
  MASTER_DATA_IMPORT_TARGETS,
  getMasterDataImportMasterFieldRequests,
  type MasterDataImportMode,
  type MasterDataImportTarget,
  type MasterDataImportTargetConfig,
} from '@/lib/master-data-import-config';
import Combobox from '@/components/Combobox';
import { hasPermission } from '@/lib/rbac';

import { useApp, useToast } from '../../layout';

type ImportAction = 'create' | 'update' | 'skip';
type ImportStatus = 'ready' | 'warning' | 'error' | 'imported';

type ImportRowResult = {
  rowNumber: number;
  status: ImportStatus;
  action: ImportAction;
  keyValue: string;
  displayName: string;
  existingId?: string;
  errors: string[];
  warnings: string[];
  importedId?: string;
};

type ImportResult = {
  target: MasterDataImportTarget;
  mode: MasterDataImportMode;
  summary: {
    totalRows: number;
    ready: number;
    warnings: number;
    errors: number;
    create: number;
    update: number;
    skip: number;
    imported: number;
  };
  rows: ImportRowResult[];
  batchId?: string;
};

const ACTION_LABELS: Record<ImportAction, string> = {
  create: 'Tambah',
  update: 'Update',
  skip: 'Lewati',
};

const STATUS_META: Record<ImportStatus, { label: string; className: string }> = {
  ready: { label: 'Siap', className: 'badge-info' },
  warning: { label: 'Warning', className: 'badge-warning' },
  error: { label: 'Error', className: 'badge-danger' },
  imported: { label: 'Terimport', className: 'badge-success' },
};

const IMPORT_STEPS = [
  { value: 1, label: 'Data & File' },
  { value: 2, label: 'Validasi' },
  { value: 3, label: 'Commit' },
];

// Redirect export: setiap target import punya halaman list yang sudah
// menyediakan tombol export Excel (permission export yang sama).
const EXPORT_DESTINATIONS: Record<MasterDataImportTarget, { href: string; label: string; module: MasterDataImportTargetConfig['module'] }> = {
  customers: { href: '/customers', label: 'Customer', module: 'customers' },
  'customer-products': { href: '/customers', label: 'Barang Customer', module: 'customers' },
  'customer-billing-rates': { href: '/customers', label: 'Tarif Billing', module: 'customers' },
  suppliers: { href: '/suppliers', label: 'Supplier', module: 'suppliers' },
  'warehouse-items': { href: '/inventory/items', label: 'Barang Gudang', module: 'warehouseItems' },
  'trip-route-rates': { href: '/trip-rates', label: 'Biaya Rute Trip', module: 'tripRouteRates' },
};

const IMPORT_FILE_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadBinaryFile(filename: string, content: BlobPart, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function resolveMasterDataImportOptions(config: MasterDataImportTargetConfig) {
  const requests = getMasterDataImportMasterFieldRequests(config);
  if (requests.length === 0) return {};
  const docsBySource = new Map<string, Array<Record<string, unknown>>>();
  await Promise.all(
    Array.from(new Set(requests.map((request) => request.source))).map(async (source) => {
      try {
        const response = await fetch(`/api/data?entity=${source}&pageSize=500`);
        if (!response.ok) return;
        const body = await response.json() as { data?: Array<Record<string, unknown>> };
        docsBySource.set(source, (body.data ?? []).filter((doc) => doc.active !== false));
      } catch {
        // Dropdown master data optional; tanpa data, kolom tidak memiliki combobox.
      }
    }),
  );
  const resolve: Record<string, string[]> = {};
  requests.forEach((request) => {
    const docs = docsBySource.get(request.source);
    if (!docs) return;
    resolve[request.key] = docs
      .map((doc) => String(doc[request.valueField] ?? ''))
      .filter((value) => value.trim() !== '');
  });
  return resolve;
}

function formatMessages(row: ImportRowResult) {
  const messages = [...row.errors, ...row.warnings];
  return messages.length > 0 ? messages.join(' | ') : '-';
}

export default function ImportDataPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const availableTargets = useMemo(
    () => MASTER_DATA_IMPORT_TARGETS.filter((target) => (
      user &&
      (hasPermission(user, target.module, 'create') || hasPermission(user, target.module, 'update'))
    )),
    [user],
  );
  const [target, setTarget] = useState<MasterDataImportTarget>(availableTargets[0]?.target || 'customers');
  const [mode, setMode] = useState<MasterDataImportMode>('createOnly');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewVersion, setPreviewVersion] = useState<number | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const dataVersionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement | null>(null);
  const errorCountRef = useRef(0);

  const selectedConfig = MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === target) || MASTER_DATA_IMPORT_TARGETS[0];
  const selectedMode = MASTER_DATA_IMPORT_MODES.find((item) => item.value === mode) || MASTER_DATA_IMPORT_MODES[0];
  const currentPreview = previewVersion === dataVersionRef.current ? preview : null;
  const actionableCount = currentPreview
    ? currentPreview.rows.filter((row) => row.action !== 'skip' && row.status !== 'error' && row.status !== 'imported').length
    : 0;
  const canCommit = Boolean(currentPreview && rows.length > 0 && currentPreview.summary.errors === 0 && actionableCount > 0 && !importing && !loadingPreview);
  const exportDest = EXPORT_DESTINATIONS[selectedConfig.target];
  const canExportTarget = Boolean(user && exportDest && hasPermission(user, exportDest.module, 'export'));
  const commitDone = Boolean(currentPreview && currentPreview.rows.length > 0 && currentPreview.rows.every((row) => row.status === 'imported'));
  const activeStep = rows.length === 0 ? 1 : (!currentPreview ? 1 : (commitDone ? 3 : 2));
  const firstErrorRow = currentPreview?.rows.find((row) => row.status === 'error')?.rowNumber;
  const visibleRows = showErrorsOnly && currentPreview
    ? currentPreview.rows.filter((row) => row.status === 'error')
    : currentPreview?.rows;

  const exportLink = canExportTarget ? (
    <Link className="btn btn-secondary" href={exportDest.href} title={`Buka halaman ${exportDest.label} untuk export Excel`}>
      <ArrowUpRight size={16} /> Export {exportDest.label}
    </Link>
  ) : null;

  const clearFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const resetPreviewState = useCallback(() => {
    dataVersionRef.current += 1;
    setPreview(null);
    setPreviewVersion(null);
  }, []);

  const resetUploadedFile = useCallback((options?: { clearInput?: boolean }) => {
    setFileName('');
    setHeaders([]);
    setRows([]);
    if (options?.clearInput) clearFileInput();
  }, [clearFileInput]);

  const handleResetImport = useCallback(() => {
    resetPreviewState();
    resetUploadedFile({ clearInput: true });
  }, [resetPreviewState, resetUploadedFile]);

  useEffect(() => {
    if (availableTargets.length > 0 && !availableTargets.some((item) => item.target === target)) {
      resetPreviewState();
      resetUploadedFile({ clearInput: true });
      setTarget(availableTargets[0].target);
    }
  }, [availableTargets, resetPreviewState, resetUploadedFile, target]);

  useEffect(() => {
    dataVersionRef.current += 1;
    setPreview(null);
    setPreviewVersion(null);
  }, [target, mode, rows]);

  useEffect(() => {
    const errors = currentPreview?.summary.errors ?? 0;
    if (errors > 0 && errors !== errorCountRef.current) {
      errorSummaryRef.current?.focus();
    }
    errorCountRef.current = errors;
  }, [currentPreview]);

  const handleTargetChange = (nextTarget: MasterDataImportTarget) => {
    if (nextTarget === target) return;
    resetPreviewState();
    resetUploadedFile({ clearInput: true });
    setTarget(nextTarget);
  };

  const handleModeChange = (nextMode: MasterDataImportMode) => {
    if (nextMode === mode) return;
    resetPreviewState();
    setMode(nextMode);
  };

  const handleDownloadTemplate = async () => {
    setTemplateLoading(true);
    try {
      const { MASTER_DATA_IMPORT_XLSX_MIME, buildMasterDataImportTemplateWorkbook } = await import('@/lib/master-data-import-file');
      const masterOptions = await resolveMasterDataImportOptions(selectedConfig);
      const workbookBuffer = await buildMasterDataImportTemplateWorkbook(selectedConfig, masterOptions);
      downloadBinaryFile(
        `template-import-${selectedConfig.target}.xlsx`,
        workbookBuffer as unknown as BlobPart,
        MASTER_DATA_IMPORT_XLSX_MIME,
      );
      addToast('success', `Template Excel ${selectedConfig.label} siap diunduh`);
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Gagal membuat template Excel');
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleFileChange = async (file: File | null) => {
    const requestVersion = dataVersionRef.current + 1;
    dataVersionRef.current = requestVersion;
    setPreview(null);
    setPreviewVersion(null);
    if (!file) {
      resetUploadedFile();
      return;
    }
    try {
      const {
        isMasterDataImportXlsxFile,
        parseMasterDataImportXlsx,
      } = await import('@/lib/master-data-import-file');
      const isXlsx = isMasterDataImportXlsxFile(file);
      if (!isXlsx) {
        if (requestVersion !== dataVersionRef.current) return;
        resetUploadedFile({ clearInput: true });
        addToast('error', 'Format file harus Excel .xlsx. Download template Excel terbaru.');
        return;
      }
      const parsed = await parseMasterDataImportXlsx(await file.arrayBuffer(), selectedConfig);
      if (requestVersion !== dataVersionRef.current) return;
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      addToast('success', `${parsed.rows.length} baris dibaca dari Excel`);
    } catch (error) {
      if (requestVersion !== dataVersionRef.current) return;
      resetUploadedFile({ clearInput: true });
      addToast('error', error instanceof Error ? error.message : 'Gagal membaca file import');
    }
  };

  const submitImportRequest = async (action: 'preview' | 'commit') => {
    if (rows.length === 0) {
      addToast('error', 'Upload file Excel dulu sebelum validasi');
      return;
    }
    const requestVersion = dataVersionRef.current;
    if (action === 'preview') setLoadingPreview(true);
    if (action === 'commit') setImporting(true);
    try {
      const response = await fetch('/api/data-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, target, mode, rows }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Import gagal diproses');
      const result = payload.data as ImportResult;
      if (requestVersion !== dataVersionRef.current) {
        return;
      }
      setPreview(result);
      setPreviewVersion(requestVersion);
      setShowErrorsOnly(false);
      if (action === 'preview') {
        addToast(result.summary.errors > 0 ? 'warning' : 'success', result.summary.errors > 0 ? 'Preview selesai, masih ada error' : 'Preview valid');
      } else {
        addToast(result.summary.errors > 0 ? 'warning' : 'success', result.summary.errors > 0 ? 'Import sebagian gagal. Cek baris error.' : 'Import selesai');
      }
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Import gagal diproses');
    } finally {
      setLoadingPreview(false);
      setImporting(false);
    }
  };

  if (availableTargets.length === 0) {
    return (
      <div className="empty-state">
        <AlertTriangle size={48} className="empty-state-icon" />
        <div className="empty-state-title">Tidak ada akses import</div>
        <div className="empty-state-text">Akses import mengikuti hak tambah atau update pada modul Customer, Master Barang Customer, Supplier, Barang Gudang, dan Biaya Rute Trip.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Import Data</h1>
          <div className="page-subtitle">Import master data memakai staging preview sebelum masuk database.</div>
        </div>
        <div className="page-actions">
          {exportLink}
          <button className="btn btn-secondary" onClick={() => void handleDownloadTemplate()} disabled={templateLoading}>
            <Download size={16} /> {templateLoading ? 'Menyiapkan...' : 'Template Excel'}
          </button>
        </div>
      </div>

      <ol className="import-steps" aria-label="Langkah import">
        {IMPORT_STEPS.map((step) => (
          <li
            key={step.value}
            className={activeStep > step.value ? 'done' : (activeStep === step.value ? 'current' : '')}
            aria-current={activeStep === step.value ? 'step' : undefined}
          >
            <span className="import-step-num">{activeStep > step.value ? <CheckCircle size={14} /> : step.value}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className="info-banner" style={{ marginBottom: '1rem' }}>
        <div className="info-banner-title">Batas aman import</div>
        <div className="info-banner-text">
          Fitur ini hanya untuk master Customer, Master Barang Customer, Supplier, Barang Gudang, dan Biaya Rute Trip. Pakai template Excel agar kolom terbaca rapi. Stok barang gudang tetap tidak diubah dari import master.
        </div>
      </div>

      <div className="table-container import-settings" style={{ marginBottom: '1rem' }}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div>
              <div className="font-semibold">Pengaturan Import</div>
              <div className="text-muted text-sm">{selectedConfig.description}</div>
            </div>
          </div>
          <div className="table-toolbar-right">
            <button className="btn btn-primary" onClick={() => void submitImportRequest('preview')} disabled={loadingPreview || importing || rows.length === 0}>
              <RefreshCw size={16} /> {loadingPreview ? 'Validasi...' : 'Validasi'}
            </button>
          </div>
        </div>

        <div className="form-row" style={{ padding: '1rem 1rem 0' }}>
          <div className="form-group">
            <label className="form-label">Target Data</label>
            <Combobox className="form-select" value={target} onChange={(v: string) => handleTargetChange(v as MasterDataImportTarget)} options={availableTargets.map((item) => ({ value: item.target, label: item.label }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Mode Import</label>
            <Combobox className="form-select" value={mode} onChange={(v: string) => handleModeChange(v as MasterDataImportMode)} options={MASTER_DATA_IMPORT_MODES.map((item) => ({ value: item.value, label: item.label }))} />
            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>{selectedMode.description}</div>
          </div>
        </div>

        <div className="form-row" style={{ padding: '0 1rem 1rem' }}>
          <div className="form-group">
            <span className="form-label" id="import-upload-label">Upload Excel (.xlsx)</span>
            <div
              className={`import-dropzone${dragging ? ' dragging' : ''}${rows.length > 0 ? ' has-file' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); void handleFileChange(event.dataTransfer.files?.[0] || null); }}
            >
              <Upload size={20} className="import-dropzone-icon" />
              <div className="import-dropzone-text">Seret file .xlsx ke sini, atau</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
                {fileName ? 'Ganti File' : 'Pilih File'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={IMPORT_FILE_ACCEPT}
                hidden
                aria-labelledby="import-upload-label"
                onChange={(event) => void handleFileChange(event.target.files?.[0] || null)}
              />
              <div className="text-muted text-xs">{fileName ? `${fileName} · ${rows.length} baris` : 'Belum ada file dipilih'}</div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Kolom terbaca</label>
            <input className="form-input" value={headers.length > 0 ? headers.join(', ') : '-'} readOnly />
          </div>
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Baris File</div><div className="kpi-value">{rows.length > 0 ? rows.length : '–'}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Siap Tambah</div><div className="kpi-value">{currentPreview ? currentPreview.summary.create : '–'}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Siap Update</div><div className="kpi-value">{currentPreview ? currentPreview.summary.update : '–'}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Error</div><div className="kpi-value">{currentPreview ? currentPreview.summary.errors : '–'}</div></div></div>
      </div>

      <div className="table-container" style={{ marginBottom: '1rem' }}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div>
              <div className="font-semibold">Format Template {selectedConfig.label}</div>
              <div className="text-muted text-sm">Kolom wajib: {selectedConfig.fields.filter((field) => field.required).map((field) => field.label).join(', ')}</div>
            </div>
          </div>
          <div className="table-toolbar-right">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowFormat((current) => !current)} aria-expanded={showFormat}>
              <ChevronDown size={14} /> {showFormat ? 'Sembunyikan kolom' : 'Lihat format kolom'}
            </button>
          </div>
        </div>
        {showFormat && (
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Kolom</th><th>Wajib</th><th>Contoh</th><th>Catatan</th></tr></thead>
            <tbody>
              {selectedConfig.fields.map((field) => (
                <tr key={field.key}>
                  <td><span className="font-semibold">{field.label}</span><div className="text-muted text-xs font-mono">{field.key}</div></td>
                  <td>{field.required ? <span className="badge badge-warning">Wajib</span> : <span className="badge badge-gray">Opsional</span>}</td>
                  <td>{field.example || '-'}</td>
                  <td>{field.help || (field.aliases?.length ? `Alias: ${field.aliases.slice(0, 4).join(', ')}` : '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {commitDone && currentPreview && (
        <div className="table-container" style={{ marginBottom: '1rem' }}>
          <div className="import-success">
            <CheckCircle size={28} className="import-success-icon" />
            <div>
              <div className="font-semibold">Import selesai — {currentPreview.summary.imported} baris {selectedConfig.label} masuk</div>
              <div className="text-muted text-sm">
                {currentPreview.batchId ? `Batch: ${currentPreview.batchId}. ` : ''}{currentPreview.summary.skip} baris dilewati.
              </div>
            </div>
            <div className="import-success-actions">
              {exportLink}
              <button className="btn btn-primary" onClick={handleResetImport}>
                <RotateCcw size={16} /> Import File Lain
              </button>
            </div>
          </div>
        </div>
      )}

      {currentPreview && (
        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-left">
              <div>
                <div className="font-semibold">Preview Import</div>
                <div className="text-muted text-sm">
                  {currentPreview.summary.totalRows} baris, {currentPreview.summary.create} tambah, {currentPreview.summary.update} update, {currentPreview.summary.skip} lewati.
                  {currentPreview.batchId ? ` Batch: ${currentPreview.batchId}` : ''}
                </div>
              </div>
            </div>
            <div className="table-toolbar-right">
              {currentPreview.summary.errors > 0 ? (
                <span className="badge badge-danger"><XCircle size={14} /> Perbaiki error dulu</span>
              ) : (
                <span className="badge badge-success"><CheckCircle size={14} /> Valid</span>
              )}
              {currentPreview.summary.errors > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowErrorsOnly((current) => !current)}
                  aria-pressed={showErrorsOnly}
                >
                  <ListFilter size={14} /> {showErrorsOnly ? 'Semua baris' : `Hanya error (${currentPreview.summary.errors})`}
                </button>
              )}
              {!commitDone && (
                <button className="btn btn-primary" onClick={() => void submitImportRequest('commit')} disabled={!canCommit}>
                  <Save size={16} /> {importing ? 'Mengimport...' : 'Commit Import'}
                </button>
              )}
            </div>
          </div>
          {currentPreview.summary.errors > 0 && !commitDone && (
            <div ref={errorSummaryRef} tabIndex={-1} role="alert" className="import-error-summary">
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div className="font-semibold">
                  Ada {currentPreview.summary.errors} baris error{currentPreview.summary.warnings > 0 ? ` dan ${currentPreview.summary.warnings} warning` : ''}.
                </div>
                <div>
                  Perbaiki file Excel lalu jalankan Validasi ulang.
                  {firstErrorRow !== undefined && (
                    <> <a href={`#import-row-${firstErrorRow}`}>Loncat ke error pertama (baris {firstErrorRow})</a></>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Baris</th><th>Data</th><th>Aksi</th><th>Status</th><th>Pesan Validasi</th></tr></thead>
              <tbody>
                {(visibleRows || []).map((row) => {
                  const meta = STATUS_META[row.status] || STATUS_META.warning;
                  return (
                    <tr key={row.rowNumber} id={`import-row-${row.rowNumber}`} style={{ scrollMarginTop: '1rem' }}>
                      <td>{row.rowNumber}</td>
                      <td><div className="font-semibold">{row.displayName}</div><div className="text-muted text-xs font-mono">{row.keyValue || '-'}</div></td>
                      <td>{ACTION_LABELS[row.action]}</td>
                      <td><span className={`badge ${meta.className}`}>{meta.label}</span></td>
                      <td>{formatMessages(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Download, RefreshCw, Save, XCircle } from 'lucide-react';

import {
  MASTER_DATA_IMPORT_MODES,
  MASTER_DATA_IMPORT_TARGETS,
  type MasterDataImportMode,
  type MasterDataImportTarget,
} from '@/lib/master-data-import-config';
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
  const dataVersionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedConfig = MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === target) || MASTER_DATA_IMPORT_TARGETS[0];
  const selectedMode = MASTER_DATA_IMPORT_MODES.find((item) => item.value === mode) || MASTER_DATA_IMPORT_MODES[0];
  const currentPreview = previewVersion === dataVersionRef.current ? preview : null;
  const actionableCount = currentPreview
    ? currentPreview.rows.filter((row) => row.action !== 'skip' && row.status !== 'error' && row.status !== 'imported').length
    : 0;
  const canCommit = Boolean(currentPreview && rows.length > 0 && currentPreview.summary.errors === 0 && actionableCount > 0 && !importing && !loadingPreview);

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
      const workbookBuffer = await buildMasterDataImportTemplateWorkbook(selectedConfig);
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
          <button className="btn btn-secondary" onClick={() => void handleDownloadTemplate()} disabled={templateLoading}>
            <Download size={16} /> {templateLoading ? 'Menyiapkan...' : 'Template Excel'}
          </button>
        </div>
      </div>

      <div className="info-banner" style={{ marginBottom: '1rem' }}>
        <div className="info-banner-title">Batas aman import</div>
        <div className="info-banner-text">
          Fitur ini hanya untuk master Customer, Master Barang Customer, Supplier, Barang Gudang, dan Biaya Rute Trip. Pakai template Excel agar kolom terbaca rapi; stok barang gudang tetap tidak diubah dari import master.
        </div>
      </div>

      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Baris File</div><div className="kpi-value">{rows.length}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Siap Tambah</div><div className="kpi-value">{currentPreview?.summary.create || 0}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Siap Update</div><div className="kpi-value">{currentPreview?.summary.update || 0}</div></div></div>
        <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Error</div><div className="kpi-value">{currentPreview?.summary.errors || 0}</div></div></div>
      </div>

      <div className="table-container" style={{ marginBottom: '1rem' }}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div>
              <div className="font-semibold">Pengaturan Import</div>
              <div className="text-muted text-sm">{selectedConfig.description}</div>
            </div>
          </div>
          <div className="table-toolbar-right">
            <button className="btn btn-secondary" onClick={() => void submitImportRequest('preview')} disabled={loadingPreview || importing || rows.length === 0}>
              <RefreshCw size={16} /> {loadingPreview ? 'Validasi...' : 'Preview'}
            </button>
            <button className="btn btn-primary" onClick={() => void submitImportRequest('commit')} disabled={!canCommit}>
              <Save size={16} /> {importing ? 'Mengimport...' : 'Commit Import'}
            </button>
          </div>
        </div>

        <div className="form-row" style={{ padding: '1rem 1rem 0' }}>
          <div className="form-group">
            <label className="form-label">Target Data</label>
            <select className="form-select" value={target} onChange={(event) => handleTargetChange(event.target.value as MasterDataImportTarget)}>
              {availableTargets.map((item) => <option key={item.target} value={item.target}>{item.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Mode Import</label>
            <select className="form-select" value={mode} onChange={(event) => handleModeChange(event.target.value as MasterDataImportMode)}>
              {MASTER_DATA_IMPORT_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>{selectedMode.description}</div>
          </div>
        </div>

        <div className="form-row" style={{ padding: '0 1rem 1rem' }}>
          <div className="form-group">
            <label className="form-label">Upload Excel (.xlsx)</label>
            <input ref={fileInputRef} className="form-input" type="file" accept={IMPORT_FILE_ACCEPT} onChange={(event) => void handleFileChange(event.target.files?.[0] || null)} />
            <div className="text-muted text-xs" style={{ marginTop: '0.35rem' }}>{fileName || 'Belum ada file dipilih'}</div>
          </div>
          <div className="form-group">
            <label className="form-label">Kolom terbaca</label>
            <input className="form-input" value={headers.length > 0 ? headers.join(', ') : '-'} readOnly />
          </div>
        </div>
      </div>

      <div className="table-container" style={{ marginBottom: '1rem' }}>
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div>
              <div className="font-semibold">Format Template {selectedConfig.label}</div>
              <div className="text-muted text-sm">Kolom wajib: {selectedConfig.fields.filter((field) => field.required).map((field) => field.label).join(', ')}</div>
            </div>
          </div>
        </div>
        <div className="table-wrapper table-desktop-only">
          <table>
            <thead><tr><th>Kolom</th><th>Wajib</th><th>Contoh</th><th>Catatan</th></tr></thead>
            <tbody>
              {selectedConfig.fields.map((field) => (
                <tr key={field.key}>
                  <td><span className="font-mono">{field.key}</span><div className="text-muted text-xs">{field.label}</div></td>
                  <td>{field.required ? <span className="badge badge-warning">Wajib</span> : <span className="badge badge-gray">Opsional</span>}</td>
                  <td>{field.example || '-'}</td>
                  <td>{field.help || (field.aliases?.length ? `Alias: ${field.aliases.slice(0, 4).join(', ')}` : '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Baris</th><th>Data</th><th>Aksi</th><th>Status</th><th>Pesan Validasi</th></tr></thead>
              <tbody>
                {currentPreview.rows.map((row) => {
                  const meta = STATUS_META[row.status] || STATUS_META.warning;
                  return (
                    <tr key={row.rowNumber}>
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

import type { AppModule } from './rbac';

export type MasterDataImportTarget = 'customers' | 'customer-products' | 'suppliers' | 'warehouse-items' | 'trip-route-rates' | 'customer-billing-rates';
export type MasterDataImportMode = 'createOnly' | 'updateOnly' | 'upsert';

export type MasterDataImportOptionSource = 'customers' | 'suppliers' | 'services' | 'trip-route-rates';

export type MasterDataImportOptionValueField = 'name' | 'code' | 'supplierCode' | 'originArea' | 'destinationArea';

export type MasterDataImportFieldOptions =
  | { kind: 'static'; values: string[] }
  | { kind: 'master'; source: MasterDataImportOptionSource; valueField: MasterDataImportOptionValueField; mode?: 'strict' | 'suggest' };

export type MasterDataImportField = {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
  aliases?: string[];
  example?: string;
  options?: MasterDataImportFieldOptions;
};

export type MasterDataImportTargetConfig = {
  target: MasterDataImportTarget;
  entity: string;
  docType: string;
  module: AppModule;
  label: string;
  description: string;
  keyLabel: string;
  fields: MasterDataImportField[];
  templateRows: Record<string, string>[];
};

export const MASTER_DATA_IMPORT_MODES: Array<{
  value: MasterDataImportMode;
  label: string;
  description: string;
}> = [
  {
    value: 'createOnly',
    label: 'Tambah baru saja',
    description: 'Baris yang sudah ada akan dilewati. Cocok untuk upload master data awal.',
  },
  {
    value: 'updateOnly',
    label: 'Update data yang sudah ada',
    description: 'Baris yang belum ada akan dilewati. Cocok untuk koreksi massal.',
  },
  {
    value: 'upsert',
    label: 'Tambah atau update',
    description: 'Data yang sudah ada diperbarui, data baru ditambahkan.',
  },
];

export const MASTER_DATA_IMPORT_TARGETS: MasterDataImportTargetConfig[] = [
  {
    target: 'customers',
    entity: 'customers',
    docType: 'customer',
    module: 'customers',
    label: 'Customer',
    description: 'Import master customer. Kunci cocok data memakai nama customer.',
    keyLabel: 'Nama Customer',
    fields: [
      { key: 'name', label: 'Nama Customer', required: true, aliases: ['nama', 'nama customer', 'customer', 'customer name'], example: 'PT Contoh Logistik' },
      { key: 'address', label: 'Alamat', aliases: ['alamat', 'address'], example: 'Jl. Industri No. 1' },
      { key: 'contactPerson', label: 'PIC', aliases: ['pic', 'kontak', 'contact person'], example: 'Budi' },
      { key: 'phone', label: 'Telepon', aliases: ['telepon', 'telp', 'hp', 'phone'], example: '08123456789' },
      { key: 'email', label: 'Email', aliases: ['email'], example: 'billing@contoh.co.id' },
      { key: 'defaultPaymentTerm', label: 'Termin Default', aliases: ['termin', 'termin default', 'default payment term'], example: '14' },
      { key: 'creditLimitAmount', label: 'Limit Piutang', aliases: ['limit piutang', 'credit limit', 'credit limit amount'], example: '50000000' },
      { key: 'npwp', label: 'NPWP', aliases: ['npwp'], example: '01.234.567.8-901.000' },
      { key: 'deliveryOrderPrefix', label: 'Prefix SJ', aliases: ['prefix sj', 'format sj', 'delivery order prefix'], example: 'SJ' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif', options: { kind: 'static', values: ['Aktif', 'Nonaktif'] } },
    ],
    templateRows: [
      {
        name: 'PT Contoh Logistik',
        address: 'Jl. Industri No. 1',
        contactPerson: 'Budi',
        phone: '08123456789',
        email: 'billing@contoh.co.id',
        defaultPaymentTerm: '14',
        creditLimitAmount: '50000000',
        npwp: '',
        deliveryOrderPrefix: 'SJ',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'suppliers',
    entity: 'suppliers',
    docType: 'supplier',
    module: 'suppliers',
    label: 'Supplier',
    description: 'Import master supplier. Kunci cocok data memakai kode supplier.',
    keyLabel: 'Kode Supplier',
    fields: [
      { key: 'supplierCode', label: 'Kode Supplier', required: true, aliases: ['kode', 'kode supplier', 'supplier code'], example: 'SUP-001' },
      { key: 'name', label: 'Nama Supplier', required: true, aliases: ['nama', 'nama supplier', 'supplier'], example: 'PT Supplier Ban' },
      { key: 'contactPerson', label: 'PIC', aliases: ['pic', 'kontak', 'contact person'], example: 'Sari' },
      { key: 'phone', label: 'Telepon', aliases: ['telepon', 'telp', 'hp', 'phone'], example: '0811111111' },
      { key: 'address', label: 'Alamat', aliases: ['alamat', 'address'], example: 'Jl. Raya Gudang' },
      { key: 'defaultTermDays', label: 'Termin Default', aliases: ['termin', 'termin default', 'default term days'], example: '14' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif', options: { kind: 'static', values: ['Aktif', 'Nonaktif'] } },
    ],
    templateRows: [
      {
        supplierCode: 'SUP-001',
        name: 'PT Supplier Ban',
        contactPerson: 'Sari',
        phone: '0811111111',
        address: 'Jl. Raya Gudang',
        defaultTermDays: '14',
        notes: '',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'customer-products',
    entity: 'customer-products',
    docType: 'customerProduct',
    module: 'customers',
    label: 'Master Barang Customer',
    description: 'Import master barang milik customer untuk pilihan item Order/SJ. Kunci cocok data memakai nama customer dan kode barang customer; tidak terkait stok gudang.',
    keyLabel: 'Customer + Kode Barang Customer',
    fields: [
      { key: 'customerName', label: 'Nama Customer', required: true, aliases: ['customer', 'nama customer', 'customer name'], example: 'PT Contoh Logistik', help: 'Harus sama dengan master Customer yang sudah ada. Customer nonaktif tidak bisa dipakai untuk tambah barang baru.', options: { kind: 'master', source: 'customers', valueField: 'name' } },
      { key: 'code', label: 'Kode Barang Customer', required: true, aliases: ['kode', 'kode barang customer', 'product code', 'kode barang'], example: 'BRG-CUST-001', help: 'Wajib untuk import agar update aman per customer. Kode boleh sama di customer berbeda.' },
      { key: 'name', label: 'Nama Barang Customer', required: true, aliases: ['nama', 'nama barang', 'nama barang customer', 'product name'], example: 'Karton Produk A' },
      { key: 'description', label: 'Deskripsi Default', aliases: ['deskripsi', 'description', 'deskripsi default'], example: 'Karton Produk A', help: 'Akan mengisi deskripsi item order/SJ saat barang dipilih.' },
      { key: 'defaultQtyKoli', label: 'Default Koli', aliases: ['koli default', 'qty koli default', 'default qty koli', 'qty', 'koli'], example: '1' },
      { key: 'defaultWeightInputValue', label: 'Default Berat per Koli', aliases: ['berat default', 'berat per koli', 'default weight', 'default berat', 'weight'], example: '10', help: 'Nilai berat per koli. Sistem mengalikan dengan qty koli saat barang dipakai.' },
      { key: 'defaultWeightInputUnit', label: 'Satuan Berat', aliases: ['satuan berat', 'weight unit', 'unit berat'], example: 'KG', help: 'Pilihan: KG atau TON.', options: { kind: 'static', values: ['KG', 'TON'] } },
      { key: 'defaultVolumeInputValue', label: 'Default Volume per Koli', aliases: ['volume default', 'volume per koli', 'default volume', 'volume'], example: '0.05', help: 'Nilai volume per koli. Sistem mengalikan dengan qty koli saat barang dipakai.' },
      { key: 'defaultVolumeInputUnit', label: 'Satuan Volume', aliases: ['satuan volume', 'volume unit', 'unit volume'], example: 'M3', help: 'Pilihan: M3, LITER, atau KL.', options: { kind: 'static', values: ['M3', 'LITER', 'KL'] } },
      { key: 'notes', label: 'Catatan Internal', aliases: ['catatan', 'notes', 'catatan internal'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif', options: { kind: 'static', values: ['Aktif', 'Nonaktif'] } },
    ],
    templateRows: [
      {
        customerName: 'PT Contoh Logistik',
        code: 'BRG-CUST-001',
        name: 'Karton Produk A',
        description: 'Karton Produk A',
        defaultQtyKoli: '1',
        defaultWeightInputValue: '10',
        defaultWeightInputUnit: 'KG',
        defaultVolumeInputValue: '0.05',
        defaultVolumeInputUnit: 'M3',
        notes: '',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'warehouse-items',
    entity: 'warehouse-items',
    docType: 'warehouseItem',
    module: 'warehouseItems',
    label: 'Barang Gudang',
    description: 'Import master barang gudang. Stok awal tidak diimport di sini agar ledger stok tetap benar.',
    keyLabel: 'Kode Barang',
    fields: [
      { key: 'itemCode', label: 'Kode Barang', required: true, aliases: ['kode', 'kode barang', 'item code'], example: 'BRG-001' },
      { key: 'name', label: 'Nama Barang', required: true, aliases: ['nama', 'nama barang', 'barang'], example: 'Ban Truk 11R22.5 Bridgestone' },
      { key: 'category', label: 'Kategori', aliases: ['kategori', 'category'], example: 'Ban' },
      { key: 'unit', label: 'Satuan', aliases: ['satuan', 'unit'], example: 'PCS' },
      { key: 'trackingMode', label: 'Mode Tracking', aliases: ['mode tracking', 'tracking mode'], example: 'TIRE_ASSET', options: { kind: 'static', values: ['STANDARD', 'TIRE_ASSET'] } },
      { key: 'minStockQty', label: 'Stok Minimum', aliases: ['stok minimum', 'min stok', 'min stock qty'], example: '0' },
      { key: 'defaultSupplierCode', label: 'Kode Supplier Default', aliases: ['kode supplier default', 'default supplier code'], example: 'SUP-001', options: { kind: 'master', source: 'suppliers', valueField: 'supplierCode' } },
      { key: 'defaultSupplierName', label: 'Nama Supplier Default', aliases: ['supplier default', 'default supplier', 'default supplier name'], example: '', options: { kind: 'master', source: 'suppliers', valueField: 'name' } },
      { key: 'defaultPurchasePrice', label: 'Harga Beli Default', aliases: ['harga beli default', 'default purchase price'], example: '2850000' },
      { key: 'tireTypeDefault', label: 'Jenis Ban Default', aliases: ['jenis ban', 'jenis ban default', 'tire type default'], example: 'ORI kawat / radial' },
      { key: 'tireBrandDefault', label: 'Merk Ban Default', aliases: ['merk ban', 'merk ban default', 'tire brand default'], example: 'Bridgestone' },
      { key: 'tireSizeDefault', label: 'Ukuran Ban Default', aliases: ['ukuran ban', 'ukuran ban default', 'tire size default'], example: '11R22.5' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif', options: { kind: 'static', values: ['Aktif', 'Nonaktif'] } },
    ],
    templateRows: [
      {
        itemCode: 'BRG-001',
        name: 'Ban Truk 11R22.5 Bridgestone',
        category: 'Ban',
        unit: 'PCS',
        trackingMode: 'TIRE_ASSET',
        minStockQty: '0',
        defaultSupplierCode: 'SUP-001',
        defaultSupplierName: '',
        defaultPurchasePrice: '2850000',
        tireTypeDefault: 'ORI kawat / radial',
        tireBrandDefault: 'Bridgestone',
        tireSizeDefault: '11R22.5',
        notes: '',
        active: 'Aktif',
      },
      {
        itemCode: 'BRG-002',
        name: 'Oli Mesin 15W-40',
        category: 'Sparepart',
        unit: 'LITER',
        trackingMode: 'STANDARD',
        minStockQty: '10',
        defaultSupplierCode: '',
        defaultSupplierName: '',
        defaultPurchasePrice: '65000',
        tireTypeDefault: '',
        tireBrandDefault: '',
        tireSizeDefault: '',
        notes: '',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'trip-route-rates',
    entity: 'trip-route-rates',
    docType: 'tripRouteRate',
    module: 'tripRouteRates',
    label: 'Biaya Rute Trip',
    description: 'Import master biaya rute operasional trip. Kunci cocok data memakai asal, tujuan, dan jenis armada; ini bukan tarif billing customer.',
    keyLabel: 'Asal + Tujuan + Jenis Armada',
    fields: [
      { key: 'originArea', label: 'Asal Area', required: true, aliases: ['asal', 'asal area', 'area asal', 'origin', 'origin area'], example: 'Jawa Timur', help: 'Pilihan asal area dari data Biaya Rute Trip yang sudah ada; teks bebas tetap bisa diisi.', options: { kind: 'master', source: 'trip-route-rates', valueField: 'originArea', mode: 'suggest' } },
      { key: 'destinationArea', label: 'Tujuan Area', required: true, aliases: ['tujuan', 'tujuan area', 'area tujuan', 'destination', 'destination area'], example: 'Surabaya', help: 'Pilihan tujuan area dari data Biaya Rute Trip yang sudah ada; teks bebas tetap bisa diisi.', options: { kind: 'master', source: 'trip-route-rates', valueField: 'destinationArea', mode: 'suggest' } },
      { key: 'serviceCode', label: 'Kode Jenis Armada', aliases: ['kode jenis armada', 'kode armada', 'kode kategori armada', 'service code'], example: 'CDD', help: 'Opsional. Lebih aman diisi daripada nama karena nama bisa mirip.', options: { kind: 'master', source: 'services', valueField: 'code' } },
      { key: 'serviceName', label: 'Jenis Armada', aliases: ['jenis armada', 'kategori armada', 'nama jenis armada', 'service', 'service name'], example: 'CDD / Engkel', help: 'Opsional jika Kode Jenis Armada sudah diisi.', options: { kind: 'master', source: 'services', valueField: 'name' } },
      { key: 'rate', label: 'Tarif Trip', required: true, aliases: ['tarif', 'tarif trip', 'biaya', 'biaya trip', 'rate'], example: '1500000' },
      { key: 'overtonaseDriverRatePerTon', label: 'Overtonase Driver per Ton', aliases: ['overtonase', 'tarif overtonase', 'overtonase driver', 'overtonase per ton'], example: '75000' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif', options: { kind: 'static', values: ['Aktif', 'Nonaktif'] } },
    ],
    templateRows: [
      {
        originArea: 'Jawa Timur',
        destinationArea: 'Surabaya',
        serviceCode: 'CDD',
        serviceName: '',
        rate: '1500000',
        overtonaseDriverRatePerTon: '75000',
        notes: 'Contoh tarif khusus jenis armada',
        active: 'Aktif',
      },
      {
        originArea: 'Jawa Timur',
        destinationArea: 'Pasuruan',
        serviceCode: '',
        serviceName: '',
        rate: '900000',
        overtonaseDriverRatePerTon: '0',
        notes: 'Contoh tarif umum semua armada',
        active: 'Aktif',
      },
    ],
  },
  {
    target: 'customer-billing-rates',
    entity: 'customer-billing-rates',
    docType: 'customerBillingRate',
    module: 'customers',
    label: 'Tarif Billing Customer',
    description: 'Import tarif billing invoice per customer (tarif biaya). Kunci cocok data memakai customer, basis billing, jenis armada, dan rute.',
    keyLabel: 'Customer + Basis + Jenis Armada + Rute',
    fields: [
      { key: 'customerName', label: 'Nama Customer', required: true, aliases: ['customer', 'nama customer', 'customer name'], example: 'PT Contoh Logistik', help: 'Harus sama dengan master Customer yang sudah ada.', options: { kind: 'master', source: 'customers', valueField: 'name' } },
      { key: 'basis', label: 'Basis Billing', required: true, aliases: ['basis', 'basis billing', 'tarif per', 'basis tarif'], example: 'PER_LITER', help: 'Pilihan: PER_KG, PER_TON, PER_VOLUME, PER_LITER, atau PER_TRIP.', options: { kind: 'static', values: ['PER_KG', 'PER_TON', 'PER_VOLUME', 'PER_LITER', 'PER_TRIP'] } },
      { key: 'rate', label: 'Tarif', required: true, aliases: ['tarif', 'tarif biaya', 'tarif billing', 'rate'], example: '150' },
      { key: 'serviceCode', label: 'Kode Jenis Armada', aliases: ['kode jenis armada', 'kode armada', 'kode kategori armada', 'service code'], example: 'CDD', help: 'Opsional. Kosong = berlaku untuk semua jenis armada.', options: { kind: 'master', source: 'services', valueField: 'code' } },
      { key: 'routeFrom', label: 'Rute Dari', aliases: ['rute dari', 'dari', 'route from'], example: 'Jawa Timur', help: 'Pilihan asal area dari master Biaya Rute Trip; teks bebas tetap bisa diisi.', options: { kind: 'master', source: 'trip-route-rates', valueField: 'originArea', mode: 'suggest' } },
      { key: 'routeTo', label: 'Rute Ke', aliases: ['rute ke', 'tujuan', 'route to'], example: 'Surabaya', help: 'Pilihan tujuan area dari master Biaya Rute Trip; teks bebas tetap bisa diisi.', options: { kind: 'master', source: 'trip-route-rates', valueField: 'destinationArea', mode: 'suggest' } },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif', options: { kind: 'static', values: ['Aktif', 'Nonaktif'] } },
    ],
    templateRows: [
      {
        customerName: 'PT Contoh Logistik',
        basis: 'PER_LITER',
        rate: '150',
        serviceCode: 'CDD',
        routeFrom: 'Jawa Timur',
        routeTo: 'Surabaya',
        notes: 'Contoh tarif per liter',
        active: 'Aktif',
      },
      {
        customerName: 'PT Contoh Logistik',
        basis: 'PER_KG',
        rate: '2000',
        serviceCode: '',
        routeFrom: '',
        routeTo: '',
        notes: 'Contoh tarif per kg semua rute',
        active: 'Aktif',
      },
    ],
  },
];

export const getMasterDataImportTargetConfig = (target: string | null | undefined) => {
  return MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === target) || null;
}

export function getMasterDataImportExportColumns(target: MasterDataImportTarget): Array<{ header: string; key: string }> {
  const config = getMasterDataImportTargetConfig(target);
  return config ? config.fields.map((field) => ({ header: field.label, key: field.key })) : [];
}

export type MasterDataImportMasterFieldRequest = {
  key: string;
  source: MasterDataImportOptionSource;
  valueField: MasterDataImportOptionValueField;
};

export function getMasterDataImportMasterFieldRequests(config: MasterDataImportTargetConfig): MasterDataImportMasterFieldRequest[] {
  return config.fields.flatMap((field) => (
    field.options?.kind === 'master'
      ? [{ key: field.key, source: field.options.source, valueField: field.options.valueField }]
      : []
  ));
}

export function getMasterDataImportMasterSources(config: MasterDataImportTargetConfig): MasterDataImportOptionSource[] {
  const seen = new Set<MasterDataImportOptionSource>();
  getMasterDataImportMasterFieldRequests(config).forEach((request) => seen.add(request.source));
  return Array.from(seen);
}

export function getMasterDataImportStaticOptions(config: MasterDataImportTargetConfig): Record<string, string[]> {
  const resolve: Record<string, string[]> = {};
  config.fields.forEach((field) => {
    if (field.options?.kind === 'static' && field.options.values.length > 0) {
      resolve[field.key] = field.options.values;
    }
  });
  return resolve;
}

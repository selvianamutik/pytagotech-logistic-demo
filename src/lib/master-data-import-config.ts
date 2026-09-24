import type { AppModule } from './rbac';

export type MasterDataImportTarget = 'customers' | 'customer-products' | 'suppliers' | 'warehouse-items' | 'trip-route-rates';
export type MasterDataImportMode = 'createOnly' | 'updateOnly' | 'upsert';

export type MasterDataImportField = {
  key: string;
  label: string;
  required?: boolean;
  help?: string;
  aliases?: string[];
  example?: string;
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
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
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
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
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
      { key: 'customerName', label: 'Nama Customer', required: true, aliases: ['customer', 'nama customer', 'customer name'], example: 'PT Contoh Logistik', help: 'Harus sama dengan master Customer yang sudah ada. Customer nonaktif tidak bisa dipakai untuk tambah barang baru.' },
      { key: 'code', label: 'Kode Barang Customer', required: true, aliases: ['kode', 'kode barang customer', 'product code', 'kode barang'], example: 'BRG-CUST-001', help: 'Wajib untuk import agar update aman per customer. Kode boleh sama di customer berbeda.' },
      { key: 'name', label: 'Nama Barang Customer', required: true, aliases: ['nama', 'nama barang', 'nama barang customer', 'product name'], example: 'Karton Produk A' },
      { key: 'description', label: 'Deskripsi Default', aliases: ['deskripsi', 'description', 'deskripsi default'], example: 'Karton Produk A', help: 'Akan mengisi deskripsi item order/SJ saat barang dipilih.' },
      { key: 'defaultQtyKoli', label: 'Default Koli', aliases: ['koli default', 'qty koli default', 'default qty koli', 'qty', 'koli'], example: '1' },
      { key: 'defaultWeightInputValue', label: 'Default Berat per Koli', aliases: ['berat default', 'berat per koli', 'default weight', 'default berat', 'weight'], example: '10', help: 'Nilai berat per koli. Sistem mengalikan dengan qty koli saat barang dipakai.' },
      { key: 'defaultWeightInputUnit', label: 'Satuan Berat', aliases: ['satuan berat', 'weight unit', 'unit berat'], example: 'KG', help: 'Pilihan: KG atau TON.' },
      { key: 'defaultVolumeInputValue', label: 'Default Volume per Koli', aliases: ['volume default', 'volume per koli', 'default volume', 'volume'], example: '0.05', help: 'Nilai volume per koli. Sistem mengalikan dengan qty koli saat barang dipakai.' },
      { key: 'defaultVolumeInputUnit', label: 'Satuan Volume', aliases: ['satuan volume', 'volume unit', 'unit volume'], example: 'M3', help: 'Pilihan: M3, LITER, atau KL.' },
      { key: 'notes', label: 'Catatan Internal', aliases: ['catatan', 'notes', 'catatan internal'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
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
      { key: 'trackingMode', label: 'Mode Tracking', aliases: ['mode tracking', 'tracking mode'], example: 'TIRE_ASSET' },
      { key: 'minStockQty', label: 'Stok Minimum', aliases: ['stok minimum', 'min stok', 'min stock qty'], example: '0' },
      { key: 'defaultSupplierCode', label: 'Kode Supplier Default', aliases: ['kode supplier default', 'default supplier code'], example: 'SUP-001' },
      { key: 'defaultSupplierName', label: 'Nama Supplier Default', aliases: ['supplier default', 'default supplier', 'default supplier name'], example: '' },
      { key: 'defaultPurchasePrice', label: 'Harga Beli Default', aliases: ['harga beli default', 'default purchase price'], example: '2850000' },
      { key: 'tireTypeDefault', label: 'Jenis Ban Default', aliases: ['jenis ban', 'jenis ban default', 'tire type default'], example: 'ORI kawat / radial' },
      { key: 'tireBrandDefault', label: 'Merk Ban Default', aliases: ['merk ban', 'merk ban default', 'tire brand default'], example: 'Bridgestone' },
      { key: 'tireSizeDefault', label: 'Ukuran Ban Default', aliases: ['ukuran ban', 'ukuran ban default', 'tire size default'], example: '11R22.5' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
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
      { key: 'originArea', label: 'Asal Area', required: true, aliases: ['asal', 'asal area', 'area asal', 'origin', 'origin area'], example: 'Surabaya' },
      { key: 'destinationArea', label: 'Tujuan Area', required: true, aliases: ['tujuan', 'tujuan area', 'area tujuan', 'destination', 'destination area'], example: 'Malang' },
      { key: 'serviceCode', label: 'Kode Jenis Armada', aliases: ['kode jenis armada', 'kode armada', 'kode kategori armada', 'service code'], example: 'CDD', help: 'Opsional. Lebih aman diisi daripada nama karena nama bisa mirip.' },
      { key: 'serviceName', label: 'Jenis Armada', aliases: ['jenis armada', 'kategori armada', 'nama jenis armada', 'service', 'service name'], example: 'CDD / Engkel', help: 'Opsional jika Kode Jenis Armada sudah diisi.' },
      { key: 'rate', label: 'Tarif Trip', required: true, aliases: ['tarif', 'tarif trip', 'biaya', 'biaya trip', 'rate'], example: '1500000' },
      { key: 'overtonaseDriverRatePerTon', label: 'Overtonase Driver per Ton', aliases: ['overtonase', 'tarif overtonase', 'overtonase driver', 'overtonase per ton'], example: '75000' },
      { key: 'notes', label: 'Catatan', aliases: ['catatan', 'notes'], example: '' },
      { key: 'active', label: 'Status Aktif', aliases: ['status', 'aktif', 'active'], example: 'Aktif' },
    ],
    templateRows: [
      {
        originArea: 'Surabaya',
        destinationArea: 'Malang',
        serviceCode: 'CDD',
        serviceName: '',
        rate: '1500000',
        overtonaseDriverRatePerTon: '75000',
        notes: 'Contoh tarif khusus jenis armada',
        active: 'Aktif',
      },
      {
        originArea: 'Surabaya',
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
];

export function getMasterDataImportTargetConfig(target: string | null | undefined) {
  return MASTER_DATA_IMPORT_TARGETS.find((item) => item.target === target) || null;
}

export function getMasterDataImportExportColumns(target: MasterDataImportTarget): Array<{ header: string; key: string }> {
  const config = getMasterDataImportTargetConfig(target);
  return config ? config.fields.map((field) => ({ header: field.label, key: field.key })) : [];
}

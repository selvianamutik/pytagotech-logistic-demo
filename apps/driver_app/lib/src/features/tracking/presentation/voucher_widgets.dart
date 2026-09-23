import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';

import '../domain/models.dart';
import 'mobile_action_feedback.dart';

const _jakartaUtcOffset = Duration(hours: 7);
final _dateOnlyPattern = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

DateTime _toJakartaDateTime(DateTime value) {
  return value.toUtc().add(_jakartaUtcOffset);
}

String formatRupiah(num value) {
  final rounded = value.round().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < rounded.length; index++) {
    final remaining = rounded.length - index;
    buffer.write(rounded[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return 'Rp ${buffer.toString()}';
}

String _formatDateText(String? value) {
  final rawValue = value?.trim();
  if (rawValue == null || rawValue.isEmpty) return '-';
  final dateOnlyMatch = _dateOnlyPattern.firstMatch(rawValue);
  if (dateOnlyMatch != null) {
    return '${dateOnlyMatch.group(3)}/${dateOnlyMatch.group(2)}/${dateOnlyMatch.group(1)}';
  }
  final parsed = DateTime.tryParse(rawValue);
  if (parsed == null) return rawValue;
  final local = _toJakartaDateTime(parsed);
  String twoDigits(int input) => input.toString().padLeft(2, '0');
  return '${twoDigits(local.day)}/${twoDigits(local.month)}/${local.year}';
}

String _textOrDash(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? '-' : trimmed;
}

String _voucherDisbursementLabel(
  DriverTripVoucherDisbursement disbursement,
  int sequence,
) {
  if (disbursement.kind == 'INITIAL' || disbursement.kind == 'TOP_UP') {
    return formatDriverTripVoucherBonLabel(sequence);
  }
  return disbursement.kind;
}

String _voucherDisbursementSummary(DriverTripVoucher voucher) {
  final totalDisbursements = voucher.disbursements.length;
  if (totalDisbursements == 0) return 'Detail pencairan belum tersedia';
  final topUpCount = voucher.disbursements
      .where((item) => item.kind == 'TOP_UP')
      .length;
  if (topUpCount == 0) return '1 pencairan dalam bon ini';
  return '$totalDisbursements pencairan dalam bon ini';
}

String _voucherPdfFileName(DriverTripVoucher voucher) {
  final safeBon = voucher.bonNumber.replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_');
  return 'uang-jalan-$safeBon.pdf';
}

pw.Widget _pdfKeyValue(String label, String value) {
  return pw.Padding(
    padding: const pw.EdgeInsets.only(bottom: 6),
    child: pw.Row(
      crossAxisAlignment: pw.CrossAxisAlignment.start,
      children: [
        pw.SizedBox(
          width: 105,
          child: pw.Text(
            label,
            style: pw.TextStyle(fontWeight: pw.FontWeight.bold),
          ),
        ),
        pw.Expanded(child: pw.Text(value)),
      ],
    ),
  );
}

pw.TableRow _pdfTableHeader(List<String> cells) {
  return pw.TableRow(
    decoration: const pw.BoxDecoration(color: PdfColor.fromInt(0xFFEFF4FA)),
    children: cells
        .map(
          (cell) => pw.Padding(
            padding: const pw.EdgeInsets.all(6),
            child: pw.Text(
              cell,
              style: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 9),
            ),
          ),
        )
        .toList(growable: false),
  );
}

pw.TableRow _pdfTableRow(List<String> cells) {
  return pw.TableRow(
    children: cells
        .map(
          (cell) => pw.Padding(
            padding: const pw.EdgeInsets.all(6),
            child: pw.Text(cell, style: const pw.TextStyle(fontSize: 9)),
          ),
        )
        .toList(growable: false),
  );
}

Future<Uint8List> _buildDriverVoucherPdf(DriverTripVoucher voucher) async {
  final document = pw.Document();
  final disbursements = voucher.disbursements;
  final expenses = voucher.items;

  document.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (context) => [
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(
                  'PT Gading Mas Surya',
                  style: pw.TextStyle(
                    fontSize: 18,
                    fontWeight: pw.FontWeight.bold,
                  ),
                ),
                pw.SizedBox(height: 4),
                pw.Text('Uang Jalan Trip ${voucher.bonNumber}'),
              ],
            ),
            pw.Text(
              'Dicetak: ${_formatDateText(DateTime.now().toUtc().toIso8601String())}',
            ),
          ],
        ),
        pw.SizedBox(height: 14),
        pw.Divider(thickness: 1.2),
        pw.SizedBox(height: 14),
        pw.Row(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  _pdfKeyValue('No. Bon', voucher.bonNumber),
                  _pdfKeyValue('Tanggal', _formatDateText(voucher.issuedDate)),
                  _pdfKeyValue('No. DO', _textOrDash(voucher.doNumber)),
                  _pdfKeyValue('Kendaraan', _textOrDash(voucher.vehiclePlate)),
                  _pdfKeyValue('Rute', _textOrDash(voucher.route)),
                  _pdfKeyValue('Status', voucher.statusLabel),
                ],
              ),
            ),
            pw.SizedBox(width: 18),
            pw.Expanded(
              child: pw.Column(
                crossAxisAlignment: pw.CrossAxisAlignment.start,
                children: [
                  _pdfKeyValue(
                    'Total Uang',
                    formatRupiah(voucher.totalIssuedAmount),
                  ),
                  _pdfKeyValue(
                    'Biaya Lain-lain',
                    formatRupiah(voucher.operationalSpent),
                  ),
                  _pdfKeyValue(
                    'Sisa Bon',
                    formatRupiah(voucher.operationalBalance),
                  ),
                  _pdfKeyValue(
                    'Upah Borongan',
                    formatRupiah(voucher.driverFeeAmount),
                  ),
                  _pdfKeyValue(
                    voucher.settlementDisplayLabel,
                    formatRupiah(voucher.netSettlementAmount.abs()),
                  ),
                ],
              ),
            ),
          ],
        ),
        pw.SizedBox(height: 18),
        pw.Text(
          'Riwayat Pencairan Uang Jalan',
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
        ),
        pw.SizedBox(height: 8),
        pw.Table(
          border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFFD6DEE8)),
          columnWidths: const {
            0: pw.FixedColumnWidth(28),
            1: pw.FixedColumnWidth(70),
            2: pw.FlexColumnWidth(),
            3: pw.FlexColumnWidth(),
            4: pw.FlexColumnWidth(),
            5: pw.FixedColumnWidth(78),
          },
          children: [
            _pdfTableHeader([
              'No',
              'Tanggal',
              'Jenis',
              'Sumber Dana',
              'Catatan',
              'Jumlah',
            ]),
            if (disbursements.isEmpty)
              _pdfTableRow(['-', '-', 'Belum ada riwayat bon', '-', '-', '-'])
            else
              ...(() {
                return disbursements.indexed.map((entry) {
                  final index = entry.$1;
                  final item = entry.$2;
                  return _pdfTableRow([
                    '${index + 1}',
                    _formatDateText(item.date),
                    _voucherDisbursementLabel(item, index + 1),
                    _textOrDash(item.bankAccountName),
                    _textOrDash(item.note),
                    formatRupiah(item.amount),
                  ]);
                });
              })(),
          ],
        ),
        pw.SizedBox(height: 18),
        pw.Text(
          'Biaya Lain-lain',
          style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold),
        ),
        pw.SizedBox(height: 8),
        pw.Table(
          border: pw.TableBorder.all(color: const PdfColor.fromInt(0xFFD6DEE8)),
          columnWidths: const {
            0: pw.FixedColumnWidth(28),
            1: pw.FixedColumnWidth(70),
            2: pw.FlexColumnWidth(),
            3: pw.FlexColumnWidth(),
            4: pw.FixedColumnWidth(78),
          },
          children: [
            _pdfTableHeader([
              'No',
              'Tanggal',
              'Kategori',
              'Deskripsi',
              'Jumlah',
            ]),
            if (expenses.isEmpty)
              _pdfTableRow(['-', '-', 'Tidak ada biaya lain-lain', '-', '-'])
            else
              ...expenses.indexed.map((entry) {
                final index = entry.$1;
                final item = entry.$2;
                return _pdfTableRow([
                  '${index + 1}',
                  _formatDateText(item.expenseDate),
                  item.category,
                  _textOrDash(item.description),
                  formatRupiah(item.amount),
                ]);
              }),
          ],
        ),
      ],
    ),
  );

  return document.save();
}

Future<void> showDriverVoucherPreviewDialog(
  BuildContext context,
  DriverTripVoucher voucher,
) {
  return showDialog<void>(
    context: context,
    builder: (context) => DriverVoucherPreviewDialog(voucher: voucher),
  );
}

// ── Voucher card ───────────────────────────────────────────
class DriverVoucherCard extends StatelessWidget {
  const DriverVoucherCard({
    super.key,
    required this.voucher,
    required this.onPreview,
  });

  final DriverTripVoucher voucher;
  final VoidCallback onPreview;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final settlementColor = voucher.netSettlementAmount < 0
        ? scheme.error
        : scheme.primary;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    Icons.account_balance_wallet_outlined,
                    color: scheme.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        voucher.bonNumber,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'DO ${_textOrDash(voucher.doNumber)} | ${_formatDateText(voucher.issuedDate)}',
                        style: TextStyle(
                          color: scheme.onSurface.withValues(alpha: 0.62),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: scheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    voucher.statusLabel,
                    style: TextStyle(
                      color: scheme.secondary,
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: scheme.surfaceContainerHighest.withValues(alpha: 0.42),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                _voucherDisbursementSummary(voucher),
                style: TextStyle(
                  color: scheme.onSurface.withValues(alpha: 0.74),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 12),
            _VoucherInfoGrid(
              items: [
                _VoucherInfoItem(
                  label: 'Total Uang',
                  value: formatRupiah(voucher.totalIssuedAmount),
                ),
                _VoucherInfoItem(
                  label: 'Biaya Lain-lain',
                  value: formatRupiah(voucher.operationalSpent),
                ),
                _VoucherInfoItem(
                  label: 'Upah Borongan',
                  value: formatRupiah(voucher.driverFeeAmount),
                ),
                _VoucherInfoItem(
                  label: voucher.settlementDisplayLabel,
                  value: formatRupiah(voucher.netSettlementAmount.abs()),
                  color: settlementColor,
                  caption: voucher.settlementLabel,
                ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: onPreview,
                icon: const Icon(Icons.print_outlined, size: 18),
                label: const Text('Preview / PDF'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VoucherInfoItem {
  const _VoucherInfoItem({
    required this.label,
    required this.value,
    this.color,
    this.caption,
  });

  final String label;
  final String value;
  final Color? color;
  final String? caption;
}

class _VoucherInfoGrid extends StatelessWidget {
  const _VoucherInfoGrid({required this.items});

  final List<_VoucherInfoItem> items;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return LayoutBuilder(
      builder: (context, constraints) {
        final twoColumns = constraints.maxWidth >= 440;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: items
              .map(
                (item) => SizedBox(
                  width: twoColumns
                      ? (constraints.maxWidth - 10) / 2
                      : constraints.maxWidth,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest.withValues(
                        alpha: 0.42,
                      ),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: scheme.outlineVariant.withValues(alpha: 0.75),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.label,
                          style: TextStyle(
                            color: scheme.onSurface.withValues(alpha: 0.58),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          item.value,
                          softWrap: true,
                          overflow: TextOverflow.visible,
                          style: TextStyle(
                            color: item.color ?? scheme.onSurface,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (item.caption?.trim().isNotEmpty == true) ...[
                          const SizedBox(height: 3),
                          Text(
                            item.caption!,
                            style: TextStyle(
                              color: scheme.onSurface.withValues(alpha: 0.55),
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              )
              .toList(growable: false),
        );
      },
    );
  }
}

// ── Preview dialog ─────────────────────────────────────────
class DriverVoucherPreviewDialog extends StatelessWidget {
  const DriverVoucherPreviewDialog({super.key, required this.voucher});

  final DriverTripVoucher voucher;

  Future<void> _downloadPdf(BuildContext context) async {
    try {
      final bytes = await _buildDriverVoucherPdf(voucher);
      await Printing.sharePdf(
        bytes: bytes,
        filename: _voucherPdfFileName(voucher),
      );
    } catch (error) {
      if (!context.mounted) return;
      showMobileFeedback(
        context,
        type: MobileFeedbackType.error,
        message: 'Gagal membuat PDF: $error',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Dialog(
      insetPadding: const EdgeInsets.all(18),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560, maxHeight: 720),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Preview Uang Jalan',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          voucher.bonNumber,
                          style: TextStyle(
                            color: scheme.onSurface.withValues(alpha: 0.62),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _VoucherInfoGrid(
                      items: [
                        _VoucherInfoItem(
                          label: 'DO',
                          value: _textOrDash(voucher.doNumber),
                        ),
                        _VoucherInfoItem(
                          label: 'Tanggal',
                          value: _formatDateText(voucher.issuedDate),
                        ),
                        _VoucherInfoItem(
                          label: 'Kendaraan',
                          value: _textOrDash(voucher.vehiclePlate),
                        ),
                        _VoucherInfoItem(
                          label: 'Rute',
                          value: _textOrDash(voucher.route),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    const Text(
                      'Ringkasan',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 10),
                    _VoucherSummaryLine(
                      label: 'Total uang diberikan',
                      value: formatRupiah(voucher.totalIssuedAmount),
                    ),
                    _VoucherSummaryLine(
                      label: 'Biaya lain-lain',
                      value: formatRupiah(voucher.operationalSpent),
                    ),
                    _VoucherSummaryLine(
                      label: 'Sisa bon operasional',
                      value: formatRupiah(voucher.operationalBalance),
                    ),
                    _VoucherSummaryLine(
                      label: 'Upah borongan',
                      value: formatRupiah(voucher.driverFeeAmount),
                    ),
                    _VoucherSummaryLine(
                      label: voucher.settlementDisplayLabel,
                      value: formatRupiah(voucher.netSettlementAmount.abs()),
                    ),
                    const SizedBox(height: 18),
                    _VoucherHistorySection(voucher: voucher),
                  ],
                ),
              ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Tutup'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () => _downloadPdf(context),
                      icon: const Icon(Icons.download_rounded, size: 18),
                      label: const Text('Download PDF'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VoucherSummaryLine extends StatelessWidget {
  const _VoucherSummaryLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              softWrap: true,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.64),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.right,
              softWrap: true,
              overflow: TextOverflow.visible,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _VoucherHistorySection extends StatelessWidget {
  const _VoucherHistorySection({required this.voucher});

  final DriverTripVoucher voucher;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Detail pencairan bon ini',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        if (voucher.disbursements.isEmpty)
          Text(
            'Belum ada riwayat bon.',
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.56)),
          )
        else
          ...(() {
            return voucher.disbursements.indexed.map((entry) {
              final sequence = entry.$1 + 1;
              final item = entry.$2;
              return _VoucherHistoryRow(
                title: _voucherDisbursementLabel(item, sequence),
                subtitle:
                    '${_formatDateText(item.date)} | ${_textOrDash(item.bankAccountName)}',
                amount: formatRupiah(item.amount),
              );
            });
          })(),
        const SizedBox(height: 16),
        const Text(
          'Biaya lain-lain',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        if (voucher.items.isEmpty)
          Text(
            'Tidak ada biaya lain-lain.',
            style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.56)),
          )
        else
          ...voucher.items.map(
            (item) => _VoucherHistoryRow(
              title: item.category,
              subtitle:
                  '${_formatDateText(item.expenseDate)} | ${_textOrDash(item.description)}',
              amount: formatRupiah(item.amount),
            ),
          ),
      ],
    );
  }
}

class _VoucherHistoryRow extends StatelessWidget {
  const _VoucherHistoryRow({
    required this.title,
    required this.subtitle,
    required this.amount,
  });

  final String title;
  final String subtitle;
  final String amount;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.34),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: scheme.onSurface.withValues(alpha: 0.58),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              amount,
              textAlign: TextAlign.right,
              softWrap: true,
              overflow: TextOverflow.visible,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

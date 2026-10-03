import 'package:flutter/material.dart';

import '../domain/models.dart';
import 'voucher_widgets.dart';

enum _VoucherStatusFilter {
  all('Semua'),
  draft('Draft'),
  issued('Diberikan'),
  settled('Selesai');

  const _VoucherStatusFilter(this.label);

  final String label;

  bool matches(DriverTripVoucher voucher) {
    return switch (this) {
      all => true,
      draft => voucher.status == 'DRAFT',
      issued => voucher.status == 'ISSUED',
      settled => voucher.status == 'SETTLED',
    };
  }
}

class VoucherHistoryPage extends StatefulWidget {
  const VoucherHistoryPage({
    super.key,
    required this.initialVouchers,
    required this.onRefresh,
  });

  /// Vouchers already loaded by the caller (shown immediately).
  final List<DriverTripVoucher> initialVouchers;

  /// Re-fetches fresh vouchers (e.g. via the parent's fresh-session-aware
  /// loader) and returns them for display.
  final Future<List<DriverTripVoucher>> Function() onRefresh;

  @override
  State<VoucherHistoryPage> createState() => _VoucherHistoryPageState();
}

class _VoucherHistoryPageState extends State<VoucherHistoryPage> {
  static const List<String> _monthNames = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];

  late List<DriverTripVoucher> _vouchers;
  String? _refreshError;
  _VoucherStatusFilter _filter = _VoucherStatusFilter.all;
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _vouchers = _dedupe(widget.initialVouchers);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<DriverTripVoucher> _dedupe(List<DriverTripVoucher> vouchers) {
    final result = <DriverTripVoucher>[];
    final seenKeys = <String>{};
    for (final voucher in vouchers) {
      final key = voucher.id.trim().isNotEmpty ? voucher.id : voucher.bonNumber;
      if (seenKeys.add(key)) {
        result.add(voucher);
      }
    }
    return result;
  }

  int _countFor(_VoucherStatusFilter filter) {
    return _vouchers.where(filter.matches).length;
  }

  List<DriverTripVoucher> get _filtered {
    final query = _searchController.text.trim().toLowerCase();
    final vouchers = _vouchers.where((voucher) {
      if (_filter != _VoucherStatusFilter.all && !_filter.matches(voucher)) {
        return false;
      }
      if (query.isEmpty) return true;
      return voucher.bonNumber.toLowerCase().contains(query) ||
          (voucher.doNumber ?? '').toLowerCase().contains(query);
    });
    return vouchers.toList(growable: false);
  }

  int _sortStampOf(String? date) {
    final parsed = DateTime.tryParse(date?.trim() ?? '');
    if (parsed == null) return 0;
    return parsed.millisecondsSinceEpoch;
  }

  String? _monthKeyOf(String date) {
    final trimmed = date.trim();
    final match = RegExp(r'^(\d{4})[-/](\d{1,2})[-/]').firstMatch(trimmed);
    if (match != null) {
      return '${match.group(1)}-${match.group(2)!.padLeft(2, '0')}';
    }
    final parsed = DateTime.tryParse(trimmed);
    if (parsed != null) {
      return '${parsed.year.toString().padLeft(4, '0')}-${parsed.month.toString().padLeft(2, '0')}';
    }
    return null;
  }

  String _monthLabelOf(String monthKey) {
    final parts = monthKey.split('-');
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    if (year != null &&
        month != null &&
        month >= 1 &&
        month <= _monthNames.length) {
      return '${_monthNames[month - 1]} $year';
    }
    return monthKey;
  }

  Future<void> _refresh() async {
    setState(() => _refreshError = null);
    try {
      final vouchers = await widget.onRefresh();
      if (!mounted) return;
      setState(() => _vouchers = _dedupe(vouchers));
    } catch (error) {
      if (!mounted) return;
      setState(() => _refreshError = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Riwayat Bon Uang Jalan')),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _buildFilters(scheme),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              controller: _searchController,
              textInputAction: TextInputAction.search,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Cari no. bon atau no. DO',
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear_rounded, size: 20),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {});
                        },
                      ),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(vertical: 12),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
            ),
          ),
          Expanded(child: _buildBody(scheme)),
        ],
      ),
    );
  }

  Widget _buildFilters(ColorScheme scheme) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Row(
        children: [
          for (final filter in _VoucherStatusFilter.values) ...[
            if (filter != _VoucherStatusFilter.values.first)
              const SizedBox(width: 8),
            ChoiceChip(
              label: Text('${filter.label} (${_countFor(filter)})'),
              selected: _filter == filter,
              onSelected: (_) => setState(() => _filter = filter),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBody(ColorScheme scheme) {
    if (_vouchers.isEmpty) {
      return _buildEmptyState(
        icon: Icons.account_balance_wallet_outlined,
        title: 'Belum ada uang jalan trip',
        message:
            'Bon uang jalan akan muncul setelah admin menerbitkan bon untuk trip kamu.',
        onRetry: _refreshError != null ? _refresh : null,
      );
    }

    final sorted = [..._filtered]
      ..sort(
        (a, b) =>
            _sortStampOf(b.issuedDate).compareTo(_sortStampOf(a.issuedDate)),
      );

    final groups = <String, List<DriverTripVoucher>>{};
    for (final voucher in sorted) {
      final key = _monthKeyOf(voucher.issuedDate) ?? 'Lainnya';
      groups.putIfAbsent(key, () => []).add(voucher);
    }
    final orderedGroups = groups.entries.toList()
      ..sort((a, b) {
        if (a.key == 'Lainnya') return 1;
        if (b.key == 'Lainnya') return -1;
        return b.key.compareTo(a.key);
      });

    if (orderedGroups.isEmpty) {
      return _buildEmptyState(
        icon: Icons.filter_alt_off_rounded,
        title: 'Tidak ada bon yang cocok',
        message:
            'Coba ubah filter status atau kata kunci pencarian untuk melihat bon lain.',
      );
    }

    final children = <Widget>[];
    if (_refreshError != null) {
      children.add(
        _StaleRefreshBanner(message: _refreshError!, onRetry: _refresh),
      );
    }
    for (final group in orderedGroups) {
      final monthTotal = group.value.fold<double>(
        0,
        (sum, voucher) => sum + voucher.totalIssuedAmount,
      );
      children.add(
        _MonthHeader(
          title: group.key == 'Lainnya' ? 'Lainnya' : _monthLabelOf(group.key),
          count: group.value.length,
          total: monthTotal,
        ),
      );
      children.addAll(
        group.value.map(
          (voucher) => Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: DriverVoucherExpandableCard(
              voucher: voucher,
              onPreview: () => showDriverVoucherPreviewDialog(context, voucher),
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(top: 4, bottom: 24),
        children: children,
      ),
    );
  }

  Widget _buildEmptyState({
    required IconData icon,
    required String title,
    required String message,
    VoidCallback? onRetry,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 44,
              color: scheme.onSurface.withValues(alpha: 0.28),
            ),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 13,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Coba lagi'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StaleRefreshBanner extends StatelessWidget {
  const _StaleRefreshBanner({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: scheme.errorContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: scheme.error.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.cloud_off_rounded, size: 18, color: scheme.error),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Data di bawah belum termuat terbaru.',
                  style: TextStyle(
                    color: scheme.error,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Padding(
            padding: const EdgeInsets.only(left: 26),
            child: Text(
              message,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.62),
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: 26),
              child: OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 16),
                label: const Text('Muat ulang'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MonthHeader extends StatelessWidget {
  const _MonthHeader({
    required this.title,
    required this.count,
    required this.total,
  });

  final String title;
  final int count;
  final double total;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
      child: Row(
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(width: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: scheme.primaryContainer,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              '$count',
              style: TextStyle(
                color: scheme.primary,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ),
          const Spacer(),
          Text(
            formatRupiah(total),
            style: TextStyle(
              color: scheme.primary,
              fontWeight: FontWeight.w800,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}

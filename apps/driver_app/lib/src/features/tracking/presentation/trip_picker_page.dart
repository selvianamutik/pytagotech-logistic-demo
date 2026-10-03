import 'package:flutter/material.dart';

import '../domain/models.dart';
import 'trip_widgets.dart';

/// Jumlah trip yang ditampilkan sekaligus. Diubah lewat [initialLimit].
const int kTripPickerPageSize = 10;

/// Halaman memilih trip.
///
/// Search dan filter status bekerja di atas SELURUH trip, lalu hasilnya
/// dipaginasi. Jadi angka di chip selalu total keseluruhan, bukan hanya
/// yang sedang dimuat.
class TripPickerPage extends StatefulWidget {
  const TripPickerPage({
    super.key,
    required this.trips,
    this.selectedDeliveryOrderId,
    this.initialLimit = kTripPickerPageSize,
  });

  final List<DeliveryTrip> trips;
  final String? selectedDeliveryOrderId;
  final int initialLimit;

  @override
  State<TripPickerPage> createState() => _TripPickerPageState();
}

class _TripPickerPageState extends State<TripPickerPage> {
  final TextEditingController _searchController = TextEditingController();
  TripStatus? _statusFilter;
  late int _limit;

  @override
  void initState() {
    super.initState();
    _limit = widget.initialLimit;
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  bool _matchesSearch(DeliveryTrip trip, String needle) {
    if (needle.isEmpty) return true;
    return [
      trip.doNumber,
      trip.customerName,
      trip.vehiclePlate,
      trip.originLabel,
      trip.destinationLabel,
      trip.etdLabel,
      trip.receiverName,
      trip.itemSummary,
    ].any((value) => (value ?? '').toLowerCase().contains(needle));
  }

  int _countForStatus(TripStatus? status) {
    final needle = _searchController.text.trim().toLowerCase();
    return widget.trips.where((trip) {
      if (status != null && trip.status != status) return false;
      return _matchesSearch(trip, needle);
    }).length;
  }

  List<DeliveryTrip> get _filtered {
    final needle = _searchController.text.trim().toLowerCase();
    return widget.trips
        .where((trip) {
          if (_statusFilter != null && trip.status != _statusFilter) {
            return false;
          }
          return _matchesSearch(trip, needle);
        })
        .toList(growable: false);
  }

  bool get _hasActiveFilters {
    if (_statusFilter != null) return true;
    return _searchController.text.trim().isNotEmpty;
  }

  void _clearFilters() {
    setState(() {
      _searchController.clear();
      _statusFilter = null;
      _limit = widget.initialLimit;
    });
  }

  /// Setiap perubahan filter mengulang dari halaman awal, supaya tidak
  /// menyisakan hasil kosong di layar setelah digeser.
  void _resetPaging() {
    _limit = widget.initialLimit;
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final visible = filtered.take(_limit).toList(growable: false);
    final hasMore = visible.length < filtered.length;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Pilih Trip',
          style: TextStyle(fontWeight: FontWeight.w800),
        ),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Column(
                children: [_buildSearchField(), _buildStatusChips()],
              ),
            ),
            const SizedBox(height: 10),
            Expanded(
              child: widget.trips.isEmpty
                  ? const _EmptyState(
                      icon: Icons.local_shipping_outlined,
                      title: 'Belum ada trip',
                      message: 'Tidak ada trip yang bisa dipilih saat ini.',
                    )
                  : filtered.isEmpty
                  ? _EmptyState(
                      icon: Icons.filter_alt_off_rounded,
                      title: 'Tidak ada trip yang cocok',
                      message:
                          'Ubah kata kunci atau filter status untuk melihat trip lain.',
                      actionLabel: _hasActiveFilters ? 'Hapus filter' : null,
                      onAction: _hasActiveFilters ? _clearFilters : null,
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                      itemCount: visible.length + (hasMore ? 2 : 1),
                      itemBuilder: (context, index) {
                        if (index < visible.length) {
                          final trip = visible[index];
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: TripListCard(
                              trip: trip,
                              isSelected:
                                  trip.deliveryOrderId ==
                                  widget.selectedDeliveryOrderId,
                              onTap: () => Navigator.of(context).pop(trip),
                            ),
                          );
                        }
                        if (index == visible.length && hasMore) {
                          return _LoadMoreFooter(
                            loaded: visible.length,
                            total: filtered.length,
                            onLoadMore: () =>
                                setState(() => _limit += widget.initialLimit),
                          );
                        }
                        return const SizedBox.shrink();
                      },
                    ),
            ),
            if (widget.trips.isNotEmpty && filtered.isNotEmpty)
              _ResultCounter(shown: visible.length, total: filtered.length),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchField() {
    return TextField(
      controller: _searchController,
      textInputAction: TextInputAction.search,
      onChanged: (_) => setState(_resetPaging),
      decoration: InputDecoration(
        hintText: 'Cari no. DO, supir, kendaraan, atau rute',
        prefixIcon: const Icon(Icons.search_rounded, size: 20),
        suffixIcon: _searchController.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.clear_rounded, size: 20),
                onPressed: () => setState(() {
                  _searchController.clear();
                  _resetPaging();
                }),
              ),
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }

  Widget _buildStatusChips() {
    if (widget.trips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            ChoiceChip(
              label: Text('Semua (${_countForStatus(null)})'),
              selected: _statusFilter == null,
              onSelected: (_) => setState(() {
                _statusFilter = null;
                _resetPaging();
              }),
            ),
            for (final status in TripStatus.values) ...[
              const SizedBox(width: 8),
              ChoiceChip(
                label: Text(
                  '${deliveryStatusLabel(deliveryStatusApiValue(status))} '
                  '(${_countForStatus(status)})',
                ),
                selected: _statusFilter == status,
                onSelected: (selected) => setState(() {
                  _statusFilter = selected ? status : null;
                  _resetPaging();
                }),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ResultCounter extends StatelessWidget {
  const _ResultCounter({required this.shown, required this.total});

  final int shown;
  final int total;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: scheme.outlineVariant)),
      ),
      child: Text(
        'Menampilkan $shown dari $total trip',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: scheme.onSurface.withValues(alpha: 0.58),
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _LoadMoreFooter extends StatelessWidget {
  const _LoadMoreFooter({
    required this.loaded,
    required this.total,
    required this.onLoadMore,
  });

  final int loaded;
  final int total;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Column(
        children: [
          OutlinedButton.icon(
            onPressed: onLoadMore,
            icon: const Icon(Icons.expand_more_rounded, size: 18),
            label: Text('Muat lebih banyak ($loaded dari $total)'),
          ),
          const SizedBox(height: 6),
          Text(
            'Sisa ${total - loaded} trip',
            style: TextStyle(
              color: scheme.onSurface.withValues(alpha: 0.5),
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 38,
              color: scheme.onSurface.withValues(alpha: 0.28),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: scheme.onSurface.withValues(alpha: 0.58),
                fontSize: 12.5,
              ),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 14),
              OutlinedButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.filter_alt_off_rounded, size: 16),
                label: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

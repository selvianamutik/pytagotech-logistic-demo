import 'package:flutter/material.dart';

import '../theme.dart';

/// Kolom pencarian gaya Material 3.
///
/// Dipakai halaman daftar (pilih trip, daftar SJ, riwayat) supaya bentuk,
/// radius, dan perilaku clear-button konsisten di semua tempat.
class AppSearchField extends StatelessWidget {
  const AppSearchField({
    super.key,
    required this.controller,
    required this.onChanged,
    this.hintText,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String? hintText;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        return TextField(
          controller: controller,
          autofocus: autofocus,
          textInputAction: TextInputAction.search,
          onChanged: onChanged,
          style: const TextStyle(fontSize: 14),
          decoration: InputDecoration(
            hintText: hintText ?? 'Cari...',
            prefixIcon: const ExcludeSemantics(
              child: Icon(Icons.search_rounded, size: 20),
            ),
            suffixIcon: value.text.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.clear_rounded, size: 20),
                    tooltip: 'Hapus pencarian',
                    onPressed: () {
                      controller.clear();
                      onChanged('');
                    },
                  ),
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(vertical: 12),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
          ),
        );
      },
    );
  }
}

/// Deretan chip filter status yang bisa digeser horizontal.
///
/// Angka di chip selalu dihitung terhadap SELURUH data yang sudah terfilter
/// search, bukan hanya yang sedang dimuat, supaya tidak menyesatkan.
class AppFilterChipRow extends StatelessWidget {
  const AppFilterChipRow({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    if (children.isEmpty) return const SizedBox.shrink();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Row(
        children: [
          for (var index = 0; index < children.length; index++) ...[
            if (index > 0) const SizedBox(width: AppSpacing.xs),
            children[index],
          ],
        ],
      ),
    );
  }
}

/// Offset WIB. Semua timestamp dari server disimpan dalam UTC dan
/// ditampilkan dalam waktu lokal.
const Duration kJakartaUtcOffset = Duration(hours: 7);

DateTime toJakartaDateTime(DateTime value) {
  return value.toUtc().add(kJakartaUtcOffset);
}

/// Format angka sebagai rupiah, tanpa desimal.
///
/// Sengaja tanpa `intl`: aplikasi ini tidak punya locale setup, dan angka
/// rupiah selalu ditampilkan dengan titik sebagai pemisah ribuan.
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

/// Format angka dengan pemisah ribuan, tanpa prefix mata uang.
String formatThousands(num value) {
  final rounded = value.round().toString();
  final buffer = StringBuffer();
  for (var index = 0; index < rounded.length; index++) {
    final remaining = rounded.length - index;
    buffer.write(rounded[index]);
    if (remaining > 1 && remaining % 3 == 1) {
      buffer.write('.');
    }
  }
  return buffer.toString();
}

/// Format tanggal server (ISO `YYYY-MM-DD`, atau datetime ISO) ke
/// `DD-MM-YYYY` untuk driver Indonesia.
///
/// Sengaja tanpa `intl`: satu format, tidak butuh locale setup. Kalau input
/// kosong atau tidak bisa diparse, kembalikan '-' agar UI tidak menampilkan
/// mentah yang membingungkan.
String formatDdMmYyyy(String? raw) {
  final text = (raw ?? '').trim();
  if (text.isEmpty) return '-';
  final parsed = DateTime.tryParse(text);
  if (parsed == null) return text;
  final day = parsed.day.toString().padLeft(2, '0');
  final month = parsed.month.toString().padLeft(2, '0');
  return '$day-$month-${parsed.year}';
}

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

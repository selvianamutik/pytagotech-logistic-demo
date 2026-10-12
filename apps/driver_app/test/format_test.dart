import 'package:driver_app/src/shared/format.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('formatDdMmYyyy', () {
    test('tanggal ISO menjadi DD-MM-YYYY', () {
      expect(formatDdMmYyyy('2026-10-05'), '05-10-2026');
      expect(formatDdMmYyyy('2026-01-09'), '09-01-2026');
    });

    test('datetime ISO hanya diambil tanggalnya', () {
      expect(formatDdMmYyyy('2026-10-05T14:30:00.000Z'), '05-10-2026');
    });

    test('kosong atau null menjadi strip', () {
      expect(formatDdMmYyyy(''), '-');
      expect(formatDdMmYyyy('   '), '-');
      expect(formatDdMmYyyy(null), '-');
    });

    test('yang tidak bisa diparse ditampilkan apa adanya', () {
      expect(formatDdMmYyyy('segera'), 'segera');
    });
  });
}

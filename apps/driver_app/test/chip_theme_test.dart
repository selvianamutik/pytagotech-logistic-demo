import 'package:driver_app/src/shared/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Regresi untuk bug "teks filter tidak terlihat": label ChoiceChip yang
/// tidak aktif pernah mewarisi warna nyaris putih di atas chip putih.
/// Kedua state sekarang punya warna eksplisit di tema.
void main() {
  Future<void> pumpChips(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(),
        home: Scaffold(
          body: Row(
            children: [
              ChoiceChip(
                label: const Text('Aktif'),
                selected: true,
                onSelected: (_) {},
              ),
              const SizedBox(width: 8),
              ChoiceChip(
                label: const Text('Nonaktif'),
                selected: false,
                onSelected: (_) {},
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
  }

  Color resolvedLabelColor(WidgetTester tester, String label) {
    final element = tester.element(find.text(label));
    final color = DefaultTextStyle.of(element).style.color;
    expect(color, isNotNull, reason: 'label $label tidak punya warna teks');
    return color!;
  }

  testWidgets('label chip yang tidak aktif berwarna gelap', (tester) async {
    await pumpChips(tester);

    final color = resolvedLabelColor(tester, 'Nonaktif');
    expect(color, AppColors.ink);
    expect(
      color.computeLuminance(),
      lessThan(0.35),
      reason: 'label nonaktif harus gelap di atas chip putih',
    );
  });

  testWidgets('label chip yang aktif memakai merah brand', (tester) async {
    await pumpChips(tester);

    final color = resolvedLabelColor(tester, 'Aktif');
    expect(color, AppColors.brand);
    expect(
      color.computeLuminance(),
      lessThan(0.35),
      reason: 'label aktif harus gelap di atas chip pink muda',
    );
  });
}

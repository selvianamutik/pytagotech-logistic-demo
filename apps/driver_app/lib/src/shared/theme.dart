import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Skala spasi yang dipakai di seluruh app. Ritme 4/8dp: semua padding, gap,
/// dan jarak antar section wajib memakai salah satu nilai ini, bukan angka
/// karangan per file.
abstract final class AppSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
}

/// Radius sudut standar supaya kartu, tombol, dan input terasa satu bahasa.
abstract final class AppRadii {
  static const double sm = 12;
  static const double md = 14;
  static const double lg = 16;
  static const double xl = 20;
}

/// Warna semantik. Primer teal mengikuti brand Logistik Demo (lihat logo).
/// Jangan pakai merah untuk primer: merah dicadangkan untuk status
/// error/destruktif supaya peringatan selalu menonjol. Pakai konstanta ini,
/// bukan hex hardcode di halaman, supaya satu perubahan menyebar ke
/// seluruh app.
abstract final class AppColors {
  /// Teal brand Logistik Demo (dicocokkan ke logo truk). Kontras
  /// putih-di-atasnya ~5.0:1 (lolos 4.5:1). Satu const ini menggerakkan
  /// seluruh scheme Material: tombol, chip terpilih, switch, indikator.
  /// Ganti satu baris ini untuk rebrand ulang.
  static const Color brand = Color(0xFF0F766E);

  /// Tinta teks utama: hitam hangat, bukan hitam murni, supaya selaras
  /// dengan permukaan netral hangat.
  static const Color ink = Color(0xFF231817);

  static const Color success = Color(0xFF15803D);
  static const Color successSoft = Color(0xFFE5F3EA);

  static const Color warning = Color(0xFFB45309);
  static const Color warningSoft = Color(0xFFFEF3C7);

  static const Color info = Color(0xFF1D6FE0);
  static const Color infoSoft = Color(0xFFE7F0FE);
}

ThemeData buildAppTheme() {
  const base = AppColors.brand;
  // Netral hangat supaya selaras dengan merah brand (abu-abu dingin terlihat
  // "kantoran" dan berbenturan dengan logo).
  const surface = Color(0xFFF7F6F5);
  const outline = Color(0xFFE0DAD5);
  const ink = AppColors.ink;

  // Body minimum 12sp; caption di bawah itu dilarang kecuali angka tabular
  // yang tetap harus >=11sp dan tidak membawa informasi kritis sendirian.
  final textTheme = GoogleFonts.interTextTheme(
    const TextTheme(
      headlineMedium: TextStyle(
        fontSize: 28,
        fontWeight: FontWeight.w800,
        height: 1.1,
        letterSpacing: -0.5,
      ),
      headlineSmall: TextStyle(
        fontSize: 24,
        fontWeight: FontWeight.w800,
        height: 1.15,
        letterSpacing: -0.25,
      ),
      titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
      titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      bodyLarge: TextStyle(fontSize: 16, height: 1.5),
      bodyMedium: TextStyle(fontSize: 14, height: 1.45),
      bodySmall: TextStyle(fontSize: 12, height: 1.4),
      labelLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      labelMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      labelSmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
    ),
  );

  final scheme = ColorScheme.fromSeed(
    seedColor: base,
    brightness: Brightness.light,
  );

  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: surface,
    useMaterial3: true,
    fontFamily: GoogleFonts.inter().fontFamily,
    textTheme: textTheme,
    dividerTheme: const DividerThemeData(
      color: outline,
      thickness: 1,
      space: 1,
    ),
    appBarTheme: const AppBarTheme(
      centerTitle: false,
      backgroundColor: Colors.transparent,
      foregroundColor: ink,
      elevation: 0,
      scrolledUnderElevation: 1,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.lg),
        side: const BorderSide(color: outline),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: base,
        foregroundColor: Colors.white,
        // Target sentuh Android >=48dp.
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        side: const BorderSide(color: outline),
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: base,
        minimumSize: const Size(0, 44),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: ink,
        // 48dp hit area walau ikon visualnya kecil.
        minimumSize: const Size.square(48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.sm),
        ),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: const StadiumBorder(side: BorderSide(color: outline)),
      // Warna teks eksplisit di kedua state: tanpanya, label chip yang tidak
      // aktif mewarisi default M3 yang di perangkat terlihat nyaris putih di
      // atas chip putih. Ink saat normal, merah brand saat terpilih.
      labelStyle: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
      secondaryLabelStyle: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        color: base,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      backgroundColor: Colors.white,
      selectedColor: const Color(0xFFF7DEDD),
      checkmarkColor: base,
      side: const BorderSide(color: outline),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return Colors.white;
        return null;
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return base;
        return null;
      }),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: base),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadii.xl),
      ),
    ),
    checkboxTheme: CheckboxThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      hintStyle: TextStyle(
        color: ink.withValues(alpha: 0.45),
        fontWeight: FontWeight.w400,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.sm),
        borderSide: const BorderSide(color: outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.sm),
        borderSide: const BorderSide(color: outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.sm),
        borderSide: const BorderSide(color: base, width: 1.6),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadii.sm),
        borderSide: BorderSide(color: scheme.error),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
  );
}

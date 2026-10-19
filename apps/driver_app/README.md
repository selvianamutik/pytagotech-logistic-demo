# Logistik Demo Driver

App driver untuk operasional PT. Logistik Demo.

## Android Release Signing

1. Salin `android/key.properties.example` menjadi `android/key.properties`.
2. Isi nilai berikut sesuai keystore production:
   - `storeFile`
   - `storePassword`
   - `keyAlias`
   - `keyPassword`
3. Simpan file keystore di path yang sesuai dengan `storeFile`.

Jika `android/key.properties` belum ada, build `release` masih akan fallback ke debug signing untuk kebutuhan local smoke build. Jangan pakai fallback itu untuk distribusi production.

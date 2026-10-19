class AppConfig {
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://pytagotech-logistic-demo.vercel.app',
    // Lokal via adb reverse (adb reverse tcp:3000 tcp:3000).
    // defaultValue: 'http://localhost:3000',
  );
}

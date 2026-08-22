import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../shared/config.dart';
import 'driver_auth_service.dart';

class DriverAccountService {
  Future<String> updateAccountName({
    required String sessionToken,
    required String name,
  }) async {
    final trimmed = name.trim();
    final response = await http.patch(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/mobile/account'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({'name': trimmed}),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal menyimpan nama akun';
      throw DriverAuthException(message, response.statusCode);
    }

    final userValue = decoded['user'];
    if (userValue is Map<String, dynamic>) {
      final updatedName = userValue['name']?.toString();
      if (updatedName != null && updatedName.isNotEmpty) {
        return updatedName;
      }
    }
    return trimmed;
  }

  Future<void> changePassword({
    required String sessionToken,
    required String currentPassword,
    required String newPassword,
  }) async {
    final response = await http.post(
      Uri.parse('${AppConfig.apiBaseUrl}/api/driver/mobile/account'),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-client-type': 'driver-app',
        'Authorization': 'Bearer $sessionToken',
      },
      body: jsonEncode({
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      }),
    );

    final decoded = _decodeJson(response.body);
    if (response.statusCode >= 400) {
      final message = decoded['error'] is String
          ? decoded['error'] as String
          : 'Gagal mengubah password';
      throw DriverAuthException(message, response.statusCode);
    }
  }

  Map<String, dynamic> _decodeJson(String body) {
    if (body.isEmpty) return <String, dynamic>{};
    final decoded = jsonDecode(body);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }
}

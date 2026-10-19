import Foundation
import Security

/// Authentication mode used to connect to GitHub.
enum AuthMode: String, Codable {
    case githubApp
    case personalToken
}

/// Credentials stored in Keychain.
struct StoredCredentials: Codable, Equatable {
    let token: String
    let mode: AuthMode
}

/// Stores the GitHub credentials in the user's login Keychain. Never written to disk or defaults.
enum Keychain {
    private static let service = "com.jayantsolution.repobutler.github"
    private static let account = "personal-access-token"

    struct Failure: LocalizedError {
        let status: OSStatus
        var errorDescription: String? {
            "Keychain error \(status): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown")"
        }
    }

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    /// Reads credentials. Migrates legacy plain token strings to StoredCredentials(token, .personalToken).
    static func readCredentials() -> StoredCredentials? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }

        // Attempt decoding modern JSON format
        if let creds = try? JSONDecoder().decode(StoredCredentials.self, from: data) {
            return creds
        }

        // Legacy format: raw UTF-8 token string
        if let rawToken = String(data: data, encoding: .utf8), !rawToken.isEmpty {
            let migrated = StoredCredentials(token: rawToken, mode: .personalToken)
            // Migrate in-place
            try? saveCredentials(migrated)
            return migrated
        }

        return nil
    }

    /// Convenience for reading just the active access token.
    static func readToken() -> String? {
        readCredentials()?.token
    }

    static func saveCredentials(_ creds: StoredCredentials) throws {
        deleteCredentials()
        guard let data = try? JSONEncoder().encode(creds) else {
            throw Failure(status: errSecParam)
        }
        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure(status: status) }
    }

    static func saveToken(_ token: String, mode: AuthMode = .personalToken) throws {
        try saveCredentials(StoredCredentials(token: token, mode: mode))
    }

    static func deleteCredentials() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    static func deleteToken() {
        deleteCredentials()
    }
}

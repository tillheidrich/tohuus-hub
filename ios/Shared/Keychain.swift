import Foundation
import Security

/// Minimal keychain wrapper for the session token. Items live in the App Group access group so the share extension
/// can read them; unsigned simulator builds have no group entitlement, so we fall back to the app's own keychain.
enum Keychain {
    private static func baseQuery(account: String, group: Bool) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: SharedConfig.keychainService,
            kSecAttrAccount as String: account,
        ]
        if group { q[kSecAttrAccessGroup as String] = SharedConfig.appGroup }
        return q
    }

    @discardableResult
    static func save(_ value: String, account: String) -> Bool {
        let data = Data(value.utf8)
        for group in [true, false] {
            let q = baseQuery(account: account, group: group)
            SecItemDelete(q as CFDictionary)
            var add = q
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecSuccess { return true }
            if status != errSecMissingEntitlement { return false }
        }
        return false
    }

    static func read(account: String) -> String? {
        for group in [true, false] {
            var q = baseQuery(account: account, group: group)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: AnyObject?
            let status = SecItemCopyMatching(q as CFDictionary, &out)
            if status == errSecSuccess, let data = out as? Data { return String(data: data, encoding: .utf8) }
        }
        return nil
    }

    static func delete(account: String) {
        for group in [true, false] { SecItemDelete(baseQuery(account: account, group: group) as CFDictionary) }
    }
}

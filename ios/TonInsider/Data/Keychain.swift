import Foundation
import Security

/// Where the app's session token lives. The token is the site's cookies sealed by the Worker (src/lib/appSession.ts):
/// the passwords in it can only be read with the Worker's key, never on the phone.
protocol TokenStore: AnyObject, Sendable {
    var token: String? { get set }
    /// Stores `new` only while the store still holds `old` (the token the request went out with): a late answer
    /// must not undo a logout or a login that landed in between.
    func replace(old: String?, new: String)
}

/// The iPhone's Keychain (this device only, readable after the first unlock so background refreshes work).
final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service = "toninsider.session"
    private let lock = NSLock()

    func replace(old: String?, new: String) {
        lock.withLock {
            guard read() == old else { return }
            write(new)
        }
    }

    var token: String? {
        get { lock.withLock { read() } }
        set { lock.withLock { write(newValue) } }
    }

    private func read() -> String? {
                var result: AnyObject?
                let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
                guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
                return String(data: data, encoding: .utf8)
    }

    private func write(_ newValue: String?) {
                let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
                SecItemDelete(query as CFDictionary)
                guard let newValue else { return }
                var add = query
                add[kSecValueData as String] = Data(newValue.utf8)
                add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                SecItemAdd(add as CFDictionary, nil)
    }
}

/// For tests and previews.
final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    init(_ token: String? = nil) { value = token }
    func replace(old: String?, new: String) {
        lock.withLock { if value == old { value = new } }
    }
    var token: String? {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

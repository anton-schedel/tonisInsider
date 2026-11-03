import Foundation
import Security

/// Where the app's session token lives. The token is the site's cookies sealed by the Worker (src/lib/appSession.ts):
/// the passwords in it can only be read with the Worker's key, never on the phone.
protocol TokenStore: AnyObject, Sendable {
    var token: String? { get set }
}

/// The iPhone's Keychain (this device only, readable after the first unlock so background refreshes work).
final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service = "toninsider.session"
    private let lock = NSLock()

    var token: String? {
        get {
            lock.withLock {
                var result: AnyObject?
                let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
                guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
                return String(data: data, encoding: .utf8)
            }
        }
        set {
            lock.withLock {
                let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
                SecItemDelete(query as CFDictionary)
                guard let newValue else { return }
                var add = query
                add[kSecValueData as String] = Data(newValue.utf8)
                add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                SecItemAdd(add as CFDictionary, nil)
            }
        }
    }
}

/// For tests and previews.
final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    init(_ token: String? = nil) { value = token }
    var token: String? {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

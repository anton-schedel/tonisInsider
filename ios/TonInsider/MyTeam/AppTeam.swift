import Foundation

/// Mein Team as /api/app/my-team/ serves it (src/lib/myTeam.ts AppTeam). Filled out in Task 10.
struct AppTeam: Decodable, Sendable {
    var signedOut: String?
    var error: String?
    var account: AccountInfo?

    struct AccountInfo: Decodable, Sendable { var name: String?; var userId: String? }
}

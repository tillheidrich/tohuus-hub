import Foundation
enum NotifyKit {
    static func actionBody(_ action: String, data: [String: String]) -> [String: Any] {
        var d: [String: Any] = [:]
        for (k, v) in data { d[k] = Int(v).map { $0 as Any } ?? v }
        return ["action": action, "data": d]
    }
}
final class ASAuthorization { var credential: Any = 0 }
final class ASAuthorizationPlatformPublicKeyCredentialRegistration { var rawAttestationObject: Data? = nil; var credentialID = Data(); var rawClientDataJSON = Data() }
final class UIDevice { @MainActor static let current = UIDevice(); var model = "iPhone" }
extension Data { var base64URL: String { base64EncodedString() } }
final class RelativeDateTimeFormatter { enum Style { case short, full }; var unitsStyle: Style = .full; func localizedString(for d: Date, relativeTo: Date) -> String { "\(d)" } }
enum Keychain { @discardableResult static func save(_ v: String, account: String) -> Bool { true }; static func read(account: String) -> String? { nil }; static func delete(account: String) {} }
extension FileManager { func containerURL(forSecurityApplicationGroupIdentifier: String) -> URL? { nil } }

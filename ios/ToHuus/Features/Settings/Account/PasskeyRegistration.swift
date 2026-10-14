import AuthenticationServices
import Foundation
import UIKit

/// Creating a passkey in the app (Mein Konto › Passkeys). Apple lets an app create passkeys only for the websites in
/// its associated domains (`webcredentials:` in ios/project.yml). The server's relying party is the host of its
/// BASE_URL (server/lib/auth-policy.ts `rpId`), so this works for ToHuus Cloud only. A self-hosted server has its
/// own host – there the passkey is added in Safari and then works in the app's browser sign-in too.
enum PasskeyHosts {
    /// keep in sync with `com.apple.developer.associated-domains` in ios/project.yml
    static let associated: Set<String> = ["cloud.tohuus.heidrich-digital.de"]

    static func canCreate(for server: URL) -> Bool {
        guard let host = server.host()?.lowercased() else { return false }
        return associated.contains(host)
    }
}

/// A passkey registration as the server expects it (RegistrationResponseJSON, base64url).
struct PasskeyRegistrationResult: Sendable {
    var id: String
    var clientDataJSON: String
    var attestationObject: String

    init?(_ auth: ASAuthorization) {
        guard let c = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let att = c.rawAttestationObject else { return nil }
        id = c.credentialID.base64URL
        clientDataJSON = c.rawClientDataJSON.base64URL
        attestationObject = att.base64URL
    }

    var json: [String: Any] {
        [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "response": ["clientDataJSON": clientDataJSON, "attestationObject": attestationObject, "transports": ["internal", "hybrid"]],
            "clientExtensionResults": [String: Any](),
        ]
    }
}

extension AuthorizationRunner {
    /// Registration with the options from POST /api/auth/passkeys/options (PublicKeyCredentialCreationOptionsJSON).
    func registerPasskey(options: JSONValue) async throws -> PasskeyRegistrationResult {
        guard let challenge = options["challenge"]?.string.flatMap({ Data(base64URL: $0) }),
              let rp = options["rp"]?["id"]?.string,
              let userId = options["user"]?["id"]?.string.flatMap({ Data(base64URL: $0) }) else {
            throw APIError.server(status: 0, message: L("The passkey could not be started. Please try again."))
        }
        let name = options["user"]?["name"]?.string ?? options["user"]?["displayName"]?.string ?? "ToHuus"
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rp)
        let req = provider.createCredentialRegistrationRequest(challenge: challenge, name: name, userID: userId)
        req.userVerificationPreference = .required
        let auth = try await run([req])
        guard let r = PasskeyRegistrationResult(auth) else {
            throw APIError.server(status: 0, message: L("The passkey could not be started. Please try again."))
        }
        return r
    }
}

/// What asking for registration options can lead to (ToHuus Cloud confirms first).
enum PasskeyOptionsAnswer: Sendable {
    case options(JSONValue)
    /// the account has a password: ask for it
    case needPassword(String)
    /// no password: a mail with a 6-digit code went out
    case needCode(String)
    case failed(String)
}

extension APIClient {
    /// POST /api/auth/passkeys/options with `password` or `code` (cloud) – status-aware, so the app can ask for what is missing.
    func passkeyRegistrationOptions(password: String? = nil, code: String? = nil) async -> PasskeyOptionsAnswer {
        var body: [String: Any] = [:]
        if let password { body["password"] = password }
        if let code { body["code"] = code.filter(\.isNumber) }
        do {
            let (status, json) = try await sendRaw("POST", "api/auth/passkeys/options", json: body, timeout: 30)
            let message = json["error"]?.string ?? ""
            if (200..<300).contains(status) { return .options(json) }
            if json["needEmailConfirm"]?.bool == true { return .needCode(message) }
            if json["needPassword"]?.bool == true { return .needPassword(message) }
            return .failed(APIError.friendly(status: status, message: message))
        } catch {
            return .failed(APIError.from(error).localizedDescription)
        }
    }

    /// POST /api/auth/passkeys { response, name }
    func savePasskey(_ r: PasskeyRegistrationResult, name: String) async throws {
        _ = try await send("POST", "api/auth/passkeys", json: ["response": r.json, "name": String(name.prefix(60))], as: Ignored.self)
    }

    /// "iPhone", "iPad" – the passkey's name in the list
    @MainActor static var passkeyDeviceName: String { UIDevice.current.model }
}

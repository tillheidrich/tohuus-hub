import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Nonces for Sign in with Apple: the raw value goes to our server, its SHA-256 (hex) into the Apple request.
enum AppleNonce {
    static func make() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URL
    }

    static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }
}

/// What came back from Apple, reduced to plain values.
struct AppleCredential: Sendable {
    var identityToken: String
    var authorizationCode: String?
    var givenName: String?

    init?(_ auth: ASAuthorization) {
        guard let c = auth.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = c.identityToken, let token = String(data: tokenData, encoding: .utf8) else { return nil }
        identityToken = token
        authorizationCode = c.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        givenName = c.fullName?.givenName
    }
}

/// A passkey assertion as the server expects it (WebAuthn JSON, base64url).
struct PasskeyAssertion: Sendable {
    var id: String
    var clientDataJSON: String
    var authenticatorData: String
    var signature: String
    var userHandle: String?

    init?(_ auth: ASAuthorization) {
        guard let c = auth.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else { return nil }
        id = c.credentialID.base64URL
        clientDataJSON = c.rawClientDataJSON.base64URL
        authenticatorData = c.rawAuthenticatorData.base64URL
        signature = c.signature.base64URL
        userHandle = c.userID.isEmpty ? nil : c.userID.base64URL
    }

    var json: [String: Any] {
        var r: [String: Any] = ["clientDataJSON": clientDataJSON, "authenticatorData": authenticatorData, "signature": signature]
        if let userHandle { r["userHandle"] = userHandle }
        return ["id": id, "rawId": id, "type": "public-key", "response": r, "clientExtensionResults": [String: Any]()]
    }
}

/// Runs an ASAuthorizationController request (Apple re-authentication, passkey sign-in) as async/await.
@MainActor
final class AuthorizationRunner: NSObject, @preconcurrency ASAuthorizationControllerDelegate, @preconcurrency ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<ASAuthorization, Error>?
    private var controller: ASAuthorizationController?

    func run(_ requests: [ASAuthorizationRequest]) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { c in
            continuation = c
            let ctl = ASAuthorizationController(authorizationRequests: requests)
            ctl.delegate = self
            ctl.presentationContextProvider = self
            controller = ctl
            ctl.performRequests()
        }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        continuation?.resume(returning: authorization)
        continuation = nil
        self.controller = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
        self.controller = nil
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first ?? ASPresentationAnchor()
    }

    /// The person closed the sheet – no error text for that.
    static func cancelled(_ error: Error) -> Bool {
        (error as? ASAuthorizationError)?.code == .canceled
    }

    /// A fresh Sign in with Apple (to confirm deleting the account). Returns the credential and the raw nonce.
    func appleReauth() async throws -> (AppleCredential, String) {
        let nonce = AppleNonce.make()
        let req = ASAuthorizationAppleIDProvider().createRequest()
        req.requestedScopes = []
        req.nonce = AppleNonce.sha256(nonce)
        let auth = try await run([req])
        guard let cred = AppleCredential(auth) else { throw APIError.server(status: 0, message: L("Sign in with Apple didn’t work. Please try again.")) }
        return (cred, nonce)
    }

    /// Passkey sign-in (usernameless) for the cloud host.
    func passkey(rpId: String, challenge: String) async throws -> PasskeyAssertion {
        guard let data = Data(base64URL: challenge) else { throw APIError.server(status: 0, message: L("That took too long. Please try again.")) }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
        let req = provider.createCredentialAssertionRequest(challenge: data)
        req.userVerificationPreference = .required
        let auth = try await run([req])
        guard let a = PasskeyAssertion(auth) else { throw APIError.server(status: 0, message: L("This passkey isn’t known here. It may have been removed.")) }
        return a
    }
}

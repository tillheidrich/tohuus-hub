import Foundation

/// Account, sign-in and sample data (package D, 1.0). docs/cloud.md › Sign in with Apple, Sign-in link and code,
/// Passkeys; docs/ios-0.2.md › 0.3 parity – account.
extension APIClient {
    private static var langRegion: (String, String) {
        let lang = Locale.current.language.languageCode?.identifier == "de" ? "de" : "en"
        return (lang, Locale.current.region?.identifier ?? "DE")
    }

    /// POST /api/auth/apple – the identity token from AuthenticationServices; `nonce` = the raw nonce whose SHA-256
    /// went into the Apple request. A new Apple ID gets an account and a household (`created: true`).
    func signInWithApple(identityToken: String, authorizationCode: String?, nonce: String, name: String?, device: String,
                         betaCode: String? = nil, stores: [String]? = nil) async throws -> AppAuthResponse {
        let (lang, region) = Self.langRegion
        var body: [String: Any] = ["identityToken": identityToken, "nonce": nonce, "device": device, "client": "ios", "lang": lang, "region": region]
        // beta gate and "Wo kauft ihr meistens ein?" – only used when Apple creates a new account
        if let betaCode, !betaCode.isEmpty { body["betaCode"] = betaCode }
        if let stores, !stores.isEmpty { body["stores"] = stores }
        if let authorizationCode { body["authorizationCode"] = authorizationCode }
        if let name, !name.isEmpty { body["name"] = name }
        return try await send("POST", "api/auth/apple", json: body)
    }

    /// GET /api/cloud/store-choices – shops for "Wo kauft ihr meistens ein?", alphabetical (no chain preferred).
    func storeChoices() async throws -> StoreChoices {
        try await get("api/cloud/store-choices", query: [URLQueryItem(name: "region", value: Self.langRegion.1)])
    }

    /// POST /api/auth/link – the mail with a link and a 6-digit code (always answers ok).
    func requestSignInMail(email: String) async throws {
        _ = try await send("POST", "api/auth/link", json: ["email": email], as: Ignored.self)
    }

    /// POST /api/auth/link/code with `device` → an app token.
    func signInWithCode(email: String, code: String, device: String) async throws -> AppAuthResponse {
        try await send("POST", "api/auth/link/code", json: ["email": email, "code": code, "device": device])
    }

    func passkeyOptions() async throws -> PasskeyOptions {
        try await send("POST", "api/auth/passkey/options", json: ["client": "ios"])
    }

    func passkeyVerify(key: String, device: String, response: [String: Any]) async throws -> AppAuthResponse {
        try await send("POST", "api/auth/passkey/verify", json: ["key": key, "device": device, "response": response])
    }

    /// DELETE /api/cloud/account with whatever confirms it: `password`, `appleIdentityToken` + `appleNonce`, or the
    /// mail `code`. Status and body come back as they are (400 `needEmailConfirm` sends the mail with the code).
    func deleteAccountRaw(_ body: [String: String]) async throws -> (status: Int, body: JSONValue) {
        try await sendRaw("DELETE", "api/cloud/account", json: body)
    }

    // MARK: sample data

    func tourInfo() async throws -> TourInfo { try await get("api/tour") }
    /// "Möchtest du Beispieldaten …?" – `demo` loads the marked sample household, `empty` starts empty.
    func answerSampleQuestion(demo: Bool) async throws {
        _ = try await send("POST", "api/tour/start", json: ["choice": demo ? "demo" : "empty"], as: Ignored.self, timeout: 90)
    }
    func demoMarks() async throws -> DemoMarks { try await get("api/tour/demo/marks") }
    func removeSampleData() async throws -> DemoRemoveResult {
        try await send("POST", "api/tour/demo/remove", json: ["include_used": false], timeout: 60)
    }
    func loadSampleData() async throws {
        _ = try await send("POST", "api/tour/demo", json: [:], as: Ignored.self, timeout: 90)
    }
    func keepSampleData() async throws { _ = try await send("POST", "api/tour/demo/nudge", json: [:], as: Ignored.self) }
}

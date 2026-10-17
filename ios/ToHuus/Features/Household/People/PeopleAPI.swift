import Foundation

/// People admin, children, permanent guests, sign-in policy and kid mode – the same endpoints the web app uses.
extension APIClient {
    /// /api/people/me/… for yourself, /api/people/person/:key/… for anyone else
    func personBase(_ key: String, isMe: Bool) -> String { isMe ? "api/people/me" : "api/people/person/\(key)" }

    /// A write that may answer 409 { code: 'health_consent' } (allergies are health data). Returns the body on success.
    func peopleWrite(_ method: String, _ path: String, _ body: [String: Any]) async throws -> (ConsentResult, JSONValue) {
        let r = try await sendRaw(method, path, json: body, timeout: 30)
        if (200..<300).contains(r.status) { return (.saved, r.body) }
        if r.status == 409, r.body["code"]?.string == "health_consent" { return (.needsConsent, r.body) }
        if r.status == 404 { throw APIError.notFound }
        throw APIError.server(status: r.status, message: r.body["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: r.status))
    }

    // MARK: picture and colour

    /// PUT …/color { color }
    func setPersonColor(_ key: String, isMe: Bool, color: String) async throws {
        _ = try await send("PUT", personBase(key, isMe: isMe) + "/color", json: ["color": color], as: Ignored.self)
    }

    /// POST …/photo (multipart `image`, a square JPEG)
    func uploadPersonPhoto(_ key: String, isMe: Bool, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "face.jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload(personBase(key, isMe: isMe) + "/photo", multipart: mp, as: Ignored.self)
    }

    /// DELETE …/photo – back to initials (members) or an animal (children)
    func deletePersonPhoto(_ key: String, isMe: Bool) async throws {
        _ = try await send("DELETE", personBase(key, isMe: isMe) + "/photo", as: Ignored.self)
    }

    /// GET /api/people/person/:key – likes, dislikes, most cooked
    func personProfile(_ key: String) async throws -> PersonProfile { try await get("api/people/person/\(key)") }

    // MARK: children (admins)

    /// POST /api/people/children { name, birth_year, color, allergies, consent? } → the new person (key)
    func addChild(name: String, birthYear: Int?, color: String, allergies: [String], consent: Bool) async throws -> (ConsentResult, String?) {
        var body: [String: Any] = ["name": name, "birth_year": birthYear ?? NSNull(), "color": color, "allergies": allergies]
        if consent { body["consent"] = true }
        let (r, out) = try await peopleWrite("POST", "api/people/children", body)
        return (r, out["key"]?.string)
    }

    /// PATCH /api/people/children/:id { name? , birth_year? }
    func updateChild(_ id: Int, _ body: [String: Any]) async throws {
        _ = try await send("PATCH", "api/people/children/\(id)", json: body, as: Ignored.self)
    }

    func removeChild(_ id: Int) async throws { _ = try await send("DELETE", "api/people/children/\(id)", as: Ignored.self) }

    // MARK: permanent guests and members (admins)

    /// POST /api/people/guests { name, email, level, color } → the new person (key)
    func addPermanentGuest(name: String, email: String?, level: String) async throws -> String? {
        let body: [String: Any] = ["name": name, "email": email ?? NSNull(), "level": level, "color": PersonColors.all[5]]
        let r = try await send("POST", "api/people/guests", json: body, as: JSONValue.self)
        return r["key"]?.string
    }

    /// PATCH /api/people/guests/:id { level } – the normal level
    func setGuestLevel(_ id: Int, level: String) async throws {
        _ = try await send("PATCH", "api/people/guests/\(id)", json: ["level": level], as: Ignored.self)
    }

    /// PATCH /api/people/guests/:id { override: { level, until } | null } – for a while, ends by itself
    func setGuestOverride(_ id: Int, level: String?, until: Date?) async throws {
        let o: Any
        if let level, let until {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            o = ["level": level, "until": iso.string(from: until)] as [String: Any]
        } else {
            o = NSNull()
        }
        _ = try await send("PATCH", "api/people/guests/\(id)", json: ["override": o], as: Ignored.self)
    }

    /// PUT /api/people/users/:id/kind { kind: member|guest, level }
    func setPersonKind(_ id: Int, kind: String) async throws {
        _ = try await send("PUT", "api/people/users/\(id)/kind", json: ["kind": kind, "level": "family"], as: Ignored.self)
    }

    /// POST /api/people/users/:id/login-link { deliver: email|link, email? }
    func personLoginLink(_ id: Int, deliver: String, email: String?) async throws -> LoginLinkResult {
        var body: [String: Any] = ["deliver": deliver]
        if deliver == "email", let email { body["email"] = email }
        return try await send("POST", "api/people/users/\(id)/login-link", json: body)
    }

    /// DELETE /api/users/:id – remove a member or permanent guest
    func removeMember(_ id: Int) async throws { _ = try await send("DELETE", "api/users/\(id)", as: Ignored.self) }

    /// POST /api/users { name, password, role, color } – self-hosted only ("Add with a password instead")
    func addMemberWithPassword(name: String, password: String, role: String, color: String) async throws {
        _ = try await send("POST", "api/users", json: ["name": name, "password": password, "role": role, "color": color], as: Ignored.self)
    }

    /// GET /api/auth/me → mail (can this server send e-mail?)
    func mailAvailable() async -> Bool {
        guard let r = try? await get("api/auth/me", as: JSONValue.self) else { return false }
        return r["mail"]?.bool ?? false
    }

    /// GET/PATCH /api/data/settings { showNames } – names on the sign-in screen (self-hosted)
    func showNamesOnLogin() async throws -> Bool {
        try await get("api/data/settings", as: JSONValue.self)["showNames"]?.bool ?? false
    }

    func setShowNamesOnLogin(_ on: Bool) async throws {
        _ = try await send("PATCH", "api/data/settings", json: ["showNames": on], as: Ignored.self)
    }

    // MARK: sign-in policy (admins, self-hosted)

    func authPolicy() async throws -> AuthPolicyInfo { try await get("api/auth/policy") }

    /// PATCH /api/auth/policy { magicLink?, passkeys?, passwordFor?, requireTotpAdmins?, newDeviceAlerts?, pinSwitch? }
    func setAuthPolicy(_ body: [String: Any]) async throws {
        _ = try await send("PATCH", "api/auth/policy", json: body, as: Ignored.self)
    }

    /// PUT /api/auth/sso { enabled, issuer, clientId, clientSecret, scopes, label, autoCreate, defaultRole, trustEmail }
    func saveSSO(_ body: [String: Any]) async throws { _ = try await send("PUT", "api/auth/sso", json: body, as: Ignored.self) }

    /// POST /api/auth/sso/test { issuer } → { issuer, pkce }
    func testSSO(issuer: String) async throws -> JSONValue { try await send("POST", "api/auth/sso/test", json: ["issuer": issuer], as: JSONValue.self) }

    func authMembers() async throws -> [MemberAuth] { try await get("api/auth/members", as: Lossy<MemberAuth>.self).wrappedValue }

    /// POST /api/auth/members/:id/reset-link { deliver } → { url } for "link"
    func memberResetLink(_ id: Int, deliver: String) async throws -> String? {
        try await send("POST", "api/auth/members/\(id)/reset-link", json: ["deliver": deliver], as: JSONValue.self)["url"]?.string
    }

    func memberSignOutEverywhere(_ id: Int) async throws { _ = try await send("POST", "api/auth/members/\(id)/signout", as: Ignored.self) }

    /// DELETE /api/auth/members/:id/(totp|pin|sso)
    func memberRemoveFactor(_ id: Int, _ factor: String) async throws {
        _ = try await send("DELETE", "api/auth/members/\(id)/\(factor)", as: Ignored.self)
    }

    // MARK: kid profiles (parents)

    func kids() async throws -> [KidProfile] { try await get("api/kids", as: KidsResponse.self).kids }

    /// POST /api/kids or PATCH /api/kids/:id { name, color, avatar, age_band, speak, pin?, rules?, find_ids? }
    func saveKid(_ id: Int?, _ body: [String: Any]) async throws {
        if let id {
            _ = try await send("PATCH", "api/kids/\(id)", json: body, as: Ignored.self)
        } else {
            _ = try await send("POST", "api/kids", json: body, as: Ignored.self)
        }
    }

    func deleteKid(_ id: Int) async throws { _ = try await send("DELETE", "api/kids/\(id)", as: Ignored.self) }

    /// PUT /api/kids/:id/ai { enabled } – AI for this child (parents)
    func setKidAI(_ id: Int, enabled: Bool) async throws {
        _ = try await send("PUT", "api/kids/\(id)/ai", json: ["enabled": enabled], as: Ignored.self)
    }

    /// POST /api/kids/:id/devices { label, days } → { token, url }
    func pairKidDevice(_ id: Int, label: String?, days: Int?) async throws -> KidPairing {
        try await send("POST", "api/kids/\(id)/devices", json: ["label": label ?? NSNull(), "days": days ?? NSNull()])
    }

    func removeKidDevice(_ id: Int) async throws { _ = try await send("DELETE", "api/kids/devices/\(id)", as: Ignored.self) }

    func kidWishes() async throws -> [KidWish] { try await get("api/kids/wishes", as: Lossy<KidWish>.self).wrappedValue }

    /// POST /api/kids/wishes/:id { answer: approve|decline }
    func answerKidWish(_ id: Int, approve: Bool) async throws {
        _ = try await send("POST", "api/kids/wishes/\(id)", json: ["answer": approve ? "approve" : "decline"], as: Ignored.self)
    }

    func kidPlaces() async throws -> [KidPlace] { try await get("api/kids/places", as: Lossy<KidPlace>.self).wrappedValue }

    func uploadKidPlacePhoto(_ id: Int, jpeg: Data) async throws {
        var mp = Multipart()
        mp.addFile("image", filename: "place.jpg", mimeType: "image/jpeg", data: jpeg)
        _ = try await upload("api/kids/places/\(id)/photo", multipart: mp, as: Ignored.self)
    }

    func deleteKidPlacePhoto(_ id: Int) async throws { _ = try await send("DELETE", "api/kids/places/\(id)/photo", as: Ignored.self) }

    // MARK: the kid tablet (token in the path, no sign-in)

    func kidHome(token: String) async throws -> KidHome { try await get("api/kid/\(token)") }

    /// POST /api/kid/:token/wish { product_id } → nil when sent, otherwise the tile state the server answered
    /// (later | enough | busy | quiet | empty) and an optional time.
    func kidWish(token: String, productId: Int) async throws -> (state: String, until: String?)? {
        let r = try await sendRaw("POST", "api/kid/\(token)/wish", json: ["product_id": productId], timeout: 20)
        if (200..<300).contains(r.status) { return nil }
        if r.status == 404 { throw APIError.notFound }
        return (r.body["state"]?.string ?? r.body["error"]?.string ?? "error", r.body["until"]?.string)
    }

    /// POST /api/kid/:token/exit { pin } → nil when the PIN is right, otherwise the server's message
    func kidExit(token: String, pin: String) async throws -> String? {
        let r = try await sendRaw("POST", "api/kid/\(token)/exit", json: ["pin": pin], timeout: 20)
        if (200..<300).contains(r.status) { return nil }
        return r.body["error"]?.string ?? L("Wrong PIN")
    }
}

import Foundation

/// Household natively: people, invitations, "Was ToHuus sich merkt" (docs/ios-0.2.md "0.3 parity – Haushalt").
extension APIClient {
    // MARK: people (server/routes/people.ts)

    /// GET /api/people → { people } – children, members, permanent guests; prefs only where the viewer may see them
    func people() async throws -> [Person] { try await get("api/people", as: PeopleResponse.self).people }

    /// GET /api/people/directory – everyone's name, colour and picture (avatars)
    func peopleDirectory() async throws -> [PersonDirEntry] {
        try await get("api/people/directory", as: Lossy<PersonDirEntry>.self).wrappedValue
    }

    /// PUT /api/people/me/prefs or /api/people/person/:key/prefs { likes?, dislikes?, allergies?, consent? }
    /// The first allergy of the household needs a confirmation (409 code health_consent) → `.needsConsent`.
    func setPrefs(personKey: String, isMe: Bool, likes: [String]? = nil, dislikes: [String]? = nil, allergies: [String]? = nil,
                  consent: Bool = false) async throws -> ConsentResult {
        var body: [String: Any] = [:]
        if let likes { body["likes"] = likes }
        if let dislikes { body["dislikes"] = dislikes }
        if let allergies { body["allergies"] = allergies }
        if consent { body["consent"] = true }
        let path = isMe ? "api/people/me/prefs" : "api/people/person/\(personKey)/prefs"
        return try await consentAware("PUT", path, body)
    }

    /// PUT …/face { type: 'initials' } | { type: 'animal', animal }
    func setFace(personKey: String, isMe: Bool, animal: String?) async throws {
        let path = isMe ? "api/people/me/face" : "api/people/person/\(personKey)/face"
        let body: [String: Any] = animal.map { ["type": "animal", "animal": $0] } ?? ["type": "initials"]
        _ = try await send("PUT", path, json: body, as: Ignored.self)
    }

    // MARK: invitations (admins; server/routes/invites.ts)

    func invites() async throws -> [InviteItem] { try await get("api/invites", as: Lossy<InviteItem>.self).wrappedValue }
    func inviteOptions() async throws -> InviteOptions { try await get("api/invites/options") }

    /// POST /api/invites { name?, email?, role, kind, guest_level?, message?, send } → { url, expires_at, sent, email }
    func createInvite(name: String?, email: String?, role: String, kind: String, guestLevel: String?, message: String?, send mail: Bool) async throws -> InviteLink {
        var body: [String: Any] = ["role": role, "kind": kind, "send": mail]
        body["name"] = name ?? NSNull()
        body["email"] = email ?? NSNull()
        body["guest_level"] = guestLevel ?? NSNull()
        body["message"] = message ?? NSNull()
        return try await send("POST", "api/invites", json: body)
    }

    /// POST /api/invites/:id/resend { deliver: 'email'|'link' } → a fresh link (the old one stops working)
    func renewInvite(_ id: Int, deliver: String) async throws -> InviteLink {
        try await send("POST", "api/invites/\(id)/resend", json: ["deliver": deliver])
    }

    /// DELETE /api/invites/:id – withdraw
    func revokeInvite(_ id: Int) async throws { _ = try await send("DELETE", "api/invites/\(id)", as: Ignored.self) }

    // MARK: what ToHuus remembers (server/routes/assistant.ts)

    func memory() async throws -> [MemoryRow] { try await get("api/memory", as: Lossy<MemoryRow>.self).wrappedValue }

    /// POST /api/memory { text, kind?, person?, onlyMe?, consent? } – a health note needs the household's confirmation once
    func remember(_ text: String, kind: String? = nil, person: String? = nil, onlyMe: Bool, consent: Bool = false) async throws -> ConsentResult {
        var body: [String: Any] = ["text": text]
        if let kind { body["kind"] = kind }
        if let person { body["person"] = person }
        if onlyMe { body["onlyMe"] = true }
        if consent { body["consent"] = true }
        return try await consentAware("POST", "api/memory", body)
    }

    func forget(_ id: Int) async throws { _ = try await send("DELETE", "api/memory/\(id)", as: Ignored.self) }

    /// a write that may answer 409 { code: 'health_consent' }
    private func consentAware(_ method: String, _ path: String, _ body: [String: Any]) async throws -> ConsentResult {
        let r = try await sendRaw(method, path, json: body, timeout: 30)
        if (200..<300).contains(r.status) { return .saved }
        if r.status == 409, r.body["code"]?.string == "health_consent" { return .needsConsent }
        if r.status == 404 { throw APIError.notFound }
        throw APIError.server(status: r.status, message: r.body["error"]?.string ?? HTTPURLResponse.localizedString(forStatusCode: r.status))
    }
}

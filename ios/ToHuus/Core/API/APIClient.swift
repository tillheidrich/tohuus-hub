import Foundation

/// Thin async/await HTTP client for one server, one token and one household. Immutable: a new client is made when the
/// session changes (sign-in, household switch).
final class APIClient: Sendable {
    let baseURL: URL
    let token: String?
    let householdId: String?
    /// called on any 401 so the app can sign out
    let onUnauthorized: @Sendable () -> Void
    private let session: URLSession

    init(baseURL: URL, token: String? = nil, householdId: String? = nil, session: URLSession = .shared,
         onUnauthorized: @escaping @Sendable () -> Void = {}) {
        self.baseURL = baseURL
        self.token = token
        self.householdId = householdId
        self.session = session
        self.onUnauthorized = onUnauthorized
        // the error log reports to the server of the current session (ErrorLog.swift)
        let (b, t, h) = (baseURL, token, householdId)
        Task { await ErrorLog.shared.use(base: b, token: t, household: h) }
    }

    func url(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        // "api/search?q=…": appendingPathComponent would turn the "?" into "%3F" – the query goes on separately
        let parts = (path.hasPrefix("/") ? String(path.dropFirst()) : path).split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let clean = String(parts[0])
        guard var comps = URLComponents(url: baseURL.appendingPathComponent(clean), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if parts.count > 1, !parts[1].isEmpty { comps.percentEncodedQuery = String(parts[1]) }
        if !query.isEmpty {
            comps.queryItems = (comps.queryItems ?? []) + query
            // URLComponents leaves "+" as is, and servers read it as a space ("1+1" → "1 1")
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let u = comps.url else { throw APIError.invalidURL }
        return u
    }

    /// Reads that have a stored answer to fall back on (ResponseCache, the shopping list) give up after 10 s without an
    /// answer – nobody should look at a spinner for half a minute because the server is gone. Everything else (exports,
    /// label sheets, writes) keeps 30 s unless the caller says otherwise.
    static let readTimeout: TimeInterval = 10

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], timeout: TimeInterval? = nil) throws -> URLRequest {
        var req = URLRequest(url: try url(path, query: query))
        req.httpMethod = method
        let quick = method == "GET" && (path.hasPrefix("api/shop/list") || ResponseCache(household: "", path: path, query: []) != nil)
        req.timeoutInterval = timeout ?? (quick ? Self.readTimeout : 30)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let householdId { req.setValue(householdId, forHTTPHeaderField: "X-Household") }
        req.setValue(Locale.preferredLanguages.first ?? "de", forHTTPHeaderField: "Accept-Language")
        // the server's error log shows which build caused an error (server/index.ts)
        req.setValue(ErrorLog.appVersion, forHTTPHeaderField: "X-ToHuus-Version")
        // ToHuus Cloud usage statistics count actions by platform only (docs/cloud.md › Usage statistics)
        #if os(watchOS)
        req.setValue("watch", forHTTPHeaderField: "X-ToHuus-Client")
        #else
        req.setValue("ios", forHTTPHeaderField: "X-ToHuus-Client")
        // "Foto mit dem iPhone" on a receipt (server/lib/import-origin.ts): only the kind of device, never its name
        if let d = ClientDevice.kind { req.setValue(d, forHTTPHeaderField: "X-ToHuus-Device") }
        #endif
        return req
    }

    /// Performs a request and maps HTTP errors. Returns the raw body.
    func perform(_ req: URLRequest, body: Data? = nil) async throws -> Data {
        let data: Data
        let resp: URLResponse
        do {
            if let body {
                (data, resp) = try await session.upload(for: req, from: body)
            } else {
                (data, resp) = try await session.data(for: req)
            }
        } catch {
            throw APIError.from(error)
        }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        #if os(iOS)
        // good moments for Apple's review dialog, and errors that rule it out for this launch (PlanMoments.swift)
        ReviewPrompt.observe(method: req.httpMethod ?? "GET", path: req.url?.path ?? "", status: status)
        #endif
        if (200..<300).contains(status) { return data }
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if Self.serverUnreachable(status: status, json: obj, body: data) { throw APIError.offline }
        let message = (obj?["error"] as? String) ?? (obj?["message"] as? String) ?? HTTPURLResponse.localizedString(forStatusCode: status)
        if status >= 500 {
            // the server logged it too (with the code in the message) – the app's log says where it happened
            let route = "\(req.httpMethod ?? "GET") \(req.url?.path ?? "")"
            Task { await ErrorLog.shared.record(kind: "http", message: message, route: route, status: status) }
        }
        let code = (obj?["code"] as? String) ?? (obj?["key"] as? String) ?? ""
        #if os(iOS)
        // no plan any more (read-only after the trial): one calm card on the main screen (PlanMoments.swift)
        if status == 402, code == "plan.readonly" {
            let text = message
            DispatchQueue.main.async { NotificationCenter.default.post(name: .toHuusPlanNotice, object: text) }
        }
        #endif
        // 402 quota.assistant, 429 quota.receiptAi (docs/assistant.md "Limits")
        let isQuota = status == 402 || (obj?["quota"] as? Bool) == true || code.hasPrefix("quota")
        if status == 413 || code == "storage.full" { throw APIError.storageFull(message) }
        switch status {
        case 401 where token != nil:
            onUnauthorized()
            throw APIError.unauthorized
        case 401:
            throw APIError.server(status: 401, message: message)
        case 404 where obj?["error"] == nil || message == "not found" || message == "Not found" || code == "not_found":
            throw APIError.notFound
        case 402 where code == "plan.assistant":
            throw APIError.planAssistant(message)
        case _ where isQuota:
            throw APIError.quota(message)
        default:
            throw APIError.server(status: status, message: message)
        }
    }

    /// For answers that carry meaning in a 4xx body (409 `cookidoo_confirm` with a draft): status and body, no throwing
    /// on HTTP errors (401 still signs out).
    func sendRaw(_ method: String, _ path: String, json: [String: Any], timeout: TimeInterval = 60) async throws -> (status: Int, body: JSONValue) {
        var req = try request(method, path, timeout: timeout)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let data: Data
        let resp: URLResponse
        do {
            (data, resp) = try await session.upload(for: req, from: try JSONSerialization.data(withJSONObject: json))
        } catch {
            throw APIError.from(error)
        }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401, token != nil { onUnauthorized(); throw APIError.unauthorized }
        let body = (try? JSONCoding.decoder().decode(JSONValue.self, from: data)) ?? .null
        return (status, body)
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        if T.self == Ignored.self, let v = Ignored() as? T { return v }
        do {
            return try JSONCoding.decoder().decode(T.self, from: data)
        } catch {
            // an answer this app version cannot read – exactly what the developer needs to know
            let msg = "\(T.self): \(String(describing: error).prefix(400))"
            Task { await ErrorLog.shared.record(kind: "decoding", message: msg) }
            throw APIError.decoding(String(describing: error))
        }
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        let data = try await getData(path, query: query)
        return try decode(T.self, from: data)
    }

    /// GET. For the screens ResponseCache keeps (Heute, Aufgaben, Vorrat, Kochen, Hausinfo) a fresh answer is stored,
    /// and when the server can't be reached (no network, timeout, DNS, 5xx, proxy without the app) the last stored
    /// answer comes back instead of an error; OfflineReads then tells the screen to say "Offline · as of …".
    func getData(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        let req = try request("GET", path, query: query)
        let household = ResponseCache.owner(household: householdId ?? baseURL.host() ?? "default", token: token)
        guard token != nil, let slot = ResponseCache(household: household, path: path, query: query) else {
            return try await perform(req)
        }
        do {
            let data = try await perform(req)
            slot.save(data)
            let p = slot.path
            Task { @MainActor in OfflineReads.shared.mark(p, savedAt: nil) }
            return data
        } catch let e as APIError where ResponseCache.shouldFallBack(e) {
            guard let hit = slot.load() else { throw e }
            let p = slot.path
            Task { @MainActor in OfflineReads.shared.mark(p, savedAt: hit.savedAt) }
            return hit.data
        }
    }

    /// The server itself isn't answering: a proxy error page (502/503/504 without the app's JSON) or the reverse
    /// proxy's "404 page not found" when the app container is gone (Traefik/Coolify during an outage or redeploy).
    /// The app's own 404 is always JSON (server/index.ts), so "not on this server yet" still works.
    static func serverUnreachable(status: Int, json: [String: Any]?, body: Data) -> Bool {
        if [502, 503, 504].contains(status) { return json == nil }
        if status == 404, json == nil {
            let text = String(decoding: body.prefix(200), as: UTF8.self).lowercased()
            return text.contains("404 page not found") || text.contains("no available server")
        }
        return false
    }

    func send<T: Decodable>(_ method: String, _ path: String, json: [String: Any]? = nil, as type: T.Type = T.self,
                            timeout: TimeInterval = 30) async throws -> T {
        var req = try request(method, path, timeout: timeout)
        var body: Data? = nil
        if let json {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            body = try JSONSerialization.data(withJSONObject: json)
        }
        let data = try await perform(req, body: body)
        return try decode(T.self, from: data)
    }

    func send<T: Decodable, B: Encodable>(_ method: String, _ path: String, body: B, as type: T.Type = T.self,
                                          timeout: TimeInterval = 30) async throws -> T {
        var req = try request(method, path, timeout: timeout)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let data = try await perform(req, body: try JSONCoding.encoder().encode(body))
        return try decode(T.self, from: data)
    }

    func upload<T: Decodable>(_ path: String, multipart: Multipart, as type: T.Type = T.self, timeout: TimeInterval = 120) async throws -> T {
        var req = try request("POST", path, timeout: timeout)
        req.setValue(multipart.contentType, forHTTPHeaderField: "Content-Type")
        let data = try await perform(req, body: multipart.finished())
        return try decode(T.self, from: data)
    }

    /// Image paths from the server: absolute URLs, "/img/…?h=…&e=…&s=…" (signed for bearer clients – the query must
    /// survive) or a bare file name under /img/.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        var base = baseURL.absoluteString
        while base.hasSuffix("/") { base.removeLast() }
        return URL(string: base + (path.hasPrefix("/") ? path : "/img/" + path))
    }
}

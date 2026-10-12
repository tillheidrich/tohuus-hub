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
    }

    func url(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard var comps = URLComponents(url: baseURL.appendingPathComponent(clean), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        if !query.isEmpty { comps.queryItems = query }
        guard let u = comps.url else { throw APIError.invalidURL }
        return u
    }

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], timeout: TimeInterval = 30) throws -> URLRequest {
        var req = URLRequest(url: try url(path, query: query))
        req.httpMethod = method
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let householdId { req.setValue(householdId, forHTTPHeaderField: "X-Household") }
        req.setValue(Locale.preferredLanguages.first ?? "de", forHTTPHeaderField: "Accept-Language")
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
        if (200..<300).contains(status) { return data }
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = (obj?["error"] as? String) ?? (obj?["message"] as? String) ?? HTTPURLResponse.localizedString(forStatusCode: status)
        let isQuota = status == 402 || (obj?["quota"] as? Bool) == true || (obj?["code"] as? String)?.contains("quota") == true
        switch status {
        case 401 where token != nil:
            onUnauthorized()
            throw APIError.unauthorized
        case 401:
            throw APIError.server(status: 401, message: message)
        case 404 where obj?["error"] == nil || message == "not found" || message == "Not found":
            throw APIError.notFound
        case _ where isQuota:
            throw APIError.quota(message)
        default:
            throw APIError.server(status: status, message: message)
        }
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        if T.self == Ignored.self, let v = Ignored() as? T { return v }
        do {
            return try JSONCoding.decoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        let data = try await perform(try request("GET", path, query: query))
        return try decode(T.self, from: data)
    }

    func getData(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        try await perform(try request("GET", path, query: query))
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

    /// Image paths from the server: absolute URLs, "/img/…" or a bare file name under /img/.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        if path.hasPrefix("/") { return try? url(path) }
        return try? url("img/" + path)
    }
}

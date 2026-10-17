import AuthenticationServices
import CryptoKit
import Foundation
import Observation
import SwiftUI
import UIKit

// Own server (self-hosted ToHuus) in the App Store app – decision 14 Oct 2026, docs/ios-native-start.md.
// Ways in: address + name/e-mail + password (+ two-step code), "Im Browser anmelden" (passkey, e-mail link, SSO –
// whatever the server offers, through ASWebAuthenticationSession and a PKCE-bound one-time code), and a QR code /
// tohuus://connect link from the web app (Settings › My account › "iPhone-App verbinden"). Server: routes/app-pair.ts.

// MARK: - checking an address

/// What checking a typed address found – with a sentence that helps instead of a bare error.
enum ServerCheck {
    enum Failure: Error, Equatable, Sendable {
        case badAddress, needsHTTPS, noSuchHost, unreachable, certificate, offline, notToHuus, tooOld
        case other(String)

        var message: String {
            switch self {
            case .badAddress: return L("That doesn’t look like an address. Example: tohuus.example.de")
            case .needsHTTPS: return L("The app connects over https only. Put your server behind https (for example Caddy or a reverse proxy with Let’s Encrypt). Plain http works in your home network only.")
            case .noSuchHost: return L("This address can’t be found. Check it for a typo.")
            case .unreachable: return L("The server doesn’t answer. Is it running and reachable from this iPhone (home network, VPN)?")
            case .certificate: return L("The server’s certificate isn’t valid for this address. The app needs a valid certificate – Let’s Encrypt works.")
            case .offline: return L("No connection right now. Check Wi-Fi or mobile data.")
            case .notToHuus: return L("There is no ToHuus server at this address. Is a path like /tohuus missing?")
            case .tooOld: return L("This ToHuus server is too old for the app. Please update ToHuus on the server, then try again.")
            case .other(let m): return m
            }
        }
    }

    enum Outcome: Sendable {
        case ok(URL, InstanceInfo)
        case failed(Failure)
    }

    /// Plain http only where App Transport Security allows it (NSAllowsLocalNetworking): IP addresses, `.local`
    /// names and names without a dot.
    static func allowsPlainHTTP(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        if host == "localhost" || host.hasSuffix(".local") || !host.contains(".") { return true }
        if host.range(of: #"^\d{1,3}(\.\d{1,3}){3}$"#, options: .regularExpression) != nil { return true }
        return host.contains(":") // IPv6 literal
    }

    static func check(_ raw: String) async -> Outcome {
        guard let url = AppModel.normalise(raw) else { return .failed(.badAddress) }
        if url.scheme?.lowercased() == "http" && !allowsPlainHTTP(url) { return .failed(.needsHTTPS) }
        do {
            let (status, data, finalURL) = try await fetch(url.appendingPathComponent("api/instance"))
            // a redirect from http to https (or to another host) – keep the address the server wants
            let base = finalURL.flatMap(baseOf) ?? url
            if status == 200, let info = try? JSONCoding.decoder().decode(InstanceInfo.self, from: data),
               info.brand == "tohuus" || info.mode == "selfhost" || info.mode == "cloud" {
                return .ok(base, info)
            }
            if status == 404 || status == 200 {
                // a ToHuus server from before /api/instance still answers its sign-in options
                if case let (s2, d2, _)? = try? await fetch(url.appendingPathComponent("api/auth/options")), s2 == 200,
                   let obj = (try? JSONSerialization.jsonObject(with: d2)) as? [String: Any], obj["methods"] != nil {
                    return .failed(.tooOld)
                }
            }
            return .failed(.notToHuus)
        } catch let e as URLError {
            return .failed(failure(e))
        } catch {
            return .failed(.other(error.localizedDescription))
        }
    }

    static func failure(_ e: URLError) -> Failure {
        switch e.code {
        case .cannotFindHost, .dnsLookupFailed: return .noSuchHost
        case .cannotConnectToHost, .timedOut, .networkConnectionLost: return .unreachable
        case .notConnectedToInternet, .dataNotAllowed, .internationalRoamingOff: return .offline
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected,
             .clientCertificateRequired:
            return .certificate
        case .appTransportSecurityRequiresSecureConnection: return .needsHTTPS
        case .badURL, .unsupportedURL: return .badAddress
        default: return .other(e.localizedDescription)
        }
    }

    private static func fetch(_ url: URL) async throws -> (Int, Data, URL?) {
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("ios", forHTTPHeaderField: "X-ToHuus-Client")
        let (data, resp) = try await URLSession.shared.data(for: req)
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data, resp.url)
    }

    /// ".../api/instance" → the base address
    private static func baseOf(_ u: URL) -> URL? {
        var s = u.absoluteString
        guard let r = s.range(of: "/api/instance") else { return nil }
        s = String(s[..<r.lowerBound])
        return URL(string: s)
    }
}

/// GET /api/auth/options (self-hosted, public): what the sign-in page offers – used to name the browser sign-in.
struct SelfhostAuthOptions: Decodable, Sendable {
    struct Methods: Decodable, Sendable {
        var password: Bool?
        var passwordAdminsOnly: Bool?
        var magicLink: Bool?
        var passkeys: Bool?
    }
    struct SSO: Decodable, Sendable { var label: String? }
    var methods: Methods?
    var sso: SSO?

    /// "Passkey, e-mail link or Authentik"
    var browserWays: String? {
        var w: [String] = []
        if methods?.passkeys == true { w.append(L("passkey")) }
        if methods?.magicLink == true { w.append(L("e-mail link")) }
        if let s = sso?.label, !s.isEmpty { w.append(s) }
        guard !w.isEmpty else { return nil }
        if w.count == 1 { return w[0] }
        return LF("%@ or %@", w.dropLast().joined(separator: ", "), w.last!)
    }
}

// MARK: - connect links (QR code from the web app, the browser sign-in's redirect)

/// tohuus://connect?server=https%3A%2F%2Ftohuus.example.de&code=ABCD-EFGH
struct ConnectLink: Equatable, Hashable, Sendable, Identifiable {
    var server: URL
    var code: String
    var id: String { server.absoluteString + "|" + code }

    init(server: URL, code: String) {
        self.server = server
        self.code = code
    }

    init?(_ url: URL) {
        guard url.scheme?.lowercased() == "tohuus", url.host()?.lowercased() == "connect",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let raw = items.first(where: { $0.name == "server" })?.value, let server = AppModel.normalise(raw),
              let code = items.first(where: { $0.name == "code" })?.value, code.count >= 4 else { return nil }
        self.init(server: server, code: code)
    }

    /// A scanned QR code: the link itself (also inside other text).
    init?(text: String) {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = s.range(of: #"tohuus://connect\?[^\s"'<>]+"#, options: .regularExpression), let u = URL(string: String(s[r])) {
            self.init(u)
        } else {
            return nil
        }
    }
}

/// Links that arrive while the app is open (camera, Safari) wait here until a screen shows them.
@MainActor
@Observable
final class ConnectInbox {
    static let shared = ConnectInbox()
    var pending: ConnectLink?

    /// true when the URL was a connect link
    @discardableResult
    func receive(_ url: URL) -> Bool {
        guard let link = ConnectLink(url) else { return false }
        pending = link
        return true
    }
}

// MARK: - PKCE + browser sign-in

enum PKCE {
    /// 32 random bytes → 43 characters base64url
    static func verifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URL
    }

    static func challenge(_ verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
    }
}

/// Opens the server's own sign-in page (passkey, e-mail link, SSO …) in a Safari sheet; the server sends the person
/// back as tohuus://connect with a one-time code that only this app (with its verifier) can use.
@MainActor
final class BrowserSignIn: NSObject, @preconcurrency ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func run(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<URL, Error>) in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "tohuus") { @Sendable callback, error in
                if let callback { c.resume(returning: callback) } else { c.resume(throwing: error ?? URLError(.cancelled)) }
            }
            s.presentationContextProvider = self
            // the Safari sign-in of this server (and its saved passkeys/passwords) can be used
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() {
                session = nil
                c.resume(throwing: URLError(.cannotLoadFromNetwork))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? scenes.first?.windows.first ?? ASPresentationAnchor()
    }

    static func cancelled(_ error: Error) -> Bool {
        if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin { return true }
        return (error as? URLError)?.code == .cancelled
    }
}

// MARK: - API

/// POST /api/auth/app/pair → a one-time code to connect another device
struct PairCode: Decodable, Sendable, Hashable {
    var code: String
    var url: String
    var server: String?
    var expiresIn: Int?
}

extension APIClient {
    func createPairCode() async throws -> PairCode { try await send("POST", "api/auth/app/pair", json: [:]) }

    /// GET /api/auth/options (self-hosted, public)
    func selfhostAuthOptions() async throws -> SelfhostAuthOptions { try await get("api/auth/options") }

    /// POST without throwing on 4xx: status and raw body (sign-in answers carry `needCode` in a 401).
    func postRaw(_ path: String, json: [String: Any]) async throws -> (status: Int, data: Data) {
        var req = try request("POST", path)
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            let (data, resp) = try await URLSession.shared.upload(for: req, from: try JSONSerialization.data(withJSONObject: json))
            return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
        } catch {
            throw APIError.from(error)
        }
    }
}

// MARK: - saved connections (several servers / accounts on one iPhone)

/// Another server or account this iPhone is signed in to (not the active one). The token stays in the Keychain.
struct SavedConnection: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var serverURL: URL
    var mode: String
    var householdId: String?
    var householdName: String?
    var userName: String?
    var households: [HouseholdRef]
    var tokenHash: String
    var savedAt: Date

    var isCloud: Bool { mode == "cloud" }
    var title: String { householdName ?? serverURL.host() ?? serverURL.absoluteString }
    var subtitle: String {
        [userName, isCloud ? L("ToHuus Cloud") : serverURL.host()].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

enum ConnectionVault {
    private static let key = "connections.saved"
    private static func account(_ id: String) -> String { "connection.\(id)" }

    static func hash(_ token: String) -> String { SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined() }

    static func all() -> [SavedConnection] {
        guard let data = SharedConfig.defaults.data(forKey: key),
              let list = try? JSONDecoder().decode([SavedConnection].self, from: data) else { return [] }
        return list.sorted { $0.savedAt > $1.savedAt }
    }

    private static func write(_ list: [SavedConnection]) {
        if let data = try? JSONEncoder().encode(list) { SharedConfig.defaults.set(data, forKey: key) }
    }

    static func token(_ id: String) -> String? { Keychain.read(account: account(id)) }

    /// Keeps one entry per token (and per server + household + person).
    static func upsert(_ c: SavedConnection, token: String) {
        var list = all()
        for old in list where old.tokenHash == c.tokenHash || (old.serverURL == c.serverURL && old.householdId == c.householdId && old.userName == c.userName) {
            Keychain.delete(account: account(old.id))
        }
        list.removeAll { $0.tokenHash == c.tokenHash || ($0.serverURL == c.serverURL && $0.householdId == c.householdId && $0.userName == c.userName) }
        guard Keychain.save(token, account: account(c.id)) else { write(list); return }
        list.append(c)
        write(list)
    }

    static func remove(id: String) {
        Keychain.delete(account: account(id))
        write(all().filter { $0.id != id })
    }

    /// The active session must not also wait here (signing out would bring it back).
    static func forget(token: String) {
        let h = hash(token)
        for c in all() where c.tokenHash == h { remove(id: c.id) }
    }
}

extension AppModel {
    /// Before another server or account becomes active: keep the current one to switch back without signing in.
    func rememberCurrentConnection() {
        guard phase == .signedIn, let s = session, let token = SessionInfo.token else { return }
        let c = SavedConnection(id: UUID().uuidString, serverURL: s.serverURL, mode: s.mode, householdId: s.householdId,
                                householdName: activeHousehold?.name, userName: userName, households: households,
                                tokenHash: ConnectionVault.hash(token), savedAt: Date())
        ConnectionVault.upsert(c, token: token)
    }

    /// Other servers/accounts on this iPhone (never the active one).
    var savedConnections: [SavedConnection] {
        let current = SessionInfo.token.map(ConnectionVault.hash)
        return ConnectionVault.all().filter { $0.tokenHash != current }
    }

    /// Switch to a saved connection (the active one is kept for switching back).
    @discardableResult
    func openSaved(_ c: SavedConnection) async -> Bool {
        guard let token = ConnectionVault.token(c.id) else {
            ConnectionVault.remove(id: c.id)
            return false
        }
        if phase == .signedIn {
            rememberCurrentConnection()
            signOut()
        }
        ConnectionVault.remove(id: c.id)
        SessionInfo(serverURL: c.serverURL, mode: c.mode, householdId: c.householdId, deviceName: Self.deviceName).save()
        SessionInfo.token = token
        if let data = try? JSONEncoder().encode(c.households) { SharedConfig.defaults.set(data, forKey: "session.households") }
        SharedConfig.defaults.set(c.userName, forKey: "session.user")
        notice = nil
        await restore()
        return true
    }

    // MARK: own server sign-in

    enum OwnSignIn { case done, needCode(String) }

    /// POST /api/auth/app with name or e-mail + password; a 401 with `needCode` asks for the two-step code.
    func signInOwnServer(server: URL, info: InstanceInfo, login: String, password: String, code: String?) async throws -> OwnSignIn {
        var body: [String: Any] = ["password": password, "device": Self.deviceName]
        body[login.contains("@") ? "email" : "name"] = login
        if let code, !code.isEmpty { body["code"] = code }
        let api = APIClient(baseURL: server)
        let r = try await api.postRaw("api/auth/app", json: body)
        let obj = (try? JSONSerialization.jsonObject(with: r.data)) as? [String: Any]
        let message = (obj?["error"] as? String) ?? ""
        if (200..<300).contains(r.status) {
            let res = try api.decode(AppAuthResponse.self, from: r.data)
            await finishOwn(server: server, info: info, response: res)
            return .done
        }
        if r.status == 401, obj?["needCode"] as? Bool == true { return .needCode(message) }
        throw APIError.server(status: r.status, message: message)
    }

    /// POST /api/auth/app/pair/claim – a code from the QR code (no verifier) or from the browser sign-in (verifier).
    func claimPairCode(server: URL, info: InstanceInfo, code: String, verifier: String?) async throws {
        var body: [String: Any] = ["code": code, "device": Self.deviceName]
        if let verifier { body["verifier"] = verifier }
        let api = APIClient(baseURL: server)
        let res: AppAuthResponse = try await api.send("POST", "api/auth/app/pair/claim", json: body)
        await finishOwn(server: server, info: info, response: res)
    }

    /// Sign in in the browser: the server's own page, then back with a code bound to this app.
    func signInInBrowser(server: URL, info: InstanceInfo, runner: BrowserSignIn) async throws {
        let verifier = PKCE.verifier()
        guard var comps = URLComponents(url: server.appendingPathComponent("api/auth/app/pair/start"), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        comps.queryItems = [URLQueryItem(name: "challenge", value: PKCE.challenge(verifier))]
        guard let url = comps.url else { throw APIError.invalidURL }
        let back = try await runner.run(url)
        guard let link = ConnectLink(back) else { throw APIError.server(status: 0, message: L("The sign-in didn’t come back complete. Please try again.")) }
        try await claimPairCode(server: server, info: info, code: link.code, verifier: verifier)
    }

    private func finishOwn(server: URL, info: InstanceInfo, response: AppAuthResponse) async {
        finishSignIn(server: server, mode: info.isCloud ? "cloud" : "selfhost", response: response)
        // the start screen showed ToHuus Cloud's instance – the app now follows this server (legal links, features)
        _ = try? await loadInstance(server)
    }

    /// Connect from a QR code / tohuus://connect link: check the server, then claim the code.
    func connect(_ link: ConnectLink) async throws {
        switch await ServerCheck.check(link.server.absoluteString) {
        case .ok(let url, let info):
            try await claimPairCode(server: url, info: info, code: link.code, verifier: nil)
        case .failed(let f):
            throw APIError.server(status: 0, message: f.message)
        }
    }
}

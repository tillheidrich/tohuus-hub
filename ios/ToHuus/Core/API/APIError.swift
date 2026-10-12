import Foundation

enum APIError: Error, LocalizedError, Equatable {
    /// no connection / timeout – the caller may queue the change
    case offline
    /// 401 – the token is gone or revoked; the app signs out
    case unauthorized
    /// assistant quota or plan limit reached (402, or an error flagged as quota)
    case quota(String)
    /// 413 storage.full – the household's storage quota is used up (nothing is deleted)
    case storageFull(String)
    /// 404 – usually an endpoint the server does not have yet
    case notFound
    case server(status: Int, message: String)
    case decoding(String)
    case invalidURL

    var errorDescription: String? {
        switch self {
        case .offline: return L("No connection right now. ToHuus keeps your changes and sends them later.")
        case .unauthorized: return L("You have been signed out. Please sign in again.")
        case .quota(let m): return m.isEmpty ? L("This month's assistant messages are used up.") : m
        case .storageFull(let m): return m.isEmpty ? L("Your household's storage is full. Nothing was deleted – free up space or choose a bigger plan.") : m
        case .notFound: return L("This server doesn't know that yet. Is it up to date?")
        case .server(_, let m): return m
        case .decoding: return L("The server answered in a way the app doesn't understand yet.")
        case .invalidURL: return L("That address doesn't look right.")
        }
    }

    var isOffline: Bool { self == .offline }

    static func from(_ error: Error) -> APIError {
        if let e = error as? APIError { return e }
        if let u = error as? URLError {
            switch u.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost,
                 .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff, .secureConnectionFailed:
                return .offline
            default:
                return .server(status: 0, message: u.localizedDescription)
            }
        }
        if error is DecodingError { return .decoding(String(describing: error)) }
        return .server(status: 0, message: error.localizedDescription)
    }
}

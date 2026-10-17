import Foundation

enum APIError: Error, LocalizedError, Equatable {
    /// no connection / timeout – the caller may queue the change
    case offline
    /// 401 – the token is gone or revoked; the app signs out
    case unauthorized
    /// assistant quota or plan limit reached (402, or an error flagged as quota)
    case quota(String)
    /// 402 plan.assistant – the household's plan (Free) has no AI assistant; simple sentences still work
    case planAssistant(String)
    /// 413 storage.full – the household's storage quota is used up (nothing is deleted)
    case storageFull(String)
    /// 404 – usually an endpoint the server does not have yet
    case notFound
    case server(status: Int, message: String)
    case decoding(String)
    case invalidURL

    var errorDescription: String? {
        switch self {
        // the shopping list queues its changes itself and never shows this; everywhere else nothing was saved
        case .offline: return L("ToHuus can't be reached right now. Nothing was changed – please try again in a moment.")
        case .unauthorized: return L("You have been signed out. Please sign in again.")
        case .quota(let m): return m.isEmpty ? L("This month's assistant messages are used up.") : m
        case .planAssistant(let m): return m.isEmpty ? L("The assistant with AI comes with Household and Plus – try it free for 14 days.") : m
        case .storageFull(let m): return m.isEmpty ? L("Your household's storage is full. Nothing was deleted – free up space or choose a bigger plan.") : m
        case .notFound: return L("That isn't there any more. Pull down to refresh.")
        case .server(let status, let m): return APIError.friendly(status: status, message: m)
        case .decoding: return L("The answer didn't fit this version of the app. Please update the app or try again later.")
        case .invalidURL: return L("That address doesn't look right.")
        }
    }

    var isOffline: Bool { self == .offline }

    /// Server texts meant for people are shown as they are; technical ones ("unauthorized", "Internal Server Error",
    /// "not found", an NSError dump) become a plain sentence for the status.
    static func friendly(status: Int, message: String) -> String {
        let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let technical = m.isEmpty
            || m.range(of: #"^[a-z_ .-]+$"#, options: .regularExpression) != nil
            || m.contains("Error Domain=") || m.contains("NSURLErrorDomain")
            || m.lowercased() == HTTPURLResponse.localizedString(forStatusCode: status).lowercased()
        if !technical { return m }
        switch status {
        case 401: return L("That didn't work – please sign in again.")
        case 403: return L("You can't do that in this household.")
        case 404: return L("That isn't there any more. Pull down to refresh.")
        case 408, 504: return L("That took too long. Please try again in a moment.")
        case 409: return L("That changed in the meantime. Pull down to refresh and try again.")
        case 413: return L("That file is too big.")
        case 429: return L("A lot is happening right now. Please try again in a moment.")
        case 502, 503: return L("ToHuus can't be reached right now. Please try again in a moment.")
        case 500...: return L("That didn't work. Please try again in a moment.")
        default: return L("That didn't work. Please try again.")
        }
    }

    static func from(_ error: Error) -> APIError {
        if let e = error as? APIError { return e }
        if let u = error as? URLError {
            switch u.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .cannotFindHost,
                 .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff, .secureConnectionFailed:
                return .offline
            case .cancelled:
                return .server(status: 0, message: L("Cancelled."))
            default:
                return .server(status: 0, message: L("That didn't work. Please check your connection and try again."))
            }
        }
        if error is DecodingError { return .decoding(String(describing: error)) }
        return .server(status: 0, message: error.localizedDescription)
    }
}

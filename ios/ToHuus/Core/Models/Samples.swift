import Foundation

/// GET /api/tour – only what the app needs: the sample data and the first-start question.
struct TourInfo: Decodable, Sendable {
    var admin: Bool?
    var demo: Demo?
    var start: Start?

    struct Demo: Decodable, Sendable {
        var rows: Int?
        var products: Int?
        var recipes: Int?
        /// when the sample data came in
        var since: String?
        /// Today offers removing it once (admins, after a few days)
        var nudge: Bool?
    }

    struct Start: Decodable, Sendable {
        var choice: String?
        /// the household has not answered "Beispieldaten?" yet (admins only)
        var due: Bool?
    }
}

/// GET /api/tour/demo/marks – ids of sample rows, tagged quietly with "Beispiel".
struct DemoMarks: Decodable, Sendable, Equatable {
    var products: [Int] = []
    var recipes: [Int] = []
    var shopping: [Int] = []
}

/// POST /api/tour/demo/remove
struct DemoRemoveResult: Decodable, Sendable {
    struct Kept: Decodable, Sendable { var products: Int?; var recipes: Int? }
    var kept: Kept?
}

/// POST /api/auth/passkey/options { client: "ios" }
struct PasskeyOptions: Decodable, Sendable {
    struct Options: Decodable, Sendable {
        var challenge: String
        var rpId: String?
    }
    var options: Options
    var key: String
}

extension CloudMe {
    /// how deleting the account is confirmed: the password, else Sign in with Apple or the code from a mail
    var hasPassword: Bool { account?["hasPassword"]?.bool ?? true }
    /// linked to Sign in with Apple
    var appleLinked: Bool { account?["apple"]?.bool ?? false }
}

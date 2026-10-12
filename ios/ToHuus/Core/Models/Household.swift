import Foundation

// Household: people (pictures, likes, allergies), invitations, "Was ToHuus sich merkt".
// server/routes/people.ts, server/routes/invites.ts, server/routes/assistant.ts (/memory).

/// A person's picture: initials, an animal drawing or a photo (web/src/people/Avatar.tsx `Face`).
struct PersonFace: Codable, Sendable, Hashable {
    var type: String
    var animal: String?
    var image: String?

    static let initials = PersonFace(type: "initials")
}

/// GET /api/people/directory – name, colour and picture of everyone in the household (for avatars in lists).
struct PersonDirEntry: Decodable, Sendable, Hashable, Identifiable {
    var key: String
    var name: String
    var color: String?
    var kind: String?
    var face: PersonFace?
    var id: String { key }
}

/// GET /api/people → { people: [Person] }
struct PeopleResponse: Decodable, Sendable {
    @Lossy var people: [Person]
}

struct Person: Decodable, Sendable, Hashable, Identifiable {
    /// u3 (member or guest), k2 (child)
    var key: String
    var id: Int
    /// member | guest | child
    var kind: String
    var role: String?
    var name: String
    var color: String?
    var face: PersonFace?
    var birthYear: Int?
    var prefs: Prefs?
    var guest: JSONValue?
    var email: String?

    struct Prefs: Codable, Sendable, Hashable {
        var likes: [String] = []
        var dislikes: [String] = []
        var allergies: [String] = []

        init(likes: [String] = [], dislikes: [String] = [], allergies: [String] = []) {
            self.likes = likes; self.dislikes = dislikes; self.allergies = allergies
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            likes = c.first([String].self, "likes") ?? []
            dislikes = c.first([String].self, "dislikes") ?? []
            allergies = c.first([String].self, "allergies") ?? []
        }
    }

    var guestLevel: String? { guest?["level"]?.string }
}

/// GET /api/invites (admins) – the last 50, open ones first.
struct InviteItem: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    var name: String?
    var email: String?
    /// admin | member
    var role: String?
    /// member | guest
    var kind: String?
    var guestLevel: String?
    var color: String?
    var message: String?
    var createdBy: String?
    var createdAt: String?
    var expiresAt: String?
    var sentAt: String?
    var sendCount: Int?
    var usedAt: String?
    var usedByName: String?
    /// pending | used | expired | revoked
    var status: String
}

/// GET /api/invites/options → { mail, levels, days }
struct InviteOptions: Decodable, Sendable {
    var mail: Bool?
    var levels: [String]?
    var days: Int?
}

/// POST /api/invites and POST /api/invites/:id/resend → the link (shown only once)
struct InviteLink: Decodable, Sendable, Hashable, Identifiable {
    var url: String
    var expiresAt: String?
    var sent: Bool?
    var email: String?
    /// set by the app: who it is for
    var forName: String?
    var id: String { url }
}

/// GET /api/memory – what the household asked ToHuus to remember ("merkt sich"; never "Gedächtnis" outward).
struct MemoryRow: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    var scope: String?
    var person: String?
    /// fact | preference | routine
    var kind: String?
    var text: String
    /// user | assistant | derived
    var source: String?
    var sensitive: Bool?
    var createdBy: String?
    var createdAt: String?
    /// "nur für mich": only the author sees it
    var onlyMe: Bool?

    var kindLabel: String {
        switch kind {
        case "preference": return L("Preference")
        case "routine": return L("Habit")
        default: return L("Fact")
        }
    }
}

/// Saving something that may contain health data (allergies) answers 409 { code: 'health_consent' } until the
/// household confirmed once (Art. 9 GDPR). The app asks and repeats the save with `consent: true`.
enum ConsentResult: Sendable {
    case saved
    case needsConsent
}

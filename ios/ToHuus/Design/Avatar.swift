import Observation
import SwiftUI

/// One avatar for every person in the app (web: web/src/people/Avatar.tsx): photo, animal drawing or initials on
/// the person's colour. Lists usually only know a name – `PersonAvatar` looks it up in the household directory.
struct AvatarView: View {
    let name: String
    var color: String?
    var face: PersonFace?
    var size: CGFloat = 30
    var api: APIClient?

    var body: some View {
        let c = Color(hexString: color) ?? Color(UIColor(hex: 0x2F5BEA))
        Group {
            if face?.type == "photo", let img = face?.image, let api {
                RemoteImage(url: api.imageURL(img), api: api, placeholder: "person.fill")
                    .background(c)
            } else if face?.type == "animal", let animal = face?.animal {
                ZStack {
                    c.opacity(0.2)
                    ArtCanvas(viewBox: CGSize(width: 100, height: 100), shapes: AnimalArt.shapes(animal))
                }
            } else {
                ZStack {
                    c
                    Text(initials)
                        .font(.system(size: size * (initials.count > 1 ? 0.36 : 0.42), weight: .semibold))
                        .foregroundStyle(.white)
                        .minimumScaleFactor(0.5)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var initials: String {
        let words = name.trimmingCharacters(in: .whitespaces).split(separator: " ").prefix(size >= 40 ? 2 : 1)
        let s = words.compactMap { $0.first.map { String($0).uppercased() } }.joined()
        return s.isEmpty ? "?" : s
    }
}

/// Avatar by name (or key) – face and colour from GET /api/people/directory, loaded once per household.
struct PersonAvatar: View {
    let name: String
    var key: String?
    var size: CGFloat = 24
    var api: APIClient?
    private var dir: PeopleDirectory { .shared }

    var body: some View {
        let hit = dir.lookup(name, key: key)
        AvatarView(name: hit?.name ?? name, color: hit?.color, face: hit?.face, size: size, api: api)
            .task(id: api?.householdId) { if let api { await dir.load(api) } }
    }
}

@MainActor
@Observable
final class PeopleDirectory {
    static let shared = PeopleDirectory()
    private(set) var entries: [PersonDirEntry] = []
    private var loadedFor: String?
    private var loadedAt: Date?
    private var loading = false

    func load(_ api: APIClient, force: Bool = false) async {
        let hh = api.householdId ?? "-"
        if !force, loadedFor == hh, let t = loadedAt, Date().timeIntervalSince(t) < 60 { return }
        if loading { return }
        loading = true
        defer { loading = false }
        if let e = try? await api.peopleDirectory() {
            entries = e
            loadedFor = hh
            loadedAt = Date()
        }
    }

    /// members first – a child could share a name with an adult (same rule as the web)
    func lookup(_ name: String, key: String? = nil) -> PersonDirEntry? {
        if let key, let k = entries.first(where: { $0.key == key }) { return k }
        let n = name.trimmingCharacters(in: .whitespaces).lowercased()
        guard !n.isEmpty else { return nil }
        return entries.first { $0.kind != "child" && $0.name.lowercased() == n } ?? entries.first { $0.name.lowercased() == n }
    }
}

extension Color {
    /// "#2f5bea" → Color
    init?(hexString: String?) {
        guard var s = hexString?.trimmingCharacters(in: .whitespaces), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(UIColor(hex: v))
    }
}

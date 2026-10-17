import SwiftUI

/// Lieblinge (web: `/lieblinge`, people/Ratings.tsx Favourites + PersonProfileSheet, GET /api/people/favourites and
/// /api/people/person/:key): the household's all-time favourites, what was cooked most often and a row per person.
/// Tap a face for what that person likes, doesn't like and had most often. Ratings come from "how was it?" after
/// cooking – nothing to keep up by hand.
struct FavouritesView: View {
    let store: ServerStore
    @State private var data: FavouritesData?
    @State private var family = true
    @State private var error: String?
    @State private var person: PersonKey?

    private var api: APIClient { store.api }

    struct PersonKey: Identifiable { let id: String }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s6) {
                if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                }
                if let d = data {
                    faces(d)
                    let nothing = d.family.isEmpty && d.classics.isEmpty && !d.people.contains { ($0.rated ?? 0) > 0 }
                    if nothing {
                        EmptyStateView(systemImage: "heart", title: L("No favourites yet"),
                                       message: L("After cooking, tap how everybody liked it – the family favourites collect here by themselves."))
                    } else {
                        if !d.family.isEmpty {
                            grid(family ? L("Family all-time favourites") : L("All-time favourites"), d.family, d)
                        }
                        if !d.classics.isEmpty { grid(L("Cooked most often"), d.classics, d) }
                        ForEach(d.people.filter { !$0.top.isEmpty }) { p in
                            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                                Button { person = PersonKey(id: p.key) } label: {
                                    HStack(spacing: Theme.Space.s2) {
                                        AvatarView(name: p.name, color: p.color, face: p.face, size: 28, api: api)
                                        Text(LF("%@ loves", p.name)).font(Theme.title(Theme.FontSize.l)).foregroundStyle(Theme.ink)
                                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                                    }
                                    .frame(minHeight: 44)
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(.isHeader)
                                tiles(p.top, d)
                            }
                        }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
        }
        .canvasBackground()
        .navigationTitle(L("Favourites"))
        .task(id: store.revision("people") + store.revision("recipes")) { await load() }
        .refreshable { await load() }
        .sheet(item: $person) { k in PersonTasteSheet(key: k.id, store: store) }
    }

    private func faces(_ d: FavouritesData) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: Theme.Space.s4) {
                ForEach(d.people) { p in
                    Button { person = PersonKey(id: p.key) } label: {
                        VStack(spacing: 4) {
                            AvatarView(name: p.name, color: p.color, face: p.face, size: 52, api: api)
                            Text(p.name).font(.caption).foregroundStyle(Theme.ink).lineLimit(1)
                        }
                        .frame(width: 64)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(p.name)
                    .accessibilityHint(L("Shows what this person likes"))
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func grid(_ title: String, _ cards: [FavouritesData.FavCard], _ d: FavouritesData) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(title).font(Theme.title(Theme.FontSize.h2)).accessibilityAddTraits(.isHeader)
            tiles(cards, d)
        }
    }

    private func tiles(_ cards: [FavouritesData.FavCard], _ d: FavouritesData) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
            ForEach(cards) { c in
                NavigationLink { RecipeDetailView(recipeId: c.recipeId, store: store) } label: { tile(c, d) }
                    .buttonStyle(.plain)
            }
        }
    }

    private func tile(_ c: FavouritesData.FavCard, _ d: FavouritesData) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            RemoteImage(url: api.imageURL(c.imagePath), api: api, placeholder: "fork.knife")
                .frame(height: 104)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
            Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2)
                .multilineTextAlignment(.leading)
            HStack(spacing: 2) {
                ForEach((c.lovedBy ?? []).prefix(4), id: \.self) { k in
                    if let p = d.people.first(where: { $0.key == k }) {
                        AvatarView(name: p.name, color: p.color, face: p.face, size: 20, api: api)
                    }
                }
                let cooked = c.cooked ?? 0
                if cooked > 0 {
                    Text(cooked == 1 ? L("cooked once") : LF("cooked %d×", cooked)).font(.caption).foregroundStyle(Theme.ink3).padding(.leading, 4)
                }
            }
        }
        .padding(Theme.Space.s2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(lovedLabel(c, d))
    }

    private func lovedLabel(_ c: FavouritesData.FavCard, _ d: FavouritesData) -> String {
        let names = (c.lovedBy ?? []).compactMap { k in d.people.first { $0.key == k }?.name }
        return names.isEmpty ? c.title : "\(c.title), " + LF("loved by %@", names.joined(separator: ", "))
    }

    private func load() async {
        do {
            async let f = api.favourites()
            async let s = try? api.homeSetup()
            data = try await f
            if let s = await s { family = (s.form ?? "family") == "family" }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// One person: what they like, what they don't, what was cooked for them most (web PersonProfileSheet).
struct PersonTasteSheet: View {
    let key: String
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var data: PersonTaste?
    @State private var tab = 0
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if let d = data {
                    Section {
                        HStack(spacing: Theme.Space.s3) {
                            AvatarView(name: d.person.name, color: d.person.color, face: d.person.face, size: 56, api: store.api)
                            VStack(alignment: .leading, spacing: 3) {
                                if let a = d.person.prefs?.allergies, !a.isEmpty {
                                    Text(L("Allergies") + ": " + a.joined(separator: ", ")).font(.subheadline.weight(.semibold))
                                }
                                if let l = d.person.prefs?.likes, !l.isEmpty {
                                    Text(L("Likes") + ": " + l.joined(separator: ", ")).font(.subheadline)
                                }
                                if let n = d.person.prefs?.dislikes, !n.isEmpty {
                                    Text(L("Doesn’t like") + ": " + n.joined(separator: ", ")).font(.subheadline).foregroundStyle(Theme.ink2)
                                }
                            }
                        }
                        Picker(L("Show"), selection: $tab) {
                            Text("\(L("Likes")) · \(d.likes.count)").tag(0)
                            Text("\(L("Not for them")) · \(d.dislikes.count)").tag(1)
                            Text(L("Most cooked")).tag(2)
                        }
                        .pickerStyle(.segmented)
                    }
                    Section {
                        let lines = tab == 0 ? d.likes : tab == 1 ? d.dislikes : d.mostCooked
                        if lines.isEmpty {
                            Text(tab == 0 ? L("Nothing rated as loved yet.") : tab == 1 ? L("Nothing they don’t like – so far.") : L("Counts once you tap a rating after cooking."))
                                .font(.subheadline).foregroundStyle(Theme.ink3)
                        }
                        ForEach(lines) { r in
                            NavigationLink { RecipeDetailView(recipeId: r.recipeId, store: store) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(r.title)
                                        if let m = r.meals, m > 0 {
                                            Text(m == 1 ? L("eaten once") : LF("eaten %d×", m)).font(.caption).foregroundStyle(Theme.ink3)
                                        }
                                    }
                                    Spacer(minLength: 8)
                                    if let v = r.value { Text(Self.rating(v)).font(.caption).foregroundStyle(Theme.ink2) }
                                }
                            }
                        }
                    }
                } else if error == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            }
            .themedList()
            .navigationTitle(data?.person.name ?? "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                do { data = try await store.api.personTaste(key) } catch { self.error = APIError.from(error).localizedDescription }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// 1/3/5 (2 and 4 from assistants show as the nearest choice) – web Ratings.tsx bucket
    static func rating(_ v: Double) -> String {
        v <= 2 ? L("Not for me") : v >= 4 ? L("Loved it") : L("Okay")
    }
}

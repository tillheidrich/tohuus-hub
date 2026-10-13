import SwiftUI

/// "Unser Haushalt" (Mehr → Haushalt): the people with their picture, likes and allergies, invitations, and what
/// ToHuus remembers. Web: people/People.tsx, Invites.tsx, Memory.tsx.
struct HouseholdView: View {
    let api: APIClient
    @State private var people: [Person] = []
    @State private var me: MeResponse?
    @State private var loaded = false
    @State private var error: String?

    private var myKey: String? { me?.actor?["userId"]?.int.map { "u\($0)" } }
    private var isAdmin: Bool { me?.role == "admin" }

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            ForEach(groups, id: \.0) { title, list in
                Section(title) {
                    ForEach(list) { p in
                        NavigationLink {
                            PersonDetailView(api: api, person: p, isMe: p.key == myKey, canEdit: p.key == myKey || isAdmin || p.kind == "child") {
                                Task { await load() }
                            }
                        } label: { personRow(p) }
                    }
                }
            }
            if loaded && people.isEmpty && error == nil {
                Section { EmptyStateView(art: .shelf, title: L("Nobody here yet.")) }.listRowBackground(Color.clear)
            }
            Section {
                if isAdmin {
                    NavigationLink { InvitesView(api: api) } label: { Label(L("Invite someone"), systemImage: "person.badge.plus") }
                }
                NavigationLink { MemoryView(api: api) } label: { Label(L("What ToHuus remembers"), systemImage: "text.book.closed") }
            } footer: {
                Text(isAdmin ? L("Children and permanent guests can be added in the web app.") : L("Only admins can invite someone."))
            }
        }
        .navigationTitle(L("Our household"))
        .refreshable { await load() }
        .task { await load() }
    }

    private var groups: [(String, [Person])] {
        [(L("Household"), people.filter { $0.kind == "member" }),
         (L("Children"), people.filter { $0.kind == "child" }),
         (L("Permanent guests"), people.filter { $0.kind == "guest" })].filter { !$0.1.isEmpty }
    }

    private func personRow(_ p: Person) -> some View {
        HStack(spacing: Theme.Space.s3) {
            AvatarView(name: p.name, color: p.color, face: p.face, size: 44, api: api)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.name + (p.key == myKey ? " · " + L("you") : "")).font(.body).foregroundStyle(Theme.ink)
                Text(kindLabel(p)).font(.caption).foregroundStyle(Theme.ink3)
                if let a = p.prefs?.allergies, !a.isEmpty {
                    StatusPill(text: a.prefix(2).joined(separator: ", "), status: "low")
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func kindLabel(_ p: Person) -> String {
        switch p.kind {
        case "child": return p.birthYear.map { LF("Child · born %d", $0) } ?? L("Child")
        case "guest": return L("Permanent guest")
        default: return p.role == "admin" ? L("Admin") : L("Member")
        }
    }

    private func load() async {
        do {
            async let m = api.me()
            async let p = api.people()
            me = try? await m
            people = try await p
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
        loaded = true
        await PeopleDirectory.shared.load(api, force: true)
    }
}

/// One person: picture (initials or an animal), allergies, dislikes, likes.
/// Allergies are health data (Art. 9 GDPR): the first one is only saved after the household confirmed once.
struct PersonDetailView: View {
    let api: APIClient
    let person: Person
    let isMe: Bool
    let canEdit: Bool
    let onChange: () -> Void
    @State private var prefs = Person.Prefs()
    @State private var face: PersonFace?
    @State private var pending: Person.Prefs?
    @State private var askConsent = false
    @State private var error: String?
    @State private var saved = Person.Prefs()

    var body: some View {
        Form {
            Section {
                HStack(spacing: Theme.Space.s4) {
                    AvatarView(name: person.name, color: person.color, face: face ?? person.face, size: 64, api: api)
                    VStack(alignment: .leading) {
                        Text(person.name).font(.title3.weight(.semibold))
                        if isMe { Text(L("you")).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                }
                .padding(.vertical, 4)
            }
            if canEdit {
                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Space.s3) {
                            pictureChoice(nil)
                            ForEach(AnimalArt.keys, id: \.self) { pictureChoice($0) }
                        }
                        .padding(.vertical, 4)
                    }
                } header: { Text(L("Picture")) } footer: {
                    if (face ?? person.face)?.type == "photo" { Text(L("A photo can be changed in the web app.")) }
                }
            }
            if person.prefs != nil || canEdit {
                Section {
                    if canEdit {
                        TagEditor(label: L("Allergies"), values: $prefs.allergies, placeholder: L("e.g. nuts"), tone: "low",
                                  help: L("Dishes with these get a warning and are never planned automatically."))
                        TagEditor(label: L("Doesn’t like"), values: $prefs.dislikes, placeholder: L("e.g. mushrooms"),
                                  help: L("Suggestions with these come a little later."))
                        TagEditor(label: L("Likes"), values: $prefs.likes, placeholder: L("e.g. pasta"), tone: "good")
                    } else {
                        if !prefs.allergies.isEmpty { LabeledContent(L("Allergies"), value: prefs.allergies.joined(separator: ", ")) }
                        if !prefs.dislikes.isEmpty { LabeledContent(L("Doesn’t like"), value: prefs.dislikes.joined(separator: ", ")) }
                        if prefs.allergies.isEmpty && prefs.dislikes.isEmpty { Text(L("Nothing noted yet.")).foregroundStyle(Theme.ink3) }
                    }
                } header: { Text(L("Food")) } footer: {
                    Text(L("Allergies stay in your household. They only go to the assistant if you allow that in the settings."))
                }
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .navigationTitle(person.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            prefs = person.prefs ?? Person.Prefs()
            saved = prefs
        }
        .onChange(of: prefs) { _, p in
            guard canEdit, p != saved else { return }
            Task { await save(p, consent: false) }
        }
        .alert(L("Save allergies?"), isPresented: $askConsent) {
            Button(L("Not now"), role: .cancel) {
                prefs = saved
                pending = nil
            }
            Button(L("Save")) { if let p = pending { Task { await save(p, consent: true) } } }
        } message: {
            Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
        }
    }

    private func pictureChoice(_ animal: String?) -> some View {
        let current = face ?? person.face
        let on = animal == nil ? (current?.type ?? "initials") == "initials" : current?.animal == animal && current?.type == "animal"
        let f = animal.map { PersonFace(type: "animal", animal: $0) } ?? .initials
        return Button {
            Task {
                do {
                    try await api.setFace(personKey: person.key, isMe: isMe, animal: animal)
                    face = f
                    onChange()
                } catch { self.error = APIError.from(error).localizedDescription }
            }
        } label: {
            AvatarView(name: person.name, color: person.color, face: f, size: 48, api: api)
                .overlay(Circle().stroke(on ? Theme.primary : Color.clear, lineWidth: 3).padding(-3))
                .padding(3)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(animal.map { LF("Picture: %@", animalName($0)) } ?? L("Initials"))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func animalName(_ k: String) -> String {
        switch k {
        case "fox": return L("Fox")
        case "bear": return L("Bear")
        case "rabbit": return L("Rabbit")
        case "cat": return L("Cat")
        case "owl": return L("Owl")
        case "frog": return L("Frog")
        case "mouse": return L("Mouse")
        default: return L("Hedgehog")
        }
    }

    private func save(_ p: Person.Prefs, consent: Bool) async {
        do {
            // only the lists that changed – allergies only when they did (consent rule)
            let r = try await api.setPrefs(personKey: person.key, isMe: isMe,
                                           likes: p.likes != saved.likes ? p.likes : nil,
                                           dislikes: p.dislikes != saved.dislikes ? p.dislikes : nil,
                                           allergies: p.allergies != saved.allergies ? p.allergies : nil,
                                           consent: consent)
            switch r {
            case .saved:
                saved = p
                pending = nil
                error = nil
                onChange()
            case .needsConsent:
                pending = p
                askConsent = true
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
            prefs = saved
        }
    }
}

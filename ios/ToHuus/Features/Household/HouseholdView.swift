import SwiftUI

/// "Unser Haushalt" (Mehr → Personen, the web's Settings › Members): everyone with their picture, likes and allergies;
/// admins add children and permanent guests, invite, set guest access, send sign-in links, switch member ⇄ guest and
/// remove people; kids & kid tablets; how people sign in (self-hosted); what ToHuus remembers.
/// Web: pages/Settings.tsx (members tab) → people/People.tsx, DataSettings.tsx Members, AuthSettings.tsx SignInAdmin,
/// KidsSettings.tsx. The person screens live in Features/Household/People/.
struct HouseholdView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var people: [Person] = []
    @State private var me: MeResponse?
    @State private var loaded = false
    @State private var error: String?
    @State private var addChild = false
    @State private var addGuest = false
    @State private var addPassword = false
    @State private var showKids = false
    @State private var showNames: Bool?
    @State private var open: Person?
    @State private var toast: ToastMessage?

    private var myUserId: Int? { me?.actor?["userId"]?.int }
    private var myKey: String? { myUserId.map { "u\($0)" } }
    private var isAdmin: Bool { me?.role == "admin" }
    private var viewerIsGuest: Bool { me?.isGuest ?? app.isGuest }
    private var form: String? { me?.home?["form"]?.string }
    private var kidsByForm: Bool { me?.home?["ui"]?["kids"]?.bool ?? (form == "family") }

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            Section {
                EmptyView()
            } footer: {
                Text(L("Tap a person for their picture, what they like and what they can see."))
            }
            ForEach(groups, id: \.0) { title, list in
                Section(title) {
                    ForEach(list) { p in
                        NavigationLink { personView(p) } label: { personRow(p) }
                    }
                }
            }
            if loaded && people.isEmpty && error == nil {
                Section { EmptyStateView(art: .shelf, title: L("Nobody here yet.")) }.listRowBackground(Color.clear)
            }
            if loaded && isAdmin && !people.contains(where: { $0.kind == "child" }) {
                Section {
                    EmptyView()
                } footer: {
                    Text(L("Children get a profile without a login: a picture, what they like and their allergies. Parents rate dishes for them, and kid mode uses the same profile."))
                }
            }
            if isAdmin && !viewerIsGuest {
                Section {
                    NavigationLink { InvitesView(api: api) } label: { Label(L("Invite someone"), systemImage: "person.badge.plus") }
                    Button { addChild = true } label: { Label(L("Add a child"), systemImage: "figure.and.child.holdinghands") }
                    Button { addGuest = true } label: { Label(L("Add a permanent guest"), systemImage: "person.crop.circle.badge.clock") }
                    if !app.isCloud {
                        Button { addPassword = true } label: { Label(L("Add with a password instead"), systemImage: "key") }
                    }
                } header: { Text(L("Add people")) } footer: {
                    Text(L("Everyone you invite gets a personal link and picks their own passkey, password or e-mail sign-in."))
                }
            }
            if !viewerIsGuest {
                Section {
                    if kidsByForm || showKids || people.contains(where: { $0.kind == "child" }) {
                        NavigationLink { KidsAdminView(api: api, isAdmin: isAdmin) } label: {
                            Label(L("Kids & kid tablets"), systemImage: "face.smiling")
                        }
                    } else {
                        Button(L("Children in the household? Show the kids section")) { showKids = true }
                            .font(.subheadline)
                    }
                }
            }
            if isAdmin && !app.isCloud {
                Section {
                    NavigationLink { SignInAdminView(api: api, myUserId: myUserId) } label: {
                        Label(L("Ways to sign in"), systemImage: "lock.shield")
                    }
                    if let on = showNames {
                        Toggle(isOn: Binding(get: { on }, set: { v in Task { await setShowNames(v) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Show names on the sign-in screen"))
                                Text(L("Handy at home: tap your name, type your password. Turn it off if the app is reachable from the internet – then everyone types their name."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                } header: { Text(L("Sign-in")) }
            }
            Section {
                NavigationLink { KnowledgeView(api: api) } label: { Label(L("What ToHuus remembers"), systemImage: "brain") }
            } footer: {
                if !isAdmin && loaded { Text(L("Only admins can invite people or change who belongs to the household.")) }
            }
        }
        .themedList()
        .navigationTitle(L("Our household"))
        .navigationDestination(item: $open) { p in personView(p) }
        .toolbar {
            if isAdmin && !viewerIsGuest {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { addChild = true } label: { Label(L("Add a child"), systemImage: "figure.and.child.holdinghands") }
                        Button { addGuest = true } label: { Label(L("Add a permanent guest"), systemImage: "person.crop.circle.badge.clock") }
                        if !app.isCloud {
                            Button { addPassword = true } label: { Label(L("Add with a password instead"), systemImage: "key") }
                        }
                    } label: { Label(L("Add"), systemImage: "plus") }
                }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $addChild) { AddChildSheet(api: api) { key in Task { await created(key) } } }
        .sheet(isPresented: $addGuest) { AddGuestSheet(api: api) { key in Task { await created(key) } } }
        .sheet(isPresented: $addPassword) {
            AddWithPasswordSheet(api: api) {
                toast = ToastMessage(text: L("Saved"))
                Task { await load() }
            }
        }
        .toast($toast)
    }

    private var groups: [(String, [Person])] {
        let word = form == "family" ? L("Family") : form == "shared" ? L("Flat share") : L("Household")
        return [(word, people.filter { $0.kind == "member" }),
                (L("Children"), people.filter { $0.kind == "child" }),
                (L("Permanent guests"), people.filter { $0.kind == "guest" })].filter { !$0.1.isEmpty }
    }

    private func personView(_ p: Person) -> some View {
        PersonAdminView(api: api, person: p, isMe: p.key == myKey, isAdmin: isAdmin, viewerIsGuest: viewerIsGuest) {
            Task { await load() }
        }
    }

    private func personRow(_ p: Person) -> some View {
        HStack(spacing: Theme.Space.s3) {
            AvatarView(name: p.name, color: p.color, face: p.face, size: 44, api: api)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.name + (p.key == myKey ? " · " + L("you") : "")).font(.body).foregroundStyle(Theme.ink)
                Text(PeopleText.kindLabel(p)).font(.caption).foregroundStyle(Theme.ink3)
                if let g = p.guestAccess, g.hasOverride {
                    Label(LF("until %@", PeopleText.when(g.overrideUntil)), systemImage: "clock")
                        .font(.caption).foregroundStyle(Theme.info)
                }
                if let a = p.prefs?.allergies, !a.isEmpty {
                    StatusPill(text: a.prefix(2).joined(separator: ", "), status: "low")
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
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
        if isAdmin && !app.isCloud && showNames == nil { showNames = try? await api.showNamesOnLogin() }
        await PeopleDirectory.shared.load(api, force: true)
    }

    private func created(_ key: String?) async {
        await load()
        if let key, let p = people.first(where: { $0.key == key }) { open = p }
    }

    private func setShowNames(_ on: Bool) async {
        do {
            try await api.setShowNamesOnLogin(on)
            showNames = on
            toast = ToastMessage(text: L("Saved"))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

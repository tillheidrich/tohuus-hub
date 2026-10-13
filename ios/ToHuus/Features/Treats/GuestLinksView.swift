import SwiftUI

/// Links for visitors, babysitters and grandparents (web: Bar.tsx `Links`, Order.tsx "Gäste"): no app, no account.
/// Guests ask for what is on the guest menu, find things in shared places and add to the list if allowed – they
/// never see quantities or purchases. Tokens are stored hashed: a link's URL is shown only right after creating it
/// (or after "new link").
struct GuestLinksView: View {
    let api: APIClient
    @State private var links: [GuestLink]?
    @State private var error: String?
    @State private var creating: GuestLinkDraft?
    @State private var shown: ShownLink?
    @State private var rotating: GuestLink?
    @State private var toast: ToastMessage?

    struct ShownLink: Identifiable { var name: String; var url: String; var expiresAt: String?; var id: String { url } }

    var body: some View {
        List {
            Section {
                Text(L("A link or QR code – no app, no account. Guests ask for what you put on the menu for guests, can find things in the places you share and add to the shopping list if you allow it. They never see quantities or purchases."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            Section {
                Button { creating = .babysitter } label: { Label(L("Babysitter"), systemImage: "figure.and.child.holdinghands") }
                Button { creating = .visitors } label: { Label(L("Visitors"), systemImage: "wineglass") }
                Button { creating = .grandparents } label: { Label(L("Grandparents"), systemImage: "heart") }
            } header: { Text(L("New link")) }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let links {
                if links.isEmpty {
                    EmptyStateView(art: .suitcase, title: L("No guest links yet"), message: L("Create one above – for an evening, a weekend or the holidays."))
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(links) { g in row(g) }
                    } header: { Text(L("Guest links")) } footer: { Text(L("Swipe to revoke a link.")) }
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
            Section {
                HelpLink(slug: "hausinfo", title: L("House info for guests and sitters"))
            }
        }
        .themedList()
        .navigationTitle(L("Guest links"))
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $creating) { d in
            GuestLinkForm(api: api, draft: d) { name, r in
                shown = ShownLink(name: name, url: r.url, expiresAt: nil)
                Task { await load() }
            }
        }
        .sheet(item: $shown) { s in
            GuestLinkShareSheet(name: s.name, url: s.url)
        }
        .confirmationDialog(rotating.map { LF("The current link for “%@” stops working. Create a new one?", $0.name) } ?? "",
                            isPresented: Binding(get: { rotating != nil }, set: { if !$0 { rotating = nil } }),
                            titleVisibility: .visible, presenting: rotating) { g in
            Button(L("New link")) { Task { await rotate(g) } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
        .task {
            #if DEBUG
            if creating == nil, UserDefaults.standard.string(forKey: "debugMore") == "guestlink-new" {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                creating = .babysitter
            }
            #endif
        }
    }

    private func row(_ g: GuestLink) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: g.scopes.contains("stock") ? "figure.and.child.holdinghands" : "wineglass")
                .foregroundStyle(Theme.primaryText)
                .frame(width: 36, height: 36)
                .background(Theme.primarySoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(g.name).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(g.scopes.map(Self.scopeLabel).joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink2)
                Text(expiry(g)).font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            Button { rotating = g } label: { Image(systemName: "qrcode") }
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel(L("New link with QR code"))
        }
        .swipeActions {
            Button(role: .destructive) { Task { await revoke(g) } } label: { Label(L("Revoke"), systemImage: "xmark") }
        }
        .accessibilityAction(named: L("Revoke")) { Task { await revoke(g) } }
    }

    static func scopeLabel(_ s: String) -> String {
        switch s {
        case "bar": return L("Ask for something")
        case "stock": return L("Where is what?")
        case "shopping": return L("Shopping list")
        default: return s
        }
    }

    private func expiry(_ g: GuestLink) -> String {
        guard let d = ServerDate.parse(g.expiresAt) else { return L("No expiry") }
        return d < Date() ? L("Expired") : LF("Valid until %@", d.formatted(.dateTime.day().month(.abbreviated).hour().minute()))
    }

    private func load() async {
        do { links = try await api.guestLinks(); error = nil }
        catch { self.error = APIError.from(error).localizedDescription }
    }

    private func rotate(_ g: GuestLink) async {
        do {
            let r = try await api.rotateGuestLink(g.id)
            shown = ShownLink(name: g.name, url: r.url, expiresAt: g.expiresAt)
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func revoke(_ g: GuestLink) async {
        do {
            try await api.revokeGuestLink(g.id)
            links?.removeAll { $0.id == g.id }
            toast = ToastMessage(text: LF("“%@” no longer works.", g.name))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Presets like the web's chips: visitors (2 days, ask), babysitter (1 day, ask + where is what + list),
/// grandparents (14 days, ask + where is what).
struct GuestLinkDraft: Identifiable, Hashable {
    var key: String
    var name: String
    var scopes: Set<String>
    var days: Int
    var allPlaces: Bool
    var id: String { key }

    static let visitors = GuestLinkDraft(key: "visit", name: L("Visit"), scopes: ["bar"], days: 2, allPlaces: false)
    static let babysitter = GuestLinkDraft(key: "sitter", name: L("Babysitter"), scopes: ["bar", "stock", "shopping"], days: 1, allPlaces: true)
    static let grandparents = GuestLinkDraft(key: "grand", name: L("Grandparents"), scopes: ["bar", "stock"], days: 14, allPlaces: true)
}

struct GuestLinkForm: View {
    let api: APIClient
    let draft: GuestLinkDraft
    let onCreated: (String, GuestLinkURL) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var scopes: Set<String> = []
    @State private var days = 2
    @State private var note = ""
    @State private var places: [Place] = []
    @State private var picked: Set<Int> = []
    @State private var busy = false
    @State private var error: String?
    @State private var confirmNoExpiry = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Name"), text: $name)
                } footer: { Text(L("Guests see this name, e.g. “Babysitter” or “Sam”.")) }
                Section {
                    ForEach(["bar", "stock", "shopping"], id: \.self) { s in
                        Toggle(GuestLinksView.scopeLabel(s), isOn: Binding(get: { scopes.contains(s) }, set: { on in
                            if on { scopes.insert(s) } else { scopes.remove(s) }
                        }))
                    }
                } header: { Text(L("What the link allows")) }
                if scopes.contains("stock") {
                    Section {
                        ForEach(places) { p in
                            Toggle(p.name, isOn: Binding(get: { picked.contains(p.id) }, set: { on in
                                if on { picked.insert(p.id) } else { picked.remove(p.id) }
                            }))
                        }
                    } header: { Text(L("Places they may look into")) } footer: { Text(L("Only what is where – never quantities.")) }
                }
                Section {
                    Stepper(value: $days, in: 0...365) {
                        Text(days == 0 ? L("No expiry") : days == 1 ? L("Valid for 1 day") : LF("Valid for %d days", days))
                    }
                    TextField(L("A note for them (optional)"), text: $note, axis: .vertical).lineLimit(2...5)
                } footer: {
                    Text(L("For the babysitter: the house info cards meant for sitter links show up on the link too. Codes stay hidden until they tap them."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("New guest link"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Create")) { if days == 0 { confirmNoExpiry = true } else { Task { await create() } } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || scopes.isEmpty || (scopes.contains("stock") && picked.isEmpty))
                }
            }
            .alert(L("A link without expiry keeps working until you revoke it – also if it is forwarded. Create it anyway?"), isPresented: $confirmNoExpiry) {
                Button(L("Create")) { Task { await create() } }
                Button(L("Cancel"), role: .cancel) {}
            }
            .task {
                name = draft.name
                scopes = draft.scopes
                days = draft.days
                places = ((try? await api.places()) ?? []).filter { $0.system != true && $0.kind != "unassigned" }
                if draft.allPlaces { picked = Set(places.map(\.id)) }
            }
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        do {
            let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
            let r = try await api.createGuestLink(name: name.trimmingCharacters(in: .whitespaces), scopes: ["bar", "stock", "shopping"].filter(scopes.contains),
                                                  locationIds: scopes.contains("stock") ? Array(picked) : [], days: days, note: n.isEmpty ? nil : n)
            dismiss()
            onCreated(name, r)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// The new guest link: QR code, share sheet, copy – shown only now.
struct GuestLinkShareSheet: View {
    let name: String
    let url: String
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Space.s4) {
                    if let qr = QRCode.image(url) {
                        Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                            .frame(width: 220, height: 220)
                            .padding(Theme.Space.s3)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .accessibilityLabel(L("QR code of the guest link"))
                    }
                    Text(url).font(.caption.monospaced()).foregroundStyle(Theme.ink3).multilineTextAlignment(.center).textSelection(.enabled)
                    ShareLink(item: url, subject: Text(name), message: Text(L("Here’s our house link – no app needed:"))) {
                        Label(L("Share link"), systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        UIPasteboard.general.string = url
                        copied = true
                    } label: { Label(copied ? L("Link copied") : L("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                        .buttonStyle(SecondaryButtonStyle())
                    Text(L("Scan with the phone, or send the link. It is shown only now – later you can create a new one."))
                        .font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
        }
    }
}

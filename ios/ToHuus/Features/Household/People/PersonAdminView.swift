import SwiftUI
import UIKit

/// One person (Haushalt › a person): picture (photo with square crop, initials or an animal) and colour, a child's name
/// and year of birth, allergies / dislikes / likes, a permanent guest's access (level and "for a while"), the sign-in
/// link, member ⇄ permanent guest, and removing. Web: people/People.tsx PersonSheet.
struct PersonAdminView: View {
    let api: APIClient
    let isMe: Bool
    let isAdmin: Bool
    /// the viewer is a permanent guest – they only edit themselves
    let viewerIsGuest: Bool
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var person: Person
    @State private var prefs = Person.Prefs()
    @State private var saved = Person.Prefs()
    @State private var pending: Person.Prefs?
    @State private var askConsent = false
    @State private var cropImage: CropImage?
    @State private var childName = ""
    @State private var childYear = ""
    @State private var loginLinkFor: Person?
    @State private var confirmKind = false
    @State private var confirmRemove = false
    @State private var toast: ToastMessage?
    @State private var busy = false

    init(api: APIClient, person: Person, isMe: Bool, isAdmin: Bool, viewerIsGuest: Bool, onChange: @escaping () -> Void) {
        self.api = api
        self.isMe = isMe
        self.isAdmin = isAdmin
        self.viewerIsGuest = viewerIsGuest
        self.onChange = onChange
        _person = State(initialValue: person)
    }

    private var canEdit: Bool { isMe || (!viewerIsGuest && (person.kind == "child" || isAdmin)) }

    var body: some View {
        Form {
            header
            if canEdit { pictureSection }
            if person.kind == "child" && isAdmin { childSection }
            foodSection
            // Haushaltswissen: sizes and other things about this person (KnowledgeView.swift)
            if person.kind != "guest" { KnowledgeSection(api: api, ref: person.key, name: person.name, canAdd: !viewerIsGuest) }
            if isAdmin && person.kind == "guest", let g = person.guestAccess {
                GuestAccessSections(api: api, person: person, access: g) { msg in
                    toast = ToastMessage(text: msg)
                    Task { await reload() }
                } failed: { toast = ToastMessage(text: $0, isError: true) }
            }
            if isAdmin && person.kind != "child" && !isMe { accessSection }
            if isAdmin && !isMe {
                Section {
                    Button(role: .destructive) { confirmRemove = true } label: {
                        Label(LF("Remove %@", person.name), systemImage: "trash")
                    }
                } footer: {
                    if person.kind == "child" { Text(L("Paired kid tablets stop working.")) }
                }
            }
        }
        .themedList()
        .navigationTitle(person.name)
        .navigationBarTitleDisplayMode(.inline)
        .disabled(busy)
        .onAppear { adopt(person) }
        .onChange(of: prefs) { _, p in
            guard canEdit, p != saved else { return }
            Task { await savePrefs(p, consent: false) }
        }
        .alert(L("Save allergies?"), isPresented: $askConsent) {
            Button(L("Not now"), role: .cancel) {
                prefs = saved
                pending = nil
            }
            Button(L("Save")) { if let p = pending { Task { await savePrefs(p, consent: true) } } }
        } message: {
            Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
        }
        .confirmationDialog(person.kind == "guest" ? L("Make family member") : L("Make permanent guest"), isPresented: $confirmKind, titleVisibility: .visible) {
            Button(person.kind == "guest" ? L("Make family member") : L("Make permanent guest")) { Task { await switchKind() } }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            Text(person.kind == "guest"
                 ? LF("Make %@ a family member? They can then use everything day to day.", person.name)
                 : LF("Make %@ a permanent guest? They keep their sign-in, but only see what you allow.", person.name))
        }
        .confirmationDialog(LF("Remove %@?", person.name), isPresented: $confirmRemove, titleVisibility: .visible) {
            Button(LF("Remove %@", person.name), role: .destructive) { Task { await remove() } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .sheet(item: $cropImage) { c in
            PhotoCropSheet(image: c.image) { jpeg in await uploadPhoto(jpeg) }
        }
        .sheet(item: $loginLinkFor) { p in LoginLinkSheet(api: api, person: p) }
        .toast($toast)
    }

    // MARK: sections

    private var header: some View {
        Section {
            HStack(spacing: Theme.Space.s4) {
                AvatarView(name: person.name, color: person.color, face: person.face, size: 64, api: api)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person.name).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(PeopleText.kindLabel(person) + (isMe ? " · " + L("you") : "")).font(.subheadline).foregroundStyle(Theme.ink3)
                    if let e = person.email, isAdmin { Text(e).font(.caption).foregroundStyle(Theme.ink3) }
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
            NavigationLink {
                PersonProfileView(api: api, personKey: person.key, name: person.name)
            } label: {
                Label(L("Likes, dislikes, most cooked"), systemImage: "heart")
            }
        }
    }

    private var pictureSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s3) {
                    PhotoSourceMenu(picked: { img in cropImage = CropImage(image: img) }) {
                        VStack(spacing: 4) {
                            Image(systemName: "camera").font(.title3)
                                .frame(width: 48, height: 48)
                                .background(Theme.surface2, in: Circle())
                            Text(L("Photo")).font(.caption2)
                        }
                        .foregroundStyle(Theme.ink)
                        .frame(minWidth: 52, minHeight: 64)
                    }
                    .accessibilityLabel(L("Take or choose a photo"))
                    pictureChoice(nil)
                    ForEach(AnimalArt.keys, id: \.self) { pictureChoice($0) }
                }
                .padding(.vertical, 4)
            }
            if person.face?.type == "photo" {
                Button(role: .destructive) { Task { await removePhoto() } } label: {
                    Label(L("Remove photo"), systemImage: "xmark.circle")
                }
            }
            HStack(spacing: Theme.Space.s2) {
                ForEach(PersonColors.all, id: \.self) { c in
                    Button { Task { await setColor(c) } } label: {
                        Circle().fill(Color(hexString: c) ?? .gray)
                            .frame(width: 30, height: 30)
                            .overlay(Circle().stroke(Theme.ink, lineWidth: person.color?.lowercased() == c ? 2.5 : 0).padding(-3))
                            .frame(width: 40, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(PeopleText.colorName(c))
                    .accessibilityAddTraits(person.color?.lowercased() == c ? .isSelected : [])
                }
            }
        } header: { Text(L("Picture")) } footer: {
            Text(L("Shows next to the name everywhere – shopping, orders, the week plan."))
        }
    }

    private var childSection: some View {
        Section {
            HStack {
                Text(L("Name")).foregroundStyle(Theme.ink2)
                TextField(L("e.g. Mika"), text: $childName)
                    .multilineTextAlignment(.trailing)
                    .submitLabel(.done)
                    .onSubmit { Task { await saveChild() } }
            }
            HStack {
                Text(L("Year of birth (optional)")).foregroundStyle(Theme.ink2)
                TextField("2021", text: $childYear)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .onChange(of: childYear) { _, v in
                        let digits = String(v.filter(\.isNumber).prefix(4))
                        if digits != v { childYear = digits }
                    }
            }
            if childChanged {
                Button(L("Save")) { Task { await saveChild() } }
                    .disabled(childName.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        } header: { Text(L("Child")) } footer: {
            Text(L("Children never get a login. You rate dishes for them and choose their picture; kid mode uses the same profile."))
        }
    }

    @ViewBuilder private var foodSection: some View {
        if canEdit, person.prefs != nil {
            Section {
                TagEditor(label: L("Allergies"), values: $prefs.allergies, placeholder: L("e.g. nuts"), tone: "low",
                          help: L("Dishes with these get a warning and are never planned automatically. “Nuts”, “milk”, “egg” or “gluten” also cover the usual ingredients."))
                TagEditor(label: L("Doesn’t like"), values: $prefs.dislikes, placeholder: L("e.g. mushrooms"),
                          help: L("Suggestions with these come a little later."))
                TagEditor(label: L("Likes"), values: $prefs.likes, placeholder: L("e.g. pasta"), tone: "good")
            } header: { Text(L("Food")) } footer: {
                Text(L("Allergies stay in your household. They only go to the assistant if you allow that in the settings."))
            }
        } else if let p = person.prefs, !p.allergies.isEmpty || !p.dislikes.isEmpty {
            Section(L("Food")) {
                if !p.allergies.isEmpty { LabeledContent(L("Allergies"), value: p.allergies.joined(separator: ", ")) }
                if !p.dislikes.isEmpty { LabeledContent(L("Doesn’t like"), value: p.dislikes.joined(separator: ", ")) }
            }
        }
    }

    private var accessSection: some View {
        Section {
            Button { loginLinkFor = person } label: { Label(L("Send login link"), systemImage: "link") }
            Button { confirmKind = true } label: {
                Label(person.kind == "guest" ? L("Make family member") : L("Make permanent guest"),
                      systemImage: person.kind == "guest" ? "person.2" : "person")
            }
        } header: { Text(L("Sign-in & access")) } footer: {
            Text(LF("%@ opens the link and is signed in on that device – no password. It works once and for 3 days.", person.name))
        }
    }

    private func pictureChoice(_ animal: String?) -> some View {
        let current = person.face
        let on = animal == nil ? (current?.type ?? "initials") == "initials" : current?.type == "animal" && current?.animal == animal
        let f = animal.map { PersonFace(type: "animal", animal: $0) } ?? .initials
        return Button {
            Task { await setFace(animal, f) }
        } label: {
            AvatarView(name: person.name, color: person.color, face: f, size: 48, api: api)
                .overlay(Circle().stroke(on ? Theme.primary : Color.clear, lineWidth: 3).padding(-3))
                .padding(3)
                .frame(minHeight: 64)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(animal.map { LF("Picture: %@", PeopleText.animalName($0)) } ?? L("Initials"))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    // MARK: actions

    private var childChanged: Bool {
        childName.trimmingCharacters(in: .whitespaces) != person.name || childYear != (person.birthYear.map(String.init) ?? "")
    }

    private func adopt(_ p: Person) {
        person = p
        prefs = p.prefs ?? Person.Prefs()
        saved = prefs
        childName = p.name
        childYear = p.birthYear.map(String.init) ?? ""
    }

    private func reload() async {
        onChange()
        guard let list = try? await api.people() else { return }
        if let p = list.first(where: { $0.key == person.key }) {
            person = p
            childName = p.name
            childYear = p.birthYear.map(String.init) ?? ""
        }
        await PeopleDirectory.shared.load(api, force: true)
    }

    private func run(_ work: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await work()
            await reload()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func setFace(_ animal: String?, _ f: PersonFace) async {
        await run {
            try await api.setFace(personKey: person.key, isMe: isMe, animal: animal)
            person.face = f
        }
    }

    private func setColor(_ c: String) async {
        await run {
            try await api.setPersonColor(person.key, isMe: isMe, color: c)
            person.color = c
        }
    }

    private func uploadPhoto(_ jpeg: Data) async -> Bool {
        do {
            try await api.uploadPersonPhoto(person.key, isMe: isMe, jpeg: jpeg)
            Haptics.success()
            await reload()
            return true
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            return false
        }
    }

    private func removePhoto() async {
        await run { try await api.deletePersonPhoto(person.key, isMe: isMe) }
    }

    private func saveChild() async {
        let n = childName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        let newName = n != person.name ? n : nil
        let year = Int(childYear)
        let yearChanged = year != person.birthYear
        guard newName != nil || yearChanged else { return }
        busy = true
        defer { busy = false }
        do {
            var body: [String: Any] = [:]
            if let newName { body["name"] = newName }
            if yearChanged { body["birth_year"] = year ?? NSNull() }
            try await api.updateChild(person.id, body)
            toast = ToastMessage(text: L("Saved"))
            await reload()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func savePrefs(_ p: Person.Prefs, consent: Bool) async {
        do {
            let r = try await api.setPrefs(personKey: person.key, isMe: isMe,
                                           likes: p.likes != saved.likes ? p.likes : nil,
                                           dislikes: p.dislikes != saved.dislikes ? p.dislikes : nil,
                                           allergies: p.allergies != saved.allergies ? p.allergies : nil,
                                           consent: consent)
            switch r {
            case .saved:
                saved = p
                pending = nil
                onChange()
            case .needsConsent:
                pending = p
                askConsent = true
            }
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            prefs = saved
        }
    }

    private func switchKind() async {
        await run { try await api.setPersonKind(person.id, kind: person.kind == "guest" ? "member" : "guest") }
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do {
            if person.kind == "child" { try await api.removeChild(person.id) } else { try await api.removeMember(person.id) }
            onChange()
            await PeopleDirectory.shared.load(api, force: true)
            dismiss()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// A picked photo waiting for the crop sheet.
struct CropImage: Identifiable {
    let id = UUID()
    let image: UIImage
}

/// Small texts shared by the people screens.
enum PeopleText {
    static func kindLabel(_ p: Person) -> String {
        switch p.kind {
        case "child": return p.birthYear.map { LF("Child · born %d", $0) } ?? L("Child")
        case "guest": return LF("Guest · %@", GuestLevels.title(p.guestAccess?.level ?? "order"))
        default: return p.role == "admin" ? L("Admin") : L("Member")
        }
    }

    static func animalName(_ k: String) -> String {
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

    static func colorName(_ hex: String) -> String {
        switch hex.lowercased() {
        case "#2f5bea", "#4f8fd8": return L("Blue")
        case "#d0603a", "#e8742c": return L("Orange")
        case "#1d9a63", "#2fa58a", "#5cb85c": return L("Green")
        case "#8e44ad", "#8e5bb8": return L("Purple")
        case "#c2185b", "#d0608f": return L("Pink")
        case "#b97c0c", "#f2a33a": return L("Amber")
        case "#e2483d": return L("Red")
        case "#0f8a8a": return L("Teal")
        default: return hex
        }
    }

    /// "Sa., 18. Okt., 20:00"
    static func when(_ s: String?) -> String {
        guard let d = ServerDate.parse(s) else { return s ?? "" }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute())
    }
}

/// Likes, dislikes and the most cooked dishes of one person (web: people/Ratings.tsx PersonProfileSheet).
struct PersonProfileView: View {
    let api: APIClient
    let personKey: String
    let name: String
    @State private var profile: PersonProfile?
    @State private var tab = 0
    @State private var error: String?

    var body: some View {
        List {
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let p = profile {
                if let prefs = p.person?.prefs, !(prefs.allergies.isEmpty && prefs.likes.isEmpty && prefs.dislikes.isEmpty) {
                    Section {
                        if !prefs.allergies.isEmpty { LabeledContent(L("Allergies"), value: prefs.allergies.joined(separator: ", ")) }
                        if !prefs.likes.isEmpty { LabeledContent(L("Likes"), value: prefs.likes.joined(separator: ", ")) }
                        if !prefs.dislikes.isEmpty { LabeledContent(L("Doesn’t like"), value: prefs.dislikes.joined(separator: ", ")) }
                    }
                }
                Section {
                    Picker(L("Show"), selection: $tab) {
                        Text("\(L("Likes")) · \(p.likes.count)").tag(0)
                        Text("\(L("Not for them")) · \(p.dislikes.count)").tag(1)
                        Text(L("Most cooked")).tag(2)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    let list = tab == 0 ? p.likes : tab == 1 ? p.dislikes : p.mostCooked
                    if list.isEmpty {
                        Text(tab == 0 ? L("Nothing rated as loved yet.") : tab == 1 ? L("Nothing they don’t like – so far.") : L("Counts once you tap a rating after cooking."))
                            .font(.subheadline).foregroundStyle(Theme.ink3)
                    }
                    ForEach(list) { d in
                        HStack(spacing: Theme.Space.s3) {
                            if let path = d.imagePath {
                                RemoteImage(url: api.imageURL(path), api: api, placeholder: "fork.knife")
                                    .frame(width: 40, height: 40)
                                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                                    .accessibilityHidden(true)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(d.title).foregroundStyle(Theme.ink)
                                if let m = d.meals, m > 0 {
                                    Text(m == 1 ? L("eaten once") : LF("eaten %d×", m)).font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                            Spacer()
                            if let v = d.value { Text(String(repeating: "★", count: max(0, min(5, v)))).font(.caption).foregroundStyle(Theme.mustard).accessibilityLabel(LF("%d of 5", v)) }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            } else if error == nil {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            profile = try await api.personProfile(personKey)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

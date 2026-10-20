import PhotosUI
import SwiftUI

/// One row of the list (web: Shopping.tsx ItemSheet + shop/ItemEditor.tsx): name and quantity, who takes care of it,
/// note, substitute rule, photo, where to buy, who sees it. Everything except "who takes care" is saved with "Save".
struct ItemDetailSheet: View {
    let item: ShopItem
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var qty = 1
    @State private var note = ""
    @State private var substitute = "unset"
    @State private var photo: PhotosPickerItem?
    @State private var photoMissing = false
    @State private var busy = false
    @State private var error: String?
    // who takes care of it
    @State private var me: MeLite?
    @State private var members: [Member] = []
    @State private var claimUser: Int?
    @State private var ownerId: Int?
    // where to buy
    @State private var stores: [String] = []
    @State private var buyAtSuggestions: BuyAtSuggestions?
    // who sees it
    @State private var visibility: RowVisibility = .all
    @State private var shareWith: Set<Int> = []
    @State private var reveal = false
    @State private var placeholder = ""

    private var hidden: Bool { item.share != nil }
    private var foreignHidden: Bool { item.share.map { !$0.isMine && $0.owner != nil } ?? false }
    private var canEdit: Bool { item.id > 0 }

    var body: some View {
        NavigationStack {
            Form {
                headerSection
                if canEdit && (me?.claimsOn ?? true) && !members.isEmpty { claimSection }
                if canEdit && !item.isChecked { placeSection }
                if canEdit && ownerOffered { ownerSection }
                Section(L("Note")) {
                    TextField(L("e.g. the big pack, ripe ones, for Sunday"), text: $note, axis: .vertical)
                        .lineLimit(1...3)
                }
                Section {
                    Picker(L("If it's not there"), selection: $substitute) {
                        Text(L("Not set")).tag("unset")
                        Text(L("Exactly this one")).tag("exact")
                        Text(L("Substitute is fine")).tag("ok")
                        Text(L("Ask first")).tag("ask")
                    }
                } header: {
                    Text(L("Substitute"))
                } footer: {
                    Text(L("A wish like “rather oat milk” goes into the note."))
                }
                if canEdit && !hidden { ExtraToggleSection(api: store.api, item: item) { Task { await store.refreshList() } } }
                photoSection
                if canEdit {
                    Section {
                        BuyAtEditor(stores: $stores, suggestions: buyAtSuggestions)
                    } header: {
                        Label(L("Where to buy?"), systemImage: "storefront")
                    } footer: {
                        Text(item.productId != nil ? L("Saved on the product, so it's there next time too.")
                             : L("Only you decide this – the app never fills it in. Leave it empty if it doesn't matter."))
                    }
                }
                if canEdit && me?.isMember == true { privacySection }
                if let last = lastBoughtLine {
                    Section(L("Last bought")) { Text(last).font(.subheadline).foregroundStyle(Theme.ink2) }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                Section {
                    Button(role: .destructive) {
                        Task { await store.delete(item); dismiss() }
                    } label: {
                        Label(L("Remove from the list"), systemImage: "trash")
                    }
                }
            }
            .themedList()
            .navigationTitle(L("Details"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(busy || !canEdit)
                }
            }
            .onAppear(perform: fill)
            .task { await loadExtras() }
            .onChange(of: photo) { _, p in
                guard let p else { return }
                Task { await upload(p) }
            }
        }
        .presentationDetents([.large])
    }

    // MARK: sections

    /// rows of the same aisle (for "up / down") and the lists to move to
    private var siblings: [ShopItem] { store.list.sections.first { $0.items.contains { $0.id == item.id } }?.items ?? [] }
    private var otherLists: [ListRef] { store.list.lists }
    /// WG: "Für wen?" – shared or one person (only with at least two people, like the web)
    private var ownerOffered: Bool {
        (me?.home?["form"]?.string == "shared" || item.owner != nil) && members.filter { $0.kind != "guest" }.count >= 2
    }

    /// aisle, order inside the aisle and list (the menu way for what drag & drop does on the web)
    @ViewBuilder private var placeSection: some View {
        Section {
            ShopChipFlow {
                ForEach(ShopSectionKey.all, id: \.self) { key in
                    ShopToggleChip(title: ShopSectionKey.label(key), systemImage: ShopSectionKey.icon(key), on: (item.section ?? "other") == key) {
                        guard (item.section ?? "other") != key else { return }
                        Task { await place(section: key) }
                    }
                }
            }
            .padding(.vertical, 4)
            if siblings.count > 1, let k = siblings.firstIndex(where: { $0.id == item.id }) {
                HStack {
                    Text(L("Order in the aisle")).font(.subheadline)
                    Spacer()
                    Button { Task { await place(neighbor: siblings[k - 1].id, after: false) } } label: {
                        Label(L("Up"), systemImage: "arrow.up")
                    }
                    .disabled(k == 0)
                    Button { Task { await place(neighbor: siblings[k + 1].id, after: true) } } label: {
                        Label(L("Down"), systemImage: "arrow.down")
                    }
                    .disabled(k == siblings.count - 1)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            if otherLists.count > 1 {
                Picker(L("On which list?"), selection: Binding(get: { item.listId ?? 0 }, set: { id in Task { await moveList(id) } })) {
                    ForEach(otherLists) { l in Text(l.name).tag(l.id.int ?? 0) }
                }
            }
        } header: {
            Label(L("Aisle"), systemImage: "square.grid.2x2")
        } footer: {
            Text(L("Remembered for next time."))
        }
    }

    private var ownerSection: some View {
        Section {
            ShopChipFlow {
                ShopToggleChip(title: L("Shared"), on: ownerId == nil) { Task { await setOwner(nil) } }
                ForEach(members.filter { $0.kind != "guest" }) { m in
                    ShopToggleChip(title: m.id == me?.userId ? L("Me") : m.name, on: ownerId == m.id) { Task { await setOwner(m.id) } }
                }
            }
            .padding(.vertical, 4)
        } header: {
            Label(L("For whom?"), systemImage: "person")
        } footer: {
            Text(L("A row for one person counts for them on the receipt, not for everyone."))
        }
    }

    private var headerSection: some View {
        Section {
            if hidden {
                HStack(spacing: 8) {
                    Image(systemName: item.share?.icon ?? "eye.slash").foregroundStyle(Theme.ink3)
                    Text(item.productName ?? item.text).font(.headline)
                }
            } else {
                TextField(L("Name on the list"), text: $name)
                    .font(.headline)
                    .disabled(!canEdit)
            }
            Stepper(value: $qty, in: 1...99) {
                HStack {
                    Text(L("How many"))
                    Spacer()
                    Text("\(qty)").font(.headline).monospacedDigit().foregroundStyle(Theme.primaryText)
                }
            }
            .disabled(!canEdit)
            Text(item.originLine).font(.footnote).foregroundStyle(Theme.ink3)
        }
    }

    private var claimSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(members) { m in
                        let on = claimUser == m.id
                        Button {
                            Task { await setClaim(on ? nil : m.id) }
                        } label: {
                            VStack(spacing: 4) {
                                ShopMemberDot(name: m.name, color: m.color, size: 40)
                                    .overlay(Circle().stroke(on ? Theme.primary : Color.clear, lineWidth: 3).padding(-4))
                                Text(m.id == me?.userId ? L("Me") : m.name)
                                    .font(.caption.weight(on ? .semibold : .regular))
                                    .foregroundStyle(on ? Theme.primaryText : Theme.ink2)
                                    .lineLimit(1)
                            }
                            .frame(minWidth: 56, minHeight: 64)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(m.id == me?.userId ? L("Me") : m.name)
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .disabled(busy)
                    }
                }
                .padding(.vertical, 6)
            }
        } header: {
            Label(L("Who takes care of it?"), systemImage: "person.crop.circle")
        } footer: {
            Text(L("Just so nobody buys it twice. No points, no ranking."))
        }
    }

    @ViewBuilder private var photoSection: some View {
        Section {
            if let p = item.photoPath {
                RemoteImage(url: store.api.imageURL(p), api: store.api)
                    .frame(height: 160)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
            }
            if canEdit {
                PhotosPicker(selection: $photo, matching: .images) {
                    Label(item.photoPath == nil ? L("Add a photo of the product") : L("Replace the photo"), systemImage: "camera")
                }
                if item.photoPath != nil {
                    Button(L("Remove the photo"), role: .destructive) {
                        Task {
                            try? await store.api.deleteItemPhoto(item.id)
                            await store.refreshList()
                            dismiss()
                        }
                    }
                }
            }
            if photoMissing {
                Text(L("Your server can't keep photos for list rows yet.")).font(.footnote).foregroundStyle(Theme.ink3)
            }
        } header: {
            Text(L("Photo"))
        } footer: {
            Text(L("So whoever shops picks the right one."))
        }
    }

    @ViewBuilder private var privacySection: some View {
        Section {
            if foreignHidden, let s = item.share {
                Label {
                    Text(foreignNote(s)).font(.subheadline)
                } icon: {
                    Image(systemName: s.icon).foregroundStyle(Theme.ink3)
                }
            } else {
                Picker(L("Who sees it?"), selection: $visibility) {
                    ForEach(RowVisibility.allCases) { v in Text(v.title).tag(v) }
                }
                .pickerStyle(.segmented)
                Text(visibility.explanation).font(.footnote).foregroundStyle(Theme.ink2)
                if visibility == .private {
                    let others = members.filter { $0.id != me?.userId }
                    if !others.isEmpty {
                        Text(L("Also visible to (optional):")).font(.footnote).foregroundStyle(Theme.ink3)
                        ShopChipFlow {
                            ForEach(others) { m in
                                ShopToggleChip(title: m.name, on: shareWith.contains(m.id)) {
                                    if shareWith.contains(m.id) { shareWith.remove(m.id) } else { shareWith.insert(m.id) }
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                if visibility == .discreet {
                    TextField(L("What others see, e.g. “Drugstore item”"), text: $placeholder)
                    Toggle(isOn: $reveal) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Show to whoever shops"))
                            Text(L("The person in the shop, or who said “I'll get it”, sees the real name."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
        } header: {
            Label(L("Who sees it?"), systemImage: "eye.slash")
        } footer: {
            if visibility != .all && !foreignHidden {
                Text(L("Never shown in Home Assistant, Telegram, displays, printed lists, guest links or to assistants."))
            }
        }
    }

    private func foreignNote(_ s: ShareInfo) -> String {
        let owner = s.owner ?? ""
        if s.isPrivate { return LF("%@ shared this with you. Only %@ can change who sees it.", owner, owner) }
        if s.revealed == true { return LF("%@ added this discreetly and lets whoever shops see it. Please keep it to yourself.", owner) }
        return L("Added discreetly. You can still tick it off when it's bought.")
    }

    private var lastBoughtLine: String? {
        guard let l = item.lastBought else { return nil }
        let parts: [String?] = [l.name, l.size, l.shop, l.price.map { Money.format($0) }, ServerDate.shortDay(l.day)]
        let s = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        return s.isEmpty ? nil : s
    }

    // MARK: data

    private func fill() {
        name = item.text
        qty = max(1, Int((item.qty ?? 1).rounded()))
        note = item.note ?? ""
        substitute = item.substitute ?? "unset"
        claimUser = item.claim?.userId
        ownerId = item.owner?.id
        stores = item.buyAt ?? []
        if let s = item.share {
            visibility = s.isPrivate ? .private : .discreet
            shareWith = Set(s.shareWith ?? [])
            reveal = s.reveal ?? false
            placeholder = s.placeholder ?? ""
        }
    }

    private func loadExtras() async {
        let api = store.api
        async let m = try? api.meLite()
        async let mem = try? api.members()
        async let sug = try? api.buyAtSuggestions()
        me = await m
        members = await mem ?? []
        buyAtSuggestions = await sug
    }

    private func setOwner(_ userId: Int?) async {
        let before = ownerId
        ownerId = userId
        Haptics.tick()
        do {
            try await store.api.setItemOwner(item.id, userId: userId)
            store.touch("shopping")
            await store.refreshList()
        } catch {
            ownerId = before
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func place(section: String? = nil, neighbor: Int? = nil, after: Bool? = nil) async {
        do {
            if let section {
                try await store.api.moveItem(item.id, section: section)
            } else {
                try await store.api.placeItem(item.id, neighborId: neighbor, after: after)
            }
            Haptics.tick()
            store.touch("shopping")
            await store.refreshList()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func moveList(_ id: Int) async {
        guard id != (item.listId ?? 0) else { return }
        do {
            try await store.api.moveItemToList(item.id, listId: id)
            Haptics.tick()
            await store.refreshList()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func setClaim(_ userId: Int?) async {
        let before = claimUser
        claimUser = userId
        Haptics.tick()
        do {
            if let userId {
                try await store.api.claimItem(item.id, on: true, userId: userId == me?.userId ? nil : userId)
            } else {
                try await store.api.claimItem(item.id, on: false)
            }
            store.touch("shopping")
            await store.refreshList()
        } catch {
            claimUser = before
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let n = name.trimmingCharacters(in: .whitespaces)
            let newNote = note.trimmingCharacters(in: .whitespaces)
            let newSub: String? = substitute == "unset" ? nil : substitute
            let oldQty = max(1, Int((item.qty ?? 1).rounded()))
            try await store.api.patchItem(
                item.id,
                text: !hidden && !n.isEmpty && n != item.text ? n : nil,
                qty: qty != oldQty ? .some(qty == 1 ? nil : Double(qty)) : nil,
                note: newNote != (item.note ?? "") ? .some(newNote.isEmpty ? nil : newNote) : nil,
                substitute: newSub != item.substitute ? .some(newSub) : nil
            )
            if stores != (item.buyAt ?? []) { try await store.api.setItemBuyAt(item.id, stores: stores) }
            if me?.isMember == true && !foreignHidden && privacyDirty {
                let p = placeholder.trimmingCharacters(in: .whitespaces)
                try await store.api.setItemPrivacy(item.id, visibility: visibility, shareWith: Array(shareWith), reveal: reveal,
                                                   placeholder: p.isEmpty ? nil : p)
            }
            store.touch("shopping")
            await store.refreshList()
            Haptics.success()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private var privacyDirty: Bool {
        let s = item.share
        let was: RowVisibility = s == nil ? .all : (s!.isPrivate ? .private : .discreet)
        if visibility != was { return true }
        if visibility == .private { return shareWith != Set(s?.shareWith ?? []) }
        if visibility == .discreet {
            let p = placeholder.trimmingCharacters(in: .whitespaces)
            return reveal != (s?.reveal ?? false) || (!p.isEmpty && p != (s?.placeholder ?? ""))
        }
        return false
    }

    private func upload(_ p: PhotosPickerItem) async {
        guard let data = try? await p.loadTransferable(type: Data.self),
              let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.7) else { return }
        busy = true
        defer { busy = false }
        do {
            try await store.api.uploadItemPhoto(item.id, jpeg: jpeg)
            await store.refreshList()
        } catch APIError.notFound {
            photoMissing = true
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

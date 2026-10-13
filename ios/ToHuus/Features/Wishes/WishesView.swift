import PhotosUI
import SwiftUI
import UIKit

// Einkauf › Wünsche (13 Oct 2026, web: web/src/pages/Wishes.tsx): wish lists and the Merkliste with photos, links,
// prices, "wer könnte das schenken", reservations (never shown to the person a list is for – the server leaves them
// out, the app follows `canReserve`), "auf die Einkaufsliste" and sharing as a message (share sheet, copy, e-mail).

private func priceText(_ p: Double?, fromLinks: Bool?) -> String? {
    guard let p else { return nil }
    let s = p.formatted(.currency(code: Locale.current.currency?.identifier ?? "EUR"))
    return fromLinks == true ? LF("from %@", s) : s
}

private func priorityLabel(_ p: Int) -> String {
    switch p {
    case 1: return L("Nice to have")
    case 3: return L("Really wants")
    default: return L("Would like")
    }
}

// MARK: - overview

struct WishesView: View {
    let api: APIClient
    @State private var lists: [WishList] = []
    @State private var archived = false
    @State private var query = ""
    @State private var results: [Wish] = []
    @State private var loading = true
    @State private var creating = false
    @State private var error: String?
    @State private var path: [Int] = []

    var body: some View {
        List {
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section(L("Search results")) {
                    if results.isEmpty { Text(L("Nothing found.")).foregroundStyle(Theme.ink3) }
                    ForEach(results) { w in
                        NavigationLink(value: w.listId) {
                            HStack(spacing: 12) {
                                WishThumb(path: w.photoPath, title: w.title, api: api, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(w.title).font(.body.weight(.semibold))
                                    Text([w.listName, priceText(w.price, fromLinks: w.priceFromLinks)].compactMap { $0 }.joined(separator: " · "))
                                        .font(.footnote).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                    }
                }
            } else {
                Section {
                    Text(L("What someone wishes for, or what you want to remember – with photo, links and price. Who reserved what stays hidden from the person it is for."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                        .listRowBackground(Color.clear)
                }
                if lists.isEmpty && !loading && error == nil {
                    EmptyStateView(systemImage: "gift", title: archived ? L("Nothing archived") : L("No wish lists yet"),
                                   message: archived ? nil : L("For example “Wishes from Mika”, “Christmas for Mum” or a Merkliste for biscuits you saw in an article."),
                                   actionTitle: archived ? nil : L("New list"), action: archived ? nil : { creating = true })
                        .listRowBackground(Color.clear)
                }
                ForEach(lists) { l in
                    NavigationLink(value: l.id) { WishListRow(list: l, api: api) }
                }
                Section {
                    Button(archived ? L("Back to current lists") : L("Archived lists")) {
                        archived.toggle()
                        Task { await load() }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(Theme.empty) }
        }
        .navigationTitle(L("Wishes"))
        .searchable(text: $query, prompt: L("Search all wishes"))
        .task(id: query) { await search() }
        .navigationDestination(for: Int.self) { id in WishListDetailView(api: api, listId: id) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label(L("New list"), systemImage: "plus") }
            }
        }
        .sheet(isPresented: $creating) {
            WishListEditSheet(api: api, list: nil) { _ in Task { await load() } }
        }
        .refreshable { await load() }
        .task { await load() }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        defer { loading = false }
        do { lists = try await api.wishLists(archived: archived); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; return }
        try? await Task.sleep(for: .milliseconds(250))
        results = (try? await api.searchWishes(q)) ?? []
    }
}

private struct WishListRow: View {
    let list: WishList
    let api: APIClient

    var body: some View {
        HStack(spacing: 12) {
            WishThumb(path: list.photos?.first, title: list.name, api: api, size: 52, symbol: "gift")
            VStack(alignment: .leading, spacing: 4) {
                Text(list.name).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                Text([list.forName.map { LF("for %@", $0) } ?? L("Saved for later"), list.count == 1 ? L("1 wish") : LF("%d wishes", list.count ?? 0)].joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Theme.ink2)
                HStack(spacing: 6) {
                    if let sym = visibilitySymbol(list.visibility) {
                        Badge(text: visibilityLabel(list.visibility, shareWith: list.shareWith, owner: list.owner, mine: list.mine), symbol: sym)
                    }
                    if list.forMe == true { Badge(text: L("Your list"), symbol: nil) }
                    if list.reservable, (list.reserved ?? 0) + (list.bought ?? 0) > 0 {
                        Badge(text: LF("%d taken", (list.reserved ?? 0) + (list.bought ?? 0)), symbol: "gift")
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct Badge: View {
    let text: String
    let symbol: String?
    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).font(.caption2) }
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 4))
        .foregroundStyle(Theme.ink2)
    }
}

/// Photo with an arch top (Dutch Detail), or a calm placeholder.
struct WishThumb: View {
    let path: String?
    let title: String
    let api: APIClient
    var size: CGFloat = 64
    var symbol = "gift"

    var body: some View {
        Group {
            if let path, !path.isEmpty {
                RemoteImage(url: api.imageURL(path), api: api, placeholder: symbol)
            } else {
                ZStack {
                    Theme.sand
                    Image(systemName: symbol).foregroundStyle(Theme.ink2)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: size / 2, bottomLeadingRadius: 6, bottomTrailingRadius: 6, topTrailingRadius: size / 2))
        .accessibilityHidden(true)
    }
}

// MARK: - one list

struct WishListDetailView: View {
    let api: APIClient
    let listId: Int
    @Environment(\.dismiss) private var dismiss
    @State private var detail: WishListDetail?
    @State private var sort = "manual"
    @State private var archived = false
    @State private var quick = ""
    @State private var editing: Wish?
    @State private var creating = false
    @State private var editList = false
    @State private var selecting = false
    @State private var picked: Set<Int> = []
    @State private var sharing = false
    @State private var toList: Wish?
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        List {
            if let l = detail?.list {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(l.forName.map { LF("for %@", $0) } ?? L("Saved for later")).foregroundStyle(Theme.ink2)
                        HStack(spacing: 6) {
                            if let sym = visibilitySymbol(l.visibility) { Badge(text: visibilityLabel(l.visibility, shareWith: l.shareWith, owner: l.owner, mine: l.mine), symbol: sym) }
                            if l.forMe == true { Badge(text: L("Your list – reservations stay a surprise"), symbol: nil) }
                        }
                    }
                    .listRowBackground(Color.clear)
                    HStack {
                        TextField(l.forName.map { LF("What does %@ wish for?", $0) } ?? L("What do you want to remember?"), text: $quick)
                            .submitLabel(.done)
                            .onSubmit { Task { await addQuick() } }
                        Button { if quick.trimmingCharacters(in: .whitespaces).isEmpty { creating = true } else { Task { await addQuick() } } } label: {
                            Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Theme.primary)
                        }
                        .accessibilityLabel(L("Add"))
                        .frame(minWidth: 44, minHeight: 44)
                    }
                }
                if (detail?.items.count ?? 0) > 1 {
                    Picker(L("Sort"), selection: $sort) {
                        Text(L("Own order")).tag("manual")
                        Text(L("Priority")).tag("priority")
                        Text(L("Price")).tag("price")
                        Text(L("Newest")).tag("newest")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
                if selecting {
                    Text(L("Pick the wishes to share – or share all.")).font(.footnote).foregroundStyle(Theme.ink3)
                }
                if detail?.items.isEmpty == true {
                    EmptyStateView(systemImage: "heart", title: archived ? L("Nothing archived") : L("No wishes yet"),
                                   message: archived ? nil : L("Add a wish with a photo, one or more links (shop, price comparison) and a price."),
                                   actionTitle: archived ? nil : L("With photo and links"), action: archived ? nil : { creating = true })
                        .listRowBackground(Color.clear)
                }
                ForEach(detail?.items ?? []) { w in
                    WishRowView(wish: w, list: l, api: api, selecting: selecting, picked: picked.contains(w.id),
                                onPick: { if picked.contains(w.id) { picked.remove(w.id) } else { picked.insert(w.id) } },
                                onOpen: { editing = w },
                                onStatus: { s in Task { await setStatus(w, s) } },
                                onToList: { toList = w })
                }
                Section {
                    Button(archived ? L("Back to current wishes") : L("Archived wishes")) { archived.toggle(); Task { await load() } }
                }
            }
            if let error { Text(error).foregroundStyle(Theme.empty) }
        }
        .navigationTitle(detail?.list.name ?? "")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if selecting {
                    Button(picked.isEmpty ? LF("Share %d", detail?.items.count ?? 0) : LF("Share %d", picked.count)) { sharing = true }
                } else {
                    Menu {
                        Button { selecting = true; picked = [] } label: { Label(L("Share"), systemImage: "square.and.arrow.up") }
                        Button { creating = true } label: { Label(L("With photo and links"), systemImage: "camera") }
                        Button { editList = true } label: { Label(L("Edit list"), systemImage: "pencil") }
                        Button { Task { await archiveList() } } label: { Label(detail?.list.archived == true ? L("Restore") : L("Archive"), systemImage: "archivebox") }
                        if detail?.list.isOwner == true {
                            Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete"), systemImage: "trash") }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel(L("More"))
                }
            }
            if selecting {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { selecting = false } }
            }
        }
        .confirmationDialog(LF("Delete “%@” with all wishes?", detail?.list.name ?? ""), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { Task { await deleteList() } }
        }
        .sheet(item: $editing) { w in WishEditSheet(api: api, list: detail!.list, wish: w) { Task { await load() } } }
        .sheet(isPresented: $creating) { if let l = detail?.list { WishEditSheet(api: api, list: l, wish: nil) { Task { await load() } } } }
        .sheet(isPresented: $editList) { if let l = detail?.list { WishListEditSheet(api: api, list: l) { _ in Task { await load() } } } }
        .sheet(isPresented: $sharing, onDismiss: { selecting = false }) { if let l = detail?.list { WishShareSheet(api: api, list: l, itemIds: Array(picked)) } }
        .sheet(item: $toList) { w in WishToListSheet(api: api, wish: w, list: detail!.list) { Task { await load() } } }
        .refreshable { await load() }
        .task(id: "\(sort)-\(archived)") { await load() }
    }

    private func load() async {
        do { detail = try await api.wishList(listId, sort: sort, archived: archived); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func addQuick() async {
        let t = quick.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        do {
            try await api.saveWish(id: nil, listId: listId, body: try JSONSerialization.data(withJSONObject: ["title": t]))
            quick = ""
            Haptics.tick()
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func setStatus(_ w: Wish, _ s: String) async {
        do { try await api.setWishStatus(w.id, status: s); Haptics.tick(); await load() } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func archiveList() async {
        guard let l = detail?.list else { return }
        _ = try? await api.saveWishList(id: l.id, body: try JSONSerialization.data(withJSONObject: ["archived": !(l.archived ?? false)]))
        if l.archived != true { dismiss() } else { await load() }
    }
    private func deleteList() async {
        do { try await api.deleteWishList(listId); dismiss() } catch { self.error = APIError.from(error).localizedDescription }
    }
}

private struct WishRowView: View {
    let wish: Wish
    let list: WishList
    let api: APIClient
    let selecting: Bool
    let picked: Bool
    let onPick: () -> Void
    let onOpen: () -> Void
    let onStatus: (String) -> Void
    let onToList: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if selecting {
                Button(action: onPick) {
                    Image(systemName: picked ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(picked ? Theme.primary : Theme.ink3)
                }
                .buttonStyle(.plain)
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel(LF("Share “%@”", wish.title))
                .accessibilityAddTraits(picked ? .isSelected : [])
            }
            Button(action: onOpen) { WishThumb(path: wish.photoPath, title: wish.title, api: api, size: 64) }
                .buttonStyle(.plain)
                .accessibilityLabel(LF("Open “%@”", wish.title))
            VStack(alignment: .leading, spacing: 6) {
                Button(action: onOpen) {
                    Text(wish.title).font(.body.weight(.semibold)).foregroundStyle(wish.status == "bought" ? Theme.ink2 : Theme.ink)
                        .strikethrough(wish.status == "bought" && list.reservable)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                FlowLayout(spacing: 10) {
                    if let p = priceText(wish.price, fromLinks: wish.priceFromLinks) { Text(p).font(.subheadline.weight(.bold)) }
                    if wish.priority != 2 {
                        Label(priorityLabel(wish.priority), systemImage: wish.priority == 3 ? "heart.fill" : "heart")
                            .font(.subheadline).foregroundStyle(wish.priority == 3 ? Theme.clay : Theme.ink2)
                    }
                    if let g = wish.giver { Text(LF("could give: %@", g.name)).font(.subheadline).foregroundStyle(Theme.ink2) }
                }
                if let n = wish.note, !n.isEmpty { Text(n).font(.subheadline).foregroundStyle(Theme.ink2) }
                if !wish.links.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(wish.links) { k in
                            Button { if let u = URL(string: k.url) { openURL(u) } } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "link").font(.caption)
                                    Text(k.display).font(.caption.weight(.semibold))
                                    if let p = k.price { Text("· " + (priceText(p, fromLinks: false) ?? "")).font(.caption).foregroundStyle(Theme.ink2) }
                                }
                                .padding(.horizontal, 10).frame(minHeight: 32)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.lineStrong, lineWidth: 1.5))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if list.reservable, wish.status != "open" {
                    let mine = wish.statusBy?.mine == true
                    let who = wish.statusBy?.name ?? "?"
                    Badge(text: wish.status == "reserved" ? (mine ? L("You reserved it") : LF("Reserved by %@", who)) : (mine ? L("You bought it") : LF("Bought by %@", who)),
                          symbol: wish.status == "reserved" ? "gift" : "checkmark")
                }
                if !selecting {
                    FlowLayout(spacing: 8) {
                        if list.reservable && wish.status == "open" {
                            Button { onStatus("reserved") } label: { Label(L("Reserve"), systemImage: "gift") }.buttonStyle(.bordered)
                        }
                        if list.reservable && wish.status == "reserved" && wish.statusBy?.mine == true {
                            Button { onStatus("bought") } label: { Label(L("Bought"), systemImage: "checkmark") }.buttonStyle(.bordered)
                            Button(L("Release")) { onStatus("open") }.buttonStyle(.borderless)
                        }
                        if list.reservable && wish.status == "bought" && wish.statusBy?.mine == true {
                            Button(L("Not bought after all")) { onStatus("open") }.buttonStyle(.borderless)
                        }
                        if wish.onShoppingList == true {
                            Label(L("on the shopping list"), systemImage: "basket").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                        } else {
                            Button(action: onToList) { Label(L("On the shopping list"), systemImage: "basket") }.buttonStyle(.borderless)
                        }
                    }
                    .controlSize(.regular)
                }
            }
        }
        .padding(.vertical, 6)
    }
}

// MARK: - onto the shopping list

private struct WishToListSheet: View {
    let api: APIClient
    let wish: Wish
    let list: WishList
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var lists: [ListRef] = []
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if list.forUserId != nil || list.visibility != "household" {
                    Text(LF("On the main list it goes on privately: %@ and anyone who doesn’t see this wish list won’t see it.", list.forName ?? L("the person it is for")))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
                ForEach(lists) { s in
                    Button {
                        Task { await go(s) }
                    } label: {
                        HStack {
                            if let sym = visibilitySymbol(s.visibility) { Image(systemName: sym).foregroundStyle(Theme.ink2) }
                            Text(s.name).foregroundStyle(Theme.ink)
                            Spacer()
                            if s.isPrivate { Text(visibilityLabel(s.visibility, shareWith: s.shareWith, owner: s.owner, mine: s.mine)).font(.footnote).foregroundStyle(Theme.ink3) }
                        }
                        .frame(minHeight: 44)
                    }
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(L("Onto which list?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task { lists = (try? await api.shopLists()) ?? [] }
        }
        .presentationDetents([.medium, .large])
    }

    private func go(_ s: ListRef) async {
        do {
            _ = try await api.wishToShopping(wish.id, listId: s.isMain ? nil : s.id.int)
            Haptics.tick()
            done()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - list sheet (new / edit)

struct WishListEditSheet: View {
    let api: APIClient
    let list: WishList?
    let saved: (WishList) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var forUser: Int?
    @State private var forName = ""
    @State private var visibility = "household"
    @State private var shareWith: [Int] = []
    @State private var members: [Member] = []
    @State private var meId: Int?
    @State private var error: String?
    @State private var busy = false

    private var owner: Bool { list == nil || list?.isOwner == true }
    private var people: [Member] { members.filter { $0.kind != "guest" } }

    var body: some View {
        NavigationStack {
            Form {
                if list == nil {
                    Section {
                        FlowLayout(spacing: 8) {
                            ForEach([L("Saved for later"), L("Christmas"), L("Birthday")], id: \.self) { p in
                                Button(p) { name = p }.buttonStyle(.bordered)
                            }
                        }
                    }
                }
                Section(L("Name")) { TextField(L("e.g. Wishes from Mika"), text: $name) }
                if owner {
                    Section(L("Who is it for?")) {
                        Picker(L("Who is it for?"), selection: $forUser) {
                            Text(L("Nobody in particular")).tag(Int?.none)
                            ForEach(people) { m in Text(m.id == meId ? L("Me") : m.name).tag(Int?.some(m.id)) }
                        }
                        if forUser == nil { TextField(L("or a name, e.g. Mum"), text: $forName) }
                    }
                    Section(L("Who sees it?")) {
                        VisibilityPicker(visibility: $visibility, shareWith: $shareWith, members: members, meId: meId,
                                         exclude: forUser.map { [$0] } ?? [],
                                         hint: forUser != nil && forUser != meId
                                            ? LF("%@ can see the wishes but never who reserved or bought what. To keep the whole list a surprise, pick “Only me” or chosen people.", people.first { $0.id == forUser }?.name ?? "")
                                            : nil)
                    }
                } else if let list {
                    Text(LF("%@ made this list. Only %@ can change who sees it.", list.owner ?? "?", list.owner ?? "?")).font(.footnote).foregroundStyle(Theme.ink3)
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(list == nil ? L("New wish list") : L("Edit list"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(list == nil ? L("Create list") : L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                name = list?.name ?? ""
                forUser = list?.forUserId
                forName = list?.forUserId == nil ? (list?.forName ?? "") : ""
                visibility = list?.visibility ?? "household"
                shareWith = list?.shareWith ?? []
                members = (try? await api.members()) ?? []
                meId = (try? await api.meLite())?.userId
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["name": name.trimmingCharacters(in: .whitespaces)]
        if owner {
            body["for_user_id"] = forUser.map { $0 as Any } ?? NSNull()
            let fn = forName.trimmingCharacters(in: .whitespaces)
            body["for_name"] = forUser == nil && !fn.isEmpty ? fn : NSNull()
            body["visibility"] = visibility
            body["share_with"] = shareWith.filter { $0 != forUser }
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            let l = try await api.saveWishList(id: list?.id, body: data)
            saved(l)
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - one wish (new / edit)

struct WishEditSheet: View {
    let api: APIClient
    let list: WishList
    let wish: Wish?
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var note = ""
    @State private var price = ""
    @State private var priority = 2
    @State private var giverId: Int?
    @State private var giverName = ""
    @State private var links: [WishLinkDraft] = []
    @State private var photo: UIImage?
    @State private var members: [Member] = []
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false

    private func num(_ s: String) -> Any {
        let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        return t.isEmpty ? NSNull() : (Double(t).map { $0 as Any } ?? NSNull())
    }
    private func fmt(_ d: Double?) -> String { d.map { String(format: "%.2f", $0).replacingOccurrences(of: ".", with: ",") } ?? "" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        Group {
                            if let photo {
                                Image(uiImage: photo).resizable().scaledToFill()
                                    .frame(width: 88, height: 88)
                                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 44, bottomLeadingRadius: 6, bottomTrailingRadius: 6, topTrailingRadius: 44))
                            } else {
                                WishThumb(path: wish?.photoPath, title: title, api: api, size: 88, symbol: "camera")
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            PhotoSourceMenu(picked: { photo = $0 }) {
                                Label(photo == nil && wish?.photoPath == nil ? L("Add photo") : L("Other photo"), systemImage: "camera")
                            }
                            if wish?.photoPath != nil && photo == nil {
                                Button(L("Remove photo"), role: .destructive) { Task { if let w = wish { try? await api.deleteWishPhoto(w.id); saved() } } }
                                    .font(.footnote)
                            }
                        }
                    }
                }
                Section(L("What")) {
                    TextField(L("e.g. Lego fire station"), text: $title, axis: .vertical)
                }
                Section {
                    ForEach($links) { $k in
                        VStack(spacing: 8) {
                            TextField("https://", text: $k.url)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .onSubmit { Task { await preview(k.id) } }
                            HStack {
                                TextField(L("Label, e.g. Shop"), text: $k.label)
                                TextField(L("Price"), text: $k.price).keyboardType(.decimalPad).frame(maxWidth: 90)
                            }
                        }
                    }
                    .onDelete { links.remove(atOffsets: $0) }
                    if links.count < 10 {
                        Button { links.append(WishLinkDraft()) } label: { Label(L("Add link (shop, price comparison …)"), systemImage: "plus") }
                    }
                } header: { Text(L("Links")) }
                Section(L("Price")) {
                    TextField("0,00", text: $price).keyboardType(.decimalPad)
                }
                Section(L("How much")) {
                    Picker(L("How much"), selection: $priority) {
                        Text(L("Nice to have")).tag(1)
                        Text(L("Would like")).tag(2)
                        Text(L("Really wants")).tag(3)
                    }
                    .pickerStyle(.segmented)
                }
                Section(L("Note")) {
                    TextField(L("Size, colour, which edition …"), text: $note, axis: .vertical).lineLimit(2...6)
                }
                if list.reservable {
                    Section {
                        Picker(L("Who could give it?"), selection: $giverId) {
                            Text(L("Nobody yet")).tag(Int?.none)
                            ForEach(members.filter { $0.kind != "guest" && $0.id != list.forUserId }) { m in Text(m.name).tag(Int?.some(m.id)) }
                        }
                        if giverId == nil { TextField(L("or a name, e.g. Grandma"), text: $giverName) }
                    } header: { Text(L("Who could give it?")) } footer: {
                        if let n = list.forName { Text(LF("%@ never sees this.", n)) }
                    }
                }
                if let wish {
                    Section {
                        Button(wish.archived == true ? L("Restore") : L("Archive")) { Task { await archive() } }
                        Button(L("Delete"), role: .destructive) { confirmDelete = true }
                    }
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(wish == nil ? L("New wish") : L("Wish"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(L("Delete"), isPresented: $confirmDelete) {
                Button(L("Delete"), role: .destructive) { Task { if let w = wish { try? await api.deleteWish(w.id); saved(); dismiss() } } }
            }
            .task {
                title = wish?.title ?? ""
                note = wish?.note ?? ""
                price = wish?.priceFromLinks == true ? "" : fmt(wish?.price)
                priority = wish?.priority ?? 2
                giverId = wish?.giver?.userId
                giverName = wish?.giver?.userId == nil ? (wish?.giver?.name ?? "") : ""
                links = (wish?.links ?? []).map { WishLinkDraft(serverId: $0.id, label: $0.label ?? "", url: $0.url, price: fmt($0.price)) }
                members = (try? await api.members()) ?? []
            }
        }
    }

    private func preview(_ id: UUID) async {
        guard let i = links.firstIndex(where: { $0.id == id }), !links[i].url.isEmpty, let p = try? await api.wishLinkPreview(links[i].url) else { return }
        guard let j = links.firstIndex(where: { $0.id == id }) else { return }
        if links[j].label.isEmpty, let s = p.site { links[j].label = s }
        if links[j].price.isEmpty, let pr = p.price { links[j].price = fmt(pr) }
        if title.trimmingCharacters(in: .whitespaces).isEmpty, let t = p.title { title = String(t.prefix(160)) }
    }

    private func archive() async {
        guard let w = wish else { return }
        _ = try? await api.saveWish(id: w.id, listId: list.id, body: try JSONSerialization.data(withJSONObject: ["archived": !(w.archived ?? false)]))
        saved()
        dismiss()
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "note": note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? NSNull() : note.trimmingCharacters(in: .whitespacesAndNewlines),
            "price": num(price),
            "priority": priority,
            "links": links.filter { !$0.url.trimmingCharacters(in: .whitespaces).isEmpty }.map { k -> [String: Any] in
                var d: [String: Any] = ["url": k.url.trimmingCharacters(in: .whitespaces), "label": k.label.isEmpty ? NSNull() : k.label, "price": num(k.price)]
                if let s = k.serverId { d["id"] = s }
                return d
            },
        ]
        if list.reservable {
            body["giver_user_id"] = giverId.map { $0 as Any } ?? NSNull()
            body["giver_name"] = giverId == nil && !giverName.trimmingCharacters(in: .whitespaces).isEmpty ? giverName.trimmingCharacters(in: .whitespaces) : NSNull()
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: body)
            let w = try await api.saveWish(id: wish?.id, listId: list.id, body: data)
            if let photo, let jpeg = photo.jpegData(compressionQuality: 0.8) { try await api.uploadWishPhoto(w.id, jpeg: jpeg) }
            Haptics.tick()
            saved()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - share

private struct WishShareSheet: View {
    let api: APIClient
    let list: WishList
    let itemIds: [Int]
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var prices = true
    @State private var skipTaken = false
    @State private var out: WishShareText?
    @State private var showShare = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                Toggle(L("With prices"), isOn: $prices)
                if list.reservable { Toggle(L("Leave out what is already reserved or bought"), isOn: $skipTaken) }
                Section(L("Message")) {
                    Text(out?.text ?? " ").font(.callout).textSelection(.enabled)
                }
                Section {
                    Button { showShare = true } label: { Label(L("Share …"), systemImage: "square.and.arrow.up") }.disabled(out == nil)
                    Button {
                        UIPasteboard.general.string = out?.text
                        copied = true
                        Haptics.tick()
                    } label: { Label(copied ? L("Copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }.disabled(out == nil)
                    Button { if let m = out?.mailto, let u = URL(string: m) { openURL(u) } } label: { Label(L("E-mail"), systemImage: "envelope") }.disabled(out == nil)
                } footer: {
                    Text(L("The message never says who reserved or bought something."))
                }
            }
            .navigationTitle(L("Share wishes"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task(id: "\(prices)-\(skipTaken)") {
                out = try? await api.wishShareText(listId: list.id, itemIds: itemIds, prices: prices, skipTaken: skipTaken)
            }
            .sheet(isPresented: $showShare) { if let out { ShareSheet(items: [out.text]) } }
        }
    }
}

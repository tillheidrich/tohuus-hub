import LinkPresentation
import PhotosUI
import SwiftUI
import UIKit

// Einkauf › Wünsche (13 Oct 2026, redesigned 20 Oct 2026 after the wish-list apps; web: web/src/pages/Wishes.tsx,
// docs/wishes.md): lists with occasion and date ("Meine Listen", "Ich bearbeite mit", "Für andere", "Zum Schenken"),
// one list with a clear head, "Alle / Noch frei", moving to sort and one big "Wunsch hinzufügen"; a wish in detail
// with a big picture and one main button "Wunsch reservieren"; "Du schenkst" with the gift shopping and reminders;
// the guest link. Reservations never reach the person a list is for nor the owner of a surprise list – the server
// leaves them out, the app follows `canReserve`. Links are read on the device (LinkPresentation), never by the server.

// MARK: - helpers

func wishPriceText(_ p: Double?, fromLinks: Bool?) -> String? {
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

/// occasion key → label and SF Symbol
enum WishOccasion: String, CaseIterable, Identifiable {
    case birthday, christmas, wedding, baby, easter, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .birthday: return L("Birthday")
        case .christmas: return L("Christmas")
        case .wedding: return L("Wedding")
        case .baby: return L("Baby")
        case .easter: return L("Easter")
        case .other: return L("Other occasion")
        }
    }
    var symbol: String {
        switch self {
        case .birthday: return "birthday.cake"
        case .christmas: return "tree"
        case .wedding: return "heart"
        case .baby: return "stroller"
        case .easter: return "hare"
        case .other: return "party.popper"
        }
    }
}

private let dayParser: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()
func wishDay(_ s: String?) -> Date? { s.flatMap { dayParser.date(from: $0) } }
/// "2026-12-24" as a local calendar day (for DatePicker and comparisons with today)
func wishLocalDay(_ s: String?) -> Date? {
    guard let p = s?.split(separator: "-").compactMap({ Int($0) }), p.count == 3 else { return nil }
    return Calendar.current.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
}
func wishDayString(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
}
func wishFmtDay(_ s: String?, short: Bool = false) -> String? {
    guard let d = wishDay(s) else { return nil }
    var st = Date.FormatStyle.dateTime.day().month(short ? .abbreviated : .wide)
    st.timeZone = TimeZone(identifier: "UTC")!
    return d.formatted(st)
}
func wishWhen(_ days: Int?) -> String? {
    guard let days else { return nil }
    if days < 0 { return L("over") }
    if days == 0 { return L("today") }
    if days == 1 { return L("tomorrow") }
    return LF("in %d days", days)
}
/// "Geburtstag · 6. Dezember · in 12 Tagen"
func wishOccasionLine(occasion: String?, date: String?, days: Int?) -> String? {
    let parts = [WishOccasion(rawValue: occasion ?? "")?.label, wishFmtDay(date), wishWhen(days)].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

/// placeholder symbol per wish (server key, server/lib/wish-icons.ts) – the web draws Phosphor icons for the same keys
func wishSymbol(_ key: String?) -> String {
    switch key {
    case "bricks": return "cube.fill"
    case "teddy": return "teddybear.fill"
    case "game": return "gamecontroller.fill"
    case "book": return "book.fill"
    case "bike": return "bicycle"
    case "ball": return "soccerball"
    case "shoe": return "shoe.fill"
    case "shirt": return "tshirt.fill"
    case "music": return "headphones"
    case "device": return "iphone"
    case "beauty": return "drop.fill"
    case "jewel": return "diamond.fill"
    case "flower": return "camera.macro"
    case "coffee": return "cup.and.saucer.fill"
    case "wine": return "wineglass.fill"
    case "sweets": return "birthday.cake.fill"
    case "kitchen": return "frying.pan.fill"
    case "tool": return "wrench.and.screwdriver.fill"
    case "garden": return "leaf.fill"
    case "paint": return "paintbrush.fill"
    case "camping": return "tent.fill"
    case "ticket": return "ticket.fill"
    case "baby": return "stroller.fill"
    case "car": return "car.fill"
    case "home": return "lamp.desk.fill"
    case "bag": return "handbag.fill"
    case "pet": return "pawprint.fill"
    case "money": return "banknote.fill"
    default: return "gift.fill"
    }
}
private let wishTints: [Color] = [Theme.sand, Theme.primarySoft, Theme.sage.opacity(0.45), Theme.lowSoft, Theme.warningSoft, Theme.surface3]
private func wishTint(_ key: String?) -> Color {
    let k = key ?? "gift"
    return wishTints[k.unicodeScalars.reduce(0) { $0 + Int($1.value) } % wishTints.count]
}

/// Photo with an arch top (Dutch Detail), or a calm tile with the wish's symbol.
struct WishThumb: View {
    let path: String?
    var icon: String? = nil
    let title: String
    let api: APIClient
    var size: CGFloat = 64
    /// fill the available width (detail)
    var fill = false
    var symbol: String? = nil

    var body: some View {
        Group {
            if let path, !path.isEmpty {
                RemoteImage(url: api.imageURL(path), api: api, placeholder: symbol ?? wishSymbol(icon))
            } else {
                ZStack {
                    wishTint(icon)
                    Image(systemName: symbol ?? wishSymbol(icon))
                        .font(.system(size: fill ? 56 : size * 0.36, weight: .regular))
                        .foregroundStyle(Theme.ink2)
                }
            }
        }
        .frame(width: fill ? nil : size, height: fill ? nil : size)
        .frame(maxWidth: fill ? .infinity : nil)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: fill ? 200 : size / 2, bottomLeadingRadius: 8, bottomTrailingRadius: 8, topTrailingRadius: fill ? 200 : size / 2))
        .accessibilityHidden(true)
    }
}

private struct Badge: View {
    let text: String
    let symbol: String?
    var tone: Color = Theme.ink2
    var fill: Color = Theme.surface2
    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).font(.caption2) }
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(fill, in: Capsule())
        .foregroundStyle(tone)
    }
}

/// symbol and "Geburtstag · 6. Dezember · in 12 Tagen" on one baseline (wraps under the text, not the symbol)
private struct OccasionLine: View {
    let text: String
    let occasion: String?
    let soon: Bool
    let font: Font
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: WishOccasion(rawValue: occasion ?? "")?.symbol ?? "calendar").accessibilityHidden(true)
            Text(text)
        }
        .font(font)
        .foregroundStyle(soon ? Theme.primaryText : Theme.ink2)
    }
}

/// symbol + text for FlowLayout rows inside a List: a `Label` there measures as a narrow, very tall box and loses its
/// text (FlowLayout asks for the `.unspecified` size) – an HStack measures like plain text.
private struct IconText: View {
    let text: String
    let symbol: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Image(systemName: symbol).imageScale(.small).accessibilityHidden(true)
            Text(text)
        }
    }
}

/// A quiet secondary action under the main button of a wish: symbol over a short word, equal width, ≥ 64 pt.
private struct WishActionTile: View {
    let title: String
    let symbol: String
    var done = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(.title3).accessibilityHidden(true)
                Text(title).font(.footnote.weight(.semibold)).multilineTextAlignment(.center).lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .padding(.vertical, 8).padding(.horizontal, 6)
            .foregroundStyle(Theme.primaryText)
            .background(done ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(done ? Color.clear : Theme.line, lineWidth: Theme.stroke))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
        }
        .buttonStyle(.plain)
        .disabled(done)
    }
}

private struct PriorityBadge: View {
    var body: some View {
        Badge(text: L("High priority"), symbol: "heart.fill", tone: Theme.low, fill: Theme.lowSoft)
    }
}

/// "Noch frei" / "Von dir reserviert" / "Reserviert – Sam" / "Gekauft" – only for people who may see it.
private struct WishStatusLine: View {
    let wish: Wish
    var body: some View {
        let who = wish.statusBy?.name ?? "?"
        let mine = wish.mineReserved
        let text: String = {
            switch wish.status {
            case "reserved":
                if mine { return L("Reserved by you") }
                return wish.statusBy?.guest == true ? LF("Reserved – %@ (guest)", who) : LF("Reserved – %@", who)
            case "bought": return mine ? L("Bought by you") : LF("Bought – %@", who)
            default: return L("Still free")
            }
        }()
        // an HStack, not a Label: in a List row a Label puts the symbol in a wide column of its own
        IconText(text: text, symbol: wish.status == "open" ? "circle" : wish.status == "bought" ? "checkmark.circle.fill" : "gift")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(wish.status == "open" || mine ? Theme.primaryText : Theme.ink2)
    }
}

private struct ProgressBar: View {
    let value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule().fill(Theme.primary).frame(width: max(0, min(1, value)) * g.size.width)
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

#if DEBUG
/// Simulator checks (debug builds only), together with `-debugTab wishes`:
///   -debugWishes new | giving | list:<id>[/wish:<id> | /edit-wish:<id> | /remind:<id> | /new-wish | /share | /edit]
/// (`-debugWishes YES` still opens the wish lists from Einkauf, ShoppingView). Every part is used once per launch.
enum WishDebugRoute {
    private static var used = Set<String>()
    static var raw: String? {
        guard let r = UserDefaults.standard.string(forKey: "debugWishes"), r != "YES", !r.isEmpty else { return nil }
        return r
    }
    /// the list id of `list:<id>…`
    static var listId: Int? {
        guard let r = raw, r.hasPrefix("list:") else { return nil }
        return Int(r.dropFirst(5).prefix { $0.isNumber })
    }
    /// the part after `list:<id>/`, e.g. "wish:3"
    static var sub: String? { raw?.split(separator: "/", maxSplits: 1).dropFirst().first.map(String.init) }
    static func once(_ key: String) -> Bool { used.insert(key).inserted }
}
#endif

// MARK: - overview

/// Navigation (fixed 20 Oct 2026, Build 22 bug): a list opens with a view link (`NavigationLink { … }`), never with a
/// value link. WishesView is pushed into stacks it does not own – Mehr (a view link on top of the Settings path), Heute
/// (a path of its own), the door in Einkauf (a sheet) –, and a value link appended to such a path popped the view-pushed
/// overview first, so the tap seemed to do nothing until one went back. Programmatic opens (a new list, debug routes)
/// use `navigationDestination(item:)`, which belongs to this view and works in every stack.
struct WishesView: View {
    let api: APIClient
    @State private var opened: Int?
    @State private var showGiving = false
    @State private var appeared = false
    @State private var lists: [WishList] = []
    @State private var giving: Giving?
    @State private var archived = false
    @State private var query = ""
    @State private var results: [Wish] = []
    @State private var loading = true
    @State private var creating = false
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var removals = PendingRemovals()
    @State private var confirmDelete: WishList?
    @Environment(AppModel.self) private var app
    /// guests and children only look (no swipe actions)
    private var canRemove: Bool { !app.isGuest && !app.isChild }

    private struct Group: Identifiable { let id: String; let title: String; let hint: String?; let lists: [WishList] }

    private var groups: [Group] {
        func forOthers(_ l: WishList) -> Bool { (l.forUserId != nil && l.forMe != true) || (l.forUserId == nil && !(l.forName ?? "").isEmpty) }
        let own = lists.filter { ($0.role == "owner" || $0.ownerId == nil) }
        return [
            Group(id: "mine", title: L("My lists"), hint: nil, lists: own.filter { !forOthers($0) }),
            Group(id: "editor", title: L("I help with"), hint: L("Lists someone runs together with you"), lists: lists.filter { $0.role == "editor" }),
            Group(id: "others", title: L("For others"), hint: L("Children, grandparents, friends"), lists: own.filter { forOthers($0) }),
            Group(id: "give", title: L("To give"), hint: L("Lists of the others – reserve something there"), lists: lists.filter { $0.role == "member" && $0.ownerId != nil }),
        ].filter { !$0.lists.isEmpty }
    }

    var body: some View {
        List {
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section(L("Search results")) {
                    if results.isEmpty { Text(L("Nothing found.")).foregroundStyle(Theme.ink3) }
                    ForEach(results) { w in
                        NavigationLink { WishListDetailView(api: api, listId: w.listId) } label: {
                            HStack(spacing: 12) {
                                WishThumb(path: w.photoPath, icon: w.icon, title: w.title, api: api, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(w.title).font(.body.weight(.semibold))
                                    Text([w.listName, wishPriceText(w.price, fromLinks: w.priceFromLinks)].compactMap { $0 }.joined(separator: " · "))
                                        .font(.footnote).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                    }
                }
            } else {
                Section {
                    Text(L("Wish lists for birthdays, Christmas and everything in between. Who reserved what stays a surprise."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }
                // "Du schenkst" as a card of its own (it hung under the intro with a separator and square corners)
                if let g = giving, g.count > 0, !archived {
                    Section {
                        NavigationLink { GivingView(api: api) } label: { GivingCard(giving: g) }
                            .listRowBackground(Theme.primarySoft)
                    }
                }
                if lists.isEmpty && !loading && error == nil {
                    EmptyStateView(systemImage: "gift", title: archived ? L("Nothing archived") : L("Your first wish list"),
                                   message: archived ? nil : L("For a birthday, Christmas or just what you’d like yourself. Share it with a link, guests need no account."),
                                   actionTitle: archived ? nil : L("Create a wish list"), action: archived ? nil : { creating = true })
                        .listRowBackground(Color.clear)
                }
                ForEach(groups) { g in
                    Section {
                        ForEach(g.lists.filter { !removals.isHidden("list:\($0.id)") }) { l in
                            NavigationLink { WishListDetailView(api: api, listId: l.id) } label: { WishListCard(list: l, api: api) }
                                .accessibilityIdentifier("wishes.list.\(l.id)")
                                // swipe left: delete (owner) and archive (whoever runs the list) – "Undo" in the toast;
                                // a list with wishes or shared (guest link, co-editors) asks first (21 Oct 2026)
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if canRemove && l.mayDelete {
                                        Button(role: .destructive) { deleteList(l) } label: { Label(L("Delete"), systemImage: "trash") }
                                            .tint(Theme.empty)
                                    }
                                    if canRemove && l.runs {
                                        Button { archiveList(l) } label: {
                                            Label(l.archived == true ? L("Restore") : L("Archive"), systemImage: l.archived == true ? "tray.and.arrow.up" : "archivebox")
                                        }
                                        .tint(Theme.ink2)
                                    }
                                }
                        }
                    } header: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.title).font(Theme.title(Theme.FontSize.l)).foregroundStyle(Theme.ink).textCase(nil)
                            if let h = g.hint { Text(h).font(.footnote).foregroundStyle(Theme.ink3).textCase(nil) }
                        }
                    }
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
        .themedList()
        .toast($toast)
        .onChange(of: toast) { old, _ in removals.toastChanged(from: old) }
        .onDisappear { removals.flush() }
        .confirmationDialog(confirmDelete.map { ($0.count ?? 0) > 0 ? LF("Delete “%@” with all wishes?", $0.name) : LF("Delete “%@”? It is shared, the others lose it too.", $0.name) } ?? "",
                            isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) {
                if let l = confirmDelete { Task { await deleteNow(l) } }
                confirmDelete = nil
            }
        }
        .navigationTitle(archived ? L("Archived lists") : L("Wishes"))
        .assistantScreen("wishes")
        .searchable(text: $query, prompt: L("Search all wishes"))
        .task(id: query) { await search() }
        .navigationDestination(item: $opened) { id in WishListDetailView(api: api, listId: id) }
        .navigationDestination(isPresented: $showGiving) { GivingView(api: api) }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label(L("New list"), systemImage: "plus") }
                    .accessibilityIdentifier("wishes.new")
            }
        }
        .sheet(isPresented: $creating) {
            // a new list opens right away – the next step is its first wish
            WishListEditSheet(api: api, list: nil) { l in
                Task {
                    await load()
                    try? await Task.sleep(for: .milliseconds(450))
                    opened = l.id
                }
            }
        }
        .refreshable { await load() }
        .task {
            await load()
            #if DEBUG
            if let r = WishDebugRoute.raw, WishDebugRoute.once("overview") {
                if r == "new" { creating = true } else if r == "giving" { showGiving = true } else if let id = WishDebugRoute.listId { opened = id }
            }
            #endif
        }
        // back from a list: fresh counts (the first appearance loads in .task)
        .onAppear {
            if appeared { Task { await load() } }
            appeared = true
        }
    }

    private func load() async {
        defer { loading = false }
        do {
            lists = try await api.wishLists(archived: archived)
            giving = try? await api.giving()
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func archiveList(_ l: WishList) {
        let back = l.archived == true
        toast = removals.remove("list:\(l.id)", text: back ? LF("“%@” is back.", l.name) : LF("“%@” archived.", l.name)) { [api] in
            do {
                _ = try await api.saveWishList(id: l.id, body: try JSONSerialization.data(withJSONObject: ["archived": !back]))
                await load()
            } catch {
                removals.restore("list:\(l.id)")
                toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            }
        }
    }

    /// an empty list nobody else runs: gone with "Undo"; otherwise ask first (the others lose it too)
    private func deleteList(_ l: WishList) {
        if (l.count ?? 0) > 0 || l.link != nil || !(l.editors ?? []).isEmpty {
            confirmDelete = l
            return
        }
        toast = removals.remove("list:\(l.id)", text: LF("“%@” deleted.", l.name)) { [api] in
            do {
                try await api.deleteWishList(l.id)
                await load()
            } catch {
                removals.restore("list:\(l.id)")
                toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            }
        }
    }

    private func deleteNow(_ l: WishList) async {
        do {
            try await api.deleteWishList(l.id)
            Haptics.success()
            toast = ToastMessage(text: LF("“%@” deleted.", l.name))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else { results = []; return }
        try? await Task.sleep(for: .milliseconds(250))
        results = (try? await api.searchWishes(q)) ?? []
    }
}

private struct GivingCard: View {
    let giving: Giving
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "gift.fill")
                .font(.title3).foregroundStyle(Theme.primaryText)
                .frame(width: 44, height: 44)
                .background(Theme.surface, in: UnevenRoundedRectangle(topLeadingRadius: 22, bottomLeadingRadius: 8, bottomTrailingRadius: 8, topTrailingRadius: 22))
            VStack(alignment: .leading, spacing: 2) {
                Text(L("You give").uppercased()).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink2)
                Text([giving.count == 1 ? L("1 wish") : LF("%d wishes", giving.count), giving.sum > 0 ? wishPriceText(giving.sum, fromLinks: false) : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
                Text(giving.todo.isEmpty ? L("All bought") : LF("%d still to get", giving.todo.count)).font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

private struct WishListCard: View {
    let list: WishList
    let api: APIClient
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let soon = (list.daysUntil ?? -1) >= 0 && (list.daysUntil ?? 99) <= 14
        let ax = typeSize.isAccessibilitySize
        let layout = ax ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        layout {
            WishThumb(path: list.photos?.first, icon: list.icons?.first ?? "gift", title: list.name, api: api, size: ax ? 52 : 64)
                .frame(width: ax ? 52 : 64, height: ax ? 60 : 76)
            VStack(alignment: .leading, spacing: 4) {
                if let line = wishOccasionLine(occasion: list.occasion, date: list.eventDate, days: list.daysUntil) {
                    OccasionLine(text: line, occasion: list.occasion, soon: soon, font: .footnote.weight(.semibold))
                }
                Text(list.name).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(subline).font(.footnote).foregroundStyle(Theme.ink2)
                if list.reservable, let c = list.count, c > 0 {
                    ProgressBar(value: Double(list.taken) / Double(c)).frame(maxWidth: 200)
                }
                HStack(spacing: 6) {
                    if list.surprise == true { Badge(text: L("Surprise"), symbol: "gift") }
                    if let sym = visibilitySymbol(list.visibility) {
                        Badge(text: visibilityLabel(list.visibility, shareWith: list.shareWith, owner: list.owner, mine: list.mine), symbol: sym)
                    }
                    if list.link != nil { Badge(text: L("Guest link"), symbol: "link") }
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var subline: String {
        let who = list.forMe == true ? L("For you") : list.forName.map { LF("for %@", $0) } ?? (list.role != "owner" ? list.owner.map { LF("from %@", $0) } : nil) ?? L("Your own wishes")
        var parts = [who, (list.count ?? 0) == 1 ? L("1 wish") : LF("%d wishes", list.count ?? 0)]
        if list.reservable, let o = list.open, (list.count ?? 0) > 0 { parts.append(LF("%d free", o)) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - one list

struct WishListDetailView: View {
    let api: APIClient
    let listId: Int
    @Environment(\.dismiss) private var dismiss
    @State private var detail: WishListDetail?
    @State private var sort = "manual"
    @State private var onlyFree = false
    @State private var archived = false
    @State private var editing: Wish?
    @State private var viewing: Wish?
    @State private var creating = false
    @State private var editList = false
    @State private var sharing = false
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var editMode: EditMode = .inactive
    @State private var toast: ToastMessage?
    @State private var removals = PendingRemovals()
    @Environment(AppModel.self) private var app
    /// guests and children only look (no swipe actions)
    private var canRemove: Bool { !app.isGuest && !app.isChild }

    private var items: [Wish] {
        let all = (detail?.items ?? []).filter { !removals.isHidden("wish:\($0.id)") }
        return onlyFree && detail?.list.reservable == true ? all.filter { $0.status == "open" } : all
    }
    private var canMove: Bool { sort == "manual" && !onlyFree && !archived && (detail?.items.count ?? 0) > 1 }

    var body: some View {
        List {
            if let l = detail?.list {
                // head and "Alle / Noch frei" in one section – as two they stood a screen-third apart
                Section {
                    header(l)
                    if l.reservable, (detail?.items.count ?? 0) > 0 {
                        Picker(L("Show"), selection: $onlyFree) {
                            Text(L("All")).tag(false)
                            Text(l.open.map { LF("Still free (%d)", $0) } ?? L("Still free")).tag(true)
                        }
                        .pickerStyle(.segmented)
                        .padding(.top, Theme.Space.s2)
                    }
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                if detail?.items.isEmpty == true {
                    // the list's own empty state (not the overview's): what a wish can hold, and the one button
                    EmptyStateView(systemImage: "heart", title: archived ? L("Nothing archived") : L("No wishes yet"),
                                   message: archived ? nil : L("With a photo, a shop link and a price. ToHuus suggests a symbol when there is no photo."),
                                   actionTitle: archived ? nil : L("Add wish"), action: archived ? nil : { creating = true })
                        .listRowBackground(Color.clear)
                        .accessibilityIdentifier("wishlist.empty")
                } else if items.isEmpty {
                    Text(L("Everything is taken. Nice!")).foregroundStyle(Theme.ink3).listRowBackground(Color.clear)
                }
                Section {
                    ForEach(items) { w in
                        Button { viewing = w } label: { WishCard(wish: w, list: l, api: api) }
                            .buttonStyle(.plain)
                            .accessibilityHint(L("Opens the wish"))
                            .accessibilityIdentifier("wish.row.\(w.id)")
                            // swipe left: delete with "Undo" (who may: the server's can_delete); swipe right, calm: reserve
                            // a free wish, or tick off my own reservation as bought. VoiceOver lists both as actions.
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                if canRemove && w.canDelete == true && editMode == .inactive {
                                    Button(role: .destructive) { removeWish(w) } label: { Label(L("Delete"), systemImage: "trash") }
                                        .tint(Theme.empty)
                                }
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                if canRemove && l.reservable && l.forMe != true && w.archived != true && editMode == .inactive {
                                    if w.status == "open" {
                                        Button { Task { await setStatus(w, "reserved") } } label: { Label(L("Reserve"), systemImage: "gift") }
                                            .tint(Theme.primary)
                                    } else if w.status == "reserved" && w.mineReserved {
                                        Button { Task { await setStatus(w, "bought") } } label: { Label(L("Bought"), systemImage: "checkmark") }
                                            .tint(Theme.primary)
                                    }
                                }
                            }
                    }
                    .onMove(perform: canMove ? move : nil)
                }
                Section {
                    Button(archived ? L("Back to current wishes") : L("Archived wishes")) { archived.toggle(); Task { await load() } }
                }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity, minHeight: 120).listRowBackground(Color.clear)
            }
            if let error { Text(error).foregroundStyle(Theme.empty) }
        }
        .themedList()
        .toast($toast)
        .onChange(of: toast) { old, _ in removals.toastChanged(from: old) }
        .onDisappear { removals.flush() }
        .accessibilityIdentifier("wishlist.detail")
        .environment(\.editMode, $editMode)
        .motion(value: (detail?.items ?? []).map { "\($0.id):\($0.status)" })
        .navigationTitle(detail?.list.name ?? "")
        .navigationBarTitleDisplayMode(.large)
        .safeAreaInset(edge: .bottom) {
            // an empty list has the button in its empty state – not twice
            if detail != nil && detail?.items.isEmpty == false && !archived && editMode == .inactive {
                Button { creating = true } label: {
                    Label(L("Add wish"), systemImage: "plus").font(.headline).lineLimit(1).minimumScaleFactor(0.6)
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.primary)
                .padding(.horizontal, Theme.Space.s4).padding(.bottom, Theme.Space.s2)
                .background(.bar.opacity(0.0001))
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if editMode == .active {
                    Button(L("Done")) { editMode = .inactive }
                } else {
                    Button { sharing = true } label: { Image(systemName: "square.and.arrow.up") }
                        .accessibilityLabel(L("Share"))
                    Menu {
                        Picker(L("Sort"), selection: $sort) {
                            Text(L("Own order")).tag("manual")
                            Text(L("Priority")).tag("priority")
                            Text(L("Price")).tag("price")
                            Text(L("Newest")).tag("newest")
                        }
                        if canMove { Button { editMode = .active } label: { Label(L("Change the order"), systemImage: "arrow.up.arrow.down") } }
                        Button { editList = true } label: { Label(L("Edit list"), systemImage: "pencil") }
                        Button { Task { await archiveList() } } label: { Label(detail?.list.archived == true ? L("Restore") : L("Archive"), systemImage: "archivebox") }
                        if detail?.list.mayDelete == true {
                            Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete list"), systemImage: "trash") }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel(L("More"))
                }
            }
        }
        .confirmationDialog(LF("Delete “%@” with all wishes?", detail?.list.name ?? ""), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { Task { await deleteList() } }
        }
        .sheet(item: $viewing) { w in
            if let l = detail?.list {
                WishDetailSheet(api: api, wish: w, list: l, changed: { Task { await load() } }, edit: { viewing = nil; DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { editing = w } })
            }
        }
        .sheet(item: $editing) { w in if let l = detail?.list { WishEditSheet(api: api, list: l, wish: w) { Task { await load() } } } }
        .sheet(isPresented: $creating) { if let l = detail?.list { WishEditSheet(api: api, list: l, wish: nil) { Task { await load() } } } }
        .sheet(isPresented: $editList) { if let l = detail?.list { WishListEditSheet(api: api, list: l) { _ in Task { await load() } } } }
        .sheet(isPresented: $sharing) { if let l = detail?.list { WishShareSheet(api: api, list: l) { Task { await load() } } } }
        .refreshable { await load() }
        .task(id: "\(sort)-\(archived)") {
            await load()
            #if DEBUG
            if let sub = WishDebugRoute.sub, WishDebugRoute.listId == listId, WishDebugRoute.once("detail") {
                let wid = Int(sub.split(separator: ":").last ?? "")
                let w = detail?.items.first { $0.id == wid }
                switch sub.split(separator: ":").first.map(String.init) {
                case "wish", "remind": viewing = w
                case "edit-wish": editing = w
                case "new-wish": creating = true
                case "share": sharing = true
                case "edit": editList = true
                default: break
                }
            }
            #endif
        }
    }

    @ViewBuilder private func header(_ l: WishList) -> some View {
        let soon = (l.daysUntil ?? -1) >= 0 && (l.daysUntil ?? 99) <= 14
        VStack(alignment: .leading, spacing: 8) {
            if let line = wishOccasionLine(occasion: l.occasion, date: l.eventDate, days: l.daysUntil) {
                OccasionLine(text: line, occasion: l.occasion, soon: soon, font: .subheadline.weight(.semibold))
            }
            FlowLayout(spacing: 12) {
                Text((l.count ?? 0) == 1 ? L("1 wish") : LF("%d wishes", l.count ?? 0))
                IconText(text: (l.people ?? 1) <= 1 ? L("only you") : LF("%d people", l.people ?? 1), symbol: "person.2")
                if l.link != nil { IconText(text: L("guests with the link"), symbol: "link") }
                if l.forMe == true { Text(L("For you – reservations stay a surprise")) } else if let n = l.forName { Text(LF("for %@", n)) }
                if l.surprise == true && !l.reservable && l.forMe != true { Text(L("Reservations are a surprise for you")) }
            }
            .font(.footnote).foregroundStyle(Theme.ink2)
            if l.reservable, let c = l.count, c > 0 {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        ProgressBar(value: Double(l.taken) / Double(c)).frame(maxWidth: 240)
                        Text(LF("%d of %d taken", l.taken, c)).font(.footnote).foregroundStyle(Theme.ink2).fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(LF("%d of %d taken", l.taken, c)).font(.footnote).foregroundStyle(Theme.ink2)
                        ProgressBar(value: Double(l.taken) / Double(c))
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func move(_ from: IndexSet, _ to: Int) {
        guard var all = detail?.items else { return }
        all.move(fromOffsets: from, toOffset: to)
        detail?.items = all
        Haptics.tick()
        Task { try? await api.orderWishes(listId: listId, ids: all.map(\.id)) }
    }
    private func load() async {
        do { detail = try await api.wishList(listId, sort: sort, archived: archived); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func archiveList() async {
        guard let l = detail?.list else { return }
        _ = try? await api.saveWishList(id: l.id, body: try JSONSerialization.data(withJSONObject: ["archived": !(l.archived ?? false)]))
        if l.archived != true { dismiss() } else { await load() }
    }
    private func deleteList() async {
        do { try await api.deleteWishList(listId); dismiss() } catch { self.error = APIError.from(error).localizedDescription }
    }
    /// gone at once, "Undo" in the toast; the server hears about it when the toast is gone or the list is left
    private func removeWish(_ w: Wish) {
        toast = removals.remove("wish:\(w.id)", text: LF("“%@” deleted.", w.title)) { [api] in
            do {
                try await api.deleteWish(w.id)
                await load()
            } catch {
                removals.restore("wish:\(w.id)")
                toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            }
        }
    }
    private func setStatus(_ w: Wish, _ s: String) async {
        do {
            try await api.setWishStatus(w.id, status: s)
            if s == "bought" { Haptics.success() } else { Haptics.tick() }
            toast = ToastMessage(text: s == "bought" ? L("Ticked off. Well done!") : LF("You reserved “%@”.", w.title))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// A calm card: picture left, title, price, quantity, priority, status.
private struct WishCard: View {
    let wish: Wish
    let list: WishList
    let api: APIClient
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        // accessibility sizes: picture above the text (side by side the title broke into syllables)
        let ax = typeSize.isAccessibilitySize
        let layout = ax ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        layout {
            WishThumb(path: wish.photoPath, icon: wish.icon, title: wish.title, api: api, size: ax ? 56 : 72)
            VStack(alignment: .leading, spacing: 5) {
                Text(wish.title).font(.body.weight(.semibold))
                    .foregroundStyle(wish.status == "bought" && list.reservable ? Theme.ink2 : Theme.ink)
                    .multilineTextAlignment(.leading)
                FlowLayout(spacing: 8) {
                    if let p = wishPriceText(wish.price, fromLinks: wish.priceFromLinks) { Text(p).font(.subheadline.weight(.bold)).monospacedDigit() }
                    if wish.qty > 1 { Text(LF("%d×", wish.qty)).font(.subheadline).foregroundStyle(Theme.ink2) }
                    if wish.priority == 3 { PriorityBadge() }
                }
                if list.reservable { WishStatusLine(wish: wish) }
            }
            if !ax {
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.ink3).accessibilityHidden(true)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - one wish in detail

private struct WishDetailSheet: View {
    let api: APIClient
    @State var wish: Wish
    let list: WishList
    let changed: () -> Void
    let edit: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var busy = false
    @State private var error: String?
    @State private var remind = false
    @State private var toList = false
    @State private var note: String?

    private var shareText: String {
        [wish.title, wishPriceText(wish.price, fromLinks: wish.priceFromLinks), wish.links.first?.url].compactMap { $0 }.joined(separator: "\n")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    WishThumb(path: wish.photoPath, icon: wish.icon, title: wish.title, api: api, fill: true)
                        // a photo gets room; the symbol tile stays smaller so "Wunsch reservieren" is visible on an SE
                        .frame(height: (wish.photoPath ?? "").isEmpty ? 170 : 260)
                    VStack(alignment: .leading, spacing: 10) {
                        if wish.priority == 3 { PriorityBadge() }
                        Text(wish.title).font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                        FlowLayout(spacing: 14) {
                            if let p = wishPriceText(wish.price, fromLinks: wish.priceFromLinks) { Text(p).font(.title2.weight(.bold)).monospacedDigit() }
                            if wish.qty > 1 { Text(LF("Quantity: %d", wish.qty)).foregroundStyle(Theme.ink2) }
                            if wish.priority != 3 { Text(priorityLabel(wish.priority)).foregroundStyle(Theme.ink2) }
                        }
                        if list.reservable && wish.status != "open" { WishStatusLine(wish: wish) }
                        if let n = wish.note, !n.isEmpty { Text(n).foregroundStyle(Theme.ink) }
                        if !wish.links.isEmpty {
                            VStack(spacing: 0) {
                                ForEach(wish.links) { k in
                                    Button { if let u = URL(string: k.url) { openURL(u) } } label: {
                                        // shop and price side by side; under each other when the text is large
                                        ViewThatFits(in: .horizontal) {
                                            HStack(spacing: 10) {
                                                Image(systemName: "link").foregroundStyle(Theme.ink2)
                                                VStack(alignment: .leading, spacing: 1) {
                                                    Text(k.display).font(.body.weight(.semibold)).foregroundStyle(Theme.ink).fixedSize()
                                                    if let t = k.title { Text(t).font(.footnote).foregroundStyle(Theme.ink3).lineLimit(1) }
                                                }
                                                Spacer(minLength: 8)
                                                if let p = k.price { Text(wishPriceText(p, fromLinks: false) ?? "").monospacedDigit().fixedSize() }
                                                Image(systemName: "arrow.up.right.square").foregroundStyle(Theme.ink3)
                                            }
                                            VStack(alignment: .leading, spacing: 4) {
                                                IconText(text: k.display, symbol: "link").font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                                                if let p = k.price { Text(wishPriceText(p, fromLinks: false) ?? "").monospacedDigit().foregroundStyle(Theme.ink2) }
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        }
                                        .padding(.horizontal, 12).padding(.vertical, 6).frame(minHeight: 50)
                                    }
                                    .buttonStyle(.plain)
                                    if k.id != wish.links.last?.id { Divider() }
                                }
                            }
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: Theme.stroke))
                        }
                        let by = [wish.createdBy.map { LF("Added by %@", $0) },
                                  (list.reservable ? wish.giver?.name : nil).map { LF("could give: %@", $0) },
                                  (wish.reminder?.sent == true ? nil : wishFmtDay(wish.reminder?.remindOn, short: true)).map { LF("Reminder on %@", $0) }].compactMap { $0 }
                        if !by.isEmpty { Text(by.joined(separator: " · ")).font(.footnote).foregroundStyle(Theme.ink3) }
                        if !list.reservable && list.forMe != true && list.surprise == true {
                            Text(L("Whether someone reserved this stays a surprise for you.")).font(.footnote).foregroundStyle(Theme.ink3)
                        }
                        if let note { Label(note, systemImage: "checkmark.circle.fill").foregroundStyle(Theme.primaryText).font(.subheadline) }
                        if let error { Text(error).foregroundStyle(Theme.empty).font(.footnote) }
                    }
                    actions
                }
                .padding(Theme.Space.s4)
            }
            .background(Theme.canvas)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(item: shareText) { Image(systemName: "square.and.arrow.up") }.accessibilityLabel(L("Pass on"))
                }
            }
            .sheet(isPresented: $remind) { WishReminderSheet(api: api, wish: wish, eventDate: list.eventDate) { Task { await reload() } } }
            .sheet(isPresented: $toList) { WishToListSheet(api: api, wish: wish, list: list) { Task { await reload() } } }
            #if DEBUG
            .task { if WishDebugRoute.sub?.hasPrefix("remind:") == true, WishDebugRoute.once("remind") { remind = true } }
            #endif
        }
        .presentationDetents([.large])
    }

    @ViewBuilder private var actions: some View {
        VStack(spacing: 10) {
            if list.reservable && wish.status == "open" {
                Button { Task { await status("reserved") } } label: {
                    Label(L("Reserve wish"), systemImage: "gift").font(.headline).frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent).tint(Theme.primary).disabled(busy)
            }
            if list.reservable && wish.status == "reserved" && wish.mineReserved {
                Button { Task { await status("bought") } } label: {
                    Label(L("Bought"), systemImage: "checkmark.circle").font(.headline).frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent).tint(Theme.primary).disabled(busy)
                // "Erinnern" sits with the other tiles below; releasing stays a quiet text button
                Button(L("Release")) { Task { await status("open") } }.buttonStyle(.borderless)
            }
            if list.reservable && wish.status == "bought" && wish.mineReserved {
                Button(L("Not bought after all")) { Task { await status("reserved") } }.buttonStyle(.borderless)
            }
            // the quiet actions as equal tiles in one row (Build 22: .bordered Labels in FlowLayout stood one under
            // the other, indented); under each other only when the text is too big for one row
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { secondary }
                VStack(spacing: 10) { secondary }
            }
            .padding(.top, 4)
        }
    }

    @ViewBuilder private var secondary: some View {
        if list.runs || (list.reservable && wish.status == "reserved" && wish.mineReserved) {
            WishActionTile(title: wish.reminder == nil ? L("Remind me") : L("Change reminder"), symbol: "bell") { remind = true }
        }
        WishActionTile(title: L("Edit"), symbol: "pencil") { dismiss(); edit() }
        if wish.onShoppingList == true {
            WishActionTile(title: L("on the shopping list"), symbol: "checkmark.circle.fill", done: true) {}
        } else {
            WishActionTile(title: L("On the shopping list"), symbol: "basket") { toList = true }
        }
    }

    private func status(_ s: String) async {
        busy = true
        defer { busy = false }
        do {
            try await api.setWishStatus(wish.id, status: s)
            if s == "open" { Haptics.tick() } else { Haptics.success() }
            if s == "reserved" { note = L("Reserved. It’s under “You give” now.") }
            await reload()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func reload() async {
        if let d = try? await api.wishList(list.id), let w = d.items.first(where: { $0.id == wish.id }) { wish = w }
        changed()
    }
}

// MARK: - reminder

/// "Erinnern": 2 weeks / 10 days / 1 week / 3 days before the occasion, or a day of your own; 10 days before suggested.
private struct WishReminderSheet: View {
    let api: APIClient
    let wish: Wish
    let eventDate: String?
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var day = Date()
    @State private var error: String?

    /// the day is set before the first frame (set in onAppear, the chip of the suggested day stayed unselected)
    init(api: APIClient, wish: Wish, eventDate: String?, saved: @escaping () -> Void) {
        self.api = api
        self.wish = wish
        self.eventDate = eventDate
        self.saved = saved
        _day = State(initialValue: Date())
        if let r = wish.reminder, let d = wishLocalDay(r.remindOn) { _day = State(initialValue: d) } else { _day = State(initialValue: suggested) }
    }

    private var today: Date { Calendar.current.startOfDay(for: Date()) }
    private var options: [(Date, String)] {
        let cal = Calendar.current
        if let e = wishLocalDay(eventDate) {
            return [(-14, L("2 weeks before")), (-10, L("10 days before")), (-7, L("1 week before")), (-3, L("3 days before"))]
                .compactMap { (n, label) in cal.date(byAdding: .day, value: n, to: e).map { ($0, label) } }
                .filter { $0.0 >= today }
        }
        return [(cal.date(byAdding: .day, value: 1, to: today)!, L("Tomorrow")), (cal.date(byAdding: .day, value: 7, to: today)!, L("In a week"))]
    }
    private var suggested: Date { options.first { $0.1 == L("10 days before") }?.0 ?? options.first?.0 ?? today }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("Only you get this reminder, on your own devices. You can switch reminders off under Settings › Notifications & calendar."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
                Section(L("When")) {
                    // plain chips (not .bordered buttons): those measured wrongly inside FlowLayout in a Form row
                    FlowLayout(spacing: 8) {
                        ForEach(options, id: \.1) { d, label in
                            ChoiceChip(title: eventDate != nil && Calendar.current.isDate(d, inSameDayAs: suggested) ? "\(label) · \(L("suggested"))" : label,
                                       on: wishDayString(d) == wishDayString(day)) { day = d }
                        }
                    }
                    .padding(.vertical, 4)
                    DatePicker(L("Or a day of your own"), selection: $day, in: today..., displayedComponents: .date)
                }
                if wish.reminder != nil {
                    Section { Button(L("Remove reminder"), role: .destructive) { Task { await save(nil) } } }
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(L("Remind me"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save(day) } } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save(_ d: Date?) async {
        do {
            try await api.setWishReminder(wish.id, day: d.map(wishDayString))
            Haptics.tick()
            saved()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
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
                if list.forUserId != nil || list.visibility != "household" || list.surprise == true {
                    Text(L("On the main list it goes on privately, so it stays a surprise.")).font(.footnote).foregroundStyle(Theme.ink2)
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
            .themedList()
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

/// The occasions as one row of compact chips (symbol + word, ~36 pt), scrolling sideways; the chosen one in the
/// accent colour, "Ohne Anlass" last. Build 22 drew them with `.bordered` Labels inside FlowLayout in a Form row:
/// FlowLayout measures with `.unspecified`, and a Label in a list row answers that with an icon-wide, very tall size
/// – grey capsules without text, each a different height, the card as high as the screen.
private struct OccasionChips: View {
    let selection: WishOccasion?
    let pick: (WishOccasion?) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(WishOccasion.allCases) { o in
                        ChoiceChip(title: o.label, systemImage: o.symbol, on: selection == o) { pick(selection == o ? nil : o) }
                            .id(o.rawValue)
                    }
                    ChoiceChip(title: L("No occasion"), systemImage: "minus.circle", on: selection == nil) { pick(nil) }
                        .id("none")
                }
                .padding(.horizontal, Theme.Space.s4)
                .padding(.vertical, 2)
            }
            .onAppear { if let s = selection { proxy.scrollTo(s.rawValue, anchor: .center) } }
            .onChange(of: selection) { _, s in withAnimation(.snappy) { proxy.scrollTo(s?.rawValue ?? "none", anchor: .center) } }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("Occasion"))
    }
}

struct WishListEditSheet: View {
    let api: APIClient
    let list: WishList?
    let saved: (WishList) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var occasion: WishOccasion?
    @State private var hasDate = false
    @State private var date = Date()
    @State private var forUser: Int?
    @State private var forName = ""
    @State private var visibility = "household"
    @State private var shareWith: [Int] = []
    @State private var editors: [Int] = []
    @State private var surprise = true
    @State private var members: [Member] = []
    @State private var meId: Int?
    @State private var error: String?
    @State private var busy = false

    private var owner: Bool { list == nil || list?.isOwner == true }
    private var people: [Member] { members.filter { $0.kind != "guest" } }

    var body: some View {
        NavigationStack {
            Form {
                Section(L("Occasion")) {
                    OccasionChips(selection: occasion) { o in
                        let wasDefault = name.isEmpty || WishOccasion.allCases.contains { $0.label == name }
                        occasion = o
                        if wasDefault, let oc = occasion { name = oc.label }
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0))
                }
                Section(L("Name")) { TextField(L("e.g. Lina’s birthday"), text: $name) }
                Section {
                    Toggle(L("With a date"), isOn: $hasDate.animation())
                    if hasDate { DatePicker(L("Date"), selection: $date, displayedComponents: .date) }
                } footer: { Text(L("A week before, ToHuus reminds whoever reserved something.")) }
                if owner {
                    // no section header: the picker row already says "Für wen?" (it stood there twice)
                    Section {
                        Picker(L("Who is it for?"), selection: $forUser) {
                            Text(L("Nobody in particular")).tag(Int?.none)
                            ForEach(people) { m in Text(m.id == meId ? L("Me") : m.name).tag(Int?.some(m.id)) }
                        }
                        if forUser == nil { TextField(L("or a name, e.g. Lina or Grandma"), text: $forName) }
                    }
                    Section {
                        Toggle(L("Keep reservations a surprise"), isOn: $surprise)
                    } footer: {
                        Text(surprise ? L("You and the people who help with the list never see whether or by whom something was reserved.") : L("You see who reserved what – handy for a child’s list."))
                    }
                    if people.contains(where: { $0.id != meId }) {
                        Section {
                            ForEach(people.filter { $0.id != meId }) { m in
                                Toggle(m.name, isOn: Binding(get: { editors.contains(m.id) }, set: { on in if on { editors.append(m.id) } else { editors.removeAll { $0 == m.id } } }))
                            }
                        } header: { Text(L("Helps with the list")) } footer: {
                            Text(L("They see the list under “I help with”, can add wishes and share the guest link."))
                        }
                    }
                    Section(L("Who sees it?")) {
                        VisibilityPicker(visibility: $visibility, shareWith: $shareWith, members: members, meId: meId, exclude: forUser.map { [$0] } ?? [], hint: nil)
                    }
                } else if let list {
                    Text(LF("%@ made this list. Only %@ can change who sees it.", list.owner ?? "?", list.owner ?? "?")).font(.footnote).foregroundStyle(Theme.ink3)
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            // short: "Neue Wunschliste" was cut off between Abbrechen and Liste anlegen
            .navigationTitle(list == nil ? L("New list") : L("Edit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    // "Anlegen": with "Liste anlegen" the title "Neue Liste" had no room on an iPhone SE
                    Button(list == nil ? L("Create") : L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onChange(of: forUser) { _, v in if list == nil { surprise = v == nil || v == meId } }
            .task {
                name = list?.name ?? ""
                occasion = WishOccasion(rawValue: list?.occasion ?? "")
                if let d = wishLocalDay(list?.eventDate) { date = d; hasDate = true }
                forUser = list?.forUserId
                forName = list?.forUserId == nil ? (list?.forName ?? "") : ""
                visibility = list?.visibility ?? "household"
                shareWith = list?.shareWith ?? []
                editors = list?.editors ?? []
                surprise = list?.surprise ?? true
                members = (try? await api.members()) ?? []
                meId = (try? await api.meLite())?.userId
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "occasion": occasion?.rawValue ?? NSNull(),
            "event_date": hasDate ? wishDayString(date) : NSNull(),
        ]
        if owner {
            body["for_user_id"] = forUser.map { $0 as Any } ?? NSNull()
            let fn = forName.trimmingCharacters(in: .whitespaces)
            body["for_name"] = forUser == nil && !fn.isEmpty ? fn : NSNull()
            body["visibility"] = visibility
            body["share_with"] = shareWith.filter { $0 != forUser }
            body["editors"] = editors.filter { $0 != meId }
            body["surprise"] = surprise
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

/// Title and picture of a shop page, read on the iPhone (LinkPresentation) – the server never opens links.
enum WishLinkReader {
    static func read(_ url: URL) async -> (title: String?, image: Data?) {
        await withCheckedContinuation { (c: CheckedContinuation<(title: String?, image: Data?), Never>) in
            DispatchQueue.main.async {
                let p = LPMetadataProvider()
                p.timeout = 8
                p.startFetchingMetadata(for: url) { md, _ in
                    let title = md?.title
                    guard let ip = md?.imageProvider else { return c.resume(returning: (title, nil)) }
                    _ = ip.loadDataRepresentation(for: .image) { data, _ in c.resume(returning: (title, data)) }
                }
            }
        }
    }
}

struct WishEditSheet: View {
    let api: APIClient
    let list: WishList
    let wish: Wish?
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var note = ""
    @State private var price = ""
    @State private var qty = 1
    @State private var priority = 2
    @State private var giverId: Int?
    @State private var giverName = ""
    @State private var links: [WishLinkDraft] = []
    @State private var photo: UIImage?
    @State private var members: [Member] = []
    @State private var aiOn = false
    @State private var reading = false
    @State private var info: String?
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
                                    .frame(width: 96, height: 96)
                                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 48, bottomLeadingRadius: 8, bottomTrailingRadius: 8, topTrailingRadius: 48))
                            } else {
                                WishThumb(path: wish?.photoPath, icon: wish?.icon, title: title, api: api, size: 96)
                            }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            PhotoSourceMenu(picked: { photo = $0 }) {
                                Label(photo == nil && wish?.photoPath == nil ? L("Add photo") : L("Other photo"), systemImage: "camera")
                            }
                            if aiOn {
                                PhotoSourceMenu(picked: { img in photo = img; Task { await readPhoto(img) } }) {
                                    Label(reading ? L("Reading the photo …") : L("Photo → fill in by AI"), systemImage: "wand.and.stars")
                                }
                                .disabled(reading)
                            }
                            if wish?.photoPath != nil && photo == nil {
                                Button(L("Remove photo"), role: .destructive) { Task { if let w = wish { try? await api.deleteWishPhoto(w.id); saved() } } }
                                    .font(.footnote)
                            }
                        }
                    }
                } footer: {
                    if aiOn { Text(L("AI reads title, details and a visible price from the photo. It counts towards your AI uses.")) }
                }
                Section(L("What")) {
                    TextField(L("e.g. Lego fire station"), text: $title, axis: .vertical)
                    if let info { Label(info, systemImage: "sparkles").font(.footnote).foregroundStyle(Theme.primaryText) }
                }
                Section {
                    TextField("0,00", text: $price).keyboardType(.decimalPad)
                    Stepper(LF("Quantity: %d", qty), value: $qty, in: 1...99)
                } header: { Text(L("Price")) }
                Section(L("How important")) {
                    Picker(L("How important"), selection: $priority) {
                        Text(L("Nice to have")).tag(1)
                        Text(L("Would like")).tag(2)
                        Text(L("Really wants")).tag(3)
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    ForEach($links) { $k in
                        VStack(alignment: .leading, spacing: 8) {
                            TextField(L("Paste a link"), text: $k.url)
                                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .onSubmit { Task { await readLink(k.id) } }
                            HStack {
                                TextField(L("Shop"), text: $k.label)
                                TextField(L("Price"), text: $k.price).keyboardType(.decimalPad).frame(maxWidth: 90)
                            }
                            if let t = k.title { Text(t).font(.footnote).foregroundStyle(Theme.ink3).lineLimit(1) }
                        }
                    }
                    .onDelete { links.remove(atOffsets: $0) }
                    if links.count < 10 {
                        Button { links.append(WishLinkDraft()) } label: { Label(links.isEmpty ? L("Add a shop link") : L("Another link (price comparison …)"), systemImage: "plus") }
                    }
                } header: { Text(L("Shop link")) } footer: {
                    Text(L("Paste a link and tap Return: the iPhone reads title and picture of the page."))
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
                        if wish.canDelete != false { Button(L("Delete"), role: .destructive) { confirmDelete = true } }
                    }
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(wish == nil ? L("New wish") : L("Edit"))  // "Wunsch bearbeiten" was cut off next to Sichern
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    // "Hinzufügen", not "Wunsch hinzufügen": the long button pushed the title "Neuer Wunsch" out of the bar
                    Button(wish == nil ? L("Add") : L("Save")) { Task { await save() } }
                        .disabled(busy || reading || title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(L("Delete"), isPresented: $confirmDelete) {
                Button(L("Delete"), role: .destructive) { Task { if let w = wish { try? await api.deleteWish(w.id); saved(); dismiss() } } }
            }
            .task {
                title = wish?.title ?? ""
                note = wish?.note ?? ""
                price = wish?.priceFromLinks == true ? "" : fmt(wish?.price)
                qty = wish?.qty ?? 1
                priority = wish?.priority ?? 2
                giverId = wish?.giver?.userId
                giverName = wish?.giver?.userId == nil ? (wish?.giver?.name ?? "") : ""
                links = (wish?.links ?? []).map { WishLinkDraft(serverId: $0.id, label: $0.label ?? "", url: $0.url, price: fmt($0.price), title: $0.title, site: $0.site) }
                members = (try? await api.members()) ?? []
                aiOn = (try? await api.meLite())?.vision ?? false
            }
        }
    }

    /// LinkPresentation on the device: the page title for the wish (if empty), the shop name, and the page picture
    /// as the wish's photo when it has none yet.
    private func readLink(_ id: UUID) async {
        guard let i = links.firstIndex(where: { $0.id == id }) else { return }
        var raw = links[i].url.trimmingCharacters(in: .whitespaces)
        if !raw.lowercased().hasPrefix("http"), raw.contains(".") { raw = "https://" + raw }
        guard let url = URL(string: raw), url.scheme?.hasPrefix("http") == true else { return }
        links[i].url = raw
        let host = url.host()?.replacingOccurrences(of: "www.", with: "")
        if links[i].label.isEmpty, let host { links[i].label = host }
        let md = await WishLinkReader.read(url)
        guard let j = links.firstIndex(where: { $0.id == id }) else { return }
        links[j].title = md.title.map { String($0.prefix(200)) }
        links[j].site = host
        if title.trimmingCharacters(in: .whitespaces).isEmpty, let t = md.title { title = String(t.prefix(160)) }
        if photo == nil, wish?.photoPath == nil, let d = md.image, let img = UIImage(data: d) { photo = img }
        if md.title != nil || md.image != nil { info = L("Filled in from the link. Check it quickly.") }
    }

    private func readPhoto(_ img: UIImage) async {
        guard let jpeg = img.jpegData(compressionQuality: 0.75) else { return }
        reading = true
        defer { reading = false }
        do {
            let r = try await api.wishFromPhoto(jpeg: jpeg)
            if title.trimmingCharacters(in: .whitespaces).isEmpty || title == wish?.title { title = r.title }
            if let n = r.note, note.isEmpty { note = n }
            if let p = r.price, price.isEmpty { price = fmt(p) }
            info = L("Filled in from the photo. Check it quickly.")
        } catch { self.error = APIError.from(error).localizedDescription }
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
            "quantity": qty,
            "priority": priority,
            "links": links.filter { !$0.url.trimmingCharacters(in: .whitespaces).isEmpty }.map { k -> [String: Any] in
                var d: [String: Any] = ["url": k.url.trimmingCharacters(in: .whitespaces), "label": k.label.isEmpty ? NSNull() : k.label, "price": num(k.price)]
                if let s = k.serverId { d["id"] = s }
                if let t = k.title { d["title"] = t }
                if let s = k.site { d["site"] = s }
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

// MARK: - share: guest link and text

private struct WishShareSheet: View {
    let api: APIClient
    @State var list: WishList
    let changed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var prices = true
    @State private var skipTaken = false
    @State private var format = "text"
    @State private var out: WishShareText?
    @State private var copied: String?
    @State private var busy = false
    @State private var confirmNew = false
    @State private var confirmStop = false
    @State private var error: String?

    private var fileURL: URL? {
        guard let out else { return nil }
        let ext = format == "csv" ? "csv" : format == "markdown" ? "md" : "txt"
        let safe = list.name.components(separatedBy: CharacterSet(charactersIn: "/\\:?%*|\"<>")).joined()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safe.isEmpty ? "Wunschliste" : safe).\(ext)")
        try? (format == "csv" ? "\u{FEFF}" + out.text : out.text).write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let link = list.link?.url, let u = URL(string: link) {
                        Text(link.replacingOccurrences(of: "https://", with: "")).font(.footnote.monospaced()).textSelection(.enabled)
                        ShareLink(item: u, subject: Text(list.name), message: Text(LF("My wish list “%@” – reserve something, no account needed.", list.name))) {
                            Label(L("Share link"), systemImage: "square.and.arrow.up")
                        }
                        Button { UIPasteboard.general.string = link; copied = L("Link copied"); Haptics.tick() } label: {
                            Label(copied == L("Link copied") ? L("Link copied") : L("Copy link"), systemImage: "doc.on.doc")
                        }
                        if list.runs {
                            Button(L("New link")) { confirmNew = true }
                            Button(L("Stop link"), role: .destructive) { confirmStop = true }
                        }
                    } else if list.runs {
                        Button { Task { await makeLink() } } label: { Label(L("Create guest link"), systemImage: "link") }.disabled(busy)
                    } else {
                        Text(LF("%@ can create a guest link for this list.", list.owner ?? "?")).foregroundStyle(Theme.ink3)
                    }
                } header: { Text(L("Link for guests")) } footer: {
                    Text(L("Grandma, friends, colleagues: they open the list in the browser and reserve with their name, no account needed. They see “taken”, never who.")
                         + (list.surprise == true ? " " + L("You won’t see it either – it stays a surprise.") : ""))
                }
                Section {
                    Picker(L("Format"), selection: $format) {
                        Text(L("Message")).tag("text")
                        Text("Markdown").tag("markdown")
                        Text(L("Table (CSV)")).tag("csv")
                    }
                    .pickerStyle(.segmented)
                    Toggle(L("With prices"), isOn: $prices)
                    if list.reservable { Toggle(L("Leave out what is already taken"), isOn: $skipTaken) }
                    Text(out?.text ?? " ").font(.callout.monospaced()).lineLimit(12).textSelection(.enabled)
                    if let out {
                        if format == "text" {
                            ShareLink(item: out.text, subject: Text(out.subject)) { Label(L("Share …"), systemImage: "square.and.arrow.up") }
                        }
                        Button { UIPasteboard.general.string = out.text; copied = L("Copied"); Haptics.tick() } label: {
                            Label(copied == L("Copied") ? L("Copied") : L("Copy"), systemImage: "doc.on.doc")
                        }
                        if let f = fileURL { ShareLink(item: f) { Label(L("As file"), systemImage: "doc") } }
                        if format == "text" { Button { if let u = URL(string: out.mailto) { openURL(u) } } label: { Label(L("E-mail"), systemImage: "envelope") } }
                    }
                } header: { Text(L("As text or file")) } footer: {
                    Text(L("Shared text never says who reserved or bought something."))
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(LF("Share “%@”", list.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .confirmationDialog(L("Make a new link? The old one stops working."), isPresented: $confirmNew, titleVisibility: .visible) {
                Button(L("New link")) { Task { await makeLink() } }
            }
            .confirmationDialog(L("Stop the guest link? Guests can no longer open the list."), isPresented: $confirmStop, titleVisibility: .visible) {
                Button(L("Stop link"), role: .destructive) { Task { await stopLink() } }
            }
            .task(id: "\(prices)-\(skipTaken)-\(format)-\(list.link?.url ?? "")") {
                out = try? await api.wishShareText(listId: list.id, prices: prices, skipTaken: skipTaken, format: format, withLink: list.link != nil && format != "csv")
            }
        }
    }

    private func makeLink() async {
        busy = true
        defer { busy = false }
        do { list = try await api.createWishGuestLink(listId: list.id); changed() } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func stopLink() async {
        do { list = try await api.revokeWishGuestLink(listId: list.id); changed() } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - "Du schenkst": the gift shopping

struct GivingView: View {
    let api: APIClient
    @State private var giving: Giving?
    @State private var showBought = false
    @State private var remind: GiftItem?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var removals = PendingRemovals()

    private var rows: [GiftItem] { (showBought ? (giving?.bought ?? []) : (giving?.todo ?? [])).filter { !removals.isHidden("gift:\($0.id)") } }
    private var groups: [(GiftItem.ListInfo, [GiftItem])] {
        var out: [(GiftItem.ListInfo, [GiftItem])] = []
        for r in rows {
            if let i = out.firstIndex(where: { $0.0.id == r.list.id }) { out[i].1.append(r) } else { out.append((r.list, [r])) }
        }
        return out
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    if let g = giving {
                        Text([g.count == 1 ? L("1 wish") : LF("%d wishes", g.count), g.sum > 0 ? wishPriceText(g.sum, fromLinks: false) : nil].compactMap { $0 }.joined(separator: " · "))
                            .font(.title3.weight(.bold))
                    }
                    Text(L("Your gift shopping, separate from the household list – so nothing gives the surprise away."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
                if (giving?.count ?? 0) > 0 {
                    Picker(L("Show"), selection: $showBought) {
                        Text(LF("Still to get (%d)", giving?.todo.count ?? 0)).tag(false)
                        Text(LF("Bought (%d)", giving?.bought.count ?? 0)).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
            }
            if giving?.count == 0 {
                EmptyStateView(systemImage: "gift", title: L("Nothing reserved yet"),
                               message: L("Reserve a wish on someone’s list – it shows up here with the occasion, the price and a reminder if you like."))
                    .listRowBackground(Color.clear)
            } else if giving != nil && rows.isEmpty {
                Text(showBought ? L("Nothing bought yet.") : L("All bought. Now only wrapping is left.")).foregroundStyle(Theme.ink3)
            }
            ForEach(groups, id: \.0.id) { info, items in
                Section {
                    ForEach(items) { g in
                        giftRow(g)
                            // swipe right: bought / not bought after all; swipe left: release (with "Undo" – someone
                            // else could take it the moment it is free). VoiceOver lists them as actions.
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
                                if g.wish.status == "reserved" {
                                    Button { Task { await set(g.wish, "bought") } } label: { Label(L("Bought"), systemImage: "checkmark") }.tint(Theme.primary)
                                } else {
                                    Button { Task { await set(g.wish, "reserved") } } label: { Label(L("Not bought after all"), systemImage: "arrow.uturn.backward") }.tint(Theme.ink2)
                                }
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                if g.wish.status == "reserved" {
                                    Button { release(g) } label: { Label(L("Release"), systemImage: "gift") }.tint(Theme.ink2)
                                }
                            }
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(info.name).font(Theme.title(Theme.FontSize.l)).foregroundStyle(Theme.ink).textCase(nil)
                        let sub = [info.forName.map { LF("for %@", $0) }, wishFmtDay(info.eventDate), wishWhen(info.daysUntil)].compactMap { $0 }
                        if !sub.isEmpty { Text(sub.joined(separator: " · ")).font(.footnote).foregroundStyle(Theme.ink3).textCase(nil) }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(Theme.empty) }
        }
        .themedList()
        .toast($toast)
        .onChange(of: toast) { old, _ in removals.toastChanged(from: old) }
        .onDisappear { removals.flush() }
        .navigationTitle(L("You give"))
        .sheet(item: $remind) { g in WishReminderSheet(api: api, wish: g.wish, eventDate: g.list.eventDate) { Task { await load() } } }
        .refreshable { await load() }
        .task { await load() }
    }

    @ViewBuilder private func giftRow(_ g: GiftItem) -> some View {
        let w = g.wish
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 14) {
                WishThumb(path: w.photoPath, icon: w.icon, title: w.title, api: api, size: 60)
                VStack(alignment: .leading, spacing: 4) {
                    Text(w.title).font(.body.weight(.semibold))
                    FlowLayout(spacing: 8) {
                        if let p = wishPriceText(w.price, fromLinks: w.priceFromLinks) { Text(p).font(.subheadline.weight(.bold)).monospacedDigit() }
                        if w.qty > 1 { Text(LF("%d×", w.qty)).font(.subheadline).foregroundStyle(Theme.ink2) }
                        if let k = w.links.first, let u = URL(string: k.url) { Link(destination: u) { IconText(text: k.display, symbol: "link").font(.subheadline) } }
                    }
                    if let r = w.reminder, r.sent != true, let d = wishFmtDay(r.remindOn, short: true) {
                        IconText(text: LF("Reminder on %@", d), symbol: "bell").font(.footnote).foregroundStyle(Theme.ink2)
                    }
                }
            }
            HStack(spacing: 10) {
                if w.status == "reserved" {
                    // HStack labels: a Label in a List row drew the check in the accent colour on the accent button
                    // (invisible) and left a wide gap before "Erinnern"
                    Button { Task { await set(w, "bought") } } label: { IconText(text: L("Bought"), symbol: "checkmark").foregroundStyle(Theme.onPrimary) }
                        .buttonStyle(.borderedProminent).tint(Theme.primary)
                    Button { remind = g } label: { IconText(text: w.reminder == nil ? L("Remind me") : L("Reminder"), symbol: "bell") }.buttonStyle(.bordered)
                } else {
                    Button(L("Not bought after all")) { Task { await set(w, "reserved") } }.buttonStyle(.borderless)
                }
            }
            .controlSize(.regular)
        }
        .padding(.vertical, 6)
    }

    private func set(_ w: Wish, _ s: String) async {
        do {
            try await api.setWishStatus(w.id, status: s)
            if s == "bought" { Haptics.success() } else { Haptics.tick() }
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
    private func release(_ g: GiftItem) {
        toast = removals.remove("gift:\(g.id)", text: LF("“%@” is free again.", g.wish.title)) { [api] in
            do {
                try await api.setWishStatus(g.wish.id, status: "open")
                await load()
            } catch {
                removals.restore("gift:\(g.id)")
                toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            }
        }
    }
    private func load() async {
        do { giving = try await api.giving(); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }
}

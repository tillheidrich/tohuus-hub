import SwiftUI

// Plan templates & rotation and the family food vote (web: pages/Plan2.tsx).

// MARK: - templates & rotation

struct RotationSheet: View {
    let store: ServerStore
    let from: String
    let feedback: CookFeedback
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var templates: [PlanTemplate] = []
    @State private var rotation: PlanRotation?
    @State private var loaded = false
    @State private var error: String?
    @State private var name = ""
    @State private var busy = ""
    @State private var weeks = 2
    @State private var replace: PlanTemplate?
    @State private var deleting: PlanTemplate?
    @State private var note: String?

    private static let letters = Array("ABCDEF")
    private var ids: [Int] { rotation?.templateIds ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Text(LC("Save a good week once and let it come back. Filling never overwrites what is planned, leaves days you’re away or eating out free and swaps a dish you had recently."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    if let note { Text(note).font(.subheadline.weight(.medium)).foregroundStyle(Theme.primaryText) }
                    if let error { ErrorBanner(message: error) { Task { await load() } } }
                    Card(title: LC("Save the shown week"), systemImage: "square.and.arrow.down") {
                        HStack(spacing: Theme.Space.s2) {
                            TextField(LC("e.g. “Autumn rotation A”"), text: $name)
                                .padding(10)
                                .background(Theme.canvas, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            Button(busy == "save" ? LC("Saving…") : L("Save")) { trySave() }
                                .buttonStyle(.borderedProminent).tint(Theme.primary)
                                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || !busy.isEmpty)
                        }
                        Text(LC("Takes the 7 days shown in the plan, with their weekdays and servings.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    if !loaded {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if templates.isEmpty {
                        EmptyStateView(systemImage: "repeat", title: LC("No templates yet"),
                                       message: LC("Plan a week you liked, then save it here. Two or three saved weeks make a rotation."))
                    } else {
                        CookHeading(title: LC("Templates"), hint: ids.isEmpty ? LC("Tap a letter to add a template") : nil)
                        VStack(spacing: 0) {
                            ForEach(templates) { tp in templateRow(tp); Divider() }
                        }
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                        if !ids.isEmpty { rotationCard }
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(LC("Plan templates & rotation"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Close")) { dismiss() } } }
            .task { await load() }
            .confirmationDialog(replace.map { LCF("Replace the template “%@” with this week?", $0.name) } ?? "", isPresented: Binding(get: { replace != nil }, set: { if !$0 { replace = nil } }), titleVisibility: .visible) {
                Button(LC("Replace")) { if let r = replace { Task { await save(replacing: r.id) } } }
                Button(L("Cancel"), role: .cancel) { replace = nil }
            }
            .confirmationDialog(deleting.map { LCF("Delete the template “%@”? Planned meals stay.", $0.name) } ?? "", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button(LC("Delete"), role: .destructive) { if let d = deleting { Task { await run("del") { try await store.api.deleteTemplate(d.id); return nil } } } }
                Button(L("Cancel"), role: .cancel) { deleting = nil }
            }
        }
    }

    private func templateRow(_ tp: PlanTemplate) -> some View {
        let pos = ids.firstIndex(of: tp.id)
        return HStack(spacing: Theme.Space.s3) {
            Button { toggle(tp.id) } label: {
                Group {
                    if let pos { Text(String(Self.letters[pos])).font(.headline) } else { Image(systemName: "plus") }
                }
                .frame(width: 40, height: 40)
                .foregroundStyle(pos != nil ? Theme.onPrimary : Theme.primaryText)
                .background(pos != nil ? Theme.primary : Theme.primarySoft, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(pos != nil ? LC("Remove from the rotation") : LC("Add to the rotation"))
            VStack(alignment: .leading, spacing: 2) {
                Text(tp.name).font(.body.weight(.semibold))
                Text(tp.items.isEmpty ? LC("empty") : tp.items.prefix(7).map { "\(CookDay.weekdayName($0.weekday)) \($0.title)" }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
            }
            Spacer(minLength: 0)
            Menu {
                Button { Task { await run("a\(tp.id)") { try await store.api.applyTemplate(tp.id, from: from).message } } } label: {
                    Label(LC("Use for this week"), systemImage: "calendar.badge.plus")
                }
                Button(role: .destructive) { deleting = tp } label: { Label(LC("Delete"), systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44)
            }
            .accessibilityLabel(LCF("Options for %@", tp.name))
        }
        .padding(.horizontal, Theme.Space.s3).padding(.vertical, 6)
    }

    private var rotationCard: some View {
        Card(title: LC("Rotation"), systemImage: "repeat") {
            if ids.count > 1 {
                let next = rotation?.weeks.first { $0.monday > CookDay.today() }
                Text(LC("Next week uses")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                FlowLayout {
                    ForEach(Array(ids.enumerated()), id: \.offset) { i, id in
                        CookChip(title: "\(Self.letters[i]) · \(templates.first { $0.id == id }?.name ?? "")", on: (next?.index ?? 0) == i) {
                            Task { await run("rot") { try await store.api.saveRotation(["next_index": i]); return nil } }
                        }
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(rotation?.weeks ?? [], id: \.monday) { w in
                        VStack(spacing: 2) {
                            Text(CookDay.short(w.monday)).font(.caption2).foregroundStyle(Theme.ink3)
                            Text(w.index >= 0 && w.index < 6 ? String(Self.letters[w.index]) : "–").font(.headline)
                        }
                        .frame(width: 64, height: 50)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                }
            }
            let avoid = rotation?.avoidDays ?? 10
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(LC("Don’t repeat a dish within")).font(.subheadline.weight(.semibold))
                    Text(LC("Cooked or planned within these days → a fitting suggestion instead.")).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Stepper(LCF("%d days", avoid), value: Binding(get: { avoid }, set: { v in
                    Task { await run("rot") { try await store.api.saveRotation(["avoid_days": max(0, v)]); return nil } }
                }), in: 0...60)
                .labelsHidden()
                Text(LCF("%d days", avoid)).font(.caption.monospacedDigit())
            }
            Toggle(isOn: Binding(get: { rotation?.auto ?? false }, set: { v in
                Task { await run("rot") { try await store.api.saveRotation(["auto": v]); return nil } }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(LC("Fill the coming week automatically")).font(.subheadline.weight(.semibold))
                    Text(LC("Once a week, quietly. You get a short note and can change anything.")).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            .tint(Theme.primary)
            Picker("", selection: $weeks) {
                Text(LC("1 week")).tag(1)
                Text(LC("2 weeks")).tag(2)
                Text(LC("4 weeks")).tag(4)
            }
            .pickerStyle(.segmented)
            Button { Task { await run("apply") { try await store.api.applyRotation(weeks: weeks).message } } } label: {
                Label(busy == "apply" ? LC("Planning…") : LC("Fill from the rotation"), systemImage: "arrow.triangle.2.circlepath")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!busy.isEmpty)
        }
    }

    private func load() async {
        do {
            async let t = store.api.planTemplates()
            async let r = store.api.planRotation()
            templates = try await t
            rotation = try? await r
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        loaded = true
    }

    private func toggle(_ id: Int) {
        let next = ids.contains(id) ? ids.filter { $0 != id } : Array((ids + [id]).prefix(6))
        Task { await run("rot") { try await store.api.saveRotation(["template_ids": next]); return nil } }
    }

    private func trySave() {
        let n = name.trimmingCharacters(in: .whitespaces)
        if let same = templates.first(where: { $0.name.lowercased() == n.lowercased() }) { replace = same; return }
        Task { await save(replacing: nil) }
    }

    private func save(replacing: Int?) async {
        let n = name.trimmingCharacters(in: .whitespaces)
        await run("save") {
            try await store.api.saveWeekTemplate(name: n, from: from, replacing: replacing)
            name = ""
            return LCF("Saved “%@”", n)
        }
    }

    private func run(_ key: String, _ fn: () async throws -> String?) async {
        busy = key
        defer { busy = "" }
        do {
            if let msg = try await fn() { note = msg; feedback.say(msg) }
            store.touch("recipes")
            onChange()
        } catch { self.error = APIError.from(error).localizedDescription }
        await load()
    }
}

// MARK: - votes

/// "Wer will was essen?" – open and finished votes, start a new one.
struct VotesSheet: View {
    let store: ServerStore
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var votes: [FoodVote] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var start = false
    @State private var path: [Int] = []

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Button { start = true } label: { Label(LC("Start a vote"), systemImage: "person.3") }
                        .buttonStyle(PrimaryButtonStyle())
                    if let error { ErrorBanner(message: error) { Task { await load() } } }
                    if !loaded {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if votes.isEmpty {
                        EmptyStateView(systemImage: "person.3", title: LC("Can’t agree on dinner?"),
                                       message: LC("Pick a few dishes, everyone swipes yes or no on their own phone – or together on one device. You see what everyone wants."))
                    } else {
                        VStack(spacing: 0) {
                            ForEach(votes) { v in
                                NavigationLink(value: v.id) { voteRow(v) }.buttonStyle(.plain)
                                Divider()
                            }
                        }
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                    }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(LC("Who wants what?"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Int.self) { id in VoteDetailView(store: store, voteId: id) { Task { await load(); onChange() } } }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Close")) { dismiss() } } }
            .task { await load() }
            .refreshable { await load() }
            .sheet(isPresented: $start) {
                StartVoteSheet(store: store, day: nil) { Task { await load() } } started: { id in path = [id] }
            }
        }
    }

    private func voteRow(_ v: FoodVote) -> some View {
        let done = v.voters.filter { $0.done == true }.count
        let myTurn = v.status == "open" && v.isSecret && v.me != nil && !(v.voters.first { $0.key == v.me }?.done ?? true)
        return HStack(spacing: Theme.Space.s3) {
            Image(systemName: v.isRevealed ? "calendar.badge.checkmark" : v.isSecret ? "lock" : "person.3")
                .foregroundStyle(Theme.primaryText).frame(width: 36, height: 36)
                .background(Theme.primarySoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(v.displayTitle).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(v.isRevealed
                     ? ((v.matches ?? []).isEmpty ? LC("Result is in") : LCF("Everyone wants: %@", (v.matches ?? []).map(\.title).joined(separator: ", ")))
                     : LCF("%d of %d done", done, v.voters.count))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            if myTurn { StatusPill(text: LC("Your turn"), status: nil) }
            Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
        }
        .padding(Theme.Space.s3)
        .contentShape(Rectangle())
    }

    private func load() async {
        do { votes = try await store.api.votes(); error = nil } catch { self.error = APIError.from(error).localizedDescription }
        loaded = true
    }
}

struct StartVoteSheet: View {
    let store: ServerStore
    let day: String?
    var onDone: () -> Void
    var started: ((Int) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var when = "today"
    @State private var mode = "secret"
    @State private var src = "suggestions"
    @State private var ideas: VoteIdeas?
    @State private var members: [VoteMember] = []
    @State private var recipes: [Recipe] = []
    @State private var picked: [VoteIdea] = []
    @State private var voters: [String]?
    @State private var q = ""
    @State private var busy = false
    @State private var error: String?

    init(store: ServerStore, day: String?, onDone: @escaping () -> Void, started: ((Int) -> Void)? = nil) {
        self.store = store
        self.day = day
        self.onDone = onDone
        self.started = started
    }

    private var today: String { CookDay.today() }
    private var from: String { if let day, when != "week" { return day }; return when == "tomorrow" ? CookDay.add(today, 1) : today }
    private var to: String { when == "week" ? CookDay.add(from, 6) : from }
    private var defaultVoters: [String] { members.filter { $0.guest != true && (mode == "together" || $0.login == true) }.map(\.key) }
    private var chosen: [String] { voters ?? defaultVoters }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    if let day {
                        Text(CookDay.long(day)).font(.subheadline).foregroundStyle(Theme.ink2)
                    } else {
                        Picker("", selection: $when) {
                            Text(LC("Today")).tag("today")
                            Text(LC("Tomorrow")).tag("tomorrow")
                            Text(LC("Next 7 days")).tag("week")
                        }
                        .pickerStyle(.segmented)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(LC("How do you vote?")).font(.subheadline.weight(.semibold))
                        Picker("", selection: $mode) {
                            Text(LC("Each on their phone")).tag("secret")
                            Text(LC("Together on one device")).tag("together")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: mode) { _, _ in voters = nil }
                        Text(mode == "secret"
                             ? LC("Everyone swipes in secret. Nobody sees anything until all are done – then you see what everyone wants.")
                             : LC("Pass the phone or use the kitchen tablet: each person taps their dishes in turn. Kids without a login vote here."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(LC("Who votes")).font(.subheadline.weight(.semibold))
                        FlowLayout {
                            ForEach(members) { m in
                                let on = chosen.contains(m.key)
                                Button {
                                    voters = on ? chosen.filter { $0 != m.key } : chosen + [m.key]
                                } label: {
                                    HStack(spacing: 6) {
                                        PersonDot(name: m.name, color: m.color, size: 24)
                                        Text(m.name).font(.subheadline)
                                        if m.login != true && mode == "secret" { Text(LC("on a grown-up’s phone")).font(.caption2).foregroundStyle(Theme.ink3) }
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(on ? Theme.primarySoft : Theme.surface, in: Capsule())
                                    .overlay(Capsule().stroke(on ? Theme.primary : Theme.line, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(on ? .isSelected : [])
                            }
                        }
                    }
                    Text(picked.count == 1 ? LC("1 dish picked") : LCF("%d dishes picked", picked.count)).font(.subheadline.weight(.semibold))
                    if !picked.isEmpty {
                        FlowLayout {
                            ForEach(picked) { p in
                                CookChip(title: p.title, systemImage: "xmark", on: true) { toggle(p) }
                            }
                        }
                    }
                    Picker("", selection: $src) {
                        Text(LC("Fits the pantry")).tag("suggestions")
                        Text(LC("Favorites")).tag("favourites")
                        if !(ideas?.cookidoo.isEmpty ?? true) { Text("Cookidoo").tag("cookidoo") }
                        Text(LC("Search / own")).tag("search")
                    }
                    .pickerStyle(.segmented)
                    if src == "search" {
                        TextField(LC("Recipe or anything (“pizza from the place”)"), text: $q)
                            .padding(10)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                    }
                    VStack(spacing: 0) {
                        ForEach(pool) { i in
                            Button { toggle(i) } label: {
                                HStack(spacing: Theme.Space.s3) {
                                    Image(systemName: has(i) ? "checkmark.circle.fill" : "circle").foregroundStyle(has(i) ? Theme.primary : Theme.ink3).font(.title3)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(i.title).font(.body.weight(.medium)).foregroundStyle(Theme.ink)
                                        if let w = i.why { Text(i.source == "cookidoo" ? CookDay.short(w) : w).font(.caption).foregroundStyle(Theme.ink3) }
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(Theme.Space.s3).frame(minHeight: 48).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider()
                        }
                        let n = q.trimmingCharacters(in: .whitespaces)
                        if src == "search", !n.isEmpty, !pool.contains(where: { $0.title.lowercased() == n.lowercased() }) {
                            Button { toggle(VoteIdea(recipeId: nil, title: n, imagePath: nil, source: "free", why: nil)); q = "" } label: {
                                Label(LCF("Add “%@”", n), systemImage: "plus").padding(Theme.Space.s3).frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                            }
                        }
                        if pool.isEmpty && src != "search" {
                            Text(src == "favourites" ? LC("No favorites yet – mark recipes with the heart.") : LC("Nothing here right now."))
                                .font(.subheadline).foregroundStyle(Theme.ink3).padding(Theme.Space.s3)
                        }
                    }
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    if let error { ErrorBanner(message: error) }
                    Button { Task { await startVote() } } label: {
                        Label(busy ? LC("Starting…") : picked.count < 2 ? LC("Pick at least two dishes") : LC("Start the vote"), systemImage: "person.3")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || picked.count < 2 || chosen.isEmpty)
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(LC("Who wants what?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task {
                if let day, day != today { when = day == CookDay.add(today, 1) ? "tomorrow" : "today" }
                async let i = store.api.voteIdeas()
                async let m = store.api.voteMembers()
                async let r = store.api.recipes()
                ideas = try? await i
                members = (try? await m) ?? []
                recipes = (try? await r) ?? []
            }
        }
    }

    private var pool: [VoteIdea] {
        switch src {
        case "search":
            let n = q.trimmingCharacters(in: .whitespaces)
            return recipes.filter { n.isEmpty || $0.title.range(of: n, options: [.caseInsensitive, .diacriticInsensitive]) != nil }.prefix(12)
                .map { VoteIdea(recipeId: $0.id, title: $0.title, imagePath: $0.imagePath, source: "recipe", why: nil) }
        case "favourites": return ideas?.favourites ?? []
        case "cookidoo": return ideas?.cookidoo ?? []
        default: return ideas?.suggestions ?? []
        }
    }

    private func same(_ a: VoteIdea, _ b: VoteIdea) -> Bool { (a.recipeId != nil && a.recipeId == b.recipeId) || a.title.lowercased() == b.title.lowercased() }
    private func has(_ i: VoteIdea) -> Bool { picked.contains { same($0, i) } }
    private func toggle(_ i: VoteIdea) { if has(i) { picked.removeAll { same($0, i) } } else if picked.count < 20 { picked.append(i) } }

    private func startVote() async {
        busy = true
        defer { busy = false }
        do {
            let v = try await store.api.startVote(from: from, to: to, mode: mode, candidates: picked, voters: chosen)
            store.touch("recipes")
            onDone()
            dismiss()
            started?(v.id)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// One vote: swipe (secret) or take turns (together), then the result and "into the plan".
struct VoteDetailView: View {
    let store: ServerStore
    let voteId: Int
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var vote: FoodVote?
    @State private var voter: String?
    @State private var error: String?
    @State private var queue: [Int] = []
    @State private var picks: [Int: Int] = [:]
    @State private var sending = false
    @State private var selected: Set<Int> = []
    @State private var confirmDelete = false
    @State private var note: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let v = vote {
                    Text((v.isSecret ? LC("Secret vote") : LC("Voting together")) + (v.startedBy.map { " · " + LCF("started by %@", $0) } ?? ""))
                        .font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                    Text(v.displayTitle).font(Theme.title(24))
                    if let note { Text(note).font(.subheadline.weight(.medium)).foregroundStyle(Theme.primaryText) }
                    if v.isRevealed { result(v) } else { voting(v) }
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
        }
        .canvasBackground()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let v = vote, v.isStarter == true || v.startedBy == nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) { confirmDelete = true } label: { Label(LC("Delete"), systemImage: "trash") }
                }
            }
        }
        .confirmationDialog(LC("Delete this vote?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(LC("Delete"), role: .destructive) {
                Task {
                    try? await store.api.deleteVote(voteId)
                    onChange()
                    dismiss()
                }
            }
        }
        .task(id: voter) { await load() }
    }

    private var activeVoter: String? { voter ?? vote?.voter }

    @ViewBuilder
    private func voting(_ v: FoodVote) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s3) {
                ForEach(v.voters) { x in
                    let can = x.canVoteHere == true && x.done != true
                    Button { voter = x.key } label: {
                        VStack(spacing: 4) {
                            PersonDot(name: x.name, color: x.color, size: 40)
                                .overlay(Circle().stroke(activeVoter == x.key ? Theme.primary : .clear, lineWidth: 3).padding(-3))
                                .opacity(x.done == true ? 0.5 : 1)
                            Text(x.name).font(.caption.weight(.semibold))
                            Text(x.done == true ? LC("done") : x.canVoteHere == true ? (v.mode == "together" || x.login != true ? LC("tap to vote") : LC("your turn")) : LC("waiting"))
                                .font(.caption2).foregroundStyle(Theme.ink3)
                        }
                        .frame(minWidth: 64)
                    }
                    .buttonStyle(.plain)
                    .disabled(!can)
                }
            }
            .padding(4)
        }
        turn(v)
        if (v.isStarter == true || v.mode == "together") && v.voters.contains(where: { $0.started == true || $0.done == true }) {
            Button(LC("Close now and show the result")) {
                Task {
                    do { try await store.api.closeVote(v.id); onChange() } catch { self.error = APIError.from(error).localizedDescription }
                    await load()
                }
            }
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    @ViewBuilder
    private func turn(_ v: FoodVote) -> some View {
        if let who = v.voters.first(where: { $0.key == activeVoter }) {
            if who.done == true {
                hint(who.key == v.me ? LC("You’re done. The result shows as soon as everyone has voted.") : LCF("%@ is done. The result shows as soon as everyone has voted.", who.name))
            } else if v.isSecret {
                swipeCard(v, who: who)
            } else {
                tapGrid(v, who: who)
            }
        } else {
            let mine = v.voters.first { $0.key == v.me }
            hint(mine?.done == true ? LC("You’re done. The result shows as soon as everyone has voted.")
                 : v.mode == "together" ? LC("Tap a name above – then that person picks their dishes.")
                 : LC("You are not part of this vote. Kids without a login can vote here – tap their name."))
        }
    }

    private func hint(_ t: String) -> some View {
        Text(t).font(.subheadline).foregroundStyle(Theme.ink2)
            .padding(Theme.Space.s4).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }

    /// Secret mode: one dish at a time – no / yes / super.
    @ViewBuilder
    private func swipeCard(_ v: FoodVote, who: FoodVote.Voter) -> some View {
        let cards = queue.compactMap { id in v.candidates.first { $0.id == id } }
        if let c = cards.first {
            Text(who.login == true ? LCF("%d left – nobody sees your choice.", cards.count) : LCF("%@ is voting – %d left.", who.name, cards.count))
                .font(.subheadline).foregroundStyle(Theme.ink2).frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                RemoteImage(url: store.api.imageURL(c.imagePath), api: store.api, placeholder: "fork.knife")
                    .frame(height: 220).frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                Text(c.title).font(Theme.title(24))
                HStack(spacing: 6) {
                    if c.thermomix == true { StatusPill(text: "Thermomix", status: nil) }
                    if let t = c.timeMin { StatusPill(text: LCF("%d min", Int(t)), status: nil) }
                }
            }
            .padding(Theme.Space.s4)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            .id(c.id)
            .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .leading).combined(with: .opacity)))
            HStack(spacing: Theme.Space.s3) {
                voteButton(LC("No"), "xmark", Theme.low) { await swipe(v, c.id, -1) }
                voteButton(LC("Yes"), "checkmark", Theme.primary) { await swipe(v, c.id, 1) }
                voteButton(LC("Super"), "heart.fill", Theme.clay) { await swipe(v, c.id, 2) }
            }
        } else {
            hint(LC("Saving…"))
        }
    }

    private func voteButton(_ title: String, _ icon: String, _ color: Color, run: @escaping () async -> Void) -> some View {
        Button { Task { await run() } } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.title2.weight(.bold))
                Text(title).font(.caption.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 64)
            .foregroundStyle(color)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(color.opacity(0.5), lineWidth: 1.5))
        }
        .buttonStyle(.plain)
        .disabled(sending)
    }

    /// Together mode: tap = yes, tap again = super, again = nothing. Untapped dishes count as no.
    @ViewBuilder
    private func tapGrid(_ v: FoodVote, who: FoodVote.Voter) -> some View {
        Text(LCF("%@, what would you like?", who.name)).font(.headline).frame(maxWidth: .infinity)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
            ForEach(v.candidates) { c in
                let val = picks[c.id] ?? 0
                Button { picks[c.id] = val == 1 ? 2 : val == 2 ? 0 : 1; Haptics.tick() } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        RemoteImage(url: store.api.imageURL(c.imagePath), api: store.api, placeholder: "fork.knife")
                            .frame(height: 96).frame(maxWidth: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                            .overlay(alignment: .topTrailing) {
                                if val > 0 {
                                    Image(systemName: val == 2 ? "heart.fill" : "checkmark").font(.headline)
                                        .foregroundStyle(.white).frame(width: 32, height: 32)
                                        .background(val == 2 ? Theme.clay : Theme.primary, in: Circle()).padding(6)
                                }
                            }
                        Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2).multilineTextAlignment(.leading)
                    }
                    .padding(8)
                    .background(val > 0 ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(val > 0 ? Theme.primary : Theme.line, lineWidth: val > 0 ? 2 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(val > 0 ? .isSelected : [])
            }
        }
        Text(LC("Tap = yes, tap again = super. Nothing tapped = no.")).font(.caption).foregroundStyle(Theme.ink3).frame(maxWidth: .infinity)
        Button {
            Task {
                let ballots = v.candidates.map { ($0.id, (picks[$0.id] ?? 0) > 0 ? picks[$0.id]! : -1) }
                if await send(v, ballots) { picks = [:]; voter = nil; await load() }
            }
        } label: { Text(picks.values.contains { $0 > 0 } ? LC("Done – next person") : LC("Nothing for me – next person")) }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(sending)
    }

    @ViewBuilder
    private func result(_ v: FoodVote) -> some View {
        let results = v.results ?? []
        let counted = max(1, v.voters.filter { $0.done == true || $0.started == true }.count)
        if let m = v.matches, !m.isEmpty {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: "heart.fill").foregroundStyle(Theme.clay).font(.title2)
                VStack(alignment: .leading) {
                    Text(LC("Everyone wants")).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                    Text(m.map(\.title).joined(separator: ", ")).font(.headline)
                }
            }
            .padding(Theme.Space.s4).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        } else {
            hint(LC("No dish that everyone wants. Here is what got the most yes votes."))
        }
        VStack(spacing: 0) {
            ForEach(results) { r in
                let planned = r.plannedEntryId != nil
                Button {
                    if selected.contains(r.candidateId) { selected.remove(r.candidateId) } else { selected.insert(r.candidateId) }
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: selected.contains(r.candidateId) || planned ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(Theme.primary).font(.title3)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(r.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                            GeometryReader { g in
                                Capsule().fill(Theme.primary).frame(width: g.size.width * CGFloat(r.yes ?? 0) / CGFloat(counted))
                            }
                            .frame(height: 6)
                            .background(Theme.surface2, in: Capsule())
                            let parts = [(r.yes ?? 0) > 0 ? LCF("%d× yes", r.yes ?? 0) : nil, (r.super ?? 0) > 0 ? LCF("%d× super", r.super ?? 0) : nil, (r.no ?? 0) > 0 ? LCF("%d× no", r.no ?? 0) : nil].compactMap { $0 }
                            Text((parts.isEmpty ? LC("no votes") : parts.joined(separator: " · ")) + (planned ? " · " + LC("in the plan") : ""))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        if r.match == true { StatusPill(text: LC("Everyone wants it"), status: nil) }
                    }
                    .padding(Theme.Space.s3).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(planned)
                Divider()
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        if results.contains(where: { $0.plannedEntryId == nil }) {
            Button { Task { await apply(v) } } label: {
                Label(sending ? LC("Planning…") : selected.count == 1 ? LC("Put it into the plan") : LCF("Put %d dishes into the plan", selected.count), systemImage: "calendar.badge.checkmark")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(sending || selected.isEmpty)
        }
        Text(LC("Only dishes are counted – nobody sees who voted what.")).font(.caption).foregroundStyle(Theme.ink3)
    }

    private func load() async {
        do {
            let v = try await store.api.vote(voteId, voter: voter)
            let first = vote == nil || vote?.id != v.id || vote?.voter != v.voter
            vote = v
            error = nil
            if first || queue.isEmpty {
                let mine = v.mine ?? [:]
                queue = v.candidates.filter { mine[String($0.id)] == nil }.map(\.id)
            }
            if v.isRevealed && selected.isEmpty {
                let results = v.results ?? []
                if !results.contains(where: { $0.plannedEntryId != nil }) {
                    let m = results.filter { $0.match == true }
                    let base = m.isEmpty ? Array(results.filter { ($0.score ?? 0) > 0 }.prefix(1)) : m
                    selected = Set((v.dayFrom == v.dayTo ? Array(base.prefix(1)) : base).map(\.candidateId))
                }
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func send(_ v: FoodVote, _ ballots: [(Int, Int)]) async -> Bool {
        sending = true
        defer { sending = false }
        do {
            try await store.api.castBallots(v.id, voter: activeVoter, ballots: ballots)
            onChange()
            return true
        } catch {
            self.error = APIError.from(error).localizedDescription
            return false
        }
    }

    private func swipe(_ v: FoodVote, _ id: Int, _ value: Int) async {
        Haptics.tick()
        guard await send(v, [(id, value)]) else { return }
        withAnimation(.easeOut(duration: 0.2)) { queue.removeAll { $0 == id } }
        if queue.isEmpty { voter = nil; await load() }
    }

    private func apply(_ v: FoodVote) async {
        sending = true
        defer { sending = false }
        do {
            let r = try await store.api.applyVote(v.id, candidates: Array(selected))
            note = r.placed.count == 1 ? LCF("“%@” is planned for %@", r.placed[0].title, CookDay.long(r.placed[0].day)) : LCF("%d dishes are in the plan", r.placed.count)
            Haptics.success()
            store.touch("recipes")
            onChange()
            selected = []
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

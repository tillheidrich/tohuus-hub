import SwiftUI

// "Was habt ihr heute gelöst?" (server: lib/checkin.ts, docs/checkin.md, web: pages/Checkin.tsx).
// In the evening, every other day at most, Heute asks. Tap what got done and who did it; the rest as a few words.
// Always positive: the answer is "Heute habt ihr zusammen 6 Sachen gelöst", never who did less. No push, no streak;
// skipping is fine. Plus "Fertig für heute": nothing due, nothing waiting – put the phone away.

struct CheckinData: Decodable, Sendable {
    struct Chip: Decodable, Sendable, Hashable, Identifiable {
        var taskId: Int
        var name: String
        var doneToday: Bool = false
        var id: Int { taskId }
    }
    struct Member: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var name: String
        var color: String?
        var me: Bool = false
    }
    var on: Bool = true
    var ask: Bool = false
    var question: String?
    @Lossy var chips: [Chip]
    @Lossy var members: [Member]
    var solvedToday: Int?
}

struct CheckinSaved: Decodable, Sendable {
    var saved: Int?
    var solvedToday: Int?
    var message: String?
}

struct CheckinSetting: Decodable, Sendable { var on: Bool }

extension APIClient {
    /// GET /api/checkin – whether Heute asks now, the chips (the household's usual tasks) and who can have done it
    func checkin() async throws -> CheckinData { try await get("api/checkin") }
    /// POST /api/checkin { items: [{ task_id | text, who }] } → { saved, solved_today, message }
    func checkinSave(_ items: [[String: Any]]) async throws -> CheckinSaved {
        try await send("POST", "api/checkin", json: ["items": items])
    }
    /// POST /api/checkin/skip – "Heute nicht", the question comes back another evening
    func checkinSkip() async throws { _ = try await send("POST", "api/checkin/skip", json: [:], as: Ignored.self) }
    /// PUT /api/checkin/settings { on } – personal switch
    func checkinSetOn(_ on: Bool) async throws -> CheckinSetting {
        try await send("PUT", "api/checkin/settings", json: ["on": on])
    }
}

/// Who did it – "Ich" or a member (only with at least two people).
private struct CheckinWho: View {
    let members: [CheckinData.Member]
    @Binding var value: Int
    let label: String

    var body: some View {
        if members.count >= 2 {
            FlowLayout(spacing: 6) {
                ForEach(members) { m in
                    ChoiceChip(title: m.me ? L("Me") : m.name, on: value == m.id) { value = m.id }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
        }
    }
}

/// Heute, from 17:00: "Was habt ihr heute gelöst?" – only when the server says `ask`.
struct CheckinCard: View {
    let api: APIClient
    let refresh: Int
    var onSaved: (String) -> Void = { _ in }
    @State private var data: CheckinData?
    /// task id → who did it
    @State private var picked: [Int: Int] = [:]
    @State private var extra: [Extra] = []
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var typing: Bool

    struct Extra: Identifiable { let id = UUID(); var text: String; var who: Int }

    private var me: Int { data?.members.first(where: \.me)?.id ?? 0 }
    private var count: Int { picked.count + extra.count + (text.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : 1) }

    var body: some View {
        LoadSlot {
            if let d = data, d.ask {
                Card(title: d.question ?? L("What did you solve today?"), systemImage: "moon.stars") {
                    VStack(alignment: .leading, spacing: Theme.Space.s3) {
                        Text(L("A lot gets solved without an app. Two taps, so it gets seen – and ToHuus learns who does what."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                        if !d.chips.isEmpty { chips(d) }
                        ForEach($extra) { $x in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: Theme.Space.s2) {
                                    Image(systemName: "checkmark").font(.caption).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                                    Text(x.text).font(.subheadline).foregroundStyle(Theme.ink)
                                    Spacer(minLength: 0)
                                    Button { extra.removeAll { $0.id == x.id } } label: {
                                        Image(systemName: "xmark").font(.caption).foregroundStyle(Theme.ink3).tapTarget()
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(LF("Remove “%@”", x.text))
                                }
                                CheckinWho(members: d.members, value: $x.who, label: LF("Who did “%@”?", x.text))
                            }
                        }
                        HStack(spacing: Theme.Space.s2) {
                            TextField(L("Something else – e.g. took the dog out"), text: $text)
                                .textFieldStyle(.roundedBorder)
                                .focused($typing)
                                .submitLabel(.done)
                                .onSubmit(addText)
                                .accessibilityLabel(L("Something else"))
                            Button(action: addText) { Image(systemName: "plus").tapTarget() }
                                .buttonStyle(.bordered)
                                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                                .accessibilityLabel(L("Add"))
                        }
                        if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                        HStack(spacing: Theme.Space.s3) {
                            Button { Task { await save() } } label: {
                                Text(L("Done")).frame(minHeight: 32)
                            }
                            .buttonStyle(.borderedProminent).tint(Theme.primary)
                            .disabled(busy || count == 0)
                            Button { Task { await skip() } } label: {
                                Text(L("Not today")).frame(minHeight: 32)
                            }
                            .buttonStyle(.bordered)
                            Spacer(minLength: 0)
                            Menu {
                                Button(L("Don’t ask any more"), systemImage: "moon.zzz") { Task { await off() } }
                            } label: {
                                Image(systemName: "ellipsis").tapTarget()
                            }
                            .accessibilityLabel(L("More"))
                        }
                    }
                }
            }
        }
        .task(id: refresh) { await load() }
    }

    private func chips(_ d: CheckinData) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            FlowLayout(spacing: 6) {
                ForEach(d.chips) { c in
                    let on = picked[c.taskId] != nil || c.doneToday
                    ChoiceChip(title: c.name, systemImage: on ? "checkmark" : nil, on: on) {
                        guard !c.doneToday else { return }
                        if picked[c.taskId] != nil { picked[c.taskId] = nil } else { picked[c.taskId] = me }
                    }
                    .disabled(c.doneToday)
                    .accessibilityHint(c.doneToday ? L("Already done today") : "")
                }
            }
            ForEach(d.chips.filter { picked[$0.taskId] != nil }) { c in
                VStack(alignment: .leading, spacing: 4) {
                    Text(LF("Who did “%@”?", c.name)).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                    CheckinWho(members: d.members, value: Binding(get: { picked[c.taskId] ?? me }, set: { picked[c.taskId] = $0 }),
                               label: LF("Who did “%@”?", c.name))
                }
            }
        }
    }

    private func addText() {
        let v = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty else { return }
        extra.append(Extra(text: String(v.prefix(200)), who: me))
        text = ""
    }

    private func load() async {
        do {
            data = try await api.checkin()
        } catch {
            // the question is an extra – Heute stays calm without it
            data = nil
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var items: [[String: Any]] = picked.map { p -> [String: Any] in ["task_id": p.key, "who": p.value] }
        items += extra.map { x -> [String: Any] in ["text": x.text, "who": x.who] }
        let v = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !v.isEmpty { items.append(["text": String(v.prefix(200)), "who": me]) }
        do {
            let r = try await api.checkinSave(items)
            Haptics.success()
            picked = [:]
            extra = []
            text = ""
            error = nil
            onSaved(r.message ?? L("Saved"))
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func skip() async {
        do {
            try await api.checkinSkip()
            error = nil
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func off() async {
        do {
            _ = try await api.checkinSetOn(false)
            error = nil
            onSaved(L("Okay – ToHuus won’t ask in the evening any more. You can switch it back on in the notification settings."))
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// "Fertig für heute": nothing due, nothing waiting. A quiet end to Heute – nothing to keep scrolling.
struct CalmCard: View {
    var body: some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: "moon").font(.title3).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
            Text(L("Everything important is done for today. Put the phone down for a while."))
                .font(.subheadline).foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .accessibilityElement(children: .combine)
    }
}

/// Settings › Notifications: the personal switch for the evening question (PUT /api/checkin/settings).
struct CheckinSettingSection: View {
    let api: APIClient
    @State private var on: Bool?
    @State private var error: String?
    @State private var loader = LoadTrigger()

    var body: some View {
        // loads from the body: in a List there is no invisible view to hang a .task on (Design/LoadSlot.swift)
        let _ = loader.run { on = (try? await api.checkin())?.on }
        if let on {
            Section {
                Toggle(isOn: Binding(get: { on }, set: { v in Task { await set(v) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Ask in the evening what got solved"))
                        Text(L("On Heute from 5 pm, every other evening at most. No push, no streak."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.primary)
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
            } footer: {
                Text(L("Only for you – the others decide for themselves."))
            }
        }
    }

    private func set(_ v: Bool) async {
        let old = on
        on = v
        do {
            on = try await api.checkinSetOn(v).on
            error = nil
        } catch {
            on = old
            self.error = APIError.from(error).localizedDescription
        }
    }
}

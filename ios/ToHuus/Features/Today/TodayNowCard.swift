import SwiftUI

/// POST /api/guest-tasks/:id/done → { ok, message }: a permanent guest ticks off a task handed to them (Jetzt dran).
struct GuestTaskDone: Decodable, Sendable { var ok: Bool?; var message: String? }

extension APIClient {
    func guestTaskDone(_ id: Int) async throws -> GuestTaskDone { try await send("POST", "api/guest-tasks/\(id)/done", json: [:]) }
}

/// Heute › Jetzt dran (Paket B, web: Today.tsx NowCard): my due tasks from the server's queue (lib/next-task.ts, the
/// same order as "Nur eins" and /fokus), at most "Heute höchstens". With "Nur eins" the single-task card instead.
/// A permanent guest sees what was handed to them and ticks it off through /api/guest-tasks.
struct TodayNowCard: View {
    let api: APIClient
    let now: TodayPayload.TodayNow
    let refresh: Int
    let openTasks: () -> Void
    /// a toast (or nil) – Heute reloads either way
    let changed: (ToastMessage?) -> Void
    @State private var busy: Int?

    private var oneThing: Bool { now.oneThing == true }
    private var guest: Bool { now.guest == true }
    private var total: Int { now.items.count + (now.more ?? 0) }

    private var showToggle: Bool { !guest && (oneThing || total > 1) }

    var body: some View {
        // like Card, but „Nur eins“ sits in the header next to the title (below it when the text is large)
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Theme.Space.s2) {
                    title
                    Spacer(minLength: Theme.Space.s2)
                    if showToggle { oneToggle }
                }
                VStack(alignment: .leading, spacing: 0) {
                    title
                    if showToggle { oneToggle }
                }
            }
            if oneThing {
                OneThingTodayView(api: api, refresh: refresh) { Task { await setOne(false) } }
            } else {
                ForEach(now.items) { t in row(t) }
                if let more = now.more, more > 0 {
                    if now.gentle == true {
                        NavigationLink { FocusView(api: api) } label: { Label(L("Just one"), systemImage: "scope").font(.subheadline.weight(.semibold)) }
                            .frame(minHeight: 44)
                    } else {
                        Button(action: openTasks) { Label(LF("%d more", more), systemImage: "arrow.right").font(.subheadline.weight(.semibold)) }
                            .frame(minHeight: 44)
                    }
                }
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }

    private var title: some View {
        HStack(spacing: Theme.Space.s2) {
            Image(systemName: TodayCardKey.now.symbol).foregroundStyle(Theme.primaryText)
            Text(L("Up now")).font(.headline).foregroundStyle(Theme.ink)
        }
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityAddTraits(.isHeader)
    }

    private func meta(_ t: TodayPayload.NowItem) -> String {
        let when: String
        switch t.level {
        case "overdue": when = now.gentle == true ? L("could be done") : L("overdue")
        case "promised": when = L("you said you’d do it")
        default: when = t.dueTime.map { LF("today %@", TaskTime.label($0)) } ?? L("due today")
        }
        let steps = (t.checklist ?? []).isEmpty ? nil : LF("%d of %d", (t.checklist ?? []).filter { $0.done == true }.count, (t.checklist ?? []).count)
        return [when, t.place, t.doer?.name, steps].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func row(_ t: TodayPayload.NowItem) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Text(t.emoji ?? "✨").font(.title3).frame(width: 30).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if t.private == true { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for me")) }
                    Text(t.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                }
                Text(meta(t)).font(.caption).foregroundStyle(t.level == "overdue" && now.gentle != true ? Theme.empty : Theme.ink3)
            }
            Spacer(minLength: 0)
            Button { Task { await done(t) } } label: {
                Label(L("Done"), systemImage: "checkmark").font(.caption.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .tint(Theme.primary)
            .frame(minHeight: 44)
            .disabled(busy == t.id)
            .accessibilityLabel(LF("Done: %@", t.name))
        }
    }

    /// compact chip; the tap area stays 44 pt high
    private var oneToggle: some View {
        Button { Task { await setOne(!oneThing) } } label: {
            Label(L("Just one"), systemImage: oneThing ? "checkmark.circle.fill" : "circle")
                .font(.caption.weight(.semibold))
                .fixedSize()
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(oneThing ? Theme.primary.opacity(0.15) : Theme.line.opacity(0.5)))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(L("Show only the next task"))
        .accessibilityAddTraits(oneThing ? .isSelected : [])
    }

    private func setOne(_ on: Bool) async {
        do {
            let p = try await api.setFocusPrefs(["oneThing": on])
            FocusFlags.apply(p)
            changed(nil)
        } catch { changed(ToastMessage(text: APIError.from(error).localizedDescription, isError: true)) }
    }

    private func done(_ t: TodayPayload.NowItem) async {
        busy = t.id
        defer { busy = nil }
        do {
            if guest {
                let r = try await api.guestTaskDone(t.id)
                Haptics.success()
                changed(ToastMessage(text: r.message ?? L("Done.")))
            } else {
                let r = try await api.careDone(t.id)
                Haptics.success()
                changed(ToastMessage(text: r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done."), actionTitle: L("Undo"), action: {
                    Task {
                        try? await api.careUndo(t.id, logId: r.logId)
                        changed(nil)
                    }
                }))
            }
        } catch { changed(ToastMessage(text: APIError.from(error).localizedDescription, isError: true)) }
    }
}

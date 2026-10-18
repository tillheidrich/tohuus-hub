import SwiftUI

/// "Wer hat bezahlt, und für wen?" on the receipt check (web: shop/forms.tsx WhoPaidPanel). In a shared household:
/// who paid, single lines for one person or for a household you shop for (care list); for everyone: "just mine".
/// Sentences and choices only – ToHuus never moves money.
struct WhoPaidPanel: View {
    let store: ServerStore
    let importId: Int
    @State private var info: ImportSplitInfo?
    @State private var members: [MoneyMember] = []
    @State private var me: Int?
    @State private var care: [ListRef] = []
    @State private var open = false
    @State private var loaded = false
    @State private var toast: ToastMessage?

    private var multi: Bool { members.count > 1 }

    var body: some View {
        LoadSlot {
            if loaded, let info, multi || !care.isEmpty || me != nil {
                VStack(alignment: .leading, spacing: Theme.Space.s3) {
                    Button { withAnimation(.easeOut(duration: 0.2)) { open.toggle() } } label: {
                        HStack {
                            Text(multi ? L("Who paid, and for whom?") : L("Anything for someone else?"))
                                .font(.headline).foregroundStyle(Theme.ink)
                            Spacer()
                            Text(summary(info)).font(.subheadline).foregroundStyle(Theme.ink3)
                            Image(systemName: open ? "chevron.up" : "chevron.down").font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if open { content(info) }
                }
                .padding(Theme.Space.s4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            }
        }
        .task(id: store.revision("imports")) { await load() }
        .toast($toast)
    }

    private func payer(_ i: ImportSplitInfo) -> Int? { i.paidBy ?? members.first { $0.name == i.actor }?.id }

    private func summary(_ i: ImportSplitInfo) -> String {
        if i.privateFor != nil { return L("just mine") }
        return payer(i).flatMap { id in members.first { $0.id == id }?.name } ?? ""
    }

    @ViewBuilder
    private func content(_ i: ImportSplitInfo) -> some View {
        if let me {
            Toggle(isOn: Binding(get: { i.privateFor != nil }, set: { on in
                Task { await run { try await store.api.setReceiptPersonal(importId, forUserId: on ? me : nil) } }
            })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("This receipt is just mine")).font(.subheadline.weight(.semibold))
                    Text(L("Nobody else sees it, not even in the household numbers.")).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            .tint(Theme.primary)
            .disabled(i.privateFor != nil && i.privateFor != me)
        }
        if multi && i.privateFor == nil {
            FlowLayout(spacing: 6) {
                ForEach(members) { m in
                    ChoiceChip(title: LF("%@ paid", m.name), on: payer(i) == m.id) {
                        Task { await run { try await store.api.setReceiptPayer(importId, userId: m.id) } }
                    }
                }
            }
        }
        if i.privateFor == nil && (multi || !care.isEmpty) {
            let priced = i.lines.filter { $0.price != nil }
            VStack(spacing: 0) {
                ForEach(Array(priced.enumerated()), id: \.element.id) { n, l in
                    if n > 0 { Divider().overlay(Theme.line) }
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(l.name).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(2)
                            Text(Money.format(l.price)).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 6)
                        Menu {
                            Button { set(l, user: nil, list: nil) } label: { choiceLabel(L("Shared"), on: l.forUserId == nil && l.forListId == nil) }
                            if multi {
                                ForEach(members) { m in
                                    Button { set(l, user: m.id, list: nil) } label: { choiceLabel(m.name, on: l.forUserId == m.id) }
                                }
                            }
                            ForEach(care) { c in
                                if let cid = Int(c.id.value) {
                                    Button { set(l, user: nil, list: cid) } label: { choiceLabel(c.name, on: l.forListId == cid) }
                                }
                            }
                        } label: {
                            HStack(spacing: 4) {
                                Text(forName(l)).font(.subheadline)
                                Image(systemName: "chevron.up.chevron.down").font(.caption2)
                            }
                            .foregroundStyle(l.forUserId == nil && l.forListId == nil ? Theme.ink2 : Theme.primaryText)
                            .frame(minHeight: 44)
                        }
                        .accessibilityLabel(LF("For whom is %@?", l.name))
                        .accessibilityValue(forName(l))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func choiceLabel(_ title: String, on: Bool) -> some View {
        if on { Label(title, systemImage: "checkmark") } else { Text(title) }
    }

    private func forName(_ l: ImportSplitInfo.Line) -> String {
        if let u = l.forUserId { return members.first { $0.id == u }?.name ?? L("Shared") }
        if let c = l.forListId { return care.first { $0.id.value == String(c) }?.name ?? L("Shared") }
        return L("Shared")
    }

    private func set(_ l: ImportSplitInfo.Line, user: Int?, list: Int?) {
        Task { await run { try await store.api.setImportLineFor(importId, line: l.id, userId: user, listId: list) } }
    }

    private func load() async {
        async let i = store.api.importSplitInfo(importId)
        async let m = store.api.spendMeta()
        async let l = store.api.shopLists()
        info = try? await i
        if let meta = try? await m {
            members = meta.members ?? []
            me = meta.me
        }
        care = ((try? await l) ?? []).filter { $0.kind == "care" }
        loaded = true
    }

    private func run(_ fn: () async throws -> Void) async {
        do {
            try await fn()
            store.touch("imports")
            info = try? await store.api.importSplitInfo(importId)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

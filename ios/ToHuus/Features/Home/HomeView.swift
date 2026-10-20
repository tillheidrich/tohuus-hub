import SwiftUI

/// Zuhause (UX audit 2026-10 Paket A, docs/navigation.md; web: home/HomeSwitch.tsx): the pantry with three labelled
/// doors on top – Hausinfo, Haushaltswissen, Wo ist was? (group "zuhause" of shared/functions.json, MoreMenu.zuhauseDoors).
/// Aufgaben has no doors any more: Urlaub & Übergabe is in Mehr › Alltag. Stock switched off ("Was nutzt ihr?") or
/// not open for a guest → no Zuhause tab; the doors then stand in Mehr as the group "Zuhause".
enum HomeDoor: String, Identifiable { case find, house, knowledge, away; var id: String { rawValue } }

extension HomeDoor {
    /// the register function (shared/functions.json) behind a door
    init?(function id: String) {
        switch id {
        case "houseinfo": self = .house
        case "knowledge": self = .knowledge
        case "find": self = .find
        default: return nil
        }
    }
}

#if DEBUG
@MainActor private var debugDoorOpened = false
/// screenshot runs: -debugHomeDoor house | knowledge | find opens the door the way a tap on its tile does
/// (with -debugTab stock)
@MainActor private func debugDoor(_ allowed: [HomeDoor]) async -> HomeDoor? {
    guard !debugDoorOpened, let raw = UserDefaults.standard.string(forKey: "debugHomeDoor"), let d = HomeDoor(rawValue: raw), allowed.contains(d) else { return nil }
    debugDoorOpened = true
    try? await Task.sleep(nanoseconds: 1_000_000_000)
    return d
}
#endif

/// Tab "Aufgaben": the task list.
struct TasksAreaView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore

    var body: some View {
        NavigationStack {
            CareView(api: store.api).rootChrome()
        }
        .onAppear { app.assistantContext = "tasks" }
    }
}

/// Tab "Zuhause": the doors, then the pantry.
struct StockAreaView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    @State private var door: HomeDoor?
    @State private var product: Int?

    var body: some View {
        PantryView(store: store, onDoor: { door = $0 })
            .onAppear { app.assistantContext = "stock" }
            #if DEBUG
            .task { if let d = await debugDoor([.house, .knowledge, .find]) { door = d } }
            #endif
            .sheet(item: $door) { d in
                switch d {
                case .find:
                    FindView(store: store) { id in door = nil; Task { try? await Task.sleep(nanoseconds: 450_000_000); product = id } }
                case .knowledge:
                    NavigationStack { KnowledgeView(api: store.api).toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
                case .away:
                    NavigationStack { AwayView(store: store).toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
                case .house:
                    NavigationStack { HouseGuideView().toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
                }
            }
            .sheet(item: Binding(get: { product.map(ProductRef.init) }, set: { product = $0?.id })) { p in
                NavigationStack {
                    ProductDetailView(productId: p.id, store: store)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { product = nil } } }
                }
            }
    }
}

/// The doors as big tiles with a symbol and a word (a list row on top of the pantry): the first two side by side
/// (symbol over the word), a third one as a full-width row below, a single door as a row. Same as the web’s .zuhause-doors.
struct ZuhauseDoors: View {
    @Environment(AppModel.self) private var app
    let open: (HomeDoor) -> Void

    var body: some View {
        let doors = MoreMenu.zuhauseDoors(app: app).compactMap { f in HomeDoor(function: f.id).map { (f, $0) } }
        if !doors.isEmpty {
            VStack(spacing: Theme.Space.s2) {
                if doors.count >= 2 {
                    HStack(alignment: .top, spacing: Theme.Space.s2) {
                        tile(doors[0].0, doors[0].1, index: 0, tall: true)
                        tile(doors[1].0, doors[1].1, index: 1, tall: true)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                if doors.count != 2 {
                    let last = doors.count == 1 ? 0 : 2
                    tile(doors[last].0, doors[last].1, index: last, tall: false)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("Home"))
        }
    }

    private func tile(_ f: FunctionRegister.Fn, _ d: HomeDoor, index: Int, tall: Bool) -> some View {
        Button { open(d) } label: {
            Group {
                if tall {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(alignment: .top) { icon(f, index); Spacer(); chevron }
                        title(f).font(.body.weight(.semibold))
                    }
                } else {
                    HStack(spacing: 12) {
                        icon(f, index)
                        title(f).font(.body.weight(.semibold))
                        Spacer(minLength: 0)
                        chevron
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .frame(minHeight: tall ? 104 : 64)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
    }

    private func title(_ f: FunctionRegister.Fn) -> some View {
        Text(MoreMenu.title(f)).lineLimit(2).minimumScaleFactor(0.8).multilineTextAlignment(.leading)
    }

    private var chevron: some View {
        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2).accessibilityHidden(true)
    }

    private func icon(_ f: FunctionRegister.Fn, _ index: Int) -> some View {
        Image(systemName: f.icon.ios)
            .font(.system(size: 18, weight: .semibold))
            .frame(width: 40, height: 40)
            .background([Theme.sand, Theme.primarySoft, Theme.surface2][min(index, 2)], in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// the row of door chips on top of a tab (scrolls sideways when the text is large)
struct DoorBar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s2) { content }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s2)
        .background(.bar)
    }
}

struct DoorChip: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                .padding(.vertical, 4)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
        .frame(minHeight: 44)
    }
}

private struct ProductRef: Identifiable { let id: Int }

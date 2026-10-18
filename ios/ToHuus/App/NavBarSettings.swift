import SwiftUI
import UIKit

/// "Deine Leiste" (18 Oct 2026, docs/navigation.md): which areas sit in the tab bar next to Heute (iPhone) and on top
/// of the sidebar (iPad). Heute stays first; up to four more, in the person's own order; everything else under "Mehr".
/// Stored per person on the server (PUT /api/nav, GET /api/me → nav.tabs), so iPhone and web look the same. Offline
/// the choice stays on this device and is sent with the next /api/me (adopt). nil = the default bar (AppModel.barAreas).
/// Same as the web (web/src/navbar.tsx).
@MainActor
@Observable
final class NavBarPrefs {
    static let shared = NavBarPrefs()
    /// the person's own areas next to Heute; nil = the default
    private(set) var tabs: [AppArea]?
    /// the last save didn't reach the server (shown in the editor)
    private(set) var offline = false

    private static let key = "nav.tabs"
    private static let pendingKey = "nav.pending"
    private var defaults: UserDefaults { .standard }

    init() {
        if let raw = UserDefaults.standard.array(forKey: Self.key) as? [String] { tabs = Self.clean(raw) }
    }

    /// known areas only, each once, at most four – like the server (lib/nav-prefs.ts cleanNavTabs)
    static func clean(_ raw: [String]) -> [AppArea] {
        var out: [AppArea] = []
        for s in raw {
            if let a = AppArea(rawValue: s), AppArea.pickable.contains(a), !out.contains(a) { out.append(a) }
        }
        return Array(out.prefix(AppArea.slots))
    }

    /// GET /api/me → nav: take the server's choice – or send ours first when it was changed offline
    func adopt(_ nav: JSONValue?, api: APIClient?) {
        // an older server without "nav": keep what this device has
        guard let nav, nav.object != nil else { return }
        if defaults.bool(forKey: Self.pendingKey) {
            let mine = tabs
            Task { await self.push(mine, api: api) }
            return
        }
        let server = nav["tabs"]?.array?.compactMap(\.string)
        keep(server.map(Self.clean))
    }

    /// save right away on this device (the bar changes at once), then on the server; false = only on this device
    @discardableResult
    func save(_ next: [AppArea]?, api: APIClient?) async -> Bool {
        keep(next)
        defaults.set(true, forKey: Self.pendingKey)
        return await push(next, api: api)
    }

    @discardableResult
    private func push(_ next: [AppArea]?, api: APIClient?) async -> Bool {
        guard let api else { offline = true; return false }
        let body: [String: Any] = ["tabs": next.map { $0.map(\.rawValue) as Any } ?? NSNull()]
        do {
            _ = try await api.send("PUT", "api/nav", json: body, as: Ignored.self)
            defaults.set(false, forKey: Self.pendingKey)
            offline = false
            return true
        } catch {
            offline = true
            return false
        }
    }

    private func keep(_ next: [AppArea]?) {
        tabs = next
        if let next { defaults.set(next.map(\.rawValue), forKey: Self.key) } else { defaults.removeObject(forKey: Self.key) }
    }
}

/// Einstellungen › Deine Leiste (also: "Leiste anpassen" in Mehr, a long press on the tab bar). The system's own
/// edit look: drag handles to sort, the red minus takes an area out, the green plus puts one in.
struct NavBarSettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var mine: [AppArea] = []
    @State private var full = false
    private var prefs: NavBarPrefs { .shared }

    private var pickable: [AppArea] { AppArea.pickable.filter { app.areaVisible($0) } }
    private var rest: [AppArea] { pickable.filter { !mine.contains($0) } }

    var body: some View {
        List {
            Section {
                HStack(spacing: Theme.Space.s3) {
                    Label(AppArea.today.title, systemImage: AppArea.today.icon)
                    Spacer()
                    Image(systemName: "lock.fill").foregroundStyle(Theme.ink3).accessibilityHidden(true)
                    Text(L("Always first")).font(.caption).foregroundStyle(Theme.ink3)
                }
                .foregroundStyle(Theme.ink2)
                .moveDisabled(true)
                .deleteDisabled(true)
                ForEach(mine) { a in
                    Label(a.title, systemImage: a.icon)
                }
                .onMove { from, to in
                    mine.move(fromOffsets: from, toOffset: to)
                    commit(mine)
                }
                .onDelete { idx in
                    mine.remove(atOffsets: idx)
                    commit(mine)
                }
            } header: {
                Text(L("In the bar"))
            } footer: {
                Text(L("Today stays first. Pick up to four more, in your order. Everything else is under More."))
            }
            if !rest.isEmpty {
                Section {
                    ForEach(rest) { a in
                        Button {
                            if mine.count >= AppArea.slots { full = true } else { mine.append(a); commit(mine) }
                        } label: {
                            HStack(spacing: Theme.Space.s3) {
                                Image(systemName: "plus.circle.fill").foregroundStyle(.green).font(.title3)
                                    .accessibilityHidden(true)
                                Label { Text(a.title).foregroundStyle(Theme.ink) } icon: { Image(systemName: a.icon).foregroundStyle(Theme.primary) }
                            }
                        }
                        .accessibilityLabel(LF("Put %@ into the bar", a.title))
                        .moveDisabled(true)
                        .deleteDisabled(true)
                    }
                } header: {
                    Text(L("Under More"))
                } footer: {
                    if full { Text(L("The bar is full. Take one out first.")).foregroundStyle(Theme.low) }
                }
            }
            Section {
                Text(prefs.offline ? L("Saved on this device. It goes to your other devices once you’re online.") : L("Same on all your devices."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
                if prefs.tabs != nil {
                    Button(L("Back to the start")) {
                        Task {
                            await prefs.save(nil, api: app.api)
                            mine = defaultTabs
                        }
                    }
                }
            }
        }
        .environment(\.editMode, .constant(.active))
        .themedList()
        .navigationTitle(L("Your bar"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { mine = (prefs.tabs ?? defaultTabs).filter { app.areaVisible($0) } }
    }

    /// what the bar shows without an own choice
    private var defaultTabs: [AppArea] { app.defaultBarAreas.filter { $0 != .today } }

    private func commit(_ next: [AppArea]) {
        full = false
        Task { await prefs.save(next, api: app.api) }
    }
}

/// A long press on the iPhone tab bar opens "Deine Leiste" – like holding an app icon. SwiftUI's TabView has no hook
/// for it, so a probe inside a tab finds the UITabBarController above it and adds one recognizer to its bar.
struct TabBarLongPress: UIViewRepresentable {
    let action: () -> Void

    func makeUIView(context: Context) -> Probe {
        let v = Probe()
        v.isUserInteractionEnabled = false
        v.action = action
        return v
    }

    func updateUIView(_ v: Probe, context: Context) { v.action = action }

    final class Probe: UIView {
        var action: (() -> Void)?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil else { return }
            DispatchQueue.main.async { [weak self] in self?.attach() }
        }

        private func attach() {
            var r: UIResponder? = self
            while let x = r, !(x is UITabBarController) { r = x.next }
            guard let bar = (r as? UITabBarController)?.tabBar else { return }
            if let g = bar.gestureRecognizers?.first(where: { $0.name == Recognizer.id }) as? Recognizer {
                g.action = action
                return
            }
            let g = Recognizer(target: nil, action: nil)
            g.name = Recognizer.id
            g.minimumPressDuration = 0.6
            g.action = action
            g.addTarget(g, action: #selector(Recognizer.fire))
            bar.addGestureRecognizer(g)
        }
    }

    final class Recognizer: UILongPressGestureRecognizer {
        static let id = "tohuus.bar.longpress"
        var action: (() -> Void)?

        @objc func fire() {
            guard state == .began else { return }
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            action?()
        }
    }
}

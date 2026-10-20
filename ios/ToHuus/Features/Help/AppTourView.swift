import SwiftUI

/// The tour of the iPhone app (13 Oct 2026): a few pages through what ToHuus does, shown once after signing in and
/// again whenever the tour gets a new version (new areas), always reachable in Einstellungen › Wissen. The last page
/// is the person's own choice about AI: the household assistant for themselves, and Apple Intelligence on this iPhone
/// – both can be changed later in Einstellungen › Mit oder ohne KI.
struct AppTourView: View {
    /// bump when the tour gets pages people who saw it should see
    /// 2 (15 Oct 2026): Im Kopf, Für wen ich da bin, Unterwegs, Wochenrückblick
    /// 3 (18 Oct 2026): short again – Deine Leiste, Demnächst, Rückgängig, Haushaltswissen, Assistent, Bring mir was
    /// 4 (20 Oct 2026, Paket B): five cards like the web – Leiste & Zuhause, Lupe & Mehr, Assistent (KI freiwillig,
    /// with the AI switches), Nur eins, Was nutzt ihr?
    static let version = 4
    static let seenKey = "tour.ios.version"

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page = 0
    @State private var onDevice = OnDeviceAI.chosen

    private struct Page: Identifiable {
        let id: String
        let symbol: String
        let title: String
        let body: String
    }

    /// five cards (Paket B, web: Tour.tsx steps) – the third one carries the person's AI choice
    private var pages: [Page] {
        [
            Page(id: "bar", symbol: "dock.rectangle", title: L("Your areas sit at the bottom"),
                 body: app.moduleOn("stock")
                    ? L("Today, Shopping, Cooking, Tasks and Home. Home holds the pantry, house info, household knowledge and “Where’s what?”. Press and hold the bar to swap areas.")
                    : L("Today, Shopping, Cooking and Tasks. Press and hold the bar to swap areas.")),
            Page(id: "more", symbol: "person.crop.circle", title: L("Top right: search and More"),
                 body: L("The magnifying glass finds every thing and every setting. Your picture opens More: money, people, settings and help.")),
            Page(id: "assistant", symbol: "sparkles", title: L("Just say what’s missing"), body: ""),
            Page(id: "one", symbol: "scope", title: L("Not a good day? Just one."),
                 body: L("“Just one” shows you one task at a time, the rest waits. Switch it on right on Today or in Settings › Me › Calm & focus.")),
            Page(id: "use", symbol: "square.grid.2x2", title: L("Too much? Switch off what you don’t need."),
                 body: L("Settings › Areas & places › What do you use? hides whole areas. You find this tour again under Help.")),
        ]
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $page) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                        Group {
                            if p.id == "assistant" { choice } else { card(p) }
                        }
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
                .animation(reduceMotion ? nil : Motion.standard, value: page)
                Button {
                    if page < pages.count - 1 { page += 1 } else { finish() }
                } label: {
                    Text(page < pages.count - 1 ? L("Next") : L("Let’s go"))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).tint(Theme.primary)
                .padding(.horizontal, Theme.Space.s5)
                .padding(.bottom, Theme.Space.s4)
            }
            .background(Theme.canvas)
            .toolbar {
                // skippable on every page, top right; swiping goes through the pages
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L("Skip")) { finish() }
                        .accessibilityLabel(L("Skip tour"))
                }
            }
        }
        .interactiveDismissDisabled(false)
    }

    private func card(_ p: Page) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Image(systemName: p.symbol)
                    .font(.system(size: 44, weight: .regular))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 88, height: 88)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
                    .accessibilityHidden(true)
                Text(p.title).font(Theme.title()).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(p.body).font(.body).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(Theme.Space.s5)
            .padding(.top, Theme.Space.s5)
        }
    }

    /// The third card: Plus and the assistant, and the person's own choice about AI (both later in Einstellungen ›
    /// Verbindungen & Geräte › KI). AI is optional – everything works without it.
    private var choice: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 88, height: 88)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
                    .accessibilityHidden(true)
                Text(L("Just say what’s missing")).font(Theme.title()).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(L("With Plus or the assistant at the bottom right: “milk is out” goes on the list. AI is optional – everything works without it, and you switch it in Settings › Connections & devices › AI."))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                if app.aiLocked {
                    Label(L("Switched off for you by an adult in the household."), systemImage: "lock.fill")
                        .foregroundStyle(Theme.ink2)
                } else {
                    if app.aiAvailable {
                        Toggle(isOn: Binding(get: { app.personalAI }, set: { on in Task { await app.setPersonalAI(on) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Use AI for me"))
                                Text(L("Free sentences to the assistant and cooking help, through Mistral in the EU."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    if OnDeviceAI.state != .notSupported {
                        Toggle(isOn: $onDevice) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Apple Intelligence on this iPhone"))
                                Text(L("Tidies up receipt photos and handwritten lists on this iPhone. Nothing leaves the device for this step."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .onChange(of: onDevice) { _, v in OnDeviceAI.chosen = v }
                    }
                }
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(Theme.Space.s5)
            .padding(.top, Theme.Space.s5)
        }
    }

    private func finish() {
        Self.markSeen()
        dismiss()
    }

    /// the tour comes once per version – finished, skipped or swiped away
    static func markSeen() {
        if UserDefaults.standard.integer(forKey: seenKey) < version { UserDefaults.standard.set(version, forKey: seenKey) }
    }

    /// shown once per tour version after signing in (not in UI tests or screenshot runs; -debugTour YES forces it)
    ///
    /// -debugNoTour wins over everything (20 Oct 2026): it used to be read only as `-debugNoTour YES`. Passed bare
    /// (`-debugNoTour -debugTab stock`), the argument domain took the next flag as its value, so the bool was false,
    /// and the following flag was lost as well – the tour came up in simulator runs. It was also checked after
    /// -debugTour, so a run that kept both forced the tour. Now the bare flag counts, anywhere in the arguments.
    static var due: Bool {
        let d = UserDefaults.standard
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-debugNoTour") && d.string(forKey: "debugNoTour").map({ !["NO", "0", "false"].contains($0) }) ?? true { return false }
        if d.bool(forKey: "debugNoTour") { return false }
        if d.bool(forKey: "debugTour") { return true }
        // simulator, UI test and screenshot runs sign in with -debugToken: no tour in the way
        if d.string(forKey: "debugToken") != nil { return false }
        return UserDefaults.standard.integer(forKey: seenKey) < version
    }
}

import SwiftUI

/// The tour of the iPhone app (13 Oct 2026): a few pages through what ToHuus does, shown once after signing in and
/// again whenever the tour gets a new version (new areas), always reachable in Einstellungen › Wissen. The last page
/// is the person's own choice about AI: the household assistant for themselves, and Apple Intelligence on this iPhone
/// – both can be changed later in Einstellungen › Mit oder ohne KI.
struct AppTourView: View {
    /// bump when the tour gets pages people who saw it should see
    /// 2 (15 Oct 2026): Im Kopf, Für wen ich da bin, Unterwegs, Wochenrückblick
    /// 3 (18 Oct 2026): short again – Deine Leiste, Demnächst, Rückgängig, Haushaltswissen, Assistent, Bring mir was
    static let version = 3
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

    /// six short pages (18 Oct 2026) – the rest of the app is found on the way; the AI choice comes last
    private var pages: [Page] {
        var p: [Page] = [
            Page(id: "bar", symbol: "dock.rectangle", title: L("Your bar, the way you need it"),
                 body: L("Today, Shopping, Cooking and Tasks sit at the bottom. Press and hold the bar (or Settings › Me › Your bar) to choose what goes there, like “Bring me something” or Knowledge. Everything else is under More.")),
            Page(id: "ahead", symbol: "calendar", title: L("Coming up: thought of in time"),
                 body: L("Under Today you see what is due in the next few days. The bin shows up the evening before, because that’s when it has to go out.")),
            Page(id: "undo", symbol: "arrow.uturn.backward", title: L("Ticked off by mistake?"),
                 body: L("Tap “Undo” right after. Later you find it in Tasks under “Recently done”.")),
        ]
        if app.moduleOn("knowledge") {
            p.append(Page(id: "knowledge", symbol: "brain", title: L("Household knowledge: write it down once"),
                          body: L("Mika’s shoe size, the filter for the cooker hood, where the main water tap is. What usually only one of you knows is there for everyone. Notes you already have come in with “Import”.")))
        }
        p.append(Page(id: "speak", symbol: "sparkles", title: L("Just tell the assistant"),
                      body: L("“Mira has the dentist on Tuesday at 3” goes into Tasks with the date, “Mika now wears shoe size 29” into Knowledge, “milk is out” onto the list. It tells you what it did, and everything can be undone.")))
        if !app.singleHousehold && app.moduleOn("treats") {
            p.append(Page(id: "treats", symbol: "hand.raised", title: L("Bring mir was"),
                          body: L("Ill on the sofa or your hands full? Ask for a tea in two taps, and someone at home says “I’ll bring it”.")))
        }
        return p
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $page) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                        card(p).tag(i)
                    }
                    choice.tag(pages.count)
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
                .animation(reduceMotion ? nil : Motion.standard, value: page)
                Button {
                    if page < pages.count { page += 1 } else { finish() }
                } label: {
                    Text(page < pages.count ? L("Next") : L("Let’s go"))
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

    /// The last page: the person decides about AI (both later in Einstellungen › Mit oder ohne KI).
    private var choice: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 88, height: 88)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
                    .accessibilityHidden(true)
                Text(L("AI: you decide")).font(Theme.title()).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(L("The list, suggestions, cooking and money work without any AI. You can change both switches later in Settings › Connections & devices › AI."))
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
    static var due: Bool {
        let d = UserDefaults.standard
        if d.bool(forKey: "debugTour") { return true }
        // simulator, UI test and screenshot runs sign in with -debugToken: no tour in the way
        if d.bool(forKey: "debugNoTour") || d.string(forKey: "debugToken") != nil { return false }
        return UserDefaults.standard.integer(forKey: seenKey) < version
    }
}

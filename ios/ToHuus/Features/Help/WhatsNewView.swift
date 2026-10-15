import SwiftUI

/// GET /api/whats-new → { latest, seen, entries: [{ id, title, items: [{ text, to }] }] } – newest first, only what
/// this person hasn't seen (server: routes/onboard.ts; web: changelog.ts). People who joined after the latest
/// release get no entries.
struct WhatsNew: Decodable, Sendable, Identifiable {
    struct Entry: Decodable, Sendable, Identifiable, Hashable {
        struct Item: Decodable, Sendable, Hashable {
            var text: String
            /// a web path ("/kochen", "/aufgaben") – opened where the app has the same place
            var to: String?
        }
        var id: String
        var title: String
        @Lossy var items: [Item]
    }
    var latest: String?
    var seen: String?
    @Lossy var entries: [Entry]
    var id: String { latest ?? "whats-new" }
}

extension APIClient {
    func whatsNew() async throws -> WhatsNew { try await get("api/whats-new") }
    /// PUT /api/me/prefs/whats-new { seen } – never goes backwards on the server (two devices)
    func whatsNewSeen(_ seen: String) async throws {
        _ = try await send("PUT", "api/me/prefs/whats-new", json: ["seen": seen], as: Ignored.self)
    }
}

/// "Was ist neu" (beta, 15 Oct 2026): a short sheet after the tour on app start or when the app comes back, while the
/// server has entries this person hasn't seen. "Alles klar" marks them seen. Never over the tour, never for guests.
struct WhatsNewSheet: View {
    let data: WhatsNew
    let api: APIClient
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s5) {
                    Text(L("Thanks for testing ToHuus. This changed since you last looked:"))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(data.entries) { e in
                        VStack(alignment: .leading, spacing: Theme.Space.s2) {
                            Text(e.title).font(.headline).foregroundStyle(Theme.ink)
                                .accessibilityAddTraits(.isHeader)
                            ForEach(Array(e.items.enumerated()), id: \.offset) { _, i in item(i) }
                        }
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(Theme.Space.s5)
                .frame(maxWidth: .infinity)
            }
            .canvasBackground()
            .safeAreaInset(edge: .bottom) {
                Button { Task { await seen(); dismiss() } } label: {
                    Text(L("Got it")).frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent).tint(Theme.primary)
                .padding(.horizontal, Theme.Space.s5)
                .padding(.vertical, Theme.Space.s3)
                .background(Theme.canvas)
            }
            .navigationTitle(L("What’s new"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Later")) { dismiss() } }
            }
        }
    }

    @ViewBuilder private func item(_ i: WhatsNew.Entry.Item) -> some View {
        let row = HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
            Image(systemName: "sparkle").font(.caption).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
            Text(i.text).font(.subheadline).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        if let tab = Self.tab(for: i.to) {
            Button {
                Task { await seen() }
                app.requestedTab = tab
                dismiss()
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    row
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3).accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(L("Opens the place in the app"))
        } else {
            row.accessibilityElement(children: .combine)
        }
    }

    /// web paths → the app's tabs (MainTabView.applyRequestedTab); anything else is just text
    static func tab(for path: String?) -> String? {
        guard let p = path?.split(separator: "?").first.map(String.init) else { return nil }
        switch p {
        case "/": return "today"
        case "/einkauf": return "shopping"
        case "/kochen", "/woche": return "cooking"
        case "/aufgaben", "/kopf", "/pflege", "/fuer-wen": return "tasks"
        case "/bestand": return "stock"
        case "/geld", "/ausgaben": return "money"
        default: return nil
        }
    }

    private func seen() async {
        guard let latest = data.latest else { return }
        try? await api.whatsNewSeen(latest)
    }
}

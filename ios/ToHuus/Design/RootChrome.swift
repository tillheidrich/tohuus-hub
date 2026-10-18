import SwiftUI

/// The two buttons at the top right of every root screen (UX benchmark 2.1/2.4): search everything, and the avatar
/// that opens Mehr – so Mehr is one tap away everywhere, not only on Heute.
private struct RootChrome: ViewModifier {
    @Environment(AppModel.self) private var app
    /// an area opened as a sheet (Geld from Mehr on the iPhone, MainTabView)
    @Environment(\.closeArea) private var closeArea

    func body(content: Content) -> some View {
        content.toolbar {
            if let closeArea {
                ToolbarItem(placement: .topBarLeading) { Button(L("Done")) { closeArea() } }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { app.showSearch = true } label: { Image(systemName: "magnifyingglass") }
                    .accessibilityLabel(L("Search"))
                    .keyboardShortcut("k", modifiers: .command)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { app.showMore = true } label: {
                    PersonAvatar(name: app.userName ?? "?", size: 30, api: app.api)
                }
                .accessibilityLabel(L("More"))
                .accessibilityHint(L("Settings, people, guests …"))
            }
        }
    }
}

extension View {
    /// search + Mehr in the navigation bar of a tab's root screen
    func rootChrome() -> some View { modifier(RootChrome()) }
}

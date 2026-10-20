import SwiftUI

/// Bereichsseiten (UX audit 2026-10, Paket E; web: web/src/area/AreaTools.tsx): one main action stays in the toolbar,
/// everything rarer sits in one labelled menu „Werkzeuge“ – never a bare „…“. Same on Einkauf, Kochen, Aufgaben,
/// Zuhause and Geld. Empty states use `EmptyStateView` with one sentence and one button, no extra message.
struct AreaToolsMenu<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        Menu {
            content()
        } label: {
            // word and symbol: a toolbar would show a bare symbol for a Label
            HStack(spacing: 5) {
                Image(systemName: "wrench.and.screwdriver")
                Text(L("Tools"))
            }
            .font(.subheadline.weight(.semibold))
            .accessibilityElement(children: .combine)
        }
        .accessibilityLabel(L("Tools"))
        .hoverEffect(.highlight)
    }
}

/// Labelled tiles under a list (Aufgaben › Kopf & Fairness), two per row on the iPhone.
struct AreaTile: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    let action: () -> Void
}

struct AreaTiles: View {
    let title: String
    let tiles: [AreaTile]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(title).font(Theme.title(22)).foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Theme.Space.s2)], spacing: Theme.Space.s2) {
                ForEach(tiles) { t in
                    Button(action: t.action) {
                        HStack(spacing: Theme.Space.s2) {
                            Image(systemName: t.systemImage)
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Theme.primaryText)
                                .frame(width: 34, height: 34)
                                .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            Text(t.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, Theme.Space.s3)
                        .frame(minHeight: 56)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
        }
    }
}

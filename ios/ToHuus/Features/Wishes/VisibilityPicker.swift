import SwiftUI

/// "Wer sieht das?" for whole lists (shopping lists and wish lists, 13 Oct 2026): everyone, only me, or me and
/// chosen people. Guests are never offered (the server drops them as well). `exclude` keeps someone out (the person
/// a wish list is for).
struct VisibilityPicker: View {
    @Binding var visibility: String
    @Binding var shareWith: [Int]
    let members: [Member]
    let meId: Int?
    var exclude: [Int] = []
    var hint: String?

    private var others: [Member] { members.filter { $0.id != meId && $0.kind != "guest" && !exclude.contains($0.id) } }

    var body: some View {
        Picker(L("Who sees it?"), selection: $visibility) {
            Text(L("Everyone")).tag("household")
            Text(L("Only me")).tag("private")
            Text(L("Chosen people")).tag("people")
        }
        .pickerStyle(.segmented)
        .accessibilityLabel(L("Who sees it?"))
        if visibility == "people" {
            if others.isEmpty {
                Text(L("Nobody else with an own account yet.")).font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(others) { m in
                Button {
                    if shareWith.contains(m.id) { shareWith.removeAll { $0 == m.id } } else { shareWith.append(m.id) }
                } label: {
                    HStack {
                        AvatarView(name: m.name, color: m.color, size: 26)
                        Text(m.name).foregroundStyle(Theme.ink)
                        Spacer()
                        if shareWith.contains(m.id) { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .accessibilityAddTraits(shareWith.contains(m.id) ? .isSelected : [])
            }
        }
        if visibility != "household" {
            Text(hint ?? L("Everyone else doesn’t see this list – not on Today, not in notifications, not via the assistant, Home Assistant or exports. Guests never see it."))
                .font(.footnote).foregroundStyle(Theme.ink3)
        }
    }
}

/// Small label for a list's visibility ("Nur du", "Du + 2", "Von Sam").
func visibilityLabel(_ v: String?, shareWith: [Int]?, owner: String?, mine: Bool?) -> String {
    let v = v ?? "household"
    if v == "household" { return L("Everyone") }
    if mine == false, let owner { return LF("From %@", owner) }
    if v == "private" || (shareWith ?? []).isEmpty { return L("Only you") }
    return LF("You + %d", (shareWith ?? []).count)
}

func visibilitySymbol(_ v: String?) -> String? {
    switch v {
    case "private": return "lock.fill"
    case "people": return "person.2.fill"
    default: return nil
    }
}

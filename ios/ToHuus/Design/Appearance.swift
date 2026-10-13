import SwiftUI

/// Light / dark per device (13 Oct 2026 feedback: "es gibt keine Einstellung, wo ich zwischen Hell und Dunkel wählen
/// kann"). Stored in UserDefaults under `appearance`, applied once at the root (`ToHuusApp`) – that sets the whole
/// window, sheets and full-screen covers included. Reachable in Settings › Erscheinungsbild and in kitchen mode.
enum AppAppearance: String, CaseIterable, Identifiable {
    case system, light, dark

    static let storageKey = "appearance"

    var id: String { rawValue }

    /// nil = follow the device
    var scheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var title: String {
        switch self {
        case .system: return L("Like the device")
        case .light: return L("Light")
        case .dark: return L("Dark")
        }
    }

    var icon: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light: return "sun.max"
        case .dark: return "moon"
        }
    }
}

/// The picker used in Settings and in kitchen mode.
struct AppearancePicker: View {
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system.rawValue

    var body: some View {
        Picker(selection: $appearance) {
            ForEach(AppAppearance.allCases) { a in
                Label(a.title, systemImage: a.icon).tag(a.rawValue)
            }
        } label: {
            Label(L("Appearance"), systemImage: "circle.lefthalf.filled")
        }
    }
}

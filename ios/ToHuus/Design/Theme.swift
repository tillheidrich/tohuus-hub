import SwiftUI
import UIKit

/// Brand tokens mirrored from web/src/styles.css (:root and :root[data-theme='dark']). Keep both in step.
enum Theme {
    // palette – light / dark
    static let canvas = dynamic(0xF7F5EF, 0x0F1513)
    static let surface = dynamic(0xFFFDF9, 0x17201C)
    static let surface2 = dynamic(0xEFEBE2, 0x1E2924)
    static let surface3 = dynamic(0xE5DFD3, 0x26332D)
    static let ink = dynamic(0x181D1A, 0xEEF0EA)
    static let ink2 = dynamic(0x545C56, 0xB3BDB6)
    static let ink3 = dynamic(0x626A64, 0x939E97)
    static let line = dynamic(0xDEDCD3, 0x28332E)
    static let lineStrong = dynamic(0x7E7D74, 0x6E7A73)
    static let primary = dynamic(0x176B50, 0x277C5B)
    static let primaryDark = dynamic(0x104E3C, 0x20684C)
    static let primarySoft = dynamic(0xE4EEE6, 0x1C3229)
    static let primaryText = dynamic(0x176B50, 0x74CDA2)
    /// the app-wide tint (text buttons, links, toggles): readable on canvas and surface in both modes.
    /// Filled buttons set `.tint(Theme.primary)` so white text stays readable on them.
    static let accent = dynamic(0x176B50, 0x74CDA2)
    static let onPrimary = dynamic(0xFFFDF9, 0xF7F5EF)
    static let sage = dynamic(0xA5BAA9, 0x50665A)
    static let sand = dynamic(0xEDE4D5, 0x2E2A22)
    static let clay = dynamic(0xC56B4B, 0xE08A68)
    static let mustard = dynamic(0xE8B865, 0xD9A94F)
    static let warning = dynamic(0x926000, 0xE4B05A)
    static let warningSoft = dynamic(0xF8EFDC, 0x2E2717)
    static let low = dynamic(0xA04B2B, 0xE39A7B)
    static let lowSoft = dynamic(0xF6E5DC, 0x33241D)
    static let empty = dynamic(0x9E2F24, 0xE58A7E)
    static let emptySoft = dynamic(0xF7E1DC, 0x35201C)
    /// "Can’t right now" / decline: reads as a no, next to the green "I’ll bring it"
    static let decline = empty
    static let info = dynamic(0x2F5E7A, 0x8DBAD6)
    static let infoSoft = dynamic(0xE2ECF1, 0x1A2A33)
    static let block = dynamic(0x104E3C, 0x163A2E)
    static let onBlock = dynamic(0xF7F5EF, 0xF7F5EF)

    // type sizes (px in the web, pt here)
    enum FontSize {
        static let xs: CGFloat = 12
        static let s: CGFloat = 14
        static let m: CGFloat = 16
        static let row: CGFloat = 17
        static let l: CGFloat = 20
        static let h2: CGFloat = 22
        static let h1: CGFloat = 28
    }

    // 4 pt grid
    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 20
        static let s6: CGFloat = 24
        static let s8: CGFloat = 32
        static let s10: CGFloat = 40
    }

    // modest radii – arches and circles are the signature, not big radii
    enum Radius {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 6
        static let base: CGFloat = 10
        static let lg: CGFloat = 14
    }

    static let stroke: CGFloat = 1.5

    /// Serif titles that follow Dynamic Type: the token size picks the text style of the same default size
    /// (28 → .title, 22 → .title2, 20 → .title3, 17 → .body …), so XXXL and the accessibility sizes scale them.
    static func title(_ size: CGFloat = FontSize.h1) -> Font { .system(textStyle(for: size), design: .serif, weight: .semibold) }
    static let rowFont = Font.body
    /// big numbers (totals, counts) – scale with Dynamic Type from the large title size
    static func number(_ design: Font.Design = .rounded) -> Font { .system(.largeTitle, design: design, weight: .semibold) }

    static func textStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case 30...: return .largeTitle
        case 25..<30: return .title
        case 21..<25: return .title2
        case 19..<21: return .title3
        case 17..<19: return .body
        case 16..<17: return .callout
        case 14..<16: return .subheadline
        case 13..<14: return .footnote
        case 12..<13: return .caption
        default: return .caption2
        }
    }

    private static func dynamic(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { traits in traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

/// Status colours never stand alone: always text + a shape marker (web rule).
enum StatusStyle {
    static func colors(_ status: String?) -> (fg: Color, bg: Color)? {
        switch status {
        case "low": return (Theme.low, Theme.lowSoft)
        case "empty", "expired": return (Theme.empty, Theme.emptySoft)
        case "expiring": return (Theme.warning, Theme.warningSoft)
        default: return nil
        }
    }
}

import Foundation
import UIKit

/// "Feedback senden" for testers: a mail to the instance's support address with version, build, iOS and the first
/// characters of the household id prefilled, so a report can be matched with the error log (Settings › Fehlerprotokoll).
enum FeedbackMail {
    @MainActor
    static func url(instance: InstanceInfo?, household: String?) -> URL? {
        guard let to = instance?.support, to.contains("@") else { return nil }
        var c = URLComponents()
        c.scheme = "mailto"
        c.path = to
        let device = UIDevice.current
        let body = "\n\n\n–––\nToHuus \(ErrorLog.appVersion) · \(device.systemName) \(device.systemVersion) · \(device.model)"
            + (household.map { " · \(String($0.prefix(8)))" } ?? "")
        c.queryItems = [URLQueryItem(name: "subject", value: L("Feedback on ToHuus")), URLQueryItem(name: "body", value: body)]
        return c.url
    }
}

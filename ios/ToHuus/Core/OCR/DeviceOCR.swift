import Foundation
import UIKit
import Vision

/// Text recognition on the iPhone (Apple Vision) – for receipts and handwritten/printed paper lists when the household
/// has no AI, or as a first pass. Nothing is sent anywhere by this type.
enum DeviceOCR {
    struct Fragment: Sendable {
        let text: String
        let box: CGRect
    }

    /// Recognised lines, top to bottom. Pieces on the same height (item left, price right) become one line.
    static func lines(in image: UIImage) async throws -> [String] {
        guard let cg = image.cgImage else { return [] }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        let fragments = try await Task.detached(priority: .userInitiated) { () throws -> [Fragment] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["de-DE", "en-US"]
            request.usesLanguageCorrection = true
            // perform() runs the request synchronously on this background task
            try VNImageRequestHandler(cgImage: cg, orientation: orientation).perform([request])
            return (request.results ?? []).compactMap { o in
                o.topCandidates(1).first.map { Fragment(text: $0.string, box: o.boundingBox) }
            }
        }.value
        return merge(fragments)
    }

    /// Pure and unit-tested: groups fragments whose vertical centres are close into one line, left to right.
    static func merge(_ fragments: [Fragment]) -> [String] {
        // Vision's boxes are normalised with the origin at the bottom left
        let sorted = fragments.sorted { $0.box.midY > $1.box.midY }
        var rows: [[Fragment]] = []
        for f in sorted {
            if let last = rows.last?.first, abs(last.box.midY - f.box.midY) < max(last.box.height, f.box.height) * 0.5 {
                rows[rows.count - 1].append(f)
            } else {
                rows.append([f])
            }
        }
        return rows.map { row in
            row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: "  ")
        }
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    }

    /// A paper shopping list: drops headings, prices and dates, keeps the things to buy.
    static func listItems(_ lines: [String]) -> [String] {
        lines.compactMap { line in
            var s = line.trimmingCharacters(in: .whitespaces)
            s = s.replacingOccurrences(of: #"^[\-\*•·–☐□○o]\s*"#, with: "", options: .regularExpression)
            s = s.replacingOccurrences(of: #"^\[\s?[xX ]?\s?\]\s*"#, with: "", options: .regularExpression)
            guard s.count >= 2, s.count <= 60 else { return nil }
            if s.range(of: #"^\d{1,2}[./]\d{1,2}([./]\d{2,4})?$"#, options: .regularExpression) != nil { return nil }
            if s.range(of: #"^[\d\s.,€-]+$"#, options: .regularExpression) != nil { return nil }
            let lower = s.lowercased()
            if ["einkaufsliste", "einkauf", "liste", "shopping list", "to buy"].contains(lower.trimmingCharacters(in: CharacterSet(charactersIn: ":"))) { return nil }
            return s
        }
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}

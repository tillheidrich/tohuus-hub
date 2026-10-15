import SwiftUI
import UIKit

/// "Bild wählen": square crop for a profile picture – drag to move, pinch or slide to zoom, saved as a 512 px JPEG
/// (web: people/People.tsx CropSheet; the server stores it via lib/images.ts).
struct PhotoCropSheet: View {
    let image: UIImage
    /// gets the finished JPEG; returns true when it was saved
    let onUse: (Data) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1
    @State private var zoomStart: CGFloat?
    @State private var offset: CGPoint = .zero
    @State private var dragStart: CGPoint?
    @State private var busy = false
    @State private var ready = false

    private let side: CGFloat = 280
    private let output: CGFloat = 512

    private var baseScale: CGFloat {
        let s = image.size
        guard s.width > 0, s.height > 0 else { return 1 }
        return side / min(s.width, s.height)
    }
    private var scale: CGFloat { baseScale * zoom }
    private var shown: CGSize { CGSize(width: image.size.width * scale, height: image.size.height * scale) }

    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.Space.s5) {
                ZStack(alignment: .topLeading) {
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: shown.width, height: shown.height)
                        .offset(x: offset.x, y: offset.y)
                }
                .frame(width: side, height: side, alignment: .topLeading)
                .clipped()
                .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 2).padding(2))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { g in
                            let s = dragStart ?? offset
                            if dragStart == nil { dragStart = offset }
                            offset = clamp(CGPoint(x: s.x + g.translation.width, y: s.y + g.translation.height), scale)
                        }
                        .onEnded { _ in dragStart = nil }
                        .simultaneously(with: MagnificationGesture()
                            .onChanged { v in
                                let start = zoomStart ?? zoom
                                if zoomStart == nil { zoomStart = zoom }
                                setZoom(min(3, max(1, start * v)))
                            }
                            .onEnded { _ in zoomStart = nil })
                )
                .accessibilityLabel(L("Picture preview"))

                VStack(spacing: Theme.Space.s2) {
                    Slider(value: Binding(get: { zoom }, set: { setZoom($0) }), in: 1...3) {
                        Text(L("Zoom"))
                    } minimumValueLabel: {
                        Image(systemName: "minus.magnifyingglass").accessibilityHidden(true)
                    } maximumValueLabel: {
                        Image(systemName: "plus.magnifyingglass").accessibilityHidden(true)
                    }
                    .frame(maxWidth: side + 40)
                    Text(L("Drag to move, slide to zoom.")).font(.footnote).foregroundStyle(Theme.ink3)
                }

                Button {
                    Task { await use() }
                } label: {
                    if busy { ProgressView().tint(Theme.onPrimary) } else { Text(L("Use this picture")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy)
                .frame(maxWidth: 360)
                Spacer(minLength: 0)
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: .infinity)
            .canvasBackground()
            .navigationTitle(L("Choose the picture"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .onAppear {
                guard !ready else { return }
                ready = true
                // centred to start with
                offset = CGPoint(x: (side - shown.width) / 2, y: (side - shown.height) / 2)
            }
        }
    }

    private func clamp(_ o: CGPoint, _ s: CGFloat) -> CGPoint {
        let w = image.size.width * s, h = image.size.height * s
        return CGPoint(x: min(0, max(side - w, o.x)), y: min(0, max(side - h, o.y)))
    }

    /// zoom around the middle of the square (like the web)
    private func setZoom(_ z: CGFloat) {
        let before = scale
        let after = baseScale * z
        let cx = (side / 2 - offset.x) / before
        let cy = (side / 2 - offset.y) / before
        zoom = z
        offset = clamp(CGPoint(x: side / 2 - cx * after, y: side / 2 - cy * after), after)
    }

    private func use() async {
        busy = true
        defer { busy = false }
        let k = output / side
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let rect = CGRect(x: offset.x * k, y: offset.y * k, width: shown.width * k, height: shown.height * k)
        let img = UIGraphicsImageRenderer(size: CGSize(width: output, height: output), format: format).image { _ in
            image.draw(in: rect)
        }
        guard let jpeg = img.jpegData(compressionQuality: 0.88) else { return }
        if await onUse(jpeg) { dismiss() }
    }
}

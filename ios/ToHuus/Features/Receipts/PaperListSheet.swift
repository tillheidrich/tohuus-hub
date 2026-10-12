import PhotosUI
import SwiftUI
import VisionKit

/// "Zettel abfotografieren": a handwritten or printed shopping list → text on the iPhone (Apple Vision, no AI) →
/// choose the lines → onto the shared list (offline queue, like typing them).
struct PaperListSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var showScanner = false
    @State private var photo: PhotosPickerItem?
    @State private var lines: [Line] = []
    @State private var reading = false
    @State private var error: String?

    struct Line: Identifiable {
        let id = UUID()
        var text: String
        var on = true
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if VNDocumentCameraViewController.isSupported {
                        Button { showScanner = true } label: { Label(L("Take a photo of the list"), systemImage: "camera") }
                    }
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label(L("Choose a photo"), systemImage: "photo")
                    }
                } footer: {
                    Text(L("The text is read on this iPhone. Only the lines you choose go onto the list."))
                }
                if reading { HStack { ProgressView(); Text(L("Reading …")) } }
                if let error { Text(error).foregroundStyle(Theme.empty) }
                if !lines.isEmpty {
                    Section {
                        ForEach($lines) { $line in
                            Toggle(isOn: $line.on) {
                                TextField("", text: $line.text)
                            }
                        }
                    } header: {
                        Text(LF("%d lines found", lines.count))
                    }
                }
            }
            .navigationTitle(L("Paper list"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Onto the list")) { addChosen() }
                        .disabled(!lines.contains { $0.on })
                }
            }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScanner { images in
                    showScanner = false
                    Task { await read(images) }
                } onCancel: { showScanner = false }
                    .ignoresSafeArea()
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { await read([img]) }
                    photo = nil
                }
            }
        }
    }

    private func read(_ images: [UIImage]) async {
        reading = true
        defer { reading = false }
        var all: [String] = []
        for img in images { all += (try? await DeviceOCR.lines(in: img)) ?? [] }
        let items = DeviceOCR.listItems(all)
        lines = items.map { Line(text: $0) }
        error = items.isEmpty ? L("No text found on the photo. Try again in better light.") : nil
    }

    private func addChosen() {
        let chosen = lines.filter(\.on).map(\.text).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        Task {
            // one line per row – the same path as typing, so it also works offline
            for line in chosen { await store.add(text: line) }
            Haptics.success()
        }
        dismiss()
    }
}

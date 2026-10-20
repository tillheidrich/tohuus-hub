import PhotosUI
import SwiftUI

/// "Schrank / Gefriere" photo mode (web: Imports.tsx photo › Cupboard / freezer): photograph a shelf, the server's image
/// model lists what it sees, everything lands as an import to check – nothing gets booked blindly. Optional place, so the
/// lines already know where they go. Needs an image model on the server (GET /api/me features.vision).
struct StocktakeSheet: View {
    let store: ServerStore
    /// opens the import to check after the upload
    var onImported: (Int) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var places: [Place] = []
    @State private var placeId: Int?
    @State private var vision: Bool?
    @State private var photos: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("Recognised products land in a list for you to check – nothing gets booked blindly."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                if vision == false {
                    Section {
                        Label(L("No image model is set up on this server. Send the photo to Claude or ChatGPT and say “add this to ToHuus” – you’ll find the connection under Settings › Connections & devices › AI assistants & access."),
                              systemImage: "cpu")
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                if !places.isEmpty {
                    Section {
                        FlowLayout(spacing: 6) {
                            ForEach(places) { p in
                                ChoiceChip(title: p.path ?? p.name, systemImage: "mappin", on: placeId == p.id) { placeId = placeId == p.id ? nil : p.id }
                            }
                        }
                        .padding(.vertical, 4)
                    } header: { Text(L("Which place is it?")) } footer: { Text(L("Optional – the lines then already know where they go.")) }
                }
                Section {
                    if CameraPicker.available {
                        Button { showCamera = true } label: { Label(L("Take a photo"), systemImage: "camera") }
                            .disabled(busy || vision == false)
                    }
                    PhotosPicker(selection: $photos, maxSelectionCount: 8, matching: .images) {
                        Label(L("Choose photos"), systemImage: "photo.on.rectangle")
                    }
                    .disabled(busy || vision == false)
                }
                if busy { Section { HStack { ProgressView(); Text(L("Reading …")).foregroundStyle(Theme.ink2) } } }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Cupboard / freezer"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task {
                async let p = store.api.places()
                async let m = store.api.meExtras()
                places = ((try? await p) ?? []).filter { $0.system != true }
                vision = (try? await m)?.vision
            }
            .onChange(of: photos) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    var datas: [Data] = []
                    for item in items {
                        if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d), let j = img.jpegData(compressionQuality: 0.8) { datas.append(j) }
                    }
                    photos = []
                    await upload(datas)
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { img in
                    showCamera = false
                    if let img, let j = img.jpegData(compressionQuality: 0.8) { Task { await upload([j]) } }
                }
                .ignoresSafeArea()
            }
        }
    }

    private func upload(_ images: [Data]) async {
        guard !images.isEmpty else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let r = try await store.api.uploadStocktake(images: images, locationId: placeId)
            store.touch("imports")
            if let e = r.results.first(where: { $0.error != nil })?.error { error = e }
            if let id = r.results.first(where: { $0.id != nil })?.id {
                Haptics.success()
                dismiss()
                onImported(id)
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// "Text" import (web: Imports.tsx mode text): a few lines like "2x Mio Mio Mate" are matched to products and land as an
/// import to check – handy for a delivery note or a list from a chat.
struct TextImportSheet: View {
    let store: ServerStore
    var onImported: (Int) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 160)
                        .focused($focused)
                        .overlay(alignment: .topLeading) {
                            if text.isEmpty {
                                Text(L("2x Mio Mio Mate\nParcel tape\n3 cans of tomatoes"))
                                    .foregroundStyle(Theme.ink3).padding(.top, 8).padding(.leading, 5).allowsHitTesting(false)
                            }
                        }
                } footer: { Text(L("One thing per line. ToHuus matches them with your products – you check before anything is booked.")) }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Text"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await send() } } label: { if busy { ProgressView() } else { Text(L("Match")) } }
                        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }

    private func send() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.importText(text)
            store.touch("imports")
            if let e = r.results.first(where: { $0.error != nil })?.error { error = e; return }
            if let id = r.results.first(where: { $0.id != nil })?.id {
                Haptics.success()
                dismiss()
                onImported(id)
            } else {
                error = L("Nothing found to match.")
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

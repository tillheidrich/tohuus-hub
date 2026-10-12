import PhotosUI
import SwiftUI

/// One row of the list: note, substitute rule and a photo of the wanted product, plus who added it and when.
struct ItemDetailSheet: View {
    let item: ShopItem
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var substitute = "unset"
    @State private var photo: PhotosPickerItem?
    @State private var photoMissing = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text([item.qtyLabel, item.productName ?? item.text].compactMap { $0 }.joined(separator: " ")).font(.headline)
                    Text(item.originLine).font(.footnote).foregroundStyle(Theme.ink3)
                }
                Section(L("Note")) {
                    TextField(L("e.g. the big pack, lactose-free"), text: $note, axis: .vertical)
                        .lineLimit(1...3)
                }
                Section {
                    Picker(L("If it's not there"), selection: $substitute) {
                        Text(L("Not set")).tag("unset")
                        Text(L("Substitute is fine")).tag("ok")
                        Text(L("Ask first")).tag("ask")
                        Text(L("Exactly this one")).tag("exact")
                    }
                } header: {
                    Text(L("Substitute"))
                } footer: {
                    Text(L("A wish like “rather oat milk” goes into the note."))
                }
                Section {
                    if let p = item.photoPath {
                        RemoteImage(url: store.api.imageURL(p), api: store.api)
                            .frame(height: 160)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                    if item.id > 0 {
                        PhotosPicker(selection: $photo, matching: .images) {
                            Label(item.photoPath == nil ? L("Add a photo of the product") : L("Replace the photo"), systemImage: "camera")
                        }
                        if item.photoPath != nil {
                            Button(L("Remove the photo"), role: .destructive) {
                                Task {
                                    try? await store.api.deleteItemPhoto(item.id)
                                    await store.refreshList()
                                    dismiss()
                                }
                            }
                        }
                    }
                    if photoMissing {
                        Text(L("Your server can't keep photos for list rows yet.")).font(.footnote).foregroundStyle(Theme.ink3)
                    }
                } header: {
                    Text(L("Photo"))
                } footer: {
                    Text(L("So whoever shops picks the right one."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(L("Details"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(busy || item.id < 0)
                }
            }
            .onAppear {
                note = item.note ?? ""
                substitute = item.substitute ?? "unset"
            }
            .onChange(of: photo) { _, p in
                guard let p else { return }
                Task { await upload(p) }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let n = note.trimmingCharacters(in: .whitespaces)
            try await store.api.updateItem(item.id, note: n.isEmpty ? nil : n, substitute: substitute == "unset" ? nil : substitute)
            store.touch("shopping")
            await store.refreshList()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func upload(_ p: PhotosPickerItem) async {
        guard let data = try? await p.loadTransferable(type: Data.self),
              let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.7) else { return }
        busy = true
        defer { busy = false }
        do {
            try await store.api.uploadItemPhoto(item.id, jpeg: jpeg)
            await store.refreshList()
        } catch APIError.notFound {
            photoMissing = true
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

import PhotosUI
import SwiftUI

/// Create or edit a whole recipe natively (web: Cook.tsx "Leer" + Recipe.tsx RecipeEditor), but with real rows
/// instead of one text box: ingredients with "always at home", steps with section and appliance settings, tags as
/// chips, photo. "Paste several lines" turns a copied list into rows. Body = PUT/POST /api/recipes (recipeSchema).
struct RecipeEditorView: View {
    let store: ServerStore
    /// nil = a new, blank recipe
    var recipe: RecipeFull?
    var onSaved: (Int) -> Void = { _ in }
    var onDeleted: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    struct IngredientRow: Identifiable, Equatable {
        var id = UUID()
        var text = ""
        var pantry = false
        var optional = false
        /// carried over while the text is unchanged (the server matched it to a product)
        var original: RecipeFull.Ingredient?
    }

    struct StepRow: Identifiable, Equatable {
        var id = UUID()
        var text = ""
        var section = ""
        var device = ""
        var time = ""
        var temp = ""
        var speed = ""
        var mode = ""
        var showSettings = false
        var hasSettings: Bool { ![device, time, temp, speed, mode].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }

    enum Field: Hashable { case title, tag, ingredient(UUID), step(UUID) }

    @State private var title = ""
    @State private var desc = ""
    @State private var servings: Int?
    @State private var minutes = ""
    @State private var thermomix = false
    @State private var tags: [String] = []
    @State private var newTag = ""
    @State private var ingredients: [IngredientRow] = []
    @State private var steps: [StepRow] = []
    @State private var notes = ""
    @State private var source = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var confirmDiscard = false
    @State private var pasteTarget: PasteTarget?
    @State private var filled = false
    @State private var initial = ""
    @FocusState private var focus: Field?

    enum PasteTarget: String, Identifiable { case ingredients, steps; var id: String { rawValue } }

    private var isNew: Bool { recipe == nil }
    private var fingerprint: String {
        [title, desc, String(servings ?? 0), minutes, String(thermomix), tags.joined(separator: "|"), notes, source,
         ingredients.map { "\($0.text)\($0.pantry)\($0.optional)" }.joined(separator: "|"),
         steps.map { "\($0.text)\($0.section)\($0.device)\($0.time)\($0.temp)\($0.speed)\($0.mode)" }.joined(separator: "|"),
         photo == nil ? "" : "photo"].joined(separator: "§")
    }
    private var dirty: Bool { filled && fingerprint != initial }
    private var canSave: Bool { !busy && !title.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                photoSection
                basics
                ingredientSection
                stepSection
                Section {
                    TextField(L("Notes"), text: $notes, axis: .vertical).lineLimit(2...6)
                    TextField(L("Source (link)"), text: $source)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text(L("Notes and source")) }
                if let error { Section { Text(error).foregroundStyle(Theme.low) } }
                if !isNew {
                    Section {
                        Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete recipe"), systemImage: "trash") }
                    }
                }
            }
            .themedList()
            .navigationTitle(isNew ? L("New recipe") : L("Edit recipe"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Cancel")) { if dirty { confirmDiscard = true } else { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? L("Create") : L("Save")) { Task { await save() } }
                        .disabled(!canSave)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(L("Done")) { focus = nil }
                }
            }
            .interactiveDismissDisabled(dirty)
            .confirmationDialog(L("Delete recipe?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
            .confirmationDialog(L("Discard your changes?"), isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button(L("Discard"), role: .destructive) { dismiss() }
                Button(L("Keep editing"), role: .cancel) {}
            }
            .sheet(item: $pasteTarget) { t in
                PasteLinesSheet(target: t) { lines in
                    if t == .ingredients {
                        ingredients.removeAll { $0.text.trimmingCharacters(in: .whitespaces).isEmpty }
                        ingredients += lines.map { IngredientRow(text: $0) }
                    } else {
                        steps.removeAll { $0.text.trimmingCharacters(in: .whitespaces).isEmpty }
                        steps += lines.map { StepRow(text: $0) }
                    }
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) { photo = img }
                }
            }
            .onAppear(perform: fill)
        }
    }

    // MARK: sections

    private var photoSection: some View {
        Section {
            PhotosPicker(selection: $photoItem, matching: .images) {
                ZStack {
                    if let photo {
                        Image(uiImage: photo).resizable().scaledToFill()
                    } else if let p = recipe?.imagePath {
                        RemoteImage(url: store.api.imageURL(p), api: store.api, placeholder: "fork.knife")
                    } else {
                        VStack(spacing: 6) {
                            Image(systemName: "camera").font(.title2)
                            Text(L("Add photo")).font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(Theme.primaryText)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Theme.surface2)
                    }
                }
                .frame(height: photo != nil || recipe?.imagePath != nil ? 180 : 96)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                .overlay(alignment: .bottomTrailing) {
                    if photo != nil || recipe?.imagePath != nil {
                        Image(systemName: "camera").font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                            .frame(width: 44, height: 44).background(.regularMaterial, in: Circle()).padding(8)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(photo != nil || recipe?.imagePath != nil ? L("Change photo") : L("Add photo"))
            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
        }
    }

    private var basics: some View {
        Section {
            TextField(L("Title"), text: $title, axis: .vertical)
                .font(.headline)
                .focused($focus, equals: .title)
                .submitLabel(.next)
            TextField(L("Short description"), text: $desc, axis: .vertical).lineLimit(1...4)
            Stepper(value: Binding(get: { servings ?? 0 }, set: { servings = $0 <= 0 ? nil : $0 }), in: 0...60) {
                HStack {
                    Label(L("Servings"), systemImage: "person.2")
                    Spacer()
                    Text(servings.map { String($0) } ?? L("not set")).foregroundStyle(servings == nil ? Theme.ink3 : Theme.ink).monospacedDigit()
                }
            }
            HStack {
                Label(L("Minutes"), systemImage: "clock")
                Spacer()
                TextField("30", text: $minutes)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 90)
            }
            Toggle(isOn: $thermomix) { Label(L("Thermomix recipe"), systemImage: "frying.pan") }.tint(Theme.primary)
            VStack(alignment: .leading, spacing: 6) {
                if !tags.isEmpty {
                    FlowLayout {
                        ForEach(tags, id: \.self) { t in
                            Button { tags.removeAll { $0 == t } } label: {
                                HStack(spacing: 4) {
                                    Text(t)
                                    Image(systemName: "xmark").font(.caption2.weight(.bold))
                                }
                                .font(.subheadline)
                                .padding(.horizontal, 10).frame(minHeight: 32)
                                .background(Theme.primarySoft, in: Capsule())
                                .foregroundStyle(Theme.primaryText)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(LF("Remove tag %@", t))
                        }
                    }
                }
                HStack {
                    Image(systemName: "tag").foregroundStyle(Theme.ink3)
                    TextField(L("Add a tag – quick, vegetarian, kids"), text: $newTag)
                        .focused($focus, equals: .tag)
                        .submitLabel(.done)
                        .onSubmit(addTag)
                    if !newTag.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button(L("Add"), action: addTag).font(.subheadline.weight(.semibold))
                    }
                }
            }
        } header: { Text(L("Recipe")) }
    }

    private var ingredientSection: some View {
        Section {
            ForEach($ingredients) { $row in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                    Image(systemName: row.pantry ? "house.fill" : "circle")
                        .font(.caption)
                        .foregroundStyle(row.pantry ? Theme.primaryText : Theme.ink3)
                        .accessibilityHidden(true)
                    TextField(L("e.g. 500 g minced meat"), text: $row.text, axis: .vertical)
                        .focused($focus, equals: .ingredient(row.id))
                        .submitLabel(.next)
                        .onSubmit { addIngredient(after: row.id) }
                    Menu {
                        Toggle(isOn: $row.pantry) { Label(L("Always at home"), systemImage: "house") }
                        Toggle(isOn: $row.optional) { Label(L("Optional"), systemImage: "questionmark.circle") }
                        Divider()
                        Button { move(&ingredients, row.id, by: -1) } label: { Label(L("Move up"), systemImage: "arrow.up") }
                            .disabled(ingredients.first?.id == row.id)
                        Button { move(&ingredients, row.id, by: 1) } label: { Label(L("Move down"), systemImage: "arrow.down") }
                            .disabled(ingredients.last?.id == row.id)
                        Button(role: .destructive) { ingredients.removeAll { $0.id == row.id } } label: { Label(L("Remove"), systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").foregroundStyle(Theme.ink3).frame(width: 36, height: 36)
                    }
                    .accessibilityLabel(LF("Options for %@", row.text.isEmpty ? L("Ingredient") : row.text))
                }
                .swipeActions {
                    Button(role: .destructive) { ingredients.removeAll { $0.id == row.id } } label: { Label(L("Remove"), systemImage: "trash") }
                }
            }
            .onMove { ingredients.move(fromOffsets: $0, toOffset: $1) }
            Button { addIngredient(after: nil) } label: { Label(L("Add ingredient"), systemImage: "plus") }
            Button { pasteTarget = .ingredients } label: { Label(L("Paste several lines"), systemImage: "doc.on.clipboard") }
        } header: {
            Text(ingredients.isEmpty ? L("Ingredients") : LF("Ingredients (%d)", ingredients.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }.count))
        } footer: {
            Text(L("“Always at home” (the house icon) is for salt, oil and the like – it always counts as in stock and never lands on the list."))
        }
    }

    private var stepSection: some View {
        Section {
            ForEach($steps) { $row in
                stepRow(steps.firstIndex { $0.id == row.id } ?? 0, binding: $row)
            }
            .onMove { steps.move(fromOffsets: $0, toOffset: $1) }
            Button { addStep(after: nil) } label: { Label(L("Add step"), systemImage: "plus") }
            Button { pasteTarget = .steps } label: { Label(L("Paste several lines"), systemImage: "doc.on.clipboard") }
        } header: {
            Text(L("Steps"))
        } footer: {
            Text(L("Settings for the Thermomix, oven or another appliance show as chips under the step and in cook mode."))
        }
    }

    private func stepRow(_ idx: Int, binding row: Binding<StepRow>) -> some View {
        let r = row.wrappedValue
        return VStack(alignment: .leading, spacing: 8) {
            if !r.section.isEmpty || r.showSettings {
                TextField(L("Section (optional), e.g. Dough"), text: row.section)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Theme.ink3)
            }
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                Text("\(idx + 1)").font(.headline).foregroundStyle(Theme.primaryText).frame(width: 22)
                TextField(L("What happens in this step?"), text: row.text, axis: .vertical)
                    .lineLimit(1...8)
                    .focused($focus, equals: .step(r.id))
                Menu {
                    Button { row.wrappedValue.showSettings.toggle() } label: {
                        Label(r.showSettings ? L("Hide appliance settings") : L("Appliance settings and section"), systemImage: "dial.medium")
                    }
                    Divider()
                    Button { move(&steps, r.id, by: -1) } label: { Label(L("Move up"), systemImage: "arrow.up") }
                        .disabled(idx == 0)
                    Button { move(&steps, r.id, by: 1) } label: { Label(L("Move down"), systemImage: "arrow.down") }
                        .disabled(idx == steps.count - 1)
                    Button { addStep(after: r.id) } label: { Label(L("Add a step below"), systemImage: "plus") }
                    Button(role: .destructive) { steps.removeAll { $0.id == r.id } } label: { Label(L("Remove"), systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(Theme.ink3).frame(width: 36, height: 36)
                }
                .accessibilityLabel(LF("Options for step %d", idx + 1))
            }
            if r.showSettings {
                VStack(spacing: 6) {
                    settingField(L("Appliance, e.g. Thermomix, oven"), row.device)
                    HStack(spacing: 6) {
                        settingField(L("Time, e.g. 5 min"), row.time)
                        settingField(L("Temperature"), row.temp)
                    }
                    HStack(spacing: 6) {
                        settingField(L("Speed"), row.speed)
                        settingField(L("Mode, e.g. fan"), row.mode)
                    }
                }
                .padding(.leading, 30)
            } else if r.hasSettings {
                Button { row.wrappedValue.showSettings = true } label: {
                    Text([r.device, r.time, r.temp, r.speed.isEmpty ? "" : LF("Speed %@", r.speed), r.mode].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Theme.surface2, in: Capsule())
                        .foregroundStyle(Theme.ink2)
                }
                .buttonStyle(.plain)
                .padding(.leading, 30)
            }
        }
        .padding(.vertical, 2)
        .swipeActions {
            Button(role: .destructive) { steps.removeAll { $0.id == r.id } } label: { Label(L("Remove"), systemImage: "trash") }
        }
    }

    private func settingField(_ label: String, _ value: Binding<String>) -> some View {
        TextField(label, text: value)
            .font(.subheadline)
            .padding(.horizontal, 10).frame(minHeight: 38)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
    }

    // MARK: editing

    private func addTag() {
        let t = newTag.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: ","))
        newTag = ""
        guard !t.isEmpty else { return }
        for part in t.split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }) where !part.isEmpty && !tags.contains(part) {
            tags.append(part)
        }
        focus = .tag
    }

    private func addIngredient(after id: UUID?) {
        let row = IngredientRow()
        if let id, let i = ingredients.firstIndex(where: { $0.id == id }) { ingredients.insert(row, at: i + 1) } else { ingredients.append(row) }
        focus = .ingredient(row.id)
    }

    private func addStep(after id: UUID?) {
        let row = StepRow()
        if let id, let i = steps.firstIndex(where: { $0.id == id }) { steps.insert(row, at: i + 1) } else { steps.append(row) }
        focus = .step(row.id)
    }

    private func move<T: Identifiable>(_ list: inout [T], _ id: T.ID, by d: Int) where T.ID == UUID {
        guard let i = list.firstIndex(where: { $0.id == id }) else { return }
        let j = i + d
        guard j >= 0, j < list.count else { return }
        list.swapAt(i, j)
        Haptics.tick()
    }

    private func fill() {
        guard !filled else { return }
        if let r = recipe {
            title = r.title
            desc = r.description ?? ""
            servings = r.baseServings
            minutes = r.timeMin.map { String(Int($0)) } ?? ""
            thermomix = r.thermomix ?? false
            tags = r.tags ?? []
            ingredients = r.ingredients.map { IngredientRow(text: $0.text, pantry: $0.isPantry, optional: $0.optional?.bool ?? false, original: $0) }
            steps = r.steps.map { s in
                let o = s.tm?.object
                return StepRow(text: s.text, section: s.section ?? "", device: o?["device"]?.string ?? "", time: o?["time"]?.string ?? "",
                               temp: o?["temp"]?.string ?? "", speed: o?["speed"]?.string ?? "", mode: o?["mode"]?.string ?? "")
            }
            notes = r.notes ?? ""
            source = r.sourceUrl ?? ""
        } else {
            ingredients = [IngredientRow()]
            steps = [StepRow()]
            focus = .title
        }
        initial = fingerprint
        filled = true
    }

    // MARK: save

    private func payload() -> [String: Any] {
        func orNull(_ s: String) -> Any { s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? NSNull() : s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let ing: [[String: Any]] = ingredients.compactMap { row in
            let text = row.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            var o: [String: Any] = ["text": text]
            if row.pantry { o["pantry"] = true }
            if row.optional { o["optional"] = true }
            // the product match only stays while the line is the same
            if let orig = row.original, orig.text == text {
                if let p = orig.productId { o["product_id"] = p }
                if let q = orig.qty { o["qty"] = q }
                if let u = orig.unit { o["unit"] = u }
            }
            return o
        }
        let st: [[String: Any]] = steps.compactMap { row in
            let text = row.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            var o: [String: Any] = ["text": text]
            let sec = row.section.trimmingCharacters(in: .whitespaces)
            if !sec.isEmpty { o["section"] = sec }
            if row.hasSettings {
                var tm: [String: Any] = [:]
                for (k, v) in [("device", row.device), ("time", row.time), ("temp", row.temp), ("speed", row.speed), ("mode", row.mode)] {
                    let x = v.trimmingCharacters(in: .whitespaces)
                    if !x.isEmpty { tm[k] = k == "device" ? String(x.prefix(80)) : k == "mode" ? String(x.prefix(60)) : x }
                }
                o["tm"] = tm
            }
            return o
        }
        return [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": orNull(desc),
            "servings": servings.map { $0 as Any } ?? NSNull(),
            "time_min": Int(minutes.trimmingCharacters(in: .whitespaces)).flatMap { $0 > 0 ? $0 : nil }.map { $0 as Any } ?? NSNull(),
            "thermomix": thermomix,
            "tags": tags,
            "ingredients": ing,
            "steps": st,
            "notes": orNull(notes),
            "source_url": orNull(source),
            "source_type": recipe?.sourceType ?? "own",
            "favorite": recipe?.isFavorite ?? false,
        ]
    }

    private func save() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            let id: Int
            if let r = recipe {
                try await store.api.saveRecipe(r.id, body: payload())
                id = r.id
            } else {
                id = try await store.api.createRecipe(payload())
            }
            if let photo, let jpeg = recipeJPEG(photo) {
                do { try await store.api.uploadRecipePhoto(id, jpeg: jpeg) } catch { self.error = APIError.from(error).localizedDescription }
            }
            store.touch("recipes")
            Haptics.success()
            initial = fingerprint
            dismiss()
            onSaved(id)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }


    private func remove() async {
        guard let r = recipe else { return }
        do {
            try await store.api.deleteRecipe(r.id)
            store.touch("recipes")
            dismiss()
            onDeleted?()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// Paste a copied ingredient list or method: one row per line, bullets and numbering are dropped.
struct PasteLinesSheet: View {
    let target: RecipeEditorView.PasteTarget
    let onAdd: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    private var lines: [String] {
        text.split(whereSeparator: \.isNewline)
            .map { $0.replacingOccurrences(of: #"^\s*(?:[-•*·▪︎–]|\d+[.)])\s*"#, with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text).frame(minHeight: 220)
                } footer: {
                    Text(target == .ingredients ? L("One ingredient per line. Bullets and numbers are removed.") : L("One step per line. Bullets and numbers are removed."))
                }
                if text.isEmpty {
                    Section {
                        PasteButton(payloadType: String.self) { strings in
                            Task { @MainActor in text = strings.joined(separator: "\n") }
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(target == .ingredients ? L("Paste ingredients") : L("Paste steps"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(lines.isEmpty ? L("Add") : LF("Add %d", lines.count)) { onAdd(lines); dismiss() }.disabled(lines.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Recipe photos: long side max 1600 px, JPEG (same as the recipe page and the web's browser fallback).
func recipeJPEG(_ img: UIImage) -> Data? {
    let scale = min(1, 1600 / max(img.size.width, img.size.height, 1))
    let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        .jpegData(compressionQuality: 0.82)
}

import SwiftUI
import AgentPetCore

/// Onboarding / Settings, styled after the Petdex pet pages: a large pet
/// preview beside its details, with setup and animation sections below.
struct SetupView: View {
    @ObservedObject private var model = SettingsModel.shared
    @ObservedObject private var pet = PetController.shared
    @ObservedObject private var imagePets = ImagePetStore.shared
    var onClose: () -> Void

    enum Tab: String, CaseIterable { case pet = "Pet", setup = "Setup" }
    @State private var tab: Tab = .pet

    private var selectedPack: ImagePetPack? {
        pet.selectedPetID.flatMap { imagePets.pack(id: $0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(EdgeInsets(top: 42, leading: 28, bottom: 14, trailing: 28))
            tabBar
                .padding(.horizontal, 28)
                .padding(.bottom, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    switch tab {
                    case .pet:
                        hero
                        if let pack = selectedPack { animationsSection(pack) }
                    case .setup:
                        setupSection
                    }
                }
                .padding(EdgeInsets(top: 0, leading: 28, bottom: 24, trailing: 28))
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider().overlay(Theme.cardStroke)
            HStack {
                Spacer()
                Button("Done") { onClose() }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .keyboardShortcut(.defaultAction)
            }
            .padding(EdgeInsets(top: 12, leading: 28, bottom: 16, trailing: 28))
        }
        .frame(width: 620, height: 640)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .onAppear { model.refresh() }
    }

    private var tabBar: some View {
        HStack(spacing: 8) {
            ForEach(Tab.allCases, id: \.self) { item in
                let on = item == tab
                Button { tab = item } label: {
                    Text(item.rawValue)
                        .font(.system(size: 13, weight: on ? .semibold : .regular))
                        .foregroundStyle(on ? .white : .white.opacity(0.6))
                        .padding(.horizontal, 16).padding(.vertical, 7)
                        .background(Capsule().fill(on ? Theme.accent : .white.opacity(0.07)))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Theme.accent)
                .frame(width: 30, height: 30)
                .overlay(Image(systemName: "pawprint.fill").font(.system(size: 15)).foregroundStyle(.white))
            Text("AgentPet").font(.system(size: 20, weight: .bold))
            Spacer()
        }
    }

    // MARK: - Hero

    private var hero: some View {
        HStack(alignment: .top, spacing: 24) {
            previewCard
            VStack(alignment: .leading, spacing: 14) {
                EyebrowLabel("Your pet")
                Text(selectedPack?.displayName ?? "No pet yet")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
                Text(selectedPack?.description ?? "Import a pet pack to bring a companion to your desktop.")
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.72))
                    .fixedSize(horizontal: false, vertical: true)
                petChooser
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var previewCard: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.white.opacity(0.04))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.accent.opacity(0.35), lineWidth: 1))
                .shadow(color: Theme.accent.opacity(0.35), radius: 24, y: 8)
            if let pack = selectedPack {
                ImageSpriteView(frames: pack.clip(0), mood: .idle, size: 150)
            } else {
                Image(systemName: "pawprint.fill").font(.system(size: 60)).foregroundStyle(.white.opacity(0.3))
            }
        }
        .frame(width: 220, height: 220)
    }

    private var petChooser: some View {
        VStack(alignment: .leading, spacing: 10) {
            if imagePets.packs.isEmpty {
                Text("No pets imported yet.").font(.system(size: 13)).foregroundStyle(.white.opacity(0.55))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(imagePets.packs) { pack in
                            PetCard(id: pack.id, title: pack.displayName,
                                    selected: pet.selectedPetID == pack.id,
                                    select: { pet.selectedPetID = pack.id })
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            Button { model.importPet() } label: {
                Label("Import pet…", systemImage: "square.and.arrow.down")
                    .font(.system(size: 13, weight: .medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accent)
        }
    }

    // MARK: - Animations

    private func animationsSection(_ pack: ImagePetPack) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            EyebrowLabel("Animations")
            Text("Pick a state, then choose which animation plays for it.")
                .font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
            AnimationTabsView(pack: pack)
        }
        .themedCard()
    }

    // MARK: - Setup

    private var setupSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            EyebrowLabel("Setup")

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Notifications").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    Text(notificationDescription).font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
                }
                Spacer()
                notificationButton
            }

            Divider().overlay(Theme.cardStroke)

            Toggle(isOn: $pet.showChat) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Chat bubble").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                    Text("Show the pet's speech bubble while it works").font(.system(size: 12)).foregroundStyle(.white.opacity(0.6))
                }
            }
            .tint(Theme.accent)

            Divider().overlay(Theme.cardStroke)

            VStack(alignment: .leading, spacing: 10) {
                Text("Agent integrations").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                ForEach(model.agents) { agent in
                    AgentRow(agent: agent,
                             installed: model.isInstalled(agent.kind),
                             toggle: { model.toggleInstall(agent.kind) })
                }
            }
        }
        .themedCard()
    }

    private var notificationDescription: String {
        switch model.notificationState {
        case .unavailable: return "Available once installed as AgentPet.app"
        case .notDetermined: return "Get alerts when an agent finishes or needs input"
        case .enabled: return "Enabled"
        case .denied: return "Denied. Enable in System Settings"
        }
    }

    @ViewBuilder private var notificationButton: some View {
        switch model.notificationState {
        case .enabled:
            Label("Enabled", systemImage: "checkmark.circle.fill").foregroundStyle(.green).font(.system(size: 13))
        case .denied:
            Button("Open Settings") { model.openSystemNotificationSettings() }.tint(Theme.accent)
        case .notDetermined:
            Button("Enable") { model.enableNotifications() }.buttonStyle(.borderedProminent).tint(Theme.accent)
        case .unavailable:
            Text("Unavailable").foregroundStyle(.white.opacity(0.5)).font(.system(size: 13))
        }
    }
}

// MARK: - Rows / cards

private struct AnimationTabsView: View {
    let pack: ImagePetPack
    @ObservedObject private var store = PetBindingsStore.shared
    @State private var selected: PetMood = .working

    private let states: [PetMood] = [.idle, .working, .waiting, .done, .celebrate]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                ForEach(states, id: \.self) { state in
                    let on = state == selected
                    Button { selected = state } label: {
                        Text(label(state))
                            .font(.system(size: 12, weight: on ? .semibold : .regular))
                            .foregroundStyle(on ? .white : .white.opacity(0.6))
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .background(Capsule().fill(on ? Theme.accent : .white.opacity(0.07)))
                    }
                    .buttonStyle(.plain)
                }
            }

            let current = store.clipIndex(packId: pack.id, clipCount: pack.clipCount, mood: selected)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 12)], spacing: 12) {
                ForEach(0..<pack.clipCount, id: \.self) { i in
                    let on = i == current
                    Button {
                        store.setClip(i, mood: selected, packId: pack.id, clipCount: pack.clipCount)
                    } label: {
                        VStack(spacing: 4) {
                            ImageSpriteView(frames: pack.clip(i), mood: .idle, size: 50)
                                .frame(width: 56, height: 48)
                            Text("Clip \(i + 1)").font(.system(size: 10)).foregroundStyle(.white.opacity(0.7))
                        }
                        .frame(width: 76, height: 80)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(on ? Theme.accent.opacity(0.22) : .white.opacity(0.05)))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(on ? Theme.accent : .clear, lineWidth: 2))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func label(_ mood: PetMood) -> String {
        switch mood {
        case .idle: return "Idle"
        case .working: return "Working"
        case .waiting: return "Waiting"
        case .done: return "Done"
        case .celebrate: return "Celebrate"
        }
    }
}

private struct PetCard: View {
    let id: String
    let title: String
    let selected: Bool
    let select: () -> Void

    var body: some View {
        Button(action: select) {
            VStack(spacing: 4) {
                Group {
                    if let pack = ImagePetStore.shared.pack(id: id) {
                        ImageSpriteView(frames: pack.clip(0), mood: .idle, size: 56)
                    } else {
                        Image(systemName: "pawprint").foregroundStyle(.white)
                    }
                }
                .frame(width: 60, height: 54)
                Text(title).font(.system(size: 11)).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
            }
            .frame(width: 84, height: 86)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(selected ? Theme.accent.opacity(0.22) : .white.opacity(0.05)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(selected ? Theme.accent : Theme.cardStroke, lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
    }
}

private struct AgentRow: View {
    let agent: AgentIntegration
    let installed: Bool
    let toggle: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(agent.displayName).foregroundStyle(.white)
                if let note = agent.note {
                    Text(note).font(.caption).foregroundStyle(.white.opacity(0.5))
                } else if installed {
                    Text("Hook installed").font(.caption).foregroundStyle(.green)
                }
            }
            Spacer()
            if agent.isSupported {
                Button(installed ? "Remove" : "Install") { toggle() }.tint(Theme.accent)
            } else {
                Text("Coming soon").font(.caption).foregroundStyle(.white.opacity(0.45))
            }
        }
    }
}

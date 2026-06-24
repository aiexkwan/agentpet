import Foundation
import AgentPetCore

/// Per-window pet state. One instance backs each pet window (single window for
/// now; the registry in later tasks owns one per active project). Holds only
/// the fields that vary per window — global toggles (showChat, petPoint…) still
/// live on `PetController.shared`.
@MainActor
final class PetWindowModel: ObservableObject {
    /// Stable grouping key: a project path or `"default"` for the home pet.
    let key: String

    @Published var petID: String?
    @Published var mood: PetMood
    @Published var projectName: String?
    @Published var sessions: [AgentSession]
    @Published var count: Int
    @Published var chatLine: String

    init(
        key: String,
        petID: String? = nil,
        mood: PetMood = .idle,
        projectName: String? = nil,
        sessions: [AgentSession] = [],
        count: Int = 0,
        chatLine: String = ""
    ) {
        self.key = key
        self.petID = petID
        self.mood = mood
        self.projectName = projectName
        self.sessions = sessions
        self.count = count
        self.chatLine = chatLine
    }
}

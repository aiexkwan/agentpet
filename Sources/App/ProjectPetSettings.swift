import Foundation
import AgentPetCore

@MainActor final class ProjectPetSettings: ObservableObject {
    static let shared = ProjectPetSettings()
    private static let key = "agentpet.projectPets"

    @Published private(set) var mappings: [ProjectPetMapping] = []

    init() { load() }

    func setPet(projectPath: String, petID: String) {
        let norm = ProjectPetResolver.normalize(projectPath)
        var m = mappings.filter { ProjectPetResolver.normalize($0.projectPath) != norm }
        m.append(ProjectPetMapping(projectPath: norm, petID: petID))
        mappings = m.sorted { $0.projectPath < $1.projectPath }
        save()
    }

    func remove(projectPath: String) {
        let norm = ProjectPetResolver.normalize(projectPath)
        mappings.removeAll { ProjectPetResolver.normalize($0.projectPath) == norm }
        save()
    }

    func petID(forProject cwd: String?) -> String? {
        ProjectPetResolver.mapping(forProject: cwd, mappings: mappings)?.petID
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: Self.key),
              let decoded = try? JSONDecoder().decode([ProjectPetMapping].self, from: data) else { return }
        mappings = decoded
    }
    private func save() {
        if let data = try? JSONEncoder().encode(mappings) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }
}

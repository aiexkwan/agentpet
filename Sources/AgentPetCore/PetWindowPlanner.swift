import Foundation

public struct PetWindowSpec: Equatable, Sendable {
    public var key: String
    public var projectName: String?
    public var petID: String?
    public var sessionIDs: [String]
    public var mood: PetMood
    public var count: Int
}

public enum PetWindowPlanner {
    public static let defaultKey = "default"

    private static func isActive(_ s: AgentState) -> Bool {
        s == .working || s == .waiting || s == .done
    }

    /// Plans the per-project pet windows. `forceDefault` guarantees a home
    /// ("default") window in the result even in split mode — used so a break
    /// nudge always has a pet to show.
    public static func plan(sessions: [AgentSession], split: Bool,
                            mappings: [ProjectPetMapping], defaultPetID: String?,
                            forceDefault: Bool = false) -> [PetWindowSpec] {
        let specs = planCore(sessions: sessions, split: split,
                             mappings: mappings, defaultPetID: defaultPetID)
        guard forceDefault, !specs.contains(where: { $0.key == defaultKey }) else { return specs }
        return specs + [PetWindowSpec(key: defaultKey, projectName: nil, petID: defaultPetID,
                                      sessionIDs: [], mood: .idle, count: 0)]
    }

    private static func planCore(sessions: [AgentSession], split: Bool,
                                 mappings: [ProjectPetMapping], defaultPetID: String?) -> [PetWindowSpec] {
        let active = sessions.filter { isActive($0.state) }

        func homeIdle() -> [PetWindowSpec] {
            [PetWindowSpec(key: defaultKey, projectName: nil, petID: defaultPetID,
                           sessionIDs: [], mood: .idle, count: 0)]
        }

        if !split {
            guard !active.isEmpty else { return homeIdle() }
            return [PetWindowSpec(key: defaultKey, projectName: nil, petID: defaultPetID,
                                  sessionIDs: active.map(\.id),
                                  mood: MoodResolver.aggregate(active), count: active.count)]
        }

        guard !active.isEmpty else { return homeIdle() }

        // group active sessions by key
        var groups: [String: (petID: String?, sessions: [AgentSession])] = [:]
        for s in active {
            let key: String
            let petID: String?
            if let m = ProjectPetResolver.mapping(forProject: s.project, mappings: mappings) {
                key = ProjectPetResolver.normalize(m.projectPath); petID = m.petID
            } else if let p = s.project, !p.isEmpty {
                key = ProjectPetResolver.normalize(p); petID = defaultPetID
            } else {
                key = defaultKey; petID = defaultPetID
            }
            groups[key, default: (petID, [])].sessions.append(s)
            groups[key]!.petID = petID
        }

        return groups.keys.sorted().map { key in
            let g = groups[key]!
            return PetWindowSpec(
                key: key,
                projectName: key == defaultKey ? nil : (key as NSString).lastPathComponent,
                petID: g.petID,
                sessionIDs: g.sessions.map(\.id),
                mood: MoodResolver.aggregate(g.sessions),
                count: g.sessions.count)
        }
    }
}

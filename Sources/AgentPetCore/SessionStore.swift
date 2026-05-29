import Foundation

/// In-memory store of agent sessions.
///
/// Pure logic, deliberately not thread-safe and free of wall-clock reads:
/// callers pass `now` so behaviour is deterministic and testable. The daemon
/// confines all access to a single queue (see issue #3).
public final class SessionStore {
    /// `done` sessions fall back to `idle` after this much quiet time.
    public var doneToIdleAfter: TimeInterval
    /// `idle` sessions are removed after this much quiet time.
    public var removeIdleAfter: TimeInterval

    private var byID: [String: AgentSession] = [:]

    public init(doneToIdleAfter: TimeInterval = 30, removeIdleAfter: TimeInterval = 600) {
        self.doneToIdleAfter = doneToIdleAfter
        self.removeIdleAfter = removeIdleAfter
    }

    /// Applies an event, creating or updating the matching session.
    /// Returns the updated session, or `nil` if the event maps to no state.
    @discardableResult
    public func apply(_ event: AgentEvent, now: Date) -> AgentSession? {
        guard let state = StateMapper.state(for: event.agentKind, eventName: event.eventName) else {
            return nil
        }
        if var existing = byID[event.sessionId] {
            existing.state = state
            existing.updatedAt = now
            if let project = event.project { existing.project = project }
            existing.message = event.message
            byID[event.sessionId] = existing
            return existing
        }
        let session = AgentSession(
            id: event.sessionId,
            agentKind: event.agentKind,
            project: event.project,
            state: state,
            message: event.message,
            source: .hook,
            updatedAt: now
        )
        byID[event.sessionId] = session
        return session
    }

    /// Demotes stale `done` sessions to `idle`, then removes long-idle ones.
    public func prune(now: Date) {
        for (id, session) in byID {
            let quiet = now.timeIntervalSince(session.updatedAt)
            switch session.state {
            case .done where quiet >= doneToIdleAfter:
                var s = session
                s.state = .idle
                s.updatedAt = now
                byID[id] = s
            case .idle where quiet >= removeIdleAfter:
                byID.removeValue(forKey: id)
            default:
                break
            }
        }
    }

    public var sessions: [AgentSession] {
        Array(byID.values)
    }

    /// Sessions ordered by attention priority then recency, for display.
    public var sorted: [AgentSession] {
        byID.values.sorted { lhs, rhs in
            let lp = lhs.state.attentionPriority
            let rp = rhs.state.attentionPriority
            if lp != rp { return lp > rp }
            return lhs.updatedAt > rhs.updatedAt
        }
    }

    public func session(id: String) -> AgentSession? {
        byID[id]
    }
}

extension AgentState {
    /// Higher means more deserving of the user's attention.
    var attentionPriority: Int {
        switch self {
        case .waiting: return 4
        case .done: return 3
        case .working: return 2
        case .registered: return 1
        case .idle: return 0
        }
    }
}

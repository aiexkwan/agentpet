import Foundation

/// Current known state of one agent session.
public struct AgentSession: Identifiable, Sendable, Equatable {
    public let id: String
    public var agentKind: AgentKind
    public var project: String?
    public var state: AgentState
    public var message: String?
    public var source: AgentSource
    public var updatedAt: Date

    public init(
        id: String,
        agentKind: AgentKind,
        project: String? = nil,
        state: AgentState,
        message: String? = nil,
        source: AgentSource,
        updatedAt: Date
    ) {
        self.id = id
        self.agentKind = agentKind
        self.project = project
        self.state = state
        self.message = message
        self.source = source
        self.updatedAt = updatedAt
    }
}

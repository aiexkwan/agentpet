import Foundation

/// The JSON Claude Code writes to a hook's stdin. Only the fields AgentPet
/// needs are decoded; the rest are ignored.
public struct ClaudeHookPayload: Decodable, Equatable {
    public let sessionId: String?
    public let cwd: String?
    public let hookEventName: String?
    public let message: String?
    public let toolName: String?

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case cwd
        case hookEventName = "hook_event_name"
        case message
        case toolName = "tool_name"
    }

    public static func decode(from data: Data) -> ClaudeHookPayload? {
        try? JSONDecoder().decode(ClaudeHookPayload.self, from: data)
    }

    /// Builds an `AgentEvent` from the payload, or `nil` if the essential
    /// fields (session id and event name) are missing.
    public func makeEvent(now: Date) -> AgentEvent? {
        guard let sessionId, let hookEventName else { return nil }
        // Surface the running tool name when there's no explicit message.
        let context = message ?? toolName.map { "Using \($0)" }
        return AgentEvent(
            sessionId: sessionId, agentKind: .claude, eventName: hookEventName,
            project: cwd, message: context, timestamp: now
        )
    }
}

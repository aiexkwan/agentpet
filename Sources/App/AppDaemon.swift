import Foundation
import AgentPetCore

/// Owns the live session state inside the running app: starts the socket
/// server, drains any queued events on launch, applies incoming events and
/// prunes stale ones, and publishes a display-ordered list to the UI.
///
/// All `SessionStore` access is confined to the main actor.
@MainActor
final class AppDaemon: ObservableObject {
    static let shared = AppDaemon()

    @Published private(set) var sessions: [AgentSession] = []

    private let store: SessionStore = {
        let s = SessionStore()
        s.archiveStore = SessionArchiveStore.shared
        return s
    }()
    private let server = EventSocketServer(path: AgentPetPaths.socketPath)
    private var pruneTimer: Timer?

    func start() {
        try? FileManager.default.createDirectory(
            atPath: AgentPetPaths.baseDir, withIntermediateDirectories: true
        )

        // Replay queued events with their original timestamps (not "now"), so
        // sessions that ended while the app was closed look stale and get
        // pruned immediately instead of resurrecting as "working".
        EventSocketServer.drainQueue(directory: AgentPetPaths.queueDir) { [store] event in
            store.apply(event, now: event.timestamp)
        }
        store.prune(now: Date())
        refresh()

        try? server.start { event in
            Task { @MainActor [weak self] in self?.ingest(event) }
        }

        pruneTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.prune() }
        }
        ReactiveEngine.shared.start()
    }

    /// Clears the tracked sessions (e.g. after disconnecting an integration).
    func clearSessions() {
        store.clear()
        refresh()
    }

    /// Dismisses a single session (e.g. a stuck agent).
    func removeSession(_ id: String) {
        store.remove(id: id)
        refresh()
    }

    private func ingest(_ event: AgentEvent) {
        let before = store.session(id: event.sessionId)?.state
        guard let updated = store.apply(event, now: Date()) else {
            refresh()
            return
        }
        resolveTitle(for: event)
        resolveModel(for: event)
        feedLiveTokens(for: event)

        // Claude's Stop hook fires identically whether the agent is truly
        // done or just ended its turn by asking the user a question — hold
        // the notification until an async transcript check resolves, so we
        // fire exactly one notification reflecting the true final state.
        if event.agentKind == .claude, event.eventName == "Stop", updated.state == .done {
            refineDoneIfQuestion(event: event, before: before, session: updated)
        } else {
            notifyIfNeeded(before: before, session: updated)
        }
        refresh()
    }

    /// Tokens appear in the transcript while Claude is still working, so the
    /// pet eats live on tool events instead of waiting for `Stop`. Throttled
    /// per session; reads are incremental (offset-based), so the `Stop` path
    /// picking up the remainder never double-counts.
    private var lastLiveFeed: [String: Date] = [:]
    private static let liveFeedInterval: TimeInterval = 10

    private func feedLiveTokens(for event: AgentEvent) {
        guard event.agentKind == .claude, event.eventName != "Stop" else { return }
        let path: String? = event.transcriptPath
            ?? event.project.map { TranscriptReader.inferredPath(sessionId: event.sessionId, cwd: $0) }
        guard let path else { return }
        let now = Date()
        if let last = lastLiveFeed[event.sessionId],
           now.timeIntervalSince(last) < Self.liveFeedInterval { return }
        lastLiveFeed[event.sessionId] = now
        Task.detached(priority: .utility) {
            let tokens = TranscriptReader.newUsageTokens(at: path) ?? 0
            guard tokens > 0 else { return }
            await MainActor.run { PetCareController.shared.feedTokens(tokens) }
        }
    }

    /// Reads the transcript off-thread to check whether Claude ended its turn
    /// by asking the user something; if so, corrects `.done` to `.waiting`.
    /// Either way, fires the (single, final-state) notification afterwards.
    private func refineDoneIfQuestion(event: AgentEvent, before: AgentState?, session: AgentSession) {
        let sessionId = event.sessionId
        let stateSince = session.stateSince
        let path: String? = event.transcriptPath
            ?? event.project.map { TranscriptReader.inferredPath(sessionId: sessionId, cwd: $0) }
        guard let path else {
            notifyIfNeeded(before: before, session: session)
            return
        }
        Task.detached(priority: .utility) { [weak self] in
            let isQuestion = TranscriptReader.latestAssistantText(at: path)
                .map(QuestionDetector.looksLikeQuestion) ?? false
            // The turn just ended either way — feed the pet the tokens it burnt.
            let tokens = TranscriptReader.newUsageTokens(at: path) ?? 0
            await MainActor.run { [weak self] in
                guard let self else { return }
                PetCareController.shared.feedTokens(tokens)
                if isQuestion {
                    self.store.refineState(id: sessionId, from: .done, to: .waiting, since: stateSince)
                }
                guard let final = self.store.session(id: sessionId) else { return }
                self.notifyIfNeeded(before: before, session: final)
                self.refresh()
            }
        }
    }

    private func resolveTitle(for event: AgentEvent) {
        let sessionId = event.sessionId
        let path: String? = event.transcriptPath
            ?? event.project.map { TranscriptReader.inferredPath(sessionId: sessionId, cwd: $0) }
        guard let path else { return }
        Task.detached(priority: .utility) { [weak self] in
            guard let title = TranscriptReader.title(at: path) else { return }
            await MainActor.run { [weak self] in
                self?.store.updateTitle(id: sessionId, title: title)
                self?.refresh()
            }
        }
    }

    /// Reads the transcript off-thread for the model of the latest assistant
    /// message — picks up `/model` switches mid-session, which Claude's hook
    /// payloads only report at `SessionStart`.
    private func resolveModel(for event: AgentEvent) {
        guard event.agentKind == .claude else { return }
        let sessionId = event.sessionId
        let path: String? = event.transcriptPath
            ?? event.project.map { TranscriptReader.inferredPath(sessionId: sessionId, cwd: $0) }
        guard let path else { return }
        Task.detached(priority: .utility) { [weak self] in
            guard let model = TranscriptReader.latestAssistantModel(at: path) else { return }
            await MainActor.run { [weak self] in
                self?.store.updateModel(id: sessionId, model: model)
                self?.refresh()
            }
        }
    }

    private func notifyIfNeeded(before: AgentState?, session: AgentSession) {
        guard session.state != before else { return }
        let project = session.project.map { ($0 as NSString).lastPathComponent } ?? session.id
        switch session.state {
        case .waiting:
            NotificationManager.shared.notify(
                title: "\(project) needs input", body: session.message ?? "Waiting for you")
            SoundSettings.shared.play(.waiting)
        case .done:
            NotificationManager.shared.notify(
                title: "\(project) finished", body: "Agent completed its turn")
            SoundSettings.shared.play(.done)
            PetCareController.shared.recordMeal()
        default:
            break
        }
    }

    private func prune() {
        store.prune(now: Date())
        refresh()
    }

    private func refresh() {
        sessions = store.sorted
        PetController.shared.update(sessions: sessions)
        StatusBarController.shared.updateStatus(sessions)
    }
}

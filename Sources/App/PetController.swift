import AppKit
import AgentPetCore

/// Resolves the aggregate session mood, plays a short `celebrate` burst when
/// work finishes, owns the selected (imported) pet, and drives the chat bubble.
@MainActor
final class PetController: ObservableObject {
    static let shared = PetController()

    @Published private(set) var mood: PetMood = .idle
    @Published private(set) var chatLine: String = ""

    @Published var selectedPetID: String? {
        didSet { UserDefaults.standard.set(selectedPetID, forKey: Self.petKey) }
    }
    @Published var showChat: Bool {
        didSet {
            UserDefaults.standard.set(showChat, forKey: Self.chatKey)
            refreshChat()
        }
    }
    /// Whether the pet shows a chat line while idle (the "doing nothing" chatter).
    @Published var showIdleMessage: Bool {
        didSet {
            UserDefaults.standard.set(showIdleMessage, forKey: Self.idleMsgKey)
            refreshChat()
        }
    }
    /// Sprite point size, freely adjustable via a slider.
    @Published var petPoint: Double {
        didSet { UserDefaults.standard.set(petPoint, forKey: Self.sizeKey) }
    }

    static let minPoint: Double = 60
    static let maxPoint: Double = 240
    static let presets: [(String, Double)] = [("S", 84), ("M", 120), ("L", 168)]

    /// Floating window size. Width is wide enough for agent-ticker lines;
    /// height grows with the number of lines in the bubble.
    static func windowSize(forPoint point: Double, lineCount: Int = 1) -> CGSize {
        let count = max(lineCount, 1)
        let bubbleH = CGFloat(count) * 22 + 16   // 22pt per line + top/bottom padding
        return CGSize(
            width: max(point + 110, 320),         // 320pt fits typical agent lines
            height: point + bubbleH + 28          // 28pt for triangle + spacing + margin
        )
    }
    var windowSize: CGSize { Self.windowSize(forPoint: petPoint, lineCount: max(chatLineCount, 1)) }

    private var lastResolved: PetMood = .idle
    private var latestSessions: [AgentSession] = []
    private var celebrateTimer: Timer?

    /// Number of active agent lines currently shown; drives window height.
    @Published private(set) var chatLineCount: Int = 0
    /// Sorted active sessions for the structured desktop bubble. Empty when idle/done/celebrate.
    @Published private(set) var activeAgentSessions: [AgentSession] = []

    private static let petKey = "agentpet.selectedPetID"
    private static let chatKey = "agentpet.showChat"
    private static let idleMsgKey = "agentpet.showIdleMessage"
    private static let sizeKey = "agentpet.petSize"
    private static let celebrateDuration: TimeInterval = 3

    init() {
        selectedPetID = UserDefaults.standard.string(forKey: Self.petKey)
        showChat = (UserDefaults.standard.object(forKey: Self.chatKey) as? Bool) ?? true
        showIdleMessage = (UserDefaults.standard.object(forKey: Self.idleMsgKey) as? Bool) ?? true
        let saved = UserDefaults.standard.object(forKey: Self.sizeKey) as? Double ?? 120
        petPoint = min(max(saved, Self.minPoint), Self.maxPoint)
    }

    func start() {
        // Ticker drives chatLine updates; no separate chat timer needed.
    }

    private var sizeAnimTimer: Timer?
    private var sizeAnimStep = 0
    private var sizeAnimStart = 0.0
    private var sizeAnimTarget = 0.0
    private static let sizeAnimSteps = 14

    /// Eases `petPoint` to a target so a preset tap resizes as smoothly as a
    /// slider drag (each step drives the same smooth window resize).
    func animateSize(to target: Double) {
        sizeAnimTimer?.invalidate()
        sizeAnimTarget = min(max(target, Self.minPoint), Self.maxPoint)
        sizeAnimStart = petPoint
        sizeAnimStep = 0
        sizeAnimTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.tickSize() }
        }
    }

    private func tickSize() {
        sizeAnimStep += 1
        let t = min(Double(sizeAnimStep) / Double(Self.sizeAnimSteps), 1)
        let eased = t * t * (3 - 2 * t)   // smoothstep
        petPoint = sizeAnimStart + (sizeAnimTarget - sizeAnimStart) * eased
        if sizeAnimStep >= Self.sizeAnimSteps {
            petPoint = sizeAnimTarget
            sizeAnimTimer?.invalidate()
        }
    }

    /// Called by the daemon whenever the session list changes.
    func update(sessions: [AgentSession]) {
        latestSessions = sessions
        let resolved = MoodResolver.aggregate(sessions)
        defer { lastResolved = resolved }

        if resolved == .done && lastResolved != .done {
            chatLineCount = 0
            activeAgentSessions = []
            setMood(.celebrate)
            celebrateTimer?.invalidate()
            celebrateTimer = Timer.scheduledTimer(withTimeInterval: Self.celebrateDuration, repeats: false) { _ in
                Task { @MainActor [weak self] in self?.settleAfterCelebrate() }
            }
            return
        }
        if mood == .celebrate {
            return  // let the 3-second celebration finish regardless of new state
        }
        celebrateTimer?.invalidate()
        setMood(resolved)

        if resolved == .working || resolved == .waiting {
            if BubbleSettings.shared.multiAgentBubbleEnabled {
                buildAgentChatLine(sessions: sessions)
            } else {
                chatLineCount = 0
                activeAgentSessions = []
                refreshChat()
            }
        } else {
            chatLineCount = 0
            activeAgentSessions = []
        }
    }

    /// Rebuilds chat state when the user toggles multi-agent bubble mode.
    func applyBubbleModeChange() {
        guard mood == .working || mood == .waiting else { return }
        if BubbleSettings.shared.multiAgentBubbleEnabled {
            buildAgentChatLine(sessions: latestSessions)
        } else {
            chatLineCount = 0
            activeAgentSessions = []
            refreshChat()
        }
    }

    private func settleAfterCelebrate() {
        setMood(MoodResolver.aggregate(latestSessions))
    }

    /// Plays a short celebrate burst with a custom line (e.g. a level-up),
    /// then settles back to the aggregate mood. Sets `chatLine` directly —
    /// `setMood` would re-roll it from the message pools.
    func flashCelebrate(line: String) {
        celebrateTimer?.invalidate()
        chatLineCount = 0
        activeAgentSessions = []
        mood = .celebrate
        chatLine = line
        StatusBarController.shared.refreshTitle()
        celebrateTimer = Timer.scheduledTimer(withTimeInterval: Self.celebrateDuration, repeats: false) { _ in
            Task { @MainActor [weak self] in self?.settleAfterCelebrate() }
        }
    }

    func flashReactiveLine(_ line: String) {
        guard showChat else { return }
        chatLine = line
        StatusBarController.shared.refreshTitle()
    }

    private func setMood(_ newMood: PetMood) {
        let changed = newMood != mood
        mood = newMood
        // Only re-pick the line when the mood actually changes, so a periodic
        // refresh (e.g. the 10s prune) doesn't keep swapping the idle line and
        // resize/jump the pet. `reroll` forces a new pick on real transitions.
        refreshChat(reroll: changed)
    }

    /// Re-pick the chat line so it adopts a newly chosen app language at once.
    func relocalize() { refreshChat() }

    private func refreshChat(reroll: Bool = true) {
        guard showChat else {
            chatLine = ""
            StatusBarController.shared.refreshTitle()
            return
        }
        if mood == .idle {
            guard showIdleMessage else {
                chatLine = ""
                StatusBarController.shared.refreshTitle()
                return
            }
            if reroll || chatLine.isEmpty {
                let pool = BubbleSettings.shared.multiAgentBubbleEnabled
                    ? BubbleMessages.shared.lines(for: nil, mood: .idle)
                    : ChatSettings.shared.lines(for: .idle)
                chatLine = CareChat.idlePool(base: pool).randomElement() ?? IdleBoost.line()
            }
            StatusBarController.shared.refreshTitle()
            return
        }
        // Multi-agent mode owns chatLine during working/waiting; otherwise use PetChat.
        if (mood == .working || mood == .waiting)
            && BubbleSettings.shared.multiAgentBubbleEnabled
            && chatLineCount > 0 {
            StatusBarController.shared.refreshTitle()
            return
        }
        if reroll || chatLine.isEmpty {
            let pool = BubbleSettings.shared.multiAgentBubbleEnabled
                ? BubbleMessages.shared.lines(for: nil, mood: mood)
                : ChatSettings.shared.lines(for: mood)
            chatLine = pool.randomElement() ?? ""
        }
        StatusBarController.shared.refreshTitle()
    }

    // MARK: - Pet tap interaction

    @Published private(set) var isPetted = false
    @Published private(set) var petReactionLine: String = ""
    @Published private(set) var petTapCount: Int = 0

    private var petBounceTimer: Timer?
    private var petLineTimer: Timer?
    private var petCooldown = false
    private var consecutivePets = 0
    private var lastPetTime: Date?

    private static let petReactions: [[String]] = [
        ["Hehe~", "That tickles!", "Hi there! 👋", "Oh! Hello~", "*purrs*", "Nyaa~"],
        ["I love you! 💕", "More pets please!", "Best human ever!", "So happy~ ✨"],
        ["MAXIMUM LOVE! 💖", "Can't stop smiling! 🥰", "I'm gonna melt~"],
    ]

    func petTap() {
        guard !petCooldown else { return }
        petCooldown = true

        let now = Date()
        if let last = lastPetTime, now.timeIntervalSince(last) < 3.0 {
            consecutivePets += 1
        } else {
            consecutivePets = 1
        }
        lastPetTime = now

        let tier = consecutivePets >= 6 ? 2 : consecutivePets >= 3 ? 1 : 0
        petReactionLine = Self.petReactions[tier].randomElement() ?? "Hehe~"
        petTapCount += 1

        isPetted = true
        petBounceTimer?.invalidate()
        petBounceTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: false) { _ in
            Task { @MainActor [weak self] in self?.isPetted = false }
        }

        petLineTimer?.invalidate()
        petLineTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { _ in
            Task { @MainActor [weak self] in self?.petReactionLine = "" }
        }

        NSSound(named: "Pop")?.play()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.petCooldown = false
        }
    }

    // MARK: - Agent list

    /// Builds the structured session list and a plain-text fallback chatLine.
    private func buildAgentChatLine(sessions: [AgentSession]) {
        let active = TickerFormatter.sorted(
            sessions.filter { $0.state != .idle && $0.state != .registered }
        )
        activeAgentSessions = active
        chatLineCount = active.count
        if active.isEmpty {
            chatLine = ""
        } else {
            // Plain-text fallback used by the menu bar chat pill (lineLimit(1) shows first line).
            chatLine = active.map { "• \(TickerFormatter.line(for: $0))" }.joined(separator: "\n")
        }
        StatusBarController.shared.refreshTitle()
    }
}

/// Built-in (system) chat lines per mood.
enum PetChat {
    static let lines: [PetMood: [String]] = [
        .working: [
            "Thinking…", "Working on it…", "On it!", "Crunching code…",
            "Hmm, let me see…", "Cooking something up…", "Deep in thought…",
            "Brain go brrr…", "Almost there…", "Wiring it up…",
        ],
        .waiting: [
            "I need you!", "Your turn 👀", "Waiting on you…", "Can you check this?",
            "Psst, need input!", "Awaiting orders…", "Help me out?", "Stuck, need you!",
        ],
        .done: [
            "All done! ✅", "Finished!", "Ta-da!", "Done and dusted!",
            "Nailed it!", "That's a wrap!", "Mission complete!",
        ],
        .celebrate: [
            "🎉 Woohoo!", "We did it!", "Victory!", "Yesss!", "High five! 🙌", "Champion!",
        ],
    ]
}

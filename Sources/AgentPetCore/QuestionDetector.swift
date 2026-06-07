import Foundation

/// Detects whether a piece of assistant text reads like Claude ended its turn
/// by asking the user something — as opposed to simply reporting completion.
///
/// Pure string logic: no I/O, no actor isolation. Used to correct a session's
/// state from `.done` to `.waiting` when Claude's `Stop` hook fires after a
/// turn that actually ended in a question (Claude Code sends no separate event
/// for "I asked the user something and am waiting for a reply").
public enum QuestionDetector {
    private static let directionPhrases = [
        "let me know",
        "should i",
        "which would you",
        "do you want",
        "want me to",
        "shall i",
        "would you like"
    ]

    /// True if `text` looks like a request for the user's direction: it ends
    /// with a question mark, or contains a recognizable "asking what to do
    /// next" phrase.
    public static func looksLikeQuestion(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        if trimmed.hasSuffix("?") { return true }
        let lowered = trimmed.lowercased()
        return directionPhrases.contains { lowered.contains($0) }
    }
}

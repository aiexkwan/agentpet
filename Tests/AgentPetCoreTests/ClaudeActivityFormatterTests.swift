import XCTest
@testable import AgentPetCore

final class ClaudeActivityFormatterTests: XCTestCase {

    // MARK: - Rotation

    func test_rotation_doesNotRepeatConsecutively() {
        let first = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "rot1",
            toolName: "Read", toolInput: nil, explicitMessage: nil
        )
        let second = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "rot1",
            toolName: "Read", toolInput: nil, explicitMessage: nil
        )
        XCTAssertNotEqual(first, second, "consecutive calls same tool should rotate")
    }

    func test_rotation_cyclesFullPool() {
        // reading pool has 5 phrases — 5 distinct calls must yield 5 distinct phrases
        let poolSize = 5
        var seen = Set<String?>()
        for _ in 0..<poolSize {
            let msg = ClaudeActivityFormatter.activityMessage(
                eventName: "PreToolUse", sessionId: "rot2",
                toolName: "Read", toolInput: nil, explicitMessage: nil
            )
            seen.insert(msg)
        }
        XCTAssertEqual(seen.count, poolSize, "should cycle through all \(poolSize) reading phrases")
    }

    // MARK: - Extension hints

    func test_extensionHint_testFile_reading() {
        let input = ClaudeToolInput(filePath: "Tests/FooTests/BarTests.swift")
        let msg = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "ext1",
            toolName: "Read", toolInput: input, explicitMessage: nil
        )
        XCTAssertEqual(msg, "Reviewing tests…")
    }

    func test_extensionHint_testFile_writing() {
        let input = ClaudeToolInput(filePath: "Tests/FooTests/BarTests.swift")
        let msg = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "ext2",
            toolName: "Edit", toolInput: input, explicitMessage: nil
        )
        XCTAssertEqual(msg, "Refining tests…")
    }

    func test_extensionHint_markdown_reading() {
        let input = ClaudeToolInput(filePath: "README.md")
        let msg = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "ext3",
            toolName: "Read", toolInput: input, explicitMessage: nil
        )
        XCTAssertEqual(msg, "Reading the docs…")
    }

    func test_extensionHint_markdown_writing() {
        let input = ClaudeToolInput(filePath: "docs/guide.md")
        let msg = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "ext4",
            toolName: "Write", toolInput: input, explicitMessage: nil
        )
        XCTAssertEqual(msg, "Updating the docs…")
    }

    func test_extensionHint_json_reading() {
        let input = ClaudeToolInput(filePath: "config/settings.json")
        let msg = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "ext5",
            toolName: "Read", toolInput: input, explicitMessage: nil
        )
        XCTAssertEqual(msg, "Parsing config…")
    }

    func test_extensionHint_plist_writing() {
        let input = ClaudeToolInput(filePath: "Info.plist")
        let msg = ClaudeActivityFormatter.activityMessage(
            eventName: "PreToolUse", sessionId: "ext6",
            toolName: "Edit", toolInput: input, explicitMessage: nil
        )
        XCTAssertEqual(msg, "Adjusting config…")
    }

    // MARK: - State messages

    func test_stateMessage_done_returnsPhrase() {
        XCTAssertNotNil(ClaudeActivityFormatter.stateMessage(for: .done))
    }

    func test_stateMessage_waiting_returnsPhrase() {
        XCTAssertNotNil(ClaudeActivityFormatter.stateMessage(for: .waiting))
    }

    func test_stateMessage_idle_returnsNil() {
        XCTAssertNil(ClaudeActivityFormatter.stateMessage(for: .idle))
    }

    func test_stateMessage_working_returnsNil() {
        XCTAssertNil(ClaudeActivityFormatter.stateMessage(for: .working))
    }

    func test_stateMessage_done_rotates() {
        let first  = ClaudeActivityFormatter.stateMessage(for: .done)
        let second = ClaudeActivityFormatter.stateMessage(for: .done)
        XCTAssertNotEqual(first, second, "done phrases should rotate")
    }
}

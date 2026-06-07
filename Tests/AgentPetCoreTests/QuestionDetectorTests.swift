import XCTest
@testable import AgentPetCore

final class QuestionDetectorTests: XCTestCase {
    func testEndsWithQuestionMark() {
        XCTAssertTrue(QuestionDetector.looksLikeQuestion("Which approach do you prefer, A or B?"))
    }

    func testTrailingWhitespaceAfterQuestionMarkStillDetected() {
        XCTAssertTrue(QuestionDetector.looksLikeQuestion("Want me to push this too?  \n"))
    }

    func testRequestForDirectionPhraseWithoutQuestionMark() {
        XCTAssertTrue(QuestionDetector.looksLikeQuestion(
            "I've made the change. Let me know if you'd like any tweaks."))
        XCTAssertTrue(QuestionDetector.looksLikeQuestion(
            "Should I go ahead and run the migration now"))
    }

    func testPlainCompletionStatementIsNotAQuestion() {
        XCTAssertFalse(QuestionDetector.looksLikeQuestion(
            "Done — fixed the login bug and added a regression test."))
    }

    func testEmptyAndWhitespaceOnlyAreNotQuestions() {
        XCTAssertFalse(QuestionDetector.looksLikeQuestion(""))
        XCTAssertFalse(QuestionDetector.looksLikeQuestion("   \n  "))
    }
}

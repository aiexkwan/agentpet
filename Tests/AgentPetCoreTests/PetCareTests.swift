import XCTest
@testable import AgentPetCore

final class PetCareTests: XCTestCase {

    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private func date(_ s: String) -> Date {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: s)!
    }

    // MARK: - Levels

    func testLevelCurve() {
        XCTAssertEqual(PetCare.xpToReach(level: 1), 0)
        XCTAssertEqual(PetCare.xpToReach(level: 2), 120)
        XCTAssertEqual(PetCare.xpToReach(level: 3), 360)
        XCTAssertEqual(PetCare.level(forXP: 0), 1)
        XCTAssertEqual(PetCare.level(forXP: 119), 1)
        XCTAssertEqual(PetCare.level(forXP: 120), 2)
        XCTAssertEqual(PetCare.level(forXP: 5_400), 10)
        XCTAssertEqual(PetCare.level(forXP: 71_400), 35)
    }

    func testProgressWithinLevel() {
        XCTAssertEqual(PetCare.progress(forXP: 0), 0, accuracy: 0.001)
        XCTAssertEqual(PetCare.progress(forXP: 60), 0.5, accuracy: 0.001)
        XCTAssertEqual(PetCare.progress(forXP: 120), 0, accuracy: 0.001)
    }

    func testStages() {
        XCTAssertEqual(PetCare.stageName(forLevel: 1), "Hatchling")
        XCTAssertEqual(PetCare.stageName(forLevel: 5), "Companion")
        XCTAssertEqual(PetCare.stageName(forLevel: 10), "Scout")
        XCTAssertEqual(PetCare.stageName(forLevel: 20), "Hero")
        XCTAssertEqual(PetCare.stageName(forLevel: 35), "Legend")
        XCTAssertEqual(PetCare.stageIndex(forLevel: 1), 0)
        XCTAssertEqual(PetCare.stageIndex(forLevel: 99), 4)
    }

    // MARK: - Feeding

    func testFeedTokensGrantsXPWithCarry() {
        var s = PetCareState()
        let now = date("2026-06-12 10:00")
        // 12 500 tokens = 2 XP + 2 500 carry
        XCTAssertEqual(PetCare.feedTokens(12_500, state: &s, now: now, calendar: calendar), 2)
        XCTAssertEqual(s.xp, 2)
        XCTAssertEqual(s.tokenCarry, 2_500)
        // 2 500 more reaches one XP exactly via the carry
        XCTAssertEqual(PetCare.feedTokens(2_500, state: &s, now: now, calendar: calendar), 1)
        XCTAssertEqual(s.tokenCarry, 0)
        XCTAssertEqual(s.totalTokens, 15_000)
        XCTAssertEqual(s.tokensToday, 15_000)
    }

    func testDailyTokenCapStopsXPNotTotals() {
        var s = PetCareState()
        let now = date("2026-06-12 10:00")
        PetCare.feedTokens(PetCare.dailyTokenCap, state: &s, now: now, calendar: calendar)
        let xpAtCap = s.xp
        // Past the cap: lifetime total still counts, XP does not.
        PetCare.feedTokens(500_000, state: &s, now: now, calendar: calendar)
        XCTAssertEqual(s.xp, xpAtCap)
        XCTAssertEqual(s.tokensToday, PetCare.dailyTokenCap)
        XCTAssertEqual(s.totalTokens, PetCare.dailyTokenCap + 500_000)
        // Next day the cap resets.
        let tomorrow = date("2026-06-13 09:00")
        XCTAssertEqual(PetCare.feedTokens(5_000, state: &s, now: tomorrow, calendar: calendar), 1)
        XCTAssertEqual(s.tokensToday, 5_000)
    }

    func testMealGrantsFixedXP() {
        var s = PetCareState()
        let now = date("2026-06-12 10:00")
        XCTAssertEqual(PetCare.recordMeal(state: &s, now: now, calendar: calendar), PetCare.mealXP)
        XCTAssertEqual(s.totalMeals, 1)
        XCTAssertEqual(s.mealsToday, 1)
        XCTAssertEqual(s.lastFedAt, now)
    }

    // MARK: - Hunger

    func testHungerThresholds() {
        var s = PetCareState()
        let fed = date("2026-06-12 00:00")
        XCTAssertEqual(PetCare.hunger(state: s, now: fed), .peckish, "never fed → peckish")
        PetCare.recordMeal(state: &s, now: fed, calendar: calendar)
        XCTAssertEqual(PetCare.hunger(state: s, now: date("2026-06-12 02:00")), .full)
        XCTAssertEqual(PetCare.hunger(state: s, now: date("2026-06-12 06:00")), .satisfied)
        XCTAssertEqual(PetCare.hunger(state: s, now: date("2026-06-12 12:00")), .peckish)
        XCTAssertEqual(PetCare.hunger(state: s, now: date("2026-06-13 06:00")), .hungry)
        XCTAssertEqual(PetCare.hunger(state: s, now: date("2026-06-14 06:00")), .starving)
    }

    // MARK: - Streaks

    func testStreakCountsConsecutiveDays() {
        var s = PetCareState()
        PetCare.recordMeal(state: &s, now: date("2026-06-12 10:00"), calendar: calendar)
        XCTAssertEqual(s.streakDays, 1)
        // Same day: unchanged.
        PetCare.recordMeal(state: &s, now: date("2026-06-12 18:00"), calendar: calendar)
        XCTAssertEqual(s.streakDays, 1)
        // Next day: +1.
        PetCare.recordMeal(state: &s, now: date("2026-06-13 09:00"), calendar: calendar)
        XCTAssertEqual(s.streakDays, 2)
        // Skipping a day resets to 1.
        PetCare.recordMeal(state: &s, now: date("2026-06-15 09:00"), calendar: calendar)
        XCTAssertEqual(s.streakDays, 1)
    }

    func testDayRolloverResetsDailyCounters() {
        var s = PetCareState()
        PetCare.feedTokens(10_000, state: &s, now: date("2026-06-12 10:00"), calendar: calendar)
        PetCare.recordMeal(state: &s, now: date("2026-06-12 10:01"), calendar: calendar)
        PetCare.rollover(&s, now: date("2026-06-13 00:01"), calendar: calendar)
        XCTAssertEqual(s.tokensToday, 0)
        XCTAssertEqual(s.mealsToday, 0)
        XCTAssertEqual(s.totalTokens, 10_000, "lifetime totals survive the rollover")
        XCTAssertEqual(s.totalMeals, 1)
    }

    func testDailyHistoryTracksFullBurnAndPrunes() {
        var s = PetCareState()
        PetCare.feedTokens(PetCare.dailyTokenCap + 500_000, state: &s,
                           now: date("2026-06-12 10:00"), calendar: calendar)
        XCTAssertEqual(s.days?["2026-06-12"], PetCare.dailyTokenCap + 500_000,
                       "history keeps the full burn, beyond the XP cap")
        // 15 more days of feeding → history pruned to 14 entries.
        for day in 13...27 {
            PetCare.feedTokens(1_000, state: &s,
                               now: date(String(format: "2026-06-%02d 10:00", day)), calendar: calendar)
        }
        XCTAssertEqual(s.days?.count, 14)
        XCTAssertNil(s.days?["2026-06-12"], "oldest day dropped")
        let recent = PetCare.recentDays(state: s, now: date("2026-06-27 12:00"), calendar: calendar)
        XCTAssertEqual(recent.count, 7)
        XCTAssertEqual(recent.last?.tokens, 1_000)
        XCTAssertEqual(recent.last?.label, "27")
    }

    func testOldStateWithoutDaysStillDecodes() throws {
        let old = #"{"xp":100,"tokenCarry":0,"tokensToday":0,"mealsToday":0,"totalTokens":100,"totalMeals":1,"dayKey":"2026-06-11","streakDays":1}"#
        let s = try JSONDecoder().decode(PetCareState.self, from: old.data(using: .utf8)!)
        XCTAssertNil(s.days)
        XCTAssertEqual(s.xp, 100)
    }

    func testStatePersistsThroughCodable() throws {
        var s = PetCareState()
        PetCare.feedTokens(123_456, state: &s, now: date("2026-06-12 10:00"), calendar: calendar)
        PetCare.recordMeal(state: &s, now: date("2026-06-12 11:00"), calendar: calendar)
        let data = try JSONEncoder().encode(s)
        let back = try JSONDecoder().decode(PetCareState.self, from: data)
        XCTAssertEqual(back, s)
    }
}

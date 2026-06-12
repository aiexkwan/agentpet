import Foundation

/// How hungry the pet is, derived from the time since its last feeding.
public enum PetHunger: String, Codable, CaseIterable, Sendable {
    case full
    case satisfied
    case peckish
    case hungry
    case starving
}

/// Persistent tamagotchi state: the pet is fed by real agent work — tokens
/// consumed (Claude transcripts) and finished sessions ("meals").
public struct PetCareState: Codable, Equatable, Sendable {
    /// Lifetime experience. Never decreases.
    public var xp: Int
    /// Tokens left over below one-XP granularity, carried to the next feeding.
    public var tokenCarry: Int
    /// Tokens eaten today (counts toward the daily cap; resets at local midnight).
    public var tokensToday: Int
    /// Sessions finished today.
    public var mealsToday: Int
    /// Lifetime tokens eaten (uncapped, for bragging rights).
    public var totalTokens: Int
    /// Lifetime finished sessions.
    public var totalMeals: Int
    /// Last time the pet was fed anything (tokens or a meal).
    public var lastFedAt: Date?
    /// Local-calendar day the counters belong to ("2026-06-12").
    public var dayKey: String
    /// Consecutive days with at least one feeding.
    public var streakDays: Int
    /// Day of the most recent feeding, for streak bookkeeping.
    public var lastFedDayKey: String?
    /// Tokens eaten per day ("2026-06-12" → tokens), kept for the last 14 days
    /// to draw the weekly trend. Optional so states saved before this field
    /// existed still decode.
    public var days: [String: Int]?

    public init() {
        xp = 0
        tokenCarry = 0
        tokensToday = 0
        mealsToday = 0
        totalTokens = 0
        totalMeals = 0
        lastFedAt = nil
        dayKey = ""
        streakDays = 0
        lastFedDayKey = nil
        days = [:]
    }
}

/// Pure feeding/levelling rules. Deliberately free of wall-clock reads:
/// callers pass `now` so behaviour is deterministic and testable.
public enum PetCare {

    /// One XP per this many tokens eaten.
    public static let tokensPerXP = 5_000
    /// Tokens counted per day. The cap keeps "burn more tokens" from being a
    /// growth strategy — once the pet is full, eating more does nothing.
    public static let dailyTokenCap = 2_000_000
    /// XP for finishing a session. Worth more per unit than raw burn so
    /// *completing* work beats merely consuming.
    public static let mealXP = 25

    // MARK: - Levels

    /// Levelling from `level` to `level + 1` costs `120 * level` XP, so the
    /// total XP to *reach* level `n` is `60·n·(n−1)`. Level 2 ≈ 5 finished
    /// sessions; level 10 needs 5 400 XP; level 35 (Legend) 71 400.
    public static func xpToReach(level: Int) -> Int {
        guard level > 1 else { return 0 }
        return 60 * level * (level - 1)
    }

    public static func level(forXP xp: Int) -> Int {
        var level = 1
        while xpToReach(level: level + 1) <= xp { level += 1 }
        return level
    }

    /// Progress within the current level, 0…1.
    public static func progress(forXP xp: Int) -> Double {
        let level = level(forXP: xp)
        let floor = xpToReach(level: level)
        let ceiling = xpToReach(level: level + 1)
        guard ceiling > floor else { return 0 }
        return Double(xp - floor) / Double(ceiling - floor)
    }

    /// Evolution stages by level. Returned as a localization key.
    public static func stageName(forLevel level: Int) -> String {
        switch level {
        case ..<5: return "Hatchling"
        case 5..<10: return "Companion"
        case 10..<20: return "Scout"
        case 20..<35: return "Hero"
        default: return "Legend"
        }
    }

    /// Stage index 0…4 (for badge styling).
    public static func stageIndex(forLevel level: Int) -> Int {
        switch level {
        case ..<5: return 0
        case 5..<10: return 1
        case 10..<20: return 2
        case 20..<35: return 3
        default: return 4
        }
    }

    // MARK: - Hunger

    /// Hunger from the time since the last feeding. A pet that has never been
    /// fed starts merely peckish — not punishing on first launch.
    public static func hunger(state: PetCareState, now: Date) -> PetHunger {
        guard let last = state.lastFedAt else { return .peckish }
        let hours = now.timeIntervalSince(last) / 3600
        switch hours {
        case ..<4: return .full
        case ..<10: return .satisfied
        case ..<24: return .peckish
        case ..<48: return .hungry
        default: return .starving
        }
    }

    // MARK: - Feeding

    /// Feeds `tokens` (e.g. a Claude turn's usage delta). Counts toward the
    /// daily cap; XP accrues at `tokensPerXP` with sub-XP remainder carried.
    /// Returns the XP gained.
    @discardableResult
    public static func feedTokens(
        _ tokens: Int, state: inout PetCareState, now: Date, calendar: Calendar = .current
    ) -> Int {
        guard tokens > 0 else { return 0 }
        rollover(&state, now: now, calendar: calendar)

        let room = max(0, dailyTokenCap - state.tokensToday)
        let counted = min(tokens, room)
        state.totalTokens += tokens
        state.tokensToday += counted

        // Daily history for the weekly trend (full burn, not just the capped
        // part). Pruned to the most recent 14 entries.
        let today = dayKey(for: now, calendar: calendar)
        var days = state.days ?? [:]
        days[today, default: 0] += tokens
        if days.count > 14 {
            for key in days.keys.sorted().dropLast(14) { days.removeValue(forKey: key) }
        }
        state.days = days

        var gained = 0
        if counted > 0 {
            let pool = state.tokenCarry + counted
            gained = pool / tokensPerXP
            state.tokenCarry = pool % tokensPerXP
            state.xp += gained
        }
        markFed(&state, now: now, calendar: calendar)
        return gained
    }

    /// Records a finished session ("a proper meal"). Returns the XP gained.
    @discardableResult
    public static func recordMeal(
        state: inout PetCareState, now: Date, calendar: Calendar = .current
    ) -> Int {
        rollover(&state, now: now, calendar: calendar)
        state.totalMeals += 1
        state.mealsToday += 1
        state.xp += mealXP
        markFed(&state, now: now, calendar: calendar)
        return mealXP
    }

    /// Resets the daily counters when the local calendar day has changed.
    /// Public so observers (UI refresh timers) can roll the day over too.
    public static func rollover(
        _ state: inout PetCareState, now: Date, calendar: Calendar = .current
    ) {
        let today = dayKey(for: now, calendar: calendar)
        guard state.dayKey != today else { return }
        state.dayKey = today
        state.tokensToday = 0
        state.mealsToday = 0
    }

    /// Tokens per day for the trailing `count` days ending today, oldest first.
    /// Labels are the day-of-month, for compact trend axes.
    public static func recentDays(
        state: PetCareState, now: Date, count: Int = 7, calendar: Calendar = .current
    ) -> [(label: String, tokens: Int)] {
        var out: [(String, Int)] = []
        for offset in stride(from: count - 1, through: 0, by: -1) {
            guard let d = calendar.date(byAdding: .day, value: -offset, to: now) else { continue }
            let key = dayKey(for: d, calendar: calendar)
            let day = calendar.dateComponents([.day], from: d).day ?? 0
            out.append(("\(day)", state.days?[key] ?? 0))
        }
        return out
    }

    public static func dayKey(for date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func markFed(_ state: inout PetCareState, now: Date, calendar: Calendar) {
        state.lastFedAt = now
        let today = dayKey(for: now, calendar: calendar)
        if state.lastFedDayKey != today {
            let yesterday = calendar.date(byAdding: .day, value: -1, to: now)
                .map { dayKey(for: $0, calendar: calendar) }
            state.streakDays = (state.lastFedDayKey == yesterday) ? state.streakDays + 1 : 1
            state.lastFedDayKey = today
        }
    }
}

import AgentPetCore
import Foundation

/// CLI helper invoked by agent hooks: `agentpet hook --event ... --session ...`.
/// Fully implemented in issue #4; stubbed here so the entry point compiles.
enum HookCLI {
    static func run(arguments: [String]) -> Never {
        FileHandle.standardError.write(Data("agentpet hook: not implemented yet (issue #4)\n".utf8))
        exit(0)
    }
}

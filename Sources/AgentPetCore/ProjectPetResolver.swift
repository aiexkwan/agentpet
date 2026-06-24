import Foundation

public enum ProjectPetResolver {
    /// Most-specific (longest projectPath) mapping whose folder contains `cwd`.
    public static func mapping(forProject cwd: String?,
                               mappings: [ProjectPetMapping]) -> ProjectPetMapping? {
        guard let cwd, !cwd.isEmpty else { return nil }
        let target = normalize(cwd)
        return mappings
            .filter { contains(root: normalize($0.projectPath), path: target) }
            .max { normalize($0.projectPath).count < normalize($1.projectPath).count }
    }

    /// True when `path` equals `root` or is a descendant directory of `root`.
    /// Boundary-aware: "/work/foo" does not contain "/work/foobar".
    static func contains(root: String, path: String) -> Bool {
        if path == root { return true }
        return path.hasPrefix(root + "/")
    }

    /// Strips a trailing slash and standardises the path.
    public static func normalize(_ path: String) -> String {
        let std = (path as NSString).standardizingPath
        if std.count > 1 && std.hasSuffix("/") { return String(std.dropLast()) }
        return std
    }
}

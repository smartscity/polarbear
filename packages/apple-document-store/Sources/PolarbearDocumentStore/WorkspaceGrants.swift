import Foundation

protocol BookmarkAccess {
    func create(_ url: URL) throws -> Data
    func resolve(_ data: Data) throws -> (url: URL, stale: Bool)
    func start(_ url: URL) -> Bool
    func stop(_ url: URL)
}

struct SystemBookmarkAccess: BookmarkAccess {
    func create(_ url: URL) throws -> Data {
        #if os(macOS)
        return try url.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        #else
        return try url.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil)
        #endif
    }

    func resolve(_ data: Data) throws -> (url: URL, stale: Bool) {
        var stale = false
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = [.withSecurityScope, .withoutUI]
        #else
        let options: URL.BookmarkResolutionOptions = [.withoutUI]
        #endif
        let url = try URL(resolvingBookmarkData: data, options: options, relativeTo: nil, bookmarkDataIsStale: &stale)
        return (url, stale)
    }

    func start(_ url: URL) -> Bool { url.startAccessingSecurityScopedResource() }
    func stop(_ url: URL) { url.stopAccessingSecurityScopedResource() }
}

private struct WorkspaceGrant: Codable {
    let schemaVersion: Int
    let workspace: LinkedWorkspace
    let bookmark: Data
}

/// The host supplies only URLs obtained from its native folder picker.
/// Bookmark bytes and absolute paths are never part of the WebView contract.
final class WorkspaceGrants {
    private let directory: URL
    private let access: any BookmarkAccess
    private let fm = FileManager.default

    init(directory: URL, access: any BookmarkAccess = SystemBookmarkAccess()) {
        self.directory = directory
        self.access = access
    }

    func connect(_ selectedURL: URL) throws -> LinkedWorkspace {
        guard selectedURL.isFileURL else { throw DocumentFailure.invalidPath }
        let scoped = access.start(selectedURL)
        defer { if scoped { access.stop(selectedURL) } }
        try requireDirectory(selectedURL)
        let workspace = LinkedWorkspace(id: UUID().uuidString, name: selectedURL.lastPathComponent)
        let grant = WorkspaceGrant(schemaVersion: 1, workspace: workspace, bookmark: try access.create(selectedURL))
        try write(grant)
        return workspace
    }

    func list() throws -> [LinkedWorkspace] {
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .map { try read($0.deletingPathExtension().lastPathComponent).workspace }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    func withRoot<T>(_ id: String, _ action: (URL) throws -> T) throws -> T {
        let grant = try read(id)
        let resolved: (url: URL, stale: Bool)
        do { resolved = try access.resolve(grant.bookmark) }
        catch { throw DocumentFailure.permission }
        let scoped = access.start(resolved.url)
        defer { if scoped { access.stop(resolved.url) } }
        // A false start is valid for non-sandboxed paths; the actual access remains authoritative.
        do { try requireDirectory(resolved.url) }
        catch { throw DocumentFailure.classify(error) }
        if resolved.stale {
            try write(WorkspaceGrant(schemaVersion: 1, workspace: grant.workspace, bookmark: try access.create(resolved.url)))
        }
        return try action(resolved.url.standardizedFileURL)
    }

    private func read(_ id: String) throws -> WorkspaceGrant {
        guard UUID(uuidString: id) != nil else { throw DocumentFailure.invalidPath }
        let grant: WorkspaceGrant
        do { grant = try JSONDecoder().decode(WorkspaceGrant.self, from: Data(contentsOf: directory.appendingPathComponent(id + ".json"))) }
        catch { throw DocumentFailure.invalidMetadata }
        guard grant.schemaVersion == 1, grant.workspace.id == id else { throw DocumentFailure.invalidMetadata }
        return grant
    }

    private func write(_ grant: WorkspaceGrant) throws {
        do {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(grant).write(to: directory.appendingPathComponent(grant.workspace.id + ".json"), options: .atomic)
        } catch { throw DocumentFailure.storageFailure }
    }
}

func requireDirectory(_ url: URL) throws {
    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else { throw DocumentFailure.invalidPath }
}

func documentURL(root: URL, relativePath: String) throws -> URL {
    let parts = relativePath.split(separator: "/", omittingEmptySubsequences: false)
    guard !parts.isEmpty, !relativePath.contains("\\"), !relativePath.contains("\0"),
          parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.hasPrefix(".") }),
          ["md", "markdown"].contains((relativePath as NSString).pathExtension.lowercased()) else {
        throw DocumentFailure.invalidPath
    }
    let base = root.resolvingSymlinksInPath().standardizedFileURL
    var url = base
    for (index, part) in parts.enumerated() {
        url.appendPathComponent(String(part))
        do {
            let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey, .isRegularFileKey])
            guard values.isSymbolicLink != true else { throw DocumentFailure.invalidPath }
            if index < parts.count - 1 {
                guard values.isDirectory == true else { throw DocumentFailure.invalidPath }
            } else if values.isRegularFile != true { throw DocumentFailure.invalidPath }
        } catch {
            let native = error as NSError
            // Only a missing leaf beneath an accessible, existing parent is a confirmed deletion.
            if index == parts.count - 1, native.domain == NSCocoaErrorDomain,
               native.code == NSFileReadNoSuchFileError || native.code == NSFileNoSuchFileError {
                try requireDirectory(url.deletingLastPathComponent())
                throw DocumentFailure.missing
            }
            throw error
        }
    }
    guard url.resolvingSymlinksInPath().standardizedFileURL.pathComponents.starts(with: base.pathComponents) else { throw DocumentFailure.invalidPath }
    return url
}

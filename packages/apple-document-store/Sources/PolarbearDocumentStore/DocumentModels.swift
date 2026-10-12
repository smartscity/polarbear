import CryptoKit
import Foundation

public enum DocumentFailure: String, Error, Codable {
    case invalidPath, unsupportedFile, invalidEncoding, tooLarge
    case permission, unavailable, missing, downloading, storageFailure
    case invalidSession, staleGeneration, revisionMismatch, recoveryRequired, invalidMetadata

    static func classify(_ error: Error) -> DocumentFailure {
        if let failure = error as? DocumentFailure { return failure }
        let native = error as NSError
        if native.domain == NSCocoaErrorDomain {
            switch native.code {
            case NSFileReadNoPermissionError, NSFileWriteNoPermissionError: return .permission
            // Missing is established separately after confirming the authorized parent exists.
            default: break
            }
        }
        return .unavailable
    }
}

public enum DocumentLimits {
    public static let bytes = 5 * 1024 * 1024
    public static let directoryEntries = 2000
    public static let generation = 9_007_199_254_740_991
}

public struct DocumentReference: Codable, Equatable {
    public let workspaceId: String
    public let relativePath: String

    public init(workspaceId: String, relativePath: String) {
        self.workspaceId = workspaceId
        self.relativePath = relativePath
    }

    var storageId: String { digest(Data((workspaceId + "\0" + relativePath).utf8)) }
}

public struct LinkedWorkspace: Codable, Equatable {
    public let id: String
    public let name: String
}

public struct EditToken: Codable {
    public let sessionId: String
    public let generation: Int

    public init(sessionId: String, generation: Int) {
        self.sessionId = sessionId
        self.generation = generation
    }
}

public struct DocumentSnapshot: Codable {
    public let sessionId: String
    public let text: String
    public let revision: String
    public let recovery: DocumentDraft?
}

/// Device-local recovery data, never stored in the selected document folder.
public struct DocumentDraft: Codable, Equatable {
    public let schemaVersion: Int
    public let id: String
    public let document: DocumentReference
    public let sessionId: String
    public let generation: Int
    public let baseRevision: String
    public let baseText: String
    public let text: String
    public let recordedAt: Double
}

public struct DocumentSaveResult: Codable {
    public enum Kind: String, Codable { case saved, conflict, missing, deferred }
    public let kind: Kind
    public let generation: Int
    public let revision: String?
    public let recoveryId: String?
    public let reason: DocumentFailure?
}

func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func revision(_ data: Data) -> String { "sha256:" + digest(data) }

func checkedText(_ data: Data) throws -> String {
    guard data.count <= DocumentLimits.bytes else { throw DocumentFailure.tooLarge }
    guard String(data: data, encoding: .utf8) != nil else { throw DocumentFailure.invalidEncoding }
    // Foundation validates UTF-8 but strips its BOM. Core decoding preserves every valid byte
    // on the supported macOS 11 / iOS 16 baselines, including BOM and original line endings.
    return String(decoding: data, as: UTF8.self)
}

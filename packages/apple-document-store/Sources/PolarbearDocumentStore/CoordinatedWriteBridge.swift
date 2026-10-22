import Foundation

// The synchronous accessor keeps revision validation and replacement in one coordinated write.
@_cdecl("polarbear_coordinate_document_write")
public func coordinateDocumentWrite(
    _ path: UnsafePointer<CChar>,
    _ context: UnsafeMutableRawPointer?,
    _ accessor: @convention(c) (UnsafePointer<CChar>, UnsafeMutableRawPointer?) -> Void
) -> Int32 {
    autoreleasepool {
        do {
            try SystemDocumentCoordination().write(URL(fileURLWithPath: String(cString: path))) { url in
                url.withUnsafeFileSystemRepresentation { resolved in
                    if let resolved { accessor(resolved, context) }
                }
            }
            return 0
        } catch {
            return 1
        }
    }
}

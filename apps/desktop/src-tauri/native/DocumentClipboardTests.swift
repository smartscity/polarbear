import AppKit
import Foundation

@main
struct ClipboardTests {
    static func main() throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 16, pixelsHigh: 16,
                                      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                      isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let png = bitmap.representation(using: .png, properties: [:])!.base64EncodedString()
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("First\nSecond", forType: .string)
        precondition(clipboardLease("First\r\nSecond", from: pasteboard) == Int64(pasteboard.changeCount))
        precondition(clipboardLease("Unrelated", from: pasteboard) == -1)
        pasteboard.setString("Original Markdown", forType: .string)
        let runs = [ClipboardRun(text: "Before 中文 😀\n", bold: true), ClipboardRun(png: png),
                    ClipboardRun(text: "\nMiddle\n"), ClipboardRun(png: png), ClipboardRun(text: "\nAfter")]
        let document = DocumentClipboard(markdown: "Original Markdown", html: "<p>Fallback</p>", runs: runs, expectedChangeCount: pasteboard.changeCount)
        try writeDocument(document, to: pasteboard)
        for type in [NSPasteboard.PasteboardType.string, .html, .rtf, .rtfd] {
            precondition(pasteboard.data(forType: type) != nil, "Missing representation: \(type)")
        }
        // Exercise an actual native paste receiver rather than only checking PNG generation.
        let receiver = NSTextView()
        receiver.isRichText = true
        receiver.importsGraphics = true
        precondition(receiver.readSelection(from: pasteboard, type: .rtfd), "Native paste failed")
        var attachments = 0
        receiver.textStorage!.enumerateAttribute(.attachment, in: NSRange(location: 0, length: receiver.textStorage!.length)) { value, _, _ in
            if value is NSTextAttachment { attachments += 1 }
        }
        precondition(attachments == 2, "Both diagrams must be native image attachments")
        precondition(receiver.string.contains("Before 中文 😀") && receiver.string.contains("After"))
        precondition(pasteboard.string(forType: .string) == "Original Markdown")
        let rtf = String(data: pasteboard.data(forType: .rtf)!, encoding: .utf8)!
        precondition(rtf.components(separatedBy: "\\pngblip").count == 3)
        precondition(rtfEscape("{\\}😀").contains("\\u-10179?\\u-8704?"))
        do { try writeDocument(document, to: pasteboard); fatalError("Stale copy overwrote clipboard") }
        catch ClipboardFailure.changed { }
        print("PASS: native paste receives two image attachments, surrounding Unicode text, four clipboard formats, and stale-copy protection")
        if CommandLine.arguments.count >= 2 {
            var fixture = try JSONDecoder().decode(DocumentClipboard.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
            fixture.expectedChangeCount = pasteboard.changeCount
            try writeDocument(fixture, to: pasteboard)
            let target = NSTextView()
            target.isRichText = true
            target.importsGraphics = true
            precondition(target.readSelection(from: pasteboard, type: .rtfd))
            var count = 0
            target.textStorage!.enumerateAttribute(.attachment, in: NSRange(location: 0, length: target.textStorage!.length)) { value, _, _ in
                if let attachment = value as? NSTextAttachment {
                    precondition(attachment.fileWrapper?.regularFileContents != nil)
                    count += 1
                }
            }
            precondition(count == fixture.runs.filter { $0.png != nil }.count)
            precondition(count > 0 && target.string.contains("After"))
            precondition(pasteboard.string(forType: .string) == fixture.plainText)
            precondition(pasteboard.string(forType: NSPasteboard.PasteboardType("net.daringfireball.markdown")) == fixture.markdown)
            var tableFound = false
            target.textStorage!.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: target.textStorage!.length)) { value, _, _ in
                if let style = value as? NSParagraphStyle, style.textBlocks.contains(where: { $0 is NSTextTableBlock }) { tableFound = true }
            }
            precondition(tableFound, "Table structure must survive native paste")
            print("PASS: native receiver pasted all \(count) real Mermaid attachments and surrounding text")
            if CommandLine.arguments.contains("--word") { try verifyWord(fixture) }
        }
        let lease = pasteboard.changeCount
        try writeClipboardImage(png, expectedChangeCount: lease, to: pasteboard)
        precondition(pasteboard.data(forType: .png) == Data(base64Encoded: png))
        do { try writeClipboardImage(png, expectedChangeCount: lease, to: pasteboard); fatalError("Stale image copy overwrote clipboard") }
        catch ClipboardFailure.changed { }
        print("PASS: single-image PNG copying and stale-copy protection")
    }

    static func verifyWord(_ document: DocumentClipboard) throws {
        let board = NSPasteboard.general
        let backup = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
            let copy = NSPasteboardItem()
            for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
            return copy
        }
        var fixture = document
        fixture.expectedChangeCount = board.changeCount
        try writeDocument(fixture, to: board)
        let lease = board.changeCount
        defer { if board.changeCount == lease { board.clearContents(); if !backup.isEmpty { board.writeObjects(backup) } } }
        let script = NSAppleScript(source: """
        local testDocument, imageCount, tableCount, bodyText
        with timeout of 45 seconds
          tell application "Microsoft Word"
            set testDocument to make new document
            try
              paste object (text object of testDocument)
              set imageCount to count of inline shapes of testDocument
              set tableCount to count of tables of testDocument
              set bodyText to content of text object of testDocument
              close testDocument saving no
              if imageCount is not 3 then error "Expected three images, received " & imageCount
              if tableCount is not 1 then error "Expected one table, received " & tableCount
              if bodyText does not contain "After" then error "Trailing text missing"
              if bodyText contains "flowchart TD" then error "Diagram source leaked into rich paste"
              return "PASS: Word pasted three images, one table and surrounding text"
            on error messageText number errorNumber
              try
                close testDocument saving no
              end try
              error messageText number errorNumber
            end try
          end tell
        end timeout
        """)!
        var error: NSDictionary?
        let result = script.executeAndReturnError(&error)
        if let error {
            let code = error[NSAppleScript.errorNumber] as? Int ?? 0
            if [-2753, -1743, -1712, -600].contains(code) { print("BLOCKED: Word automation cannot provide a temporary document: \(error)") }
            else { throw NSError(domain: "WordPasteVerification", code: code, userInfo: [NSLocalizedDescriptionKey: error.description]) }
        }
        else { print(result.stringValue ?? "FAIL: Word returned no verification result") }
    }
}

import AppKit
import Foundation

struct ClipboardRun: Codable {
    var text: String?
    var png: String?
    var bold: Bool?
    var italic: Bool?
    var code: Bool?
}

struct DocumentClipboard: Codable {
    var markdown: String
    var html: String
    var runs: [ClipboardRun]
    var expectedChangeCount: Int
}

enum ClipboardFailure: Error { case invalidImage, tooLarge, changed, writeFailed }

// RTFD is the native attachment representation. RTF embeds PNG bytes for
// receivers that support rich text but do not understand Apple's RTFD format.
func documentRepresentations(_ document: DocumentClipboard) throws -> [NSPasteboard.PasteboardType: Data] {
    let attributed = NSMutableAttributedString(string: "")
    var rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Helvetica;}{\\f1 Menlo;}}\\uc1\\fs24 "
    var imageBytes = 0
    for run in document.runs {
        if let encoded = run.png {
            guard let data = Data(base64Encoded: encoded),
                  data.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]),
                  let image = NSImage(data: data), image.size.width > 0, image.size.height > 0 else {
                throw ClipboardFailure.invalidImage
            }
            imageBytes += data.count
            guard imageBytes <= 32 * 1024 * 1024 else { throw ClipboardFailure.tooLarge }
            let attachment = NSTextAttachment(data: data, ofType: "public.png")
            let scale = min(1, 540 / image.size.width)
            attachment.bounds = NSRect(x: 0, y: 0, width: image.size.width * scale, height: image.size.height * scale)
            attributed.append(NSAttributedString(attachment: attachment))
            let pixels = NSBitmapImageRep(data: data)
            let width = pixels?.pixelsWide ?? Int(image.size.width)
            let height = pixels?.pixelsHigh ?? Int(image.size.height)
            rtf += "{\\pict\\pngblip\\picw\(width)\\pich\(height)\\picwgoal\(Int(attachment.bounds.width * 20))\\pichgoal\(Int(attachment.bounds.height * 20))\n"
            let digits = Array("0123456789abcdef".utf8)
            var hex: [UInt8] = []
            hex.reserveCapacity(data.count * 2)
            for byte in data { hex.append(digits[Int(byte >> 4)]); hex.append(digits[Int(byte & 15)]) }
            rtf += String(decoding: hex, as: UTF8.self) + "}"
        } else if let text = run.text {
            var font = run.code == true ? NSFont.monospacedSystemFont(ofSize: 12, weight: .regular) : NSFont.systemFont(ofSize: 12)
            if run.bold == true { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
            if run.italic == true { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
            attributed.append(NSAttributedString(string: text, attributes: [.font: font]))
            rtf += "{\\f\(run.code == true ? 1 : 0)"
            if run.bold == true { rtf += "\\b" }
            if run.italic == true { rtf += "\\i" }
            rtf += " " + rtfEscape(text) + "}"
        }
    }
    rtf += "}"
    guard let rtfd = attributed.rtfd(from: NSRange(location: 0, length: attributed.length), documentAttributes: [:]) else {
        throw ClipboardFailure.writeFailed
    }
    return [.string: Data(document.markdown.utf8), .html: Data(document.html.utf8),
            .rtf: Data(rtf.utf8), .rtfd: rtfd]
}

func rtfEscape(_ text: String) -> String {
    text.utf16.map { unit in
        switch unit {
        case 92: return "\\\\"
        case 123: return "\\{"
        case 125: return "\\}"
        case 10: return "\\par\n"
        case 13: return ""
        case 9: return "\\tab "
        case 32...126: return String(UnicodeScalar(unit)!)
        default: return "\\u\(Int16(bitPattern: unit))?"
        }
    }.joined()
}

func writeDocument(_ document: DocumentClipboard, to pasteboard: NSPasteboard) throws {
    let representations = try documentRepresentations(document)
    guard pasteboard.changeCount == document.expectedChangeCount else { throw ClipboardFailure.changed }
    let item = NSPasteboardItem()
    for (type, data) in representations {
        guard item.setData(data, forType: type) else { throw ClipboardFailure.writeFailed }
    }
    pasteboard.clearContents()
    guard pasteboard.writeObjects([item]) else { throw ClipboardFailure.writeFailed }
}

@_cdecl("polarbear_clipboard_begin")
func clipboardBegin(_ markdown: UnsafePointer<CChar>) -> Int64 {
    clipboardLease(String(cString: markdown), from: .general)
}

func clipboardLease(_ markdown: String, from pasteboard: NSPasteboard) -> Int64 {
    let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n")
    guard pasteboard.string(forType: .string)?.replacingOccurrences(of: "\r\n", with: "\n") == normalized else { return -1 }
    return Int64(pasteboard.changeCount)
}

@_cdecl("polarbear_clipboard_write")
func clipboardWrite(_ json: UnsafePointer<CChar>) -> Int32 {
    do {
        let document = try JSONDecoder().decode(DocumentClipboard.self, from: Data(String(cString: json).utf8))
        try writeDocument(document, to: .general)
        return 0
    } catch ClipboardFailure.changed { return 1 }
      catch { return 2 }
}

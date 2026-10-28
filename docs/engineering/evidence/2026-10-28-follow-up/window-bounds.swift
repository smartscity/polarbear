import AppKit
import CoreGraphics
import Foundation
let processes = NSRunningApplication.runningApplications(withBundleIdentifier: "dev.polarbear.recentacceptance").map { Int($0.processIdentifier) }
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let owned = windows.filter { processes.contains(($0[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1) }
let data = try JSONSerialization.data(withJSONObject: owned, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)

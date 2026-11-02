import CoreGraphics
import Foundation

let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let candidates = windows.compactMap { window -> (Int, Double)? in
    guard
        let owner = window[kCGWindowOwnerName as String] as? String,
        owner.localizedCaseInsensitiveContains("Rhema"),
        (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
        ((window[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0.1,
        let number = (window[kCGWindowNumber as String] as? NSNumber)?.intValue,
        let bounds = window[kCGWindowBounds as String] as? NSDictionary,
        let width = (bounds["Width"] as? NSNumber)?.doubleValue,
        let height = (bounds["Height"] as? NSNumber)?.doubleValue
    else { return nil }
    return (number, width * height)
}

guard let window = candidates.max(by: { $0.1 < $1.1 }) else {
    let diagnostics = windows.map { window in
        let owner = window[kCGWindowOwnerName as String] as? String ?? "?"
        let title = window[kCGWindowName as String] as? String ?? ""
        let layer = (window[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
        return "\(owner) [layer \(layer)] \(title)"
    }.joined(separator: " | ")
    fputs("No Rhema window found for native screenshot capture. Window Server returned \(windows.count) windows: \(diagnostics)\n", stderr)
    exit(1)
}
print(window.0)

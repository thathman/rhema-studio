// Inspect a Rhema recording with AVFoundation: tracks, duration, audio level, and stills at given times.
// usage: swift scripts/mac-qa/probe-recording.swift <file.mp4> <out-dir> [seconds ...]
// Prints one JSON object. Development/QA only; nothing here ships.
import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: probe-recording.swift <file> <out-dir> [seconds ...]"); exit(2) }
let url = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let times = args.dropFirst(3).compactMap(Double.init)

let asset = AVURLAsset(url: url)
let video = asset.tracks(withMediaType: .video)
let audio = asset.tracks(withMediaType: .audio)
var out: [String: Any] = [
    "durationS": CMTimeGetSeconds(asset.duration),
    "videoTracks": video.count,
    "audioTracks": audio.count,
]
if let v = video.first {
    out["size"] = [v.naturalSize.width, v.naturalSize.height]
    out["videoStartS"] = CMTimeGetSeconds(v.timeRange.start)
    out["videoFrames"] = v.nominalFrameRate * Float(CMTimeGetSeconds(v.timeRange.duration))
    if let f = v.formatDescriptions.first { out["videoCodec"] = String(describing: CMFormatDescriptionGetMediaSubType(f as! CMFormatDescription)) }
}
if let a = audio.first {
    out["audioStartS"] = CMTimeGetSeconds(a.timeRange.start)
    out["audioDurationS"] = CMTimeGetSeconds(a.timeRange.duration)
    // Peak level of the decoded sound, so "has audio" means real sound, not a silent track.
    if let reader = try? AVAssetReader(asset: asset) {
        let o = AVAssetReaderTrackOutput(track: a, outputSettings: [AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsNonInterleaved: false])
        reader.add(o)
        reader.startReading()
        var peak: Float = 0
        while let sb = o.copyNextSampleBuffer(), let bb = CMSampleBufferGetDataBuffer(sb) {
            var len = 0
            var ptr: UnsafeMutablePointer<Int8>?
            CMBlockBufferGetDataPointer(bb, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &len, dataPointerOut: &ptr)
            if let p = ptr {
                p.withMemoryRebound(to: Float.self, capacity: len / 4) { f in
                    for i in 0..<(len / 4) { peak = max(peak, abs(f[i])) }
                }
            }
        }
        out["audioPeakDb"] = peak > 0 ? 20 * log10(peak) : -999
    }
}
let gen = AVAssetImageGenerator(asset: asset)
// A QA still is a decode check, not a sample-exact timestamp assertion. Allow one frame of
// tolerance so a valid sparse/short recording can return its nearest real frame.
gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
var stills: [String] = []
for t in times {
    if let img = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
        let rep = NSBitmapImageRep(cgImage: img)
        let file = outDir.appendingPathComponent(String(format: "still-%05.1fs.png", t))
        try? rep.representation(using: .png, properties: [:])?.write(to: file)
        stills.append(file.path)
    }
}
out["stills"] = stills
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)

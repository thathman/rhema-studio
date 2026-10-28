import { describe, expect, it } from "vitest"
import { soundType } from "./sound-type"

describe("soundType", () => {
  it("names the common sound files", () => {
    expect(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/aac", "audio/ogg", "audio/flac", ""].map(soundType)).toEqual(["MP3", "M4A", "M4A", "WAV", "WAV", "AAC", "OGG", "FLAC", ""])
  })
})

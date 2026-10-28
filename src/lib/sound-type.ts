/** A sound file's type for its list row ("MP3", "M4A", "WAV"), so two files with the same name can be told apart. */
export function soundType(mime: string): string {
  const sub = mime.split("/")[1]?.toLowerCase().replace(/^x-/, "") ?? ""
  return ({ mpeg: "MP3", mp3: "MP3", mp4: "M4A", m4a: "M4A", wav: "WAV", wave: "WAV", aac: "AAC", ogg: "OGG", vorbis: "OGG" } as Record<string, string>)[sub] ?? sub.toUpperCase()
}

/**
 * UPDATE 14 — is this actually audio?
 *
 * Every TTS adapter had its own idea of "we got something back", and they did
 * not agree:
 *
 *   - ElevenLabs / OpenAI  → `buf.length < 1000` reject
 *   - Pollinations GET     → `buf.length > 1000` accept
 *   - Pollinations POST    → **no check at all**
 *
 * The POST path is the one that matters, because it asks a *chat* model for
 * audio and then regexes a data URL out of prose. A reply like
 * "Sorry, see data:audio/mpeg;base64,AAAA" matched, decoded to three bytes, and
 * was returned as a finished MP3 — billed, saved to history, and handed to an
 * <audio> tag that plays nothing.
 *
 * A byte-length floor alone is not enough either: 40KB of HTML error page is
 * "big" and still is not audio. So this module checks the container signature
 * as well, and it is the single place any adapter is allowed to decide.
 */

/**
 * Smallest plausible synthesised clip. A fraction of a second of MP3 is still
 * a few KB; anything under this is a truncated stream or an error body.
 */
export const MIN_AUDIO_BYTES = 1024;

export type AudioMime = "audio/mpeg" | "audio/wav" | "audio/ogg" | "audio/mp4";

/**
 * Identify the container from its magic bytes, so we label the response with
 * what it *is* rather than what we hoped for. Returns null when the bytes are
 * not a recognised audio container — that is a failed generation, not audio
 * with an unusual header.
 */
export function sniffAudioMime(buf: Buffer): AudioMime | null {
  if (buf.length < 4) return null;

  // MP3: either an ID3 tag or a raw frame sync (11 set bits).
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";

  // RIFF....WAVE
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WAVE"
  ) {
    return "audio/wav";
  }

  // Ogg (Vorbis/Opus)
  if (buf.toString("ascii", 0, 4) === "OggS") return "audio/ogg";

  // MP4/M4A: a 'ftyp' box at offset 4.
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "audio/mp4";

  return null;
}

/** True only when these bytes are big enough AND look like a real container. */
export function isValidAudio(buf: Buffer): boolean {
  return buf.length >= MIN_AUDIO_BYTES && sniffAudioMime(buf) !== null;
}

/**
 * Turn raw vendor bytes into a data URL, or null when they are not audio.
 * `estMs` is a rough duration used only for the UI's progress affordance.
 */
export function audioFromBytes(
  buf: Buffer
): { dataUrl: string; estMs: number; mime: AudioMime; bytes: number } | null {
  const mime = sniffAudioMime(buf);
  if (!mime || buf.length < MIN_AUDIO_BYTES) return null;
  return {
    dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
    // ~24 bytes/ms at the bitrates these vendors return.
    estMs: Math.round(buf.length / 24),
    mime,
    bytes: buf.length,
  };
}

/**
 * Validate a `data:audio/...;base64,...` string that came from a text response.
 * Decodes it and applies the same checks as raw bytes, so a scrap of base64
 * lifted out of an apology cannot pass as a clip.
 */
export function audioFromDataUrl(
  dataUrl: string
): { dataUrl: string; estMs: number; mime: AudioMime; bytes: number } | null {
  const m = /^data:audio\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(m[1], "base64");
  } catch {
    return null;
  }
  return audioFromBytes(buf);
}

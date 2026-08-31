/**
 * Chrome's SpeechRecognition, typed narrowly enough to use.
 *
 * These two interfaces used to live inside app/page.tsx (module scope, so invisible to
 * every other file) which forced anyone else wanting dictation to redeclare them. Now
 * that the composer is its own component, they are shared from here. Only the members
 * the app touches are declared - the browser API is much wider, and pretending
 * otherwise is how you end up calling something that is undefined on Safari.
 */
export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  start(): void;
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionResultEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

/** The two vendor spellings, in the order the app prefers them. */
export function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Standalone video recording logic using MediaRecorder.
 * Records a MediaStream (webcam) to a WebM Blob.
 */

// Audio codec (opus) must be included alongside video codec when the stream
// has audio tracks — otherwise some browsers error silently mid-recording.
const MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

function selectMimeType(): string {
  for (const mime of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export interface VideoRecorder {
  start: () => void;
  stop: () => Promise<Blob | null>;
  isRecording: () => boolean;
}

export function createVideoRecorder(
  stream: MediaStream,
  timeslice: number = 1000
): VideoRecorder {
  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];

  return {
    start() {
      if (recorder && recorder.state !== "inactive") return;
      chunks.length = 0;

      const mimeType = selectMimeType();
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

      recorder = new MediaRecorder(stream, options);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        console.error("[VideoRecorder] MediaRecorder error:", event);
      };
      recorder.start(timeslice);
    },

    stop(): Promise<Blob | null> {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          // Already stopped — return whatever chunks we have
          const blob = chunks.length > 0
            ? new Blob(chunks, { type: "video/webm" })
            : null;
          resolve(blob && blob.size > 0 ? blob : null);
          return;
        }
        const mimeType = recorder.mimeType || "video/webm";
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          recorder = null;
          resolve(blob.size > 0 ? blob : null);
        };
        // requestData() flushes the current in-progress timeslice chunk
        // before stop() so the last few seconds aren't lost
        try { recorder.requestData(); } catch {}
        recorder.stop();
      });
    },

    isRecording() {
      return recorder != null && recorder.state !== "inactive";
    },
  };
}

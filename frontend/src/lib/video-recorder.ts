/**
 * Standalone video recording logic using MediaRecorder.
 * Records a MediaStream (webcam) to a WebM Blob.
 */

const MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

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
      recorder.start(timeslice);
    },

    stop(): Promise<Blob | null> {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === "inactive") {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const blob = new Blob(chunks, {
            type: recorder!.mimeType || "video/webm",
          });
          recorder = null;
          resolve(blob);
        };
        recorder.stop();
      });
    },

    isRecording() {
      return recorder != null && recorder.state !== "inactive";
    },
  };
}

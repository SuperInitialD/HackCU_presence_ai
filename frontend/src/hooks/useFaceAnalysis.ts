import { useEffect, useRef, useState, useCallback } from 'react';
import type { FaceMetrics } from '../types';

const API_BASE = '/api';
const FRAME_INTERVAL_MS = 1000; // analyze once per second — not worth more

function smoothMetric(prev: number, next: number, alpha = 0.35): number {
  return prev * (1 - alpha) + next * alpha;
}

export function useFaceAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>, // overlay canvas — for indicators only
  enabled: boolean
) {
  const [metrics, setMetrics] = useState<FaceMetrics>({ eyeContact: 75, stress: 20, confidence: 70 });
  const [isReady, setIsReady] = useState(false);
  const smoothedRef = useRef<FaceMetrics>({ eyeContact: 75, stress: 20, confidence: 70 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  // Dedicated hidden canvas for frame capture — never shown to the user
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = 320;   // low res is fine for face detection
    c.height = 240;
    c.style.display = 'none';
    document.body.appendChild(c);
    captureCanvasRef.current = c;
    return () => {
      c.remove();
      captureCanvasRef.current = null;
    };
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    if (!enabled || runningRef.current) return;
    const video = videoRef.current;
    const captureCanvas = captureCanvasRef.current;
    if (!video || video.readyState < 2 || !captureCanvas) return;

    runningRef.current = true;
    try {
      const ctx = captureCanvas.getContext('2d');
      if (!ctx) return;

      // Draw to the hidden capture canvas — never touches the visible overlay
      ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const blob: Blob | null = await new Promise(resolve =>
        captureCanvas.toBlob(resolve, 'image/jpeg', 0.6)
      );
      if (!blob) return;

      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      const res = await fetch(`${API_BASE}/analyze-frame`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(3000), // don't let slow requests pile up
      });

      if (!res.ok) return;
      const data = await res.json();

      if (data.face_detected) {
        smoothedRef.current = {
          eyeContact: smoothMetric(smoothedRef.current.eyeContact, data.eye_contact),
          stress: smoothMetric(smoothedRef.current.stress, data.stress),
          confidence: smoothMetric(smoothedRef.current.confidence, data.confidence),
        };
        setMetrics({ ...smoothedRef.current });

        // Draw a small indicator on the overlay canvas — minimal, just a dot
        const overlayCanvas = canvasRef.current;
        if (overlayCanvas) {
          const oc = overlayCanvas.getContext('2d');
          if (oc) {
            oc.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            const eyeOk = data.eye_contact > 60;
            oc.fillStyle = eyeOk ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)';
            oc.beginPath();
            oc.arc(overlayCanvas.width - 16, 16, 7, 0, Math.PI * 2);
            oc.fill();
          }
        }
      }
    } catch {
      // Backend not running or timeout — silently skip, keep last values
    } finally {
      runningRef.current = false;
    }
  }, [enabled, videoRef, canvasRef]);

  useEffect(() => {
    if (!enabled) return;
    setIsReady(true);
    intervalRef.current = setInterval(captureAndAnalyze, FRAME_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      runningRef.current = false;
    };
  }, [enabled, captureAndAnalyze]);

  return { metrics, isReady };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import type { FaceMetrics } from '../types';

const API_BASE = '/api';
const FRAME_INTERVAL_MS = 800; // send a frame every 800ms

function smoothMetric(prev: number, next: number, alpha = 0.35): number {
  return prev * (1 - alpha) + next * alpha;
}

export function useFaceAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean
) {
  const [metrics, setMetrics] = useState<FaceMetrics>({ eyeContact: 75, stress: 20, confidence: 70 });
  const [isReady, setIsReady] = useState(false);
  const smoothedRef = useRef<FaceMetrics>({ eyeContact: 75, stress: 20, confidence: 70 });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);

  const captureAndAnalyze = useCallback(async () => {
    if (!enabled || runningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || video.readyState < 2 || !canvas) return;

    runningRef.current = true;
    try {
      // Draw current video frame to canvas
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to JPEG blob
      const blob: Blob | null = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.7)
      );
      if (!blob) return;

      // Send to backend
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      const res = await fetch(`${API_BASE}/analyze-frame`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) return;

      const data = await res.json();

      if (data.face_detected) {
        // Smooth incoming values
        smoothedRef.current = {
          eyeContact: smoothMetric(smoothedRef.current.eyeContact, data.eye_contact),
          stress: smoothMetric(smoothedRef.current.stress, data.stress),
          confidence: smoothMetric(smoothedRef.current.confidence, data.confidence),
        };
        setMetrics({ ...smoothedRef.current });

        // Draw subtle overlay on canvas: green dot if good eye contact
        const eyeOk = data.eye_contact > 60;
        ctx.fillStyle = eyeOk ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';
        ctx.beginPath();
        ctx.arc(canvas.width - 20, 20, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    } catch {
      // Network error or backend not running — silently continue with last known values
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

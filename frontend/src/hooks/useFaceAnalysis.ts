import { useEffect, useRef, useState, useCallback } from 'react';
import type { FaceMetrics } from '../types';
import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision';
import { extractMetrics, smoothMetrics } from '../utils/cvMetrics';
import type { CVMetricsFrame } from '../types/interview';

const FRAME_INTERVAL_MS = 100; // ~10 fps for responsive client-side analysis

/** Convert CVMetricsFrame (0-1) to FaceMetrics (0-100). Volume is injected externally via ref. */
function cvToFaceMetrics(cv: CVMetricsFrame, volume: number): FaceMetrics {
  return {
    eyeContact: Math.round(cv.eyeContact * 100),
    volume,
    confidence: Math.round(cv.confidence * 100),
  };
}

export function useFaceAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean
) {
  const [metrics, setMetrics] = useState<FaceMetrics>({
    eyeContact: 75,
    volume: 50,
    confidence: 70,
  });
  const [isReady, setIsReady] = useState(false);
  const smoothedCvRef = useRef<CVMetricsFrame | undefined>(undefined);
  const volumeRef = useRef<number>(50);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameIdRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    c.style.display = 'none';
    document.body.appendChild(c);
    captureCanvasRef.current = c;
    return () => {
      c.remove();
      captureCanvasRef.current = null;
    };
  }, []);

  const initMediaPipe = useCallback(async () => {
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm'
      );

      let faceLandmarker: FaceLandmarker;
      let poseLandmarker: PoseLandmarker | null;

      const faceOpts = {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU' as const,
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        runningMode: 'IMAGE' as const,
        numFaces: 1,
      };
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, faceOpts);
      } catch {
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          ...faceOpts,
          baseOptions: { ...faceOpts.baseOptions, delegate: 'CPU' },
        });
      }

      const poseOpts = {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU' as const,
        },
        runningMode: 'IMAGE' as const,
        numPoses: 1,
      };
      try {
        poseLandmarker = await PoseLandmarker.createFromOptions(vision, poseOpts);
      } catch {
        try {
          poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            ...poseOpts,
            baseOptions: { ...poseOpts.baseOptions, delegate: 'CPU' },
          });
        } catch {
          poseLandmarker = null;
          console.warn('[useFaceAnalysis] PoseLandmarker failed to load, using face-only mode');
        }
      }

      faceLandmarkerRef.current = faceLandmarker;
      poseLandmarkerRef.current = poseLandmarker;
    })();

    return initPromiseRef.current;
  }, []);

  const analyzeFrame = useCallback(() => {
    const video = videoRef.current;
    const faceLandmarker = faceLandmarkerRef.current;

    if (
      !enabled ||
      !video ||
      video.videoWidth === 0 ||
      video.videoHeight === 0 ||
      !faceLandmarker
    ) {
      frameIdRef.current = requestAnimationFrame(analyzeFrame);
      return;
    }

    const now = performance.now();
    if (now - lastFrameTimeRef.current < FRAME_INTERVAL_MS) {
      frameIdRef.current = requestAnimationFrame(analyzeFrame);
      return;
    }
    lastFrameTimeRef.current = now;

    try {
      const captureCanvas = captureCanvasRef.current;
      if (!captureCanvas) {
        frameIdRef.current = requestAnimationFrame(analyzeFrame);
        return;
      }

      const ctx = captureCanvas.getContext('2d');
      if (!ctx) {
        frameIdRef.current = requestAnimationFrame(analyzeFrame);
        return;
      }

      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const faceResult = faceLandmarker.detect(captureCanvas);
      const poseResult = poseLandmarkerRef.current
        ? poseLandmarkerRef.current.detect(captureCanvas)
        : null;

      const raw = extractMetrics(faceResult, poseResult, now);
      const smoothed = smoothMetrics(smoothedCvRef.current, raw);
      smoothedCvRef.current = smoothed;

      // Sample mic RMS volume
      if (analyserRef.current) {
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(buf);
        const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
        // rms ~0-128; normalize to 0-100 with slight amplification
        volumeRef.current = Math.min(100, Math.round((rms / 80) * 100));
      }

      const faceMetrics = cvToFaceMetrics(smoothed, volumeRef.current);
      setMetrics(faceMetrics);

      // Overlay indicator
      const overlayCanvas = canvasRef.current;
      if (overlayCanvas) {
        const oc = overlayCanvas.getContext('2d');
        if (oc) {
          oc.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          const eyeOk = faceMetrics.eyeContact > 60;
          oc.fillStyle = eyeOk
            ? 'rgba(34,197,94,0.8)'
            : 'rgba(239,68,68,0.8)';
          oc.beginPath();
          oc.arc(overlayCanvas.width - 16, 16, 7, 0, Math.PI * 2);
          oc.fill();
        }
      }
    } catch (err) {
      console.warn('[useFaceAnalysis] Frame detection failed:', err);
    }

    frameIdRef.current = requestAnimationFrame(analyzeFrame);
  }, [enabled, videoRef, canvasRef]);

  // Start mic volume analyser
  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyserRef.current = analyser;
      } catch {
        // mic unavailable — volume stays at default
      }
    })();
    return () => {
      analyserRef.current = null;
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = async () => {
      try {
        await initMediaPipe();
        if (cancelled) return;
        setIsReady(true);
        frameIdRef.current = requestAnimationFrame(analyzeFrame);
      } catch (err) {
        console.warn('[useFaceAnalysis] MediaPipe init failed:', err);
      }
    };

    run();
    return () => {
      cancelled = true;
      if (frameIdRef.current !== null) {
        cancelAnimationFrame(frameIdRef.current);
        frameIdRef.current = null;
      }
    };
  }, [enabled, initMediaPipe, analyzeFrame]);

  return { metrics, isReady };
}

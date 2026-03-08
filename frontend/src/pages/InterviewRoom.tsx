import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Send, Video, VideoOff, ChevronRight, AlertTriangle, Volume2 } from 'lucide-react';
import { getCompany } from '../components/CompanyConfig';
import { useFaceAnalysis } from '../hooks/useFaceAnalysis';
import { respond, transcribeAudio, endSession } from '../api/client';
import MetricGauge from '../components/MetricGauge';
import type { Message, InterviewSetup, FaceMetrics, QuestionResult, InterviewResults } from '../types';

interface LocationState {
  setup: InterviewSetup;
  firstQuestion: string;
  sessionId: string;
  interviewerName?: string;
  interviewType?: string;
}



// Always use the default company config — no company-specific theming
const companyConfig = getCompany();

const InterviewRoom: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState;

  const setup: InterviewSetup = state?.setup || { sessionId: `demo-${Date.now()}` };
  const sessionId = state?.sessionId || setup.sessionId || `demo-${Date.now()}`;
  const interviewerName = state?.interviewerName || companyConfig.interviewer;
  const interviewType = state?.interviewType || setup.interviewType;

  const [messages, setMessages] = useState<Message[]>([{
    id: '0',
    role: 'interviewer',
    content: state?.firstQuestion || "Tell me about yourself.",
    timestamp: new Date(),
  }]);
  const [textInput, setTextInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState(false);
  const [cameraPermission, setCameraPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [currentTip, setCurrentTip] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [questionCount, setQuestionCount] = useState(0);
  const [checklist, setChecklist] = useState({
    behavioral: { introduction: false, experience: false, star_scenario: false, skills_strengths: false },
    technical: { concepts: false, problem_solving: false, project_dive: false, role_specific: false },
  });
  const [metricsHistory, setMetricsHistory] = useState<FaceMetrics[]>([]);
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const metricsSnapshotRef = useRef<FaceMetrics>({ eyeContact: 75, volume: 50, confidence: 70 });
  const videoChunksRef = useRef<Blob[]>([]);
  const recordingStartRef = useRef<number>(0);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoTimestampsRef = useRef<Array<{ time: number; label: string; feedback?: string }>>([]);

  // Refs to track current state inside async callbacks / effects
  const isRecordingRef = useRef(false);
  const isProcessingAudioRef = useRef(false);
  const isThinkingRef = useRef(false);
  const autoStartedForRef = useRef<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1.2);
  const ttsSpeedRef = useRef(1.2);
  const isSpeakingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Speak text via OpenAI TTS backend — returns promise that resolves when done
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise(async (resolve) => {
      // Stop any currently playing audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      setIsSpeaking(true);
      isSpeakingRef.current = true;

      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: 'nova', speed: 1.0 }),  // playbackRate handles speed client-side
        });

        if (!res.ok) throw new Error('TTS request failed');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = ttsSpeedRef.current;
        currentAudioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          currentAudioRef.current = null;
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          resolve();
        };

        await audio.play();
      } catch {
        // TTS failed — skip speaking, continue to recording
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        resolve();
      }
    });
  }, []);

  // Stop audio on unmount
  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isProcessingAudioRef.current = isProcessingAudio; }, [isProcessingAudio]);
  useEffect(() => { isThinkingRef.current = isThinking; }, [isThinking]);

  const { metrics } = useFaceAnalysis(videoRef, canvasRef, cameraPermission === 'granted');

  useEffect(() => {
    metricsSnapshotRef.current = metrics;
    setMetricsHistory(prev => [...prev.slice(-60), metrics]);
  }, [metrics]);

  // Camera init
  useEffect(() => {
    const startCamera = async () => {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        // Also grab audio track for the video recording (separate from STT mic)
        let combinedStream = videoStream;
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          const audioTrack = audioStream.getAudioTracks()[0];
          if (audioTrack) {
            combinedStream = new MediaStream([...videoStream.getTracks(), audioTrack]);
          }
        } catch { /* no audio in recording — fine */ }

        cameraStreamRef.current = videoStream;
        if (videoRef.current) {
          videoRef.current.srcObject = videoStream;
          videoRef.current.play().catch(() => {});
        }

        // Start video recording
        videoChunksRef.current = [];
        recordingStartRef.current = Date.now();
        videoTimestampsRef.current = [];
        try {
          const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
            ? 'video/webm;codecs=vp9'
            : MediaRecorder.isTypeSupported('video/webm')
            ? 'video/webm'
            : '';
          const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = e => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
          recorder.start(1000);
          videoRecorderRef.current = recorder;
        } catch { /* recording unsupported */ }

        setCameraPermission('granted');
      } catch {
        setCameraPermission('denied');
      }
    };
    startCamera();
    return () => {
      cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  // Speak interviewer message then auto-start recording
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (
      lastMsg?.role !== 'interviewer' ||
      isComplete ||
      lastMsg.id === autoStartedForRef.current
    ) return;

    autoStartedForRef.current = lastMsg.id;

    const run = async () => {
      // Speak the interviewer's message
      await speak(lastMsg.content);

      // Small gap after speech before mic opens
      await new Promise(r => setTimeout(r, 400));

      if (isRecordingRef.current || isProcessingAudioRef.current || isThinkingRef.current) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
      } catch {
        // Mic denied — user can click manually or use text input
      }
    };

    run();
  }, [messages, isComplete, speak]);

  const currentQuestion = messages.filter(m => m.role === 'interviewer').at(-1)?.content || '';

  const submitAnswer = useCallback(async (answerText: string) => {
    if (!answerText.trim() || isThinkingRef.current) return;

    const candidateMsg: Message = {
      id: Date.now().toString(),
      role: 'candidate',
      content: answerText.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, candidateMsg]);
    setTextInput('');
    setIsThinking(true);
    setTranscriptionError(false);

    const m = metricsSnapshotRef.current;

    try {
      const response = await respond(sessionId, {
        answer: answerText.trim(),
        eye_contact: m.eyeContact,
        stress: m.volume,  // send volume as stress proxy for backend
        confidence: m.confidence,
      });

      const result: QuestionResult = {
        question: currentQuestion,
        answer: answerText.trim(),
        feedback: response.feedback_hint || '',
        score: response.score || Math.round(65 + Math.random() * 25),
        eyeContact: m.eyeContact,
        stress: m.volume,
        confidence: m.confidence,
      };
      setQuestionResults(prev => [...prev, result]);

      if (response.feedback_hint) {
        setCurrentTip(response.feedback_hint);
      }

      // Update checklist from AI response (only allow items to flip true)
      let updatedChecklist = checklist;
      if (response.checklist) {
        const cl = response.checklist;
        updatedChecklist = {
          behavioral: {
            introduction:     checklist.behavioral.introduction     || !!cl.behavioral?.introduction,
            experience:       checklist.behavioral.experience       || !!cl.behavioral?.experience,
            star_scenario:    checklist.behavioral.star_scenario    || !!cl.behavioral?.star_scenario,
            skills_strengths: checklist.behavioral.skills_strengths || !!cl.behavioral?.skills_strengths,
          },
          technical: {
            concepts:        checklist.technical.concepts        || !!cl.technical?.concepts,
            problem_solving: checklist.technical.problem_solving || !!cl.technical?.problem_solving,
            project_dive:    checklist.technical.project_dive    || !!cl.technical?.project_dive,
            role_specific:   checklist.technical.role_specific   || !!cl.technical?.role_specific,
          },
        };
        setChecklist(updatedChecklist);
      }

      // Auto-end: if all visible checklist items are now true, end immediately
      const allDone = Object.values(updatedChecklist.behavioral).every(Boolean)
        && Object.values(updatedChecklist.technical).every(Boolean);

      if (response.is_complete || allDone) {
        setIsComplete(true);

        const avgMetric = (key: keyof FaceMetrics) =>
          metricsHistory.length > 0
            ? metricsHistory.reduce((s, mm) => s + mm[key], 0) / metricsHistory.length
            : 70;

        const allResults = [...questionResults, result];
        const eyeContactAvg = avgMetric('eyeContact');
        const stressAvg     = avgMetric('volume');
        const confidenceAvg = avgMetric('confidence');
        const presenceScore = Math.round((eyeContactAvg + stressAvg + confidenceAvg) / 3);  // stressAvg is now volumeAvg

        // Stop video recording and compile blob
        let videoUrl: string | undefined;
        const videoTimestamps = [...videoTimestampsRef.current];
        if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
          await new Promise<void>(res => {
            videoRecorderRef.current!.onstop = () => res();
            videoRecorderRef.current!.stop();
          });
          if (videoChunksRef.current.length > 0) {
            const blob = new Blob(videoChunksRef.current, { type: 'video/webm' });
            videoUrl = URL.createObjectURL(blob);
          }
        }

        // Call the real end-session endpoint for AI evaluation
        try {
          const evaluation = await endSession(sessionId);

          const aq = evaluation.answer_quality;
          const interviewScore = aq?.overall != null
            ? Math.round(aq.overall * 10)
            : evaluation.overall_score?.total != null
            ? Math.round(evaluation.overall_score.total * 10)
            : Math.round(allResults.reduce((s, r) => s + r.score, 0) / Math.max(allResults.length, 1));

          const interviewResults: InterviewResults = {
            sessionId,
            company: setup.company,
            overallScore: Math.round((presenceScore + interviewScore) / 2),
            presenceScore,
            interviewScore,
            eyeContactAvg,
            volumeAvg: stressAvg,
            confidenceAvg,
            strengths: evaluation.strengths || [],
            improvements: evaluation.areas_for_improvement || [],
            questions: allResults,
            duration: Math.round((Date.now() - new Date(messages[0].timestamp).getTime()) / 1000 / 60),
            hiring_recommendation: evaluation.hiring_recommendation,
            summary: evaluation.summary,
            answer_quality: evaluation.answer_quality,
            resume_feedback: evaluation.resume_feedback ?? null,
            linkedin_feedback: evaluation.linkedin_feedback ?? null,
            videoUrl,
            videoTimestamps,
          };

          navigate('/results', { state: { results: interviewResults } });
        } catch {
          // Fallback if end-session fails — navigate with what we have
          const interviewScore = Math.round(allResults.reduce((s, r) => s + r.score, 0) / Math.max(allResults.length, 1));
          navigate('/results', { state: { results: {
            sessionId, company: setup.company,
            overallScore: Math.round((presenceScore + interviewScore) / 2),
            presenceScore, interviewScore,
            eyeContactAvg, volumeAvg: stressAvg, confidenceAvg,
            strengths: [], improvements: [], questions: allResults,
            duration: Math.round((Date.now() - new Date(messages[0].timestamp).getTime()) / 1000 / 60),
            resume_feedback: null, linkedin_feedback: null,
          }}});
        }
      } else if (response.next_question) {
        if (!response.follow_up) setQuestionCount(prev => prev + 1);
        // Record timestamp for this question in the video timeline
        videoTimestampsRef.current.push({
          time: (Date.now() - recordingStartRef.current) / 1000,
          label: response.next_question.slice(0, 80) + (response.next_question.length > 80 ? '…' : ''),
          feedback: response.feedback_hint,
        });
        const interviewerMsg: Message = {
          id: Date.now().toString() + '-q',
          role: 'interviewer',
          content: response.next_question,
          timestamp: new Date(),
          feedbackHint: response.feedback_hint,
        };
        setMessages(prev => [...prev, interviewerMsg]);
      }
    } catch (err) {
      // Show the error in chat so the user knows what's wrong
      const errMsg: Message = {
        id: Date.now().toString() + '-err',
        role: 'interviewer',
        content: `⚠️ Backend error: ${err instanceof Error ? err.message : 'Could not reach the interview server. Make sure the backend is running on port 8000.'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setIsThinking(false);
    }
  }, [sessionId, currentQuestion, metricsHistory, questionResults, messages, navigate]);

  const handleSendText = () => {
    if (textInput.trim()) submitAnswer(textInput);
  };

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || isProcessingAudioRef.current || isThinkingRef.current) return;
    // Stop any ongoing TTS immediately when user wants to respond
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setIsSpeaking(false);
    isSpeakingRef.current = false;
    setTranscriptionError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
    } catch {
      // Mic denied silently — user can type instead
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !isRecordingRef.current) return;
    setIsRecording(false);
    setIsProcessingAudio(true);

    await new Promise<void>((resolve) => {
      mediaRecorderRef.current!.onstop = () => resolve();
      mediaRecorderRef.current!.stop();
      mediaRecorderRef.current!.stream.getTracks().forEach(t => t.stop());
    });

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

    try {
      const result = await transcribeAudio(audioBlob);
      if (result.text.trim()) {
        await submitAnswer(result.text);
      }
    } catch {
      setTranscriptionError(true);
    } finally {
      setIsProcessingAudio(false);
    }
  }, [submitAnswer]);

  const toggleRecording = useCallback(async () => {
    if (isProcessingAudio || isThinking) return;
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, isProcessingAudio, isThinking, startRecording, stopRecording]);

  return (
    <div style={{
      height: '100vh',
      background: '#0f0f13',
      display: 'flex',
      overflow: 'hidden',
    }}>
      {/* Left Panel - Interview */}
      <div style={{
        flex: '0 0 60%',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #2a2a3e',
        height: '100vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 28px',
          borderBottom: '1px solid #2a2a3e',
          background: '#16161e',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexShrink: 0,
        }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${companyConfig.accentColor}33, ${companyConfig.accentColor}11)`,
            border: `1.5px solid ${companyConfig.accentColor}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 900, color: companyConfig.accentColor,
          }}>
            {companyConfig.icon}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, color: '#e8e8f0', fontSize: 15 }}>{interviewerName}</span>
              {interviewType && (
                <span style={{
                  padding: '2px 9px',
                  background: `${companyConfig.accentColor}22`,
                  border: `1px solid ${companyConfig.accentColor}44`,
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 700,
                  color: companyConfig.accentColor,
                  letterSpacing: '0.02em',
                }}>
                  {interviewType === 'behavioral'
                    ? 'Behavioral'
                    : interviewType === 'technical_verbal'
                    ? 'Technical — Verbal'
                    : interviewType}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#555577', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
              {isSpeaking ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Volume2 size={11} style={{ color: companyConfig.accentColor }} />
                  Speaking...
                </span>
              ) : `Interview in progress — Question ${questionCount + 1}`}
            </div>
          </div>
          {/* Pace Slider */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#555577', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Pace</span>
            <input
              type="range"
              min={0.8}
              max={2.0}
              step={0.1}
              value={ttsSpeed}
              onChange={e => {
                const v = parseFloat(e.target.value);
                setTtsSpeed(v);
                ttsSpeedRef.current = v;
                if (currentAudioRef.current) currentAudioRef.current.playbackRate = v;
              }}
              style={{ width: 72, accentColor: companyConfig.accentColor, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: companyConfig.accentColor, fontWeight: 700, minWidth: 28 }}>{ttsSpeed.toFixed(1)}×</span>
          </div>
          {setup.company && (
            <div>
              <div style={{
                padding: '4px 12px',
                background: `${companyConfig.accentColor}18`,
                border: `1px solid ${companyConfig.accentColor}33`,
                borderRadius: 20,
                fontSize: 12,
                color: companyConfig.accentColor,
                fontWeight: 600,
              }}>
                {setup.company}
              </div>
            </div>
          )}
        </div>

        {/* Current Question Banner */}
        <div style={{
          padding: '20px 28px',
          background: `linear-gradient(135deg, ${companyConfig.accentColor}12, transparent)`,
          borderBottom: '1px solid #2a2a3e',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 11, color: companyConfig.accentColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Current Question
          </div>
          <div style={{ fontSize: 16, color: '#e8e8f0', fontWeight: 600, lineHeight: 1.5 }}>
            {currentQuestion}
          </div>
        </div>

        {/* Transcript */}
        <div
          ref={transcriptRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <AnimatePresence initial={false}>
            {messages.map(msg => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                style={{
                  display: 'flex',
                  flexDirection: msg.role === 'candidate' ? 'row-reverse' : 'row',
                  gap: 12,
                  alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: 32, height: 32,
                  borderRadius: 8,
                  background: msg.role === 'interviewer'
                    ? `${companyConfig.accentColor}22`
                    : '#2a2a3e',
                  border: `1px solid ${msg.role === 'interviewer' ? companyConfig.accentColor + '33' : '#3a3a55'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                  color: msg.role === 'interviewer' ? companyConfig.accentColor : '#8888aa',
                  flexShrink: 0,
                }}>
                  {msg.role === 'interviewer' ? companyConfig.icon : 'Y'}
                </div>
                <div style={{
                  maxWidth: '75%',
                  background: msg.role === 'interviewer' ? '#1c1c28' : `${companyConfig.accentColor}18`,
                  border: `1px solid ${msg.role === 'interviewer' ? '#2a2a3e' : companyConfig.accentColor + '33'}`,
                  borderRadius: msg.role === 'interviewer' ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
                  padding: '12px 16px',
                }}>
                  <div style={{ fontSize: 14, color: '#e8e8f0', lineHeight: 1.6 }}>
                    {msg.content}
                  </div>
                  <div style={{ fontSize: 11, color: '#555577', marginTop: 6 }}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Thinking indicator */}
          <AnimatePresence>
            {isThinking && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
              >
                <div style={{
                  width: 32, height: 32,
                  borderRadius: 8,
                  background: `${companyConfig.accentColor}22`,
                  border: `1px solid ${companyConfig.accentColor}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700,
                  color: companyConfig.accentColor,
                }}>
                  {companyConfig.icon}
                </div>
                <div style={{
                  background: '#1c1c28',
                  border: '1px solid #2a2a3e',
                  borderRadius: '4px 14px 14px 14px',
                  padding: '16px 20px',
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                }}>
                  <div className="thinking-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: companyConfig.accentColor }} />
                  <div className="thinking-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: companyConfig.accentColor }} />
                  <div className="thinking-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: companyConfig.accentColor }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Interview complete */}
          <AnimatePresence>
            {isComplete && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  textAlign: 'center',
                  padding: '24px',
                  background: '#22c55e12',
                  border: '1px solid #22c55e33',
                  borderRadius: 14,
                  color: '#22c55e',
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Interview Complete</div>
                <div style={{ fontSize: 13, color: '#8888aa', marginTop: 4 }}>Generating your results...</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input Area */}
        {!isComplete && (
          <div style={{
            padding: '20px 28px',
            borderTop: '1px solid #2a2a3e',
            background: '#16161e',
            flexShrink: 0,
          }}>
            {/* Voice Status Banner */}
            <AnimatePresence>
              {(isRecording || isProcessingAudio) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    padding: '14px 20px',
                    marginBottom: 14,
                    background: isRecording ? '#ef444412' : '#6366f112',
                    border: `1px solid ${isRecording ? '#ef444433' : '#6366f133'}`,
                    borderRadius: 12,
                  }}
                >
                  {isRecording ? (
                    <>
                      <div className="pulse-red-dot" />
                      <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 15 }}>
                        Listening... <span style={{ fontWeight: 400, opacity: 0.8 }}>(click mic to stop)</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="spinner-ring" />
                      <span style={{ color: '#8888aa', fontWeight: 600, fontSize: 15 }}>Transcribing...</span>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Transcription Error */}
            <AnimatePresence>
              {transcriptionError && !isRecording && !isProcessingAudio && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    padding: '10px 14px',
                    marginBottom: 12,
                    background: '#ef444412',
                    border: '1px solid #ef444433',
                    borderRadius: 10,
                    color: '#ef4444',
                    fontSize: 13,
                  }}
                >
                  Transcription failed — type your answer below
                </motion.div>
              )}
            </AnimatePresence>

            {/* Primary mic button */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <motion.button
                whileHover={{ scale: isProcessingAudio || isThinking ? 1 : 1.05 }}
                whileTap={{ scale: isProcessingAudio || isThinking ? 1 : 0.95 }}
                onClick={toggleRecording}
                disabled={isProcessingAudio || isThinking}
                title={isRecording ? 'Click to stop recording' : 'Click to start recording'}
                style={{
                  width: 64, height: 64,
                  borderRadius: 32,
                  background: isRecording
                    ? '#ef4444'
                    : isProcessingAudio
                    ? '#1c1c28'
                    : companyConfig.accentColor,
                  border: `2px solid ${
                    isRecording ? '#ef444466'
                    : isProcessingAudio ? '#2a2a3e'
                    : companyConfig.accentColor + '66'
                  }`,
                  cursor: isProcessingAudio || isThinking ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff',
                  opacity: isThinking ? 0.4 : 1,
                  boxShadow: isRecording
                    ? '0 0 28px #ef444455'
                    : isProcessingAudio ? 'none'
                    : `0 0 20px ${companyConfig.accentColor}44`,
                  transition: 'all 0.2s ease',
                }}
              >
                {isProcessingAudio ? (
                  <div className="spinner-ring" style={{ width: 24, height: 24, borderWidth: 3, borderColor: '#555577', borderTopColor: companyConfig.accentColor }} />
                ) : isRecording ? (
                  <MicOff size={26} />
                ) : (
                  <Mic size={26} />
                )}
              </motion.button>
            </div>

            {/* Mic button label */}
            {!isRecording && !isProcessingAudio && (
              <div style={{ textAlign: 'center', color: '#555577', fontSize: 12, marginBottom: 14 }}>
                {isThinking ? 'Waiting for AI response...' : 'Click to start recording'}
              </div>
            )}

            {/* Secondary: Text input */}
            <div style={{ display: 'flex', gap: 10 }}>
              <textarea
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendText();
                  }
                }}
                placeholder={
                  isRecording
                    ? 'Recording in progress...'
                    : isProcessingAudio
                    ? 'Transcribing audio...'
                    : 'Or type your answer here... (Enter to send)'
                }
                disabled={isThinking || isRecording || isProcessingAudio}
                rows={2}
                style={{
                  flex: 1,
                  background: '#0f0f13',
                  border: '1px solid #2a2a3e',
                  borderRadius: 10,
                  padding: '10px 14px',
                  color: '#e8e8f0',
                  fontSize: 13,
                  outline: 'none',
                  resize: 'none',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                  opacity: isThinking || isRecording || isProcessingAudio ? 0.4 : 0.8,
                  transition: 'opacity 0.2s',
                }}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSendText}
                disabled={isThinking || !textInput.trim() || isRecording || isProcessingAudio}
                style={{
                  width: 42, height: 42,
                  borderRadius: 10,
                  background: textInput.trim() && !isThinking && !isRecording && !isProcessingAudio
                    ? companyConfig.accentColor : '#1c1c28',
                  border: `1.5px solid ${
                    textInput.trim() && !isThinking && !isRecording && !isProcessingAudio
                      ? companyConfig.accentColor : '#2a2a3e'
                  }`,
                  cursor: isThinking || !textInput.trim() || isRecording || isProcessingAudio
                    ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: textInput.trim() && !isThinking && !isRecording && !isProcessingAudio
                    ? '#fff' : '#555577',
                  flexShrink: 0,
                  alignSelf: 'flex-end',
                  transition: 'all 0.2s',
                }}
              >
                <Send size={15} />
              </motion.button>
            </div>

            <div style={{ fontSize: 11, color: '#444466', marginTop: 8, textAlign: 'center' }}>
              Click mic to record voice • Enter to send text • Shift+Enter for new line
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Camera & Metrics */}
      <div style={{
        flex: '0 0 40%',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}>
        {/* Camera Feed */}
        <div style={{
          flex: '0 0 55%',
          position: 'relative',
          background: '#0a0a0f',
          borderBottom: '1px solid #2a2a3e',
          overflow: 'hidden',
        }}>
          {cameraPermission === 'granted' && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                }}
              />
              <canvas
                ref={canvasRef}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: 'scaleX(-1)',
                  pointerEvents: 'none',
                }}
              />
            </>
          )}

          {cameraPermission === 'denied' && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: 24, textAlign: 'center',
            }}>
              <AlertTriangle size={36} color="#eab308" />
              <div style={{ color: '#e8e8f0', fontWeight: 600, fontSize: 15 }}>Camera access denied</div>
              <div style={{ color: '#8888aa', fontSize: 13, lineHeight: 1.5 }}>
                Enable camera in browser settings to enable face analysis. You can still use the interview without it.
              </div>
            </div>
          )}

          {cameraPermission === 'pending' && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 12,
            }}>
              <Video size={36} color="#555577" />
              <div style={{ color: '#8888aa', fontSize: 14 }}>Requesting camera access...</div>
            </div>
          )}

          {cameraPermission === 'granted' && (
            <>
              <div style={{
                position: 'absolute', top: 14, left: 14,
                padding: '4px 10px',
                background: 'rgba(0,0,0,0.6)',
                borderRadius: 20,
                fontSize: 11,
                color: '#e8e8f0',
                display: 'flex', alignItems: 'center', gap: 6,
                backdropFilter: 'blur(8px)',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                LIVE
              </div>
              <div style={{
                position: 'absolute', bottom: 14, right: 14,
                padding: '4px 10px',
                background: 'rgba(0,0,0,0.6)',
                borderRadius: 20,
                fontSize: 11,
                color: '#8888aa',
                backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <VideoOff size={11} />
                Face Mesh Active
              </div>
            </>
          )}
        </div>

        {/* Metrics Panel */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}>
          {/* Live Metrics */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555577', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
              Live Analysis
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12,
              marginBottom: 16,
            }}>
              <MetricGauge label="Eye Contact" value={metrics.eyeContact} type="gauge" />
              <MetricGauge label="Confidence" value={metrics.confidence} type="gauge" />
              <MetricGauge label="Volume" value={metrics.volume} type="gauge" />
            </div>
            <MetricGauge label="Vocal Volume" value={metrics.volume} type="bar" />
          </div>

          {/* Tip from AI */}
          <AnimatePresence>
            {currentTip && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                style={{
                  padding: '14px 16px',
                  background: `${companyConfig.accentColor}12`,
                  border: `1px solid ${companyConfig.accentColor}33`,
                  borderRadius: 12,
                  borderLeft: `3px solid ${companyConfig.accentColor}`,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: companyConfig.accentColor, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  💡 Tip
                </div>
                <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6 }}>
                  {currentTip}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Coverage Checklist */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555577', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Coverage
            </div>
            {([
              {
                section: 'behavioral' as const,
                label: 'Behavioral',
                items: [
                  { key: 'introduction' as const, label: 'Background & Intro' },
                  { key: 'experience' as const, label: 'Professional Experience' },
                  { key: 'star_scenario' as const, label: 'STAR Scenario' },
                  { key: 'skills_strengths' as const, label: 'Skills & Strengths' },
                ],
              },
              {
                section: 'technical' as const,
                label: 'Technical',
                items: [
                  { key: 'concepts' as const, label: 'Technical Concepts' },
                  { key: 'problem_solving' as const, label: 'Problem-Solving' },
                  { key: 'project_dive' as const, label: 'Project Deep-Dive' },
                  { key: 'role_specific' as const, label: 'Role-Specific Knowledge' },
                ],
              },
            ].filter(({ section }) => {
              if (!interviewType) return true; // show both when undefined
              if (interviewType === 'behavioral') return section === 'behavioral';
              if (interviewType === 'technical' || interviewType === 'technical_verbal') return section === 'technical';
              return true;
            })).map(({ section, label, items }) => {
              const sectionMap = checklist[section] as Record<string, boolean>;
              const sectionDone = items.every(i => sectionMap[i.key]);
              return (
                <div key={section} style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    color: sectionDone ? companyConfig.accentColor : '#8888aa',
                    textTransform: 'uppercase', marginBottom: 8,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {sectionDone && <span>✓</span>}
                    {label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                    {items.map(({ key, label: itemLabel }) => {
                      const done = sectionMap[key];
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                            background: done ? companyConfig.accentColor : 'transparent',
                            border: `1.5px solid ${done ? companyConfig.accentColor : '#3a3a55'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.3s ease',
                          }}>
                            {done && <span style={{ color: '#fff', fontSize: 9, fontWeight: 800, lineHeight: 1 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 12, color: done ? '#c8c8e0' : '#555577', transition: 'color 0.3s ease' }}>
                            {itemLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: '#555577', marginTop: 4 }}>
              AI moves to the next section when it has genuine signal.
            </div>
          </div>

          {/* End Early */}
          {!isComplete && messages.length > 2 && (
            <button
              onClick={() => {
                const avgMetric = (key: keyof FaceMetrics) =>
                  metricsHistory.length > 0
                    ? metricsHistory.reduce((s, mm) => s + mm[key], 0) / metricsHistory.length
                    : 70;
                const eyeC = avgMetric('eyeContact');
                const str  = avgMetric('volume');
                const conf = avgMetric('confidence');
                const presenceScore  = Math.round((eyeC + str + conf) / 3);
                const interviewScore = questionResults.length > 0
                  ? Math.round(questionResults.reduce((s, r) => s + r.score, 0) / questionResults.length)
                  : 72;
                const results: InterviewResults = {
                  sessionId,
                  company: setup.company,
                  overallScore: Math.round((presenceScore + interviewScore) / 2),
                  presenceScore,
                  interviewScore,
                  eyeContactAvg: eyeC,
                  volumeAvg: str,
                  confidenceAvg: conf,
                  strengths: [],
                  improvements: [],
                  questions: questionResults,
                  duration: Math.round((Date.now() - new Date(messages[0].timestamp).getTime()) / 1000 / 60),
                  resume_feedback: null,
                  linkedin_feedback: null,
                };
                navigate('/results', { state: { results } });
              }}
              style={{
                background: 'none',
                border: '1px solid #2a2a3e',
                borderRadius: 10,
                padding: '10px 16px',
                color: '#555577',
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.2s',
                width: '100%',
              }}
            >
              <ChevronRight size={14} />
              End interview & see results
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-red {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 #ef444455; }
          50% { transform: scale(1.2); box-shadow: 0 0 0 8px #ef444400; }
        }
        .pulse-red-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #ef4444;
          animation: pulse-red 1.2s ease-in-out infinite;
          flex-shrink: 0;
        }
        .spinner-ring {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2.5px solid #555577;
          border-top-color: #6366f1;
          animation: spin 0.8s linear infinite;
          flex-shrink: 0;
        }
        .thinking-dot:nth-child(1) { animation: thinking 1.2s ease-in-out infinite 0s; }
        .thinking-dot:nth-child(2) { animation: thinking 1.2s ease-in-out infinite 0.2s; }
        .thinking-dot:nth-child(3) { animation: thinking 1.2s ease-in-out infinite 0.4s; }
        @keyframes thinking {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default InterviewRoom;

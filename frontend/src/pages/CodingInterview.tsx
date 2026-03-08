import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, Play, RotateCcw, ChevronDown, ChevronUp, Zap, Clock, RefreshCw } from 'lucide-react';
import type { InterviewSetup } from '../types';

// ── API helpers ───────────────────────────────────────────────────────────────

interface Problem {
  title: string;
  slug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  hints: string[];
  examples: string;
  starter_code: string;
  topics: string[];
}

interface Analysis {
  status: string;
  summary: string;
  observations: string[];
  next_step: string;
  bugs: string[];
  score: number;
}

// const fetchProblem = async (difficulty: string, slug?: string): Promise<Problem> => {
//   const params = new URLSearchParams({ difficulty });
//   if (slug) params.set('slug', slug);
//   const r = await fetch(`/api/coding/problem?${params}`);
//   if (!r.ok) throw new Error(await r.text());
//   return r.json();
// };
const fetchProblem = async (difficulty: string, slug?: string): Promise<Problem> => {
  const params = new URLSearchParams({ difficulty });
  if (slug) params.set('slug', slug);
  const r = await fetch(`/api/coding/problem?${params}`);
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text);
      throw new Error(j.detail || j.message || text);
    } catch {
      throw new Error(text);
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON response from /api/coding/problem");
  }
};
const getHint = async (problem: Problem, code: string, level: number): Promise<string> => {
  const r = await fetch('/api/coding/hint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem, current_code: code, hint_level: level }),
  });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return d.hint;
};

const analyzeCode = async (problem: Problem, code: string, isPeriodic: boolean): Promise<Analysis> => {
  const r = await fetch('/api/coding/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ problem, current_code: code, is_periodic: isPeriodic }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// ── Difficulty badge ──────────────────────────────────────────────────────────

const DIFF_COLOR: Record<string, string> = {
  Easy: '#22c55e', Medium: '#eab308', Hard: '#ef4444',
};

// ── Timer display ─────────────────────────────────────────────────────────────

const Timer: React.FC<{ startTime: number; accent: string }> = ({ startTime, accent }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startTime]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', color: accent, fontWeight: 700, fontSize: 14 }}>
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

const ACCENT = '#6366f1';
const SNAPSHOT_INTERVAL_MS = 6 * 60 * 1000; // 6 minutes (random jitter added)

const CodingInterview: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { setup?: InterviewSetup; difficulty?: string } | null;

  const difficulty = state?.difficulty ?? 'medium';

  const [problem, setProblem] = useState<Problem | null>(null);
  const [code, setCode] = useState('');
  const [loadingProblem, setLoadingProblem] = useState(true);
  const [problemError, setProblemError] = useState('');

  const [hintLevel, setHintLevel] = useState(1);
  const [hint, setHint] = useState('');
  const [loadingHint, setLoadingHint] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisPanel, setAnalysisPanel] = useState(false);
  const [nextSnapshotIn, setNextSnapshotIn] = useState(0);

  const [descExpanded, setDescExpanded] = useState(true);
  const [startTime] = useState(Date.now());

  const codeRef = useRef('');
  const problemRef = useRef<Problem | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync
  useEffect(() => { codeRef.current = code; }, [code]);
  useEffect(() => { problemRef.current = problem; }, [problem]);

  // Load problem on mount
  useEffect(() => {
    setLoadingProblem(true);
    fetchProblem(difficulty)
      .then(p => {
        setProblem(p);
        setCode(p.starter_code);
      })
      .catch(e => setProblemError(e.message))
      .finally(() => setLoadingProblem(false));
  }, [difficulty]);

  // Periodic AI snapshot
  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    // Random jitter: 5–8 minutes
    const jitter = Math.floor(Math.random() * 3 * 60 * 1000); // 0–3 min
    const delay = SNAPSHOT_INTERVAL_MS - 60 * 1000 + jitter;  // 5–8 min total
    const fireAt = Date.now() + delay;

    setNextSnapshotIn(Math.round(delay / 1000));

    countdownRef.current = setInterval(() => {
      setNextSnapshotIn(Math.max(0, Math.round((fireAt - Date.now()) / 1000)));
    }, 1000);

    snapshotTimerRef.current = setTimeout(async () => {
      if (!problemRef.current) return;
      setLoadingAnalysis(true);
      try {
        const result = await analyzeCode(problemRef.current, codeRef.current, true);
        setAnalysis(result);
        setAnalysisPanel(true);
      } catch (e) {
        console.warn('Periodic analysis failed:', e);
      } finally {
        setLoadingAnalysis(false);
        scheduleSnapshot(); // reschedule
      }
    }, delay);
  }, []);

  useEffect(() => {
    scheduleSnapshot();
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [scheduleSnapshot]);

  const handleGetHint = async () => {
    if (!problem) return;
    setLoadingHint(true);
    setShowHint(true);
    try {
      const h = await getHint(problem, codeRef.current, hintLevel);
      setHint(h);
    } catch (e) {
      setHint(`Failed to get hint: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingHint(false);
    }
  };

  const handleAnalyzeNow = async () => {
    if (!problem) return;
    setLoadingAnalysis(true);
    setAnalysisPanel(true);
    try {
      const result = await analyzeCode(problem, codeRef.current, false);
      setAnalysis(result);
    } catch (e) {
      console.warn('Analysis failed:', e);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const handleNewProblem = () => {
    setLoadingProblem(true);
    setProblemError('');
    setHint('');
    setAnalysis(null);
    setAnalysisPanel(false);
    setHintLevel(1);
    fetchProblem(difficulty)
      .then(p => { setProblem(p); setCode(p.starter_code); })
      .catch(e => setProblemError(e.message))
      .finally(() => setLoadingProblem(false));
  };

  const statusColor = (s: string) => {
    if (s === 'complete') return '#22c55e';
    if (s === 'on_track') return '#6366f1';
    if (s === 'needs_help') return '#ef4444';
    return '#eab308';
  };

  const fmtCountdown = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  if (loadingProblem) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f13', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#8888aa' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
          <div style={{ fontSize: 15 }}>Fetching problem from LeetCode…</div>
        </div>
      </div>
    );
  }

  if (problemError) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f13', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#ef4444', maxWidth: 400 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 15, marginBottom: 16 }}>{problemError}</div>
          <button onClick={handleNewProblem} style={{ padding: '10px 20px', background: ACCENT, border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ background: '#16161e', borderBottom: '1px solid #2a2a3e', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e8e8f0', letterSpacing: '-0.02em' }}>
            ⚙️ Coding Interview
          </div>
          {problem && (
            <>
              <span style={{ color: '#2a2a3e' }}>—</span>
              <span style={{ color: '#e8e8f0', fontWeight: 600, fontSize: 14 }}>{problem.title}</span>
              <span style={{ padding: '2px 8px', borderRadius: 20, background: `${DIFF_COLOR[problem.difficulty]}22`, border: `1px solid ${DIFF_COLOR[problem.difficulty]}44`, color: DIFF_COLOR[problem.difficulty], fontSize: 11, fontWeight: 700 }}>
                {problem.difficulty}
              </span>
              {problem.topics.slice(0, 2).map(t => (
                <span key={t} style={{ padding: '2px 8px', borderRadius: 20, background: '#1c1c28', border: '1px solid #2a2a3e', color: '#8888aa', fontSize: 11 }}>{t}</span>
              ))}
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Countdown to next snapshot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#555577', fontSize: 12 }}>
            <Clock size={12} />
            <span>Next AI check: {fmtCountdown(nextSnapshotIn)}</span>
          </div>

          {/* Elapsed timer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#555577' }}>Elapsed:</span>
            <Timer startTime={startTime} accent={ACCENT} />
          </div>

          <button onClick={handleNewProblem} style={{ padding: '7px 14px', background: '#1c1c28', border: '1px solid #2a2a3e', borderRadius: 8, color: '#8888aa', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} /> New Problem
          </button>
          <button onClick={() => navigate('/')} style={{ padding: '7px 14px', background: '#1c1c28', border: '1px solid #2a2a3e', borderRadius: 8, color: '#8888aa', fontSize: 12, cursor: 'pointer' }}>
            ✕ Exit
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '380px 1fr', overflow: 'hidden' }}>

        {/* ── Left panel: problem + hints ── */}
        <div style={{ borderRight: '1px solid #2a2a3e', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#12121a' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 0' }}>

            {/* Description */}
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => setDescExpanded(e => !e)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#e8e8f0', fontSize: 14, fontWeight: 700, marginBottom: 8 }}
              >
                Problem Description
                {descExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
              <AnimatePresence initial={false}>
                {descExpanded && problem && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#16161e', borderRadius: 10, padding: '14px 16px', border: '1px solid #2a2a3e', maxHeight: 320, overflowY: 'auto' }}>
                      {problem.description}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Hint section */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0', marginBottom: 10 }}>💡 Hints</div>

              {/* Hint level selector */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {([
                  { level: 1, label: 'Nudge' },
                  { level: 2, label: 'Approach' },
                  { level: 3, label: 'Walkthrough' },
                ]).map(({ level, label }) => (
                  <button
                    key={level}
                    onClick={() => setHintLevel(level)}
                    style={{
                      flex: 1, padding: '6px 0', borderRadius: 8,
                      background: hintLevel === level ? `${ACCENT}22` : '#1c1c28',
                      border: `1px solid ${hintLevel === level ? ACCENT : '#2a2a3e'}`,
                      color: hintLevel === level ? ACCENT : '#8888aa',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleGetHint}
                disabled={loadingHint}
                style={{
                  width: '100%', padding: '10px', borderRadius: 10,
                  background: `${ACCENT}22`, border: `1px solid ${ACCENT}44`,
                  color: ACCENT, fontSize: 13, fontWeight: 700, cursor: loadingHint ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: loadingHint ? 0.6 : 1,
                }}
              >
                <Lightbulb size={15} />
                {loadingHint ? 'Thinking…' : 'Get Hint'}
              </button>

              <AnimatePresence>
                {showHint && hint && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{ marginTop: 10, padding: '12px 14px', background: `${ACCENT}12`, border: `1px solid ${ACCENT}33`, borderRadius: 10, borderLeft: `3px solid ${ACCENT}` }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: ACCENT, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Level {hintLevel} Hint
                    </div>
                    <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6 }}>{hint}</div>
                    {hintLevel < 3 && (
                      <button
                        onClick={() => { setHintLevel(l => l + 1); setShowHint(false); }}
                        style={{ marginTop: 8, fontSize: 11, color: '#555577', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Need more help? →
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Analyze now */}
            <div style={{ marginBottom: 20 }}>
              <button
                onClick={handleAnalyzeNow}
                disabled={loadingAnalysis}
                style={{
                  width: '100%', padding: '10px', borderRadius: 10,
                  background: '#1c1c28', border: '1px solid #2a2a3e',
                  color: '#c8c8e0', fontSize: 13, fontWeight: 600, cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: loadingAnalysis ? 0.6 : 1,
                }}
              >
                <Zap size={14} />
                {loadingAnalysis ? 'Analyzing…' : 'Analyze My Code Now'}
              </button>
            </div>

            {/* AI Analysis panel */}
            <AnimatePresence>
              {analysisPanel && analysis && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{ marginBottom: 20, padding: '14px 16px', background: '#16161e', border: '1px solid #2a2a3e', borderRadius: 12, borderLeft: `3px solid ${statusColor(analysis.status)}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: statusColor(analysis.status), textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      AI Analysis · {analysis.status.replace('_', ' ')} · {analysis.score}/10
                    </div>
                    <button onClick={() => setAnalysisPanel(false)} style={{ background: 'none', border: 'none', color: '#555577', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
                  </div>

                  <p style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6, margin: '0 0 10px' }}>{analysis.summary}</p>

                  {analysis.observations.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {analysis.observations.map((o, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#8888aa', padding: '3px 0', display: 'flex', gap: 6 }}>
                          <span style={{ color: ACCENT }}>→</span> {o}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.bugs.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {analysis.bugs.map((b, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#ef4444', padding: '3px 0', display: 'flex', gap: 6 }}>
                          <span>🐛</span> {b}
                        </div>
                      ))}
                    </div>
                  )}

                  {analysis.next_step && (
                    <div style={{ fontSize: 12, color: '#22c55e', padding: '6px 10px', background: '#22c55e12', borderRadius: 8, border: '1px solid #22c55e22', marginTop: 6 }}>
                      Next: {analysis.next_step}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Right panel: Monaco editor ── */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Editor toolbar */}
          <div style={{ background: '#16161e', borderBottom: '1px solid #2a2a3e', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span style={{ fontSize: 12, color: '#555577', fontWeight: 600 }}>TypeScript</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={handleAnalyzeNow}
              disabled={loadingAnalysis}
              style={{ padding: '6px 14px', borderRadius: 8, background: `${ACCENT}22`, border: `1px solid ${ACCENT}44`, color: ACCENT, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Play size={12} /> Analyze
            </button>
            <button
              onClick={() => problem && setCode(problem.starter_code)}
              style={{ padding: '6px 14px', borderRadius: 8, background: '#1c1c28', border: '1px solid #2a2a3e', color: '#8888aa', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>

          {/* Monaco */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Editor
              height="100%"
              defaultLanguage="typescript"
              value={code}
              onChange={(v) => setCode(v ?? '')}
              theme="vs-dark"
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                wordWrap: 'on',
                tabSize: 2,
                formatOnPaste: true,
                suggestOnTriggerCharacters: true,
                padding: { top: 16 },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CodingInterview;

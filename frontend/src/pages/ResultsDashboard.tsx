import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RotateCcw, TrendingUp, AlertCircle, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { getCompany } from '../components/CompanyConfig';
import MetricGauge from '../components/MetricGauge';
import type { InterviewResults, AnswerQualityPerQuestion, FeedbackImprovement } from '../types';

const MOCK_RESULTS: InterviewResults = {
  sessionId: 'demo',
  company: 'generic',
  overallScore: 74,
  presenceScore: 76,
  interviewScore: 72,
  eyeContactAvg: 78,
  stressAvg: 32,
  confidenceAvg: 71,
  strengths: [
    'Clear and well-structured responses using STAR format',
    'Strong technical depth with relevant examples',
    'Confident vocal delivery throughout',
  ],
  improvements: [
    'Maintain consistent eye contact during key moments',
    'Add quantitative metrics to strengthen impact statements',
    'Reduce filler words ("um", "like") when transitioning',
  ],
  questions: [
    {
      question: "Tell me about yourself and your background.",
      answer: "I'm a software engineer with 3 years of experience in full-stack development...",
      feedback: "Good opener. Consider leading with your most impactful achievement.",
      score: 78,
      eyeContact: 82,
      stress: 28,
      confidence: 75,
    },
    {
      question: "What's a project you're most proud of and why?",
      answer: "I led the migration of our monolith to microservices at my last company...",
      feedback: "Excellent example. Quantify the performance improvements with specific numbers.",
      score: 71,
      eyeContact: 74,
      stress: 35,
      confidence: 68,
    },
  ],
  duration: 18,
};

// ─── ScoreRing ────────────────────────────────────────────────────────────────

const ScoreRing: React.FC<{ score: number; color: string; size?: number }> = ({ score, color, size = 120 }) => {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score / 100);

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1c1c28" strokeWidth="8" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.5s ease', filter: `drop-shadow(0 0 10px ${color}88)` }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontSize: size * 0.22, fontWeight: 800, color, lineHeight: 1 }}>{Math.round(score)}</div>
        <div style={{ fontSize: size * 0.09, color: '#555577', fontWeight: 500 }}>/ 100</div>
      </div>
    </div>
  );
};

// ─── ScoreBar (0–10) ──────────────────────────────────────────────────────────

const scoreBarColor = (v: number): string =>
  v >= 7 ? '#22c55e' : v >= 5 ? '#eab308' : '#ef4444';

const ScoreBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const pct = (value / 10) * 100;
  const color = scoreBarColor(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8888aa', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{value}/10</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: '#1c1c28', overflow: 'hidden' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{
            height: '100%',
            borderRadius: 4,
            background: color,
            boxShadow: `0 0 8px ${color}88`,
          }}
        />
      </div>
    </div>
  );
};

// ─── AnswerQualitySection ────────────────────────────────────────────────────

const AnswerQuestionCard: React.FC<{ qr: AnswerQualityPerQuestion; index: number; accentColor: string }> = ({
  qr, index, accentColor,
}) => {
  const [expanded, setExpanded] = React.useState(false);
  const scoreColor = scoreBarColor(qr.score / 10);

  return (
    <div
      style={{
        background: '#1c1c28',
        border: '1px solid #2a2a3e',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '14px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 28, height: 28,
          borderRadius: 7,
          background: `${accentColor}22`,
          border: `1px solid ${accentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: accentColor,
          flexShrink: 0,
        }}>
          {index + 1}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: '#e8e8f0', fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>
            {qr.question}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 4 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, color: scoreColor,
            background: `${scoreColor}18`,
            border: `1px solid ${scoreColor}44`,
            borderRadius: 6, padding: '2px 8px',
          }}>
            {qr.score}/10
          </span>
          <span style={{ color: '#555577' }}>
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </div>
      </button>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{ borderTop: '1px solid #2a2a3e', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555577', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Answer Summary</div>
            <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6, background: '#16161e', padding: '10px 12px', borderRadius: 8, border: '1px solid #2a2a3e' }}>
              {qr.answer_summary}
            </div>
          </div>
          <div style={{ padding: '10px 12px', background: `${accentColor}12`, border: `1px solid ${accentColor}33`, borderRadius: 8, borderLeft: `3px solid ${accentColor}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: accentColor, marginBottom: 5 }}>Feedback</div>
            <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6 }}>{qr.feedback}</div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

// ─── ResumeFeedbackSection ────────────────────────────────────────────────────

const ImprovementCard: React.FC<{ item: FeedbackImprovement; accentColor: string }> = ({ item, accentColor }) => (
  <div style={{
    background: '#1c1c28',
    border: '1px solid #2a2a3e',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontSize: 11, fontWeight: 700,
        color: accentColor,
        background: `${accentColor}18`,
        border: `1px solid ${accentColor}44`,
        borderRadius: 6,
        padding: '2px 8px',
        letterSpacing: '0.04em',
      }}>
        {item.section}
      </span>
    </div>
    <div style={{ fontSize: 13, color: '#e8e8f0', fontWeight: 600, lineHeight: 1.4 }}>{item.issue}</div>
    <div style={{ fontSize: 13, color: '#8888aa', lineHeight: 1.5 }}>💡 {item.suggestion}</div>
  </div>
);

// ─── QuestionCard (existing per-session questions) ────────────────────────────

const QuestionCard: React.FC<{ qr: InterviewResults['questions'][0]; index: number; accentColor: string; aiScore?: number; aiFeedback?: string }> = ({ qr, index, accentColor, aiScore, aiFeedback }) => {
  const [expanded, setExpanded] = React.useState(false);
  const scoreColor = qr.score >= 70 ? '#22c55e' : qr.score >= 50 ? '#eab308' : '#ef4444';
  const aiScoreColor = aiScore != null ? (aiScore >= 7 ? '#22c55e' : aiScore >= 5 ? '#eab308' : '#ef4444') : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      style={{
        background: '#16161e',
        border: '1px solid #2a2a3e',
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '18px 20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 32, height: 32,
          borderRadius: 8,
          background: `${accentColor}22`,
          border: `1px solid ${accentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: accentColor,
          flexShrink: 0,
        }}>
          Q{index + 1}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: '#e8e8f0', fontWeight: 600, lineHeight: 1.4, marginBottom: 6 }}>
            {qr.question}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#8888aa', fontWeight: 600 }}>🎥 Presence: <span style={{ color: scoreColor }}>{qr.score}/100</span></span>
            {aiScore != null && aiScoreColor && (
              <span style={{ fontSize: 12, color: '#8888aa', fontWeight: 600 }}>🧠 Answer: <span style={{ color: aiScoreColor }}>{aiScore}/10</span></span>
            )}
            <span style={{ fontSize: 12, color: '#555577' }}>Eye: {Math.round(qr.eyeContact)}%</span>
            <span style={{ fontSize: 12, color: '#555577' }}>Conf: {Math.round(qr.confidence)}%</span>
          </div>
        </div>
        <div style={{ color: '#555577', flexShrink: 0, marginTop: 6 }}>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{ borderTop: '1px solid #2a2a3e', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#555577', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Your Answer</div>
            <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6, background: '#1c1c28', padding: '12px 14px', borderRadius: 10, border: '1px solid #2a2a3e' }}>
              {qr.answer}
            </div>
          </div>
          {(qr.feedback || aiFeedback) && (
            <div style={{ padding: '12px 14px', background: `${accentColor}12`, border: `1px solid ${accentColor}33`, borderRadius: 10, borderLeft: `3px solid ${accentColor}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: accentColor, marginBottom: 6 }}>AI Feedback</div>
              <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6 }}>{aiFeedback || qr.feedback}</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <MetricGauge label="Eye Contact" value={qr.eyeContact} type="bar" />
            <MetricGauge label="Confidence" value={qr.confidence} type="bar" />
            <MetricGauge label="Stress" value={qr.stress} type="bar" invert />
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

// ─── Section Header ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8f0', margin: '0 0 16px', letterSpacing: '-0.01em' }}>
    {title}
  </h2>
);

// ─── ResultsDashboard ─────────────────────────────────────────────────────────

const ResultsDashboard: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const results: InterviewResults = (location.state as { results: InterviewResults })?.results || MOCK_RESULTS;
  const companyConfig = getCompany(results.company);



  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', padding: '48px 24px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}
        >
          <div>
            <div style={{ fontSize: 12, color: '#555577', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 20, height: 20, background: companyConfig.accentColor + '22', border: `1px solid ${companyConfig.accentColor}44`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: companyConfig.accentColor }}>
                {companyConfig.icon}
              </div>
              {companyConfig.name} Interview · {results.duration} min
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: '#e8e8f0', margin: 0, letterSpacing: '-0.02em' }}>
              Your Results
            </h1>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/')}
            style={{
              background: '#16161e',
              border: '1.5px solid #2a2a3e',
              borderRadius: 12,
              padding: '12px 20px',
              color: '#e8e8f0',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s',
            }}
          >
            <RotateCcw size={15} />
            Try Again
          </motion.button>
        </motion.div>

        {/* ── Score Overview — two cards ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}
        >
          {/* Presence Score */}
          {(() => {
            const ps = results.presenceScore ?? results.overallScore;
            const pc = ps >= 80 ? '#22c55e' : ps >= 60 ? '#eab308' : '#ef4444';
            const pl = ps >= 80 ? 'Excellent Presence' : ps >= 65 ? 'Good Presence' : ps >= 50 ? 'Needs Work' : 'Keep Practicing';
            return (
              <div style={{ background: '#16161e', border: '1px solid #2a2a3e', borderRadius: 20, padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'flex-start' }}>
                  🎥 Presence Score
                </div>
                <ScoreRing score={ps} color={pc} size={120} />
                <div style={{ padding: '4px 14px', background: pc + '22', border: `1px solid ${pc}44`, borderRadius: 20, fontSize: 12, color: pc, fontWeight: 700 }}>
                  {pl}
                </div>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <MetricGauge label="Eye Contact" value={results.eyeContactAvg} type="bar" />
                  <MetricGauge label="Calmness" value={100 - results.stressAvg} type="bar" />
                  <MetricGauge label="Confidence" value={results.confidenceAvg} type="bar" />
                </div>
              </div>
            );
          })()}

          {/* Interview Performance Score */}
          {(() => {
            const is_ = results.interviewScore ?? results.overallScore;
            const ic = is_ >= 80 ? '#6366f1' : is_ >= 60 ? '#8b5cf6' : is_ >= 40 ? '#a78bfa' : '#ef4444';
            const il = is_ >= 80 ? 'Strong Performance' : is_ >= 65 ? 'Good Performance' : is_ >= 50 ? 'Needs Practice' : 'Keep Practicing';
            return (
              <div style={{ background: '#16161e', border: '1px solid #2a2a3e', borderRadius: 20, padding: '32px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', alignSelf: 'flex-start' }}>
                  🧠 Interview Performance
                </div>
                <ScoreRing score={is_} color={ic} size={120} />
                <div style={{ padding: '4px 14px', background: ic + '22', border: `1px solid ${ic}44`, borderRadius: 20, fontSize: 12, color: ic, fontWeight: 700 }}>
                  {il}
                </div>
                {results.answer_quality && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <MetricGauge label="Inflection" value={(results.answer_quality.inflection ?? results.answer_quality.star_structure) * 10} type="bar" />
                    <MetricGauge label="Clarity" value={(results.answer_quality.clarity ?? results.answer_quality.specificity) * 10} type="bar" />
                    <MetricGauge label="Conciseness" value={(results.answer_quality.conciseness ?? results.answer_quality.depth) * 10} type="bar" />
                  </div>
                )}
                {results.hiring_recommendation && (
                  <div style={{ marginTop: 4, fontSize: 13, color: '#c8c8e0', textAlign: 'center' }}>
                    Hiring Signal: <span style={{ fontWeight: 700, color: ic }}>{results.hiring_recommendation}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </motion.div>

        {/* ── AI Summary ── */}
        {results.summary && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.13 }}
            style={{ background: '#16161e', border: '1px solid #2a2a3e', borderRadius: 16, padding: '22px 26px', marginBottom: 24 }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
              💬 Interviewer Summary
            </div>
            <p style={{ margin: 0, fontSize: 15, color: '#c8c8e0', lineHeight: 1.7, fontStyle: 'italic' }}>
              "{results.summary}"
            </p>
          </motion.div>
        )}

        {/* ── Answer Quality ── */}
        {results.answer_quality && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            style={{
              background: '#16161e',
              border: '1px solid #2a2a3e',
              borderRadius: 20,
              padding: '28px 32px',
              marginBottom: 24,
            }}
          >
            <SectionHeader title="🎯 Answer Quality" />

            {/* Metric bars row */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
              <ScoreBar label="STAR Structure" value={results.answer_quality.star_structure} />
              <ScoreBar label="Specificity" value={results.answer_quality.specificity} />
              <ScoreBar label="Depth" value={results.answer_quality.depth} />
              <ScoreBar label="Overall Answer Score" value={results.answer_quality.overall} />
            </div>

            {/* Summary */}
            <div style={{
              fontSize: 13, color: '#c8c8e0', lineHeight: 1.6,
              background: '#1c1c28', padding: '14px 16px', borderRadius: 12,
              border: '1px solid #2a2a3e', marginBottom: 20,
            }}>
              {results.answer_quality.summary}
            </div>

            {/* Per-question expandable cards */}
            {results.answer_quality.per_question.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {results.answer_quality.per_question.map((qr, i) => (
                  <AnswerQuestionCard
                    key={i}
                    qr={qr}
                    index={i}
                    accentColor={companyConfig.accentColor}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── Strengths & Improvements ── */}
        {(results.strengths.length > 0 || results.improvements.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}
        >
          <div style={{
            background: '#16161e',
            border: '1px solid #22c55e33',
            borderRadius: 16,
            padding: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <TrendingUp size={16} color="#22c55e" />
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#22c55e', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Strengths
              </h3>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.strengths.map((s, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <Star size={13} color="#22c55e" style={{ marginTop: 3, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.5 }}>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          <div style={{
            background: '#16161e',
            border: '1px solid #eab30833',
            borderRadius: 16,
            padding: '24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <AlertCircle size={16} color="#eab308" />
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#eab308', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Areas to Improve
              </h3>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.improvements.map((s, i) => (
                <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#eab308', flexShrink: 0, marginTop: 6 }} />
                  <span style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.5 }}>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
        )}

        {/* ── Resume Feedback ── */}
        {results.resume_feedback != null && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            style={{
              background: '#16161e',
              border: '1px solid #2a2a3e',
              borderRadius: 20,
              padding: '28px 32px',
              marginBottom: 24,
            }}
          >
            <SectionHeader title="📄 Resume Feedback" />

            {/* Overall impression */}
            <div style={{
              fontSize: 13, color: '#c8c8e0', lineHeight: 1.6,
              background: '#1c1c28', padding: '14px 16px', borderRadius: 12,
              border: '1px solid #2a2a3e', marginBottom: 20,
            }}>
              {results.resume_feedback.overall_impression}
            </div>

            {/* Strengths */}
            {results.resume_feedback.strengths.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Strengths
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {results.resume_feedback.strengths.map((s, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <Star size={13} color="#22c55e" style={{ marginTop: 3, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.5 }}>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Improvements */}
            {results.resume_feedback.improvements.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#eab308', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Improvements
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {results.resume_feedback.improvements.map((item, i) => (
                    <ImprovementCard key={i} item={item} accentColor={companyConfig.accentColor} />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── LinkedIn Feedback ── */}
        {results.linkedin_feedback != null && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{
              background: '#16161e',
              border: '1px solid #2a2a3e',
              borderRadius: 20,
              padding: '28px 32px',
              marginBottom: 24,
            }}
          >
            <SectionHeader title="🔗 LinkedIn Feedback" />

            {/* Overall impression */}
            <div style={{
              fontSize: 13, color: '#c8c8e0', lineHeight: 1.6,
              background: '#1c1c28', padding: '14px 16px', borderRadius: 12,
              border: '1px solid #2a2a3e', marginBottom: 20,
            }}>
              {results.linkedin_feedback.overall_impression}
            </div>

            {/* Improvements */}
            {results.linkedin_feedback.improvements.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#eab308', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                  Improvements
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {results.linkedin_feedback.improvements.map((item, i) => (
                    <ImprovementCard key={i} item={item} accentColor={companyConfig.accentColor} />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Per-Question Breakdown ── */}
        {results.questions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            style={{ marginBottom: 48 }}
          >
            <SectionHeader title="Question Breakdown" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {results.questions.map((qr, i) => {
                const pq = results.answer_quality?.per_question?.[i];
                return (
                <QuestionCard key={i} qr={qr} index={i} accentColor={companyConfig.accentColor}
                  aiScore={pq?.score}
                  aiFeedback={pq?.feedback}
                />
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ── CTA ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          style={{ textAlign: 'center', paddingBottom: 48 }}
        >
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/')}
            style={{
              background: `linear-gradient(135deg, ${companyConfig.accentColor}, ${companyConfig.secondaryColor})`,
              border: 'none',
              borderRadius: 14,
              padding: '16px 40px',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: `0 8px 24px ${companyConfig.accentColor}44`,
              letterSpacing: '-0.01em',
            }}
          >
            <RotateCcw size={16} />
            Practice Again
          </motion.button>
          <div style={{ marginTop: 12, fontSize: 13, color: '#555577' }}>
            Each session improves your score. Keep going.
          </div>
        </motion.div>

      </div>
    </div>
  );
};

export default ResultsDashboard;

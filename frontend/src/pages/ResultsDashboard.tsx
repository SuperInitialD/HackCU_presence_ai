import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { RotateCcw, TrendingUp, AlertCircle, Eye, Brain, Shield, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { getCompany } from '../components/CompanyConfig';
import MetricGauge from '../components/MetricGauge';
import type { InterviewResults } from '../types';

const MOCK_RESULTS: InterviewResults = {
  sessionId: 'demo',
  company: 'generic',
  overallScore: 74,
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

const QuestionCard: React.FC<{ qr: InterviewResults['questions'][0]; index: number; accentColor: string }> = ({ qr, index, accentColor }) => {
  const [expanded, setExpanded] = React.useState(false);
  const scoreColor = qr.score >= 70 ? '#22c55e' : qr.score >= 50 ? '#eab308' : '#ef4444';

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
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 12, color: scoreColor, fontWeight: 700 }}>Score: {qr.score}/100</span>
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
          {qr.feedback && (
            <div style={{ padding: '12px 14px', background: `${accentColor}12`, border: `1px solid ${accentColor}33`, borderRadius: 10, borderLeft: `3px solid ${accentColor}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: accentColor, marginBottom: 6 }}>AI Feedback</div>
              <div style={{ fontSize: 13, color: '#c8c8e0', lineHeight: 1.6 }}>{qr.feedback}</div>
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

const ResultsDashboard: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const results: InterviewResults = (location.state as { results: InterviewResults })?.results || MOCK_RESULTS;
  const companyConfig = getCompany(results.company);

  const scoreColor = results.overallScore >= 80 ? '#22c55e' : results.overallScore >= 60 ? '#eab308' : '#ef4444';
  const scoreLabel = results.overallScore >= 80 ? 'Excellent' : results.overallScore >= 65 ? 'Good' : results.overallScore >= 50 ? 'Needs Work' : 'Keep Practicing';

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', padding: '48px 24px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        {/* Header */}
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

        {/* Score Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{
            background: '#16161e',
            border: '1px solid #2a2a3e',
            borderRadius: 20,
            padding: '36px',
            marginBottom: 24,
            display: 'flex',
            gap: 40,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <ScoreRing score={results.overallScore} color={scoreColor} size={140} />
            <div style={{
              padding: '4px 16px',
              background: scoreColor + '22',
              border: `1px solid ${scoreColor}44`,
              borderRadius: 20,
              fontSize: 13,
              color: scoreColor,
              fontWeight: 700,
            }}>
              {scoreLabel}
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#e8e8f0', margin: '0 0 20px', letterSpacing: '-0.01em' }}>
              Overall Performance
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Eye size={16} color="#8888aa" />
                <div style={{ flex: 1 }}>
                  <MetricGauge label="Eye Contact" value={results.eyeContactAvg} type="bar" />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Brain size={16} color="#8888aa" />
                <div style={{ flex: 1 }}>
                  <MetricGauge label="Stress Level" value={results.stressAvg} type="bar" invert />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Shield size={16} color="#8888aa" />
                <div style={{ flex: 1 }}>
                  <MetricGauge label="Confidence" value={results.confidenceAvg} type="bar" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Strengths & Improvements */}
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

        {/* Per-Question Breakdown */}
        {results.questions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            style={{ marginBottom: 48 }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e8e8f0', margin: '0 0 16px', letterSpacing: '-0.01em' }}>
              Question Breakdown
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {results.questions.map((qr, i) => (
                <QuestionCard key={i} qr={qr} index={i} accentColor={companyConfig.accentColor} />
              ))}
            </div>
          </motion.div>
        )}

        {/* CTA */}
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

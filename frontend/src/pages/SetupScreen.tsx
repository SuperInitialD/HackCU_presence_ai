import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Link, FileText, ChevronRight, CheckCircle, AlertCircle, Loader2, Briefcase } from 'lucide-react';
import { getCompany } from '../components/CompanyConfig';
import { parseResume, fetchJD, startSession } from '../api/client';
import type { InterviewSetup } from '../types';

const defaultConfig = getCompany();

const SetupScreen: React.FC = () => {
  const navigate = useNavigate();
  const [companyFreeText, setCompanyFreeText] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState('');
  const [jdMode, setJdMode] = useState<'url' | 'text'>('text');
  const [jdUrl, setJdUrl] = useState('');
  const [jdText, setJdText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsingResume, setIsParsingResume] = useState(false);
  const [isFetchingJD, setIsFetchingJD] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const [jdError, setJdError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const accentColor = defaultConfig.accentColor;

  const handleFileDrop = useCallback(async (file: File) => {
    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.txt') && !file.name.endsWith('.docx')) {
      setResumeError('Please upload a PDF, TXT, or DOCX file.');
      return;
    }
    setResumeFile(file);
    setResumeError('');
    setIsParsingResume(true);
    try {
      const result = await parseResume(file);
      setResumeText(result.text);
    } catch {
      const reader = new FileReader();
      reader.onload = (e) => setResumeText(e.target?.result as string || '');
      reader.readAsText(file);
    } finally {
      setIsParsingResume(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileDrop(file);
  }, [handleFileDrop]);

  const handleFetchJD = async () => {
    if (!jdUrl.trim()) return;
    setIsFetchingJD(true);
    setJdError('');
    try {
      const result = await fetchJD(jdUrl.trim());
      setJdText(result.text);
      setJdMode('text');
    } catch {
      setJdError('Could not fetch job description. Paste the text directly instead.');
    } finally {
      setIsFetchingJD(false);
    }
  };

  const handleStart = async () => {
    setIsStarting(true);
    try {
      const session = await startSession({
        company: companyFreeText.trim() || undefined,
        resume_text: resumeText || undefined,
        job_description: jdText || undefined,
      });

      const setup: InterviewSetup = {
        company: companyFreeText.trim() || undefined,
        resumeText,
        jobDescription: jdText,
        sessionId: session.session_id,
      };

      navigate('/interview', {
        state: {
          setup,
          firstQuestion: session.first_question,
          sessionId: session.session_id,
          interviewerName: session.interviewer_name,
        },
      });
    } catch {
      const setup: InterviewSetup = {
        company: companyFreeText.trim() || undefined,
        resumeText,
        jobDescription: jdText,
        sessionId: `demo-${Date.now()}`,
      };
      navigate('/interview', {
        state: {
          setup,
          firstQuestion: `Tell me about yourself${companyFreeText.trim() ? ` and why you're interested in this ${companyFreeText.trim()} role` : ''}.`,
          sessionId: setup.sessionId,
          interviewerName: 'AI Interviewer',
        },
      });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f0f13',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '48px 24px',
    }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ textAlign: 'center', marginBottom: 48 }}
      >
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          marginBottom: 16,
        }}>
          <div style={{
            width: 40, height: 40,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>◎</div>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#e8e8f0', letterSpacing: '-0.02em' }}>
            Presence AI
          </span>
        </div>
        <h1 style={{ fontSize: 40, fontWeight: 800, color: '#e8e8f0', margin: '0 0 12px', letterSpacing: '-0.03em' }}>
          Ace your next interview
        </h1>
        <p style={{ fontSize: 16, color: '#8888aa', margin: 0, maxWidth: 480 }}>
          AI-powered mock interviews with real-time body language analysis.
          Practice, get feedback, land the role.
        </p>
      </motion.div>

      <div style={{ width: '100%', maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Target Company / Role */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            01 — Target Company / Role <span style={{ color: '#555577', fontWeight: 400 }}>(optional)</span>
          </h2>
          <div style={{
            background: '#16161e',
            border: '1px solid #2a2a3e',
            borderRadius: 14,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <Briefcase size={18} color="#555577" style={{ flexShrink: 0 }} />
            <input
              type="text"
              value={companyFreeText}
              onChange={e => setCompanyFreeText(e.target.value)}
              placeholder='e.g. "Google SWE", "Amazon PM", "Startup engineer"'
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e8e8f0',
                fontSize: 15,
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#555577' }}>
            Leave blank for a general interview. The AI will tailor questions to your target role.
          </div>
        </motion.section>

        {/* Resume Upload */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            02 — Upload Resume <span style={{ color: '#555577', fontWeight: 400 }}>(optional)</span>
          </h2>
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${isDragging ? accentColor : resumeFile ? '#22c55e44' : '#2a2a3e'}`,
              borderRadius: 14,
              padding: '32px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragging ? `${accentColor}08` : resumeFile ? '#22c55e08' : '#16161e',
              transition: 'all 0.2s ease',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.docx"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileDrop(f); }}
            />
            {isParsingResume ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#8888aa' }}>
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Parsing resume...</span>
              </div>
            ) : resumeFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <CheckCircle size={20} color="#22c55e" />
                <span style={{ color: '#22c55e', fontWeight: 600 }}>{resumeFile.name}</span>
                <span style={{ color: '#555577', fontSize: 13 }}>— resume loaded</span>
              </div>
            ) : (
              <>
                <Upload size={28} color="#555577" style={{ marginBottom: 12 }} />
                <div style={{ color: '#8888aa', fontSize: 14, marginBottom: 4 }}>
                  Drop your resume here or <span style={{ color: accentColor }}>browse</span>
                </div>
                <div style={{ color: '#555577', fontSize: 12 }}>PDF, TXT, or DOCX</div>
              </>
            )}
          </div>
          {resumeError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#ef4444', fontSize: 13 }}>
              <AlertCircle size={14} />
              {resumeError}
            </div>
          )}
        </motion.section>

        {/* Job Description */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            03 — Job Description <span style={{ color: '#555577', fontWeight: 400 }}>(optional)</span>
          </h2>
          <div style={{
            background: '#16161e',
            border: '1px solid #2a2a3e',
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            {/* Mode tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #2a2a3e' }}>
              {(['url', 'text'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setJdMode(mode)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'none',
                    border: 'none',
                    borderBottom: jdMode === mode ? `2px solid ${accentColor}` : '2px solid transparent',
                    cursor: 'pointer',
                    color: jdMode === mode ? accentColor : '#8888aa',
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.2s',
                    marginBottom: -1,
                  }}
                >
                  {mode === 'url' ? <><Link size={14} /> Paste URL</> : <><FileText size={14} /> Paste Text</>}
                </button>
              ))}
            </div>
            <div style={{ padding: 16 }}>
              <AnimatePresence mode="wait">
                {jdMode === 'url' ? (
                  <motion.div
                    key="url"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    style={{ display: 'flex', gap: 10 }}
                  >
                    <input
                      type="url"
                      value={jdUrl}
                      onChange={e => setJdUrl(e.target.value)}
                      placeholder="https://jobs.example.com/..."
                      onKeyDown={(e) => e.key === 'Enter' && handleFetchJD()}
                      style={{
                        flex: 1,
                        background: '#0f0f13',
                        border: '1px solid #2a2a3e',
                        borderRadius: 8,
                        padding: '10px 14px',
                        color: '#e8e8f0',
                        fontSize: 14,
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={handleFetchJD}
                      disabled={isFetchingJD || !jdUrl.trim()}
                      style={{
                        background: accentColor,
                        border: 'none',
                        borderRadius: 8,
                        padding: '10px 18px',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                        opacity: isFetchingJD || !jdUrl.trim() ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {isFetchingJD ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                      Fetch
                    </button>
                  </motion.div>
                ) : (
                  <motion.div key="text" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <textarea
                      value={jdText}
                      onChange={e => setJdText(e.target.value)}
                      placeholder="Paste the job description here..."
                      rows={6}
                      style={{
                        width: '100%',
                        background: '#0f0f13',
                        border: '1px solid #2a2a3e',
                        borderRadius: 8,
                        padding: '12px 14px',
                        color: '#e8e8f0',
                        fontSize: 14,
                        outline: 'none',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        lineHeight: 1.6,
                        boxSizing: 'border-box',
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {jdError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#ef4444', fontSize: 13 }}>
                  <AlertCircle size={14} />
                  {jdError}
                </div>
              )}
              {jdText && jdMode === 'url' && (
                <div style={{ marginTop: 10, padding: '10px 14px', background: '#22c55e10', border: '1px solid #22c55e33', borderRadius: 8, color: '#22c55e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={14} />
                  Job description loaded ({jdText.length} characters)
                </div>
              )}
            </div>
          </div>
        </motion.section>

        {/* Start Button */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 48 }}
        >
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            disabled={isStarting}
            style={{
              background: `linear-gradient(135deg, ${defaultConfig.accentColor}, ${defaultConfig.secondaryColor})`,
              border: 'none',
              borderRadius: 14,
              padding: '16px 36px',
              color: '#fff',
              fontSize: 16,
              fontWeight: 700,
              cursor: isStarting ? 'not-allowed' : 'pointer',
              opacity: isStarting ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              boxShadow: `0 8px 24px ${defaultConfig.accentColor}44`,
              letterSpacing: '-0.01em',
            }}
          >
            {isStarting ? (
              <>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Setting up interview...
              </>
            ) : (
              <>
                Start Interview
                <ChevronRight size={18} />
              </>
            )}
          </motion.button>
        </motion.div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default SetupScreen;

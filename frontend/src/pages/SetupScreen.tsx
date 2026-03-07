import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Link, FileText, ChevronRight, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { COMPANIES } from '../components/CompanyConfig';
import { parseResume, fetchJD, startSession } from '../api/client';
import type { Company, InterviewSetup } from '../types';

const SetupScreen: React.FC = () => {
  const navigate = useNavigate();
  const [selectedCompany, setSelectedCompany] = useState<Company>('generic');
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

  const selectedConfig = COMPANIES.find(c => c.id === selectedCompany)!;

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
      // Fallback: read as text if API fails
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
        company: selectedCompany,
        resume_text: resumeText || undefined,
        job_description: jdText || undefined,
      });

      const setup: InterviewSetup = {
        company: selectedCompany,
        resumeText,
        jobDescription: jdText,
        sessionId: session.session_id,
      };

      navigate('/interview', {
        state: {
          setup,
          firstQuestion: session.first_question,
          sessionId: session.session_id,
        },
      });
    } catch {
      // Fallback for demo: create a local session
      const setup: InterviewSetup = {
        company: selectedCompany,
        resumeText,
        jobDescription: jdText,
        sessionId: `demo-${Date.now()}`,
      };
      navigate('/interview', {
        state: {
          setup,
          firstQuestion: `Tell me about yourself and why you're interested in this ${selectedConfig.name} role.`,
          sessionId: setup.sessionId,
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
        {/* Company Picker */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5 }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#8888aa', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            01 — Choose Company
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {COMPANIES.map(company => {
              const isSelected = selectedCompany === company.id;
              return (
                <motion.button
                  key={company.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedCompany(company.id)}
                  style={{
                    background: isSelected ? `${company.accentColor}18` : '#16161e',
                    border: `2px solid ${isSelected ? company.accentColor : '#2a2a3e'}`,
                    borderRadius: 14,
                    padding: '18px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s ease',
                    boxShadow: isSelected ? `0 0 20px ${company.accentColor}22` : 'none',
                  }}
                >
                  <div style={{
                    width: 42, height: 42,
                    borderRadius: 10,
                    background: isSelected ? company.accentColor : '#2a2a3e',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 900, color: '#fff',
                    transition: 'all 0.2s ease',
                  }}>
                    {company.icon}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: isSelected ? company.accentColor : '#e8e8f0', marginBottom: 4 }}>
                      {company.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#555577', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {company.description}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
          {selectedCompany && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              style={{
                marginTop: 12,
                padding: '12px 16px',
                background: `${selectedConfig.accentColor}12`,
                border: `1px solid ${selectedConfig.accentColor}33`,
                borderRadius: 10,
                fontSize: 13,
                color: '#8888aa',
              }}
            >
              <span style={{ color: selectedConfig.accentColor, fontWeight: 600 }}>{selectedConfig.interviewer}</span>
              {' '}will be interviewing you. Style: {selectedConfig.style}.
            </motion.div>
          )}
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
              border: `2px dashed ${isDragging ? selectedConfig.accentColor : resumeFile ? '#22c55e44' : '#2a2a3e'}`,
              borderRadius: 14,
              padding: '32px',
              textAlign: 'center',
              cursor: 'pointer',
              background: isDragging ? `${selectedConfig.accentColor}08` : resumeFile ? '#22c55e08' : '#16161e',
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
                  Drop your resume here or <span style={{ color: selectedConfig.accentColor }}>browse</span>
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
                    borderBottom: jdMode === mode ? `2px solid ${selectedConfig.accentColor}` : '2px solid transparent',
                    cursor: 'pointer',
                    color: jdMode === mode ? selectedConfig.accentColor : '#8888aa',
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
                      placeholder="https://jobs.google.com/..."
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
                        background: selectedConfig.accentColor,
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
              background: `linear-gradient(135deg, ${selectedConfig.accentColor}, ${selectedConfig.secondaryColor})`,
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
              boxShadow: `0 8px 24px ${selectedConfig.accentColor}44`,
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

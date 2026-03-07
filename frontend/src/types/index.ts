export type Company = 'google' | 'amazon' | 'meta' | 'microsoft' | 'generic';

export interface CompanyConfig {
  id: Company;
  name: string;
  interviewer: string;
  accentColor: string;
  secondaryColor: string;
  description: string;
  style: string;
  icon: string;
}

export interface InterviewSetup {
  company: Company;
  resumeText?: string;
  jobDescription?: string;
  sessionId?: string;
}

export interface Message {
  id: string;
  role: 'interviewer' | 'candidate';
  content: string;
  timestamp: Date;
  feedbackHint?: string;
}

export interface FaceMetrics {
  eyeContact: number;   // 0-100
  stress: number;       // 0-100
  confidence: number;   // 0-100
}

export interface QuestionResult {
  question: string;
  answer: string;
  feedback: string;
  score: number;
  eyeContact: number;
  stress: number;
  confidence: number;
}

export interface InterviewResults {
  sessionId: string;
  company: Company;
  overallScore: number;
  eyeContactAvg: number;
  stressAvg: number;
  confidenceAvg: number;
  strengths: string[];
  improvements: string[];
  questions: QuestionResult[];
  duration: number;
}

export interface SessionState {
  setup: InterviewSetup;
  messages: Message[];
  results?: InterviewResults;
  metricsHistory: FaceMetrics[];
}

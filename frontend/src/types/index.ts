export type Company = string;

export interface CompanyConfig {
  id: string;
  name: string;
  interviewer: string;
  accentColor: string;
  secondaryColor: string;
  description: string;
  style: string;
  icon: string;
}

export interface InterviewSetup {
  company?: string;
  resumeText?: string;
  jobDescription?: string;
  sessionId?: string;
  interviewType?: string;
}

export interface Message {
  id: string;
  role: 'interviewer' | 'candidate';
  content: string;
  timestamp: Date;
  feedbackHint?: string;
}

export interface FaceMetrics {
  eyeContact: number;   // 0-100: face gaze estimated by MediaPipe
  volume: number;       // 0-100: mic RMS audio level
  confidence: number;   // 0-100: face landmark presence/quality
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

export interface AnswerQualityPerQuestion {
  question: string;
  answer_summary: string;
  score: number;
  feedback: string;
}

export interface AnswerQuality {
  star_structure: number;
  specificity: number;
  depth: number;
  overall: number;
  inflection: number;
  clarity: number;
  conciseness: number;
  summary: string;
  per_question: AnswerQualityPerQuestion[];
}

export interface FeedbackImprovement {
  section: string;
  issue: string;
  suggestion: string;
}

export interface ResumeFeedback {
  overall_impression: string;
  strengths: string[];
  improvements: FeedbackImprovement[];
}

export interface LinkedInFeedback {
  overall_impression: string;
  improvements: FeedbackImprovement[];
}

export interface InterviewResults {
  sessionId: string;
  company?: string;
  overallScore: number;
  presenceScore: number;      // 0-100: eye contact + volume + confidence
  interviewScore: number;     // 0-100: AI eval of answer quality
  eyeContactAvg: number;
  volumeAvg: number;
  stressAvg?: number;   // legacy — mapped to volumeAvg
  confidenceAvg: number;
  strengths: string[];
  improvements: string[];
  questions: QuestionResult[];
  duration: number;
  hiring_recommendation?: string;
  summary?: string;
  videoUrl?: string;
  videoTimestamps?: Array<{ time: number; label: string; feedback?: string }>;
  answer_quality?: AnswerQuality;
  resume_feedback?: ResumeFeedback | null;
  linkedin_feedback?: LinkedInFeedback | null;
}

export interface SessionState {
  setup: InterviewSetup;
  messages: Message[];
  results?: InterviewResults;
  metricsHistory: FaceMetrics[];
}

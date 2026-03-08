import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

export interface ParseResumeResponse {
  text: string;
  skills: string[];
  experience: string[];
}

export interface FetchJDResponse {
  text: string;       // mapped from backend's "description"
  description: string;
  title: string;
  company: string;
}

export interface StartSessionResponse {
  session_id: string;
  first_question: string;
  opening_message?: string;  // backend alias
  interviewer_name: string;
}

export interface RespondResponse {
  next_question?: string;
  message?: string;
  feedback_hint?: string;
  follow_up?: boolean;
  is_complete: boolean;
  score?: number;
  checklist?: {
    resume: boolean;
    profile: boolean;
    technical: boolean;
    behavioral: boolean;
  };
  results?: {
    overall_score: number;
    strengths: string[];
    improvements: string[];
    per_question: Array<{
      question: string;
      answer: string;
      feedback: string;
      score: number;
    }>;
  };
}

export interface TranscribeResponse {
  text: string;
}

export const parseResume = async (file: File): Promise<ParseResumeResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<ParseResumeResponse>('/parse-resume', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const fetchJD = async (url: string): Promise<FetchJDResponse> => {
  const { data } = await api.get<FetchJDResponse>('/fetch-jd', { params: { url } });
  // Backend returns `description`, normalize to `text` for frontend compatibility
  return { ...data, text: data.description || data.text || '' };
};

export const startSession = async (payload: {
  company?: string;
  resume_text?: string;
  job_description?: string;
  github_url?: string;
  linkedin_url?: string;
}): Promise<StartSessionResponse> => {
  const { data } = await api.post<StartSessionResponse>('/session/start', payload);
  // Normalize: backend may return opening_message instead of first_question
  return {
    ...data,
    first_question: data.first_question || data.opening_message || "Tell me about yourself.",
  };
};

export const respond = async (
  sessionId: string,
  payload: { answer: string; eye_contact?: number; stress?: number; confidence?: number }
): Promise<RespondResponse> => {
  const { data } = await api.post<RespondResponse>(`/session/${sessionId}/respond`, payload);
  return data;
};

export const transcribeAudio = async (audioBlob: Blob): Promise<TranscribeResponse> => {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');
  const { data } = await api.post<TranscribeResponse>('/transcribe', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export default api;

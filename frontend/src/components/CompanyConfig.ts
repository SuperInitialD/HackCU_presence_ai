import type { CompanyConfig } from '../types';

const DEFAULT_CONFIG: CompanyConfig = {
  id: 'default',
  name: 'AI Interview',
  interviewer: 'AI Interviewer',
  accentColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  description: 'General interview preparation with AI feedback.',
  style: 'Mixed: behavioral, technical, situational',
  icon: '◎',
};

export const getCompany = (_id?: string): CompanyConfig => DEFAULT_CONFIG;

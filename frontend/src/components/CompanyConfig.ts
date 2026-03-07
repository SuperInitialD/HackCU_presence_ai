import type { Company, CompanyConfig } from '../types';

export const COMPANIES: CompanyConfig[] = [
  {
    id: 'google',
    name: 'Google',
    interviewer: 'Alex from Google',
    accentColor: '#4285F4',
    secondaryColor: '#34A853',
    description: 'Focuses on system design, algorithms, and "Googleyness".',
    style: 'Structured STAR format, behavioral + technical mix',
    icon: 'G',
  },
  {
    id: 'amazon',
    name: 'Amazon',
    interviewer: 'Jordan from Amazon',
    accentColor: '#FF9900',
    secondaryColor: '#FF9900',
    description: 'Leadership Principles-driven. Every question connects to LP.',
    style: '14 Leadership Principles, deep dives, bar-raising',
    icon: 'A',
  },
  {
    id: 'meta',
    name: 'Meta',
    interviewer: 'Sam from Meta',
    accentColor: '#0866FF',
    secondaryColor: '#0866FF',
    description: 'Move fast. Product sense, impact focus, collaboration.',
    style: 'Behavioral, cross-functional leadership, product thinking',
    icon: 'M',
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    interviewer: 'Taylor from Microsoft',
    accentColor: '#00A4EF',
    secondaryColor: '#00A4EF',
    description: 'Growth mindset, problem-solving approach, collaboration.',
    style: 'Behavioral, design thinking, culture fit',
    icon: '⊞',
  },
  {
    id: 'generic',
    name: 'Generic',
    interviewer: 'Morgan — AI Interviewer',
    accentColor: '#6366f1',
    secondaryColor: '#8b5cf6',
    description: 'General software engineering interview preparation.',
    style: 'Mixed: behavioral, technical, situational',
    icon: '◎',
  },
];

export const getCompany = (id: Company): CompanyConfig =>
  COMPANIES.find(c => c.id === id) || COMPANIES[4];

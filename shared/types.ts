export type AssessmentStatus = 'available' | 'in_progress' | 'submitted' | 'closed' | 'unknown';
export type QuestionType = 'single' | 'multiple' | 'text' | 'unsupported';
export interface Course {
  id: number;
  external_id: string;
  name: string;
  url: string;
  updated_at: string;
}
export interface Assessment {
  id: number;
  external_id: string;
  course_id: number;
  course_name?: string;
  title: string;
  url: string;
  due_at: string | null;
  source_timezone: string;
  instructions: string;
  status: AssessmentStatus;
  attempt_id: string | null;
  duration_minutes: number | null;
  updated_at: string;
  fingerprint: string | null;
}
export interface Choice {
  id: string;
  text: string;
}
export interface Answer {
  text: string;
  choices: string[];
}
export interface Suggestion {
  answer: Answer;
  explanation: string;
  references: string[];
  provider: string;
  model: string;
}
export interface Question {
  id: number;
  assessment_id: number;
  external_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  choices: Choice[];
  images: string[];
  fingerprint: string;
  answer: Answer;
  approved_hash: string | null;
  suggestion: Suggestion | null;
  updated_at: string;
}
export interface Material {
  id: number;
  course_id: number;
  title: string;
  content: string;
  url: string;
  selected: number;
}
export type JobKind =
  | 'sync'
  | 'inspect'
  | 'start'
  | 'extract'
  | 'fill'
  | 'submit'
  | 'reconcile'
  | 'learn_discover'
  | 'learn_consume'
  | 'learn_generate'
  | 'learn_transcribe';
export interface Job {
  id: number;
  kind: JobKind;
  assessment_id: number | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'needs_action' | 'uncertain';
  progress: string;
  created_at: string;
  updated_at: string;
}
export interface Reminder {
  id: number;
  assessment_id: number;
  title: string;
  course_name: string;
  due_at: string;
  threshold_hours: number;
  notified_at: string | null;
}
export interface Receipt {
  id: number;
  assessment_id: number;
  attempt_id: string;
  status: string;
  evidence: string;
  created_at: string;
}
export interface Dashboard {
  courses: Course[];
  assessments: Assessment[];
  jobs: Job[];
  reminders: Reminder[];
  receipts: Receipt[];
  lastSync: string | null;
}
export interface AssessmentDetail {
  assessment: Assessment;
  questions: Question[];
  materials: Material[];
  receipts: Receipt[];
}

export interface ChecklistSource {
  id: string;
  title: string;
  url: string;
  detail: string;
}
export interface ChecklistItemInput {
  slug: string;
  phase: string;
  title: string;
  description: string;
  kind: 'requirement' | 'organization' | 'verify';
  required: boolean;
  source_refs: string[];
}
export interface ChecklistItem extends ChecklistItemInput {
  id: number;
  plan_id: number;
  position: number;
  done: boolean;
  notes: string;
  revision: number;
  updated_at: string;
}
export interface ChecklistPlanInput {
  external_id: string;
  title: string;
  course_name: string;
  source_url: string;
  personal_due_at: string;
  official_due_at: string;
  summary: string;
  warnings: string[];
  sources: ChecklistSource[];
  source_checked_at: string;
  items: ChecklistItemInput[];
}
export interface ChecklistPlan extends Omit<ChecklistPlanInput, 'items'> {
  id: number;
  updated_at: string;
  items: ChecklistItem[];
}

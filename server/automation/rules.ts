import { hash } from '../db.js';

type QuizRules = {
  instructions: string;
  duration_minutes: number | null;
  due_at: string | null;
};

/** A manual deadline is a fallback only when the portal omits its date. */
export function quizRulesFingerprint(rules: QuizRules, manualDeadline?: string | null) {
  const deadline = rules.due_at || manualDeadline || null;
  const timestamp = deadline ? Date.parse(deadline) : NaN;
  const normalized = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : deadline;
  return hash([rules.instructions, rules.duration_minutes, normalized]);
}

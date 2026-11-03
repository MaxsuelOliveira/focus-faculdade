import { z } from 'zod';

export const outputKinds = ['summary', 'mindmap', 'slides', 'quiz'] as const;
export const courseStateSchema = z.enum(['in_progress', 'completed', 'unclassified']);
const refs = z.array(z.string().min(1)).min(1).max(30);
export const learningPacketSchema = z.object({
  title: z.string().trim().min(1).max(300),
  summary: z
    .array(
      z.object({ title: z.string().min(1).max(300), text: z.string().min(1).max(12000), refs }),
    )
    .min(1)
    .max(100),
  mindmap: z
    .array(
      z.object({
        id: z.string().min(1),
        parent: z.string().nullable(),
        label: z.string().min(1).max(300),
        refs,
      }),
    )
    .min(1)
    .max(1000),
  slides: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        bullets: z.array(z.string().min(1).max(2000)).min(1).max(8),
        refs,
      }),
    )
    .min(1)
    .max(100),
  quiz: z
    .array(
      z.object({
        prompt: z.string().min(1).max(3000),
        choices: z.array(z.string().min(1).max(1000)).min(2).max(8),
        correct: z.number().int().nonnegative(),
        explanation: z.string().min(1).max(3000),
        refs,
      }),
    )
    .min(1)
    .max(100),
});
export type LearningPacket = z.infer<typeof learningPacketSchema>;
export function validateLearningPacket(packet: unknown, valid: Set<string>) {
  const value = learningPacketSchema.parse(packet);
  if (
    [...value.summary, ...value.mindmap, ...value.slides, ...value.quiz].some((e) =>
      e.refs.some((r) => !valid.has(r)),
    )
  )
    throw new Error('A IA citou uma fonte inexistente ou não consumida.');
  if (value.quiz.some((q) => q.correct >= q.choices.length))
    throw new Error('A IA retornou uma alternativa inválida.');
  const ids = new Set(value.mindmap.map((n) => n.id));
  if (
    ids.size !== value.mindmap.length ||
    value.mindmap.filter((n) => n.parent === null).length !== 1 ||
    value.mindmap.some((n) => n.parent !== null && !ids.has(n.parent))
  )
    throw new Error('A IA retornou um mapa inválido.');
  for (const n of value.mindmap) {
    const seen = new Set<string>();
    let node: typeof n | undefined = n;
    while (node) {
      if (seen.has(node.id)) throw new Error('A IA retornou um mapa com ciclo.');
      seen.add(node.id);
      node = value.mindmap.find((x) => x.id === node!.parent);
    }
  }
  return value;
}
export interface LearningSource {
  id: number;
  course_id: number;
  external_key: string;
  title: string;
  url: string;
  kind: 'text' | 'pdf' | 'video' | 'link' | 'image';
  status: 'pending' | 'ready' | 'failed' | 'excluded';
  content: string;
  content_hash: string;
  locator: string;
  reason: string;
  updated_at: string;
}
export interface LearningRun {
  id: number;
  course_id: number;
  status: 'queued' | 'running' | 'paused' | 'needs_action' | 'completed' | 'failed';
  outputs: (typeof outputKinds)[number][];
  source_snapshot: { id: number; hash: string }[];
  provider: string;
  model: string;
  error: string;
  progress?: string;
  created_at: string;
  updated_at: string;
}
export interface LearningArtifact {
  id: number;
  run_id: number;
  packet: LearningPacket;
  sources: LearningSource[];
  coverage: 'partial' | 'complete';
  created_at: string;
}

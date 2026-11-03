import { z } from 'zod';

export const portalOrigin = 'https://graduacao.faculdadefocus.edu.br';
export const jacadOrigin = 'https://faculdadefocus.jacad.com.br';
export const moodleId = z
  .union([z.number().int().positive(), z.string().regex(/^[1-9]\d*$/)])
  .transform(Number)
  .refine(Number.isSafeInteger);
const timestamp = z.number().int().min(0).max(253402300799);
export const courseSchema = z.object({
  id: moodleId,
  fullname: z.string().min(1).max(1000),
  startdate: timestamp,
  enddate: timestamp,
  viewurl: z.string().url(),
  visible: z.boolean(),
  hidden: z.boolean(),
  coursecategory: z.string().optional(),
});
export const coursesSchema = z.object({
  courses: z.array(courseSchema).max(1000),
  nextoffset: z.number().int().nonnegative(),
});
export const moduleSchema = z.object({
  id: moodleId,
  name: z.string().min(1).max(1000),
  module: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),
  url: z.string().url().optional(),
  uservisible: z.boolean(),
  visible: z.boolean(),
  completionstate: z.number().int().min(0).max(3).optional(),
});
export const stateSchema = z.object({
  course: z.object({ id: moodleId }),
  section: z.array(z.object({ id: moodleId, cmlist: z.array(moodleId) })).max(1000),
  cm: z.array(moduleSchema).max(10000),
});
export const eventSchema = z.object({
  id: moodleId,
  name: z.string().max(2000),
  description: z.string().max(1_000_000),
  eventtype: z.string().max(100),
  modulename: z.string().max(100),
  timestart: timestamp,
  timeduration: z.number().int().nonnegative(),
  course: z.object({ id: moodleId }).nullish(),
  url: z.string().max(4000),
});
export const monthSchema = z.object({
  date: z.object({ year: z.number().int(), mon: z.number().int().min(1).max(12), timestamp }),
  nextperiod: z.object({ timestamp }),
  weeks: z.array(z.object({ days: z.array(z.object({ events: z.array(eventSchema) })) })).max(6),
});
export type ApiCourse = z.infer<typeof courseSchema>;
export type ApiCourseState = z.infer<typeof stateSchema>;
export type ApiCalendarEvent = z.infer<typeof eventSchema>;
export interface PortalSnapshot {
  courses: ApiCourse[];
  inProgressIds: number[];
  states: ApiCourseState[];
  events: ApiCalendarEvent[];
  coverage: { from: string; to: string };
  checkedAt: string;
  scope: { courseExternalId: string | null };
}
export function isoTimestamp(seconds: number) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}
export function moduleUrl(module: { id: number; module: string; url?: string }) {
  const parsed = new URL(
    module.url || `${portalOrigin}/mod/${module.module}/view.php?id=${module.id}`,
  );
  if (
    parsed.origin !== portalOrigin ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== `/mod/${module.module}/view.php` ||
    parsed.searchParams.get('id') !== String(module.id)
  ) {
    throw new Error('A API retornou uma identidade de atividade inconsistente.');
  }
  return parsed.href;
}

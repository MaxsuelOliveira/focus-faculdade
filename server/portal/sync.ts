import { config } from '../config.js';
import type { Store } from '../db.js';
import { PortalApiError, PortalHttpClient, type PortalReader } from './client.js';
import { PortalStore } from './store.js';
import {
  moduleUrl,
  type ApiCalendarEvent,
  type PortalSnapshot,
  type ApiCourse,
} from './contracts.js';

export function calendarMonths(courses: ApiCourse[], now = new Date()) {
  const starts = courses.map((c) => c.startdate).filter(Boolean);
  const ends = courses.map((c) => c.enddate).filter(Boolean);
  const from = new Date(
    (starts.length ? Math.min(...starts) : now.getTime() / 1000 - 366 * 86400) * 1000,
  );
  const to = new Date(Math.max(now.getTime() / 1000 + 366 * 86400, ...ends) * 1000);
  // Pad month selection for timezone boundaries. Coverage itself comes from the
  // server's date/nextperiod timestamps, never from a guessed local midnight.
  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 2, 1));
  const months: { year: number; month: number }[] = [];
  for (
    const cursor = new Date(first);
    cursor < last;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  ) {
    if (months.length >= 120) throw new PortalApiError('INVALID_RESPONSE');
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
  }
  return { months };
}
export async function collectPortal(
  reader: PortalReader,
  courseExternalId?: string,
  progress: (message: string) => void = () => {},
) {
  if (courseExternalId && !/^[1-9]\d{0,9}$/.test(courseExternalId))
    throw new PortalApiError('INVALID_RESPONSE');
  progress('Consultando catálogo pela API Moodle');
  const courses = await reader.courses('all');
  const active = await reader.courses('inprogress');
  if (active.some((a) => !courses.some((c) => c.id === a.id)))
    throw new PortalApiError('INVALID_RESPONSE');
  const selected = courseExternalId
    ? courses.filter((c) => String(c.id) === courseExternalId)
    : courses;
  if (courseExternalId && !selected.length) throw new PortalApiError('API_UNAVAILABLE');
  const states: PortalSnapshot['states'] = [];
  for (const [index, course] of selected.entries()) {
    progress(`API: módulos da disciplina ${index + 1}/${selected.length}`);
    const state = await reader.state(course.id);
    const moduleIds = state.cm.map((m) => m.id);
    if (new Set(moduleIds).size !== moduleIds.length || state.course.id !== course.id)
      throw new PortalApiError('INVALID_RESPONSE');
    for (const module of state.cm) if (module.url) moduleUrl(module);
    states.push(state);
  }
  const { months } = calendarMonths(courses);
  const events = new Map<number, ApiCalendarEvent>();
  let fromTimestamp: number | undefined;
  let nextTimestamp: number | undefined;
  for (const [index, month] of months.entries()) {
    progress(`API: calendário ${index + 1}/${months.length}`);
    const data = await reader.month(month.year, month.month);
    if (
      data.date.year !== month.year ||
      data.date.mon !== month.month ||
      data.nextperiod.timestamp <= data.date.timestamp ||
      (nextTimestamp !== undefined && data.date.timestamp !== nextTimestamp)
    )
      throw new PortalApiError('INVALID_RESPONSE');
    fromTimestamp ??= data.date.timestamp;
    nextTimestamp = data.nextperiod.timestamp;
    for (const week of data.weeks)
      for (const day of week.days)
        for (const event of day.events) {
          if (event.timestart + event.timeduration > 253402300799)
            throw new PortalApiError('INVALID_RESPONSE');
          const previous = events.get(event.id);
          if (previous && JSON.stringify(previous) !== JSON.stringify(event))
            throw new PortalApiError('INVALID_RESPONSE');
          events.set(event.id, event);
        }
  }
  if (fromTimestamp === undefined || nextTimestamp === undefined)
    throw new PortalApiError('INVALID_RESPONSE');
  const coverage = {
    from: new Date(fromTimestamp * 1000).toISOString(),
    to: new Date(nextTimestamp * 1000 - 1).toISOString(),
  };
  return {
    courses,
    inProgressIds: active.map((c) => c.id),
    states,
    events: [...events.values()],
    coverage,
    checkedAt: new Date().toISOString(),
    scope: { courseExternalId: courseExternalId || null },
  } satisfies PortalSnapshot;
}
export async function syncPortal(
  store: Store,
  courseExternalId?: string,
  progress?: (message: string) => void,
  connect: () => Promise<PortalReader> = () => PortalHttpClient.login(config),
) {
  const reader = await connect();
  try {
    const snapshot = await collectPortal(reader, courseExternalId, progress);
    return new PortalStore(store).save(snapshot);
  } finally {
    await reader.close();
  }
}
export async function discoverPortalCourses(store: Store) {
  // Use the same structured integration for the learning module's discovery action.
  return syncPortal(store);
}

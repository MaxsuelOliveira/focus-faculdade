import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { APIRequestContext, APIResponse } from 'playwright';
import { z } from 'zod';
import { PortalApiError, PortalHttpClient, type PortalReader } from '../server/portal/client.js';
import {
  portalOrigin,
  jacadOrigin,
  coursesSchema,
  type ApiCourse,
  type ApiCalendarEvent,
} from '../server/portal/contracts.js';
import { syncPortal } from '../server/portal/sync.js';
import { PortalStore } from '../server/portal/store.js';
import { PortalRunner } from '../server/automation/runner.js';
import { Store } from '../server/db.js';
import { createApp } from '../server/app.js';

const course: ApiCourse = {
  id: 123,
  fullname: 'Disciplina (título não define situação)',
  startdate: 1790812800,
  enddate: 1793491200,
  viewurl: `${portalOrigin}/course/view.php?id=123`,
  visible: true,
  hidden: false,
};
const event: ApiCalendarEvent = {
  id: 200,
  name: 'Fechamento publicado',
  description: '',
  eventtype: 'close',
  modulename: 'quiz',
  timestart: 1793501940,
  timeduration: 0,
  course: { id: 123 },
  url: `${portalOrigin}/mod/quiz/view.php?id=456`,
};
function reader(): PortalReader {
  return {
    courses: async () => [course],
    state: async () => ({
      course: { id: 123 },
      section: [{ id: 7, cmlist: [456] }],
      cm: [
        {
          id: 456,
          name: 'Prova',
          module: 'quiz',
          url: event.url,
          uservisible: true,
          visible: true,
          completionstate: 1,
        },
      ],
    }),
    month: async (year, month) => monthData(year, month, [event]),
    close: async () => {},
  };
}
function monthData(year: number, month: number, events: ApiCalendarEvent[] = []) {
  return {
    date: { year, mon: month, timestamp: Date.UTC(year, month - 1, 1) / 1000 + 10800 },
    nextperiod: { timestamp: Date.UTC(year, month, 1) / 1000 + 10800 },
    weeks: [{ days: [{ events }] }],
  };
}
type Call = {
  url: string;
  method?: string;
  form?: Record<string, string>;
  data?: { methodname: string; args: Record<string, unknown> }[];
};
function mockHttp(
  ajax: (call: Call) => unknown,
  opts: { redirectOutside?: boolean; mfa?: boolean } = {},
) {
  const calls: Call[] = [];
  let closed = false;
  const respond = (url: string, status: number, body: unknown, headers = {}) =>
    ({
      url: () => url,
      status: () => status,
      headers: () => headers,
      text: async () => String(body),
      json: async () => body,
    }) as unknown as APIResponse;
  const context = {
    fetch: async (url: string, options: Omit<Call, 'url'> = {}) => {
      const call = { url, ...options };
      calls.push(call);
      const u = new URL(url);
      if (u.origin === jacadOrigin && u.pathname === '/aluno-v2/login')
        return respond(url, 200, '<form action="/aluno-v2/login/do/;jsessionid=FAKE123"></form>');
      if (u.origin === jacadOrigin && u.pathname.startsWith('/aluno-v2/login/do/'))
        return respond(url, 302, '', { location: '/aluno-v2' });
      if (u.origin === jacadOrigin && u.pathname === '/aluno-v2')
        return respond(
          url,
          200,
          opts.mfa ? '<input name="login.password">' : '<main>Authenticated</main>',
        );
      if (u.origin === jacadOrigin && u.pathname === '/aluno-v2/moodle/auth/do')
        return respond(url, 302, '', {
          location: opts.redirectOutside
            ? 'https://untrusted.invalid/steal'
            : `${portalOrigin}/my/`,
        });
      if (u.origin === portalOrigin && u.pathname === '/my/')
        return respond(
          url,
          200,
          `M.cfg = ${JSON.stringify({ wwwroot: portalOrigin, sesskey: 'PRIVATE_SESSION_EXAMPLE' })};`,
        );
      if (u.origin === portalOrigin && u.pathname === '/lib/ajax/service.php')
        return respond(url, 200, ajax(call));
      throw new Error('Unexpected request (fixture)');
    },
    dispose: async () => {
      closed = true;
    },
  } as unknown as APIRequestContext;
  return { context, calls, closed: () => closed };
}

test('autenticação HTTP e chamadas JSON não usam navegador nem aceitam métodos de escrita', async () => {
  const http = mockHttp(() => [{ error: false, data: { courses: [course], nextoffset: 1 } }]);
  const client = await PortalHttpClient.login(
    { username: 'synthetic-user', password: 'synthetic-password' },
    async () => http.context,
  );
  try {
    assert.equal((await client.courses('all'))[0].id, 123);
    assert.equal(
      http.calls.find((c) => c.form?.['login.login'])?.form?.['login.password'],
      'synthetic-password',
    );
    const before = http.calls.length;
    await assert.rejects(
      client.read('mod_quiz_start_attempt' as Parameters<typeof client.read>[0], {}, z.unknown()),
      (error) => error instanceof PortalApiError && error.code === 'READ_ONLY',
    );
    assert.equal(http.calls.length, before);
  } finally {
    await client.close();
  }
  assert.equal(http.closed(), true);
});

test('redirecionamento externo, MFA e erro de API falham sem revelar credenciais ou corpo remoto', async () => {
  for (const opts of [{ redirectOutside: true }, { mfa: true }]) {
    const http = mockHttp(() => [], opts);
    await assert.rejects(
      PortalHttpClient.login(
        { username: 'synthetic-user', password: 'synthetic-password' },
        async () => http.context,
      ),
      (error) => error instanceof PortalApiError && !error.message.includes('synthetic-password'),
    );
    assert.equal(http.closed(), true);
    assert.ok(!http.calls.some((c) => new URL(c.url).hostname === 'untrusted.invalid'));
  }
  const http = mockHttp(() => [
    {
      error: true,
      exception: { errorcode: 'invalidsesskey', message: 'PRIVATE_BODY_DO_NOT_ECHO' },
    },
  ]);
  const client = await PortalHttpClient.login(
    { username: 'synthetic-user', password: 'synthetic-password' },
    async () => http.context,
  );
  try {
    await assert.rejects(
      client.courses('all'),
      (error) =>
        error instanceof PortalApiError &&
        error.code === 'AUTH_REQUIRED' &&
        !JSON.stringify(error).includes('PRIVATE_BODY_DO_NOT_ECHO'),
    );
  } finally {
    await client.close();
  }
});

test('paginação consulta todas as páginas e rejeita repetição ou contrato sem campos obrigatórios', async () => {
  const http = mockHttp((call) => {
    const offset = Number(call.data?.[0].args.offset);
    return [
      {
        error: false,
        data: {
          courses:
            offset === 0
              ? Array.from({ length: 100 }, (_, i) => ({
                  ...course,
                  id: i + 1,
                  viewurl: `${portalOrigin}/course/view.php?id=${i + 1}`,
                }))
              : [course],
          nextoffset: offset + 100,
        },
      },
    ];
  });
  const client = await PortalHttpClient.login(
    { username: 'u', password: 'p' },
    async () => http.context,
  );
  try {
    assert.equal((await client.courses('all')).length, 101);
  } finally {
    await client.close();
  }
  const bad = mockHttp(() => [{ error: false, data: { courses: [{ id: 1 }], nextoffset: 1 } }]);
  const invalid = await PortalHttpClient.login(
    { username: 'u', password: 'p' },
    async () => bad.context,
  );
  try {
    await assert.rejects(
      invalid.read(
        'core_course_get_enrolled_courses_by_timeline_classification',
        {},
        coursesSchema,
      ),
      (error) => error instanceof PortalApiError && error.code === 'INVALID_RESPONSE',
    );
  } finally {
    await invalid.close();
  }
  for (const duplicate of [true, false]) {
    const badPage = mockHttp(() => [
      {
        error: false,
        data: {
          courses: duplicate
            ? [course, course]
            : Array.from({ length: 100 }, (_, i) => ({
                ...course,
                id: i + 1,
                viewurl: `${portalOrigin}/course/view.php?id=${i + 1}`,
              })),
          nextoffset: 0,
        },
      },
    ]);
    const badClient = await PortalHttpClient.login(
      { username: 'u', password: 'p' },
      async () => badPage.context,
    );
    try {
      await assert.rejects(
        badClient.courses('all'),
        (error) => error instanceof PortalApiError && error.code === 'INVALID_RESPONSE',
      );
    } finally {
      await badClient.close();
    }
  }
});

test('fila sincroniza pela API, mantém respostas e prazo manual, e expõe calendário e origem separados', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-portal-'));
  const store = new Store(directory);
  const fake = reader();
  let closed = 0;
  fake.close = async () => {
    closed++;
  };
  const courseId = store.course({
    external_id: '123',
    name: 'Nome anterior',
    url: course.viewurl,
  }).id;
  const original = store.upsertAssessment({
    external_id: '456',
    course_id: courseId,
    title: 'Prova',
    url: event.url,
    attempt_id: 'existing-attempt',
    duration_minutes: 60,
  });
  store.replaceQuestions(
    original.id,
    [
      {
        external_id: 'q',
        prompt: 'Questão já revisada',
        position: 1,
        type: 'text',
        choices: [],
        images: [],
      },
    ],
    'existing-attempt',
  );
  store.saveAnswer(
    store.questions(original.id)[0].id,
    { text: 'Resposta preservada', choices: [] },
    true,
  );
  store.setSetting(`due:${courseId}:456`, '2026-11-30T23:59:00-03:00');
  const runner = new PortalRunner(store, (s, target, progress) =>
    syncPortal(s, target, progress, async () => fake),
  );
  runner.session.ava = async () => {
    throw new Error('O navegador não pode ser aberto para sincronizar');
  };
  const job = store.enqueue('sync', null);
  try {
    await runner.execute(store.job(job));
    assert.equal(store.job(job).status, 'completed');
    assert.equal(closed, 1);
    const repo = new PortalStore(store);
    assert.ok(
      repo.status().coverage!.from.endsWith('03:00:00.000Z'),
      'cobertura usa a meia-noite fornecida pela API, não uma meia-noite UTC deduzida',
    );
    const facts = repo.assessmentFacts(store.assessment(original.id))!;
    assert.equal(facts.closesAt, new Date(event.timestart * 1000).toISOString());
    assert.equal(facts.effectiveDeadlineIsManual, true);
    assert.equal(facts.attemptState, null, 'completion=1 não significa prova enviada');
    assert.equal(store.assessment(original.id).due_at, '2026-11-30T23:59:00-03:00');
    assert.equal(store.questions(original.id)[0].answer.text, 'Resposta preservada');
    assert.ok(store.questions(original.id)[0].approved_hash);
    assert.equal(
      repo.allEvents().length,
      1,
      'eventos repetidos em várias páginas são deduplicados',
    );
    const app = await createApp(store);
    try {
      const headers = { host: '127.0.0.1:4317' };
      const response = await app.inject({
        method: 'GET',
        url: '/api/portal/calendar?from=2026-10-01T00:00:00-03:00&to=2026-11-01T00:00:00-03:00',
        headers,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().events[0].source, 'moodle_api');
      assert.equal(response.json().coverageComplete, true);
      const detail = await app.inject({
        method: 'GET',
        url: `/api/portal/assessments/${original.id}`,
        headers,
      });
      assert.equal(detail.json().assessment.duration_minutes, null);
      assert.equal(detail.json().assessment.attempt_id, null);
      assert.equal(
        store.assessment(original.id).duration_minutes,
        60,
        'observação antiga é preservada localmente, sem ser apresentada como nova resposta da API',
      );
      const spec = await app.inject({ method: 'GET', url: '/api/portal/openapi', headers });
      assert.equal(spec.json().openapi, '3.1.0');
      assert.ok(spec.json().paths['/api/portal/calendar']);
      const forbidden = await app.inject({
        method: 'GET',
        url: '/api/portal/status',
        headers: { host: 'external.invalid' },
      });
      assert.equal(forbidden.statusCode, 403);
      assert.ok(
        !(await app.inject({ method: 'GET', url: '/api/portal/export', headers })).body.includes(
          'sesskey',
        ),
      );
    } finally {
      await app.close();
    }
    fake.month = async () => {
      throw new PortalApiError('API_UNAVAILABLE');
    };
    const before = repo.status().lastSync;
    await assert.rejects(syncPortal(store, undefined, undefined, async () => fake));
    assert.equal(closed, 2);
    assert.equal(repo.status().lastSync, before, 'falha parcial não marca sincronização concluída');
    assert.equal(repo.allEvents().length, 1, 'falha parcial não apaga o calendário anterior');
    fake.month = async (year, month) => monthData(year, month);
    await syncPortal(store, undefined, undefined, async () => fake);
    assert.equal(repo.allEvents().length, 0, 'remoção na fonte é refletida após leitura completa');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

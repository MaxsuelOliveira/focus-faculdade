import { request, type APIRequestContext, type APIResponse } from 'playwright';
import { z } from 'zod';
import { NeedsAction } from '../automation/session.js';
import {
  jacadOrigin,
  portalOrigin,
  coursesSchema,
  stateSchema,
  monthSchema,
  type ApiCourse,
} from './contracts.js';

export class PortalApiError extends NeedsAction {
  constructor(
    public code:
      'AUTH_REQUIRED' | 'API_UNAVAILABLE' | 'INVALID_RESPONSE' | 'HTTP_ERROR' | 'READ_ONLY',
    message?: string,
  ) {
    super(
      message ||
        {
          AUTH_REQUIRED:
            'A API exige autenticação válida. Confira as credenciais locais ou a exigência de MFA/CAPTCHA; a sincronização não abre navegador.',
          API_UNAVAILABLE:
            'A API estruturada necessária não está disponível para esta conta. Não há fallback visual.',
          INVALID_RESPONSE:
            'A API retornou um contrato diferente do esperado. A sincronização foi interrompida sem deduzir valores.',
          HTTP_ERROR:
            'A API do portal não respondeu corretamente. Tente novamente depois; dados privados não são registrados.',
          READ_ONLY: 'A API de sincronização permite somente consultas acadêmicas.',
        }[code],
    );
  }
}
const readMethods = [
  'core_course_get_enrolled_courses_by_timeline_classification',
  'core_courseformat_get_state',
  'core_calendar_get_calendar_monthly_view',
] as const;
type ReadMethod = (typeof readMethods)[number];
const envelope = z
  .array(
    z.object({
      error: z.boolean(),
      data: z.unknown().optional(),
      exception: z.object({ errorcode: z.string().optional() }).optional(),
    }),
  )
  .length(1);
export interface PortalReader {
  courses(classification: 'all' | 'inprogress'): Promise<ApiCourse[]>;
  state(courseId: number): Promise<z.infer<typeof stateSchema>>;
  month(year: number, month: number): Promise<z.infer<typeof monthSchema>>;
  close(): Promise<void>;
}

// APIRequestContext is an HTTP client with an in-memory cookie jar. No Chromium,
// page, locator, persistent profile or browser fallback is used by this adapter.
export class PortalHttpClient implements PortalReader {
  private sesskey = '';
  constructor(private http: APIRequestContext) {}
  static async login(
    credentials: { username: string; password: string },
    createContext = () => request.newContext({ timeout: 30_000, ignoreHTTPSErrors: false }),
  ) {
    if (!credentials.username || !credentials.password) throw new PortalApiError('AUTH_REQUIRED');
    const client = new PortalHttpClient(await createContext());
    try {
      await client.authenticate(credentials);
      return client;
    } catch (error) {
      await client.close();
      throw error instanceof PortalApiError ? error : new PortalApiError('HTTP_ERROR');
    }
  }
  private async fetch(
    url: string,
    options: { method?: 'GET' | 'POST'; form?: Record<string, string>; data?: unknown } = {},
  ) {
    const u = new URL(url);
    if (![jacadOrigin, portalOrigin].includes(u.origin) || u.username || u.password)
      throw new PortalApiError('INVALID_RESPONSE');
    try {
      const response = await this.http.fetch(u.href, { ...options, maxRedirects: 0 });
      if (response.status() === 401 || response.status() === 403)
        throw new PortalApiError('AUTH_REQUIRED');
      if (response.status() === 429 || response.status() >= 400)
        throw new PortalApiError('HTTP_ERROR');
      return response;
    } catch (error) {
      throw error instanceof PortalApiError ? error : new PortalApiError('HTTP_ERROR');
    }
  }
  private async follow(response: APIResponse) {
    for (let hops = 0; [301, 302, 303].includes(response.status()); hops++) {
      if (hops >= 8 || !response.headers().location) throw new PortalApiError('INVALID_RESPONSE');
      response = await this.fetch(new URL(response.headers().location, response.url()).href);
    }
    if (response.status() !== 200) throw new PortalApiError('HTTP_ERROR');
    return response;
  }
  private async authenticate(credentials: { username: string; password: string }) {
    const login = await this.fetch(`${jacadOrigin}/aluno-v2/login`);
    const form = (await login.text()).match(/<form\b[^>]*action="([^"]+)"/s)?.[1];
    if (!form) throw new PortalApiError('AUTH_REQUIRED');
    const action = new URL(form, jacadOrigin);
    if (
      action.origin !== jacadOrigin ||
      !/^\/aluno-v2\/login\/do\/(?:;jsessionid=[a-zA-Z0-9]+)?$/.test(action.pathname)
    )
      throw new PortalApiError('INVALID_RESPONSE');
    const signedIn = await this.follow(
      await this.fetch(action.href, {
        method: 'POST',
        form: {
          'login.login': credentials.username,
          'login.password': credentials.password,
          'login.referenciaLogarComo': '',
        },
      }),
    );
    if (
      new URL(signedIn.url()).pathname.includes('/login') ||
      /name="login\.password"/.test(await signedIn.text())
    )
      throw new PortalApiError('AUTH_REQUIRED');
    // SSO is the same authentication POST used by the JACAD menu, without a UI.
    const ava = await this.follow(
      await this.fetch(`${jacadOrigin}/aluno-v2/moodle/auth/do`, { method: 'POST', form: {} }),
    );
    if (new URL(ava.url()).origin !== portalOrigin) throw new PortalApiError('AUTH_REQUIRED');
    const bootstrap = (await ava.text()).match(/M\.cfg\s*=\s*(\{[^;]+\});/)?.[1];
    try {
      const cfg = z
        .object({ wwwroot: z.literal(portalOrigin), sesskey: z.string().min(5).max(200) })
        .parse(JSON.parse(bootstrap || 'null'));
      this.sesskey = cfg.sesskey;
    } catch {
      throw new PortalApiError('AUTH_REQUIRED');
    }
  }
  async read<T>(
    method: ReadMethod,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    if (!readMethods.includes(method)) throw new PortalApiError('READ_ONLY');
    if (!this.sesskey) throw new PortalApiError('AUTH_REQUIRED');
    const url = new URL('/lib/ajax/service.php', portalOrigin);
    url.searchParams.set('sesskey', this.sesskey);
    const r = await this.fetch(url.href, {
      method: 'POST',
      data: [{ index: 0, methodname: method, args }],
    });
    let parsed: z.infer<typeof envelope>;
    try {
      parsed = envelope.parse(await r.json());
    } catch {
      throw new PortalApiError('INVALID_RESPONSE');
    }
    if (parsed[0].error) {
      const code = parsed[0].exception?.errorcode;
      throw new PortalApiError(
        code && ['invalidsesskey', 'requireloginerror', 'servicerequireslogin'].includes(code)
          ? 'AUTH_REQUIRED'
          : 'API_UNAVAILABLE',
      );
    }
    try {
      return schema.parse(
        typeof parsed[0].data === 'string' ? JSON.parse(parsed[0].data) : parsed[0].data,
      );
    } catch {
      throw new PortalApiError('INVALID_RESPONSE');
    }
  }
  async courses(classification: 'all' | 'inprogress') {
    const result: ApiCourse[] = [];
    let offset = 0;
    const seen = new Set<number>();
    for (let page = 0; page < 200; page++) {
      const data = await this.read(
        readMethods[0],
        { classification, limit: 100, offset, sort: 'fullname' },
        coursesSchema,
      );
      for (const course of data.courses) {
        if (seen.has(course.id)) throw new PortalApiError('INVALID_RESPONSE');
        const u = new URL(course.viewurl);
        if (
          u.origin !== portalOrigin ||
          u.pathname !== '/course/view.php' ||
          u.searchParams.get('id') !== String(course.id) ||
          u.username ||
          u.password
        )
          throw new PortalApiError('INVALID_RESPONSE');
        seen.add(course.id);
        result.push(course);
      }
      if (data.courses.length < 100) return result;
      if (data.nextoffset <= offset) throw new PortalApiError('INVALID_RESPONSE');
      offset = data.nextoffset;
    }
    throw new PortalApiError('INVALID_RESPONSE');
  }
  async state(courseId: number) {
    const state = await this.read(readMethods[1], { courseid: courseId }, stateSchema);
    if (state.course.id !== courseId) throw new PortalApiError('INVALID_RESPONSE');
    return state;
  }
  month(year: number, month: number) {
    return this.read(
      readMethods[2],
      {
        year,
        month,
        courseid: 0,
        categoryid: 0,
        includenavigation: false,
        mini: false,
        day: 1,
        view: 'month',
      },
      monthSchema,
    );
  }
  async close() {
    this.sesskey = '';
    await this.http.dispose();
  }
}

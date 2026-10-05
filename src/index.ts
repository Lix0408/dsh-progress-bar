/**
 * Node half of dsh-progress-bar.
 *
 * Serves two diary routes for the header orb's menu and injects one prompt.
 * The plugin only *triggers* a diary entry — the format contract (four-part
 * file, the mandatory 今日结论 section) lives in the host's AGENTS.md, so it is
 * never duplicated here.
 * @module dsh-progress-bar
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Plugin configuration; every field is optional and defaulted below. */
export interface Config {
  /** Directory holding `YYYY-MM-DD.txt` diary files. */
  dir?: string
  /** Instruction injected when the menu asks for today's diary. */
  diaryPrompt?: string
}

/** Same default as dsh-diary: the diary directory is global, not per-workspace. */
const DEFAULT_DIR = join(homedir(), '.dsh', 'diary')

/**
 * The trigger only. Format details stay in AGENTS.md — copying them here would
 * give the convention two homes that drift apart.
 */
const DEFAULT_PROMPT =
  '写今天的日记。回顾本次会话做了什么，用第一人称写成 ~/.dsh/diary/<今天日期>.txt，'
  + '格式和「今日结论」小节按 AGENTS.md 的约定来。'

/** Diary file names: one file per local date. */
const DIARY_FILE = /^\d{4}-\d{2}-\d{2}\.txt$/

/** Route prefix, parallel to the whale widget's `/dsh-whale`. */
const PREFIX = '/dsh-progress'

/** Largest accepted JSON body for the write route. */
const MAX_BODY_BYTES = 8 * 1024

/*
 * The two host services are declared structurally: this plugin's installed type
 * closure does not contain the webserver / session-controller packages, so the
 * shapes below mirror what the running host already exposes and what
 * dsh-whale-widget consumes on this machine.
 */

interface HttpRequest {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'end' | 'error', listener: () => void): unknown
  destroy(): void
}

interface HttpResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string | Uint8Array): unknown
}

interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: HttpRequest, res: HttpResponse) => unknown
}

interface WebServerService {
  register(route: WebServerRoute): () => void
}

interface PromptRequest {
  sessionId: string
  requestId: string
  mode: 'queue'
  content: Array<{ type: 'text'; text: string }>
}

interface SessionControllerService {
  prompt(request: PromptRequest, signal: AbortSignal): Promise<unknown>
  /**
   * Optional: only hosts that mount the desktop bridge have it, hence the
   * runtime `typeof` check before every call.
   */
  openWorkspacePath?(request: OpenPathRequest, signal: AbortSignal): Promise<{ opened: boolean }>
}

interface OpenPathRequest {
  /** Absolute path. Verified for absoluteness, not confined to the workspace. */
  path: string
  /** `reveal` selects the file in the file manager; omitted opens the file. */
  action?: 'reveal'
}

function sendJson(res: HttpResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

/** Read a small JSON body; resolves to `{}` when absent, oversized or unparsable. */
function readJsonBody(req: HttpRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    const finish = (value: Record<string, unknown>) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        finish({})
        return
      }
      chunks.push(chunk)
    })
    req.on('error', () => finish({}))
    req.on('end', () => {
      if (chunks.length === 0) {
        finish({})
        return
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        finish(typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {})
      } catch {
        finish({})
      }
    })
  })
}

/** Newest diary on disk, or `{ ok: true, date: null }` when there is none. */
async function readLatest(dir: string): Promise<Record<string, unknown>> {
  // Resolved once, here: the client renders these paths and posts them back, and
  // it cannot derive them itself (config.dir is overridable, and `~` would not
  // survive the round trip).
  const root = resolve(dir)
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    // A missing directory means "nothing written yet", not a failure.
    return { ok: true, date: null }
  }
  const dates = names.filter((name) => DIARY_FILE.test(name)).map((name) => name.slice(0, -4)).sort()
  const latest = dates.at(-1)
  if (latest === undefined) return { ok: true, date: null }
  const file = join(root, `${latest}.txt`)
  try {
    const [bytes, stats] = await Promise.all([readFile(file), stat(file)])
    const text = bytes.toString('utf8')
    return {
      ok: true,
      date: latest,
      path: file,
      dir: root,
      bytes: bytes.length,
      chars: [...text].length,
      lines: text === '' ? 0 : text.split(/\r?\n/).length,
      // Real modification time: the menu's "written · 2 h ago" subtitle must
      // come from a timestamp that exists, never from a guess.
      mtime: stats.mtimeMs,
      text,
    }
  } catch (error) {
    return { ok: false, error: `cannot read ${latest}.txt: ${String((error as Error).message)}` }
  }
}

/**
 * Install the diary routes.
 *
 * Both services are resolved inside the scoped inject callback, so a host that
 * does not mount them simply gets no routes instead of a boot failure.
 * @param ctx - host root context.
 * @param config - optional diary directory and prompt overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const dir = config.dir ?? DEFAULT_DIR
  const diaryPrompt = config.diaryPrompt ?? DEFAULT_PROMPT
  const disposers: Array<() => void> = []

  ctx.effect(
    () => () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // Route teardown must not break plugin disposal.
        }
      }
    },
    'dsh-progress-bar: diary routes',
  )

  ctx.inject(['webServer', 'sessionController'], (scoped) => {
    const server = (scoped as unknown as { webServer?: WebServerService }).webServer
    const sessions = (scoped as unknown as { sessionController?: SessionControllerService }).sessionController
    if (server === undefined || sessions === undefined) return

    // 1. Read: the newest diary on disk. Plain file I/O — no model call, no
    //    prompt injection, nothing that can touch the transcript.
    //    The handler is async and RETURNS its promise: the webserver awaits
    //    `route.handler(req, res)` so its outer catch can log and answer 400.
    //    Fire-and-forget would make that catch unreachable and leave the
    //    response hanging on any throw.
    disposers.push(server.register({
      kind: 'exact',
      path: `${PREFIX}/diary/latest`,
      handler: async (_req, res) => {
        try {
          sendJson(res, 200, await readLatest(dir))
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error as Error).message) })
        }
      },
    }))

    // 2. Write: queue one instruction. The controller warms a cold session on
    //    its own, so liveness is never checked here.
    disposers.push(server.register({
      kind: 'exact',
      path: `${PREFIX}/diary/write`,
      handler: async (req, res) => {
        const body = await readJsonBody(req)
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const requestId = typeof body.requestId === 'string' ? body.requestId : ''
        if (sessionId === '' || requestId === '') {
          sendJson(res, 400, { ok: false, error: 'sessionId and requestId are required' })
          return
        }
        try {
          await sessions.prompt(
            {
              sessionId,
              requestId,
              mode: 'queue',
              content: [{ type: 'text', text: diaryPrompt }],
            },
            AbortSignal.timeout(30_000),
          )
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error as Error).message) })
        }
      },
    }))

    // 3. Open: hand an absolute path to the desktop bridge. This plugin neither
    //    spawns a process nor shells out — the host owns the OS integration, and
    //    `reveal` (locate in the file manager) is the same call with one flag.
    //    Body parsing lives here rather than in progress.ts: that module is pure
    //    and takes no part in transport concerns.
    disposers.push(server.register({
      kind: 'exact',
      path: `${PREFIX}/diary/open`,
      handler: async (req, res) => {
        const body = await readJsonBody(req)
        const target = typeof body.path === 'string' ? body.path : ''
        if (target === '') {
          sendJson(res, 400, { ok: false, error: 'path is required' })
          return
        }
        // Missing capability is a *supported answer*, not an error: the client
        // degrades to copying the path instead of pretending nothing happened.
        if (typeof sessions.openWorkspacePath !== 'function') {
          sendJson(res, 200, { ok: false, error: 'unsupported' })
          return
        }
        try {
          await sessions.openWorkspacePath(
            { path: target, ...(body.reveal === true ? { action: 'reveal' as const } : {}) },
            AbortSignal.timeout(10_000),
          )
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 200, { ok: false, error: String((error as Error).message) })
        }
      },
    }))
  })
}

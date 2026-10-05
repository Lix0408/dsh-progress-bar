import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { ProgressBadge } from './ProgressBadge.tsx'
import type { ProgressInjected } from './ProgressBadge.tsx'
import { en, NS, zh, type ProgressKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    progress: ProgressKey
  }
}

/**
 * Required services: the jobs roster, the slot registry, the dictionaries, and
 * the workspace picker (which owns the `uiWorkspace.selection` store of the
 * session the frame is currently showing).
 *
 * These are client *service* names, not package names — the package list lives
 * in `dsh.client.inject`. Note that
 * `@deepseek-ai/dsh-client-ui-workspace` provides the service named
 * `uiWorkspace`; its own package description ("Workspace picker plugin") is
 * about the UI it ships, not the service name.
 */
export const inject = ['jobs', 'slots', 'locale', 'uiWorkspace']

/**
 * The workspace picker's current-selection store.
 *
 * `selection` is a public class field on `UiWorkspaceService` at runtime, but
 * the shipped `UiWorkspace` interface keeps it `private`, so it is read through
 * this local structural view instead of widening the host's declaration. The
 * shape is checked against the runtime store: a bare snapshot source, exactly
 * like `ctx.jobs.state`.
 */
interface SelectionSource {
  getSnapshot(): { readonly sessionId?: SessionId; readonly subagentAddress?: unknown }
  subscribe(listener: () => void): () => void
}

/** Read the picker's selection store off the `uiWorkspace` service. */
function selectionSource(service: unknown): SelectionSource {
  return (service as { selection: SelectionSource }).selection
}

/**
 * Client plugin body: register the dictionaries and the frame-wide orb.
 *
 * The orb used to live in `conversation.session.header.actions`, but the host
 * gates that whole title cluster behind `!hideChrome`, so on a blank session
 * the element never reached the DOM. `shell.overlay` is the host's own
 * frame-wide seat — always rendered, above every column, outside their scroll
 * containers — and it is generic on purpose. Its container is `inset: 0` with
 * `pointer-events: none`, so the component positions and collapses itself.
 *
 * A root-scoped slot is handed no session prop, hence the extra
 * `selection` hook: the component resolves the session from the workspace
 * picker instead. `hooks` values must be bare observable sources, exactly like
 * `ctx.jobs.state`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-progress-bar: dictionaries')
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      id: 'progress-orb',
      order: 50,
      locale: NS,
      inject: (): ProgressInjected => ({
        hooks: { jobs: ctx.jobs.state, selection: selectionSource(ctx.uiWorkspace) },
        watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
      }),
    }, ProgressBadge),
  )
}

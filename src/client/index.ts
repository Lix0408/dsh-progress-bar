import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ProgressBadge } from './ProgressBadge.tsx'
import type { ProgressInjected } from './ProgressBadge.tsx'
import { en, NS, zh, type ProgressKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    progress: ProgressKey
  }
}

/**
 * Required services: the jobs roster, the slot registry, and the dictionaries.
 * These are client *service* names, not package names — the package list lives
 * in `dsh.client.inject`.
 */
export const inject = ['jobs', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 *
 * Everything service-shaped stays in this closure; the component receives only
 * the observable jobs source and the roster follower.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-progress-bar: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'progress',
      order: 30,
      locale: NS,
      inject: (): ProgressInjected => ({
        hooks: { jobs: ctx.jobs.state },
        watchRows: (sessionId) => ctx.jobs.watchRows(sessionId),
      }),
    }, ProgressBadge),
  )
}

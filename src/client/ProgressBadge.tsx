import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  IconChevronDownOutlineRegular,
  StateDot,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the package that owns the branded Session identity. Erased at build.
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './ProgressBadge.module.css'
import type { ProgressKey } from './locales.ts'
import {
  countTodos,
  elapsedMs,
  formatBytes,
  isLive,
  jobDetail,
  orderJobs,
  percentOf,
  splitDuration,
  type JobStatus,
  type JobView,
  type TodoItem,
} from './progress.ts'

/** Snapshot shape the jobs roster hook reads. */
export interface JobsSnapshotLike {
  readonly rows: Readonly<Record<string, readonly JobView[]>>
}

/**
 * What this plugin projects into the slot. Services stay in the `apply`
 * closure: the component only ever sees observable sources and callbacks.
 */
export interface ProgressInjected {
  hooks: {
    /** The renderer binds this bare source to a `useJobs(selector)` prop. */
    jobs: {
      getSnapshot(): JobsSnapshotLike
      subscribe(listener: () => void): () => void
    }
  }
  /** Keeps this session's roster stream open while the control is mounted. */
  watchRows: (sessionId: SessionId) => () => void
}

export type ProgressBadgeProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'progress'>
  & InjectFace<ProgressInjected>

/** Stable empty roster so a session with no jobs keeps one array identity. */
const NO_JOBS: readonly JobView[] = []

/** Stable empty to-do list, for the same reason. */
const NO_TODOS: readonly TodoItem[] = []

const TODO_DOT: Record<TodoItem['status'], 'done' | 'ongoing' | 'idle'> = {
  completed: 'done',
  in_progress: 'ongoing',
  pending: 'idle',
}

const JOB_DOT: Record<JobStatus, 'ongoing' | 'warning' | 'done' | 'error'> = {
  running: 'ongoing',
  stopping: 'warning',
  completed: 'done',
  killed: 'warning',
  failed: 'error',
}

/**
 * Everything the wave geometry needs. `ds`/`pad` are read back from the computed
 * `--ds`/`--pad` of whichever size class is applied, so the stylesheet stays the
 * single source of truth for the size tiers.
 */
interface TrackMetrics {
  width: number
  ds: number
  pad: number
}

/** Fallback before the first measurement; mirrors the `.track` defaults in the CSS. */
const DEFAULT_METRICS: TrackMetrics = { width: 0, ds: 24, pad: 7 }

/**
 * Water-head and avatar positions, ported from the prototype's `geometry()`.
 *
 * The water head leads the ds centre by `c0 · p` (`c0 = pad + ds/2`), so the
 * avatar starts half-submerged and sinks deeper as p grows — fully under water
 * past p = 0.64 at the header tier. At 0% the water is one `c0`-wide pool and
 * the avatar's left edge sits `pad` from the track's left end; at 100% the water
 * fills the track and the avatar's right edge sits `pad` from the right end, so
 * neither endpoint ever clips the avatar.
 * @param metrics - measured track width plus the active tier's `ds` and `pad`.
 * @param p - progress in 0..1.
 * @returns fill width and avatar translate x, in px.
 */
function geometry({ width, ds, pad }: TrackMetrics, p: number): { fillW: number; x: number } {
  const c0 = pad + ds / 2
  const c1 = Math.max(c0, width - pad - ds / 2)
  const center = c0 + (c1 - c0) * p
  const fillW = c0 + (Math.max(c0, width) - c0) * p
  return { fillW, x: center - ds / 2 }
}

/**
 * Session-header progress control.
 *
 * The percentage has exactly one source: the session's `todos` projection, so
 * it means "share of the declared plan that is done". Background jobs are a
 * separate, independent list — job progress lines are strings and are shown as
 * text, never folded into the percentage. When there is nothing in flight and
 * nothing to measure, the component renders no node at all.
 * @param props - slot runtime props, the locale translator, and the jobs roster.
 * @returns the trigger and its panel, or null when there is nothing to show.
 */
export function ProgressBadge({
  sessionId,
  useProjection,
  useSession,
  useSessionStatus,
  useJobs,
  watchRows,
  t,
}: ProgressBadgeProps) {
  const todos: readonly TodoItem[] = useProjection('todos') ?? NO_TODOS
  const running = useSession((snapshot) => snapshot.running) === true
  const waiting = useSessionStatus(
    (snapshot) => snapshot.get(sessionId)?.pendingInteraction !== undefined,
  )
  const jobs = useJobs((snapshot) => snapshot.rows[sessionId]) ?? NO_JOBS

  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement>(null)
  const [panelShift, setPanelShift] = useState(0)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [metrics, setMetrics] = useState<TrackMetrics>(DEFAULT_METRICS)

  useDismissOnOutsidePointer(rootRef, open, setOpen)
  useEffect(() => watchRows(sessionId), [sessionId, watchRows])

  const counts = useMemo(() => countTodos(todos), [todos])
  const percent = percentOf(counts)
  const ordered = useMemo(() => orderJobs(jobs), [jobs])
  const liveRows = useMemo(() => ordered.filter(isLive), [ordered])
  const hasTodos = counts.total > 0
  const visible = hasTodos || running || liveRows.length > 0

  // The fill width and the avatar offset are px values derived from the track's
  // real width, so the track has to be measured. `--ds`/`--pad` are read back
  // from the computed style rather than kept in a second tier table. This runs
  // after `visible` because the track only exists once the badge renders.
  useEffect(() => {
    const element = trackRef.current
    if (element === null) return
    const measure = () => {
      const computed = getComputedStyle(element)
      const ds = Number.parseFloat(computed.getPropertyValue('--ds'))
      const pad = Number.parseFloat(computed.getPropertyValue('--pad'))
      const width = element.clientWidth
      setMetrics((previous) => (
        previous.width === width
        && previous.ds === ds
        && previous.pad === pad
          ? previous
          : {
              width,
              ds: Number.isFinite(ds) ? ds : DEFAULT_METRICS.ds,
              pad: Number.isFinite(pad) ? pad : DEFAULT_METRICS.pad,
            }
      ))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])

  const durationOf = (job: JobView): string => {
    const parts = splitDuration(elapsedMs(job.startedAt, job.finishedAt, now))
    if (parts.hours > 0) return t('duration.hours', { hours: parts.hours, minutes: parts.minutes })
    if (parts.minutes > 0) return t('duration.minutes', { minutes: parts.minutes, seconds: parts.seconds })
    return t('duration.seconds', { seconds: parts.seconds })
  }

  const jobStatusOf = (status: JobStatus): string => {
    switch (status) {
      case 'running': return t('job.running')
      case 'stopping': return t('job.stopping')
      case 'completed': return t('job.completed')
      case 'killed': return t('job.killed')
      case 'failed': return t('job.failed')
      default: return status
    }
  }

  // A live clock ticks only while the panel is open and something is running:
  // the only duration this plugin can prove is a job's own start timestamp.
  useEffect(() => {
    if (!open || liveRows.length === 0) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open, liveRows.length])

  // Nothing left to show: never leave an open panel pointing at nothing.
  useEffect(() => {
    if (open && !visible) setOpen(false)
  }, [open, visible])

  // The anchor sits near the header's left edge; keep the panel inside the viewport.
  useEffect(() => {
    if (!open) {
      setPanelShift(0)
      return
    }
    const fit = () => {
      const root = rootRef.current
      if (root === null) return
      const anchorLeft = root.getBoundingClientRect().left
      const width = Math.min(380, window.innerWidth - 32)
      setPanelShift(Math.max(12 - anchorLeft, Math.min(0, window.innerWidth - 12 - width - anchorLeft)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open])

  if (!visible) return null

  const leadJob = liveRows[0]
  const triggerText = percent !== undefined
    ? t('trigger.tasks', { done: counts.completed, total: counts.total, percent })
    : leadJob !== undefined
      ? t('trigger.jobsOnly', { duration: durationOf(leadJob) })
      : t('trigger.running')
  const triggerLabel = percent !== undefined
    ? t('trigger.aria.tasks', { done: counts.completed, total: counts.total })
    : t('trigger.aria.running')
  // Indeterminate (running, but no to-do list yet) is p = 0: the wave keeps
  // rolling and the avatar idles at the left end. Never a fabricated percentage.
  const { fillW, x } = geometry(metrics, (percent ?? 0) / 100)
  const trackStyle = { '--fillw': `${fillW}px`, '--x': `${x}px` } as CSSProperties
  const barClass = percent !== undefined ? css.barFill : `${css.barFill} ${css.barFillIndeterminate}`

  return (
    <div ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => {
          setNow(Date.now())
          setOpen((current) => !current)
        }}
      >
        <span
          ref={trackRef}
          className={css.track}
          style={trackStyle}
          aria-hidden="true"
        >
          <span className={css.fill}>
            <span className={css.water} />
            <span className={`${css.wave} ${css.waveFoam}`} />
            <span className={`${css.wave} ${css.waveFront}`} />
            <span className={css.surf} />
          </span>
          <span className={css.dsSlot}>
            <span className={css.dsBob}>
              <span className={css.dsSpin}>
                <span className={css.dsImg} />
              </span>
            </span>
          </span>
        </span>
        <span className={css.count}>{triggerText}</span>
        <IconChevronDownOutlineRegular size={12} className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
      </button>
      {open ? (
        <div className={css.panel} style={{ left: panelShift }} role="group" aria-label={t('panel.aria')}>
          <div className={css.header}>
            <div className={css.headerRow}>
              <span className={css.summary}>
                {percent === undefined ? t('trigger.running') : t('panel.summary', { done: counts.completed, total: counts.total })}
              </span>
              {percent === undefined ? null : <span className={css.percent}>{`${percent}%`}</span>}
            </div>
            <span className={css.bar} aria-hidden="true">
              <span className={barClass} style={percent === undefined ? undefined : { width: `${percent}%` }} />
            </span>
            {percent === undefined ? <span className={css.indeterminateNote}>{t('panel.indeterminate')}</span> : null}
          </div>
          {hasTodos ? (
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('section.todos')}</h3>
              <ul className={css.list}>
                {todos.map((item) => (
                  <li
                    key={item.content}
                    className={item.status === 'completed'
                      ? `${css.todoItem} ${css.todoDone}`
                      : item.status === 'in_progress'
                        ? `${css.todoItem} ${css.todoActive}`
                        : css.todoItem}
                  >
                    <StateDot state={TODO_DOT[item.status]} />
                    <span className={css.todoText}>{item.content}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {ordered.length > 0 ? (
            <section className={css.section}>
              <h3 className={css.sectionTitle}>{t('section.jobs')}</h3>
              <ul className={css.list}>
                {ordered.map((job) => {
                  const detail = jobDetail(job)
                  return (
                    <li key={job.id} className={css.jobItem}>
                      <span className={css.jobRow}>
                        <StateDot state={JOB_DOT[job.status]} />
                        <span className={css.jobLabel} title={job.label}>{job.label}</span>
                        <span className={css.jobKind}>{job.kind}</span>
                        <span className={css.jobStatus}>{`${jobStatusOf(job.status)} · ${durationOf(job)}`}</span>
                      </span>
                      {detail === undefined ? null : <span className={css.jobProgress}>{detail}</span>}
                      {job.output.total > 0
                        ? <span className={css.jobProgress}>{t('job.output', { size: formatBytes(job.output.total) })}</span>
                        : null}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}
          {waiting ? <span className={css.notice}>{t('notice.waiting')}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

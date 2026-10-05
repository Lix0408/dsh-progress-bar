import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
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
    /**
     * The workspace picker's current-session store. The frame-wide
     * `shell.overlay` seat is root-scoped, so the host hands the component no
     * `sessionId` prop; this is the source of identity instead. Bound to a
     * `useSelection(selector, equalityFn?)` prop.
     */
    selection: {
      getSnapshot(): SelectionSnapshotLike
      subscribe(listener: () => void): () => void
    }
  }
  /** Keeps this session's roster stream open while the control is mounted. */
  watchRows: (sessionId: SessionId) => () => void
}

/**
 * Snapshot shape read off `uiWorkspace.selection`. The store is driven by
 * `replaceMain` (`{ sessionId, ...(subagentAddress === undefined ? {} : { subagentAddress }) }`)
 * and `clearMain` (`{}`), so `sessionId` is genuinely absent only when no
 * Session is selected at all. A *blank* Session is still a real Session with a
 * real id — it simply has no to-dos and no jobs yet, which is what lands us on
 * the bare orb rather than on nothing.
 */
export interface SelectionSnapshotLike {
  readonly sessionId?: SessionId
  readonly subagentAddress?: unknown
}

/** One Session row as the component reads it: identity plus projection values. */
interface SessionRowLike {
  readonly running?: boolean
  readonly projectionValues?: { readonly todos?: readonly TodoItem[] | null }
}

/** Snapshot shape read by the `useSessions` hook. */
export interface SessionsSnapshotLike {
  readonly byId: Readonly<Record<string, SessionRowLike | undefined>>
}

export type ProgressBadgeProps = PropsRuntime<'shell.overlay'>
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

/** Route prefix shared with the host half. */
const API = '/dsh-progress/diary'

/** Keep a flyout this far away from the viewport edges. */
const FLYOUT_MARGIN = 12

/**
 * How long the ink water may stay armed without the prompt being accepted.
 * Clicking "write today's diary" arms it immediately; if the session never
 * starts running, this is what clears the blue again.
 */
const INK_FALLBACK_MS = 20_000

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
const DEFAULT_METRICS: TrackMetrics = { width: 0, ds: 32, pad: 9 }

/** Seat offsets, in px, measured against the widget's offsetParent. */
interface SeatMetrics {
  right: number
  top: number
}

/**
 * Seat before the first measurement, for a cold start that lands on a blank
 * session where the band reference may not exist yet: orb right edge 183px
 * from the frame's right edge, vertical centre 25px below its top. Both are
 * design values, not guesses.
 */
const DEFAULT_SEAT: SeatMetrics = { right: 183, top: 25 }

/** Newest diary as the host describes it. `chars`/`lines` are the host's own
 *  count — the client never recounts, or the two would drift apart. */
interface DiaryLatest {
  ok: boolean
  date: string | null
  /** Absolute path of the newest txt, as resolved by the host. */
  path?: string
  /** Absolute diary directory, for the "open folder" action. */
  dir?: string
  bytes?: number
  chars?: number
  lines?: number
  mtime?: number
  text?: string
  error?: string
}

/** One block of the entry, in the order the source file puts it. */
type DiaryBlock =
  | { kind: 'para'; text: string }
  | { kind: 'sign'; text: string }
  | { kind: 'conclusion'; items: string[] }

/** Literal heading that opens the conclusion band; nothing else is ever guessed. */
const CONCLUSION_HEAD = '## 今日结论'

/**
 * Split an entry into blocks, top to bottom.
 *
 * Streamed line by line on purpose: the conclusion band stays where it sits in
 * the file instead of being hoisted to the end. The first line is dropped when
 * it is exactly the file-name date (the card head already shows it), and the
 * band itself is dropped entirely when it has no `- ` item — an empty highlight
 * block would claim a conclusion that does not exist.
 * @param text - raw entry text.
 * @param date - the entry's date, equal to the file name without extension.
 * @returns blocks in source order.
 */
function parseDiary(text: string, date: string | null): DiaryBlock[] {
  const lines = text.split(/\r?\n/)
  if (date !== null && lines[0]?.trim() === date) lines.shift()
  const blocks: DiaryBlock[] = []
  let buffer: string[] = []
  let items: string[] | null = null

  const flushParagraph = () => {
    if (buffer.length === 0) return
    const joined = buffer.join('\n')
    if (joined.startsWith('——')) blocks.push({ kind: 'sign', text: joined })
    else blocks.push({ kind: 'para', text: joined })
    buffer = []
  }
  const flushConclusion = () => {
    if (items !== null && items.length > 0) blocks.push({ kind: 'conclusion', items })
    items = null
  }

  for (const line of lines) {
    if (line.startsWith(CONCLUSION_HEAD)) {
      flushParagraph()
      flushConclusion()
      items = []
      continue
    }
    if (items !== null) {
      // Items may be separated by blank lines, and every "-" line is one item.
      if (line.startsWith('- ')) {
        items.push(line.slice(2).trim())
        continue
      }
      if (line.trim() === '') continue
      // The band ends at the first line that is neither an item nor blank. By
      // convention nothing but items lives inside it, so the signature line
      // that follows the conclusion is never swallowed: the band closes and
      // this same line falls through to the ordinary rules below, where `——`
      // turns it into the `.sign` block.
      flushConclusion()
    }
    if (line.trim() === '') flushParagraph()
    else buffer.push(line)
  }
  flushParagraph()
  flushConclusion()
  return blocks
}

/** Root state: the design's three faces, driven by the session's real signals. */
type WidgetState = 'idle' | 'working' | 'waiting'

/** Local (not UTC) date key, matching the diary file-name convention. */
function localDate(at: number = Date.now()): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Right offset for a flyout, preferring to sit flush with the widget's right
 * edge and only pushing left when its left edge would fall inside the viewport
 * margin. The width is measured from the element, never recomputed from the
 * stylesheet — a CSS change must not be able to make this silently wrong.
 * @param anchor - the widget the flyout is anchored to.
 * @param flyout - the flyout element, already laid out.
 * @returns the `right` value to apply, in px.
 */
function fitRight(anchor: HTMLElement, flyout: HTMLElement): number {
  const anchorRight = anchor.getBoundingClientRect().right
  const width = flyout.offsetWidth
  const lower = Math.max(0, anchorRight - window.innerWidth + FLYOUT_MARGIN)
  return Math.min(lower, anchorRight - width - FLYOUT_MARGIN)
}

/**
 * Water-head and avatar positions, ported from the prototype's `geometry()`.
 *
 * The water head leads the ds centre by `c0 · p` (`c0 = pad + ds/2`), so the
 * avatar starts half-submerged and sinks deeper as p grows — fully under water
 * past p = 0.64 at the default tier. At 0% the water is one `c0`-wide pool and
 * the avatar's left edge sits `pad` from the track's left end; at 100% the water
 * fills the track and the avatar's right edge sits `pad` from the right end, so
 * neither endpoint ever clips the avatar.
 *
 * `p` is 0..1 here. The design prototype's copy of this function takes 0..100 —
 * both are correct, do not "fix" this one to match it.
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
 * text, never folded into the percentage.
 *
 * The control is permanent: with no work in flight it collapses to a 32px orb,
 * and it expands to the 340×44 bar only while something is running or waiting.
 * `percent` stays `undefined` when there is no to-do list, so idle shows no
 * percentage at all rather than a fabricated zero.
 * @param props - slot runtime props, the locale translator, and the jobs roster.
 * @returns the seat-mounted control and its flyouts.
 */
export function ProgressBadge({
  useSessions,
  useSessionStatus,
  useJobs,
  useSelection,
  watchRows,
  t,
}: ProgressBadgeProps) {
  // Identity: the frame-wide `shell.overlay` seat is root-scoped, so the host
  // hands it no `sessionId` prop at all. The workspace picker's selection store
  // is the source instead — the same store the rest of the client navigates by.
  // Hooks stay unconditional: the selector runs, then the fallback picks.
  const storedSessionId = useSelection((snapshot) => snapshot.sessionId)
  const sessionId = storedSessionId

  // Root scope exposes `useSessions` (the list plus its projection values)
  // rather than the per-Session `useProjection`/`useSession` kit, so the to-do
  // projection and the running flag both come from the list row for this id.
  // Reading one row object keeps the selector's identity stable across renders.
  const row = useSessions((snapshot) => sessionId === undefined
    ? undefined
    : snapshot.byId[sessionId])
  const todos: readonly TodoItem[] = row?.projectionValues?.todos ?? NO_TODOS
  const running = row?.running === true
  const waiting = useSessionStatus(
    (snapshot) => sessionId === undefined
      ? false
      : snapshot.get(sessionId)?.pendingInteraction !== undefined,
  )
  // No session at all means no roster to look up; an empty roster is the
  // honest answer, not an error.
  const jobs = useJobs((snapshot) => sessionId === undefined
    ? NO_JOBS
    : snapshot.rows[sessionId]) ?? NO_JOBS

  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [today, setToday] = useState(() => localDate())
  const [latest, setLatest] = useState<DiaryLatest | null>(null)
  const [cardEntry, setCardEntry] = useState<DiaryLatest | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  const [diaryError, setDiaryError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  /** Ink water is local intent, not a session fact — see the effects below. */
  const [ink, setInk] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const copyTimerRef = useRef<number | undefined>(undefined)
  /** Which footer button is showing "copied" after a degraded open. */
  const [copied, setCopied] = useState<'full' | 'folder' | null>(null)
  const inkSawRunning = useRef(false)
  const [shifts, setShifts] = useState({ menu: 0, panel: 0, card: 0 })
  const [seat, setSeat] = useState<SeatMetrics>(DEFAULT_SEAT)
  // Last successfully measured seat, so a missing reference element never
  // resets the widget to the origin.
  const seatRef = useRef<SeatMetrics>(DEFAULT_SEAT)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [metrics, setMetrics] = useState<TrackMetrics>(DEFAULT_METRICS)

  // One dismissal rule for every overlay: an outside pointer closes all three.
  const anyOpen = open || menuOpen || cardOpen
  const closeAll = useCallback(() => {
    setOpen(false)
    setMenuOpen(false)
    setCardOpen(false)
  }, [])
  useDismissOnOutsidePointer(rootRef, anyOpen, closeAll)
  // With no session there is no roster to follow, so skip the subscription
  // rather than querying a table keyed by an id that does not exist.
  useEffect(() => {
    if (sessionId === undefined) return undefined
    return watchRows(sessionId)
  }, [sessionId, watchRows])

  const counts = useMemo(() => countTodos(todos), [todos])
  const percent = percentOf(counts)
  const ordered = useMemo(() => orderJobs(jobs), [jobs])
  const liveRows = useMemo(() => ordered.filter(isLive), [ordered])
  const hasTodos = counts.total > 0

  // Strict three faces: a finished checklist is NOT work in flight, so the orb
  // comes back as soon as the session stops running. The task panel stays
  // reachable from the menu's 任务详情 entry.
  const widgetState: WidgetState = waiting
    ? 'waiting'
    : running || liveRows.length > 0 ? 'working' : 'idle'

  const written = latest !== null && latest.date === today
  const diaryStatus: 'written' | 'unwritten' = written ? 'written' : 'unwritten'

  // Seat: the widget floats over the header row instead of taking part in its
  // layout (that row is 30px tall; a 44px bar inside it would push the tabs
  // down). `right` is measured from the containing block's padding box while
  // getBoundingClientRect reports the border box, hence the border subtraction.
  // Measured in a layout effect so the first paint is already seated.
  //
  // The frame-wide overlay renders *before* the conversation header, and the
  // header only appears once conversation data arrives. So the very first
  // measure can legitimately find no band at all — and simply giving up there
  // would pin the widget to the fallback constant for the rest of the session,
  // because a first paint never fires `resize`. Hence the dependency on
  // `sessionId` (the header appears exactly when identity does) plus a bounded
  // retry that starts on the next frame and stops as soon as it succeeds.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return

    /** Give up after this long; the fallback seat is better than retrying forever. */
    const RETRY_CAP_MS = 2000
    const retryDeadline = Date.now() + RETRY_CAP_MS
    let retryFrame: number | undefined
    let disposed = false

    /** @returns true when the band was found and the seat was written. */
    const measure = (): boolean => {
      const anchor = root.offsetParent
      if (anchor === null) return false
      // Reference is the utilities band, not root.parentElement: the slot
      // wrapper is `display: contents` (no box, rect all zeros), so measuring
      // it seats the widget a full viewport-width away. The band is a real box
      // and it is what the design actually positions against. Selected by
      // data-slot because the hash in the class name is not stable.
      const utilsSlot = document.querySelector('[data-slot="conversation.session.header.utilities"]')
      const band = utilsSlot?.parentElement ?? null
      // Not rendered yet on a blank session or before the header lands: keep the
      // last seat instead of falling back to 0, which would fling the widget to
      // the top-left corner — worse than a stale-but-plausible seat.
      if (band === null) {
        console.info('[progress-bar] seat skipped: no utilities band', {
          seatRight: seatRef.current.right,
          seatTop: seatRef.current.top,
          bandLeft: null,
          bandHeight: null,
        })
        return false
      }
      const anchorStyle = getComputedStyle(anchor)
      const borderRight = Number.parseFloat(anchorStyle.borderRightWidth) || 0
      const borderTop = Number.parseFloat(anchorStyle.borderTopWidth) || 0
      const bandStyle = getComputedStyle(band)
      const marginLeft = Number.parseFloat(bandStyle.marginLeft) || 0
      const anchorRect = anchor.getBoundingClientRect()
      const bandRect = band.getBoundingClientRect()
      const next: SeatMetrics = {
        right: (anchorRect.right - borderRight) - (bandRect.left - marginLeft),
        top: (bandRect.top + bandRect.height / 2) - anchorRect.top - borderTop,
      }
      setSeat((previous) => (
        previous.right === next.right && previous.top === next.top ? previous : next
      ))
      seatRef.current = next
      // The DOM is not visible from the outside, so the code reports its own
      // numbers: DevTools shows this on mount and on every resize.
      console.info('[progress-bar] seat', {
        seatRight: next.right,
        seatTop: next.top,
        rootRight: root.getBoundingClientRect().right,
        bandLeft: bandRect.left,
        bandHeight: bandRect.height,
      })
      return true
    }

    /** Poll frame by frame until the band shows up or the cap runs out. */
    const retry = () => {
      if (disposed) return
      if (measure()) return
      if (Date.now() >= retryDeadline) {
        console.info('[progress-bar] seat retry gave up; keeping fallback seat', {
          seatRight: seatRef.current.right,
          seatTop: seatRef.current.top,
        })
        return
      }
      retryFrame = window.requestAnimationFrame(retry)
    }

    /** A resize re-arms the retry window: the band may be about to come back. */
    const onResize = () => {
      if (disposed) return
      if (retryFrame !== undefined) window.cancelAnimationFrame(retryFrame)
      if (!measure()) retryFrame = window.requestAnimationFrame(retry)
    }

    retry()
    window.addEventListener('resize', onResize)
    return () => {
      disposed = true
      if (retryFrame !== undefined) window.cancelAnimationFrame(retryFrame)
      window.removeEventListener('resize', onResize)
    }
  }, [sessionId])

  // Reverse check: re-measure what actually landed. offsetParent is null under
  // display:none, and an ancestor `transform` becomes the real containing block
  // without offsetParent admitting it — so the derived values are verified
  // against the rendered box rather than trusted.
  //
  // The comparison is against the *band*, the same reference the forward
  // measurement uses. It used to compare against `root.parentElement`, which is
  // the `display: contents` slot wrapper and therefore always has a zero rect —
  // that produced a permanent false failure (dx === the widget's own right
  // edge). With no band there is no reference, so there is nothing to report.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const utilsSlot = document.querySelector('[data-slot="conversation.session.header.utilities"]')
    const band = utilsSlot?.parentElement ?? null
    if (band === null) return
    const bandStyle = getComputedStyle(band)
    const marginLeft = Number.parseFloat(bandStyle.marginLeft) || 0
    const bandRect = band.getBoundingClientRect()
    const expectedRight = bandRect.left - marginLeft
    const expectedCenterY = bandRect.top + bandRect.height / 2
    const rootRect = root.getBoundingClientRect()
    const actualRight = rootRect.right
    const actualCenterY = rootRect.top + rootRect.height / 2
    const dx = Math.abs(actualRight - expectedRight)
    const dy = Math.abs(actualCenterY - expectedCenterY)
    if (dx > 1 || dy > 1) {
      console.warn('[progress-bar] seat reverse-check failed', {
        dx,
        dy,
        expectedRight,
        actualRight,
        expectedCenterY,
        actualCenterY,
        bandLeft: bandRect.left,
        marginLeft,
        bandHeight: bandRect.height,
      })
    }
  }, [seat])

  // Flyouts: one shared rule for every overlay. Widths come from the elements
  // themselves, so .menu / .dcard / .panel each get their own answer.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const fit = () => {
      const next = {
        menu: menuRef.current === null ? 0 : fitRight(root, menuRef.current),
        panel: panelRef.current === null ? 0 : fitRight(root, panelRef.current),
        // 396px is the widest of the three flyouts, so this is the one that
        // actually needs the clamp on a narrow window.
        card: cardRef.current === null ? 0 : fitRight(root, cardRef.current),
      }
      setShifts((previous) => (
        previous.menu === next.menu
        && previous.panel === next.panel
        && previous.card === next.card
          ? previous
          : next
      ))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open, menuOpen, cardOpen])

  // The fill width and the avatar offset are px values derived from the track's
  // real width, so the track has to be measured. `--ds`/`--pad` are read back
  // from the computed style rather than kept in a second tier table.
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
  }, [])

  // Report the card's own numbers once it has settled, so the 396px width can be
  // checked against what actually landed (max-width squeezes it on narrow windows).
  useEffect(() => {
    if (!cardOpen) return
    const timer = window.setTimeout(() => {
      console.info('[progress-bar] card', {
        offsetWidth: cardRef.current?.offsetWidth ?? 0,
        flyRight: shifts.card,
      })
    }, 260)
    return () => window.clearTimeout(timer)
  }, [cardOpen, shifts.card])

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

  /** Relative time for the diary subtitle; only ever derived from a real mtime. */
  const agoOf = (mtime: number | undefined): string => {
    if (mtime === undefined) return t('ago.justNow')
    const diff = Math.max(0, Date.now() - mtime)
    if (diff < 60_000) return t('ago.justNow')
    if (diff < 3_600_000) return t('ago.minutes', { count: Math.round(diff / 60_000) })
    if (diff < 86_400_000) return t('ago.hours', { count: Math.round(diff / 3_600_000) })
    return t('ago.days', { count: Math.round(diff / 86_400_000) })
  }

  /** Read the newest diary. Failures keep the previous value instead of blanking. */
  const loadLatest = useCallback(async () => {
    try {
      const response = await fetch(`${API}/latest`)
      const payload = await response.json() as DiaryLatest
      if (payload.ok) {
        setLatest(payload)
        setDiaryError(null)
      } else {
        setDiaryError(t('error.read', { error: String(payload.error ?? 'unknown') }))
      }
    } catch (error) {
      setDiaryError(t('error.read', { error: String((error as Error).message) }))
    }
  }, [t])

  /** Queue today's diary. One fresh requestId per click; a retry of that click
   *  would reuse it, which is what the idempotency key is for. */
  const writeDiary = useCallback(async () => {
    const requestId = crypto.randomUUID()
    setWriting(true)
    setDiaryError(null)
    // Arm the ink water on the intent, not on the session: the click is the
    // only reliable signal that this turn is about the diary.
    inkSawRunning.current = false
    setInk(true)
    try {
      const response = await fetch(`${API}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, requestId }),
      })
      const payload = await response.json() as { ok: boolean; error?: string }
      if (payload.ok) {
        setMenuOpen(false)
        await loadLatest()
      } else {
        setDiaryError(t('error.write', { error: String(payload.error ?? 'unknown') }))
        setInk(false)
      }
    } catch (error) {
      setDiaryError(t('error.write', { error: String((error as Error).message) }))
      setInk(false)
    } finally {
      setWriting(false)
    }
  }, [sessionId, loadLatest, t])

  /**
   * Open the diary card. The bar's shape is deliberately untouched: reading one
   * file takes milliseconds, and expanding or collapsing the bar for it would
   * only flash. The band's own errors are shown inside the card.
   */
  const openCard = useCallback(async () => {
    // Menu and card are mutually exclusive, and the card must not be anchored
    // off a popup that is fading out.
    setMenuOpen(false)
    setCardOpen(true)
    setCardBusy(true)
    setCopied(null)
    try {
      const response = await fetch(`${API}/latest`)
      const payload = await response.json() as DiaryLatest
      setCardEntry(payload.ok ? payload : { ok: false, date: null, error: String(payload.error ?? 'unknown') })
    } catch (error) {
      setCardEntry({ ok: false, date: null, error: String((error as Error).message) })
    } finally {
      setCardBusy(false)
    }
  }, [])

  /** Degraded footer action: put the path on the clipboard so the click still
   *  does something visible. Never a silent no-op. */
  const copyPath = useCallback(async (path: string, which: 'full' | 'folder') => {
    try {
      await navigator.clipboard.writeText(path)
      setCopied(which)
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard unavailable (permissions, insecure context): the path is still
      // on screen and selectable, so say nothing rather than lie about copying.
    }
  }, [])

  /** Ask the host to open a path; fall back to copying it when it cannot. */
  const openPath = useCallback(async (path: string, reveal: boolean, which: 'full' | 'folder') => {
    try {
      const response = await fetch(`${API}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ...(reveal ? { reveal: true } : {}) }),
      })
      const payload = await response.json() as { ok: boolean; error?: string }
      if (payload.ok) return
    } catch {
      // Network failure degrades exactly like `unsupported`.
    }
    await copyPath(path, which)
  }, [copyPath])

  // Refresh the card's data whenever the session stops running, so a write that
  // finishes while the card is open does not leave a stale entry behind.
  useEffect(() => {
    if (running || !cardOpen) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`${API}/latest`)
        const payload = await response.json() as DiaryLatest
        if (!cancelled) setCardEntry(payload)
      } catch {
        // Keep the entry already on screen; the next open refreshes it.
      }
    })()
    return () => { cancelled = true }
  }, [running, cardOpen])

  // Pull the newest entry once on mount, and again when the session stops
  // running (a just-finished diary write). No polling.
  useEffect(() => {
    void loadLatest()
  }, [loadLatest])
  useEffect(() => {
    if (!running) void loadLatest()
  }, [running, loadLatest])

  // Local-date rollover: without this the orb would still show yesterday's
  // ticks after midnight.
  useEffect(() => {
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    const timer = setTimeout(() => setToday(localDate()), midnight.getTime() - Date.now() + 50)
    return () => clearTimeout(timer)
  }, [today])

  // Backstop for the ink water: the prompt may never be accepted (no running
  // turn ever starts), in which case nothing else would ever clear it.
  useEffect(() => {
    if (!ink) return
    const timer = setTimeout(() => {
      if (!inkSawRunning.current) setInk(false)
    }, INK_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [ink])

  // Clear the ink water when the diary turn ends — i.e. when running falls back
  // to false after having actually been true. `inkSawRunning` is what makes that
  // distinguishable from the gap right after the click, before the prompt is
  // accepted; without it this effect would kill the blue immediately and the bar
  // would only flicker.
  useEffect(() => {
    if (!ink) return
    if (running) {
      inkSawRunning.current = true
      return
    }
    if (inkSawRunning.current) {
      inkSawRunning.current = false
      setInk(false)
    }
  }, [ink, running])

  // A live clock ticks only while the panel is open and something is running:
  // the only duration this plugin can prove is a job's own start timestamp.
  useEffect(() => {
    if (!open || liveRows.length === 0) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open, liveRows.length])

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
  const seatStyle = {
    '--seat-right': `${seat.right}px`,
    '--seat-top': `${seat.top}px`,
  } as CSSProperties
  const barClass = percent !== undefined ? css.barFill : `${css.barFill} ${css.barFillIndeterminate}`

  const menuTitle = widgetState === 'idle' || !hasTodos
    ? t('menu.title.idle')
    : t('menu.title.working', {
        step: Math.min(counts.completed + 1, counts.total),
        total: counts.total,
      })
  const menuSub = written
    ? t('menu.sub.written', { ago: agoOf(latest?.mtime) })
    : t('menu.sub.unwritten')
  const readHint = latest?.date === null || latest?.date === undefined
    ? t('menu.read.hint.empty')
    : t('menu.read.hint', { date: latest.date, bytes: formatBytes(latest.bytes ?? 0) })

  // Card: exactly one gate decides between body, notice and error, so the three
  // can never render on top of each other.
  const cardState: 'body' | 'empty' | 'error' | 'loading' = cardEntry === null || (cardBusy && cardEntry.ok !== true)
    ? 'loading'
    : cardEntry.ok === false
      ? 'error'
      : cardEntry.date === null || (cardEntry.text ?? '').trim() === ''
        ? 'empty'
        : 'body'
  const cardBlocks = useMemo(
    () => (cardState === 'body' ? parseDiary(cardEntry?.text ?? '', cardEntry?.date ?? null) : []),
    [cardState, cardEntry],
  )
  const cardDate = cardEntry?.date ?? ''
  const cardChip = cardDate === today ? t('card.chip.today') : t('card.chip.previous')
  const cardPath = cardEntry?.path ?? ''
  const cardDir = cardEntry?.dir ?? ''

  return (
    <div
      ref={rootRef}
      className={css.root}
      data-state={widgetState}
      data-diary={diaryStatus}
      data-ink={ink ? 'true' : 'false'}
      style={seatStyle}
    >
      <button
        type="button"
        className={css.trigger}
        aria-expanded={widgetState === 'idle' ? menuOpen : open}
        aria-label={widgetState === 'idle' ? t('orb.aria') : triggerLabel}
        title={triggerLabel}
        onClick={() => {
          setNow(Date.now())
          // idle → the diary menu; working/waiting → the task panel. The menu
          // carries 任务详情 so the panel keeps an entry from the orb too.
          // Opening either one closes the other two.
          if (widgetState === 'idle') {
            setCardOpen(false)
            setMenuOpen((current) => !current)
          } else {
            setCardOpen(false)
            setOpen((current) => !current)
          }
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
            <span className={css.halo} />
            <span className={css.dsBob}>
              <span className={css.dsSpin}>
                <span className={css.dsImg} />
              </span>
            </span>
            <span className={css.badge} aria-hidden="true">
              <svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.4 2.4 4.6-5" /></svg>
            </span>
          </span>
        </span>
        {/* Readout: idle hides it and it must not take part in layout, or the
            116px root pushes the 32px orb off its seat. See `.readout`. */}
        <span className={css.readout}>
          <span className={css.count}>{triggerText}</span>
          <IconChevronDownOutlineRegular size={12} className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} />
        </span>
      </button>

      <div
        ref={menuRef}
        className={css.menu}
        data-open={menuOpen ? 'true' : 'false'}
        style={{ right: shifts.menu }}
        role="menu"
        aria-label={t('menu.aria')}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.menuHead}>
          <span className={css.menuPic}><span className={css.dsImg} /></span>
          <span className={css.menuTxt}>
            <b className={css.menuTitle}>{menuTitle}</b>
            <span className={css.menuSub}>{menuSub}</span>
          </span>
        </div>
        <div className={css.menuSep} />
        <div className={css.menuCap}>{t('menu.group.diary')}</div>
        <button
          type="button"
          className={`${css.menuItem} ${css.menuItemPrimary}`}
          disabled={writing}
          onClick={() => { void writeDiary() }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span className={css.menuMain}>
            <b className={css.menuLabel}>{written ? t('menu.write.label.redo') : t('menu.write.label')}</b>
            <em className={css.menuHint}>{written ? t('menu.write.hint.redo') : t('menu.write.hint')}</em>
          </span>
        </button>
        <button
          type="button"
          className={css.menuItem}
          onClick={() => {
            void openCard()
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
          </svg>
          <span className={css.menuMain}>
            <b className={css.menuLabel}>{t('menu.read.label')}</b>
            <em className={css.menuHint}>
              {cardBusy ? t('trigger.running') : copied === 'full' ? t('card.copied') : readHint}
            </em>
          </span>
          <span className={css.menuKbd}>›</span>
        </button>
        <div className={css.menuSep} />
        <button
          type="button"
          className={css.menuItem}
          onClick={() => {
            setMenuOpen(false)
            setOpen((current) => !current)
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M9 5h6M9 12h6M9 19h6" /><rect x="4" y="2" width="16" height="20" rx="2" />
          </svg>
          <span className={css.menuMain}>
            <b className={css.menuLabel}>{t('menu.tasks')}</b>
          </span>
        </button>
        {diaryError === null ? null : <div className={css.menuError}>{diaryError}</div>}
      </div>

      <div
        ref={cardRef}
        className={css.dcard}
        data-open={cardOpen ? 'true' : 'false'}
        style={{ right: shifts.card }}
        role="group"
        aria-label={t('card.aria')}
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className={css.dcardHead}>
          <b className={css.dcardDate}>{cardDate}</b>
          <span className={css.dcardChip}>{cardChip}</span>
          <span className={css.dcardMeta}>
            {t('card.meta', { chars: cardEntry?.chars ?? 0, lines: cardEntry?.lines ?? 0 })}
          </span>
        </div>
        <div className={css.dcardBody}>
          {cardState === 'error' ? (
            <p className={css.dcardNotice}>{t('error.read', { error: String(cardEntry?.error ?? 'unknown') })}</p>
          ) : cardState === 'empty' ? (
            <p className={css.dcardNotice}>{t('menu.read.empty')}</p>
          ) : cardState === 'loading' ? (
            <p className={css.dcardNotice}>{t('trigger.running')}</p>
          ) : (
            cardBlocks.map((block, index) => {
              const key = `${block.kind}-${index}`
              if (block.kind === 'conclusion') {
                return (
                  <div key={key} className={css.dcardConcl}>
                    <div className={css.dcardConclTitle}>{t('card.conclusion')}</div>
                    <ul className={css.dcardConclList}>
                      {block.items.map((item, itemIndex) => (
                        <li key={`${item}-${itemIndex}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )
              }
              return <p key={key} className={block.kind === 'sign' ? css.sign : undefined}>{block.text}</p>
            })
          )}
        </div>
        <div className={css.dcardFoot}>
          <button
            type="button"
            className={css.dcardBtn}
            onClick={() => { void openPath(cardPath, false, 'full') }}
          >
            {copied === 'full' ? t('card.copied') : t('card.read.full')}
          </button>
          <button
            type="button"
            className={css.dcardBtn}
            onClick={() => { void openPath(cardDir, true, 'folder') }}
          >
            {copied === 'folder' ? t('card.copied') : t('card.open.folder')}
          </button>
          <span className={css.path} title={cardPath} aria-label={t('card.path.aria')}>{cardPath}</span>
        </div>
      </div>

      {open ? (
        <div
          ref={panelRef}
          className={css.panel}
          style={{ right: shifts.panel }}
          role="group"
          aria-label={t('panel.aria')}
        >
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

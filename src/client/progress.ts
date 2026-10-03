/**
 * Pure progress arithmetic for the badge. No React, no services: every value
 * here is derived from an already-resolved projection or job row, so the
 * component never has to invent a number.
 * @module dsh-progress-bar/client/progress
 */

/** Todo lifecycle state, as declared by the `todo_write` tool. */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/**
 * One entry of the session's `todos` projection.
 *
 * Structurally identical to the declaration shipped by the tool that owns the
 * key (`export interface TodoItem { content: string; status: 'pending' |
 * 'in_progress' | 'completed' }`), redeclared here so this plugin reads the
 * projection through its own vocabulary instead of another plugin's exports.
 */
export interface TodoItem {
  content: string
  status: TodoStatus
}

/** Todo counts behind one progress reading. */
export interface ProgressCounts {
  total: number
  completed: number
  inProgress: number
  pending: number
}

/**
 * Count a todos projection.
 * @param todos - the projection value, or null/undefined before the first write.
 * @returns per-status counts; all zero for an absent list.
 */
export function countTodos(todos: readonly TodoItem[] | null | undefined): ProgressCounts {
  const list = todos ?? []
  let completed = 0
  let inProgress = 0
  for (const item of list) {
    if (item.status === 'completed') completed += 1
    else if (item.status === 'in_progress') inProgress += 1
  }
  return { total: list.length, completed, inProgress, pending: list.length - completed - inProgress }
}

/**
 * Whole-number completion percentage.
 * @param counts - counts from {@link countTodos}.
 * @returns the percentage, or undefined when there is no list to measure. An
 *   absent list has no completion reading — never `0`.
 */
export function percentOf(counts: ProgressCounts): number | undefined {
  if (counts.total === 0) return undefined
  return Math.round((counts.completed / counts.total) * 100)
}

/**
 * Elapsed milliseconds for one job.
 * @param startedAt - the job's own start timestamp.
 * @param finishedAt - its end timestamp, or undefined while it is live.
 * @param now - the current clock reading used for a live job.
 * @returns a non-negative duration in milliseconds.
 */
export function elapsedMs(startedAt: number, finishedAt: number | undefined, now: number): number {
  return Math.max(0, (finishedAt ?? now) - startedAt)
}

/**
 * Split a duration into display units.
 * @param ms - duration in milliseconds.
 * @returns whole hours, minutes and seconds.
 */
export function splitDuration(ms: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(ms / 1000))
  return { hours: Math.floor(total / 3600), minutes: Math.floor(total / 60) % 60, seconds: total % 60 }
}

/**
 * Human byte size for a job's retained output. Units stay locale-neutral.
 * @param bytes - retained output bytes.
 * @returns a short size string such as `1.2 MB`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit]}`
}

/** Job lifecycle states the host publishes. */
export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

/**
 * The subset of a roster row this plugin reads, mirroring the host's
 * declaration (`JobView`): `id`/`kind`/`label`/`status`/`progress`/`detail`/
 * `startedAt`/`finishedAt`/`output.total`.
 *
 * `progress` is a live progress *line* (a string), never a number: it is
 * displayed as text and is never converted into a percentage.
 */
export interface JobView {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: JobStatus
  readonly progress?: string
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
  readonly output: { readonly total: number }
}

/**
 * Whether a job still occupies the machine.
 * @param job - one roster row.
 * @returns true while the job is running or being stopped.
 */
export function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/**
 * The one-line qualifier for a row: live progress while running, the terminal
 * reason once settled.
 * @param job - one roster row.
 * @returns the line to show, or undefined when the host published neither.
 */
export function jobDetail(job: JobView): string | undefined {
  return job.progress ?? job.detail
}

/**
 * Live rows first in start order, then settled rows newest-first.
 * @param jobs - roster rows.
 * @returns a new ordered array; the input is not mutated.
 */
export function orderJobs(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const settled = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return settled !== 0 ? settled : left.startedAt - right.startedAt
  })
}

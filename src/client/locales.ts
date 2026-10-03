/** Locale namespace this plugin registers its dictionaries under. */
export const NS = 'progress'

/**
 * Simplified Chinese dictionary. It is the key-set source of truth: `en` is
 * typed against it, so a missing or extra English key is a compile error.
 */
export const zh = {
  'trigger.aria.tasks': '工作进度：{done}/{total} 已完成',
  'trigger.aria.running': '工作进度：有任务正在运行',
  'trigger.tasks': '{done}/{total} · {percent}%',
  'trigger.running': '运行中',
  'trigger.jobsOnly': '运行中 · {duration}',
  'panel.aria': '工作进度详情',
  'panel.summary': '已完成 {done} / 共 {total}',
  'panel.indeterminate': '有工作正在进行，但本会话还没有任务清单',
  'section.todos': '任务清单',
  'section.jobs': '后台作业',
  'todo.pending': '待处理',
  'todo.in_progress': '进行中',
  'todo.completed': '已完成',
  'job.running': '运行中',
  'job.stopping': '正在停止',
  'job.completed': '已完成',
  'job.killed': '已取消',
  'job.failed': '已失败',
  'job.output': '保留输出 {size}',
  'duration.seconds': '{seconds}秒',
  'duration.minutes': '{minutes}分{seconds}秒',
  'duration.hours': '{hours}小时{minutes}分',
  'notice.waiting': '正在等待你确认一次操作',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<ProgressKey, string> = {
  'trigger.aria.tasks': 'Work progress: {done} of {total} completed',
  'trigger.aria.running': 'Work progress: tasks are running',
  'trigger.tasks': '{done}/{total} · {percent}%',
  'trigger.running': 'running',
  'trigger.jobsOnly': 'running · {duration}',
  'panel.aria': 'Work progress details',
  'panel.summary': '{done} of {total} completed',
  'panel.indeterminate': 'Work is in progress, but this session has no to-do list yet',
  'section.todos': 'To-dos',
  'section.jobs': 'Background jobs',
  'todo.pending': 'Pending',
  'todo.in_progress': 'In progress',
  'todo.completed': 'Completed',
  'job.running': 'running',
  'job.stopping': 'stopping',
  'job.completed': 'completed',
  'job.killed': 'cancelled',
  'job.failed': 'failed',
  'job.output': '{size} retained',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours}h {minutes}m',
  'notice.waiting': 'Waiting for your confirmation',
}

/** Every key this namespace carries. */
export type ProgressKey = keyof typeof zh

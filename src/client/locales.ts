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
  'orb.aria': '进度与日记',
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

  /* ---- 菜单 ---- */
  'menu.aria': '进度与日记菜单',
  'menu.title.idle': '空闲中',
  'menu.title.working': '写作中 · 第 {step} / {total} 步',
  'menu.sub.unwritten': '今天的日记还没写',
  'menu.sub.written': '今天的日记已写 · {ago}',
  'menu.group.diary': '日记',
  'menu.write.label': '写今天的日记',
  'menu.write.label.redo': '重写今天的日记',
  'menu.write.hint': '回顾今天，写成第一人称',
  'menu.write.hint.redo': '今天的已经写过了，要覆盖吗',
  'menu.read.label': '读上一篇日记',
  'menu.read.hint': '{date} · {bytes}',
  'menu.read.hint.empty': '还没有日记',
  'menu.tasks': '任务详情',
  'menu.read.empty': '还没有日记',

  /* ---- 日记卡片 ---- */
  'card.aria': '上一篇日记',
  'card.chip.today': '今天',
  'card.chip.previous': '上一篇',
  'card.meta': '{chars} 字 · {lines} 行',
  'card.conclusion': '今日结论',
  'card.read.full': '读全文',
  'card.open.folder': '打开文件夹',
  'card.copied': '已复制',
  'card.path.aria': '日记路径',
  'card.empty': '这篇日记是空的',

  /* ---- 相对时间与错误 ---- */
  'ago.justNow': '刚刚',
  'ago.minutes': '{count} 分钟前',
  'ago.hours': '{count} 小时前',
  'ago.days': '{count} 天前',
  'error.read': '读日记失败：{error}',
  'error.write': '写日记失败：{error}',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<ProgressKey, string> = {
  'trigger.aria.tasks': 'Work progress: {done} of {total} completed',
  'trigger.aria.running': 'Work progress: tasks are running',
  'trigger.tasks': '{done}/{total} · {percent}%',
  'trigger.running': 'running',
  'trigger.jobsOnly': 'running · {duration}',
  'orb.aria': 'Progress and diary',
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

  /* ---- menu ---- */
  'menu.aria': 'Progress and diary menu',
  'menu.title.idle': 'idle',
  'menu.title.working': 'writing · step {step} / {total}',
  'menu.sub.unwritten': "today's diary is not written yet",
  'menu.sub.written': "today's diary was written · {ago}",
  'menu.group.diary': 'Diary',
  'menu.write.label': "Write today's diary",
  'menu.write.label.redo': "Rewrite today's diary",
  'menu.write.hint': 'Look back on today, first person',
  'menu.write.hint.redo': "Today's entry exists — overwrite it?",
  'menu.read.label': 'Read the latest diary',
  'menu.read.hint': '{date} · {bytes}',
  'menu.read.hint.empty': 'no diary yet',
  'menu.tasks': 'Task details',
  'menu.read.empty': "No diary entries yet",

  /* ---- diary card ---- */
  'card.aria': 'Latest diary',
  'card.chip.today': 'today',
  'card.chip.previous': 'latest',
  'card.meta': '{chars} chars · {lines} lines',
  'card.conclusion': 'Conclusions',
  'card.read.full': 'Read in full',
  'card.open.folder': 'Open folder',
  'card.copied': 'Copied',
  'card.path.aria': 'Diary path',
  'card.empty': 'This entry is empty',

  /* ---- relative time and errors ---- */
  'ago.justNow': 'just now',
  'ago.minutes': '{count} min ago',
  'ago.hours': '{count} h ago',
  'ago.days': '{count} d ago',
  'error.read': 'Could not read the diary: {error}',
  'error.write': 'Could not write the diary: {error}',
}

/** Every key this namespace carries. */
export type ProgressKey = keyof typeof zh

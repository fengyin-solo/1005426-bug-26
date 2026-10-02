/**
 * 评估表单草稿：边填边存到 localStorage（按演练编号隔离）。
 * 提交事务中断、刷新页面、关掉重开，已填的结论与人数都还在；
 * 提交成功或评估退回后草稿清掉。
 */
const DRAFT_KEY = 'geohazard-patrol:drill-eval-draft'

export type EvalDraft = {
  conclusion: string
  participantCount: string
  savedAt: string
}

type DraftMap = Record<string, EvalDraft>

function read(): DraftMap {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    return JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? '{}') as DraftMap
  } catch {
    return {}
  }
}

function write(map: DraftMap): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(map))
  }
}

export function loadDraft(drillNo: string): EvalDraft | null {
  return read()[drillNo] ?? null
}

export function saveDraft(drillNo: string, draft: Omit<EvalDraft, 'savedAt'>): EvalDraft {
  const map = read()
  const next: EvalDraft = { ...draft, savedAt: new Date().toISOString() }
  write({ ...map, [drillNo]: next })
  return next
}

export function clearDraft(drillNo: string): void {
  const map = read()
  if (drillNo in map) {
    delete map[drillNo]
    write(map)
  }
}

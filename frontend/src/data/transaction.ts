import { persist, state, type PersistState, type TxJournal } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

/**
 * 一次多步落库（one-shot commit）：
 * - 步骤按顺序执行，每步成功后把步骤编号写进事务日志并连同数据一次落库；
 * - 同一事务重放时，已完成的步骤直接跳过 —— 失败重试从断掉那一步接着走；
 * - 每一步内部幂等：按业务键 upsert，重复执行也不会多出记录；
 * - 全部完成后日志随数据一起清掉（也是一次落库），不会留下半成品。
 */
export type TxContext = {
  draft: PersistState
  journal: TxJournal
  /** 步骤里用它做幂等 upsert：同业务键只留一条。 */
  upsertRow: (key: string, businessField: string, businessValue: string, patch: Partial<EntryRow>) => void
  /** 按 id 更新单条记录，找不到时不产生任何改动（幂等）。 */
  updateById: (key: string, id: number, patch: Partial<EntryRow>) => void
  /** 按业务键把记录标作废（active=false）：重放时已撤下也不会再动。 */
  deactivateByBiz: (key: string, businessField: string, businessValue: string) => void
}

export type TxStep = {
  /** 步骤名只用于日志展示。 */
  name: string
  run: (ctx: TxContext) => void
}

function upsertRowInto(
  entries: Record<string, EntryRow[]>,
  key: string,
  businessField: string,
  businessValue: string,
  patch: Partial<EntryRow>,
): void {
  const rows = entries[key] ? [...entries[key]] : []
  const index = rows.findIndex((row) => row.active !== false && String(row[businessField]) === businessValue)
  if (index >= 0) {
    rows[index] = { ...rows[index], ...patch } as EntryRow
  } else {
    const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    rows.push({
      id: nextId,
      status: '',
      pending: false,
      abnormal: false,
      active: true,
      [businessField]: businessValue,
      ...patch,
    } as EntryRow)
  }
  entries[key] = rows
}

export function beginJournal(kind: string, payload: Record<string, unknown>): TxJournal {
  const id = String(payload.txId ?? `${kind}-${Date.now()}`)
  const existing = state().journal.find((item) => item.id === id)
  if (existing) {
    return existing
  }
  return {
    id,
    kind,
    stepDone: [],
    payload,
    createdAt: new Date().toISOString(),
  }
}

export function runJournal(journal: TxJournal, steps: TxStep[]): void {
  let current = state()
  // 重放前先挂日志（若之前没挂住），保证「数据已改、日志没记」不可能发生。
  if (!current.journal.some((item) => item.id === journal.id)) {
    current = { ...current, journal: [...current.journal, journal] }
    persist(current)
  }

  for (let i = 0; i < steps.length; i += 1) {
    if (journal.stepDone.includes(i)) {
      continue
    }
    // 每步从已落库的最新状态克隆一份草稿，改完连同进度一次写入。
    const draft: PersistState = JSON.parse(JSON.stringify(state())) as PersistState
    const activeJournal = draft.journal.find((item) => item.id === journal.id) ?? journal
    const ctx: TxContext = {
      draft,
      journal: activeJournal,
      upsertRow: (key, businessField, businessValue, patch) =>
        upsertRowInto(draft.entries, key, businessField, businessValue, patch),
      updateById: (key, id, patch) => {
        const rows = draft.entries[key]
        if (!rows) {
          return
        }
        const index = rows.findIndex((row) => Number(row.id) === id)
        if (index >= 0) {
          draft.entries[key] = rows.map((row, rowIndex) =>
            rowIndex === index ? ({ ...row, ...patch } as EntryRow) : row,
          )
        }
      },
      deactivateByBiz: (key, businessField, businessValue) => {
        const rows = draft.entries[key]
        if (!rows) {
          return
        }
        draft.entries[key] = rows.map((row) =>
          String(row[businessField]) === businessValue && row.active !== false
            ? { ...row, active: false, status: '已撤下', pending: false, abnormal: false }
            : row,
        )
      },
    }
    steps[i].run(ctx)
    activeJournal.stepDone = [...new Set([...activeJournal.stepDone, i])]
    persist(draft)
  }

  // 全部步骤完成：日志与最终数据在同一次写入里清掉。
  const finished = state()
  persist({ ...finished, journal: finished.journal.filter((item) => item.id !== journal.id) })
}

/** 启动时把上次没走完的事务交给注册方续跑。 */
export function pendingJournals(): TxJournal[] {
  return state().journal
}

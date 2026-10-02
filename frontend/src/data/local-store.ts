import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都在。
// v2：把「业务数据 + 事务日志」放进同一份状态，一次写入同时落库，
// 多步事务做到「全有或全无」，中断后还能按日志接着走。
const STORAGE_KEY = 'geohazard-patrol:entries'
const STORAGE_VERSION = 2

/** 事务日志：记录一次多步落库走到了第几步，中断后据此续跑。 */
export type TxJournal = {
  id: string
  kind: string
  stepDone: number[]
  payload: Record<string, unknown>
  createdAt: string
}

export type PersistState = {
  version: number
  entries: Record<string, EntryRow[]>
  journal: TxJournal[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedState(): PersistState {
  return { version: STORAGE_VERSION, entries: clone(SEED_ROWS), journal: [] }
}

function normalize(raw: unknown): PersistState {
  // v1 是平铺的 { moduleKey: rows }，识别到就整体迁到 v2。
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    if (obj.version === STORAGE_VERSION && obj.entries) {
      const state = obj as PersistState
      return {
        version: STORAGE_VERSION,
        entries: { ...clone(SEED_ROWS), ...clone(state.entries) },
        journal: Array.isArray(state.journal) ? state.journal : [],
      }
    }
    const seeded = seedState()
    return { ...seeded, entries: { ...seeded.entries, ...clone(raw as Record<string, EntryRow[]>) } }
  }
  return seedState()
}

function readStorage(): PersistState {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedState()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = seedState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    return normalize(JSON.parse(raw))
  } catch {
    const seeded = seedState()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: PersistState | null = null

export function state(): PersistState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return state().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 有效（未作废）记录：重评项随评估退回被撤下后，所有入口都读不到它。 */
export function activeRows(key: string): EntryRow[] {
  return listRows(key).filter((row) => row.active !== false)
}

/** 数据与事务日志一次写入：多步事务的每一步都只产生一次落库，不会半新半旧。 */
export function persist(next: PersistState): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

/** 只改一个模块的数据，不带事务日志。 */
export function saveRows(key: string, rows: EntryRow[]): void {
  persist({ ...state(), entries: { ...state().entries, [key]: rows } })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

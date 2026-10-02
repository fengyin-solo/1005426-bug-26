import { listRows, saveModules, saveRows } from '@/data/local-store'
import { moduleMeta } from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'

// —— 参演人数取数规则（列表、统计、大屏、详情弹窗、导出都从这里取，不各取各的）——
// 有效范围 1–1000 人，超出范围或不是整数一律按无效处理：展示为「无效」，不计入合计。
// 参演人数与评估结论冲突时，以落库在演练记录上的「参演人数」字段为准；
// 评估结论只是文字结论，不参与人数统计。
export const PARTICIPANT_MIN = 1
export const PARTICIPANT_MAX = 1000

export function readParticipants(row: EntryRow): number | null {
  const raw = row['参演人数']
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isInteger(value) || value < PARTICIPANT_MIN || value > PARTICIPANT_MAX) {
    return null
  }
  return value
}

export function formatParticipants(row: EntryRow): string {
  const value = readParticipants(row)
  return value === null ? '无效' : String(value)
}

export function sumParticipants(rows: EntryRow[]): number {
  return rows.reduce((sum, row) => sum + (readParticipants(row) ?? 0), 0)
}

// —— 评估提交：分两步落库（演练记录 → 隐患点台账重评项），每步留 checkpoint ——
// 任何一步失败，journal 留在 localStorage，重试或重开页面时从未完成的那一步接着走；
// 每一步都按演练编号 upsert，重复提交、连点两次都只挂一条记录。
const JOURNAL_KEY = 'geohazard-patrol:drill-eval-journal'
const DRAFT_KEY = 'geohazard-patrol:drill-eval-draft'

export type EvalPayload = {
  drillCode: string
  conclusion: string
  participants: number
}

type EvalJournal = {
  payload: EvalPayload
  done: string[]
  updatedAt: string
}

function storage(): Storage | null {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
}

function readJournal(): EvalJournal | null {
  const raw = storage()?.getItem(JOURNAL_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as EvalJournal
  } catch {
    return null
  }
}

function writeJournal(journal: EvalJournal): void {
  journal.updatedAt = new Date().toISOString()
  storage()?.setItem(JOURNAL_KEY, JSON.stringify(journal))
}

function clearJournal(): void {
  storage()?.removeItem(JOURNAL_KEY)
}

export function hasPendingEvaluation(): boolean {
  return readJournal() !== null
}

// 评估表单草稿：边填边存，中途中断（关页面、刷新）再打开还能接着填。
export function loadEvalDraft(drillCode: string): { conclusion: string; participants: string } | null {
  const raw = storage()?.getItem(DRAFT_KEY)
  if (!raw) {
    return null
  }
  try {
    const drafts = JSON.parse(raw) as Record<string, { conclusion: string; participants: string }>
    return drafts[drillCode] ?? null
  } catch {
    return null
  }
}

export function saveEvalDraft(drillCode: string, draft: { conclusion: string; participants: string }): void {
  const store = storage()
  if (!store) {
    return
  }
  let drafts: Record<string, { conclusion: string; participants: string }> = {}
  try {
    drafts = JSON.parse(store.getItem(DRAFT_KEY) ?? '{}') as typeof drafts
  } catch {
    drafts = {}
  }
  drafts[drillCode] = draft
  store.setItem(DRAFT_KEY, JSON.stringify(drafts))
}

export function clearEvalDraft(drillCode: string): void {
  const store = storage()
  if (!store) {
    return
  }
  try {
    const drafts = JSON.parse(store.getItem(DRAFT_KEY) ?? '{}') as Record<string, unknown>
    delete drafts[drillCode]
    store.setItem(DRAFT_KEY, JSON.stringify(drafts))
  } catch {
    store.removeItem(DRAFT_KEY)
  }
}

function validatePayload(input: { drillCode: string; conclusion: string; participants: string | number }):
  | { ok: true; payload: EvalPayload }
  | { ok: false; message: string } {
  const drillCode = input.drillCode.trim()
  if (!drillCode) {
    return { ok: false, message: '演练编号不能为空' }
  }
  const conclusion = input.conclusion.trim()
  if (!conclusion) {
    return { ok: false, message: '评估结论不能为空' }
  }
  const participants = Number(String(input.participants).trim())
  if (!Number.isInteger(participants) || participants < PARTICIPANT_MIN || participants > PARTICIPANT_MAX) {
    return {
      ok: false,
      message: `参演人数超出有效范围（${PARTICIPANT_MIN}–${PARTICIPANT_MAX} 人），按无效处理，本次评估未落库`,
    }
  }
  return { ok: true, payload: { drillCode, conclusion, participants } }
}

// 第一步：评估结论与参演人数落到演练记录上（按演练编号 upsert，只挂一条）。
function upsertDrillRow(payload: EvalPayload): void {
  const meta = moduleMeta('drill')
  const rows = listRows('drill')
  const index = rows.findIndex((row) => String(row['演练编号']) === payload.drillCode)
  const base: EntryRow = index >= 0
    ? rows[index]
    : {
        id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
        status: '已组织',
        pending: true,
        abnormal: false,
        演练编号: payload.drillCode,
        演练主题: '—',
        参演队伍: '—',
        演练日期: '—',
        演练科目: '—',
      }
  const current = String(base.status)
  if (current !== '已组织' && current !== '已评估') {
    throw new Error(`演练 ${payload.drillCode} 当前状态「${current}」不能提交评估，状态只能按顺序流转`)
  }
  const updated: EntryRow = {
    ...base,
    status: '已评估',
    演练状态: '已评估',
    评估结论: payload.conclusion,
    参演人数: payload.participants,
    pending: false,
    abnormal: false,
  }
  const next = [...rows]
  if (index >= 0) {
    next[index] = updated
  } else {
    next.push(updated)
  }
  saveRows(meta.key, next)
}

// 隐患点台账里的重评项编号：一条演练只对应一条重评项。
export function reviewItemCode(drillCode: string): string {
  return `REEV-${drillCode}`
}

// 第二步：评估结果落到隐患点建档台账，添上一条重评项（按 REEV-演练编号 upsert）。
function upsertHazardReview(payload: EvalPayload): void {
  const rows = listRows('hazard')
  const drill = listRows('drill').find((row) => String(row['演练编号']) === payload.drillCode)
  const code = reviewItemCode(payload.drillCode)
  const index = rows.findIndex((row) => String(row['隐患编号']) === code)
  const item: EntryRow = {
    id: index >= 0 ? rows[index].id : rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
    status: '待核查',
    pending: true,
    abnormal: false,
    隐患编号: code,
    所在乡镇: String(drill?.['演练主题'] ?? '—'),
    灾害类型: '演练评估重评',
    坡体规模: '—',
    威胁户数: '—',
    威胁人数: payload.participants,
    发现日期: String(drill?.['演练日期'] ?? '—'),
    隐患状态: '重评中',
    来源演练编号: payload.drillCode,
    评估结论: payload.conclusion,
  }
  const next = [...rows]
  if (index >= 0) {
    next[index] = item
  } else {
    next.push(item)
  }
  saveRows('hazard', next)
}

const EVAL_STEPS: [string, (payload: EvalPayload) => void][] = [
  ['演练记录', upsertDrillRow],
  ['隐患点台账重评项', upsertHazardReview],
]

function runJournal(journal: EvalJournal): ActionResult {
  for (const [name, run] of EVAL_STEPS) {
    if (journal.done.includes(name)) {
      continue
    }
    try {
      run(journal.payload)
    } catch (error) {
      // 已完成的步留在 journal 里，重试从断掉的这一步接着走，已填内容不丢。
      writeJournal(journal)
      const reason = error instanceof Error ? error.message : '未知原因'
      return { ok: false, message: `评估提交在「${name}」一步中断：${reason}。已填内容已保留，可重试。` }
    }
    journal.done.push(name)
    writeJournal(journal)
  }
  clearJournal()
  clearEvalDraft(journal.payload.drillCode)
  return { ok: true, message: `演练 ${journal.payload.drillCode} 评估已提交，当前状态「已评估」` }
}

export function submitEvaluation(input: {
  drillCode: string
  conclusion: string
  participants: string | number
}): ActionResult {
  const validation = validatePayload(input)
  if (!validation.ok) {
    return validation
  }
  const payload = validation.payload
  // 同一条演练、同一份内容：接着上次的 checkpoint 走；内容变了就重头落一遍（每步幂等）。
  const existing = readJournal()
  const done =
    existing &&
    existing.payload.drillCode === payload.drillCode &&
    existing.payload.conclusion === payload.conclusion &&
    existing.payload.participants === payload.participants
      ? existing.done
      : []
  return runJournal({ payload, done, updatedAt: new Date().toISOString() })
}

// 页面打开时调用：上次没提交完的评估，从断掉的那一步接着落库。
export function resumePendingEvaluation(): ActionResult | null {
  const journal = readJournal()
  if (!journal) {
    return null
  }
  return runJournal(journal)
}

// 评估退回：一次落库。状态回「已组织」、清空本次评估结论与参演人数、
// 撤掉隐患点台账里的重评项，两块数据合并成一次写入，看板和详情读到的都是这一条。
export function rejectEvaluation(id: number): ActionResult {
  const drills = listRows('drill')
  const index = drills.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的应急演练` }
  }
  const row = drills[index]
  if (String(row.status) !== '已评估') {
    return { ok: false, message: `只有「已评估」的演练才能退回评估，当前状态「${row.status}」` }
  }
  const drillCode = String(row['演练编号'] ?? '')
  const reverted: EntryRow = {
    ...row,
    status: '已组织',
    演练状态: '已组织',
    评估结论: '',
    参演人数: '',
    pending: true,
    abnormal: false,
  }
  const nextDrills = [...drills]
  nextDrills[index] = reverted
  const reviewCode = reviewItemCode(drillCode)
  const nextHazards = listRows('hazard').filter((item) => String(item['隐患编号']) !== reviewCode)
  saveModules({ drill: nextDrills, hazard: nextHazards })
  clearEvalDraft(drillCode)
  return { ok: true, message: `演练 ${drillCode} 评估已退回，本次评估结论与参演人数已清空` }
}

// —— 读侧：所有入口都读同一份演练记录 ——
export function getDrill(id: number): EntryRow | null {
  return listRows('drill').find((row) => Number(row.id) === id) ?? null
}

export function listEvaluatedDrills(): EntryRow[] {
  return listRows('drill').filter((row) => String(row.status) === '已评估')
}

export function drillStats(rows: EntryRow[]): { label: string; value: number }[] {
  return [
    { label: '待组织演练', value: rows.filter((row) => String(row.status) === '待组织').length },
    { label: '已评估演练', value: rows.filter((row) => String(row.status) === '已评估').length },
    { label: '参演人数合计', value: sumParticipants(rows) },
  ]
}

export function downloadDrillExport(): void {
  const meta = moduleMeta('drill')
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows('drill')) {
    const cells = meta.fields.map((field) => (field === '参演人数' ? formatParticipants(row) : row[field] ?? ''))
    lines.push([row.id, ...cells, row.status].join(','))
  }
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${meta.name}-清单.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

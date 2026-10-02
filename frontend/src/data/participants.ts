import { activeRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

/**
 * 参演人数统一取数入口：
 * 列表页、看板、详情弹窗、大屏、统计卡片都走这里，不再各取各的。
 * 权威来源是演练登记记录上的结构化「参演人数」字段（整数）。
 */
export const PARTICIPANT_MIN = 1
export const PARTICIPANT_MAX = 9999

/** 解析参演人数：非整数、越界一律按无效处理（null），绝不参与合计。 */
export function parseParticipantCount(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= PARTICIPANT_MIN && raw <= PARTICIPANT_MAX ? raw : null
  }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!/^\d+$/.test(text)) {
      return null
    }
    const value = Number(text)
    return value >= PARTICIPANT_MIN && value <= PARTICIPANT_MAX ? value : null
  }
  return null
}

export function participantCount(row: EntryRow): number | null {
  return parseParticipantCount(row['参演人数'])
}

/** 入口统一的合计口径：无效值跳过，不计入总数。 */
export function totalParticipants(rows: EntryRow[] = activeRows('drill')): number {
  return rows.reduce((sum, row) => sum + (participantCount(row) ?? 0), 0)
}

/**
 * 参演人数与评估结论冲突时的判定口径（明确写清楚）：
 * - 以演练记录上结构化「参演人数」字段为准，评估结论是文字意见，不得反写人数；
 * - 结构化人数缺失/越域（无效）时，结论文本里即使写了人数也不采纳，按「未登记有效人数」处理；
 * - 返回 { conflict: true } 表示结论文本里出现了数字且与登记人数不一致，仅作提示，不改变权威值。
 */
export function countConclusionConflict(row: EntryRow): { count: number | null; textCount: number | null; conflict: boolean } {
  const count = participantCount(row)
  const conclusion = String(row['评估结论'] ?? '')
  const matched = conclusion.match(/\d+/)
  const textCount = matched ? parseParticipantCount(matched[0]) : null
  const conflict = textCount !== null && count !== null && textCount !== count
  return { count, textCount, conflict }
}

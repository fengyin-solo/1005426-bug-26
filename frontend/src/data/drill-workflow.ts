import { activeRows, state } from '@/data/local-store'
import { clearDraft } from '@/data/eval-draft'
import { beginJournal, runJournal, type TxStep } from '@/data/transaction'
import { parseParticipantCount, PARTICIPANT_MAX, PARTICIPANT_MIN } from '@/data/participants'
import type { EntryRow } from '@/data/types'

export const DRILL_KEY = 'drill'
export const HAZARD_KEY = 'hazard'

// 状态只能按顺序流转：待组织 → 已组织 → 已评估；已取消为终态。
// 唯一允许的反向操作是「退回评估」：已评估 → 已组织（由独立事务处理）。
export const DRILL_STATUSES = ['待组织', '已组织', '已评估', '已取消'] as const
const CANCEL_STATUS = '已取消'

/** 每个动作允许的出发状态；不在表里的次序一律拒掉。 */
const FORWARD_RULES: Record<string, { from: string[]; to: string }> = {
  确认组织: { from: ['待组织'], to: '已组织' },
  提交评估: { from: ['已组织'], to: '已评估' },
  取消演练: { from: ['待组织', '已组织'], to: CANCEL_STATUS },
}

function findDrill(id: number): EntryRow | undefined {
  return activeRows(DRILL_KEY).find((row) => Number(row.id) === id)
}

export function reevalBizNo(drillNo: string): string {
  return `REEV-${drillNo}`
}

export type WorkflowResult = { ok: boolean; message: string }
export type EvalInput = { conclusion: string; participantCount: string }

function submitSteps(id: number, drillNo: string, drillSubject: string, input: EvalInput, count: number): TxStep[] {
  return [
    {
      name: '评估结论与参演人数落到演练记录',
      run: ({ updateById }) => {
        updateById(DRILL_KEY, id, {
          评估结论: input.conclusion,
          参演人数: count,
          演练状态: '已评估',
          status: '已评估',
          pending: false,
          abnormal: false,
        })
      },
    },
    {
      name: '隐患点建档台账挂重评项',
      run: ({ upsertRow }) => {
        // 同一演练编号走两次评估：按重评编号 upsert，台账只挂一条，不会多出。
        upsertRow(HAZARD_KEY, '隐患编号', reevalBizNo(drillNo), {
          所在乡镇: '应急演练重评',
          灾害类型: '演练评估重评项',
          坡体规模: '—',
          威胁户数: 0,
          威胁人数: 0,
          发现日期: new Date().toISOString().slice(0, 10),
          隐患状态: '重点防范',
          status: '重点防范',
          pending: false,
          abnormal: false,
          active: true,
          隐患编号: reevalBizNo(drillNo),
          重评项: '是',
          来源演练编号: drillNo,
          来源演练主题: drillSubject,
          重评结论: input.conclusion,
        })
      },
    },
  ]
}

function returnSteps(id: number, drillNo: string): TxStep[] {
  return [
    {
      name: '清空评估结论与参演人数并退回已组织',
      run: ({ updateById }) => {
        updateById(DRILL_KEY, id, {
          评估结论: '',
          参演人数: '',
          演练状态: '已组织',
          status: '已组织',
          pending: true,
          abnormal: false,
        })
      },
    },
    {
      name: '撤下隐患台账重评项',
      run: ({ deactivateByBiz }) => {
        deactivateByBiz(HAZARD_KEY, '隐患编号', reevalBizNo(drillNo))
      },
    },
  ]
}

function transitionSteps(id: number, to: string): TxStep[] {
  return [
    {
      name: '更新演练状态',
      run: ({ updateById }) => {
        updateById(DRILL_KEY, id, {
          status: to,
          演练状态: to,
          pending: to !== '已评估' && to !== CANCEL_STATUS,
          abnormal: false,
        })
      },
    },
  ]
}

/** 普通顺序流转：先校验次序，再按一次落库提交（日志保证中断可续跑）。 */
export function transitionDrill(id: number, action: string): WorkflowResult {
  const rule = FORWARD_RULES[action]
  if (!rule) {
    return { ok: false, message: `应急演练没有登记「${action}」这个动作` }
  }
  const target = findDrill(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的应急演练` }
  }
  const current = String(target.status)
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      message: `状态只能按 待组织→已组织→已评估（→已取消） 顺序流转，当前「${current}」不能执行「${action}」`,
    }
  }

  const txId = `drill-transition-${action}-${id}`
  const journal = beginJournal('drill', { txId, action: 'transition', flow: action, drillId: id })
  runJournal(journal, transitionSteps(id, rule.to))
  return { ok: true, message: `应急演练已${action}，当前状态「${rule.to}」` }
}

/**
 * 提交评估（一次落库，两步）：
 * 1) 演练记录本身上结论与人数、置为「已评估」——读的时候永远以这同一份记录为准；
 * 2) 隐患点建档台账挂/更新一条重评项（业务键 REEV-演练编号，连提两次也只挂一条）。
 */
export function submitEvaluation(id: number, input: EvalInput): WorkflowResult {
  const target = findDrill(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的应急演练` }
  }
  const current = String(target.status)
  if (current !== '已组织') {
    return { ok: false, message: `只有「已组织」的演练才能提交评估，当前「${current}」` }
  }
  const conclusion = input.conclusion.trim()
  if (!conclusion) {
    return { ok: false, message: '评估结论不能为空' }
  }
  const count = parseParticipantCount(input.participantCount)
  if (count === null) {
    return {
      ok: false,
      message: `参演人数无效：需为 ${PARTICIPANT_MIN}~${PARTICIPANT_MAX} 的整数，超出范围按无效处理`,
    }
  }

  const drillNo = String(target['演练编号'])
  const drillSubject = String(target['演练主题'] ?? '')
  const payload = { action: 'submit-eval', drillId: id, drillNo, conclusion, participantCount: String(count) }
  const journal = beginJournal('drill', { txId: `drill-eval-${id}`, ...payload })
  runJournal(journal, submitSteps(id, drillNo, drillSubject, { conclusion, participantCount: String(count) }, count))
  clearDraft(drillNo)
  return { ok: true, message: `评估已提交，演练「${drillNo}」状态为「已评估」，隐患台账已挂重评项` }
}

/**
 * 退回评估（一次落库，两步同时回滚）：
 * 1) 演练记录清空本次评估结论与参演人数，状态回到「已组织」——重新打开读的就是退回后的同一份；
 * 2) 隐患台账里对应的重评项撤下，看板不会再挂着作废结论。
 */
export function returnEvaluation(id: number): WorkflowResult {
  const target = findDrill(id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的应急演练` }
  }
  const current = String(target.status)
  if (current !== '已评估') {
    return { ok: false, message: `只有「已评估」的演练能退回，当前「${current}」` }
  }

  const drillNo = String(target['演练编号'])
  const journal = beginJournal('drill', { txId: `drill-return-${id}`, action: 'return-eval', drillId: id, drillNo })
  runJournal(journal, returnSteps(id, drillNo))
  clearDraft(drillNo)
  return { ok: true, message: `评估已退回：「${drillNo}」的结论与参演人数已清空，台账重评项已撤下` }
}

/** 启动续跑：把上次中断在半路的评估提交/退回事务，按日志从断掉那一步走完。 */
export function recoverInterrupted(): string[] {
  const messages: string[] = []
  for (const journal of state().journal) {
    if (journal.kind !== 'drill') {
      continue
    }
    const payload = journal.payload as {
      action?: string
      drillId?: number
      drillNo?: string
      flow?: string
      conclusion?: string
      participantCount?: string
    }
    const id = Number(payload.drillId)
    if (!id) {
      continue
    }
    const target = activeRows(DRILL_KEY).find((row) => Number(row.id) === id)
    const drillNo = payload.drillNo ?? String(target?.['演练编号'] ?? '')

    if (payload.action === 'submit-eval') {
      const count = parseParticipantCount(payload.participantCount)
      runJournal(
        { ...journal, payload: { ...journal.payload, txId: journal.id } },
        submitSteps(
          id,
          drillNo,
          String(target?.['演练主题'] ?? ''),
          { conclusion: String(payload.conclusion ?? ''), participantCount: String(count ?? '') },
          count ?? 0,
        ),
      )
      messages.push(`上次中断的评估提交已从断点续跑完成（演练 ${drillNo}）`)
    } else if (payload.action === 'return-eval') {
      runJournal({ ...journal, payload: { ...journal.payload, txId: journal.id } }, returnSteps(id, drillNo))
      messages.push(`上次中断的评估退回已从断点续跑完成（演练 ${drillNo}）`)
    } else if (payload.action === 'transition' && payload.flow) {
      const rule = FORWARD_RULES[payload.flow]
      if (rule) {
        runJournal({ ...journal, payload: { ...journal.payload, txId: journal.id } }, transitionSteps(id, rule.to))
        messages.push(`上次中断的「${payload.flow}」已从断点续跑完成（演练 ${drillNo}）`)
      }
    }
  }
  return messages
}

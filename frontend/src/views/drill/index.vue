<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">
          状态按 待组织→已组织→已评估（→已取消）顺序流转；评估退回后清空本次结论与参演人数，以演练记录为唯一准数。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :class="{ primary: viewMode === 'list' }" @click="viewMode = 'list'">列表视图</button>
        <button class="btn" type="button" :class="{ primary: viewMode === 'board' }" @click="viewMode = 'board'">看板视图</button>
        <button class="btn" type="button" @click="exportRows">导出应急演练清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待组织演练</span>
        <strong class="stat-value">{{ summary.pendingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已评估演练</span>
        <strong class="stat-value">{{ summary.evaluatedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">参演人数合计（统一口径）</span>
        <strong class="stat-value">{{ summary.participantTotal }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in summary.byStatus" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 列表视图 -->
    <table v-if="viewMode === 'list'" class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <button v-if="column === '演练编号'" class="link" type="button" @click="openDetail(row)">
              {{ row[column] || '—' }}
            </button>
            <template v-else>
              <span v-if="column === '参演人数'">{{ displayCount(row) }}</span>
              <span v-else>{{ row[column] ? row[column] : '—' }}</span>
            </template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据</td>
        </tr>
      </tbody>
    </table>

    <!-- 看板视图：与列表、详情、大屏同一份数据，作废结论不会挂上来 -->
    <div v-else class="board">
      <article v-for="bucket in boardBuckets" :key="bucket.status" class="board-col">
        <header class="board-head">
          <strong>{{ bucket.status }}</strong>
          <span class="board-count">{{ bucket.rows.length }}</span>
        </header>
        <div
          v-for="row in bucket.rows"
          :key="String(row.id)"
          class="board-card"
          :class="{ invalid: participantCount(row) === null }"
          @click="openDetail(row)"
        >
          <p class="card-no">{{ row['演练编号'] }}</p>
          <p class="card-subject">{{ row['演练主题'] }}</p>
          <p class="card-meta">参演：<strong>{{ displayCount(row) }}</strong> 人</p>
          <p v-if="row['评估结论']" class="card-conclusion">结论：{{ row['评估结论'] }}</p>
          <p v-else class="card-muted">暂无评估结论</p>
        </div>
        <p v-if="!bucket.rows.length" class="board-empty">—</p>
      </article>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条演练记录 · 参演人数以登记表结构化字段为准（{{ PARTICIPANT_MIN }}~{{ PARTICIPANT_MAX }} 人，越界按无效处理），评估结论文字不反写人数</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 评估弹窗：填写中自动暂存草稿，中断/刷新不丢 -->
    <div v-if="evalTarget" class="modal-mask" @click.self="closeEval">
      <div class="modal">
        <header class="modal-head">
          <h3>提交评估：{{ evalTarget['演练编号'] }}</h3>
          <button class="link" type="button" @click="closeEval">关闭</button>
        </header>
        <div class="modal-body">
          <label class="form-item">
            <span>评估结论</span>
            <textarea v-model="evalForm.conclusion" rows="4" placeholder="填写本次演练的评估结论"></textarea>
          </label>
          <label class="form-item">
            <span>参演人数（{{ PARTICIPANT_MIN }}~{{ PARTICIPANT_MAX }} 的整数）</span>
            <input v-model="evalForm.participantCount" placeholder="如 58" />
            <small v-if="countHint" class="form-hint" :class="{ bad: countInvalid }">{{ countHint }}</small>
          </label>
          <p v-if="draftSavedAt" class="draft-tip">草稿已自动暂存：{{ draftSavedAt }}，中断后重开可继续填写</p>
        </div>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="closeEval">取消</button>
          <button class="btn primary" type="button" @click="confirmEval">提交评估（一次落库）</button>
        </footer>
      </div>
    </div>

    <!-- 详情弹窗：直接读列表那一行，不复制第二份结论 -->
    <div v-if="detailTarget" class="modal-mask" @click.self="detailTarget = null">
      <div class="modal">
        <header class="modal-head">
          <h3>演练详情：{{ detailTarget['演练编号'] }}</h3>
          <button class="link" type="button" @click="detailTarget = null">关闭</button>
        </header>
        <div class="modal-body">
          <dl class="detail-list">
            <div v-for="column in columns" :key="column" class="detail-row">
              <dt>{{ column }}</dt>
              <dd v-if="column === '参演人数'">{{ displayCount(detailTarget) }}</dd>
              <dd v-else>{{ detailTarget[column] ? detailTarget[column] : '—' }}</dd>
            </div>
            <div class="detail-row">
              <dt>当前状态</dt>
              <dd>{{ detailTarget.status }}</dd>
            </div>
          </dl>
          <p v-if="conflictInfo.conflict" class="form-hint bad">
            提示：结论文字中的人数（{{ conflictInfo.textCount }}）与登记人数（{{ conflictInfo.count }}）不一致，以登记人数 {{ conflictInfo.count }} 为准。
          </p>
        </div>
        <footer class="modal-foot">
          <button
            v-for="action in actionsFor(detailTarget)"
            :key="action"
            class="btn"
            :class="{ primary: action === '提交评估' }"
            type="button"
            @click="runAction(action, detailTarget)"
          >
            {{ action }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import { downloadEntries, drillSummary, listEntries, moduleMeta } from '@/api/local-service'
import { activeRows } from '@/data/local-store'
import { loadDraft, saveDraft } from '@/data/eval-draft'
import {
  countConclusionConflict,
  participantCount,
  PARTICIPANT_MAX,
  PARTICIPANT_MIN,
  parseParticipantCount,
} from '@/data/participants'
import {
  DRILL_STATUSES,
  recoverInterrupted,
  returnEvaluation,
  submitEvaluation,
  transitionDrill,
} from '@/data/drill-workflow'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('drill')
const columns = ['演练编号', '演练主题', '参演队伍', '参演人数', '演练日期', '演练科目', '评估结论', '演练状态']
const filterFields = columns.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const viewMode = ref<'list' | 'board'>('list')

const detailTarget = ref<EntryRow | null>(null)
const evalTarget = ref<EntryRow | null>(null)
const evalForm = reactive({ conclusion: '', participantCount: '' })
const draftSavedAt = ref('')

function refreshSummary() {
  return drillSummary()
}
const summary = ref(refreshSummary())

const boardBuckets = computed(() =>
  [...DRILL_STATUSES].map((status) => ({
    status,
    rows: rows.value.filter((row) => String(row.status) === status),
  })),
)

const countInvalid = computed(() => evalForm.participantCount.trim() !== '' && parseParticipantCount(evalForm.participantCount) === null)
const countHint = computed(() => {
  if (evalForm.participantCount.trim() === '') {
    return ''
  }
  return countInvalid.value
    ? `人数无效：须为 ${PARTICIPANT_MIN}-${PARTICIPANT_MAX} 的整数，当前按无效处理，不能提交。`
    : '人数有效。'
})

const conflictInfo = computed(() =>
  detailTarget.value
    ? countConclusionConflict(detailTarget.value)
    : { count: null, textCount: null, conflict: false },
)

function actionsFor(row: EntryRow): string[] {
  switch (String(row.status)) {
    case '待组织':
      return ['确认组织', '取消演练']
    case '已组织':
      return ['提交评估', '取消演练']
    case '已评估':
      return ['退回评估']
    default:
      return []
  }
}

function displayCount(row: EntryRow): string {
  const value = participantCount(row)
  return value === null ? '无效（未计入）' : String(value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDetail(row: EntryRow) {
  detailTarget.value = row
}

function openEval(row: EntryRow) {
  evalTarget.value = row
  const draft = loadDraft(String(row['演练编号']))
  evalForm.conclusion = draft?.conclusion ?? ''
  evalForm.participantCount = draft?.participantCount ?? (participantCount(row)?.toString() ?? '')
  draftSavedAt.value = draft?.savedAt ? new Date(draft.savedAt).toLocaleString() : ''
}

function closeEval() {
  evalTarget.value = null
  draftSavedAt.value = ''
}

watch(
  () => [evalForm.conclusion, evalForm.participantCount],
  () => {
    if (!evalTarget.value) {
      return
    }
    const drillNo = String(evalTarget.value['演练编号'])
    if (evalForm.conclusion.trim() === '' && evalForm.participantCount.trim() === '') {
      return
    }
    const saved = saveDraft(drillNo, {
      conclusion: evalForm.conclusion,
      participantCount: evalForm.participantCount,
    })
    draftSavedAt.value = new Date(saved.savedAt).toLocaleString()
  },
)

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  if (action === '提交评估') {
    detailTarget.value = null
    openEval(row)
    return
  }
  const result =
    action === '退回评估'
      ? returnEvaluation(Number(row.id))
      : transitionDrill(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  detailTarget.value = null
  reload()
}

function confirmEval() {
  if (!evalTarget.value) {
    return
  }
  const result = submitEvaluation(Number(evalTarget.value.id), {
    conclusion: evalForm.conclusion,
    participantCount: evalForm.participantCount,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  closeEval()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = drillSummary()
    if (detailTarget.value) {
      const latest = activeRows(meta.key).find((row) => Number(row.id) === Number(detailTarget.value!.id))
      detailTarget.value = latest ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急演练列表读取失败'
  }
}

onMounted(() => {
  // 上次提交/退回事务在半路中断（如页面被关掉）：启动时按日志从断点续跑，不丢已填内容。
  const recovered = recoverInterrupted()
  reload()
  if (recovered.length > 0) {
    errorMessage.value = recovered.join('；')
  }
})
</script>

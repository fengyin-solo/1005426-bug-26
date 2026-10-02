<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">维护应急演练，围绕演练编号、演练主题、参演队伍、参演人数做登记、筛选与状态流转。</p>
        <p class="page-desc">
          参演人数有效范围 {{ participantRange }}，超出按无效处理；参演人数与评估结论不一致时，以落库的参演人数为准。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记应急演练</button>
        <button class="btn" type="button" @click="exportRows">导出应急演练清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p v-if="resumeMessage" class="resume-hint">{{ resumeMessage }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
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
            {{ column === '参演人数' ? displayParticipants(row) : row[column] || '—' }}
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
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据，可先登记应急演练</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急演练记录</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="evalTarget" class="modal-mask" @click.self="closeEval">
      <div class="modal-box">
        <h3>提交评估 · {{ evalTarget['演练编号'] }}</h3>
        <p class="modal-desc">{{ evalTarget['演练主题'] }}（{{ evalTarget['参演队伍'] }}）</p>
        <label class="form-item">
          <span>评估结论</span>
          <textarea v-model="evalForm.conclusion" rows="4" placeholder="填写本次演练的评估结论"></textarea>
        </label>
        <label class="form-item">
          <span>参演人数</span>
          <input v-model="evalForm.participants" type="number" min="1" placeholder="填写实际参演人数" />
        </label>
        <p class="modal-desc">
          参演人数有效范围 {{ participantRange }}，超出按无效处理；与评估结论不一致时以落库的参演人数为准。
          填写内容实时保存，中途中断再打开可接着填。
        </p>
        <p v-if="evalError" class="error-text">{{ evalError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="submitEval">提交评估</button>
          <button class="btn ghost" type="button" @click="closeEval">暂不提交</button>
        </div>
      </div>
    </div>

    <div v-if="detailRow" class="modal-mask" @click.self="detailRow = null">
      <div class="modal-box">
        <h3>演练详情 · {{ detailRow['演练编号'] }}</h3>
        <dl class="detail-list">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ column === '参演人数' ? displayParticipants(detailRow) : detailRow[column] || '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detailRow.status }}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="detailRow = null">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import {
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  PARTICIPANT_MAX,
  PARTICIPANT_MIN,
  downloadDrillExport,
  drillStats,
  formatParticipants,
  getDrill,
  loadEvalDraft,
  rejectEvaluation,
  resumePendingEvaluation,
  saveEvalDraft,
  submitEvaluation,
} from '@/api/drill-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('drill')
const columns = ["演练编号", "演练主题", "参演队伍", "参演人数", "演练日期", "演练科目", "评估结论", "演练状态"]
const statuses = ["待组织", "已组织", "已评估", "已取消"]
// 状态只能按顺序流转，每个状态只给该走的动作。
const ACTIONS_BY_STATUS: Record<string, string[]> = {
  待组织: ["确认组织", "取消演练", "详情"],
  已组织: ["提交评估", "取消演练", "详情"],
  已评估: ["退回评估", "详情"],
  已取消: ["详情"],
}
const participantRange = `${PARTICIPANT_MIN}–${PARTICIPANT_MAX} 人`

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const resumeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const evalTarget = ref<EntryRow | null>(null)
const evalForm = reactive({ conclusion: '', participants: '' })
const evalError = ref('')
const detailRow = ref<EntryRow | null>(null)

const stats = computed(() => drillStats(rows.value))
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function actionsFor(row: EntryRow): string[] {
  return ACTIONS_BY_STATUS[String(row.status)] ?? ["详情"]
}

function displayParticipants(row: EntryRow): string {
  return formatParticipants(row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadDrillExport()
}

function openCreate() {
  errorMessage.value = '应急演练登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  if (action === '提交评估') {
    openEval(row)
    return
  }
  if (action === '退回评估') {
    const result = rejectEvaluation(Number(row.id))
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    infoMessage.value = result.message
    reload()
    return
  }
  if (action === '详情') {
    // 详情读的是同一份演练记录，不另拷一份。
    detailRow.value = getDrill(Number(row.id))
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  reload()
}

function openEval(row: EntryRow) {
  evalTarget.value = row
  evalError.value = ''
  // 中途中断不丢已填内容：打开时先恢复上次没提交的草稿。
  const draft = loadEvalDraft(String(row['演练编号']))
  evalForm.conclusion = draft?.conclusion ?? String(row['评估结论'] ?? '')
  evalForm.participants = draft?.participants ?? ''
}

function closeEval() {
  evalTarget.value = null
  evalError.value = ''
}

watch(evalForm, () => {
  if (evalTarget.value) {
    saveEvalDraft(String(evalTarget.value['演练编号']), { ...evalForm })
  }
})

function submitEval() {
  if (!evalTarget.value) {
    return
  }
  evalError.value = ''
  const result = submitEvaluation({
    drillCode: String(evalTarget.value['演练编号']),
    conclusion: evalForm.conclusion,
    participants: evalForm.participants,
  })
  if (!result.ok) {
    // 失败不丢内容：草稿与断点都在，改完再点提交就从断掉那步接着走。
    evalError.value = result.message
    return
  }
  infoMessage.value = result.message
  closeEval()
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急演练列表读取失败'
  }
}

onMounted(() => {
  // 上次没提交完的评估，从断掉的那一步接着落库。
  const resumed = resumePendingEvaluation()
  if (resumed) {
    resumeMessage.value = resumed.ok ? `已续传上次中断的评估：${resumed.message}` : resumed.message
  }
  reload()
})
</script>

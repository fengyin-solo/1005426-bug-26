<template>
  <section class="screen">
    <header class="screen-head">
      <h2>应急演练监测大屏</h2>
      <span class="head-sub">数据与应急演练列表页同一份 · 刷新时间 {{ refreshedAt }}</span>
    </header>

    <div class="screen-grid">
      <article class="screen-card">
        <strong>{{ summary.byStatus[0]?.count ?? 0 }}</strong>
        <span>待组织</span>
      </article>
      <article class="screen-card">
        <strong>{{ summary.byStatus[1]?.count ?? 0 }}</strong>
        <span>已组织</span>
      </article>
      <article class="screen-card">
        <strong>{{ summary.evaluatedCount }}</strong>
        <span>已评估</span>
      </article>
      <article class="screen-card">
        <strong>{{ summary.participantTotal }}</strong>
        <span>参演人数合计（统一口径）</span>
      </article>
    </div>

    <div class="screen-board">
      <article v-for="bucket in buckets" :key="bucket.status" class="screen-col">
        <h4>
          <span>{{ bucket.status }}</span>
          <span>{{ bucket.rows.length }}</span>
        </h4>
        <div v-for="row in bucket.rows" :key="String(row.id)" class="screen-item">
          <p class="no">{{ row['演练编号'] }}</p>
          <p>{{ row['演练主题'] }}</p>
          <p>参演：{{ countText(row) }} 人 · {{ row['演练日期'] }}</p>
          <p v-if="row['评估结论']">结论：{{ row['评估结论'] }}</p>
          <p v-else style="color:#64748b">暂无评估结论</p>
        </div>
        <p v-if="!bucket.rows.length" style="color:#64748b;text-align:center">—</p>
      </article>
    </div>

    <footer class="page-foot" style="color:#94a3b8;margin-top:12px">
      <span>规则：状态只能 待组织→已组织→已评估 顺序流转；参演人数取登记表结构化字段（1~9999），越界按无效处理；结论与人数冲突时以登记人数为准。</span>
      <button class="btn" type="button" @click="reload">刷新数据</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { drillSummary, listEntries } from '@/api/local-service'
import { DRILL_STATUSES } from '@/data/drill-workflow'
import { participantCount } from '@/data/participants'
import type { EntryRow } from '@/data/types'

const rows = ref<EntryRow[]>([])
const summary = ref(drillSummary())
const refreshedAt = ref('')
let timer: number | undefined

const buckets = computed(() =>
  [...DRILL_STATUSES].map((status) => ({
    status,
    rows: rows.value.filter((row) => String(row.status) === status),
  })),
)

function countText(row: EntryRow): string {
  const value = participantCount(row)
  return value === null ? '无效' : String(value)
}

function reload() {
  rows.value = listEntries('drill').items
  summary.value = drillSummary()
  refreshedAt.value = new Date().toLocaleTimeString()
}

onMounted(() => {
  reload()
  timer = window.setInterval(reload, 10000)
})

onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer)
  }
})
</script>

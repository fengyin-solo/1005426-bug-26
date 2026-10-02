<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>

    <header class="page-head">
      <div>
        <h2>应急演练评估</h2>
        <p class="page-desc">与应急演练列表页读同一份记录，评估退回后这里同步不再展示。</p>
      </div>
    </header>
    <table class="data-table">
      <thead>
        <tr><th>演练编号</th><th>演练主题</th><th>评估结论</th><th>参演人数</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in evaluatedDrills" :key="String(row.id)">
          <td>{{ row['演练编号'] }}</td>
          <td>{{ row['演练主题'] }}</td>
          <td>{{ row['评估结论'] || '—' }}</td>
          <td>{{ displayParticipants(row) }}</td>
        </tr>
        <tr v-if="!evaluatedDrills.length">
          <td colspan="4" class="empty-state">暂无已评估的应急演练</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { formatParticipants, listEvaluatedDrills } from '@/api/drill-service'
import type { EntryRow, OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const evaluatedDrills = ref<EntryRow[]>([])

function displayParticipants(row: EntryRow): string {
  return formatParticipants(row)
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  evaluatedDrills.value = listEvaluatedDrills()
}

onMounted(refresh)
</script>

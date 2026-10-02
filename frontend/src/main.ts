import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { recoverInterrupted } from './data/drill-workflow'
import './styles/global.css'

// 启动先续跑：上次评估提交/退回若在半路中断，按事务日志从断掉那一步补齐。
recoverInterrupted()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

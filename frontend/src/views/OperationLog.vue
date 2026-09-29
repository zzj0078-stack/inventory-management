<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>操作日志</span>
          <el-button v-permission="'log:export'" @click="doExport"><el-icon><Download /></el-icon> 导出CSV</el-button>
        </div>
      </template>
      <el-form :inline="true" :model="sf">
        <el-form-item label="模块">
          <el-input v-model="sf.module" placeholder="模块名" clearable style="width:150px" />
        </el-form-item>
        <el-form-item><el-button type="primary" @click="load">查询</el-button></el-form-item>
      </el-form>
      <el-table :data="list" v-loading="loading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="username" label="操作人" width="110" />
        <el-table-column prop="module" label="模块" width="120" />
        <el-table-column prop="action" label="动作" width="130" />
        <el-table-column prop="target" label="对象" min-width="170">
          <template #default="{ row }">{{ row.target || '-' }}</template>
        </el-table-column>
        <el-table-column prop="detail" label="详情" min-width="150">
          <template #default="{ row }">{{ row.detail || '-' }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="时间" width="180">
          <template #default="{row}">{{ row.created_at ? new Date(row.created_at).toLocaleString() : '-' }}</template>
        </el-table-column>
        <template #empty>
          <div style="padding:24px 0;line-height:2;color:#909399">
            <div>暂无操作日志</div>
            <div style="font-size:12px">
              日志从后端启动后开始记录。执行任意「登录 / 新增 / 编辑 / 删除 / 审核 / 入库 / 出库」操作即会产生记录。<br/>
              若操作后仍无记录，请确认已执行 <b>restart_backend.bat</b> 重启后端。
            </div>
          </div>
        </template>
      </el-table>
      <el-pagination style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pg.page" v-model:page-size="pg.size"
        :total="pg.total" layout="total,prev,pager,next" @change="load" />
    </el-card>
  </div>
</template>
<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getLogs, downloadExport } from '../api/modules'
import { ElMessage } from 'element-plus'
const loading = ref(false), list = ref([])
const sf = reactive({ module: '' })
const pg = reactive({ page: 1, size: 20, total: 0 })
const load = async () => {
  loading.value = true
  try {
    const r = await getLogs({ page: pg.page, page_size: pg.size, module: sf.module || null })
    list.value = r.items; pg.total = r.total
  } finally { loading.value = false }
}
const doExport = async () => { await downloadExport('logs'); ElMessage.success('已导出') }
onMounted(() => load())
</script>
<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>

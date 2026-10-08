<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>数据自检</span>
          <div>
            <el-button v-if="fixableCount > 0" v-permission="'system:fix'" type="warning" :loading="fixing" @click="doFix">
              <el-icon><MagicStick /></el-icon> 一键修复（{{ fixableCount }} 项）
            </el-button>
            <el-button type="primary" :loading="loading" @click="load">
              <el-icon><Refresh /></el-icon> 重新检测
            </el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="result.ok && !result.warn_count"
        title="数据正常，未发现问题"
        type="success"
        :closable="false"
        show-icon
        style="margin-bottom:16px"
      />
      <el-alert
        v-else
        :title="`发现 ${result.error_count} 个错误、${result.warn_count} 个警告，其中 ${fixableCount} 项可自动修复`"
        :type="result.error_count ? 'error' : 'warning'"
        :closable="false"
        show-icon
        style="margin-bottom:16px"
      />

      <!-- 没有问题时不要渲染空表格：否则会同时出现
           「数据正常」提示 + 空表 + 「暂无问题」，看起来像坏了 -->
      <el-table
        v-if="result.issues.length"
        :data="result.issues"
        v-loading="loading"
        border
        stripe
        style="width:100%"
      >
        <el-table-column label="级别" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.level === 'error' ? 'danger' : 'warning'" size="small">
              {{ row.level === 'error' ? '错误' : '警告' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="table" label="数据表" width="170" />
        <el-table-column prop="message" label="问题" min-width="380" />
        <el-table-column prop="fix" label="建议处理" min-width="240" />
        <el-table-column label="可修复" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.fixable" type="success" size="small">可自动</el-tag>
            <el-tag v-else type="info" size="small">需人工</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && !result.issues.length" description="暂无问题" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getHealthCheck, fixHealthCheck } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const fixing = ref(false)
const result = reactive({
  ok: true, error_count: 0, warn_count: 0, fixable_count: 0, issues: []
})

/** 前端自行统计，兼容后端未返回 fixable_count 的情况 */
const fixableCount = computed(() =>
  (result.issues || []).filter(i => i.fixable).length
)

const load = async () => {
  loading.value = true
  try {
    const r = await getHealthCheck()
    Object.assign(result, r)
    result.issues = r.issues || []
  } finally {
    loading.value = false
  }
}

const doFix = async () => {
  try {
    await ElMessageBox.confirm(
      `<div style="line-height:1.9">
        将自动处理以下问题：<br/>
        • 删除指向已删除商品的孤儿库存记录<br/>
        • 按明细重算金额不符的单据<br/>
        <div style="margin-top:8px;color:#e6a23c">
          涉及业务单据的孤儿引用（订单指向已删除的供应商/客户）不会自动删除，需人工确认。
        </div>
      </div>`,
      '确认自动修复',
      { dangerouslyUseHTMLString: true, type: 'warning', confirmButtonText: '确认修复' }
    )
  } catch {
    return
  }

  fixing.value = true
  try {
    const r = await fixHealthCheck()
    if (r.fixed_count) {
      ElMessage.success(`已修复 ${r.fixed_count} 项`)
    } else {
      ElMessage.info('没有可自动修复的项目')
    }
    if (r.manual_count) {
      ElMessageBox.alert(
        `<div style="line-height:1.9">
          <div>仍有 <b style="color:#f56c6c">${r.manual_count}</b> 项需人工处理：</div>
          <ul style="margin:8px 0 0 18px;padding:0">
            ${r.manual.slice(0, 10).map(m => `<li>${m}</li>`).join('')}
          </ul>
          <div style="margin-top:8px;color:#909399">
            这些是历史单据引用了已删除的往来单位。处理方式：<br/>
            ① 重新创建同名供应商/客户并手动指定；② 或作废/删除这些历史单据。
          </div>
        </div>`,
        '剩余需人工处理',
        { dangerouslyUseHTMLString: true, confirmButtonText: '知道了' }
      ).catch(() => {})
    }
    await load()
  } finally {
    fixing.value = false
  }
}

onMounted(() => load())
</script>

<style scoped>
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>

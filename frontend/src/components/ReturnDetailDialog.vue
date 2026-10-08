<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="860px"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-loading="loading">
      <template v-if="detail">
        <!-- 表头：单号 + 状态 -->
        <div class="rd-head">
          <span class="rd-no">{{ detail.return_no }}</span>
          <el-tag :type="statusTag" size="small">{{ detail.status_text || '-' }}</el-tag>
        </div>

        <!-- 基本信息 -->
        <el-descriptions :column="2" border size="small" class="rd-desc">
          <el-descriptions-item :label="sourceLabel">
            <span :style="{ color: detail.source_order_no ? '' : '#e6a23c' }">
              {{ detail.source_order_no || '无来源' }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item :label="partyLabel">
            {{ partyName || '-' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="partyContact" label="联系人">
            {{ partyContact }}<span v-if="partyPhone"> · {{ partyPhone }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="退货原因">
            {{ detail.reason || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="partyContact ? 1 : 2">
            {{ fmtDateTime(detail.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.remark" label="备注" :span="2">
            {{ detail.remark }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 退货明细 -->
        <div class="rd-sub">
          退货明细
          <span class="rd-sub-hint">共 {{ items.length }} 项 · {{ totalQty }} 件</span>
        </div>
        <el-table :data="items" border stripe size="small" style="width:100%">
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column prop="product_name" label="商品名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ellipsis-cell">{{ row.product_name || ('商品#' + row.product_id) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="product_spec" label="规格/型号" min-width="110" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ellipsis-cell">{{ row.product_spec || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="product_unit" label="单位" width="60" align="center">
            <template #default="{ row }">{{ row.product_unit || '-' }}</template>
          </el-table-column>
          <el-table-column prop="quantity" label="退货数量" width="90" align="right" />
          <el-table-column label="单价" width="100" align="right">
            <template #default="{ row }">{{ money(row.price) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">{{ money(row.amount) }}</template>
          </el-table-column>
        </el-table>

        <!-- 合计 -->
        <div class="rd-total">
          合计数量：<b>{{ totalQty }}</b>　退货金额：<b class="rd-amt">¥{{ money(detail.total_amount) }}</b>
        </div>
      </template>

      <el-empty v-else-if="!loading" description="未能加载退货单详情" />
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 退货单详情（销售退货 / 采购退货共用）。
 *
 * 两个列表页的结构、接口形状、状态文案完全对称，只是往来单位叫法不同
 * （客户 / 供应商），所以做成一个组件，通过 detailApi 与几个文案参数区分。
 */
import { ref, computed, watch } from 'vue'
import { fmtDateTime, money } from '../utils/format'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 详情接口：传 id，返回退货单对象 */
  detailApi: { type: Function, required: true },
  /** 'sale' | 'purchase'，只用于文案与字段名 */
  kind: { type: String, default: 'sale' },
  /** 列表行，用于对话框打开时先渲染单号/状态，避免白屏 */
  row: { type: Object, default: null },
})

defineEmits(['update:modelValue'])

const loading = ref(false)
const detail = ref(null)

const isSale = computed(() => props.kind === 'sale')
const title = computed(() => (isSale.value ? '销售退货单详情' : '采购退货单详情'))
const sourceLabel = computed(() => (isSale.value ? '来源销售单' : '来源采购单'))
const partyLabel = computed(() => (isSale.value ? '客户' : '供应商'))

const partyName = computed(() =>
  isSale.value ? detail.value?.customer_name : detail.value?.supplier_name
)
const partyContact = computed(() =>
  isSale.value ? detail.value?.customer_contact : detail.value?.supplier_contact
)
const partyPhone = computed(() =>
  isSale.value ? detail.value?.customer_phone : detail.value?.supplier_phone
)

const items = computed(() => detail.value?.items || [])
const totalQty = computed(() => items.value.reduce((s, i) => s + Number(i.quantity || 0), 0))

/** 状态文案 → 标签色（与两个列表页一致） */
const TAGS = { 待审核: 'info', 已审核: 'warning', 已退货: 'success', 已作废: 'danger' }
const statusTag = computed(() => TAGS[detail.value?.status_text] || 'info')

async function load(id) {
  if (!id) return
  loading.value = true
  try {
    detail.value = await props.detailApi(id)
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    // 先用列表行占位渲染，再拉完整详情
    detail.value = props.row ? { ...props.row, items: [] } : null
    load(props.row?.id)
  }
)
</script>

<style scoped>
.rd-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.rd-no {
  font-size: 16px;
  font-weight: 600;
}
.rd-desc {
  margin-bottom: 16px;
}
.rd-sub {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.rd-sub-hint {
  font-size: 12px;
  font-weight: 400;
  color: #909399;
}
.rd-total {
  margin-top: 12px;
  text-align: right;
  font-size: 14px;
}
.rd-total b {
  font-size: 15px;
}
.rd-amt {
  color: #f56c6c;
}
</style>

<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>对账单</span>
          <div>
            <el-button :disabled="!data || !data.rows.length" @click="doPrint">
              <el-icon><Printer /></el-icon> 打印
            </el-button>
          </div>
        </div>
      </template>

      <el-form :inline="true" :model="qf">
        <el-form-item label="类型">
          <el-radio-group v-model="qf.side" @change="onSideChange">
            <el-radio-button value="customer">客户（应收）</el-radio-button>
            <el-radio-button value="supplier">供应商（应付）</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item :label="partyLabel">
          <el-select
            v-model="qf.partner_id"
            filterable
            clearable
            :placeholder="'请选择' + partyLabel"
            style="width: 240px"
          >
            <el-option v-for="p in partners" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="日期区间">
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            :clearable="true"
            style="width: 260px"
          />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="loading" @click="load">查询</el-button>
          <el-button @click="resetRange">全部期间</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="rangeHint"
        :title="rangeHint"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
      />

      <template v-if="data">
        <!-- 往来单位抬头 -->
        <div class="stmt-head">
          <div class="stmt-party">
            <span class="stmt-name">{{ data.partner.name }}</span>
            <span class="muted" v-if="data.partner.contact">　联系人：{{ data.partner.contact }}</span>
            <span class="muted" v-if="data.partner.phone">　电话：{{ data.partner.phone }}</span>
          </div>
          <div class="muted">
            期间：{{ data.start || '不限' }} ~ {{ data.end || '不限' }}
          </div>
        </div>

        <!-- 期初 / 本期 / 期末 -->
        <div class="sum-bar">
          <span>期初余额：<b>¥{{ money(data.opening_balance) }}</b></span>
          <span class="inc">本期增加：<b>¥{{ money(data.total_increase) }}</b></span>
          <span class="dec">本期减少：<b>¥{{ money(data.total_decrease) }}</b></span>
          <span class="close">期末余额：<b>¥{{ money(data.closing_balance) }}</b></span>
          <span class="muted">共 {{ data.row_count }} 笔</span>
        </div>

        <el-table :data="data.rows" border stripe size="small" style="width:100%" empty-text="该期间没有流水">
          <el-table-column type="index" label="#" width="55" align="center" />
          <el-table-column prop="date" label="日期" width="105" align="center" />
          <el-table-column prop="kind" label="类型" width="110" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="kindTag(row.kind)" effect="plain">{{ row.kind }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="doc_no" label="单号" min-width="170" show-overflow-tooltip />
          <el-table-column label="内容（商品×数量）" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.items_summary">{{ row.items_summary }}</span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="数量" width="80" align="right">
            <template #default="{ row }">
              <span v-if="row.items_quantity">{{ row.items_quantity }}</span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="增加" width="120" align="right">
            <template #default="{ row }">
              <span v-if="Number(row.increase)" class="num inc">{{ money(row.increase) }}</span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="减少" width="120" align="right">
            <template #default="{ row }">
              <span v-if="Number(row.decrease)" class="num dec">{{ money(row.decrease) }}</span>
              <span v-else class="muted">-</span>
            </template>
          </el-table-column>
          <el-table-column label="余额" width="130" align="right">
            <template #default="{ row }">
              <span class="num bold">{{ money(row.balance) }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="stmt-foot muted">
          余额口径：{{ sideWord }} = 期初 + 增加 − 减少。
          <template v-if="data.side === 'customer'">
            增加 = 销售单 / 退款给客户；减少 = 收款 / 销售退货。
          </template>
          <template v-else>
            增加 = 采购单 / 收供应商退款；减少 = 付款 / 采购退货。
          </template>
        </div>
      </template>

      <el-empty v-else-if="!loading" description="请选择往来单位后查询" />
    </el-card>
  </div>
</template>

<script setup>
/**
 * 对账单（桌面端）。
 *
 * 数据完全来自 /api/ext/statement/{customer,supplier}，
 * 界面只做展示与打印，不重算任何金额 —— 避免前后端两套口径对不上。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Printer } from '@element-plus/icons-vue'
import {
  getCustomerStatement,
  getSupplierStatement,
  getCustomers,
  getSuppliers,
} from '../api/modules'
import { money, escapeHtml } from '../utils/format'
import { printHtml } from '../utils/print'

const route = useRoute()

const qf = ref({ side: 'customer', partner_id: null })
const range = ref(null)
const partners = ref([])
const data = ref(null)
const loading = ref(false)
/** 请求序号：用于丢弃乱序返回的旧响应（见 load()） */
let loadSeq = 0

const partyLabel = computed(() => (qf.value.side === 'customer' ? '客户' : '供应商'))
const sideWord = computed(() => (qf.value.side === 'customer' ? '应收' : '应付'))

const rangeHint = computed(() => {
  if (!data.value) return ''
  if (!data.value.start && !data.value.end) {
    return '当前为全部期间，期末余额应与「' + partyLabel.value + '欠款」页显示的金额一致。'
  }
  return '期初余额 = 起始日之前的累计净额；期末余额 = 期初 + 本期增加 − 本期减少。'
})

function kindTag(kind) {
  if (kind.includes('退货')) return 'warning'
  if (kind.includes('收') || kind.includes('付')) return 'success'
  return 'primary'
}

async function loadPartners() {
  try {
    const res = qf.value.side === 'customer'
      ? await getCustomers({ page: 1, page_size: 200, status: 1 })
      : await getSuppliers({ page: 1, page_size: 200, status: 1 })
    partners.value = res.items || []
  } catch {
    partners.value = []
  }
}

function onSideChange() {
  qf.value.partner_id = null
  data.value = null
  loadPartners()
}

function resetRange() {
  range.value = null
  if (qf.value.partner_id) load()
}

async function load() {
  if (!qf.value.partner_id) {
    ElMessage.warning('请先选择' + partyLabel.value)
    return
  }
  // 序号守卫：切类型/改区间可能并发触发，旧响应不得覆盖新结果
  const seq = ++loadSeq
  loading.value = true
  try {
    const params = { partner_id: qf.value.partner_id }
    if (range.value && range.value.length === 2) {
      params.start = range.value[0]
      params.end = range.value[1]
    }
    const res = qf.value.side === 'customer'
      ? await getCustomerStatement(params)
      : await getSupplierStatement(params)
    if (seq !== loadSeq) return
    data.value = res
  } catch {
    if (seq !== loadSeq) return
    data.value = null
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** 打印：用同一份接口数据重新排版，保证与屏幕一致 */
function doPrint() {
  const d = data.value
  if (!d) return

  const rows = d.rows.map((r, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td class="c">${escapeHtml(r.date)}</td>
      <td class="c">${escapeHtml(r.kind)}</td>
      <td>${escapeHtml(r.doc_no)}</td>
      <td>${escapeHtml(r.items_summary || '-')}</td>
      <td class="c">${r.items_quantity || '-'}</td>
      <td class="r">${Number(r.increase) ? money(r.increase) : '-'}</td>
      <td class="r">${Number(r.decrease) ? money(r.decrease) : '-'}</td>
      <td class="r b">${money(r.balance)}</td>
    </tr>`).join('')

  const html = `
    <h2 style="text-align:center;margin:0 0 4px">${escapeHtml(d.side === 'customer' ? '客户对账单' : '供应商对账单')}</h2>
    <div style="text-align:center;font-size:12px;margin-bottom:10px">
      期间：${escapeHtml(d.start || '不限')} ~ ${escapeHtml(d.end || '不限')}
    </div>
    <table style="width:100%;font-size:12px;margin-bottom:8px">
      <tr>
        <td><b>${escapeHtml(partyLabel.value)}：</b>${escapeHtml(d.partner.name)}</td>
        <td>联系人：${escapeHtml(d.partner.contact || '-')}</td>
        <td>电话：${escapeHtml(d.partner.phone || '-')}</td>
      </tr>
    </table>
    <table border="1" style="width:100%;font-size:12px">
      <thead>
        <tr>
          <th style="width:30px">#</th>
          <th style="width:70px">日期</th>
          <th style="width:70px">类型</th>
          <th style="width:120px">单号</th>
          <th>内容（商品×数量）</th>
          <th style="width:50px">数量</th>
          <th style="width:70px">增加</th>
          <th style="width:70px">减少</th>
          <th style="width:80px">余额</th>
        </tr>
        <tr>
          <td colspan="5" class="r"><b>期初余额</b></td>
          <td colspan="4" class="r"><b>${money(d.opening_balance)}</b></td>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" class="r"><b>本期合计</b></td>
          <td></td>
          <td class="r b">${money(d.total_increase)}</td>
          <td class="r b">${money(d.total_decrease)}</td>
          <td></td>
        </tr>
        <tr>
          <td colspan="5" class="r"><b>期末余额</b></td>
          <td colspan="4" class="r"><b>${money(d.closing_balance)}</b></td>
        </tr>
      </tfoot>
    </table>
    <div style="margin-top:10px;font-size:11px">
      口径：${sideWord.value} = 期初 + 增加 − 减少。
      ${d.side === 'customer'
        ? '增加 = 销售单 / 退款给客户；减少 = 收款 / 销售退货。'
        : '增加 = 采购单 / 收供应商退款；减少 = 付款 / 采购退货。'}
    </div>
    <table style="width:100%;margin-top:24px;font-size:12px">
      <tr>
        <td>制表：______________</td>
        <td>核对：______________</td>
        <td style="text-align:right">日期：______________</td>
      </tr>
    </table>
    <style>
      .c { text-align: center; }
      .r { text-align: right; }
      .b { font-weight: bold; }
      th, td { padding: 3px 4px; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    </style>`

  printHtml(html, { title: '' })
}

onMounted(async () => {
  await loadPartners()
  // 支持从欠款页带参数跳进来（?side=customer&partner_id=1）
  const q = route.query
  if (q.side === 'supplier' || q.side === 'customer') qf.value.side = q.side
  if (q.side && q.side !== 'customer') await loadPartners()
  if (q.partner_id) qf.value.partner_id = Number(q.partner_id)
  if (qf.value.partner_id) load()
})
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.stmt-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.stmt-name {
  font-size: 16px;
  font-weight: 600;
}
.sum-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  align-items: center;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
  color: #606266;
}
.sum-bar b {
  color: #303133;
}
.sum-bar .inc b {
  color: #f56c6c;
}
.sum-bar .dec b {
  color: #67c23a;
}
.sum-bar .close b {
  color: #2f6fed;
}
.inc {
  color: #f56c6c;
}
.dec {
  color: #67c23a;
}
.stmt-foot {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
}
</style>

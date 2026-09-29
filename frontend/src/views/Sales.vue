<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>销售管理</span>
          <div>
            <el-button v-permission="'sales:export'" @click="doExport"><el-icon><Download /></el-icon> 导出CSV</el-button>
            <el-button v-permission="'sales:add'" type="primary" @click="handleAdd">
              <el-icon><Plus /></el-icon> 新增销售单
            </el-button>
          </div>
        </div>
      </template>
      
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" clearable style="width:280px"
            placeholder="单号/客户/联系人/电话/地址/备注" @keyup.enter="loadData" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" placeholder="全部" clearable :value-on-clear="null" style="width:110px">
            <el-option label="草稿" :value="0" />
            <el-option label="已审核" :value="1" />
            <el-option label="部分发货" :value="2" />
            <el-option label="已发货" :value="3" />
            <el-option label="已关闭" :value="4" /><el-option label="部分退货" :value="5" /><el-option label="已退货" :value="6" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="searchForm.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD"
            style="width:230px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>
      
      <el-table :data="tableData" v-loading="loading" border stripe size="small" style="width:100%">
        <el-table-column type="index" label="序号" width="50" align="center"
          :index="i => pagination.total - ((pagination.page - 1) * pagination.pageSize + i)" />
        <el-table-column prop="order_no" label="单号" width="135" show-overflow-tooltip />
        <el-table-column prop="product_summary" label="商品名称" min-width="120" align="center" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.product_summary || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="spec_summary" label="型号" min-width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.spec_summary || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="customer_name" label="公司名称" min-width="110" align="center" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.customer_name || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="customer_contact" label="联系人" width="65" align="center">
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.customer_contact || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="customer_phone" label="联系电话" width="100" align="center">
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.customer_phone || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="total_amount" label="金额" width="105"  align="center">
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.total_amount }}</span></template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="110" align="center">
          <template #default="{ row }">{{ fmtShort(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="handleDetail(row)">详情</el-button>
            <el-button v-if="row.status === 0" v-permission="'sales:edit'" type="primary" link size="small" @click="handleEdit(row)">编辑</el-button>
            <el-button v-if="row.status === 0" v-permission="'sales:approve'" type="success" link size="small" @click="handleApprove(row)">审核</el-button>
            <el-button v-if="[1, 2, 5].includes(row.status)" v-permission="'sales:ship'" type="warning" link size="small" @click="handleShip(row)">发货</el-button>
            <el-button v-if="row.status <= 1" v-permission="'sales:cancel'" type="warning" link size="small" @click="handleCancel(row)">作废</el-button>
            <el-button v-if="row.status === 0 || row.status === 4" v-permission="'sales:delete'" type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next"
        @change="loadData"
      />
    </el-card>
    
    <!-- 详情对话框 -->
    <el-dialog v-model="detailVisible" title="销售单详情" width="1120px">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="销售单号">{{ detailData.order_no }}</el-descriptions-item>
          <el-descriptions-item label="销售日期">{{ detailData.sale_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="交货日期">{{ detailData.delivery_date || '-' }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{ detailData.customer_name }}</el-descriptions-item>
          <el-descriptions-item label="联系人">{{ detailData.customer_contact || '-' }}</el-descriptions-item>
          <el-descriptions-item label="联系电话">{{ detailData.customer_phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="发货仓库">{{ detailData.warehouse_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="销售员">{{ detailData.creator_name || '-' }}</el-descriptions-item>
          <el-descriptions-item label="付款方式">
            {{ detailData.payment_method || '-' }}
            <span v-if="detailData.payment_terms" style="color:#909399">（{{ detailData.payment_terms }}）</span>
          </el-descriptions-item>
          <el-descriptions-item label="币种">
            {{ detailData.currency || 'CNY' }}
            <span v-if="Number(detailData.exchange_rate) !== 1" style="color:#909399">
              汇率 {{ detailData.exchange_rate }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="税额">
            ¥{{ detailData.tax_amount || 0 }}
            <span style="color:#909399">（内含）</span>
          </el-descriptions-item>
          <el-descriptions-item label="不含税金额">
            ¥{{ netOfDetail(detailData) }}
          </el-descriptions-item>
          <el-descriptions-item label="运费">¥{{ detailData.freight || 0 }}</el-descriptions-item>
          <el-descriptions-item label="整单合计">¥{{ detailData.total_amount }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="statusType(detailData.status)">{{ statusText(detailData.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="发票号">{{ detailData.invoice_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">
            {{ detailData.created_at ? new Date(detailData.created_at).toLocaleString() : '' }}
          </el-descriptions-item>
          <el-descriptions-item label="送货地址" :span="3">{{ detailData.delivery_address || '-' }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="3">{{ detailData.remark || '-' }}</el-descriptions-item>
        </el-descriptions>
        
        <el-table :data="detailData.items || []" border style="margin-top: 16px;width:100%">
          <el-table-column prop="product_name" label="商品名称" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="ellipsis-cell">{{ row.product_name || `商品#${row.product_id}` }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="product_spec" label="规格" min-width="110" show-overflow-tooltip>
            <template #default="{ row }"><span class="ellipsis-cell">{{ row.product_spec || '-' }}</span></template>
          </el-table-column>
          <el-table-column prop="product_unit" label="单位" width="55" align="center" />
          <el-table-column prop="quantity" label="订购" width="70" align="right" />
          <el-table-column prop="price" label="单价" width="85" align="right" />
          <el-table-column prop="tax_rate" label="税率%" width="75" align="right">
            <template #default="{ row }">{{ row.tax_rate ?? 0 }}</template>
          </el-table-column>
          <el-table-column prop="amount" label="金额小计" width="100" align="right" />
          <el-table-column prop="shipped_quantity" label="已发" width="70" align="right" />
          <el-table-column prop="pending_quantity" label="待发" width="70" align="right">
            <template #default="{ row }">
              <span :style="{ color: row.pending_quantity > 0 ? '#e6a23c' : '#67c23a' }">
                {{ row.pending_quantity ?? 0 }}
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="行备注" min-width="100" show-overflow-tooltip>
            <template #default="{ row }"><span class="ellipsis-cell">{{ row.remark || '-' }}</span></template>
          </el-table-column>
        </el-table>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button v-if="[2, 3, 5].includes(detailData.status)"
          v-permission="'sale_return:add'" type="warning" @click="openReturn">退货</el-button>
        <el-button v-permission="'sales:print'" type="primary" @click="handlePrint">打印</el-button>
      </template>
    </el-dialog>

    <!-- 从销售单退货 -->
    <el-dialog v-model="returnVisible" title="销售退货" width="960px">
      <el-alert
        v-if="returnInfo"
        :title="`来源销售单 ${returnInfo.order_no}　客户：${returnInfo.customer_name || '-'}　（单价为原成交价）`"
        type="info" :closable="false" show-icon style="margin-bottom:12px" />

      <el-table :data="returnRows" border size="small">
        <el-table-column prop="product_name" label="商品名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="product_spec" label="规格/型号" min-width="110" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.product_spec || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="product_unit" label="单位" width="55" align="center" />
        <el-table-column prop="shipped_quantity" label="已发货" width="75" align="right" />
        <el-table-column prop="returned_quantity" label="已退" width="65" align="right" />
        <el-table-column prop="available_quantity" label="可退" width="65" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.available_quantity > 0 ? '#67c23a' : '#909399' }">
              {{ row.available_quantity }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="本次退货" width="120">
          <template #default="{ row }">
            <el-input-number v-model="row.return_qty" :min="0" :max="row.available_quantity"
              :controls="false" size="small" :disabled="row.available_quantity === 0" style="width:100%" />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="95" align="right">
          <template #default="{ row }">{{ Number(row.price).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="退货金额" width="110" align="right">
          <template #default="{ row }">{{ (Number(row.return_qty || 0) * Number(row.price)).toFixed(2) }}</template>
        </el-table-column>
      </el-table>

      <el-form :model="returnForm" label-width="80px" style="margin-top:14px">
        <el-form-item label="退货原因">
          <el-input v-model="returnForm.reason" placeholder="如：质量问题 / 客户取消" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="returnForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>

      <div class="amount-summary">
        <el-button link type="primary" @click="fillAllReturn">全部可退</el-button>
        <span>合计退货数量：<b>{{ returnTotalQty }}</b></span>
        <span class="grand">退货金额：¥{{ returnTotalAmount }}</span>
      </div>

      <template #footer>
        <el-button @click="returnVisible = false">取消</el-button>
        <el-button type="primary" :loading="returnLoading" @click="submitReturn">确认退货</el-button>
      </template>
    </el-dialog>

    <!-- 分批发货对话框 -->
    <el-dialog v-model="shipVisible" title="销售发货" width="820px">
      <el-alert
        v-if="shipOrder"
        :title="`销售单 ${shipOrder.order_no}　${shipOrder.customer_name || ''}　发货仓库：${shipOrder.warehouse_name || '默认仓库'}`"
        type="info" :closable="false" show-icon style="margin-bottom:12px" />

      <el-table :data="shipRows" border>
        <el-table-column prop="product_name" label="商品" min-width="160" show-overflow-tooltip />
        <el-table-column prop="product_spec" label="规格型号" min-width="120" show-overflow-tooltip>
          <template #default="{ row }"><span class="ellipsis-cell">{{ row.product_spec || '-' }}</span></template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="60" align="center" />
        <el-table-column prop="quantity" label="订购" width="75" align="right" />
        <el-table-column prop="shipped_quantity" label="已发" width="75" align="right" />
        <el-table-column prop="pending" label="待发" width="75" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.pending > 0 ? '#e6a23c' : '#909399' }">{{ row.pending }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本次发货" width="150">
          <template #default="{ row }">
            <el-input-number v-model="row.this_time" :min="0" :max="row.pending"
              :controls="false" :disabled="row.pending === 0" style="width:100%" />
          </template>
        </el-table-column>
      </el-table>

      <div class="amount-summary">
        <el-button link type="primary" @click="fillAllPendingShip">全部发齐</el-button>
        <span>本次出库合计：<b>{{ shipTotal }}</b></span>
      </div>

      <template #footer>
        <el-button @click="shipVisible = false">取消</el-button>
        <el-button type="primary" :loading="shipLoading" @click="submitShip">确认发货</el-button>
      </template>
    </el-dialog>
    
    <!-- 新增销售单对话框 -->
    <el-dialog v-model="addVisible" :title="editId ? '编辑销售单' : '新增销售单'" width="1160px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="销售日期" prop="sale_date">
              <el-date-picker v-model="form.sale_date" type="date" value-format="YYYY-MM-DD"
                placeholder="选择日期" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="交货日期">
              <el-date-picker v-model="form.delivery_date" type="date" value-format="YYYY-MM-DD"
                placeholder="选填" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="客户" prop="customer_id">
              <el-select v-model="form.customer_id" placeholder="请选择客户" filterable style="width:100%">
                <el-option v-for="item in customers" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="发货仓库" prop="warehouse_id">
              <el-select v-model="form.warehouse_id" placeholder="请选择仓库" style="width:100%">
                <el-option v-for="w in warehouses" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="销售员">
              <el-input v-model="form.seller" placeholder="选填，默认当前用户" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="付款方式">
              <el-select v-model="form.payment_method" placeholder="选填" clearable style="width:100%">
                <el-option label="现结" value="现结" />
                <el-option label="赊销" value="赊销" />
                <el-option label="月结" value="月结" />
                <el-option label="预收款" value="预收款" />
                <el-option label="银行承兑" value="银行承兑" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="账期">
              <el-input v-model="form.payment_terms" placeholder="如 30天" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="币种">
              <el-select v-model="form.currency" style="width:100%">
                <el-option label="人民币 CNY" value="CNY" />
                <el-option label="美元 USD" value="USD" />
                <el-option label="欧元 EUR" value="EUR" />
                <el-option label="港币 HKD" value="HKD" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="汇率">
              <el-input-number v-model="form.exchange_rate" :precision="4" :min="0.0001"
                :controls="false" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="税额">
              <el-input :model-value="autoTax.toFixed(2)" disabled style="width:100%">
                <template #prefix>¥</template>
              </el-input>
              <div class="field-hint">
                价内税，自动从明细拆出（不含税金额 ¥{{ netAmount.toFixed(2) }}）
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="运费">
              <el-input-number v-model="form.freight" :precision="2" :min="0"
                :controls="false" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="发票号">
              <el-input v-model="form.invoice_no" placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="送货地址">
          <el-input v-model="form.delivery_address" placeholder="选填" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" />
        </el-form-item>
        
        <el-divider>销售明细</el-divider>
        
        <el-table :data="form.items" border size="small">
          <el-table-column label="商品" min-width="180">
            <template #default="{ row }">
              <el-select v-model="row.product_id" placeholder="选择商品" filterable size="small"
                style="width:100%" @change="(val) => onProductSelect(row, val)">
                <el-option v-for="p in products" :key="p.id"
                  :label="p.sku ? `${p.name}（${p.sku}）` : p.name" :value="p.id" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="规格/型号" min-width="130">
            <template #default="{ row }">
              <span class="ellipsis-cell spec-cell">{{ specOf(row.product_id) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="单位" width="60" align="center">
            <template #default="{ row }">{{ unitOf(row.product_id) }}</template>
          </el-table-column>
          <el-table-column label="销售数量" width="110">
            <template #default="{ row }">
              <el-input-number v-model="row.quantity" :min="1" :controls="false"
                size="small" style="width:100%" @change="calcAmount(row)" />
            </template>
          </el-table-column>
          <el-table-column label="单价" width="105">
            <template #default="{ row }">
              <el-input-number v-model="row.price" :precision="2" :min="0" :controls="false"
                size="small" style="width:100%" @change="calcAmount(row)" />
            </template>
          </el-table-column>
          <el-table-column label="税率%" width="85">
            <template #default="{ row }">
              <el-input-number v-model="row.tax_rate" :precision="2" :min="0" :max="100"
                :controls="false" size="small" style="width:100%" />
            </template>
          </el-table-column>
          <el-table-column label="金额小计" width="105" align="right">
            <template #default="{ row }">
              {{ ((row.quantity || 0) * (row.price || 0)).toFixed(2) }}
            </template>
          </el-table-column>
          <el-table-column label="行备注" min-width="120">
            <template #default="{ row }">
              <el-input v-model="row.remark" size="small" placeholder="选填" />
            </template>
          </el-table-column>
          <el-table-column width="55" align="center">
            <template #default="{ $index }">
              <el-button type="danger" link size="small" @click="form.items.splice($index, 1)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        
        <el-button type="primary" link @click="addItem" style="margin-top: 12px">
          + 添加明细
        </el-button>
        
        <div class="amount-summary">
          <span>明细合计(含税)：¥{{ goodsAmount.toFixed(2) }}</span>
          <span>其中税额：¥{{ autoTax.toFixed(2) }}</span>
          <span>运费：¥{{ Number(form.freight || 0).toFixed(2) }}</span>
          <span class="grand">整单合计：¥{{ totalAmount }}</span>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { getSalesOrders, getSalesOrder, createSalesOrder, updateSalesOrder, deleteSalesOrder, approveSalesOrder, shipSalesOrder, cancelSalesOrder, downloadExport } from '../api/modules'
import { getSaleReturnAvailable, createSaleReturn } from '../api/modules'
import { getCustomers } from '../api/modules'
import { getProducts } from '../api/modules'
import { getWarehouses } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmAction, confirmCancel, confirmDelete } from '../utils/confirm'
import { printHtml } from '../utils/print'
import { escapeHtml, amountInChinese, fmtShort } from '../utils/format'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const customers = ref([])
const products = ref([])
const warehouses = ref([])
const detailVisible = ref(false)
const addVisible = ref(false)
const detailData = ref({})
const formRef = ref(null)
/** 非空表示编辑模式（对应单据 id） */
const editId = ref(null)

/* ---------- 从销售单退货 ---------- */
const returnVisible = ref(false)
const returnLoading = ref(false)
const returnInfo = ref(null)
const returnRows = ref([])
const returnForm = reactive({ reason: '', remark: '' })

const openReturn = async () => {
  const d = detailData.value
  if (!d.id) return
  try {
    const info = await getSaleReturnAvailable(d.id)
    returnInfo.value = info
    returnRows.value = (info.items || []).map(i => {
      // 已经被退光的行默认 0，其余默认全退，减少手工输入
      const def = i.available_quantity
      return { ...i, return_qty: def }
    })
    returnForm.reason = ''
    returnForm.remark = ''
    returnVisible.value = true
  } catch (e) {
    // 拦截器已提示（如状态不允许退货）
  }
}

const fillAllReturn = () => {
  returnRows.value.forEach(r => { r.return_qty = r.available_quantity })
}

const returnTotalQty = computed(() =>
  returnRows.value.reduce((s, r) => s + Number(r.return_qty || 0), 0)
)

const returnTotalAmount = computed(() =>
  returnRows.value.reduce((s, r) => s + Number(r.return_qty || 0) * Number(r.price || 0), 0).toFixed(2)
)

const submitReturn = async () => {
  const items = returnRows.value
    .filter(r => Number(r.return_qty) > 0)
    .map(r => ({ product_id: r.product_id, quantity: Number(r.return_qty), price: Number(r.price) }))

  if (!items.length) {
    ElMessage.warning('请填写本次退货数量')
    return
  }
  const over = returnRows.value.find(r => Number(r.return_qty) > r.available_quantity)
  if (over) {
    ElMessage.error(`「${over.product_name}」退货数量超过可退 ${over.available_quantity}`)
    return
  }

  returnLoading.value = true
  try {
    const res = await createSaleReturn({
      sales_order_id: returnInfo.value.sales_order_id,
      customer_id: returnInfo.value.customer_id,
      reason: returnForm.reason,
      remark: returnForm.remark,
      items
    })
    ElMessage.success(`退货单已创建：${res.return_no}`)
    returnVisible.value = false
    detailVisible.value = false
    loadData()
  } catch (e) {
    // 拦截器已提示
  } finally {
    returnLoading.value = false
  }
}

/* 分批发货 */
const shipVisible = ref(false)
const shipOrder = ref({})
const shipRows = ref([])
const shipLoading = ref(false)

const fillAllPendingShip = () => {
  shipRows.value.forEach(r => { r.this_time = r.pending })
}

const searchForm = reactive({
  keyword: '',
  status: null,
  dateRange: null
})
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const form = reactive({
  customer_id: null,
  warehouse_id: null,
  sale_date: '',
  delivery_date: '',
  seller: '',
  payment_method: '',
  payment_terms: '',
  currency: 'CNY',
  exchange_rate: 1,
  tax_amount: 0,
  freight: 0,
  items: [],
  remark: '',
  delivery_address: '',
  invoice_no: ''
})

const rules = {
  sale_date: [{ required: true, message: '请选择销售日期', trigger: 'change' }],
  customer_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
  warehouse_id: [{ required: true, message: '请选择发货仓库', trigger: 'change' }]
}

const goodsAmount = computed(() =>
  form.items.reduce((s, i) => s + (i.quantity || 0) * (i.price || 0), 0)
)

/* ---------- 价内税：单价已含税，税额从明细中拆出 ---------- */
/** 内含税额 = Σ(小计 − 小计 / (1 + 税率/100)) */
const autoTax = computed(() =>
  form.items.reduce((s, i) => {
    const gross = (i.quantity || 0) * (i.price || 0)
    const rate = Number(i.tax_rate) || 0
    if (rate <= -100) return s
    return s + (gross - gross / (1 + rate / 100))
  }, 0)
)

// 价内税下税额是派生值，随明细自动更新
watch(autoTax, (v) => { form.tax_amount = Number(v.toFixed(2)) }, { immediate: true })

/** 明细不含税金额合计 */
const netAmount = computed(() => goodsAmount.value - autoTax.value)

/** 详情弹窗：含税合计 − 内含税额 − 运费 = 不含税金额 */
const netOfDetail = (d) => {
  const total = Number(d.total_amount || 0)
  const tax = Number(d.tax_amount || 0)
  const freight = Number(d.freight || 0)
  return (total - tax - freight).toFixed(2)
}

/** 整单合计 = 含税明细 + 运费 */
const totalAmount = computed(() =>
  (goodsAmount.value + Number(form.freight || 0)).toFixed(2)
)

const statusText = (status) => ['草稿', '已审核', '部分发货', '已发货', '已关闭', '部分退货', '已退货'][status] || '未知'
const statusType = (status) => ['info', 'success', 'warning', 'primary', 'danger', 'warning', 'info'][status] || 'info'

const loadData = async () => {
  loading.value = true
  try {
    const res = await getSalesOrders({
      page: pagination.page,
      page_size: pagination.pageSize,
      keyword: searchForm.keyword || undefined,
      status: searchForm.status,
      start_date: searchForm.dateRange?.[0] || undefined,
      end_date: searchForm.dateRange?.[1] || undefined
    })
    tableData.value = res.items
    pagination.total = res.total
  } finally {
    loading.value = false
  }
}

const loadBaseData = async () => {
  const [c, p, w] = await Promise.all([
    getCustomers({ page: 1, page_size: 200 }),
    getProducts({ page: 1, page_size: 500 }),
    getWarehouses()
  ])
  customers.value = c.items
  products.value = p.items
  warehouses.value = w || []
}

const resetSearch = () => {
  searchForm.keyword = ''
  searchForm.status = null
  searchForm.dateRange = null
  pagination.page = 1
  loadData()
}

const handleDetail = async (row) => {
  detailData.value = await getSalesOrder(row.id)
  detailVisible.value = true
}

const today = () => new Date().toISOString().slice(0, 10)

const handleAdd = () => {
  editId.value = null
  form.customer_id = null
  form.warehouse_id = warehouses.value[0]?.id || null
  form.sale_date = today()
  form.delivery_date = ''
  form.seller = ''
  form.payment_method = ''
  form.payment_terms = ''
  form.currency = 'CNY'
  form.exchange_rate = 1
  form.tax_amount = 0
  form.freight = 0
  form.items = [{ product_id: null, quantity: 1, price: 0, tax_rate: 13, remark: '' }]
  form.remark = ''
  form.delivery_address = ''
  form.invoice_no = ''
  addVisible.value = true
}

const handleEdit = async (row) => {
  const d = await getSalesOrder(row.id)
  editId.value = row.id
  form.customer_id = d.customer_id
  form.warehouse_id = d.warehouse_id
  form.sale_date = d.sale_date || today()
  form.delivery_date = d.delivery_date || ''
  form.seller = d.seller || ''
  form.payment_method = d.payment_method || ''
  form.payment_terms = d.payment_terms || ''
  form.currency = d.currency || 'CNY'
  form.exchange_rate = Number(d.exchange_rate || 1)
  form.tax_amount = Number(d.tax_amount || 0)
  form.freight = Number(d.freight || 0)
  form.items = (d.items || []).map(i => ({
    product_id: i.product_id,
    quantity: i.quantity,
    price: Number(i.price),
    tax_rate: Number(i.tax_rate || 0),
    remark: i.remark || ''
  }))
  form.remark = d.remark || ''
  form.delivery_address = d.delivery_address || ''
  form.invoice_no = d.invoice_no || ''
  if (!products.value.length) await loadBaseData()
  addVisible.value = true
}

const handleDelete = async (row) => {
  await confirmDelete(
    `销售单「${row.order_no}」`,
    `名称：${row.customer_name || '-'}<br/>金额：¥${row.total_amount}<br/><br/>删除后不可恢复。`
  )
  await deleteSalesOrder(row.id)
  ElMessage.success('删除成功')
  loadData()
}

const doExport = async () => {
  await downloadExport('sales')
  ElMessage.success('已导出')
}

const addItem = () => {
  form.items.push({ product_id: null, quantity: 1, price: 0, tax_rate: 13, remark: '' })
}

const onProductSelect = (row, productId) => {
  const product = products.value.find(p => p.id === productId)
  if (product) {
    row.price = product.sale_price
  }
}

const calcAmount = (row) => {}

/** 明细行展示：按已选商品取规格/单位 */
const specOf = (productId) => {
  const p = products.value.find(x => x.id === productId)
  return p ? (p.spec || '-') : '-'
}
const unitOf = (productId) => {
  const p = products.value.find(x => x.id === productId)
  return p ? (p.unit || '-') : '-'
}

const handleSubmit = async () => {
  await formRef.value.validate()
  if (form.items.length === 0) {
    ElMessage.warning('请添加销售明细')
    return
  }
  submitLoading.value = true
  try {
    // 日期选择器清空后是空字符串，后端需要 null
    const payload = {
      ...form,
      sale_date: form.sale_date || null,
      delivery_date: form.delivery_date || null
    }
    if (editId.value) {
      await updateSalesOrder(editId.value, payload)
      ElMessage.success('更新成功')
    } else {
      await createSalesOrder(payload)
      ElMessage.success('创建成功')
    }
    addVisible.value = false
    editId.value = null
    loadData()
  } finally {
    submitLoading.value = false
  }
}

const handleApprove = async (row) => {
  await confirmAction('确认审核', `销售单：<b>${row.order_no}</b><br/>金额：¥${row.total_amount}`, '确认审核')
  await approveSalesOrder(row.id)
  ElMessage.success('审核成功')
  loadData()
}

/** 打开分批发货弹窗 */
const handleShip = async (row) => {
  const d = await getSalesOrder(row.id)
  shipOrder.value = d
  shipRows.value = (d.items || []).map(i => ({
    item_id: i.id,
    product_name: i.product_name || `商品#${i.product_id}`,
    product_spec: i.product_spec || '',
    unit: i.product_unit || '',
    quantity: i.quantity,
    shipped_quantity: i.shipped_quantity || 0,
    pending: Math.max((i.quantity || 0) - (i.shipped_quantity || 0), 0),
    this_time: Math.max((i.quantity || 0) - (i.shipped_quantity || 0), 0)
  }))
  shipVisible.value = true
}

const shipTotal = computed(() =>
  shipRows.value.reduce((s, r) => s + Number(r.this_time || 0), 0)
)

const submitShip = async () => {
  const items = shipRows.value
    .filter(r => Number(r.this_time) > 0)
    .map(r => ({ item_id: r.item_id, quantity: Number(r.this_time) }))

  if (!items.length) {
    ElMessage.warning('请填写本次发货数量')
    return
  }
  const over = shipRows.value.find(r => Number(r.this_time) > r.pending)
  if (over) {
    ElMessage.error(`「${over.product_name}」本次发货超过待发数量 ${over.pending}`)
    return
  }

  shipLoading.value = true
  try {
    const res = await shipSalesOrder(shipOrder.value.id, { items })
    ElMessage.success(res.message || '出库成功')
    shipVisible.value = false
    loadData()
  } catch (e) {
    // 库存不足等错误由拦截器提示
  } finally {
    shipLoading.value = false
  }
}

const handleCancel = async (row) => {
  await confirmCancel(`销售单「${row.order_no}」`)
  await cancelSalesOrder(row.id)
  ElMessage.success('作废成功')
  loadData()
}

onMounted(() => {
  loadData()
  loadBaseData()
})

const handlePrint = () => {
  const d = detailData.value
  const items = (d.items || []).map((item) => ({
    product_name: item.product_name || `商品#${item.product_id}`,
    spec: item.product_spec || '',
    unit: item.product_unit || '',
    quantity: item.quantity,
    price: item.price,
    amount: item.amount,
  }))
  const customer = customers.value.find(c => c.id === d.customer_id) || {}
  const contact = [d.customer_contact, d.customer_phone].filter(Boolean).join(' ')

  const printData = {
    company_name: localStorage.getItem('print_company_name') || '',
    company_address: localStorage.getItem('print_company_address') || '',
    company_phone: localStorage.getItem('print_company_phone') || '',
    title: '销售单',
    order_no: d.order_no,
    partner_label: '购货单位',
    partner_name: d.customer_name || customer.name || '',
    partner_address: customer.address || d.customer_address || '',
    partner_contact: contact || customer.phone || '',
    date: d.created_at ? new Date(d.created_at).toLocaleDateString('zh-CN') : '',
    total_amount: d.total_amount,
    total_cn: amountInChinese(Number(d.total_amount || 0)),
    remark: d.remark || '',
    invoice_no: d.invoice_no || '',
    delivery_address: d.delivery_address || '',
    sign_left: '送货单位及经手人',
    sign_right: '收货单位及经手人',
    items,
  }
  printHtml(buildPrintHtml(printData))
}

function buildPrintHtml(d) {
  let rows = ''
  ;(d.items || []).forEach((item, idx) => {
    rows += `<tr>
      <td style="border:1px solid #000;padding:5px 4px;text-align:center;">${idx + 1}</td>
      <td style="border:1px solid #000;padding:5px 4px;">${escapeHtml(item.product_name)}</td>
      <td style="border:1px solid #000;padding:5px 4px;">${escapeHtml(item.spec)}</td>
      <td style="border:1px solid #000;padding:5px 4px;text-align:center;">${escapeHtml(item.unit)}</td>
      <td style="border:1px solid #000;padding:5px 4px;text-align:center;">${item.quantity}</td>
      <td style="border:1px solid #000;padding:5px 4px;text-align:right;">${Number(item.price).toFixed(2)}</td>
      <td style="border:1px solid #000;padding:5px 4px;text-align:right;">${Number(item.amount).toFixed(2)}</td>
      <td style="border:1px solid #000;padding:5px 4px;">&nbsp;</td>
    </tr>`
  })
  const emptyRows = Math.max(0, 8 - (d.items || []).length)
  for (let i = 0; i < emptyRows; i++) {
    rows += '<tr>' + '<td style="border:1px solid #000;height:22px;">&nbsp;</td>'.repeat(8) + '</tr>'
  }

  const infoRows = `
    <tr>
      <td style="border:1px solid #000;padding:4px 8px;width:70px;font-weight:bold;">${d.partner_label}</td>
      <td style="border:1px solid #000;padding:4px 8px;width:38%;">${escapeHtml(d.partner_name)}</td>
      <td style="border:1px solid #000;padding:4px 8px;width:70px;font-weight:bold;">联系人</td>
      <td style="border:1px solid #000;padding:4px 8px;">${escapeHtml(d.partner_contact)}</td>
    </tr>
    <tr>
      <td style="border:1px solid #000;padding:4px 8px;font-weight:bold;">地址电话</td>
      <td style="border:1px solid #000;padding:4px 8px;">${escapeHtml(d.partner_address)}</td>
      <td style="border:1px solid #000;padding:4px 8px;font-weight:bold;">发票号</td>
      <td style="border:1px solid #000;padding:4px 8px;">${escapeHtml(d.invoice_no)}</td>
    </tr>
    ${d.delivery_address ? `<tr>
      <td style="border:1px solid #000;padding:4px 8px;font-weight:bold;">送货地址</td>
      <td style="border:1px solid #000;padding:4px 8px;" colspan="3">${escapeHtml(d.delivery_address)}</td>
    </tr>` : ''}`

  return `
    <div style="text-align:center;margin-bottom:2px;font-size:22px;font-weight:bold;letter-spacing:6px;">${escapeHtml(d.company_name)}</div>
    <div style="text-align:center;margin-bottom:10px;font-size:18px;font-weight:bold;">${d.title}</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
      <div>送货日期：${d.date}</div><div>NO：${escapeHtml(d.order_no)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      ${infoRows}
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr>
        <th style="border:1px solid #000;padding:6px 4px;width:5%;">序号</th>
        <th style="border:1px solid #000;padding:6px 4px;width:20%;">商品名称</th>
        <th style="border:1px solid #000;padding:6px 4px;width:18%;">规格型号</th>
        <th style="border:1px solid #000;padding:6px 4px;width:5%;">单位</th>
        <th style="border:1px solid #000;padding:6px 4px;width:8%;">数量</th>
        <th style="border:1px solid #000;padding:6px 4px;width:11%;">单价(含税)</th>
        <th style="border:1px solid #000;padding:6px 4px;width:13%;">金额</th>
        <th style="border:1px solid #000;padding:6px 4px;width:11%;">备注</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3" style="border:1px solid #000;padding:5px 4px;font-weight:bold;">合计(含税)：${Number(d.total_amount || 0).toFixed(2)}元</td>
        <td colspan="5" style="border:1px solid #000;padding:5px 4px;font-weight:bold;">金额（大写）${escapeHtml(d.total_cn)}</td>
      </tr></tfoot>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr>
        <td style="border:1px solid #000;padding:4px 8px;width:70px;font-weight:bold;">备注</td>
        <td style="border:1px solid #000;padding:4px 8px;">${escapeHtml(d.remark)}</td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">
      <tr>
        <td style="padding:4px 0;vertical-align:top;text-align:left;">${d.sign_right}：</td>
      </tr>
    </table>`
}
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.el-pagination {
  margin-top: 16px;
  justify-content: flex-end;
}
/* 搜索条件较多，紧凑排布并允许换行 */
.search-form {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 0;
}
.search-form :deep(.el-form-item) {
  margin-bottom: 10px;
  margin-right: 14px;
}
.search-form :deep(.el-form-item__label) {
  padding-right: 6px;
}
/* 明细行规格：超长省略，不撑破表格 */
.spec-cell {
  font-size: 13px;
  color: #606266;
}
/* 单据金额汇总条 */
.amount-summary {
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
  gap: 20px;
  margin-top: 12px;
  font-size: 14px;
  color: #606266;
}
.amount-summary .grand {
  font-size: 17px;
  font-weight: bold;
  color: #f56c6c;
}
.tax-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 2px;
}
</style>

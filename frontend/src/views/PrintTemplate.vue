<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>打印模板</span>
          <div style="display:flex;gap:8px">
            <el-button @click="editCompany">设置公司信息</el-button>
            <el-button type="primary" @click="doPrint">打印</el-button>
          </div>
        </div>
      </template>
      <div ref="printRef" class="print-paper">
        <div style="text-align:center;margin-bottom:2px;font-size:22px;font-weight:bold;letter-spacing:6px;">{{ data.company_name }}</div>
        <div style="text-align:center;margin-bottom:10px;font-size:18px;font-weight:bold;">{{ data.title || '销售单' }}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px;">
          <div>送货日期: {{ data.date }}</div>
          <div>NO:{{ data.order_no }}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tr>
            <td style="border:1px solid #000;padding:4px 8px;width:80px;font-weight:bold;">{{ data.title === '采购单' ? '供应商' : '购货单位' }}</td>
            <td style="border:1px solid #000;padding:4px 8px;width:35%;">{{ data.partner_name }}</td>
            <td style="border:1px solid #000;padding:4px 8px;width:12%;font-weight:bold;">联系人</td>
            <td style="border:1px solid #000;padding:4px 8px;">{{ data.partner_contact }}</td>
          </tr>
          <tr>
            <td style="border:1px solid #000;padding:4px 8px;font-weight:bold;">地址电话</td>
            <td style="border:1px solid #000;padding:4px 8px;" colspan="3">{{ data.partner_address }}</td>
          </tr>
          <tr v-if="data.delivery_address">
            <td style="border:1px solid #000;padding:4px 8px;font-weight:bold;">送货地址</td>
            <td style="border:1px solid #000;padding:4px 8px;" colspan="3">{{ data.delivery_address }}</td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:0;">
          <thead>
            <tr>
              <th style="border:1px solid #000;padding:6px 4px;width:5%;">序号</th>
              <th style="border:1px solid #000;padding:6px 4px;width:15%;">品名</th>
              <th style="border:1px solid #000;padding:6px 4px;width:13%;">规格型号</th>
              <th style="border:1px solid #000;padding:6px 4px;width:8%;">单位</th>
              <th style="border:1px solid #000;padding:6px 4px;width:8%;">数量</th>
              <th style="border:1px solid #000;padding:6px 4px;width:10%;">单价(元)</th>
              <th style="border:1px solid #000;padding:6px 4px;width:12%;">金额(含税)</th>
              <th style="border:1px solid #000;padding:6px 4px;width:12%;">备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in (data.items || [])" :key="idx">
              <td style="border:1px solid #000;padding:5px 4px;text-align:center;">{{ idx + 1 }}</td>
              <td style="border:1px solid #000;padding:5px 4px;">{{ item.product_name }}</td>
              <td style="border:1px solid #000;padding:5px 4px;">{{ item.spec || '' }}</td>
              <td style="border:1px solid #000;padding:5px 4px;text-align:center;">{{ item.unit }}</td>
              <td style="border:1px solid #000;padding:5px 4px;text-align:center;">{{ item.quantity }}</td>
              <td style="border:1px solid #000;padding:5px 4px;text-align:right;">{{ Number(item.price).toFixed(2) }}</td>
              <td style="border:1px solid #000;padding:5px 4px;text-align:right;">{{ Number(item.amount || item.quantity * item.price).toFixed(2) }}</td>
              <td style="border:1px solid #000;padding:5px 4px;">{{ item.remark || '' }}</td>
            </tr>
            <tr v-for="n in Math.max(0, 8 - (data.items||[]).length)" :key="'e'+n">
              <td style="border:1px solid #000;padding:5px 4px;height:22px;">&nbsp;</td>
              <td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td>
              <td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td>
              <td style="border:1px solid #000;"></td><td style="border:1px solid #000;"></td>
              <td style="border:1px solid #000;"></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="border:1px solid #000;padding:5px 4px;font-weight:bold;">合计</td>
              <td colspan="2" style="border:1px solid #000;padding:5px 4px;font-weight:bold;">金额大写</td>
              <td colspan="3" style="border:1px solid #000;padding:5px 4px;">{{ amountInChinese(data.total_amount || 0) }}</td>
              <td style="border:1px solid #000;padding:5px 4px;text-align:right;font-weight:bold;">{{ Number(data.total_amount || 0).toFixed(2) }}</td>
            </tr>
          </tfoot>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:0;">
          <tr>
            <td style="border:1px solid #000;padding:4px 8px;width:8%;font-weight:bold;">备注</td>
            <td style="border:1px solid #000;padding:4px 8px;" colspan="3">{{ data.remark || '' }}</td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:0;">
          <tr>
            <td style="border:1px solid #000;padding:4px 8px;vertical-align:top;">
              <strong>说明</strong><br/>
              1. 本单为交易时使用，购方确认无误后签字。<br/>
              2. 有质量异议，应一周内提出，逾期概不负责。
            </td>
          </tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:4px;">
          <tr>
            <td style="padding:4px 0;vertical-align:top;text-align:left;">{{ data.title === '采购单' ? '供应商' : '收货单位' }}及经手人：</td>
          </tr>
        </table>
      </div>
    </el-card>

    <el-dialog v-model="companyDialogVisible" title="设置公司信息" width="500px">
      <el-form :model="companyForm" label-width="80px">
        <el-form-item label="公司名称"><el-input v-model="companyForm.company_name" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="companyForm.company_address" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="companyForm.company_phone" /></el-form-item>
        <el-form-item label="传真"><el-input v-model="companyForm.company_fax" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="companyDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCompany">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { printHtml } from '../utils/print'
import { amountInChinese } from '../utils/format'

const printRef = ref(null)
const companyDialogVisible = ref(false)

/** 打印数据（预览用空白模板，实际打印由 setPrintData 注入） */
const data = reactive({
  company_name: localStorage.getItem('print_company_name') || '厦门保盟科技有限公司',
  company_address: localStorage.getItem('print_company_address') || '',
  company_phone: localStorage.getItem('print_company_phone') || '',
  title: '销售单',
  date: new Date().toLocaleDateString('zh-CN'),
  order_no: '',
  partner_name: '',
  partner_contact: '',
  partner_address: '',
  delivery_address: '',
  total_amount: 0,
  remark: '',
  items: []
})

const companyForm = reactive({ company_name: '', company_address: '', company_phone: '', company_fax: '' })

const editCompany = () => {
  companyForm.company_name = data.company_name
  companyForm.company_address = data.company_address
  companyForm.company_phone = data.company_phone
  companyDialogVisible.value = true
}

const saveCompany = () => {
  data.company_name = companyForm.company_name
  data.company_address = companyForm.company_address
  data.company_phone = companyForm.company_phone
  localStorage.setItem('print_company_name', companyForm.company_name)
  localStorage.setItem('print_company_address', companyForm.company_address)
  localStorage.setItem('print_company_phone', companyForm.company_phone)
  companyDialogVisible.value = false
  ElMessage.success('已保存')
}

const setPrintData = (d) => { Object.assign(data, d) }

const doPrint = () => {
  const content = printRef.value.innerHTML
  printHtml(content)
}

defineExpose({ setPrintData })
</script>
<style scoped>
.card-header{display:flex;justify-content:space-between;align-items:center}
.print-paper{max-width:800px;margin:0 auto;padding:20px;background:white}
</style>

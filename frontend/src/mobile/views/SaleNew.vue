<template>
  <div class="page">
    <div class="card">
      <div class="field">
        <label class="field-label">客户 <span class="req">*</span></label>
        <!--
          占位项必须显式绑定空串，不能用 :value="null"：
          Vue 会把 null 渲染成**没有 value 属性**的 <option>，此时 DOM 的
          option.value 退化为其文本，用户点选占位项就会让 v-model 拿到
          「请选择客户」这个字符串，!customerId 校验随之失效。
        -->
        <select v-model="customerId" class="select">
          <option value="">请选择客户</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label">发货仓库</label>
        <select v-model="warehouseId" class="select">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>

      <div class="row" style="gap: 10px">
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">销售日期</label>
          <input v-model="saleDate" type="date" class="input" />
        </div>
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">税率(%)</label>
          <input v-model="taxRate" type="number" inputmode="decimal" min="0" class="input" />
        </div>
      </div>
      <div class="field-hint">单价为含税价；税率只影响「其中税额」的展示，不影响合计</div>
    </div>

    <!-- 商品明细 -->
    <div class="card">
      <div class="between">
        <div class="card-title" style="margin: 0">商品明细</div>
        <button class="btn btn-sm btn-primary" @click="openPicker">＋ 添加商品</button>
      </div>

      <div v-if="!items.length" class="empty" style="padding: 28px 0">
        还没有商品<br />
        <span class="tiny">点右上角「添加商品」从库存里选</span>
      </div>

      <div v-for="(it, idx) in items" :key="it.product_id" class="item-row">
        <div class="item-main">
          <div class="item-name">{{ it.product_name }}</div>
          <div class="item-sub">
            <span v-if="it.product_spec">{{ it.product_spec }} · </span>
            库存 {{ it.stock }} {{ it.product_unit || '' }}
          </div>

          <div class="row mt8" style="gap: 8px">
            <input
              v-model="it.quantity"
              class="input qty-input"
              type="number"
              inputmode="numeric"
              min="1"
              placeholder="数量"
            />
            <span class="tiny muted-3">×</span>
            <input
              v-model="it.price"
              class="input"
              type="number"
              inputmode="decimal"
              step="0.01"
              placeholder="单价"
              style="width: 96px; min-height: 38px; padding: 6px 8px; font-size: 15px"
            />
          </div>
        </div>

        <div class="right">
          <div class="item-amount num">{{ money(lineAmount(it)) }}</div>
          <button class="btn btn-sm btn-danger mt8" @click="removeItem(idx)">移除</button>
        </div>
      </div>
    </div>

    <!-- 运费 / 合计 -->
    <div class="card">
      <div class="field" style="margin-bottom: 10px">
        <label class="field-label">运费</label>
        <input v-model="freight" class="input" type="number" inputmode="decimal" step="0.01" min="0" />
      </div>
      <div class="kv"><span>明细合计</span><span class="num">{{ money(goodsTotal) }}</span></div>
      <div class="kv"><span>其中税额</span><span class="num muted">{{ money(taxTotal) }}</span></div>
      <div class="kv" style="border-top: 1px solid var(--line); margin-top: 6px; padding-top: 10px">
        <span class="bold">整单合计</span>
        <span class="bold num" style="font-size: 19px; color: #2f6fed">{{ money(grandTotal) }}</span>
      </div>
    </div>

    <!-- 送货信息：地址 + 接收人，送货单/打印件上要用 -->
    <div class="card">
      <div class="card-title">送货信息</div>

      <div class="field">
        <label class="field-label">送货地址</label>
        <input v-model.trim="deliveryAddress" class="input" type="text" placeholder="选填，送到哪里" />
      </div>

      <div class="row" style="gap: 10px">
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">接收人</label>
          <input v-model.trim="receiverName" class="input" type="text" placeholder="选填" />
        </div>
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">接收人电话</label>
          <input v-model.trim="receiverPhone" class="input" type="tel" inputmode="tel" placeholder="选填" />
        </div>
      </div>
    </div>

    <div class="actionbar">
      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ saving ? '提交中…' : '保存草稿' }}
      </button>
    </div>

    <!-- 商品选择弹层 -->
    <div v-if="pickerVisible" class="mask" @click.self="pickerVisible = false">
      <div class="sheet">
        <div class="sheet-title">选择商品</div>

        <div class="searchbar">
          <input
            v-model.trim="pk.keyword"
            class="input"
            type="search"
            placeholder="商品名称 / 编码"
            @keyup.enter="searchProducts"
          />
          <button class="btn btn-primary" @click="searchProducts">查询</button>
        </div>

        <div v-if="pk.loading" class="loading"><div class="spinner" />加载中…</div>
        <div v-else-if="!pk.items.length" class="empty" style="padding: 28px 0">
          没有匹配的商品<br />
          <span class="tiny">换个关键词，或先到桌面端建立商品资料</span>
        </div>

        <div v-else>
          <button
            v-for="p in pk.items"
            :key="p.id"
            class="picker-item"
            @click="addProduct(p)"
          >
            <div class="grow" style="text-align: left">
              <div class="bold">{{ p.product_name }}</div>
              <div class="tiny muted-3 mt8">
                <span v-if="p.product_sku">{{ p.product_sku }}</span>
                <span v-if="p.product_spec"> · {{ p.product_spec }}</span>
              </div>
              <div class="small mt8">
                售价 <span class="num" style="color: #2f6fed; font-weight: 600">{{ money(p.sale_price) }}</span>
                <span class="muted-3"> · 库存 {{ p.quantity }}</span>
              </div>
            </div>
            <span class="chip" :class="num(p.quantity) > 0 ? 'green' : 'gray'">
              {{ num(p.quantity) > 0 ? '有货' : '无货' }}
            </span>
          </button>

          <div class="center mt12">
            <button v-if="pk.hasMore" class="btn btn-sm" :disabled="pk.loading" @click="loadMoreProducts">
              加载更多
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api, errMsg } from '../api'
import { session, toast } from '../store'
import { money, num, today } from '../util'

const router = useRouter()

const customers = ref([])
const warehouses = ref([])
const customerId = ref('')   // '' = 未选择；见模板里关于占位项绑定的说明
const warehouseId = ref(null)
const saleDate = ref(today())
// 与桌面端保持一致：默认 13%（桌面 Purchase.vue / Sales.vue 新增明细也是 13）
const taxRate = ref(13)
const freight = ref(0)
// 送货信息（可选）：送货地址 + 接收人姓名/电话
const deliveryAddress = ref('')
const receiverName = ref('')
const receiverPhone = ref('')
const items = ref([])
const saving = ref(false)

const pickerVisible = ref(false)
const pk = reactive({ keyword: '', items: [], total: 0, page: 1, loading: false, hasMore: false })

const lineAmount = (it) => num(it.quantity) * num(it.price)
const goodsTotal = computed(() => items.value.reduce((s, it) => s + lineAmount(it), 0))
const taxTotal = computed(() => {
  const r = num(taxRate.value)
  if (r <= -100) return 0
  return items.value.reduce((s, it) => {
    const gross = lineAmount(it)
    return s + (gross - gross / (1 + r / 100))
  }, 0)
})
const grandTotal = computed(() => goodsTotal.value + num(freight.value))

function addProduct(p) {
  const exist = items.value.find((x) => x.product_id === p.product_id)
  if (exist) {
    exist.quantity = num(exist.quantity) + 1
  } else {
    items.value.push({
      product_id: p.product_id,
      product_name: p.product_name,
      product_spec: p.product_spec || '',
      product_unit: p.product_unit || '',
      stock: p.quantity,
      quantity: 1,
      price: num(p.sale_price),
    })
  }
  pickerVisible.value = false
  toast.success(`已添加 ${p.product_name}`)
}

function removeItem(idx) {
  items.value.splice(idx, 1)
}

function openPicker() {
  pickerVisible.value = true
  pk.keyword = ''
  searchProducts()
}

async function searchProducts() {
  pk.page = 1
  pk.items = []
  await loadProducts(true)
}

async function loadProducts(reset) {
  pk.loading = true
  try {
    const res = await api.inventory({
      page: pk.page,
      page_size: 20,
      keyword: pk.keyword || undefined,
      warehouse_id: warehouseId.value || undefined,
    })
    const list = res.items || []
    pk.items = reset ? list : pk.items.concat(list)
    pk.total = res.total || 0
    pk.hasMore = pk.items.length < pk.total
    pk.page += 1
  } catch {
    /* 拦截器已提示 */
  } finally {
    pk.loading = false
  }
}

function loadMoreProducts() {
  loadProducts(false)
}

async function submit() {
  if (!customerId.value) return toast.error('请选择客户')
  if (!items.value.length) return toast.error('请至少添加一个商品')

  for (const it of items.value) {
    if (!(num(it.quantity) > 0)) return toast.error(`「${it.product_name}」数量必须大于 0`)
    if (num(it.price) < 0) return toast.error(`「${it.product_name}」单价不能为负`)
  }

  saving.value = true
  try {
    const res = await api.createSalesOrder({
      customer_id: customerId.value,
      warehouse_id: warehouseId.value || undefined,
      sale_date: saleDate.value || undefined,
      seller: (session.user && (session.user.full_name || session.user.username)) || undefined,
      freight: num(freight.value),
      delivery_address: deliveryAddress.value || undefined,
      receiver_name: receiverName.value || undefined,
      receiver_phone: receiverPhone.value || undefined,
      items: items.value.map((it) => ({
        product_id: it.product_id,
        quantity: num(it.quantity),
        price: num(it.price),
        tax_rate: num(taxRate.value),
      })),
    })
    toast.success(`已保存：${res.order_no}`)
    router.replace(`/m/sales/${res.id}`)
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const [cs, ws] = await Promise.all([
      api.customers({ page: 1, page_size: 100, status: 1 }),
      api.warehouses(),
    ])
    customers.value = cs.items || []
    warehouses.value = ws || []
    if (warehouses.value.length) warehouseId.value = warehouses.value[0].id
  } catch {
    /* 拦截器已提示 */
  }
})
</script>

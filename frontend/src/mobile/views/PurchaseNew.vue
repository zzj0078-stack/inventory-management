<template>
  <div class="page">
    <div class="card">
      <div class="field">
        <label class="field-label">供应商 <span class="req">*</span></label>
        <!--
          占位项必须显式绑定空串，不能用 :value="null"：
          Vue 会把 null 渲染成**没有 value 属性**的 <option>，此时 DOM 的
          option.value 退化为其文本，用户点选占位项就会让 v-model 拿到
          「请选择供应商」这个字符串，!supplierId 校验随之失效。
        -->
        <select v-model="supplierId" class="select">
          <option value="">请选择供应商</option>
          <option v-for="s in suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <div class="field">
        <label class="field-label">收货仓库</label>
        <select v-model="warehouseId" class="select">
          <option v-for="w in warehouses" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </div>

      <div class="row" style="gap: 10px">
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">采购日期</label>
          <input v-model="purchaseDate" type="date" class="input" />
        </div>
        <div class="field grow" style="margin-bottom: 0">
          <label class="field-label">预计到货</label>
          <input v-model="expectedDate" type="date" class="input" />
        </div>
      </div>

      <div class="field mt8" style="margin-bottom: 0">
        <label class="field-label">税率(%)</label>
        <input v-model="taxRate" type="number" inputmode="decimal" min="0" class="input" />
      </div>
      <div class="field-hint">单价为含税价；税率只影响「其中税额」的展示，不影响合计</div>
    </div>

    <!-- 商品明细 -->
    <div class="card">
      <div class="between">
        <div class="card-title" style="margin: 0">采购明细</div>
        <button class="btn btn-sm btn-primary" @click="openPicker">＋ 添加商品</button>
      </div>

      <div v-if="!items.length" class="empty" style="padding: 28px 0">
        还没有商品<br />
        <span class="tiny">点右上角「添加商品」从商品资料里选</span>
      </div>

      <div v-for="(it, idx) in items" :key="it.product_id" class="item-row">
        <div class="item-main">
          <div class="item-name">{{ it.product_name }}</div>
          <div class="item-sub">
            <span v-if="it.product_spec">{{ it.product_spec }} · </span>
            当前库存 {{ it.stock }} {{ it.product_unit || '' }}
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

    <div class="field">
      <label class="field-label">备注</label>
      <input v-model="remark" class="input" type="text" placeholder="选填" />
    </div>

    <div class="actionbar">
      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ saving ? '提交中…' : '保存草稿' }}
      </button>
    </div>

    <!-- 商品选择弹层：采购从「商品资料」选，不是从库存选 -->
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
              <div class="bold">{{ p.name }}</div>
              <div class="tiny muted-3 mt8">
                <span v-if="p.sku">{{ p.sku }}</span>
                <span v-if="p.spec"> · {{ p.spec }}</span>
              </div>
              <div class="small mt8">
                进价 <span class="num" style="color: #2f6fed; font-weight: 600">{{ money(p.purchase_price) }}</span>
                <span v-if="p.stock != null" class="muted-3"> · 库存 {{ p.stock }}</span>
              </div>
            </div>
            <span class="chip gray">{{ p.unit || '' }}</span>
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

const suppliers = ref([])
const warehouses = ref([])
const supplierId = ref('')   // '' = 未选择；见模板里关于占位项绑定的说明
const warehouseId = ref(null)
const purchaseDate = ref(today())
const expectedDate = ref('')
// 与桌面端保持一致：默认 13%
const taxRate = ref(13)
const freight = ref(0)
const remark = ref('')
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
  const exist = items.value.find((x) => x.product_id === p.id)
  if (exist) {
    exist.quantity = num(exist.quantity) + 1
  } else {
    items.value.push({
      product_id: p.id,
      product_name: p.name,
      product_spec: p.spec || '',
      product_unit: p.unit || '',
      stock: p.stock,
      quantity: 1,
      price: num(p.purchase_price),
    })
  }
  pickerVisible.value = false
  toast.success(`已添加 ${p.name}`)
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

/**
 * 从「商品资料」搜索，而不是从库存。
 *
 * 采购是买入动作：新品、库存为 0 的商品同样要能开进采购单，
 * 而 /inventory 只返回已有库存记录的商品，会把它们漏掉。
 * 库存数作为参考信息按需补充（失败也不影响选品）。
 */
async function loadProducts(reset) {
  pk.loading = true
  try {
    const res = await api.products({
      page: pk.page,
      page_size: 20,
      keyword: pk.keyword || undefined,
      status: 1,
    })
    const list = res.items || []
    pk.items = reset ? list : pk.items.concat(list)
    pk.total = res.total || 0
    pk.hasMore = pk.items.length < pk.total
    pk.page += 1
    fillStock(pk.items)
  } catch {
    /* 拦截器已提示 */
  } finally {
    pk.loading = false
  }
}

/** 批量取库存作为参考；没有库存记录的商品显示为 0 */
let stockCache = null
async function fillStock(list) {
  try {
    if (!stockCache) {
      const inv = await api.inventory({ page: 1, page_size: 200 })
      stockCache = new Map((inv.items || []).map((x) => [x.product_id, num(x.quantity)]))
    }
    for (const p of list) {
      if (p.stock == null) p.stock = stockCache.get(p.id) ?? 0
    }
  } catch {
    /* 库存只是参考信息，取不到就算了 */
  }
}

function loadMoreProducts() {
  loadProducts(false)
}

async function submit() {
  if (!supplierId.value) return toast.error('请选择供应商')
  if (!items.value.length) return toast.error('请至少添加一个商品')

  for (const it of items.value) {
    if (!(num(it.quantity) > 0)) return toast.error(`「${it.product_name}」数量必须大于 0`)
    if (num(it.price) < 0) return toast.error(`「${it.product_name}」单价不能为负`)
  }

  saving.value = true
  try {
    const res = await api.createPurchaseOrder({
      supplier_id: supplierId.value,
      warehouse_id: warehouseId.value || undefined,
      purchase_date: purchaseDate.value || undefined,
      expected_date: expectedDate.value || undefined,
      buyer: (session.user && (session.user.full_name || session.user.username)) || undefined,
      freight: num(freight.value),
      remark: remark.value || undefined,
      items: items.value.map((it) => ({
        product_id: it.product_id,
        quantity: num(it.quantity),
        price: num(it.price),
        tax_rate: num(taxRate.value),
      })),
    })
    toast.success(`已保存：${res.order_no}`)
    router.replace(`/m/purchase/${res.id}`)
  } catch (e) {
    if (!e.friendlyMessage) toast.error(errMsg(e, '保存失败'))
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const [ss, ws] = await Promise.all([
      api.suppliers({ page: 1, page_size: 100, status: 1 }),
      api.warehouses(),
    ])
    suppliers.value = ss.items || []
    warehouses.value = ws || []
    if (warehouses.value.length) warehouseId.value = warehouses.value[0].id
  } catch {
    /* 拦截器已提示 */
  }
})
</script>

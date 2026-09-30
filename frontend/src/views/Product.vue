<template>
  <div class="page-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>商品管理</span>
          <div>
            <el-button v-permission="'category:view'" @click="openCategoryManager">分类管理</el-button>
            <el-button v-permission="'product:add'" type="primary" @click="handleAddProduct">
              <el-icon><Plus /></el-icon> 新增商品
            </el-button>
          </div>
        </div>
      </template>
      
      <el-form :inline="true" :model="searchForm">
        <el-form-item label="分类">
          <el-select v-model="searchForm.category_id" placeholder="全部分类" clearable :value-on-clear="null" style="width:150px">
            <el-option v-for="item in categories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="searchForm.keyword" placeholder="名称/编码/条码" clearable style="width:200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadProducts">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="products" v-loading="productLoading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="60" align="center" />
        <el-table-column label="图片" width="70" align="center">
          <template #default="{ row }">
            <el-image
              v-if="row.image_url"
              :src="row.image_url"
              :preview-src-list="[row.image_url]"
              preview-teleported
              fit="cover"
              class="list-thumb"
            />
            <span v-else class="no-img">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="商品名称" min-width="200" show-overflow-tooltip />
        <el-table-column prop="sku" label="商品编码" width="140" show-overflow-tooltip />
        <el-table-column prop="spec" label="规格" min-width="160" show-overflow-tooltip />
        <el-table-column prop="unit" label="单位" width="70" align="center" />
        <el-table-column v-if="canSeeCost" prop="purchase_price" label="采购价" width="100" align="right" />
        <el-table-column prop="sale_price" label="销售价" width="100" align="right" />
        <el-table-column prop="min_stock" label="最低库存" width="90" align="center" />
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{row}"><el-tag :type="row.status===1?'success':'danger'" size="small">{{ row.status===1?'启用':'禁用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button v-permission="'product:edit'" type="primary" link size="small" @click="handleEditProduct(row)">编辑</el-button>
            <el-button v-permission="'product:delete'" type="danger" link size="small" @click="handleDeleteProduct(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        style="margin-top:16px;justify-content:flex-end"
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.pageSize"
        :total="pagination.total"
        layout="total, sizes, prev, pager, next"
        @change="loadProducts"
      />
    </el-card>

    <!-- 分类管理 -->
    <el-dialog v-model="categoryManagerVisible" title="分类管理" width="520px">
      <div style="margin-bottom:12px">
        <el-button v-permission="'category:add'" type="primary" size="small" @click="handleAddCategory">
          <el-icon><Plus /></el-icon> 新增分类
        </el-button>
      </div>
      <el-table :data="categories" v-loading="categoryLoading" border stripe style="width:100%">
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="name" label="分类名称" min-width="140" />
        <el-table-column prop="sort_order" label="排序" width="80" align="center" />
        <el-table-column label="操作" width="140" align="center">
          <template #default="{ row }">
            <el-button v-permission="'category:edit'" type="primary" link size="small" @click="handleEditCategory(row)">编辑</el-button>
            <el-button v-permission="'category:delete'" type="danger" link size="small" @click="handleDeleteCategory(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="categoryManagerVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 分类编辑 -->
    <el-dialog v-model="categoryDialogVisible" :title="categoryDialogTitle" width="400px" append-to-body>
      <el-form ref="categoryFormRef" :model="categoryForm" :rules="categoryRules" label-width="80px">
        <el-form-item label="分类名称" prop="name">
          <el-input v-model="categoryForm.name" placeholder="请输入分类名称" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="categoryForm.sort_order" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="categoryDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="categorySubmitLoading" @click="handleSubmitCategory">确定</el-button>
      </template>
    </el-dialog>

    <!-- 商品对话框 -->
    <el-dialog v-model="productDialogVisible" :title="productDialogTitle" width="600px">
      <el-form ref="productFormRef" :model="productForm" :rules="productRules" label-width="100px">
        <el-form-item label="商品名称" prop="name">
          <el-input v-model="productForm.name" placeholder="请输入商品名称" />
        </el-form-item>
        <el-form-item label="所属分类">
          <el-select v-model="productForm.category_id" placeholder="请选择分类" clearable style="width:100%">
            <el-option
              v-for="item in categories"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            >
              <div class="cat-option">
                <span>{{ item.name }}</span>
                <span class="cat-actions">
                  <el-icon
                    v-permission="'category:delete'"
                    title="删除该分类"
                    @mousedown.prevent.stop
                    @click.stop.prevent="handleDeleteCategoryInline(item)"
                  ><Delete /></el-icon>
                </span>
              </div>
            </el-option>
            <el-option v-if="!categories.length" disabled value="" label="暂无分类，请先新增" />
          </el-select>
        </el-form-item>
        <el-form-item label="商品编码">
          <el-input v-model="productForm.sku" placeholder="商品唯一编码，如 HW-M60P-256" />
        </el-form-item>
        <el-form-item label="条码">
          <el-input v-model="productForm.barcode" placeholder="商品条码" />
        </el-form-item>
        <el-form-item label="基本单位" prop="unit">
          <el-input v-model="productForm.unit" placeholder="个/箱/件" />
        </el-form-item>
        <el-form-item label="规格">
          <el-input v-model="productForm.spec" placeholder="商品规格" />
        </el-form-item>
        <el-form-item label="商品图片">
          <div class="img-uploader">
            <el-upload
              class="img-upload"
              :show-file-list="false"
              :http-request="uploadImage"
              accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
              :before-upload="beforeImageUpload"
            >
              <img v-if="productForm.image_url" :src="productForm.image_url" class="img-preview" />
              <div v-else class="img-placeholder">
                <el-icon><Plus /></el-icon>
                <span>上传图片</span>
              </div>
            </el-upload>
            <div class="img-actions">
              <el-button v-if="productForm.image_url" link type="danger" size="small" @click="productForm.image_url = ''">
                移除图片
              </el-button>
              <span class="img-hint">
                选填，可不上传<br />
                JPG / PNG / GIF / WEBP / BMP，不超过 5 MB
              </span>
            </div>
          </div>
        </el-form-item>
        <el-row :gutter="20">
          <el-col v-if="canSeeCost" :span="12">
            <el-form-item label="采购价">
              <el-input-number v-model="productForm.purchase_price" :precision="2" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="canSeeCost ? 12 : 24">
            <el-form-item label="销售价">
              <el-input-number v-model="productForm.sale_price" :precision="2" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="最低库存">
          <el-input-number v-model="productForm.min_stock" :min="0" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="productForm.remark" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="productDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="productSubmitLoading" @click="handleSubmitProduct">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getCategories, createCategory, updateCategory, deleteCategory } from '../api/modules'
import { getProducts, createProduct, updateProduct, deleteProduct, uploadProductImage } from '../api/modules'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { confirmDelete } from '../utils/confirm'
import { useUserStore } from '../store/user'

const userStore = useUserStore()
/** 成本价（采购价）需要 product:cost 权限；销售员默认没有，后端也不返回该字段 */
const canSeeCost = computed(() => userStore.hasPermission('product:cost'))

// 分类相关
const categoryLoading = ref(false)
const categorySubmitLoading = ref(false)
const categories = ref([])
const categoryDialogVisible = ref(false)
const categoryManagerVisible = ref(false)
const categoryDialogTitle = ref('')
const categoryFormRef = ref(null)
const editCategoryId = ref(null)
const selectedCategory = ref(null)

const categoryForm = reactive({
  name: '',
  sort_order: 0
})

const categoryRules = {
  name: [{ required: true, message: '请输入分类名称', trigger: 'blur' }]
}

// 商品相关
const productLoading = ref(false)
const productSubmitLoading = ref(false)
const products = ref([])
const productDialogVisible = ref(false)
const productDialogTitle = ref('')
const productFormRef = ref(null)
const editProductId = ref(null)

const searchForm = reactive({ keyword: '', category_id: null })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

const productForm = reactive({
  name: '',
  category_id: null,
  sku: '',
  barcode: '',
  unit: '',
  spec: '',
  image_url: '',
  purchase_price: 0,
  sale_price: 0,
  min_stock: 0,
  remark: ''
})

const productRules = {
  name: [{ required: true, message: '请输入商品名称', trigger: 'blur' }],
  unit: [{ required: true, message: '请输入单位', trigger: 'blur' }]
}

// 分类方法
const loadCategories = async () => {
  categoryLoading.value = true
  try {
    categories.value = await getCategories()
  } finally {
    categoryLoading.value = false
  }
}

const openCategoryManager = async () => {
  await loadCategories()
  categoryManagerVisible.value = true
}

const handleAddCategory = () => {
  editCategoryId.value = null
  categoryForm.name = ''
  categoryForm.sort_order = 0
  categoryDialogTitle.value = '新增分类'
  categoryDialogVisible.value = true
}

const handleEditCategory = (row) => {
  editCategoryId.value = row.id
  categoryForm.name = row.name
  categoryForm.sort_order = row.sort_order
  categoryDialogTitle.value = '编辑分类'
  categoryDialogVisible.value = true
}

const handleSubmitCategory = async () => {
  await categoryFormRef.value.validate()
  categorySubmitLoading.value = true
  try {
    if (editCategoryId.value) {
      await updateCategory(editCategoryId.value, categoryForm)
      ElMessage.success('更新成功')
    } else {
      await createCategory(categoryForm)
      ElMessage.success('创建成功')
    }
    categoryDialogVisible.value = false
    loadCategories()
  } finally {
    categorySubmitLoading.value = false
  }
}

const handleDeleteCategory = async (row) => {
  await confirmDelete(`分类「${row.name}」`, '该分类下的商品不会被删除，但会失去分类归属。')
  await deleteCategory(row.id)
  ElMessage.success('删除成功')
  if (selectedCategory.value?.id === row.id) {
    selectedCategory.value = null
  }
  loadCategories()
  loadProducts()
}

const handleCategoryClick = (row) => {
  selectedCategory.value = row
  searchForm.keyword = ''
  pagination.page = 1
  loadProducts()
}

/** 下拉内联删除分类 */
const handleDeleteCategoryInline = async (item) => {
  try {
    await confirmDelete(`分类「${item.name}」`, '该分类下的商品不会被删除，但会失去分类归属。')
  } catch {
    return
  }
  try {
    await deleteCategory(item.id)
    ElMessage.success('分类已删除')
    if (productForm.category_id === item.id) productForm.category_id = null
    if (searchForm.category_id === item.id) searchForm.category_id = null
    if (selectedCategory.value?.id === item.id) selectedCategory.value = null
    await loadCategories()
    await loadProducts()
  } catch (e) {
    // 错误已由拦截器提示（如分类下有商品）
    await loadCategories()
  }
}

// 商品方法
const loadProducts = async () => {
  productLoading.value = true
  try {
    const res = await getProducts({
      page: pagination.page,
      page_size: pagination.pageSize,
      keyword: searchForm.keyword,
      category_id: searchForm.category_id
    })
    products.value = res.items
    pagination.total = res.total
  } finally {
    productLoading.value = false
  }
}

const resetSearch = () => {
  searchForm.keyword = ''
  searchForm.category_id = null
  pagination.page = 1
  loadProducts()
}

const handleAddProduct = () => {
  editProductId.value = null
  productForm.name = ''
  productForm.category_id = selectedCategory.value?.id || null
  productForm.sku = ''
  productForm.barcode = ''
  productForm.unit = ''
  productForm.spec = ''
  productForm.image_url = ''
  productForm.purchase_price = 0
  productForm.sale_price = 0
  productForm.min_stock = 0
  productForm.remark = ''
  productDialogTitle.value = '新增商品'
  productDialogVisible.value = true
}

/* ---------- 商品图片上传 ---------- */
const uploading = ref(false)

const beforeImageUpload = (file) => {
  // 图片是选填项：空文件直接忽略，不提示错误
  if (!file || !file.size) return false

  const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']
  if (!ok.includes(file.type)) {
    ElMessage.error('仅支持 JPG / PNG / GIF / WEBP / BMP 格式')
    return false
  }
  if (file.size > 5 * 1024 * 1024) {
    ElMessage.error(`图片不能超过 5 MB（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB）`)
    return false
  }
  return true
}

const uploadImage = async ({ file }) => {
  if (!file || !file.size) return          // 未选文件/空文件：保持原图片不变
  uploading.value = true
  try {
    const res = await uploadProductImage(file)
    productForm.image_url = res.url
    ElMessage.success('图片上传成功')
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    uploading.value = false
  }
}

const handleEditProduct = (row) => {
  editProductId.value = row.id
  productForm.name = row.name
  productForm.category_id = row.category_id
  productForm.sku = row.sku || ''
  productForm.barcode = row.barcode || ''
  productForm.unit = row.unit || ''
  productForm.spec = row.spec || ''
  productForm.image_url = row.image_url || ''
  productForm.purchase_price = row.purchase_price || 0
  productForm.sale_price = row.sale_price || 0
  productForm.min_stock = row.min_stock || 0
  productForm.remark = row.remark || ''
  productDialogTitle.value = '编辑商品'
  productDialogVisible.value = true
}

const handleSubmitProduct = async () => {
  await productFormRef.value.validate()
  productSubmitLoading.value = true
  try {
    if (editProductId.value) {
      await updateProduct(editProductId.value, productForm)
      ElMessage.success('更新成功')
    } else {
      await createProduct(productForm)
      ElMessage.success('创建成功')
    }
    productDialogVisible.value = false
    loadProducts()
  } finally {
    productSubmitLoading.value = false
  }
}

const handleDeleteProduct = async (row) => {
  await confirmDelete(`商品「${row.name}」`, `商品编码：${row.sku || '无'}`)
  await deleteProduct(row.id)
  ElMessage.success('删除成功')
  loadProducts()
}

onMounted(() => {
  loadCategories()
  loadProducts()
})
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
.cat-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.cat-actions {
  opacity: 0;
  transition: opacity 0.15s;
  display: inline-flex;
  align-items: center;
  color: #f56c6c;
  font-size: 15px;
}
.el-select-dropdown__item:hover .cat-actions {
  opacity: 1;
}
/* ---------- 商品图片上传 ---------- */
.img-uploader {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.img-upload :deep(.el-upload) {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s;
  background: #fafafa;
}
.img-upload :deep(.el-upload:hover) {
  border-color: #409eff;
}
.img-preview {
  display: block;
  width: 120px;
  height: 120px;
  object-fit: cover;
}
.img-placeholder {
  width: 120px;
  height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #8c939d;
  font-size: 12px;
}
.img-placeholder .el-icon {
  font-size: 26px;
}
.img-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
}
.img-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.list-thumb {
  width: 44px;
  height: 44px;
  border-radius: 4px;
  display: block;
  margin: 0 auto;
}
.no-img {
  color: #c0c4cc;
}
</style>

<style>
/* el-option 内容在 popper 中，scoped 覆盖不到 */
.el-select-dropdown__item .cat-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.el-select-dropdown__item .cat-actions {
  opacity: 0;
  transition: opacity 0.15s;
  display: inline-flex;
  align-items: center;
  color: #f56c6c;
}
.el-select-dropdown__item:hover .cat-actions {
  opacity: 1;
}
</style>

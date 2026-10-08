<template>
  <div v-if="total > 0" class="pager">
    <button
      class="pager-btn"
      type="button"
      :disabled="loading || page <= 1"
      @click="go(page - 1)"
    >
      ‹ 上一页
    </button>

    <span class="pager-info">
      第 <b>{{ page }}</b> / {{ totalPages }} 页
      <span class="pager-total">共 {{ total }} 条</span>
    </span>

    <button
      class="pager-btn"
      type="button"
      :disabled="loading || page >= totalPages"
      @click="go(page + 1)"
    >
      下一页 ›
    </button>
  </div>
</template>

<script setup>
/**
 * 移动端分页条。
 *
 * 手机宽度放不下页码按钮列表（单据动辄几十页），所以用「上一页 / 下一页 +
 * 第 X / Y 页」这种紧凑形式，并显示总条数。
 *
 * 不自己请求数据：只把目标页码抛给父组件，由父组件决定取数与缓存策略。
 */
import { computed } from 'vue'

const props = defineProps({
  page: { type: Number, default: 1 },
  total: { type: Number, default: 0 },
  pageSize: { type: Number, default: 20 },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['change'])

const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.total / (props.pageSize || 20)))
)

function go(p) {
  if (props.loading) return
  if (p < 1 || p > totalPages.value) return
  if (p === props.page) return
  emit('change', p)
}
</script>

<style scoped>
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 0 4px;
}

.pager-btn {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  color: var(--text);
  font-size: 14px;
  line-height: 1;
}

.pager-btn:disabled {
  color: var(--text-3);
  background: #f7f8fa;
}

.pager-btn:not(:disabled):active {
  transform: scale(0.97);
}

.pager-info {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.4;
}

.pager-info b {
  color: var(--text);
  font-size: 14px;
}

.pager-total {
  display: block;
  font-size: 12px;
  color: var(--text-3);
}
</style>

<template>
  <router-view />
</template>

<script setup>
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Arial, sans-serif;
}

/* 单行省略：用于表格中的长文本列（供应商/客户/备注/地址等） */
.ellipsis-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 表格表头与单元格统一字号，避免中文换行错位 */
.el-table th.el-table__cell > .cell {
  white-space: nowrap;
  font-weight: 600;
}

/* 数字列右对齐时的字距 */
.el-table .is-right > .cell {
  font-variant-numeric: tabular-nums;
}
</style>

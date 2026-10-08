<template>
  <!-- 安装引导：安卓直接调系统安装框；iOS 只给图文步骤 -->
  <div v-if="install.visible" class="mask" @click.self="dismissInstall">
    <div class="sheet install-sheet">
      <div class="install-head">
        <img class="install-icon" src="/mobile-icon-192.png" alt="应用图标" />
        <div class="grow">
          <div class="sheet-title" style="margin-bottom: 4px">安装到主屏幕</div>
          <div class="tiny muted-3">像 App 一样打开，不用每次输网址</div>
        </div>
      </div>

      <!-- iOS：浏览器不支持自动安装，只能给步骤。
           安卓在 prompt 不可用时（信号未就绪/抛错）也切到这里 -->
      <ol v-if="needsSteps" class="install-steps">
        <li>点底部工具栏的 <b>分享</b> 按钮 <span class="install-glyph">⬆︎</span></li>
        <li>在列表里选 <b>「添加到主屏幕」</b></li>
        <li>点右上角 <b>「添加」</b> 完成</li>
      </ol>

      <!-- 可调系统安装框 -->
      <div v-else class="install-steps">
        <div class="tiny muted-3">
          点下面的按钮，浏览器会弹出安装确认框。
        </div>
      </div>

      <div class="btn-row mt16">
        <button class="btn" @click="dismissInstall">以后再说</button>
        <button
          v-if="canOneTap"
          class="btn btn-primary"
          :disabled="busy"
          @click="onInstall"
        >
          {{ busy ? '安装中…' : '立即安装' }}
        </button>
        <button v-else class="btn btn-primary" @click="dismissInstall">知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { install, doInstall, dismissInstall, toast } from '../store'

const busy = ref(false)

/** 点了「立即安装」但 prompt 不可用/出错时，切成图文步骤 */
const showSteps = ref(false)

/** 需要展示手动步骤：iOS，或 prompt 不可用/出过错。
 *
 * iOS 必须**优先**判定：Safari 上 prompt() 即使拿到事件也装不了，
 * 显示「立即安装」按钮是误导。 */
const needsSteps = computed(() => install.isIOS || showSteps.value || !install.canPrompt)

/** 只有非 iOS 且真的拿到了 prompt 才给「立即安装」 */
const canOneTap = computed(() => !install.isIOS && install.canPrompt && !showSteps.value)

async function onInstall() {
  busy.value = true
  try {
    const res = await doInstall()
    if (res && res.outcome === 'accepted') {
      toast.success('已开始安装')
    } else if (res && (res.outcome === 'unavailable' || res.outcome === 'error')) {
      showSteps.value = true
      install.visible = true
      toast.info('请按下面的步骤手动添加')
    }
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.install-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

/* .sheet-title 默认居中；这里它跟在图标右侧，要改成左对齐 */
.install-head .sheet-title {
  text-align: left;
}

.install-icon {
  width: 48px;
  height: 48px;
  border-radius: 11px;
  flex: none;
}

.install-steps {
  margin: 0;
  padding-left: 20px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--text-2);
}

.install-glyph {
  color: var(--primary);
  font-weight: 700;
}
</style>

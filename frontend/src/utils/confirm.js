import { ElMessageBox } from 'element-plus'

/** 删除二次确认：显示对象名 + 不可恢复提示 */
export function confirmDelete(name, extra = '') {
  return ElMessageBox.confirm(
    `<div style="line-height:1.9">
       <div>即将删除：<b>${name}</b></div>
       ${extra ? `<div style="color:#606266">${extra}</div>` : ''}
       <div style="color:#f56c6c;margin-top:6px">删除后不可恢复。</div>
     </div>`,
    '确认删除',
    {
      dangerouslyUseHTMLString: true,
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      closeOnClickModal: false
    }
  )
}

/** 作废二次确认 */
export function confirmCancel(name, extra = '') {
  return ElMessageBox.confirm(
    `<div style="line-height:1.9">
       <div>即将作废：<b>${name}</b></div>
       ${extra ? `<div style="color:#606266">${extra}</div>` : ''}
       <div style="color:#f56c6c;margin-top:6px">作废后单据不再参与业务统计。</div>
     </div>`,
    '确认作废',
    {
      dangerouslyUseHTMLString: true,
      type: 'warning',
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
      closeOnClickModal: false
    }
  )
}

/** 通用二次确认 */
export function confirmAction(title, body, confirmText = '确定', type = 'warning') {
  return ElMessageBox.confirm(
    `<div style="line-height:1.9">${body}</div>`,
    title,
    {
      dangerouslyUseHTMLString: true,
      type,
      confirmButtonText: confirmText,
      cancelButtonText: '取消',
      closeOnClickModal: false
    }
  )
}

/** 仅提示（无取消） */
export function alertInfo(title, body, type = 'warning') {
  return ElMessageBox.alert(
    `<div style="line-height:1.9">${body}</div>`,
    title,
    { dangerouslyUseHTMLString: true, type, confirmButtonText: '我知道了' }
  )
}

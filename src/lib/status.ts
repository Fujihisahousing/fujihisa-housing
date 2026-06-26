// 部屋の状況バッジの色。入居=緑／空室=赤／入予=青／退予=ピンク／停止=グレー。
export function statusBadgeClass(status?: string | null): string {
  switch (status) {
    case '入居':
      return 'bg-emerald-50 text-emerald-700'
    case '空室':
      return 'bg-rose-50 text-rose-700'
    case '入予':
    case '予定': // 旧名（後方互換）
      return 'bg-sky-50 text-sky-700'
    case '退予':
      return 'bg-pink-100 text-pink-700'
    case '停止':
      return 'bg-slate-200 text-slate-500'
    default:
      return 'bg-slate-200 text-slate-600'
  }
}

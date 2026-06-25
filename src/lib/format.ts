// 表示フォーマット系ユーティリティ

/** 日本円表記（カンマ区切り）。例: 123456 -> "¥123,456" */
export function yen(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '¥0'
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

/** カンマ区切りの数値（記号なし）。例: 1234 -> "1,234" */
export function num(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('ja-JP')
}

/** 西暦の日付表記。例: "2026-06-24" -> "2026/06/24" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

/** input[type=date] 用の "YYYY-MM-DD" 文字列（本日） */
export function today(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** パーセント表記。例: 0.0852 -> "8.52%" */
export function percent(value: number | null | undefined, digits = 2): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0%'
  return (n * 100).toFixed(digits) + '%'
}

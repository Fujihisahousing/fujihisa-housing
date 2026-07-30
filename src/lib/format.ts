// 表示フォーマット系ユーティリティ

/** 日本円表記（カンマ区切り）。例: 123456 -> "¥123,456" */
export function yen(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '¥0'
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

// ---- 号室の桁揃え ----
// 同じ物件に2桁階（1501 など4桁の号室）があると、1桁階（101）が左に寄って
// 一の位が揃わない。桁の少ない号室の頭にスペースを入れて位を合わせる。
//
// 入れるのは U+2007（FIGURE SPACE）。半角スペースは数字より細くて揃わないうえ、
// HTMLでは行頭の空白が詰められて消えてしまうため使えない。U+2007 は数字と同じ幅で、
// 空白の詰め処理の対象外なのでそのまま残る。
const FIGURE_SPACE = ' '

/** 号室の先頭に続く数字の桁数。数字で始まらない号室（地名など）は 0 */
export function roomDigits(room: string | null | undefined): number {
  const m = String(room ?? '').match(/^\d+/)
  return m ? m[0].length : 0
}

/** 同じ表に並ぶ号室のうち、いちばん桁数が多いものの桁数 */
export function maxRoomDigits(rooms: (string | null | undefined)[]): number {
  return rooms.reduce<number>((m, r) => Math.max(m, roomDigits(r)), 0)
}

/** 号室を maxDigits 桁ぶんの位置に右詰めする（数字で始まらない号室はそのまま） */
export function padRoom(room: string | null | undefined, maxDigits: number): string {
  const s = String(room ?? '')
  const d = roomDigits(s)
  if (d === 0 || d >= maxDigits) return s
  return FIGURE_SPACE.repeat(maxDigits - d) + s
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

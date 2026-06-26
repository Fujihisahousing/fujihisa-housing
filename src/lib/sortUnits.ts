// 号室の並び替え（レントロール・部屋管理で共通利用）。
//  rank 0 = 通常フロア（階数の高い順・同じ階は号室の小さい順）
//  rank 1 = 駐車場（用途=駐車場）→ フロアの下にまとめる
//  rank 2 = 屋上・地下室など数字で表せない区画 → 一番下
// 「101」→1階01号、「1203」→12階03号 のように下2桁を部屋番号、上位を階として扱う。
import type { Unit } from '../types'

// 全角数字を半角へ（号室が「７F」等の全角で入っているため）
function toHalf(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

export function unitKey(u: Unit) {
  const raw = toHalf(String(u.room ?? ''))
  const isParking = (u.use_type ?? '').includes('駐車')
  const m = raw.match(/\d+/)
  const num = m ? parseInt(m[0], 10) : NaN
  if (isParking) return { rank: 1, floor: 0, sub: Number.isNaN(num) ? 0 : num, raw }
  if (Number.isNaN(num)) return { rank: 2, floor: 0, sub: 0, raw }
  if (num >= 100) return { rank: 0, floor: Math.floor(num / 100), sub: num % 100, raw }
  return { rank: 0, floor: num, sub: 0, raw }
}

// フロア降順・同階は号室昇順。駐車場はフロアの下、屋上/地下は最下段。
// 表示順(sort_order)が設定されている部屋はそれを最優先（小さいほど上、未設定は階数ロジック）。
export function unitCompare(a: Unit, b: Unit): number {
  const sa = a.sort_order
  const sb = b.sort_order
  if (sa != null && sb != null && sa !== sb) return sa - sb
  if (sa != null && sb == null) return -1
  if (sa == null && sb != null) return 1
  const ka = unitKey(a)
  const kb = unitKey(b)
  if (ka.rank !== kb.rank) return ka.rank - kb.rank
  if (ka.rank === 0 && ka.floor !== kb.floor) return kb.floor - ka.floor
  if (ka.sub !== kb.sub) return ka.sub - kb.sub
  return ka.raw.localeCompare(kb.raw, 'ja')
}

// 隣り合う行で「まとまり」（同一フロア／駐車場ブロック／その他ブロック）が変わったか
function groupId(u: Unit): string {
  const k = unitKey(u)
  return k.rank === 0 ? 'F' + k.floor : k.rank === 1 ? 'P' : 'O'
}
export function isGroupBreak(prev: Unit, cur: Unit): boolean {
  return groupId(prev) !== groupId(cur)
}

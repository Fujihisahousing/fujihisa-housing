// 現況報告書のデータ整形（表示から独立させ、単体で検証できるようにする）。
import { unitCompare } from '../../lib/sortUnits'
import type { Property, Unit } from '../../types'

export interface Block {
  /** 見出しに出す名前。戸建てのようにまとめた場合はグループ名 */
  label: string
  property: Property
  rooms: Unit[]
}

// ---- ここから下は報告書の表示だけに効く調整。DBのデータは変えない ----
/** 報告書に載せない部屋（物件名→号室） */
const HIDDEN_ROOMS: Record<string, string[]> = {
  プランドール守口: ['202', '101'],
}
/**
 * 報告書だけで使う並び順（手本PDFの段組み順）。物件タブ等の通常表示は
 * properties.created_at 順（戸建てが最後尾）のままにするため、ここで
 * 決め打ちする。一致しない物件・グループは末尾にまとめて追加する。
 */
const REPORT_ORDER = [
  'プランドール守口',
  'ルネスプランドール守口',
  '戸建て賃貸', // group_name。ここでまとまる
  'シャーメゾン新大阪',
  'プランドール道頓堀',
  '近畿吉田ビル',
  'プランドール阿波座',
  '富士マンション',
  '川西市久代',
  'プランドール堂島',
]
/**
 * 部屋一覧を報告書のブロックに組み替える。
 * - group_name を持つ物件は1ブロックにまとめる（戸建て6現場 →「戸建て」）
 * - HIDDEN_ROOMS の部屋は載せない
 * - まとめた場合の号室は現場名を前置き（既に現場名で始まっていれば重ねない）
 * 並びは REPORT_ORDER（＝手本PDFの並び）。properties.created_at には依存しない。
 */
export function buildBlocks(units: Unit[], properties: Property[]): Block[] {
  const propById = new Map(properties.map((p) => [p.id, p]))
  const reportOrder = new Map(REPORT_ORDER.map((name, i) => [name, i]))
  const orderOf = (p: Property) => reportOrder.get(p.group_name || p.name) ?? REPORT_ORDER.length
  const byKey = new Map<string, { label: string; property: Property; rooms: Unit[]; ord: number }>()
  for (const u of units) {
    const p = propById.get(u.property_id)
    if (!p) continue
    if (HIDDEN_ROOMS[p.name]?.includes(u.room ?? '')) continue
    const key = p.group_name || p.id
    if (!byKey.has(key)) {
      byKey.set(key, {
        label: p.group_name ? p.group_name.replace(/賃貸$/, '') : p.name,
        property: p,
        rooms: [],
        ord: orderOf(p),
      })
    }
    const g = byKey.get(key)!
    g.ord = Math.min(g.ord, orderOf(p))
    const room = u.room ?? ''
    const label = p.group_name ? (room.startsWith(p.name) ? room : `${p.name}${room ? ' ' + room : ''}`) : room
    g.rooms.push({ ...u, room: label })
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.ord - b.ord)
    .map((g) => ({ label: g.label, property: g.property, rooms: g.rooms.sort(unitCompare) }))
}


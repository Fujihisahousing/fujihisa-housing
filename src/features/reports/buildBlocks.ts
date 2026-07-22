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
 * 部屋一覧を報告書のブロックに組み替える。
 * - group_name を持つ物件は1ブロックにまとめる（戸建て6現場 →「戸建て」）
 * - HIDDEN_ROOMS の部屋は載せない
 * - まとめた場合の号室は現場名を前置き（既に現場名で始まっていれば重ねない）
 * 並びは properties の順（＝手本PDFに合わせて created_at を調整済み）。
 */
export function buildBlocks(units: Unit[], properties: Property[]): Block[] {
  const propById = new Map(properties.map((p) => [p.id, p]))
  const order = new Map(properties.map((p, i) => [p.id, i]))
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
        ord: order.get(p.id) ?? 9999,
      })
    }
    const g = byKey.get(key)!
    g.ord = Math.min(g.ord, order.get(p.id) ?? 9999)
    const room = u.room ?? ''
    const label = p.group_name ? (room.startsWith(p.name) ? room : `${p.name}${room ? ' ' + room : ''}`) : room
    g.rooms.push({ ...u, room: label })
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.ord - b.ord)
    .map((g) => ({ label: g.label, property: g.property, rooms: g.rooms.sort(unitCompare) }))
}


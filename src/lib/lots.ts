// 号地（1棟ずつ独立した戸建てを1物件にまとめている物件）の小道具。
//
// 豊野町は「豊野町1／豊野町2／豊野町3」の3邸で1物件になっている。売買は号地ごとなので、
// 物件概要書だけは号地単位で1冊ずつ出せるようにしてある（Prospectus.tsx の号地タブ）。
//
// どの物件を号地物件と見なすかは、物件名の決め打ちではなくデータから引く：
// 「2部屋以上あって、全部屋の号室が〈物件名＋数字〉」なら号地物件。
// 豊野町のほかに分譲地を足したときも、号室をこの形で登録すればそのまま号地タブが出る。
import type { Property, Unit, UnitSpec } from '../types'

/** 号室から号地番号を取り出す。「豊野町2」→ 2。物件名で始まらない号室は null */
export function lotNumberOf(propertyName: string, room?: string | null): number | null {
  const name = String(propertyName ?? '').trim()
  const r = String(room ?? '').trim()
  if (!name || !r.startsWith(name)) return null
  const m = r.slice(name.length).match(/^(\d+)$/)
  return m ? Number(m[1]) : null
}

/** 号地物件か（2邸以上・全部屋が「物件名＋数字」） */
export function isLotProperty(property: Property | null | undefined, units: Unit[]): boolean {
  if (!property || units.length < 2) return false
  return units.every((u) => lotNumberOf(property.name, u.room) != null)
}

/** その物件の号地番号を昇順で。号地物件でなければ空 */
export function lotNumbers(property: Property | null | undefined, units: Unit[]): number[] {
  if (!isLotProperty(property, units)) return []
  return units
    .map((u) => lotNumberOf(property!.name, u.room))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)
}

/** 号地の呼び名。「豊野町1号地」 */
export function lotName(propertyName: string, lot: number): string {
  return `${propertyName}${lot}号地`
}

/** 物件のスペックに号地別スペック（units.spec）を重ねて「その号地の物件」を作る。
 *  重ねるのは値の入っている項目だけ＝号地で違うところだけ入力すれば、あとは物件の値が出る。 */
export function propertyForLot(property: Property, unit: Unit, lot: number): Property {
  const spec = (unit.spec ?? {}) as UnitSpec
  const merged: Property = { ...property, name: lotName(property.name, lot) }
  const box = merged as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(spec)) {
    if (v == null || v === '') continue
    box[k] = v
  }
  return merged
}

/** 号地別スペックとして入力できる項目。UnitSpec と並びを合わせてある（入力欄の表示順） */
export const LOT_SPEC_FIELDS: { key: keyof UnitSpec; label: string; type?: 'number' }[] = [
  { key: 'address', label: '所在地（住居表示）' },
  { key: 'chiban', label: '地番' },
  { key: 'access', label: '交通' },
  { key: 'land_area', label: '土地面積（㎡・公簿）', type: 'number' },
  { key: 'building_area', label: '建物面積（㎡・公簿）', type: 'number' },
  { key: 'standard_floor_area', label: '基準階面積（㎡）', type: 'number' },
  { key: 'structure', label: '構造・規模' },
  { key: 'main_use', label: '主要用途' },
  { key: 'max_height', label: '最高高さ（m）', type: 'number' },
  { key: 'unit_count_label', label: '総戸数／区画数の表記' },
  { key: 'parking', label: '駐車場' },
  { key: 'parking_count', label: '駐車場台数', type: 'number' },
  { key: 'basement', label: '地下室' },
  { key: 'zoning', label: '用途地域' },
  { key: 'bcr', label: '建ぺい率（%）', type: 'number' },
  { key: 'far', label: '容積率（%）', type: 'number' },
  { key: 'fire_zone', label: '防火指定' },
  { key: 'height_district', label: '高度地区' },
  { key: 'road', label: '前面道路' },
  { key: 'built', label: '竣工年月（例 2024年10月）' },
  { key: 'building_cert_no', label: '建築確認番号' },
  { key: 'building_cert', label: '確認済証（有り/無し）' },
  { key: 'inspection_cert', label: '検査済証（有り/無し）' },
  { key: 'inspection_date', label: '完了検査済日' },
]

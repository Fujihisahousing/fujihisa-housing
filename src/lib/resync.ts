// マスタ（部屋・賃料履歴・入退去・台帳）から入金状況の月次記録を作り直す。
//
// 「どこを直しても全部が連動する」ための入口。部屋の編集・賃料履歴の追加や削除・
// 入退去の登録・台帳の記帳・通帳や水道代の取込・入金状況の手入力——どこから直しても
// 最後にここを通せば、入金状況・滞納一覧・収支表が同じマスタから作り直される。
//
// 組み立てそのものは lib/derive.ts の純関数で、ここは読み書きだけを受け持つ。
// 手で直した値（payment_records.overrides）は作り直しの対象から外れる。
import {
  moveEventsRepo,
  paymentRecordsRepo,
  rentHistoryRepo,
  transactionsRepo,
  unitsRepo,
} from './repositories'
import {
  buildUnitContext,
  mergeMonth,
  monthIdx,
  monthsInScope,
  overridesOf,
  type OverridableField,
} from './derive'
import type { PaymentRecord, Unit } from '../types'

export interface ResyncResult {
  /** 書き換えた記録の数 */
  updated: number
  /** 見た月の数 */
  scanned: number
}

const todayIdx = () => {
  const d = new Date()
  return monthIdx(d.getFullYear(), d.getMonth() + 1)
}

/**
 * 物件まるごと作り直す。部屋を1つだけ直したいときは unitIds で絞る。
 * 物件単位で材料を読むのは、記帳・記録の取得が物件単位のクエリしか無いため。
 */
export async function resyncProperty(
  propertyId: string,
  unitIds?: string[],
): Promise<ResyncResult> {
  const [units, txs, records] = await Promise.all([
    unitsRepo.listByProperty(propertyId),
    transactionsRepo.list({ propertyId }),
    paymentRecordsRepo.list(propertyId),
  ])
  const targets = unitIds ? units.filter((u) => unitIds.includes(u.id)) : units
  if (targets.length === 0) return { updated: 0, scanned: 0 }

  const [histories, moves] = await Promise.all([
    rentHistoryRepo.listByUnitIds(targets.map((u) => u.id)),
    moveEventsRepo.listByUnitIds(targets.map((u) => u.id)),
  ])

  const historyByUnit = new Map<string, typeof histories>()
  for (const h of histories) {
    const list = historyByUnit.get(h.unit_id) ?? []
    list.push(h)
    historyByUnit.set(h.unit_id, list)
  }
  const movesByUnit = new Map<string, typeof moves>()
  for (const m of moves) {
    const list = movesByUnit.get(m.unit_id) ?? []
    list.push(m)
    movesByUnit.set(m.unit_id, list)
  }

  const now = todayIdx()
  let updated = 0
  let scanned = 0
  for (const unit of targets) {
    if (!unit.room) continue // 号室が無い部屋は月次記録と突き合わせられない
    const ctx = buildUnitContext(
      unit,
      historyByUnit.get(unit.id) ?? [],
      movesByUnit.get(unit.id) ?? [],
      txs,
      records,
    )
    for (const idx of monthsInScope(ctx, now)) {
      scanned++
      const { record, changed, known } = mergeMonth(ctx, idx)
      const isNew = !ctx.recByIdx.has(idx)
      // 入退去シートにも入居開始日にも手掛かりが無い月は、当時の状況が分からない。
      // 記録が無いのに勝手に作ると、根拠のない「空室」や「未入金」を並べることになる。
      if (isNew && !known) continue
      // 何も無い月に空の記録を作らない（請求も入金も無い＝そもそも記録が要らない）
      if (isNew && record.billed === 0 && record.paid === 0) continue
      if (!changed) continue
      await paymentRecordsRepo.upsert(record)
      updated++
    }
  }
  return { updated, scanned }
}

/** 部屋を1つだけ作り直す */
export async function resyncUnit(unit: Pick<Unit, 'id' | 'property_id'>): Promise<ResyncResult> {
  return resyncProperty(unit.property_id, [unit.id])
}

/** 部屋のIDだけ分かっているとき（台帳・取込から呼ぶ） */
export async function resyncUnitIds(unitIds: string[]): Promise<ResyncResult> {
  const byProperty = new Map<string, string[]>()
  for (const id of Array.from(new Set(unitIds))) {
    const u = await unitsRepo.getById(id)
    if (!u) continue
    byProperty.set(u.property_id, [...(byProperty.get(u.property_id) ?? []), id])
  }
  let updated = 0
  let scanned = 0
  for (const [propertyId, ids] of byProperty) {
    const r = await resyncProperty(propertyId, ids)
    updated += r.updated
    scanned += r.scanned
  }
  return { updated, scanned }
}

/**
 * 入金状況で手入力した値を「手動上書き」として保存し、その部屋を作り直す。
 *
 * 手で直した値は overrides に残るので、あとからマスタを直しても消えない。
 * 一方その値を土台にした判定や滞納一覧は作り直しで連動する
 * （＝「手で直しても全部が同期する」）。
 *
 * 値に null を渡すと、その項目の手動上書きを外して自動導出に戻す。
 */
export async function setOverride(
  base: Pick<PaymentRecord, 'property_id' | 'room' | 'year' | 'month'>,
  patch: Partial<Record<OverridableField, unknown>>,
  unit?: Pick<Unit, 'id' | 'property_id'> | null,
): Promise<void> {
  const current = await paymentRecordsRepo.get(base.property_id, base.room, base.year, base.month)
  const ov = { ...overridesOf(current) }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete ov[key]
    else ov[key] = value
  }
  await paymentRecordsRepo.upsert({
    ...(current ?? base),
    ...base,
    overrides: ov,
  })
  if (unit) await resyncUnit(unit)
}

/** 手動上書きを全部外して、その月を完全に自動導出へ戻す */
export async function clearOverrides(
  base: Pick<PaymentRecord, 'property_id' | 'room' | 'year' | 'month'>,
  unit?: Pick<Unit, 'id' | 'property_id'> | null,
): Promise<void> {
  const current = await paymentRecordsRepo.get(base.property_id, base.room, base.year, base.month)
  if (!current) return
  await paymentRecordsRepo.upsert({ ...current, overrides: {} })
  if (unit) await resyncUnit(unit)
}

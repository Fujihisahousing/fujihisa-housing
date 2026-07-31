// 台帳（transactions）の賃料記帳を、入金状況（payment_records）に反映する。
//
// 入金状況の月次記録は台帳とは独立に持っている（記録がある月は物件情報を参照しない設計）。
// そのため台帳で家賃の記帳を直しても入金状況の入金額が変わらなかった。ここで橋渡しする。
//
// 収支表・支出表は毎回 transactions を読み直すので、この処理が無くても台帳の編集は反映される。
// 反映が要るのは入金状況だけ。
import { transactionsRepo, unitsRepo, paymentRecordsRepo, rentHistoryRepo } from './repositories'
import {
  attributionMonth,
  deriveJudgement,
  effectiveRentKyoeki,
  isRentCategory,
} from './calc'
import type { PaymentRecord, Transaction } from '../types'

const n = (v: unknown) => Number(v ?? 0) || 0
const keyOf = (y: number, m: number) => `${y}-${m}`

/**
 * 記帳の変更に合わせて、その号室の該当月の入金額を貼り直す。
 *
 * @param affected 変更に関わった記帳（更新なら変更前と変更後の両方、削除なら削除した行）。
 *                 ここから「どの号室のどの月を貼り直すか」を決める。
 *
 * 触るのは賃料・共益費で、かつ号室が紐づいている記帳だけ。号室が分からない記帳は
 * どの部屋の入金か決められないので対象外にする（建物まとめの収入など）。
 * 貼り直すのは入金額と判定だけで、契約者名・請求額・備考・滞納月数には触らない。
 */
export async function syncPaymentRecordsFromLedger(affected: Partial<Transaction>[]): Promise<void> {
  // 号室 → 貼り直す帰属月 を集める
  const targets = new Map<string, Set<string>>()
  for (const t of affected) {
    if (!t.unit_id || !t.date) continue
    if (t.category && !isRentCategory(t.category)) continue
    const { year, month } = attributionMonth(t.date)
    const set = targets.get(t.unit_id) ?? new Set<string>()
    set.add(keyOf(year, month))
    targets.set(t.unit_id, set)
  }
  if (targets.size === 0) return

  for (const [unitId, months] of targets) {
    const unit = await unitsRepo.getById(unitId)
    // 月次記録のキーは 物件＋号室 なので、号室が無い部屋は突き合わせられない
    if (!unit?.room) continue
    const room = unit.room

    // この号室の生きている賃料記帳を全部集めて、帰属月ごとに合計する
    const txs = await transactionsRepo.list({ propertyId: unit.property_id })
    const paidByMonth = new Map<string, number>()
    const paidOnByMonth = new Map<string, string>() // その月の最後の入金日
    for (const t of txs) {
      if (t.unit_id !== unitId || t.type !== 'income' || !isRentCategory(t.category)) continue
      const { year, month } = attributionMonth(t.date)
      const k = keyOf(year, month)
      paidByMonth.set(k, (paidByMonth.get(k) ?? 0) + n(t.amount))
      const d = String(t.date).slice(0, 10)
      if (!paidOnByMonth.has(k) || d > paidOnByMonth.get(k)!) paidOnByMonth.set(k, d)
    }

    const history = await rentHistoryRepo.listByUnit(unitId)
    const existing = await paymentRecordsRepo.list(unit.property_id)
    const occupied = unit.status === '入居' || unit.status === '退予'

    for (const k of months) {
      const [year, month] = k.split('-').map(Number)
      const paid = paidByMonth.get(k) ?? 0
      const rec = existing.find(
        (r) => r.room === room && r.year === year && r.month === month,
      )
      // 記帳が無くなり、記録も無い月は何もしない（空の記録を作らない）
      if (paid === 0 && !rec) continue
      if (rec && n(rec.paid) === paid) continue // 変化なし

      // 請求額は記録にあればそれを、無ければ賃料履歴から出す
      const eff = effectiveRentKyoeki(unit, history, year, month)
      const billed = rec?.billed != null ? n(rec.billed) : eff.rent + eff.kyoeki
      const guarantor = rec?.guarantor ?? unit.guarantor ?? null
      // 記録を新しく作るときは、契約者名・読み方・属性・保証会社を部屋の情報から埋める。
      // ここを空のまま作ると、入金状況に金額だけ並んで誰の入金か分からなくなる。
      // 既にある記録はそのまま活かす（当時の契約者名を書き換えない）。
      const base: PaymentRecord = rec ?? {
        property_id: unit.property_id,
        room,
        year,
        month,
        tenant: unit.tenant ?? null,
        tenant_type: unit.tenant_type ?? null,
        kana: unit.tenant_kana ?? null,
        guarantor: unit.guarantor ?? null,
      }
      await paymentRecordsRepo.upsert({
        ...base,
        billed,
        paid,
        // 入金日は記帳の日付から入れる。記帳が消えて0になった月は日付も外す
        paid_on: paid > 0 ? (paidOnByMonth.get(k) ?? base.paid_on ?? null) : null,
        judgement: deriveJudgement(occupied, billed, paid, Boolean(guarantor)),
      })
    }
  }
}

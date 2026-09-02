// 台帳（transactions）の賃料記帳を、入金状況（payment_records）に反映する。
//
// 中身は lib/resync.ts の再計算そのもの。台帳を直したときも、部屋の情報を直したときも、
// 入退去を登録したときも、同じマスタから同じやり方で作り直されるようにするため、
// 入口だけをここに残して実処理は resync に寄せてある。
//
// 収支表・支出表は毎回 transactions を読み直すので、この処理が無くても台帳の編集は反映される。
// 反映が要るのは入金状況（と、そこから作る滞納一覧）だけ。
import { resyncUnitIds } from './resync'
import { isRentCategory } from './calc'
import type { Transaction } from '../types'

/**
 * 記帳の変更に合わせて、その号室の入金状況を作り直す。
 *
 * @param affected 変更に関わった記帳（更新なら変更前と変更後の両方、削除なら削除した行）。
 *                 ここから「どの号室を作り直すか」を決める。
 *
 * 対象は賃料・共益費・駐車・駐輪で、かつ号室が紐づいている記帳だけ。号室が分からない記帳は
 * どの部屋の入金か決められないので対象外にする（建物まとめの収入など）。
 *
 * 入金額は台帳の記帳から作り直す。入金状況で手入力した入金額は payment_records.overrides に
 * 手動上書きとして残っているので、記帳が無くても消えない。
 */
export async function syncPaymentRecordsFromLedger(affected: Partial<Transaction>[]): Promise<void> {
  const unitIds = new Set<string>()
  for (const t of affected) {
    if (!t.unit_id) continue
    if (t.category && !isRentCategory(t.category)) continue
    unitIds.add(t.unit_id)
  }
  if (unitIds.size === 0) return
  await resyncUnitIds(Array.from(unitIds))
}

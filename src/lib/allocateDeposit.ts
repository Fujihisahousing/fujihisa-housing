// まとめ入金を号室ごとに割り振る。
//
// 保証会社は複数戸ぶんを1件にまとめて振り込んでくるので、通帳の1行に対して
// 号室が複数ぶら下がる。合計は各戸の契約額の和と一致するはずなので、
// 各戸に契約額をそのまま配り、戸の中で 賃料→共益費→駐車・駐輪→光熱費 の順に充てる。
//
// 駐車・駐輪を光熱費より前に置くのは、入居者の毎月の支払いに駐車場代・駐輪場代が
// 含まれることがあり、以前はその分が丸ごと光熱費に乗って収支表を歪めていたため。
// 契約上いくらなのかは units.parking（'￥18,700' 等の文字列）に入っているので、
// そこまでを駐車・駐輪、それを超えた分だけを光熱費として扱う。
//
// 合計が合わない場合も止めずに配る（人が号室の選び直しで直せるように）。
// 足りなければ後ろの戸が欠け、余れば最後の戸の光熱費に乗る。差額は呼び出し側で出す。
import { parkingYen } from './calc'
import type { Unit } from '../types'

const n = (v: unknown) => Number(v ?? 0) || 0

/** その号室の契約額（賃料＋共益費＋駐輪駐車） */
export const contractAmount = (u: Unit) => n(u.rent) + n(u.kyoeki) + parkingYen(u.parking)

export interface Allocation {
  unitId: string
  rent: number
  kyoeki: number
  /** 駐車場代・駐輪場代（契約の駐輪駐車欄まで） */
  parking: number
  utility: number
  /** この号室に割り当てた合計 */
  total: number
}

export interface AllocationResult {
  rows: Allocation[]
  /** 各戸の契約額の合計 */
  expected: number
  /** 入金額 − 契約額の合計。0 なら想定どおり */
  diff: number
}

/** 1戸ぶんを賃料→共益費→駐車・駐輪→光熱費の順に充てる */
function splitOne(u: Unit, amount: number): Omit<Allocation, 'unitId'> {
  // 契約額が台帳に無い部屋（停止中など賃料0）は差し引く土台が無いので分けない。
  // 分けると入金の全額が光熱費に落ちてしまうので、従来どおり全額を賃料に充てる。
  if (contractAmount(u) <= 0) {
    return { rent: amount, kyoeki: 0, parking: 0, utility: 0, total: amount }
  }
  const rent = Math.min(amount, n(u.rent))
  const afterRent = Math.max(0, amount - rent)
  const kyoeki = Math.min(afterRent, n(u.kyoeki))
  const afterKyoeki = Math.max(0, afterRent - kyoeki)
  const parking = Math.min(afterKyoeki, parkingYen(u.parking))
  const utility = Math.max(0, afterKyoeki - parking)
  return { rent, kyoeki, parking, utility, total: amount }
}

/**
 * total を units に割り振る。units の並び順に契約額ぶんずつ配る。
 * 1戸だけのときは従来どおり「全額をその戸に充てる」になる。
 */
export function allocateDeposit(units: Unit[], total: number): AllocationResult {
  const expected = units.reduce((s, u) => s + contractAmount(u), 0)
  const diff = total - expected

  let rest = total
  const rows: Allocation[] = units.map((u, i) => {
    const isLast = i === units.length - 1
    // 最後の戸には残り全部を渡す。余った分はその戸の光熱費に乗る
    const give = isLast ? Math.max(0, rest) : Math.min(rest, contractAmount(u))
    rest -= give
    return { unitId: u.id, ...splitOne(u, give) }
  })
  return { rows, expected, diff }
}

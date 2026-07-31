// まとめ入金を号室ごとに割り振る。
//
// 保証会社は複数戸ぶんを1件にまとめて振り込んでくるので、通帳の1行に対して
// 号室が複数ぶら下がる。合計は各戸の契約額（賃料＋共益費）の和と一致するはずなので、
// 各戸に契約額をそのまま配り、戸の中で 賃料→共益費→光熱費 の順に充てる。
//
// 合計が合わない場合も止めずに配る（人が号室の選び直しで直せるように）。
// 足りなければ後ろの戸が欠け、余れば最後の戸の光熱費に乗る。差額は呼び出し側で出す。
import type { Unit } from '../types'

const n = (v: unknown) => Number(v ?? 0) || 0

/** その号室の契約額（賃料＋共益費） */
export const contractAmount = (u: Unit) => n(u.rent) + n(u.kyoeki)

export interface Allocation {
  unitId: string
  rent: number
  kyoeki: number
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

/** 1戸ぶんを賃料→共益費→光熱費の順に充てる */
function splitOne(u: Unit, amount: number): Omit<Allocation, 'unitId'> {
  const rent = Math.min(amount, n(u.rent))
  const afterRent = Math.max(0, amount - rent)
  const kyoeki = Math.min(afterRent, n(u.kyoeki))
  const utility = Math.max(0, afterRent - kyoeki)
  return { rent, kyoeki, utility, total: amount }
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

// 通帳の1行（1回の振込）を、賃料・共益費・駐車駐輪・水道代・不明金に分ける。
//
// allocateDeposit との違いは「水道代を検針表の額で頭打ちにする」ところ。
// allocateDeposit は賃料・共益費・駐車駐輪を引いた残りを全部まとめて光熱費にしていたので、
// 礼金や更新料が混ざった入金でも全額が水道代として計上されてしまっていた
// （ルネスプランドール守口で 88,012円が水道代として立っていた、など）。
// ここでは検針表の額までを水道代とし、それを超えた分は「不明金」として分けて見せる。
// 不明金は画面で人が直すためのもので、直さずに保存すると「その他」収入として記帳される。
//
// 検針表の額は入金状況の備考タグ（[水道 3012]）から取る。水道代の請求書を取り込む前に
// 通帳を取り込むこともあるので、そのときは水道代0・残りは全部不明金になる。あとから
// 請求書を取り込んで「その月を再計算」すれば、不明金から水道代へ振り替わる。
import { parkingYen } from './calc'
import { readWaterTag } from './invoiceWater'
import type { PaymentRecord, Unit } from '../types'

const n = (v: unknown) => Number(v ?? 0) || 0

/** 1戸ぶんの内訳。合計は必ず入金額（に割り当てた額）と一致する */
export interface DepositSplit {
  unitId: string
  rent: number
  kyoeki: number
  parking: number
  /** 検針表の額まで。請求書が未取込なら0 */
  water: number
  /** 上の4つに収まらなかった残り。礼金・更新料・過入金など */
  unknown: number
  total: number
}

/** その戸がその月に受け取るはずの額（賃料＋共益費＋駐車駐輪＋水道代） */
export const dueAmount = (u: Unit, water: number) =>
  n(u.rent) + n(u.kyoeki) + parkingYen(u.parking) + water

/** 1戸ぶんを 賃料→共益費→駐車駐輪→水道代→不明金 の順に充てる */
export function splitOne(u: Unit, amount: number, water: number): DepositSplit {
  let rest = Math.max(0, amount)
  const take = (cap: number) => {
    const v = Math.min(rest, Math.max(0, cap))
    rest -= v
    return v
  }
  const rent = take(n(u.rent))
  const kyoeki = take(n(u.kyoeki))
  const parking = take(parkingYen(u.parking))
  const w = take(water)
  return { unitId: u.id, rent, kyoeki, parking, water: w, unknown: rest, total: Math.max(0, amount) }
}

/**
 * 1回の振込を号室に割り振る。保証会社のまとめ入金は複数戸ぶんが1行で届くので、
 * 受け取るはずの額（dueAmount）ずつ配り、最後の戸に残り全部を渡す。
 * 合計が合わない振込も止めずに配る（人が画面で直せるように）。
 */
export function splitDeposit(
  units: Unit[],
  amount: number,
  waterOf: (unitId: string) => number,
): DepositSplit[] {
  let rest = Math.max(0, amount)
  return units.map((u, i) => {
    const water = waterOf(u.id)
    const isLast = i === units.length - 1
    const give = isLast ? rest : Math.min(rest, dueAmount(u, water))
    rest -= give
    return splitOne(u, give, water)
  })
}

/**
 * 入金状況の備考タグから「号室×年月 → 水道代」の早見表を作る。
 * キーは `${room}|${year}-${month}`。room は payment_records の号室名をそのまま使う。
 */
export function waterMapOf(records: PaymentRecord[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of records) {
    const yen = readWaterTag(r.memo)
    if (yen > 0) m.set(`${r.room}|${r.year}-${String(r.month).padStart(2, '0')}`, yen)
  }
  return m
}

/** 内訳の合計。画面で入金額と突き合わせるのに使う */
export const splitTotal = (s: Pick<DepositSplit, 'rent' | 'kyoeki' | 'parking' | 'water' | 'unknown'>) =>
  n(s.rent) + n(s.kyoeki) + n(s.parking) + n(s.water) + n(s.unknown)

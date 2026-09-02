// 入金状況の月次記録を、マスタ（部屋・賃料履歴・入退去・台帳）から組み立てる。
//
// これまでは payment_records が「その月の控え」で、記録がある月は物件情報を一切参照
// しなかった。そのため部屋の編集・賃料履歴・入退去を直しても記録のある月は変わらず、
// 「どこを直しても連動しない」状態になっていた。
//
// ここでは逆に、記録は毎回マスタから作り直す前提にする。手で直した値だけを
// payment_records.overrides に残し、そのキーだけ作り直しの対象から外す。
//
// この段は入出力を持たない純関数だけにしてある（画面からも再計算からも同じ結果を使う）。
import {
  attributionMonth,
  billedAmount,
  deriveJudgement,
  effectiveRentKyoeki,
  isRentCategory,
} from './calc'
import { readWaterTag, writeWaterTag } from './invoiceWater'
import type { MoveEvent, PaymentRecord, RentHistory, Transaction, Unit } from '../types'

const n = (v: unknown) => Number(v ?? 0) || 0

/** 年月を1本の整数にする。月の前後比較・集合演算をこれで行う */
export const monthIdx = (year: number, month: number) => year * 12 + (month - 1)
export const yearOfIdx = (idx: number) => Math.floor(idx / 12)
export const monthOfIdx = (idx: number) => (idx % 12) + 1

/** 'YYYY-MM' / 'YYYY-MM-DD' → 月インデックス。読めなければ null */
export function idxOfYm(ym: string | null | undefined): number | null {
  const s = String(ym ?? '')
  if (s.length < 7) return null
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  if (!y || !m || m < 1 || m > 12) return null
  return monthIdx(y, m)
}

/** 入居していた期間。toIdx が null なら今も入居中 */
interface Period {
  fromIdx: number
  toIdx: number | null
  tenant: string | null
  kana: string | null
  /** 日割りを計上する月と、その額（入居月だけの例外） */
  proratedIdx: number | null
  proratedAmount: number | null
}

/** 入居イベントの開始月＝日割り月（あれば）、無ければ満額開始月 */
const moveInStart = (e: MoveEvent) =>
  idxOfYm(e.prorated_ym) ?? idxOfYm(e.first_full_ym) ?? idxOfYm(e.actual_date)
/** 退去イベントの最終請求月。退去月は満額もらう運用なので既定は退去月 */
const moveOutEnd = (e: MoveEvent) =>
  idxOfYm(e.final_ym) ?? idxOfYm(e.actual_date) ?? idxOfYm(e.scheduled_date)

/**
 * 入退去シートから入居期間を組み立てる。入退去シートが無い部屋は、
 * 「いま入居中で入居開始日がある」ときだけ1本の期間として扱う。
 * どちらでもない部屋（入退去シートも入居開始日も無い空室など）は期間が決められず、
 * その月は既存の記録をそのまま残す（過去の控えを壊さないため）。
 */
export function periodsOf(unit: Unit, moves: MoveEvent[]): Period[] {
  const ins = moves
    .filter((e) => e.kind === '入居' && moveInStart(e) != null)
    .sort((a, b) => moveInStart(a)! - moveInStart(b)!)
  const outs = moves
    .filter((e) => e.kind === '退去' && moveOutEnd(e) != null)
    .sort((a, b) => moveOutEnd(a)! - moveOutEnd(b)!)

  if (ins.length === 0) {
    const start = idxOfYm(unit.contract_start)
    const occupied = unit.status === '入居' || unit.status === '退予'
    if (!occupied || start == null) return []
    return [
      {
        fromIdx: start,
        toIdx: null,
        tenant: unit.tenant ?? null,
        kana: unit.tenant_kana ?? null,
        proratedIdx: null,
        proratedAmount: null,
      },
    ]
  }

  const used = new Set<number>()
  return ins
    .map((e) => {
      const fromIdx = moveInStart(e)!
      // その入居より後ろで、まだ使っていない最初の退去がこの期間の終わり
      let toIdx: number | null = null
      for (let i = 0; i < outs.length; i++) {
        if (used.has(i)) continue
        const end = moveOutEnd(outs[i])!
        if (end >= fromIdx) {
          used.add(i)
          toIdx = end
          break
        }
      }
      return {
        fromIdx,
        toIdx,
        tenant: e.tenant ?? null,
        kana: e.tenant_kana ?? null,
        proratedIdx: idxOfYm(e.prorated_ym),
        proratedAmount: e.prorated_amount != null ? n(e.prorated_amount) : null,
      }
    })
    .sort((a, b) => a.fromIdx - b.fromIdx)
}

/** その部屋について、占有状況が分かる最も古い月。これより前は既存の記録を触らない */
export function knownFromIdx(unit: Unit, moves: MoveEvent[]): number | null {
  const anchors: number[] = periodsOf(unit, moves).map((p) => p.fromIdx)
  for (const e of moves) {
    const a = e.kind === '入居' ? moveInStart(e) : moveOutEnd(e)
    if (a != null) anchors.push(a)
  }
  if (anchors.length === 0) return null
  return Math.min(...anchors)
}

export interface UnitContext {
  unit: Unit
  history: RentHistory[]
  periods: Period[]
  knownFrom: number | null
  paidByIdx: Map<number, number>
  paidOnByIdx: Map<number, string>
  recByIdx: Map<number, PaymentRecord>
}

/**
 * 1部屋ぶんの材料をまとめる。
 * 入金額は「帰属月」で集計する（前家賃：11日以降の入金は翌月分）。
 */
export function buildUnitContext(
  unit: Unit,
  history: RentHistory[],
  moves: MoveEvent[],
  transactions: Transaction[],
  records: PaymentRecord[],
): UnitContext {
  const paidByIdx = new Map<number, number>()
  const paidOnByIdx = new Map<number, string>()
  for (const t of transactions) {
    if (t.unit_id !== unit.id || t.type !== 'income' || !isRentCategory(t.category)) continue
    const { year, month } = attributionMonth(t.date)
    const idx = monthIdx(year, month)
    paidByIdx.set(idx, (paidByIdx.get(idx) ?? 0) + n(t.amount))
    const d = String(t.date).slice(0, 10)
    if (!paidOnByIdx.has(idx) || d > paidOnByIdx.get(idx)!) paidOnByIdx.set(idx, d)
  }
  const recByIdx = new Map<number, PaymentRecord>()
  for (const r of records) {
    if (r.room !== unit.room || r.property_id !== unit.property_id) continue
    recByIdx.set(monthIdx(r.year, r.month), r)
  }
  return {
    unit,
    history,
    periods: periodsOf(unit, moves),
    knownFrom: knownFromIdx(unit, moves),
    paidByIdx,
    paidOnByIdx,
    recByIdx,
  }
}

export interface Derived {
  /** 占有状況がマスタから決められる月か。false なら既存の記録を尊重する */
  known: boolean
  occupied: boolean
  tenant: string | null
  kana: string | null
  tenantType: string | null
  guarantor: string | null
  /** 契約額（賃料＋共益費＋駐輪駐車）。入居月は日割り、空室月は0 */
  contract: number
  /** メモの目印から拾った水道代。請求額にはこれを足す */
  water: number
  billed: number
  paid: number
  paidOn: string | null
  judgement: string
}

/** その月に効いていた契約額。入居月の日割りと空室月の0をここで吸収する */
function contractOf(ctx: UnitContext, idx: number, period: Period | null): number {
  if (!period) return 0
  if (period.proratedIdx === idx && period.proratedAmount != null) return period.proratedAmount
  const eff = effectiveRentKyoeki(ctx.unit, ctx.history, yearOfIdx(idx), monthOfIdx(idx))
  return billedAmount(eff, ctx.unit)
}

/** 指定月をマスタから組み立てる */
export function deriveMonth(ctx: UnitContext, idx: number): Derived {
  const rec = ctx.recByIdx.get(idx)
  const water = readWaterTag(rec?.memo)
  const paid = ctx.paidByIdx.get(idx) ?? 0
  const paidOn = ctx.paidOnByIdx.get(idx) ?? null

  const period =
    ctx.periods.find((p) => idx >= p.fromIdx && (p.toIdx == null || idx <= p.toIdx)) ?? null
  // 入退去シートにも入居開始日にも手掛かりが無い月＝当時の状況が分からない
  const known = ctx.knownFrom != null && idx >= ctx.knownFrom
  const occupied = Boolean(period)

  const contract = known ? contractOf(ctx, idx, period) : 0
  const billed = contract + water
  const guarantor = occupied ? ctx.unit.guarantor ?? null : null

  return {
    known,
    occupied,
    // 期間に控えが無い（入退去シートを使う前の入居）ときは部屋の現在値で補う
    tenant: occupied ? period!.tenant ?? ctx.unit.tenant ?? null : null,
    kana: occupied ? period!.kana ?? ctx.unit.tenant_kana ?? null : null,
    tenantType: occupied ? ctx.unit.tenant_type ?? null : null,
    guarantor,
    contract,
    water,
    billed,
    paid,
    paidOn,
    judgement: occupied ? deriveJudgement(true, billed, paid, Boolean(guarantor)) : '空室',
  }
}

/** 手で直した値の入れ物。payment_records.overrides に入る */
export type Overrides = Record<string, unknown>

/** 手動上書きを置けるフィールド。memo と arrears_months は元々手入力しか入らない */
export const OVERRIDABLE = [
  'billed',
  'paid',
  'paid_on',
  'tenant',
  'tenant_type',
  'kana',
  'guarantor',
  'judgement',
  'arrears_months',
] as const
export type OverridableField = (typeof OVERRIDABLE)[number]

export const overridesOf = (rec?: PaymentRecord | null): Overrides =>
  (rec?.overrides as Overrides | undefined) ?? {}

/**
 * 導出結果と既存の記録・手動上書きを重ねて、保存するべき1行を作る。
 *
 * 重ねる順は 導出 → 既存（判断できない項目のみ）→ 手動上書き。
 * 「判断できない項目」は次の2つで、ここを導出で潰すと過去の控えが消える：
 *   ・占有状況が分からない月（入退去シートを使う前の期間）は丸ごと既存を残す
 *   ・台帳に記帳が1件も無いのに入金額が入っている月は、手入力された実績なので残す
 *     （初回の再計算でその値を overrides に移し、以後は手動上書きとして扱う）
 */
export function mergeMonth(
  ctx: UnitContext,
  idx: number,
): { record: PaymentRecord; changed: boolean; known: boolean } {
  const rec = ctx.recByIdx.get(idx)
  const d = deriveMonth(ctx, idx)
  const ov: Overrides = { ...overridesOf(rec) }

  // 記帳から作り直せない入金額は手入力とみなして上書きに移す（初回の引き継ぎ）
  if (!('paid' in ov) && d.paid === 0 && rec && n(rec.paid) > 0) {
    ov.paid = n(rec.paid)
    if (rec.paid_on) ov.paid_on = rec.paid_on
  }

  // 請求額の初回引き継ぎ。この仕組みを入れる前の記録は、請求額の内訳がどこにも
  // 残っていないので、いまの材料だけで作り直すと差額が消えてしまう。
  //   ・契約額を上回っている … 上乗せして請求している実費（水道代など）。備考の目印に
  //     移しておけば「契約額＋実費」で組み直せるので、あとで賃料を直しても連動し続ける。
  //     阿波座1Fが該当：家賃600,000に対し請求額603,835で、目印は付いていなかった。
  //   ・契約額を下回っている … 入居月の日割りなど、いまの材料からは作り直せない額。
  //     手動上書きとして凍結する（自動に戻したいときは画面から外せる）。
  let water = d.water
  let memo = rec?.memo ?? null
  if (!('billed' in ov) && rec && d.known && n(rec.billed) !== d.billed) {
    const stored = n(rec.billed)
    if (d.water === 0 && d.contract > 0 && stored > d.contract) {
      water = stored - d.contract
      memo = writeWaterTag(memo, water, '光熱費')
    } else {
      ov.billed = stored
    }
  }

  const pick = <T,>(key: OverridableField, derived: T, kept: T): T =>
    key in ov ? (ov[key] as T) : d.known ? derived : kept

  const paid = 'paid' in ov ? n(ov.paid) : d.paid
  const paidOn = 'paid_on' in ov ? ((ov.paid_on as string | null) ?? null) : d.paidOn
  const billed = 'billed' in ov ? n(ov.billed) : d.known ? d.contract + water : n(rec?.billed)
  const guarantor = pick<string | null>('guarantor', d.guarantor, rec?.guarantor ?? null)
  // 判定は請求額・入金額が手で直されていれば、その値で導き直す（手動修正も連動させる）
  const judgement =
    'judgement' in ov
      ? (ov.judgement as string)
      : d.known
        ? d.occupied
          ? deriveJudgement(true, billed, paid, Boolean(guarantor))
          : '空室'
        : (rec?.judgement ?? d.judgement)

  const record: PaymentRecord = {
    property_id: ctx.unit.property_id,
    // 号室の無い部屋は呼ぶ側（resync）で除いている
    room: ctx.unit.room!,
    year: yearOfIdx(idx),
    month: monthOfIdx(idx),
    tenant: pick<string | null>('tenant', d.tenant, rec?.tenant ?? null),
    tenant_type: pick<string | null>('tenant_type', d.tenantType, rec?.tenant_type ?? null),
    kana: pick<string | null>('kana', d.kana, rec?.kana ?? null),
    billed,
    paid,
    paid_on: paid > 0 ? paidOn : null,
    judgement,
    guarantor,
    // メモは人が入れた値。ただし請求額の上乗せ分は目印として書き足す
    memo,
    arrears_months:
      'arrears_months' in ov
        ? ((ov.arrears_months as number | null) ?? null)
        : (rec?.arrears_months ?? null),
    overrides: ov,
  }

  const same =
    rec != null &&
    n(rec.billed) === n(record.billed) &&
    n(rec.paid) === n(record.paid) &&
    (rec.paid_on ?? null) === (record.paid_on ?? null) &&
    (rec.tenant ?? null) === (record.tenant ?? null) &&
    (rec.tenant_type ?? null) === (record.tenant_type ?? null) &&
    (rec.kana ?? null) === (record.kana ?? null) &&
    (rec.guarantor ?? null) === (record.guarantor ?? null) &&
    (rec.judgement ?? null) === (record.judgement ?? null) &&
    (rec.memo ?? null) === (record.memo ?? null) &&
    JSON.stringify(overridesOf(rec)) === JSON.stringify(ov)

  return { record, changed: !same, known: d.known }
}

/**
 * 作り直す月の範囲。記録のある月・記帳のある月に加えて、その範囲の中で
 * 入居していたのに記録が抜けている月も埋める（滞納一覧の取りこぼしを防ぐ）。
 * データの始まりより前まで遡って新しい記録を作ることはしない。
 */
export function monthsInScope(ctx: UnitContext, todayIdx: number): number[] {
  const set = new Set<number>([...ctx.recByIdx.keys(), ...ctx.paidByIdx.keys()])
  if (set.size > 0) {
    const lo = Math.min(...set)
    for (const p of ctx.periods) {
      const from = Math.max(p.fromIdx, lo)
      const to = Math.min(p.toIdx ?? todayIdx, todayIdx)
      for (let i = from; i <= to; i++) set.add(i)
    }
  }
  return Array.from(set).sort((a, b) => a - b)
}

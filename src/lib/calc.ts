// 集計ロジック（レントロール・利回り・収支表・入金状況）。UI から分離（SOW 設計方針）。
import type { PaymentRecord, Property, RentHistory, Transaction, Unit } from '../types'

const n = (v: number | null | undefined) => Number(v ?? 0) || 0
const isOccupied = (u: Unit) => u.status === '入居' || u.status === '退予' // 退去予定も入居中・課金対象
const isStopped = (u: Unit) => u.status === '停止' // 募集停止：空室率の総数に含めない

// 指定年月時点で有効な賃料・共益費を履歴から求める（履歴が無い/その年月以前の履歴が無い場合は units の現在値にフォールバック）。
// 「新しい日付の開始日ほど優先」＝ effective_date が対象年月以前で最大の行を採用する。
export function effectiveRentKyoeki(
  unit: Unit,
  history: RentHistory[] | undefined,
  year: number,
  month: number,
): { rent: number; kyoeki: number } {
  const fallback = { rent: n(unit.rent), kyoeki: n(unit.kyoeki) }
  if (!history || history.length === 0) return fallback
  const asOf = new Date(year, month - 1, 1).getTime()
  let best: RentHistory | null = null
  for (const h of history) {
    const t = new Date(h.effective_date).getTime()
    if (t <= asOf && (!best || t > new Date(best.effective_date).getTime())) best = h
  }
  return best ? { rent: n(best.rent), kyoeki: n(best.kyoeki) } : fallback
}

// =====================================================================
// レントロール（SOW 6.4）
// =====================================================================
export interface RentRollRow {
  unit: Unit
  total: number // 賃料＋共益費
}

export interface RentRollResult {
  rows: RentRollRow[]
  totalUnits: number
  occupiedUnits: number
  occupancyRate: number // 稼働率 = 入居戸数 / 総戸数
  fullMonthly: number // 満室想定(月) = Σ(rent+kyoeki) 全戸
  currentMonthly: number // 現況(月) = 入居戸の Σ
  fullAnnual: number // 満室想定(年)
  grossYield: number | null // 表面利回り = 満室想定×12 / acquired_price
}

export function calcRentRoll(units: Unit[], property?: Property | null): RentRollResult {
  const rows = units.map((u) => ({ unit: u, total: n(u.rent) + n(u.kyoeki) }))
  const totalUnits = units.filter((u) => !isStopped(u)).length // 停止は総数に含めない
  const occupiedUnits = units.filter(isOccupied).length
  const fullMonthly = rows.reduce((s, r) => s + r.total, 0)
  const currentMonthly = rows.filter((r) => isOccupied(r.unit)).reduce((s, r) => s + r.total, 0)
  const fullAnnual = fullMonthly * 12
  const acquired = property?.acquired_price ? n(property.acquired_price) : 0
  return {
    rows,
    totalUnits,
    occupiedUnits,
    occupancyRate: totalUnits ? occupiedUnits / totalUnits : 0,
    fullMonthly,
    currentMonthly,
    fullAnnual,
    grossYield: acquired > 0 ? fullAnnual / acquired : null,
  }
}

// =====================================================================
// 収支表（SOW 6.5）— 行=項目 / 列=1〜12月＋合計
// =====================================================================
// transactions のカテゴリ → 収支表の行 へのマッピング
const INCOME_ROW_OF: Record<string, string> = {
  賃料: '家賃+共益費',
  共益費: '家賃+共益費',
  光熱費: '光熱費（入居者負担）',
  水道代: '光熱費（入居者負担）',
  電気代: '光熱費（入居者負担）',
  礼金: '礼金',
  敷金: '敷金',
  看板: '看板',
  KDDI: 'KDDI',
  タイムズ: 'タイムズ',
}
const EXPENSE_ROW_OF: Record<string, string> = {
  管理会社委託費: '管理会社委託費',
  BM: 'BM',
  EV保守費: 'EV保守費',
  '警備（アルソック）': 'アルソック',
  清掃費: '清掃費',
  修繕費: '修繕費',
  ゴミ処理代: 'ゴミ処理代',
  通信費: '通信費',
  公租公課: '公租公課',
  '保険料（建物保険）': '保険料（建物）',
  '保険料（賠償責任保険）': '保険料（賠償責任）',
  '道頓堀商店街　組合費': '商店街組合費',
  町会費: '町会費',
  水道光熱費: '水道光熱費',
}
export const INCOME_ROWS = [
  '家賃+共益費', '光熱費（入居者負担）', '礼金', '敷金', '看板', 'KDDI', 'タイムズ', 'その他',
] as const
export const EXPENSE_ROWS = [
  '管理会社委託費', 'BM', 'EV保守費', 'アルソック', '清掃費', '修繕費', 'ゴミ処理代', '通信費', '公租公課',
  '保険料（建物）', '保険料（賠償責任）', '商店街組合費', '町会費', '水道光熱費', 'その他',
] as const

// 特定物件のみ表示する行（他物件の単独表示では非表示。全体タブでは常に表示）。
// key=行ラベル、value=物件名に含まれるべき文字列
export const PROPERTY_ONLY_ROWS: ReadonlyMap<string, string> = new Map([
  ['KDDI', '道頓堀'],
  ['商店街組合費', '道頓堀'],
  ['タイムズ', '近畿吉田ビル'],
  ['管理会社委託費', '道頓堀'],
])

export interface StatementRow {
  label: string
  months: number[] // 12要素（0=1月）
  total: number
}
export interface IncomeStatementResult {
  year: number
  income: StatementRow[]
  expense: StatementRow[]
  incomeTotalByMonth: number[]
  expenseTotalByMonth: number[]
  netByMonth: number[]
  incomeTotal: number
  expenseTotal: number
  net: number
}

function buildRows(
  labels: readonly string[],
  mapOf: Record<string, string>,
  txs: Transaction[],
): StatementRow[] {
  const table = new Map<string, number[]>()
  labels.forEach((l) => table.set(l, new Array(12).fill(0)))
  for (const t of txs) {
    const row = mapOf[t.category] ?? 'その他'
    const arr = table.get(row) ?? table.get('その他')!
    const m = new Date(t.date).getMonth()
    if (m >= 0 && m <= 11) arr[m] += n(t.amount)
  }
  return labels.map((l) => {
    const months = table.get(l)!
    return { label: l, months, total: months.reduce((s, v) => s + v, 0) }
  })
}

function sumByMonth(rows: StatementRow[]): number[] {
  const out = new Array(12).fill(0)
  for (const r of rows) for (let i = 0; i < 12; i++) out[i] += r.months[i]
  return out
}

export function calcIncomeStatement(transactions: Transaction[], year: number): IncomeStatementResult {
  const inYear = transactions.filter((t) => new Date(t.date).getFullYear() === year)
  const income = buildRows(INCOME_ROWS, INCOME_ROW_OF, inYear.filter((t) => t.type === 'income'))
  const expense = buildRows(EXPENSE_ROWS, EXPENSE_ROW_OF, inYear.filter((t) => t.type === 'expense'))
  const incomeTotalByMonth = sumByMonth(income)
  const expenseTotalByMonth = sumByMonth(expense)
  const netByMonth = incomeTotalByMonth.map((v, i) => v - expenseTotalByMonth[i])
  const incomeTotal = incomeTotalByMonth.reduce((s, v) => s + v, 0)
  const expenseTotal = expenseTotalByMonth.reduce((s, v) => s + v, 0)
  return {
    year,
    income,
    expense,
    incomeTotalByMonth,
    expenseTotalByMonth,
    netByMonth,
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
  }
}

// =====================================================================
// 入金状況（SOW 6.6）— 月次・号室別
// =====================================================================
export type PaymentJudgement =
  | '空室'
  | '入金済'
  | '保証会社入金済'
  | '一部入金'
  | '保証会社請求中'
  | '未入金'

export interface PaymentRow {
  unit: Unit
  billed: number // 請求額 = rent+kyoeki（入居戸）
  paid: number // 入金額 = 当月分（前家賃で帰属）の賃料系入金
  paidDate: string | null // 入金日 = 当月分の最新入金の日付
  judgement: PaymentJudgement
  arrearsMonths: number // 滞納月数（初回入金月〜選択月で満額未達の月数）
}
export interface PaymentStatusResult {
  year: number
  month: number // 1-12
  rows: PaymentRow[]
  billedUnits: number // 請求対象戸数
  collectedUnits: number // 回収済（入金済/保証会社入金済）
  attentionUnits: number // 要対応（一部入金/保証会社請求中/未入金）
  collectionRate: number // 回収率 = 回収済 / 請求対象
}

const RENT_CATEGORIES = new Set(['賃料', '共益費'])
const isGuarantor = (s?: string | null) => Boolean(s && /保証/.test(s))

// 請求額・入金額・入居状況・保証会社有無 から判定を導出（手入力の入金額編集で使用）。
export function deriveJudgement(
  occupied: boolean,
  billed: number,
  paid: number,
  hasGuarantor: boolean,
): PaymentJudgement {
  if (!occupied) return '空室'
  if (paid >= billed && billed > 0) return hasGuarantor ? '保証会社入金済' : '入金済'
  if (paid > 0 && paid < billed) return '一部入金'
  if (paid === 0 && hasGuarantor) return '保証会社請求中'
  return '未入金'
}

export function calcPaymentStatus(
  units: Unit[],
  transactions: Transaction[],
  year: number,
  month: number, // 1-12
  rentHistoryByUnit?: Map<string, RentHistory[]>, // 未指定時は units の現在値のみ使用（旧挙動と同じ）
): PaymentStatusResult {
  // 前家賃ルール：翌月分は前月末日までに入金、当月10日を過ぎても未着なら滞納。
  // 入金の「帰属月」＝ 11日以降の入金は翌月分の前払い、10日までの入金は当月分とみなす。
  const attrIdx = (d: Date) => d.getFullYear() * 12 + d.getMonth() + (d.getDate() > 10 ? 1 : 0)
  const selIdx = year * 12 + (month - 1)

  // 締め切り経過（猶予判定）：過去月、または当月で本日が11日以降なら true
  const today = new Date()
  const nowIdx = today.getFullYear() * 12 + today.getMonth()
  const gracePassed = (i: number) => (i < nowIdx ? true : i > nowIdx ? false : today.getDate() >= 11)

  const rows: PaymentRow[] = units.map((u) => {
    const eff = effectiveRentKyoeki(u, rentHistoryByUnit?.get(u.id), year, month)
    const billed = eff.rent + eff.kyoeki

    // この号室の賃料系入金を帰属月ごとに集計（選択月まで）
    const paidByMonth = new Map<number, number>()
    const selPayments: Transaction[] = []
    for (const t of transactions) {
      if (t.type !== 'income' || t.unit_id !== u.id || !RENT_CATEGORIES.has(t.category)) continue
      const idx = attrIdx(new Date(t.date))
      if (idx > selIdx) continue
      paidByMonth.set(idx, (paidByMonth.get(idx) ?? 0) + n(t.amount))
      if (idx === selIdx) selPayments.push(t)
    }
    const paid = paidByMonth.get(selIdx) ?? 0
    const paidDate =
      selPayments.length > 0
        ? selPayments.reduce((mx, t) => (t.date > mx ? t.date : mx), selPayments[0].date)
        : null
    const guarantorUnit = isGuarantor(u.payment_method) || selPayments.some((t) => isGuarantor(t.method))

    let judgement: PaymentJudgement
    if (!isOccupied(u)) judgement = '空室'
    else if (paid >= billed && billed > 0) judgement = guarantorUnit ? '保証会社入金済' : '入金済'
    else if (paid > 0 && paid < billed) judgement = '一部入金'
    else if (paid === 0 && guarantorUnit) judgement = '保証会社請求中'
    else judgement = '未入金'

    // 滞納月数：初回入金月〜選択月で、締め切り（当月10日）を過ぎても満額未達の月を数える
    let arrearsMonths = 0
    if (isOccupied(u) && billed > 0 && paidByMonth.size > 0) {
      const startIdx = Math.min(...paidByMonth.keys())
      for (let i = startIdx; i <= selIdx; i++) {
        if (gracePassed(i) && (paidByMonth.get(i) ?? 0) < billed) arrearsMonths++
      }
    }

    return { unit: u, billed, paid, paidDate, judgement, arrearsMonths }
  })

  const billable = rows.filter((r) => r.judgement !== '空室')
  const collected = rows.filter((r) => r.judgement === '入金済' || r.judgement === '保証会社入金済')
  const attention = rows.filter(
    (r) => r.judgement === '一部入金' || r.judgement === '保証会社請求中' || r.judgement === '未入金',
  )
  return {
    year,
    month,
    rows,
    billedUnits: billable.length,
    collectedUnits: collected.length,
    attentionUnits: attention.length,
    collectionRate: billable.length ? collected.length / billable.length : 0,
  }
}

// =====================================================================
// 未入金一覧 — 号室ごとに、滞納している月とその金額・合計を集計
// =====================================================================
export interface ArrearsMonthDetail {
  year: number
  month: number
  shortfall: number // その月の不足額（請求額−入金額）
}
export interface ArrearsUnitRow {
  unit: Unit
  tenant: string
  guarantor: string
  months: ArrearsMonthDetail[] // 未入金・一部入金の月（古い順）
  monthsCount: number
  total: number // 合計滞納額
}

// 判定：入金済・保証会社入金済・空室 は滞納ではない
const isSettled = (j?: string | null) => j === '入金済' || j === '保証会社入金済' || j === '空室'

export function calcArrearsList(
  units: Unit[],
  records: PaymentRecord[],
  transactions: Transaction[],
  upToYear: number,
  upToMonth: number,
  rentHistoryByUnit?: Map<string, RentHistory[]>,
): ArrearsUnitRow[] {
  const selIdx = upToYear * 12 + (upToMonth - 1)
  const today = new Date()
  const nowIdx = today.getFullYear() * 12 + today.getMonth()
  // 締め切り経過（未到来の月は滞納に数えない）
  const gracePassed = (i: number) => (i < nowIdx ? true : i > nowIdx ? false : today.getDate() >= 11)
  const attrIdx = (d: Date) => d.getFullYear() * 12 + d.getMonth() + (d.getDate() > 10 ? 1 : 0)

  // 月次記録を号室（property_id|room）→ idx→record に索引化
  const recByUnit = new Map<string, Map<number, PaymentRecord>>()
  for (const rec of records) {
    const k = `${rec.property_id}|${rec.room}`
    if (!recByUnit.has(k)) recByUnit.set(k, new Map())
    recByUnit.get(k)!.set(rec.year * 12 + (rec.month - 1), rec)
  }
  // 記帳（transactions）の賃料系入金を unit_id→帰属月→合計 に索引化
  const paidByUnit = new Map<string, Map<number, number>>()
  for (const t of transactions) {
    if (t.type !== 'income' || !t.unit_id || !RENT_CATEGORIES.has(t.category)) continue
    const idx = attrIdx(new Date(t.date))
    if (!paidByUnit.has(t.unit_id)) paidByUnit.set(t.unit_id, new Map())
    const m = paidByUnit.get(t.unit_id)!
    m.set(idx, (m.get(idx) ?? 0) + n(t.amount))
  }

  const out: ArrearsUnitRow[] = []
  for (const u of units) {
    const recMap = recByUnit.get(`${u.property_id}|${u.room}`)
    const txMap = paidByUnit.get(u.id)
    // 記録のある月＋入金のある月 の和集合だけを見る（データの無い月は誤検知になるので数えない）
    const idxSet = new Set<number>()
    if (recMap) for (const i of recMap.keys()) idxSet.add(i)
    if (txMap) for (const i of txMap.keys()) idxSet.add(i)

    const months: ArrearsMonthDetail[] = []
    let tenant = u.tenant ?? ''
    let guarantor = u.guarantor ?? ''
    for (const idx of Array.from(idxSet).sort((a, b) => a - b)) {
      if (idx > selIdx || !gracePassed(idx)) continue
      const y = Math.floor(idx / 12)
      const mo = (idx % 12) + 1
      const eff = effectiveRentKyoeki(u, rentHistoryByUnit?.get(u.id), y, mo)
      const rec = recMap?.get(idx)
      let billed: number
      let paid: number
      if (rec) {
        if (isSettled(rec.judgement)) continue
        billed = rec.billed != null ? n(rec.billed) : eff.rent + eff.kyoeki
        paid = rec.paid != null ? n(rec.paid) : 0
        if (!tenant && rec.tenant) tenant = rec.tenant
        if (!guarantor && rec.guarantor) guarantor = rec.guarantor
      } else {
        if (!isOccupied(u)) continue // 記録の無い空室月は数えない
        billed = eff.rent + eff.kyoeki
        paid = txMap?.get(idx) ?? 0
      }
      const shortfall = Math.max(0, billed - paid)
      if (shortfall > 0) months.push({ year: y, month: mo, shortfall })
    }

    if (months.length > 0) {
      out.push({
        unit: u,
        tenant,
        guarantor,
        months,
        monthsCount: months.length,
        total: months.reduce((s, m) => s + m.shortfall, 0),
      })
    }
  }
  // 合計滞納額の大きい順
  return out.sort((a, b) => b.total - a.total)
}

// =====================================================================
// 物件概要書の収益指標（SOW 6.7）— M4 の概要書でも利用
// =====================================================================
export interface ProfitIndicators {
  gpi: number // 満室想定年収
  grossYield: number | null // 表面利回り = GPI / acquired_price
  currentAnnual: number // 現況年収
  currentYield: number | null // 現況利回り
  noi: number // 想定NOI = GPI×(1-空室率) - 運営費
  realYield: number | null // 実質利回り = NOI / acquired_price
}

export function calcProfitIndicators(
  rr: RentRollResult,
  property?: Property | null,
  opex = 0, // 運営費（年）
  vacancyRate = 0, // 空室率（0-1）
): ProfitIndicators {
  const acquired = property?.acquired_price ? n(property.acquired_price) : 0
  const gpi = rr.fullAnnual
  const currentAnnual = rr.currentMonthly * 12
  const noi = gpi * (1 - vacancyRate) - opex
  return {
    gpi,
    grossYield: acquired > 0 ? gpi / acquired : null,
    currentAnnual,
    currentYield: acquired > 0 ? currentAnnual / acquired : null,
    noi,
    realYield: acquired > 0 ? noi / acquired : null,
  }
}

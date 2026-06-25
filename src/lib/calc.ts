// 集計ロジック（レントロール・利回り・収支表・入金状況）。UI から分離（SOW 設計方針）。
import type { Property, Transaction, Unit } from '../types'

const n = (v: number | null | undefined) => Number(v ?? 0) || 0
const isOccupied = (u: Unit) => u.status === '入居'

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
  const totalUnits = units.length
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
  賃料: '家賃',
  共益費: '共益費',
  '看板・広告': '看板・広告',
  礼金: '礼金・更新料',
  更新料: '礼金・更新料',
  敷金: 'その他',
  その他入金: 'その他',
}
const EXPENSE_ROW_OF: Record<string, string> = {
  管理委託費: '管理委託費',
  BM: 'BM',
  清掃費: '清掃費',
  水道光熱費: '共用部光熱費',
  修繕費: '修繕費',
  固定資産税: '固都税',
  損害保険料: '損害保険料',
  ローン返済: 'ローン返済',
  その他出金: 'その他',
}
export const INCOME_ROWS = ['家賃', '共益費', '看板・広告', '礼金・更新料', 'その他'] as const
export const EXPENSE_ROWS = [
  '管理委託費', 'BM', '清掃費', '共用部光熱費', '修繕費', '固都税', '損害保険料', 'ローン返済', 'その他',
] as const

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
  paid: number // 入金額 = 当月の賃料系入金（該当unit）
  judgement: PaymentJudgement
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

export function calcPaymentStatus(
  units: Unit[],
  transactions: Transaction[],
  year: number,
  month: number, // 1-12
): PaymentStatusResult {
  const monthTxs = transactions.filter((t) => {
    const d = new Date(t.date)
    return d.getFullYear() === year && d.getMonth() + 1 === month && t.type === 'income'
  })

  const rows: PaymentRow[] = units.map((u) => {
    const billed = n(u.rent) + n(u.kyoeki)
    const unitTxs = monthTxs.filter((t) => t.unit_id === u.id && RENT_CATEGORIES.has(t.category))
    const paid = unitTxs.reduce((s, t) => s + n(t.amount), 0)
    const guarantorUnit = isGuarantor(u.payment_method) || unitTxs.some((t) => isGuarantor(t.method))

    let judgement: PaymentJudgement
    if (!isOccupied(u)) judgement = '空室'
    else if (paid >= billed && billed > 0) judgement = guarantorUnit ? '保証会社入金済' : '入金済'
    else if (paid > 0 && paid < billed) judgement = '一部入金'
    else if (paid === 0 && guarantorUnit) judgement = '保証会社請求中'
    else judgement = '未入金'

    return { unit: u, billed, paid, judgement }
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

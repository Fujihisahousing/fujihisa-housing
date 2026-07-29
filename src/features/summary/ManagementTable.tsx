// 賃貸物件管理表（全物件まとめ）。画面表示＋A3横の印刷／PDF。
// 長年 Excel（フジヒサハウジング管理.xls「賃貸物件管理表」）で作ってきた形をそのまま踏襲する：
//   縦＝物件ごとの帯（収入・支出6行・合計）／横＝9月〜8月＋年間合計／最下段＝全物件の合計。
// 既存の収支表（行=費目・1物件ぶん）とは別物なので、画面も別タブに分けている。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { transactionsRepo, paymentRecordsRepo, unitsRepo } from '../../lib/repositories'
import {
  calcManagementTable,
  fiscalYearOf,
  fiscalYearRange,
  paymentRecordsToTransactions,
  FISCAL_MONTHS,
  FISCAL_PREV_YEAR_COLS,
  MGMT_EXPENSE_ROWS,
  isDisposedForRentRoll,
  type MgmtPropertyBlock,
  type MgmtTableResult,
  type StatementRow,
} from '../../lib/calc'
import { yen } from '../../lib/format'
import '../../reports/print.css'
import type { PaymentRecord, Property, Transaction, Unit } from '../../types'

// 収支表と同じ運用開始年度（データが無くても過去年度を開けるように）
const FIRST_YEAR = 2023

export function ManagementTable({ properties }: { properties: Property[] }) {
  const [year, setYear] = useState(fiscalYearOf(new Date()))
  const [txs, setTxs] = useState<Transaction[]>([])
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  // print.css は A4縦。この画面を開いている間だけ A3横に上書きする（現況報告書と同じ手）
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = '@media print { @page { size: A3 landscape; margin: 8mm; } }'
    document.head.appendChild(el)
    return () => {
      document.head.removeChild(el)
    }
  }, [])

  // 管理表は常に全物件が対象（物件タブでは絞らない）
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, rec, u] = await Promise.all([
        transactionsRepo.list({}),
        paymentRecordsRepo.list(null),
        unitsRepo.listAll(),
      ])
      setTxs(t)
      setRecords(rec)
      setUnits(u)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 入金状況の月次記録も収入に合算する（収支表と同じ扱い）
  const allTxs = useMemo(
    () => [...txs, ...paymentRecordsToTransactions(records, units)],
    [txs, records, units],
  )

  // 決済済みの物件は来期から落とす（レントロールと同じ基準）。過去年度を開けば表に残る。
  const visibleProperties = useMemo(() => {
    const today = new Date()
    return properties.filter((p) => !isDisposedForRentRoll(p.disposed_date, today))
  }, [properties])

  const r = useMemo(
    () => calcManagementTable(allTxs, visibleProperties, year),
    [allTxs, visibleProperties, year],
  )

  const years = useMemo(() => {
    const set = new Set<number>()
    for (let y = FIRST_YEAR; y <= fiscalYearOf(new Date()); y++) set.add(y)
    allTxs.forEach((t) => set.add(fiscalYearOf(new Date(t.date))))
    return Array.from(set).sort((a, b) => b - a)
  }, [allTxs])

  const range = fiscalYearRange(year)

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm font-medium text-slate-700">賃貸物件管理表</span>
        <label className="text-sm text-slate-600 ml-2">年度</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年度
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          A3横。印刷ダイアログで用紙をA3・横にして「PDFとして保存」
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Printer className="w-4 h-4" /> 印刷 / PDF
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : (
        <div id="print-root" className="space-y-3">
          <h2 className="text-center text-lg font-bold text-slate-800">
            フジヒサハウジング 賃貸物件管理表
          </h2>
          <p className="text-center text-xs text-slate-500 -mt-2">
            {year}年度（{range.from} 〜 {range.to}）
          </p>
          <Summary r={r} />
          <MgmtTable r={r} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- サマリー
function Summary({ r }: { r: MgmtTableResult }) {
  const s = useMemo(() => {
    let income = 0
    const byExpense = MGMT_EXPENSE_ROWS.map(() => 0)
    for (const b of r.blocks) {
      income += b.income.total
      b.expenses.forEach((e, i) => (byExpense[i] += e.total))
    }
    const expense = byExpense.reduce((a, v) => a + v, 0)
    return { income, expense, net: income - expense, byExpense }
  }, [r])

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="収入計" value={s.income} tone="text-emerald-700" />
        <Stat label="支出計" value={s.expense} tone="text-rose-700" />
        <Stat label="差引（収支）" value={s.net} tone="text-slate-900" big />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
        <span className="font-medium text-slate-500">支出の内訳</span>
        {MGMT_EXPENSE_ROWS.map((label, i) => (
          <span key={label} className="tabular-nums">
            {label} <span className="font-medium text-slate-800">{yen(s.byExpense[i])}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  big,
}: {
  label: string
  value: number
  tone: string
  big?: boolean
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`tabular-nums font-bold ${tone} ${big ? 'text-xl' : 'text-lg'}`}>
        {yen(value)}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ 本表
const PREV = FISCAL_PREV_YEAR_COLS
// 左2列（物件名・項目）は横スクロールしても固定する。印刷では sticky は効かないので影響なし。
const C_NAME = 'sticky left-0 z-10 bg-white border-r border-slate-200 align-top'
const C_ITEM = 'sticky left-[9.5rem] z-10 bg-white border-r border-slate-200 whitespace-nowrap'
const C_TOTAL = 'sticky right-0 z-10 bg-slate-50 border-l border-slate-200 whitespace-nowrap'
const CELL = 'px-2 py-1 whitespace-nowrap'

function MgmtTable({ r }: { r: MgmtTableResult }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="text-xs border-collapse w-max">
        <thead>
          <tr className="text-slate-500">
            <th rowSpan={2} className={`${CELL} ${C_NAME} z-20 text-left font-medium min-w-[9.5rem]`}>
              物件
            </th>
            <th rowSpan={2} className={`${CELL} ${C_ITEM} z-20 text-left font-medium min-w-[4.5rem]`}>
              項目
            </th>
            <th colSpan={PREV} className={`${CELL} pb-0 text-left font-medium`}>
              {r.year - 1}年
            </th>
            <th
              colSpan={FISCAL_MONTHS.length - PREV}
              className={`${CELL} pb-0 text-left font-medium border-l border-slate-200`}
            >
              {r.year}年
            </th>
            <th rowSpan={2} className={`${CELL} ${C_TOTAL} z-20 text-right font-medium`}>
              年間合計
            </th>
          </tr>
          <tr className="text-slate-500 border-b border-slate-300">
            {FISCAL_MONTHS.map((m, i) => (
              <th
                key={m}
                className={
                  `${CELL} pt-0 text-center font-medium min-w-[5.5rem] ` +
                  (i === PREV ? 'border-l border-slate-200' : '')
                }
              >
                {m}月
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.blocks.map((b) => (
            <PropertyBlock key={b.propertyId} b={b} />
          ))}
          <tr className="border-t-2 border-slate-400 bg-slate-100 font-bold">
            <td className={`${CELL} ${C_NAME} !bg-slate-100 text-slate-900`} colSpan={2}>
              合　計
            </td>
            {r.grandTotal.months.map((v, i) => (
              <td key={i} className={`${CELL} text-right tabular-nums text-slate-900`}>
                {v ? yen(v) : '—'}
              </td>
            ))}
            <td className={`${CELL} ${C_TOTAL} !bg-slate-200 text-right tabular-nums text-slate-900`}>
              {yen(r.grandTotal.total)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// 物件1件ぶんの帯（8行）。印刷でページをまたいで割れないよう report-block を付ける
function PropertyBlock({ b }: { b: MgmtPropertyBlock }) {
  const ROWS = 2 + MGMT_EXPENSE_ROWS.length // 収入 + 支出6 + 合計
  return (
    <>
      <tr className="report-block border-t-2 border-slate-300">
        <td rowSpan={ROWS} className={`${CELL} ${C_NAME} py-2`}>
          <div className="font-semibold text-slate-800 leading-tight">{b.name}</div>
          {b.built && <div className="text-[10px] text-slate-500 leading-tight">{b.built}</div>}
          {b.acquired && <div className="text-[10px] text-slate-500 leading-tight">{b.acquired}</div>}
        </td>
        <ItemCells row={b.income} tone="text-emerald-700" />
      </tr>
      {b.expenses.map((e) => (
        <tr key={e.label} className="border-b border-slate-100">
          <ItemCells row={e} tone="text-slate-600" />
        </tr>
      ))}
      <tr className="border-b border-slate-200 bg-slate-50 font-semibold">
        <ItemCells row={b.net} tone="text-slate-900" strong />
      </tr>
    </>
  )
}

// 項目名セル＋12ヶ月＋年間合計。<tr> 直下に置く前提
function ItemCells({
  row,
  tone,
  strong,
}: {
  row: StatementRow
  tone: string
  strong?: boolean
}) {
  const bg = strong ? '!bg-slate-50' : ''
  return (
    <>
      <td className={`${CELL} ${C_ITEM} ${bg} ${tone}`}>{row.label}</td>
      {row.months.map((v, i) => (
        <td key={i} className={`${CELL} text-right tabular-nums ${tone}`}>
          {v ? yen(v) : '—'}
        </td>
      ))}
      {/* 発生の無い費目は月・年間合計とも「—」で揃える（合計だけ ¥0 と出るのを防ぐ） */}
      <td className={`${CELL} ${C_TOTAL} ${strong ? '!bg-slate-100' : ''} text-right tabular-nums font-medium ${tone}`}>
        {row.total ? yen(row.total) : '—'}
      </td>
    </>
  )
}

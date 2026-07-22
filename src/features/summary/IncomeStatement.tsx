// 収支表（画面）。行=項目 / 列=1〜12月＋合計。Excel出力は M4。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, FileSpreadsheet } from 'lucide-react'
import { transactionsRepo, paymentRecordsRepo, unitsRepo } from '../../lib/repositories'
import {
  calcIncomeStatement,
  fiscalYearOf,
  isStatementRowVisible,
  FISCAL_MONTHS,
  type IncomeStatementResult,
  type StatementRow,
} from '../../lib/calc'
import { exportIncomeStatementExcel } from '../../reports/exportExcel'
import { yen } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import { CAT_RENT, type PaymentRecord, type Transaction, type Unit } from '../../types'

// 収支表の年度プルダウンに常に出す最も古い会計年度（データの有無に関わらず選べるようにする）
const FIRST_YEAR = 2022

export function IncomeStatement({ propertyName }: { propertyName: string }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [year, setYear] = useState(fiscalYearOf(new Date()))
  const [txs, setTxs] = useState<Transaction[]>([])
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, rec, u] = await Promise.all([
        transactionsRepo.list({ propertyId: activeProperty }),
        paymentRecordsRepo.list(activeProperty),
        activeProperty ? unitsRepo.listByProperty(activeProperty) : unitsRepo.listAll(),
      ])
      setTxs(t)
      setRecords(rec)
      setUnits(u)
    } finally {
      setLoading(false)
    }
  }, [activeProperty])

  useEffect(() => {
    void load()
  }, [load])

  // 部屋がKDDI契約（アンテナ等）かどうかの判定用（物件ID+号室→契約者名がKDDIか）
  const kddiRooms = useMemo(() => {
    const s = new Set<string>()
    for (const u of units) {
      if (u.tenant === 'KDDI') s.add(`${u.property_id}|${u.room}`)
    }
    return s
  }, [units])

  // 入金状況の月次記録（入金額）を家賃収入として収支表に合算する。
  // KDDI契約の部屋の入金だけは家賃ではなくKDDI収入として計上する。
  const recordTxs: Transaction[] = useMemo(
    () =>
      records
        .filter((rec) => Number(rec.paid) > 0)
        .map((rec) => ({
          id: `pr-${rec.property_id}-${rec.room}-${rec.year}-${rec.month}`,
          date: `${rec.year}-${String(rec.month).padStart(2, '0')}-15`,
          property_id: rec.property_id,
          type: 'income' as const,
          category: kddiRooms.has(`${rec.property_id}|${rec.room}`) ? 'KDDI' : CAT_RENT,
          amount: Number(rec.paid),
        })),
    [records, kddiRooms],
  )

  const allTxs = useMemo(() => [...txs, ...recordTxs], [txs, recordTxs])

  const r = useMemo(() => calcIncomeStatement(allTxs, year), [allTxs, year])

  // 行の出し分けは calc.ts に集約（特定物件限定行・全体非表示行・物件ごとの非表示行）
  const keepRow = useCallback(
    (row: StatementRow) => isStatementRowVisible(row.label, propertyName),
    [propertyName],
  )
  const incomeRows = useMemo(() => r.income.filter(keepRow), [r.income, keepRow])
  const expenseRows = useMemo(() => r.expense.filter(keepRow), [r.expense, keepRow])
  // 年度の選択肢は運用開始年度〜今年度を常に出す。データが1件も無い物件（富士マンション等）で
  // 今年度しか選べず過去年度を開けなくなるのを防ぐ。データ側に範囲外の年度があれば併せて出す。
  const years = useMemo(() => {
    const set = new Set<number>()
    for (let y = FIRST_YEAR; y <= fiscalYearOf(new Date()); y++) set.add(y)
    allTxs.forEach((t) => set.add(fiscalYearOf(new Date(t.date))))
    return Array.from(set).sort((a, b) => b - a)
  }, [allTxs])

  return (
    <div className="space-y-4">
      {/* flex-wrap と max-w-full は、選択肢が長くなっても横幅を突き破らないための保険 */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600">年度</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="max-w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {/* 「2025年度（2025年9月〜2026年8月）」のように期間まで書くと、select が
              最長の選択肢の幅（105px→278px）まで広がってスマホ幅でツールバーが
              はみ出し、表全体が潰れる。表記は短いままにすること */}
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年度
            </option>
          ))}
        </select>
        <button
          onClick={() => void exportIncomeStatementExcel(propertyName, r)}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel出力
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : (
        <StatementTable r={r} incomeRows={incomeRows} expenseRows={expenseRows} />
      )}
    </div>
  )
}

// 列数 = 項目 + 12ヶ月 + 年度合計
const COL_COUNT = FISCAL_MONTHS.length + 2

// 左端（項目）と右端（年度合計）は横スクロールしても固定する。
// 金額は whitespace-nowrap で折り返さない（折り返すと行が縦に伸びて非常に見づらい）。
// 固定列は背景を不透明にし、z-index でスクロールしてくる月の列より前面に出すこと。
const COL_ITEM = 'sticky left-0 z-10 bg-white border-r border-slate-200 whitespace-nowrap'
const COL_TOTAL = 'sticky right-0 z-10 bg-slate-50 border-l border-slate-200 whitespace-nowrap'
const CELL = 'px-3 py-2 whitespace-nowrap'

export function StatementTable({
  r,
  incomeRows,
  expenseRows,
}: {
  r: IncomeStatementResult
  incomeRows: StatementRow[]
  expenseRows: StatementRow[]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="text-sm border-collapse w-max">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-200">
            <th className={`${CELL} ${COL_ITEM} z-20 text-left font-medium min-w-[9rem]`}>項目</th>
            {FISCAL_MONTHS.map((m) => (
              <th key={m} className={`${CELL} text-right font-medium min-w-[6.5rem]`}>
                {m}月
              </th>
            ))}
            <th className={`${CELL} ${COL_TOTAL} z-20 text-right font-medium`}>年度合計</th>
          </tr>
        </thead>
        <tbody>
          <SectionHeader title="収入" />
          {incomeRows.map((row) => (
            <DataRow key={row.label} row={row} />
          ))}
          <TotalRow label="収入計" months={r.incomeTotalByMonth} total={r.incomeTotal} tone="income" />

          <SectionHeader title="支出" />
          {expenseRows.map((row) => (
            <DataRow key={row.label} row={row} />
          ))}
          <TotalRow label="支出計" months={r.expenseTotalByMonth} total={r.expenseTotal} tone="expense" />

          <TotalRow label="差引（収支）" months={r.netByMonth} total={r.net} tone="net" />
        </tbody>
      </table>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr className="bg-slate-50">
      <td className="px-3 py-1.5 text-xs font-semibold text-slate-500" colSpan={COL_COUNT}>
        {/* 横スクロールしても見出しが左端に残るように */}
        <span className="sticky left-3 whitespace-nowrap">{title}</span>
      </td>
    </tr>
  )
}

function DataRow({ row }: { row: StatementRow }) {
  return (
    <tr className="border-b border-slate-100 bg-white">
      <td className={`${CELL} ${COL_ITEM} text-slate-700`}>{row.label}</td>
      {row.months.map((v, i) => (
        <td key={i} className={`${CELL} text-right tabular-nums text-slate-600`}>
          {v ? yen(v) : '—'}
        </td>
      ))}
      <td className={`${CELL} ${COL_TOTAL} text-right tabular-nums font-medium`}>{yen(row.total)}</td>
    </tr>
  )
}

function TotalRow({
  label,
  months,
  total,
  tone,
}: {
  label: string
  months: number[]
  total: number
  tone: 'income' | 'expense' | 'net'
}) {
  const color =
    tone === 'income' ? 'text-emerald-700' : tone === 'expense' ? 'text-rose-700' : 'text-slate-900'
  return (
    <tr className="border-b-2 border-slate-200 font-medium bg-white">
      <td className={`${CELL} ${COL_ITEM} ${color}`}>{label}</td>
      {months.map((v, i) => (
        <td key={i} className={`${CELL} text-right tabular-nums ${color}`}>
          {v ? yen(v) : '—'}
        </td>
      ))}
      <td className={`${CELL} ${COL_TOTAL} text-right tabular-nums ${color}`}>{yen(total)}</td>
    </tr>
  )
}

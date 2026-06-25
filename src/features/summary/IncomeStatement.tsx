// 収支表（画面）。行=項目 / 列=1〜12月＋合計。Excel出力は M4。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, FileSpreadsheet } from 'lucide-react'
import { transactionsRepo } from '../../lib/repositories'
import { calcIncomeStatement, type StatementRow } from '../../lib/calc'
import { exportIncomeStatementExcel } from '../../reports/exportExcel'
import { yen } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type { Transaction } from '../../types'

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

export function IncomeStatement({ propertyName }: { propertyName: string }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [year, setYear] = useState(new Date().getFullYear())
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setTxs(await transactionsRepo.list({ propertyId: activeProperty }))
    } finally {
      setLoading(false)
    }
  }, [activeProperty])

  useEffect(() => {
    void load()
  }, [load])

  const r = useMemo(() => calcIncomeStatement(txs, year), [txs, year])
  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()])
    txs.forEach((t) => set.add(new Date(t.date).getFullYear()))
    return Array.from(set).sort((a, b) => b - a)
  }, [txs])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-slate-600">年度</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="text-sm border-collapse min-w-[860px]">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="sticky left-0 bg-white px-3 py-2 text-left font-medium">項目</th>
                {MONTHS.map((m) => (
                  <th key={m} className="px-3 py-2 text-right font-medium">
                    {m}月
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium bg-slate-50">年間合計</th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader title="収入" />
              {r.income.map((row) => (
                <DataRow key={row.label} row={row} />
              ))}
              <TotalRow label="収入計" months={r.incomeTotalByMonth} total={r.incomeTotal} tone="income" />

              <SectionHeader title="支出" />
              {r.expense.map((row) => (
                <DataRow key={row.label} row={row} />
              ))}
              <TotalRow label="支出計" months={r.expenseTotalByMonth} total={r.expenseTotal} tone="expense" />

              <TotalRow label="差引（収支）" months={r.netByMonth} total={r.net} tone="net" />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr className="bg-slate-50">
      <td className="sticky left-0 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500" colSpan={14}>
        {title}
      </td>
    </tr>
  )
}

function DataRow({ row }: { row: StatementRow }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="sticky left-0 bg-white px-3 py-2 text-slate-700">{row.label}</td>
      {row.months.map((v, i) => (
        <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-600">
          {v ? yen(v) : '—'}
        </td>
      ))}
      <td className="px-3 py-2 text-right tabular-nums font-medium bg-slate-50">{yen(row.total)}</td>
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
    <tr className="border-b-2 border-slate-200 font-medium">
      <td className={'sticky left-0 bg-white px-3 py-2 ' + color}>{label}</td>
      {months.map((v, i) => (
        <td key={i} className={'px-3 py-2 text-right tabular-nums ' + color}>
          {v ? yen(v) : '—'}
        </td>
      ))}
      <td className={'px-3 py-2 text-right tabular-nums bg-slate-50 ' + color}>{yen(total)}</td>
    </tr>
  )
}

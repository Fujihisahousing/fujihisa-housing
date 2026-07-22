// 用途別のExcel出力。パターンを選んで書き出す。必要なデータはボタンを押したときに読み込む。
import { useCallback, useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import {
  transactionsRepo,
  unitsRepo,
  paymentRecordsRepo,
  rentHistoryRepo,
} from '../lib/repositories'
import { EXPORT_PATTERNS, exportPattern, type ExportPattern } from '../reports/exportPatterns'
import { fiscalYearOf } from '../lib/calc'
import { useAppStore } from '../state/useAppStore'
import type { Property } from '../types'

export function ExportPatternBar({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [pattern, setPattern] = useState<ExportPattern>('genkyo')
  const [busy, setBusy] = useState(false)

  const propertyName = activeProperty
    ? (properties.find((p) => p.id === activeProperty)?.name ?? '物件')
    : '全体'
  const hint = EXPORT_PATTERNS.find((p) => p.key === pattern)?.hint ?? ''

  const run = useCallback(async () => {
    setBusy(true)
    try {
      const units = activeProperty
        ? await unitsRepo.listByProperty(activeProperty)
        : await unitsRepo.listAll()
      const [transactions, records, rentHistory] = await Promise.all([
        transactionsRepo.list({ propertyId: activeProperty }),
        paymentRecordsRepo.list(activeProperty),
        rentHistoryRepo.listByUnitIds(units.map((u) => u.id)),
      ])
      const now = new Date()
      await exportPattern(pattern, {
        propertyName,
        properties: activeProperty ? properties.filter((p) => p.id === activeProperty) : properties,
        units,
        transactions,
        records,
        rentHistory,
        fiscalYear: fiscalYearOf(now),
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      })
    } catch (e) {
      alert('Excel出力に失敗しました：' + (e instanceof Error ? e.message : ''))
    } finally {
      setBusy(false)
    }
  }, [activeProperty, pattern, properties, propertyName])

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Excel出力</span>
        <select
          value={pattern}
          onChange={(e) => setPattern(e.target.value as ExportPattern)}
          className="max-w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {EXPORT_PATTERNS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          書き出す
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

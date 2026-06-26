// 入金状況（画面）。月次・号室別。Excel出力は M4。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, FileSpreadsheet } from 'lucide-react'
import { transactionsRepo, unitsRepo } from '../../lib/repositories'
import { calcPaymentStatus, type PaymentJudgement } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { exportPaymentStatusExcel } from '../../reports/exportExcel'
import { yen, percent } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type { Property, Transaction, Unit } from '../../types'

const JUDGE_STYLE: Record<PaymentJudgement, string> = {
  入金済: 'bg-emerald-50 text-emerald-700',
  保証会社入金済: 'bg-teal-50 text-teal-700',
  一部入金: 'bg-amber-50 text-amber-700',
  保証会社請求中: 'bg-sky-50 text-sky-700',
  未入金: 'bg-rose-50 text-rose-700',
  空室: 'bg-slate-100 text-slate-500',
}

const now = new Date()

export function PaymentStatus({
  properties,
  propertyName,
}: {
  properties: Property[]
  propertyName: string
}) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [units, setUnits] = useState<Unit[]>([])
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, t] = await Promise.all([
        activeProperty ? unitsRepo.listByProperty(activeProperty) : unitsRepo.listAll(),
        transactionsRepo.list({ propertyId: activeProperty }),
      ])
      setUnits(u)
      setTxs(t)
    } finally {
      setLoading(false)
    }
  }, [activeProperty])

  useEffect(() => {
    void load()
  }, [load])

  const propOrder = useMemo(() => {
    const m = new Map<string, number>()
    properties.forEach((p, i) => m.set(p.id, i))
    return m
  }, [properties])
  const propName = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]))
    return (id?: string | null) => (id ? m.get(id) ?? '—' : '—')
  }, [properties])

  // 物件→号室順に並べ替え（レントロールと同じ並び）
  const sortedUnits = useMemo(() => {
    return [...units].sort((a, b) => {
      const pa = propOrder.get(a.property_id) ?? 9999
      const pb = propOrder.get(b.property_id) ?? 9999
      if (pa !== pb) return pa - pb
      return unitCompare(a, b)
    })
  }, [units, propOrder])

  const r = useMemo(
    () => calcPaymentStatus(sortedUnits, txs, year, month),
    [sortedUnits, txs, year, month],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <button
          onClick={() => void exportPaymentStatusExcel(propertyName, r)}
          disabled={units.length === 0}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel出力
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="請求対象戸数" value={`${r.billedUnits}戸`} />
        <StatCard label="回収済" value={`${r.collectedUnits}戸`} />
        <StatCard label="要対応" value={`${r.attentionUnits}戸`} />
        <StatCard label="回収率" value={percent(r.collectionRate, 1)} />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : units.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">部屋が登録されていません。</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2 font-medium">マンション</th>
                <th className="px-3 py-2 font-medium">号室</th>
                <th className="px-3 py-2 font-medium text-right">請求額</th>
                <th className="px-3 py-2 font-medium text-right">入金額</th>
                <th className="px-3 py-2 font-medium">判定</th>
                <th className="px-3 py-2 font-medium">滞納</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => (
                <tr key={row.unit.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{propName(row.unit.property_id)}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-700">{row.unit.room}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                    {row.judgement === '空室' ? '—' : yen(row.billed)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                    {row.judgement === '空室' ? '—' : yen(row.paid)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={'text-xs rounded-full px-2 py-0.5 ' + JUDGE_STYLE[row.judgement]}>
                      {row.judgement}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {row.arrearsMonths >= 1 ? (
                      <span className="text-xs rounded-full px-2 py-0.5 bg-rose-600 text-white font-medium">
                        {row.arrearsMonths}ヵ月
                      </span>
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-800 mt-0.5">{value}</div>
    </div>
  )
}

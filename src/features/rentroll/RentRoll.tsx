// レントロール（画面）。Excel出力は M4、
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, FileSpreadsheet } from 'lucide-react'
import { unitsRepo } from '../../lib/repositories'
import { calcRentRoll } from '../../lib/calc'
import { exportRentRollExcel } from '../../reports/exportExcel'
import { yen, percent, formatDate } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type { Property, Unit } from '../../types'

export function RentRoll({ properties, propertyName }: { properties: Property[]; propertyName: string }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUnits(activeProperty ? await unitsRepo.listByProperty(activeProperty) : await unitsRepo.listAll())
    } finally {
      setLoading(false)
    }
  }, [activeProperty])

  useEffect(() => {
    void load()
  }, [load])

  // 全体表示時は取得価格を合算した擬似物件で表面利回りを算出
  const propertyForCalc: Property | null = useMemo(() => {
    if (activeProperty) return properties.find((p) => p.id === activeProperty) ?? null
    const sum = properties.reduce((s, p) => s + (Number(p.acquired_price) || 0), 0)
    return sum > 0 ? ({ id: 'all', name: '全体', acquired_price: sum } as Property) : null
  }, [activeProperty, properties])

  const rr = useMemo(() => calcRentRoll(units, propertyForCalc), [units, propertyForCalc])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => void exportRentRollExcel(propertyName, rr)}
          disabled={units.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel出力
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="満室想定(月)" value={yen(rr.fullMonthly)} />
        <StatCard label="現況(月)" value={yen(rr.currentMonthly)} />
        <StatCard label="稼働率" value={`${percent(rr.occupancyRate, 1)}（${rr.occupiedUnits}/${rr.totalUnits}）`} />
        <StatCard label="表面利回り" value={rr.grossYield != null ? percent(rr.grossYield, 2) : '—'} />
      </div>

      {units.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">部屋が登録されていません。</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <Th>号室</Th>
                <Th>間取</Th>
                <Th className="text-right">面積</Th>
                <Th>用途</Th>
                <Th>入居者属性</Th>
                <Th className="text-right">賃料</Th>
                <Th className="text-right">共益費</Th>
                <Th className="text-right">合計</Th>
                <Th className="text-right">敷金</Th>
                <Th className="text-right">礼金</Th>
                <Th className="text-right">返還金</Th>
                <Th>駐輪・駐車</Th>
                <Th>契約満了</Th>
                <Th>状況</Th>
                <Th>備考</Th>
              </tr>
            </thead>
            <tbody>
              {rr.rows.map(({ unit: u, total }) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <Td className="font-medium">{u.room}</Td>
                  <Td>{u.layout}</Td>
                  <Td className="text-right">{u.area ? `${u.area}㎡` : '—'}</Td>
                  <Td>{u.use_type || '—'}</Td>
                  <Td>{u.tenant_type || '—'}</Td>
                  <Td className="text-right tabular-nums">{yen(u.rent)}</Td>
                  <Td className="text-right tabular-nums">{yen(u.kyoeki)}</Td>
                  <Td className="text-right tabular-nums font-medium">{yen(total)}</Td>
                  <Td className="text-right tabular-nums">{yen(u.deposit)}</Td>
                  <Td className="text-right tabular-nums">{yen(u.key_money)}</Td>
                  <Td className="text-right tabular-nums">{u.refund != null ? yen(u.refund) : '—'}</Td>
                  <Td>{u.parking || '—'}</Td>
                  <Td>{u.contract_end ? formatDate(u.contract_end) : '—'}</Td>
                  <Td>
                    <span
                      className={
                        'text-xs rounded-full px-2 py-0.5 ' +
                        (u.status === '入居' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600')
                      }
                    >
                      {u.status}
                    </span>
                  </Td>
                  <Td className="max-w-[12rem] truncate" >{u.notes || '—'}</Td>
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

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={'px-3 py-2 font-medium ' + className}>{children}</th>
}
function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={'px-3 py-2.5 text-slate-700 ' + className}>{children}</td>
}

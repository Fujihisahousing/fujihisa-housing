// 物件概要書（A4 PDF・印刷レイアウト。SOW 6.7）。
// スペック＋収益指標＋レントロール要約。ブラウザ印刷で A4 PDF 化する。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Printer, Loader2 } from 'lucide-react'
import { unitsRepo } from '../../lib/repositories'
import { calcRentRoll, calcProfitIndicators } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { yen, percent, formatDate } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type { Property, Unit } from '../../types'
import '../../reports/print.css'

export function Prospectus({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [selectedId, setSelectedId] = useState<string>(activeProperty ?? properties[0]?.id ?? '')
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(false)
  const [opex, setOpex] = useState('') // 運営費（年）
  const [vacancy, setVacancy] = useState('') // 空室率（%）

  useEffect(() => {
    if (activeProperty) setSelectedId(activeProperty)
  }, [activeProperty])

  const property = useMemo(() => properties.find((p) => p.id === selectedId) ?? null, [properties, selectedId])

  const load = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    try {
      setUnits(await unitsRepo.listByProperty(selectedId))
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void load()
  }, [load])

  // 階数の高い順（駐車場は下・屋上地下は最下段）に並べてから集計
  const sortedUnits = useMemo(() => [...units].sort(unitCompare), [units])
  const rr = useMemo(() => calcRentRoll(sortedUnits, property), [sortedUnits, property])
  const ind = useMemo(
    () => calcProfitIndicators(rr, property, Number(opex) || 0, (Number(vacancy) || 0) / 100),
    [rr, property, opex, vacancy],
  )

  if (properties.length === 0) {
    return <div className="text-center text-slate-400 text-sm py-12">物件を登録してください。</div>
  }

  return (
    <div className="space-y-4">
      {/* 操作部（印刷時は隠す） */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="text-xs text-slate-500">運営費(年)</label>
        <input
          type="number"
          value={opex}
          onChange={(e) => setOpex(e.target.value)}
          placeholder="0"
          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right"
        />
        <label className="text-xs text-slate-500">空室率%</label>
        <input
          type="number"
          value={vacancy}
          onChange={(e) => setVacancy(e.target.value)}
          placeholder="0"
          className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right"
        />
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-slate-800"
        >
          <Printer className="w-4 h-4" /> 印刷 / PDF
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : property ? (
        <div id="print-root">
          <div className="sheet bg-white border border-slate-200 rounded-xl p-6 max-w-[760px] mx-auto">
            <h1 className="text-xl font-bold text-slate-900">物件概要書</h1>
            <div className="text-sm text-slate-500 mb-4">
              {property.name}　／　作成日 {formatDate(new Date())}
            </div>

            {/* スペック */}
            <Section title="物件スペック">
              <SpecGrid property={property} />
            </Section>

            {/* 収益指標 */}
            <Section title="収益指標">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Metric label="満室想定年収（GPI）" value={yen(ind.gpi)} />
                <Metric label="表面利回り" value={ind.grossYield != null ? percent(ind.grossYield) : '—'} />
                <Metric label="現況年収" value={yen(ind.currentAnnual)} />
                <Metric label="現況利回り" value={ind.currentYield != null ? percent(ind.currentYield) : '—'} />
                <Metric label="想定NOI" value={yen(ind.noi)} />
                <Metric label="実質利回り" value={ind.realYield != null ? percent(ind.realYield) : '—'} />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                前提：運営費(年) {yen(Number(opex) || 0)}／空室率 {Number(vacancy) || 0}%。利回りは参考値。
              </p>
            </Section>

            {/* レントロール要約 */}
            <Section title={`レントロール要約（稼働 ${rr.occupiedUnits}/${rr.totalUnits}・稼働率 ${percent(rr.occupancyRate, 1)}）`}>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-300">
                    <th className="py-1.5 pr-2">号室</th>
                    <th className="py-1.5 pr-2">間取</th>
                    <th className="py-1.5 pr-2 text-right">賃料＋共益</th>
                    <th className="py-1.5">状況</th>
                  </tr>
                </thead>
                <tbody>
                  {rr.rows.map(({ unit: u, total }) => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 font-medium">{u.room}</td>
                      <td className="py-1.5 pr-2">{u.layout}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{yen(total)}</td>
                      <td className="py-1.5">{u.status}</td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-1.5 pr-2" colSpan={2}>
                      満室想定(月)合計
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{yen(rr.fullMonthly)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </Section>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-sm font-bold text-slate-700 border-b-2 border-slate-800 pb-1 mb-2">{title}</h2>
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-800">{value}</div>
    </div>
  )
}

function SpecGrid({ property: p }: { property: Property }) {
  const items: [string, string][] = [
    ['所在地', p.address ?? '—'],
    ['交通', p.access ?? '—'],
    ['種別', p.type ?? '—'],
    ['構造', p.structure ?? '—'],
    ['築年', p.built ?? '—'],
    ['土地面積', p.land_area ? `${p.land_area}㎡` : '—'],
    ['建物面積', p.building_area ? `${p.building_area}㎡` : '—'],
    ['用途地域', p.zoning ?? '—'],
    ['建蔽率', p.bcr != null ? `${p.bcr}%` : '—'],
    ['容積率', p.far != null ? `${p.far}%` : '—'],
    ['前面道路', p.road ?? '—'],
    ['駐車場', p.parking ?? '—'],
    ['取得日', p.acquired_date ? formatDate(p.acquired_date) : '—'],
    ['取得価格', p.acquired_price != null ? yen(p.acquired_price) : '—'],
    ['ローン残債', p.loan_balance != null ? yen(p.loan_balance) : '—'],
  ]
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-1">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-800 text-right">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

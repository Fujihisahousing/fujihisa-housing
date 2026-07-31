// 元家賃比較（家賃変動）。A4縦1枚に、左＝元家賃・右＝現在の家賃と変動値を並べる。
// 手本はデスクトップの「堂島家賃変動19.05~.pdf」（過去／現在の2ブロック並記）。
//
// 元家賃は rent_history の基準日時点の値。プランドール堂島は 2019-05-01 付で
// 57室ぶんを登録済み。基準日より前の履歴が無い部屋は units の現在値に
// フォールバックする（effectiveRentKyoeki の仕様）ので変動値は 0 になる。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { unitsRepo, rentHistoryRepo } from '../../lib/repositories'
import { useAppStore } from '../../state/useAppStore'
import { effectiveRentKyoeki } from '../../lib/calc'
import { floorMark, isGroupBreak, unitCompare } from '../../lib/sortUnits'
import { maxRoomDigits, padRoom } from '../../lib/format'
import '../../reports/print.css'
import '../../reports/rentComparison.css'
import type { Property, RentHistory, Unit } from '../../types'

/** 元家賃の基準日。この日時点で有効だった賃料を「元家賃」とする */
export const BASE_YEAR = 2019
export const BASE_MONTH = 5
const BASE_LABEL = `${BASE_YEAR}年${BASE_MONTH}月時点`

const n = (v: unknown) => Number(v ?? 0) || 0
const yen = (v: number) => (v ? v.toLocaleString('ja-JP') : '')
/** 変動値は符号付き。0 は空欄（PDFの手本と同じで、変わっていない部屋は何も出さない） */
const signed = (v: number) => (v === 0 ? '' : (v > 0 ? '+' : '−') + Math.abs(v).toLocaleString('ja-JP'))

export interface CompareRow {
  unit: Unit
  baseRent: number
  baseKyoeki: number
  nowRent: number
  nowKyoeki: number
  diff: number
  /** この行から階が変わる（＝行の上に区切り線を引く）。先頭行は false */
  floorBreak: boolean
}

/** 部屋と賃料履歴から比較表の行を組み立てる。CSS を読まないので単体で検証できる */
export function buildCompareRows(units: Unit[], history: RentHistory[]): CompareRow[] {
  const byUnit = new Map<string, RentHistory[]>()
  for (const h of history) {
    if (!h.unit_id) continue
    if (!byUnit.has(h.unit_id)) byUnit.set(h.unit_id, [])
    byUnit.get(h.unit_id)!.push(h)
  }
  const sorted = [...units].sort(unitCompare)
  return sorted.map((u, i) => {
    const base = effectiveRentKyoeki(u, byUnit.get(u.id), BASE_YEAR, BASE_MONTH)
    const nowRent = n(u.rent)
    const nowKyoeki = n(u.kyoeki)
    return {
      unit: u,
      baseRent: n(base.rent),
      baseKyoeki: n(base.kyoeki),
      nowRent,
      nowKyoeki,
      diff: nowRent + nowKyoeki - (n(base.rent) + n(base.kyoeki)),
      floorBreak: i > 0 && isGroupBreak(sorted[i - 1], u),
    }
  })
}

export function RentComparison({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [units, setUnits] = useState<Unit[]>([])
  const [history, setHistory] = useState<RentHistory[]>([])
  const [loading, setLoading] = useState(true)

  const property = properties.find((p) => p.id === activeProperty) ?? null

  const load = useCallback(async () => {
    if (!activeProperty) {
      setUnits([])
      setHistory([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const us = await unitsRepo.listByProperty(activeProperty)
      setUnits(us)
      setHistory(await rentHistoryRepo.listByUnitIds(us.map((u) => u.id)))
    } finally {
      setLoading(false)
    }
  }, [activeProperty])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => buildCompareRows(units, history), [units, history])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-sm font-medium text-slate-700">元家賃比較</span>
        <span className="text-xs text-slate-500">
          A4縦1枚。印刷ダイアログで用紙をA4・縦にして「PDFとして保存」
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Printer className="w-4 h-4" /> 印刷 / PDF
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">部屋が登録されていません。</div>
      ) : (
        <div id="print-root">
          <RentComparisonSheet rows={rows} propertyName={property?.name ?? ''} today={new Date()} />
        </div>
      )}
    </div>
  )
}

/** 印刷される本体。データ取得から切り離してあるので単体で表示確認できる */
export function RentComparisonSheet({
  rows,
  propertyName,
  today,
}: {
  rows: CompareRow[]
  propertyName: string
  today: Date
}) {
  const baseTotal = rows.reduce((s, r) => s + r.baseRent + r.baseKyoeki, 0)
  const nowTotal = rows.reduce((s, r) => s + r.nowRent + r.nowKyoeki, 0)
  const diffTotal = nowTotal - baseTotal
  const changed = rows.filter((r) => r.diff !== 0).length
  const roomWidth = maxRoomDigits(rows.map((r) => r.unit.room))

  return (
    <div className="rc-page">
      <header className="rc-head">
        <div className="rc-title">
          <span className="rc-kicker">FUJIHISA HOUSING</span>
          <h1>{propertyName}　家賃変動</h1>
        </div>
        <div className="rc-kpis">
          <Kpi label="変動戸数" value={String(changed)} unit={`/ ${rows.length}戸`} />
          <Kpi label="変動値" value={diffTotal === 0 ? '±0' : signed(diffTotal)} unit="円" accent />
        </div>
        <div className="rc-date">
          {today.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </div>
      </header>

      <table className="rc-table">
        <colgroup>
          {/* 元家賃：号室・賃料・共益費・合計 */}
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '12%' }} />
          {/* 現在：号室・賃料・共益費・合計・変動値 */}
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr className="rc-group">
            <th className="rc-past" colSpan={4}>
              元家賃<small>{BASE_LABEL}</small>
            </th>
            <th className="rc-now rc-split" colSpan={5}>
              現在<small>
                {today.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
              </small>
            </th>
          </tr>
          <tr className="rc-cols">
            <th>号室</th>
            <th>賃料</th>
            <th>共益費</th>
            <th>合計</th>
            <th className="rc-split">号室</th>
            <th>賃料</th>
            <th>共益費</th>
            <th>合計</th>
            <th>変動値</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const room = padRoom(String(r.unit.room ?? ''), roomWidth)
            // 号室のうしろの階数記号（奇数階=■／偶数階=□）。現況報告書と同じ規則で、
            // 101号室だけは特例で付けない。
            const mark = String(r.unit.room ?? '').trim() !== '101' ? floorMark(r.unit) : ''
            const label = mark ? `${room}　${mark}` : room
            // 空室・停止など現在が課金対象でない部屋は号室を灰色にして区別する
            const idle = !(r.unit.status === '入居' || r.unit.status === '退予')
            const br = r.floorBreak ? ' is-fbreak' : ''
            return (
              <tr key={r.unit.id} className={r.floorBreak ? 'is-fbreak' : undefined}>
                <td className={'rm' + br}>{label}</td>
                <td className={'r' + br}>{yen(r.baseRent)}</td>
                <td className={'r' + br}>{yen(r.baseKyoeki)}</td>
                <td className={'r sum' + br}>{yen(r.baseRent + r.baseKyoeki)}</td>
                <td className={'rm now rc-split' + br + (idle ? ' is-idle' : '')}>{label}</td>
                <td className={'r now' + br}>{yen(r.nowRent)}</td>
                <td className={'r now' + br}>{yen(r.nowKyoeki)}</td>
                <td className={'r sum now' + br}>{yen(r.nowRent + r.nowKyoeki)}</td>
                <td className={'r dv now' + br + (r.diff < 0 ? ' is-down' : '')}>{signed(r.diff)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>計</td>
            <td colSpan={3} className="r">
              {yen(baseTotal)}
            </td>
            <td className="rc-split now">計</td>
            <td colSpan={3} className="r now">
              {yen(nowTotal)}
            </td>
            <td className={'r dv' + (diffTotal < 0 ? ' is-down' : '')}>{signed(diffTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="rc-note">
        元家賃＝{BASE_LABEL}の賃料履歴。現在＝部屋情報の賃料・共益費。変動値は合計（賃料＋共益費）の差額。
      </p>
    </div>
  )
}

function Kpi({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: string
  unit?: string
  accent?: boolean
}) {
  return (
    <div className={'rc-kpi' + (accent ? ' is-accent' : '')}>
      <span className="rc-kpi-label">{label}</span>
      <span className="rc-kpi-value">
        {value}
        {unit && <i>{unit}</i>}
      </span>
    </div>
  )
}

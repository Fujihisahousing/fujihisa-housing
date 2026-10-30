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
  /** 階ごとに交互に塗るための目印。先頭の階から 0,1,0,1… */
  floorBand: 0 | 1
}

/** 1坪あたりの㎡数の逆数（1㎡＝0.3025坪） */
const TSUBO_PER_M2 = 0.3025

/** 単価（円）。面積が無い・金額が0なら null（空欄） */
export function unitPrices(total: number, area: number | null | undefined) {
  const a = n(area)
  if (a <= 0 || total <= 0) return { tsubo: null, m2: null }
  return { tsubo: Math.round(total / (a * TSUBO_PER_M2)), m2: Math.round(total / a) }
}

/** 合計行の単価＝面積のある部屋の合計額の総和 ÷ 面積の総和（面積で重みをつけた平均） */
function averagePrices(rows: CompareRow[], pick: (r: CompareRow) => number) {
  let sum = 0
  let area = 0
  for (const r of rows) {
    const a = n(r.unit.area)
    const t = pick(r)
    if (a <= 0 || t <= 0) continue
    sum += t
    area += a
  }
  return unitPrices(sum, area)
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
  let band: 0 | 1 = 0
  return sorted.map((u, i) => {
    const base = effectiveRentKyoeki(u, byUnit.get(u.id), BASE_YEAR, BASE_MONTH)
    const nowRent = n(u.rent)
    const nowKyoeki = n(u.kyoeki)
    const floorBreak = i > 0 && isGroupBreak(sorted[i - 1], u)
    if (floorBreak) band = band === 0 ? 1 : 0
    return {
      unit: u,
      baseRent: n(base.rent),
      baseKyoeki: n(base.kyoeki),
      nowRent,
      nowKyoeki,
      diff: nowRent + nowKyoeki - (n(base.rent) + n(base.kyoeki)),
      floorBreak,
      floorBand: band,
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
  const baseAvg = averagePrices(rows, (r) => r.baseRent + r.baseKyoeki)
  const nowAvg = averagePrices(rows, (r) => r.nowRent + r.nowKyoeki)

  return (
    <div className="rc-page">
      <header className="rc-head">
        <div className="rc-title">
          <span className="rc-kicker">FUJIHISA HOUSING</span>
          <h1>{propertyName}　家賃変動</h1>
        </div>
        <div className="rc-kpis">
          <Kpi label="変動戸数" value={String(changed)} unit={`/ ${rows.length}戸`} />
          <Kpi
            label="変動値"
            value={diffTotal === 0 ? '±0' : signed(diffTotal)}
            unit="円/月"
            accent
          />
        </div>
        <div className="rc-date">
          {today.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </div>
      </header>

      <table className="rc-table">
        <colgroup>
          {/* 元家賃：号室・賃料・共益費・合計・坪単価・㎡単価 */}
          <col style={{ width: '8.5%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8.5%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6.5%' }} />
          {/* 現在：号室・賃料・共益費・合計・変動値・坪単価・㎡単価 */}
          <col style={{ width: '8.5%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8.5%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6.5%' }} />
        </colgroup>
        <thead>
          <tr className="rc-group">
            <th className="rc-past" colSpan={6}>
              元家賃<small>{BASE_LABEL}</small>
            </th>
            <th className="rc-now rc-split" colSpan={7}>
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
            <th>坪単価</th>
            <th>㎡単価</th>
            <th className="rc-split">号室</th>
            <th>賃料</th>
            <th>共益費</th>
            <th>合計</th>
            <th>変動値</th>
            <th>坪単価</th>
            <th>㎡単価</th>
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
            const baseSum = r.baseRent + r.baseKyoeki
            const nowSum = r.nowRent + r.nowKyoeki
            const bp = unitPrices(baseSum, r.unit.area)
            const np = unitPrices(nowSum, r.unit.area)
            // 階ごとに背景を交互に塗る（同じ階の部屋は同じ色）
            const rowClass = [r.floorBreak ? 'is-fbreak' : '', r.floorBand ? 'is-band' : '']
              .filter(Boolean)
              .join(' ')
            return (
              <tr key={r.unit.id} className={rowClass || undefined}>
                <td className={'rm' + br}>{label}</td>
                <td className={'r' + br}>{yen(r.baseRent)}</td>
                <td className={'r' + br}>{yen(r.baseKyoeki)}</td>
                <td className={'r sum' + br}>{yen(baseSum)}</td>
                <td className={'r up' + br}>{yen(bp.tsubo ?? 0)}</td>
                <td className={'r up' + br}>{yen(bp.m2 ?? 0)}</td>
                <td className={'rm now rc-split' + br + (idle ? ' is-idle' : '')}>{label}</td>
                <td className={'r now' + br}>{yen(r.nowRent)}</td>
                <td className={'r now' + br}>{yen(r.nowKyoeki)}</td>
                <td className={'r sum now' + br}>{yen(nowSum)}</td>
                <td className={'r dv now' + br + (r.diff < 0 ? ' is-down' : '')}>{signed(r.diff)}</td>
                <td className={'r up now' + br}>{yen(np.tsubo ?? 0)}</td>
                <td className={'r up now' + br}>{yen(np.m2 ?? 0)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          {/* 月収計＝各室の合計の総和、年収計＝その12倍。変動値も同じ並びで出す */}
          <TotalRow
            label="月収計"
            base={baseTotal}
            now={nowTotal}
            diff={diffTotal}
            baseAvg={baseAvg}
            nowAvg={nowAvg}
          />
          <TotalRow
            label="年収計"
            base={baseTotal * 12}
            now={nowTotal * 12}
            diff={diffTotal * 12}
            year
          />
        </tfoot>
      </table>

      <p className="rc-note">
        元家賃＝{BASE_LABEL}の賃料履歴。現在＝部屋情報の賃料・共益費。変動値は合計（賃料＋共益費）の差額。年収計は月収計の12か月分。
        坪単価・㎡単価は合計（賃料＋共益費）÷部屋の面積（1㎡＝0.3025坪、円未満四捨五入）。月収計の単価は全室の合計÷全室の面積。
      </p>
    </div>
  )
}

/** 合計行（月収計・年収計）。左＝元家賃／右＝現在／末尾＝変動値 */
function TotalRow({
  label,
  base,
  now,
  diff,
  year,
  baseAvg,
  nowAvg,
}: {
  label: string
  base: number
  now: number
  diff: number
  year?: boolean
  /** 平均の単価。年収計では出さない（月額の単価なので） */
  baseAvg?: { tsubo: number | null; m2: number | null }
  nowAvg?: { tsubo: number | null; m2: number | null }
}) {
  return (
    <tr className={year ? 'is-year' : undefined}>
      <td>{label}</td>
      <td colSpan={3} className="r">
        {yen(base)}
      </td>
      <td className="r up">{yen(baseAvg?.tsubo ?? 0)}</td>
      <td className="r up">{yen(baseAvg?.m2 ?? 0)}</td>
      <td className="rc-split now">{label}</td>
      <td colSpan={3} className="r now">
        {yen(now)}
      </td>
      <td className={'r dv' + (diff < 0 ? ' is-down' : '')}>{signed(diff)}</td>
      <td className="r up now">{yen(nowAvg?.tsubo ?? 0)}</td>
      <td className="r up now">{yen(nowAvg?.m2 ?? 0)}</td>
    </tr>
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

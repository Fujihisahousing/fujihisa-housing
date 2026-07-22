// 現況報告書（印刷／PDF）。A3横1枚に全物件を段組みで収める。
// 参照した「入居状況（共有用）」と同じく、入居者欄は個人／法人の属性のみ（氏名は出さない）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { unitsRepo } from '../../lib/repositories'
import { unitCompare } from '../../lib/sortUnits'
import { useAppStore } from '../../state/useAppStore'
import '../../reports/print.css'
import '../../reports/statusReport.css'
import type { Property, Unit } from '../../types'

const n = (v: unknown) => Number(v ?? 0) || 0
const num = (v?: number | null) => (n(v) ? n(v).toLocaleString('ja-JP') : '')
const text = (v?: string | null) => (v && String(v).trim() ? String(v) : '')

// 状況ごとの見た目（CSS側で配色を持つ）
const STATUS_TONE: Record<string, string> = {
  入居: 'is-occupied',
  空室: 'is-vacant',
  入予: 'is-incoming',
  退予: 'is-leaving',
  停止: 'is-stopped',
}

const isChargeable = (u: Unit) => u.status === '入居' || u.status === '退予'

// 検査済証（和暦の年月。例「昭和63年4月」）から築年数を出す
function buildingAge(wareki?: string | null): string {
  if (!wareki) return ''
  const m = wareki.match(/(昭和|平成|令和)\s*(\d+|元)年/)
  if (!m) return ''
  const base = m[1] === '昭和' ? 1925 : m[1] === '平成' ? 1988 : 2018
  const year = base + (m[2] === '元' ? 1 : Number(m[2]))
  return `築${new Date().getFullYear() - year}年`
}
const parkingYen = (s?: string | null) => {
  const m = s ? String(s).match(/[0-9][0-9,]*/) : null
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0
}

export interface Block {
  /** 見出しに出す名前。戸建てのようにまとめた場合はグループ名 */
  label: string
  property: Property
  rooms: Unit[]
}

export function PrintCurrentStatus({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  // print.css は A4縦なので、この画面を開いている間だけ A3横に上書きする
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = '@media print { @page { size: A3 landscape; margin: 8mm; } }'
    document.head.appendChild(el)
    return () => {
      document.head.removeChild(el)
    }
  }, [])

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

  // group_name を持つ物件は1ブロックにまとめる（戸建て6現場 →「戸建て」）。
  // 並びは properties の順（＝手本PDFの並びに合わせて created_at を調整済み）。
  const blocks = useMemo<Block[]>(() => {
    const propById = new Map(properties.map((p) => [p.id, p]))
    const order = new Map(properties.map((p, i) => [p.id, i]))
    const byKey = new Map<string, { label: string; property: Property; rooms: Unit[]; ord: number }>()
    for (const u of units) {
      const p = propById.get(u.property_id)
      if (!p) continue
      const key = p.group_name || p.id
      if (!byKey.has(key)) {
        byKey.set(key, {
          label: p.group_name ? p.group_name.replace(/賃貸$/, '') : p.name,
          property: p,
          rooms: [],
          ord: order.get(p.id) ?? 9999,
        })
      }
      const g = byKey.get(key)!
      g.ord = Math.min(g.ord, order.get(p.id) ?? 9999)
      // まとめた場合は号室だけでは物件が分からないので、現場名を前置きする
      g.rooms.push(p.group_name ? { ...u, room: `${p.name}${u.room && u.room !== p.name ? ' ' + u.room : ''}` } : u)
    }
    return Array.from(byKey.values())
      .sort((a, b) => a.ord - b.ord)
      .map((g) => ({ label: g.label, property: g.property, rooms: g.rooms.sort(unitCompare) }))
  }, [units, properties])

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
        <span className="text-sm font-medium text-slate-700">現況報告書</span>
        <span className="text-xs text-slate-500">
          A3横1枚。印刷ダイアログで用紙をA3・横にして「PDFとして保存」
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Printer className="w-4 h-4" /> 印刷 / PDF
        </button>
      </div>

      {units.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">部屋が登録されていません。</div>
      ) : (
        <div id="print-root">
          <CurrentStatusSheet blocks={blocks} today={new Date()} />
        </div>
      )}
    </div>
  )
}

/** 印刷される本体。データ取得から切り離してあるので単体で表示確認できる */
export function CurrentStatusSheet({ blocks, today }: { blocks: Block[]; today: Date }) {
  const all = blocks.flatMap((b) => b.rooms)
  const counted = all.filter((u) => u.status !== '停止')
  const occupied = all.filter(isChargeable)
  const monthly = occupied.reduce((s, u) => s + n(u.rent) + n(u.kyoeki) + parkingYen(u.parking), 0)

  return (
    <div className="sr-page">
      <header className="sr-head">
        <div className="sr-title">
          <span className="sr-kicker">FUJIHISA HOUSING</span>
          <h1>入居状況一覧</h1>
        </div>
        <div className="sr-kpis">
          <Kpi label="TOTAL" value={String(counted.length)} unit="戸" />
          <Kpi label="OCCUPIED" value={String(occupied.length)} unit="戸" />
          <Kpi
            label="OCCUPANCY"
            value={counted.length ? ((occupied.length / counted.length) * 100).toFixed(1) : '0.0'}
            unit="%"
            accent
          />
          <Kpi label="MONTHLY" value={`¥${monthly.toLocaleString('ja-JP')}`} />
        </div>
        <div className="sr-date">
          {today.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </div>
      </header>

      <div className="sr-cols">
        {blocks.map(({ label, property, rooms }) => {
          const c = rooms.filter((u) => u.status !== '停止')
          const o = rooms.filter(isChargeable)
          const sum = o.reduce(
            (a, u) => ({
              rent: a.rent + n(u.rent),
              kyoeki: a.kyoeki + n(u.kyoeki),
              parking: a.parking + parkingYen(u.parking),
            }),
            { rent: 0, kyoeki: 0, parking: 0 },
          )
          return (
            <section className="sr-block" key={property.id}>
              <div className="sr-block-head">
                <h2>{label}</h2>
                <span className="sr-rate">
                  {o.length}/{c.length}
                  <i>{c.length ? Math.round((o.length / c.length) * 100) : 0}%</i>
                </span>
              </div>
              {property.inspection_date && (
                <div className="sr-block-meta">
                  検査済証 {property.inspection_date}
                  <span>{buildingAge(property.inspection_date)}</span>
                </div>
              )}
              <table className="sr-table">
                <thead>
                  <tr>
                    <th>号室</th>
                    <th>用途</th>
                    <th>入居者</th>
                    <th className="r">賃料</th>
                    <th className="r">共益費</th>
                    <th className="r">駐輪駐車</th>
                    <th className="c">状況</th>
                    <th>備考</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((u) => (
                    <tr key={u.id}>
                      <td className="rm">{text(u.room)}</td>
                      <td>{text(u.use_type)}</td>
                      <td>{text(u.tenant_type)}</td>
                      <td className="r">{num(u.rent)}</td>
                      <td className="r">{num(u.kyoeki)}</td>
                      <td className="r">{text(u.parking)}</td>
                      <td className="c">
                        <span className={'sr-pill ' + (STATUS_TONE[u.status ?? ''] ?? '')}>
                          {text(u.status)}
                        </span>
                      </td>
                      <td className="nt">{text(u.notes)}</td>
                    </tr>
                  ))}
                  <tr className="sr-total">
                    <td colSpan={3}>計</td>
                    <td className="r">{num(sum.rent)}</td>
                    <td className="r">{num(sum.kyoeki)}</td>
                    <td className="r">{num(sum.parking)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </section>
          )
        })}
      </div>
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
    <div className={'sr-kpi' + (accent ? ' is-accent' : '')}>
      <span className="sr-kpi-label">{label}</span>
      <span className="sr-kpi-value">
        {value}
        {unit && <i>{unit}</i>}
      </span>
    </div>
  )
}

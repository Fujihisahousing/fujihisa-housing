// 現況報告書（印刷／PDF）。ブラウザの印刷からPDF保存する前提のA4横レイアウト。
// 物件情報は行ごとに繰り返さず、物件ブロックの見出しにまとめる。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { unitsRepo } from '../../lib/repositories'
import { unitCompare } from '../../lib/sortUnits'
import { yen, percent } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import '../../reports/print.css'
import type { Property, Unit } from '../../types'

// 状況ごとの色（画面のバッジと揃える）
const STATUS_CLASS: Record<string, string> = {
  入居: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  空室: 'bg-rose-50 text-rose-700 border-rose-200',
  入予: 'bg-sky-50 text-sky-700 border-sky-200',
  退予: 'bg-amber-50 text-amber-700 border-amber-200',
  停止: 'bg-slate-100 text-slate-500 border-slate-200',
}

const n = (v: unknown) => Number(v ?? 0) || 0
const money = (v?: number | null) => (n(v) ? yen(n(v)) : '—')
const text = (v?: string | null) => (v && String(v).trim() ? String(v) : '—')

// 「1989年6月」「昭和40年12月」から築年数を出す
function buildingAge(built?: string | null): string {
  if (!built) return '—'
  const wa = built.match(/(昭和|平成|令和)\s*(\d+|元)年/)
  const year = wa
    ? (wa[1] === '昭和' ? 1925 : wa[1] === '平成' ? 1988 : 2018) + (wa[2] === '元' ? 1 : Number(wa[2]))
    : Number(built.match(/(\d{4})\s*年/)?.[1])
  return year ? `${new Date().getFullYear() - year}年` : '—'
}

// 駐輪駐車欄から金額を取り出す（合計用）
const parkingYen = (s?: string | null) => {
  const m = s ? String(s).match(/[0-9][0-9,]*/) : null
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0
}
const isChargeable = (u: Unit) => u.status === '入居' || u.status === '退予'

// 返還金：敷金があれば敷金、保証金なら保証金−解約引、どちらも無ければ保存値。
// レントロール画面（RentRoll.tsx の refundValue）と同じ算出に揃える。
function refundValue(u: Unit): number {
  const dep = n(u.deposit)
  const hosho = n(u.hoshokin)
  if (dep > 0) return dep
  if (hosho > 0) return hosho - n(u.kaiyakubiki)
  return n(u.refund)
}

export function PrintCurrentStatus({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)

  // 既存の print.css は A4縦なので、この画面を開いている間だけ横向きに上書きする
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = '@media print { @page { size: A4 landscape; margin: 10mm; } }'
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

  // 物件ごとにまとめ、タブと同じ物件順・部屋順に並べる
  const blocks = useMemo(() => {
    const order = new Map(properties.map((p, i) => [p.id, i]))
    const byProp = new Map<string, Unit[]>()
    for (const u of units) {
      if (!byProp.has(u.property_id)) byProp.set(u.property_id, [])
      byProp.get(u.property_id)!.push(u)
    }
    return Array.from(byProp.entries())
      .sort((a, b) => (order.get(a[0]) ?? 9999) - (order.get(b[0]) ?? 9999))
      .map(([pid, list]) => ({
        property: properties.find((p) => p.id === pid),
        rooms: [...list].sort(unitCompare),
      }))
      .filter((b) => b.property)
  }, [units, properties])

  const today = new Date().toLocaleDateString('ja-JP')

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
        <span className="text-xs text-slate-500">印刷ダイアログで「PDFとして保存」を選ぶとPDFになります</span>
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
        <CurrentStatusSheet blocks={blocks as Block[]} today={today} />
      )}
    </div>
  )
}

export interface Block {
  property: Property
  rooms: Unit[]
}

/** 印刷される本体。データ取得から切り離してあるので単体で表示確認できる */
export function CurrentStatusSheet({ blocks, today }: { blocks: Block[]; today: string }) {
  return (
    <div id="print-root" className="space-y-6">
      <header className="flex items-end justify-between border-b-2 border-slate-800 pb-2">
            <div>
              <h1 className="text-xl font-bold tracking-wide text-slate-900">現況報告書</h1>
              <p className="text-xs text-slate-500">フジヒサハウジング</p>
            </div>
            <p className="text-xs text-slate-500">作成日：{today}</p>
          </header>

      {blocks.map(({ property, rooms }) => {
            const p = property!
            const chargeable = rooms.filter(isChargeable)
            const counted = rooms.filter((u) => u.status !== '停止')
            const total = chargeable.reduce(
              (a, u) => ({
                rent: a.rent + n(u.rent),
                kyoeki: a.kyoeki + n(u.kyoeki),
                parking: a.parking + parkingYen(u.parking),
              }),
              { rent: 0, kyoeki: 0, parking: 0 },
            )
            return (
              <section key={p.id} className="report-block">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-t-lg bg-slate-800 px-3 py-2 text-white">
                  <h2 className="text-base font-bold">{p.name}</h2>
                  <Meta label="完了検査済日" value={text(p.inspection_date)} />
                  <Meta label="築年月" value={text(p.built)} />
                  <Meta label="築年数" value={buildingAge(p.built)} />
                  <span className="ml-auto text-xs">
                    {counted.length}戸中 {chargeable.length}戸入居／稼働率{' '}
                    {percent(counted.length ? chargeable.length / counted.length : 0, 1)}
                  </span>
                </div>

                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600">
                      <Th>号室</Th>
                      <Th>用途</Th>
                      <Th>属性</Th>
                      <Th>契約者名</Th>
                      <Th right>賃料</Th>
                      <Th right>共益費</Th>
                      <Th right>駐輪駐車</Th>
                      <Th right>返還金（敷金）</Th>
                      <Th center>状況</Th>
                      <Th>備考</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((u) => (
                      <tr key={u.id} className="border-b border-slate-200">
                        <Td bold>{text(u.room)}</Td>
                        <Td>{text(u.use_type)}</Td>
                        <Td>{text(u.tenant_type)}</Td>
                        <Td>{text(u.tenant)}</Td>
                        <Td right>{money(u.rent)}</Td>
                        <Td right>{money(u.kyoeki)}</Td>
                        <Td right>{text(u.parking)}</Td>
                        <Td right>{money(refundValue(u))}</Td>
                        <Td center>
                          <span
                            className={
                              'inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ' +
                              (STATUS_CLASS[u.status ?? ''] ?? 'bg-slate-100 text-slate-600 border-slate-200')
                            }
                          >
                            {text(u.status)}
                          </span>
                        </Td>
                        <Td>{text(u.notes)}</Td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold text-slate-800">
                      <Td colSpan={4}>計（入居・退予のみ）</Td>
                      <Td right>{money(total.rent)}</Td>
                      <Td right>{money(total.kyoeki)}</Td>
                      <Td right>{money(total.parking)}</Td>
                      <Td colSpan={3} />
                    </tr>
                  </tbody>
                </table>
              </section>
            )
          })}
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs">
      <span className="text-slate-300">{label}</span> {value}
    </span>
  )
}

function Th({ children, right, center }: { children?: React.ReactNode; right?: boolean; center?: boolean }) {
  return (
    <th
      className={
        'border border-slate-300 px-2 py-1 font-medium whitespace-nowrap ' +
        (right ? 'text-right' : center ? 'text-center' : 'text-left')
      }
    >
      {children}
    </th>
  )
}

function Td({
  children,
  right,
  center,
  bold,
  colSpan,
}: {
  children?: React.ReactNode
  right?: boolean
  center?: boolean
  bold?: boolean
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={
        'border border-slate-200 px-2 py-1 ' +
        (right ? 'text-right tabular-nums ' : center ? 'text-center ' : '') +
        (bold ? 'font-medium text-slate-900' : 'text-slate-700')
      }
    >
      {children}
    </td>
  )
}

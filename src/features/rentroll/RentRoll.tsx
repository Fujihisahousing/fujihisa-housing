// レントロール（画面）。一覧上で編集できるのは「変動値」「状況」「備考」のみ。他は表示専用。
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { unitsRepo } from '../../lib/repositories'
import { calcRentRoll, isDisposedForRentRoll } from '../../lib/calc'
import { unitCompare, isGroupBreak } from '../../lib/sortUnits'
import { statusBadgeClass } from '../../lib/status'
import { yen, percent, formatDate } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import { UNIT_STATUSES, type Property, type Unit } from '../../types'

const money = (v?: number | null) => (v != null ? yen(v) : '—')

// 駐輪・駐車欄：金額だけ（数字／￥◯◯）は¥表示に整形。文字（家賃込み・バイク等）はそのまま。
function parkingDisplay(s?: string | null): string {
  if (s == null || String(s).trim() === '') return '—'
  const t = String(s).trim()
  const m = t.match(/^[¥￥]?\s*([0-9][0-9,]*)$/)
  return m ? yen(Number(m[1].replace(/,/g, ''))) : t
}

// 返還金の数値：敷金があれば敷金、保証金なら保証金−解約引、どちらも無ければ保存値。
function refundValue(u: Unit): number {
  const dep = Number(u.deposit) || 0
  const hosho = Number(u.hoshokin) || 0
  const kaiyaku = Number(u.kaiyakubiki) || 0
  if (dep > 0) return dep
  if (hosho > 0) return hosho - kaiyaku
  return Number(u.refund) || 0
}
function refundDisplay(u: Unit): string {
  const dep = Number(u.deposit) || 0
  const hosho = Number(u.hoshokin) || 0
  if (dep > 0 || hosho > 0) return yen(refundValue(u))
  return u.refund != null ? yen(u.refund) : '—'
}

// 物件グループの稼働率・返還金合計（稼働率は入居+退去予定／停止を除いた総数）
function groupStats(rows: { unit: Unit }[]) {
  const occ = rows.filter((r) => r.unit.status === '入居' || r.unit.status === '退予').length
  const total = rows.filter((r) => r.unit.status !== '停止').length
  const refund = rows.reduce((s, r) => s + refundValue(r.unit), 0)
  return { occ, total, rate: total ? occ / total : 0, refund }
}

// 敷金（保証金）/ 礼金（解約引）を1段で表示。第2引数（保証金・解約引）は ( ) 付き。
function pairCell(primary?: number | null, paren?: number | null): string {
  const p: string[] = []
  if (primary != null && primary > 0) p.push(yen(primary))
  if (paren != null && paren > 0) p.push(`（${yen(paren)}）`)
  return p.length ? p.join(' ') : '—'
}

// 駐輪・駐車欄（'￥18,700' 等の文字列）から金額を取り出して合算用に数値化
function parkingYen(s?: string | null): number {
  if (!s) return 0
  const m = String(s).match(/[0-9][0-9,]*/)
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0
}

interface Totals {
  rent: number
  kyoeki: number
  parking: number
}
// 合計は「入居・退予」の部屋のみ計上する（入予・空室・停止は合計に含めない）。
// ※各行の賃料表示はそのまま（0にしない）。合計への計上有無だけを状況で判定する。
const isChargeable = (u: Unit) => u.status === '入居' || u.status === '退予'
const sumTotals = (rows: { unit: Unit }[]): Totals =>
  rows.reduce(
    (a, { unit }) =>
      isChargeable(unit)
        ? {
            rent: a.rent + (Number(unit.rent) || 0),
            kyoeki: a.kyoeki + (Number(unit.kyoeki) || 0),
            parking: a.parking + parkingYen(unit.parking),
          }
        : a,
    { rent: 0, kyoeki: 0, parking: 0 },
  )

export function RentRoll({ properties }: { properties: Property[] }) {
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

  // 状況・備考の編集：その場で反映しつつ DB を更新（失敗時は読み直し）
  const patchUnit = useCallback(
    async (id: string, patch: Partial<Unit>) => {
      setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)))
      try {
        await unitsRepo.update(id, patch)
      } catch (e) {
        alert('保存に失敗しました：' + (e instanceof Error ? e.message : ''))
        void load()
      }
    },
    [load],
  )

  // 決済後の物件は来期（決済年度の翌年度9/1）からレントロールに出さない。DBは消さない。
  const today = useMemo(() => new Date(), [])
  const hiddenPropIds = useMemo(
    () => new Set(properties.filter((p) => isDisposedForRentRoll(p.disposed_date, today)).map((p) => p.id)),
    [properties, today],
  )
  const visibleUnits = useMemo(() => units.filter((u) => !hiddenPropIds.has(u.property_id)), [units, hiddenPropIds])

  // 全体表示時は取得価格を合算した擬似物件で集計（非表示物件は合算からも除く）
  const propertyForCalc: Property | null = useMemo(() => {
    if (activeProperty) return properties.find((p) => p.id === activeProperty) ?? null
    const sum = properties
      .filter((p) => !hiddenPropIds.has(p.id))
      .reduce((s, p) => s + (Number(p.acquired_price) || 0), 0)
    return sum > 0 ? ({ id: 'all', name: '全体', acquired_price: sum } as Property) : null
  }, [activeProperty, properties, hiddenPropIds])

  const propOrder = useMemo(() => {
    const m = new Map<string, number>()
    properties.forEach((p, i) => m.set(p.id, i))
    return m
  }, [properties])
  // 全体タブでは group_name を持つ物件を1つの帯にまとめる（戸建ての6現場→「戸建て賃貸」）。
  // group_name が無い物件は従来どおり物件単位。
  const groupKeyOf = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.group_name || p.id]))
    return (propertyId: string) => m.get(propertyId) ?? propertyId
  }, [properties])
  const groupLabelOf = useMemo(() => {
    const m = new Map<string, string>()
    properties.forEach((p) => m.set(p.group_name || p.id, p.group_name || p.name))
    return (key: string) => m.get(key) ?? '—'
  }, [properties])

  // 物件→（階数の高い順・同じ階は号室の小さい順）に並べ替え
  const sortedUnits = useMemo(() => {
    return [...visibleUnits].sort((a, b) => {
      const pa = propOrder.get(a.property_id) ?? 9999
      const pb = propOrder.get(b.property_id) ?? 9999
      if (pa !== pb) return pa - pb
      return unitCompare(a, b)
    })
  }, [visibleUnits, propOrder])

  const rr = useMemo(() => calcRentRoll(sortedUnits, propertyForCalc), [sortedUnits, propertyForCalc])

  // 全体表示のときだけグループごとにまとめる（既定は物件単位、group_name があればその単位）
  const groups = useMemo(() => {
    if (activeProperty) return null
    const map = new Map<string, typeof rr.rows>()
    for (const row of rr.rows) {
      const k = groupKeyOf(row.unit.property_id)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(row)
    }
    return Array.from(map.entries())
  }, [activeProperty, rr.rows, groupKeyOf])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">状況・備考はその場で編集できます（自動保存）</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <DualCard label="満室想定" monthly={rr.fullMonthly} annual={rr.fullAnnual} />
        <DualCard label="現況" monthly={rr.currentMonthly} annual={rr.currentMonthly * 12} />
        <StatCard label="稼働率" value={`${percent(rr.occupancyRate, 1)}（${rr.occupiedUnits}/${rr.totalUnits}）`} />
        <StatCard label="返還金合計" value={yen(rr.rows.reduce((s, r) => s + refundValue(r.unit), 0))} />
      </div>

      {units.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">部屋が登録されていません。</div>
      ) : (
        <div className="overflow-auto max-h-[70vh] rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <Th>号室</Th>
                <Th>間取</Th>
                <Th className="text-right" narrow>面積</Th>
                <Th>用途</Th>
                <Th narrow>属性</Th>
                <Th className="text-right">賃料</Th>
                <Th className="text-right">共益費</Th>
                <Th className="text-right">変動値</Th>
                <Th className="text-right">敷金（保証金）</Th>
                <Th className="text-right">礼金（解約引）</Th>
                <Th className="text-right">返還金</Th>
                <Th className="text-right" narrow>駐輪駐車</Th>
                <Th>入居開始日</Th>
                <Th>状況</Th>
                <Th>備考</Th>
              </tr>
            </thead>
            <tbody>
              {groups
                ? groups.map(([gkey, rows]) => (
                    <Fragment key={gkey}>
                      <tr>
                        <td
                          colSpan={15}
                          className="bg-slate-700 px-3 py-2 text-sm font-semibold text-white"
                        >
                          {groupLabelOf(gkey)}
                          {(() => {
                            const g = groupStats(rows)
                            return (
                              <span className="ml-2 text-xs font-normal text-slate-300">
                                {rows.length}室／稼働率 {percent(g.rate, 1)}（{g.occ}/{g.total}）／返還金合計 {yen(g.refund)}
                              </span>
                            )
                          })()}
                        </td>
                      </tr>
                      {rows.map((r, i) => (
                        <UnitRow
                          key={r.unit.id}
                          unit={r.unit}
                          onPatch={patchUnit}
                          floorBreak={i > 0 && isGroupBreak(rows[i - 1].unit, r.unit)}
                        />
                      ))}
                      {rows.length > 1 && <TotalBlock t={sumTotals(rows)} />}
                    </Fragment>
                  ))
                : (
                    <>
                      {rr.rows.map((r, i) => (
                        <UnitRow
                          key={r.unit.id}
                          unit={r.unit}
                          onPatch={patchUnit}
                          floorBreak={i > 0 && isGroupBreak(rr.rows[i - 1].unit, r.unit)}
                        />
                      ))}
                      {rr.rows.length > 1 && <TotalBlock t={sumTotals(rr.rows)} />}
                    </>
                  )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UnitRow({
  unit: u,
  floorBreak,
  onPatch,
}: {
  unit: Unit
  floorBreak?: boolean
  onPatch: (id: string, patch: Partial<Unit>) => void
}) {
  return (
    <tr
      className={
        'border-b border-slate-100 last:border-0 ' + (floorBreak ? 'border-t-2 border-t-slate-300' : '')
      }
    >
      <Td className="font-medium">{u.room}</Td>
      <Td>{u.layout || '—'}</Td>
      <Td className="text-right" narrow>{u.area ? `${Number(u.area).toFixed(2)}㎡` : '—'}</Td>
      <Td>{u.use_type || '—'}</Td>
      <Td narrow>{u.tenant_type || '—'}</Td>
      <Td className="text-right tabular-nums">{money(u.rent)}</Td>
      <Td className="text-right tabular-nums">{money(u.kyoeki)}</Td>
      <td className="px-1.5 py-1 text-right">
        <TextCell value={u.variation ?? ''} onCommit={(v) => onPatch(u.id, { variation: v || null })} />
      </td>
      <Td className="text-right tabular-nums whitespace-nowrap">{pairCell(u.deposit, u.hoshokin)}</Td>
      <Td className="text-right tabular-nums whitespace-nowrap">{pairCell(u.key_money, u.kaiyakubiki)}</Td>
      <Td className="text-right tabular-nums">{refundDisplay(u)}</Td>
      <Td className="text-right tabular-nums" narrow>{parkingDisplay(u.parking)}</Td>
      <Td>{u.contract_start ? formatDate(u.contract_start) : '—'}</Td>
      <td className="px-1.5 py-1">
        <select
          value={u.status ?? ''}
          onChange={(e) => onPatch(u.id, { status: e.target.value })}
          className={
            'rounded-full border-0 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 ' +
            statusBadgeClass(u.status)
          }
        >
          {UNIT_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-white text-slate-700">
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1.5 py-1">
        <NotesInput value={u.notes ?? ''} onCommit={(v) => onPatch(u.id, { notes: v || null })} />
      </td>
    </tr>
  )
}

// 内訳（賃料・共益費・駐輪駐車）の「計」行と、その下に総額の「合計」行（駐輪・駐車の列位置）を出す
function TotalBlock({ t }: { t: Totals }) {
  const total = t.rent + t.kyoeki + t.parking
  return (
    <>
      <tr className="bg-slate-50 font-medium border-t border-slate-300">
        <td colSpan={5} className="px-3 py-1.5 text-slate-600">
          計
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{yen(t.rent)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{yen(t.kyoeki)}</td>
        <td />
        <td colSpan={3} />
        <td className="px-3 py-1.5 text-right tabular-nums">{yen(t.parking)}</td>
        <td colSpan={3} />
      </tr>
      <tr className="bg-slate-50 font-semibold">
        <td colSpan={11} className="px-3 py-1.5 text-slate-700">
          合計
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums">{yen(total)}</td>
        <td colSpan={3} />
      </tr>
    </>
  )
}

// 変動値など、その場編集する短いテキスト入力（右寄せ・自動保存）
function TextCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [s, setS] = useState(value)
  useEffect(() => setS(value), [value])
  return (
    <input
      value={s}
      onChange={(e) => setS(e.target.value)}
      onBlur={() => {
        if (s !== value) onCommit(s)
      }}
      placeholder="—"
      className="w-24 rounded border border-transparent bg-transparent px-2 py-1 text-right tabular-nums hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
    />
  )
}

function NotesInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [s, setS] = useState(value)
  useEffect(() => setS(value), [value])
  return (
    <input
      value={s}
      onChange={(e) => setS(e.target.value)}
      onBlur={() => {
        if (s !== value) onCommit(s)
      }}
      placeholder="—"
      className="w-44 rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
    />
  )
}

// 月/年を1枠にまとめた金額カード（金額は右寄せ）
function DualCard({ label, monthly, annual }: { label: string; monthly: number; annual: number }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 space-y-0.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-400">月</span>
          <span className="text-sm font-bold text-slate-800 tabular-nums">{yen(monthly)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-400">年</span>
          <span className="text-sm font-bold text-slate-800 tabular-nums">{yen(annual)}</span>
        </div>
      </div>
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

function Th({
  children,
  className = '',
  narrow,
}: {
  children?: ReactNode
  className?: string
  narrow?: boolean
}) {
  // sticky top-0 で縦スクロール時もヘッダーを固定。narrow指定の列は横paddingを詰める。
  return (
    <th
      className={
        'sticky top-0 z-20 whitespace-nowrap bg-white ' +
        (narrow ? 'px-1.5' : 'px-3') +
        ' py-2 font-medium shadow-[inset_0_-1px_0_#e2e8f0] ' +
        className
      }
    >
      {children}
    </th>
  )
}
function Td({
  children,
  className = '',
  narrow,
}: {
  children?: ReactNode
  className?: string
  narrow?: boolean
}) {
  return (
    <td className={'whitespace-nowrap ' + (narrow ? 'px-1.5' : 'px-3') + ' py-1.5 text-slate-700 ' + className}>
      {children}
    </td>
  )
}

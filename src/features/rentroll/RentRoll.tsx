// レントロール（画面）。一覧上で直接編集できる（金額・備考＝入力、用途・状況＝選択）。
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, FileSpreadsheet } from 'lucide-react'
import { unitsRepo } from '../../lib/repositories'
import { calcRentRoll } from '../../lib/calc'
import { unitCompare, isGroupBreak } from '../../lib/sortUnits'
import { statusBadgeClass } from '../../lib/status'
import { exportRentRollExcel } from '../../reports/exportExcel'
import { yen, percent } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import { UNIT_STATUSES, USE_TYPES, TENANT_TYPES, type Property, type Unit } from '../../types'

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

  // 一覧上の編集：その場で反映しつつ DB を更新（失敗時は読み直し）
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

  // 全体表示時は取得価格を合算した擬似物件で表面利回りを算出
  const propertyForCalc: Property | null = useMemo(() => {
    if (activeProperty) return properties.find((p) => p.id === activeProperty) ?? null
    const sum = properties.reduce((s, p) => s + (Number(p.acquired_price) || 0), 0)
    return sum > 0 ? ({ id: 'all', name: '全体', acquired_price: sum } as Property) : null
  }, [activeProperty, properties])

  const propOrder = useMemo(() => {
    const m = new Map<string, number>()
    properties.forEach((p, i) => m.set(p.id, i))
    return m
  }, [properties])
  const propName = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]))
    return (id?: string | null) => (id ? m.get(id) ?? '—' : '—')
  }, [properties])

  // 物件→（階数の高い順・同じ階は号室の小さい順）に並べ替え。Excel出力にも反映される。
  const sortedUnits = useMemo(() => {
    return [...units].sort((a, b) => {
      const pa = propOrder.get(a.property_id) ?? 9999
      const pb = propOrder.get(b.property_id) ?? 9999
      if (pa !== pb) return pa - pb
      return unitCompare(a, b)
    })
  }, [units, propOrder])

  const rr = useMemo(() => calcRentRoll(sortedUnits, propertyForCalc), [sortedUnits, propertyForCalc])

  // 全体表示のときだけ物件ごとにグループ化（rr.rows は既にソート済み）
  const groups = useMemo(() => {
    if (activeProperty) return null
    const map = new Map<string, typeof rr.rows>()
    for (const row of rr.rows) {
      const k = row.unit.property_id
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(row)
    }
    return Array.from(map.entries())
  }, [activeProperty, rr.rows])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">セルをタップして直接編集できます（自動保存）</span>
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
        <div className="overflow-auto max-h-[70vh] rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-max text-sm">
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
              {groups
                ? groups.map(([pid, rows]) => (
                    <Fragment key={pid}>
                      <tr className="bg-slate-100">
                        <td
                          colSpan={15}
                          className="px-3 py-2 text-sm font-semibold text-slate-700 border-y border-slate-200"
                        >
                          {propName(pid)}
                          <span className="ml-2 text-xs font-normal text-slate-500">
                            {rows.length}室／満室想定(月) {yen(rows.reduce((s, r) => s + r.total, 0))}
                          </span>
                        </td>
                      </tr>
                      {rows.map((r, i) => (
                        <UnitRow
                          key={r.unit.id}
                          unit={r.unit}
                          total={r.total}
                          onPatch={patchUnit}
                          floorBreak={i > 0 && isGroupBreak(rows[i - 1].unit, r.unit)}
                        />
                      ))}
                    </Fragment>
                  ))
                : rr.rows.map((r, i) => (
                    <UnitRow
                      key={r.unit.id}
                      unit={r.unit}
                      total={r.total}
                      onPatch={patchUnit}
                      floorBreak={i > 0 && isGroupBreak(rr.rows[i - 1].unit, r.unit)}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UnitRow({
  unit: u,
  total,
  floorBreak,
  onPatch,
}: {
  unit: Unit
  total: number
  floorBreak?: boolean
  onPatch: (id: string, patch: Partial<Unit>) => void
}) {
  const p = (patch: Partial<Unit>) => onPatch(u.id, patch)
  return (
    <tr
      className={
        'border-b border-slate-100 last:border-0 ' + (floorBreak ? 'border-t-2 border-t-slate-300' : '')
      }
    >
      <EditTd><TextInput value={u.room ?? ''} extra="w-16 font-medium" onCommit={(v) => p({ room: v || null })} /></EditTd>
      <EditTd><TextInput value={u.layout ?? ''} extra="w-20" onCommit={(v) => p({ layout: v || null })} /></EditTd>
      <EditTd><NumInput value={u.area} extra="w-16 text-right" onCommit={(v) => p({ area: v })} /></EditTd>
      <EditTd><SelectInput value={u.use_type} options={USE_TYPES} extra="w-24" onCommit={(v) => p({ use_type: v || null })} /></EditTd>
      <EditTd><SelectInput value={u.tenant_type} options={TENANT_TYPES} extra="w-20" onCommit={(v) => p({ tenant_type: v || null })} /></EditTd>
      <EditTd><NumInput value={u.rent} extra="w-24 text-right" onCommit={(v) => p({ rent: v })} /></EditTd>
      <EditTd><NumInput value={u.kyoeki} extra="w-24 text-right" onCommit={(v) => p({ kyoeki: v })} /></EditTd>
      <Td className="text-right tabular-nums font-medium">{yen(total)}</Td>
      <EditTd><NumInput value={u.deposit} extra="w-24 text-right" onCommit={(v) => p({ deposit: v })} /></EditTd>
      <EditTd><NumInput value={u.key_money} extra="w-24 text-right" onCommit={(v) => p({ key_money: v })} /></EditTd>
      <EditTd><NumInput value={u.refund} extra="w-24 text-right" onCommit={(v) => p({ refund: v })} /></EditTd>
      <EditTd><TextInput value={u.parking ?? ''} extra="w-24" onCommit={(v) => p({ parking: v || null })} /></EditTd>
      <EditTd>
        <input
          type="date"
          value={u.contract_end ?? ''}
          onChange={(e) => p({ contract_end: e.target.value || null })}
          className={CELL + ' w-36'}
        />
      </EditTd>
      <EditTd>
        <select
          value={u.status ?? ''}
          onChange={(e) => p({ status: e.target.value })}
          className={'rounded-full border-0 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-900 ' + statusBadgeClass(u.status)}
        >
          {UNIT_STATUSES.map((s) => (
            <option key={s} value={s} className="bg-white text-slate-700">
              {s}
            </option>
          ))}
        </select>
      </EditTd>
      <EditTd><TextInput value={u.notes ?? ''} extra="w-48" onCommit={(v) => p({ notes: v || null })} /></EditTd>
    </tr>
  )
}

// ----------------------- 編集セル部品 -----------------------
const CELL =
  'rounded border border-transparent bg-transparent px-2 py-1 hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900'

function TextInput({
  value,
  onCommit,
  extra = '',
}: {
  value: string
  onCommit: (v: string) => void
  extra?: string
}) {
  const [s, setS] = useState(value)
  useEffect(() => setS(value), [value])
  return (
    <input
      value={s}
      onChange={(e) => setS(e.target.value)}
      onBlur={() => {
        if (s !== value) onCommit(s)
      }}
      className={CELL + ' ' + extra}
    />
  )
}

function NumInput({
  value,
  onCommit,
  extra = '',
}: {
  value: number | null | undefined
  onCommit: (v: number | null) => void
  extra?: string
}) {
  const text = value != null ? String(value) : ''
  const [s, setS] = useState(text)
  useEffect(() => setS(value != null ? String(value) : ''), [value])
  return (
    <input
      inputMode="numeric"
      value={s}
      onChange={(e) => setS(e.target.value)}
      onBlur={() => {
        const t = s.trim()
        const parsed = t === '' ? null : Number(t)
        if (t !== '' && !Number.isFinite(parsed)) {
          setS(value != null ? String(value) : '')
          return
        }
        if ((value ?? null) !== (parsed ?? null)) onCommit(parsed)
      }}
      className={CELL + ' tabular-nums ' + extra}
    />
  )
}

function SelectInput({
  value,
  options,
  onCommit,
  extra = '',
}: {
  value?: string | null
  options: readonly string[]
  onCommit: (v: string) => void
  extra?: string
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onCommit(e.target.value)}
      className={CELL + ' bg-transparent ' + extra}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
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
  // sticky top-0 で縦スクロール時もヘッダーを固定。bg/影で本文と重なっても見えるように。
  return (
    <th
      className={
        'sticky top-0 z-20 whitespace-nowrap bg-white px-3 py-2 font-medium shadow-[inset_0_-1px_0_#e2e8f0] ' +
        className
      }
    >
      {children}
    </th>
  )
}
function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={'whitespace-nowrap px-3 py-2.5 text-slate-700 ' + className}>{children}</td>
}
function EditTd({ children }: { children?: ReactNode }) {
  return <td className="whitespace-nowrap px-1.5 py-1">{children}</td>
}

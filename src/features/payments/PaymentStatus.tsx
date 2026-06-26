// 入金状況（画面）。月次・号室別。マンション帯でグループ表示。備考のみ編集可（月別保存）。
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, FileSpreadsheet, Upload } from 'lucide-react'
import { ImportCsv } from './ImportCsv'
import { transactionsRepo, unitsRepo, paymentNotesRepo } from '../../lib/repositories'
import { calcPaymentStatus, type PaymentJudgement, type PaymentRow } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { exportPaymentStatusExcel } from '../../reports/exportExcel'
import { yen, percent, formatDate } from '../../lib/format'
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
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, t, n] = await Promise.all([
        activeProperty ? unitsRepo.listByProperty(activeProperty) : unitsRepo.listAll(),
        transactionsRepo.list({ propertyId: activeProperty }),
        paymentNotesRepo.mapByMonth(year, month),
      ])
      setUnits(u)
      setTxs(t)
      setNotes(n)
    } finally {
      setLoading(false)
    }
  }, [activeProperty, year, month])

  useEffect(() => {
    void load()
  }, [load])

  const saveNote = useCallback(
    async (unitId: string, memo: string) => {
      setNotes((prev) => ({ ...prev, [unitId]: memo }))
      try {
        await paymentNotesRepo.set(unitId, year, month, memo)
      } catch (e) {
        alert('備考の保存に失敗しました：' + (e instanceof Error ? e.message : ''))
      }
    },
    [year, month],
  )

  const propOrder = useMemo(() => {
    const m = new Map<string, number>()
    properties.forEach((p, i) => m.set(p.id, i))
    return m
  }, [properties])
  const propName = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]))
    return (id?: string | null) => (id ? m.get(id) ?? '—' : '—')
  }, [properties])

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

  const groups = useMemo(() => {
    if (activeProperty) return null
    const map = new Map<string, PaymentRow[]>()
    for (const row of r.rows) {
      const k = row.unit.property_id
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(row)
    }
    return Array.from(map.entries())
  }, [activeProperty, r.rows])

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
          onClick={() => setImporting(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <Upload className="w-4 h-4" /> 通帳CSV取込
        </button>
        <button
          onClick={() => void exportPaymentStatusExcel(propertyName, r)}
          disabled={units.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" /> Excel出力
        </button>
      </div>

      {importing && (
        <ImportCsv
          properties={properties}
          defaultPropertyId={activeProperty}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false)
            void load()
          }}
        />
      )}

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
        <div className="overflow-auto max-h-[70vh] rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <Th>号室</Th>
                <Th>契約者名</Th>
                <Th>読み方</Th>
                <Th className="text-right">請求額</Th>
                <Th className="text-right">入金額</Th>
                <Th>入金日</Th>
                <Th className="text-right">不足額</Th>
                <Th>判定</Th>
                <Th>滞納</Th>
                <Th>備考</Th>
              </tr>
            </thead>
            <tbody>
              {groups
                ? groups.map(([pid, rows]) => (
                    <Fragment key={pid}>
                      <tr>
                        <td colSpan={10} className="bg-slate-700 px-3 py-2 text-sm font-semibold text-white">
                          {propName(pid)}
                          <span className="ml-2 text-xs font-normal text-slate-300">{rows.length}室</span>
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <PayRow
                          key={row.unit.id}
                          row={row}
                          memo={notes[row.unit.id] ?? ''}
                          onNote={saveNote}
                        />
                      ))}
                    </Fragment>
                  ))
                : r.rows.map((row) => (
                    <PayRow key={row.unit.id} row={row} memo={notes[row.unit.id] ?? ''} onNote={saveNote} />
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PayRow({
  row,
  memo,
  onNote,
}: {
  row: PaymentRow
  memo: string
  onNote: (unitId: string, memo: string) => void
}) {
  const u = row.unit
  const vacant = row.judgement === '空室'
  const shortfall = Math.max(0, row.billed - row.paid)
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{u.room}</td>
      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{u.tenant || '—'}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{u.tenant_kana || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{vacant ? '—' : yen(row.billed)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{vacant ? '—' : yen(row.paid)}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.paidDate ? formatDate(row.paidDate) : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {vacant || shortfall <= 0 ? <span className="text-slate-400">—</span> : <span className="text-rose-700">{yen(shortfall)}</span>}
      </td>
      <td className="px-3 py-2">
        <span className={'text-xs rounded-full px-2 py-0.5 ' + JUDGE_STYLE[row.judgement]}>
          {row.judgement}
        </span>
      </td>
      <td className="px-3 py-2">
        {row.arrearsMonths >= 1 && (
          <span className="text-xs rounded-full px-2 py-0.5 bg-rose-600 text-white font-medium">
            {row.arrearsMonths}ヵ月
          </span>
        )}
      </td>
      <td className="px-1.5 py-1">
        <NoteInput value={memo} onCommit={(v) => onNote(u.id, v)} />
      </td>
    </tr>
  )
}

function NoteInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white border border-slate-200 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-800 mt-0.5">{value}</div>
    </div>
  )
}

function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
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

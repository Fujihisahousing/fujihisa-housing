// 入金状況（画面）。月次。マンション帯でグループ表示。
// payment_records に記録があればそれを表示、無ければ記帳からの自動計算。備考は編集可。
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, FileSpreadsheet, Upload } from 'lucide-react'
import { ImportCsv } from './ImportCsv'
import { transactionsRepo, unitsRepo, paymentNotesRepo, paymentRecordsRepo } from '../../lib/repositories'
import { calcPaymentStatus } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { exportPaymentStatusExcel } from '../../reports/exportExcel'
import { yen, percent, formatDate } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type { PaymentRecord, Property, Transaction, Unit } from '../../types'

const JUDGE_STYLE: Record<string, string> = {
  入金済: 'bg-emerald-50 text-emerald-700',
  保証会社入金済: 'bg-teal-50 text-teal-700',
  一部入金: 'bg-amber-50 text-amber-700',
  保証会社請求中: 'bg-sky-50 text-sky-700',
  未入金: 'bg-rose-50 text-rose-700',
  空室: 'bg-slate-100 text-slate-500',
}
const judgeStyle = (j: string) => JUDGE_STYLE[j] ?? 'bg-slate-100 text-slate-600'

interface DisplayRow {
  unit: Unit
  tenant: string
  tenantType: string
  kana: string
  billed: number | null
  paid: number | null
  paidDate: string | null
  judgement: string
  guarantor: string
  memo: string
  arrears: number
  fromRecord: boolean
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
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, t, n, rec] = await Promise.all([
        activeProperty ? unitsRepo.listByProperty(activeProperty) : unitsRepo.listAll(),
        transactionsRepo.list({ propertyId: activeProperty }),
        paymentNotesRepo.mapByMonth(year, month),
        paymentRecordsRepo.list(activeProperty),
      ])
      setUnits(u)
      setTxs(t)
      setNotes(n)
      setRecords(rec)
    } finally {
      setLoading(false)
    }
  }, [activeProperty, year, month])

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

  // 記録のインデックス
  const recIndex = useMemo(() => {
    const m = new Map<string, PaymentRecord>()
    for (const rec of records) m.set(`${rec.property_id}|${rec.room}|${rec.year}|${rec.month}`, rec)
    return m
  }, [records])
  const recsByUnit = useMemo(() => {
    const m = new Map<string, PaymentRecord[]>()
    for (const rec of records) {
      const k = `${rec.property_id}|${rec.room}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(rec)
    }
    return m
  }, [records])

  const selIdx = year * 12 + (month - 1)

  // 表示行：記録があれば記録、無ければ自動計算
  const displayRows: DisplayRow[] = useMemo(() => {
    return r.rows.map((row) => {
      const u = row.unit
      const rec = recIndex.get(`${u.property_id}|${u.room}|${year}|${month}`)
      if (rec) {
        const arrears = (recsByUnit.get(`${u.property_id}|${u.room}`) ?? []).filter((x) => {
          const xi = x.year * 12 + (x.month - 1)
          const b = Number(x.billed) || 0
          const p = Number(x.paid) || 0
          return xi <= selIdx && b > 0 && p < b && x.judgement !== '空室'
        }).length
        return {
          unit: u,
          tenant: rec.tenant ?? u.tenant ?? '',
          tenantType: rec.tenant_type ?? u.tenant_type ?? '',
          kana: rec.kana ?? u.tenant_kana ?? '',
          billed: rec.billed ?? null,
          paid: rec.paid ?? null,
          paidDate: rec.paid_on ?? null,
          judgement: rec.judgement ?? '—',
          guarantor: rec.guarantor ?? u.guarantor ?? '',
          memo: rec.memo ?? '',
          arrears,
          fromRecord: true,
        }
      }
      return {
        unit: u,
        tenant: u.tenant ?? '',
        tenantType: u.tenant_type ?? '',
        kana: u.tenant_kana ?? '',
        billed: row.billed,
        paid: row.paid,
        paidDate: row.paidDate,
        judgement: row.judgement,
        guarantor: u.guarantor ?? '',
        memo: notes[u.id] ?? '',
        arrears: row.arrearsMonths,
        fromRecord: false,
      }
    })
  }, [r.rows, recIndex, recsByUnit, year, month, notes, selIdx])

  // 集計（表示行ベース）
  const summary = useMemo(() => {
    const billable = displayRows.filter((d) => d.judgement !== '空室')
    const collected = displayRows.filter((d) => d.judgement === '入金済' || d.judgement === '保証会社入金済')
    const attention = displayRows.filter((d) =>
      ['一部入金', '未入金', '保証会社請求中'].includes(d.judgement),
    )
    return {
      billed: billable.length,
      collected: collected.length,
      attention: attention.length,
      rate: billable.length ? collected.length / billable.length : 0,
    }
  }, [displayRows])

  const groups = useMemo(() => {
    if (activeProperty) return null
    const map = new Map<string, DisplayRow[]>()
    for (const d of displayRows) {
      const k = d.unit.property_id
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(d)
    }
    return Array.from(map.entries())
  }, [activeProperty, displayRows])

  const saveMemo = useCallback(
    async (row: DisplayRow, memo: string) => {
      const u = row.unit
      if (row.fromRecord) {
        setRecords((prev) =>
          prev.map((x) =>
            x.property_id === u.property_id && x.room === u.room && x.year === year && x.month === month
              ? { ...x, memo }
              : x,
          ),
        )
        try {
          await paymentRecordsRepo.setMemo(u.property_id, u.room ?? '', year, month, memo)
        } catch (e) {
          alert('備考の保存に失敗しました：' + (e instanceof Error ? e.message : ''))
        }
      } else {
        setNotes((prev) => ({ ...prev, [u.id]: memo }))
        try {
          await paymentNotesRepo.set(u.id, year, month, memo)
        } catch (e) {
          alert('備考の保存に失敗しました：' + (e instanceof Error ? e.message : ''))
        }
      }
    },
    [year, month],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i).map((y) => (
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
        <StatCard label="請求対象戸数" value={`${summary.billed}戸`} />
        <StatCard label="回収済" value={`${summary.collected}戸`} />
        <StatCard label="要対応" value={`${summary.attention}戸`} />
        <StatCard label="回収率" value={percent(summary.rate, 1)} />
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
                <Th>個人/法人</Th>
                <Th>契約者名</Th>
                <Th>読み方</Th>
                <Th className="text-right">請求額</Th>
                <Th className="text-right">入金額</Th>
                <Th>入金日</Th>
                <Th className="text-right">不足額</Th>
                <Th>判定</Th>
                <Th>保証会社</Th>
                <Th>滞納</Th>
                <Th>備考</Th>
              </tr>
            </thead>
            <tbody>
              {groups
                ? groups.map(([pid, rows]) => (
                    <Fragment key={pid}>
                      <tr>
                        <td colSpan={12} className="bg-slate-700 px-3 py-2 text-sm font-semibold text-white">
                          {propName(pid)}
                          <span className="ml-2 text-xs font-normal text-slate-300">{rows.length}室</span>
                        </td>
                      </tr>
                      {rows.map((d) => (
                        <PayRow key={d.unit.id} d={d} onMemo={saveMemo} />
                      ))}
                    </Fragment>
                  ))
                : displayRows.map((d) => <PayRow key={d.unit.id} d={d} onMemo={saveMemo} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PayRow({ d, onMemo }: { d: DisplayRow; onMemo: (d: DisplayRow, memo: string) => void }) {
  const vacant = d.judgement === '空室'
  const shortfall = Math.max(0, (Number(d.billed) || 0) - (Number(d.paid) || 0))
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{d.unit.room}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.tenantType || '—'}</td>
      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{d.tenant || '—'}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.kana || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{vacant || d.billed == null ? '—' : yen(d.billed)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{vacant || d.paid == null ? '—' : yen(d.paid)}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.paidDate ? formatDate(d.paidDate) : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {vacant || shortfall <= 0 ? <span className="text-slate-400">—</span> : <span className="text-rose-700">{yen(shortfall)}</span>}
      </td>
      <td className="px-3 py-2">
        <span className={'text-xs rounded-full px-2 py-0.5 ' + judgeStyle(d.judgement)}>{d.judgement}</span>
      </td>
      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{d.guarantor || '—'}</td>
      <td className="px-3 py-2">
        {d.arrears >= 1 && (
          <span className="text-xs rounded-full px-2 py-0.5 bg-rose-600 text-white font-medium">{d.arrears}ヵ月</span>
        )}
      </td>
      <td className="px-1.5 py-1">
        <NoteInput value={d.memo} onCommit={(v) => onMemo(d, v)} />
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

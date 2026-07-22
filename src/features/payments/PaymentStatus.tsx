// 入金状況（画面）。月次。マンション帯でグループ表示。
// payment_records に記録があればそれを表示、無ければ記帳からの自動計算。備考は編集可。
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, FileSpreadsheet, Upload, ListChecks } from 'lucide-react'
import { ImportCsv } from './ImportCsv'
import { transactionsRepo, unitsRepo, paymentNotesRepo, paymentRecordsRepo, rentHistoryRepo, arrearsNotesRepo } from '../../lib/repositories'
import { calcPaymentStatus, calcArrearsList, deriveJudgement, type ArrearsUnitRow } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { exportPaymentStatusExcel } from '../../reports/exportExcel'
import { yen, percent, formatDate, today } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import { PAYMENT_JUDGEMENTS } from '../../types'
import type { ArrearsNote, PaymentRecord, Property, RentHistory, Transaction, Unit } from '../../types'

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
  calcBilled: number // 実効家賃ベースの請求額（記録のbilledがnullでも常に埋まる。手入力の判定計算に使う）
  paid: number | null
  paidDate: string | null
  judgement: string
  guarantor: string
  memo: string
  arrears: number
  /** 滞納月数が手入力値か（true なら自動計算を上書きしている） */
  arrearsManual: boolean
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
  const [rentHistory, setRentHistory] = useState<RentHistory[]>([])
  const [arrearsNotes, setArrearsNotes] = useState<ArrearsNote[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [mode, setMode] = useState<'monthly' | 'arrears'>('monthly')

  // 表示上限＝翌月（前家賃の記入分まで）。それ以降の未来月は選べない。月が進めば自動で解放。
  const capDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const capYear = capDate.getFullYear()
  const capMonth = capDate.getMonth() + 1
  const monthMax = year < capYear ? 12 : capMonth

  // 上限を超える年月が選ばれたらクランプ
  useEffect(() => {
    if (year > capYear) {
      setYear(capYear)
      return
    }
    const mMax = year < capYear ? 12 : capMonth
    if (month > mMax) setMonth(mMax)
  }, [year, month, capYear, capMonth])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const u = await (activeProperty ? unitsRepo.listByProperty(activeProperty) : unitsRepo.listAll())
      const [t, n, rec, rh, an] = await Promise.all([
        transactionsRepo.list({ propertyId: activeProperty }),
        paymentNotesRepo.mapByMonth(year, month),
        paymentRecordsRepo.list(activeProperty),
        rentHistoryRepo.listByUnitIds(u.map((x) => x.id)),
        arrearsNotesRepo.listByUnitIds(u.map((x) => x.id)),
      ])
      setUnits(u)
      setTxs(t)
      setNotes(n)
      setRecords(rec)
      setRentHistory(rh)
      setArrearsNotes(an)
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

  const rentHistoryByUnit = useMemo(() => {
    const m = new Map<string, RentHistory[]>()
    for (const h of rentHistory) {
      if (!m.has(h.unit_id)) m.set(h.unit_id, [])
      m.get(h.unit_id)!.push(h)
    }
    return m
  }, [rentHistory])

  const r = useMemo(
    () => calcPaymentStatus(sortedUnits, txs, year, month, rentHistoryByUnit),
    [sortedUnits, txs, year, month, rentHistoryByUnit],
  )

  // 未入金一覧（選択月まで）
  const arrears = useMemo(
    () => calcArrearsList(sortedUnits, records, txs, year, month, rentHistoryByUnit),
    [sortedUnits, records, txs, year, month, rentHistoryByUnit],
  )
  const arrearsNoteMap = useMemo(() => {
    const m = new Map<string, ArrearsNote>()
    for (const a of arrearsNotes) m.set(a.unit_id, a)
    return m
  }, [arrearsNotes])

  const saveArrearsNote = useCallback(async (unitId: string, patch: Partial<ArrearsNote>) => {
    setArrearsNotes((prev) => {
      const idx = prev.findIndex((a) => a.unit_id === unitId)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], ...patch }
        return next
      }
      return [...prev, { unit_id: unitId, ...patch }]
    })
    try {
      await arrearsNotesRepo.upsert(unitId, patch)
    } catch (e) {
      alert('保存に失敗しました：' + (e instanceof Error ? e.message : ''))
    }
  }, [])

  // 記録のインデックス
  const recIndex = useMemo(() => {
    const m = new Map<string, PaymentRecord>()
    for (const rec of records) m.set(`${rec.property_id}|${rec.room}|${rec.year}|${rec.month}`, rec)
    return m
  }, [records])
  // 滞納月数は未入金一覧と同じ計算（calcArrearsList）を使い、両画面で必ず一致させる。
  // 手入力の上書きも calcArrearsList の中で効くので、ここでは分岐しない。
  const arrearsByUnit = useMemo(() => {
    const m = new Map<string, { months: number; manual: boolean }>()
    for (const a of arrears) m.set(a.unit.id, { months: a.monthsCount, manual: a.manualMonths })
    return m
  }, [arrears])

  // 表示行：記録があれば記録、無ければ自動計算
  const displayRows: DisplayRow[] = useMemo(() => {
    return r.rows.map((row) => {
      const u = row.unit
      const rec = recIndex.get(`${u.property_id}|${u.room}|${year}|${month}`)
      const arr = arrearsByUnit.get(u.id)
      // 手入力があればそれが正（0を入れた月は一覧から外れるので arrearsByUnit には載らない）
      const manualArrears = rec?.arrears_months
      const arrearsMonths = manualArrears ?? arr?.months ?? 0
      const arrearsIsManual = manualArrears != null
      if (rec) {
        // 記録がある月は、その時点の値だけを使う（物件情報には一切フォールバックしない）。
        // → 物件情報の契約者名を変更しても過去の表示は変わらない。
        // ただし読み方(kana)だけは例外：記録に読み方が入っておらず、かつ契約者名が
        // 物件情報の現在値と一致する場合に限り、物件情報の読み方を補完する。
        // 契約者名が一致しない（＝過去の入居者の記録）場合は補完しない。
        // これは「読み方の入力が漏れているだけ」のケースを、部屋詳細から救うためのもの。
        const kana = rec.kana || (rec.tenant && rec.tenant === u.tenant ? u.tenant_kana : null) || ''
        return {
          unit: u,
          tenant: rec.tenant ?? '',
          tenantType: rec.tenant_type ?? '',
          kana,
          billed: rec.billed ?? null,
          calcBilled: row.billed,
          paid: rec.paid ?? null,
          paidDate: rec.paid_on ?? null,
          judgement: rec.judgement ?? '—',
          guarantor: rec.guarantor ?? '',
          memo: rec.memo ?? '',
          arrears: arrearsMonths,
          arrearsManual: arrearsIsManual,
          fromRecord: true,
        }
      }
      return {
        unit: u,
        tenant: u.tenant ?? '',
        tenantType: u.tenant_type ?? '',
        kana: u.tenant_kana ?? '',
        billed: row.billed,
        calcBilled: row.billed,
        paid: row.paid,
        paidDate: row.paidDate,
        judgement: row.judgement,
        guarantor: u.guarantor ?? '',
        memo: notes[u.id] ?? '',
        arrears: arrearsMonths,
        arrearsManual: arrearsIsManual,
        fromRecord: false,
      }
    })
  }, [r.rows, recIndex, arrearsByUnit, year, month, notes])

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

  // 手入力の保存に使う payment_records の下地。記録の無い月でも新規作成できるようにする。
  const baseRecord = useCallback(
    (row: DisplayRow): PaymentRecord => {
      const u = row.unit
      return {
        property_id: u.property_id,
        room: u.room ?? '',
        year,
        month,
        tenant: row.tenant || u.tenant || null,
        tenant_type: row.tenantType || u.tenant_type || null,
        kana: row.kana || u.tenant_kana || null,
        billed: row.billed != null ? Number(row.billed) : row.calcBilled,
        paid: row.paid != null ? Number(row.paid) : 0,
        paid_on: row.paidDate ?? null,
        judgement: row.judgement,
        guarantor: row.guarantor || u.guarantor || null,
        memo: row.memo || null,
        arrears_months: row.arrearsManual ? row.arrears : null,
      }
    },
    [year, month],
  )

  // 判定の手入力：その月の状態を確定させる。
  // 空室を選んだ月は請求も入金も無かった月として扱う（契約者名・請求額・入金額をクリア）。
  const saveJudgement = useCallback(
    async (row: DisplayRow, judgement: string) => {
      const rec = baseRecord(row)
      rec.judgement = judgement
      if (judgement === '空室') {
        rec.tenant = null
        rec.kana = null
        rec.guarantor = null
        rec.billed = 0
        rec.paid = 0
        rec.paid_on = null
        rec.arrears_months = null
      }
      try {
        await paymentRecordsRepo.upsert(rec)
        await load() // 月次・未入金一覧の両方に反映
      } catch (e) {
        alert('判定の保存に失敗しました：' + (e instanceof Error ? e.message : ''))
      }
    },
    [baseRecord, load],
  )

  // 滞納月数の手入力：空欄にすると自動計算に戻す
  const saveArrears = useCallback(
    async (row: DisplayRow, value: string) => {
      const s = value.trim()
      const n = s === '' ? null : Number(s)
      if (n != null && (!Number.isFinite(n) || n < 0)) return
      const rec = baseRecord(row)
      rec.arrears_months = n
      try {
        await paymentRecordsRepo.upsert(rec)
        await load()
      } catch (e) {
        alert('滞納月数の保存に失敗しました：' + (e instanceof Error ? e.message : ''))
      }
    },
    [baseRecord, load],
  )

  // 入金額の手入力：payment_records を作成/更新し、判定は請求額との比較で自動導出する
  const savePaid = useCallback(
    async (row: DisplayRow, paidStr: string) => {
      const u = row.unit
      const paid = paidStr.trim() === '' ? 0 : Number(paidStr)
      if (!Number.isFinite(paid)) return
      const billed = row.billed != null ? Number(row.billed) : row.calcBilled
      const occupied = u.status === '入居' || u.status === '退予'
      // 判定は金額のみで導出（既存の手入力データと同じく保証会社の有無で分けない）
      const judgement = deriveJudgement(occupied, billed, paid, false)
      const rec: PaymentRecord = {
        ...baseRecord(row), // 手入力済みの滞納月数などを引き継ぐ
        billed,
        paid,
        paid_on: paid > 0 ? today() : null,
        judgement,
      }
      try {
        await paymentRecordsRepo.upsert(rec)
        await load() // 月次・未入金一覧の両方を更新
      } catch (e) {
        alert('入金額の保存に失敗しました：' + (e instanceof Error ? e.message : ''))
      }
    },
    [baseRecord, load],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {Array.from({ length: capYear - (now.getFullYear() - 4) + 1 }, (_, i) => now.getFullYear() - 4 + i).map(
            (y) => (
              <option key={y} value={y}>
                {y}年
              </option>
            ),
          )}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {Array.from({ length: monthMax }, (_, i) => i + 1).map((m) => (
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
          onClick={() => setMode((m) => (m === 'arrears' ? 'monthly' : 'arrears'))}
          className={
            'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ' +
            (mode === 'arrears'
              ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
          }
        >
          <ListChecks className="w-4 h-4" /> 未入金一覧
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

      {mode === 'arrears' ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatCard label="未入金の号室" value={`${arrears.length}戸`} />
          <StatCard label="合計滞納額" value={yen(arrears.reduce((s, a) => s + a.total, 0))} />
          <StatCard label="保証会社入金予定" value={yen(arrearsNotes.reduce((s, a) => s + (Number(a.expected_from_guarantor) || 0), 0))} />
          <StatCard label="報告済" value={`${arrearsNotes.filter((a) => a.reported).length}戸`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatCard label="請求対象戸数" value={`${summary.billed}戸`} />
          <StatCard label="回収済" value={`${summary.collected}戸`} />
          <StatCard label="要対応" value={`${summary.attention}戸`} />
          <StatCard label="回収率" value={percent(summary.rate, 1)} />
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : units.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">部屋が登録されていません。</div>
      ) : mode === 'arrears' ? (
        <ArrearsTable
          arrears={arrears}
          noteMap={arrearsNoteMap}
          onSave={saveArrearsNote}
          groupHeader={activeProperty ? null : propName}
          year={year}
          month={month}
        />
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
                        <PayRow
                          key={d.unit.id}
                          d={d}
                          onMemo={saveMemo}
                          onPaid={savePaid}
                          onJudgement={saveJudgement}
                          onArrears={saveArrears}
                        />
                      ))}
                    </Fragment>
                  ))
                : displayRows.map((d) => <PayRow
                          key={d.unit.id}
                          d={d}
                          onMemo={saveMemo}
                          onPaid={savePaid}
                          onJudgement={saveJudgement}
                          onArrears={saveArrears}
                        />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------- 未入金一覧 ----------------------
function ArrearsTable({
  arrears,
  noteMap,
  onSave,
  groupHeader,
  year,
  month,
}: {
  arrears: ArrearsUnitRow[]
  noteMap: Map<string, ArrearsNote>
  onSave: (unitId: string, patch: Partial<ArrearsNote>) => void
  groupHeader: ((id?: string | null) => string) | null
  year: number
  month: number
}) {
  if (arrears.length === 0) {
    return (
      <div className="text-center text-emerald-600 text-sm py-12">
        {year}年{month}月時点で未入金の号室はありません。
      </div>
    )
  }
  // 全体表示のときは物件ごとに区切る
  const groups = groupHeader
    ? Array.from(
        arrears.reduce((m, a) => {
          const k = a.unit.property_id
          if (!m.has(k)) m.set(k, [])
          m.get(k)!.push(a)
          return m
        }, new Map<string, ArrearsUnitRow[]>()),
      )
    : null

  return (
    <div className="overflow-auto max-h-[70vh] rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <Th>号室</Th>
            <Th>契約者名</Th>
            <Th>滞納している月・金額</Th>
            <Th className="text-right">滞納月数</Th>
            <Th className="text-right">合計滞納額</Th>
            <Th>保証会社</Th>
            <Th className="text-right">保証会社入金予定額</Th>
            <Th>報告済</Th>
            <Th>備考</Th>
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map(([pid, rows]) => (
                <Fragment key={pid}>
                  <tr>
                    <td colSpan={9} className="bg-slate-700 px-3 py-2 text-sm font-semibold text-white">
                      {groupHeader!(pid)}
                      <span className="ml-2 text-xs font-normal text-slate-300">{rows.length}室</span>
                    </td>
                  </tr>
                  {rows.map((a) => (
                    <ArrearsRow key={a.unit.id} a={a} note={noteMap.get(a.unit.id)} onSave={onSave} />
                  ))}
                </Fragment>
              ))
            : arrears.map((a) => (
                <ArrearsRow key={a.unit.id} a={a} note={noteMap.get(a.unit.id)} onSave={onSave} />
              ))}
        </tbody>
      </table>
    </div>
  )
}

function ArrearsRow({
  a,
  note,
  onSave,
}: {
  a: ArrearsUnitRow
  note?: ArrearsNote
  onSave: (unitId: string, patch: Partial<ArrearsNote>) => void
}) {
  return (
    <tr className="border-b border-slate-100 last:border-0 align-top">
      <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{a.unit.room}</td>
      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{a.tenant || '—'}</td>
      <td className="px-3 py-2">
        <div className="space-y-0.5">
          {a.months.map((m) => (
            <div key={`${m.year}-${m.month}`} className="flex gap-2 whitespace-nowrap">
              <span className="text-slate-500 w-24">
                {m.year}年{m.month}月分
              </span>
              <span className="tabular-nums text-rose-700">{yen(m.shortfall)}</span>
            </div>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
        {a.monthsCount >= 2 ? (
          <span className="text-rose-700 font-semibold">{a.monthsCount}ヵ月</span>
        ) : (
          `${a.monthsCount}ヵ月`
        )}
        {/* 月次画面で手入力された値であることを示す */}
        {a.manualMonths && (
          <span className="ml-1 text-[10px] text-slate-400" title="入金状況の月次画面で手入力された値">
            手入力
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-700 whitespace-nowrap">
        {yen(a.total)}
      </td>
      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{a.guarantor || '—'}</td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          defaultValue={note?.expected_from_guarantor != null ? String(note.expected_from_guarantor) : ''}
          onBlur={(e) => {
            const v = e.target.value.trim()
            const num = v === '' ? null : Number(v)
            const cur = note?.expected_from_guarantor ?? null
            if (num !== cur) onSave(a.unit.id, { expected_from_guarantor: num })
          }}
          placeholder="0"
          className="w-28 rounded border border-slate-200 px-2 py-1 text-right tabular-nums focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={Boolean(note?.reported)}
          onChange={(e) => onSave(a.unit.id, { reported: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 accent-slate-900"
        />
      </td>
      <td className="px-1.5 py-1">
        <NoteInput value={note?.memo ?? ''} onCommit={(v) => onSave(a.unit.id, { memo: v || null })} />
      </td>
    </tr>
  )
}

export function PayRow({
  d,
  onMemo,
  onPaid,
  onJudgement,
  onArrears,
}: {
  d: DisplayRow
  onMemo: (d: DisplayRow, memo: string) => void
  onPaid: (d: DisplayRow, paid: string) => void
  onJudgement: (d: DisplayRow, judgement: string) => void
  onArrears: (d: DisplayRow, months: string) => void
}) {
  const vacant = d.judgement === '空室'
  const billedShown = d.billed != null ? Number(d.billed) : d.calcBilled // 記録のbilledが空なら実効家賃を表示
  const shortfall = Math.max(0, billedShown - (Number(d.paid) || 0))
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{d.unit.room}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.tenantType || '—'}</td>
      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{d.tenant || '—'}</td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.kana || '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{vacant ? '—' : yen(billedShown)}</td>
      <td className="px-2 py-1 text-right">
        {vacant ? (
          <span className="text-slate-400">—</span>
        ) : (
          <input
            type="number"
            defaultValue={d.paid != null ? String(d.paid) : ''}
            onBlur={(e) => {
              const v = e.target.value.trim()
              const cur = d.paid != null ? String(d.paid) : ''
              if (v !== cur) onPaid(d, v)
            }}
            placeholder="0"
            title="入金額を入力（0円で未入金・満額で入金済に自動判定）"
            className="w-24 rounded border border-transparent bg-transparent px-2 py-1 text-right tabular-nums hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        )}
      </td>
      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.paidDate ? formatDate(d.paidDate) : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {vacant || shortfall <= 0 ? <span className="text-slate-400">—</span> : <span className="text-rose-700">{yen(shortfall)}</span>}
      </td>
      <td className="px-2 py-1">
        {/* 判定はプルダウンで確定できる。空室を選ぶとその月は請求も入金も無かった扱いになる */}
        <select
          value={d.judgement}
          onChange={(e) => onJudgement(d, e.target.value)}
          title="判定を選ぶとその月の状態が確定します（空室を選ぶと契約者名・請求額・入金額をクリア）"
          className={
            'text-xs rounded-full px-2 py-1 border border-transparent hover:border-slate-300 ' +
            'focus:border-slate-900 focus:outline-none ' +
            judgeStyle(d.judgement)
          }
        >
          {!PAYMENT_JUDGEMENTS.includes(d.judgement as (typeof PAYMENT_JUDGEMENTS)[number]) && (
            <option value={d.judgement}>{d.judgement}</option>
          )}
          {PAYMENT_JUDGEMENTS.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{d.guarantor || '—'}</td>
      <td className="px-2 py-1 text-right">
        {/* 空欄にすると自動計算に戻る。手入力中は色を変えて区別する */}
        <input
          type="number"
          min={0}
          defaultValue={d.arrears ? String(d.arrears) : ''}
          onBlur={(e) => {
            const v = e.target.value.trim()
            const cur = d.arrearsManual && d.arrears ? String(d.arrears) : ''
            if (v !== cur) onArrears(d, v)
          }}
          placeholder="自動"
          title="滞納月数を手入力（空欄にすると自動計算に戻ります）"
          className={
            'w-16 rounded border border-transparent bg-transparent px-2 py-1 text-right tabular-nums ' +
            'hover:border-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 ' +
            (d.arrears >= 1 ? 'font-medium text-rose-700' : 'text-slate-500')
          }
        />
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

// 通帳取込で入れた記帳の内訳を、月を指定して計算し直す。
//
// 水道代の請求書より先に通帳を取り込むことがある。そのときは水道代が0で取り込まれ、
// 残りが不明金（または賃料）に寄ってしまう。あとから請求書を取り込んでからここを通せば、
// その月の入金を集め直して 家賃／共益費／駐車駐輪／水道代／不明金 に振り分け直せる。
//
// 過去ぶんまで一度に作り直すと収拾がつかなくなるので、対象は必ず「1物件 × 1か月」に絞る。
// 手で直した記帳（method='通帳取込・手修正'）は対象から外し、せっかく直したものが
// 自動で戻る事故を防いでいる。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { paymentRecordsRepo, transactionsRepo, unitsRepo } from '../../lib/repositories'
import { attributionMonth } from '../../lib/calc'
import { splitOne, waterMapOf } from '../../lib/depositBreakdown'
import { CAT_RENT, CAT_KYOEKI, CAT_PARKING, CAT_UTILITY, type Property, type Transaction, type Unit } from '../../types'
import { syncPaymentRecordsFromLedger } from '../../lib/syncLedger'
import { BreakdownTable, type BreakdownRow } from './BreakdownTable'
import { METHOD_IMPORT, METHOD_IMPORT_EDITED, UNKNOWN_TAG } from './ImportCsv'
import { yen } from '../../lib/format'

const pad = (n: number) => String(n).padStart(2, '0')
const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

/** 直近24か月ぶんの選択肢（新しい順） */
function recentMonths(count = 24): string[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ymOf(new Date(now.getFullYear(), now.getMonth() - i, 1)))
}

export function RecalcMonth({
  properties,
  defaultPropertyId,
  onDone,
}: {
  properties: Property[]
  defaultPropertyId: string | null
  onDone: () => void
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '')
  const [ym, setYm] = useState(recentMonths(1)[0])
  const [units, setUnits] = useState<Unit[]>([])
  const [targets, setTargets] = useState<Transaction[]>([])
  const [rows, setRows] = useState<BreakdownRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState(0)

  useEffect(() => {
    setPropertyId(defaultPropertyId ?? properties[0]?.id ?? '')
  }, [defaultPropertyId, properties])

  // 物件を変えたら組み立て直す
  useEffect(() => {
    setRows([])
    setTargets([])
    setError(null)
  }, [propertyId, ym])

  const unitsById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])

  const load = useCallback(async () => {
    if (!propertyId) return setError('物件を選択してください。')
    setError(null)
    setLoading(true)
    try {
      const [us, recs, txs] = await Promise.all([
        unitsRepo.listByProperty(propertyId),
        paymentRecordsRepo.list(propertyId),
        // 前家賃で翌月に寄る入金があるので、前後1か月を広めに取ってから帰属月で絞る
        transactionsRepo.list({ propertyId }),
      ])
      setUnits(us)

      const byId = new Map(us.map((u) => [u.id, u]))
      const wm = waterMapOf(recs)
      // 対象＝通帳取込のまま（手修正していない）で、帰属月が選んだ月の記帳
      const inMonth = txs.filter((t) => {
        if (t.type !== 'income' || !t.unit_id || t.deleted_at) return false
        if (t.method !== METHOD_IMPORT) return false
        const a = attributionMonth(t.date)
        return `${a.year}-${pad(a.month)}` === ym
      })
      const edited = txs.filter((t) => {
        if (t.type !== 'income' || !t.unit_id || t.deleted_at) return false
        if (t.method !== METHOD_IMPORT_EDITED) return false
        const a = attributionMonth(t.date)
        return `${a.year}-${pad(a.month)}` === ym
      })
      setSkipped(new Set(edited.map((t) => t.unit_id)).size)
      setTargets(inMonth)

      // 号室ごとに、その月に入った通帳ぶんを合計してから振り分け直す。
      // 家賃と水道代が別々の振込で届いても、まとめてから分けるので正しく分かれる。
      const byUnit = new Map<string, Transaction[]>()
      for (const t of inMonth) {
        const k = t.unit_id!
        if (!byUnit.has(k)) byUnit.set(k, [])
        byUnit.get(k)!.push(t)
      }
      const [y, m] = ym.split('-').map(Number)
      const out: BreakdownRow[] = []
      for (const [unitId, list] of byUnit) {
        const u = byId.get(unitId)
        if (!u) continue
        const total = list.reduce((s, t) => s + Number(t.amount ?? 0), 0)
        const date = list.reduce((mx, t) => (t.date > mx ? t.date : mx), list[0].date)
        const water = wm.get(`${u.room}|${y}-${pad(m)}`) ?? 0
        const sp = splitOne(u, total, water)
        out.push({
          key: unitId,
          date,
          ym,
          unitId,
          room: u.room ?? '',
          tenant: u.tenant ?? '',
          amount: total,
          rent: sp.rent,
          kyoeki: sp.kyoeki,
          parking: sp.parking,
          water: sp.water,
          unknown: sp.unknown,
          edited: false,
          memo: list[0].memo ?? '通帳取込',
          waterExpected: water > 0 ? water : null,
        })
      }
      out.sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }))
      setRows(out)
      if (out.length === 0) setError('この月に通帳取込の記帳がありません。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [propertyId, ym])

  async function save() {
    setError(null)
    const tx: Partial<Transaction>[] = []
    for (const r of rows) {
      const u = unitsById.get(r.unitId)
      if (!u) continue
      const base = {
        date: r.date,
        property_id: u.property_id,
        unit_id: u.id,
        type: 'income' as const,
        method: r.edited ? METHOD_IMPORT_EDITED : METHOD_IMPORT,
        memo: r.memo,
      }
      if (r.rent > 0) tx.push({ ...base, category: CAT_RENT, amount: r.rent })
      if (r.kyoeki > 0) tx.push({ ...base, category: CAT_KYOEKI, amount: r.kyoeki })
      if (r.parking > 0) tx.push({ ...base, category: CAT_PARKING, amount: r.parking })
      if (r.water > 0) tx.push({ ...base, category: CAT_UTILITY, amount: r.water })
      if (r.unknown > 0)
        tx.push({ ...base, category: 'その他', amount: r.unknown, memo: `${r.memo} ${UNKNOWN_TAG}` })
    }
    setSaving(true)
    try {
      // 先に入れてから消すと二重に見える瞬間があるので、古いほうを先に落とす
      for (const t of targets) await transactionsRepo.remove(t.id)
      const made = await transactionsRepo.createMany(tx)
      await syncPaymentRecordsFromLedger([...targets, ...made])
      setRows([])
      setTargets([])
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  const total = rows.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h4 className="font-bold text-slate-800">あとから内訳を計算し直す</h4>
        <p className="mt-1 text-xs text-slate-600">
          水道代の請求書より先に通帳を取り込んだときに使います。請求書を取り込んでからこの月を
          計算し直すと、賃料や不明金に寄っていた分が水道代に振り替わります。
          <b>手で直した記帳は対象から外れます。</b>
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">物件</label>
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">選択してください</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">何月分</label>
          <select
            value={ym}
            onChange={(e) => setYm(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
          >
            {recentMonths().map((v) => (
              <option key={v} value={v}>
                {v.replace('-', '年')}月分
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || !propertyId}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          この月を計算し直す
        </button>
        {rows.length > 0 && (
          <span className="text-xs text-slate-500">
            {rows.length}室・入金合計 {yen(total)}
            {skipped > 0 && `／手修正ぶん ${skipped}室は対象外`}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      {rows.length > 0 && (
        <BreakdownTable
          rows={rows}
          setRows={setRows}
          onSave={() => void save()}
          saving={saving}
          saveLabel={`${rows.length}室ぶんを入れ直す`}
          note={'保存すると、この月の通帳取込の記帳を消してから入れ直します。入金額の合計は変わりません。'}
        />
      )}
    </div>
  )
}

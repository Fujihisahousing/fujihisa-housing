// 部屋ごとの入力。物件→号室を選び、賃料・敷金・礼金をまとめて記帳する。
// 「まとめ入金」モードでは、入居者からの合算振込を契約内訳（賃料・共益費・光熱費）に自動で振り分ける。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { transactionsRepo, unitsRepo } from '../../lib/repositories'
import { today } from '../../lib/format'
import { yen } from '../../lib/format'
import { CAT_RENT, CAT_KYOEKI, CAT_UTILITY } from '../../types'
import type { Property, Transaction, Unit } from '../../types'

type Mode = 'individual' | 'lump'
const n = (s: string) => {
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

export function RoomEntry({
  properties,
  defaultPropertyId,
  onSaved,
}: {
  properties: Property[]
  defaultPropertyId: string | null
  onSaved: () => void
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '')
  const [unitId, setUnitId] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('')
  const [mode, setMode] = useState<Mode>('individual')

  // 個別入力
  const [rent, setRent] = useState('')
  const [deposit, setDeposit] = useState('')
  const [keyMoney, setKeyMoney] = useState('')
  const [water, setWater] = useState('')
  const [electricity, setElectricity] = useState('')
  const [other, setOther] = useState('')
  // まとめ入金
  const [lump, setLump] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // activeProperty 変更に追従
  useEffect(() => {
    setPropertyId(defaultPropertyId ?? properties[0]?.id ?? '')
  }, [defaultPropertyId, properties])

  // 物件に応じた号室を取得
  useEffect(() => {
    setUnitId('')
    if (!propertyId) return setUnits([])
    let active = true
    unitsRepo
      .listByProperty(propertyId)
      .then((u) => active && setUnits(u))
      .catch(() => active && setUnits([]))
    return () => {
      active = false
    }
  }, [propertyId])

  const unit = useMemo(() => units.find((u) => u.id === unitId) ?? null, [units, unitId])
  const contractRent = Number(unit?.rent ?? 0) || 0
  const contractKyoeki = Number(unit?.kyoeki ?? 0) || 0

  // 号室を選んだら、個別入力の賃料に契約額（賃料＋共益費）を初期表示
  useEffect(() => {
    if (unit) setRent(String(contractRent + contractKyoeki || ''))
    else setRent('')
    setDeposit('')
    setKeyMoney('')
    setWater('')
    setElectricity('')
    setOther('')
    setLump('')
    setError(null)
  }, [unitId]) // eslint-disable-line react-hooks/exhaustive-deps

  // まとめ入金の振り分けプレビュー（賃料→共益費→光熱費 の順に充当）
  const split = useMemo(() => {
    const total = n(lump)
    const rentPart = Math.min(total, contractRent)
    const afterRent = Math.max(0, total - rentPart)
    const kyoekiPart = Math.min(afterRent, contractKyoeki)
    const utilityPart = Math.max(0, afterRent - kyoekiPart)
    return { total, rentPart, kyoekiPart, utilityPart }
  }, [lump, contractRent, contractKyoeki])

  async function save() {
    setError(null)
    if (!propertyId) return setError('物件を選択してください。')
    if (!unitId) return setError('号室を選択してください。')

    const base = {
      date,
      property_id: propertyId,
      unit_id: unitId,
      type: 'income' as const,
      method: method || null,
    }
    let rows: Partial<Transaction>[] = []

    if (mode === 'individual') {
      if (n(rent) > 0) rows.push({ ...base, category: CAT_RENT, amount: n(rent) })
      if (n(deposit) > 0) rows.push({ ...base, category: '敷金', amount: n(deposit) })
      if (n(keyMoney) > 0) rows.push({ ...base, category: '礼金', amount: n(keyMoney) })
      if (n(water) > 0) rows.push({ ...base, category: '水道代', amount: n(water) })
      if (n(electricity) > 0) rows.push({ ...base, category: '電気代', amount: n(electricity) })
      if (n(other) > 0) rows.push({ ...base, category: 'その他', amount: n(other) })
      if (rows.length === 0) return setError('金額を1つ以上入力してください。')
    } else {
      if (split.total <= 0) return setError('入金額を入力してください。')
      const memo = 'まとめ入金 自動振り分け'
      if (split.rentPart > 0) rows.push({ ...base, category: CAT_RENT, amount: split.rentPart, memo })
      if (split.kyoekiPart > 0) rows.push({ ...base, category: CAT_KYOEKI, amount: split.kyoekiPart, memo })
      if (split.utilityPart > 0) rows.push({ ...base, category: CAT_UTILITY, amount: split.utilityPart, memo })
    }

    setSaving(true)
    try {
      await transactionsRepo.createMany(rows)
      // 入力欄をリセット（物件・号室・日付は残す）
      setDeposit('')
      setKeyMoney('')
      setWater('')
      setElectricity('')
      setOther('')
      setLump('')
      if (mode === 'lump') setRent(String(contractRent + contractKyoeki || ''))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="物件">
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">選択してください</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="号室">
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!propertyId || units.length === 0}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">選択してください</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.room}
                {u.layout ? `（${u.layout}）` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* モード切替 */}
      <div className="flex rounded-xl bg-slate-100 p-1 text-sm">
        {(['individual', 'lump'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              'flex-1 rounded-lg py-2 font-medium transition-colors ' +
              (mode === m ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')
            }
          >
            {m === 'individual' ? '個別入力' : 'まとめ入金（自動振り分け）'}
          </button>
        ))}
      </div>

      {mode === 'individual' ? (
        <div className="space-y-3">
          <Field label="賃料（共益費込み）">
            <MoneyInput value={rent} onChange={setRent} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="敷金">
              <MoneyInput value={deposit} onChange={setDeposit} />
            </Field>
            <Field label="礼金">
              <MoneyInput value={keyMoney} onChange={setKeyMoney} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="水道代">
              <MoneyInput value={water} onChange={setWater} />
            </Field>
            <Field label="電気代">
              <MoneyInput value={electricity} onChange={setElectricity} />
            </Field>
          </div>
          <Field label="その他">
            <MoneyInput value={other} onChange={setOther} />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="入金額（合算振込）">
            <MoneyInput value={lump} onChange={setLump} />
          </Field>
          {unit && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="text-xs text-slate-500 mb-2">
                契約内訳：賃料 {yen(contractRent)}／共益費 {yen(contractKyoeki)}
              </div>
              <SplitLine label="賃料" value={split.rentPart} />
              <SplitLine label="共益費" value={split.kyoekiPart} />
              <SplitLine label="光熱費（差額）" value={split.utilityPart} />
              <div className="mt-2 pt-2 border-t border-slate-200 flex justify-between font-semibold">
                <span>計</span>
                <span className="tabular-nums">{yen(split.total)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="日付">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Field>
        <Field label="支払方法（任意）">
          <input
            type="text"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="振込 / 現金 / 保証会社 など"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Field>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
      )}

      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-slate-900 text-white py-3 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? '保存中…' : '記帳する'}
      </button>
    </div>
  )
}

function SplitLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-0.5 text-slate-700">
      <span>{label}</span>
      <span className="tabular-nums">{value > 0 ? yen(value) : '—'}</span>
    </div>
  )
}

function MoneyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="0"
      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-right text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
    />
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

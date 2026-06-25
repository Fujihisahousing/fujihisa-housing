// 入力シート（金額・物件・部屋・日付・メモ → 記帳）。transactions に追加する。
import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from '../common/Modal'
import { transactionsRepo, unitsRepo } from '../../lib/repositories'
import { today } from '../../lib/format'
import type { Property, TxType, Unit } from '../../types'

export interface EntryTarget {
  type: TxType
  category: string
}

export function EntrySheet({
  target,
  properties,
  defaultPropertyId,
  onClose,
  onSaved,
}: {
  target: EntryTarget | null
  properties: Property[]
  defaultPropertyId: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('')
  const [memo, setMemo] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // シートを開くたびに初期化
  useEffect(() => {
    if (!target) return
    setAmount('')
    setPropertyId(defaultPropertyId ?? properties[0]?.id ?? '')
    setUnitId('')
    setDate(today())
    setMethod('')
    setMemo('')
    setError(null)
  }, [target, defaultPropertyId, properties])

  // 物件に応じた部屋を取得
  useEffect(() => {
    if (!propertyId) {
      setUnits([])
      return
    }
    let active = true
    unitsRepo
      .listByProperty(propertyId)
      .then((u) => active && setUnits(u))
      .catch(() => active && setUnits([]))
    return () => {
      active = false
    }
  }, [propertyId])

  async function save() {
    setError(null)
    const amt = Number(amount)
    if (!target) return
    if (!propertyId) return setError('物件を選択してください。')
    if (!Number.isFinite(amt) || amt <= 0) return setError('金額を正しく入力してください。')

    setSaving(true)
    try {
      await transactionsRepo.create({
        date,
        property_id: propertyId,
        unit_id: unitId || null,
        type: target.type,
        category: target.category,
        amount: amt,
        method: method || null,
        memo: memo || null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      title={target ? `${target.type === 'income' ? '収入' : '支出'}：${target.category}` : ''}
      onClose={onClose}
      footer={
        <button
          onClick={() => void save()}
          disabled={saving}
          className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? '保存中…' : '記帳する'}
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="金額（円）">
          <input
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-right text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Field>

        <Field label="物件">
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value)
              setUnitId('')
            }}
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

        <Field label="部屋（任意）">
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!propertyId || units.length === 0}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">指定なし（物件全体）</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.room}
                {u.layout ? `（${u.layout}）` : ''}
              </option>
            ))}
          </select>
        </Field>

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

        <Field label="メモ（任意）">
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Field>

        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
        )}
      </div>
    </Modal>
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

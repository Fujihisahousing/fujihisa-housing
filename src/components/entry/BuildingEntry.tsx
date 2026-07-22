// 建物まとめ入力。物件を選び、建物単位の収入（看板・KDDI・タイムズ）と
// 支出（管理委託費〜水道光熱費）を1画面で入力し、入力した費目だけまとめて記帳する。
// 公租公課・各保険・組合費など年1回の費目は、支払った月に入力する（月割りはしない）。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { transactionsRepo } from '../../lib/repositories'
import { today } from '../../lib/format'
import { BUILDING_INCOME_CATEGORIES, BUILDING_EXPENSE_CATEGORIES, categoryLabel } from '../../types'
import type { Property, Transaction } from '../../types'

const n = (s: string) => {
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

export function BuildingEntry({
  properties,
  defaultPropertyId,
  onSaved,
}: {
  properties: Property[]
  defaultPropertyId: string | null
  onSaved: () => void
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '')
  const [date, setDate] = useState(today())
  const [method, setMethod] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPropertyId(defaultPropertyId ?? properties[0]?.id ?? '')
  }, [defaultPropertyId, properties])

  const set = (cat: string, v: string) => setValues((prev) => ({ ...prev, [cat]: v }))

  const filledCount = useMemo(
    () => Object.values(values).filter((v) => n(v) > 0).length,
    [values],
  )

  async function save() {
    setError(null)
    if (!propertyId) return setError('物件を選択してください。')

    const rows: Partial<Transaction>[] = []
    const base = { date, property_id: propertyId, unit_id: null, method: method || null }
    for (const cat of BUILDING_INCOME_CATEGORIES) {
      if (n(values[cat]) > 0) rows.push({ ...base, type: 'income', category: cat, amount: n(values[cat]) })
    }
    for (const cat of BUILDING_EXPENSE_CATEGORIES) {
      if (n(values[cat]) > 0) rows.push({ ...base, type: 'expense', category: cat, amount: n(values[cat]) })
    }
    if (rows.length === 0) return setError('金額を1つ以上入力してください。')

    setSaving(true)
    try {
      await transactionsRepo.createMany(rows)
      setValues({})
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
        <Field label="日付">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Field>
      </div>

      <Section title="収入" accent="text-emerald-700">
        {BUILDING_INCOME_CATEGORIES.map((cat) => (
          <Line key={cat} label={cat} value={values[cat] ?? ''} onChange={(v) => set(cat, v)} />
        ))}
      </Section>

      <Section title="支出" accent="text-rose-700">
        {BUILDING_EXPENSE_CATEGORIES.map((cat) => (
          <Line
            key={cat}
            label={categoryLabel(cat)}
            value={values[cat] ?? ''}
            onChange={(v) => set(cat, v)}
          />
        ))}
      </Section>

      <Field label="支払方法・摘要（任意）">
        <input
          type="text"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder="振込 / 口座振替 など"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </Field>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
      )}

      <button
        onClick={() => void save()}
        disabled={saving || filledCount === 0}
        className="w-full rounded-xl bg-slate-900 text-white py-3 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? '保存中…' : filledCount > 0 ? `記帳する（${filledCount}件）` : '記帳する'}
      </button>
    </div>
  )
}

function Section({ title, accent, children }: { title: string; accent: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <h3 className={'text-sm font-semibold mb-2 ' + accent}>{title}</h3>
      <div className="divide-y divide-slate-100">{children}</div>
    </div>
  )
}

function Line({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex-1 text-sm text-slate-700">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-right font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
    </div>
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

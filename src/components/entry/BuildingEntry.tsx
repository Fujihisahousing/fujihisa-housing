// 建物まとめ入力。物件を選び、建物単位の収入（看板・KDDI・タイムズ）と
// 支出（管理委託費〜利息）を1画面で入力し、入力した費目だけまとめて記帳する。
// 公租公課・各保険・組合費など年1回の費目は、支払った月に入力する（月割りはしない）。
//
// 毎月ほぼ同じ額の費目が多いので、物件を選んだ時点で前月の記帳を入れておく。
// 前月に記帳の無い費目は0のまま＝年1回の費目（公租公課・保険料など）は空欄で残る。
// 違う額はその場で直してから記帳ボタンを押す。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { transactionsRepo } from '../../lib/repositories'
import { today } from '../../lib/format'
import { ReflectionHint } from '../common/ReflectionHint'
import { BUILDING_INCOME_CATEGORIES, BUILDING_EXPENSE_CATEGORIES } from '../../types'
import type { Property, Transaction } from '../../types'

const n = (s: string) => {
  const v = Number(s)
  return Number.isFinite(v) ? v : 0
}

/** 入力欄のキー。収入と支出に同名の費目（『その他』）があるので必ず種別で分ける */
const keyOf = (type: 'income' | 'expense', cat: string) => `${type}:${cat}`

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
  const [prefillNote, setPrefillNote] = useState<string | null>(null)
  const [prefilling, setPrefilling] = useState(false)
  // 手入力を始めたかどうか。物件はそのままで日付だけ直したときに入力を消さないために見る
  const touched = useRef(false)
  const lastKey = useRef('')

  useEffect(() => {
    setPropertyId(defaultPropertyId ?? properties[0]?.id ?? '')
  }, [defaultPropertyId, properties])

  // 「その他」は収入・支出の両方にあるので、費目名だけをキーにすると入力欄が
  // つながってしまう（片方に入れると両方に記帳される）。収入／支出で分ける。
  const set = (key: string, v: string) => {
    touched.current = true
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  // 入力する月の前月。1月なら前年12月に回る
  const ym = date.slice(0, 7)
  const prev = useMemo(() => {
    const [y, m] = ym.split('-').map(Number)
    const i = (y || 0) * 12 + ((m || 1) - 1) - 1
    return { year: Math.floor(i / 12), month: (i % 12) + 1 }
  }, [ym])

  /** 前月の建物まとめの記帳を読んで入力欄に入れる。号室に紐づく記帳は対象外 */
  const prefill = useCallback(async () => {
    if (!propertyId) return
    setPrefilling(true)
    try {
      const mm = String(prev.month).padStart(2, '0')
      const lastDay = new Date(prev.year, prev.month, 0).getDate()
      const txs = await transactionsRepo.list({
        propertyId,
        from: `${prev.year}-${mm}-01`,
        to: `${prev.year}-${mm}-${String(lastDay).padStart(2, '0')}`,
      })
      const income = new Set<string>(BUILDING_INCOME_CATEGORIES)
      const expense = new Set<string>(BUILDING_EXPENSE_CATEGORIES)
      const sums: Record<string, number> = {}
      for (const t of txs) {
        if (t.unit_id) continue // 部屋ごとの記帳は建物まとめでは扱わない
        const list = t.type === 'income' ? income : expense
        if (!list.has(t.category)) continue // 今の費目一覧に無い古い名前は入れない
        const k = keyOf(t.type, t.category)
        sums[k] = (sums[k] ?? 0) + Number(t.amount ?? 0)
      }
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(sums)) if (v > 0) next[k] = String(v)
      setValues(next)
      touched.current = false
      const cnt = Object.keys(next).length
      setPrefillNote(
        cnt > 0
          ? `${prev.year}年${prev.month}月の記帳から ${cnt}件 を入れました。違う額は直してから記帳してください。`
          : `${prev.year}年${prev.month}月に建物まとめの記帳がありません。`,
      )
    } catch {
      setPrefillNote('前月の記帳を読めませんでした。手で入力してください。')
    } finally {
      setPrefilling(false)
    }
  }, [propertyId, prev])

  // 物件を選んだら前月ぶんを入れる。日付だけ直したときは、まだ手を付けていない場合のみ入れ直す
  useEffect(() => {
    if (!propertyId) return
    const key = `${propertyId}|${ym}`
    if (key === lastKey.current) return
    const propChanged = lastKey.current.split('|')[0] !== propertyId
    if (!propChanged && touched.current) return
    lastKey.current = key
    void prefill()
  }, [propertyId, ym, prefill])

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
      const v = n(values[keyOf('income', cat)])
      if (v > 0) rows.push({ ...base, type: 'income', category: cat, amount: v })
    }
    for (const cat of BUILDING_EXPENSE_CATEGORIES) {
      const v = n(values[keyOf('expense', cat)])
      if (v > 0) rows.push({ ...base, type: 'expense', category: cat, amount: v })
    }
    if (rows.length === 0) return setError('金額を1つ以上入力してください。')

    setSaving(true)
    try {
      await transactionsRepo.createMany(rows)
      setValues({})
      touched.current = false
      lastKey.current = ''
      setPrefillNote(null)
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
          {/* 建物まとめは号室に紐づかないので入金状況には出ない */}
          <ReflectionHint date={date} toPayments={false} />
        </Field>
      </div>

      {propertyId && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <span className="flex-1 min-w-[16rem]">
            {prefilling ? '前月の記帳を読み込み中…' : (prefillNote ?? '物件を選ぶと前月の記帳を入れます。')}
          </span>
          <button
            onClick={() => void prefill()}
            disabled={prefilling}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            前月分を入れ直す
          </button>
          <button
            onClick={() => {
              setValues({})
              touched.current = true
              setPrefillNote(null)
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100"
          >
            全部クリア
          </button>
        </div>
      )}

      <Section title="収入" accent="text-emerald-700">
        {BUILDING_INCOME_CATEGORIES.map((cat) => {
          const k = keyOf('income', cat)
          return <Line key={k} label={cat} value={values[k] ?? ''} onChange={(v) => set(k, v)} />
        })}
      </Section>

      <Section title="支出" accent="text-rose-700">
        {BUILDING_EXPENSE_CATEGORIES.map((cat) => {
          const k = keyOf('expense', cat)
          return <Line key={k} label={cat} value={values[k] ?? ''} onChange={(v) => set(k, v)} />
        })}
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

// 台帳：activeProperty でフィルタした入出金を新しい順に表示。編集・削除可。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pencil, Trash2, Loader2, Download, FileJson } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { transactionsRepo, unitsRepo } from '../../lib/repositories'
import { exportTransactionsCSV, exportAllJSON } from '../../lib/csv'
import { yen, formatDate } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type { Property, Transaction, Unit } from '../../types'

type TypeFilter = 'all' | 'income' | 'expense'

export function LedgerView({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [rows, setRows] = useState<Transaction[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [editing, setEditing] = useState<Transaction | null>(null)

  const propName = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]))
    return (id?: string | null) => (id ? m.get(id) ?? '—' : '—')
  }, [properties])

  const roomName = useMemo(() => {
    const m = new Map(units.map((u) => [u.id, u.room ?? '']))
    return (id?: string | null) => (id ? m.get(id) ?? '' : '')
  }, [units])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tx, u] = await Promise.all([
        transactionsRepo.list({ propertyId: activeProperty }),
        unitsRepo.listAll(),
      ])
      setRows(tx)
      setUnits(u)
    } finally {
      setLoading(false)
    }
  }, [activeProperty])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = rows.filter((r) => typeFilter === 'all' || r.type === typeFilter)

  async function onDelete(id: string) {
    if (!window.confirm('この記帳を削除しますか？')) return
    await transactionsRepo.remove(id)
    void load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {(['all', 'income', 'expense'] as TypeFilter[]).map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={
              'rounded-full px-3 py-1 text-sm ' +
              (typeFilter === t ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600')
            }
          >
            {t === 'all' ? 'すべて' : t === 'income' ? '収入' : '支出'}
          </button>
        ))}
        <button
          onClick={() => exportTransactionsCSV(filtered)}
          disabled={filtered.length === 0}
          className="ml-auto flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="表示中の入出金をCSV書出し"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button
          onClick={() => void exportAllJSON()}
          className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          title="全テーブルをJSON書出し"
        >
          <FileJson className="w-3.5 h-3.5" /> JSON
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">記帳がありません。</div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-xl bg-white border border-slate-200 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{r.category}</span>
                  <span className="text-xs text-slate-400">{formatDate(r.date)}</span>
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {propName(r.property_id)}
                  {roomName(r.unit_id) && ` ／ ${roomName(r.unit_id)}`}
                  {r.method && ` ／ ${r.method}`}
                  {r.memo && ` ／ ${r.memo}`}
                </div>
              </div>
              <div
                className={
                  'text-sm font-semibold tabular-nums ' +
                  (r.type === 'income' ? 'text-emerald-700' : 'text-rose-700')
                }
              >
                {r.type === 'income' ? '+' : '−'}
                {yen(r.amount)}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditing(r)} className="p-1.5 text-slate-400 hover:text-slate-700">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => void onDelete(r.id)} className="p-1.5 text-slate-400 hover:text-rose-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EditModal
        tx={editing}
        properties={properties}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          void load()
        }}
      />
    </div>
  )
}

function EditModal({
  tx,
  properties,
  onClose,
  onSaved,
}: {
  tx: Transaction | null
  properties: Property[]
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [category, setCategory] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [method, setMethod] = useState('')
  const [memo, setMemo] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tx) return
    setAmount(String(tx.amount))
    setDate(tx.date)
    setCategory(tx.category)
    setPropertyId(tx.property_id)
    setUnitId(tx.unit_id ?? '')
    setMethod(tx.method ?? '')
    setMemo(tx.memo ?? '')
    setError(null)
  }, [tx])

  useEffect(() => {
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

  async function save() {
    if (!tx) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) return setError('金額を正しく入力してください。')
    setSaving(true)
    try {
      await transactionsRepo.update(tx.id, {
        amount: amt,
        date,
        category,
        property_id: propertyId,
        unit_id: unitId || null,
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
      open={Boolean(tx)}
      title="記帳の編集"
      onClose={onClose}
      footer={
        <button
          onClick={() => void save()}
          disabled={saving}
          className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存する'}
        </button>
      }
    >
      <div className="space-y-4">
        <Row label="金額（円）">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-right font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Row>
        <Row label="カテゴリ">
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Row>
        <Row label="物件">
          <select
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value)
              setUnitId('')
            }}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="部屋（任意）">
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">指定なし</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.room}
              </option>
            ))}
          </select>
        </Row>
        <Row label="日付">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Row>
        <Row label="支払方法（任意）">
          <input
            type="text"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Row>
        <Row label="メモ（任意）">
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </Row>
        {error && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
        )}
      </div>
    </Modal>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

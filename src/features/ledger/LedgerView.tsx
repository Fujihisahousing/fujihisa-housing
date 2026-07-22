// 台帳：activeProperty でフィルタした入出金を新しい順に表示。編集・削除・履歴（adminのみ）。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pencil, Trash2, Loader2, Download, FileJson, History } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { transactionsRepo, unitsRepo, auditLogsRepo } from '../../lib/repositories'
import { exportTransactionsCSV, exportAllJSON } from '../../lib/csv'
import { yen, formatDate } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import { useAuth } from '../../auth/AuthProvider'
import type { AuditLog, Property, Transaction, Unit } from '../../types'

type TypeFilter = 'all' | 'income' | 'expense'

export function LedgerView({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<Transaction[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [history, setHistory] = useState<Transaction | null>(null)

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
    if (!window.confirm('この記帳を削除しますか？\n（論理削除。履歴には残ります）')) return
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
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setHistory(r)} className="p-1.5 text-slate-400 hover:text-slate-700" title="変更履歴">
                    <History className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditing(r)} className="p-1.5 text-slate-400 hover:text-slate-700" title="編集">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => void onDelete(r.id)} className="p-1.5 text-slate-400 hover:text-rose-600" title="削除">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
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

      <HistoryModal tx={history} propName={propName} roomName={roomName} onClose={() => setHistory(null)} />
    </div>
  )
}

// ---------------------- 変更履歴モーダル ----------------------
// 監査ログ（audit_logs）から、そのレコードの作成・変更・削除の履歴を新しい順に表示。
const FIELD_LABELS: Record<string, string> = {
  amount: '金額',
  date: '日付',
  category: 'カテゴリ',
  property_id: '物件',
  unit_id: '部屋',
  method: '支払方法',
  memo: 'メモ',
  type: '種別',
  deleted_at: '削除',
}
// 履歴で差分表示する対象フィールド（created_at 等の内部項目は除外）
const TRACKED_FIELDS = ['amount', 'date', 'category', 'property_id', 'unit_id', 'method', 'memo', 'type']

function HistoryModal({
  tx,
  propName,
  roomName,
  onClose,
}: {
  tx: Transaction | null
  propName: (id?: string | null) => string
  roomName: (id?: string | null) => string
  onClose: () => void
}) {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!tx) return
    setLoading(true)
    auditLogsRepo
      .listByRecord('transactions', tx.id)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [tx])

  // 値を人間可読に整形（物件/部屋はID→名称、金額は¥、日付は整形）
  const fmt = (field: string, v: unknown): string => {
    if (v == null || v === '') return '（空）'
    if (field === 'property_id') return propName(String(v))
    if (field === 'unit_id') return roomName(String(v)) || '指定なし'
    if (field === 'amount') return yen(Number(v))
    if (field === 'date') return formatDate(String(v))
    if (field === 'type') return v === 'income' ? '収入' : '支出'
    return String(v)
  }

  const actionLabel = (a: string) =>
    a === 'insert' ? '作成' : a === 'delete' ? '削除' : '変更'

  return (
    <Modal open={Boolean(tx)} title="変更履歴" onClose={onClose}>
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-8">履歴がありません。</div>
      ) : (
        <ul className="space-y-3">
          {logs.map((log) => {
            const oldD = (log.detail?.old ?? {}) as Record<string, unknown>
            const newD = (log.detail?.new ?? {}) as Record<string, unknown>
            const changed =
              log.action === 'update'
                ? TRACKED_FIELDS.filter((f) => JSON.stringify(oldD[f]) !== JSON.stringify(newD[f]))
                : []
            return (
              <li key={log.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                  <span
                    className={
                      'rounded-full px-2 py-0.5 font-medium ' +
                      (log.action === 'insert'
                        ? 'bg-emerald-50 text-emerald-700'
                        : log.action === 'delete'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-50 text-amber-700')
                    }
                  >
                    {actionLabel(log.action)}
                  </span>
                  <span>{new Date(log.created_at).toLocaleString('ja-JP')}</span>
                  <span className="ml-auto">{log.actor_email || 'システム'}</span>
                </div>
                {log.action === 'update' ? (
                  changed.length === 0 ? (
                    <div className="text-xs text-slate-400">（表示対象の項目に変更なし）</div>
                  ) : (
                    <div className="space-y-1">
                      {changed.map((f) => (
                        <div key={f} className="text-sm flex flex-wrap items-center gap-1.5">
                          <span className="text-slate-500 w-16 shrink-0">{FIELD_LABELS[f] ?? f}</span>
                          <span className="text-slate-400 line-through">{fmt(f, oldD[f])}</span>
                          <span className="text-slate-400">→</span>
                          <span className="text-slate-800 font-medium">{fmt(f, newD[f])}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : log.action === 'insert' ? (
                  <div className="text-sm text-slate-700">
                    {fmt('category', newD.category)}／{fmt('amount', newD.amount)}／{fmt('date', newD.date)}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">この記帳を削除しました。</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
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

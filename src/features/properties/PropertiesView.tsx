// 物件・部屋マスタ管理（CRUD）。記帳・集計の土台。SOW スコープ 2.1。
import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, DoorOpen, ChevronDown, ChevronRight, Users } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { LeaseManager } from '../leases/LeaseManager'
import { useAuth } from '../../auth/AuthProvider'
import { propertiesRepo, unitsRepo } from '../../lib/repositories'
import { yen } from '../../lib/format'
import type { Property, Unit } from '../../types'

export function PropertiesView({ onChanged }: { onChanged: () => void }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Property> | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProperties(await propertiesRepo.list())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function removeProperty(p: Property) {
    if (!window.confirm(`物件「${p.name}」を削除しますか？\n（部屋・記帳も連動して削除されます）`)) return
    await propertiesRepo.remove(p.id)
    await load()
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800">物件・部屋の管理</h2>
        <button
          onClick={() => setEditing({})}
          className="flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm font-medium hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" /> 物件を追加
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : properties.length === 0 ? (
        <div className="text-center text-slate-400 text-sm py-12">
          物件がありません。「物件を追加」から登録してください。
        </div>
      ) : (
        <ul className="space-y-2">
          {properties.map((p) => (
            <li key={p.id} className="rounded-xl bg-white border border-slate-200">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  className="text-slate-400"
                >
                  {expanded === p.id ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {p.address || '住所未登録'}
                    {p.acquired_price ? ` ／ 取得 ${yen(p.acquired_price)}` : ''}
                  </div>
                </div>
                <button onClick={() => setEditing(p)} className="p-1.5 text-slate-400 hover:text-slate-700">
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void removeProperty(p)}
                  className="p-1.5 text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              {expanded === p.id && <UnitsPanel property={p} />}
            </li>
          ))}
        </ul>
      )}

      <PropertyModal
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await load()
          onChanged()
        }}
      />
    </div>
  )
}

// ---------------------- 部屋パネル ----------------------
function UnitsPanel({ property }: { property: Property }) {
  const { isAdmin } = useAuth()
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Unit> | null>(null)
  const [managing, setManaging] = useState<Unit | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUnits(await unitsRepo.listByProperty(property.id))
    } finally {
      setLoading(false)
    }
  }, [property.id])

  useEffect(() => {
    void load()
  }, [load])

  async function removeUnit(u: Unit) {
    if (!window.confirm(`部屋「${u.room}‍を削除しますか？`)) return
    await unitsRepo.remove(u.id)
    await load()
  }

  return (
    <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/60">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-500">部屋（{units.length}）</span>
        <button
          onClick={() => setEditing({ property_id: property.id, status: '空室' })}
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
        >
          <Plus className="w-3.5 h-3.5" /> 部屋を追加
        </button>
      </div>
      {loading ? (
        <div className="text-xs text-slate-400 py-2">読み込み中…</div>
      ) : units.length === 0 ? (
        <div className="text-xs text-slate-400 py-2">部屋が未登録です。</div>
      ) : (
        <ul className="space-y-1">
          {units.map((u) => (
            <li key={u.id} className="flex items-center gap-2 text-sm py-1">
              <DoorOpen className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700">{u.room}</span>
              <span className="text-xs text-slate-500">
                {u.layout} ／ 賃料 {yen(u.rent)}＋共益 {yen(u.kyoeki)}
              </span>
              <span
                className={
                  'text-xs rounded-full px-2 py-0.5 ' +
                  (u.status === '入居' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600')
                }
              >
                {u.status}
              </span>
              <span className="flex-1" />
              {isAdmin && (
                <button
                  onClick={() => setManaging(u)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                  title="入居者管理"
                >
                  <Users className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setEditing(u)} className="p-1 text-slate-400 hover:text-slate-700">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => void removeUnit(u)} className="p-1 text-slate-400 hover:text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <UnitModal
        value={editing}
        propertyId={property.id}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await load()
        }}
      />

      {managing && (
        <LeaseManager
          unit={managing}
          onClose={() => setManaging(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  )
}

// ---------------------- フォーム部品 ----------------------
function TextField({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
    </div>
  )
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------------- 物件モーダル ----------------------
function PropertyModal({
  value,
  onClose,
  onSaved,
}: {
  value: Partial<Property> | null
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = Boolean(value?.id)

  useEffect(() => {
    if (!value) return
    setF({
      name: value.name ?? '',
      address: value.address ?? '',
      type: value.type ?? '',
      structure: value.structure ?? '',
      built: value.built ?? '',
      acquired_date: value.acquired_date ?? '',
      acquired_price: value.acquired_price != null ? String(value.acquired_price) : '',
      loan_balance: value.loan_balance != null ? String(value.loan_balance) : '',
      notes: value.notes ?? '',
    })
    setError(null)
  }, [value])

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!f.name?.trim()) return setError('物件名を入力してください。')
    setSaving(true)
    try {
      const payload: Partial<Property> = {
        name: f.name.trim(),
        address: f.address || null,
        type: f.type || null,
        structure: f.structure || null,
        built: f.built || null,
        acquired_date: f.acquired_date || null,
        acquired_price: numOrNull(f.acquired_price),
        loan_balance: numOrNull(f.loan_balance),
        notes: f.notes || null,
      }
      if (isEdit && value?.id) await propertiesRepo.update(value.id, payload)
      else await propertiesRepo.create(payload)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(value)}
      title={isEdit ? '物件の編集' : '物件の追加'}
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
      <div className="space-y-3">
        <TextField label="物件名" value={f.name ?? ''} onChange={set('name')} />
        <TextField label="住所" value={f.address ?? ''} onChange={set('address')} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="種別" value={f.type ?? ''} onChange={set('type')} />
          <TextField label="構造" value={f.structure ?? ''} onChange={set('structure')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="築年" value={f.built ?? ''} onChange={set('built')} />
          <TextField label="取得日" value={f.acquired_date ?? ''} onChange={set('acquired_date')} type="date" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="取得価格（円）" value={f.acquired_price ?? ''} onChange={set('acquired_price')} type="number" />
          <TextField label="ローン残債（円）" value={f.loan_balance ?? ''} onChange={set('loan_balance')} type="number" />
        </div>
        <TextField label="メモ" value={f.notes ?? ''} onChange={set('notes')} />
        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------- 部屋モーダル ----------------------
function UnitModal({
  value,
  propertyId,
  onClose,
  onSaved,
}: {
  value: Partial<Unit> | null
  propertyId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = Boolean(value?.id)

  useEffect(() => {
    if (!value) return
    setF({
      room: value.room ?? '',
      layout: value.layout ?? '',
      area: value.area != null ? String(value.area) : '',
      use_type: value.use_type ?? '',
      tenant_type: value.tenant_type ?? '',
      rent: value.rent != null ? String(value.rent) : '',
      kyoeki: value.kyoeki != null ? String(value.kyoeki) : '',
      deposit: value.deposit != null ? String(value.deposit) : '',
      key_money: value.key_money != null ? String(value.key_money) : '',
      refund: value.refund != null ? String(value.refund) : '',
      parking: value.parking ?? '',
      status: value.status ?? '空室',
      payment_method: value.payment_method ?? '',
      contract_end: value.contract_end ?? '',
    })
    setError(null)
  }, [value])

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!f.room?.trim()) return setError('号室を入力してください。')
    setSaving(true)
    try {
      const payload: Partial<Unit> = {
        property_id: propertyId,
        room: f.room.trim(),
        layout: f.layout || null,
        area: numOrNull(f.area),
        use_type: f.use_type || null,
        tenant_type: f.tenant_type || null,
        rent: numOrNull(f.rent) ?? 0,
        kyoeki: numOrNull(f.kyoeki) ?? 0,
        deposit: numOrNull(f.deposit) ?? 0,
        key_money: numOrNull(f.key_money) ?? 0,
        refund: numOrNull(f.refund),
        parking: f.parking || null,
        status: f.status || '空室',
        payment_method: f.payment_method || null,
        contract_end: f.contract_end || null,
      }
      if (isEdit && value?.id) await unitsRepo.update(value.id, payload)
      else await unitsRepo.create(payload)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(value)}
      title={isEdit ? '部屋の編集' : '部屋の追加'}
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
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="号室" value={f.room ?? ''} onChange={set('room')} />
          <TextField label="間取り" value={f.layout ?? ''} onChange={set('layout')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="用途" value={f.use_type ?? ''} onChange={set('use_type')} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">入居者属性</label>
            <select
              value={f.tenant_type ?? ''}
              onChange={(e) => set('tenant_type')(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">未設定</option>
              <option value="個人">個人</option>
              <option value="法人">法人</option>
              <option value="企業">企業</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="面積（㎡）" value={f.area ?? ''} onChange={set('area')} type="number" />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">状況</label>
            <select
              value={f.status ?? '空室'}
              onChange={(e) => set('status')(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="空室">空室</option>
              <option value="入居">入居</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="賃料（円）" value={f.rent ?? ''} onChange={set('rent')} type="number" />
          <TextField label="共益費（円）" value={f.kyoeki ?? ''} onChange={set('kyoeki')} type="number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="敷金（円）" value={f.deposit ?? ''} onChange={set('deposit')} type="number" />
          <TextField label="礼金（円）" value={f.key_money ?? ''} onChange={set('key_money')} type="number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="返還金（円）" value={f.refund ?? ''} onChange={set('refund')} type="number" />
          <TextField label="駐輪場・駐車場" value={f.parking ?? ''} onChange={set('parking')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="支払方法" value={f.payment_method ?? ''} onChange={set('payment_method')} />
          <TextField label="契約満了" value={f.contract_end ?? ''} onChange={set('contract_end')} type="date" />
        </div>
        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
        )}
      </div>
    </Modal>
  )
}

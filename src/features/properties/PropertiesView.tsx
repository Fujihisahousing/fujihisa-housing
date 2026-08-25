// 物件・部屋マスタ管理（CRUD）。記帳・集計の土台。SOW スコープ 2.1。
import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, DoorOpen, ChevronDown, ChevronRight, Users } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { LeaseManager } from '../leases/LeaseManager'
import { MoveEventsPanel, applyDueMoveIns } from './MoveEvents'
import { useAuth } from '../../auth/AuthProvider'
import { propertiesRepo, unitsRepo, rentHistoryRepo, paymentRecordsRepo, moveEventsRepo } from '../../lib/repositories'
import { unitCompare } from '../../lib/sortUnits'
import { effectiveRentKyoeki, deriveJudgement } from '../../lib/calc'
import { statusBadgeClass } from '../../lib/status'
import { yen, today } from '../../lib/format'
import { UNIT_STATUSES, USE_TYPES, PAYMENT_METHODS, type MoveEvent, type Property, type RentHistory, type Unit } from '../../types'

export function PropertiesView({ onChanged }: { onChanged: () => void }) {
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Property> | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 物件／入居／退去の3タブ。入退去は全物件を横断して一覧したいので、
  // 物件パネルの中ではなくこの画面のトップに置いている。
  const [tab, setTab] = useState<'物件' | '入居' | '退去'>('物件')
  const [units, setUnits] = useState<Unit[]>([])
  const [events, setEvents] = useState<MoveEvent[]>([])
  const [history, setHistory] = useState<RentHistory[]>([])
  const [moveLoading, setMoveLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProperties(await propertiesRepo.list())
    } finally {
      setLoading(false)
    }
  }, [])

  /** 入退去タブで使う全物件ぶんのデータ。賃料履歴も要る
   *  （日割りの目安と退去月の満額を、その月時点の賃料で出すため） */
  const loadMove = useCallback(async () => {
    setMoveLoading(true)
    try {
      const us = await unitsRepo.listAll()
      setUnits(us)
      const ids = us.map((u) => u.id)
      const [ev, hs] = await Promise.all([
        moveEventsRepo.listByUnitIds(ids),
        rentHistoryRepo.listByUnitIds(ids),
      ])
      // 入居予定日が来た予約を部屋へ反映する。サーバー側の定時処理が無いので、
      // 画面を開いた時点で追いつかせる。反映したら部屋と記録を読み直す。
      if ((await applyDueMoveIns(us, ev)) > 0) {
        const us2 = await unitsRepo.listAll()
        setUnits(us2)
        setEvents(await moveEventsRepo.listByUnitIds(us2.map((u) => u.id)))
        setHistory(await rentHistoryRepo.listByUnitIds(us2.map((u) => u.id)))
        return
      }
      setEvents(ev)
      setHistory(hs)
    } finally {
      setMoveLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== '物件') void loadMove()
  }, [tab, loadMove])

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
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-slate-800">物件・部屋の管理</h2>
        <span className="flex-1" />
        {(['物件', '入居', '退去'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'rounded-xl px-3 py-2 text-sm font-medium transition-colors ' +
              (tab === t
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50')
            }
          >
            {t}
          </button>
        ))}
        {tab === '物件' && (
          <button
            onClick={() => setEditing({})}
            className="flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm font-medium hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" /> 物件を追加
          </button>
        )}
      </div>

      {tab !== '物件' ? (
        <MoveEventsPanel
          kind={tab}
          units={units}
          properties={properties}
          history={history}
          events={events}
          loading={moveLoading}
          onChanged={loadMove}
        />
      ) : loading ? (
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
      const list = await unitsRepo.listByProperty(property.id)
      setUnits(list.sort(unitCompare)) // レントロールと同じ並び順
    } finally {
      setLoading(false)
    }
  }, [property.id])

  useEffect(() => {
    void load()
  }, [load])

  async function removeUnit(u: Unit) {
    if (!window.confirm(`部屋「${u.room}」を削除しますか？`)) return
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
              <span className={'text-xs rounded-full px-2 py-0.5 ' + statusBadgeClass(u.status)}>
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

/**
 * 賃料履歴を変えたあと、入金状況の月次記録（payment_records）の請求額を貼り直す。
 *
 * 記録がある月は物件情報にフォールバックしない設計なので、記録に固まっている
 * 請求額を上書きしない限り、履歴を直しても入金状況の表示は変わらない。
 * 触るのは請求額と判定だけで、入金額・契約者名・備考・滞納月数には手を付けない。
 * 対象は反映開始日の月以降だけ（それより前の月は当時の請求額のまま残す）。
 */
/** 'YYYY-MM' の当月値。適用開始月の既定値に使う */
function thisYm(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM' → 'YYYY-MM-01'。effectiveRentKyoeki は対象月の1日と文字列比較するので、
 *  1日に揃えておけば「その月分から効く」がそのまま成り立つ。 */
function ymToDate(ym?: string | null): string | null {
  const m = String(ym ?? '').match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}-${m[2]}-01` : null
}

/** 日付を その月の1日 に丸める。契約開始日から「改定前の額の開始月」を作るのに使う */
function firstOfMonth(date?: string | null): string | null {
  const m = String(date ?? '').match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-01` : null
}

/** 履歴一覧の表示。'2026-08-01' → '2026年8月分' */
function ymLabel(date: string): string {
  const m = String(date).match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}年${Number(m[2])}月分` : String(date)
}

async function repriceRecords(
  propertyId: string,
  room: string,
  unitId: string,
  history: RentHistory[],
  effectiveDate: string,
) {
  const [fromYear, fromMonth] = effectiveDate.split('-').map(Number)
  if (!fromYear || !fromMonth) return
  const records = await paymentRecordsRepo.listFrom(propertyId, room, fromYear, fromMonth)
  for (const rec of records) {
    // effectiveRentKyoeki は units の現在値をフォールバックに使うが、ここでは
    // 履歴だけで決めたいので rent/kyoeki は 0 の器を渡す（履歴が無ければ 0 になり、
    // その月は貼り直しの対象外として下で弾く）。
    const eff = effectiveRentKyoeki(
      { id: unitId, rent: 0, kyoeki: 0 } as Unit,
      history,
      rec.year,
      rec.month,
    )
    const billed = eff.rent + eff.kyoeki
    if (billed === 0) continue // その月をカバーする履歴が無い＝据え置き
    if (Number(rec.billed ?? -1) === billed) continue // 変化なし
    const judgement = deriveJudgement(
      rec.judgement !== '空室',
      billed,
      Number(rec.paid ?? 0),
      Boolean(rec.guarantor),
    )
    await paymentRecordsRepo.setBilled(propertyId, room, rec.year, rec.month, billed, judgement)
  }
}

/** 物件モーダルの項目が増えたので、区切りの小見出しを入れて探しやすくする */
function FormSection({ title }: { title: string }) {
  return (
    <div className="pt-2 text-xs font-bold text-slate-500 border-b border-slate-200 pb-1">{title}</div>
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
    const s = (v: unknown) => (v == null ? '' : String(v))
    setF({
      name: value.name ?? '',
      address: value.address ?? '',
      chiban: value.chiban ?? '',
      access: value.access ?? '',
      type: value.type ?? '',
      main_use: value.main_use ?? '',
      structure: value.structure ?? '',
      built: value.built ?? '',
      inspection_date: value.inspection_date ?? '',
      land_area: s(value.land_area),
      building_area: s(value.building_area),
      standard_floor_area: s(value.standard_floor_area),
      max_height: s(value.max_height),
      zoning: value.zoning ?? '',
      bcr: s(value.bcr),
      far: s(value.far),
      fire_zone: value.fire_zone ?? '',
      height_district: value.height_district ?? '',
      road: value.road ?? '',
      unit_count_label: value.unit_count_label ?? '',
      parking: value.parking ?? '',
      parking_count: s(value.parking_count),
      basement: value.basement ?? '',
      building_cert: value.building_cert ?? '',
      building_cert_no: value.building_cert_no ?? '',
      inspection_cert: value.inspection_cert ?? '',
      mgmt_company: value.mgmt_company ?? '',
      mgmt_contact: value.mgmt_contact ?? '',
      mgmt_phone: value.mgmt_phone ?? '',
      acquired_date: value.acquired_date ?? '',
      acquired_price: s(value.acquired_price),
      sale_price: s(value.sale_price),
      loan_balance: s(value.loan_balance),
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
        chiban: f.chiban || null,
        access: f.access || null,
        type: f.type || null,
        main_use: f.main_use || null,
        structure: f.structure || null,
        built: f.built || null,
        inspection_date: f.inspection_date || null,
        land_area: numOrNull(f.land_area),
        building_area: numOrNull(f.building_area),
        standard_floor_area: numOrNull(f.standard_floor_area),
        max_height: numOrNull(f.max_height),
        zoning: f.zoning || null,
        bcr: numOrNull(f.bcr),
        far: numOrNull(f.far),
        fire_zone: f.fire_zone || null,
        height_district: f.height_district || null,
        road: f.road || null,
        unit_count_label: f.unit_count_label || null,
        parking: f.parking || null,
        parking_count: numOrNull(f.parking_count),
        basement: f.basement || null,
        building_cert: f.building_cert || null,
        building_cert_no: f.building_cert_no || null,
        inspection_cert: f.inspection_cert || null,
        mgmt_company: f.mgmt_company || null,
        mgmt_contact: f.mgmt_contact || null,
        mgmt_phone: f.mgmt_phone || null,
        acquired_date: f.acquired_date || null,
        acquired_price: numOrNull(f.acquired_price),
        sale_price: numOrNull(f.sale_price),
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
        <TextField label="所在地（住居表示）" value={f.address ?? ''} onChange={set('address')} />
        <TextField label="地番" value={f.chiban ?? ''} onChange={set('chiban')} />
        <TextField label="交通" value={f.access ?? ''} onChange={set('access')} />

        <FormSection title="建物" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="種別" value={f.type ?? ''} onChange={set('type')} />
          <TextField label="主要用途" value={f.main_use ?? ''} onChange={set('main_use')} />
        </div>
        <TextField label="構造・規模" value={f.structure ?? ''} onChange={set('structure')} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="築年月（竣工）" value={f.built ?? ''} onChange={set('built')} />
          {/* 検査済証は年月までしか無く和暦管理なので、日付入力ではなくテキスト（例「昭和63年4月」） */}
          <TextField label="完了検査済日" value={f.inspection_date ?? ''} onChange={set('inspection_date')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="土地面積（㎡・公簿）" value={f.land_area ?? ''} onChange={set('land_area')} type="number" />
          <TextField label="建物面積（㎡・公簿）" value={f.building_area ?? ''} onChange={set('building_area')} type="number" />
          <TextField label="基準階面積（㎡）" value={f.standard_floor_area ?? ''} onChange={set('standard_floor_area')} type="number" />
          <TextField label="最高高さ（m）" value={f.max_height ?? ''} onChange={set('max_height')} type="number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="総戸数／区画数" value={f.unit_count_label ?? ''} onChange={set('unit_count_label')} />
          <TextField label="地下室有無" value={f.basement ?? ''} onChange={set('basement')} />
          <TextField label="駐車場" value={f.parking ?? ''} onChange={set('parking')} />
          <TextField label="駐車場台数" value={f.parking_count ?? ''} onChange={set('parking_count')} type="number" />
        </div>

        <FormSection title="法規" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="用途地域" value={f.zoning ?? ''} onChange={set('zoning')} />
          <TextField label="前面道路" value={f.road ?? ''} onChange={set('road')} />
          <TextField label="建ぺい率（%）" value={f.bcr ?? ''} onChange={set('bcr')} type="number" />
          <TextField label="容積率（%）" value={f.far ?? ''} onChange={set('far')} type="number" />
          <TextField label="防火指定" value={f.fire_zone ?? ''} onChange={set('fire_zone')} />
          <TextField label="高度地区" value={f.height_district ?? ''} onChange={set('height_district')} />
          <TextField label="確認済証（有り/無し）" value={f.building_cert ?? ''} onChange={set('building_cert')} />
          <TextField label="検査済証（有り/無し）" value={f.inspection_cert ?? ''} onChange={set('inspection_cert')} />
        </div>
        <TextField label="建築確認番号" value={f.building_cert_no ?? ''} onChange={set('building_cert_no')} />

        <FormSection title="管理" />
        <TextField label="管理会社" value={f.mgmt_company ?? ''} onChange={set('mgmt_company')} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="担当者" value={f.mgmt_contact ?? ''} onChange={set('mgmt_contact')} />
          <TextField label="担当者連絡先" value={f.mgmt_phone ?? ''} onChange={set('mgmt_phone')} />
        </div>

        <FormSection title="取得・売却" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="取得日" value={f.acquired_date ?? ''} onChange={set('acquired_date')} type="date" />
          <TextField label="取得価格（円）" value={f.acquired_price ?? ''} onChange={set('acquired_price')} type="number" />
          {/* 物件概要書の利回りはこの想定売価を分母に使う（概要書の画面からも保存できる） */}
          <TextField label="想定売却価格（円）" value={f.sale_price ?? ''} onChange={set('sale_price')} type="number" />
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
  const [history, setHistory] = useState<RentHistory[]>([])
  const isEdit = Boolean(value?.id)

  useEffect(() => {
    if (!value) return
    setF({
      room: value.room ?? '',
      sort_order: value.sort_order != null ? String(value.sort_order) : '',
      layout: value.layout ?? '',
      area: value.area != null ? String(value.area) : '',
      use_type: value.use_type ?? '',
      tenant_type: value.tenant_type ?? '',
      tenant: value.tenant ?? '',
      tenant_kana: value.tenant_kana ?? '',
      rent: value.rent != null ? String(value.rent) : '',
      kyoeki: value.kyoeki != null ? String(value.kyoeki) : '',
      variation: value.variation ?? '',
      rent_apply_ym: thisYm(),
      deposit: value.deposit != null ? String(value.deposit) : '',
      hoshokin: value.hoshokin != null ? String(value.hoshokin) : '',
      key_money: value.key_money != null ? String(value.key_money) : '',
      kaiyakubiki: value.kaiyakubiki != null ? String(value.kaiyakubiki) : '',
      refund: value.refund != null ? String(value.refund) : '',
      parking: value.parking ?? '',
      status: value.status ?? '空室',
      guarantor: value.guarantor ?? '',
      payment_method: value.payment_method ?? '',
      contract_start: value.contract_start ?? '',
      contract_end: value.contract_end ?? '',
      notes: value.notes ?? '',
    })
    setError(null)
    if (value.id) void rentHistoryRepo.listByUnit(value.id).then(setHistory)
    else setHistory([])
  }, [value])

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  async function removeHistory(id: string) {
    if (!window.confirm('この賃料履歴を削除しますか？')) return
    await rentHistoryRepo.remove(id)
    setHistory((prev) => prev.filter((h) => h.id !== id))
  }

  async function save() {
    if (!f.room?.trim()) return setError('号室を入力してください。')

    // 「空室」に変えた＝退去が確定した時点。契約者まわりの情報を消す。
    // 賃料・共益費・駐輪駐車は次の募集条件としてそのまま使うので残す
    // （消してしまうと満室想定や過去月の請求額の計算材料が無くなる）。
    const movedOut = isEdit && f.status === '空室' && (value?.status ?? '') !== '空室'
    if (movedOut) {
      const ok = window.confirm(
        `${f.room} を空室にします。

契約者名・読み方・入居者属性・保証会社・支払方法・契約期間を消去します。
賃料・共益費・駐輪駐車は残します（次の募集条件として使うため）。

よろしいですか？`,
      )
      if (!ok) return
    }

    setSaving(true)
    try {
      const newRent = numOrNull(f.rent) ?? 0
      const newKyoeki = numOrNull(f.kyoeki) ?? 0
      const newParking = f.parking || null
      const rentChanged =
        !isEdit ||
        newRent !== (Number(value?.rent) || 0) ||
        newKyoeki !== (Number(value?.kyoeki) || 0) ||
        newParking !== (value?.parking ?? null)

      const payload: Partial<Unit> = {
        property_id: propertyId,
        room: f.room.trim(),
        sort_order: numOrNull(f.sort_order),
        layout: f.layout || null,
        area: numOrNull(f.area),
        use_type: f.use_type || null,
        tenant_type: movedOut ? null : f.tenant_type || null,
        tenant: movedOut ? null : f.tenant || null,
        tenant_kana: movedOut ? null : f.tenant_kana || null,
        rent: newRent,
        kyoeki: newKyoeki,
        variation: f.variation || null,
        deposit: numOrNull(f.deposit) ?? 0,
        hoshokin: numOrNull(f.hoshokin),
        key_money: numOrNull(f.key_money) ?? 0,
        kaiyakubiki: numOrNull(f.kaiyakubiki),
        refund: numOrNull(f.refund),
        parking: f.parking || null,
        status: f.status || '空室',
        guarantor: movedOut ? null : f.guarantor || null,
        payment_method: movedOut ? null : f.payment_method || null,
        contract_start: movedOut ? null : f.contract_start || null,
        contract_end: movedOut ? null : f.contract_end || null,
        notes: f.notes || null,
      }

      let unitId = value?.id
      if (isEdit && unitId) await unitsRepo.update(unitId, payload)
      else unitId = (await unitsRepo.create(payload)).id

      // 入金状況の月次記録のうち「契約者名が未入力」のものだけ、ここで
      // 入力した契約者情報を反映する。既に契約者名が入っている記録
      // （前の入居者の分など）には触らない——過去の履歴を保護するため。
      if (payload.tenant) {
        await paymentRecordsRepo.fillMissingTenant(
          propertyId,
          payload.room!,
          payload.tenant,
          payload.tenant_type ?? null,
          payload.tenant_kana ?? null,
        )
      }

      if (rentChanged && (newRent > 0 || newKyoeki > 0 || newParking)) {
        // 適用開始月の1日を反映開始日にする。effectiveRentKyoeki は対象月の1日と
        // 文字列比較するので、1日にしておけば「その月分から」がそのまま成り立つ。
        const applyDate = ymToDate(f.rent_apply_ym) || today()

        // 改定前の額を履歴に残す。これが無いと、適用開始月より前の月を計算する材料が
        // 無くなり「最古の履歴＝改定後の額」になって過去月まで新家賃になってしまう。
        // 既に適用開始月より前の履歴があるなら、改定前の額はそこに入っているので触らない。
        const before = isEdit ? await rentHistoryRepo.listByUnit(unitId) : []
        const hasEarlier = before.some((h) => String(h.effective_date).slice(0, 10) < applyDate)
        const oldRent = Number(value?.rent) || 0
        const oldKyoeki = Number(value?.kyoeki) || 0
        if (isEdit && !hasEarlier && (oldRent > 0 || oldKyoeki > 0)) {
          await rentHistoryRepo.create({
            unit_id: unitId,
            // 「いつからその額だったか」は分からないので、契約開始日があればそこから、
            // 無ければ十分過去に置く。過去月の計算で最古の履歴として拾われるのが目的。
            effective_date: firstOfMonth(value?.contract_start) ?? '2000-01-01',
            rent: oldRent,
            kyoeki: oldKyoeki,
            parking: value?.parking ?? null,
          })
        }

        await rentHistoryRepo.create({
          unit_id: unitId,
          effective_date: applyDate,
          rent: newRent,
          kyoeki: newKyoeki,
          parking: newParking,
        })
        // 適用開始月が過去（バックデート修正）の場合、「今日時点で最新の履歴」を units の現在値として再計算する。
        const allHistory = await rentHistoryRepo.listByUnit(unitId)
        const todayStr = today()
        const current = allHistory
          .filter((h) => h.effective_date <= todayStr)
          .sort((a, b) => (a.effective_date < b.effective_date ? 1 : -1))[0]
        if (
          current &&
          (current.rent !== newRent || current.kyoeki !== newKyoeki || (current.parking ?? null) !== newParking)
        ) {
          await unitsRepo.update(unitId, { rent: current.rent, kyoeki: current.kyoeki, parking: current.parking ?? null })
        }
        // 入金状況の月次記録は、作られた時点の請求額を持ったまま固まっている
        // （記録がある月は物件情報にフォールバックしない設計）。賃料履歴を直しても
        // 画面が変わらないのを防ぐため、反映開始日以降の記録の請求額を貼り直す。
        await repriceRecords(propertyId, payload.room!, unitId, allHistory, ymToDate(f.rent_apply_ym) || todayStr)
      }
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
        <TextField
          label="表示順（小さいほど上。空欄は自動＝階数順）"
          value={f.sort_order ?? ''}
          onChange={set('sort_order')}
          type="number"
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">用途</label>
            <select
              value={f.use_type ?? ''}
              onChange={(e) => set('use_type')(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">未設定</option>
              {USE_TYPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
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
          <TextField label="契約者名（漢字/英字）" value={f.tenant ?? ''} onChange={set('tenant')} />
          <TextField label="読み方（カナ）" value={f.tenant_kana ?? ''} onChange={set('tenant_kana')} />
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
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="賃料（円）" value={f.rent ?? ''} onChange={set('rent')} type="number" />
          <TextField label="共益費（円）" value={f.kyoeki ?? ''} onChange={set('kyoeki')} type="number" />
        </div>
        <TextField label="変動値（家賃変動・自由入力）" value={f.variation ?? ''} onChange={set('variation')} />
        <div>
          <TextField
            label="適用開始月（何月分の賃料から新しい額にするか。賃料・共益費・駐輪駐車を変えたときだけ使う）"
            value={f.rent_apply_ym ?? ''}
            onChange={set('rent_apply_ym')}
            type="month"
          />
          <p className="mt-1 text-[11px] text-slate-500">
            例：2026年8月分から値上げ → 2026-08 を選ぶ。7月以前の請求額と収支表は変わりません。
            過去の月を選べば遡って直せます。
          </p>
          {history.length > 0 && (
            <div className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100">
              {history.map((h) => (
                <div key={h.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-600">
                  <span className="w-24 shrink-0">{ymLabel(h.effective_date)}〜</span>
                  <span className="flex-1">
                    賃料 {yen(h.rent)}／共益費 {yen(h.kyoeki)}
                    {h.parking && `／駐輪駐車 ${h.parking}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeHistory(h.id)}
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="敷金（円）"
            value={f.deposit ?? ''}
            onChange={(v) => setF((p) => ({ ...p, deposit: v, refund: v }))}
            type="number"
          />
          <TextField label="保証金（円）" value={f.hoshokin ?? ''} onChange={set('hoshokin')} type="number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="礼金（円）" value={f.key_money ?? ''} onChange={set('key_money')} type="number" />
          <TextField label="解約引（円）" value={f.kaiyakubiki ?? ''} onChange={set('kaiyakubiki')} type="number" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="返還金（円・敷金と連動）" value={f.refund ?? ''} onChange={set('refund')} type="number" />
          <TextField label="駐輪場・駐車場" value={f.parking ?? ''} onChange={set('parking')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="保証会社" value={f.guarantor ?? ''} onChange={set('guarantor')} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">支払方法</label>
            <select
              value={f.payment_method ?? ''}
              onChange={(e) => set('payment_method')(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">未設定</option>
              {PAYMENT_METHODS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              {/* 移行前の自由入力（「日本管理サポート㈱から毎月入金」など）を消さないため、
                  選択肢に無い現在値はそのまま候補に残す。選び直せば新しい表記になる。 */}
              {f.payment_method && !PAYMENT_METHODS.includes(f.payment_method as never) && (
                <option value={f.payment_method}>{f.payment_method}（旧表記）</option>
              )}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {f.payment_method === '保証会社'
                ? '通帳には保証会社名が出るため、金額で照合します。会社名は左の「保証会社」に入れてください。'
                : f.payment_method === '振込'
                  ? '通帳の契約者名（カナ）で照合します。読み方が未入力だと突き合わせられません。'
                  : '通帳・PDFの自動読み取りで、契約者名で照合するか金額で照合するかの判断に使います。'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="入居開始日" value={f.contract_start ?? ''} onChange={set('contract_start')} type="date" />
          <TextField label="契約満了" value={f.contract_end ?? ''} onChange={set('contract_end')} type="date" />
        </div>
        <TextField label="メモ（備考）" value={f.notes ?? ''} onChange={set('notes')} />
        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
        )}
      </div>
    </Modal>
  )
}

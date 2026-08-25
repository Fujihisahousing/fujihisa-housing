// 入退去シート（move_events）。物件・部屋の管理の「入居」「退去」タブの中身。
//
// なぜ部屋の編集と分けるか：
//   賃料改定は「何月分から新しい額か」だけで決まるが、入退去は月の途中で起きるので
//   その月だけ請求額が例外になる（入居月＝日割り／退去月＝満額）。
//   部屋の編集に混ぜると「今の条件」と「その月だけの例外」が同じ画面に並んで混乱するため、
//   例外を作る操作をこちらへ寄せている。
//
// 退去は予告を受けた時点で登録する運用。予告書の退去予定日を scheduled_date に入れておくと、
// その日を過ぎても状況が「退予」のままの部屋をレントロールが警告として拾う（rentroll 側）。
//
// 日割りは手入力。実日数・30日それぞれの目安は出すが、仲介会社によって計算が違うので
// 自動では入れない（契約書の額をそのまま入れてもらう）。
import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, LogIn, LogOut } from 'lucide-react'
import { moveEventsRepo, paymentRecordsRepo } from '../../lib/repositories'
import { effectiveRentKyoeki } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { yen, formatDate } from '../../lib/format'
import type { MoveEvent, MoveKind, Property, RentHistory, Unit } from '../../types'

// ---------------------------------------------------------------------
// 年月・日割りのヘルパー（純粋関数。UI を読まなくても検証できる）
// ---------------------------------------------------------------------

/** 'YYYY-MM-DD' → 'YYYY-MM'。Date を通さないのは calc.ts と同じ理由（UTC で1日ずれる） */
export function ymOf(date?: string | null): string {
  const m = String(date ?? '').match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : ''
}

/** 'YYYY-MM' の翌月 */
export function nextYm(ym: string): string {
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  if (!m) return ''
  const y = Number(m[1])
  const mo = Number(m[2])
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

/** その月の日数 */
export function daysInMonth(ym: string): number {
  const m = ym.match(/^(\d{4})-(\d{2})$/)
  if (!m) return 30
  return new Date(Number(m[1]), Number(m[2]), 0).getDate()
}

/** 入居日から月末までの日数（入居日当日を含む） */
export function remainingDays(date: string): number {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return 0
  const total = daysInMonth(`${m[1]}-${m[2]}`)
  return Math.max(0, total - Number(m[3]) + 1)
}

/** 日割りの目安。実日数割りと30日割りの2通りを出す（採用はしない。手入力の参考） */
export function proratedHints(monthly: number, date: string): { actual: number; thirty: number } | null {
  const ym = ymOf(date)
  if (!ym || monthly <= 0) return null
  const rest = remainingDays(date)
  return {
    actual: Math.round((monthly * rest) / daysInMonth(ym)),
    thirty: Math.round((monthly * rest) / 30),
  }
}

// ---------------------------------------------------------------------
// パネル本体
// ---------------------------------------------------------------------
interface Props {
  kind: MoveKind
  /** 全物件ぶんの部屋。物件をまたいで入退去を一覧するため */
  units: Unit[]
  properties: Property[]
  history: RentHistory[]
  events: MoveEvent[]
  loading: boolean
  onChanged: () => void | Promise<void>
}

type Form = Partial<MoveEvent>

export function MoveEventsPanel({ kind, units, properties, history, events, loading, onChanged }: Props) {
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameOf = useMemo(() => {
    const m = new Map(properties.map((p) => [p.id, p.name]))
    return (id?: string | null) => (id ? (m.get(id) ?? '') : '')
  }, [properties])
  // 物件ごとにまとめてから号室順。号室だけだと物件をまたいで混ざって選びにくい
  const sortedUnits = useMemo(
    () =>
      [...units].sort(
        (a, b) =>
          nameOf(a.property_id).localeCompare(nameOf(b.property_id), 'ja') || unitCompare(a, b),
      ),
    [units, nameOf],
  )
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const rows = useMemo(
    () => events.filter((e) => e.kind === kind),
    [events, kind],
  )

  const isMoveIn = kind === '入居'

  /** 選択中の部屋の、対象月時点の賃料＋共益費。日割りの目安と退去月の満額に使う */
  function monthlyOf(unitId: string | null | undefined, ym: string): number {
    const u = unitId ? unitById.get(unitId) : null
    if (!u) return 0
    const [y, m] = ym.split('-').map(Number)
    if (!y || !m) return 0
    const hs = history.filter((h) => h.unit_id === u.id)
    const eff = effectiveRentKyoeki(u, hs, y, m)
    return eff.rent + eff.kyoeki
  }

  function startNew() {
    setError(null)
    setForm(isMoveIn ? { kind } : { kind })
  }

  /** 実際の日付が決まったら、年月の項目に既定値を入れる。手で上書きできる */
  function onDateChange(v: string) {
    const ym = ymOf(v)
    setForm((p) => {
      if (!p) return p
      if (isMoveIn) {
        return {
          ...p,
          actual_date: v,
          prorated_ym: p.prorated_ym || ym,
          first_full_ym: p.first_full_ym || nextYm(ym),
        }
      }
      // 退去月の家賃は満額もらう運用なので、最終請求月の既定は退去月そのもの
      return { ...p, actual_date: v, final_ym: p.final_ym || ym }
    })
  }

  async function save() {
    if (!form?.unit_id) return setError('号室を選んでください。')
    if (!form.actual_date && !form.scheduled_date) {
      return setError(isMoveIn ? '入居日を入れてください。' : '退去日または退去予定日を入れてください。')
    }
    setSaving(true)
    setError(null)
    try {
      const u = unitById.get(form.unit_id)
      const saved = await moveEventsRepo.save({
        ...form,
        unit_id: form.unit_id,
        kind,
        tenant: form.tenant || u?.tenant || null,
        prorated_amount: form.prorated_amount != null ? Number(form.prorated_amount) : null,
      })

      // その月だけの例外を入金状況の請求額に書き戻す。
      // 通常月は賃料履歴から自動計算されるので、ここでは例外月だけを触る。
      const room = u?.room
      const propertyId = u?.property_id
      if (room && propertyId) {
        if (isMoveIn && saved.prorated_ym && saved.prorated_amount != null) {
          await writeBilled(propertyId, room, saved.prorated_ym, Number(saved.prorated_amount))
        }
        if (!isMoveIn && saved.final_ym) {
          const full = monthlyOf(saved.unit_id, saved.final_ym)
          if (full > 0) await writeBilled(propertyId, room, saved.final_ym, full)
        }
      }
      setForm(null)
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('この記録を削除しますか？（入金状況の請求額はそのまま残ります）')) return
    await moveEventsRepo.remove(id)
    await onChanged()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-xs py-6 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-600">
          {isMoveIn ? '入居' : '退去'}（{rows.length}）
        </span>
        {/* この画面の主役の操作なので、上のタブや「物件を追加」と同じ大きさで出す */}
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 rounded-xl bg-slate-900 text-white px-3 py-2 text-sm font-medium hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" /> {isMoveIn ? '入居を登録' : '退去を登録'}
        </button>
      </div>

      {form && (
        <MoveForm
          kind={kind}
          form={form}
          setForm={setForm}
          units={sortedUnits}
          nameOf={nameOf}
          onDateChange={onDateChange}
          monthlyOf={monthlyOf}
          saving={saving}
          error={error}
          onCancel={() => setForm(null)}
          onSave={() => void save()}
        />
      )}

      {rows.length === 0 ? (
        <p className="text-center text-slate-400 text-xs py-6">
          {isMoveIn
            ? '入居の記録はありません。入居日と日割り家賃を登録すると、その月の請求額に反映されます。'
            : '退去の記録はありません。退去予告を受けた時点で登録してください。'}
        </p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
          {rows.map((e) => {
            const u = unitById.get(e.unit_id)
            return (
              <div key={e.id} className="flex items-start gap-3 px-3 py-2 text-xs">
                <span className="w-32 shrink-0 text-slate-500">{nameOf(u?.property_id)}</span>
                <span className="w-16 shrink-0 font-medium text-slate-800">{u?.room ?? '—'}</span>
                <span className="w-28 shrink-0 text-slate-600">{e.tenant || '—'}</span>
                <div className="flex-1 text-slate-600 space-y-0.5">
                  {isMoveIn ? (
                    <>
                      <div>入居日 {formatDate(e.actual_date) || '—'}</div>
                      <div>
                        日割り {e.prorated_amount != null ? yen(e.prorated_amount) : '—'}
                        {e.prorated_ym && `（${e.prorated_ym} 分）`}
                        {e.first_full_ym && ` ／ 満額 ${e.first_full_ym} 分から`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        予告 {formatDate(e.notice_date) || '—'} ／ 予定 {formatDate(e.scheduled_date) || '—'}
                        {' ／ '}退去 {formatDate(e.actual_date) || '—'}
                      </div>
                      <div>最終請求 {e.final_ym ? `${e.final_ym} 分（満額）` : '—'}</div>
                    </>
                  )}
                  {e.memo && <div className="text-slate-400">{e.memo}</div>}
                </div>
                <button onClick={() => void remove(e.id)} className="text-slate-400 hover:text-rose-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// 入力フォーム
// ---------------------------------------------------------------------
function MoveForm({
  kind, form, setForm, units, nameOf, onDateChange, monthlyOf, saving, error, onCancel, onSave,
}: {
  kind: MoveKind
  form: Form
  setForm: (f: (p: Form | null) => Form | null) => void
  units: Unit[]
  nameOf: (id?: string | null) => string
  onDateChange: (v: string) => void
  monthlyOf: (unitId: string | null | undefined, ym: string) => number
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  const isMoveIn = kind === '入居'
  const set = (k: keyof MoveEvent) => (v: string) =>
    setForm((p) => (p ? { ...p, [k]: v || null } : p))

  const hintYm = isMoveIn ? ymOf(form.actual_date) : ''
  const monthly = isMoveIn && hintYm ? monthlyOf(form.unit_id, hintYm) : 0
  const hints = isMoveIn && form.actual_date ? proratedHints(monthly, String(form.actual_date)) : null

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="物件・号室">
          <select
            value={form.unit_id ?? ''}
            onChange={(e) => set('unit_id')(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
          >
            <option value="">選択してください</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {nameOf(u.property_id)} {u.room}
                {u.tenant ? `（${u.tenant}）` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="契約者名（空なら部屋の契約者を控えます）">
          <Input value={form.tenant ?? ''} onChange={set('tenant')} />
        </Field>
      </div>

      {isMoveIn ? (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="入居日">
              <Input type="date" value={form.actual_date ?? ''} onChange={onDateChange} />
            </Field>
            <Field label="日割りを計上する月">
              <Input type="month" value={form.prorated_ym ?? ''} onChange={set('prorated_ym')} />
            </Field>
            <Field label="満額を始める月">
              <Input type="month" value={form.first_full_ym ?? ''} onChange={set('first_full_ym')} />
            </Field>
          </div>
          <Field label="日割り家賃（契約書の額をそのまま入力）">
            <Input
              type="number"
              value={form.prorated_amount != null ? String(form.prorated_amount) : ''}
              onChange={set('prorated_amount')}
            />
          </Field>
          {hints && (
            <p className="text-[11px] text-slate-500">
              参考：月額 {yen(monthly)} ／ 残り {remainingDays(String(form.actual_date))} 日 →
              　実日数割り <b>{yen(hints.actual)}</b>　／　30日割り <b>{yen(hints.thirty)}</b>
              <br />
              仲介会社によって計算が違うので自動では入れません。契約書の額を入れてください。
            </p>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label="予告を受けた日">
              <Input type="date" value={form.notice_date ?? ''} onChange={set('notice_date')} />
            </Field>
            <Field label="退去予定日（予告書の日付）">
              <Input type="date" value={form.scheduled_date ?? ''} onChange={set('scheduled_date')} />
            </Field>
            <Field label="実際の退去日">
              <Input type="date" value={form.actual_date ?? ''} onChange={onDateChange} />
            </Field>
          </div>
          <Field label="最終請求月（退去月は満額。既定は退去月）">
            <Input type="month" value={form.final_ym ?? ''} onChange={set('final_ym')} />
          </Field>
          <p className="text-[11px] text-slate-500">
            退去予定日を過ぎても状況が「退予」のままの部屋は、レントロールに警告が出ます。
            退去が済んだら部屋の編集で状況を「空室」にしてください（契約者情報が消えます）。
          </p>
        </>
      )}

      <Field label="メモ">
        <Input value={form.memo ?? ''} onChange={set('memo')} />
      </Field>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 rounded-lg bg-slate-900 text-white py-1.5 text-xs font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存する'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          やめる
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Input({
  value, onChange, type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
    />
  )
}

/** 入金状況の請求額を1か月だけ上書きする。記録が無ければ作る */
async function writeBilled(propertyId: string, room: string, ym: string, billed: number) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return
  await paymentRecordsRepo.upsertBilled(propertyId, room, y, m, billed)
}

/** タブの見出しに使うアイコン。呼び出し側（PropertiesView）から参照する */
export const MOVE_ICONS = { 入居: LogIn, 退去: LogOut } as const

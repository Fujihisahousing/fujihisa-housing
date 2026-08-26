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
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Loader2, Plus, Trash2, LogIn, LogOut } from 'lucide-react'
import { useAuth } from '../../auth/AuthProvider'
import {
  moveEventsRepo, moveOutLedgerRepo, paymentRecordsRepo, unitsRepo, rentHistoryRepo,
} from '../../lib/repositories'
import { effectiveRentKyoeki } from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { yen, formatDate } from '../../lib/format'
import { TENANT_TYPES, PAYMENT_METHODS, USE_TYPES } from '../../types'
import type { MoveEvent, MoveKind, MoveOutLedgerEntry, Property, RentHistory, Unit } from '../../types'

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

/** 月初（1日）入居かどうか。1日から住むなら日割りは発生せず、その月から満額になる */
export function startsOnFirst(date?: string | null): boolean {
  return /^\d{4}-\d{2}-01$/.test(String(date ?? ''))
}

/** 入居日から、日割りを計上する月と満額を始める月を決める。
 *  日割り月は入居日の月と同期。満額は翌月から。
 *  ただし1日入居だけは例外で、日割りが無くその月から満額になる。 */
export function moveInMonths(date?: string | null): { proratedYm: string | null; firstFullYm: string } {
  const ym = ymOf(date)
  if (!ym) return { proratedYm: null, firstFullYm: '' }
  return startsOnFirst(date)
    ? { proratedYm: null, firstFullYm: ym }
    : { proratedYm: ym, firstFullYm: nextYm(ym) }
}

/** 備考欄に入れる入居予定の目印。年は付けない（'8/25入居予定'）。
 *  レントロールの備考は狭いので、年をまたいでも月日だけで足りるという運用判断。 */
export function moveInNote(date?: string | null): string {
  const m = String(date ?? '').match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[1])}/${Number(m[2])}入居予定` : ''
}

/** 備考から入居予定の目印だけを外す。手書きのメモは残す */
export function stripMoveInNote(notes?: string | null): string {
  return String(notes ?? '')
    .replace(/\d{1,2}\/\d{1,2}入居予定/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 備考に入居予定の目印を付け直す（重複しないよう、いったん外してから足す） */
export function withMoveInNote(notes: string | null | undefined, date?: string | null): string | null {
  const base = stripMoveInNote(notes)
  const mark = moveInNote(date)
  const joined = [base, mark].filter(Boolean).join(' ')
  return joined === '' ? null : joined
}

/** 返還金の既定値。敷金があれば敷金、無ければ保証金−解約引。
 *  レントロールの返還金列と同じ考え方（RentRoll.tsx の refundValue）。 */
export function defaultRefund(
  deposit: unknown,
  hoshokin: unknown,
  kaiyakubiki: unknown,
): number | null {
  const d = Number(deposit) || 0
  const h = Number(hoshokin) || 0
  const k = Number(kaiyakubiki) || 0
  if (d > 0) return d
  if (h > 0) return h - k
  return null
}

/** 退去の最終請求月。退去月の家賃は満額もらう運用なので、月そのものが決まればよい。
 *  予告を受けた時点では予告書の退去予定日しか無いのでその月を入れ、
 *  実際の退去日が決まったらそちらの月に切り替える。
 *  手で直した後は動かさない（呼び出し側で touched を見て判断する）。 */
export function autoFinalYm(scheduled?: string | null, actual?: string | null): string | null {
  return ymOf(actual) || ymOf(scheduled) || null
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
  /** 退去帳簿（転居先住所）。admin 以外は空で届く。退去の記録と move_event_id で1対1 */
  ledger: MoveOutLedgerEntry[]
  loading: boolean
  onChanged: () => void | Promise<void>
}

/** 号室を選ぶと部屋から引いてくる項目。部屋の賃料・共益費はレントロールに出ている額そのもので、
 *  入居のたびに打ち直さなくて済むよう号室を選んだ時点で入れる。
 *  手入力すれば上書きでき、上書きした項目は号室を選び直しても部屋の値で戻されない。 */
const PULLED_FIELDS = [
  'use_type', 'parking', 'rent', 'kyoeki',
  'deposit', 'hoshokin', 'key_money', 'kaiyakubiki', 'refund',
] as const
type PulledField = (typeof PULLED_FIELDS)[number]

/** 手入力で自動計算を止められる項目。引いてくる項目に最終請求月を足したもの */
type TouchableField = PulledField | 'final_ym'

/** フォームの持ち物。move_events の列に加えて、保存時に units へ書き戻す契約情報と、
 *  号室を絞り込むための property_id を持つ（property_id は move_events には保存しない）。
 *  金額欄は入力途中の文字列も通るよう string も許す。 */
type Form = Partial<Omit<MoveEvent, 'unit_id'>> & {
  unit_id?: string | null
  property_id?: string | null
  tenant_type?: string | null
  guarantor?: string | null
  payment_method?: string | null
  use_type?: string | null
  contract_start?: string | null
  contract_end?: string | null
  parking?: string | null
  rent?: string | number | null
  kyoeki?: string | number | null
  deposit?: string | number | null
  hoshokin?: string | number | null
  key_money?: string | number | null
  kaiyakubiki?: string | number | null
  /** 退去：転居先住所。move_events ではなく退去帳簿（暗号化）に保存する */
  forwarding_address?: string | null
  refund?: string | number | null
  /** 手で触った項目。触った後は日付や号室を変えても自動では上書きしない（画面だけの状態） */
  touched?: Partial<Record<TouchableField, true>>
}

const numOrNull = (v: unknown) => {
  const t = String(v ?? '').trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function MoveEventsPanel({ kind, units, properties, history, events, ledger, loading, onChanged }: Props) {
  const { isAdmin } = useAuth()
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 転居先住所は個人情報なので admin にしか届かない。退去の記録から引けるようにしておく
  const addressOf = useMemo(
    () => new Map(ledger.map((l) => [l.move_event_id, l.forwarding_address ?? ''])),
    [ledger],
  )

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
    setForm({ kind })
  }

  /** 号室を選んだら、その部屋の今の条件をフォームに引いてくる。
   *  募集条件（賃料・共益費・敷金など）は部屋に入っているので、
   *  入居のたびに一から打ち直さなくて済む。契約者欄は空のままにする。
   *
   *  選び直したときは、手で触っていない項目を新しい部屋の額で入れ直す。
   *  前は「空のときだけ入れる」だったので、部屋やマンションを選び直すと
   *  前の部屋の賃料が残ったままになっていた。 */
  function onUnitChange(unitId: string) {
    const u = unitId ? unitById.get(unitId) : null
    setForm((p) => {
      if (!p) return p
      if (!isMoveIn || !u) return { ...p, unit_id: unitId || null }
      const t = p.touched ?? {}
      const deposit = t.deposit ? p.deposit ?? null : u.deposit ?? null
      const hoshokin = t.hoshokin ? p.hoshokin ?? null : u.hoshokin ?? null
      const kaiyakubiki = t.kaiyakubiki ? p.kaiyakubiki ?? null : u.kaiyakubiki ?? null
      return {
        ...p,
        unit_id: unitId || null,
        use_type: t.use_type ? p.use_type ?? null : u.use_type ?? null,
        parking: t.parking ? p.parking ?? null : u.parking ?? null,
        rent: t.rent ? p.rent ?? null : u.rent ?? null,
        kyoeki: t.kyoeki ? p.kyoeki ?? null : u.kyoeki ?? null,
        deposit,
        hoshokin,
        key_money: t.key_money ? p.key_money ?? null : u.key_money ?? null,
        kaiyakubiki,
        // 返還金は部屋の保存値ではなく、敷金／保証金−解約引 から計算し直す
        refund: t.refund ? p.refund ?? null : defaultRefund(deposit, hoshokin, kaiyakubiki),
      }
    })
  }

  /** 入居日／退去日が変わったら年月の項目を追随させる。
   *  入居側は手入力させない：日割り月＝入居月、満額＝翌月（1日入居なら日割り無しで当月から満額）
   *  と決まっているので、人が触れると食い違うだけ。 */
  function onDateChange(v: string) {
    setForm((p) => {
      if (!p) return p
      if (isMoveIn) {
        const { proratedYm, firstFullYm } = moveInMonths(v)
        return {
          ...p,
          actual_date: v,
          prorated_ym: proratedYm,
          first_full_ym: firstFullYm,
          // 1日入居は日割りが発生しないので、入れてあった額も落とす
          prorated_amount: proratedYm ? p.prorated_amount : null,
        }
      }
      // 退去月の家賃は満額もらう運用なので、最終請求月の既定は退去月そのもの
      return {
        ...p,
        actual_date: v,
        final_ym: p.touched?.final_ym ? p.final_ym ?? null : autoFinalYm(p.scheduled_date, v),
      }
    })
  }

  /** 退去予定日（予告書の日付）が変わったら最終請求月を追随させる。
   *  予告を受けた時点ではまだ実際の退去日が無いので、ここが既定の出どころになる。 */
  function onScheduledChange(v: string) {
    setForm((p) =>
      p
        ? {
            ...p,
            scheduled_date: v || null,
            final_ym: p.touched?.final_ym ? p.final_ym ?? null : autoFinalYm(v, p.actual_date),
          }
        : p,
    )
  }

  async function save() {
    if (!form?.unit_id) return setError('号室を選んでください。')
    if (!form.actual_date && !form.scheduled_date) {
      return setError(isMoveIn ? '入居日を入れてください。' : '退去日または退去予定日を入れてください。')
    }
    setSaving(true)
    setError(null)
    try {
      const unitId = form.unit_id
      const u = unitById.get(unitId)

      // 入居は「予約」として持つ。入居日が来るまで部屋の情報は書き換えず、
      // 入れる予定の内容を unit_patch に置いておく（applyDueMoveIns がその日に反映する）。
      const patch = isMoveIn
        ? {
            tenant: form.tenant || null,
            tenant_kana: form.tenant_kana || null,
            tenant_type: form.tenant_type || null,
            guarantor: form.guarantor || null,
            payment_method: form.payment_method || null,
            use_type: form.use_type || null,
            contract_start: form.contract_start || null,
            parking: form.parking || null,
            rent: numOrNull(form.rent) ?? 0,
            kyoeki: numOrNull(form.kyoeki) ?? 0,
            deposit: numOrNull(form.deposit),
            hoshokin: numOrNull(form.hoshokin),
            key_money: numOrNull(form.key_money),
            kaiyakubiki: numOrNull(form.kaiyakubiki),
            refund: numOrNull(form.refund),
          }
        : null

      const saved = await moveEventsRepo.save({
        id: form.id,
        unit_id: unitId,
        kind,
        notice_date: form.notice_date ?? null,
        scheduled_date: form.scheduled_date ?? null,
        actual_date: form.actual_date ?? null,
        prorated_amount: numOrNull(form.prorated_amount),
        prorated_ym: form.prorated_ym ?? null,
        first_full_ym: form.first_full_ym ?? null,
        final_ym: form.final_ym ?? null,
        tenant: form.tenant || u?.tenant || null,
        tenant_kana: form.tenant_kana || u?.tenant_kana || null,
        memo: form.memo ?? null,
        unit_patch: patch,
        applied_at: null,
      })

      if (isMoveIn && u) {
        if (isDue(saved.actual_date, todayStr())) {
          // 入居日が今日以前なら待つ意味がないのでその場で反映する
          await applyMoveIn(saved, u)
        } else {
          // まだ先の話。部屋は「入予」にし、備考に mm/dd入居予定 を出しておく
          await unitsRepo.update(u.id, {
            status: '入予',
            notes: withMoveInNote(u.notes, saved.actual_date),
          })
        }
      }

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
      // 転居先住所は暗号化して退去帳簿へ。move_events は誰でも読めるので置かない。
      // 予告の時点でまだ分からないことが多いので、後から一覧のその場編集でも足せる。
      const forwarding = form.forwarding_address?.trim() || ''
      if (!isMoveIn && isAdmin && forwarding !== '') {
        await moveOutLedgerRepo.save(saved.id, forwarding)
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
          properties={properties}
          onUnitChange={onUnitChange}
          onDateChange={onDateChange}
          onScheduledChange={onScheduledChange}
          isAdmin={isAdmin}
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
                      {/* 転居先は退去の後で分かることが多いので、一覧でそのまま書き足せるようにする */}
                      {isAdmin && (
                        <ForwardingCell
                          value={addressOf.get(e.id) ?? ''}
                          onSave={async (v) => {
                            await moveOutLedgerRepo.save(e.id, v || null)
                            await onChanged()
                          }}
                        />
                      )}
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
  kind, form, setForm, units, properties, onUnitChange, onDateChange, onScheduledChange,
  isAdmin, monthlyOf, saving, error, onCancel, onSave,
}: {
  kind: MoveKind
  form: Form
  setForm: Dispatch<SetStateAction<Form | null>>
  units: Unit[]
  properties: Property[]
  onUnitChange: (v: string) => void
  onDateChange: (v: string) => void
  onScheduledChange: (v: string) => void
  isAdmin: boolean
  monthlyOf: (unitId: string | null | undefined, ym: string) => number
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  const isMoveIn = kind === '入居'
  const set = (k: keyof Form) => (v: string) =>
    setForm((p) => (p ? { ...p, [k]: v || null } : p))

  /** 部屋から引いてくる項目の手入力。触った印を残し、以降は号室を選び直しても
   *  部屋の額で戻さない（自動で入るが、手で決めた額のほうを優先する）。 */
  const setPulled = (k: PulledField) => (v: string) =>
    setForm((p) => (p ? { ...p, [k]: v || null, touched: { ...p.touched, [k]: true } } : p))

  /** 最終請求月の手入力。直したら以降は退去日・退去予定日を変えても自動で戻さない */
  const setFinalYm = (v: string) =>
    setForm((p) => (p ? { ...p, final_ym: v || null, touched: { ...p.touched, final_ym: true } } : p))

  /** 敷金・保証金・解約引を触ったら返還金を計算し直す。
   *  返還金を手で入力した後は上書きしない。 */
  const setDepositLike = (k: 'deposit' | 'hoshokin' | 'kaiyakubiki') => (v: string) =>
    setForm((p) => {
      if (!p) return p
      const touched = { ...p.touched, [k]: true as const }
      const next = { ...p, [k]: v || null, touched }
      if (touched.refund) return next
      return { ...next, refund: defaultRefund(next.deposit, next.hoshokin, next.kaiyakubiki) }
    })

  // 物件と号室は別々に選ばせる。1つのプルダウンに全物件の部屋を並べると数が多すぎるうえ、
  // どのマンションの部屋なのかが読み取りにくい。
  const selected = units.find((u) => u.id === form.unit_id)
  const propertyId = form.property_id ?? selected?.property_id ?? ''
  const rooms = units.filter((u) => u.property_id === propertyId)

  const onFirst = startsOnFirst(form.actual_date)
  const hintYm = ymOf(form.actual_date)
  const monthly = isMoveIn && hintYm ? monthlyOf(form.unit_id, hintYm) : 0
  const hints =
    isMoveIn && form.actual_date && !onFirst ? proratedHints(monthly, String(form.actual_date)) : null

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="マンション名">
          <Select
            value={propertyId}
            onChange={(v) =>
              setForm((p) => {
                if (!p) return p
                // マンションを変えたら号室は選び直し。前の部屋から引いてきた額が
                // 残っていると次の部屋の条件と紛らわしいので、手で触っていない欄は空に戻す。
                const next: Form = { ...p, property_id: v || null, unit_id: null }
                for (const k of PULLED_FIELDS) if (!p.touched?.[k]) next[k] = null
                return next
              })
            }
            options={[
              { value: '', label: '選択してください' },
              ...properties.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>
        <Field label="号室">
          <Select
            value={form.unit_id ?? ''}
            onChange={onUnitChange}
            options={[
              { value: '', label: propertyId ? '選択してください' : 'マンションを先に選んでください' },
              ...rooms.map((u) => ({ value: u.id, label: String(u.room ?? '') })),
            ]}
          />
        </Field>
      </div>

      {isMoveIn ? (
        <>
          <Section title="入居予定日" />
          <div className="grid grid-cols-3 gap-3 items-end">
            <Field label="入居予定日">
              <Input type="date" value={form.actual_date ?? ''} onChange={onDateChange} />
            </Field>
            <Readonly
              label="日割りを計上する月"
              value={onFirst ? '日割りなし' : form.prorated_ym || '—'}
            />
            <Readonly label="満額を始める月" value={form.first_full_ym || '—'} />
          </div>
          <p className="text-[11px] text-slate-500">
            月は入居日から自動で決まります（日割り＝入居月／満額＝翌月）。
            1日入居のときだけ日割りが無くなり、その月から満額になります。
          </p>

          {!onFirst && (
            <>
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
                  仲介会社によって計算が違うので自動では入れません。
                </p>
              )}
            </>
          )}

          <Section title="契約者" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="契約者名（漢字/英字）">
              <Input value={form.tenant ?? ''} onChange={set('tenant')} />
            </Field>
            <Field label="読み方（カナ）">
              <Input value={form.tenant_kana ?? ''} onChange={set('tenant_kana')} />
            </Field>
            <Field label="入居者属性">
              <Select
                value={form.tenant_type ?? ''}
                onChange={set('tenant_type')}
                options={[
                  { value: '', label: '未設定' },
                  ...TENANT_TYPES.map((t) => ({ value: t, label: t })),
                ]}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="保証会社">
              <Input value={form.guarantor ?? ''} onChange={set('guarantor')} />
            </Field>
            <Field label="支払方法">
              <Select
                value={form.payment_method ?? ''}
                onChange={set('payment_method')}
                options={[
                  { value: '', label: '未設定' },
                  ...PAYMENT_METHODS.map((m) => ({ value: m, label: m })),
                ]}
              />
            </Field>
            <Field label="用途">
              <Select
                value={form.use_type ?? ''}
                onChange={setPulled('use_type')}
                options={[
                  { value: '', label: '未設定' },
                  ...USE_TYPES.map((t) => ({ value: t, label: t })),
                ]}
              />
            </Field>
          </div>
          <Field label="契約開始日">
            <Input type="date" value={form.contract_start ?? ''} onChange={set('contract_start')} />
          </Field>

          <Section title="契約条件" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="賃料（円）">
              <Input type="number" value={String(form.rent ?? '')} onChange={setPulled('rent')} />
            </Field>
            <Field label="共益費（円）">
              <Input type="number" value={String(form.kyoeki ?? '')} onChange={setPulled('kyoeki')} />
            </Field>
            <Field label="駐輪駐車">
              <Input value={form.parking ?? ''} onChange={setPulled('parking')} />
            </Field>
          </div>
          <p className="text-[11px] text-slate-500">
            号室を選ぶと、レントロールに出ているその部屋の条件（賃料・共益費・敷金など）が入ります。
            違う額で契約するときはそのまま書き換えてください。書き換えた欄は、号室を選び直しても元に戻りません。
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="敷金（円）">
              <Input type="number" value={String(form.deposit ?? '')} onChange={setDepositLike('deposit')} />
            </Field>
            <Field label="保証金（円）">
              <Input type="number" value={String(form.hoshokin ?? '')} onChange={setDepositLike('hoshokin')} />
            </Field>
            <Field label="解約引（円）">
              <Input type="number" value={String(form.kaiyakubiki ?? '')} onChange={setDepositLike('kaiyakubiki')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="礼金（円）">
              <Input type="number" value={String(form.key_money ?? '')} onChange={setPulled('key_money')} />
            </Field>
            <Field label="返還金（円）　※敷金／保証金−解約引から自動、手入力で上書き可">
              <Input type="number" value={String(form.refund ?? '')} onChange={setPulled('refund')} />
            </Field>
          </div>
          <p className="text-[11px] text-slate-500">
            保存すると状況が「入予」になり、レントロールの備考に「
            {moveInNote(form.actual_date) || 'mm/dd入居予定'}」が出ます。
            入居予定日が来た時点で、この内容が自動で部屋の情報に入り、状況が「入居」に変わります。
            賃料・共益費を今と違う額にした場合は、満額を始める月からの賃料履歴も作ります。
            入居予定日が今日以前ならその場で反映します。
          </p>
        </>
      ) : (
        <>
          <Section title="退去日" />
          <div className="grid grid-cols-3 gap-3">
            <Field label="予告を受けた日">
              <Input type="date" value={form.notice_date ?? ''} onChange={set('notice_date')} />
            </Field>
            <Field label="退去予定日（予告書の日付）">
              <Input type="date" value={form.scheduled_date ?? ''} onChange={onScheduledChange} />
            </Field>
            <Field label="実際の退去日">
              <Input type="date" value={form.actual_date ?? ''} onChange={onDateChange} />
            </Field>
          </div>
          <Field label="最終請求月（退去月は満額）">
            <Input type="month" value={form.final_ym ?? ''} onChange={setFinalYm} />
          </Field>
          <p className="text-[11px] text-slate-500">
            最終請求月は退去予定日の月が自動で入ります。実際の退去日を入れるとその月に切り替わります。
            月をまたいで精算するなど違う月にしたいときは書き換えてください（書き換えた後は日付を変えても戻りません）。
          </p>
          {isAdmin && (
            <>
              <Section title="転居先（退去帳簿）" />
              <Field label="転居先住所">
                <Input value={form.forwarding_address ?? ''} onChange={set('forwarding_address')} />
              </Field>
              <p className="text-[11px] text-slate-500">
                敷金の返金先・郵便物の転送先として残します。予告の時点で分からなければ空のままでよく、
                後から一覧の「転居先」欄に直接書き足せます。
                個人情報なので暗号化して保存し、管理者だけが読めます。退去から2年で自動的に消えます。
              </p>
            </>
          )}

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

      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 rounded-xl bg-slate-900 text-white py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          {saving ? '保存中…' : '保存する'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          やめる
        </button>
      </div>
    </div>
  )
}

/** 退去帳簿の転居先セル。打っている間は手元の値を出し、欄から離れたときだけ保存する。
 *  入金状況の備考と同じ「その場で直せる」操作感に合わせている（admin のみ描画される）。 */
function ForwardingCell({
  value, onSave,
}: {
  value: string
  onSave: (v: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // 保存後に親から新しい値が届いたら追随する
  useEffect(() => setDraft(value), [value])

  return (
    <div className="flex items-center gap-1.5 pt-0.5">
      <span className="shrink-0 text-slate-500">転居先</span>
      <input
        value={draft}
        disabled={busy}
        placeholder="住所（未確認なら空のまま）"
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={async () => {
          const next = draft.trim()
          if (next === value.trim()) return
          setBusy(true)
          setFailed(false)
          try {
            await onSave(next)
          } catch {
            setFailed(true)
            setDraft(value)
          } finally {
            setBusy(false)
          }
        }}
        className="flex-1 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
      />
      {busy && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
      {failed && <span className="text-rose-600">保存できませんでした</span>}
    </div>
  )
}

function Section({ title }: { title: string }) {
  return (
    <div className="pt-1 text-xs font-semibold text-slate-500 border-b border-slate-200 pb-1">
      {title}
    </div>
  )
}

/** 入居日から自動で決まる項目。触らせないので入力欄ではなく表示にする */
function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-600 mb-1">{label}</label>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
        {value}
      </div>
    </div>
  )
}

function Select({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

/** 今日の 'YYYY-MM-DD'。Date を通した文字列比較にしないのは calc.ts と同じ理由 */
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 入居日が来ているか（今日を含む） */
export function isDue(actualDate: string | null | undefined, today: string): boolean {
  const d = String(actualDate ?? '').slice(0, 10)
  return d !== '' && d <= today
}

/** 反映待ちの入居のうち、入居日が来ているものを選ぶ */
export function dueMoveIns(events: MoveEvent[], today: string): MoveEvent[] {
  return events.filter(
    (e) => e.kind === '入居' && !e.applied_at && e.unit_patch && isDue(e.actual_date, today),
  )
}

/** 予約してあった入居内容を部屋へ反映する。
 *  備考の「mm/dd入居予定」は役目を終えるので外し、状況を「入居」にする。
 *  賃料が変わるなら、満額を始める月から効く履歴も足す（月初の日付＝その月分から）。 */
export async function applyMoveIn(e: MoveEvent, u: Unit): Promise<void> {
  const patch = (e.unit_patch ?? {}) as Partial<Unit>
  const newRent = Number(patch.rent) || 0
  const newKyoeki = Number(patch.kyoeki) || 0
  await unitsRepo.update(u.id, {
    ...patch,
    status: '入居',
    notes: stripMoveInNote(u.notes) || null,
  })
  const changed = newRent !== (Number(u.rent) || 0) || newKyoeki !== (Number(u.kyoeki) || 0)
  if (changed && e.first_full_ym) {
    await rentHistoryRepo.create({
      unit_id: u.id,
      effective_date: `${e.first_full_ym}-01`,
      rent: newRent,
      kyoeki: newKyoeki,
      parking: patch.parking ?? null,
    })
  }
  await moveEventsRepo.save({ id: e.id, unit_id: e.unit_id, kind: e.kind, applied_at: new Date().toISOString() })
}

/** 入居日が来た予約をまとめて部屋へ反映する。画面を開いたときに呼ぶ。
 *  サーバー側の定時処理が無いので、台帳を見た人が最初に開いた時点で追いつく作り。
 *  反映した件数を返す（0 なら再読み込み不要）。 */
export async function applyDueMoveIns(units: Unit[], events: MoveEvent[]): Promise<number> {
  const byId = new Map(units.map((u) => [u.id, u]))
  const due = dueMoveIns(events, todayStr())
  let done = 0
  for (const e of due) {
    const u = byId.get(e.unit_id)
    if (!u) continue
    await applyMoveIn(e, u)
    done++
  }
  return done
}

/** 入金状況の請求額を1か月だけ上書きする。記録が無ければ作る */
async function writeBilled(propertyId: string, room: string, ym: string, billed: number) {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return
  await paymentRecordsRepo.upsertBilled(propertyId, room, y, m, billed)
}

/** タブの見出しに使うアイコン。呼び出し側（PropertiesView）から参照する */
export const MOVE_ICONS = { 入居: LogIn, 退去: LogOut } as const

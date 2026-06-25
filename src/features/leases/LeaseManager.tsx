// 入居者・保証人の登録と退去処理（leases）。個人情報のため admin のみ。
// 🔒列はサーバ側 RPC（lease_create / lease_end）で暗号化され、復号は admin のみ。
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, UserPlus, LogOut, ArrowLeft } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { useAuth } from '../../auth/AuthProvider'
import { leasesRepo, unitsRepo } from '../../lib/repositories'
import { formatDate, today } from '../../lib/format'
import type { Lease, Unit } from '../../types'

type Mode = { kind: 'list' } | { kind: 'move-in' } | { kind: 'move-out'; lease: Lease }

export function LeaseManager({
  unit,
  onClose,
  onChanged,
}: {
  unit: Unit
  onClose: () => void
  onChanged: () => void
}) {
  const { isAdmin } = useAuth()
  const [leases, setLeases] = useState<Lease[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })

  const load = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setLeases(await leasesRepo.listByUnit(unit.id))
    } finally {
      setLoading(false)
    }
  }, [unit.id, isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  const title =
    mode.kind === 'move-in'
      ? `入居登録：${unit.room}`
      : mode.kind === 'move-out'
        ? `退去処理：${unit.room}`
        : `入居者管理：${unit.room}`

  return (
    <Modal open title={title} onClose={onClose}>
      {!isAdmin ? (
        <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600">
          <Lock className="w-5 h-5 shrink-0" />
          入居者・保証人の情報は管理者のみが閲覧・編集できます。
        </div>
      ) : mode.kind === 'move-in' ? (
        <MoveInForm
          unit={unit}
          onBack={() => setMode({ kind: 'list' })}
          onDone={async () => {
            setMode({ kind: 'list' })
            await load()
            onChanged()
          }}
        />
      ) : mode.kind === 'move-out' ? (
        <MoveOutForm
          unit={unit}
          lease={mode.lease}
          onBack={() => setMode({ kind: 'list' })}
          onDone={async () => {
            setMode({ kind: 'list' })
            await load()
            onChanged()
          }}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Lock className="w-3.5 h-3.5" /> 暗号化保存・管理者のみ閲覧可
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
            </div>
          ) : leases.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-6">入居履歴はありません。</div>
          ) : (
            <ul className="space-y-2">
              {leases.map((l) => (
                <li key={l.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'text-xs rounded-full px-2 py-0.5 ' +
                        (l.status === '入居' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-200 text-slate-600')
                      }
                    >
                      {l.status}
                    </span>
                    <span className="font-medium text-slate-800">{l.tenant_name || '（氏名なし）'}</span>
                    {l.status === '入居' && (
                      <button
                        onClick={() => setMode({ kind: 'move-out', lease: l })}
                        className="ml-auto flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700"
                      >
                        <LogOut className="w-3.5 h-3.5" /> 退去処理
                      </button>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-y-1 text-xs text-slate-600">
                    {l.tenant_phone && <Info label="連絡先" v={l.tenant_phone} />}
                    {l.guarantor_name && <Info label="連帯保証人" v={l.guarantor_name} />}
                    {l.guarantor_company && <Info label="保証会社" v={l.guarantor_company} />}
                    <Info
                      label="入居期間"
                      v={`${formatDate(l.move_in) || '—'} 〜 ${l.move_out ? formatDate(l.move_out) : '入居中'}`}
                    />
                    {l.move_out_reason && <Info label="退去理由" v={l.move_out_reason} />}
                    {l.pii_purge_at && <Info label="個人情報削除予定" v={formatDate(l.pii_purge_at)} />}
                  </dl>
                </li>
              ))}
            </ul>
          )}

          {!leases.some((l) => l.status === '入居') && (
            <button
              onClick={() => setMode({ kind: 'move-in' })}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800"
            >
              <UserPlus className="w-4 h-4" /> 入居登録
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

function Info({ label, v }: { label: string; v: string }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-slate-700 break-all">{v}</dd>
    </>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  lock,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  lock?: boolean
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium text-slate-600 mb-1">
        {lock && <Lock className="w-3 h-3 text-amber-500" />}
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
      />
    </div>
  )
}

// ---------------------- 入居登録 ----------------------
function MoveInForm({ unit, onBack, onDone }: { unit: Unit; onBack: () => void; onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    move_in: today(),
    rent: unit.rent != null ? String(unit.rent) : '',
    kyoeki: unit.kyoeki != null ? String(unit.kyoeki) : '',
    deposit: unit.deposit != null ? String(unit.deposit) : '',
    key_money: unit.key_money != null ? String(unit.key_money) : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!f.tenant_name?.trim()) return setError('入居者氏名を入力してください。')
    setSaving(true)
    try {
      await leasesRepo.create({
        unit_id: unit.id,
        status: '入居',
        tenant_name: f.tenant_name,
        tenant_phone: f.tenant_phone,
        tenant_email: f.tenant_email,
        emergency_contact: f.emergency_contact,
        tenant_employer: f.tenant_employer,
        guarantor_name: f.guarantor_name,
        guarantor_relation: f.guarantor_relation,
        guarantor_address: f.guarantor_address,
        guarantor_phone: f.guarantor_phone,
        guarantor_company: f.guarantor_company,
        guarantor_contract_no: f.guarantor_contract_no,
        guarantor_period: f.guarantor_period,
        rent: f.rent,
        kyoeki: f.kyoeki,
        deposit: f.deposit,
        key_money: f.key_money,
        move_in: f.move_in,
      })
      await unitsRepo.update(unit.id, { status: '入居' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> 一覧に戻る
      </button>

      <p className="text-xs font-semibold text-slate-500 pt-1">入居者</p>
      <Field label="氏名" value={f.tenant_name ?? ''} onChange={set('tenant_name')} lock />
      <div className="grid grid-cols-2 gap-3">
        <Field label="電話" value={f.tenant_phone ?? ''} onChange={set('tenant_phone')} lock />
        <Field label="メール" value={f.tenant_email ?? ''} onChange={set('tenant_email')} lock />
      </div>
      <Field label="緊急連絡先" value={f.emergency_contact ?? ''} onChange={set('emergency_contact')} lock />
      <Field label="勤務先" value={f.tenant_employer ?? ''} onChange={set('tenant_employer')} lock />

      <p className="text-xs font-semibold text-slate-500 pt-1">連帯保証人</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="氏名" value={f.guarantor_name ?? ''} onChange={set('guarantor_name')} lock />
        <Field label="続柄" value={f.guarantor_relation ?? ''} onChange={set('guarantor_relation')} lock />
      </div>
      <Field label="住所" value={f.guarantor_address ?? ''} onChange={set('guarantor_address')} lock />
      <Field label="電話" value={f.guarantor_phone ?? ''} onChange={set('guarantor_phone')} lock />

      <p className="text-xs font-semibold text-slate-500 pt-1">保証会社</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="保証会社名" value={f.guarantor_company ?? ''} onChange={set('guarantor_company')} />
        <Field label="契約番号" value={f.guarantor_contract_no ?? ''} onChange={set('guarantor_contract_no')} />
      </div>
      <Field label="保証期間" value={f.guarantor_period ?? ''} onChange={set('guarantor_period')} />

      <p className="text-xs font-semibold text-slate-500 pt-1">契約条件</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="賃料（円）" value={f.rent ?? ''} onChange={set('rent')} type="number" />
        <Field label="共益費（円）" value={f.kyoeki ?? ''} onChange={set('kyoeki')} type="number" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="敷金（円）" value={f.deposit ?? ''} onChange={set('deposit')} type="number" />
        <Field label="礼金（円）" value={f.key_money ?? ''} onChange={set('key_money')} type="number" />
      </div>
      <Field label="入居日" value={f.move_in ?? ''} onChange={set('move_in')} type="date" />

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
      )}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? '保存中…' : '入居を登録する'}
      </button>
    </div>
  )
}

// ---------------------- 退去処理 ----------------------
function MoveOutForm({
  unit,
  lease,
  onBack,
  onDone,
}: {
  unit: Unit
  lease: Lease
  onBack: () => void
  onDone: () => void
}) {
  const [f, setF] = useState<Record<string, string>>({ move_out: today() })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  async function save() {
    if (!f.move_out) return setError('退去日を入力してください。')
    setSaving(true)
    try {
      await leasesRepo.end({
        id: lease.id,
        move_out: f.move_out,
        move_out_reason: f.move_out_reason,
        forwarding_address: f.forwarding_address,
        deposit_settlement: f.deposit_settlement,
        restoration_cost: f.restoration_cost,
      })
      await unitsRepo.update(unit.id, { status: '空室' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-4 h-4" /> 一覧に戻る
      </button>
      <p className="text-sm text-slate-600">
        入居者：<span className="font-medium">{lease.tenant_name || '（氏名なし）'}</span>
      </p>
      <Field label="退去日" value={f.move_out ?? ''} onChange={set('move_out')} type="date" />
      <Field label="退去理由" value={f.move_out_reason ?? ''} onChange={set('move_out_reason')} />
      <Field label="転居先住所" value={f.forwarding_address ?? ''} onChange={set('forwarding_address')} lock />
      <div className="grid grid-cols-2 gap-3">
        <Field label="敷金精算額（円）" value={f.deposit_settlement ?? ''} onChange={set('deposit_settlement')} type="number" />
        <Field label="原状回復費（円）" value={f.restoration_cost ?? ''} onChange={set('restoration_cost')} type="number" />
      </div>
      <p className="text-xs text-slate-400">
        退去後、個人情報は保持年数（既定2年）経過で自動削除されます。会計データは残ります。
      </p>
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
      )}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-rose-600 text-white py-2.5 text-sm font-medium hover:bg-rose-700 disabled:opacity-60"
      >
        {saving ? '処理中…' : '退去処理を確定する'}
      </button>
    </div>
  )
}

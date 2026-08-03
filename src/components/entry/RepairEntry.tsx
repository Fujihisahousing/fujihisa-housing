// 修繕履歴の入力。物件と区分（共用部／専有部）を選び、1件ぶんの修繕をまとめて登録する。
// 登録先は property_repairs（物件概要書の修繕タブに出る明細）。
//
// 概要書の「年度別の修繕費」は収支表(transactions)を集計して出しているので、
// 明細だけ入れても金額は出てこない。既定では収支表にも修繕費として記帳し、
// すでに建物まとめ等で記帳済みのときだけチェックを外す運用にしてある。
import { useEffect, useState, type ReactNode } from 'react'
import { propertyRepairsRepo, transactionsRepo } from '../../lib/repositories'
import { today } from '../../lib/format'
import { ReflectionHint } from '../common/ReflectionHint'
import { REPAIR_SCOPES } from '../../types'
import type { Property } from '../../types'

/** 分類の候補。原本（台帳_プランドール守口.xlsx）に出てくる値。自由入力もできる */
const KINDS = ['居室', '設備', '防水', '全体', '一部階'] as const

export function RepairEntry({
  properties,
  defaultPropertyId,
  onSaved,
}: {
  properties: Property[]
  defaultPropertyId: string | null
  onSaved: () => void
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '')
  const [scope, setScope] = useState<string>('共用部')
  const [date, setDate] = useState(today())
  const [kind, setKind] = useState('')
  const [place, setPlace] = useState('')
  const [content, setContent] = useState('')
  const [vendor, setVendor] = useState('')
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [alsoLedger, setAlsoLedger] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPropertyId(defaultPropertyId ?? properties[0]?.id ?? '')
  }, [defaultPropertyId, properties])

  const costNum = Number(cost)
  const validCost = cost !== '' && Number.isFinite(costNum) ? costNum : 0

  async function save() {
    setError(null)
    if (!propertyId) return setError('物件を選択してください。')
    if (!place.trim() && !content.trim()) return setError('修繕箇所か修繕内容を入力してください。')

    setSaving(true)
    try {
      await propertyRepairsRepo.save({
        property_id: propertyId,
        scope,
        repaired_on: date || null,
        kind: kind.trim() || null,
        place: place.trim() || null,
        content: content.trim() || null,
        vendor: vendor.trim() || null,
        cost: validCost > 0 ? validCost : null,
        note: note.trim() || null,
      })
      if (alsoLedger && validCost > 0) {
        await transactionsRepo.createMany([
          {
            date,
            property_id: propertyId,
            unit_id: null,
            type: 'expense',
            category: '修繕費',
            amount: validCost,
            memo: [scope, place.trim(), content.trim()].filter(Boolean).join(' '),
          },
        ])
      }
      setKind(''); setPlace(''); setContent(''); setVendor(''); setCost(''); setNote('')
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
            className={INPUT + ' bg-white'}
          >
            <option value="">選択してください</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="区分">
          <div className="flex rounded-xl bg-slate-100 p-1 text-sm">
            {REPAIR_SCOPES.map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={
                  'flex-1 rounded-lg py-2 font-medium transition-colors ' +
                  (scope === s ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500')
                }
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="修繕日付">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
            {/* 修繕は号室に紐づけないので入金状況には出ない */}
            <ReflectionHint date={date} toPayments={false} />
          </Field>
          <Field label="分類（任意）">
            <input
              type="text"
              list="repair-kinds"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="設備 / 居室 / 防水 など"
              className={INPUT}
            />
            <datalist id="repair-kinds">
              {KINDS.map((k) => <option key={k} value={k} />)}
            </datalist>
          </Field>
        </div>

        <Field label="修繕箇所">
          <input
            type="text"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder={scope === '専有部' ? '例）301レンジフード' : '例）１F玄関エントランスドア'}
            className={INPUT}
          />
        </Field>

        <Field label="修繕内容">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            placeholder="例）フロアヒンジ交換"
            className={INPUT}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="会社名（任意）">
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="例）㈱丸田商店"
              className={INPUT}
            />
          </Field>
          <Field label="費用">
            <input
              type="number"
              inputMode="numeric"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="0"
              className={INPUT + ' text-right font-semibold'}
            />
          </Field>
        </div>

        <Field label="備考（任意）">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="経年劣化 / 台風被害 など"
            className={INPUT}
          />
        </Field>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={alsoLedger}
          onChange={(e) => setAlsoLedger(e.target.checked)}
          className="mt-0.5 w-4 h-4"
        />
        <span>
          収支表にも修繕費として記帳する
          <span className="block text-xs text-slate-500">
            概要書の「年度別の修繕費」は収支表を集計して出しているので、通常はオンのまま。
            建物まとめ等ですでに記帳済みの分を後から履歴に足すときだけ外す。
          </span>
        </span>
      </label>

      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
      )}

      <button
        onClick={() => void save()}
        disabled={saving}
        className="w-full rounded-xl bg-slate-900 text-white py-3 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
      >
        {saving ? '保存中…' : '修繕履歴に登録する'}
      </button>
    </div>
  )
}

const INPUT =
  'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

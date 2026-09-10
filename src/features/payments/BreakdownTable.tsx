// 通帳から取り込んだ入金の内訳を一覧で確認・修正する画面。
//
// 「〇〇号室の入金額 ●●円。内訳は 家賃●●／共益費●●／駐車駐輪●●／水道代●●、
//   あまりが出たら不明金●●」を1行ずつ出して、その場で直してから一括保存する。
//
// 通帳取込と、あとからの「その月を再計算」の両方で同じ画面を使う。
import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react'
import { yen } from '../../lib/format'
import { splitTotal } from '../../lib/depositBreakdown'

/** 画面で1行ぶん。金額はすべて円。編集するとその行が edited になる */
export interface BreakdownRow {
  key: string
  date: string
  /** 収支表に載る月 'YYYY-MM'（前家賃の帰属月） */
  ym: string
  unitId: string
  room: string
  tenant: string
  /** その戸に割り当てた入金額。内訳の合計はこれと一致していなければならない */
  amount: number
  rent: number
  kyoeki: number
  parking: number
  water: number
  unknown: number
  /** 人が手で直した行。再計算のときに触らない印になる */
  edited: boolean
  /** 摘要（まとめ入金の元の振込名義など） */
  memo: string
  /** 水道代の請求書から分かっている額。未取込なら null */
  waterExpected: number | null
}

const FIELDS = [
  { key: 'rent', label: '家賃' },
  { key: 'kyoeki', label: '共益費' },
  { key: 'parking', label: '駐車・駐輪' },
  { key: 'water', label: '水道代' },
  { key: 'unknown', label: '不明金' },
] as const
type FieldKey = (typeof FIELDS)[number]['key']

export function BreakdownTable({
  rows,
  setRows,
  onSave,
  saving,
  saveLabel = '記帳する',
  note,
}: {
  rows: BreakdownRow[]
  setRows: (rows: BreakdownRow[]) => void
  onSave: () => void
  saving: boolean
  saveLabel?: string
  note?: string
}) {
  const [onlyProblem, setOnlyProblem] = useState(false)

  const diffOf = (r: BreakdownRow) => splitTotal(r) - r.amount
  const broken = rows.filter((r) => diffOf(r) !== 0)
  const unknownTotal = rows.reduce((s, r) => s + r.unknown, 0)
  const waterTotal = rows.reduce((s, r) => s + r.water, 0)
  const amountTotal = rows.reduce((s, r) => s + r.amount, 0)

  const shown = useMemo(
    () => (onlyProblem ? rows.filter((r) => diffOf(r) !== 0 || r.unknown > 0) : rows),
    [rows, onlyProblem],
  )

  const edit = (key: string, field: FieldKey, raw: string) => {
    const v = Math.max(0, Math.round(Number(raw.replace(/[^\d-]/g, '')) || 0))
    setRows(rows.map((r) => (r.key === key ? { ...r, [field]: v, edited: true } : r)))
  }
  /** 残り（入金額−ほかの費目）を不明金に寄せる。1クリックで帳尻を合わせる用 */
  const restToUnknown = (key: string) => {
    setRows(
      rows.map((r) =>
        r.key === key
          ? { ...r, unknown: Math.max(0, r.amount - r.rent - r.kyoeki - r.parking - r.water), edited: true }
          : r,
      ),
    )
  }
  /** 不明金を水道代に振り替える。請求書が後から届いたときに使う */
  const unknownToWater = (key: string) => {
    setRows(rows.map((r) => (r.key === key ? { ...r, water: r.water + r.unknown, unknown: 0, edited: true } : r)))
  }

  if (rows.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <span className="font-medium text-slate-700">{rows.length}件</span>
        <span className="text-slate-500">入金額 {yen(amountTotal)}</span>
        <span className="text-slate-500">水道代 {yen(waterTotal)}</span>
        <span className={unknownTotal > 0 ? 'font-medium text-amber-700' : 'text-slate-500'}>
          不明金 {yen(unknownTotal)}
        </span>
        {broken.length > 0 && (
          <span className="flex items-center gap-1 font-medium text-rose-700">
            <AlertTriangle className="w-4 h-4" />
            内訳が入金額と合わない行が {broken.length}件
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-slate-600">
          <input
            type="checkbox"
            checked={onlyProblem}
            onChange={(e) => setOnlyProblem(e.target.checked)}
            className="rounded border-slate-300"
          />
          不明金・不一致だけ表示
        </label>
        <button
          onClick={onSave}
          disabled={saving || broken.length > 0}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saveLabel}
        </button>
      </div>

      {note && <p className="text-xs text-slate-500">{note}</p>}
      {broken.length > 0 && (
        <p className="text-xs text-rose-700">
          合計が入金額と合っていない行があります。金額を直すか「残りを不明金へ」を押してから保存してください。
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left font-medium">入金日</th>
              <th className="px-2 py-2 text-left font-medium">号室</th>
              <th className="px-2 py-2 text-left font-medium">契約者</th>
              <th className="px-2 py-2 text-left font-medium">何月分</th>
              <th className="px-2 py-2 text-right font-medium">入金額</th>
              {FIELDS.map((f) => (
                <th key={f.key} className="px-2 py-2 text-right font-medium">
                  {f.label}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">合計</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const diff = diffOf(r)
              return (
                <tr
                  key={r.key}
                  className={
                    'border-t border-slate-100 ' +
                    (diff !== 0 ? 'bg-rose-50' : r.unknown > 0 ? 'bg-amber-50' : '')
                  }
                >
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{r.date}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-900">{r.room}</td>
                  <td className="px-2 py-1.5 max-w-[12rem] truncate text-slate-600" title={r.memo || r.tenant}>
                    {r.tenant}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{r.ym}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-slate-900">{yen(r.amount)}</td>
                  {FIELDS.map((f) => (
                    <td key={f.key} className="px-1 py-1">
                      <input
                        inputMode="numeric"
                        value={r[f.key]}
                        onChange={(e) => edit(r.key, f.key, e.target.value)}
                        className={
                          'w-24 rounded border px-1.5 py-1 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-900 ' +
                          (f.key === 'unknown' && r.unknown > 0
                            ? 'border-amber-400 bg-amber-50 font-medium text-amber-800'
                            : 'border-slate-300')
                        }
                      />
                      {f.key === 'water' && r.waterExpected !== null && r.water !== r.waterExpected && (
                        <div className="mt-0.5 text-[10px] text-slate-400">検針表 {yen(r.waterExpected)}</div>
                      )}
                    </td>
                  ))}
                  <td
                    className={
                      'px-2 py-1.5 text-right font-medium ' +
                      (diff === 0 ? 'text-slate-500' : 'text-rose-700')
                    }
                  >
                    {yen(splitTotal(r))}
                    {diff !== 0 && <div className="text-[10px]">差 {yen(diff)}</div>}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {diff !== 0 && (
                      <button
                        onClick={() => restToUnknown(r.key)}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        残りを不明金へ
                      </button>
                    )}
                    {diff === 0 && r.unknown > 0 && (
                      <button
                        onClick={() => unknownToWater(r.key)}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        不明金を水道代へ
                      </button>
                    )}
                    {diff === 0 && r.unknown === 0 && <Check className="w-4 h-4 text-emerald-600" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 通帳CSV取込：Gemini等でスキャン→CSV化（日付,契約者名,金額）したものを取り込む。
// 契約者名で号室に自動マッチ→確認→契約内訳で賃料/共益費/光熱費に自動振り分けして記帳。
import { useEffect, useMemo, useState } from 'react'
import { X, Upload, Loader2 } from 'lucide-react'
import { transactionsRepo, unitsRepo } from '../../lib/repositories'
import { yen } from '../../lib/format'
import { CAT_RENT, CAT_KYOEKI, CAT_UTILITY, type Property, type Transaction, type Unit } from '../../types'

interface Parsed {
  date: string
  name: string
  amount: number
  unitId: string // マッチ結果（空＝未マッチ）
}

const norm = (s: string) => s.replace(/[\s　]/g, '')

function normDate(s: string): string {
  const t = s.trim().replace(/\//g, '-')
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : t
}

function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

// 契約内訳で賃料→共益費→光熱費の順に充当
function splitDeposit(u: Unit, total: number) {
  const rent = Math.min(total, Number(u.rent) || 0)
  const afterRent = Math.max(0, total - rent)
  const kyoeki = Math.min(afterRent, Number(u.kyoeki) || 0)
  const utility = Math.max(0, afterRent - kyoeki)
  return { rent, kyoeki, utility }
}

export function ImportCsv({
  properties,
  defaultPropertyId,
  onClose,
  onDone,
}: {
  properties: Property[]
  defaultPropertyId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? properties[0]?.id ?? '')
  const [units, setUnits] = useState<Unit[]>([])
  const [rows, setRows] = useState<Parsed[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 選択物件の号室を取得
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

  const unitsById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const byName = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of units) if (u.tenant) m.set(norm(u.tenant), u.id)
    return m
  }, [units])

  // CSVを取り込んで自動マッチ
  function ingest(text: string) {
    setError(null)
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const parsed: Parsed[] = []
    for (const line of lines) {
      const c = splitLine(line)
      if (c.length < 3) continue
      const amount = Number(c[2].replace(/[,，\s¥￥円]/g, ''))
      if (!Number.isFinite(amount) || amount === 0) continue // ヘッダー行や空行はスキップ
      const name = c[1].trim()
      parsed.push({ date: normDate(c[0]), name, amount, unitId: byName.get(norm(name)) ?? '' })
    }
    if (parsed.length === 0) setError('取り込める行がありませんでした。CSVの形式（日付,契約者名,金額）を確認してください。')
    setRows(parsed)
  }

  // byName が更新されたら（物件変更時）再マッチ
  useEffect(() => {
    setRows((prev) => prev.map((r) => ({ ...r, unitId: r.unitId || byName.get(norm(r.name)) || '' })))
  }, [byName])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => ingest(String(reader.result ?? ''))
    reader.readAsText(file, 'utf-8')
  }

  const matched = rows.filter((r) => r.unitId)
  const unmatched = rows.length - matched.length

  async function save() {
    setError(null)
    const tx: Partial<Transaction>[] = []
    for (const r of matched) {
      const u = unitsById.get(r.unitId)
      if (!u) continue
      const s = splitDeposit(u, r.amount)
      const base = {
        date: r.date,
        property_id: u.property_id,
        unit_id: u.id,
        type: 'income' as const,
        method: '通帳CSV取込',
        memo: '通帳CSV取込',
      }
      if (s.rent > 0) tx.push({ ...base, category: CAT_RENT, amount: s.rent })
      if (s.kyoeki > 0) tx.push({ ...base, category: CAT_KYOEKI, amount: s.kyoeki })
      if (s.utility > 0) tx.push({ ...base, category: CAT_UTILITY, amount: s.utility })
    }
    if (tx.length === 0) return setError('記帳する行がありません（号室がマッチした行が必要です）。')
    setSaving(true)
    try {
      await transactionsRepo.createMany(tx)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '記帳に失敗しました。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 shrink-0">
          <h3 className="font-bold text-slate-800">通帳CSV取込</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
            通帳をスキャンし、Gemini等で <b>「日付,契約者名,金額」の3列CSV（入金行のみ・日付はYYYY-MM-DD）</b> に変換 →
            下から取り込んでください。契約者名で号室に自動マッチし、契約内訳で賃料／共益費／光熱費に振り分けて記帳します。
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">物件（通帳の対象）</label>
              <select
                value={propertyId}
                onChange={(e) => setPropertyId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">選択してください</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">CSVファイル</label>
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4" /> ファイルを選択
                <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
              </label>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm p-3">{error}</div>
          )}

          {rows.length > 0 && (
            <>
              <div className="text-xs text-slate-500">
                {rows.length}件 読込／マッチ {matched.length}件
                {unmatched > 0 && <span className="text-rose-600">／未マッチ {unmatched}件（号室を選んでください）</span>}
              </div>
              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 font-medium">日付</th>
                      <th className="px-3 py-2 font-medium">通帳の名前</th>
                      <th className="px-3 py-2 font-medium text-right">金額</th>
                      <th className="px-3 py-2 font-medium">号室（契約者）</th>
                      <th className="px-3 py-2 font-medium">振り分け</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const u = r.unitId ? unitsById.get(r.unitId) : null
                      const s = u ? splitDeposit(u, r.amount) : null
                      return (
                        <tr key={i} className={'border-b border-slate-100 ' + (r.unitId ? '' : 'bg-rose-50/40')}>
                          <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{yen(r.amount)}</td>
                          <td className="px-3 py-2">
                            <select
                              value={r.unitId}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)),
                                )
                              }
                              className="rounded border border-slate-300 px-2 py-1 text-sm bg-white"
                            >
                              <option value="">未選択</option>
                              {units.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.room}
                                  {u.tenant ? `（${u.tenant}）` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                            {s
                              ? `賃料 ${yen(s.rent)}／共益 ${yen(s.kyoeki)}／光熱 ${yen(s.utility)}`
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 shrink-0">
          <button
            onClick={() => void save()}
            disabled={saving || matched.length === 0}
            className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> 記帳中…
              </span>
            ) : (
              `マッチした ${matched.length} 件を記帳する`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

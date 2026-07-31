// 通帳CSV取込：Gemini等でスキャン→CSV化（日付,契約者名,金額）したものを取り込む。
// 契約者名で号室に自動マッチ→確認→契約内訳で賃料/共益費/光熱費に自動振り分けして記帳。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { X, Upload, Loader2, Download } from 'lucide-react'
import { transactionsRepo, unitsRepo } from '../../lib/repositories'
import { yen } from '../../lib/format'
import { CAT_RENT, CAT_KYOEKI, CAT_UTILITY, type Property, type Transaction, type Unit } from '../../types'
import { matchTenantName, type MatchConfidence } from '../../lib/matchTenant'
import { allocateDeposit, contractAmount } from '../../lib/allocateDeposit'

interface Parsed {
  date: string
  name: string
  amount: number
  /** 割り当てる号室。保証会社のまとめ入金では複数戸になる（空＝未確定） */
  unitIds: string[]
  /** どうやって当てたか。人が見て承認できるように残す */
  confidence: MatchConfidence
  /** ambiguous のときに選ばせる候補 */
  candidates: string[]
  /** 人が手で選び直したら true。以後の自動再マッチで上書きしない */
  manual: boolean
}

// 照合結果の見せ方。推測で入れたものは色を変えて必ず目に留まるようにする
const CONF_LABEL: Record<MatchConfidence, string> = {
  exact: '一致',
  prefix: '推測（名前が一部違う）',
  similar: '推測（似ている）',
  ambiguous: '候補が複数',
  none: '見つからず',
}
const CONF_CLASS: Record<MatchConfidence, string> = {
  exact: 'bg-emerald-50 text-emerald-700',
  prefix: 'bg-amber-50 text-amber-700',
  similar: 'bg-amber-50 text-amber-700',
  ambiguous: 'bg-rose-50 text-rose-700',
  none: 'bg-rose-50 text-rose-700',
}

/** 取込用CSVの見本を書き出す。列の並びと日付の形を間違えないための雛形。
 *  Excelで開いたときに文字化けしないよう BOM を付ける。 */
function downloadTemplate() {
  const csv = [
    '日付,振込名義,金額',
    '2026-07-30,アオキショウジ,120000',
    '2026-07-30,カ）アオキショウジ,85000',
    '2026-07-31,タナカタロウ,98000',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = '通帳取込_見本.csv'
  a.click()
  URL.revokeObjectURL(url)
}

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

export function ImportCsv({
  properties,
  defaultPropertyId,
  onClose,
  onDone,
  /** 入力タブに直接置く場合は true（モーダルの覆いと閉じるボタンを出さない） */
  embedded = false,
}: {
  properties: Property[]
  defaultPropertyId: string | null
  onClose?: () => void
  onDone: () => void
  embedded?: boolean
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

  // 通帳の名義から号室を当てる。カナの揺れ（半角・法人格・語尾の増減）を吸収する。
  const match = useMemo(
    () => (name: string) => matchTenantName(name, units),
    [units],
  )

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
      const m = match(name)
      parsed.push({
        date: normDate(c[0]),
        name,
        amount,
        unitIds: m.unitId ? [m.unitId] : [],
        confidence: m.confidence,
        candidates: m.candidates.map((x) => x.unitId),
        manual: false,
      })
    }
    if (parsed.length === 0) setError('取り込める行がありませんでした。CSVの形式（日付,契約者名,金額）を確認してください。')
    setRows(parsed)
  }

  // 物件を変えたら号室が変わるので、手で選び直した行以外を再マッチする
  useEffect(() => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.manual) return r
        const m = match(r.name)
        return { ...r, unitIds: m.unitId ? [m.unitId] : [], confidence: m.confidence, candidates: m.candidates.map((x) => x.unitId) }
      }),
    )
  }, [match])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => ingest(String(reader.result ?? ''))
    reader.readAsText(file, 'utf-8')
  }

  const matched = rows.filter((r) => r.unitIds.length > 0)
  const unmatched = rows.length - matched.length
  // 推測で入れた行。記帳前に目を通してほしいので件数を分けて出す
  const guessed = rows.filter((r) => !r.manual && (r.confidence === 'prefix' || r.confidence === 'similar'))

  async function save() {
    setError(null)
    const tx: Partial<Transaction>[] = []
    for (const r of matched) {
      const us = r.unitIds.map((id) => unitsById.get(id)).filter((u): u is Unit => Boolean(u))
      if (us.length === 0) continue
      // 複数戸のまとめ入金は契約額で割り振る。1戸なら全額をその戸に充てる（従来どおり）
      const { rows: alloc } = allocateDeposit(us, r.amount)
      // まとめ入金は元が1件の振込なので、摘要に何戸ぶんかを残しておく
      const memo = us.length > 1 ? `通帳取込 まとめ入金${us.length}戸（${r.name}）` : '通帳取込'
      for (const a of alloc) {
        const u = unitsById.get(a.unitId)!
        const base = {
          date: r.date,
          property_id: u.property_id,
          unit_id: u.id,
          type: 'income' as const,
          method: '通帳取込',
          memo,
        }
        if (a.rent > 0) tx.push({ ...base, category: CAT_RENT, amount: a.rent })
        if (a.kyoeki > 0) tx.push({ ...base, category: CAT_KYOEKI, amount: a.kyoeki })
        if (a.utility > 0) tx.push({ ...base, category: CAT_UTILITY, amount: a.utility })
      }
    }
    if (tx.length === 0) return setError('記帳する行がありません（号室を選んだ行が必要です）。')
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

  // 入力タブに埋め込むときは覆いを出さず、そのまま流し込む
  const Shell = ({ children }: { children: ReactNode }) =>
    embedded ? (
      <div className="rounded-2xl bg-white border border-slate-200 flex flex-col">{children}</div>
    ) : (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl">
          {children}
        </div>
      </div>
    )

  return (
    <Shell>
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 shrink-0">
          <h3 className="font-bold text-slate-800">通帳から取込</h3>
          {!embedded && (
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="閉じる">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1.5">
            <p>
              通帳を <b>「日付,振込名義,金額」の3列CSV（入金行のみ）</b> にして取り込みます。
              ネットバンキングのCSVをこの3列に整えるか、紙の通帳はスキャンしてGemini等でCSV化してください。
            </p>
            <p>
              振込名義から号室を当てます。半角カナ・法人格（カ）など）・語尾の増減は吸収しますが、
              <b>推測で当てた行は色を変えて出す</b>ので、記帳前に確認してください。
            </p>
            <p>
              保証会社などが複数戸をまとめて振り込んでくる場合は、<b>号室を追加で選べます</b>。
              選んだ戸の契約額（賃料＋共益費）で自動的に割り振ります。
              合計が契約額と合わないときは差額を赤で出します。
            </p>
            <button
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> CSVの見本をダウンロード
            </button>
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>{rows.length}件 読込</span>
                <span className="text-emerald-700">一致 {matched.length - guessed.length}件</span>
                {guessed.length > 0 && (
                  <span className="text-amber-700">
                    推測 {guessed.length}件（名前が違うので合っているか確認してください）
                  </span>
                )}
                {unmatched > 0 && (
                  <span className="text-rose-600">未確定 {unmatched}件（号室を選んでください）</span>
                )}
              </div>
              <div className="overflow-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                      <th className="px-3 py-2 font-medium">日付</th>
                      <th className="px-3 py-2 font-medium">通帳の名前</th>
                      <th className="px-3 py-2 font-medium text-right">金額</th>
                      <th className="px-3 py-2 font-medium">号室（契約者）</th>
                      <th className="px-3 py-2 font-medium">照合</th>
                      <th className="px-3 py-2 font-medium">振り分け</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const picked = r.unitIds
                        .map((id) => unitsById.get(id))
                        .filter((x): x is Unit => Boolean(x))
                      const u = picked[0] ?? null
                      const alloc = picked.length > 0 ? allocateDeposit(picked, r.amount) : null
                      // 号室を差し替える／増やす／外す。いずれも手動扱いにする
                      const setUnitAt = (k: number, id: string) =>
                        setRows((prev) =>
                          prev.map((x, j) => {
                            if (j !== i) return x
                            const next = [...x.unitIds]
                            if (id) next[k] = id
                            else next.splice(k, 1) // 未選択にしたら外す
                            return { ...x, unitIds: next, manual: true }
                          }),
                        )
                      const addUnit = (id: string) =>
                        setRows((prev) =>
                          prev.map((x, j) =>
                            j === i && id && !x.unitIds.includes(id)
                              ? { ...x, unitIds: [...x.unitIds, id], manual: true }
                              : x,
                          ),
                        )
                      return (
                        <tr
                          key={i}
                          className={'border-b border-slate-100 ' + (picked.length ? '' : 'bg-rose-50/40')}
                        >
                          <td className="px-3 py-2 whitespace-nowrap align-top">{r.date}</td>
                          <td className="px-3 py-2 whitespace-nowrap align-top">{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums align-top">{yen(r.amount)}</td>
                          <td className="px-3 py-2 align-top">
                            <div className="space-y-1">
                              {/* 保証会社のまとめ入金は複数戸。選んだぶんだけ行が増える */}
                              {r.unitIds.map((id, k) => (
                                <select
                                  key={k}
                                  value={id}
                                  onChange={(e) => setUnitAt(k, e.target.value)}
                                  className="block rounded border border-slate-300 px-2 py-1 text-sm bg-white"
                                >
                                  <option value="">— 外す —</option>
                                  {units.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.room}
                                      {x.tenant ? `（${x.tenant}）` : ''} {yen(contractAmount(x))}
                                    </option>
                                  ))}
                                </select>
                              ))}
                              <select
                                value=""
                                onChange={(e) => addUnit(e.target.value)}
                                className="block rounded border border-dashed border-slate-300 px-2 py-1 text-sm bg-white text-slate-500"
                              >
                                <option value="">
                                  {r.unitIds.length === 0 ? '＋ 号室を選ぶ' : '＋ 号室を追加'}
                                </option>
                                {/* 候補が複数のときは先に出して選びやすくする */}
                                {r.candidates.map((id) => {
                                  const cu = unitsById.get(id)
                                  return cu ? (
                                    <option key={'c' + id} value={id}>
                                      ★ {cu.room}
                                      {cu.tenant_kana ? `（${cu.tenant_kana}）` : cu.tenant ? `（${cu.tenant}）` : ''}
                                    </option>
                                  ) : null
                                })}
                                {units
                                  .filter((x) => !r.unitIds.includes(x.id))
                                  .map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.room}
                                      {x.tenant ? `（${x.tenant}）` : ''} {yen(contractAmount(x))}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap align-top">
                            <span
                              className={
                                'rounded px-1.5 py-0.5 text-xs font-medium ' +
                                (r.manual ? 'bg-slate-100 text-slate-600' : CONF_CLASS[r.confidence])
                              }
                            >
                              {r.manual ? '手で選択' : CONF_LABEL[r.confidence]}
                            </span>
                            {/* 推測のときは通帳名と契約者名を並べて出し、違いを目で確かめられるようにする */}
                            {!r.manual && u && (r.confidence === 'prefix' || r.confidence === 'similar') && (
                              <div className="mt-0.5 text-xs text-slate-400">
                                通帳 {r.name} / 契約 {u.tenant_kana || u.tenant}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap align-top">
                            {!alloc ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <div className="space-y-0.5">
                                {alloc.rows.map((a) => {
                                  const au = unitsById.get(a.unitId)!
                                  return (
                                    <div key={a.unitId} className="text-slate-500">
                                      {picked.length > 1 && (
                                        <b className="text-slate-700">{au.room}　</b>
                                      )}
                                      賃料 {yen(a.rent)}／共益 {yen(a.kyoeki)}／光熱 {yen(a.utility)}
                                    </div>
                                  )
                                })}
                                {/* 合計が契約額と合わないときは必ず気づけるようにする */}
                                {alloc.diff !== 0 && (
                                  <div className="text-rose-600">
                                    契約額の合計 {yen(alloc.expected)}／差額{' '}
                                    {alloc.diff > 0 ? '+' : ''}
                                    {yen(alloc.diff)}
                                  </div>
                                )}
                              </div>
                            )}
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
              `確定した ${matched.length} 件を記帳する`
            )}
          </button>
        </div>
    </Shell>
  )
}

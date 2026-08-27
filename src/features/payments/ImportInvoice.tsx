// 請求書（水道代の検針表Excel）から取込。
// 号数・氏名・金額・入金日の4つだけを読み、対象月の月次記録の請求額に水道代を足す。
// 入金は総額で来るので、固定分をきちんと払っている月は入金額にも同じだけ足す。
import { useState } from 'react'
import { X, Upload, Loader2, FileSpreadsheet } from 'lucide-react'
import { unitsRepo, paymentRecordsRepo } from '../../lib/repositories'
import { deriveJudgement } from '../../lib/calc'
import { yen } from '../../lib/format'
import {
  parseInvoiceSheet,
  invoiceTargetMonth,
  parseInvoiceDate,
  waterPatch,
  fixedAmount,
  type InvoiceRow,
} from '../../lib/invoiceWater'
import type { PaymentRecord, Property, Unit } from '../../types'

interface Line extends InvoiceRow {
  unit: Unit | null
}

export function ImportInvoice({
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
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? '')
  const [units, setUnits] = useState<Unit[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [pay, setPay] = useState<{ year: number; month: number } | null>(null)
  // 入金日の何か月あとの請求額に足すか。既定は翌月（7月末入金→8月分）。
  // 通帳では2026年7月分の水道代が8月上旬に入金されており、前家賃と同じ寄せ方になる。
  const [offset, setOffset] = useState(1)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const target = pay ? invoiceTargetMonth(pay, offset) : null

  async function loadUnits(pid: string) {
    if (!pid) {
      setUnits([])
      return []
    }
    const us = await unitsRepo.listByProperty(pid)
    setUnits(us)
    return us
  }

  async function onPickProperty(pid: string) {
    setPropertyId(pid)
    const us = await loadUnits(pid)
    setLines((prev) =>
      prev.map((l) => ({ ...l, unit: us.find((u) => String(u.room).trim() === l.room) ?? null })),
    )
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setDone(null)
    setFileName(file.name)
    setBusy(true)
    try {
      // ライブラリが重いので、ファイルを選んだときだけ読み込む
      const XLSX = await import('xlsx-js-style')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      // 検針シートを優先。無ければ最初のシート
      const sheetName = wb.SheetNames.find((s) => /検針/.test(s)) ?? wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true }) as unknown[][]
      const parsed = parseInvoiceSheet(grid)
      if (parsed.rows.length === 0) {
        setError('明細が読み取れませんでした。「号数・氏名・金額」の見出しがある表か確認してください。')
      }
      // 入金日がシートから読めない請求書（=TODAY() が入っている古い版）はファイル名で補う
      const fromName = parseInvoiceDate(file.name.replace(/[（(].*?[)）]/g, ''))
      setPay(parsed.pay ?? fromName)
      const us = units.length > 0 ? units : await loadUnits(propertyId)
      setLines(
        parsed.rows.map((r) => ({
          ...r,
          unit: us.find((u) => String(u.room).trim() === r.room) ?? null,
        })),
      )
    } catch (err) {
      setError('ファイルを読めませんでした：' + (err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  const matched = lines.filter((l) => l.unit)
  const unmatched = lines.filter((l) => !l.unit)
  const total = matched.reduce((s, l) => s + l.amount, 0)

  async function save() {
    if (!propertyId || !target || matched.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const existing = await paymentRecordsRepo.list(propertyId)
      const index = new Map(
        existing
          .filter((r) => r.year === target.year && r.month === target.month)
          .map((r) => [String(r.room), r]),
      )
      let raised = 0
      for (const l of matched) {
        const u = l.unit!
        const rec = index.get(String(u.room))
        const patch = waterPatch(u, rec, l.amount)
        if (patch.paidRaised) raised++
        const occupied = u.status === '入居' || u.status === '退予'
        const guarantor = rec?.guarantor ?? u.guarantor ?? null
        const base: PaymentRecord = rec ?? {
          property_id: propertyId,
          room: String(u.room ?? ''),
          year: target.year,
          month: target.month,
          tenant: u.tenant ?? null,
          tenant_type: u.tenant_type ?? null,
          kana: u.tenant_kana ?? null,
          guarantor: u.guarantor ?? null,
        }
        await paymentRecordsRepo.upsert({
          ...base,
          billed: patch.billed,
          paid: patch.paid,
          memo: patch.memo,
          judgement: deriveJudgement(occupied, patch.billed, patch.paid, Boolean(guarantor)),
        })
      }
      setDone(
        `${target.year}年${target.month}月分に ${matched.length}件・${yen(total)} を足しました` +
          `（入金額にも足したのは ${raised}件）。`,
      )
      onDone()
    } catch (err) {
      setError('保存に失敗しました：' + (err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 shrink-0">
          <h3 className="font-bold text-slate-800">請求書から取込（水道代）</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1.5">
            <p>
              水道代の<b>検針表Excel（.xls / .xlsx）</b>を取り込み、対象月の請求額に水道代を足します。
              読むのは <b>号数・氏名・金額・入金日</b> の4つだけです。物件名の下の「◯月分」と検針期間は
              TODAY関数なので読みません。
            </p>
            <p>
              入金は総額で届くので、<b>固定分（賃料＋共益費＋駐車・駐輪）をきちんと払っている月は入金額にも同じだけ足します</b>。
              未入金・一部入金の月は請求額だけ増やすので、不足額として出ます。
              同じ請求書を取り込み直しても二重にはなりません（備考に足した額を控えています）。
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">物件</label>
              <select
                value={propertyId}
                onChange={(e) => void onPickProperty(e.target.value)}
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
              <label className="block text-xs font-medium text-slate-600 mb-1">反映先の月</label>
              <select
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
                title="請求書の入金日から何か月あとの請求額に足すか"
              >
                <option value={1}>入金日の翌月（7月末→8月分）</option>
                <option value={2}>入金日の2か月あと（7月末→9月分）</option>
                <option value={0}>入金日と同じ月（7月末→7月分）</option>
              </select>
            </div>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
              <Upload className="w-4 h-4" />
              請求書Excelを選ぶ
              <input type="file" accept=".xls,.xlsx" onChange={(e) => void onFile(e)} className="hidden" />
            </label>
            {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
          </div>

          {pay && target && (
            <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
              <span>
                入金日：<b>{pay.year}年{pay.month}月末頃</b>
              </span>
              <span>
                反映先：<b className="text-slate-900">{target.year}年{target.month}月分</b>
              </span>
              <span>
                明細：<b>{matched.length}件</b> / 合計 <b>{yen(total)}</b>
              </span>
            </div>
          )}

          {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{error}</div>}
          {done && <div className="rounded-lg bg-emerald-50 text-emerald-700 text-sm px-3 py-2">{done}</div>}
          {unmatched.length > 0 && (
            <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
              号室が見つからない行が {unmatched.length} 件あります（
              {unmatched.map((l) => l.room).join('・')}）。この行は取り込みません。
            </div>
          )}

          {lines.length > 0 && (
            <div className="overflow-auto max-h-[40vh] rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-3 py-2">号室</th>
                    <th className="px-3 py-2">氏名（請求書）</th>
                    <th className="px-3 py-2">契約者（台帳）</th>
                    <th className="px-3 py-2 text-right">水道代</th>
                    <th className="px-3 py-2 text-right">固定分</th>
                    <th className="px-3 py-2 text-right">請求額（予定）</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.room} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-1.5 font-medium text-slate-700">{l.room}</td>
                      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{l.name || '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {l.unit ? (
                          <span className="text-slate-700">{l.unit.tenant || '（空欄）'}</span>
                        ) : (
                          <span className="text-rose-700">号室が見つからず</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{yen(l.amount)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {l.unit ? yen(fixedAmount(l.unit)) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">
                        {l.unit ? yen(fixedAmount(l.unit) + l.amount) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            閉じる
          </button>
          <button
            onClick={() => void save()}
            disabled={busy || !propertyId || !target || matched.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            {target ? `${target.year}年${target.month}月分に反映` : '反映'}
          </button>
        </div>
      </div>
    </div>
  )
}

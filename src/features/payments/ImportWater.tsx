// 水道代を一覧のExcelから取り込む。入力タブの「水道代を取込」に置く。
//
// 家賃とは別に水道代を請求している物件（ルネスプランドール守口・プランドール阿波座）で、
// 対象月の請求額に水道代を足す。読める形は2つ。
//   ① 一覧形式   … 年月・号室・水道代の列。1ファイルで何か月ぶんでも入れられる
//   ② 検針表     … ルネスの検針表そのまま（号数・氏名・金額＋入金日）。1ファイル1か月ぶん
// 見出しに「年月」の列があれば①、無ければ②として読む。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { X, Upload, Loader2, FileSpreadsheet, Download } from 'lucide-react'
import { unitsRepo, paymentRecordsRepo } from '../../lib/repositories'
import { resyncProperty } from '../../lib/resync'
import { deriveJudgement } from '../../lib/calc'
import { yen } from '../../lib/format'
import {
  parseInvoiceSheet,
  parseWaterListSheet,
  invoiceTargetMonth,
  parseInvoiceDate,
  waterPatch,
  fixedAmount,
  normRoom,
} from '../../lib/invoiceWater'
import type { PaymentRecord, Property, Unit } from '../../types'

/** 画面に出す1行。年月を行ごとに持つので、月をまたぐ一覧もそのまま扱える */
interface Line {
  year: number
  month: number
  room: string
  name: string
  amount: number
  unit: Unit | null
}

/** 一覧形式の見本CSV。列の並びと年月の書き方を間違えないための雛形 */
function downloadTemplate() {
  const csv = [
    '年月,号室,氏名,水道代',
    '2024-09,1F,株式会社 キョードーエンタテイメント,4106',
    '2024-10,1F,株式会社 キョードーエンタテイメント,4289',
    '2024-11,1F,株式会社 キョードーエンタテイメント,4651',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = '水道代取込_見本.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

export function ImportWater({
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
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? '')
  const [units, setUnits] = useState<Unit[]>([])
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [lines, setLines] = useState<Line[]>([])
  // 検針表を読んだときだけ使う。一覧形式は行ごとに年月を持つので出さない
  const [invoicePay, setInvoicePay] = useState<{ year: number; month: number } | null>(null)
  const [offset, setOffset] = useState(1)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // 号室を当て直す。台帳の号室は全角が混ざる（阿波座は「1Ｆ」）ので正規化して突き合わせる。
  // 号室の列が無いファイルは、入居中の部屋が1つだけならその部屋に寄せる。
  const attach = useCallback((rows: Omit<Line, 'unit'>[], us: Unit[]): Line[] => {
    const occupied = us.filter((u) => u.status === '入居' || u.status === '退予')
    const only = occupied.length === 1 ? occupied[0] : null
    return rows.map((r) => ({
      ...r,
      unit: r.room
        ? us.find((u) => normRoom(u.room) === normRoom(r.room)) ?? null
        : only,
    }))
  }, [])

  // 物件を選んだら号室と既存の月次記録を読む（反映前後を表に出すため）
  useEffect(() => {
    if (!propertyId) {
      setUnits([])
      setRecords([])
      return
    }
    let active = true
    void (async () => {
      try {
        const [us, rec] = await Promise.all([
          unitsRepo.listByProperty(propertyId),
          paymentRecordsRepo.list(propertyId),
        ])
        if (!active) return
        setUnits(us)
        setRecords(rec)
        setLines((prev) => attach(prev, us))
      } catch {
        if (!active) return
        setUnits([])
        setRecords([])
      }
    })()
    return () => {
      active = false
    }
  }, [propertyId, attach])

  // 検針表は入金日から反映先の月を決めるので、月の選び直しに追従させる
  useEffect(() => {
    if (!invoicePay) return
    const t = invoiceTargetMonth(invoicePay, offset)
    setLines((prev) => prev.map((l) => ({ ...l, year: t.year, month: t.month })))
  }, [invoicePay, offset])

  const recordAt = useMemo(() => {
    const m = new Map<string, PaymentRecord>()
    for (const r of records) m.set(`${normRoom(r.room)}|${ymKey(r.year, r.month)}`, r)
    return m
  }, [records])

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
      const sheetName = wb.SheetNames.find((s) => /検針|水道/.test(s)) ?? wb.SheetNames[0]
      const ws = wb.Sheets[sheetName]
      const grid = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
        blankrows: true,
      }) as unknown[][]

      // まず一覧形式として読む。「年月」の列が無ければ検針表として読み直す
      const list = parseWaterListSheet(grid)
      if (list) {
        setInvoicePay(null)
        if (list.length === 0) {
          setError('明細が読み取れませんでした。「年月・号室・水道代」の見出しがある表か確認してください。')
        }
        setLines(attach(list, units))
      } else {
        const parsed = parseInvoiceSheet(grid)
        if (parsed.rows.length === 0) {
          setError(
            '明細が読み取れませんでした。一覧形式なら「年月・号室・水道代」、検針表なら「号数・氏名・金額」の見出しが要ります。',
          )
        }
        // 入金日がシートから読めない請求書（=TODAY() が入っている古い版）はファイル名で補う
        const pay = parsed.pay ?? parseInvoiceDate(file.name.replace(/[（(].*?[)）]/g, ''))
        setInvoicePay(pay)
        const t = pay ? invoiceTargetMonth(pay, offset) : null
        if (!t) setError('請求書の入金日を読めませんでした。一覧形式（年月の列あり）で取り込んでください。')
        setLines(
          t
            ? attach(
                parsed.rows.map((r) => ({ ...r, year: t.year, month: t.month })),
                units,
              )
            : [],
        )
      }
    } catch (err) {
      setError('ファイルを読めませんでした：' + (err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  // 反映前後を出すための下ごしらえ。保存でも同じ waterPatch を使う
  const preview = useMemo(
    () =>
      lines.map((l) => {
        const rec = l.unit ? recordAt.get(`${normRoom(l.unit.room)}|${ymKey(l.year, l.month)}`) : undefined
        const patch = l.unit ? waterPatch(l.unit, rec, l.amount) : null
        return { line: l, rec, patch }
      }),
    [lines, recordAt],
  )
  const matched = preview.filter((p) => p.line.unit && p.patch)
  const unmatched = preview.filter((p) => !p.line.unit)
  const total = matched.reduce((s, p) => s + p.line.amount, 0)
  const months = Array.from(new Set(matched.map((p) => ymKey(p.line.year, p.line.month)))).sort()
  const rebased = matched.filter((p) => p.patch!.rebased).length

  async function save() {
    if (!propertyId || matched.length === 0) return
    setBusy(true)
    setError(null)
    try {
      let raised = 0
      for (const { line, rec, patch } of matched) {
        const u = line.unit!
        const occupied = u.status === '入居' || u.status === '退予'
        const guarantor = rec?.guarantor ?? u.guarantor ?? null
        if (patch!.paidRaised) raised++
        const base: PaymentRecord = rec ?? {
          property_id: propertyId,
          room: String(u.room ?? ''),
          year: line.year,
          month: line.month,
          tenant: u.tenant ?? null,
          tenant_type: u.tenant_type ?? null,
          kana: u.tenant_kana ?? null,
          guarantor: u.guarantor ?? null,
        }
        await paymentRecordsRepo.upsert({
          ...base,
          billed: patch!.billed,
          paid: patch!.paid,
          memo: patch!.memo,
          judgement: deriveJudgement(occupied, patch!.billed, patch!.paid, Boolean(guarantor)),
        })
      }
      // 請求額・判定はマスタから作り直す。水道代は備考に残した目印から拾われるので、
      // あとで賃料を直しても「契約額＋水道代」で組み直される（lib/derive.ts）。
      await resyncProperty(propertyId)
      // 反映後の請求額を表に出し続けるため、記録を読み直す
      setRecords(await paymentRecordsRepo.list(propertyId))
      setDone(
        `${months.length}か月ぶん・${matched.length}件・${yen(total)} を請求額に足しました` +
          `（入金額にも足したのは ${raised}件）。`,
      )
      onDone()
    } catch (err) {
      setError('保存に失敗しました：' + (err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
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
        <h3 className="font-bold text-slate-800">水道代を取込</h3>
        {!embedded && (
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="閉じる">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="px-5 py-4 overflow-y-auto space-y-4">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1.5">
          <p>
            家賃とは別に請求している水道代を、<b>対象月の請求額に足します</b>。
            読める形は2つで、見出しを見て自動で切り替えます。
          </p>
          <p>
            ① <b>一覧形式</b>（おすすめ）… <b>年月・号室・水道代</b> の列。1ファイルで何か月ぶんでも入れられます。
            号室の列が無くても、入居中の部屋が1つだけの物件（阿波座など）はその部屋に当てます。
            <br />② <b>検針表</b>（ルネスの様式）… 号数・氏名・金額と入金日。1ファイル1か月ぶんで、入金日から反映先の月を決めます。
          </p>
          <p>
            入金は総額で届くので、<b>固定分（賃料＋共益費＋駐車・駐輪）をきちんと払っている月は入金額にも同じだけ足します</b>。
            未入金・一部入金の月は請求額だけ増やすので、不足額として出ます。
            同じファイルを取り込み直しても二重にはなりません（備考に足した額を控えています）。
            通帳の総額をそのまま請求額にしていた月は、<b>家賃を超えていた分を水道代とみなして置き換えます</b>。
          </p>
          <button
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
          >
            <Download className="w-3.5 h-3.5" /> 一覧形式の見本をダウンロード
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">物件</label>
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
          {invoicePay && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">反映先の月（検針表）</label>
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
          )}
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
            <Upload className="w-4 h-4" />
            ファイルを選ぶ（.xlsx / .xls / .csv）
            <input
              type="file"
              accept=".xls,.xlsx,.csv"
              onChange={(e) => void onFile(e)}
              className="hidden"
              disabled={!propertyId}
            />
          </label>
          {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
        </div>

        {!propertyId && (
          <p className="text-xs text-slate-500">先に物件を選んでください（号室の突き合わせに使います）。</p>
        )}

        {matched.length > 0 && (
          <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
            <span>
              対象：<b className="text-slate-900">{months.length}か月</b>
              {months.length > 0 && `（${months[0]} 〜 ${months[months.length - 1]}）`}
            </span>
            <span>
              明細：<b>{matched.length}件</b> / 合計 <b>{yen(total)}</b>
            </span>
            {invoicePay && (
              <span>
                入金日：<b>
                  {invoicePay.year}年{invoicePay.month}月末頃
                </b>
              </span>
            )}
          </div>
        )}

        {error && <div className="rounded-lg bg-rose-50 text-rose-700 text-sm px-3 py-2">{error}</div>}
        {done && <div className="rounded-lg bg-emerald-50 text-emerald-700 text-sm px-3 py-2">{done}</div>}
        {unmatched.length > 0 && (
          <div className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            号室が見つからない行が {unmatched.length} 件あります（
            {Array.from(new Set(unmatched.map((p) => p.line.room || '（空欄）'))).join('・')}）。この行は取り込みません。
          </div>
        )}
        {rebased > 0 && (
          <div className="rounded-lg bg-sky-50 text-sky-800 text-sm px-3 py-2">
            {rebased} 件は、既に請求額が家賃を上回っていた月です（通帳の総額をそのまま入れていた月）。
            超えていた分を水道代とみなして置き換えます。反映後の額を確認してください。
          </div>
        )}

        {preview.length > 0 && (
          <div className="overflow-auto max-h-[45vh] rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-3 py-2">対象月</th>
                  <th className="px-3 py-2">号室</th>
                  <th className="px-3 py-2">契約者（台帳）</th>
                  <th className="px-3 py-2 text-right">水道代</th>
                  <th className="px-3 py-2 text-right">固定分</th>
                  <th className="px-3 py-2 text-right">現在の請求額</th>
                  <th className="px-3 py-2 text-right">反映後の請求額</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(({ line, rec, patch }, i) => (
                  <tr key={`${line.year}-${line.month}-${line.room}-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">
                      {line.year}年{line.month}月
                    </td>
                    <td className="px-3 py-1.5 font-medium text-slate-700">
                      {line.unit ? String(line.unit.room) : line.room || '（空欄）'}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {line.unit ? (
                        <span className="text-slate-700">{line.unit.tenant || '（空欄）'}</span>
                      ) : (
                        <span className="text-rose-700">号室が見つからず</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{yen(line.amount)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                      {line.unit ? yen(fixedAmount(line.unit)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                      {rec?.billed != null ? yen(Number(rec.billed)) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">
                      {patch ? yen(patch.billed) : '—'}
                      {patch?.rebased && (
                        <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-700">置換</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-slate-200 shrink-0">
        {!embedded && (
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            閉じる
          </button>
        )}
        <button
          onClick={() => void save()}
          disabled={busy || !propertyId || matched.length === 0}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
          {months.length > 0 ? `${months.length}か月ぶんを請求額に反映` : '反映'}
        </button>
      </div>
    </Shell>
  )
}

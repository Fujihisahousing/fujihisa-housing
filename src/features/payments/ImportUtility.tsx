// 光熱費（水道・電気・ガス）を請求書から取り込む。入力タブの「光熱費を取込」に置く。
//
// 家賃とは別に光熱費を請求している物件（ルネスプランドール守口・プランドール阿波座は水道、
// プランドール道頓堀は水道と電気）で、対象月の請求額に光熱費を足す。読める形は3つ。
//   ① 一覧形式（Excel/CSV） … 年月・号室・水道代（電気代・ガス代）の列。1ファイルで何か月ぶんでも
//   ② 検針表（Excel）       … ルネスの検針表そのまま（号数・氏名・金額＋入金日）。1ファイル1か月ぶん
//   ③ 請求書のPDF           … 道頓堀の請求書のような1テナント宛ての請求書。スキャンしたPDFも読む
// ①②は見出しに「年月」の列があれば①、無ければ②として読む。
//
// 収支表の収入は光熱費1本なので、水道・電気・ガスは分けずに合計して「光熱費」として足す。
// 備考の目印も [光熱費 78336] の1つにする（昔の [水道 …] [電気 …] は取り込み直すと置き換わる）。
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { X, Upload, Loader2, FileSpreadsheet, Download, CheckCircle2, AlertTriangle } from 'lucide-react'
import { unitsRepo, paymentRecordsRepo } from '../../lib/repositories'
import { resyncProperty } from '../../lib/resync'
import { monthIdx } from '../../lib/derive'
import { deriveJudgement } from '../../lib/calc'
import { yen } from '../../lib/format'
import { matchTenantName } from '../../lib/matchTenant'
import {
  parseInvoiceSheet,
  parseWaterListSheet,
  invoiceTargetMonth,
  parseInvoiceDate,
  utilityPatch,
  fixedAmount,
  normRoom,
  readWaterTag,
} from '../../lib/invoiceWater'
import { parseInvoiceText, invoiceTotals, type ParsedInvoiceText } from '../../lib/invoiceText'
import type { PaymentRecord, Property, Unit } from '../../types'

/** 取り込む1件。号室×年月で1行 */
interface Line {
  year: number
  month: number
  /** 請求額に足す光熱費（税込。水道・電気・ガスの合計） */
  amount: number
  /** ファイルに書かれていた号室（当てられなかったときに画面に出す） */
  room: string
  name: string
  unitId: string | null
}

/** PDFを読んだときの控え。読み取り結果を画面で見比べるために持つ */
interface PdfState {
  preview: string
  ocr: boolean
  lines: string[]
  parsed: ParsedInvoiceText
  /** 明細が税抜で、消費税を足して取り込むか */
  taxed: boolean
}

/** 一覧形式の見本CSV。列の並びと年月の書き方を間違えないための雛形 */
function downloadTemplate() {
  const csv = [
    '年月,号室,氏名,光熱費',
    '2024-09,1F,株式会社 キョードーエンタテイメント,4106',
    '2024-10,1F,株式会社 キョードーエンタテイメント,4289',
    '2024-11,1F,株式会社 キョードーエンタテイメント,4651',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = '光熱費取込_見本.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`

const isOccupied = (u: Unit) => u.status === '入居' || u.status === '退予'

/**
 * 同じ号室・年月の行は1行にまとめる（水道代と電気代の列が並んだ一覧、同じ月が2行あるときなど）
 */
function mergeLines(lines: Line[]): Line[] {
  const map = new Map<string, Line>()
  for (const l of lines) {
    const key = `${l.unitId ?? '?' + normRoom(l.room)}|${ymKey(l.year, l.month)}`
    const got = map.get(key)
    if (got) got.amount += l.amount
    else map.set(key, { ...l })
  }
  return Array.from(map.values())
}

/**
 * 号室を当てる。台帳の号室は全角が混ざる（阿波座は「1Ｆ」）ので正規化して突き合わせる。
 * 号室が書かれていないファイルは、入居中の部屋が1つだけならその部屋に寄せる。
 */
function unitOfRoom(room: string, us: Unit[]): string | null {
  if (room) return us.find((u) => normRoom(u.room) === normRoom(room))?.id ?? null
  const occupied = us.filter(isOccupied)
  return occupied.length === 1 ? occupied[0].id : null
}

/**
 * PDFの請求書の宛先の部屋を当てる。賃料の額が一致する部屋 → 宛名の一致 → 入居中が1部屋だけ の順。
 * OCRでは宛名の行が落ちることがあるので、賃料の額を先に見る（道頓堀3F：税抜428,376→税込471,213）。
 */
function unitOfInvoice(p: ParsedInvoiceText, rentIncl: number | null, us: Unit[]): string | null {
  const occupied = us.filter(isOccupied)
  for (const target of [rentIncl, p.rent]) {
    if (target == null) continue
    const hit = occupied.filter((u) => Math.abs(Number(u.rent ?? 0) + Number(u.kyoeki ?? 0) - target) <= 1)
    if (hit.length === 1) return hit[0].id
  }
  if (p.addressee) {
    const m = matchTenantName(p.addressee, occupied)
    if (m.unitId) return m.unitId
  }
  return occupied.length === 1 ? occupied[0].id : null
}

export function ImportUtility({
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
  const [pdf, setPdf] = useState<PdfState | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])

  /** PDFの読み取り結果から取り込む行を作る。税の扱い・対象月・部屋を変えたら作り直す */
  const pdfLines = useCallback(
    (
      p: ParsedInvoiceText,
      taxed: boolean,
      ym: { year: number; month: number } | null,
      unitId: string | null,
    ): Line[] => {
      if (!ym) return []
      if (p.items.length === 0) {
        // 検針表の様式（号室ごとに金額が並ぶ）
        return mergeLines(
          p.rooms.map((r) => ({ ...ym, amount: r.amount, room: r.room, name: r.name, unitId: unitOfRoom(r.room, units) })),
        )
      }
      // 1テナント宛ての請求書。水道・電気などの明細を税込にして合計する
      const t = invoiceTotals(p, taxed)
      const amount = Object.values(t.byLabel).reduce((s, v) => s + (v ?? 0), 0)
      return [{ ...ym, amount, room: '', name: p.addressee, unitId }]
    },
    [units],
  )

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
        setLines((prev) => prev.map((l) => ({ ...l, unitId: l.room ? unitOfRoom(l.room, us) : l.unitId })))
      } catch {
        if (!active) return
        setUnits([])
        setRecords([])
      }
    })()
    return () => {
      active = false
    }
  }, [propertyId])

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

  async function readExcel(file: File) {
    // ライブラリが重いので、ファイルを選んだときだけ読み込む
    const XLSX = await import('xlsx-js-style')
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheetName = wb.SheetNames.find((s) => /検針|水道|電気|光熱/.test(s)) ?? wb.SheetNames[0]
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      blankrows: true,
    }) as unknown[][]

    // まず一覧形式として読む。「年月」の列が無ければ検針表として読み直す
    const list = parseWaterListSheet(grid)
    if (list) {
      setInvoicePay(null)
      if (list.length === 0) {
        setError('明細が読み取れませんでした。「年月・号室・水道代（電気代）」の見出しがある表か確認してください。')
      }
      setLines(mergeLines(list.map((r) => ({ ...r, unitId: unitOfRoom(r.room, units) }))))
      return
    }
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
    setLines(t ? mergeLines(parsed.rows.map((r) => ({ ...r, ...t, unitId: unitOfRoom(r.room, units) }))) : [])
  }

  async function readPdf(file: File) {
    const { readPdfText } = await import('../../lib/invoicePdf')
    const text = await readPdfText(file, setStatus)
    const parsed = parseInvoiceText(text.lines)
    const taxed = parsed.tax != null
    // 対象月は請求書の「〇年〇月分」。書かれていなければ入金日から（検針表と同じ寄せ方）
    const ym = parsed.target ?? (parsed.pay ? invoiceTargetMonth(parsed.pay, offset) : null)
    setInvoicePay(parsed.target ? null : parsed.pay)
    setPdf({ preview: text.preview, ocr: text.ocr, lines: text.lines, parsed, taxed })
    const unitId = unitOfInvoice(parsed, invoiceTotals(parsed, taxed).rent, units)
    setLines(pdfLines(parsed, taxed, ym, unitId))
    if (parsed.items.length === 0 && parsed.rooms.length === 0) {
      setError(
        '光熱費の明細が読み取れませんでした。「水道」「電気」「ガス」と金額（〇〇円）が同じ行にある請求書か確認してください。' +
          (text.ocr ? 'スキャンが傾いていたり薄かったりすると読めないことがあります。' : ''),
      )
    } else if (!ym) {
      setError('請求書の対象月（「令和〇年〇月分」）が読み取れませんでした。下で対象月を選んでください。')
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setDone(null)
    setPdf(null)
    setLines([])
    setInvoicePay(null)
    setFileName(file.name)
    setBusy(true)
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') await readPdf(file)
      else await readExcel(file)
    } catch (err) {
      setError('ファイルを読めませんでした：' + (err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
      setStatus('')
      e.target.value = ''
    }
  }

  // PDFの取込で、税の扱い・対象月を選び直したら行を作り直す（部屋の選び直しは引き継ぐ）
  const pdfYm = lines[0] ? { year: lines[0].year, month: lines[0].month } : (pdf?.parsed.target ?? null)
  function rebuildPdf(next: { taxed?: boolean; ym?: { year: number; month: number } | null }) {
    if (!pdf) return
    const taxed = next.taxed ?? pdf.taxed
    if (next.taxed != null) setPdf({ ...pdf, taxed })
    const unitId = lines[0]?.unitId ?? unitOfInvoice(pdf.parsed, invoiceTotals(pdf.parsed, taxed).rent, units)
    setLines(pdfLines(pdf.parsed, taxed, next.ym !== undefined ? next.ym : pdfYm, unitId))
  }

  // 号室×年月ごとにまとめる。請求額への足し込みはこの単位で行う
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; year: number; month: number; unit: Unit | null; room: string; idx: number[] }>()
    lines.forEach((l, i) => {
      const unit = l.unitId ? unitById.get(l.unitId) ?? null : null
      const key = `${unit ? unit.id : '?' + normRoom(l.room)}|${ymKey(l.year, l.month)}`
      const g = map.get(key) ?? { key, year: l.year, month: l.month, unit, room: l.room, idx: [] }
      g.idx.push(i)
      map.set(key, g)
    })
    return Array.from(map.values())
      .sort(
        (a, b) =>
          a.year - b.year ||
          a.month - b.month ||
          String(a.unit?.room ?? a.room).localeCompare(String(b.unit?.room ?? b.room), 'ja'),
      )
      .map((g) => {
        // 号室を選び直して同じ部屋・同じ月の行が2つになったときは足す
        const amount = g.idx.reduce((s, i) => s + lines[i].amount, 0)
        const rec = g.unit ? recordAt.get(`${normRoom(g.unit.room)}|${ymKey(g.year, g.month)}`) : undefined
        const patch = g.unit ? utilityPatch(g.unit, rec, amount) : null
        return { ...g, amount, rec, patch }
      })
  }, [lines, unitById, recordAt])

  const matched = groups.filter((g) => g.unit && g.patch)
  const unmatched = groups.filter((g) => !g.unit)
  const total = matched.reduce((s, g) => s + g.amount, 0)
  const months = Array.from(new Set(matched.map((g) => ymKey(g.year, g.month)))).sort()
  const rebased = matched.filter((g) => g.patch!.rebased).length
  const pdfTotals = pdf ? invoiceTotals(pdf.parsed, pdf.taxed) : null

  function setAmount(i: number, v: string) {
    const amount = Number(v.replace(/[^\d]/g, '')) || 0
    setLines((prev) => prev.map((l, k) => (k === i ? { ...l, amount } : l)))
  }
  function setGroupUnit(idx: number[], unitId: string) {
    setLines((prev) => prev.map((l, k) => (idx.includes(k) ? { ...l, unitId: unitId || null } : l)))
  }

  async function save() {
    if (!propertyId || matched.length === 0) return
    setBusy(true)
    setError(null)
    try {
      let raised = 0
      for (const { unit, year, month, rec, patch } of matched) {
        const u = unit!
        const guarantor = rec?.guarantor ?? u.guarantor ?? null
        if (patch!.paidRaised) raised++
        const base: PaymentRecord = rec ?? {
          property_id: propertyId,
          room: String(u.room ?? ''),
          year,
          month,
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
          judgement: deriveJudgement(isOccupied(u), patch!.billed, patch!.paid, Boolean(guarantor)),
        })
      }
      // 請求額・判定はマスタから作り直す。光熱費は備考に残した目印から拾われるので、
      // あとで賃料を直しても「契約額＋光熱費」で組み直される（lib/derive.ts）。
      // 対象は取り込んだ請求書の月だけに絞る。全期間を作り直すと、手で合わせた
      // ほかの月まで自動計算に巻き戻ってしまう。
      await resyncProperty(
        propertyId,
        undefined,
        matched.map((g) => monthIdx(g.year, g.month)),
      )
      // 反映後の請求額を表に出し続けるため、記録を読み直す
      setRecords(await paymentRecordsRepo.list(propertyId))
      setDone(
        `${months.length}か月ぶん・${matched.length}件・${yen(total)} を請求額に反映しました` +
          `（入金額にも足したのは ${raised}件）。`,
      )
      onDone()
    } catch (err) {
      setError('保存に失敗しました：' + (err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div className="flex items-center justify-between px-5 h-14 border-b border-slate-200 shrink-0">
      <h3 className="font-bold text-slate-800">光熱費を取込</h3>
      {!embedded && (
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="閉じる">
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  )

  const body = (
    <div className="px-5 py-4 overflow-y-auto space-y-4">
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1.5">
        <p>
          家賃とは別に請求している光熱費（水道・電気・ガス）を、<b>対象月の請求額に足します</b>。
          読める形は3つで、ファイルを見て自動で切り替えます。
        </p>
        <p>
          ① <b>一覧形式</b>（Excel・CSV）… <b>年月・号室・光熱費</b> の列（「水道代」「電気代」など費目別の列が並んでいれば合計します）。1ファイルで何か月ぶんでも入れられます。
          号室の列が無くても、入居中の部屋が1つだけの物件（阿波座など）はその部屋に当てます。
          <br />② <b>検針表</b>（ルネスの様式）… 号数・氏名・金額と入金日。1ファイル1か月ぶんで、入金日から反映先の月を決めます。
          <br />③ <b>請求書のPDF</b>（道頓堀の様式）… 「水道」「電気」などの行を合計して光熱費とし、「令和〇年〇月分」を対象月にします。
          <b>スキャンしたPDFは文字を自動で読み取る</b>ので、反映する前に請求書の画像と金額を見比べてください（表の金額は直せます）。
          明細が税抜で「消費税」の行がある請求書は、10%を足して税込で取り込みます。
        </p>
        <p>
          入金は総額で届くので、<b>固定分（賃料＋共益費＋駐車・駐輪）をきちんと払っている月は入金額にも同じだけ足します</b>。
          未入金・一部入金の月は請求額だけ増やすので、不足額として出ます。
          同じファイルを取り込み直しても二重にはなりません（備考に [光熱費 〇〇] の形で足した額を控えています。昔の [水道 〇〇] [電気 〇〇] も光熱費として読み、取り込み直すと置き換えます）。
          通帳の総額をそのまま請求額にしていた月は、<b>家賃を超えていた分を光熱費とみなして置き換えます</b>。
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
        <label
          className={
            'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 ' +
            (propertyId && !busy ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-50 cursor-not-allowed')
          }
        >
          <Upload className="w-4 h-4" />
          ファイルを選ぶ（.xlsx / .xls / .csv / .pdf）
          <input
            type="file"
            accept=".xls,.xlsx,.csv,.pdf,application/pdf"
            onChange={(e) => void onFile(e)}
            className="hidden"
            disabled={!propertyId || busy}
          />
        </label>
        {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
      </div>

      {!propertyId && (
        <p className="text-xs text-slate-500">先に物件を選んでください（号室の突き合わせに使います）。</p>
      )}
      {busy && status && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 text-slate-600 text-sm px-3 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {status}
        </div>
      )}

      {pdf && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,280px)_1fr]">
          <a href={pdf.preview} target="_blank" rel="noreferrer" title="クリックで大きく表示">
            <img src={pdf.preview} alt="読み取った請求書" className="w-full rounded-lg border border-slate-200" />
          </a>
          <div className="space-y-2 text-sm text-slate-700 min-w-0">
            <p className="text-xs text-slate-500">
              {pdf.ocr
                ? 'スキャンしたPDFなので、文字を自動で読み取りました。読み違いがないか左の請求書と見比べてください。'
                : 'PDFの文字データを読み取りました。'}
            </p>
            <table className="text-sm">
              <tbody>
                <tr>
                  <td className="pr-4 py-0.5 text-slate-500 whitespace-nowrap">宛名</td>
                  <td>{pdf.parsed.addressee || '（読み取れず）'}</td>
                </tr>
                {pdf.parsed.rent != null && (
                  <tr>
                    <td className="pr-4 py-0.5 text-slate-500 whitespace-nowrap">賃料・共益費</td>
                    <td className="tabular-nums">
                      {yen(pdf.parsed.rent)}
                      {pdf.taxed && pdfTotals?.rent != null && ` → 税込 ${yen(pdfTotals.rent)}`}
                      <span className="ml-1 text-xs text-slate-400">（部屋を当てるのに使うだけで、取り込みません）</span>
                    </td>
                  </tr>
                )}
                {pdf.parsed.items.map((it, i) => (
                  <tr key={i}>
                    <td className="pr-4 py-0.5 text-slate-500 whitespace-nowrap">{it.label}</td>
                    <td className="tabular-nums">
                      {yen(it.amount)} <span className="text-xs text-slate-400 break-all">「{it.text}」</span>
                    </td>
                  </tr>
                ))}
                {pdf.parsed.tax != null && (
                  <tr>
                    <td className="pr-4 py-0.5 text-slate-500 whitespace-nowrap">消費税</td>
                    <td className="tabular-nums">{yen(pdf.parsed.tax)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {pdf.parsed.items.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={pdf.taxed} onChange={(e) => rebuildPdf({ taxed: e.target.checked })} />
                明細は税抜（消費税10%を足して取り込む）
              </label>
            )}
            {pdfTotals && pdfTotals.subtotalOk != null && (
              <Check ok={pdfTotals.subtotalOk}>
                {pdfTotals.subtotalOk
                  ? '明細の合計が小計と一致'
                  : `明細の合計が小計 ${yen(pdf.parsed.subtotal!)} と合いません（読み落としか読み違いがあります）`}
              </Check>
            )}
            {pdfTotals && pdfTotals.totalOk != null && (
              <Check ok={pdfTotals.totalOk}>
                {pdfTotals.totalOk
                  ? `賃料＋光熱費（税込）${yen(pdfTotals.computedTotal)} が総合計と一致`
                  : `賃料＋光熱費（税込）${yen(pdfTotals.computedTotal)} が総合計 ${yen(pdf.parsed.total!)} と合いません`}
              </Check>
            )}
            {pdf.parsed.items.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">対象月</label>
                <input
                  type="month"
                  value={pdfYm ? ymKey(pdfYm.year, pdfYm.month) : ''}
                  onChange={(e) => {
                    const m = e.target.value.match(/^(\d{4})-(\d{2})$/)
                    rebuildPdf({ ym: m ? { year: Number(m[1]), month: Number(m[2]) } : null })
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
                />
              </div>
            )}
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">読み取った文字をすべて見る</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{pdf.lines.join('\n')}</pre>
            </details>
          </div>
        </div>
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
          {Array.from(new Set(unmatched.map((g) => g.room || '（空欄）'))).join('・')}）。表で号室を選べば取り込めます。選ばなければ取り込みません。
        </div>
      )}
      {rebased > 0 && (
        <div className="rounded-lg bg-sky-50 text-sky-800 text-sm px-3 py-2">
          {rebased} 件は、既に請求額が家賃を上回っていた月です（通帳の総額をそのまま入れていた月）。
          超えていた分を光熱費とみなして置き換えます。反映後の額を確認してください。
        </div>
      )}

      {groups.length > 0 && (
        <div className="overflow-auto max-h-[45vh] rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-3 py-2">対象月</th>
                <th className="px-3 py-2">号室</th>
                <th className="px-3 py-2">契約者（台帳）</th>
                <th className="px-3 py-2 text-right">光熱費（税込）</th>
                <th className="px-3 py-2 text-right">固定分</th>
                <th className="px-3 py-2 text-right">現在の請求額</th>
                <th className="px-3 py-2 text-right">反映後の請求額</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">
                    {g.year}年{g.month}月
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={g.unit?.id ?? ''}
                      onChange={(e) => setGroupUnit(g.idx, e.target.value)}
                      className={
                        'rounded border px-1.5 py-0.5 text-sm bg-white ' +
                        (g.unit ? 'border-slate-300 text-slate-700' : 'border-rose-300 text-rose-700')
                      }
                      title={g.room ? `ファイルの号室：${g.room}` : undefined}
                    >
                      <option value="">{g.room ? `${g.room}（未対応）` : '選択'}</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {String(u.room ?? '')}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">
                    {g.unit ? g.unit.tenant || '（空欄）' : <span className="text-rose-700">号室を選んでください</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      {g.idx.map((i) => (
                        <label key={i} className="flex items-center gap-1 text-slate-700">
                          <input
                            inputMode="numeric"
                            value={lines[i].amount.toLocaleString('ja-JP')}
                            onChange={(e) => setAmount(i, e.target.value)}
                            className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-right tabular-nums"
                          />
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {g.unit ? yen(fixedAmount(g.unit)) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {g.rec?.billed != null ? yen(Number(g.rec.billed)) : '—'}
                    <CurrentTags memo={g.rec?.memo} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-900">
                    {g.patch ? yen(g.patch.billed) : '—'}
                    {g.patch?.rebased && (
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
  )

  const footer = (
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
  )

  // 枠は関数で包む。中で部品（コンポーネント）として定義すると描画のたびに作り直され、
  // 表の金額欄が1文字打つごとにフォーカスを失う
  const content = (
    <>
      {header}
      {body}
      {footer}
    </>
  )
  return embedded ? (
    <div className="rounded-2xl bg-white border border-slate-200 flex flex-col">{content}</div>
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-xl">
        {content}
      </div>
    </div>
  )
}

/** 検算の結果を1行で出す */
function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p className={'flex items-start gap-1 text-xs ' + (ok ? 'text-emerald-700' : 'text-rose-700')}>
      {ok ? (
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
      )}
      <span>{children}</span>
    </p>
  )
}

/** いま備考に入っている光熱費の目印の合計（取り込むと、この額を戻してから新しい額を足す） */
function CurrentTags({ memo }: { memo: string | null | undefined }) {
  const v = readWaterTag(memo)
  if (v === 0) return null
  return <div className="text-[11px] text-slate-400 whitespace-nowrap">うち光熱費 {yen(v)}</div>
}

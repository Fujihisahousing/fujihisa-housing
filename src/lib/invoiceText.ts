// PDFの請求書から読み取った文字（1行ずつ）を、光熱費の取込に使える形に直す。
//
// 文字の取り出し（PDFの文字データ／スキャンPDFのOCR）は lib/invoicePdf.ts。
// ここは文字列だけを相手にするので、ブラウザが無くても検算できる。
//
// 想定している請求書（道頓堀の各テナント宛て。複合機でスキャンしたPDF）
//   株式会社ブライト御中
//   賃料・共益費 令和8年9月分              428,376円
//   水道        7/20 〜 8/18 … 13㎥       1,974円
//   電気基本料金                          30,000円
//   電気（電灯） 7/20 〜 8/18 … 945kwh    17,105円
//   電気（動力） 7/20 〜 8/18 … 1,223kwh  22,136円
//   消費税10%                             49,958円
//   小計 499,591円 / 総合計 549,549円
// 明細の金額は税抜で、消費税が別の行にまとめて載る。RentBook の請求額と備考の目印は
// 税込で持っているので（道頓堀3F 2026年9月分＝[水道 2171] [電気 76165]）、費目ごとに
// 税抜の合計へ10%を足し、1円未満を切り捨てて税込にする。
//
// OCRの読み違いを前提にしている。
//   ・金額の区切りが「1.974円」「17., 105円」「30, 000円」のように崩れる → 数字だけ拾う
//   ・「電気（動力）」が「(福 動力)」になる → 電気／電灯／動力／kwh のどれかで電気とみなす
//   ・宛名の「御中」の行が丸ごと落ちることがある → 賃料の額でも号室を当てる（画面側）
import { toHalf, parseInvoiceDate, labelOfHead, type ImportLabel } from './invoiceWater'

export interface InvoiceItem {
  label: ImportLabel
  /** 請求書に書かれている額（税抜のことが多い） */
  amount: number
  /** 読み取った行そのもの。画面で読み違いを確かめるために出す */
  text: string
}

export interface ParsedInvoiceText {
  /** 「令和8年9月分」の年月。請求書の対象月 */
  target: { year: number; month: number } | null
  /** 検針表の「入金日」。対象月が書かれていない様式のときに使う */
  pay: { year: number; month: number } | null
  /** 宛名（「〇〇御中」「〇〇様」の〇〇）。読めなければ空 */
  addressee: string
  /** 賃料・共益費の行の額（請求書の表記のまま）。無ければ null */
  rent: number | null
  /** 光熱費の明細 */
  items: InvoiceItem[]
  /** 消費税の行の額。この行があれば明細は税抜とみなす */
  tax: number | null
  subtotal: number | null
  total: number | null
  /** 検針表のように号室ごとに金額が並ぶ様式の明細（items が空のときだけ使う） */
  rooms: { room: string; name: string; amount: number }[]
}

/** 照合用に整える。全角→半角（NFKC で ㎥→m3 も揃う）・空白を除く */
const compact = (s: string) => toHalf(s).normalize('NFKC').replace(/\s+/g, '')

/**
 * 行の中のいちばん右の「〇〇円」を数値にする。
 * 区切りの崩れ（1.974 / 17., 105 / 30, 000）を許し、数字だけをつなげる。
 */
export function yenOf(line: string): number | null {
  const s = toHalf(line).normalize('NFKC')
  const re = /(\d{1,3}(?:\s?[,.]{1,2}\s?\d{3})+|\d+)\s*円/g
  let last: string | null = null
  for (const m of s.matchAll(re)) last = m[1]
  if (last == null) return null
  const v = Number(last.replace(/\D/g, ''))
  return Number.isFinite(v) ? v : null
}

/** 光熱費の行なら費目を返す。ガスは㎥で数えるので水道より先に見る */
function utilityLabelOfLine(c: string): ImportLabel | null {
  if (/ガス/.test(c)) return 'ガス'
  if (/電気|電灯|動力|kwh/i.test(c)) return '電気'
  if (/水道|上水|下水|m3/.test(c)) return '水道'
  return labelOfHead(c)
}

export function parseInvoiceText(lines: string[]): ParsedInvoiceText {
  const out: ParsedInvoiceText = {
    target: null,
    pay: null,
    addressee: '',
    rent: null,
    items: [],
    tax: null,
    subtotal: null,
    total: null,
    rooms: [],
  }
  let roomHead = false
  for (const raw of lines) {
    const c = compact(raw)
    if (!c) continue

    // 「※令和7年6月分より賃料増額」のような注記にも「〇月分」が出るので、
    // 金額の入った行（賃料・共益費 令和8年9月分 428,376円）で見つけたものを優先する
    {
      const r = c.match(/令和(\d{1,2})年(\d{1,2})月分/)
      const g = c.match(/(\d{4})年(\d{1,2})月分/)
      const ym = r
        ? { year: 2018 + Number(r[1]), month: Number(r[2]) }
        : g
          ? { year: Number(g[1]), month: Number(g[2]) }
          : null
      if (ym && (!out.target || /円/.test(c)) && !/より/.test(c)) out.target = ym
    }
    if (!out.pay && /入金日/.test(c)) out.pay = parseInvoiceDate(c.slice(c.indexOf('入金日')))
    if (!out.addressee) {
      const a = c.match(/^(.*?)(御中|様)/)
      // 「お客様」のような文中の「様」を拾わないよう、名前らしい長さがあるものだけ
      if (a && a[1].length >= 2 && !/お客/.test(a[1])) out.addressee = a[1]
    }

    // 検針表の様式（号数・氏名・金額）。見出しより下の「号室で始まる行」を明細とみなす
    if (/^号/.test(c) && /金額/.test(c)) {
      roomHead = true
      continue
    }
    if (roomHead) {
      if (/合計/.test(c)) {
        roomHead = false
        continue
      }
      const tokens = toHalf(raw).normalize('NFKC').trim().split(/\s+/)
      const room = tokens[0]?.match(/^\d{2,4}[A-Z]?$/i) ? tokens[0] : null
      const last = tokens[tokens.length - 1]?.replace(/[,円]/g, '')
      if (room && tokens.length >= 2 && /^\d+$/.test(last ?? '')) {
        const name = tokens.slice(1).filter((t) => !/^[\d,.]+[A-Za-z㎥]*$/.test(t)).join(' ')
        out.rooms.push({ room, name, amount: Number(last) })
        continue
      }
    }

    const yen = yenOf(raw)
    if (yen == null) continue
    if (/消費税/.test(c)) out.tax = yen
    else if (/小計/.test(c)) out.subtotal = yen
    else if (/総合計|請求金額|ご請求額/.test(c)) out.total = yen
    else if (/合計/.test(c)) out.total ??= yen
    else if (/賃料|家賃|共益費|管理費/.test(c)) out.rent = (out.rent ?? 0) + yen
    else {
      const label = utilityLabelOfLine(c)
      if (label) out.items.push({ label, amount: yen, text: raw.trim() })
    }
  }
  return out
}

/** 税抜の額に消費税10%を足して1円未満を切り捨てる。小数の誤差を避けるため整数で計算する */
export const withTax = (yen: number) => Math.floor((yen * 11) / 10)

export interface InvoiceTotals {
  /** 費目ごとの税込額（taxed=false なら書かれている額のまま） */
  byLabel: Partial<Record<ImportLabel, number>>
  /** 賃料の税込額。賃料の行が無ければ null */
  rent: number | null
  /** 明細（賃料＋光熱費）を足した額が「小計」と合うか。小計が無ければ null */
  subtotalOk: boolean | null
  /** 税込の賃料＋光熱費が「総合計」と合うか。総合計が無ければ null */
  totalOk: boolean | null
  /** 税込で足した総額 */
  computedTotal: number
}

/**
 * 費目ごとに足して税込に直し、請求書の小計・総合計と突き合わせる。
 * OCRで行が落ちたり金額を読み違えたりすると、ここが合わなくなるので画面で警告する。
 */
export function invoiceTotals(p: ParsedInvoiceText, taxed: boolean): InvoiceTotals {
  const raw: Partial<Record<ImportLabel, number>> = {}
  for (const it of p.items) raw[it.label] = (raw[it.label] ?? 0) + it.amount
  const byLabel: Partial<Record<ImportLabel, number>> = {}
  for (const [label, yen] of Object.entries(raw) as [ImportLabel, number][]) {
    byLabel[label] = taxed ? withTax(yen) : yen
  }
  const rent = p.rent == null ? null : taxed ? withTax(p.rent) : p.rent
  const utilRaw = Object.values(raw).reduce((s, v) => s + (v ?? 0), 0)
  const utilIncl = Object.values(byLabel).reduce((s, v) => s + (v ?? 0), 0)
  const computedTotal = (rent ?? 0) + utilIncl
  // 消費税は明細ごとに端数を切るので、総合計は数円ずれることがある
  const near = (a: number, b: number) => Math.abs(a - b) <= 3
  return {
    byLabel,
    rent,
    subtotalOk: p.subtotal == null ? null : p.subtotal === (p.rent ?? 0) + utilRaw,
    totalOk: p.total == null ? null : near(p.total, computedTotal),
    computedTotal,
  }
}

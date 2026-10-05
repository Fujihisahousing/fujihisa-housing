// PDFの請求書から読み取った文字（1行ずつ）を、光熱費の取込に使える形に直す。
//
// 文字の取り出し（PDFの文字データ／スキャンPDFのOCR）は lib/invoicePdf.ts。
// ここは文字列だけを相手にするので、ブラウザが無くても検算できる。
//
// 想定している請求書（道頓堀の各テナント宛て。複合機でスキャンしたPDF）
//   株式会社ブライト御中
//   賃料・共益費 令和8年9月分              428,376円
//   水道／電気基本料金／電気（電灯）／電気（動力） … 検針値・使用量・金額
//   消費税10% / 小計 / 総合計 549,549円
//   請求金額 549,549円
// 光熱費は明細から組み立てない（電気の単価や基本料金、消費税の端数まで追うことになる）。
// 請求金額から台帳の家賃・共益費を引いた残りを光熱費とする（画面側。ユーザー指示 2026-10-05）。
// ここで拾うのは 請求金額・対象月・宛名・賃料の行 だけ。
//
// OCRの読み違いを前提にしている。
//   ・金額の区切りが「549, 549円」「1.974円」のように崩れる → 数字だけ拾う
//   ・宛名の「御中」の行が丸ごと落ちることがある → 賃料の額でも号室を当てる（画面側）
import { toHalf, parseInvoiceDate } from './invoiceWater'

export interface ParsedInvoiceText {
  /** 「令和8年9月分」の年月。請求書の対象月 */
  target: { year: number; month: number } | null
  /** 検針表の「入金日」。対象月が書かれていない様式のときに使う */
  pay: { year: number; month: number } | null
  /** 宛名（「〇〇御中」「〇〇様」の〇〇）。読めなければ空 */
  addressee: string
  /** 賃料・共益費の行の額（請求書の表記のまま。税抜のことがある）。部屋を当てるのに使う */
  rent: number | null
  /** 請求金額（総合計）。光熱費はここから家賃・共益費を引いて出す */
  total: number | null
  /** 検針表のように号室ごとに金額が並ぶ様式の明細 */
  rooms: { room: string; name: string; amount: number }[]
}

/** 照合用に整える。全角→半角・空白を除く */
const compact = (s: string) => toHalf(s).normalize('NFKC').replace(/\s+/g, '')

/**
 * 行の中のいちばん右の「〇〇円」を数値にする。
 * 区切りの崩れ（1.974 / 17., 105 / 549, 549）を許し、数字だけをつなげる。
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

export function parseInvoiceText(lines: string[]): ParsedInvoiceText {
  const out: ParsedInvoiceText = { target: null, pay: null, addressee: '', rent: null, total: null, rooms: [] }
  // 請求金額は「請求金額」の行を最優先、次に「総合計」、最後に「合計」
  let totalRank = 0
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
    const rank = /請求金額|ご請求額/.test(c) ? 3 : /総合計/.test(c) ? 2 : /合計/.test(c) && !/小計/.test(c) ? 1 : 0
    if (rank > totalRank) {
      out.total = yen
      totalRank = rank
    } else if (rank === 0 && out.rent == null && /賃料|家賃|共益費/.test(c) && !/消費税|小計/.test(c)) {
      out.rent = yen
    }
  }
  return out
}

/** 税抜の額に消費税10%を足して1円未満を切り捨てる。小数の誤差を避けるため整数で計算する */
export const withTax = (yen: number) => Math.floor((yen * 11) / 10)

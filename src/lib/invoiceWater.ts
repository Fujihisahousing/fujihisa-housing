// 水道代の請求書（検針表のExcel）を読んで、入金状況の請求額に足すための下ごしらえ。
//
// ルネスプランドール守口では、入居者の支払いが 家賃＋共益費＋駐車場代＋水道代 になる。
// 水道代だけは2か月に1回・使用量ぶんの変動額なので、こちらで作って送っている請求書
// （検針表）から取り込む。号数・氏名・金額・入金日の4つだけを見る。
//
// シートの体裁（ルネスの検針表）
//   0行目  ルネス・プランドール守口 ... 入金日 | 令和8年7月末頃
//   2行目  =TODAY() の「◯月分」と検針期間 … 実データではないので読まない
//   4行目  号　数 | 氏　名 | 前回 | 今回 | 差(㎥) | 金額(円)
//   5行目〜 明細。最後に「合　　　計」の行が入る（号数が数字でないので自然に外れる）
import type { Unit } from '../types'
import { parkingYen } from './calc'

const n = (v: unknown) => Number(v ?? 0) || 0

/** 全角数字・全角空白を半角に寄せる。号室や金額が全角で入っていても拾えるように */
export const toHalf = (s: string) =>
  String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')

/** セルの値を数値にする。'1,234' や '￥1,234'、全角数字も拾う。数字でなければ null */
export function cellNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = toHalf(String(v ?? '')).match(/-?[0-9][0-9,]*/)
  return m ? Number(m[0].replace(/,/g, '')) : null
}

/**
 * 「令和8年7月末頃」→ { year: 2026, month: 7 }。令和1年＝2019年なので 2018 + 元号年。
 * 西暦表記（2026年7月）も受ける。読めなければ null。
 */
export function parseInvoiceDate(v: unknown): { year: number; month: number } | null {
  const s = toHalf(String(v ?? ''))
  const r = s.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月/)
  if (r) return { year: 2018 + Number(r[1]), month: Number(r[2]) }
  const g = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  if (g) return { year: Number(g[1]), month: Number(g[2]) }
  return null
}

/**
 * 入金日の年月から、請求額に足す対象月を出す。
 *
 * offset=2 … 令和8年7月末頃の入金 → 令和8年9月分（ユーザー指定のルール）
 * offset=1 … 令和8年7月末頃の入金 → 令和8年8月分（前家賃と同じ寄せ方）
 *
 * 通帳では2026年7月分の請求書の水道代が8月上旬に入金されており、
 * 前家賃の帰属だと8月分になる。どちらで運用するかは取込画面で選べるようにしている。
 */
export function invoiceTargetMonth(
  pay: { year: number; month: number },
  offset: number,
): { year: number; month: number } {
  const idx = pay.year * 12 + (pay.month - 1) + offset
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export interface InvoiceRow {
  room: string
  name: string
  amount: number
}

export interface ParsedInvoice {
  /** 請求書に書かれている入金日（読めなければ null） */
  pay: { year: number; month: number } | null
  rows: InvoiceRow[]
}

/**
 * 検針表のシート（sheet_to_json の header:1 形式）から入金日と明細を取り出す。
 * 見出し行は「号」「氏」「金額」を含む行として探す。列の並びが多少違っても拾えるようにする。
 */
export function parseInvoiceSheet(grid: unknown[][]): ParsedInvoice {
  let pay: { year: number; month: number } | null = null
  // 入金日：'入金日' と書かれたセルの右隣（空セルは飛ばす）を見る
  outer: for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      if (!/入金日/.test(String(row[c] ?? ''))) continue
      for (let k = c + 1; k < row.length; k++) {
        const got = parseInvoiceDate(row[k])
        if (got) {
          pay = got
          break outer
        }
      }
    }
  }

  // 見出し行を探す
  let head = -1
  let cRoom = 0
  let cName = 1
  let cAmount = -1
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = (grid[r] ?? []).map((v) => toHalf(String(v ?? '')).replace(/\s+/g, ''))
    const iRoom = row.findIndex((v) => /^号/.test(v))
    const iName = row.findIndex((v) => /^氏/.test(v))
    const iAmt = row.findIndex((v) => /金額/.test(v))
    if (iRoom >= 0 && iName >= 0 && iAmt >= 0) {
      head = r
      cRoom = iRoom
      cName = iName
      cAmount = iAmt
      break
    }
  }
  if (head < 0) return { pay, rows: [] }

  const rows: InvoiceRow[] = []
  for (let r = head + 1; r < grid.length; r++) {
    const row = grid[r] ?? []
    const room = cellNumber(row[cRoom])
    // 号数が数字でない行（「合　　　計」や注記）で明細は終わり
    if (room == null) continue
    const amount = cellNumber(row[cAmount])
    if (amount == null || amount <= 0) continue
    rows.push({
      room: String(room),
      name: toHalf(String(row[cName] ?? '')).replace(/\s+/g, ' ').trim(),
      amount,
    })
  }
  return { pay, rows }
}

// ---------------------------------------------------------------------
// 記録への足し込み
// ---------------------------------------------------------------------

/** 月次記録の備考に残す目印。同じ請求書を何度取り込んでも二重に足さないために使う */
const TAG = /\[水道\s*(-?\d+)\]/

/** 備考に残っている「前回この取込で足した水道代」。無ければ0 */
export function readWaterTag(memo: string | null | undefined): number {
  const m = TAG.exec(String(memo ?? ''))
  return m ? Number(m[1]) : 0
}

/** 備考の目印を新しい金額に貼り替える（元の文言は残す） */
export function writeWaterTag(memo: string | null | undefined, water: number): string {
  const base = String(memo ?? '').replace(TAG, '').replace(/\s{2,}/g, ' ').trim()
  const tag = `[水道 ${water}]`
  return base ? `${base} ${tag}` : tag
}

/** その部屋の固定分（賃料＋共益費＋駐輪駐車）。水道代を足す前の土台 */
export const fixedAmount = (u: Unit) => n(u.rent) + n(u.kyoeki) + parkingYen(u.parking)

export interface WaterPatch {
  billed: number
  paid: number
  memo: string
  /** 入金額に水道代を足したか。未入金・一部入金の月には足さない */
  paidRaised: boolean
}

/**
 * 1件ぶんの足し込みを計算する。前回の目印ぶんを一度戻してから足すので、
 * 同じ請求書を取り込み直しても二重にならない。
 *
 * 入金額は「固定分をきちんと払っている月」だけ水道代を足す。
 * 未入金・一部入金の月に足すと、受け取っていないお金を受け取ったことにしてしまうため。
 */
export function waterPatch(
  unit: Unit,
  rec: { billed?: number | null; paid?: number | null; memo?: string | null } | undefined,
  water: number,
): WaterPatch {
  const prev = readWaterTag(rec?.memo)
  const fixed = fixedAmount(unit)
  const baseBilled = rec?.billed != null ? n(rec.billed) - prev : fixed
  const basePaid = rec?.paid != null ? n(rec.paid) - prev : 0
  const raise = basePaid > 0 && basePaid >= baseBilled
  return {
    billed: baseBilled + water,
    paid: raise ? basePaid + water : basePaid,
    memo: writeWaterTag(rec?.memo, water),
    paidRaised: raise,
  }
}

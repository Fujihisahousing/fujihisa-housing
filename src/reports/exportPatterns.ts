// 用途別のExcel出力パターン。1つのブックに複数シートをまとめて書き出す。
//   ①現況報告用      … レントロール（指定項目のみ）
//   ②収入支出一覧用  … 収支表
//   ③販売業者提出用  … 物件概要／レントロール／収支表／入金状況
//                       元金・利息は載せない。入居者の氏名は伏せる（社外に出る書類のため）
import { calcIncomeStatement, calcPaymentStatus, isStatementRowVisible, FISCAL_MONTHS, FISCAL_PREV_YEAR_COLS } from '../lib/calc'
import { unitCompare } from '../lib/sortUnits'
import type { PaymentRecord, Property, RentHistory, Transaction, Unit } from '../types'
import { CAT_RENT } from '../types'

type XlsxModule = typeof import('xlsx-js-style')

export type ExportPattern = 'genkyo' | 'shushi' | 'hanbai'

export const EXPORT_PATTERNS: { key: ExportPattern; label: string; hint: string }[] = [
  { key: 'genkyo', label: '現況報告用', hint: 'レントロール（物件情報＋部屋ごとの賃料・状況）' },
  { key: 'shushi', label: '収入支出一覧用', hint: '収支表（年度の収入・支出）' },
  { key: 'hanbai', label: '販売業者提出用', hint: '物件概要／レントロール／収支表／入金状況。元金・利息は除外し氏名は伏せる' },
]

type Cell = string | number | null
/**
 * 書き出す1シート。rows のほかに見た目の指定を持たせ、exportPattern でまとめて装飾する。
 * ※スタイルの書き出しには xlsx-js-style を使う（本家 xlsx のコミュニティ版は
 *   色・太字・罫線を書き出せない）。ウィンドウ枠の固定は xlsx-js-style でも非対応。
 */
type Sheet = {
  name: string
  rows: Cell[][]
  /** 列幅（文字数目安）。省略時は自動 */
  cols?: number[]
  /** 見出し行のインデックス（0始まり）。濃い背景＋白文字にする */
  headerRow?: number
  /** ¥表示にする列 */
  moneyCols?: number[]
  /** 状況の列。値ごとに色を変える */
  statusCol?: number
}

// 画面の配色に合わせた Excel 用のパレット
const C = {
  ink: '0F172A',
  headerBg: '334155',
  headerText: 'FFFFFF',
  border: 'E2E8F0',
  band: 'F8FAFC',
  sub: '64748B',
}
const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  入居: { bg: 'DCFCE7', text: '166534' },
  空室: { bg: 'FEE2E2', text: '991B1B' },
  入予: { bg: 'DBEAFE', text: '1E40AF' },
  退予: { bg: 'FEF3C7', text: '92400E' },
  停止: { bg: 'F1F5F9', text: '64748B' },
}

export interface PatternInput {
  propertyName: string
  properties: Property[]
  units: Unit[]
  transactions: Transaction[]
  records: PaymentRecord[]
  rentHistory: RentHistory[]
  fiscalYear: number
  /** 入金状況シートの対象年月 */
  year: number
  month: number
}

const n = (v: unknown) => Number(v ?? 0) || 0
const yenNum = (v: number | null | undefined) => Math.round(Number(v ?? 0))

// 「1989年6月」「昭和40年12月」から西暦の年を取り出す
function builtYear(built?: string | null): number | null {
  if (!built) return null
  const wa = built.match(/(昭和|平成|令和)\s*(\d+|元)年/)
  if (wa) {
    const y = wa[2] === '元' ? 1 : Number(wa[2])
    const base = wa[1] === '昭和' ? 1925 : wa[1] === '平成' ? 1988 : 2018
    return base + y
  }
  const m = built.match(/(\d{4})\s*年/)
  return m ? Number(m[1]) : null
}
const buildingAge = (built?: string | null): string => {
  const y = builtYear(built)
  return y ? `${new Date().getFullYear() - y}年` : ''
}

// 物件順（タブと同じ並び）＋部屋の並びでソート
function sortUnits(units: Unit[], properties: Property[]): Unit[] {
  const order = new Map(properties.map((p, i) => [p.id, i]))
  return [...units].sort((a, b) => {
    const pa = order.get(a.property_id) ?? 9999
    const pb = order.get(b.property_id) ?? 9999
    return pa !== pb ? pa - pb : unitCompare(a, b)
  })
}

// 社外向けに氏名を伏せる。誰が住んでいるかは出さず、埋まっているかどうかだけ分かるようにする
const maskTenant = (u: Unit) => (u.tenant ? (u.tenant_type || '入居中') : '')

// ---------------------- ①現況報告用 ----------------------
function rentRollSheet(input: PatternInput, mask: boolean): Sheet {
  const propById = new Map(input.properties.map((p) => [p.id, p]))
  const header = [
    'マンション名', '完了検査済日', '築年月', '築年数', '号室', '用途', '属性',
    ...(mask ? ['入居状況'] : ['契約者名']),
    '賃料', '共益費', '駐輪駐車', '返還金（敷金）', '状況', '備考',
  ]
  const rows: Cell[][] = sortUnits(input.units, input.properties).map((u) => {
    const p = propById.get(u.property_id)
    return [
      p?.name ?? '',
      p?.inspection_date ?? '',
      p?.built ?? '',
      buildingAge(p?.built),
      u.room ?? '',
      u.use_type ?? '',
      u.tenant_type ?? '',
      mask ? maskTenant(u) : (u.tenant ?? ''),
      yenNum(u.rent),
      yenNum(u.kyoeki),
      u.parking ?? '',
      u.refund ?? '',
      u.status ?? '',
      u.notes ?? '',
    ]
  })
  return {
    name: 'レントロール',
    rows: [[`レントロール（${input.propertyName}）`], [], header, ...rows],
    cols: [18, 13, 11, 8, 10, 10, 8, mask ? 10 : 20, 11, 10, 12, 13, 8, 24],
    headerRow: 2,
    moneyCols: [8, 9],
    statusCol: 12,
  }
}

// ---------------------- 収支表 ----------------------
function statementSheet(input: PatternInput, excludeLoan: boolean): Sheet {
  // 元金・利息を外すときは集計前に取引から除く。行を隠すだけだと支出計に残ってしまうため。
  const txs = excludeLoan
    ? input.transactions.filter((t) => t.category !== '元金' && t.category !== '利息')
    : input.transactions
  const kddi = new Set(
    input.units.filter((u) => u.tenant === 'KDDI').map((u) => `${u.property_id}|${u.room}`),
  )
  const recordTxs: Transaction[] = input.records
    .filter((rec) => n(rec.paid) > 0)
    .map((rec) => ({
      id: `pr-${rec.property_id}-${rec.room}-${rec.year}-${rec.month}`,
      date: `${rec.year}-${String(rec.month).padStart(2, '0')}-15`,
      property_id: rec.property_id,
      type: 'income' as const,
      category: kddi.has(`${rec.property_id}|${rec.room}`) ? 'KDDI' : CAT_RENT,
      amount: n(rec.paid),
    }))
  const r = calcIncomeStatement([...txs, ...recordTxs], input.fiscalYear)
  // 元金・利息は金額だけでなく行そのものを出さない
  const keep = (label: string) =>
    isStatementRowVisible(label, input.propertyName) &&
    !(excludeLoan && (label === '元金' || label === '利息'))

  const yearRow: Cell[] = ['', ...FISCAL_MONTHS.map((_, i) =>
    i === 0 ? `${r.year - 1}年` : i === FISCAL_PREV_YEAR_COLS ? `${r.year}年` : ''), '']
  const monthRow: Cell[] = ['項目', ...FISCAL_MONTHS.map((m) => `${m}月`), '年度合計']
  const line = (label: string, months: number[], total: number): Cell[] => [label, ...months.map(yenNum), yenNum(total)]

  return {
    name: '収支表',
    rows: [
      [`収支表（${input.propertyName}・${r.year}年度 ${r.year - 1}年9月〜${r.year}年8月）`],
      [],
      yearRow,
      monthRow,
      ['【収入】'],
      ...r.income.filter((x) => keep(x.label)).map((x) => line(x.label, x.months, x.total)),
      line('収入計', r.incomeTotalByMonth, r.incomeTotal),
      ['【支出】'],
      ...r.expense.filter((x) => keep(x.label)).map((x) => line(x.label, x.months, x.total)),
      line('支出計', r.expenseTotalByMonth, r.expenseTotal),
      line('差引（収支）', r.netByMonth, r.net),
    ],
  }
}

// ---------------------- 入金状況（月次） ----------------------
function paymentSheet(input: PatternInput, mask: boolean): Sheet {
  const rentHistoryByUnit = new Map<string, RentHistory[]>()
  for (const h of input.rentHistory) {
    if (!rentHistoryByUnit.has(h.unit_id)) rentHistoryByUnit.set(h.unit_id, [])
    rentHistoryByUnit.get(h.unit_id)!.push(h)
  }
  const recIndex = new Map<string, PaymentRecord>()
  for (const rec of input.records) recIndex.set(`${rec.property_id}|${rec.room}|${rec.year}|${rec.month}`, rec)

  const propById = new Map(input.properties.map((p) => [p.id, p]))
  const r = calcPaymentStatus(
    sortUnits(input.units, input.properties), input.transactions, input.year, input.month, rentHistoryByUnit,
  )
  const header = ['物件', '号室', ...(mask ? ['入居状況'] : ['契約者名']), '請求額', '入金額', '入金日', '不足額', '判定']
  const rows: Cell[][] = r.rows.map((row) => {
    const u = row.unit
    const rec = recIndex.get(`${u.property_id}|${u.room}|${input.year}|${input.month}`)
    const billed = rec?.billed != null ? n(rec.billed) : row.billed
    const paid = rec?.paid != null ? n(rec.paid) : row.paid
    return [
      propById.get(u.property_id)?.name ?? '',
      u.room ?? '',
      mask ? maskTenant(u) : (rec?.tenant ?? u.tenant ?? ''),
      yenNum(billed),
      yenNum(paid),
      rec?.paid_on ?? row.paidDate ?? '',
      yenNum(Math.max(0, billed - paid)),
      rec?.judgement ?? row.judgement,
    ]
  })
  return {
    name: '入金状況',
    rows: [[`入金状況（${input.propertyName}・${input.year}年${input.month}月）`], [], header, ...rows],
  }
}

// ---------------------- 物件概要 ----------------------
function overviewSheet(input: PatternInput): Sheet {
  const target = input.properties.filter(
    (p) => input.propertyName === '全体' || p.name === input.propertyName,
  )
  const header = ['物件名', '所在地', '種別', '構造', '築年月', '築年数', '完了検査済日',
                  '土地面積(㎡)', '建物面積(㎡)', '総戸数', '入居戸数', '満室想定月額', '現況月額']
  const rows: Cell[][] = target.map((p) => {
    const us = input.units.filter((u) => u.property_id === p.id)
    const occupied = us.filter((u) => u.status === '入居' || u.status === '退予')
    const monthly = (list: Unit[]) => list.reduce((s, u) => s + n(u.rent) + n(u.kyoeki), 0)
    return [
      p.name, p.address ?? '', p.type ?? '', p.structure ?? '', p.built ?? '', buildingAge(p.built),
      p.inspection_date ?? '',
      p.land_area != null ? n(p.land_area) : '', p.building_area != null ? n(p.building_area) : '',
      us.length, occupied.length, yenNum(monthly(us)), yenNum(monthly(occupied)),
    ]
  })
  return { name: '物件概要', rows: [[`物件概要（${input.propertyName}）`], [], header, ...rows] }
}

// ---------------------- 組み立て ----------------------
export function buildPatternSheets(pattern: ExportPattern, input: PatternInput): Sheet[] {
  if (pattern === 'genkyo') return [rentRollSheet(input, false)]
  if (pattern === 'shushi') return [statementSheet(input, false)]
  // 販売業者提出用：元金・利息を除き、氏名は伏せる
  return [overviewSheet(input), rentRollSheet(input, true), statementSheet(input, true), paymentSheet(input, true)]
}

/** aoa から作った worksheet に、Sheet の指定どおりの見た目を付ける */
function decorate(XLSX: XlsxModule, sheet: Sheet) {
  const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
  const colCount = Math.max(...sheet.rows.map((r) => r.length))
  const thin = { style: 'thin' as const, color: { rgb: C.border } }
  const box = { top: thin, bottom: thin, left: thin, right: thin }

  if (sheet.cols) ws['!cols'] = sheet.cols.map((wch) => ({ wch }))
  // タイトル行は全列にまたがらせる
  if (sheet.headerRow != null && sheet.headerRow > 0) {
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } }]
  }
  ws['!rows'] = sheet.rows.map((_, r) => ({ hpt: r === sheet.headerRow ? 22 : r === 0 ? 24 : 18 }))

  for (let r = 0; r < sheet.rows.length; r++) {
    for (let c = 0; c < colCount; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      const cell = ws[ref]
      if (!cell) continue
      if (r === 0) {
        cell.s = { font: { bold: true, sz: 14, color: { rgb: C.ink } }, alignment: { vertical: 'center' } }
        continue
      }
      if (r === sheet.headerRow) {
        cell.s = {
          font: { bold: true, sz: 10, color: { rgb: C.headerText } },
          fill: { fgColor: { rgb: C.headerBg } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: box,
        }
        continue
      }
      if (sheet.headerRow == null || r <= sheet.headerRow) continue

      const isMoney = sheet.moneyCols?.includes(c)
      const banded = (r - sheet.headerRow) % 2 === 0
      const style: Record<string, unknown> = {
        font: { sz: 10, color: { rgb: C.ink } },
        border: box,
        alignment: {
          horizontal: isMoney ? 'right' : 'left',
          vertical: 'center',
        },
      }
      if (banded) style.fill = { fgColor: { rgb: C.band } }
      // 状況は値ごとに色を変えて一目で分かるようにする
      if (c === sheet.statusCol) {
        const st = STATUS_STYLE[String(cell.v ?? '')]
        if (st) {
          style.fill = { fgColor: { rgb: st.bg } }
          style.font = { sz: 10, bold: true, color: { rgb: st.text } }
          style.alignment = { horizontal: 'center', vertical: 'center' }
        }
      }
      cell.s = style
      if (isMoney && typeof cell.v === 'number') cell.z = '¥#,##0'
    }
  }
  return ws
}

export async function exportPattern(pattern: ExportPattern, input: PatternInput): Promise<void> {
  // xlsx-js-style は CJS のみなので、動的 import では中身が default に入る場合がある。
  // 環境によってどちらにもなり得るので両対応にしておくこと。
  const mod = await import('xlsx-js-style')
  const XLSX = ((mod as unknown as { default?: XlsxModule }).default ?? mod) as XlsxModule
  const wb = XLSX.utils.book_new()
  for (const sheet of buildPatternSheets(pattern, input)) {
    XLSX.utils.book_append_sheet(wb, decorate(XLSX, sheet), sheet.name)
  }
  const label = EXPORT_PATTERNS.find((p) => p.key === pattern)?.label ?? pattern
  const d = new Date()
  const p2 = (x: number) => String(x).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`
  XLSX.writeFile(wb, `${label}_${input.propertyName}_${stamp}.xlsx`)
}

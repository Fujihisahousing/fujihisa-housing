// SheetJS による Excel 書き出し（レントロール／収支表／入金状況）。
// xlsx は重いので動的 import で遅延ロードし、初期表示を軽くする。
import type { RentRollResult, IncomeStatementResult, PaymentStatusResult } from '../lib/calc'

function stamp(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

async function save(rows: (string | number | null)[][], sheetName: string, fileName: string) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName)
}

const yenNum = (v: number | null | undefined) => Math.round(Number(v ?? 0))

// ---------------------- レントロール ----------------------
export function exportRentRollExcel(propertyName: string, rr: RentRollResult): Promise<void> {
  const rows: (string | number | null)[][] = [
    [`レントロール（${propertyName}）`],
    [],
    ['満室想定(月)', yenNum(rr.fullMonthly)],
    ['現況(月)', yenNum(rr.currentMonthly)],
    ['稼働率', `${(rr.occupancyRate * 100).toFixed(1)}%（${rr.occupiedUnits}/${rr.totalUnits}）`],
    ['表面利回り', rr.grossYield != null ? `${(rr.grossYield * 100).toFixed(2)}%` : '—'],
    [],
    ['号室', '間取', '面積(㎡)', '賃料', '共益費', '合計', '敷金', '契約満了', '状況'],
    ...rr.rows.map(({ unit: u, total }) => [
      u.room ?? '',
      u.layout ?? '',
      u.area ?? null,
      yenNum(u.rent),
      yenNum(u.kyoeki),
      yenNum(total),
      yenNum(u.deposit),
      u.contract_end ?? '',
      u.status ?? '',
    ]),
  ]
  return save(rows, 'レントロール', `レントロール_${propertyName}_${stamp()}.xlsx`)
}

// ---------------------- 収支表 ----------------------
export function exportIncomeStatementExcel(propertyName: string, r: IncomeStatementResult): Promise<void> {
  const header = ['項目', ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), '年間合計']
  const rows: (string | number | null)[][] = [
    [`収支表（${propertyName}・${r.year}年）`],
    [],
    header,
    ['【収入】'],
    ...r.income.map((row) => [row.label, ...row.months.map(yenNum), yenNum(row.total)]),
    ['収入計', ...r.incomeTotalByMonth.map(yenNum), yenNum(r.incomeTotal)],
    ['【支出】'],
    ...r.expense.map((row) => [row.label, ...row.months.map(yenNum), yenNum(row.total)]),
    ['支出計', ...r.expenseTotalByMonth.map(yenNum), yenNum(r.expenseTotal)],
    ['差引（収支）', ...r.netByMonth.map(yenNum), yenNum(r.net)],
  ]
  return save(rows, '収支表', `収支表_${propertyName}_${r.year}_${stamp()}.xlsx`)
}

// ---------------------- 入金状況 ----------------------
export function exportPaymentStatusExcel(propertyName: string, r: PaymentStatusResult): Promise<void> {
  const rows: (string | number | null)[][] = [
    [`入金状況（${propertyName}・${r.year}年${r.month}月）`],
    [],
    ['請求対象戸数', r.billedUnits],
    ['回収済', r.collectedUnits],
    ['要対応', r.attentionUnits],
    ['回収率', `${(r.collectionRate * 100).toFixed(1)}%`],
    [],
    ['号室', '請求額', '入金額', '判定'],
    ...r.rows.map((row) => [
      row.unit.room ?? '',
      row.judgement === '空室' ? null : yenNum(row.billed),
      row.judgement === '空室' ? null : yenNum(row.paid),
      row.judgement,
    ]),
  ]
  return save(rows, '入金状況', `入金状況_${propertyName}_${r.year}${String(r.month).padStart(2, '0')}_${stamp()}.xlsx`)
}

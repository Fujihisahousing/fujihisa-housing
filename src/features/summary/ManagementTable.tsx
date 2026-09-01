// 収支管理表（全物件まとめ）。画面表示＋A3横の印刷／PDF。紙面の表題は「賃貸物件支出表」。
// 長年 Excel（フジヒサハウジング管理.xls「賃貸物件管理表」）で作ってきた形を踏襲する：
//   縦＝物件ごとの帯（収入・支出・明細・利益）／横＝9月〜8月＋年間合計／最下段＝全物件の合計。
// 既存の収支表（行=費目・1物件ぶん）とは別物なので、画面も別タブに分けている。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { transactionsRepo, paymentRecordsRepo, unitsRepo, rentHistoryRepo } from '../../lib/repositories'
import {
  calcManagementTable,
  fiscalYearOf,
  accountingFiscalYear,
  fiscalYearRange,
  paymentRecordsToTransactions,
  bookedRentKeys,
  rentHistoryMapOf,
  FISCAL_MONTHS,
  FISCAL_PREV_YEAR_COLS,
  MGMT_ROW_MEMBERS,
  isDisposedForRentRoll,
  type MgmtPropertyBlock,
  type MgmtTableResult,
  type StatementRow,
} from '../../lib/calc'
import { yen } from '../../lib/format'
import '../../reports/print.css'
import '../../reports/mgmtTable.css'
import type { PaymentRecord, Property, RentHistory, Transaction, Unit } from '../../types'

// 収支表と同じ運用開始年度（データが無くても過去年度を開けるように）
const FIRST_YEAR = 2023

export function ManagementTable({ properties }: { properties: Property[] }) {
  const [year, setYear] = useState(fiscalYearOf(new Date()))
  const [txs, setTxs] = useState<Transaction[]>([])
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  // 賃料履歴。入金額を家賃／駐車・駐輪／光熱費に振り分けるとき、その月の賃料を知るのに要る
  const [rentHistory, setRentHistory] = useState<RentHistory[]>([])
  const [loading, setLoading] = useState(true)

  // print.css は A4縦。この画面を開いている間だけ A3横に上書きする（現況報告書と同じ手）
  useEffect(() => {
    const el = document.createElement('style')
    el.textContent = '@media print { @page { size: A3 landscape; margin: 8mm; } }'
    document.head.appendChild(el)
    return () => {
      document.head.removeChild(el)
    }
  }, [])

  // 管理表は常に全物件が対象（物件タブでは絞らない）
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, rec, u] = await Promise.all([
        transactionsRepo.list({}),
        paymentRecordsRepo.list(null),
        unitsRepo.listAll(),
      ])
      setTxs(t)
      setRecords(rec)
      setUnits(u)
      setRentHistory(await rentHistoryRepo.listByUnitIds(u.map((x) => x.id)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 入金状況の月次記録も収入に合算する（収支表と同じ扱い）。
  // 同じ家賃を台帳にも記帳している号室・月は、記帳のほうを採って二重計上を避ける。
  const allTxs = useMemo(
    () => [
      ...txs,
      ...paymentRecordsToTransactions(records, units, bookedRentKeys(txs), rentHistoryMapOf(rentHistory)),
    ],
    [txs, records, units, rentHistory],
  )

  // 決済済みの物件は来期から落とす（レントロールと同じ基準）。過去年度を開けば表に残る。
  const visibleProperties = useMemo(() => {
    const today = new Date()
    return properties.filter((p) => !isDisposedForRentRoll(p.disposed_date, today))
  }, [properties])

  const r = useMemo(
    () => calcManagementTable(allTxs, visibleProperties, year),
    [allTxs, visibleProperties, year],
  )

  const years = useMemo(() => {
    const set = new Set<number>()
    for (let y = FIRST_YEAR; y <= fiscalYearOf(new Date()); y++) set.add(y)
    allTxs.forEach((t) => set.add(accountingFiscalYear(t)))
    return Array.from(set).sort((a, b) => b - a)
  }, [allTxs])

  const range = fiscalYearRange(year)

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        {/* 画面のラベルはタブ名（収支管理表）に合わせる。印刷の表題は「賃貸物件支出表」で別 */}
        <span className="text-sm font-medium text-slate-700">収支管理表</span>
        <label className="text-sm text-slate-600 ml-2">年度</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年度
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          A3横。印刷ダイアログで用紙をA3・横にして「PDFとして保存」
        </span>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          <Printer className="w-4 h-4" /> 印刷 / PDF
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : (
        // 画面でも印刷と同じ紙面を出す（現況報告書と同じ方針）。用紙幅が画面より
        // 広いことがあるので、はみ出す分だけ横スクロールさせる。
        <div className="overflow-x-auto">
          <div id="print-root">
            <MgmtSheet r={r} range={range} />
          </div>
        </div>
      )}
    </div>
  )
}


// ================================================================== 紙面
// 行の構成（物件ごと）：
//   収入（薄い青）／支出＝合計（薄い赤）／支出の明細7行（インデント）／利益（黄）
const PREV = FISCAL_PREV_YEAR_COLS

/** 印刷される本体。データ取得から切り離してあるので単体で表示確認できる */
export function MgmtSheet({
  r,
  range,
}: {
  r: MgmtTableResult
  range: { from: string; to: string }
}) {
  return (
    <div className="mt-page">
      <header className="mt-head">
        <div className="mt-title">
          <span className="mt-kicker">FUJIHISA HOUSING</span>
          <h1>賃貸物件支出表</h1>
        </div>
        <div className="mt-kpis">
          <Kpi cls="income" label="収入" value={r.grandIncome.total} />
          {/* 表の支出行と揃えてマイナス表記にする */}
          <Kpi cls="expense" label="支出" value={-r.grandExpense.total} />
          <Kpi cls="profit" label="利益" value={r.grandNet.total} />
        </div>
        <div className="mt-date">
          {r.year}年度（{range.from} 〜 {range.to}）
        </div>
      </header>

      {/* 「管理費」に何を畳んでいるかの凡例。横1行で、罫線のすぐ下に置く */}
      <p className="mt-legend">
        管理費の内訳：{MGMT_ROW_MEMBERS['管理費'].join('・')}
      </p>

      <table className="mt-table">
        <thead>
          <tr>
            <th rowSpan={2}>物件</th>
            <th rowSpan={2}>項目</th>
            {/* 年は始まりの月の真上に来るよう左寄せ（2025年→9月／2026年→1月） */}
            <th className="y yr" colSpan={PREV}>
              {r.year - 1}年
            </th>
            <th className="y yr" colSpan={FISCAL_MONTHS.length - PREV}>
              {r.year}年
            </th>
            <th rowSpan={2}>年間合計</th>
          </tr>
          <tr>
            {FISCAL_MONTHS.map((m) => (
              <th key={m} className="y">
                {m}月
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.blocks.map((b) => (
            <PropertyBlock key={b.propertyId} b={b} />
          ))}
          {/* 最下段は全物件の 収入／支出／利益。行の色は各帯と同じ。
              支出は出ていく金額なので常に赤字＋マイナス表記、利益は赤字になったときだけ赤。 */}
          <GrandRow row={r.grandIncome} cls="mt-row-income" first />
          <GrandRow row={r.grandExpense} cls="mt-row-expense" tone="red" negate />
          <GrandRow row={r.grandNet} cls="mt-row-profit" tone="negRed" last />
        </tbody>
      </table>
    </div>
  )
}

function Kpi({ cls, label, value }: { cls: string; label: string; value: number }) {
  return (
    <div className={`mt-kpi ${cls}`}>
      <span>{label}</span>
      <b>{yen(value)}</b>
    </div>
  )
}

/** 最下段の合計行（物件名の列は「合計」でまとめる） */
function GrandRow({
  row,
  cls,
  first,
  last,
  tone,
  negate,
}: {
  row: StatementRow
  cls: string
  first?: boolean
  last?: boolean
  tone?: Tone
  negate?: boolean
}) {
  return (
    <tr className={`mt-grand ${cls}${last ? ' mt-grand-last' : ''}`}>
      {first && (
        <td className="mt-name mt-grand-name" rowSpan={3}>
          <strong>合計</strong>
        </td>
      )}
      <Cells row={row} tone={tone} negate={negate} />
    </tr>
  )
}

// 物件1件ぶんの帯。印刷でページをまたいで割れないよう mt-block を付ける
function PropertyBlock({ b }: { b: MgmtPropertyBlock }) {
  const details = b.expenses
  return (
    <>
      <tr className="mt-block mt-row-income">
        {/* 物件名は帯の全行にまたがらせ、大きく出す。築年数・新築／購入日を添える */}
        <td className="mt-name" rowSpan={3 + details.length}>
          <strong>{b.name}</strong>
          {b.age && <em>{b.age}</em>}
          {b.built && <i>{b.built}</i>}
          {b.acquired && <i>{b.acquired}</i>}
        </td>
        <Cells row={b.income} />
      </tr>
      {/* 各物件の支出・明細はプラス表記の黒。マイナス表記＋赤字にするのは
          利益がマイナスのときと、最下段の合計の支出行だけ。 */}
      <tr className="mt-row-expense">
        <Cells row={b.expenseTotal} />
      </tr>
      {details.map((e) => (
        <tr key={e.label} className="mt-row-detail">
          <Cells row={e} detail />
        </tr>
      ))}
      <tr className="mt-row-profit">
        <Cells row={b.net} tone="negRed" />
      </tr>
    </>
  )
}

/** 文字色の付け方。マイナス表記（negate）とは独立に決める。
 *  plain  … 常に黒。マイナスでも黒のまま
 *  negRed … マイナスのときだけ赤（各物件と合計の利益行）
 *  red    … 常に赤（合計の支出行） */
type Tone = 'plain' | 'negRed' | 'red'

/** 項目名セル＋12ヶ月＋年間合計。<tr> 直下に置く前提。
 *  negate＝符号を反転して表示する（支出を「出ていく金額」として−で見せる用） */
function Cells({
  row,
  detail,
  negate,
  tone = 'plain',
}: {
  row: StatementRow
  detail?: boolean
  negate?: boolean
  tone?: Tone
}) {
  const sign = (v: number) => (negate ? -v : v)
  const cell = (v: number) =>
    'r' + (tone === 'red' || (tone === 'negRed' && v < 0) ? ' neg' : '')
  return (
    <>
      <td className={detail ? 'mt-item detail' : 'mt-item'}>{row.label}</td>
      {row.months.map((v, i) => (
        <td key={i} className={cell(sign(v))}>
          {money(sign(v))}
        </td>
      ))}
      <td className={cell(sign(row.total)) + ' total'}>{money(sign(row.total))}</td>
    </>
  )
}

/** 0 は薄い「—」にして、金額のある月を目で追いやすくする */
function money(v: number) {
  return v ? yen(v) : <span className="mt-zero">—</span>
}

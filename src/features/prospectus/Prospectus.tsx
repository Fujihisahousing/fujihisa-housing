// 物件概要書（売買資料版・A4印刷 / PDF）。
//
// 手本＝デスクトップ「台帳_プランドール守口.xlsx」の7シート構成。Excelのシートに対応する
// タブに分け、レントロールだけは Excel ではなく RentBook の units を正として出す
// （原本のレントロールより RentBook のほうが整合性が高い、というユーザー判断）。
//
//   概要         … Excel「物件サマリー」だけ。1枚を使い切るよう1列でゆったり組む
//   レントロール … RentBook の units。現在の契約内容のみ（過去分は年間収支表で見る）
//   年間収支表   … 収支表(transactions＋入金記録)を今年度・前年度の月別で並べる。
//                  収支管理表と違って支出は費目ごとにばらす（まとめない）
//   運営費       … Excel「運営費内訳」
//   修繕履歴     … Excel「修繕費(専有部)」「修繕費(共用部)」
//   法定点検     … Excel「法定点検・維持管理」
//   引継書類     … Excel「公的書類詳細」
//
// 物件の切り替えは画面最上段の物件タブ（PropertyTabs）で行うので、この画面には
// 物件のプルダウンを置かない。
//
// 紙面は A4縦で統一する。収支管理表・現況報告書と同じく、画面でも印刷と同じ紙面を出す
// （reports/prospectus.css が mm 指定で用紙を再現する）。1セクション＝1枚から始まり、
// 1枚に入らないセクションだけ行単位でページを送るので、途中で半端に改ページされない。
// 印刷はタブ単位と全ページまとめの2通り。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Printer, Loader2, FileText } from 'lucide-react'
import {
  unitsRepo, transactionsRepo, paymentRecordsRepo,
  propertyDocumentsRepo, propertyInspectionsRepo, propertyOpexRepo, propertyRepairsRepo,
} from '../../lib/repositories'
import {
  calcRentRoll, buildingAgeYears, parkingYen,
  calcOpexActual, calcRepairByFiscalYear, calcIncomeStatement,
  paymentRecordsToTransactions, bookedRentKeys,
  fiscalYearOf, fiscalYearRange, FISCAL_MONTHS, FISCAL_PREV_YEAR_COLS,
  type OpexActual, type RepairByYear, type IncomeStatementResult, type StatementRow,
} from '../../lib/calc'
import { unitCompare } from '../../lib/sortUnits'
import { fitSheets } from '../../reports/fitToPage'
import { yen, percent, formatDate, num } from '../../lib/format'
import { useAppStore } from '../../state/useAppStore'
import type {
  Property, Unit, Transaction, PaymentRecord,
  PropertyDocument, PropertyInspection, PropertyOpex, PropertyRepair,
} from '../../types'
import { OpexTab, RepairsTab, InspectionsTab, DocumentsTab } from './ProspectusTables'
import '../../reports/print.css'
import '../../reports/prospectus.css'

type TabKey = 'overview' | 'rentroll' | 'statement' | 'opex' | 'repairs' | 'inspections' | 'documents'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概要' },
  { key: 'rentroll', label: 'レントロール' },
  { key: 'statement', label: '年間収支表' },
  { key: 'opex', label: '運営費' },
  { key: 'repairs', label: '修繕履歴' },
  { key: 'inspections', label: '法定点検' },
  { key: 'documents', label: '引継書類' },
]

/** 年間収支表に出さない支出。買主に承継されない借入返済なので、概要書には載せない
 *  （運営費タブと同じ扱い。行だけ隠すと支出計から借入額が逆算できてしまうので、
 *   合計もこの行を除いて計算する） */
const STATEMENT_EXCLUDE = new Set(['元金', '利息'])

export function Prospectus({ properties }: { properties: Property[] }) {
  const activeProperty = useAppStore((s) => s.activeProperty)
  const [tab, setTab] = useState<TabKey>('overview')
  const [printAll, setPrintAll] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)

  const [units, setUnits] = useState<Unit[]>([])
  const [txs, setTxs] = useState<Transaction[]>([])
  const [records, setRecords] = useState<PaymentRecord[]>([])
  const [opex, setOpex] = useState<PropertyOpex[]>([])
  const [repairs, setRepairs] = useState<PropertyRepair[]>([])
  const [inspections, setInspections] = useState<PropertyInspection[]>([])
  const [docs, setDocs] = useState<PropertyDocument[]>([])

  const selectedId = activeProperty ?? ''
  const property = useMemo(
    () => properties.find((p) => p.id === selectedId) ?? null,
    [properties, selectedId],
  )

  const load = useCallback(async () => {
    if (!selectedId) {
      setUnits([]); setTxs([]); setRecords([]); setOpex([]); setRepairs([]); setInspections([]); setDocs([])
      return
    }
    setLoading(true)
    try {
      const [u, t, rec, o, r, i, d] = await Promise.all([
        unitsRepo.listByProperty(selectedId),
        transactionsRepo.list({ propertyId: selectedId }),
        // 家賃収入の大半は入金状況の月次記録に入っているので、年間収支表にはこれも要る
        paymentRecordsRepo.list(selectedId),
        propertyOpexRepo.listByProperty(selectedId),
        propertyRepairsRepo.listByProperty(selectedId),
        propertyInspectionsRepo.listByProperty(selectedId),
        propertyDocumentsRepo.listByProperty(selectedId),
      ])
      setUnits(u)
      setTxs(t)
      setRecords(rec)
      setOpex(o)
      // 新しい修繕を上に。日付未入力は末尾へ落とす
      setRepairs([...r].sort((a, b) => String(b.repaired_on ?? '').localeCompare(String(a.repaired_on ?? ''))))
      setInspections(i)
      setDocs(d)
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void load()
  }, [load])

  // 全ページ印刷：先に全タブを描画してから print する（描画前に呼ぶと1タブしか出ない）
  useEffect(() => {
    if (!printAll) return
    const done = () => setPrintAll(false)
    window.addEventListener('afterprint', done)
    const id = window.setTimeout(() => {
      fitSheets(rootRef.current)
      window.print()
    }, 100)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('afterprint', done)
    }
  }, [printAll])

  // 末尾の数行だけが次ページへこぼれるセクションは、行間を詰めて1枚に収める（fitToPage.ts）。
  // 依存配列を付けないのは、タブ切替・行の追加・printAll のどれでも測り直したいから。
  // React の state を触らないので再レンダーのループにはならない。
  useLayoutEffect(() => {
    fitSheets(rootRef.current)
  })

  // フォントの読み込みで行の高さが変わるので、読み込み後にもう一度測る
  useEffect(() => {
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) fitSheets(rootRef.current)
    })
    return () => {
      alive = false
    }
  }, [])

  const sortedUnits = useMemo(() => [...units].sort(unitCompare), [units])
  const rr = useMemo(() => calcRentRoll(sortedUnits, property), [sortedUnits, property])

  // 会計年度は9月始まり。今年度はまだ途中なので、収入と支出が1年ぶん揃う「1つ前の年度」を使う。
  const thisFY = fiscalYearOf(new Date())
  const lastFY = thisFY - 1
  const actual = useMemo(() => calcOpexActual(txs, lastFY), [txs, lastFY])
  const repairByYear = useMemo(() => calcRepairByFiscalYear(txs), [txs])

  // 年間収支表。入金状況の月次記録を家賃収入として合算する（同じ家賃を台帳にも
  // 記帳している号室・月は記帳のほうを採る）。変換は収支表・管理表と共通の calc.ts 側。
  const allTxs = useMemo(
    () => [...txs, ...paymentRecordsToTransactions(records, units, bookedRentKeys(txs))],
    [txs, records, units],
  )
  const stCur = useMemo(() => calcIncomeStatement(allTxs, thisFY), [allTxs, thisFY])
  const stPrev = useMemo(() => calcIncomeStatement(allTxs, lastFY), [allTxs, lastFY])

  // DataTable からの保存・削除。保存後に一覧を取り直す
  const handler = <T extends { id: string }>(
    repo: { save: (r: Partial<T> & { property_id: string }) => Promise<T>; remove: (id: string) => Promise<void> },
  ) => ({
    onSave: async (row: Partial<T>) => {
      await repo.save({ ...row, property_id: selectedId } as Partial<T> & { property_id: string })
      await load()
    },
    onRemove: async (id: string) => {
      await repo.remove(id)
      await load()
    },
  })

  if (properties.length === 0) {
    return <div className="text-center text-slate-400 text-sm py-12">物件を登録してください。</div>
  }

  const show = (k: TabKey) => printAll || tab === k

  return (
    <div className="space-y-4">
      {/* 操作部とタブ。下までスクロールしても迷子にならないよう画面上部に貼り付ける。
          貼り付ける位置＝ヘッダー(h-14)＋物件タブの高さ。物件タブは prospectus のときだけ
          sticky になり、自分の実測高さを --rb-tabs-bottom に入れてくれる（PropertyTabs.tsx）。 */}
      <div
        style={{ top: 'var(--rb-tabs-bottom, 6.8rem)' }}
        className="no-print sticky z-20 -mx-5 px-5 py-2 bg-slate-50 border-b border-slate-200 space-y-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium text-slate-700">
            {property ? property.name : '物件を選択してください'}
          </div>
          <button
            onClick={() => {
              fitSheets(rootRef.current)
              window.print()
            }}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 text-white px-3 py-1.5 text-sm font-medium hover:bg-slate-800"
          >
            <Printer className="w-4 h-4" /> このタブを印刷
          </button>
          <button
            onClick={() => setPrintAll(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="w-4 h-4" /> 全ページ印刷
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                'whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
                (tab === t.key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!property ? (
        <div className="text-center text-slate-400 text-sm py-12">
          画面上部の物件タブから物件を選んでください。
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 読み込み中…
        </div>
      ) : (
        // 用紙幅（186mm）が画面より広いことがあるので、はみ出す分だけ横スクロールさせる
        <div className="overflow-x-auto">
          <div id="print-root" ref={rootRef} className="pr-root">
            {show('overview') && (
              <Sheet sec="overview" property={property} title="1. 物件概要">
                <SpecTable property={property} units={units} />
                {property.notes && (
                  <div className="mt-4">
                    <h3 className="text-sm font-bold text-slate-700 border-b border-slate-300 pb-1 mb-1">備考</h3>
                    <p className="text-xs text-slate-700 whitespace-pre-wrap">{property.notes}</p>
                  </div>
                )}
              </Sheet>
            )}

            {show('rentroll') && (
              <Sheet sec="rentroll" property={property} title="2. レントロール（賃貸借条件一覧）">
                <IncomeSummary rr={rr} units={units} />
                <div className="mt-6">
                  <RentRollTable units={sortedUnits} title="現在の契約内容" subtitle={formatDate(new Date()) + ' 時点'} />
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  ※ 入居者名は個人情報のため属性（個人／法人）のみ記載。稼働 {rr.occupiedUnits}/{rr.totalUnits} 戸・
                  稼働率 {percent(rr.occupancyRate, 1)}（募集停止は総数から除外）。
                </p>
              </Sheet>
            )}

            {show('statement') && (
              <Sheet sec="statement" property={property} title="3. 年間収支表">
                <AnnualStatement prev={stPrev} cur={stCur} prevYear={lastFY} curYear={thisFY} />
              </Sheet>
            )}

            {show('opex') && (
              <Sheet sec="opex" property={property} title={`4. 運営費（${lastFY}年度実績）`}>
                <OpexActualTable actual={actual} lastFY={lastFY} />
                <div className="mt-6">
                  <h3 className="text-sm font-bold text-slate-700 border-b-2 border-slate-800 pb-1 mb-2">
                    支払先・契約条件
                  </h3>
                  <OpexTab rows={opex} propertyId={selectedId} {...handler(propertyOpexRepo)} />
                </div>
              </Sheet>
            )}

            {show('repairs') && (
              <Sheet sec="repairs" property={property} title="5. 修繕費・修繕履歴">
                {/* 前年度より古い年度は出さない（レントロールと同じく今年度・前年度の2年度） */}
                <RepairByYearTable rows={repairByYear.filter((r) => r.year >= lastFY)} lastFY={lastFY} />
                <div className="mt-6">
                  <RepairsTab rows={repairs} propertyId={selectedId} {...handler(propertyRepairsRepo)} />
                </div>
              </Sheet>
            )}

            {show('inspections') && (
              <Sheet sec="inspections" property={property} title="6. 法定点検・維持管理">
                <InspectionsTab rows={inspections} propertyId={selectedId} {...handler(propertyInspectionsRepo)} />
              </Sheet>
            )}

            {show('documents') && (
              <Sheet sec="documents" property={property} title="7. 引継書類">
                <DocumentsTab rows={docs} propertyId={selectedId} {...handler(propertyDocumentsRepo)} />
              </Sheet>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// 1. 概要
// =====================================================================
/** 1セクション＝A4縦1枚ぶんの紙面。中身が1枚に収まらないときだけ行単位でページが送られる。
 *  どのページを切り取っても物件が分かるよう、見出しは全セクションに同じものを出す。 */
function Sheet({
  sec, property, title, children,
}: {
  sec: string
  property: Property
  title: string
  children: ReactNode
}) {
  return (
    <section className="pr-sheet" data-sec={sec}>
      <header className="pr-head">
        <div>
          <h1>物件概要書</h1>
          <div className="pr-prop">{property.name}</div>
        </div>
        <div className="pr-meta">
          <div>作成日 {formatDate(new Date())}</div>
          {property.mgmt_company && <div>管理：{property.mgmt_company}</div>}
        </div>
      </header>
      <h2 className="pr-h2">{title}</h2>
      {children}
    </section>
  )
}

/** ログイン無しで見た目を検証できるよう export してある（tabcheck から import する） */
export function SpecTable({ property: p, units }: { property: Property; units: Unit[] }) {
  const age = buildingAgeYears(p.built)
  const rooms = units.filter((u) => u.use_type !== '駐車場' && u.use_type !== '看板').length
  // 原本の表記（「18戸4事務所」等）があればそれを優先し、無ければ登録戸数を出す
  const unitLabel = p.unit_count_label ?? (rooms ? `${rooms}戸` : '—')

  const rows: [string, ReactNode][] = [
    ['所在地（住居表示）', p.address],
    ['地番', p.chiban],
    ['交通', p.access],
    ['土地面積（公簿）', p.land_area != null ? `${num(p.land_area)} ㎡` : null],
    ['建物面積（公簿）', p.building_area != null ? `${num(p.building_area)} ㎡` : null],
    ['基準階面積', p.standard_floor_area != null ? `${num(p.standard_floor_area)} ㎡` : null],
    ['構造・規模', p.structure],
    ['主要用途', p.main_use ?? p.type],
    ['最高高さ', p.max_height != null ? `${num(p.max_height)} m` : null],
    ['総戸数／区画数', unitLabel],
    ['駐車場', p.parking_count != null ? `${p.parking_count} 台` : p.parking],
    ['地下室', p.basement],
    ['用途地域', p.zoning],
    ['建ぺい率／容積率', p.bcr != null || p.far != null ? `${p.bcr ?? '—'}% / ${p.far ?? '—'}%` : null],
    ['防火指定', p.fire_zone],
    ['高度地区', p.height_district],
    ['前面道路', p.road],
    ['竣工年月', p.built ? `${p.built}${age != null ? `（築${age}年）` : ''}` : null],
    ['建築確認番号', p.building_cert_no],
    ['確認済証', p.building_cert],
    ['検査済証', p.inspection_cert],
    ['完了検査済日', p.inspection_date],
    ['管理会社', p.mgmt_company],
    // 担当者名が空で連絡先だけ入っている物件があるので、ラベルは両方を含む表記にする
    ['担当者／連絡先', [p.mgmt_contact, p.mgmt_phone].filter(Boolean).join('／') || null],
  ]

  // 概要タブは物件概要だけなので、2列に詰めず1項目1行にしてA4縦1枚を使い切る。
  // 行の高さ（余白）は prospectus.css の [data-sec='overview'] 側で決めている。
  return (
    <table className="w-full border-collapse">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-slate-100">
            <th className="bg-slate-50 text-slate-500 font-medium text-left align-top w-[30%] whitespace-nowrap">
              {k}
            </th>
            <td className="align-top text-slate-800">
              {v == null || v === '' ? <span className="text-slate-300">—</span> : v}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const isOccupied = (u: Unit) => u.status === '入居' || u.status === '退予'

/** 3. 年間収支表。収支表(transactions＋入金記録)を月ごとに並べる。今年度・前年度の2表。
 *
 *  収支管理表は「管理費」に複数費目を畳んでいるが、こちらは畳まず費目ごとに出す（ユーザー指定）。
 *  金額が全月0の費目は行ごと省く。物件ごとの行の出し分け（isStatementRowVisible）は
 *  掛けない — 行を隠すと「行を足しても計に合わない」表になるため。
 *  ログイン無しで見た目を検証できるよう export してある（tabcheck から import する） */
export function AnnualStatement({
  prev, cur, prevYear, curYear,
}: {
  prev: IncomeStatementResult
  cur: IncomeStatementResult
  prevYear: number
  curYear: number
}) {
  // pr-fill：紙面の高さいっぱいまで2表を伸ばす（余った高さは各行に配られる。prospectus.css）
  return (
    <div className="pr-fill">
      <MonthlyStatement r={cur} year={curYear} note="進行中のため途中までの金額" />
      <MonthlyStatement r={prev} year={prevYear} />
      <p className="pr-nofill text-[11px] text-slate-500">
        ※ 収支管理表と違い、支出は費目ごとにばらして出している（管理費等にまとめない）。
        家賃収入は入金状況の月次記録を合算したもの。全月0円の費目は行ごと省いている。
        借入返済（元金・利息）は買主に承継されないため載せていない。
        月の欄は円記号を省いた桁区切り。
      </p>
    </div>
  )
}

/** 会計年度1年ぶんの月別収支。列＝9月〜8月＋年度合計 */
function MonthlyStatement({ r, year, note }: { r: IncomeStatementResult; year: number; note?: string }) {
  const alive = (x: StatementRow) => x.total !== 0 || x.months.some((m) => m !== 0)
  const income = r.income.filter(alive)
  const expense = r.expense.filter((x) => !STATEMENT_EXCLUDE.has(x.label) && alive(x))

  // 合計は表示している行だけから出す（元金・利息を除いた計にする）
  const byMonth = (rows: StatementRow[]) =>
    FISCAL_MONTHS.map((_, i) => rows.reduce((s, x) => s + x.months[i], 0))
  const inM = byMonth(income)
  const exM = byMonth(expense)
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  const range = fiscalYearRange(year)

  if (income.length === 0 && expense.length === 0) {
    return (
      <div className="pr-fill-block">
        <StatementHead year={year} range={range} note={note} />
        <p className="text-center text-slate-400 text-xs py-4">この年度の記帳がありません。</p>
      </div>
    )
  }

  return (
    <div className="pr-fill-block">
      <StatementHead year={year} range={range} note={note} />
      <table className="pr-monthly w-full border-collapse">
        <thead>
          <tr className="text-slate-500 border-b-2 border-slate-300">
            <th className="text-left font-medium">項目</th>
            {FISCAL_MONTHS.map((m, i) => (
              <th key={m} className={`text-right font-medium ${splitClass(i)}`}>{m}月</th>
            ))}
            <th className="text-right font-medium pr-total">年度合計</th>
          </tr>
        </thead>
        <tbody>
          <SectionRow label="収入" />
          {income.map((x) => <MonthRow key={x.label} row={x} />)}
          <MonthRow row={{ label: '収入計', months: inM, total: sum(inM) }} bold />

          <SectionRow label="支出" />
          {expense.map((x) => <MonthRow key={x.label} row={x} />)}
          <MonthRow row={{ label: '支出計', months: exM, total: sum(exM) }} bold />

          <MonthRow
            row={{ label: '差引', months: inM.map((v, i) => v - exM[i]), total: sum(inM) - sum(exM) }}
            bold
            top
          />
        </tbody>
      </table>
    </div>
  )
}

function StatementHead({
  year, range, note,
}: { year: number; range: { from: string; to: string }; note?: string }) {
  return (
    <div className="flex items-baseline gap-2 border-b-2 border-slate-800 pb-1 mb-1.5">
      <h3 className="text-sm font-bold text-slate-700">{year}年度</h3>
      <span className="text-[11px] text-slate-500">{range.from}〜{range.to}</span>
      {note && <span className="text-[11px] text-slate-400">（{note}）</span>}
    </div>
  )
}

/** 暦年が変わる位置（年度の5列目＝1月）に区切り線を入れる */
const splitClass = (i: number) => (i === FISCAL_PREV_YEAR_COLS ? 'pr-yearsplit' : '')

function SectionRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={FISCAL_MONTHS.length + 2} className="bg-slate-100 text-slate-700 font-medium">
        {label}
      </td>
    </tr>
  )
}

function MonthRow({ row, bold, top }: { row: StatementRow; bold?: boolean; top?: boolean }) {
  return (
    <tr
      className={
        'border-b border-slate-100 ' +
        (bold ? 'font-bold bg-slate-50 ' : '') +
        (top ? 'border-t-2 border-slate-800' : '')
      }
    >
      <td className={bold ? '' : 'pl-2'}>{row.label}</td>
      {row.months.map((v, i) => (
        <td key={i} className={`text-right tabular-nums ${splitClass(i)} ${v === 0 ? 'text-slate-300' : ''}`}>
          {v === 0 ? '—' : num(v)}
        </td>
      ))}
      <td className="text-right tabular-nums pr-total">{yen(row.total)}</td>
    </tr>
  )
}

/** 4. 運営費（会計年度の実績）。収支表に記帳された額をそのまま費目別に出す。
 *  ログイン無しで見た目を検証できるよう export してある（tabcheck から import する） */
export function OpexActualTable({ actual, lastFY }: { actual: OpexActual; lastFY: number }) {
  const range = fiscalYearRange(lastFY)
  if (!actual.hasData) {
    return (
      <div className="text-center text-slate-400 text-sm py-8">
        {lastFY}年度（{range.from}〜{range.to}）の支出が収支表に記帳されていません。
      </div>
    )
  }
  const pct = (v: number) => (actual.total > 0 ? `${((v / actual.total) * 100).toFixed(1)}%` : '—')

  return (
    <>
      <p className="text-[11px] text-slate-500 mb-2">
        {lastFY}年度（{range.from}〜{range.to}）に収支表へ記帳された実績。
        1年ぶんの収入と支出が揃うよう、常に1つ前の会計年度を出している。
      </p>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[11px] text-slate-500 border-b-2 border-slate-300">
            <th className="py-1.5 pr-2 text-left font-medium">費目</th>
            <th className="py-1.5 pr-2 text-right font-medium">月平均</th>
            <th className="py-1.5 pr-2 text-right font-medium">年額</th>
            <th className="py-1.5 text-right font-medium">構成比</th>
          </tr>
        </thead>
        <tbody>
          {actual.rows.map((r) => (
            <tr key={r.label} className="border-b border-slate-100">
              <td className="py-1.5 pr-2">{r.label}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{yen(r.annual / 12)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{yen(r.annual)}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-500">{pct(r.annual)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 運営費合計と、そこから外した公租公課を横に並べる。
          公租公課は年1回払いなので月平均は出さない */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <TotalBox label={`${lastFY}年度 運営費 合計`} annual={actual.total} monthlyAverage strong />
        <TotalBox label={`${lastFY}年度 公租公課`} annual={actual.tax} />
      </div>

      <p className="text-[11px] text-slate-500 mt-2">
        ※ 公租公課は税なので運営費と分けて表示している。修繕費は年によって大規模修繕で桁が変わるため
        修繕タブにまとめた。借入返済（元金・利息）は買主に承継されないため載せていない。
        金額が0円の費目は行ごと省いている。
      </p>
    </>
  )
}

/** 収入サマリー。家賃＋共益費／駐輪・駐車／総合計を分けて、満室時と現況の両方を出す。
 *  運営費は運営費タブ側にまとめてあるので、ここには出さない。
 *  ログイン無しで見た目を検証できるよう export してある（tabcheck から import する） */
export function IncomeSummary({
  rr, units,
}: {
  rr: ReturnType<typeof calcRentRoll>
  units: Unit[]
}) {
  const sum = (list: Unit[], f: (u: Unit) => number) => list.reduce((s, u) => s + f(u), 0)
  const occupied = units.filter(isOccupied)
  const rentOf = (u: Unit) => Number(u.rent ?? 0) + Number(u.kyoeki ?? 0)
  const parkOf = (u: Unit) => parkingYen(u.parking)

  const full = { rent: sum(units, rentOf), park: sum(units, parkOf) }
  const cur = { rent: sum(occupied, rentOf), park: sum(occupied, parkOf) }
  const refund = sum(units, (u) => Number(u.refund ?? 0))

  return (
    <div className="report-block">
      <h3 className="text-sm font-bold text-slate-700 border-b-2 border-slate-800 pb-1 mb-2">収入サマリー</h3>

      {/* 概要書でいちばん見たい数字なので、pr-summary で大きめに出す（prospectus.css） */}
      <table className="pr-summary w-full border-collapse mb-3">
        <thead>
          <tr className="text-slate-500 border-b border-slate-300">
            <th className="text-left font-medium" />
            <th className="text-right font-medium">家賃＋共益費</th>
            <th className="text-right font-medium">駐輪・駐車</th>
            <th className="text-right font-medium">総合計</th>
          </tr>
        </thead>
        <tbody>
          <MoneyRow label="満室時 月収" rent={full.rent} park={full.park} />
          <MoneyRow label="満室時 年収" rent={full.rent * 12} park={full.park * 12} strong />
          <MoneyRow label="現況 月収" rent={cur.rent} park={cur.park} />
          <MoneyRow label="現況 年収" rent={cur.rent * 12} park={cur.park * 12} strong />
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-2">
        <Metric label="稼働率" value={`${percent(rr.occupancyRate, 1)}（${rr.occupiedUnits}/${rr.totalUnits} 戸）`} />
        <Metric label="返還金 合計" value={yen(refund)} />
      </div>
    </div>
  )
}

/** strong＝年収の行。月収と見分けが付くよう太字＋薄い地色にする */
function MoneyRow({
  label, rent, park, strong,
}: { label: string; rent: number; park: number; strong?: boolean }) {
  return (
    <tr className={`border-b border-slate-100 ${strong ? 'font-bold bg-slate-50' : ''}`}>
      <td className="text-slate-600">{label}</td>
      <td className="text-right tabular-nums">{yen(rent)}</td>
      <td className="text-right tabular-nums">{yen(park)}</td>
      <td className="text-right tabular-nums">{yen(rent + park)}</td>
    </tr>
  )
}

/** 4. 修繕費（会計年度ごとの実績）。運営費から外したぶんをここにまとめる。
 *  ログイン無しで見た目を検証できるよう export してある（tabcheck から import する） */
export function RepairByYearTable({ rows, lastFY }: { rows: RepairByYear[]; lastFY: number }) {
  if (rows.length === 0) {
    return (
      <div className="text-center text-slate-400 text-sm py-6">
        収支表に修繕費の記帳がありません。
      </div>
    )
  }
  const total = rows.reduce((s, r) => s + r.annual, 0)

  return (
    <div className="report-block">
      <h3 className="text-sm font-bold text-slate-700 border-b-2 border-slate-800 pb-1 mb-2">
        年度別の修繕費（収支表の実績）
      </h3>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-[11px] text-slate-500 border-b-2 border-slate-300">
            <th className="py-1.5 pr-2 text-left font-medium">会計年度</th>
            <th className="py-1.5 pr-2 text-right font-medium">月平均</th>
            <th className="py-1.5 text-right font-medium">年額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const range = fiscalYearRange(r.year)
            return (
              <tr key={r.year} className={`border-b border-slate-100 ${r.year === lastFY ? 'bg-slate-50 font-bold' : ''}`}>
                <td className="py-1.5 pr-2">
                  {r.year}年度
                  <span className="text-slate-400 font-normal">（{range.from}〜{range.to}）</span>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{yen(r.annual / 12)}</td>
                <td className="py-1.5 text-right tabular-nums">{yen(r.annual)}</td>
              </tr>
            )
          })}
          <tr className="border-t-2 border-slate-800 font-bold">
            <td className="py-1.5 pr-2">{rows.length}年度の合計</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{yen(total / rows.length / 12)}</td>
            <td className="py-1.5 text-right tabular-nums">{yen(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="text-[11px] text-slate-500 mt-2">
        ※ 合計行の月平均は「{rows.length}年度の総額 ÷ {rows.length}年 ÷ 12ヶ月」。
        大規模修繕のある年に金額が偏るため、単年ではなくこの平均で見ること。
        年度をまたぐ古い修繕は下の明細を参照。
      </p>
    </div>
  )
}

/** 運営費タブの合計欄。monthlyAverage を付けたときだけ月平均を添える
 *  （公租公課は年1回払いなので月平均に意味がなく、出さない） */
function TotalBox({
  label, annual, monthlyAverage, strong,
}: { label: string; annual: number; monthlyAverage?: boolean; strong?: boolean }) {
  return (
    <div className={`pr-box rounded-lg px-3 py-2 ${strong ? 'bg-slate-800 text-white' : 'bg-slate-50'}`}>
      <div className={`text-[11px] ${strong ? 'text-slate-300' : 'text-slate-500'}`}>{label}</div>
      <div className={`font-bold text-base tabular-nums ${strong ? '' : 'text-slate-800'}`}>{yen(annual)}</div>
      {monthlyAverage && (
        <div className={`text-[11px] tabular-nums ${strong ? 'text-slate-300' : 'text-slate-500'}`}>
          月平均 {yen(annual / 12)}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`pr-box rounded-lg px-3 py-2 ${strong ? 'bg-slate-800 text-white' : 'bg-slate-50'}`}>
      <div className={`text-[11px] ${strong ? 'text-slate-300' : 'text-slate-500'}`}>{label}</div>
      <div className={`font-bold text-sm ${strong ? '' : 'text-slate-800'}`}>{value}</div>
    </div>
  )
}

// =====================================================================
// 2. レントロール（RentBook の units が正）
// =====================================================================
const STATUS_CLASS: Record<string, string> = {
  入居: 'bg-emerald-100 text-emerald-700',
  空室: 'bg-red-100 text-red-700',
  入予: 'bg-blue-100 text-blue-700',
  退予: 'bg-amber-100 text-amber-700',
  停止: 'bg-slate-200 text-slate-500',
}

/** 現在の契約内容だけを出す。過去の推移は年間収支表で見る（ユーザー指定）。
 *  ログイン無しで見た目を検証できるよう export してある（tabcheck から import する）。 */
export function RentRollTable({
  units, title, subtitle,
}: {
  units: Unit[]
  title?: string
  subtitle?: string
}) {
  const n = (v: unknown) => Number(v ?? 0)
  const moneyOf = (u: Unit) => ({ rent: n(u.rent), kyoeki: n(u.kyoeki), park: parkingYen(u.parking) })
  const sum = (f: (u: Unit) => number) => units.reduce((s, u) => s + f(u), 0)

  // report-block（break-inside: avoid）は付けない。1枚に収まらない長さになると
  // ブロックごと次ページへ送られて前のページに大きな空白が残るため。
  // 行が割れないことと見出しの繰り返しは prospectus.css 側で担保している。
  return (
    <div>
      {title && (
        <div className="border-b-2 border-slate-800 pb-1 mb-2">
          <h3 className="text-sm font-bold text-slate-700">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="pr-rentroll w-full border-collapse">
          <thead>
            <tr className="text-left text-slate-500 border-b-2 border-slate-300">
              <th className="py-1.5 pr-2">号室</th>
              <th className="py-1.5 pr-2">用途</th>
              <th className="py-1.5 pr-2">間取り</th>
              <th className="py-1.5 pr-2 text-right">専有面積(㎡)</th>
              <th className="py-1.5 pr-2 text-center">属性</th>
              <th className="py-1.5 pr-2 text-right">賃料</th>
              <th className="py-1.5 pr-2 text-right">共益費</th>
              <th className="py-1.5 pr-2 text-right">駐輪駐車</th>
              <th className="py-1.5 pr-2 text-right">合計</th>
              <th className="py-1.5 pr-2 text-right">敷金</th>
              <th className="py-1.5 pr-2 text-right">保証金</th>
              <th className="py-1.5 pr-2 text-right">礼金</th>
              <th className="py-1.5 pr-2 text-right">返還金</th>
              <th className="py-1.5 pr-2">契約開始日</th>
              <th className="py-1.5 pr-2">保証会社</th>
              <th className="py-1.5 text-center">状況</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => {
              const m = moneyOf(u)
              return (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="py-1 pr-2 font-medium whitespace-nowrap">{u.room}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{u.use_type ?? ''}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{u.layout ?? ''}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{u.area != null ? num(u.area) : ''}</td>
                  <td className="py-1 pr-2 text-center whitespace-nowrap">
                    {u.tenant_type ? `（${u.tenant_type}）` : ''}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(m.rent)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(m.kyoeki)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(m.park)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums font-medium">{num(m.rent + m.kyoeki + m.park)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(n(u.deposit))}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(n(u.hoshokin))}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(n(u.key_money))}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{num(n(u.refund))}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{u.contract_start ? formatDate(u.contract_start) : ''}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{u.guarantor ?? ''}</td>
                  <td className="py-1 text-center">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[u.status ?? ''] ?? 'bg-slate-100 text-slate-500'}`}>
                      {u.status}
                    </span>
                  </td>
                </tr>
              )
            })}
            <tr className="border-t-2 border-slate-800 font-bold">
              <td className="py-1.5 pr-2" colSpan={5}>合計（満室想定）</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => moneyOf(u).rent))}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => moneyOf(u).kyoeki))}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => moneyOf(u).park))}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {num(sum((u) => { const m = moneyOf(u); return m.rent + m.kyoeki + m.park }))}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => n(u.deposit)))}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => n(u.hoshokin)))}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => n(u.key_money)))}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{num(sum((u) => n(u.refund)))}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

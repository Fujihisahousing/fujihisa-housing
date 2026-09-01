// 集計ロジック（レントロール・利回り・収支表・入金状況）。UI から分離（SOW 設計方針）。
import { CAT_RENT, CAT_KYOEKI, CAT_PARKING, CAT_UTILITY } from '../types'
import type { MoveEvent, PaymentRecord, Property, RentHistory, Transaction, Unit } from '../types'

const n = (v: number | null | undefined) => Number(v ?? 0) || 0
const isOccupied = (u: Unit) => u.status === '入居' || u.status === '退予' // 退去予定も入居中・課金対象
const isStopped = (u: Unit) => u.status === '停止' // 募集停止：空室率の総数に含めない

// 指定年月時点で有効な賃料・共益費を履歴から求める。
// 「新しい開始月ほど優先」＝ effective_date が対象月の1日以前で最大の行を採用する。
// 履歴は適用開始月の1日で作るので、その月分から効く（例：2026-03-01 → 3月分から）。
//
// 対象月より前の履歴が無いときは「いちばん古い履歴」を使う。ここを units の現在値に
// していたのが、賃料改定のたびに過去月まで新家賃になっていた原因：
//   8月から値上げして履歴を1行足すと、7月は該当行が無いので現在値（＝新家賃）に落ちる。
//   入金記録に請求額が入っている月は記録が優先されるので無事だが、まだ記録が無い月
//   （＝7月）だけが新家賃で計算されてしまい、6月は正しいのに7月だけ狂って見えた。
// 改定時は PropertiesView 側で「改定前の額」も履歴に残すので、最古の履歴＝改定前の額になる。
//
// 判定は 'YYYY-MM-DD' の文字列同士の比較で行う。Date に変換して比べてはいけない：
// new Date('2026-03-01') は UTC の0時として解釈されるため JST では 3/1 9時になり、
// 対象月の1日0時（new Date(2026,2,1)）より後ろに回って、その月に適用されなくなる。
export function effectiveRentKyoeki(
  unit: Unit,
  history: RentHistory[] | undefined,
  year: number,
  month: number,
): { rent: number; kyoeki: number; parking: string | null } {
  // parking も返すのは物件概要書の過去年度レントロールと、入金状況の請求額のため。
  // 請求額は billedAmount() で 賃料＋共益費＋駐輪駐車 として組み立てる。
  const fallback = { rent: n(unit.rent), kyoeki: n(unit.kyoeki), parking: unit.parking ?? null }
  if (!history || history.length === 0) return fallback
  const asOf = `${year}-${String(month).padStart(2, '0')}-01`
  const startOf = (h: RentHistory) => String(h.effective_date).slice(0, 10)
  let best: RentHistory | null = null
  let oldest: RentHistory | null = null
  for (const h of history) {
    const d = startOf(h)
    if (d <= asOf && (!best || d > startOf(best))) best = h
    if (!oldest || d < startOf(oldest)) oldest = h
  }
  const hit = best ?? oldest
  return hit
    ? { rent: n(hit.rent), kyoeki: n(hit.kyoeki), parking: hit.parking ?? null }
    : fallback
}

// =====================================================================
// レントロール（SOW 6.4）
// =====================================================================
export interface RentRollRow {
  unit: Unit
  total: number // 賃料＋共益費
}

export interface RentRollResult {
  rows: RentRollRow[]
  totalUnits: number
  occupiedUnits: number
  occupancyRate: number // 稼働率 = 入居戸数 / 総戸数
  fullMonthly: number // 満室想定(月) = Σ(家賃+共益費+駐輪駐車) 全戸
  currentMonthly: number // 現況(月) = 入居戸の Σ(家賃+共益費+駐輪駐車)
  fullAnnual: number // 満室想定(年)
  grossYield: number | null // 表面利回り = 満室想定×12 / acquired_price
}

// 駐輪・駐車・バイク代（parking欄の金額文字列 '￥18,700' 等）を数値化。金額でなければ0。
export const parkingYen = (s?: string | null): number => {
  const m = s ? String(s).match(/[0-9][0-9,]*/) : null
  return m ? parseInt(m[0].replace(/,/g, ''), 10) : 0
}
// 1戸あたりの月額収入 ＝ 家賃＋共益費＋駐輪駐車（バイク代含む）
export const unitMonthly = (u: Unit) => n(u.rent) + n(u.kyoeki) + parkingYen(u.parking)

/**
 * 請求額 ＝ 賃料＋共益費＋駐輪駐車（バイク代・駐車場代含む）。
 * 入居者が毎月払う契約額そのもの。入金状況・滞納一覧・台帳同期で同じ定義を使う。
 * 以前は賃料＋共益費だけで出しており、駐輪代や駐車場代のぶんが請求額から落ちていた
 * （レントロールの満室想定＝unitMonthly とも定義がズレていた）。
 * parking は '￥18,700' 等の文字列で、'家賃込み' のように金額でなければ 0 になる。
 *
 * 賃料履歴（rent_history）の駐輪駐車が空のときは、部屋の現在値（units.parking）で補う。
 * 堂島のように「2019年5月の基準額」だけを履歴に入れた物件は、その行の parking が空のままで、
 * 履歴を見にいくと駐輪代が丸ごと 0 になってしまうため。履歴側は物件概要書の過去年度
 * レントロールが参照するので空のまま触らず、請求額を出すときだけ補完する。
 */
export const billedAmount = (
  eff: { rent: number; kyoeki: number; parking: string | null },
  unit?: Unit,
) => eff.rent + eff.kyoeki + parkingYen(eff.parking || unit?.parking)

export function calcRentRoll(units: Unit[], property?: Property | null): RentRollResult {
  const rows = units.map((u) => ({ unit: u, total: n(u.rent) + n(u.kyoeki) }))
  const totalUnits = units.filter((u) => !isStopped(u)).length // 停止は総数に含めない
  const occupiedUnits = units.filter(isOccupied).length
  // 満室想定・現況とも 家賃＋共益費＋駐輪駐車（バイク代）込みで集計
  const fullMonthly = units.reduce((s, u) => s + unitMonthly(u), 0)
  const currentMonthly = units.filter(isOccupied).reduce((s, u) => s + unitMonthly(u), 0)
  const fullAnnual = fullMonthly * 12
  const acquired = property?.acquired_price ? n(property.acquired_price) : 0
  return {
    rows,
    totalUnits,
    occupiedUnits,
    occupancyRate: totalUnits ? occupiedUnits / totalUnits : 0,
    fullMonthly,
    currentMonthly,
    fullAnnual,
    grossYield: acquired > 0 ? fullAnnual / acquired : null,
  }
}

// =====================================================================
// 収支表（SOW 6.5）— 行=項目 / 列=1〜12月＋合計
// =====================================================================
// transactions のカテゴリ → 収支表の行 へのマッピング
const INCOME_ROW_OF: Record<string, string> = {
  賃料: '家賃+共益費',
  共益費: '家賃+共益費',
  光熱費: '光熱費（入居者負担）',
  水道代: '光熱費（入居者負担）',
  電気代: '光熱費（入居者負担）',
  '駐車・駐輪': '駐車・駐輪',
  礼金: '礼金',
  敷金: '敷金',
  看板: '看板',
  KDDI: 'KDDI',
  タイムズ: 'タイムズ',
}
const EXPENSE_ROW_OF: Record<string, string> = {
  管理会社委託費: '管理会社委託費',
  BM: 'BM',
  EV保守費: 'EV保守費',
  '警備（アルソック）': 'アルソック',
  清掃費: '清掃費',
  修繕費: '修繕費',
  ゴミ処理代: 'ゴミ処理代',
  通信費: '通信費',
  公租公課: '公租公課',
  '保険料（建物保険）': '保険料（建物）',
  '保険料（賠償責任保険）': '保険料（賠償責任）',
  '道頓堀商店街　組合費': '商店街組合費',
  町会費: '町会費',
  '水道、電気代': '水道、電気代',
  水道光熱費: '水道、電気代', // 旧カテゴリ名。2026-07にDBを '水道、電気代' へ改名済みだが、
  // supabase/*.sql の取込スクリプトが旧名のままなので受け皿として残す
  元金: '元金',
  利息: '利息',
}
export const INCOME_ROWS = [
  '家賃+共益費', '駐車・駐輪', '光熱費（入居者負担）', '礼金', '敷金', '看板', 'KDDI', 'タイムズ', 'その他',
] as const
// 収支表の支出の行順（ユーザー指定の並び）。'その他' は必ず最後（未対応カテゴリの受け皿）。
export const EXPENSE_ROWS = [
  '管理会社委託費', 'BM', 'EV保守費', 'アルソック', '清掃費', '修繕費', 'ゴミ処理代', '水道、電気代',
  '通信費', '公租公課', '保険料（建物）', '保険料（賠償責任）', '商店街組合費', '町会費',
  '元金', '利息', 'その他',
] as const

// 特定物件のみ表示する行（他物件の単独表示では非表示。全体タブでは常に表示）。
// key=行ラベル、value=対象物件名（properties.name と完全一致）
// 借入のある物件だけ元金・利息を出す（近畿吉田ビル・富士マンション・戸建て6現場は対象外）
const LOAN_PROPERTIES = [
  'プランドール守口',
  'プランドール道頓堀',
  'プランドール阿波座',
  'ルネスプランドール守口',
  'プランドール堂島',
  'シャーメゾン新大阪',
  '川西市久代',
]
export const PROPERTY_ONLY_ROWS: ReadonlyMap<string, readonly string[]> = new Map([
  ['KDDI', ['プランドール道頓堀']],
  ['商店街組合費', ['プランドール道頓堀']],
  ['タイムズ', ['近畿吉田ビル']],
  ['管理会社委託費', ['プランドール道頓堀', '近畿吉田ビル']],
  ['元金', LOAN_PROPERTIES],
  ['利息', LOAN_PROPERTIES],
])

// どの物件でも（全体タブでも）表示しない行。実務上その費目が発生しないもの。
export const HIDDEN_ROWS: ReadonlySet<string> = new Set(['町会費'])

// 物件ごとに非表示にする行（その物件では発生しない費目）。全体タブでは表示する。
// key=物件名（properties.name と完全一致。「守口」は部分一致だと ルネス〜 と衝突するので必ず完全一致）
const KODATE_LIKE_HIDDEN = [
  '光熱費（入居者負担）', '看板',
  'BM', 'EV保守費', 'アルソック', '清掃費', 'ゴミ処理代', '通信費', '保険料（賠償責任）', '水道、電気代',
]
// 戸建ての各現場（2026-07に「戸建て賃貸」1物件から6現場へ分割。全体タブでは
// properties.group_name='戸建て賃貸' で1つの帯にまとまる）
export const KODATE_PROPERTIES = [
  '豊野町', '東中浜', '大庭町', '五月田町', '滝井元町', '東大阪松原',
]
export const PROPERTY_HIDDEN_ROWS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ...KODATE_PROPERTIES.map(
    (name) => [name, new Set(KODATE_LIKE_HIDDEN)] as [string, ReadonlySet<string>],
  ),
  ['プランドール守口', new Set(['ゴミ処理代', '保険料（賠償責任）'])],
  ['プランドール道頓堀', new Set(['ゴミ処理代'])],
  ['プランドール堂島', new Set(['看板', '保険料（賠償責任）'])],
  ['シャーメゾン新大阪', new Set(['看板', '保険料（賠償責任）'])],
  ['ルネスプランドール守口', new Set(['看板', '保険料（賠償責任）'])],
  ['プランドール阿波座', new Set(['光熱費（入居者負担）', '看板'])],
  ['近畿吉田ビル', new Set(['看板', 'アルソック', '清掃費', 'ゴミ処理代', '保険料（賠償責任）'])],
  ['富士マンション', new Set(KODATE_LIKE_HIDDEN)],
  // 川西市久代（戸建てグループには入れず、全体タブでも単体の帯で表示する）。
  // 残す行は 収入=家賃+共益費/礼金/敷金/その他、支出=水道、電気代/公租公課/保険料（建物）/元金/利息/その他
  [
    '川西市久代',
    new Set([
      '光熱費（入居者負担）', '看板',
      'BM', 'EV保守費', 'アルソック', '清掃費', '修繕費', 'ゴミ処理代', '通信費', '保険料（賠償責任）',
    ]),
  ],
])

// 収支表のこの行を、この物件の表示で出すか。画面・Excel出力の両方から使う。
export function isStatementRowVisible(label: string, propertyName: string): boolean {
  if (HIDDEN_ROWS.has(label)) return false
  const only = PROPERTY_ONLY_ROWS.get(label)
  if (only && propertyName !== '全体' && !only.includes(propertyName)) return false
  if (PROPERTY_HIDDEN_ROWS.get(propertyName)?.has(label)) return false
  return true
}

// =====================================================================
// 物件概要書の運営費（実績ベース）
// =====================================================================
/** 運営費に入れない行。
 *  公租公課は税なので運営費と分けて並べる（tax に入る）。
 *  修繕費は年によって大規模修繕で桁が変わり運営費の実態を歪めるので、修繕履歴タブへまとめる
 *  （calcRepairByFiscalYear）。元金・利息は買主に承継されない借入返済なので概要書には出さない。 */
const OPEX_TAX_ROW = '公租公課'
const OPEX_DROP_ROWS: readonly string[] = ['修繕費', '元金', '利息']

export interface OpexActualRow {
  label: string
  annual: number
}
export interface OpexActual {
  /** 運営費の行（修繕費を含む。公租公課・元金・利息は除く）。金額0の費目は落とす。EXPENSE_ROWS の並び */
  rows: OpexActualRow[]
  /** 運営費合計＝rows の合計 */
  total: number
  /** 公租公課（運営費とは別に並べる） */
  tax: number
  /** その年度に支出の記帳が1件でもあったか */
  hasData: boolean
}

/** 会計年度ぶんの支出実績を、収支表と同じ費目行に寄せて集計する。
 *
 *  金額0の行を落とすだけで、isStatementRowVisible による物件別の非表示は掛けない。
 *  行を隠すと「行を足しても合計に合わない」表になってしまうため（収支表で実際にあった罠）。 */
export function calcOpexActual(txs: Transaction[], year: number): OpexActual {
  const byRow = new Map<string, number>()
  let hasData = false
  for (const t of txs) {
    if (t.type !== 'expense') continue
    if (t.deleted_at) continue
    if (fiscalYearOf(new Date(t.date)) !== year) continue
    hasData = true
    const label = EXPENSE_ROW_OF[t.category] ?? 'その他'
    byRow.set(label, (byRow.get(label) ?? 0) + Number(t.amount ?? 0))
  }
  const rows: OpexActualRow[] = []
  for (const label of EXPENSE_ROWS) {
    if (label === OPEX_TAX_ROW || OPEX_DROP_ROWS.includes(label)) continue
    const annual = byRow.get(label) ?? 0
    if (annual === 0) continue
    rows.push({ label, annual })
  }
  return {
    rows,
    total: rows.reduce((s, r) => s + r.annual, 0),
    tax: byRow.get(OPEX_TAX_ROW) ?? 0,
    hasData,
  }
}

export interface RepairByYear {
  /** 会計年度（9月始まり。締める年で呼ぶ） */
  year: number
  annual: number
}

/** 収支表に記帳された修繕費を会計年度ごとに合計する（新しい年度が先頭）。
 *  大規模修繕でどの年にいくら掛けたかを見せるため、運営費からは外して修繕履歴タブに出す。 */
export function calcRepairByFiscalYear(txs: Transaction[]): RepairByYear[] {
  const byYear = new Map<number, number>()
  for (const t of txs) {
    if (t.type !== 'expense' || t.deleted_at) continue
    if ((EXPENSE_ROW_OF[t.category] ?? '') !== '修繕費') continue
    const y = fiscalYearOf(new Date(t.date))
    byYear.set(y, (byYear.get(y) ?? 0) + Number(t.amount ?? 0))
  }
  return [...byYear.entries()]
    .map(([year, annual]) => ({ year, annual }))
    .sort((a, b) => b.year - a.year)
}

// 会計年度は9月始まり8月締め。**年度は「締める年（終了年）」で呼ぶ**（弊社規定）。
// 例：2026年度 = 2025-09 〜 2026-08。開始年ではない点に注意。
export const FISCAL_START_MONTH = 9
/** 収支表の列の並び（0番目=9月 … 11番目=8月） */
export const FISCAL_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8] as const
/** 年度の前半（9〜12月）＝前の暦年 の列数。ヘッダーで年をまとめる幅に使う */
export const FISCAL_PREV_YEAR_COLS = FISCAL_MONTHS.filter((m) => m >= FISCAL_START_MONTH).length
/** その日付が属する会計年度。9〜12月は翌年の年度に入る（2025-09 → 2026年度） */
export function fiscalYearOf(d: Date): number {
  return d.getMonth() + 1 >= FISCAL_START_MONTH ? d.getFullYear() + 1 : d.getFullYear()
}
/** 会計年度の期間（表示用）。2026年度 → { from: '2025-09', to: '2026-08' } */
export const fiscalYearRange = (year: number) => ({ from: `${year - 1}-09`, to: `${year}-08` })
/** 会計年度内の月インデックス（9月=0 … 8月=11） */
export function fiscalMonthIndex(d: Date): number {
  return (d.getMonth() + 1 - FISCAL_START_MONTH + 12) % 12
}
/** 年月から会計年度・月インデックスを出す（日付を経由しない版） */
const fiscalYearOfYM = (y: number, m: number) => (m >= FISCAL_START_MONTH ? y + 1 : y)
const fiscalMonthIndexOfM = (m: number) => (m - FISCAL_START_MONTH + 12) % 12

/** 収入のうち、入金した月の収入として扱う費目。月々の家賃と違い一時金なので寄せない */
const INCOME_SAME_MONTH = new Set(['礼金', '敷金'])

/**
 * 収支表・支出表で、その記帳を「何年何月の欄に載せるか」。
 *
 * 収入（礼金・敷金を除く）は前家賃なので、入金した月ではなく対象月に寄せる。
 * 判定は入金状況とまったく同じ規則（11日以降の入金は翌月分）なので、
 * 入金状況の「○月分」と収支表の列が必ず一致する。
 * 支出と礼金・敷金は入金日の月のまま（現金の動きどおり）。
 */
export function accountingMonth(t: {
  type?: string
  category?: string
  date: string
}): { year: number; month: number } {
  if (t.type === 'income' && !INCOME_SAME_MONTH.has(t.category ?? '')) {
    return attributionMonth(t.date)
  }
  return ledgerMonth(t.date)
}
/** その記帳が属する会計年度（accountingMonth 基準） */
export function accountingFiscalYear(t: { type?: string; category?: string; date: string }): number {
  const a = accountingMonth(t)
  return fiscalYearOfYM(a.year, a.month)
}

// ---- 物件の決済（処分）に伴う表示制御 ----
// properties.disposed_date（決済日 'YYYY-MM-DD'）を基準に、時間軸を持つビュー
// （現況報告書・レントロール）から順に非表示にする。DBのデータは消さないので、
// 収支表（年度セレクタ）・入金状況（年月セレクタ）で過去はいつでも参照できる。
function ymd(s: string): { y: number; m: number } {
  const [y, m] = s.split('-').map(Number)
  return { y: y || 0, m: m || 1 }
}
/** 現況報告書：決済月の翌月1日以降は非表示（例 2026-07-30決済 → 2026-08-01から消える）。 */
export function isDisposedForStatusReport(disposed: string | null | undefined, today: Date): boolean {
  if (!disposed) return false
  const { y, m } = ymd(disposed)
  return today >= new Date(y, m, 1) // m は1-12なので new Date(y,m,1) が「翌月1日」
}
/** レントロール：決済した会計年度の翌年度開始（＝来期の9/1）以降は非表示。 */
export function isDisposedForRentRoll(disposed: string | null | undefined, today: Date): boolean {
  if (!disposed) return false
  const { y, m } = ymd(disposed)
  const fy = m >= FISCAL_START_MONTH ? y + 1 : y // その決済日が属する会計年度
  return today >= new Date(fy, FISCAL_START_MONTH - 1, 1) // 来期開始 = fy年9月1日
}

export interface StatementRow {
  label: string
  months: number[] // 12要素（0=9月 … 11=8月。FISCAL_MONTHS と同じ並び）
  total: number
}
export interface IncomeStatementResult {
  year: number
  income: StatementRow[]
  expense: StatementRow[]
  incomeTotalByMonth: number[]
  expenseTotalByMonth: number[]
  netByMonth: number[]
  incomeTotal: number
  expenseTotal: number
  net: number
}

function buildRows(
  labels: readonly string[],
  mapOf: Record<string, string>,
  txs: Transaction[],
): StatementRow[] {
  const table = new Map<string, number[]>()
  labels.forEach((l) => table.set(l, new Array(12).fill(0)))
  for (const t of txs) {
    const row = mapOf[t.category] ?? 'その他'
    const arr = table.get(row) ?? table.get('その他')!
    const m = fiscalMonthIndexOfM(accountingMonth(t).month)
    if (m >= 0 && m <= 11) arr[m] += n(t.amount)
  }
  return labels.map((l) => {
    const months = table.get(l)!
    return { label: l, months, total: months.reduce((s, v) => s + v, 0) }
  })
}

function sumByMonth(rows: StatementRow[]): number[] {
  const out = new Array(12).fill(0)
  for (const r of rows) for (let i = 0; i < 12; i++) out[i] += r.months[i]
  return out
}

// =====================================================================
// 賃貸物件管理表（全物件まとめ）
// 既存の収支表が「行=費目 / 列=12ヶ月」で1物件ぶんなのに対し、こちらは
// 物件を縦に積む。長年 Excel（フジヒサハウジング管理.xls）で運用してきた
// 「賃貸物件管理表」と同じ形。銀行提出・年次報告に使う。
// =====================================================================

/** 管理表の支出明細行。収支表の15費目をこの7つに畳む（畳み方は MGMT_ROW_OF）。 */
export const MGMT_EXPENSE_ROWS = [
  '管理費',
  '修繕費',
  '光熱費',
  '公租公課',
  '保険料',
  '元金',
  '利息',
] as const
export type MgmtExpenseRow = (typeof MGMT_EXPENSE_ROWS)[number]

// 収支表の行ラベル（EXPENSE_ROWS）→ 管理表の支出明細行。
// 元金・利息を支出に含める点が Excel と異なる（Excelでは借入返済・金利を
// 合計の外に置いていたが、利益を実際の手残りに合わせる）。
const MGMT_ROW_OF: Record<string, MgmtExpenseRow> = {
  管理会社委託費: '管理費',
  BM: '管理費',
  EV保守費: '管理費',
  アルソック: '管理費',
  清掃費: '管理費',
  ゴミ処理代: '管理費',
  修繕費: '修繕費',
  '水道、電気代': '光熱費',
  通信費: '光熱費',
  公租公課: '公租公課',
  商店街組合費: '公租公課',
  '保険料（建物）': '保険料',
  '保険料（賠償責任）': '保険料',
  元金: '元金',
  利息: '利息',
  // '町会費'（HIDDEN_ROWS）と 'その他' は下の ?? で '管理費' に入る
}
/** 明細行ごとに、そこへ畳まれる収支表の費目名。紙面の凡例に出す。
 *  MGMT_ROW_OF から導出しているので、対応を変えれば凡例も自動で追従する。 */
export const MGMT_ROW_MEMBERS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {}
  for (const row of MGMT_EXPENSE_ROWS) out[row] = []
  for (const [cat, row] of Object.entries(MGMT_ROW_OF)) out[row].push(cat)
  out['管理費'].push('その他') // 未対応カテゴリの受け皿（MGMT_ROW_OF の ?? 側）
  return out
})()

/** 収支管理表でだけ、戸建ての各現場を1つの帯にまとめる。表示名はこれ。
 *  レントロールの group_name による集約とは別で、この表専用の扱い。 */
export const MGMT_KODATE_LABEL = '戸建て賃貸'

// 帯ごとに出さない明細行（その物件では発生しない費目）。key は帯の名前。
// A3横1枚に収めるため、実務上ゼロの行はあらかじめ落としておく。
const MGMT_HIDDEN_ROWS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [MGMT_KODATE_LABEL, new Set(['光熱費'])],
  ['川西市久代', new Set(['管理費', '修繕費', '光熱費'])],
])
// 借入の無い帯では落とす行。金額が入っていれば残す。
const MGMT_DROP_WHEN_ZERO: ReadonlySet<string> = new Set(['元金', '利息'])

/** 築年月（'2022年4月' / '平成元年6月17日' の両方）から築年数を出す。取れなければ null */
export function buildingAgeYears(built: string | null | undefined, today = new Date()): number | null {
  if (!built) return null
  const wareki = built.match(/(昭和|平成|令和)\s*(\d+|元)年/)
  let y = 0
  if (wareki) {
    // 昭和1年=1926 / 平成1年=1989 / 令和1年=2019
    const base = wareki[1] === '昭和' ? 1925 : wareki[1] === '平成' ? 1988 : 2018
    y = base + (wareki[2] === '元' ? 1 : Number(wareki[2]))
  } else {
    const seireki = built.match(/(\d{4})\s*年/)
    if (!seireki) return null
    y = Number(seireki[1])
  }
  const age = today.getFullYear() - y
  return age >= 0 && age < 200 ? age : null
}

/** 物件1件ぶんの帯。各行はいずれも12ヶ月＋年間合計を持つ */
export interface MgmtPropertyBlock {
  propertyId: string
  name: string
  /** 見出しの2段目・3段目（新築 / 購入）。無ければ空文字 */
  built: string
  acquired: string
  /** 築年数の表示（例 '築37年'）。取れなければ空文字。集約した帯では空 */
  age: string
  income: StatementRow
  /** 支出の合計。表では収入の1つ下に出し、その下に expenses を明細として並べる */
  expenseTotal: StatementRow
  /** 表示する明細行だけ。MGMT_EXPENSE_ROWS の並びのまま、非表示分を除いてある */
  expenses: StatementRow[]
  net: StatementRow // 利益 = 収入 − 支出
}
export interface MgmtTableResult {
  year: number
  blocks: MgmtPropertyBlock[]
  /** 最下段の3行（全帯の合計）。収入・支出・利益 */
  grandIncome: StatementRow
  grandExpense: StatementRow
  grandNet: StatementRow
}

const emptyRow = (label: string): StatementRow => ({
  label,
  months: new Array(12).fill(0),
  total: 0,
})
const finishRow = (r: StatementRow): StatementRow => ({
  ...r,
  total: r.months.reduce((s, v) => s + v, 0),
})

/**
 * 入金状況の月次記録（payment_records）を収支表用の収入トランザクションに変換する。
 * 収支表と管理表で扱いが食い違わないよう共通化している。
 * KDDI契約の部屋（units.tenant='KDDI'）の入金だけは家賃ではなくKDDI収入として計上する。
 *
 * 家賃は「台帳に記帳する」運用と「入金状況に記録する」運用のどちらもあり得るので、
 * 収支表では両方を足している。ただし同じ家賃を両方に入れている月は二重計上になる。
 * そこで booked（既に賃料が記帳されている 号室×月）に当たる記録は足さない。
 * 記帳のほうを優先するのは、収支表が入金日ベース（現金主義）だから。
 *
 * 受取額は 賃料→共益費→駐車・駐輪→光熱費 の順に振り分けて出す。まとめ入金の按分
 * （allocateDeposit）と同じ順番。以前は受取額をまるごと賃料にしていたため、駐車場代・
 * 駐輪代が収支表の「家賃+共益費」行に混ざり、「駐車・駐輪」行はいつも0円だった。
 *   賃料＋共益費を払いきった残り … 契約の駐輪駐車欄（units.parking）の額まで「駐車・駐輪」
 *   それも超えた残り             … 「光熱費」（入居者負担の水道代など）
 * ルネスプランドール守口のように水道代を上乗せして請求する物件があり、その分が
 * 家賃側に乗ったままだと収支表の家賃が実態より膨らむ。
 */
/** 賃料履歴を unit_id ごとにまとめる。収支表・管理表・物件概要書で同じ形にして渡す */
export function rentHistoryMapOf(list: RentHistory[]): Map<string, RentHistory[]> {
  const m = new Map<string, RentHistory[]>()
  for (const h of list) {
    if (!m.has(h.unit_id)) m.set(h.unit_id, [])
    m.get(h.unit_id)!.push(h)
  }
  return m
}

export function paymentRecordsToTransactions(
  records: PaymentRecord[],
  units: Unit[],
  booked: ReadonlySet<string> = new Set(),
  rentHistoryByUnit?: Map<string, RentHistory[]>,
): Transaction[] {
  const kddiRooms = new Set<string>()
  for (const u of units) if (u.tenant === 'KDDI') kddiRooms.add(`${u.property_id}|${u.room}`)
  const unitIdOf = new Map<string, string>()
  for (const u of units) unitIdOf.set(`${u.property_id}|${u.room}`, u.id)
  const unitOf = new Map<string, Unit>()
  for (const u of units) unitOf.set(`${u.property_id}|${u.room}`, u)

  const out: Transaction[] = []
  for (const rec of records) {
    const paid = n(rec.paid)
    if (paid <= 0) continue
    const key = `${rec.property_id}|${rec.room}`
    const unitId = unitIdOf.get(key)
    // 号室が突き合わない記録は従来どおり足す
    if (unitId && booked.has(`${unitId}|${rec.year}-${String(rec.month).padStart(2, '0')}`)) continue

    // 月次記録は既に「何月分か」で持っているので、これ以上ずらしてはいけない。
    // accountingMonth は11日以降を翌月に寄せるため、日は必ず10日以前にする。
    const date = `${rec.year}-${String(rec.month).padStart(2, '0')}-01`
    const base = { property_id: rec.property_id, type: 'income' as const, date }
    const idBase = `pr-${rec.property_id}-${rec.room}-${rec.year}-${rec.month}`

    if (kddiRooms.has(key)) {
      out.push({ ...base, id: idBase, category: 'KDDI', amount: paid })
      continue
    }

    const u = unitOf.get(key)
    const split = splitParkingFrom(rec.year, rec.month)
    // 賃料＋共益費を払いきった残りを、契約の駐輪駐車欄の額まで駐車・駐輪に回す
    const pk = parkingYen(u?.parking)
    // 差し引く「賃料＋共益費」は、部屋の現在値と賃料履歴の当月額のうち高いほう。
    //   ・値下げした部屋（守口703：70,000→68,000）に今の額を当てると、過去の月の差額が
    //     光熱費に回ってしまう。当時の額のほうが高いので履歴を採る。
    //   ・逆に値上げのときに履歴の安い額まで下げないのは、改定日より前から実際の入金が
    //     新しい額で動いていることがあるため（堂島）。下げると差額が光熱費に流れる。
    // 賃料履歴を渡さない呼び出しは従来どおり部屋の現在値だけを使う。
    let rentBase = n(u?.rent) + n(u?.kyoeki)
    if (u && rentHistoryByUnit) {
      const eff = effectiveRentKyoeki(u, rentHistoryByUnit.get(u.id), rec.year, rec.month)
      rentBase = Math.max(rentBase, n(eff.rent) + n(eff.kyoeki))
    }
    const afterRent = Math.max(0, paid - rentBase)
    const parkingPart = split ? Math.min(afterRent, pk) : 0
    // それも超えた残りは光熱費（水道代など入居者負担分）
    const utilityPart = split ? Math.max(0, afterRent - parkingPart) : 0

    out.push({ ...base, id: idBase, category: CAT_RENT, amount: paid - parkingPart - utilityPart })
    if (parkingPart > 0) {
      out.push({ ...base, id: `${idBase}-pk`, category: CAT_PARKING, amount: parkingPart })
    }
    if (utilityPart > 0) {
      out.push({ ...base, id: `${idBase}-ut`, category: CAT_UTILITY, amount: utilityPart })
    }
  }
  return out
}

/**
 * 駐車・駐輪を分けて計上する対象の月か。2025年度（2024年9月）以降だけ分ける。
 * それ以前の収支表は既に確定して見慣れた数字になっているので、行の内訳を動かさない。
 * 対象を広げるならこの境目を変える（収入合計は変わらず、行の内訳だけが移る）。
 */
const PARKING_SPLIT_FROM = 2024 * 12 + (9 - 1) // 2024年9月
const splitParkingFrom = (year: number, month: number) =>
  year * 12 + (month - 1) >= PARKING_SPLIT_FROM

/**
 * 賃料・共益費が既に記帳されている「号室×帰属月」の集合を作る。
 * paymentRecordsToTransactions に渡して、同じ家賃の二重計上を防ぐ。
 * キーは `${unit_id}|YYYY-MM`。号室の紐付いていない記帳は対象外。
 *
 * 記帳の暦月ではなく帰属月で持つのが要点。前家賃なので 6/30 の入金は7月分＝
 * 月次記録では2026-07に載る。暦月（2026-06）で突き合わせると外れてしまい、
 * 同じ家賃が「6月＝記帳」「7月＝記録」の2か所に出てしまう。
 */
export function bookedRentKeys(transactions: Transaction[]): Set<string> {
  const s = new Set<string>()
  for (const t of transactions) {
    if (t.type !== 'income' || !t.unit_id) continue
    if (!RENT_CATEGORIES.has(t.category)) continue
    const { year, month } = attributionMonth(t.date)
    s.add(`${t.unit_id}|${year}-${String(month).padStart(2, '0')}`)
  }
  return s
}

/**
 * 賃貸物件管理表を組み立てる。year は会計年度（締める年）。
 * properties の並びがそのまま表の縦の並びになる。
 */
export function calcManagementTable(
  transactions: Transaction[],
  properties: Property[],
  year: number,
): MgmtTableResult {
  const inYear = transactions.filter((t) => accountingFiscalYear(t) === year)
  const today = new Date()

  // 戸建ての6現場はこの表では1つの帯にまとめる。物件ID → 帯のキー を先に決める。
  const isKodate = (p: Property) => KODATE_PROPERTIES.includes(p.name)
  const KODATE_KEY = '__kodate__'
  const keyOf = new Map<string, string>()
  for (const p of properties) keyOf.set(p.id, isKodate(p) ? KODATE_KEY : p.id)

  // 帯のキー → 月別の集計。帯数×行数が小さいので素直に回す
  const byBlock = new Map<string, { income: StatementRow; expenses: StatementRow[] }>()
  for (const key of new Set(keyOf.values())) {
    byBlock.set(key, {
      income: emptyRow('収入'),
      expenses: MGMT_EXPENSE_ROWS.map((label) => emptyRow(label)),
    })
  }

  for (const t of inYear) {
    const key = keyOf.get(t.property_id ?? '')
    if (!key) continue // 決済済みなどで properties に無い物件は表に出さない
    const bucket = byBlock.get(key)!
    const m = fiscalMonthIndexOfM(accountingMonth(t).month)
    if (m < 0 || m > 11) continue
    if (t.type === 'income') {
      bucket.income.months[m] += n(t.amount)
    } else {
      // 収支表の行ラベルを一度経由することで、旧カテゴリ名（水道光熱費など）の
      // 受け皿も EXPENSE_ROW_OF 側の定義をそのまま使える
      const statementRow = EXPENSE_ROW_OF[t.category] ?? 'その他'
      const label = MGMT_ROW_OF[statementRow] ?? '管理費'
      const idx = MGMT_EXPENSE_ROWS.indexOf(label)
      bucket.expenses[idx].months[m] += n(t.amount)
    }
  }

  // 帯の並びは properties の順。戸建ては最初に出てきた位置に1つだけ置く。
  const kodateCount = properties.filter(isKodate).length
  const order: { key: string; property: Property | null }[] = []
  const seen = new Set<string>()
  for (const p of properties) {
    const key = keyOf.get(p.id)!
    if (seen.has(key)) continue
    seen.add(key)
    order.push({ key, property: key === KODATE_KEY ? null : p })
  }

  const grandIncome = emptyRow('収入')
  const grandExpense = emptyRow('支出')
  const grandNet = emptyRow('利益')
  const blocks: MgmtPropertyBlock[] = order.map(({ key, property: p }) => {
    const b = byBlock.get(key)!
    const name = p ? p.name : `${MGMT_KODATE_LABEL}（${kodateCount}現場）`
    const expenseTotal = emptyRow('支出')
    const net = emptyRow('利益')
    // 合計は非表示行も含めた全費目で出す（行を隠しても金額は落とさない）
    for (let i = 0; i < 12; i++) {
      expenseTotal.months[i] = b.expenses.reduce((s, r) => s + r.months[i], 0)
      net.months[i] = b.income.months[i] - expenseTotal.months[i]
      grandIncome.months[i] += b.income.months[i]
      grandExpense.months[i] += expenseTotal.months[i]
      grandNet.months[i] += net.months[i]
    }
    // 表示する明細行を絞る。帯ごとの非表示指定（MGMT_HIDDEN_ROWS）は
    // 戸建ての集約帯では基準名（'戸建て賃貸'）でも引けるようにしておく。
    const hidden = MGMT_HIDDEN_ROWS.get(name) ?? MGMT_HIDDEN_ROWS.get(p ? name : MGMT_KODATE_LABEL)
    const shown = b.expenses.filter((e) => {
      if (hidden?.has(e.label)) return false
      if (MGMT_DROP_WHEN_ZERO.has(e.label) && e.months.every((v) => v === 0)) return false
      return true
    })
    const age = p ? buildingAgeYears(p.built, today) : null
    return {
      propertyId: key,
      name,
      built: p?.built ? `${p.built} 新築` : '',
      acquired: p?.acquired_date ? `${p.acquired_date} 購入` : '',
      age: age === null ? '' : `築${age}年`,
      income: finishRow(b.income),
      expenseTotal: finishRow(expenseTotal),
      expenses: shown.map(finishRow),
      net: finishRow(net),
    }
  })

  return {
    year,
    blocks,
    grandIncome: finishRow(grandIncome),
    grandExpense: finishRow(grandExpense),
    grandNet: finishRow(grandNet),
  }
}

/** year は会計年度（締める年）。2026 を渡すと 2025-09 〜 2026-08 が対象になる */
export function calcIncomeStatement(transactions: Transaction[], year: number): IncomeStatementResult {
  const inYear = transactions.filter((t) => accountingFiscalYear(t) === year)
  const income = buildRows(INCOME_ROWS, INCOME_ROW_OF, inYear.filter((t) => t.type === 'income'))
  const expense = buildRows(EXPENSE_ROWS, EXPENSE_ROW_OF, inYear.filter((t) => t.type === 'expense'))
  const incomeTotalByMonth = sumByMonth(income)
  const expenseTotalByMonth = sumByMonth(expense)
  const netByMonth = incomeTotalByMonth.map((v, i) => v - expenseTotalByMonth[i])
  const incomeTotal = incomeTotalByMonth.reduce((s, v) => s + v, 0)
  const expenseTotal = expenseTotalByMonth.reduce((s, v) => s + v, 0)
  return {
    year,
    income,
    expense,
    incomeTotalByMonth,
    expenseTotalByMonth,
    netByMonth,
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
  }
}

// =====================================================================
// 入金状況（SOW 6.6）— 月次・号室別
// =====================================================================
export type PaymentJudgement =
  | '空室'
  | '入金済'
  | '保証会社入金済'
  | '一部入金'
  | '保証会社請求中'
  | '未入金'

export interface PaymentRow {
  unit: Unit
  billed: number // 請求額 = rent+kyoeki+駐輪駐車（入居戸）
  paid: number // 入金額 = 当月分（前家賃で帰属）の賃料系入金
  paidDate: string | null // 入金日 = 当月分の最新入金の日付
  judgement: PaymentJudgement
  arrearsMonths: number // 滞納月数（初回入金月〜選択月で満額未達の月数）
}
export interface PaymentStatusResult {
  year: number
  month: number // 1-12
  rows: PaymentRow[]
  billedUnits: number // 請求対象戸数
  collectedUnits: number // 回収済（入金済/保証会社入金済）
  attentionUnits: number // 要対応（一部入金/保証会社請求中/未入金）
  collectionRate: number // 回収率 = 回収済 / 請求対象
}

// 入金状況で「賃料系の入金」として数えるカテゴリ。
// 請求額に駐輪駐車を含める以上、入金側も同じ範囲で拾わないと駐輪代のある戸が
// 毎月「一部入金」になってしまうので、駐車・駐輪もここに入れる。
// 光熱費（水道代・電気代）は請求額に含めないので対象外のまま。
const RENT_CATEGORIES = new Set<string>([CAT_RENT, CAT_KYOEKI, CAT_PARKING])
const isGuarantor = (s?: string | null) => Boolean(s && /保証/.test(s))
/** その記帳が賃料系（入金状況で扱う対象）か */
export const isRentCategory = (category: string) => RENT_CATEGORIES.has(category)

/**
 * 入金日から「何月分の入金か（帰属月）」を出す。前家賃ルール：
 * 11日以降の入金は翌月分の前払い、10日までの入金は当月分とみなす。
 * calcPaymentStatus の attrIdx と同じ規則。台帳→入金状況の反映でも使う。
 *
 * 'YYYY-MM-DD' の文字列はそのまま数値として読む。new Date(文字列) はUTCの0時として
 * 解釈されるので、タイムゾーンによって日付が1日ずれる（effectiveRentKyoeki で
 * 同じ理由の不具合があった）。日付の計算に Date を通さないこと。
 */
export function attributionMonth(date: string | Date): { year: number; month: number } {
  let y: number
  let m: number
  let d: number
  const iso = typeof date === 'string' ? date.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null
  if (iso) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else {
    const dt = typeof date === 'string' ? new Date(date) : date
    if (Number.isNaN(dt.getTime())) return { year: 0, month: 1 }
    y = dt.getFullYear()
    m = dt.getMonth() + 1
    d = dt.getDate()
  }
  const idx = y * 12 + (m - 1) + (d > 10 ? 1 : 0)
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

/** 収支表・支出表でその記帳が載る月（入金日ベースなので暦月そのまま） */
export function ledgerMonth(date: string | Date): { year: number; month: number } {
  const iso = typeof date === 'string' ? date.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) }
  const dt = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(dt.getTime())) return { year: 0, month: 1 }
  return { year: dt.getFullYear(), month: dt.getMonth() + 1 }
}

// 請求額・入金額・入居状況・保証会社有無 から判定を導出（手入力の入金額編集で使用）。
/**
 * 入金状況で、その月の契約者情報をどこから出すかを決める。
 *
 * 退去月は旧入居者が1か月まるまる払っているので、その行は旧入居者のまま残す。
 * ただし同じ月に新しい人が入ることがあるので、名前に「（旧）」を付けて取り違えを防ぐ。
 * 翌月からは部屋の現在値（＝新入居者、居なければ空）に切り替える。記録に残っている
 * 旧入居者の名前を出し続けると、いつまでも前の人の行に見えてしまうため。
 *
 * moveOutYm は 'YYYY-MM'。ym も同じ形。文字列比較で足りる（どちらも同じ桁数）。
 */
export interface TenantView {
  /** 記録ではなく部屋の現在値を使うか（退去月の翌月以降） */
  useUnit: boolean
  /** 名前に付ける接尾辞。退去月だけ '（旧）' */
  suffix: string
  /** 空室として扱うか（退去の翌月以降で、次の入居が無い） */
  vacant: boolean
}

export function tenantViewFor(
  occupiedNow: boolean,
  moveOutYm: string | null | undefined,
  ym: string,
): TenantView {
  const none = { useUnit: false, suffix: '', vacant: false }
  if (!moveOutYm) return none
  if (ym < moveOutYm) return none
  if (ym === moveOutYm) return { useUnit: false, suffix: '（旧）', vacant: false }
  return { useUnit: true, suffix: '', vacant: !occupiedNow }
}

/** 部屋ごとの退去月（'YYYY-MM'）。実際の退去日が無ければ退去予定日を使う */
export function moveOutYmByUnit(events: MoveEvent[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of events) {
    if (e.kind !== '退去') continue
    const d = String(e.actual_date ?? e.scheduled_date ?? '').slice(0, 7)
    if (!d) continue
    // 同じ部屋に複数あれば新しい方を採る（退去→入居→また退去 の順に積まれるため）
    const prev = m.get(e.unit_id)
    if (!prev || d > prev) m.set(e.unit_id, d)
  }
  return m
}

export function deriveJudgement(
  occupied: boolean,
  billed: number,
  paid: number,
  hasGuarantor: boolean,
): PaymentJudgement {
  if (!occupied) return '空室'
  if (paid >= billed && billed > 0) return hasGuarantor ? '保証会社入金済' : '入金済'
  if (paid > 0 && paid < billed) return '一部入金'
  if (paid === 0 && hasGuarantor) return '保証会社請求中'
  return '未入金'
}

export function calcPaymentStatus(
  units: Unit[],
  transactions: Transaction[],
  year: number,
  month: number, // 1-12
  rentHistoryByUnit?: Map<string, RentHistory[]>, // 未指定時は units の現在値のみ使用（旧挙動と同じ）
): PaymentStatusResult {
  // 前家賃ルール：翌月分は前月末日までに入金、当月10日を過ぎても未着なら滞納。
  // 入金の「帰属月」＝ 11日以降の入金は翌月分の前払い、10日までの入金は当月分とみなす。
  const attrIdx = (d: Date) => d.getFullYear() * 12 + d.getMonth() + (d.getDate() > 10 ? 1 : 0)
  const selIdx = year * 12 + (month - 1)

  // 締め切り経過（猶予判定）：過去月、または当月で本日が11日以降なら true
  const today = new Date()
  const nowIdx = today.getFullYear() * 12 + today.getMonth()
  const gracePassed = (i: number) => (i < nowIdx ? true : i > nowIdx ? false : today.getDate() >= 11)

  const rows: PaymentRow[] = units.map((u) => {
    const eff = effectiveRentKyoeki(u, rentHistoryByUnit?.get(u.id), year, month)
    const billed = billedAmount(eff, u)

    // この号室の賃料系入金を帰属月ごとに集計（選択月まで）
    const paidByMonth = new Map<number, number>()
    const selPayments: Transaction[] = []
    for (const t of transactions) {
      if (t.type !== 'income' || t.unit_id !== u.id || !RENT_CATEGORIES.has(t.category)) continue
      const idx = attrIdx(new Date(t.date))
      if (idx > selIdx) continue
      paidByMonth.set(idx, (paidByMonth.get(idx) ?? 0) + n(t.amount))
      if (idx === selIdx) selPayments.push(t)
    }
    const paid = paidByMonth.get(selIdx) ?? 0
    const paidDate =
      selPayments.length > 0
        ? selPayments.reduce((mx, t) => (t.date > mx ? t.date : mx), selPayments[0].date)
        : null
    const guarantorUnit = isGuarantor(u.payment_method) || selPayments.some((t) => isGuarantor(t.method))

    let judgement: PaymentJudgement
    if (!isOccupied(u)) judgement = '空室'
    else if (paid >= billed && billed > 0) judgement = guarantorUnit ? '保証会社入金済' : '入金済'
    else if (paid > 0 && paid < billed) judgement = '一部入金'
    else if (paid === 0 && guarantorUnit) judgement = '保証会社請求中'
    else judgement = '未入金'

    // 滞納月数：初回入金月〜選択月で、締め切り（当月10日）を過ぎても満額未達の月を数える
    let arrearsMonths = 0
    if (isOccupied(u) && billed > 0 && paidByMonth.size > 0) {
      const startIdx = Math.min(...paidByMonth.keys())
      for (let i = startIdx; i <= selIdx; i++) {
        if (gracePassed(i) && (paidByMonth.get(i) ?? 0) < billed) arrearsMonths++
      }
    }

    return { unit: u, billed, paid, paidDate, judgement, arrearsMonths }
  })

  const billable = rows.filter((r) => r.judgement !== '空室')
  const collected = rows.filter((r) => r.judgement === '入金済' || r.judgement === '保証会社入金済')
  const attention = rows.filter(
    (r) => r.judgement === '一部入金' || r.judgement === '保証会社請求中' || r.judgement === '未入金',
  )
  return {
    year,
    month,
    rows,
    billedUnits: billable.length,
    collectedUnits: collected.length,
    attentionUnits: attention.length,
    collectionRate: billable.length ? collected.length / billable.length : 0,
  }
}

// =====================================================================
// 未入金一覧 — 号室ごとに、滞納している月とその金額・合計を集計
// =====================================================================
export interface ArrearsMonthDetail {
  year: number
  month: number
  shortfall: number // その月の不足額（請求額−入金額）
}
export interface ArrearsUnitRow {
  unit: Unit
  tenant: string
  guarantor: string
  months: ArrearsMonthDetail[] // 未入金・一部入金の月（古い順）
  monthsCount: number
  total: number // 合計滞納額
  /** 滞納月数が手入力（payment_records.arrears_months）で上書きされているか */
  manualMonths: boolean
}

// 判定：入金済・保証会社入金済・空室 は滞納ではない
const isSettled = (j?: string | null) => j === '入金済' || j === '保証会社入金済' || j === '空室'

export function calcArrearsList(
  units: Unit[],
  records: PaymentRecord[],
  transactions: Transaction[],
  upToYear: number,
  upToMonth: number,
  rentHistoryByUnit?: Map<string, RentHistory[]>,
): ArrearsUnitRow[] {
  const selIdx = upToYear * 12 + (upToMonth - 1)
  const today = new Date()
  const nowIdx = today.getFullYear() * 12 + today.getMonth()
  // 締め切り経過（未到来の月は滞納に数えない）
  const gracePassed = (i: number) => (i < nowIdx ? true : i > nowIdx ? false : today.getDate() >= 11)
  const attrIdx = (d: Date) => d.getFullYear() * 12 + d.getMonth() + (d.getDate() > 10 ? 1 : 0)

  // 月次記録を号室（property_id|room）→ idx→record に索引化
  const recByUnit = new Map<string, Map<number, PaymentRecord>>()
  for (const rec of records) {
    const k = `${rec.property_id}|${rec.room}`
    if (!recByUnit.has(k)) recByUnit.set(k, new Map())
    recByUnit.get(k)!.set(rec.year * 12 + (rec.month - 1), rec)
  }
  // 記帳（transactions）の賃料系入金を unit_id→帰属月→合計 に索引化
  const paidByUnit = new Map<string, Map<number, number>>()
  for (const t of transactions) {
    if (t.type !== 'income' || !t.unit_id || !RENT_CATEGORIES.has(t.category)) continue
    const idx = attrIdx(new Date(t.date))
    if (!paidByUnit.has(t.unit_id)) paidByUnit.set(t.unit_id, new Map())
    const m = paidByUnit.get(t.unit_id)!
    m.set(idx, (m.get(idx) ?? 0) + n(t.amount))
  }

  const out: ArrearsUnitRow[] = []
  for (const u of units) {
    const recMap = recByUnit.get(`${u.property_id}|${u.room}`)
    const txMap = paidByUnit.get(u.id)
    // 記録のある月＋入金のある月 の和集合だけを見る（データの無い月は誤検知になるので数えない）
    const idxSet = new Set<number>()
    if (recMap) for (const i of recMap.keys()) idxSet.add(i)
    if (txMap) for (const i of txMap.keys()) idxSet.add(i)

    const months: ArrearsMonthDetail[] = []
    let tenant = u.tenant ?? ''
    let guarantor = u.guarantor ?? ''
    for (const idx of Array.from(idxSet).sort((a, b) => a - b)) {
      if (idx > selIdx || !gracePassed(idx)) continue
      const y = Math.floor(idx / 12)
      const mo = (idx % 12) + 1
      const eff = effectiveRentKyoeki(u, rentHistoryByUnit?.get(u.id), y, mo)
      const rec = recMap?.get(idx)
      let billed: number
      let paid: number
      if (rec) {
        if (isSettled(rec.judgement)) continue
        billed = rec.billed != null ? n(rec.billed) : billedAmount(eff, u)
        paid = rec.paid != null ? n(rec.paid) : 0
        if (!tenant && rec.tenant) tenant = rec.tenant
        if (!guarantor && rec.guarantor) guarantor = rec.guarantor
      } else {
        if (!isOccupied(u)) continue // 記録の無い空室月は数えない
        billed = billedAmount(eff, u)
        paid = txMap?.get(idx) ?? 0
      }
      const shortfall = Math.max(0, billed - paid)
      if (shortfall > 0) months.push({ year: y, month: mo, shortfall })
    }

    // 選択月の記録に滞納月数の手入力があれば、それを月数として採用する。
    // 明細（月ごとの不足額）と合計滞納額は実データのままにする＝上書きするのは件数だけ。
    const selRec = recMap?.get(selIdx)
    const manual = selRec?.arrears_months
    const manualMonths = manual != null
    const monthsCount = manualMonths ? manual : months.length

    // 手入力があるときはその月数で載せるか決める（0を入れたら「滞納なし」として一覧から外す）。
    // 手入力が無いときは従来どおり、計算上の滞納月がある部屋だけを載せる。
    if (manualMonths ? monthsCount > 0 : months.length > 0) {
      out.push({
        unit: u,
        tenant,
        guarantor,
        months,
        monthsCount,
        total: months.reduce((s, m) => s + m.shortfall, 0),
        manualMonths,
      })
    }
  }
  // 合計滞納額の大きい順
  return out.sort((a, b) => b.total - a.total)
}

// =====================================================================
// 物件概要書の収益指標（SOW 6.7）— M4 の概要書でも利用
// =====================================================================
export interface ProfitIndicators {
  gpi: number // 満室想定年収
  grossYield: number | null // 表面利回り = GPI / acquired_price
  currentAnnual: number // 現況年収
  currentYield: number | null // 現況利回り
  noi: number // 想定NOI = GPI×(1-空室率) - 運営費
  realYield: number | null // 実質利回り = NOI / acquired_price
}

export function calcProfitIndicators(
  rr: RentRollResult,
  property?: Property | null,
  opex = 0, // 運営費（年）
  vacancyRate = 0, // 空室率（0-1）
  // 利回りの分母。売買資料では取得価格ではなく想定売却価格で見たいので上書きできる。
  // 0/未指定なら従来どおり properties.acquired_price を使う。
  priceOverride = 0,
): ProfitIndicators {
  const acquired = priceOverride > 0 ? priceOverride : property?.acquired_price ? n(property.acquired_price) : 0
  const gpi = rr.fullAnnual
  const currentAnnual = rr.currentMonthly * 12
  const noi = gpi * (1 - vacancyRate) - opex
  return {
    gpi,
    grossYield: acquired > 0 ? gpi / acquired : null,
    currentAnnual,
    currentYield: acquired > 0 ? currentAnnual / acquired : null,
    noi,
    realYield: acquired > 0 ? noi / acquired : null,
  }
}

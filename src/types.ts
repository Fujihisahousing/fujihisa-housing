// RentBook データモデル型定義（SOW 5章 / 付録C のスキーマに対応）

export type TxType = 'income' | 'expense'
export type UnitStatus = '入居' | '空室' | '入予' | '退予' | '停止' | string

/** 部屋の状況（選択肢）。空室率の総数からは「停止」を除外する。入予=入居予定／退予=退去予定。 */
export const UNIT_STATUSES = ['入居', '空室', '入予', '退予', '停止'] as const
/** 用途の選択肢 */
export const USE_TYPES = [
  '住居', '事務所', '店舗', 'テナント', '倉庫', '物置', '駐車場', '看板', '賃貸', 'その他',
] as const
/** 入居者属性の選択肢 */
export const TENANT_TYPES = ['個人', '法人'] as const

/** 支払方法の選択肢。「誰から入金されるか」を表す。
 *  通帳・PDFからの自動読み取りで、どう照合するかがこれで決まる：
 *    振込     … 通帳に契約者名（カナ）が出るので、名前で突き合わせる
 *    保証会社 … 通帳には保証会社名しか出ないので、金額で突き合わせる
 *               （どの会社かは units.guarantor に持つ）
 *  isGuarantor（calc.ts）が '保証' を含むかで判定するので、
 *  '保証会社' の表記はこのまま変えないこと。 */
export const PAYMENT_METHODS = ['振込', '保証会社'] as const
export type LeaseStatus = '入居' | '退去'
export type Role = 'admin' | 'staff'

/** 5.1 properties（物件） */
export interface Property {
  id: string
  name: string
  address?: string | null
  access?: string | null
  type?: string | null
  structure?: string | null
  built?: string | null
  land_area?: number | null
  building_area?: number | null
  zoning?: string | null
  bcr?: number | null
  far?: number | null
  road?: string | null
  parking?: string | null
  /** 完了検査済日。築年月(built)とは別。現況報告用Excelに出力する */
  inspection_date?: string | null
  // --- 以下は物件概要書（売買資料）用のスペック。竣工年月は built、構造・規模は structure を使う ---
  /** 地番（住居表示 address とは別） */
  chiban?: string | null
  /** 主要用途（共同住宅+事務所 等） */
  main_use?: string | null
  /** 防火指定（防火地域 等） */
  fire_zone?: string | null
  height_district?: string | null
  building_cert_no?: string | null
  /** 確認済証（有り/無し） */
  building_cert?: string | null
  /** 検査済証（有り/無し）。inspection_date（完了検査済日）とは別項目 */
  inspection_cert?: string | null
  standard_floor_area?: number | null
  max_height?: number | null
  parking_count?: number | null
  basement?: string | null
  /** 総戸数／区画数の表記（例「18戸4事務所」）。units の実数とは別に原本表記を持つ */
  unit_count_label?: string | null
  mgmt_company?: string | null
  mgmt_contact?: string | null
  mgmt_phone?: string | null
  /** 決済日（売却の決済='YYYY-MM-DD'）。設定すると決済後に現況報告書→レントロールの順で
   *  自動的に一覧から消える（DBデータは消さないので過去の収支表・入金状況は残る）。 */
  disposed_date?: string | null
  acquired_date?: string | null
  acquired_price?: number | null
  sale_price?: number | null
  loan_balance?: number | null
  notes?: string | null
  /** レントロールの全体タブでまとめる単位。null なら物件単独で表示。
   *  例：戸建ての6現場は別物件だが group_name='戸建て賃貸' で1つの帯にまとまる */
  group_name?: string | null
  created_at?: string
}

/** 5.2 units（部屋） */
export interface Unit {
  id: string
  property_id: string
  room?: string | null
  layout?: string | null
  area?: number | null
  use_type?: string | null // 用途（住居/事務所/テナント/倉庫/駐車場 等）
  tenant_type?: string | null // 入居者属性（個人/法人）
  rent?: number | null
  kyoeki?: number | null
  variation?: string | null // 変動値（家賃変動。テキスト自由入力）
  deposit?: number | null
  hoshokin?: number | null // 保証金
  key_money?: number | null
  kaiyakubiki?: number | null // 解約引
  refund?: number | null // 返還金
  parking?: string | null // 駐輪場・駐車場
  status?: UnitStatus | null
  sort_order?: number | null // 表示順（小さいほど上。未設定は階数ロジックで並ぶ）
  tenant?: string | null // 契約者名（漢字/英字）
  tenant_kana?: string | null // 契約者名の読み（カナ）
  guarantor?: string | null
  payment_method?: string | null
  contract_start?: string | null
  contract_end?: string | null
  notes?: string | null
  created_at?: string
}

/** 5.3 transactions（入出金） */
export interface Transaction {
  id: string
  date: string
  property_id: string
  unit_id?: string | null
  type: TxType
  category: string
  amount: number
  method?: string | null
  status?: string | null
  memo?: string | null
  created_at?: string
  deleted_at?: string | null // 論理削除（NULLでない＝削除済み）
}

/** 監査ログ（変更履歴）。detail に変更前(old)・変更後(new)の行を保持 */
export interface AuditLog {
  id: string
  table_name: string
  record_id: string
  action: 'insert' | 'update' | 'delete' | string
  actor?: string | null
  actor_email?: string | null
  detail?: { old?: Record<string, unknown> | null; new?: Record<string, unknown> | null } | null
  created_at: string
}

/** 月次入金記録（入金状況の手動データ） */
export interface PaymentRecord {
  property_id: string
  room: string
  year: number
  month: number
  tenant?: string | null
  tenant_type?: string | null
  kana?: string | null
  billed?: number | null
  paid?: number | null
  paid_on?: string | null
  judgement?: string | null
  guarantor?: string | null
  memo?: string | null
  /** 滞納月数の手入力値。null なら自動計算値を表示する */
  arrears_months?: number | null
}

/** 入金状況の判定（手入力のプルダウンで選べる値） */
export const PAYMENT_JUDGEMENTS = [
  '入金済',
  '保証会社入金済',
  '一部入金',
  '保証会社請求中',
  '未入金',
  '空室',
] as const

/** 未入金一覧の保証会社対応メモ（号室単位） */
export interface ArrearsNote {
  unit_id: string
  expected_from_guarantor?: number | null
  reported?: boolean | null
  memo?: string | null
}

/** 入退去の種別 */
export const MOVE_KINDS = ['入居', '退去'] as const
export type MoveKind = (typeof MOVE_KINDS)[number]

/** 入退去シート（move_events）。個人情報は暗号化された leases 側に置くので、ここは運用データだけ。
 *  年月の項目（*_ym）は 'YYYY-MM'。請求は月単位なので日付ではなく月で持つ。 */
export interface MoveEvent {
  id: string
  unit_id: string
  kind: MoveKind
  /** 退去：予告を受けた日 */
  notice_date?: string | null
  /** 退去：予告書に書かれた退去予定日 */
  scheduled_date?: string | null
  /** 実際の入居日／退去日 */
  actual_date?: string | null
  /** 入居：入居月の日割り家賃（契約書どおりの手入力） */
  prorated_amount?: number | null
  /** 入居：日割りを計上する年月 */
  prorated_ym?: string | null
  /** 入居：満額請求を始める年月 */
  first_full_ym?: string | null
  /** 退去：最終請求月。退去月は満額もらう運用なので既定は退去月 */
  final_ym?: string | null
  /** 契約者名の控え（units.tenant は退去時にクリアするため） */
  tenant?: string | null
  /** 読み仮名の控え */
  tenant_kana?: string | null
  /** 入居日が来たら units に入れる契約内容。反映するまでここに置いておく */
  unit_patch?: Record<string, unknown> | null
  /** units へ反映した日時。null なら未反映 */
  applied_at?: string | null
  memo?: string | null
  created_at?: string
}

/** 退去帳簿（move_out_ledger）の1行。退去の記録1件につき1行。
 *  転居先住所は退去者の現住所そのものなので、move_events には置かず暗号化して別テーブルに持つ
 *  （admin のみ読み書き可・退去から pii_retention_years で自動消去）。
 *  この型に入っている forwarding_address は RPC で復号済みの平文。 */
export interface MoveOutLedgerEntry {
  id: string
  move_event_id: string
  unit_id: string
  /** ここから下は退去タブに書いた内容の控え。保存のたびに move_events から取り直す。
   *  部屋を消しても物件名を直しても、名簿には記録した時点の内容が残る。 */
  property_name?: string | null
  room?: string | null
  tenant?: string | null
  tenant_kana?: string | null
  notice_date?: string | null
  scheduled_date?: string | null
  actual_date?: string | null
  final_ym?: string | null
  memo?: string | null
  /** 🔒 連絡先（復号済みの平文） */
  contact?: string | null
  /** 🔒 転居先住所（復号済みの平文） */
  forwarding_address?: string | null
  /** 個人情報（連絡先・転居先住所）の消去予定日。控えは消えない */
  pii_purge_at?: string | null
  created_at?: string
  updated_at?: string
}

/** 賃料・共益費の履歴（反映開始日つき）。ある年月時点の実効値＝effective_date がその年月以前で最大の行。 */
export interface RentHistory {
  id: string
  unit_id: string
  effective_date: string
  rent: number
  kyoeki: number
  /** その反映開始日時点の駐輪駐車欄（units.parkingと同じテキスト形式） */
  parking?: string | null
  created_at?: string
}

/** 5.4 settings（key/value） */
export interface Setting {
  key: string
  value: unknown
}

/** 5.5 leases（入居履歴・個人情報の保管先。🔒は暗号化対象） */
export interface Lease {
  id: string
  unit_id: string
  status?: LeaseStatus | null
  tenant_name?: string | null // 🔒
  tenant_phone?: string | null // 🔒
  tenant_email?: string | null // 🔒
  emergency_contact?: string | null // 🔒
  tenant_employer?: string | null // 🔒
  guarantor_name?: string | null // 🔒
  guarantor_relation?: string | null // 🔒
  guarantor_address?: string | null // 🔒
  guarantor_phone?: string | null // 🔒
  guarantor_company?: string | null
  guarantor_contract_no?: string | null
  guarantor_period?: string | null
  rent?: number | null
  kyoeki?: number | null
  deposit?: number | null
  key_money?: number | null
  move_in?: string | null
  move_out?: string | null
  move_out_reason?: string | null
  forwarding_address?: string | null // 🔒
  deposit_settlement?: number | null
  restoration_cost?: number | null
  created_at?: string
  pii_purge_at?: string | null
}

/** 5.6 profiles（ユーザーの役割） */
export interface Profile {
  id: string
  email?: string | null
  role: Role
  created_at?: string
}

/** カテゴリ定義
 * 入力UIは「部屋ごと」「建物まとめ」の2系統。費目の単位（部屋／建物）で分けている。
 * 共益費・光熱費は手入力タイルには出さず、まとめ入金の自動振り分けでのみ使う。
 */

/** 部屋ごとの収入（部屋を選んで入力） */
export const ROOM_INCOME_CATEGORIES = ['賃料', '敷金', '礼金', '水道代', '電気代', 'その他'] as const

/** 建物ごとの収入（物件全体に紐づく） */
export const BUILDING_INCOME_CATEGORIES = ['看板', 'KDDI', 'タイムズ', 'その他'] as const

/** 建物ごとの支出（物件全体に紐づく） */
export const BUILDING_EXPENSE_CATEGORIES = [
  '管理会社委託費',
  'BM',
  'EV保守費',
  '警備（アルソック）',
  '清掃費',
  '修繕費',
  'ゴミ処理代',
  '通信費',
  '公租公課',
  '保険料（建物保険）',
  '保険料（賠償責任保険）',
  '道頓堀商店街　組合費',
  '町会費',
  '水道、電気代', // 旧名 '水道光熱費'。2026-07 に DB の値も含めて改名済み
  '元金',
  '利息',
  'その他', // 収支表では EXPENSE_ROW_OF 未定義カテゴリの受け皿である『その他』行に入る
] as const

/** まとめ入金の自動振り分けで使う収入カテゴリ名（賃料は ROOM_INCOME と共通） */
export const CAT_RENT = '賃料'
export const CAT_KYOEKI = '共益費'
export const CAT_UTILITY = '光熱費'
/** 駐車場代・駐輪場代。契約額の駐輪駐車欄（units.parking）に相当する分 */
export const CAT_PARKING = '駐車・駐輪'

// =====================================================================
// 物件概要書（売買資料）の付随データ
// 手本＝「台帳_プランドール守口.xlsx」の各シート。
// レントロールだけは units（RentBook側）を正とするので、ここには型を持たない。
// =====================================================================

/** 公的書類・特殊設備の有無（Excel「公的書類詳細」シート） */
export interface PropertyDocument {
  id: string
  property_id: string
  /** '公的書類'（確認済証・定期報告・謄本 等）／'特殊設備'（避雷設備・非常用発電機 等） */
  category: string
  name: string
  /** 有 / 無 / 確認中 */
  status?: string | null
  /** 現物のファイル名。保管場所の手がかりとして原本の表記をそのまま持つ */
  file_name?: string | null
  law?: string | null
  requirement?: string | null
  note?: string | null
  sort_order?: number | null
}
export const DOCUMENT_CATEGORIES = ['公的書類', '特殊設備'] as const
export const DOCUMENT_STATUSES = ['有', '無', '確認中'] as const

/** 法定点検・維持管理スケジュール（Excel「法定点検・維持管理」シート）。売買時の遵法性開示に使う */
export interface PropertyInspection {
  id: string
  property_id: string
  category?: string | null
  item: string
  law?: string | null
  frequency?: string | null
  /** 対象 / 非対象 / 確認中 */
  target?: string | null
  last_date?: string | null
  next_date?: string | null
  /** ○適合 / △指摘あり / ×要修繕 */
  judgement?: string | null
  vendor?: string | null
  note?: string | null
  sort_order?: number | null
}
export const INSPECTION_TARGETS = ['対象', '非対象', '確認中'] as const
export const INSPECTION_JUDGEMENTS = ['○適合', '△指摘あり', '×要修繕'] as const

/** 年間運営費内訳（Excel「運営費内訳」シート）。
 *  収支表(transactions)が「実際に払った額」なのに対し、こちらは「買主に示す想定運営費」。
 *  支払先・支払サイクル・法定義務の別は transactions に無いのでここで持つ。 */
export interface PropertyOpex {
  id: string
  property_id: string
  category?: string | null
  name: string
  payee?: string | null
  cycle?: string | null
  monthly?: number | null
  annual?: number | null
  /** 義務 / 任意 / 義務（昇降機有）等 */
  mandatory?: string | null
  note?: string | null
  sort_order?: number | null
}
export const OPEX_CATEGORIES = [
  '管理費', '法定点検費', '修繕費', '光熱費（共用）', '通信費', '保険・税', 'その他',
] as const
export const OPEX_CYCLES = ['月次', '年次', '年2回', '隔月', 'なし'] as const

/** 修繕履歴の明細（Excel「修繕費(専有部)」「修繕費(共用部)」シート）。
 *  transactions の修繕費は金額だけなので、箇所・内容・業者はこちらで持つ。
 *  major=true が大規模改修（原本では赤文字）で、売買資料の売り材料になる。 */
export interface PropertyRepair {
  id: string
  property_id: string
  /** 専有部 / 共用部 */
  scope: string
  repaired_on?: string | null
  kind?: string | null
  place?: string | null
  content?: string | null
  vendor?: string | null
  cost?: number | null
  major: boolean
  note?: string | null
  sort_order?: number | null
}
export const REPAIR_SCOPES = ['共用部', '専有部'] as const

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
  acquired_date?: string | null
  acquired_price?: number | null
  sale_price?: number | null
  loan_balance?: number | null
  notes?: string | null
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
export const ROOM_INCOME_CATEGORIES = ['賃料', '敷金', '礼金'] as const

/** 建物ごとの収入（物件全体に紐づく） */
export const BUILDING_INCOME_CATEGORIES = ['看板', 'KDDI', 'タイムズ'] as const

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
  '水道光熱費',
] as const

/** まとめ入金の自動振り分けで使う収入カテゴリ名（賃料は ROOM_INCOME と共通） */
export const CAT_RENT = '賃料'
export const CAT_KYOEKI = '共益費'
export const CAT_UTILITY = '光熱費'

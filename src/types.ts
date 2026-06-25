// RentBook データモデル型定義（SOW 5章 / 付録C のスキーマに対応）

export type TxType = 'income' | 'expense'
export type UnitStatus = '入居' | '空室' | string
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
  key_money?: number | null
  refund?: number | null // 返還金
  parking?: string | null // 駐輪場・駐車場
  status?: UnitStatus | null
  tenant?: string | null
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

/** カテゴリ初期値（SOW 5.3） */
export const INCOME_CATEGORIES = [
  '賃料', '共益費', '礼金', '敷金', '更新料', '看板・広告', 'その他入金',
] as const

export const EXPENSE_CATEGORIES = [
  '管理委託費', 'BM', '清掃費', '修繕費', 'ローン返済', '固定資産税', '水道光熱費', '損害保険料', 'その他出金',
] as const

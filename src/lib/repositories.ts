// repository層：UI・集計は必ずここ経由で DB にアクセスする（DB実装に依存させない）。
// RLS により、ログイン済みでないと読み書きできない。個人情報(leases)は admin のみ。
import { supabase } from './supabase'
import type { Property, Unit, Transaction, Setting, Profile, Lease, PaymentRecord } from '../types'

function unwrap<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message)
  return data as T
}

// ---------------------------------------------------------------------
// properties（物件）
// ---------------------------------------------------------------------
export const propertiesRepo = {
  async list(): Promise<Property[]> {
    const { data, error } = await supabase.from('properties').select('*').order('created_at')
    return unwrap(data, error)
  },
  async get(id: string): Promise<Property | null> {
    const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle()
    return unwrap(data, error)
  },
  async create(p: Partial<Property>): Promise<Property> {
    const { data, error } = await supabase.from('properties').insert(p).select().single()
    return unwrap(data, error)
  },
  async update(id: string, patch: Partial<Property>): Promise<Property> {
    const { data, error } = await supabase.from('properties').update(patch).eq('id', id).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('properties').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// units（部屋）
// ---------------------------------------------------------------------
export const unitsRepo = {
  async listAll(): Promise<Unit[]> {
    const { data, error } = await supabase.from('units').select('*').order('room')
    return unwrap(data, error)
  },
  async listByProperty(propertyId: string): Promise<Unit[]> {
    const { data, error } = await supabase
      .from('units')
      .select('*')
      .eq('property_id', propertyId)
      .order('room')
    return unwrap(data, error)
  },
  async create(u: Partial<Unit>): Promise<Unit> {
    const { data, error } = await supabase.from('units').insert(u).select().single()
    return unwrap(data, error)
  },
  async update(id: string, patch: Partial<Unit>): Promise<Unit> {
    const { data, error } = await supabase.from('units').update(patch).eq('id', id).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('units').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// transactions（入出金）
// ---------------------------------------------------------------------
export interface TxFilter {
  propertyId?: string | null // null/未指定 = 全体（合算）
  from?: string // 'YYYY-MM-DD'
  to?: string
}

export const transactionsRepo = {
  async list(filter: TxFilter = {}): Promise<Transaction[]> {
    let q = supabase.from('transactions').select('*').order('date', { ascending: false })
    if (filter.propertyId) q = q.eq('property_id', filter.propertyId)
    if (filter.from) q = q.gte('date', filter.from)
    if (filter.to) q = q.lte('date', filter.to)
    const { data, error } = await q
    return unwrap(data, error)
  },
  async create(t: Partial<Transaction>): Promise<Transaction> {
    const { data, error } = await supabase.from('transactions').insert(t).select().single()
    return unwrap(data, error)
  },
  /** 複数件をまとめて記帳（部屋ごと・建物まとめ入力で使用） */
  async createMany(rows: Partial<Transaction>[]): Promise<Transaction[]> {
    if (rows.length === 0) return []
    const { data, error } = await supabase.from('transactions').insert(rows).select()
    return unwrap(data, error)
  },
  async update(id: string, patch: Partial<Transaction>): Promise<Transaction> {
    const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select().single()
    return unwrap(data, error)
  },
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// payment_notes（入金状況の月別メモ）
// ---------------------------------------------------------------------
export const paymentNotesRepo = {
  /** 指定年月のメモを { unit_id: memo } のマップで取得 */
  async mapByMonth(year: number, month: number): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('payment_notes')
      .select('unit_id, memo')
      .eq('year', year)
      .eq('month', month)
    const rows = unwrap(data, error) as { unit_id: string; memo: string | null }[]
    const m: Record<string, string> = {}
    for (const r of rows) if (r.memo != null) m[r.unit_id] = r.memo
    return m
  },
  /** メモを保存（空なら削除） */
  async set(unitId: string, year: number, month: number, memo: string): Promise<void> {
    if (memo.trim() === '') {
      const { error } = await supabase
        .from('payment_notes')
        .delete()
        .eq('unit_id', unitId)
        .eq('year', year)
        .eq('month', month)
      if (error) throw new Error(error.message)
      return
    }
    const { error } = await supabase
      .from('payment_notes')
      .upsert({ unit_id: unitId, year, month, memo, updated_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// payment_records（入金状況の月次記録）
// ---------------------------------------------------------------------
export const paymentRecordsRepo = {
  /** 物件の月次記録を取得（propertyId=null は全件） */
  async list(propertyId: string | null): Promise<PaymentRecord[]> {
    let q = supabase.from('payment_records').select('*')
    if (propertyId) q = q.eq('property_id', propertyId)
    const { data, error } = await q
    return unwrap(data, error) as PaymentRecord[]
  },
  /** 備考を更新 */
  async setMemo(
    property_id: string,
    room: string,
    year: number,
    month: number,
    memo: string,
  ): Promise<void> {
    const { error } = await supabase
      .from('payment_records')
      .update({ memo, updated_at: new Date().toISOString() })
      .match({ property_id, room, year, month })
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// settings（key/value）
// ---------------------------------------------------------------------
export const settingsRepo = {
  async get<T = unknown>(key: string): Promise<T | null> {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle()
    const row = unwrap(data, error) as { value: T } | null
    return row ? row.value : null
  },
  async set(key: string, value: unknown): Promise<void> {
    const { error } = await supabase.from('settings').upsert({ key, value } as Setting)
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// profiles（役割）
// ---------------------------------------------------------------------
export const profilesRepo = {
  async getMine(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .eq('id', userId)
      .maybeSingle()
    return unwrap(data, error)
  },
}

// ---------------------------------------------------------------------
// leases（入居履歴・個人情報）— 暗号化/復号は必ずサーバ側 RPC 経由（admin のみ）
//   実際の入退去 UI は M3 で実装する。ここは基盤として用意。
// ---------------------------------------------------------------------
// leases RPC へ渡すペイロード（値は文字列でも数値でも可。サーバ側でパース）
export type LeasePayload = Record<string, string | number | null | undefined>

export const leasesRepo = {
  /** 号室の入居履歴を「復号済み」で取得（admin 以外は空配列） */
  async listByUnit(unitId: string): Promise<Lease[]> {
    const { data, error } = await supabase.rpc('leases_for_unit', { p_unit_id: unitId })
    return unwrap(data, error)
  },
  // RPC は jsonb を受け取り、数値・日付はサーバ側で文字列からパースする。
  // そのため payload は文字列値も許容する緩い型にする。
  /** 入居履歴を作成（🔒列はサーバ側で暗号化） */
  async create(payload: LeasePayload): Promise<string> {
    const { data, error } = await supabase.rpc('lease_create', { p: payload })
    return unwrap(data, error)
  },
  /** 退去処理（転居先は暗号化、pii_purge_at は保持年数から自動計算） */
  async end(payload: LeasePayload & { id: string }): Promise<void> {
    const { error } = await supabase.rpc('lease_end', { p: payload })
    if (error) throw new Error(error.message)
  },
}

// ---------------------------------------------------------------------
// 接続確認（M0 から継続利用）
// ---------------------------------------------------------------------
export async function pingSupabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { error } = await supabase.from('properties').select('id').limit(1)
    if (!error) return { ok: true, detail: 'properties に到達（テーブルあり）' }
    if (error.code === '42P01' || /relation .* does not exist/i.test(error.message)) {
      return { ok: true, detail: 'サーバー接続OK（schema.sql 未適用）' }
    }
    return { ok: true, detail: `サーバー応答あり: ${error.message}` }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

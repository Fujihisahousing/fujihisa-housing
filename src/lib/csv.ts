// データ書き出し（SOW 6.8）。CSV（transactions, UTF-8 BOM付）/ JSON（全テーブル）。
import { supabase } from './supabase'
import type { Transaction } from '../types'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function stamp(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** transactions を CSV（UTF-8 BOM付）で書き出す。Excel で文字化けしないよう BOM を付与。 */
export function exportTransactionsCSV(rows: Transaction[]) {
  const headers = ['date', 'type', 'category', 'amount', 'property_id', 'unit_id', 'method', 'status', 'memo']
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      headers.map((h) => csvCell((r as unknown as Record<string, unknown>)[h])).join(','),
    ),
  ]
  const bom = '﻿'
  download(new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `transactions_${stamp()}.csv`)
}

/**
 * 全テーブルを JSON で書き出す（控え・他用途向け）。
 * leases は個人情報のため admin のみ取得でき、🔒列は暗号文のまま（復号しない）。
 */
export async function exportAllJSON() {
  const tables = ['properties', 'units', 'transactions', 'settings', 'profiles', 'leases'] as const
  const out: Record<string, unknown> = { exported_at: new Date().toISOString() }
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*')
    out[t] = error ? { error: error.message } : data
  }
  download(
    new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }),
    `rentbook_backup_${stamp()}.json`,
  )
}

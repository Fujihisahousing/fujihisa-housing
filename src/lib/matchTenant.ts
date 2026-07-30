// 通帳の振込名義から号室を当てる。
//
// 通帳に出る名義は契約者名と一致しないことが多い：
//   アオキショウジ      ⇄ アオキショウジダイ  … 途中で切れる／余分に付く
//   カ）アオキショウジ  ⇄ アオキショウジ      … 法人格の有無
//   ｱｵｷｼｮｳｼﾞ            ⇄ アオキショウジ      … 半角カナ
// そこで「正規化 → 完全一致 → 前方一致 → 類似度」の順に当てていき、
// どの段階で当たったかを confidence として返す。呼び出し側はそれを見せて
// 人に承認させる（黙って確定させない）。
import type { Unit } from '../types'

/** 銀行の通帳でよく使われる法人格の略記。前後どちらに付くこともある。 */
const CORP_TOKENS = [
  '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
  '医療法人', '学校法人', '社会福祉法人', '一般社団法人', '一般財団法人', '宗教法人',
  '(株)', '(有)', '(合)', '(同)', '(財)', '(社)', '(医)', '(学)',
  '㈱', '㈲', '㈳', '㈶',
  // 通帳の省略形。「カ)」＝株式会社、「ユ)」＝有限会社 など
  'カ)', 'ユ)', 'ド)', 'ザ)', 'シャ)', 'イ)', 'ガク)', 'シユ)', 'ホ)',
  'カ.', 'ユ.',
]

/**
 * 照合用の正規形にする。
 * NFKC で半角カナ・全角英数・全角括弧をまとめ（ｱｵｷ→アオキ、ｶﾞ→ガ、（→( ）、
 * ひらがなをカタカナに寄せ、法人格と記号・空白を落とす。
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = String(raw).normalize('NFKC').toUpperCase()
  // ひらがな → カタカナ（契約者名がひらがな入力のことがある）
  s = s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  // 法人格を除去（長いものから消さないと「(株)」より先に「株式会社」が残る）
  for (const t of [...CORP_TOKENS].sort((a, b) => b.length - a.length)) {
    s = s.split(t).join('')
  }
  // 記号・空白・区切りを除去。長音符（ー）は意味が変わるので残す
  s = s.replace(/[\s　.,()（）「」『』・､、。／/\\|:：;；*＊#＃&＆'"’”-]/g, '')
  return s
}

/** レーベンシュタイン距離（1文字の挿入・削除・置換の最小回数） */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1, // 削除
        cur[j - 1] + 1, // 挿入
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), // 置換
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/** 0〜1 の似ている度合い。1 が完全一致 */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

/** どうやって当てたか。人に見せて承認させるために区別する */
export type MatchConfidence =
  | 'exact' // 正規化して完全一致
  | 'prefix' // 一方が他方で始まる（アオキショウジ ⊂ アオキショウジダイ）
  | 'similar' // 類似度が高い
  | 'ambiguous' // 候補が複数あって決められない
  | 'none' // 候補なし

export interface NameMatch {
  unitId: string // 確定した号室（ambiguous / none のときは空）
  confidence: MatchConfidence
  /** 確認用の候補。似ている順。ambiguous のときはここから選ばせる */
  candidates: { unitId: string; score: number }[]
}

// 前方一致で拾うのはこの文字数以上のときだけ（「ア」で当たると誤爆する）
const MIN_PREFIX = 3
// 類似とみなす下限
const SIMILAR_THRESHOLD = 0.7

/**
 * 通帳の名義から号室を当てる。契約者名は tenant_kana（読み方）を優先し、
 * 無ければ tenant（漢字）でも試す。通帳はカナなので通常はカナ側で当たる。
 */
export function matchTenantName(bankName: string, units: Unit[]): NameMatch {
  const q = normalizeName(bankName)
  if (!q) return { unitId: '', confidence: 'none', candidates: [] }

  // 号室ごとに、カナ・漢字それぞれの正規形を持つ
  const cands = units
    .map((u) => ({
      unitId: u.id,
      names: [normalizeName(u.tenant_kana), normalizeName(u.tenant)].filter(Boolean),
    }))
    .filter((c) => c.names.length > 0)

  const exact = cands.filter((c) => c.names.includes(q))
  if (exact.length === 1) return { unitId: exact[0].unitId, confidence: 'exact', candidates: [] }
  if (exact.length > 1) {
    return {
      unitId: '',
      confidence: 'ambiguous',
      candidates: exact.map((c) => ({ unitId: c.unitId, score: 1 })),
    }
  }

  const prefix = cands.filter((c) =>
    c.names.some(
      (n) =>
        n.length >= MIN_PREFIX &&
        q.length >= MIN_PREFIX &&
        (n.startsWith(q) || q.startsWith(n)),
    ),
  )
  if (prefix.length === 1) return { unitId: prefix[0].unitId, confidence: 'prefix', candidates: [] }
  if (prefix.length > 1) {
    return {
      unitId: '',
      confidence: 'ambiguous',
      candidates: prefix.map((c) => ({
        unitId: c.unitId,
        score: Math.max(...c.names.map((n) => similarity(q, n))),
      })).sort((a, b) => b.score - a.score),
    }
  }

  const scored = cands
    .map((c) => ({ unitId: c.unitId, score: Math.max(...c.names.map((n) => similarity(q, n))) }))
    .filter((c) => c.score >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return { unitId: '', confidence: 'none', candidates: [] }
  // 首位が2位を明確に上回っていれば採用。並んでいるなら選ばせる
  if (scored.length === 1 || scored[0].score - scored[1].score >= 0.1) {
    return { unitId: scored[0].unitId, confidence: 'similar', candidates: scored.slice(0, 3) }
  }
  return { unitId: '', confidence: 'ambiguous', candidates: scored.slice(0, 3) }
}

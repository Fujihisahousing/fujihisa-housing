// 帳票の紙面が「あと数行」ではみ出すときに、行間（セルの上下余白と行送り）だけを詰めて
// ページ内に収めるユーティリティ。物件概要書（prospectus.css）から使う。
//
// フォントと余白はこれまで物件ごとに手で実測して決め打ちしてきたため、行数の多い物件では
// 末尾の2〜3行だけが次ページへこぼれていた（例：シャーメゾン新大阪の運営費）。
// CSS だけでは「あと3行はみ出している」を検知できないので、描画後に高さを実測して
// セクションごとの詰め率 --pr-fit を決める。
//
// はみ出しの判定は1枚ものに限定していない。ページ数の端数が小さければ1ページぶん減らす、
// という同じ計算で「1.08ページ→1枚」も「2.15ページ→2枚」も扱える。
// 本当に複数ページ必要なもの（守口の修繕明細95行など）は端数が大きいので詰めない。
//
// React に依存しない純粋な DOM 操作にしてある（tabcheck から直接呼んで検証できるように）。

/** A4縦の中身の高さ。297mm から print.css の余白 12mm×2 を引いたもの */
export const PAGE_CONTENT_MM = 273
/** A4縦の中身の幅。210mm − 12mm×2 */
export const SHEET_WIDTH_MM = 186

/** 余白の詰め率の下限。これ以上は潰さない（下限でも収まらなければ詰めるのを諦める） */
export const FIT_MIN = 0.4
/** 行送りの詰め率の下限。行送りは余白ほど詰められないので浅くしてある */
export const LH_FIT_MIN = 0.88
/** 前のページへ吸収するはみ出しの上限（ページ数の端数）。25%＝1/4ページ以内なら詰める */
export const TAIL_TOLERANCE = 0.25

/** 測定誤差ぶんの余裕 */
const SAFETY_MM = 2
/** ページをまたぐ表は各ページで thead が繰り返される。その周りの余白ぶん */
const HEAD_EXTRA_MM = 3
/** 二分探索の回数。6回で 0.6/2^6 ≒ 0.01 まで詰まる */
const STEPS = 6

/** mm → px。ブラウザや dpi の差を吸収するため実測する */
export function mmToPx(doc: Document = document): number {
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;height:100mm;width:0;padding:0;border:0'
  doc.body.appendChild(probe)
  const px = probe.getBoundingClientRect().height / 100
  probe.remove()
  return px
}

/** 余白の詰め率から行送りの詰め率を作る。行送りは LH_FIT_MIN で頭打ちにする */
export function lineHeightFit(fit: number): number {
  return LH_FIT_MIN + (1 - LH_FIT_MIN) * fit
}

/** 目標ページ数。端数が TAIL_TOLERANCE 以内なら1ページ減らす（＝末尾数行を前へ吸収する） */
export function targetPages(heightPx: number, pagePx: number): number {
  if (pagePx <= 0) return 1
  const raw = heightPx / pagePx
  const floor = Math.floor(raw)
  if (floor >= 1 && raw - floor <= TAIL_TOLERANCE) return floor
  return Math.max(1, Math.ceil(raw))
}

/** 目標ページ数に収めるために許される高さ(px) */
export function usableHeight(pages: number, pagePx: number, theadPx: number, mmPx: number): number {
  const breaks = Math.max(0, pages - 1)
  return pages * pagePx - breaks * (theadPx + HEAD_EXTRA_MM * mmPx) - SAFETY_MM * mmPx
}

function applyFit(sheet: HTMLElement, fit: number) {
  sheet.style.setProperty('--pr-fit', fit.toFixed(4))
  sheet.style.setProperty('--pr-lh-fit', lineHeightFit(fit).toFixed(4))
}

function clearFit(sheet: HTMLElement) {
  sheet.style.removeProperty('--pr-fit')
  sheet.style.removeProperty('--pr-lh-fit')
  delete sheet.dataset.fit
}

function maxTheadHeight(sheet: HTMLElement): number {
  let max = 0
  sheet.querySelectorAll('thead').forEach((t) => {
    max = Math.max(max, t.getBoundingClientRect().height)
  })
  return max
}

/**
 * root 配下の .pr-sheet を1枚ずつ測り、わずかにはみ出しているものだけ行間を詰める。
 * 測定と復元は同期的に行うので、useLayoutEffect から呼べばちらつかない。
 */
export function fitSheets(root: HTMLElement | null | undefined): void {
  if (!root) return
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.pr-sheet'))
  if (sheets.length === 0) return

  const mmPx = mmToPx(root.ownerDocument)
  const pagePx = PAGE_CONTENT_MM * mmPx

  // 測るあいだだけ印刷時と同じ幾何にする。画面にしか出ない「行を追加」ボタンや
  // 編集列（.no-print）を一緒に測ってしまうと、実際より高く見積もってしまう。
  root.classList.add('pr-measuring')
  try {
    for (const sheet of sheets) {
      clearFit(sheet)
      const natural = sheet.getBoundingClientRect().height
      const pages = targetPages(natural, pagePx)
      const limit = usableHeight(pages, pagePx, maxTheadHeight(sheet), mmPx)
      if (natural <= limit) continue

      // 下限まで詰めても届かないなら諦める（無駄に潰れた見た目にしない）
      applyFit(sheet, FIT_MIN)
      if (sheet.getBoundingClientRect().height > limit) {
        clearFit(sheet)
        continue
      }

      // 収まる中でいちばん詰めない値を探す。lo は常に収まる値
      let lo = FIT_MIN
      let hi = 1
      for (let i = 0; i < STEPS; i++) {
        const mid = (lo + hi) / 2
        applyFit(sheet, mid)
        if (sheet.getBoundingClientRect().height <= limit) lo = mid
        else hi = mid
      }
      applyFit(sheet, lo)
      sheet.dataset.fit = lo.toFixed(3)
    }
  } finally {
    root.classList.remove('pr-measuring')
  }
}

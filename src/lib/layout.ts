// 画面の横幅（枠）の決め方をここに集約する。App / Header / PropertyTabs の
// 3か所で同じ判定を使うため、対象ビューの一覧が食い違わないようにしている。
import type { ViewKey } from '../state/useAppStore'

/** 表が横に広いビュー。枠をモニターの横幅いっぱいまで使う。 */
const WIDE_VIEWS: ReadonlySet<ViewKey> = new Set<ViewKey>([
  'rentroll',
  'summary',
  'mgmt',
  'payments',
  'prospectus',
  'statusreport',
  'rentcompare',
])

export function isWideView(view: ViewKey): boolean {
  return WIDE_VIEWS.has(view)
}

/** 枠の最大幅。wide のときは上限なし＝ビューポート幅いっぱい。
 * 横長モニターでは表の横スクロールが減り、横幅の狭いモニターでは
 * どのみちビューポート幅で頭打ちになるので従来と同じ見え方になる。 */
export const contentWidth = (wide: boolean, normal: string) =>
  (wide ? 'max-w-none' : normal) + ' mx-auto'

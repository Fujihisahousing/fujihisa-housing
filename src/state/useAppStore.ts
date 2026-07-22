import { create } from 'zustand'

/** 画面のメインビュー識別子（SOW 6章のビュー） */
export type ViewKey =
  | 'entry'
  | 'ledger'
  | 'properties'
  | 'rentroll'
  | 'summary'
  | 'payments'
  | 'prospectus'
  | 'statusreport'

interface AppState {
  /** 選択中の物件ID。null = 「全体」（合算表示） */
  activeProperty: string | null
  /** 表示中のビュー */
  activeView: ViewKey
  setActiveProperty: (id: string | null) => void
  setActiveView: (view: ViewKey) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeProperty: null, // null = 全体
  activeView: 'rentroll', // 起動時は資料の全体レントロールを表示
  setActiveProperty: (id) => set({ activeProperty: id }),
  setActiveView: (view) => set({ activeView: view }),
}))

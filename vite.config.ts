import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages（プロジェクトサイト）配信用の base 設定。
// 配信URL: https://<user>.github.io/fujihisa-housing/ （リポジトリ名 = fujihisa-housing）。
// リポジトリ名を変える場合はここを合わせること。Vercel等のルート配信なら '/' に。
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/fujihisa-housing/' : '/',
}))

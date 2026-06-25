import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages（プロジェクトサイト）配信用の base 設定。
// 例: https://<user>.github.io/rentbook/ で配信する場合は '/rentbook/'。
// リポジトリ名を変える場合はここを合わせること。Vercel等のルート配信なら '/' に。
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/rentbook/' : '/',
}))

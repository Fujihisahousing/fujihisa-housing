# RentBook（収益物件管理システム）

フジヒサハウジング管理物件DXシステム。Excel手入力をやめ、入出金を会計アプリ風UIで記帳してクラウド単一DB（Supabase）に蓄積し、どの端末からでも「本日時点の最新版」として4資料（物件概要書／レントロール／収支表／入金状況）を出力する。

- 仕様書: [docs/SOW.md](docs/SOW.md)
- 技術スタック: React + TypeScript + Vite / Tailwind CSS / Zustand / Supabase（PostgreSQL + Auth）/ SheetJS / lucide-react
- ホスティング: GitHub Pages（無料枠）

## セットアップ

```bash
npm install
cp .env.example .env.local   # 値を埋める（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）
npm run dev
```

- `.env.local` の `VITE_SUPABASE_ANON_KEY` に Supabase の anon public key を設定する。
- anon key はクライアントに公開される前提のキー。守りは Supabase の **RLS**。
- **service_role（秘密の鍵）は絶対にリポジトリ／アプリに置かない。**

## Supabase スキーマ・初期設定（M1）

1. `supabase/schema.sql` を Supabase の SQL Editor に貼り付けて実行（テーブル・RLS・トリガー・暗号化関数・RPC）。
2. 個人情報の暗号化キーを Vault に登録（一度だけ）。`<...>` は十分に長いランダム文字列に置き換える:
   ```sql
   select vault.create_secret('<ランダムな長い文字列>', 'rentbook_pii_key');
   ```
3. スタッフのアカウントを Authentication 画面で発行（メール＋パスワード）。ログイン時に `profiles` 行が自動作成される（既定 `staff`）。
4. 最初の管理者を昇格:
   ```sql
   update profiles set role = 'admin' where email = 'owner@example.com';
   ```

> 暗号化は **サーバ側（pgcrypto + Vault）** で行い、復号は `is_admin()` のみ。鍵はクライアント（anon key）には一切出ない。leases（個人情報）は RLS でも admin 限定。

### 個人情報の自動削除（保持ポリシー）

退去後 `pii_retention_years`（既定2年）で個人情報を匿名化する日次ジョブ。Supabase の Database > Extensions で **pg_cron** を有効化してから、SQL Editor で実行:

```sql
create extension if not exists pg_cron;
select cron.schedule('rentbook-purge-pii', '0 3 * * *', $$ select purge_expired_pii(); $$);
```

保持年数は `settings` の `pii_retention_years` / `accounting_retention_years` の数値変更だけで調整可能。会計データ（transactions）は削除されない。

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ起動 |
| `npm run build` | 型チェック＋本番ビルド |
| `npm run preview` | ビルド成果物のプレビュー |
| `npm run typecheck` | 型チェックのみ |

## マイルストーン進捗

- [x] **M0 雛形＋接続**：Vite+TS+Tailwind 初期化、Supabaseクライアント、.env、型定義、起動確認
- [x] **M1 スキーマ＋認証＋権限**：schema.sql（profiles自動作成・PII暗号化・RPC）、ログイン画面、セッション管理、role判定、repository層、ログインゲート
- [x] **M2 入力＋台帳**：会計風入力UI（カテゴリ→入力シート→記帳）、台帳（一覧・絞り込み・編集・削除）、物件・部屋マスタ管理、物件タブ、下部ナビ
- [x] **M3 物件軸＋集計＋入居履歴**：レントロール・収支表・入金状況（calc.ts）、入居者/保証人の登録と退去処理（leases、暗号化RPC・admin限定）、資料グループ
- [x] **M4 出力＋保持ポリシー**：物件概要書PDF（印刷）、3資料のExcel（SheetJS・遅延ロード）、CSV/JSON書出し、個人情報の自動削除関数＋pg_cronジョブ
- [ ] M5 デプロイ（GitHub Pages）
- [ ] M6 (Phase2) スキャン取込・自動消込・操作ログ

## デプロイ

`main` への push で `.github/workflows/deploy.yml` が GitHub Pages へ自動デプロイする。
リポジトリの Settings > Secrets に `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を登録すること。
リポジトリ名が `rentbook` 以外の場合は `vite.config.ts` の `base` を合わせる。

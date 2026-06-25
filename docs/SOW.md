# 収益物件管理システム 構築仕様書 兼 SOW（Supabase版）

- 文書バージョン: v2.1（クラウド構成＋個人情報保護）
- 作成日: 2026-06-23
- 想定実装手段: Claude Code
- プロジェクト略称: **RentBook**（社内呼称：フジヒサハウジング管理物件DXシステム）
- 運営: フジヒサハウジング

> v2.0 → v2.1 の変更点：入居者・保証人の個人情報を扱うため、**入居履歴（leases）／ロール権限（管理者・一般スタッフ）／機微項目の暗号化／保持期間と自動削除**を追加。
> v1.0（ローカルDB/Dexie版）からの変更点：**どこからでもアクセス**するため、データ保管を Supabase（クラウドDB＋認証）に変更。アプリは GitHub Pages 等で配信。UI・集計ロジック・出力仕様は v1 を踏襲。

---

## 0. この文書の位置づけ

プロトタイプ（会計アプリ風の入力UI、および ①物件概要書 ②レントロール ③収支表 ④入金状況 の4出力）で固めた要件を、**Claude Code で実装するための仕様書 兼 SOW** としてまとめたもの。本書をリポジトリの `docs/SOW.md` に置き、フェーズごとに Claude Code へ指示する。

---

## 1. 目的・ゴール

1. Excelの手入力をやめ、入出金を**会計アプリ風UI**で記帳し、**クラウドの単一DB**へ蓄積する。
2. **最上段の物件タブ**で物件を切り替え、いつでも「本日時点の最新版」として4資料を出力できる。
3. **どの端末・どの場所からでも**、ログインすれば同じデータにアクセスできる。
4. **会社のシステム**として、スタッフが各自のログインで利用する。
5. 月額固定費は**無料枠**で運用（個人〜小規模の利用量を想定）。
6. 将来、**スキャン（通帳・明細・領収書）→AIで自動記帳**できる土台を持つ。

---

## 2. スコープ

### 2.1 In Scope（Phase 1 / MVP）
- 認証：スタッフが各自のメール＋パスワードでログイン（アプリ専用。Supabase管理画面とは別）
- 物件・部屋マスタ管理（CRUD）
- 会計風入力UI（カテゴリ → 金額 → 物件/部屋/日付/メモ → 記帳）
- クラウド単一DB（Supabase / PostgreSQL）。全データを1か所に集約
- 最上段の物件タブ（「全体」＋物件別の切替）
- 台帳ビュー（一覧・絞り込み・編集・削除）
- レントロール（画面 ＋ Excel出力）
- 収支表（年間・月次／画面 ＋ Excel出力）
- 入金状況（月次・号室別・保証会社状態対応／画面 ＋ Excel出力）
- 物件概要書（A4 PDF出力＝印刷レイアウト）
- 入居履歴（leases）：入居者・保証人・保証会社・入退去・転居先・敷金精算を時系列で保持
- ロール権限（管理者 / 一般スタッフ）：個人情報は管理者のみ閲覧、スタッフにはマスキング
- 機微項目の暗号化保存（氏名・連絡先・緊急連絡先・保証人情報・転居先 等）
- 保持期間ポリシーと自動削除（個人情報＝退去後2年／会計データ＝7年・いずれも設定値）
- データ書き出し（CSV / JSON）

### 2.2 Phase 2
- スキャン取込：明細/領収書の画像 → AIビジョン（Claude）で行認識 → 記帳候補化
- 入金自動消込：各戸の請求額と入金実績を照合し、入金状況を自動判定
- 契約更新アラート（契約満了が近い入居者の通知）
- スタッフ操作ログ（誰がいつ個人情報を閲覧・変更したか）

### 2.3 Phase 3（任意）
- 売却シミュレーション（想定売却価格別の利回り・残債控除後の手残り）
- 確定申告向け集計（不動産所得の収支内訳）

### 2.4 Out of Scope
- 入居者募集ポータル連携、電子契約
- 会計ソフトそのものの代替（正式な仕訳・税務申告機能）

---

## 3. 技術スタック

| 区分 | 採用 | 補足 |
|---|---|---|
| 言語/フレームワーク | React + TypeScript + Vite | |
| スタイル | Tailwind CSS | プロト同系統のデザイン |
| UI状態管理 | Zustand | activeProperty / activeView |
| **DB／バックエンド** | **Supabase（PostgreSQL）** | クラウド単一DB |
| **認証** | **Supabase Auth（メール＋パスワード）** | アプリ専用ログイン |
| 接続クライアント | @supabase/supabase-js | |
| Excel出力 | SheetJS（xlsx） | レントロール/収支表/入金状況 |
| PDF出力 | 印刷CSS + ブラウザ印刷（任意で react-to-print） | 物件概要書 |
| アイコン | lucide-react | |
| ランタイム前提 | Node.js 18+（推奨 20/22 LTS） | ビルドに必須 |
| **ホスティング** | **GitHub Pages**（or Vercel） | 静的配信。無料 |
| 月額コスト | **無料枠**（Supabase Free / GitHub Pages） | |

**接続情報（このプロジェクト）**
- Supabase Project URL： `https://rpmiecrhnjpvgntltftd.supabase.co`
- anon public key（公開可能なキー）： `（控えた公開可能なキーを .env に設定）`
- ※ anon key はクライアントに埋め込まれて公開される前提のキー。安全性は後述の **RLS（行レベルセキュリティ）** で担保する。**service_role（秘密の鍵）は絶対にアプリ／リポジトリに入れない。**

**設計方針**：データアクセスは `repository層` に隔離し、UI・集計はDB実装に依存させない。認証状態に応じてアクセスを制御する。

---

## 4. システム構成

```
            ┌───────────────────────────────────────┐
   ブラウザ  │            UI (React) on GitHub Pages   │
 (PC/スマホ) │  ログイン / 物件タブ / 入力 / 台帳 / 4資料   │
            └───────────────┬───────────────────────┘
                            │ HTTPS（@supabase/supabase-js）
                            ▼
            ┌───────────────────────────────────────┐
            │              Supabase（クラウド）          │
            │  Auth（スタッフのログイン）                 │
            │  PostgreSQL（properties/units/transactions）│
            │  RLS（ログイン済みのみアクセス可）           │
            └───────────────────────────────────────┘

  出力：Excel(SheetJS) / PDF(print) / CSV・JSON 書き出し はクライアント側で生成
 (Phase2) スキャン画像 → Vision API(Claude) → 記帳候補 → DB
```

---

## 5. データモデル（PostgreSQL）

### 5.1 properties（物件）
id(uuid,PK) / name / address / access / type / structure / built / land_area(numeric) / building_area(numeric) / zoning / bcr(numeric) / far(numeric) / road / parking / acquired_date(date) / acquired_price(numeric) / sale_price(numeric) / loan_balance(numeric) / notes / created_at(timestamptz)

### 5.2 units（部屋）
id(uuid,PK) / property_id(uuid,FK) / room / layout / area(numeric) / rent(numeric) / kyoeki(numeric) / deposit(numeric) / key_money(numeric) / status / payment_method / notes / created_at
※ 入居者・保証人などの個人情報は units には持たず、**leases（入居履歴）** に保持する。現在の入居者は status='入居' の最新 lease から参照する。

### 5.3 transactions（入出金）
id(uuid,PK) / date(date) / property_id(uuid,FK) / unit_id(uuid,FK,null可) / type('income'|'expense') / category / amount(numeric) / method / status / memo / created_at

**カテゴリ初期値**
- 収入：賃料 / 共益費 / 礼金 / 敷金 / 更新料 / 看板・広告 / その他入金
- 支出：管理委託費 / BM / 清掃費 / 修繕費 / ローン返済 / 固定資産税 / 水道光熱費 / 損害保険料 / その他出金

### 5.4 settings（key/value）
key(text,PK) / value(jsonb)

### 5.5 leases（入居履歴・個人情報の保管先）
- id(uuid,PK) / unit_id(uuid,FK) / status('入居'|'退去')
- 🔒tenant_name（氏名）/ 🔒tenant_phone / 🔒tenant_email / 🔒emergency_contact（緊急連絡先）/ 🔒tenant_employer（勤務先・任意）
- 🔒guarantor_name（連帯保証人 氏名）/ 🔒guarantor_relation（続柄）/ 🔒guarantor_address / 🔒guarantor_phone
- guarantor_company（保証会社名）/ guarantor_contract_no（契約番号）/ guarantor_period（保証期間）
- rent / kyoeki / deposit / key_money
- move_in(date 入居日) / move_out(date 退去日) / move_out_reason（退去理由）
- 🔒forwarding_address（転居先住所）/ deposit_settlement（敷金精算額）/ restoration_cost（原状回復費）
- created_at / pii_purge_at(date 個人情報削除予定日＝退去日＋設定年数)

🔒＝暗号化対象（保存前に暗号化し、復号は管理者ロールのみ）。号室を入れ替えても過去の入居者情報が履歴として残る。

### 5.6 profiles（ユーザーの役割）
- id(uuid,PK＝auth.users.id) / email / role('admin'|'staff') / created_at
- Supabase Auth のユーザーと1:1。ログイン後に role を判定し、UI表示・RLSの両方で個人情報の出し分けに使う。

> 完全なSQL（テーブル作成＋RLS）は **付録C** にあり、これを Supabase の SQL Editor に貼って実行する。

---

## 6. 機能要件（画面別）

### 6.0 ログイン
- 未ログイン時はログイン画面のみ表示。スタッフはメール＋パスワードでログイン。
- アカウントの発行は管理者（オーナー）が Supabase の Authentication 画面で行う（Phase 1）。

### 6.1 物件タブ（最上段）
「全体」＋登録物件を横スクロールタブで表示。タップで `activeProperty` を切替、全ビューがフィルタされる（全体は合算）。

### 6.2 入力（会計風UI）
収入/支出カテゴリをタイル表示 → タップで入力シート（金額・物件・部屋・日付・メモ）→ 保存で transactions に追加。

### 6.3 台帳
activeProperty でフィルタした入出金を新しい順に表示。編集・削除可。

### 6.4 レントロール（画面＋Excel）
- 満室想定(月)＝Σ(rent+kyoeki)（全戸）／現況(月)＝入居戸のΣ／稼働率＝入居戸数/総戸数
- 表面利回り＝満室想定×12 / acquired_price
- 列：号室・間取・面積・賃料・共益費・合計・敷金・契約者・契約満了・状況

### 6.5 収支表（年間・月次／画面＋Excel）
- 行＝項目、列＝1〜12月＋年間合計
- 収入：家賃 / 共益費 / 看板・広告 / 礼金・更新料 / その他　支出：管理委託費 / BM / 清掃費 / 共用部光熱費 / 修繕費 / 固都税 / 損害保険料 / ローン返済 / その他
- 各月＝当月 transactions のカテゴリ別合計。収入計・支出計・差引を算出。部屋別に分けず合計ベース。

### 6.6 入金状況（月次・号室別／画面＋Excel）
- 請求額＝rent+kyoeki（入居戸）／入金額＝当月の賃料系入金（該当unit）合計
- 判定：空室→対象外／入金≧請求→入金済（保証会社methodなら「保証会社入金済」）／0<入金<請求→一部入金／入金=0かつmethod=保証会社→保証会社請求中／入金=0→未入金
- サマリー：請求対象戸数 / 回収済 / 要対応 / 回収率
- Phase 1 は status 手動設定可、Phase 2 で自動化

### 6.7 物件概要書（PDF）
スペック＋収益指標（満室想定年収・表面利回り・現況年収・現況利回り・想定NOI・実質利回り）＋レントロール要約。印刷でA4 PDF化。
- 表面利回り＝GPI / acquired_price、実質利回り＝NOI / acquired_price（運営費・空室率は設定可能な前提値）

### 6.8 データ書き出し
CSV（transactions, UTF-8 BOM付）/ JSON（全テーブル）。DB自体はSupabaseに常時保管され、CSV/JSONは控え・他用途向け。

---

## 7. 認証・セキュリティ・個人情報保護

### 7.1 2種類のログインを分離
- Supabase ダッシュボード（管理者のみ。プロジェクト設定・ユーザー発行）
- アプリのログイン（スタッフ各自。Supabase Auth／メール＋パスワード）

### 7.2 ロール（権限）
- **admin（管理者）**：全データを閲覧・編集。入居者・保証人の個人情報も閲覧可（復号可）。
- **staff（一般スタッフ）**：物件・号室・賃料・入金状況までは閲覧可。**氏名・連絡先・保証人情報などの個人情報は閲覧不可（マスキング）**。
- 役割は profiles.role で判定。UIで隠すだけでなく、**RLSとビューでDBレベルに取得できない**ようにする。

### 7.3 暗号化
- 通信：HTTPS（標準）。保管：Supabaseのディスク暗号化（標準）。
- さらに **機微項目（leasesの🔒列）はアプリ保存前に暗号化**して格納。pgcrypto もしくは Supabase Vault による鍵管理を用い、復号は admin のみ。
- anon public key はクライアントに公開される前提（守りはRLS）。**service_role（秘密の鍵）はアプリ／リポジトリに置かない**。

### 7.4 保持期間と自動削除（設定値）
- **個人情報（leasesの🔒列）＝退去後 2年** で自動削除（匿名化）。
- **会計データ（transactions 等の金額・取引記録）＝7年** 保持（税務対応）。
- いずれも settings の値（`pii_retention_years=2` / `accounting_retention_years=7`）として持ち、**数値変更だけで調整可能**。
- 退去日＋保持年数を `pii_purge_at` に保持し、定期ジョブ（Supabase の pg_cron 等）で期限到来分の🔒列を消去／匿名化。会計データは残す。
- 退去者情報の保有目的：再入居判断・原状回復/敷金精算のトラブル対応。目的外の長期保有はしない。

---

## 8. ファイル構成

```
rentbook/
├─ index.html
├─ package.json
├─ vite.config.ts                 # GitHub Pages 用 base 設定
├─ tsconfig.json
├─ tailwind.config.js
├─ postcss.config.js
├─ .env.local                     # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（gitignore）
├─ .gitignore
├─ README.md
├─ docs/
│  └─ SOW.md                      # 本書
├─ supabase/
│  └─ schema.sql                  # 付録Cのテーブル＋RLS（SQL Editorで実行）
├─ .github/workflows/
│  └─ deploy.yml                  # GitHub Pages 自動デプロイ
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ types.ts
   ├─ lib/
   │  ├─ supabase.ts              # Supabaseクライアント初期化
   │  ├─ repositories.ts          # CRUD（UIはここ経由でDBアクセス）
   │  ├─ format.ts                # yen() / 日付
   │  ├─ calc.ts                  # レントロール・利回り・NOI・収支
   │  ├─ csv.ts                   # CSV書出し/取込
   │  └─ ocr.ts                   # (Phase2) Vision取込
   ├─ auth/
   │  ├─ AuthProvider.tsx         # セッション管理
   │  └─ LoginView.tsx            # ログイン画面
   ├─ state/
   │  └─ useAppStore.ts           # Zustand：activeProperty / activeView
   ├─ components/
   │  ├─ layout/ (PropertyTabs / Header / BottomNav)
   │  ├─ entry/  (EntryGrid / EntrySheet)
   │  └─ common/ (Modal / Tag / Stat / Toggle)
   ├─ features/
   │  ├─ ledger/LedgerView.tsx
   │  ├─ rentroll/RentRoll.tsx
   │  ├─ summary/IncomeStatement.tsx
   │  ├─ payments/PaymentStatus.tsx
   │  └─ prospectus/Prospectus.tsx
   ├─ reports/ (exportExcel.ts / print.css)
   └─ styles/index.css
```

---

## 9. 開発フェーズ・マイルストーン

| MS | 内容 | 成果物 |
|---|---|---|
| **M0 雛形＋接続** | Vite+TS+Tailwind 初期化、Supabaseクライアント、.env、型定義、起動確認 | 空アプリがSupabaseに接続できる |
| **M1 スキーマ＋認証＋権限** | 付録CのSQLを適用（profiles/leases含む）、ログイン画面、セッション管理、role判定、機微項目の暗号化、repository | ログイン→role別にDB読み書き、個人情報はadminのみ |
| **M2 入力＋台帳** | 会計風入力UI、台帳 | 記帳→クラウド保存→一覧反映 |
| **M3 物件軸＋集計＋入居履歴** | 物件タブ、レントロール、収支表、入金状況、入居者/保証人の登録と退去処理（leases） | 4ビュー＋入退去管理 |
| **M4 出力＋保持ポリシー** | 概要書PDF、3資料のExcel、CSV/JSON書出し、保持期間の自動削除ジョブ | ファイル成果物＋自動削除 |
| **M5 デプロイ** | GitHub Pages 公開、動作確認 | URLでどこからでもアクセス |
| **M6 (Phase2)** | スキャン取込・自動消込・操作ログ | 明細写真→記帳 |

---

## 10. 受け入れ基準（Acceptance Criteria）

- [ ] スタッフが各自のメール＋パスワードでログインできる
- [ ] ログインしないとデータにアクセスできない（RLS有効）
- [ ] 別端末からログインしても同じデータが見える
- [ ] 入力UIで記帳するとSupabaseに保存され、台帳に即時反映される
- [ ] 物件タブ切替で各ビューが当該物件のみになる（全体は合算）
- [ ] レントロールで稼働率・満室/現況・表面利回りが自動計算される
- [ ] 収支表が「行=項目 / 列=1–12月+合計」で表示され収支が一致する
- [ ] 入金状況が号室別に入金済/未入金/保証会社請求中/保証会社入金済/空室を判別
- [ ] 物件概要書をA4 PDFで出力できる
- [ ] 3資料を .xlsx で出力できる、CSV/JSONを書き出せる
- [ ] 管理者は入居者・保証人の個人情報を閲覧でき、一般スタッフには見えない（マスキング／DBレベルで取得不可）
- [ ] 機微項目（氏名・連絡先・保証人情報・転居先 等）が暗号化保存されている
- [ ] 退去処理ができ、過去の入居者が入居履歴（leases）に残る
- [ ] 個人情報＝退去後2年・会計＝7年の保持期間が設定値で管理され、期限到来分の個人情報が自動削除される
- [ ] GitHub Pages のURLからアクセスできる
- [ ] 金額は日本円表記（カンマ区切り）で統一

---

## 11. 非機能要件
- コスト：Supabase Free / GitHub Pages の無料枠内。
- パフォーマンス：数千件で快適。
- 可用性：ネット接続が前提（オフライン不可）。
- 言語：日本語UI、円表記、西暦。
- セキュリティ：RLSで保護。秘密鍵は非配布。

---

## 12. 前提・制約・リスク
- 動作にネット接続が必須。
- Supabase無料枠には上限あり（容量・帯域等）。長期間アクセスが無いとプロジェクトが一時停止する場合があるため、定期利用かバックアップ運用を推奨。
- anon keyはクライアントに公開される（仕様）。守りはRLSが担う。設定漏れに注意。
- 利回り・NOI・税務の数値は参考値。申告はユーザー責任。

---

## 付録A：Claude Code 事前準備
- Node.js 18+（推奨20/22 LTS）、Git
- Claude Code（公式インストーラ推奨）
  - macOS/Linux/WSL： `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows(PowerShell)： `irm https://claude.ai/install.ps1 | iex`
  - npm版： `npm install -g @anthropic-ai/claude-code`（Node 18+）
  - 認証：有料Claudeプラン または APIキー
- GitHub アカウント（リポジトリ＋Pages用）
- 控えてあるもの：Supabase Project URL ／ 公開可能なキー（anon）

## 付録B：将来のスケール
- 権限管理が必要になれば profiles テーブル＋RLSポリシーで役割を分離。
- 移管が必要になれば pg_dump / CSV で別プロジェクトへ移行（repository層は不変）。

## 付録C：Supabase スキーマ（SQL Editor に貼って実行）

```sql
-- 拡張
create extension if not exists "pgcrypto";

-- 物件
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text, access text, type text, structure text, built text,
  land_area numeric, building_area numeric, zoning text,
  bcr numeric, far numeric, road text, parking text,
  acquired_date date, acquired_price numeric, sale_price numeric, loan_balance numeric,
  notes text, created_at timestamptz default now()
);

-- 部屋
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  room text, layout text, area numeric,
  rent numeric default 0, kyoeki numeric default 0,
  deposit numeric default 0, key_money numeric default 0,
  status text default '空室', tenant text, guarantor text, payment_method text,
  contract_start date, contract_end date, notes text, created_at timestamptz default now()
);

-- 入出金
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  property_id uuid references properties(id) on delete cascade,
  unit_id uuid references units(id) on delete set null,
  type text not null check (type in ('income','expense')),
  category text not null,
  amount numeric not null default 0,
  method text, status text, memo text, created_at timestamptz default now()
);

-- 設定
create table if not exists settings (
  key text primary key,
  value jsonb
);

-- ユーザーの役割（admin / staff）
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz default now()
);

-- 入居履歴（個人情報の保管先。🔒列は暗号化して格納する）
create table if not exists leases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete cascade,
  status text default '入居',
  tenant_name text, tenant_phone text, tenant_email text,
  emergency_contact text, tenant_employer text,
  guarantor_name text, guarantor_relation text, guarantor_address text, guarantor_phone text,
  guarantor_company text, guarantor_contract_no text, guarantor_period text,
  rent numeric default 0, kyoeki numeric default 0, deposit numeric default 0, key_money numeric default 0,
  move_in date, move_out date, move_out_reason text,
  forwarding_address text, deposit_settlement numeric, restoration_cost numeric,
  created_at timestamptz default now(),
  pii_purge_at date
);

-- 役割判定ヘルパー
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- インデックス
create index if not exists idx_units_property on units(property_id);
create index if not exists idx_tx_property on transactions(property_id);
create index if not exists idx_tx_date on transactions(date);
create index if not exists idx_leases_unit on leases(unit_id);

-- RLS 有効化
alter table properties   enable row level security;
alter table units        enable row level security;
alter table transactions enable row level security;
alter table settings     enable row level security;
alter table profiles     enable row level security;
alter table leases       enable row level security;

-- ポリシー：物件・部屋・入出金・設定はログイン済みなら可（個人情報は含まない）
create policy "auth all properties"   on properties   for all to authenticated using (true) with check (true);
create policy "auth all units"         on units         for all to authenticated using (true) with check (true);
create policy "auth all transactions"  on transactions  for all to authenticated using (true) with check (true);
create policy "auth all settings"      on settings      for all to authenticated using (true) with check (true);

-- profiles：本人は自分の行を参照、adminは全件
create policy "profiles self read"  on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy "profiles admin write" on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- leases（個人情報）：管理者(admin)のみ全操作可。一般スタッフはアクセス不可
create policy "leases admin only" on leases for all to authenticated using (is_admin()) with check (is_admin());
-- ※ 一般スタッフが「現在入居中か」「契約満了」など非個人情報だけを見たい場合は、
--    号室・status・契約満了のみを返すビュー（個人情報を除外）を別途作成して参照させる。
```

### 補足：暗号化と自動削除の実装メモ
- **暗号化**：leases の🔒列は、アプリ側で暗号化してから保存（鍵は環境変数／Vaultで管理、復号はadmin操作時のみ）。または pgcrypto の `pgp_sym_encrypt/decrypt` を用い、鍵は Supabase Vault に保管する。
- **保持期間の自動削除**：退去時に `pii_purge_at = move_out + (pii_retention_years)` をセット。Supabase の **pg_cron** で日次ジョブを動かし、`pii_purge_at <= 今日` の行の🔒列を NULL 化（匿名化）する。金額・取引（transactions）は会計保持年数まで残す。
- 保持年数は settings に保持：`{"key":"pii_retention_years","value":2}` / `{"key":"accounting_retention_years","value":7}`。

（以上）

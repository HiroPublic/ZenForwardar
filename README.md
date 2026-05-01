# ZenForwarder

ZenForwarder は、日本語のホテル予約メールを Gmail から検出し、TripIt と HotelSlash が読み取りやすい英語メール本文へ変換して、ユーザー承認後に転送するローカル Web アプリです。

予約メタデータと処理履歴は Notion データベースにも記録します。

## 主な機能

- Gmail からホテル予約関連メールを検索
- OpenAI で予約メタデータを抽出
- TripIt / HotelSlash 向けの英語転送本文を生成
- 転送前に本文を確認・編集・承認
- Gmail API 経由で承認済みメールを転送
- Notion データベースに予約履歴を保存
- Gmail ラベルで処理済みメールを管理
- サイドバーの `終了` ボタンからローカルアプリを終了

## 技術スタック

- フロントエンド: React 19, Vite, Framer Motion, Lucide React, Tailwind CSS
- バックエンド: Node.js, Express, TypeScript
- 連携先: Gmail API, OpenAI API, Notion API
- テスト: Vitest

## 必要なもの

- Node.js
- npm
- Gmail 連携用の Google OAuth クライアント情報
- OpenAI API キー
- Notion インテグレーショントークン
- Notion の予約管理データベース ID

## セットアップ

依存パッケージをインストールします。

```bash
npm install
```

プロジェクト直下に `.env` を作成します。

```bash
APP_URL=http://localhost:3000
SESSION_SECRET=change-me

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
GMAIL_AUTH_ACCOUNT=
FORWARD_FROM_EMAIL=

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

NOTION_API_KEY=
NOTION_HOTEL_RESERVATION_DATABASE_ID=

TRIPIT_FORWARD_EMAIL=plans@tripit.com
HOTELSLASH_FORWARD_EMAIL=save@hotelslash.com

EXCHANGE_RATE_API_KEY=
EXCHANGE_RATE_PROVIDER=mock
```

`FORWARD_FROM_EMAIL` は、Gmail の送信元エイリアスとして認証済みのメールアドレスを指定してください。

## 開発環境での起動

API サーバーと Vite クライアントを同時に起動します。

```bash
npm run dev
```

アプリ画面:

```text
http://localhost:5173/
```

バックエンド API:

```text
http://localhost:3000/
```

ブラウザから終了する場合は、サイドバーの `終了` ボタンを押します。`POST /api/shutdown` が呼ばれ、バックエンド終了後に Vite クライアントも停止します。

## npm スクリプト

```bash
npm run dev        # バックエンドとフロントエンドを watch モードで起動
npm run build      # 型チェック後にフロントエンドをビルド
npm run start      # バックエンドサーバーを起動
npm run test       # テストを実行
npm run typecheck  # TypeScript の型チェックを実行
```

## 基本ワークフロー

1. Google OAuth で Gmail 連携を行う
2. `Gmail同期` を押す
3. 抽出された予約メタデータと生成された英語本文を確認する
4. 必要に応じて本文を編集する
5. `承認して転送` を押す
6. TripIt と HotelSlash へメールが転送され、Notion に履歴が作成される
7. 元メールに処理済み Gmail ラベルが付与される

## ドキュメント

詳細仕様は [doc/AppSpec.md](doc/AppSpec.md) を参照してください。

## セキュリティ上の注意

- `.env` は Git 管理に含めないでください。
- API キー、OAuth シークレット、セッションシークレット、Notion データベース ID はコミットしないでください。
- 転送前に Gmail の送信元エイリアス設定を確認します。
- 生成される転送メールでは、可能な範囲で個人情報を削除またはマスクします。

# License

This project is licensed under the MIT License - see the LICENSE file for details.

## Author

Copyright (c) 2026 HiroPublic

This project was developed with assistance from generative AI.

# ZenForwarder 予約翻訳転送アプリ - 最終仕様書

## 1. アプリケーション概要
ZenForwarderは、日本語のホテル予約メールをGmailから検出し、TripItおよびHotelSlashが読み取りやすい英語メール本文へ変換して、ユーザー承認後に両サービスへ転送するメールユーティリティです。

対象はホテル予約に限定し、予約確認、変更通知、キャンセル通知、HotelSlashからの低価格通知を扱います。処理履歴と予約メタデータはNotionデータベースで管理します。

## 2. 名前の由来
- **Zen:** シンプルさ、心の平穏、煩雑さの排除を表します。日本語予約メールを海外旅行管理サービスへ渡す作業を、落ち着いて扱えるものにします。
- **Forward:** 予約メールの転送と、ユーザーの旅程管理を前へ進める意味を持ちます。

## 3. 対象メール
対象メールはホテル予約関連メールのみです。

- 予約確認
- 変更通知
- キャンセル通知
- HotelSlash低価格通知

初回同期は過去1週間分のGmailを対象にします。以降はGmailラベルで処理済み判定を行い、未処理メールのみ処理します。

同じ予約の再送、変更、キャンセルが届いた場合でも、既存のNotionレコードは更新せず、新規レコードとして追加します。ただしHotelSlash低価格通知は、既存予約に紐づけます。

## 4. 主な機能
- **Gmail連携:** Google OAuth2を使用し、ホテル予約関連メールを検索、取得、送信します。
- **Gmailラベル管理:** 処理状態をGmailラベルで管理します。
- **AI内部JSON抽出:** Notion登録、低価格通知紐づけ、監査ログ用に、予約情報を内部JSONとして抽出します。
- **AI英語メール生成:** ユーザーに表示し、TripItおよびHotelSlashへ転送する英語メール本文を生成します。
- **機密情報削除:** ユーザー個人情報を削除し、ホテル情報と予約管理に必要な情報は残します。
- **承認ワークフロー:** 送信前にユーザーが生成メール本文を確認、編集、承認できます。
- **転送:** 承認後、TripItとHotelSlashの両方へ常に転送します。
- **Notion履歴管理:** 予約確認、変更通知、キャンセル通知、HotelSlash低価格通知をNotion DBで管理します。
- **監査ログ:** 各処理ステップ、AI出力、送信結果、エラーを記録します。

## 5. 非対応範囲
- ホテル以外の予約メール処理
- 自動承認モード
- 却下、スキップ、あとで確認などの承認待ち派生状態
- ユーザー編集後メール本文のNotion保存
- 同一予約に対する既存Notionレコード更新

## 6. 技術アーキテクチャ
- **フロントエンド:** React 19, Tailwind CSS 4, Framer Motion, Lucide React
- **バックエンド:** Node.js Express
- **AIエンジン:** OpenAI API
- **メール連携:** Gmail API
- **認証:** Google OAuth2
- **セッション管理:** 暗号化Cookieセッション
- **履歴DB:** Notion Database
- **為替換算:** 外部為替レートAPI

## 7. Gmail送信元
Gmail OAuthで認証するアカウントは`user@example.com`です。TripItおよびHotelSlashへ転送する際の送信元メールアドレスは、Gmailに送信元エイリアスとして追加済みの`sender@example.com`を使用します。

送信前にGmail APIの`users.settings.sendAs.list`で、`FORWARD_FROM_EMAIL`が認証済み送信元として登録されていることを確認します。登録されていない場合は送信せず、ユーザーに設定エラーとして表示します。

送信メールの`From`ヘッダーには`FORWARD_FROM_EMAIL`を指定します。OAuth認証アカウントと送信元エイリアスは別の設定値として扱います。

## 8. Gmailラベル
以下のラベルを使用します。

- `ZenForwarder/Pending`: 承認待ち
- `ZenForwarder/Processed`: 処理済み
- `ZenForwarder/Error`: エラー

処理対象判定では、`ZenForwarder/Processed` が付与されていないメールのみを対象にします。

## 9. AI処理方針
ユーザーに表示する内容と実際に転送する内容は、TripItおよびHotelSlash向けに整形された英語メール本文のみです。

ただしバックエンド内部では、Notion登録、HotelSlash低価格通知の紐づけ、監査ログのために、AIで予約情報をJSON抽出します。内部JSONはユーザー承認画面には表示しません。

ユーザーが承認画面でメール本文を編集した場合、編集後本文をTripItおよびHotelSlashへ転送します。ただし編集後本文はNotionには保存しません。NotionにはAI生成時点のメール本文と内部JSON由来の予約メタデータを保存します。

## 10. 機密情報削除ルール
### 残す情報
- ホテル名
- ホテル住所
- ホテル電話番号
- 宿泊日
- 予約番号
- 料金
- 現地通貨
- 現在の為替レートで換算した日本円
- キャンセルポリシー

### 削除またはマスクする情報
- 宿泊者名
- 個人住所
- 個人電話番号
- クレジットカード情報
- 会員番号
- 認証コード
- その他ユーザー個人を特定しうる情報

## 11. TripIt / HotelSlash向けメールテンプレート
以下のようなラベル付き英語本文を生成します。

```text
Subject: Hotel Reservation - {Hotel Name} - {Check-in Date} to {Check-out Date}

Hotel Reservation

Hotel Name:
{Hotel Name}

Hotel Address:
{Hotel Address}

Hotel Phone:
{Hotel Phone}

Reservation Number:
{Reservation Number}

Status:
{Confirmed / Modified / Cancelled}

Check-in:
{Date}, {Time if available}

Check-out:
{Date}, {Time if available}

Number of Nights:
{Nights}

Room:
{Room Type}

Guests:
[Redacted]

Total Price:
{Original Currency Amount}

Approx. JPY:
{JPY Amount} based on exchange rate {Exchange Rate} as of {Rate Date}

Cancellation Policy:
{Cancellation Policy}

Notes:
{Important hotel or booking notes}

Original Email Type:
{Reservation Confirmation / Change Notice / Cancellation Notice}
```

## 12. データフロー
1. Gmailから過去1週間分のホテル予約関連メールを検索します。
2. `ZenForwarder/Processed` ラベルがないメールを処理対象にします。
3. メール種別を判定します。
4. AIで予約情報を内部JSONとして抽出します。
5. 料金の現地通貨と日本円換算額を算出します。
6. HotelSlash低価格通知の場合、既存予約との紐づけ候補を検索します。
7. AIでTripIt / HotelSlash向け英語メール本文を生成します。
8. ユーザー個人情報を削除またはマスクします。
9. ユーザーが承認画面で本文を確認し、必要に応じて編集します。
10. 承認後、TripItとHotelSlashの両方へGmailから転送します。
11. Notionに新規レコードを追加します。
12. Gmailに`ZenForwarder/Processed`ラベルを付与します。
13. 監査ログを保存します。

## 13. Notion DB項目
| 項目名 | 型 | 説明 |
| --- | --- | --- |
| Name | Title | 表示名。例: `{Hotel Name} - {Check-in Date}` |
| Hotel Name | Text | ホテル名 |
| Reservation Number | Text | 予約番号 |
| Status | Select | `Confirmed`, `Modified`, `Cancelled`, `Price Alert` |
| Email Type | Select | `Reservation Confirmation`, `Change Notice`, `Cancellation Notice`, `HotelSlash Price Alert` |
| Check-in | Date | チェックイン日 |
| Check-out | Date | チェックアウト日 |
| Nights | Number | 泊数 |
| Original Currency | Text | 元通貨 |
| Original Amount | Number | 元通貨の金額 |
| JPY Amount | Number | 現在レート換算の日本円 |
| Exchange Rate | Number | 使用した為替レート |
| Exchange Rate Date | Date | 為替取得日 |
| Hotel Address | Text | ホテル住所 |
| Hotel Phone | Text | ホテル電話番号 |
| Original Gmail Message ID | Text | Gmail message id |
| Original Gmail URL | URL | 元メールURL |
| Forwarded To TripIt At | Date | TripIt転送日時 |
| Forwarded To HotelSlash At | Date | HotelSlash転送日時 |
| Gmail Processed Label | Text | 処理済みラベル名 |
| AI Generated Body | Text | AI生成時点の英語メール本文 |
| Internal JSON | Text | 内部抽出JSON |
| Audit Log | Text | 処理ログまたはログ参照 |
| Related Reservation | Relation | HotelSlash低価格通知の紐づけ先予約 |
| Created At | Date | 作成日時 |
| Updated At | Date | 更新日時 |

HotelSlash低価格通知の紐づけは、予約番号が取得できる場合は予約番号を優先します。予約番号がない場合は、ホテル名、チェックイン日、チェックアウト日で候補検索します。

## 14. 監査ログ
以下を監査ログとして保存します。

- 元Gmail Message ID
- 元Gmail URL
- メール種別判定結果
- 内部JSON抽出結果
- AI生成メール本文
- 個人情報削除結果
- ユーザー承認日時
- 転送先
- TripIt送信結果
- HotelSlash送信結果
- Notion登録結果
- Gmailラベル付与結果
- エラー内容

## 15. 必要な環境変数
設定値は`.env`に格納します。`.env`はGit管理対象外にします。

```text
APP_URL=
SESSION_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GMAIL_AUTH_ACCOUNT=
FORWARD_FROM_EMAIL=

OPENAI_API_KEY=
OPENAI_MODEL=

NOTION_API_KEY=
NOTION_HOTEL_RESERVATION_DATABASE_ID=

TRIPIT_FORWARD_EMAIL=
HOTELSLASH_FORWARD_EMAIL=

EXCHANGE_RATE_API_KEY=
EXCHANGE_RATE_PROVIDER=
```

## 16. セキュリティ要件
- APIキー、OAuthクライアントシークレット、セッションシークレットは`.env`で管理し、Gitに格納しません。
- Gmail OAuthスコープは、読み取りと送信に必要な最小限にします。
- AIへ送信する本文には、必要最小限のメール本文のみを含めます。
- 転送前にユーザー個人情報を削除またはマスクします。
- エラー時にも個人情報やAPIキーをログに出力しません。

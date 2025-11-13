# GitClauder

GitHub Actions上で動作する **Claude Code CLI** 実行システム。Googleスプレッドシートから指示を入力し、パソコンを閉じていてもClaude Codeが自動でタスクを処理します。

## 特徴

- ✅ **パソコンを閉じても実行継続**（GitHub Actions上で動作）
- ✅ **スマホ対応**：Googleスプレッドシートアプリからアクセス
- ✅ **Claude Code CLI のフル機能**：ファイル編集、git操作、ターミナルコマンド実行など
- ✅ **複数タスクの順次処理**：何個でもタスクを予約可能
- ✅ **実行結果の自動記録**：スプレッドシートに出力を保存
- ✅ **会話の継続**：セッションIDで前回の会話を継続可能
- ✅ **自動Git管理**：ファイル変更を自動でコミット＆プッシュ
- ✅ **5分ごとに自動チェック**（カスタマイズ可能）

## 仕組み

```mermaid
graph LR
    A[Googleスプレッドシート] -->|新しい指示| B[GitHub Actions]
    B -->|5分ごとに確認| C[Claude Code CLI]
    C -->|ファイル編集・git操作| D[リポジトリ]
    C -->|実行結果| A
    D -->|自動コミット| E[GitHub]
```

## セットアップ手順

### 前提条件

- GitHubアカウント（imuzen127）
- Googleアカウント
- **Claude Code CLI** がローカルにインストール済み（`claude login` 完了）

### 1. Claude Code CLI の認証情報を取得

ローカルで Claude Code CLI にログインしている場合、認証情報は `~/.claude/.credentials.json` に保存されています。

**Windowsの場合:**
```bash
cat C:\Users\<ユーザー名>\.claude\.credentials.json
```

**Mac/Linuxの場合:**
```bash
cat ~/.claude/.credentials.json
```

このJSONファイルの内容全体をコピーしてください。

### 2. Googleスプレッドシートの準備

1. 新しいGoogleスプレッドシートを作成
2. URLから `SPREADSHEET_ID` を取得
   ```
   https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit
   ```

### 3. Google Cloud Platformの設定

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 新しいプロジェクトを作成（例: `gitclauder-project`）
3. **Google Sheets API** を有効化
4. サービスアカウントを作成:
   - 「IAM と管理」→「サービスアカウント」→「サービスアカウントを作成」
   - 適当な名前を付けて作成（例: `gitclauder-bot`）
5. サービスアカウントのキーを作成:
   - 作成したサービスアカウントをクリック
   - 「キー」タブ→「鍵を追加」→「新しい鍵を作成」
   - **JSON形式**で保存
6. サービスアカウントのメールアドレスをコピー
   - 例: `gitclauder-bot@project-id.iam.gserviceaccount.com`
7. Googleスプレッドシートを開き、サービスアカウントのメールアドレスに**編集権限**を付与

### 4. GitHubリポジトリのセットアップ

1. GitHubで新しいリポジトリを作成
   - リポジトリ名: `GitClauder`
   - Public または Private

2. このコードをプッシュ:

```bash
cd GitClauder
git remote add origin https://github.com/imuzen127/GitClauder.git
git add .
git commit -m "Initial commit: GitClauder setup"
git branch -M main
git push -u origin main
```

### 5. GitHub Secretsの設定

GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」で以下のSecretsを追加:

#### `CLAUDE_CREDENTIALS`
- 値: 手順1で取得した `.credentials.json` の内容（全体を1行にする）
- 例:
```json
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-...","refreshToken":"sk-ant-ort01-...","expiresAt":1763048502442,"scopes":["user:inference","user:profile"],"subscriptionType":"max"}}
```

#### `SPREADSHEET_ID`
- 値: 手順2で取得したスプレッドシートID

#### `GOOGLE_SHEETS_CREDENTIALS`
- 値: 手順3で作成したJSONファイルの内容（全体を1行にまとめる）
- 例:
```json
{"type":"service_account","project_id":"your-project","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"gitclauder-bot@your-project.iam.gserviceaccount.com",...}
```

### 6. スプレッドシートの初期化

ローカルで実行:

```bash
cd scripts
npm install

# .envファイルを作成
cp ../.env.example .env

# .envファイルを編集して以下を設定:
# SPREADSHEET_ID=あなたのスプレッドシートID
# GOOGLE_SHEETS_CREDENTIALS='{"type":"service_account",...}'

# スプレッドシートにヘッダーとサンプルタスクを追加
node setup-sheet.js
```

成功すると、スプレッドシートに以下のヘッダーが追加されます：

| ID | 指示内容 | ステータス | 実行結果 | セッションID | 作成日時 | 完了日時 |
|----|---------|----------|---------|------------|---------|---------|

## 使い方

### タスクの追加

Googleスプレッドシートで新しい行を追加:

| ID | 指示内容 | ステータス | 実行結果 | セッションID | 作成日時 | 完了日時 |
|----|---------|----------|---------|------------|---------|---------|
| 1 | このリポジトリにPythonでフィボナッチ数列を生成するfibonacci.pyを作成してください | 待機中 | | | 2025-01-13T10:00:00Z | |

**重要ポイント:**
- **ID**: 任意の番号（重複しないように）
- **指示内容**: Claude Codeに実行させたい内容
- **ステータス**: `待機中` と入力
- **セッションID**: 空欄（会話を継続する場合は前回のセッションIDをコピー）
- 他の列は空欄でOK

### タスクの実行

1. **自動実行**: GitHub Actionsが5分ごとに自動チェック
2. **手動実行**:
   - GitHubリポジトリの「Actions」タブを開く
   - 「Claude Code Task Runner」をクリック
   - 「Run workflow」ボタンをクリック

### 実行結果の確認

スプレッドシートの「実行結果」列に、Claude Codeの回答が自動で記録されます。

ファイルの変更は自動的にGitリポジトリにコミット＆プッシュされます。

## スプレッドシートの列説明

- **ID**: タスクの識別番号
- **指示内容**: Claude Codeに送る指示文
- **ステータス**:
  - `待機中`: まだ実行されていない
  - `処理中`: 現在実行中
  - `完了`: 正常に完了
  - `エラー`: 実行中にエラーが発生
- **実行結果**: Claude Codeからの返答
- **セッションID**: 会話を継続するためのID（自動生成）
- **作成日時**: タスクが作成された日時
- **完了日時**: タスクが完了した日時

## 会話の継続

Claude Codeは会話の文脈を保持できます。前回の会話を続けるには：

1. 前回のタスクの「セッションID」列の値をコピー
2. 新しいタスクの「セッションID」列にペースト
3. 指示内容に「先ほどのコードを修正して...」のように書く

例：

| ID | 指示内容 | ステータス | セッションID |
|----|---------|----------|------------|
| 1 | fibonacci.pyを作成して | 完了 | abc-123-def |
| 2 | 先ほどのコードにキャッシュ機能を追加して | 待機中 | abc-123-def |

## 実行例

### 例1: ファイル作成

**指示:**
```
このリポジトリにPythonでフィボナッチ数列を計算するfibonacci.pyを作成してください。
関数fib(n)を実装し、テストコードも含めてください。
```

**結果:**
- `fibonacci.py` が作成される
- ファイルがGitにコミットされる
- 実行結果に作成内容が記録される

### 例2: ファイル編集

**指示:**
```
README.mdに使用例セクションを追加してください。
```

**結果:**
- `README.md` が更新される
- 変更がGitにコミットされる

### 例3: Git操作

**指示:**
```
新しいブランチ feature/new-feature を作成して、そのブランチに切り替えてください。
```

**結果:**
- 新しいブランチが作成される
- ブランチが切り替わる

## カスタマイズ

### 実行頻度の変更

`.github/workflows/claude-runner.yml` の `cron` 設定を変更:

```yaml
schedule:
  - cron: '*/5 * * * *'  # 5分ごと（デフォルト）
  # - cron: '*/10 * * * *'  # 10分ごと
  # - cron: '0 * * * *'     # 1時間ごと
```

### Claude モデルの変更

`scripts/process-tasks.js` の `executeWithClaudeCLI` 関数にモデル指定を追加:

```javascript
let command = 'claude --print --model sonnet';  // または 'opus', 'haiku'
```

## トラブルシューティング

### GitHub Actionsが実行されない

1. リポジトリの「Actions」タブでワークフローが有効になっているか確認
2. GitHub Secretsが正しく設定されているか確認
3. ワークフローのログでエラーメッセージを確認

### スプレッドシートに書き込めない

1. サービスアカウントにスプレッドシートの編集権限があるか確認
2. `GOOGLE_SHEETS_CREDENTIALS` が正しいJSON形式か確認
3. `SPREADSHEET_ID` が正しいか確認

### Claude Code CLIがエラーを返す

1. `CLAUDE_CREDENTIALS` が正しいか確認
2. トークンの有効期限が切れていないか確認（`expiresAt` を確認）
3. トークンが切れている場合は、ローカルで `claude login` を再実行して新しい認証情報を取得

### 認証情報の更新

Claude Codeの認証トークンには有効期限があります。期限切れの場合：

1. ローカルで `claude login` を再実行
2. 新しい `.credentials.json` を取得
3. GitHub Secretsの `CLAUDE_CREDENTIALS` を更新

## ローカルでテスト

```bash
cd scripts
npm install

# .envファイルを作成して環境変数を設定
cp ../.env.example .env
# .envを編集

# タスク処理を実行
node process-tasks.js
```

## 注意事項

- Claude Code CLIは **Claude Pro サブスクリプション** が必要です
- GitHub Actionsの無料枠は月2,000分（Publicリポジトリは無制限）
- スプレッドシートのセルは50,000文字まで（超過分は切り詰められます）
- 長時間実行されるタスクは10分でタイムアウトします

## セキュリティ

- **認証情報を公開しない**: `.credentials.json` は絶対にGitにコミットしない
- **プライベートリポジトリ推奨**: 作業内容に機密情報が含まれる場合
- **GitHub Secretsを使用**: 認証情報は必ずSecretsに保存

## ライセンス

MIT License

## 作者

imuzen127

## 貢献

Issue や Pull Request を歓迎します！

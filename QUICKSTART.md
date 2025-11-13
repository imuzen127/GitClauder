# GitClauder クイックスタートガイド

このガイドに従えば、15分でGitClauderを動かせます！

## 📋 事前準備チェックリスト

- [ ] GitHubアカウント（imuzen127）
- [ ] Googleアカウント
- [ ] **Claude Code CLI** がローカルにインストール済み
- [ ] `claude login` でログイン完了

## 🚀 セットアップ（5ステップ）

### ステップ1: Claude Code認証情報を取得（1分）

**Windowsの場合:**
```bash
cat C:\Users\imuze\.claude\.credentials.json
```

**Mac/Linuxの場合:**
```bash
cat ~/.claude/.credentials.json
```

このJSON全体をコピーして保存しておきます。

### ステップ2: Googleスプレッドシート作成（1分）

1. [Google Sheets](https://sheets.google.com) で新しいシートを作成
2. URLをコピー:
   ```
   https://docs.google.com/spreadsheets/d/1a2b3c4d5e6f7g8h9i/edit
                                      ↑この部分がSPREADSHEET_ID
   ```

### ステップ3: Google Cloud設定（5分）

1. [Google Cloud Console](https://console.cloud.google.com/) を開く
2. プロジェクトを作成（例: `gitclauder-project`）
3. 検索バーで「Google Sheets API」を検索 → 有効化
4. 左メニューから「IAMと管理」→「サービスアカウント」
5. 「サービスアカウントを作成」:
   - 名前: `gitclauder-bot`
   - ロール: 不要（スキップ）
6. 作成したサービスアカウントをクリック
7. 「キー」タブ → 「鍵を追加」→「新しい鍵を作成」→「JSON」
8. ダウンロードされたJSONファイルを開いてコピー
9. サービスアカウントのメールアドレスをコピー
   - 例: `gitclauder-bot@gitclauder-project.iam.gserviceaccount.com`
10. ステップ2で作成したスプレッドシートに戻る
11. 右上の「共有」をクリック
12. サービスアカウントのメールアドレスを貼り付けて「編集者」権限を付与

### ステップ4: GitHubにプッシュ（3分）

```bash
# GitClauderディレクトリに移動
cd GitClauder

# GitHubで https://github.com/new から新しいリポジトリ「GitClauder」を作成してから:
git remote add origin https://github.com/imuzen127/GitClauder.git
git add .
git commit -m "Initial commit: GitClauder with Claude Code CLI"
git branch -M main
git push -u origin main
```

### ステップ5: GitHub Secretsを設定（5分）

1. GitHubのリポジトリページを開く: `https://github.com/imuzen127/GitClauder`
2. 「Settings」→「Secrets and variables」→「Actions」
3. 「New repository secret」をクリックして、以下の3つを追加:

#### Secret 1: `CLAUDE_CREDENTIALS`
```
ステップ1で取得した .credentials.json の内容（全体）
```
例:
```json
{"claudeAiOauth":{"accessToken":"sk-ant-oat01-...","refreshToken":"sk-ant-ort01-...","expiresAt":1763048502442,"scopes":["user:inference","user:profile"],"subscriptionType":"max"}}
```

#### Secret 2: `SPREADSHEET_ID`
```
ステップ2で取得したスプレッドシートID
```

#### Secret 3: `GOOGLE_SHEETS_CREDENTIALS`
```
ステップ3でダウンロードしたJSONファイルの内容（全体を1行にする）
```

## ✅ 動作確認

### スプレッドシートを初期化

```bash
cd scripts
npm install
cp ../.env.example .env

# .envファイルを編集して以下を設定:
# SPREADSHEET_ID=あなたのスプレッドシートID
# GOOGLE_SHEETS_CREDENTIALS='{"type":"service_account",...}'

node setup-sheet.js
```

成功すると、スプレッドシートにヘッダーとサンプルタスクが追加されます！

### 手動でタスクを実行してテスト

GitHub Actionsで手動実行:
1. GitHubリポジトリの「Actions」タブを開く
2. 「Claude Code Task Runner」をクリック
3. 「Run workflow」→「Run workflow」

数分後、スプレッドシートの「実行結果」列に結果が表示されます。

## 🎉 完了！

これで準備完了です。以下のように使えます:

### スマホから使う場合

1. Googleスプレッドシートアプリを開く
2. 新しい行を追加:
   - ID: `3`
   - 指示内容: `このリポジトリにHello Worldを出力するhello.pyを作成してください`
   - ステータス: `待機中`
3. 5分以内にClaude Codeが自動で処理して結果を記入

### パソコンから使う場合

1. ブラウザでスプレッドシートを開く
2. 新しいタスクを追加
3. GitHub Actionsが自動で実行（または手動実行）

## 💡 使用例

### ファイル作成
```
このリポジトリにPythonでフィボナッチ数列を計算するfibonacci.pyを作成してください
```

### ファイル編集
```
README.mdに新しいセクション「使用例」を追加してください
```

### Git操作
```
新しいブランチ feature/add-tests を作成して、そのブランチに切り替えてください
```

### 会話の継続
1行目:
```
ID: 1
指示: このリポジトリにcalculator.pyを作成してください
```

処理完了後、セッションIDをコピーして2行目:
```
ID: 2
指示: 先ほどのcalculator.pyに割り算機能を追加してください
セッションID: (1行目のセッションIDをコピー)
```

## ⚠️ トラブルシューティング

### タスクが実行されない
→ GitHub Actionsのログを確認: `リポジトリ → Actions → 最新のワークフロー`

### スプレッドシートに書き込めない
→ サービスアカウントに編集権限があるか確認

### Claude Code CLIがエラーを返す
→ `CLAUDE_CREDENTIALS` のトークンが有効か確認（`expiresAt` の日時）

### 認証トークンの有効期限切れ
1. ローカルで `claude login` を再実行
2. 新しい `.credentials.json` を取得
3. GitHub Secretsの `CLAUDE_CREDENTIALS` を更新

## 📚 詳細情報

詳しい使い方は [README.md](README.md) を参照してください。

---

**楽しんでください！** 🚀

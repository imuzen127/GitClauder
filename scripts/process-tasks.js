#!/usr/bin/env node

const { google } = require('googleapis');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const execAsync = promisify(exec);

// 環境変数から設定を読み込む
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SHEETS_CREDENTIALS = process.env.GOOGLE_SHEETS_CREDENTIALS;

// スプレッドシートの列定義
const COLUMNS = {
  ID: 0,
  INSTRUCTION: 1,
  STATUS: 2,
  RESULT: 3,
  SESSION_ID: 4,
  CREATED_AT: 5,
  COMPLETED_AT: 6
};

const STATUS = {
  PENDING: '待機中',
  PROCESSING: '処理中',
  COMPLETED: '完了',
  ERROR: 'エラー'
};

/**
 * 日本時間（JST, UTC+9）のISO形式文字列を取得
 */
function getJSTTimestamp() {
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // 9時間のミリ秒
  const jstTime = new Date(now.getTime() + jstOffset);

  // ISO形式で出力し、末尾の'Z'を'+09:00'に置き換える
  return jstTime.toISOString().replace('Z', '+09:00');
}

/**
 * Google Sheets APIクライアントを初期化
 */
async function initGoogleSheets() {
  try {
    const credentials = JSON.parse(GOOGLE_SHEETS_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    return sheets;
  } catch (error) {
    console.error('Google Sheets初期化エラー:', error.message);
    throw error;
  }
}

/**
 * Sheet2から制御パラメータを取得
 */
async function getControlParams(sheets) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet2!A2:C2'
    });

    const row = response.data.values?.[0] || [];
    return {
      operation: row[0] || '稼働',  // 動作: 稼働 or 停止
      updateInterval: parseInt(row[1]) || 300,  // 更新時間（秒）
      timeout: parseInt(row[2]) || 300  // タイムアウト制限（秒）
    };
  } catch (error) {
    console.log('Sheet2が見つかりません。デフォルト値を使用します。');
    return {
      operation: '稼働',
      updateInterval: 300,
      timeout: 300
    };
  }
}

/**
 * スプレッドシートから全タスクを取得
 */
async function getTasks(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Sheet1!A2:G'  // ヘッダー行をスキップ
  });

  const rows = response.data.values || [];
  return rows.map((row, index) => ({
    rowIndex: index + 2,  // スプレッドシートの実際の行番号
    id: row[COLUMNS.ID] || '',
    instruction: row[COLUMNS.INSTRUCTION] || '',
    status: row[COLUMNS.STATUS] || STATUS.PENDING,
    result: row[COLUMNS.RESULT] || '',
    sessionId: row[COLUMNS.SESSION_ID] || '',
    createdAt: row[COLUMNS.CREATED_AT] || '',
    completedAt: row[COLUMNS.COMPLETED_AT] || ''
  }));
}

/**
 * タスクのステータスと結果を更新
 */
async function updateTaskStatus(sheets, rowIndex, status, result = '', sessionId = '', completedAt = '') {
  // C列(status), D列(result), E列(sessionId), G列(completedAt)を更新
  // F列(createdAt)は上書きしない
  const updates = [
    {
      range: `Sheet1!C${rowIndex}:E${rowIndex}`,
      values: [[status, result, sessionId]]
    }
  ];

  // 完了日時がある場合のみG列を更新
  if (completedAt) {
    updates.push({
      range: `Sheet1!G${rowIndex}`,
      values: [[completedAt]]
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      valueInputOption: 'RAW',
      data: updates
    }
  });
}

// メモリ状態管理
const PRIORITY_THRESHOLD = 30 * 1024; // 30KB
const CONTEXT_SHORTAGE_KEYWORDS = [
  'わかりません', '情報が足りません', '前に言った', '前に', '以前',
  '知りません', 'context', 'previous', 'earlier', '見つかりません'
];

/**
 * メモリ状態を読み込む
 */
function loadMemoryState(workDir) {
  const statePath = path.join(workDir, 'reports', 'memory-state.json');
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }
  return { nextPriorityLevel: 1 };
}

/**
 * メモリ状態を保存
 */
function saveMemoryState(workDir, state) {
  const reportsDir = path.join(workDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const statePath = path.join(reportsDir, 'memory-state.json');
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 階層化会話レポートを読み込む
 */
function loadConversationReport(workDir, priorityLevel = 1) {
  const reportsDir = path.join(workDir, 'reports');
  let content = '';

  // 重要度1は必ず読む
  const priority1Path = path.join(reportsDir, 'priority-1.md');
  if (fs.existsSync(priority1Path)) {
    content += fs.readFileSync(priority1Path, 'utf8');
  }

  // 重要度2以上が指定されていれば読む
  if (priorityLevel >= 2) {
    const priority2Path = path.join(reportsDir, 'priority-2.md');
    if (fs.existsSync(priority2Path)) {
      content += '\n\n' + fs.readFileSync(priority2Path, 'utf8');
    }
  }

  // 重要度3が指定されていれば読む
  if (priorityLevel >= 3) {
    const priority3Path = path.join(reportsDir, 'priority-3.md');
    if (fs.existsSync(priority3Path)) {
      content += '\n\n' + fs.readFileSync(priority3Path, 'utf8');
    }
  }

  return content;
}

/**
 * 会話レポートを保存（重要度1に追記）
 */
function saveConversationReport(workDir, sessionId, taskId, instruction, result) {
  const reportsDir = path.join(workDir, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const priority1Path = path.join(reportsDir, 'priority-1.md');
  const timestamp = getJSTTimestamp();
  const report = `## [タスク ${taskId}] ${timestamp} (SessionID: ${sessionId})\n\n### 指示\n${instruction}\n\n### 結果\n${result}\n\n---\n\n`;

  fs.appendFileSync(priority1Path, report, 'utf8');
}

/**
 * 自動アーカイブ: 重要度1が大きすぎる場合、古い部分を重要度2に移動
 */
function archiveOldMemories(workDir) {
  const reportsDir = path.join(workDir, 'reports');
  const priority1Path = path.join(reportsDir, 'priority-1.md');

  if (!fs.existsSync(priority1Path)) {
    return;
  }

  const priority1Content = fs.readFileSync(priority1Path, 'utf8');
  const priority1Size = Buffer.byteLength(priority1Content, 'utf8');

  if (priority1Size > PRIORITY_THRESHOLD) {
    console.log(`[アーカイブ] 重要度1が${priority1Size}バイトを超えました。古い記憶を重要度2に移動します...`);

    // タスクごとに分割
    const tasks = priority1Content.split('---\n\n').filter(t => t.trim());

    // 半分を重要度2に移動
    const halfPoint = Math.floor(tasks.length / 2);
    const oldTasks = tasks.slice(0, halfPoint).join('---\n\n') + '---\n\n';
    const recentTasks = tasks.slice(halfPoint).join('---\n\n') + (tasks.length > halfPoint ? '---\n\n' : '');

    // 重要度2に追記（先頭に追加）
    const priority2Path = path.join(reportsDir, 'priority-2.md');
    const priority2Content = fs.existsSync(priority2Path) ? fs.readFileSync(priority2Path, 'utf8') : '';
    fs.writeFileSync(priority2Path, oldTasks + priority2Content, 'utf8');

    // 重要度1を更新
    fs.writeFileSync(priority1Path, recentTasks, 'utf8');

    console.log(`[アーカイブ] ${halfPoint}個のタスクを重要度2に移動しました。`);

    // 重要度2も大きすぎる場合は重要度3へ
    const priority2Size = Buffer.byteLength(fs.readFileSync(priority2Path, 'utf8'), 'utf8');
    if (priority2Size > PRIORITY_THRESHOLD) {
      console.log(`[アーカイブ] 重要度2も大きいため、さらに古い記憶を重要度3に移動します...`);
      const priority2Tasks = fs.readFileSync(priority2Path, 'utf8').split('---\n\n').filter(t => t.trim());
      const p2HalfPoint = Math.floor(priority2Tasks.length / 2);
      const p2OldTasks = priority2Tasks.slice(0, p2HalfPoint).join('---\n\n') + '---\n\n';
      const p2RecentTasks = priority2Tasks.slice(p2HalfPoint).join('---\n\n') + (priority2Tasks.length > p2HalfPoint ? '---\n\n' : '');

      const priority3Path = path.join(reportsDir, 'priority-3.md');
      const priority3Content = fs.existsSync(priority3Path) ? fs.readFileSync(priority3Path, 'utf8') : '';
      fs.writeFileSync(priority3Path, p2OldTasks + priority3Content, 'utf8');
      fs.writeFileSync(priority2Path, p2RecentTasks, 'utf8');
    }
  }
}

/**
 * 結果を分析して次回の読み込みレベルを決定
 */
function analyzeResultForNextPriority(result, success) {
  // エラーの場合
  if (!success) {
    return 2;
  }

  // 情報不足のキーワードチェック
  const lowerResult = result.toLowerCase();
  for (const keyword of CONTEXT_SHORTAGE_KEYWORDS) {
    if (lowerResult.includes(keyword.toLowerCase())) {
      return 2;
    }
  }

  // 問題なければ重要度1のみ
  return 1;
}

/**
 * Claude Code CLIでタスクを実行
 * 注: レポートの読み込みは呼び出し側で行う
 */
async function executeWithClaudeCLI(instruction, sessionId = null, workDir = null, timeoutSeconds = 600) {
  try {
    // 作業ディレクトリ（リポジトリのルート）
    if (!workDir) {
      workDir = path.join(__dirname, '..');
    }

    // Claude Codeコマンドの引数を配列として構築
    const args = ['--print', '--dangerously-skip-permissions'];

    // セッションIDがある場合は継続
    if (sessionId) {
      args.push('--session-id', sessionId);
    }

    // 指示を追加（引数として直接渡すのでエスケープ不要）
    args.push(instruction);

    // 出力形式はテキスト
    args.push('--output-format', 'text');

    console.log(`実行コマンド: claude ${args.map(a => a.length > 50 ? a.substring(0, 50) + '...' : a).join(' ')}`);
    console.log(`作業ディレクトリ: ${workDir}`);

    // Claude Code CLIを実行（stdinを閉じる）
    const result = await new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        cwd: workDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],  // stdin を無視
        shell: true  // クロスプラットフォーム対応
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data;
      });

      child.stderr.on('data', (data) => {
        stderrData += data;
      });

      const timeoutMs = timeoutSeconds * 1000;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Timeout after ${timeoutSeconds} seconds`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout: stdoutData, stderr: stderrData });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderrData}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const { stdout, stderr } = result;

    // セッションIDを抽出（新規セッションの場合）
    let newSessionId = sessionId;
    if (!sessionId && stdout) {
      // セッションIDはUUID形式で出力される可能性がある
      const sessionMatch = stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (sessionMatch) {
        newSessionId = sessionMatch[0];
      }
    }

    return {
      success: true,
      result: stdout || '(出力なし)',
      sessionId: newSessionId,
      stderr: stderr || ''
    };
  } catch (error) {
    console.error('Claude Code CLI エラー:', error);

    return {
      success: false,
      result: `エラー: ${error.message}\n\nStderr: ${error.stderr || ''}`,
      sessionId: sessionId,
      stderr: error.stderr || ''
    };
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('GitClauder - Claude Code タスクプロセッサーを開始します...');
  console.log(`作業ディレクトリ: ${path.join(__dirname, '..')}`);

  try {
    // Google Sheets APIを初期化
    const sheets = await initGoogleSheets();

    // 制御パラメータを取得
    console.log('制御パラメータを取得中...');
    const controlParams = await getControlParams(sheets);
    console.log(`動作: ${controlParams.operation}`);
    console.log(`更新時間: ${controlParams.updateInterval}秒`);
    console.log(`タイムアウト制限: ${controlParams.timeout}秒`);

    // 停止状態の場合は処理を終了
    if (controlParams.operation === '停止') {
      console.log('Sheet2の動作が「停止」に設定されています。処理を終了します。');
      return;
    }

    console.log('スプレッドシートからタスクを取得中...');
    const tasks = await getTasks(sheets);

    // 待機中のタスクのみをフィルタリング
    const pendingTasks = tasks.filter(task =>
      task.status === STATUS.PENDING && task.instruction.trim() !== ''
    );

    console.log(`待機中のタスク: ${pendingTasks.length}件`);

    // 各タスクを順番に処理
    for (const task of pendingTasks) {
      console.log(`\n========================================`);
      console.log(`[タスク ${task.id}] 処理開始`);
      console.log(`指示: ${task.instruction.substring(0, 100)}${task.instruction.length > 100 ? '...' : ''}`);
      console.log(`========================================\n`);

      // セッションIDを生成または取得
      let sessionId = task.sessionId && task.sessionId.trim() !== ''
        ? task.sessionId
        : crypto.randomUUID();

      const workDir = path.join(__dirname, '..');

      // STEP 1: メモリ状態を読み込んで、次回の読み込みレベルを決定
      const memoryState = loadMemoryState(workDir);
      const priorityLevel = memoryState.nextPriorityLevel || 1;

      console.log(`[タスク ${task.id}] 階層化メモリを読み込み中（重要度レベル: ${priorityLevel}）...`);
      const conversationHistory = loadConversationReport(workDir, priorityLevel);

      if (conversationHistory) {
        console.log(`[タスク ${task.id}] 既存の会話履歴を発見（${conversationHistory.length}文字、重要度${priorityLevel}まで読み込み）`);
      } else {
        console.log(`[タスク ${task.id}] 初回タスク`);
      }

      // ステータスを「処理中」に更新（セッションIDも設定）
      await updateTaskStatus(sheets, task.rowIndex, STATUS.PROCESSING, '', sessionId);

      // STEP 2: 指示を構築（階層化メモリの履歴を含める）
      let fullInstruction = task.instruction;
      if (conversationHistory) {
        fullInstruction = `これまでの全タスク履歴（重要度${priorityLevel}まで）:\n\n${conversationHistory}\n\n---\n\n新しい指示: ${task.instruction}`;
      }

      // STEP 3: Claude Code CLIで実行（SessionIDは局所的な会話継続用）
      console.log(`[タスク ${task.id}] Claude Code CLI実行中（SessionID: ${sessionId}、タイムアウト: ${controlParams.timeout}秒）...`);
      const result = await executeWithClaudeCLI(fullInstruction, sessionId, workDir, controlParams.timeout);

      // 結果を書き込み
      const now = getJSTTimestamp();
      const status = result.success ? STATUS.COMPLETED : STATUS.ERROR;

      // STEP 4: 会話レポートに追記（重要度1）
      console.log(`[タスク ${task.id}] 会話レポートを更新中...`);
      saveConversationReport(workDir, sessionId, task.id, task.instruction, result.result);
      console.log(`[タスク ${task.id}] レポート更新完了`);

      // STEP 5: 自動アーカイブ処理
      archiveOldMemories(workDir);

      // STEP 6: 結果を分析して次回の読み込みレベルを決定
      const nextPriorityLevel = analyzeResultForNextPriority(result.result, result.success);
      saveMemoryState(workDir, { nextPriorityLevel });

      if (nextPriorityLevel > 1) {
        console.log(`[タスク ${task.id}] 情報不足を検出。次回は重要度${nextPriorityLevel}まで読み込みます。`);
      } else {
        console.log(`[タスク ${task.id}] 次回は重要度1のみ読み込みます。`);
      }

      // スプレッドシートのセル制限（50,000文字）を考慮
      let truncatedResult = result.result.substring(0, 50000);
      if (result.result.length > 50000) {
        truncatedResult += '\n\n... (結果が長すぎるため切り詰められました)';
      }

      await updateTaskStatus(
        sheets,
        task.rowIndex,
        status,
        truncatedResult,
        result.sessionId || '',
        now
      );

      console.log(`\n[タスク ${task.id}] ${status}`);

      if (result.stderr) {
        console.log(`Stderr: ${result.stderr}`);
      }
    }

    console.log('\n========================================');
    console.log('全てのタスク処理が完了しました。');
    console.log('========================================');
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  }
}

// スクリプトを実行
if (require.main === module) {
  main();
}

module.exports = { main };

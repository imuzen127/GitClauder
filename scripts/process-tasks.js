#!/usr/bin/env node

const { google } = require('googleapis');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');

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
  const range = `Sheet1!C${rowIndex}:G${rowIndex}`;
  const values = [[status, result, sessionId, '', completedAt]];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: 'RAW',
    resource: { values }
  });
}

/**
 * Claude Code CLIでタスクを実行
 */
async function executeWithClaudeCLI(instruction, sessionId = null) {
  try {
    // 作業ディレクトリ（リポジトリのルート）
    const workDir = path.join(__dirname, '..');

    // Claude Codeコマンドを構築
    let command = 'claude --print --dangerously-skip-permissions';

    // セッションIDがある場合は継続
    if (sessionId) {
      command += ` --session-id "${sessionId}"`;
    }

    // 指示を追加（エスケープ処理）
    const escapedInstruction = instruction.replace(/"/g, '\\"');
    command += ` "${escapedInstruction}"`;

    // 出力形式はテキスト
    command += ' --output-format text';

    console.log(`実行コマンド: ${command}`);
    console.log(`作業ディレクトリ: ${workDir}`);

    // Claude Code CLIを実行（stdinを閉じる）
    const result = await new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        cwd: workDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']  // stdin を無視
      });

      let stdoutData = '';
      let stderrData = '';

      child.stdout.on('data', (data) => {
        stdoutData += data;
      });

      child.stderr.on('data', (data) => {
        stderrData += data;
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Timeout after 10 minutes'));
      }, 600000);

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

      // ステータスを「処理中」に更新
      await updateTaskStatus(sheets, task.rowIndex, STATUS.PROCESSING);

      // Claude Code CLIで実行
      const result = await executeWithClaudeCLI(task.instruction, task.sessionId);

      // 結果を書き込み
      const now = new Date().toISOString();
      const status = result.success ? STATUS.COMPLETED : STATUS.ERROR;

      // スプレッドシートのセル制限（50,000文字）を考慮
      const truncatedResult = result.result.substring(0, 50000);
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

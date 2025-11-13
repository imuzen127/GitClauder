#!/usr/bin/env node

const { google } = require('googleapis');
require('dotenv').config();

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
 * スプレッドシートにヘッダーを設定するスクリプト
 */
async function setupSheet() {
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
  const GOOGLE_SHEETS_CREDENTIALS = process.env.GOOGLE_SHEETS_CREDENTIALS;

  if (!SPREADSHEET_ID || !GOOGLE_SHEETS_CREDENTIALS) {
    console.error('環境変数が設定されていません');
    console.error('SPREADSHEET_ID と GOOGLE_SHEETS_CREDENTIALS が必要です');
    process.exit(1);
  }

  try {
    const credentials = JSON.parse(GOOGLE_SHEETS_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ヘッダー行を設定
    const headers = [
      ['ID', '指示内容', 'ステータス', '実行結果', 'セッションID', '作成日時', '完了日時']
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A1:G1',
      valueInputOption: 'RAW',
      resource: { values: headers }
    });

    // サンプルタスクを追加
    const now = getJSTTimestamp();
    const sampleTasks = [
      ['1', 'こんにちは、自己紹介してください。あなたは何ができますか？', '待機中', '', '', now, ''],
      ['2', 'このリポジトリ（GitClauder）にREADME.mdファイルがあるか確認して、内容を要約してください', '待機中', '', '', now, '']
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet1!A2:G3',
      valueInputOption: 'RAW',
      resource: { values: sampleTasks }
    });

    // ヘッダー行を太字にするフォーマット
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                  textFormat: { bold: true }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: 1,
                endIndex: 2
              },
              properties: { pixelSize: 300 },
              fields: 'pixelSize'
            }
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: 3,
                endIndex: 4
              },
              properties: { pixelSize: 400 },
              fields: 'pixelSize'
            }
          }
        ]
      }
    });

    // Sheet2の制御パラメータを設定
    const controlHeaders = [
      ['動作', '更新時間', 'タイムアウト制限']
    ];

    const controlData = [
      ['稼働', 300, 300]
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet2!A1:C1',
      valueInputOption: 'RAW',
      resource: { values: controlHeaders }
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Sheet2!A2:C2',
      valueInputOption: 'RAW',
      resource: { values: controlData }
    });

    // Sheet2のヘッダー行を太字にする
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 1,  // Sheet2のID
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                  textFormat: { bold: true }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          }
        ]
      }
    });

    console.log('スプレッドシートのセットアップが完了しました！');
    console.log('Sheet1: タスク管理');
    console.log('Sheet2: 制御パラメータ（動作: 稼働/停止、更新時間: 秒、タイムアウト制限: 秒）');
    console.log(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
  } catch (error) {
    console.error('エラー:', error.message);
    process.exit(1);
  }
}

setupSheet();

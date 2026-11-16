/* =====================================================================
   Hot & Cold Assessment Mastery — Backend API
   Google Apps Script Web App
   =====================================================================

   Author:  JEMUEL C. MARI, MAN, RN, LPT
   Version: 3.2.0

   SETUP (done in the Google Sheet):
   - Paste this whole file into Extensions → Apps Script (replace the old code).
   - Run testSetup() once. Missing tabs/headers are created automatically.
   - Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
       Execute as: Me
       Who has access: Anyone
     (Editing the existing deployment keeps the same /exec URL, so the
      app files do not need to change.)

   WHAT CHANGED IN 3.2.0
   - Accepts POST (form-encoded) so large payloads (exam answers) no longer
     break the URL-length limit of GET requests. GET still works.
   - Values are written as plain text, so "50%" is no longer turned into 0.5
     by Google Sheets. Old rows are read using their displayed values.
   - The submission code no longer changes on every sync.
   - LockService prevents duplicate rows when two syncs arrive together.
   - New actions: redeemRetake (student uses a retake code), and
     listByStudent now matches school year / semester when given.
   ===================================================================== */

var SHEET_SUBMISSIONS = 'Submissions';
var SHEET_FEEDBACK    = 'Feedback';
var SHEET_RETAKES     = 'Retakes';

var APP_VERSION = '3.2.0';

var SUBMISSION_COLUMNS = [
  'timestamp', 'code', 'fullName', 'studentNo', 'section', 'group',
  'email', 'schoolYear', 'semester', 'unitsCompleted', 'unitAvg',
  'examScore', 'examTotal', 'examPercentage', 'examPassed',
  'integrityFlags', 'appVersion', 'dataJson'
];

var FEEDBACK_COLUMNS = ['timestamp', 'studentName', 'studentNo', 'email', 'message'];
var RETAKE_COLUMNS   = ['timestamp', 'studentNo', 'email', 'retakeCode', 'used', 'usedAt'];

/* =====================================================================
   ENTRY POINTS
   ===================================================================== */

function doGet(e)  { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  try {
    var params = collectParams(e);
    var action = params.action || 'ping';

    var result;
    switch (action) {
      case 'ping':          result = { success: true, message: 'Hot & Cold backend alive', version: APP_VERSION }; break;
      case 'getVersion':    result = { success: true, version: APP_VERSION }; break;
      case 'submit':        result = withLock(function () { return handleSubmit(params); }); break;
      case 'listAll':       result = handleListAll(); break;
      case 'listByCode':    result = handleListByCode(params); break;
      case 'listByStudent': result = handleListByStudent(params); break;
      case 'issueRetake':   result = withLock(function () { return handleIssueRetake(params); }); break;
      case 'redeemRetake':  result = withLock(function () { return handleRedeemRetake(params); }); break;
      case 'listRetakes':   result = handleListRetakes(); break;
      case 'sendFeedback':  result = withLock(function () { return handleSendFeedback(params); }); break;
      case 'listFeedback':  result = handleListFeedback(); break;
      case 'stats':         result = handleStats(); break;
      default:              result = { success: false, error: 'Unknown action: ' + action };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ success: false, error: String(err && err.message || err) });
  }
}

/* Merge URL params, form-encoded POST body, and JSON POST body. */
function collectParams(e) {
  var params = {};
  var p = (e && e.parameter) || {};
  for (var k in p) params[k] = p[k];
  if (e && e.postData && e.postData.contents && e.postData.type === 'application/json') {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var j in body) params[j] = body[j];
    } catch (ignore) {}
  }
  return params;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { success: false, error: 'Server busy, please retry.' };
  try { return fn(); }
  finally { lock.releaseLock(); }
}

/* =====================================================================
   ACTIONS
   ===================================================================== */

function handleSubmit(params) {
  var sheet = getSheet(SHEET_SUBMISSIONS, SUBMISSION_COLUMNS);

  if (!params.studentNo && !params.email) {
    return { success: false, error: 'Missing studentNo or email' };
  }

  var existingRow = findSubmissionRow(sheet, params.studentNo, params.email, params.schoolYear, params.semester);
  var codeIdx = SUBMISSION_COLUMNS.indexOf('code');
  var existingCode = existingRow > 0
    ? String(sheet.getRange(existingRow, codeIdx + 1).getDisplayValue() || '').trim()
    : '';

  var record = {
    timestamp:       new Date().toISOString(),
    code:            existingCode || params.code || generateCode(),
    fullName:        params.fullName || '',
    studentNo:       params.studentNo || '',
    section:         params.section || '',
    group:           params.group || '',
    email:           params.email || '',
    schoolYear:      params.schoolYear || '',
    semester:        params.semester || '',
    unitsCompleted:  params.unitsCompleted || '0%',
    unitAvg:         params.unitAvg || '0%',
    examScore:       params.examScore === undefined ? '' : params.examScore,
    examTotal:       params.examTotal === undefined ? '' : params.examTotal,
    examPercentage:  params.examPercentage === undefined ? '' : params.examPercentage,
    examPassed:      params.examPassed || '',
    integrityFlags:  params.integrityFlags || 0,
    appVersion:      params.appVersion || APP_VERSION,
    dataJson:        params.dataJson || '{}'
  };

  var rowValues = SUBMISSION_COLUMNS.map(function (col) { return String(record[col]); });
  var targetRow = existingRow > 0 ? existingRow : sheet.getLastRow() + 1;
  var range = sheet.getRange(targetRow, 1, 1, rowValues.length);
  range.setNumberFormat('@');           // plain text: stops "50%" → 0.5
  range.setValues([rowValues]);

  return existingRow > 0
    ? { success: true, updated: true, row: existingRow, code: record.code }
    : { success: true, created: true, row: targetRow, code: record.code };
}

function handleListAll() {
  var records = readRecords(getSheet(SHEET_SUBMISSIONS, SUBMISSION_COLUMNS), SUBMISSION_COLUMNS)
    .filter(function (r) { return r.code || r.studentNo || r.email; });
  return { success: true, records: records, count: records.length };
}

function handleListByCode(params) {
  var code = String(params.code || '').trim();
  if (!code) return { success: false, error: 'Missing code' };
  var records = readRecords(getSheet(SHEET_SUBMISSIONS, SUBMISSION_COLUMNS), SUBMISSION_COLUMNS);
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].code).trim() === code) return { success: true, record: records[i] };
  }
  return { success: false, error: 'Code not found: ' + code };
}

function handleListByStudent(params) {
  var studentNo = String(params.studentNo || '').trim();
  var email = String(params.email || '').trim().toLowerCase();
  if (!studentNo && !email) return { success: false, error: 'Missing studentNo or email' };

  var records = readRecords(getSheet(SHEET_SUBMISSIONS, SUBMISSION_COLUMNS), SUBMISSION_COLUMNS);
  var match = null;
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var hit = (studentNo && String(r.studentNo).trim() === studentNo) ||
              (email && String(r.email).trim().toLowerCase() === email);
    if (!hit) continue;
    if (params.schoolYear && String(r.schoolYear) !== String(params.schoolYear)) continue;
    if (params.semester && String(r.semester) !== String(params.semester)) continue;
    match = r; // keep the last (most recent) row
  }
  return match ? { success: true, record: match } : { success: false, error: 'Student not found' };
}

function handleIssueRetake(params) {
  var studentNo = String(params.studentNo || '').trim();
  if (!studentNo) return { success: false, error: 'Missing studentNo' };

  var code = generateRetakeCode();
  var sheet = getSheet(SHEET_RETAKES, RETAKE_COLUMNS);
  var row = sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, RETAKE_COLUMNS.length);
  range.setNumberFormat('@');
  range.setValues([[new Date().toISOString(), studentNo, params.email || '', code, 'FALSE', '']]);

  return { success: true, retakeCode: code, studentNo: studentNo };
}

function handleRedeemRetake(params) {
  var studentNo = String(params.studentNo || '').trim();
  var code = String(params.retakeCode || '').trim().toUpperCase();
  if (!studentNo || !code) return { success: false, error: 'Missing student number or retake code' };

  var sheet = getSheet(SHEET_RETAKES, RETAKE_COLUMNS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'Invalid retake code' };

  var values = sheet.getRange(2, 1, lastRow - 1, RETAKE_COLUMNS.length).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][3]).trim().toUpperCase() !== code) continue;
    if (String(values[i][1]).trim() !== studentNo) {
      return { success: false, error: 'This retake code was issued to a different student' };
    }
    if (String(values[i][4]).toUpperCase() === 'TRUE') {
      return { success: false, error: 'This retake code was already used' };
    }
    var r = sheet.getRange(i + 2, 5, 1, 2);
    r.setNumberFormat('@');
    r.setValues([['TRUE', new Date().toISOString()]]);
    return { success: true, retakeCode: code };
  }
  return { success: false, error: 'Invalid retake code' };
}

function handleListRetakes() {
  var records = readRecords(getSheet(SHEET_RETAKES, RETAKE_COLUMNS), RETAKE_COLUMNS);
  return { success: true, records: records, count: records.length };
}

function handleSendFeedback(params) {
  var sheet = getSheet(SHEET_FEEDBACK, FEEDBACK_COLUMNS);
  var row = sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, FEEDBACK_COLUMNS.length);
  range.setNumberFormat('@');
  range.setValues([[
    new Date().toISOString(),
    params.studentName || '',
    params.studentNo || '',
    params.email || '',
    params.message || ''
  ]]);
  return { success: true, message: 'Feedback saved' };
}

function handleListFeedback() {
  var records = readRecords(getSheet(SHEET_FEEDBACK, FEEDBACK_COLUMNS), FEEDBACK_COLUMNS);
  return { success: true, records: records, count: records.length };
}

function handleStats() {
  var records = readRecords(getSheet(SHEET_SUBMISSIONS, SUBMISSION_COLUMNS), SUBMISSION_COLUMNS)
    .filter(function (r) { return r.code || r.studentNo || r.email; });
  var passed = 0, examTaken = 0, flagged = 0;
  records.forEach(function (r) {
    var p = String(r.examPassed).toUpperCase();
    if (p === 'PASSED' || p === 'TRUE') passed++;
    if (String(r.examScore) !== '' || String(r.examPercentage) !== '') examTaken++;
    if (Number(r.integrityFlags) > 0) flagged++;
  });
  return {
    success: true,
    stats: {
      totalStudents: records.length,
      examTaken: examTaken,
      examPassed: passed,
      integrityFlagged: flagged,
      version: APP_VERSION
    }
  };
}

/* =====================================================================
   HELPERS
   ===================================================================== */

/* Get a sheet tab; create it with headers if missing. */
function getSheet(name, columns) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (columns && sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (columns && sheet.getLastColumn() < columns.length) {
    // add any missing header cells (e.g. usedAt on old Retakes tabs)
    var hdr = sheet.getRange(1, 1, 1, columns.length);
    var cur = hdr.getValues()[0];
    for (var i = 0; i < columns.length; i++) if (!cur[i]) cur[i] = columns[i];
    hdr.setValues([cur]);
  }
  return sheet;
}

/* Read rows as objects using DISPLAYED values, so rows written by older
   versions (where "50%" became 0.5) still come back as "50%". */
function readRecords(sheet, columns) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var range = sheet.getRange(2, 1, lastRow - 1, columns.length);
  var display = range.getDisplayValues();
  var raw = range.getValues();
  var tsIdx = columns.indexOf('timestamp');
  return display.map(function (row, r) {
    var obj = {};
    columns.forEach(function (col, i) {
      var v = row[i];
      if (i === tsIdx && raw[r][i] instanceof Date) v = raw[r][i].toISOString();
      obj[col] = v;
    });
    return obj;
  });
}

function findSubmissionRow(sheet, studentNo, email, schoolYear, semester) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var values = sheet.getRange(2, 1, lastRow - 1, SUBMISSION_COLUMNS.length).getDisplayValues();
  var noIdx    = SUBMISSION_COLUMNS.indexOf('studentNo');
  var emailIdx = SUBMISSION_COLUMNS.indexOf('email');
  var syIdx    = SUBMISSION_COLUMNS.indexOf('schoolYear');
  var semIdx   = SUBMISSION_COLUMNS.indexOf('semester');

  var wantNo    = String(studentNo || '').trim();
  var wantEmail = String(email || '').trim().toLowerCase();

  for (var i = 0; i < values.length; i++) {
    var rowNo    = String(values[i][noIdx] || '').trim();
    var rowEmail = String(values[i][emailIdx] || '').trim().toLowerCase();
    var rowSY    = String(values[i][syIdx] || '').trim();
    var rowSem   = String(values[i][semIdx] || '').trim();

    var matchNo    = wantNo && rowNo === wantNo;
    var matchEmail = wantEmail && rowEmail === wantEmail;
    var sameSY     = String(schoolYear || '').trim() === rowSY;
    var sameSem    = String(semester || '').trim() === rowSem;

    if ((matchNo || matchEmail) && sameSY && sameSem) return i + 2;
  }
  return 0;
}

function generateCode() {
  return 'HC-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function generateRetakeCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = 'RTK-';
  for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Run once manually after pasting: creates missing tabs/headers. */
function testSetup() {
  try {
    var sub = getSheet(SHEET_SUBMISSIONS, SUBMISSION_COLUMNS);
    getSheet(SHEET_FEEDBACK, FEEDBACK_COLUMNS);
    getSheet(SHEET_RETAKES, RETAKE_COLUMNS);
    Logger.log('✅ All three sheet tabs ready');
    Logger.log('Submissions rows: ' + Math.max(0, sub.getLastRow() - 1));
    Logger.log('Backend version: ' + APP_VERSION);
    return 'OK';
  } catch (e) {
    Logger.log('❌ Setup error: ' + e.message);
    return 'ERROR: ' + e.message;
  }
}

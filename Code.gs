/**
 * Code.gs — Backend Apps Script untuk aplikasi "Serah Terima Dinas"
 * =========================================================================
 * Cara pakai singkat:
 * 1. Buka https://script.google.com -> New Project, hapus isi default,
 *    tempel seluruh isi file ini.
 * 2. Ganti SPREADSHEET_ID di bawah dengan ID Google Sheet Anda.
 * 3. Deploy -> New deployment -> Type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 * 4. Salin URL Web App yang diberikan, tempel ke CONFIG.APPS_SCRIPT_URL
 *    pada file assets/js/config.js di frontend.
 *
 * Struktur Google Sheet yang dibutuhkan (dibuat otomatis oleh fungsi
 * setupSpreadsheet() di bawah bila belum ada):
 *
 *   Sheet "Pegawai"     : NIPP | Nama | Jabatan | Stasiun
 *   Sheet "SerahTerima" : Timestamp | NIPP | Nama | Jabatan | Dinas |
 *                         JenisSerahTerima | Stasiun | Tanggal |
 *                         TabelDigunakan | FileURL_FotoSerahTerima |
 *                         FileURL_FotoDokumentasi | FileURL_PDF
 * =========================================================================
 */

const SPREADSHEET_ID = "1hXqmE_NiVhm2P4dN7wRg0bMKRFj2wAhgwsYr9RVTirM";
const SHEET_PEGAWAI = "Pegawai";
const SHEET_SERAH_TERIMA = "SerahTerima";
const DRIVE_ROOT_FOLDER_DEFAULT = "IMO_2026";

/** Kolom sheet Pegawai (indeks 0-based). */
const PEGAWAI_COLS = { NIPP: 0, NAMA: 1, JABATAN: 2, STASIUN: 3 };

/** Kolom sheet SerahTerima (indeks 0-based). */
const SERAH_COLS = {
  TIMESTAMP: 0, NIPP: 1, NAMA: 2, JABATAN: 3, DINAS: 4,
  JENIS: 5, STASIUN: 6, TANGGAL: 7, TABEL: 8,
  FOTO_SERAH: 9, FOTO_DOK: 10, PDF: 11,
};

// -------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------

function doPost(e) {
  let response;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === "cekNipp") {
      response = { ok: true, data: cekNipp(body.nipp) };
    } else if (action === "simpanData") {
      response = { ok: true, data: simpanData(body.payload) };
    } else {
      response = { ok: false, message: "Action tidak dikenali: " + action };
    }
  } catch (err) {
    response = { ok: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// -------------------------------------------------------------------------
// Fitur 1: Cek NIPP
// -------------------------------------------------------------------------

function cekNipp(nipp) {
  const sheet = getOrCreateSheet_(SHEET_PEGAWAI, ["NIPP", "Nama", "Jabatan", "Stasiun"]);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[PEGAWAI_COLS.NIPP]).trim() === String(nipp).trim()) {
      return {
        found: true,
        data: {
          nama: row[PEGAWAI_COLS.NAMA],
          jabatan: row[PEGAWAI_COLS.JABATAN],
          stasiun: row[PEGAWAI_COLS.STASIUN],
        },
      };
    }
  }
  return { found: false };
}

// -------------------------------------------------------------------------
// Fitur 2: Simpan data (pegawai baru bila perlu + foto + PDF + log)
// -------------------------------------------------------------------------

function simpanData(payload) {
  // 1. Tambahkan pegawai baru ke sheet Pegawai jika NIPP belum terdaftar.
  if (!payload.employeeFound) {
    tambahPegawaiBaruJikaBelumAda_(payload);
  }

  // 2. Siapkan folder Drive: {root}/{Stasiun}/{Jabatan}/{NIPP}/
  const rootFolderName = payload.driveRootFolder || DRIVE_ROOT_FOLDER_DEFAULT;
  const targetFolder = getOrCreateFolderPath_([
    rootFolderName, payload.stasiun, payload.jabatan, payload.nipp,
  ]);

  // 3. Simpan 2 foto ke Drive.
  const fotoSerahTerimaFile = simpanBase64KeDrive_(
    targetFolder,
    `${payload.pdfFileName.replace(".pdf", "")} - ${payload.fotoSerahTerima.kolom}.jpg`,
    payload.fotoSerahTerima.base64,
    payload.fotoSerahTerima.mimeType
  );
  const fotoDokumentasiFile = simpanBase64KeDrive_(
    targetFolder,
    `${payload.pdfFileName.replace(".pdf", "")} - ${payload.fotoDokumentasi.kolom}.jpg`,
    payload.fotoDokumentasi.base64,
    payload.fotoDokumentasi.mimeType
  );

  // 4. Simpan PDF ke Drive.
  const pdfFile = simpanBase64KeDrive_(
    targetFolder,
    payload.pdfFileName,
    payload.pdfBase64,
    "application/pdf"
  );

  // 5. Catat baris baru ke sheet SerahTerima.
  const sheet = getOrCreateSheet_(SHEET_SERAH_TERIMA, [
    "Timestamp", "NIPP", "Nama", "Jabatan", "Dinas", "JenisSerahTerima",
    "Stasiun", "Tanggal", "TabelDigunakan",
    "FileURL_FotoSerahTerima", "FileURL_FotoDokumentasi", "FileURL_PDF",
  ]);

  sheet.appendRow([
    new Date(),
    payload.nipp,
    payload.nama,
    payload.jabatan,
    payload.dinas,
    payload.jenisSerahTerima,
    payload.stasiun,
    payload.tanggal,
    payload.tabel,
    fotoSerahTerimaFile.getUrl(),
    fotoDokumentasiFile.getUrl(),
    pdfFile.getUrl(),
  ]);

  return {
    pdfUrl: pdfFile.getUrl(),
    folderUrl: targetFolder.getUrl(),
  };
}

function tambahPegawaiBaruJikaBelumAda_(payload) {
  const sheet = getOrCreateSheet_(SHEET_PEGAWAI, ["NIPP", "Nama", "Jabatan", "Stasiun"]);
  const rows = sheet.getDataRange().getValues();

  const sudahAda = rows.some(
    (row, i) => i > 0 && String(row[PEGAWAI_COLS.NIPP]).trim() === String(payload.nipp).trim()
  );
  if (sudahAda) return; // Cegah duplikasi NIPP.

  sheet.appendRow([payload.nipp, payload.nama, payload.jabatan, payload.stasiun]);
}

// -------------------------------------------------------------------------
// Helper: Sheet
// -------------------------------------------------------------------------

function getOrCreateSheet_(name, headerRow) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headerRow);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// -------------------------------------------------------------------------
// Helper: Drive
// -------------------------------------------------------------------------

/** Cari/berjenjang folder sesuai array nama; buat jika belum ada. */
function getOrCreateFolderPath_(pathParts) {
  let current = DriveApp.getRootFolder();
  pathParts.forEach((name) => {
    current = getOrCreateSubfolder_(current, String(name));
  });
  return current;
}

function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function simpanBase64KeDrive_(folder, fileName, base64, mimeType) {
  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  return folder.createFile(blob);
}

// -------------------------------------------------------------------------
// Utilitas setup awal (jalankan manual sekali dari editor Apps Script
// jika ingin membuat kedua sheet + header sebelum dipakai).
// -------------------------------------------------------------------------

function setupSpreadsheet() {
  getOrCreateSheet_(SHEET_PEGAWAI, ["NIPP", "Nama", "Jabatan", "Stasiun"]);
  getOrCreateSheet_(SHEET_SERAH_TERIMA, [
    "Timestamp", "NIPP", "Nama", "Jabatan", "Dinas", "JenisSerahTerima",
    "Stasiun", "Tanggal", "TabelDigunakan",
    "FileURL_FotoSerahTerima", "FileURL_FotoDokumentasi", "FileURL_PDF",
  ]);
  Logger.log("Setup selesai.");
}

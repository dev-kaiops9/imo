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
 *                         TabelDigunakan | FileURL_PDF
 *
 * Catatan: foto "Serah Terima" & "Dokumentasi Kegiatan" TIDAK disimpan
 * sebagai file terpisah di Google Drive — foto-foto itu sudah tertempel
 * langsung di dalam PDF yang dibuat di sisi frontend, jadi yang disimpan
 * ke Drive hanya satu file: PDF-nya saja.
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
  JENIS: 5, STASIUN: 6, TANGGAL: 7, TABEL: 8, PDF: 9,
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
    } else if (action === "cekPdfTersimpan") {
      response = { ok: true, data: cekPdfTersimpan(body.nipp) };
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
// Fitur 1b: Cek PDF Tersimpan (daftar riwayat serah terima per NIPP)
// -------------------------------------------------------------------------

/** Urutan pengurutan dinas dalam satu tanggal yang sama: Pagi -> Siang -> Malam. */
const URUTAN_DINAS = { "Pagi": 0, "Siang": 1, "Malam": 2 };

function cekPdfTersimpan(nipp) {
  const sheet = getOrCreateSheet_(SHEET_SERAH_TERIMA, [
    "Timestamp", "NIPP", "Nama", "Jabatan", "Dinas", "JenisSerahTerima",
    "Stasiun", "Tanggal", "TabelDigunakan", "FileURL_PDF",
  ]);
  const rows = sheet.getDataRange().getValues();
  const nippTarget = String(nipp).trim();

  const hasil = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[SERAH_COLS.NIPP]).trim() !== nippTarget) continue;

    hasil.push({
      tanggal: formatTanggal_(row[SERAH_COLS.TANGGAL]),
      tanggalRaw: row[SERAH_COLS.TANGGAL],
      dinas: row[SERAH_COLS.DINAS],
      jenisSerahTerima: row[SERAH_COLS.JENIS],
      fileUrl: row[SERAH_COLS.PDF],
    });
  }

  // Urutkan: tanggal termuda (terbaru) dulu, lalu dalam tanggal yang sama
  // dimulai dari Dinas Pagi -> Siang -> Malam.
  hasil.sort((a, b) => {
    const ta = new Date(a.tanggalRaw).getTime();
    const tb = new Date(b.tanggalRaw).getTime();
    if (tb !== ta) return tb - ta; // descending (terbaru dulu)
    const ua = URUTAN_DINAS.hasOwnProperty(a.dinas) ? URUTAN_DINAS[a.dinas] : 99;
    const ub = URUTAN_DINAS.hasOwnProperty(b.dinas) ? URUTAN_DINAS[b.dinas] : 99;
    return ua - ub;
  });

  // Buang field internal sebelum dikirim ke frontend.
  const list = hasil.map((h) => ({
    tanggal: h.tanggal,
    dinas: h.dinas,
    jenisSerahTerima: h.jenisSerahTerima,
    fileUrl: h.fileUrl,
  }));

  return { found: list.length > 0, list: list };
}

/** Format Date/serial sheet -> string "dd-mm-yyyy" untuk ditampilkan. */
function formatTanggal_(value) {
  const d = (value instanceof Date) ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
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

  // 3. Simpan PDF ke Drive.
  // Foto "Serah Terima" & "Dokumentasi Kegiatan" TIDAK disimpan sebagai
  // file terpisah — sudah tertempel di dalam PDF ini.
  const pdfFile = simpanBase64KeDrive_(
    targetFolder,
    payload.pdfFileName,
    payload.pdfBase64,
    "application/pdf"
  );

  // 4. Catat baris baru ke sheet SerahTerima.
  const sheet = getOrCreateSheet_(SHEET_SERAH_TERIMA, [
    "Timestamp", "NIPP", "Nama", "Jabatan", "Dinas", "JenisSerahTerima",
    "Stasiun", "Tanggal", "TabelDigunakan", "FileURL_PDF",
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
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Data PDF (base64) kosong atau tidak valid — gagal membuat file.");
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    throw new Error("Gagal decode base64 PDF: " + err.message);
  }

  // Info ukuran file untuk debugging lewat Executions log di Apps Script,
  // kalau suatu saat masih ada kendala menyimpan file besar.
  Logger.log("simpanBase64KeDrive_: " + fileName + " — " + bytes.length + " bytes (~" +
    Math.round(bytes.length / 1024 / 1024 * 10) / 10 + " MB)");

  let blob;
  try {
    blob = Utilities.newBlob(bytes, mimeType, fileName);
  } catch (err) {
    throw new Error(
      "Gagal membuat file (" + Math.round(bytes.length / 1024 / 1024 * 10) / 10 +
      " MB) — kemungkinan file terlalu besar untuk diproses. Detail: " + err.message
    );
  }

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
    "Stasiun", "Tanggal", "TabelDigunakan", "FileURL_PDF",
  ]);
  Logger.log("Setup selesai.");
}

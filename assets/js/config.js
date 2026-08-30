/**
 * config.js
 * -----------------------------------------------------------------------
 * Semua nilai yang mungkin berubah (URL backend, folder Drive, aturan
 * tabel/kolom, dsb) dikumpulkan di sini agar aplikasi mudah disesuaikan
 * tanpa menyentuh logika di file JS lain.
 * -----------------------------------------------------------------------
 */

const CONFIG = {
  // URL Web App hasil deploy Google Apps Script (lihat apps-script/Code.gs).
  // Contoh: "https://script.google.com/macros/s/XXXXXXXX/exec"
  APPS_SCRIPT_URL: "GANTI_DENGAN_URL_APPS_SCRIPT_ANDA",

  // Nama folder utama di Google Drive tempat semua PDF/foto disimpan.
  // Struktur akhir: {DRIVE_ROOT_FOLDER}/{Stasiun}/{Jabatan}/{NIPP}/
  DRIVE_ROOT_FOLDER: "IMO_2026",

  // Daftar pilihan dropdown. Ubah di sini jika ada penambahan/pengurangan opsi.
  OPTIONS: {
    jabatan: ["PPKA", "PLR", "PRS", "PJL"],
    dinas: ["Pagi", "Siang", "Malam"],
    jenisSerahTerima: ["Awal Dinas", "Akhir Dinas", "Serah Terima Dinasan"],
  },

  // Aturan inti: jenis serah terima -> tabel yang dipakai & kolom foto.
  // Jangan ubah "key" (harus sama persis dengan isi dropdown jenisSerahTerima).
  MAPPING: {
    "Awal Dinas": {
      tabel: "tabel_dinas_tutup",
      kolomFotoSerahTerima: "Awal Dinas",
      kolomFotoDokumentasi: "Dokumentasi Kegiatan",
    },
    "Akhir Dinas": {
      tabel: "tabel_dinas_tutup",
      kolomFotoSerahTerima: "Akhir Dinas",
      kolomFotoDokumentasi: "Dokumentasi Kegiatan",
    },
    "Serah Terima Dinasan": {
      tabel: "tabel_dinas_buka",
      kolomFotoSerahTerima: "Serah Terima Dinasan",
      kolomFotoDokumentasi: "Dokumentasi Kegiatan",
    },
  },

  // Format nama file PDF: dd-mm-yy (Dinas).pdf
  buildPdfFileName(tanggalISO, dinas) {
    const d = new Date(tanggalISO + "T00:00:00");
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy} (${dinas}).pdf`;
  },
};

// Dibekukan supaya tidak sengaja termodifikasi saat runtime.
Object.freeze(CONFIG.OPTIONS);
Object.freeze(CONFIG.MAPPING);

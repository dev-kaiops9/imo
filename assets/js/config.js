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
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyPd0fyxJpy8vWpzj9GBg1-1nENo9Nqq-SfjH3rpm55c1Iy23HiduSNzwYJSt-ikwY4/exec",

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

  // Isi kolom "Kegiatan" otomatis mengikuti dropdown Dinas
  // (Pagi -> "Dinas Pagi", Siang -> "Dinas Siang", Malam -> "Dinas Malam").
  buildKegiatan(dinas) {
    return dinas ? `Dinas ${dinas}` : "";
  },

  // Struktur kolom tabel — dipakai bersama oleh preview.js (tampilan di
  // layar) dan pdf.js (hasil akhir), supaya keduanya SELALU identik.
  // "w" = proporsi lebar kolom (total per tabel harus berjumlah 1).
  getTableColumns(tabel) {
    if (tabel === "tabel_dinas_tutup") {
      return [
        { key: "hari", label: "Hari, Tanggal", w: 0.14 },
        { key: "kegiatan", label: "Kegiatan", w: 0.10 },
        { key: "awal", label: "Awal Dinas", w: 0.22 },
        { key: "akhir", label: "Akhir Dinas", w: 0.22 },
        { key: "dok", label: "Dokumentasi Kegiatan", w: 0.32 },
      ];
    }
    return [
      { key: "hari", label: "Hari, Tanggal", w: 0.16 },
      { key: "kegiatan", label: "Kegiatan", w: 0.12 },
      { key: "gabung", label: "Serah Terima Dinasan", w: 0.36 },
      { key: "dok", label: "Dokumentasi Kegiatan", w: 0.36 },
    ];
  },

  // Nama kolom foto (target) untuk setiap jenis serah terima —
  // dipakai untuk tahu foto "serah terima" harus masuk ke cell mana.
  getTargetPhotoKey(jenisSerahTerima) {
    const map = {
      "Awal Dinas": "awal",
      "Akhir Dinas": "akhir",
      "Serah Terima Dinasan": "gabung",
    };
    return map[jenisSerahTerima];
  },
};

// Dibekukan supaya tidak sengaja termodifikasi saat runtime.
Object.freeze(CONFIG.OPTIONS);
Object.freeze(CONFIG.MAPPING);

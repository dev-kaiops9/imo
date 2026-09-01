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
    // "LIBUR" & "Lainnya" ditambahkan SETELAH 3 pilihan dinas existing
    // (Pagi/Siang/Malam) — jangan hapus/ubah/reorder 3 pilihan pertama,
    // sejumlah logika (lihat DINAS_KHUSUS di bawah, form.js, preview.js,
    // pdf.js) mengasumsikan Pagi/Siang/Malam tetap berjalan seperti semula.
    dinas: ["Pagi", "Siang", "Malam", "LIBUR", "Lainnya"],
    jenisSerahTerima: ["Awal Dinas", "Akhir Dinas", "Serah Terima Dinasan"],
  },

  // Pilihan dinas dengan alur khusus (bukan Pagi/Siang/Malam biasa).
  // Dipakai oleh form.js untuk mengunci Jenis Serah Terima & menyembunyikan
  // upload foto yang tidak relevan, dan oleh preview.js/pdf.js untuk
  // menampilkan teks "LIBUR" bergaya bold-merah alih-alih foto.
  DINAS_KHUSUS: {
    LIBUR: "LIBUR",
    LAINNYA: "Lainnya",
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
  // Untuk LIBUR -> selalu "LIBUR". Untuk Lainnya -> pakai teks manual yang
  // diketik user (parameter kedua, isi input "Isi Dinas/Kegiatan").
  buildKegiatan(dinas, manualKegiatan) {
    if (dinas === this.DINAS_KHUSUS.LIBUR) return "LIBUR";
    if (dinas === this.DINAS_KHUSUS.LAINNYA) return manualKegiatan || "";
    return dinas ? `Dinas ${dinas}` : "";
  },

  // Struktur kolom tabel — dipakai bersama oleh preview.js (tampilan di
  // layar) dan pdf.js (hasil akhir), supaya keduanya SELALU identik.
  // "w" = proporsi lebar kolom (total per tabel harus berjumlah 1).
  //
  // "targetKey" (opsional) = key kolom yang menampung foto serah terima
  // untuk data ini ("awal"/"akhir"/"gabung"). Khusus tabel_dinas_tutup,
  // dipakai untuk menggeser alokasi lebar antar kolom "Awal Dinas" dan
  // "Akhir Dinas": kolom yang jadi tujuan foto diperlebar, kolom
  // pasangannya (yang kosong, tidak dipakai untuk jenis serah terima ini)
  // disempitkan — total lebar keduanya tetap sama seperti sebelumnya,
  // jadi kolom lain (Hari/Tanggal, Kegiatan, Dokumentasi Kegiatan) tidak
  // ikut terpengaruh. tabel_dinas_buka tidak punya sepasang kolom seperti
  // ini (cuma 1 kolom tujuan foto), jadi lebarnya tetap statis.
  getTableColumns(tabel, targetKey) {
    if (tabel === "tabel_dinas_tutup") {
      const WIDE = 0.34;
      const NARROW = 0.10;
      const awalW = targetKey === "akhir" ? NARROW : WIDE;
      const akhirW = targetKey === "akhir" ? WIDE : NARROW;
      return [
        { key: "hari", label: "Hari, Tanggal", w: 0.14 },
        { key: "kegiatan", label: "Kegiatan", w: 0.10 },
        { key: "awal", label: "Awal Dinas", w: awalW },
        { key: "akhir", label: "Akhir Dinas", w: akhirW },
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
Object.freeze(CONFIG.DINAS_KHUSUS);

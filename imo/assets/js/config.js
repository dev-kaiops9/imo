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
    // DIUBAH — sebelumnya 3 pilihan ("Awal Dinas", "Akhir Dinas", "Serah
    // Terima Dinasan"), sekarang diringkas jadi 2. "Stasiun Tutup"
    // menggantikan gabungan "Awal Dinas" + "Akhir Dinas" (Langkah 2 langsung
    // menampilkan kedua upload sekaligus — lihat form.js/upload.js/pdf.js/
    // preview.js). "Stasiun Buka" menggantikan nama "Serah Terima Dinasan"
    // (logika/tabel tidak berubah). Dropdown ini dipakai BERSAMA oleh kedua
    // mode (Kedudukan & Wakilan reuse elemen #jenisSerahTerima yang sama).
    jenisSerahTerima: ["Stasiun Buka", "Stasiun Tutup"],
    // BARU — khusus mode "Stasiun Tempat Wakilan" (lihat MODE_* di bawah).
    // Tidak dipakai sama sekali oleh mode Kedudukan.
    wakilan: ["PPKA", "PLR", "PRS", "PJL"],
  },

  // BARU — dua mode form Langkah 1 (lihat Form.mode/Form.setMode di form.js).
  // "kedudukan" = form asli (tidak berubah sama sekali). "wakilan" = form
  // yang sama + 2 field tambahan (Stasiun Tempat Wakilan, Wakilan).
  MODE_KEDUDUKAN: "kedudukan",
  MODE_WAKILAN: "wakilan",

  // BARU — dua pilihan dropdown "Jenis Serah Terima" (lihat OPTIONS di atas).
  // Konstanta ini dipakai form.js/upload.js/pdf.js/preview.js supaya tidak
  // ada string "Stasiun Buka"/"Stasiun Tutup" yang diketik berulang-ulang.
  JENIS_BUKA: "Stasiun Buka",
  JENIS_TUTUP: "Stasiun Tutup",

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
  // DIUBAH — "Stasiun Tutup" sekarang satu entri yang menggabungkan bekas
  // "Awal Dinas" + "Akhir Dinas" (kedua kolom foto tetap terpisah di tabel
  // PDF/preview, lihat getTableColumns() di bawah — hanya dropdownnya yang
  // digabung). "Stasiun Buka" adalah nama baru dari "Serah Terima Dinasan"
  // (tabel & kolom TIDAK berubah).
  MAPPING: {
    "Stasiun Tutup": {
      tabel: "tabel_dinas_tutup",
      kolomFotoAwalDinas: "Awal Dinas",
      kolomFotoAkhirDinas: "Akhir Dinas",
      kolomFotoDokumentasi: "Dokumentasi Kegiatan",
    },
    "Stasiun Buka": {
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

  // BARU — format nama file PDF khusus mode "Stasiun Tempat Wakilan":
  // dd-mm-yyyy (Wakilan StasiunTempatWakilan Dinas).pdf
  // Terpisah sepenuhnya dari buildPdfFileName() di atas — mode Kedudukan
  // TIDAK tersentuh sama sekali oleh fungsi ini.
  buildPdfFileNameWakilan(tanggalISO, wakilan, stasiunTempatWakilan, dinas) {
    const d = new Date(tanggalISO + "T00:00:00");
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy} (${wakilan} ${stasiunTempatWakilan} ${dinas}).pdf`;
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
  // DIUBAH — dulu kolom "Awal Dinas"/"Akhir Dinas" pada tabel_dinas_tutup
  // punya lebar asimetris (kolom yang terisi foto diperlebar, pasangannya
  // yang kosong disempitkan) karena dulu HANYA SALAH SATU yang pernah
  // terisi dalam satu submit. Sekarang ("Stasiun Tutup") KEDUA kolom
  // selalu terisi sekaligus dalam satu submit yang sama, jadi lebarnya
  // dibuat sama rata (masing-masing separuh dari total lebar lama
  // WIDE+NARROW = 0.34+0.10 = 0.44, supaya kolom lain — Hari/Tanggal,
  // Kegiatan, Dokumentasi Kegiatan — tidak ikut terpengaruh/bergeser).
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

  // Nama kolom foto (target) untuk jenis serah terima yang HANYA punya
  // 1 foto serah terima ("Stasiun Buka" -> kolom "gabung"). "Stasiun
  // Tutup" tidak punya satu targetKey tunggal (2 foto sekaligus: "awal"
  // & "akhir") — pdf.js/preview.js menangani kasus itu secara khusus,
  // lihat pengecekan `jenisSerahTerima === CONFIG.JENIS_TUTUP` di sana.
  getTargetPhotoKey(jenisSerahTerima) {
    const map = {
      "Stasiun Buka": "gabung",
    };
    return map[jenisSerahTerima];
  },
};

// Dibekukan supaya tidak sengaja termodifikasi saat runtime.
Object.freeze(CONFIG.OPTIONS);
Object.freeze(CONFIG.MAPPING);
Object.freeze(CONFIG.DINAS_KHUSUS);

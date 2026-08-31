# Serah Terima Dinas

Aplikasi web untuk mencatat serah terima dinas pegawai stasiun: input data pegawai (auto-fill via NIPP), data dinas, unggah foto, preview dokumen, generate PDF, lalu tersimpan otomatis ke **Google Sheet** (database) dan **Google Drive** (arsip PDF & foto).

Frontend berupa file statis (cocok untuk **GitHub Pages**), backend memakai **Google Apps Script** sebagai API gratis yang terhubung langsung ke Google Sheet & Drive.

## Struktur Proyek

```
.
├── index.html                 Halaman utama (form wizard)
├── assets/
│   ├── css/style.css           Semua styling
│   ├── js/
│   │   ├── config.js            URL Apps Script, opsi dropdown, aturan tabel
│   │   ├── api.js                Komunikasi ke backend Apps Script
│   │   ├── form.js               Dropdown, cek NIPP, validasi
│   │   ├── upload.js             Drag & drop foto + preview thumbnail
│   │   ├── pdf.js                Generate PDF (jsPDF) sesuai tabel_dinas_tutup/buka
│   │   ├── preview.js            Modal preview sebelum simpan
│   │   └── main.js               Orkestrasi alur & inisialisasi
│   └── img/
├── apps-script/
│   └── Code.gs                  Kode backend Google Apps Script
└── README.md
```

## 1. Setup Google Sheet

1. Buat Google Spreadsheet baru, salin **Spreadsheet ID**-nya (bagian di URL antara `/d/` dan `/edit`).
2. Sheet akan dibuat otomatis oleh backend saat pertama kali dipakai (`Pegawai` dan `SerahTerima`), atau jalankan fungsi `setupSpreadsheet()` manual dari editor Apps Script untuk membuatnya lebih dulu.

**Sheet `Pegawai`**

| NIPP | Nama | Jabatan | Stasiun |
|---|---|---|---|

**Sheet `SerahTerima`**

| Timestamp | NIPP | Nama | Jabatan | Dinas | JenisSerahTerima | Stasiun | Tanggal | TabelDigunakan | FileURL_FotoSerahTerima | FileURL_FotoDokumentasi | FileURL_PDF |
|---|---|---|---|---|---|---|---|---|---|---|---|

## 2. Deploy Backend (Google Apps Script)

1. Buka [script.google.com](https://script.google.com) → **New project**.
2. Hapus isi default, tempel seluruh isi `apps-script/Code.gs`.
3. Ganti baris berikut dengan Spreadsheet ID dari langkah 1:
   ```js
   const SPREADSHEET_ID = "GANTI_DENGAN_SPREADSHEET_ID_ANDA";
   ```
4. **Deploy → New deployment → Type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Salin URL Web App yang muncul (diakhiri `/exec`).

## 3. Hubungkan Frontend ke Backend

Buka `assets/js/config.js`, isi:

```js
APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXX/exec",
```

## 4. Deploy Frontend

Folder ini sekarang bagian dari repo **converterpdftojpg** (PDF Hub), ditempatkan di subfolder `/imo/` di root repo tersebut (dideploy via Cloudflare Pages, lihat `wrangler.jsonc` di root repo). Situs akan tersedia di `https://<domain-pdfhub>/imo/`, dan link menu "IMO" di beranda PDF Hub (`index.html`) sudah diarahkan ke `imo/index.html`.

Jika suatu saat ingin dideploy terpisah lagi via GitHub Pages sebagai repo sendiri, cukup push seluruh isi folder `imo/` ini ke root repo GitHub lain, lalu aktifkan **Settings → Pages** dengan folder `/ (root)`.

## Logika Inti (Jenis Serah Terima → Tabel & Kolom)

| Jenis Serah Terima | Tabel | Foto Serah Terima masuk ke kolom | Foto Dokumentasi masuk ke kolom |
|---|---|---|---|
| Awal Dinas | `tabel_dinas_tutup` | Awal Dinas | Dokumentasi Kegiatan |
| Akhir Dinas | `tabel_dinas_tutup` | Akhir Dinas | Dokumentasi Kegiatan |
| Serah Terima Dinasan | `tabel_dinas_buka` | Serah Terima Dinasan | Dokumentasi Kegiatan |

Aturan ini didefinisikan di `assets/js/config.js` (`CONFIG.MAPPING`) — ubah di sana jika perlu, tidak perlu menyentuh file lain.

## Struktur Folder Google Drive

```
IMO_2026/
└── {Stasiun}/
    └── {Jabatan}/
        └── {NIPP}/
            ├── dd-mm-yy (Dinas).pdf
            ├── dd-mm-yy (Dinas) - <kolom foto serah terima>.jpg
            └── dd-mm-yy (Dinas) - Dokumentasi Kegiatan.jpg
```

Folder dibuat otomatis oleh backend bila belum tersedia.

## Alur Aplikasi

1. **Data Pegawai** — ketik NIPP → sistem cek ke Google Sheet:
   - Ditemukan → Nama/Jabatan/Stasiun terisi otomatis.
   - Tidak ditemukan → isi manual; data baru ditambahkan ke Sheet **hanya setelah** tombol Simpan ditekan dan berhasil.
2. **Data Dinas** — pilih Dinas, Jenis Serah Terima, dan Tanggal.
3. **Unggah Foto** — Foto Serah Terima & Foto Dokumentasi Kegiatan (drag & drop + preview thumbnail).
4. **Preview** — tinjau seluruh data & foto sebelum disimpan (tombol Kembali/Edit atau Simpan).
5. **Simpan** — PDF dibuat di browser (jsPDF) → dikirim ke Apps Script → disimpan ke Drive (folder otomatis) → dicatat ke Google Sheet.

## Catatan Kustomisasi

Semua nilai yang mungkin sering berubah (URL backend, nama folder root Drive, isi dropdown, dan mapping tabel/kolom) dikumpulkan di **`assets/js/config.js`** — cukup ubah di satu tempat ini tanpa menyentuh logika aplikasi lainnya.

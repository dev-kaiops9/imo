/**
 * form.js
 * -----------------------------------------------------------------------
 * Mengisi dropdown dari CONFIG.OPTIONS, memuat identitas user dari sesi
 * Login (bukan lagi form "Data Pegawai" manual), serta validasi setiap
 * step sebelum lanjut.
 *
 * Identitas (Nama/NIPP/Jabatan/Stasiun) SEKARANG berasal dari localStorage
 * key "imoUser" yang diisi oleh modal Login pada dashboard IMO Tools
 * (index.html satu level di atas folder ini). Karena halaman ini dimuat
 * sebagai iframe pada origin yang sama, localStorage tersebut bisa
 * dibaca langsung di sini — tidak perlu form input NIPP/Nama terpisah lagi.
 * -----------------------------------------------------------------------
 */

const SESSION_STORAGE_KEY = "imoUser";

const Form = {
  employeeFound: true, // Selalu true: user login berarti sudah tercatat di sheet Pegawai.
  currentUser: null,   // { nama, nipp, jabatan, stasiun } — hasil Session.get()

  // Value jenisSerahTerima yang dikunci otomatis untuk dinas LIBUR & Lainnya
  // (supaya kolom tabel yang dipakai selalu "Serah Terima Dinasan" / kolom
  // "gabung" — lihat CONFIG.MAPPING).
  _JENIS_KHUSUS: "Serah Terima Dinasan",

  init() {
    this._populateSelect("dinas", CONFIG.OPTIONS.dinas);
    this._populateSelect("jenisSerahTerima", CONFIG.OPTIONS.jenisSerahTerima);
    this._wireLiveValidationClear();
    this._wireDinasMode();
    this._applyDinasMode(); // set tampilan awal (dinas belum dipilih -> mode normal)
    const loggedIn = this.loadSession();

    // Ambil daftar "PDF Tersimpan" di LATAR BELAKANG begitu halaman dibuka
    // (bukan menunggu sampai tombol "Lanjut" diklik). Dengan begitu, saat
    // user selesai mengisi Langkah 1 dan menekan "Lanjut →", pengecekan
    // duplikat tanggal (checkTanggalDuplikat) biasanya tinggal membaca
    // cache yang sudah selesai dimuat — tidak ada jeda loading baru.
    if (loggedIn) this._prefetchSavedPdfList();

    return loggedIn;
  },

  // Cache hasil "cekPdfTersimpan" supaya tidak perlu request baru setiap
  // kali tombol "Lanjut" diklik. _savedPdfListPromise dipakai supaya kalau
  // ada beberapa pemanggil sekaligus, mereka menunggu SATU request yang
  // sama (tidak dobel fetch).
  _savedPdfList: null,
  _savedPdfListPromise: null,

  /** Mulai (atau pakai ulang) proses ambil daftar PDF Tersimpan milik user aktif. */
  _prefetchSavedPdfList() {
    if (!this.currentUser || !this.currentUser.nipp) return Promise.resolve([]);
    if (this._savedPdfListPromise) return this._savedPdfListPromise; // sudah berjalan/selesai, pakai ulang.

    this._savedPdfListPromise = Api.cekPdfTersimpan(this.currentUser.nipp)
      .then((data) => {
        this._savedPdfList = (data && data.list) || [];
        return this._savedPdfList;
      })
      .catch(() => {
        // Gagal ambil (mis. jaringan) — anggap kosong, jangan blokir user.
        // Set null lagi supaya percobaan berikutnya (klik Lanjut) mencoba fetch ulang.
        this._savedPdfListPromise = null;
        return [];
      });
    return this._savedPdfListPromise;
  },

  /**
   * Catat entri yang baru saja berhasil disimpan (dipanggil dari main.js
   * setelah Api.saveSerahTerima() sukses) langsung ke cache lokal, supaya
   * kalau user langsung isi entri baru lagi di sesi yang sama, tanggal
   * yang baru saja disimpan langsung terdeteksi duplikat tanpa perlu
   * fetch ulang ke server.
   */
  registerSavedPdf(tanggalISO, dinas, jenisSerahTerima, fileUrl) {
    if (!this._savedPdfList) this._savedPdfList = [];
    this._savedPdfList.push({
      tanggal: this._isoToDDMMYYYY(tanggalISO),
      dinas,
      jenisSerahTerima,
      fileUrl,
    });
  },

  /** Pasang listener perubahan Dinas untuk mengatur mode tampilan (normal / LIBUR / Lainnya). */
  _wireDinasMode() {
    document.getElementById("dinas").addEventListener("change", () => this._applyDinasMode());
  },

  /**
   * Menyesuaikan tampilan form berdasarkan pilihan Dinas saat ini, TANPA
   * mengubah alur existing Pagi/Siang/Malam:
   * - LIBUR: kunci Jenis Serah Terima ke "Serah Terima Dinasan", sembunyikan
   *   kedua upload foto di Langkah 2.
   * - Lainnya: tampilkan input manual "Isi Dinas/Kegiatan", kunci Jenis
   *   Serah Terima ke "Serah Terima Dinasan", sembunyikan hanya Upload Foto
   *   Serah Terima di Langkah 2 (Upload Foto Dokumentasi Kegiatan tetap ada).
   * - Pagi/Siang/Malam/kosong: semua tampil & berperilaku seperti semula.
   */
  _applyDinasMode() {
    const dinas = document.getElementById("dinas").value;
    const isLibur = dinas === CONFIG.DINAS_KHUSUS.LIBUR;
    const isLainnya = dinas === CONFIG.DINAS_KHUSUS.LAINNYA;
    const isKhusus = isLibur || isLainnya;

    const jenisSelect = document.getElementById("jenisSerahTerima");
    const fieldDinasLainnya = document.getElementById("fieldDinasLainnya");
    const fieldFotoSerahTerima = document.getElementById("fieldFotoSerahTerima");
    const fieldFotoDokumentasi = document.getElementById("fieldFotoDokumentasi");
    const hintLibur = document.getElementById("hintLiburNoUpload");

    // Input manual "Isi Dinas/Kegiatan" — hanya untuk Lainnya.
    fieldDinasLainnya.classList.toggle("hidden", !isLainnya);
    if (!isLainnya) this._clearFieldError("dinasLainnya");

    // Jenis Serah Terima: dikunci otomatis untuk LIBUR & Lainnya, bebas dipilih
    // seperti semula untuk Pagi/Siang/Malam/kosong.
    if (isKhusus) {
      jenisSelect.value = this._JENIS_KHUSUS;
      jenisSelect.disabled = true;
      this._clearFieldError("jenisSerahTerima");
    } else {
      jenisSelect.disabled = false;
    }

    // Langkah 2 — Upload Foto:
    // LIBUR -> sembunyikan keduanya (tidak perlu foto sama sekali).
    // Lainnya -> sembunyikan Foto Serah Terima saja.
    // Pagi/Siang/Malam/kosong -> tampilkan keduanya (existing).
    fieldFotoSerahTerima.classList.toggle("hidden", isKhusus);
    fieldFotoDokumentasi.classList.toggle("hidden", isLibur);
    hintLibur.classList.toggle("hidden", !isLibur);
  },

  /** Ambil user aktif dari sesi Login. Return true jika ada & valid. */
  loadSession() {
    this.currentUser = this._readSession();

    const banner = document.getElementById("identityBanner");
    const notLoggedIn = document.getElementById("notLoggedInPanel");
    const mainFormArea = document.getElementById("mainFormArea");
    const stepperNav = document.getElementById("stepperNav");

    if (this.currentUser) {
      document.getElementById("idNama").textContent = this.currentUser.nama || "-";
      document.getElementById("idNipp").textContent = this.currentUser.nipp || "-";
      document.getElementById("idJabatan").textContent = this.currentUser.jabatan || "-";
      document.getElementById("idStasiun").textContent = this.currentUser.stasiun || "-";

      banner.classList.remove("hidden");
      notLoggedIn.classList.add("hidden");
      mainFormArea.classList.remove("hidden");
      stepperNav.classList.remove("hidden");
      return true;
    }

    // Belum login: sembunyikan form & tampilkan ajakan login.
    banner.classList.add("hidden");
    mainFormArea.classList.add("hidden");
    stepperNav.classList.add("hidden");
    notLoggedIn.classList.remove("hidden");
    return false;
  },

  _readSession() {
    try {
      const raw = window.parent && window.parent !== window
        ? window.parent.localStorage.getItem(SESSION_STORAGE_KEY)
        : localStorage.getItem(SESSION_STORAGE_KEY);
      const user = JSON.parse(raw);
      if (user && user.nama && user.nipp) return user;
    } catch (err) {
      // Sesi rusak/tidak bisa dibaca — perlakukan sebagai belum login.
    }
    return null;
  },

  _populateSelect(id, options) {
    const el = document.getElementById(id);
    options.forEach((opt) => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      el.appendChild(o);
    });
  },

  _wireLiveValidationClear() {
    ["dinas", "tanggal", "jenisSerahTerima", "dinasLainnya"].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener("input", () => this._clearFieldError(id));
      el.addEventListener("change", () => this._clearFieldError(id));
    });
  },

  _clearFieldError(id) {
    const field = document.getElementById(id).closest(".field");
    if (field) field.classList.remove("has-error");
    const el = document.getElementById(id);
    el.classList.remove("is-invalid");
  },

  _setFieldError(id, hasError) {
    const el = document.getElementById(id);
    const field = el.closest(".field");
    if (hasError) {
      field.classList.add("has-error");
      el.classList.add("is-invalid");
    } else {
      field.classList.remove("has-error");
      el.classList.remove("is-invalid");
    }
  },

  /** Validasi step 1 (Data Dinas). Return true jika lolos. */
  validateStep1() {
    let ok = true;
    const dinas = document.getElementById("dinas").value;
    const tanggal = document.getElementById("tanggal").value;
    const jenis = document.getElementById("jenisSerahTerima").value;
    const isLainnya = dinas === CONFIG.DINAS_KHUSUS.LAINNYA;
    const dinasLainnya = document.getElementById("dinasLainnya").value.trim();

    this._setFieldError("dinas", !dinas);
    this._setFieldError("tanggal", !tanggal);
    this._setFieldError("jenisSerahTerima", !jenis);
    if (isLainnya) this._setFieldError("dinasLainnya", !dinasLainnya);

    if (!dinas || !tanggal || !jenis) ok = false;
    if (isLainnya && !dinasLainnya) ok = false;
    if (!ok) Toast.show("Lengkapi data dinas terlebih dahulu.", "error");
    return ok;
  },

  /**
   * Cek apakah tanggal yang sedang dipilih di Langkah 1 SUDAH ADA di
   * "PDF Tersimpan" milik user yang sedang login (sheet SerahTerima).
   *
   * Memakai cache dari _prefetchSavedPdfList() (sudah mulai diambil sejak
   * halaman ini dibuka) supaya klik "Lanjut" TIDAK menunggu request baru
   * ke server — kalau cache belum selesai juga (mis. baru buka halaman
   * lalu langsung buru-buru klik Lanjut), baru di sini menunggu request
   * yang sama itu selesai (bukan bikin request baru/dobel).
   *
   * Dipanggil dari main.js SEBELUM pindah dari Langkah 1 -> Langkah 2,
   * supaya user tidak bisa lanjut mengisi & upload foto untuk tanggal
   * yang datanya sudah pernah disimpan sebelumnya (mencegah dobel entri
   * untuk tanggal yang sama).
   *
   * @returns {Promise<{duplikat: boolean, tanggalTampil?: string}>}
   *   duplikat=true jika tanggal sudah ada; tanggalTampil format
   *   "dd-mm-yyyy" (sama seperti ditampilkan di widget PDF Tersimpan).
   */
  async checkTanggalDuplikat() {
    const tanggalISO = document.getElementById("tanggal").value;
    const nipp = this.currentUser && this.currentUser.nipp;
    if (!tanggalISO || !nipp) return { duplikat: false };

    const tanggalTampil = this._isoToDDMMYYYY(tanggalISO);

    try {
      const list = await this._prefetchSavedPdfList();
      const sudahAda = (list || []).some((item) => item.tanggal === tanggalTampil);
      return { duplikat: sudahAda, tanggalTampil };
    } catch (err) {
      // Gagal cek ke server (mis. jaringan bermasalah) — jangan blokir
      // user karena error koneksi, biarkan tetap lanjut seperti biasa.
      return { duplikat: false };
    }
  },

  /** "yyyy-mm-dd" (dari <input type="date">) -> "dd-mm-yyyy" (format tampilan backend). */
  _isoToDDMMYYYY(iso) {
    const parts = String(iso || "").split("-");
    if (parts.length !== 3) return "";
    const [yyyy, mm, dd] = parts;
    return `${dd}-${mm}-${yyyy}`;
  },

  /** Validasi step 2 (Upload Foto). */
  validateStep2() {
    const dinas = document.getElementById("dinas").value;
    const isLibur = dinas === CONFIG.DINAS_KHUSUS.LIBUR;
    const isLainnya = dinas === CONFIG.DINAS_KHUSUS.LAINNYA;

    // LIBUR: tidak perlu foto sama sekali — langsung lolos.
    if (isLibur) return true;

    let ok = true;
    const dzSerahTerima = document.getElementById("dzSerahTerima");
    const dzDokumentasi = document.getElementById("dzDokumentasi");

    // Lainnya: hanya Foto Dokumentasi Kegiatan yang wajib (Foto Serah
    // Terima disembunyikan, tidak divalidasi).
    const requireSerahTerima = !isLainnya;
    const hasSerahTerima = !!UploadField.state.fotoSerahTerima;
    const hasDokumentasi = !!UploadField.state.fotoDokumentasi;

    if (requireSerahTerima) {
      document.getElementById("err-fotoSerahTerima").style.display = hasSerahTerima ? "none" : "block";
      dzSerahTerima.classList.toggle("is-invalid", !hasSerahTerima);
      if (!hasSerahTerima) ok = false;
    }

    document.getElementById("err-fotoDokumentasi").style.display = hasDokumentasi ? "none" : "block";
    dzDokumentasi.classList.toggle("is-invalid", !hasDokumentasi);
    if (!hasDokumentasi) ok = false;

    if (!ok) Toast.show("Unggah foto yang wajib sebelum melanjutkan.", "error");
    return ok;
  },

  /** Kumpulkan seluruh data form (identitas dari sesi + Data Dinas) menjadi satu objek. */
  collect() {
    const jenis = document.getElementById("jenisSerahTerima").value;
    const mapping = CONFIG.MAPPING[jenis];
    const user = this.currentUser || {};
    const dinas = document.getElementById("dinas").value;
    const dinasLainnya = document.getElementById("dinasLainnya").value.trim();
    return {
      nipp: user.nipp || "",
      nama: user.nama || "",
      jabatan: user.jabatan || "",
      stasiun: user.stasiun || "",
      dinas,
      kegiatan: CONFIG.buildKegiatan(dinas, dinasLainnya),
      tanggal: document.getElementById("tanggal").value,
      jenisSerahTerima: jenis,
      employeeFound: this.employeeFound,
      mapping,
    };
  },

  reset() {
    ["tanggal", "dinasLainnya"].forEach((id) => (document.getElementById(id).value = ""));
    ["dinas", "jenisSerahTerima"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("jenisSerahTerima").disabled = false;
    this._applyDinasMode();
  },
};

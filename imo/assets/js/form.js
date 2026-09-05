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
  // (supaya kolom tabel yang dipakai selalu "Stasiun Buka" / kolom "gabung"
  // — lihat CONFIG.MAPPING). DIUBAH — dulu "Serah Terima Dinasan", sekarang
  // nama barunya "Stasiun Buka" (CONFIG.JENIS_BUKA), logika tidak berubah.
  _JENIS_KHUSUS: CONFIG.JENIS_BUKA,

  // BARU — mode Langkah 1: CONFIG.MODE_KEDUDUKAN (default, form asli TIDAK
  // berubah) atau CONFIG.MODE_WAKILAN (form yang sama + 2 field tambahan).
  mode: null,

  init() {
    this.mode = CONFIG.MODE_KEDUDUKAN;
    this._populateSelect("dinas", CONFIG.OPTIONS.dinas);
    this._populateSelect("jenisSerahTerima", CONFIG.OPTIONS.jenisSerahTerima);
    this._populateSelect("wakilan", CONFIG.OPTIONS.wakilan);
    this._wireLiveValidationClear();
    this._wireDinasMode();
    // BARU — jenisSerahTerima sekarang juga menentukan blok upload mana
    // yang tampil di Langkah 2 (lihat _applyUploadVisibility di bawah).
    document.getElementById("jenisSerahTerima").addEventListener("change", () => this._applyUploadVisibility());
    // BARU — pilihan "Wakilan" ikut menentukan status dropdown Jenis Serah
    // Terima saat jabatan user PPKA (lihat _refreshJenisSerahTerimaState).
    document.getElementById("wakilan").addEventListener("change", () => this._refreshJenisSerahTerimaState());
    this._applyDinasMode(); // set tampilan awal (dinas belum dipilih -> mode normal)
    this._wireStasiunWakilanAutocomplete();
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
   * - LIBUR: kunci Jenis Serah Terima ke "Stasiun Buka", sembunyikan
   *   kedua upload foto di Langkah 2.
   * - Lainnya: tampilkan input manual "Isi Dinas/Kegiatan", kunci Jenis
   *   Serah Terima ke "Stasiun Buka", sembunyikan hanya Upload Foto
   *   Serah Terima di Langkah 2 (Upload Foto Dokumentasi Kegiatan tetap ada).
   * - Pagi/Siang/Malam/kosong: semua tampil & berperilaku seperti semula.
   */
  _applyDinasMode() {
    const dinas = document.getElementById("dinas").value;
    const isLibur = dinas === CONFIG.DINAS_KHUSUS.LIBUR;
    const isLainnya = dinas === CONFIG.DINAS_KHUSUS.LAINNYA;
    const isKhusus = isLibur || isLainnya;

    const fieldDinasLainnya = document.getElementById("fieldDinasLainnya");
    const fieldFotoDokumentasi = document.getElementById("fieldFotoDokumentasi");
    const hintLibur = document.getElementById("hintLiburNoUpload");

    // Input manual "Isi Dinas/Kegiatan" — hanya untuk Lainnya.
    fieldDinasLainnya.classList.toggle("hidden", !isLainnya);
    if (!isLainnya) this._clearFieldError("dinasLainnya");

    // Jenis Serah Terima: dikunci otomatis untuk LIBUR & Lainnya (dan juga
    // untuk aturan jabatan/wakilan — lihat _refreshJenisSerahTerimaState),
    // bebas dipilih seperti semula untuk Pagi/Siang/Malam/kosong.
    this._refreshJenisSerahTerimaState();

    // Langkah 2 — Upload Foto Dokumentasi Kegiatan:
    // LIBUR -> sembunyikan (tidak perlu foto sama sekali).
    // Lainnya/Pagi/Siang/Malam/kosong -> tampilkan (existing).
    fieldFotoDokumentasi.classList.toggle("hidden", isLibur);
    hintLibur.classList.toggle("hidden", !isLibur);
  },

  /**
   * BARU — menentukan status dropdown "Jenis Serah Terima" berdasarkan
   * gabungan 2 aturan:
   *
   * 1) Aturan Dinas (existing, TIDAK berubah): LIBUR/Lainnya mengunci nilai
   *    ke "Stasiun Buka" & menonaktifkan dropdown.
   *
   * 2) Aturan Jabatan/Wakilan (BARU):
   *    - Mode "Stasiun Kedudukan": jika jabatan user (dari sesi login)
   *      adalah PLR/PRS/PJL -> SEMBUNYIKAN dropdown, default "Stasiun Buka".
   *      Jika jabatan PPKA -> dropdown aktif normal (tidak disentuh).
   *    - Mode "Stasiun Tempat Wakilan":
   *        * Jika jabatan user BUKAN PPKA (PLR/PRS/PJL) -> SEMBUNYIKAN
   *          dropdown, default "Stasiun Buka".
   *        * Jika jabatan user PPKA:
   *            - Dropdown "Wakilan" = PPKA -> dropdown Jenis Serah Terima
   *              aktif normal (Stasiun Buka & Stasiun Tutup).
   *            - Dropdown "Wakilan" = PLR/PRS/PJL (atau belum dipilih)
   *              -> NONAKTIFKAN (disabled, tetap terlihat) dropdown Jenis
   *              Serah Terima, default "Stasiun Buka".
   *
   * Kedua aturan digabung: dropdown dikunci ke "Stasiun Buka" jika salah
   * satu aturan mengunci (dinas khusus ATAU jabatan/wakilan), dan hanya
   * disembunyikan sepenuhnya jika aturan jabatan/wakilan secara spesifik
   * meminta "hidden".
   */
  _refreshJenisSerahTerimaState() {
    const dinas = document.getElementById("dinas").value;
    const isDinasKhusus = dinas === CONFIG.DINAS_KHUSUS.LIBUR || dinas === CONFIG.DINAS_KHUSUS.LAINNYA;

    const jabatan = this.currentUser && this.currentUser.jabatan;
    const isPPKA = jabatan === "PPKA";

    // 'normal' = dropdown bebas dipilih user (tunduk pada aturan dinas di atas).
    // 'disabled' = dropdown terlihat tapi nonaktif, nilai dikunci "Stasiun Buka".
    // 'hidden' = seluruh field disembunyikan, nilai dikunci "Stasiun Buka".
    let jabatanState;
    if (this.mode === CONFIG.MODE_WAKILAN) {
      if (!isPPKA) {
        jabatanState = "hidden";
      } else {
        const wakilanVal = document.getElementById("wakilan").value;
        jabatanState = wakilanVal === "PPKA" ? "normal" : "disabled";
      }
    } else {
      jabatanState = isPPKA ? "normal" : "hidden";
    }

    const jenisSelect = document.getElementById("jenisSerahTerima");
    const jenisField = document.getElementById("fieldJenisSerahTerima");
    const forceBuka = isDinasKhusus || jabatanState !== "normal";

    if (jenisField) jenisField.classList.toggle("hidden", jabatanState === "hidden");
    jenisSelect.disabled = forceBuka;

    if (forceBuka) {
      jenisSelect.value = this._JENIS_KHUSUS; // "Stasiun Buka"
      this._clearFieldError("jenisSerahTerima");
    }

    // Blok upload Foto Serah Terima (Stasiun Buka, 1 foto) vs blok Awal
    // Dinas + Akhir Dinas (Stasiun Tutup, 2 foto) — lihat _applyUploadVisibility.
    this._applyUploadVisibility();
  },

  /**
   * BARU — menentukan blok upload mana yang tampil di Langkah 2 berdasarkan
   * pilihan Jenis Serah Terima saat ini:
   * - "Stasiun Buka" (termasuk LIBUR/Lainnya yang dikunci ke sini) ->
   *   tampilkan #fieldFotoSerahTerima (1 upload, mekanisme existing).
   * - "Stasiun Tutup" -> tampilkan #fieldFotoStasiunTutup (2 upload: Awal
   *   Dinas + Akhir Dinas sekaligus).
   * LIBUR tetap menyembunyikan kedua blok (tidak perlu foto serah terima
   * sama sekali) — ditangani lewat isKhusus/isLibur seperti semula.
   */
  _applyUploadVisibility() {
    const dinas = document.getElementById("dinas").value;
    const isLibur = dinas === CONFIG.DINAS_KHUSUS.LIBUR;
    const isLainnya = dinas === CONFIG.DINAS_KHUSUS.LAINNYA;
    const isKhusus = isLibur || isLainnya;
    const jenis = document.getElementById("jenisSerahTerima").value;
    const isTutup = !isKhusus && jenis === CONFIG.JENIS_TUTUP;

    const fieldFotoSerahTerima = document.getElementById("fieldFotoSerahTerima");
    const fieldFotoStasiunTutup = document.getElementById("fieldFotoStasiunTutup");

    fieldFotoStasiunTutup.classList.toggle("hidden", isKhusus || !isTutup);
    fieldFotoSerahTerima.classList.toggle("hidden", isKhusus || isTutup);
  },

  // -----------------------------------------------------------------------
  // BARU — Mode "Stasiun Tempat Wakilan" (Langkah 1)
  // -----------------------------------------------------------------------

  /**
   * Ganti mode aktif. Hanya menampilkan/menyembunyikan field-row tambahan
   * (#fieldRowWakilan) di Langkah 1 — TIDAK menyentuh field/alur lain sama
   * sekali. Dipanggil dari skrip mode switcher di index.html saat user
   * klik tab.
   */
  setMode(mode) {
    this.mode = mode === CONFIG.MODE_WAKILAN ? CONFIG.MODE_WAKILAN : CONFIG.MODE_KEDUDUKAN;
    const isWakilan = this.mode === CONFIG.MODE_WAKILAN;
    const row = document.getElementById("fieldRowWakilan");
    if (row) row.classList.toggle("hidden", !isWakilan);

    if (isWakilan) {
      this._prefetchDaftarStasiun();
    } else {
      // Balik ke Kedudukan: bersihkan error field Wakilan supaya tidak
      // "nyangkut" kalau user sempat coba Lanjut di mode Wakilan lalu
      // pindah kembali ke Kedudukan.
      this._clearFieldError("stasiunTempatWakilan");
      this._clearFieldError("wakilan");
    }

    // BARU — aturan tampilan Jenis Serah Terima berbeda antara mode
    // Kedudukan & Wakilan (tergantung jabatan user & pilihan Wakilan),
    // lihat _refreshJenisSerahTerimaState.
    this._refreshJenisSerahTerimaState();
  },

  // Cache daftar MasterStasiun (reuse action backend "getDaftarStasiun",
  // sama seperti dipakai form pendaftaran di root index.html & bulanan.js).
  _daftarStasiunCache: [],
  _daftarStasiunLoaded: false,
  _daftarStasiunPromise: null,

  _prefetchDaftarStasiun() {
    if (this._daftarStasiunLoaded || this._daftarStasiunPromise) return this._daftarStasiunPromise;
    this._daftarStasiunPromise = Api.getDaftarStasiun()
      .then((data) => {
        this._daftarStasiunCache = Array.isArray(data) ? data : [];
        this._daftarStasiunLoaded = true;
        return this._daftarStasiunCache;
      })
      .catch((err) => {
        console.warn("Gagal memuat daftar stasiun:", err.message);
        this._daftarStasiunPromise = null; // izinkan coba lagi nanti
        return [];
      });
    return this._daftarStasiunPromise;
  },

  _cariSaranStasiun(query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    return this._daftarStasiunCache
      .filter((s) => (s.nama || "").toLowerCase().includes(q) || (s.kode || "").toLowerCase().includes(q))
      .slice(0, 8);
  },

  /** Cocokkan input dengan entri MasterStasiun (Nama ATAU Kode), abaikan besar/kecil huruf. */
  _cariStasiunTerdaftar(inputStasiun) {
    const namaInput = String(inputStasiun || "").trim().toLowerCase();
    const kodeInput = namaInput;
    if (!namaInput) return null;
    return this._daftarStasiunCache.find((s) => {
      const namaCocok = String(s.nama || "").trim().toLowerCase() === namaInput;
      const kodeCocok = s.kode && String(s.kode).trim().toLowerCase() === kodeInput;
      return namaCocok || kodeCocok;
    }) || null;
  },

  _wireStasiunWakilanAutocomplete() {
    const input = document.getElementById("stasiunTempatWakilan");
    const suggestBox = document.getElementById("stasiunTempatWakilanSuggest");
    if (!input || !suggestBox) return;

    const renderSuggest = () => {
      const matches = this._cariSaranStasiun(input.value);
      if (!matches.length) {
        suggestBox.classList.add("hidden");
        suggestBox.innerHTML = "";
        return;
      }
      suggestBox.innerHTML = matches.map((s) => {
        const nama = String(s.nama || "").replace(/"/g, "&quot;");
        const kode = String(s.kode || "").replace(/"/g, "&quot;");
        return `<button type="button" data-nama="${nama}" style="width:100%; text-align:left; padding:8px 14px; font-size:13.5px; background:transparent; border:none; border-bottom:1px solid var(--border); cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px;">
          <span>${nama}</span>${kode ? `<span style="font-size:11px; color:var(--ink-300); font-family:var(--font-mono);">${kode}</span>` : ""}
        </button>`;
      }).join("");
      suggestBox.classList.remove("hidden");
    };

    input.addEventListener("input", renderSuggest);
    input.addEventListener("focus", renderSuggest);

    // 'mousedown' (bukan 'click') supaya kejadian sebelum 'blur' pada input.
    suggestBox.addEventListener("mousedown", (e) => {
      const btn = e.target.closest("button[data-nama]");
      if (!btn) return;
      e.preventDefault();
      input.value = btn.getAttribute("data-nama");
      suggestBox.classList.add("hidden");
      suggestBox.innerHTML = "";
      this._clearFieldError("stasiunTempatWakilan");
    });

    input.addEventListener("blur", () => {
      setTimeout(() => suggestBox.classList.add("hidden"), 150);
    });
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

      // BARU — jabatan baru diketahui setelah sesi termuat, jadi aturan
      // tampilan Jenis Serah Terima (lihat _refreshJenisSerahTerimaState)
      // baru bisa diterapkan di sini, bukan saat init() awal.
      this._refreshJenisSerahTerimaState();
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
        ? window.parent.sessionStorage.getItem(SESSION_STORAGE_KEY)
        : sessionStorage.getItem(SESSION_STORAGE_KEY);
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
    ["dinas", "tanggal", "jenisSerahTerima", "dinasLainnya", "stasiunTempatWakilan", "wakilan"].forEach((id) => {
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

    // BARU — 2 field tambahan HANYA divalidasi saat mode Wakilan. Mode
    // Kedudukan tidak tersentuh sama sekali oleh blok ini.
    if (this.mode === CONFIG.MODE_WAKILAN) {
      const stasiunWakilanInput = document.getElementById("stasiunTempatWakilan").value.trim();
      const wakilan = document.getElementById("wakilan").value;
      // Fail-open kalau daftar MasterStasiun belum/gagal dimuat (mis.
      // jaringan lambat) — sama seperti pola validasiStasiunTerdaftar()
      // di form pendaftaran (root index.html), supaya user tidak terkunci
      // gara-gara error jaringan, bukan gara-gara stasiunnya salah.
      const stasiunValid = !this._daftarStasiunLoaded || !this._daftarStasiunCache.length
        || !!this._cariStasiunTerdaftar(stasiunWakilanInput);

      this._setFieldError("stasiunTempatWakilan", !stasiunWakilanInput || !stasiunValid);
      this._setFieldError("wakilan", !wakilan);
      if (!stasiunWakilanInput || !stasiunValid) ok = false;
      if (!wakilan) ok = false;
    }

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
      // BARU — dibedakan per mode: entri Wakilan (stasiunTempatWakilan
      // terisi) tidak dianggap bentrok dengan entri Kedudukan di tanggal
      // yang sama, dan sebaliknya — keduanya kejadian yang berbeda.
      const isWakilanMode = this.mode === CONFIG.MODE_WAKILAN;
      const sudahAda = (list || []).some((item) => {
        if (item.tanggal !== tanggalTampil) return false;
        const itemIsWakilan = !!item.stasiunTempatWakilan;
        return itemIsWakilan === isWakilanMode;
      });
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
    const jenis = document.getElementById("jenisSerahTerima").value;
    // LIBUR/Lainnya selalu terkunci ke CONFIG.JENIS_BUKA (lihat
    // _applyDinasMode), jadi isTutup otomatis false untuk keduanya.
    const isTutup = jenis === CONFIG.JENIS_TUTUP;

    // LIBUR: tidak perlu foto sama sekali — langsung lolos.
    if (isLibur) return true;

    let ok = true;
    const dzDokumentasi = document.getElementById("dzDokumentasi");
    const hasDokumentasi = !!UploadField.state.fotoDokumentasi;
    document.getElementById("err-fotoDokumentasi").style.display = hasDokumentasi ? "none" : "block";
    dzDokumentasi.classList.toggle("is-invalid", !hasDokumentasi);
    if (!hasDokumentasi) ok = false;

    if (isTutup) {
      // Stasiun Tutup: Awal Dinas DAN Akhir Dinas dua-duanya wajib — tidak
      // boleh hanya salah satu (lihat CONFIG.MAPPING["Stasiun Tutup"]).
      const dzAwal = document.getElementById("dzAwalDinas");
      const dzAkhir = document.getElementById("dzAkhirDinas");
      const hasAwal = !!UploadField.state.fotoAwalDinas;
      const hasAkhir = !!UploadField.state.fotoAkhirDinas;

      document.getElementById("err-fotoAwalDinas").style.display = hasAwal ? "none" : "block";
      dzAwal.classList.toggle("is-invalid", !hasAwal);
      if (!hasAwal) ok = false;

      document.getElementById("err-fotoAkhirDinas").style.display = hasAkhir ? "none" : "block";
      dzAkhir.classList.toggle("is-invalid", !hasAkhir);
      if (!hasAkhir) ok = false;
    } else {
      // Stasiun Buka: Lainnya -> foto serah terima disembunyikan/tidak
      // wajib (perilaku existing); Pagi/Siang/Malam -> wajib.
      const requireSerahTerima = !isLainnya;
      if (requireSerahTerima) {
        const dzSerahTerima = document.getElementById("dzSerahTerima");
        const hasSerahTerima = !!UploadField.state.fotoSerahTerima;
        document.getElementById("err-fotoSerahTerima").style.display = hasSerahTerima ? "none" : "block";
        dzSerahTerima.classList.toggle("is-invalid", !hasSerahTerima);
        if (!hasSerahTerima) ok = false;
      }
    }

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
    const data = {
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
      mode: this.mode,
    };
    // BARU — hanya diisi saat mode Wakilan; mode Kedudukan tidak membawa
    // field ini sama sekali (undefined), jadi Api.saveSerahTerima() dan
    // Pdf.build() tetap berjalan persis seperti semula untuk Kedudukan.
    if (this.mode === CONFIG.MODE_WAKILAN) {
      data.stasiunTempatWakilan = document.getElementById("stasiunTempatWakilan").value.trim();
      data.wakilan = document.getElementById("wakilan").value;
    }
    return data;
  },

  reset() {
    ["tanggal", "dinasLainnya"].forEach((id) => (document.getElementById(id).value = ""));
    ["dinas", "jenisSerahTerima"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("jenisSerahTerima").disabled = false;
    this._applyDinasMode();
    // BARU — bersihkan 2 field tambahan juga (tidak berpengaruh apa pun
    // saat mode Kedudukan karena field-nya memang tersembunyi).
    const stasiunWakilanEl = document.getElementById("stasiunTempatWakilan");
    const wakilanEl = document.getElementById("wakilan");
    if (stasiunWakilanEl) stasiunWakilanEl.value = "";
    if (wakilanEl) wakilanEl.value = "";
  },
};

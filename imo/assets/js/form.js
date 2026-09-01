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

  init() {
    this._populateSelect("dinas", CONFIG.OPTIONS.dinas);
    this._populateSelect("jenisSerahTerima", CONFIG.OPTIONS.jenisSerahTerima);
    this._wireLiveValidationClear();
    return this.loadSession();
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
    ["dinas", "tanggal", "jenisSerahTerima"].forEach((id) => {
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

    this._setFieldError("dinas", !dinas);
    this._setFieldError("tanggal", !tanggal);
    this._setFieldError("jenisSerahTerima", !jenis);

    if (!dinas || !tanggal || !jenis) ok = false;
    if (!ok) Toast.show("Lengkapi data dinas terlebih dahulu.", "error");
    return ok;
  },

  /** Validasi step 2 (Upload Foto). */
  validateStep2() {
    let ok = true;
    const dzSerahTerima = document.getElementById("dzSerahTerima");
    const dzDokumentasi = document.getElementById("dzDokumentasi");

    const hasSerahTerima = !!UploadField.state.fotoSerahTerima;
    const hasDokumentasi = !!UploadField.state.fotoDokumentasi;

    document.getElementById("err-fotoSerahTerima").style.display = hasSerahTerima ? "none" : "block";
    document.getElementById("err-fotoDokumentasi").style.display = hasDokumentasi ? "none" : "block";
    dzSerahTerima.classList.toggle("is-invalid", !hasSerahTerima);
    dzDokumentasi.classList.toggle("is-invalid", !hasDokumentasi);

    if (!hasSerahTerima || !hasDokumentasi) ok = false;
    if (!ok) Toast.show("Unggah kedua foto sebelum melanjutkan.", "error");
    return ok;
  },

  /** Kumpulkan seluruh data form (identitas dari sesi + Data Dinas) menjadi satu objek. */
  collect() {
    const jenis = document.getElementById("jenisSerahTerima").value;
    const mapping = CONFIG.MAPPING[jenis];
    const user = this.currentUser || {};
    return {
      nipp: user.nipp || "",
      nama: user.nama || "",
      jabatan: user.jabatan || "",
      stasiun: user.stasiun || "",
      dinas: document.getElementById("dinas").value,
      kegiatan: CONFIG.buildKegiatan(document.getElementById("dinas").value),
      tanggal: document.getElementById("tanggal").value,
      jenisSerahTerima: jenis,
      employeeFound: this.employeeFound,
      mapping,
    };
  },

  reset() {
    ["tanggal"].forEach((id) => (document.getElementById(id).value = ""));
    ["dinas", "jenisSerahTerima"].forEach((id) => (document.getElementById(id).value = ""));
  },
};

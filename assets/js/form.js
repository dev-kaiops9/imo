/**
 * form.js
 * -----------------------------------------------------------------------
 * Mengisi dropdown dari CONFIG.OPTIONS, menangani pencarian NIPP
 * (debounce + auto-fill), serta validasi setiap step sebelum lanjut.
 * -----------------------------------------------------------------------
 */

const Form = {
  employeeFound: false, // true jika NIPP ditemukan di sheet (jangan buat pegawai baru)
  nippDebounceTimer: null,

  init() {
    this._populateSelect("jabatan1", CONFIG.OPTIONS.jabatan);
    this._populateSelect("dinas", CONFIG.OPTIONS.dinas);
    this._populateSelect("jenisSerahTerima", CONFIG.OPTIONS.jenisSerahTerima);
    this._wireNippLookup();
    this._wireLiveValidationClear();
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

  _wireNippLookup() {
    const nippInput = document.getElementById("nipp");
    nippInput.addEventListener("input", () => {
      clearTimeout(this.nippDebounceTimer);
      const nipp = nippInput.value.trim();
      this._hideNippStatus();
      this.employeeFound = false;

      if (!nipp) return;

      this.nippDebounceTimer = setTimeout(() => this._lookupNipp(nipp), 450);
    });
  },

  async _lookupNipp(nipp) {
    this._showNippStatus("loading", "Mencari…");
    try {
      const result = await Api.cekNipp(nipp);
      if (result && result.found) {
        this.employeeFound = true;
        document.getElementById("nama").value = result.data.nama || "";
        document.getElementById("jabatan1").value = result.data.jabatan || "";
        document.getElementById("stasiun").value = result.data.stasiun || "";
        this._showNippStatus("found", "Pegawai ditemukan");
      } else {
        this.employeeFound = false;
        this._showNippStatus("notfound", "NIPP belum terdaftar — isi data manual");
      }
    } catch (err) {
      this._showNippStatus("notfound", "Gagal memeriksa NIPP, isi data manual");
      Toast.show("Tidak dapat menghubungi server untuk cek NIPP: " + err.message, "warn");
    }
  },

  _showNippStatus(kind, text) {
    const el = document.getElementById("nippStatus");
    el.className = `nipp-status is-visible nipp-status--${kind}`;
    const flap = el.querySelector(".flap");
    flap.innerHTML = kind === "loading"
      ? '<span class="spinner"></span>'
      : (kind === "found" ? "✓" : "!");
    document.getElementById("nippStatusText").textContent = text;
  },

  _hideNippStatus() {
    document.getElementById("nippStatus").className = "nipp-status";
  },

  _wireLiveValidationClear() {
    ["nipp", "nama", "jabatan1", "stasiun", "dinas", "tanggal", "jenisSerahTerima"].forEach((id) => {
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

  /** Validasi step 1 (Data Pegawai). Return true jika lolos. */
  validateStep1() {
    let ok = true;
    const nipp = document.getElementById("nipp").value.trim();
    const nama = document.getElementById("nama").value.trim();
    const jabatan = document.getElementById("jabatan1").value;
    const stasiun = document.getElementById("stasiun").value.trim();

    this._setFieldError("nipp", !nipp);
    this._setFieldError("nama", !nama);
    this._setFieldError("jabatan1", !jabatan);
    this._setFieldError("stasiun", !stasiun);

    if (!nipp || !nama || !jabatan || !stasiun) ok = false;
    if (!ok) Toast.show("Lengkapi data pegawai terlebih dahulu.", "error");
    return ok;
  },

  /** Validasi step 2 (Data Dinas). */
  validateStep2() {
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

  /** Validasi step 3 (Upload Foto). */
  validateStep3() {
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

  /** Kumpulkan seluruh data form step 1 & 2 menjadi satu objek. */
  collect() {
    const jenis = document.getElementById("jenisSerahTerima").value;
    const mapping = CONFIG.MAPPING[jenis];
    return {
      nipp: document.getElementById("nipp").value.trim(),
      nama: document.getElementById("nama").value.trim(),
      jabatan: document.getElementById("jabatan1").value,
      stasiun: document.getElementById("stasiun").value.trim(),
      dinas: document.getElementById("dinas").value,
      kegiatan: CONFIG.buildKegiatan(document.getElementById("dinas").value),
      tanggal: document.getElementById("tanggal").value,
      jenisSerahTerima: jenis,
      employeeFound: this.employeeFound,
      mapping,
    };
  },

  reset() {
    ["nipp", "nama", "stasiun", "tanggal"].forEach((id) => (document.getElementById(id).value = ""));
    ["jabatan1", "dinas", "jenisSerahTerima"].forEach((id) => (document.getElementById(id).value = ""));
    this.employeeFound = false;
    this._hideNippStatus();
  },
};

/**
 * upload.js
 * -----------------------------------------------------------------------
 * PLACEHOLDER SEMENTARA — file asli tidak berhasil dipulihkan dari backup.
 * Menangani drag & drop + preview thumbnail foto secara lokal di browser.
 * Belum meng-upload apa pun ke Google Drive (lihat api.js).
 * -----------------------------------------------------------------------
 */

const UploadField = {
  state: {
    fotoSerahTerima: null,
    fotoDokumentasi: null,
  },

  init() {
    this._wire("dzSerahTerima", "fileSerahTerima", "thumbSerahTerima", "fotoSerahTerima");
    this._wire("dzDokumentasi", "fileDokumentasi", "thumbDokumentasi", "fotoDokumentasi");
  },

  _wire(dzId, inputId, thumbId, stateKey) {
    const dz = document.getElementById(dzId);
    const input = document.getElementById(inputId);
    if (!dz || !input) return;

    dz.addEventListener("click", () => input.click());
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("is-dragover"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("is-dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("is-dragover");
      if (e.dataTransfer.files[0]) this._setFile(e.dataTransfer.files[0], dz, thumbId, stateKey);
    });
    input.addEventListener("change", () => {
      if (input.files[0]) this._setFile(input.files[0], dz, thumbId, stateKey);
    });
  },

  _setFile(file, dz, thumbId, stateKey) {
    if (!file.type.startsWith("image/")) {
      Toast.show("File harus berupa gambar (JPG/PNG).", "error");
      return;
    }
    this.state[stateKey] = file;
    dz.classList.remove("is-invalid");

    const thumbRow = document.getElementById(thumbId);
    const url = URL.createObjectURL(file);
    thumbRow.innerHTML = `
      <div class="thumb">
        <img src="${url}" alt="preview" />
        <button type="button" class="thumb__remove" aria-label="Hapus foto">&times;</button>
      </div>
    `;
    thumbRow.querySelector(".thumb__remove").addEventListener("click", (e) => {
      e.stopPropagation();
      this.state[stateKey] = null;
      thumbRow.innerHTML = "";
    });
  },

  reset() {
    this.state.fotoSerahTerima = null;
    this.state.fotoDokumentasi = null;
    ["thumbSerahTerima", "thumbDokumentasi"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
  },
};

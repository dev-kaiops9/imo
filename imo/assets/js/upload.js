/**
 * upload.js
 * -----------------------------------------------------------------------
 * Mengelola dua dropzone foto (Serah Terima & Dokumentasi Kegiatan):
 * klik untuk pilih file, drag & drop, preview thumbnail, dan simpan
 * hasilnya sebagai base64 supaya siap dipakai oleh pdf.js / preview.js /
 * api.js (foto ditempel langsung di dalam PDF, tidak diunggah terpisah).
 * -----------------------------------------------------------------------
 */

const UploadField = {
  // Menyimpan state 2 foto: { file, dataUrl, base64, mimeType, fileName }
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
    const thumbWrap = document.getElementById(thumbId);
    if (!dz || !input || !thumbWrap) return;

    const openPicker = () => input.click();
    dz.addEventListener("click", openPicker);
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });

    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this._handleFile(file, stateKey, thumbWrap, dz);
    });

    ["dragenter", "dragover"].forEach((evt) => {
      dz.addEventListener(evt, (e) => {
        e.preventDefault();
        dz.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((evt) => {
      dz.addEventListener(evt, (e) => {
        e.preventDefault();
        dz.classList.remove("is-dragover");
      });
    });
    dz.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files[0];
      if (file) this._handleFile(file, stateKey, thumbWrap, dz);
    });
  },

  async _handleFile(file, stateKey, thumbWrap, dz) {
    if (!file.type.startsWith("image/")) {
      Toast.show("File yang dipilih bukan gambar.", "error");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      Toast.show("Ukuran foto maksimal 8MB.", "error");
      return;
    }

    const dataUrl = await this._readAsDataURL(file);
    this.state[stateKey] = {
      file,
      dataUrl,
      base64: dataUrl.split(",")[1],
      mimeType: file.type,
      fileName: file.name,
    };

    dz.classList.remove("is-invalid");
    thumbWrap.innerHTML = `
      <div class="thumb">
        <img src="${dataUrl}" alt="${file.name}" />
        <button type="button" class="thumb__remove" aria-label="Hapus foto">✕</button>
      </div>`;

    thumbWrap.querySelector(".thumb__remove").addEventListener("click", (e) => {
      e.stopPropagation();
      this.state[stateKey] = null;
      thumbWrap.innerHTML = "";
    });
  },

  _readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  reset() {
    this.state.fotoSerahTerima = null;
    this.state.fotoDokumentasi = null;
    const a = document.getElementById("thumbSerahTerima");
    const b = document.getElementById("thumbDokumentasi");
    if (a) a.innerHTML = "";
    if (b) b.innerHTML = "";
  },
};

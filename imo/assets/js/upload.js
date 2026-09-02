/**
 * upload.js
 * -----------------------------------------------------------------------
 * Mengelola dua dropzone foto (Serah Terima & Dokumentasi Kegiatan):
 * klik untuk pilih file, drag & drop, preview thumbnail, dan simpan
 * hasilnya sebagai base64 supaya siap dipakai oleh pdf.js / preview.js /
 * api.js (foto ditempel langsung di dalam PDF, tidak diunggah terpisah).
 *
 * Kolom "Foto Serah Terima" khusus juga menerima berkas PDF 2 halaman
 * (mis. hasil scan berita acara). PDF tersebut otomatis dikonversi di
 * dalam browser (pdf.js) menjadi satu lembar JPG A4 beresolusi 450 DPI —
 * logika render/crop/susun-ke-A4 sama persis dengan menu "PDF to A4",
 * dipadatkan di sini (lihat PdfToJpgConverter) supaya hasilnya konsisten
 * dan prosesnya cepat karena deteksi tepi konten memakai kanvas kecil.
 * -----------------------------------------------------------------------
 */

// DPI target konversi PDF -> JPG untuk kolom Foto Serah Terima.
const PDF_SERAH_TERIMA_DPI = 450;

if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

/**
 * PdfToJpgConverter
 * -----------------------------------------------------------------------
 * Versi ringkas dari logika di pdf-to-a4/assets/js/app.js: menerima PDF
 * TEPAT 2 halaman, merender tiap halaman ke kanvas, memangkas spasi
 * kosong di sekitar konten, menyusun keduanya bertumpuk di satu lembar
 * A4, lalu mengekspornya sebagai JPG pada DPI yang diminta.
 * -----------------------------------------------------------------------
 */
const PdfToJpgConverter = {
  async convert(file, dpi) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    if (pdf.numPages !== 2) {
      throw new Error(
        `PDF ini punya ${pdf.numPages} halaman. Kolom ini butuh PDF tepat 2 halaman.`
      );
    }

    const scale = dpi / 72;
    const page1 = await pdf.getPage(1);
    const canvas1 = await this._renderPage(page1, scale);
    const page2 = await pdf.getPage(2);
    const canvas2 = await this._renderPage(page2, scale);

    const trimmed1 = this._cropCanvas(canvas1, this._detectContentBounds(canvas1));
    const trimmed2 = this._cropCanvas(canvas2, this._detectContentBounds(canvas2));

    const finalCanvas = this._composeOntoA4(trimmed1, trimmed2, dpi);

    const blob = await new Promise((resolve) =>
      finalCanvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) throw new Error("Gagal membuat berkas JPG dari PDF.");
    return blob;
  },

  async _renderPage(page, scale) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  },

  _detectContentBounds(canvas) {
    const maxDim = 800;
    const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    const tmp = document.createElement("canvas");
    tmp.width = Math.max(1, Math.round(canvas.width * scale));
    tmp.height = Math.max(1, Math.round(canvas.height * scale));
    const tctx = tmp.getContext("2d");
    tctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
    const data = tctx.getImageData(0, 0, tmp.width, tmp.height).data;

    const threshold = 248;
    let minX = tmp.width, minY = tmp.height, maxX = -1, maxY = -1;
    for (let y = 0; y < tmp.height; y++) {
      for (let x = 0; x < tmp.width; x++) {
        const idx = (y * tmp.width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a > 10 && (r < threshold || g < threshold || b < threshold)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return { x: 0, y: 0, width: canvas.width, height: canvas.height };
    }

    const invScale = 1 / scale;
    let x = Math.floor(minX * invScale);
    let y = Math.floor(minY * invScale);
    let w = Math.ceil((maxX - minX + 1) * invScale);
    let h = Math.ceil((maxY - minY + 1) * invScale);

    const padX = Math.round(canvas.width * 0.012);
    const padY = Math.round(canvas.height * 0.012);
    x = Math.max(0, x - padX);
    y = Math.max(0, y - padY);
    w = Math.min(canvas.width - x, w + padX * 2);
    h = Math.min(canvas.height - y, h + padY * 2);

    return { x, y, width: w, height: h };
  },

  _cropCanvas(canvas, bounds) {
    const c = document.createElement("canvas");
    c.width = bounds.width;
    c.height = bounds.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(
      canvas,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, bounds.width, bounds.height
    );
    return c;
  },

  _composeOntoA4(canvas1, canvas2, dpi) {
    const stackWidth = Math.max(canvas1.width, canvas2.width);
    const dividerGap = Math.round(dpi * 0.04);
    const stackHeight = canvas1.height + canvas2.height + dividerGap;

    const stack = document.createElement("canvas");
    stack.width = stackWidth;
    stack.height = stackHeight;
    const sctx = stack.getContext("2d");
    sctx.fillStyle = "#FFFFFF";
    sctx.fillRect(0, 0, stackWidth, stackHeight);
    sctx.drawImage(canvas1, (stackWidth - canvas1.width) / 2, 0);
    sctx.drawImage(canvas2, (stackWidth - canvas2.width) / 2, canvas1.height + dividerGap);

    const A4_MM = { w: 210, h: 297 };
    const isPortrait = stackHeight >= stackWidth;
    const a4wmm = isPortrait ? A4_MM.w : A4_MM.h;
    const a4hmm = isPortrait ? A4_MM.h : A4_MM.w;
    const a4w = Math.round((a4wmm / 25.4) * dpi);
    const a4h = Math.round((a4hmm / 25.4) * dpi);

    const fitScale = Math.min(a4w / stackWidth, a4h / stackHeight);
    const drawW = stackWidth * fitScale;
    const drawH = stackHeight * fitScale;
    const offsetX = (a4w - drawW) / 2;
    const offsetY = (a4h - drawH) / 2;

    const final = document.createElement("canvas");
    final.width = a4w;
    final.height = a4h;
    const fctx = final.getContext("2d");
    fctx.fillStyle = "#FFFFFF";
    fctx.fillRect(0, 0, a4w, a4h);
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(stack, 0, 0, stackWidth, stackHeight, offsetX, offsetY, drawW, drawH);

    return final;
  },
};

const UploadField = {
  // Menyimpan state 2 foto: { file, dataUrl, base64, mimeType, fileName }
  state: {
    fotoSerahTerima: null,
    fotoDokumentasi: null,
  },

  init() {
    // Hanya kolom "Foto Serah Terima" yang boleh menerima PDF 2 halaman
    // (otomatis dikonversi jadi JPG 450 DPI). Kolom "Dokumentasi Kegiatan"
    // tetap gambar saja.
    this._wire("dzSerahTerima", "fileSerahTerima", "thumbSerahTerima", "fotoSerahTerima", { allowPdf: true });
    this._wire("dzDokumentasi", "fileDokumentasi", "thumbDokumentasi", "fotoDokumentasi", { allowPdf: false });
  },

  _wire(dzId, inputId, thumbId, stateKey, opts = {}) {
    const dz = document.getElementById(dzId);
    const input = document.getElementById(inputId);
    const thumbWrap = document.getElementById(thumbId);
    if (!dz || !input || !thumbWrap) return;

    const allowPdf = !!opts.allowPdf;

    const openPicker = () => input.click();
    dz.addEventListener("click", openPicker);
    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
    });

    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this._handleFile(file, stateKey, thumbWrap, dz, allowPdf);
      input.value = "";
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
      if (file) this._handleFile(file, stateKey, thumbWrap, dz, allowPdf);
    });
  },

  async _handleFile(file, stateKey, thumbWrap, dz, allowPdf) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);

    if (isPdf && !allowPdf) {
      Toast.show("File yang dipilih bukan gambar.", "error");
      return;
    }

    if (isPdf) {
      await this._handlePdfFile(file, stateKey, thumbWrap, dz);
      return;
    }

    if (!file.type.startsWith("image/")) {
      Toast.show("File yang dipilih bukan gambar atau PDF.", "error");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      Toast.show("Ukuran foto maksimal 8MB.", "error");
      return;
    }

    const dataUrl = await this._readAsDataURL(file);
    this._setPhotoState(stateKey, thumbWrap, dz, {
      dataUrl,
      base64: dataUrl.split(",")[1],
      mimeType: file.type,
      fileName: file.name,
    });
  },

  /**
   * Alur khusus saat file yang diunggah ke kolom "Foto Serah Terima"
   * berupa PDF: validasi ukuran & jumlah halaman, tampilkan status
   * "mengonversi" di dropzone, lalu proses lewat PdfToJpgConverter.
   * Hasil JPG-nya disimpan ke state persis seperti foto biasa, sehingga
   * pdf.js / preview.js / api.js tidak perlu tahu asalnya dari PDF.
   */
  async _handlePdfFile(file, stateKey, thumbWrap, dz) {
    if (typeof pdfjsLib === "undefined") {
      Toast.show("Gagal memuat pustaka pembaca PDF. Coba muat ulang halaman.", "error");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      Toast.show("Ukuran PDF maksimal 15MB.", "error");
      return;
    }

    const originalHtml = dz.innerHTML;
    dz.classList.add("is-loading");
    dz.innerHTML = `
      <div class="dropzone__spinner"></div>
      <div class="dropzone__text">Mengonversi PDF ke JPG (${PDF_SERAH_TERIMA_DPI} DPI)…</div>
      <div class="dropzone__hint">Mohon tunggu sebentar</div>`;

    try {
      const jpgBlob = await PdfToJpgConverter.convert(file, PDF_SERAH_TERIMA_DPI);
      const dataUrl = await this._readAsDataURL(jpgBlob);
      const fileName = file.name.replace(/\.pdf$/i, "") + `-${PDF_SERAH_TERIMA_DPI}dpi.jpg`;

      this._setPhotoState(stateKey, thumbWrap, dz, {
        dataUrl,
        base64: dataUrl.split(",")[1],
        mimeType: "image/jpeg",
        fileName,
      });

      Toast.show("PDF berhasil dikonversi ke JPG 450 DPI.", "success");
    } catch (err) {
      console.error(err);
      Toast.show(err && err.message ? err.message : "Gagal mengonversi PDF.", "error");
    } finally {
      // Selesai (berhasil ataupun gagal): kembalikan tampilan dropzone ke
      // semula. Thumbnail hasil konversi (bila berhasil) tampil terpisah
      // di thumbWrap lewat _setPhotoState, jadi dropzone-nya sendiri tidak
      // perlu terus menampilkan status "mengonversi".
      dz.classList.remove("is-loading");
      dz.innerHTML = originalHtml;
    }
  },

  _setPhotoState(stateKey, thumbWrap, dz, { dataUrl, base64, mimeType, fileName }) {
    this.state[stateKey] = { dataUrl, base64, mimeType, fileName };

    dz.classList.remove("is-invalid");
    thumbWrap.innerHTML = `
      <div class="thumb">
        <img src="${dataUrl}" alt="${fileName}" />
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

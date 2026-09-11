/**
 * pdf.js
 * -----------------------------------------------------------------------
 * Membuat dokumen PDF di browser (jsPDF) berisi MURNI tabel serah terima
 * (tanpa judul/keterangan tambahan di atas maupun di bawah tabel), persis
 * seperti struktur kolom yang didefinisikan di CONFIG.getTableColumns()
 * — kolom & posisi yang sama persis dipakai juga oleh preview.js supaya
 * preview dan hasil PDF selalu identik.
 *
 * Dipanggil sebagai Pdf.build(data) dari main.js — foto diambil langsung
 * dari UploadField.state (sudah berisi dataUrl/base64 hasil upload.js).
 *
 * DIUBAH — sel Awal Dinas / Akhir Dinas / Serah Terima yang sumbernya PDF
 * (UploadField.state.*.isVector === true) TIDAK LAGI dirender sebagai
 * gambar JPG. Proses build() sekarang 2 tahap:
 *   1. Tabel + teks + foto-foto RASTER (Dokumentasi Kegiatan, atau
 *      Awal/Akhir/Serah Terima yang memang diunggah sebagai foto biasa,
 *      bukan PDF) digambar seperti biasa lewat jsPDF — sel milik foto
 *      VEKTOR sengaja dikosongkan dulu.
 *   2. Dokumen jsPDF itu dimuat ulang lewat pdf-lib, lalu untuk tiap sel
 *      vektor: PDF sumbernya (2 halaman) ditempel LANGSUNG sebagai objek
 *      vektor (pdfDoc.embedPage + page.drawPage) ke koordinat sel yang
 *      sama, disusun bertumpuk (halaman 1 di atas, halaman 2 di bawah,
 *      persis seperti tampilan thumbnail-nya) — hasilnya tetap tajam
 *      sempurna di zoom berapa pun karena tidak pernah melalui rasterisasi.
 * Vektor tidak bisa "dikompres" seperti JPEG, jadi ukurannya (bytes PDF
 * sumber apa adanya) dikurangkan lebih dulu dari jatah ukuran harian
 * SEBELUM sisanya dibagi ke foto-foto raster (lihat totalBudget di build()).
 * Kalau PDF sumber suatu sel ternyata sangat besar sampai tidak lagi
 * menyisakan jatah wajar untuk Dokumentasi Kegiatan, sel itu FALLBACK ke
 * cara lama (dirender jadi gambar terkompresi) khusus untuk hari itu,
 * dengan peringatan lewat Toast — lihat _resolvePhotoSlots().
 * -----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// Budget ukuran PDF harian — supaya "Unduh IMO" bulanan (menggabungkan
// s.d. ±31 file harian + Cover/SmartCard/Daftar Hadir) tidak pernah
// mendekati batas blob keras Apps Script (50MB).
//
// DIUBAH — target dinaikkan dari 1MB ke 1,5MB/hari (permintaan: hasil foto
// serah terima harus lebih tajam saat di-zoom). Perhitungan margin bulanan:
// 1,5MB × 31 hari ≈ 46,5MB, masih di bawah 50MB — sisa ±3,5MB untuk halaman
// Cover/SmartCard/Daftar Hadir (masing-masing dikompres terpisah di
// bulanan.js, biasanya jauh di bawah itu) + overhead base64. Kalau ke
// depan overhead bulanan mulai mepet (mis. banyak baris "Lainnya" dengan
// teks panjang, atau SmartCard/Daftar Hadir foto besar), turunkan lagi
// angka ini secukupnya.
// Batas keras dijaga lewat reserve overhead tabel/teks di bawah target,
// BUKAN dengan upscale kualitas balik kalau kelewat (JPEG tidak bisa
// "kurang dari 0" — pada kualitas & DPI terendah di tangga di bawah, foto
// asli manapun praktis sudah jauh di bawah budget ini).
const PDF_HARIAN_TARGET_BYTES = 1500 * 1024; // ~1,5MB — target yang DIKEJAR
const PDF_HARIAN_HARD_CAP_BYTES = Math.round(1.65 * 1024 * 1024); // ~1,65MB (rasio sama seperti sebelumnya: 1,1x target) — ambang peringatan
const PDF_OVERHEAD_RESERVE_BYTES = 40 * 1024; // cadangan vektor tabel/teks jsPDF (kecil, tapi disisihkan)
// DIUBAH — tangga DPI ditambah 350 di puncak (dicoba dari yang PALING
// TINGGI dulu, paling tajam) supaya dengan budget yang lebih besar sekarang
// foto bisa bertahan di resolusi lebih tinggi sebelum turun tangga; turun
// hanya kalau kualitas terendah di tangga itu MASIH kelewat jatah. _compressForBudget
// TIDAK PERNAH upscale, jadi 350 hanya kepakai kalau foto sumbernya memang
// beresolusi cukup (foto kamera & hasil convert PDF 450 DPI biasanya cukup).
const FOTO_DPI_CANDIDATES = [350, 300, 250, 200, 150];
const FOTO_QUALITY_MIN = 0.4;
const FOTO_QUALITY_MAX = 0.95; // dinaikkan dari 0,92 — budget lebih besar, kualitas puncak boleh lebih tinggi
const FOTO_QUALITY_BINARY_STEPS = 6; // ~0,008 resolusi kualitas — cukup halus
const CELL_PHOTO_PAD_MM = 4; // jarak foto ke tepi sel, dipakai di beberapa tempat (lihat _placeImageInCellBudgeted & _drawCompressedImage)

// ---- Konstanta khusus penempelan PDF sumber sebagai vektor ----
const MM_TO_PT = 72 / 25.4;
// Jarak antar 2 halaman PDF sumber saat ditumpuk dalam 1 sel (setara
// dividerGap di PdfToJpgConverter.upload.js: dpi*0.04 px @ dpi px/inch
// = 0,04 inci = 0,04*72 pt).
const VECTOR_STACK_GAP_PT = 0.04 * 72;
// Jatah minimum yang tetap disisihkan untuk Dokumentasi Kegiatan (raster)
// sebelum sebuah sel vektor dianggap "terlalu besar" dan di-fallback jadi
// gambar terkompresi khusus untuk hari itu (lihat _resolvePhotoSlots()).
const MIN_RASTER_RESERVE_BYTES = 150 * 1024;

const Pdf = {
  /**
   * @param {object} data hasil Form.collect()
   * @returns {Promise<{blob: Blob, base64: string, fileName: string}>}
   */
  async build(data) {
    const photos = UploadField.state;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 12;
    const marginY = 8; // tidak ada header/footer halaman lain, jadi tabel boleh
                       // mepet ke atas & bawah — cuma sisakan margin cetak tipis.
    const tableW = pageW - marginX * 2;
    const rowHeaderH = 12;
    const rowBodyH = pageH - marginY * 2 - rowHeaderH;
    const tableTop = marginY;

    // ---- Struktur kolom (sumber tunggal: CONFIG, sama dengan preview) ----
    // targetKey hanya berarti untuk "Stasiun Buka" (1 foto -> kolom
    // "gabung"). "Stasiun Tutup" ditangani khusus di bawah (2 foto: awal
    // & akhir sekaligus) — lihat isTutup.
    const isTutup = data.jenisSerahTerima === CONFIG.JENIS_TUTUP;
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const columns = CONFIG.getTableColumns(data.mapping.tabel);
    let x = marginX;
    columns.forEach((c) => {
      c.x = x;
      c.width = tableW * c.w;
      x += c.width;
    });

    // ---- Header tabel ----
    doc.setDrawColor(20, 30, 50);
    doc.setLineWidth(0.3);
    doc.setFillColor(243, 245, 248);
    doc.rect(marginX, tableTop, tableW, rowHeaderH, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    columns.forEach((c) => {
      doc.rect(c.x, tableTop, c.width, rowHeaderH);
      doc.text(c.label, c.x + c.width / 2, tableTop + rowHeaderH / 2 + 1.2, {
        align: "center",
        maxWidth: c.width - 4,
      });
    });

    // ---- Baris body ----
    const bodyTop = tableTop + rowHeaderH;
    columns.forEach((c) => doc.rect(c.x, bodyTop, c.width, rowBodyH));

    const isLibur = data.dinas === CONFIG.DINAS_KHUSUS.LIBUR;
    const LIBUR_COLOR = [239, 68, 68]; // sama dengan --signal-red (#ef4444)

    const tanggalLabel = this._formatTanggalPanjang(data.tanggal);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    columns.forEach((c) => {
      if (c.key === "hari") {
        this._drawCenteredText(doc, tanggalLabel, c, bodyTop, rowBodyH);
      }
      if (c.key === "kegiatan") {
        if (isLibur) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(...LIBUR_COLOR);
        }
        this._drawCenteredText(doc, data.kegiatan || "", c, bodyTop, rowBodyH);
        if (isLibur) {
          doc.setFont("helvetica", "normal");
          doc.setTextColor(0, 0, 0);
        }
      }
    });

    // ---- Tempatkan foto sesuai mapping ----
    const targetCol = columns.find((c) => c.key === targetKey);
    const dokCol = columns.find((c) => c.key === "dok");

    let vectorOverlayTasks = [];

    if (isLibur) {
      // LIBUR: tidak ada foto sama sekali (Serah Terima Dinasan tetap
      // kosong) — kolom Dokumentasi Kegiatan diisi teks "LIBUR" bold merah.
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...LIBUR_COLOR);
      this._drawCenteredText(doc, "LIBUR", dokCol, bodyTop, rowBodyH);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
    } else {
      // ---- Kelompokkan sel yang aktif: kandidat VEKTOR (sumbernya PDF,
      // lihat photo.isVector dari upload.js) vs RASTER biasa. Dokumentasi
      // Kegiatan tidak pernah vektor (upload.js tidak mengizinkan PDF di
      // kolom itu) — selalu masuk kandidat raster.
      let vectorCandidates, rasterCandidates;
      if (isTutup) {
        // Stasiun Tutup: 2 foto serah terima sekaligus (Awal Dinas & Akhir
        // Dinas), masing-masing masuk kolomnya sendiri — TIDAK digabung
        // jadi satu kolom (lihat CONFIG.getTableColumns).
        const awalCol = columns.find((c) => c.key === "awal");
        const akhirCol = columns.find((c) => c.key === "akhir");
        const all = [
          { col: awalCol, photo: photos.fotoAwalDinas },
          { col: akhirCol, photo: photos.fotoAkhirDinas },
          { col: dokCol, photo: photos.fotoDokumentasi },
        ].filter((s) => s.photo && s.col);
        vectorCandidates = all.filter((s) => s.photo.isVector);
        rasterCandidates = all.filter((s) => !s.photo.isVector);
      } else {
        // Stasiun Buka (& Lainnya, yang otomatis dikunci ke Stasiun Buka
        // dengan foto Serah Terima kosong/null -> kolom "gabung" kosong).
        const all = [
          { col: targetCol, photo: photos.fotoSerahTerima },
          { col: dokCol, photo: photos.fotoDokumentasi },
        ].filter((s) => s.photo && s.col);
        vectorCandidates = all.filter((s) => s.photo.isVector);
        rasterCandidates = all.filter((s) => !s.photo.isVector);
      }

      const totalBudget = PDF_HARIAN_TARGET_BYTES - PDF_OVERHEAD_RESERVE_BYTES;

      // ---- Vektor tidak bisa dikompres: siapkan sumbernya (bytes + kotak
      // batas konten tiap halaman), lalu putuskan mana yang benar-benar
      // ditempel sebagai vektor vs mana yang harus FALLBACK jadi raster
      // (kalau ukurannya sampai tidak menyisakan jatah wajar untuk
      // Dokumentasi Kegiatan) — lihat _resolveVectorSlots().
      const { vectorSlots, fallbackToRaster } = await this._resolveVectorSlots(vectorCandidates, totalBudget);
      const rasterSlots = [...rasterCandidates, ...fallbackToRaster];
      const vectorBytesUsed = vectorSlots.reduce((sum, s) => sum + s.source.bytes.length, 0);
      const rasterBudget = Math.max(1, totalBudget - vectorBytesUsed);

      // ---- Gambar foto RASTER (Dokumentasi Kegiatan + fallback bila ada)
      // — logika kompres/pembagian jatah SAMA seperti sebelumnya, hanya
      // sekarang jatahnya (rasterBudget) sudah dikurangi ukuran vektor.
      if (rasterSlots.length) {
        const croppedRasterSlots = await Promise.all(
          rasterSlots.map(async (s) => ({ col: s.col, photo: await this._withCroppedDataUrl(s.photo) }))
        );
        const slotDims = croppedRasterSlots.map((s) => ({
          ...s,
          maxW: s.col.width - CELL_PHOTO_PAD_MM * 2,
          maxH: rowBodyH - CELL_PHOTO_PAD_MM * 2,
        }));
        const idealResults = await Promise.all(
          slotDims.map((s) => this._estimateIdealBytes(s.photo.dataUrl, s.photo.mimeType, s.maxW, s.maxH))
        );
        const idealTotal = idealResults.reduce((sum, r) => sum + r.bytes, 0);

        if (idealTotal > 0 && idealTotal <= rasterBudget) {
          slotDims.forEach((s, i) => {
            this._drawCompressedImage(doc, idealResults[i], s.col, bodyTop, s.maxW, s.maxH);
          });
        } else {
          for (let i = 0; i < slotDims.length; i++) {
            const s = slotDims[i];
            const share = idealTotal > 0 ? idealResults[i].bytes / idealTotal : 1 / slotDims.length;
            const budgetBytes = Math.max(1, Math.round(rasterBudget * share));
            await this._placeImageInCellBudgeted(doc, s.photo, s.col, bodyTop, rowBodyH, budgetBytes);
          }
        }
      }

      // ---- Sel VEKTOR sengaja TIDAK digambar ke jsPDF sama sekali —
      // dicatat dulu (rect sel + sumbernya), ditempel setelah dokumen
      // jsPDF selesai dibangun lewat pdf-lib (lihat tahap 2 di bawah).
      vectorOverlayTasks = vectorSlots.map((s) => ({ col: s.col, source: s.source, bodyTop, rowBodyH }));
    }

    // BARU — nama file bercabang sesuai mode (lihat Form.mode/collect()).
    // Mode Kedudukan (data.mode !== MODE_WAKILAN, termasuk semua pemanggil
    // lama yang belum mengirim field "mode") tetap memakai buildPdfFileName()
    // yang sama persis seperti sebelumnya.
    const fileName = data.mode === CONFIG.MODE_WAKILAN
      ? CONFIG.buildPdfFileNameWakilan(data.tanggal, data.wakilan, data.stasiunTempatWakilan, data.dinas)
      : CONFIG.buildPdfFileName(data.tanggal, data.dinas);

    // ---- Tahap 2: tempel sel VEKTOR (kalau ada) lewat pdf-lib. Dokumen
    // jsPDF yang sudah jadi (tabel + teks + foto raster) dimuat ulang
    // sebagai PDFDocument, lalu tiap PDF sumber ditempel LANGSUNG sebagai
    // objek vektor ke koordinat selnya masing-masing — tidak ada
    // rasterisasi/kompresi JPEG yang menyentuh konten ini sama sekali.
    let finalBytes;
    if (vectorOverlayTasks.length) {
      const jsPdfBytes = doc.output("arraybuffer");
      const { PDFDocument } = PDFLib;
      const finalDoc = await PDFDocument.load(jsPdfBytes);
      const finalPage = finalDoc.getPages()[0];
      const pageHeightPt = finalPage.getHeight();
      for (const task of vectorOverlayTasks) {
        await this._embedVectorCell(finalDoc, finalPage, pageHeightPt, task);
      }
      finalBytes = await finalDoc.save();
    } else {
      finalBytes = doc.output("arraybuffer");
    }

    const blob = new Blob([finalBytes], { type: "application/pdf" });
    const base64 = this._arrayBufferToBase64(finalBytes);

    // Pagar pengaman terakhir: kalau ternyata TETAP kelewat batas keras
    // (kasus langka — foto sangat kompleks/detail di kedua sel sekaligus),
    // beri tahu lewat konsol & toast supaya kelihatan, tapi tidak
    // menggagalkan penyimpanan (ukurannya biasanya cuma sedikit di atas).
    if (blob.size > PDF_HARIAN_HARD_CAP_BYTES) {
      console.warn(
        `PDF harian ${fileName} berukuran ${(blob.size / 1024 / 1024).toFixed(2)}MB, ` +
          `melebihi batas ${(PDF_HARIAN_HARD_CAP_BYTES / 1024 / 1024).toFixed(1)}MB.`
      );
      if (typeof Toast !== "undefined") {
        Toast.show(
          `PDF harian ini ${(blob.size / 1024 / 1024).toFixed(2)}MB, sedikit di atas target ${(PDF_HARIAN_HARD_CAP_BYTES / 1024 / 1024).toFixed(2)}MB (foto kemungkinan sangat detail).`,
          "warn"
        );
      }
    }

    return { blob, base64, fileName };
  },

  /**
   * Menulis teks di tengah sel (horizontal & vertikal), memecah ke beberapa
   * baris otomatis kalau tidak muat dalam lebar kolom.
   */
  _drawCenteredText(doc, text, col, bodyTop, rowBodyH) {
    const maxWidth = col.width - 4;
    const lines = doc.splitTextToSize(text || "", maxWidth);
    const fontSize = doc.getFontSize(); // pt
    const lineHeight = (fontSize / doc.internal.scaleFactor) * 1.15; // mm, per baris
    const totalHeight = lines.length * lineHeight;
    const startY = bodyTop + rowBodyH / 2 - totalHeight / 2 + lineHeight * 0.8;

    lines.forEach((line, i) => {
      doc.text(line, col.x + col.width / 2, startY + i * lineHeight, {
        align: "center",
      });
    });
  },

  /**
   * Mengembalikan salinan objek foto dengan dataUrl yang sudah di-crop
   * (ruang putih/kosong di tepi dibuang). Aman dipanggil untuk foto apapun.
   */
  async _withCroppedDataUrl(photo) {
    if (!photo) return photo;
    const cropped = await this._cropWhitespace(photo.dataUrl, photo.mimeType);
    return { ...photo, dataUrl: cropped };
  },

  _cropWhitespace(dataUrl, mimeType) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const SCAN_MAX = 500;
          const scale = Math.min(1, SCAN_MAX / Math.max(img.width, img.height));
          const sw = Math.max(1, Math.round(img.width * scale));
          const sh = Math.max(1, Math.round(img.height * scale));

          const scanCanvas = document.createElement("canvas");
          scanCanvas.width = sw;
          scanCanvas.height = sh;
          const sctx = scanCanvas.getContext("2d");
          if (!sctx) throw new Error("Canvas 2D context tidak tersedia (scan)");
          sctx.drawImage(img, 0, 0, sw, sh);
          const { data } = sctx.getImageData(0, 0, sw, sh);

          const WHITE_THRESHOLD = 238;
          let minX = sw, minY = sh, maxX = -1, maxY = -1;

          for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
              const i = (y * sw + x) * 4;
              const r = data[i], g = data[i + 1], b = data[i + 2];
              if (r < WHITE_THRESHOLD || g < WHITE_THRESHOLD || b < WHITE_THRESHOLD) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (maxX < 0 || maxY < 0) {
            resolve(dataUrl);
            return;
          }

          const padX = Math.round(sw * 0.01);
          const padY = Math.round(sh * 0.01);
          minX = Math.max(0, minX - padX);
          minY = Math.max(0, minY - padY);
          maxX = Math.min(sw - 1, maxX + padX);
          maxY = Math.min(sh - 1, maxY + padY);

          const coverage = ((maxX - minX) * (maxY - minY)) / (sw * sh);
          if (coverage > 0.97) {
            resolve(dataUrl);
            return;
          }

          const fx = img.width / sw;
          const fy = img.height / sh;
          let cropX = Math.round(minX * fx);
          let cropY = Math.round(minY * fy);
          let cropW = Math.round((maxX - minX) * fx);
          let cropH = Math.round((maxY - minY) * fy);

          const OUTPUT_MAX_DIM = 3000;
          const outScale = Math.min(1, OUTPUT_MAX_DIM / Math.max(cropW, cropH));
          const outW = Math.max(1, Math.round(cropW * outScale));
          const outH = Math.max(1, Math.round(cropH * outScale));

          const outCanvas = document.createElement("canvas");
          outCanvas.width = outW;
          outCanvas.height = outH;
          const octx = outCanvas.getContext("2d");
          if (!octx) throw new Error("Canvas 2D context tidak tersedia (output)");
          octx.fillStyle = "#FFFFFF";
          octx.fillRect(0, 0, outW, outH);
          octx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

          const outType = mimeType && mimeType.includes("png") ? "image/png" : "image/jpeg";
          const outUrl = outCanvas.toDataURL(outType, 0.95);

          if (!outUrl || outUrl === "data:," || outUrl.length < 50) {
            resolve(dataUrl);
            return;
          }

          resolve(outUrl);
        } catch (e) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  async _placeImageInCellBudgeted(doc, photo, col, bodyTop, rowBodyH, budgetBytes) {
    if (!photo || !col) return;
    const maxW = col.width - CELL_PHOTO_PAD_MM * 2;
    const maxH = rowBodyH - CELL_PHOTO_PAD_MM * 2;

    // Foto dicari DPI & kualitas JPEG SETINGGI mungkin yang masih muat
    // jatah (budgetBytes) milik sel ini — lihat _compressForBudget di
    // bawah. Ukuran fisik (maxW x maxH mm) tempat foto digambar di
    // halaman TIDAK berubah; yang disesuaikan hanya resolusi piksel &
    // kualitas kompresi datanya, supaya PDF harian gabungan tetap masuk
    // jatah ~1,5MB (batas keras ~1,65MB) tanpa foto terlihat pecah/kotak.
    const result = await this._compressForBudget(photo.dataUrl, photo.mimeType, maxW, maxH, budgetBytes);
    this._drawCompressedImage(doc, result, col, bodyTop, maxW, maxH);
  },

  /**
   * BARU — bagian "gambar ke halaman" dipisah dari `_placeImageInCellBudgeted`
   * supaya bisa dipakai ulang oleh jalur "ideal" di build() (kasus jatah
   * harian belum termaksimalkan, hasil _estimateIdealBytes langsung dipakai
   * tanpa kompres ulang lewat _compressForBudget).
   */
  _drawCompressedImage(doc, result, col, bodyTop, maxW, maxH) {
    const pad = CELL_PHOTO_PAD_MM;
    try {
      const props = doc.getImageProperties(result.dataUrl);
      const ratio = Math.min(maxW / props.width, maxH / props.height);
      const drawW = props.width * ratio;
      const drawH = props.height * ratio;
      const drawX = col.x + pad + (maxW - drawW) / 2;
      const drawY = bodyTop + pad + (maxH - drawH) / 2;

      doc.addImage(result.dataUrl, result.format, drawX, drawY, drawW, drawH, undefined, "NONE");
    } catch (e) {
      doc.setFontSize(8);
      doc.text("(gambar tidak dapat ditampilkan)", col.x + pad, bodyTop + pad + 6);
    }
  },

  /** Perkiraan ukuran byte sebuah data URL base64 (tanpa perlu fetch/blob). */
  _dataUrlBytes(dataUrl) {
    const idx = dataUrl.indexOf(",");
    const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
    const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.round((b64.length * 3) / 4) - padding);
  },

  /**
   * BARU — perkiraan ukuran byte "ideal" 1 foto: dirender SEKALI di DPI &
   * kualitas JPEG TERTINGGI yang tersedia (tangga teratas FOTO_DPI_CANDIDATES
   * + FOTO_QUALITY_MAX), TANPA batas jatah byte sama sekali. Dipakai HANYA
   * untuk mengetahui seberapa besar "kebutuhan" foto ini secara wajar, supaya
   * pembagian jatah harian ke beberapa foto sekaligus (lihat build()) bisa
   * proporsional ke kebutuhan nyata tiap foto — bukan cuma lebar kolom
   * tabelnya seperti sebelumnya. TIDAK PERNAH upscale (sama seperti
   * _compressForBudget). Kalau render gagal (kasus sangat langka), anggap
   * kebutuhannya = ukuran data URL asli apa adanya, biar tetap ikut
   * pembagian jatah secara wajar (tidak sampai bikin proses gagal total).
   */
  _estimateIdealBytes(dataUrl, mimeType, targetWmm, targetHmm) {
    const fallback = () => ({
      dataUrl,
      format: mimeType && mimeType.includes("png") ? "PNG" : "JPEG",
      bytes: this._dataUrlBytes(dataUrl),
    });
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const isPng = !!(mimeType && mimeType.includes("png"));
          const dpi = FOTO_DPI_CANDIDATES[0]; // tangga tertinggi
          const maxWpx = Math.max(1, Math.round((targetWmm / 25.4) * dpi));
          const maxHpx = Math.max(1, Math.round((targetHmm / 25.4) * dpi));
          const scale = Math.min(1, maxWpx / img.width, maxHpx / img.height); // jangan upscale
          const outW = Math.max(1, Math.round(img.width * scale));
          const outH = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D context tidak tersedia.");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, outW, outH);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, outW, outH);

          const outType = isPng ? "image/png" : "image/jpeg";
          const url = isPng ? canvas.toDataURL(outType) : canvas.toDataURL(outType, FOTO_QUALITY_MAX);
          if (!url || url === "data:,") throw new Error("Gagal render.");

          resolve({ dataUrl: url, format: isPng ? "PNG" : "JPEG", bytes: this._dataUrlBytes(url) });
        } catch (e) {
          resolve(fallback());
        }
      };
      img.onerror = () => resolve(fallback());
      img.src = dataUrl;
    });
  },

  /**
   * Downscale (TIDAK PERNAH upscale) sebuah foto ke resolusi piksel yang
   * sepadan dengan ukuran cetak targetnya, mencoba tangga DPI dari yang
   * PALING TINGGI (FOTO_DPI_CANDIDATES) dan mencari — via binary search —
   * kualitas JPEG SETINGGI mungkin yang hasil filenya masih muat
   * budgetBytes. Kalau di DPI tertinggi bahkan kualitas terendah masih
   * kelewat jatah, turun ke DPI berikutnya (gambar direnderulang lebih
   * kecil) dan dicoba lagi. Ini pola yang sama dipakai fitur migrasi
   * "Kompres PDF Lama" sebelumnya, sekarang dijalankan langsung saat
   * PDF harian dibuat sehingga ukurannya terjamin sejak awal.
   *
   * @returns {Promise<{dataUrl: string, format: "JPEG"|"PNG", bytes: number}>}
   */
  _compressForBudget(dataUrl, mimeType, targetWmm, targetHmm, budgetBytes) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const isPng = mimeType && mimeType.includes("png");

          // Kalau sudah muat jatah APA ADANYA (jarang, biasanya foto asli
          // memang kecil), tidak usah diproses ulang sama sekali.
          const originalBytes = this._dataUrlBytes(dataUrl);
          if (originalBytes <= budgetBytes) {
            resolve({ dataUrl, format: isPng ? "PNG" : "JPEG", bytes: originalBytes });
            return;
          }

          let best = null; // { dataUrl, bytes } hasil TERBAIK yang ditemukan sejauh ini

          for (const dpi of FOTO_DPI_CANDIDATES) {
            const maxWpx = Math.max(1, Math.round((targetWmm / 25.4) * dpi));
            const maxHpx = Math.max(1, Math.round((targetHmm / 25.4) * dpi));
            const scale = Math.min(1, maxWpx / img.width, maxHpx / img.height);
            const outW = Math.max(1, Math.round(img.width * scale));
            const outH = Math.max(1, Math.round(img.height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = outW;
            canvas.height = outH;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, outW, outH);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, outW, outH);

            // PNG tidak punya parameter "quality" yang mengecilkan ukuran
            // (lossless) — kalau PNG di DPI ini masih kelewat jatah, foto
            // dipaksa jadi JPEG (satu-satunya cara memenuhi budget tanpa
            // upscale/downscale ekstra) mulai dari kandidat DPI ini juga.
            const tryOne = (outType, quality) => {
              const url = canvas.toDataURL(outType, quality);
              return { url, bytes: this._dataUrlBytes(url) };
            };

            if (isPng) {
              const png = tryOne("image/png", undefined);
              if (png.bytes <= budgetBytes) {
                resolve({ dataUrl: png.url, format: "PNG", bytes: png.bytes });
                return;
              }
              if (!best || png.bytes < best.bytes) best = { dataUrl: png.url, format: "PNG", bytes: png.bytes };
              // lanjut coba sebagai JPEG di DPI yang sama sebelum turun DPI.
            }

            const atMax = tryOne("image/jpeg", FOTO_QUALITY_MAX);
            if (atMax.bytes <= budgetBytes) {
              resolve({ dataUrl: atMax.url, format: "JPEG", bytes: atMax.bytes });
              return;
            }
            if (!best || atMax.bytes < best.bytes) best = { dataUrl: atMax.url, format: "JPEG", bytes: atMax.bytes };

            const atMin = tryOne("image/jpeg", FOTO_QUALITY_MIN);
            if (atMin.bytes > budgetBytes) {
              // Bahkan kualitas terendah di DPI ini masih kelewat —
              // simpan sebagai kandidat cadangan, lalu turun ke DPI
              // berikutnya (lebih kecil) dan coba lagi dari awal.
              if (!best || atMin.bytes < best.bytes) best = { dataUrl: atMin.url, format: "JPEG", bytes: atMin.bytes };
              continue;
            }

            // Muat di suatu titik antara MIN dan MAX — binary search
            // kualitas untuk mencari titik SETINGGI mungkin yang masih pas.
            let lo = FOTO_QUALITY_MIN;
            let hi = FOTO_QUALITY_MAX;
            let found = atMin;
            for (let i = 0; i < FOTO_QUALITY_BINARY_STEPS; i++) {
              const mid = (lo + hi) / 2;
              const res = tryOne("image/jpeg", mid);
              if (res.bytes <= budgetBytes) {
                found = res;
                lo = mid;
              } else {
                hi = mid;
              }
            }
            resolve({ dataUrl: found.url, format: "JPEG", bytes: found.bytes });
            return;
          }

          // Tangga DPI habis dan TETAP kelewat jatah di semua level (kasus
          // sangat langka — foto ekstrem detail/tekstur padat). Pakai
          // hasil terkecil yang berhasil didapat sejauh ini sebagai upaya
          // terbaik, daripada gagal total.
          if (best) {
            resolve(best);
          } else {
            resolve({ dataUrl, format: isPng ? "PNG" : "JPEG", bytes: originalBytes });
          }
        } catch (e) {
          resolve({ dataUrl, format: mimeType && mimeType.includes("png") ? "PNG" : "JPEG", bytes: this._dataUrlBytes(dataUrl) });
        }
      };
      img.onerror = () => resolve({ dataUrl, format: mimeType && mimeType.includes("png") ? "PNG" : "JPEG", bytes: this._dataUrlBytes(dataUrl) });
      img.src = dataUrl;
    });
  },

  /**
   * Menentukan sel mana yang BENAR-BENAR ditempel sebagai vektor, dan mana
   * yang harus FALLBACK jadi raster (kompresi JPEG seperti biasa) — hanya
   * terjadi kalau total ukuran PDF sumber semua sel vektor sampai tidak
   * lagi menyisakan MIN_RASTER_RESERVE_BYTES untuk Dokumentasi Kegiatan.
   * Sel yang dikorbankan adalah yang PALING BESAR dulu, supaya sisa sel
   * vektor yang tetap tajam sebanyak mungkin. Kasus ini sangat jarang
   * terjadi (PDF hasil scan aplikasi resmi biasanya kecil).
   * @returns {Promise<{vectorSlots: Array, fallbackToRaster: Array}>}
   */
  async _resolveVectorSlots(vectorCandidates, totalBudget) {
    if (!vectorCandidates.length) return { vectorSlots: [], fallbackToRaster: [] };

    const withSource = await Promise.all(
      vectorCandidates.map(async (s) => ({ ...s, source: await this._prepareVectorSource(s.photo) }))
    );
    // Terbesar dulu (lihat komentar di atas).
    withSource.sort((a, b) => b.source.bytes.length - a.source.bytes.length);

    const vectorSlots = [];
    const fallbackToRaster = [];
    const remaining = withSource.slice();

    while (remaining.length) {
      const vectorBytesUsed = remaining.reduce((sum, s) => sum + s.source.bytes.length, 0);
      if (vectorBytesUsed <= totalBudget - MIN_RASTER_RESERVE_BYTES) {
        vectorSlots.push(...remaining);
        break;
      }
      const worst = remaining.shift();
      fallbackToRaster.push(worst.photo);
      if (typeof Toast !== "undefined") {
        Toast.show(
          `PDF sumber "${worst.col.label}" berukuran besar, dipakai sebagai gambar terkompresi (bukan vektor) khusus untuk hari ini.`,
          "warn"
        );
      }
    }

    return { vectorSlots, fallbackToRaster };
  },

  /**
   * Mengurai PDF sumber (2 halaman, bytes base64 dari upload.js) menjadi
   * bytes mentah (dipakai pdf-lib untuk embed) + kotak batas konten tiap
   * halaman dalam satuan pt, sistem koordinat PDF asli (dipakai supaya
   * spasi kosong di tepi halaman sumber ikut terbuang, sama seperti
   * _cropWhitespace pada jalur raster).
   */
  async _prepareVectorSource(photo) {
    const raw = atob(photo.pdfBytesBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    // .slice() supaya buffer yang dipegang pdfjsLib terpisah dari `bytes`
    // yang nanti dipakai pdf-lib (pdfjsLib bisa "meminjam"/mentransfer
    // buffer yang diberikan padanya).
    const pdfDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const page1 = await pdfDoc.getPage(1);
    const page2 = await pdfDoc.getPage(2);
    const box1 = await this._detectPdfContentBoxPt(page1);
    const box2 = await this._detectPdfContentBoxPt(page2);
    return { bytes, box1, box2 };
  },

  /**
   * Deteksi kotak batas konten (non-putih) 1 halaman PDF, dikembalikan
   * dalam satuan pt pada sistem koordinat PDF asli halaman itu (origin
   * kiri-bawah) — versi vektor dari _detectContentBounds di
   * upload.js/PdfToJpgConverter, tapi hasilnya kotak koordinat PDF
   * (lewat viewport.convertToPdfPoint), bukan kotak piksel kanvas.
   */
  async _detectPdfContentBoxPt(page) {
    const SCAN_MAX = 700;
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, SCAN_MAX / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const threshold = 248;
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const idx = (y * canvas.width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a > 10 && (r < threshold || g < threshold || b < threshold)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Halaman kosong (jarang) -> pakai kotak halaman penuh apa adanya.
    if (maxX < minX || maxY < minY) {
      const view = page.view; // [x0, y0, x1, y1] dalam pt, kotak halaman asli
      return { left: view[0], bottom: view[1], right: view[2], top: view[3] };
    }

    const padPx = Math.round(Math.max(canvas.width, canvas.height) * 0.012);
    minX = Math.max(0, minX - padPx);
    minY = Math.max(0, minY - padPx);
    maxX = Math.min(canvas.width - 1, maxX + padPx);
    maxY = Math.min(canvas.height - 1, maxY + padPx);

    const corners = [
      viewport.convertToPdfPoint(minX, minY),
      viewport.convertToPdfPoint(maxX, minY),
      viewport.convertToPdfPoint(minX, maxY),
      viewport.convertToPdfPoint(maxX, maxY),
    ];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
  },

  /**
   * Menempel (embed) 1 sel vektor: memuat PDF sumbernya lewat pdf-lib,
   * menempelkan kedua halamannya (dipangkas ke kotak konten masing-masing)
   * bertumpuk (hal.1 di atas, hal.2 di bawah — sama seperti susunan
   * thumbnail-nya) ke dalam rect sel yang sama persis posisinya dengan
   * yang dipakai jalur raster dulu, dengan 1 skala seragam supaya rasio
   * aspek asli tiap halaman tetap terjaga (tidak gepeng/molor).
   */
  async _embedVectorCell(finalDoc, finalPage, pageHeightPt, task) {
    const { col, source, bodyTop, rowBodyH } = task;
    const pad = CELL_PHOTO_PAD_MM;

    // Rect sel: dari mm (top-left, sistem jsPDF) ke pt (bottom-left, sistem pdf-lib).
    const cellLeftMm = col.x + pad;
    const cellTopMm = bodyTop + pad;
    const cellWmm = col.width - pad * 2;
    const cellHmm = rowBodyH - pad * 2;
    const xPt = cellLeftMm * MM_TO_PT;
    const cellWpt = cellWmm * MM_TO_PT;
    const cellHpt = cellHmm * MM_TO_PT;
    const yPt = pageHeightPt - cellTopMm * MM_TO_PT - cellHpt;

    const { PDFDocument } = PDFLib;
    const srcDoc = await PDFDocument.load(source.bytes);
    const srcPages = srcDoc.getPages();
    const embeddedPage1 = await finalDoc.embedPage(srcPages[0], source.box1);
    const embeddedPage2 = await finalDoc.embedPage(srcPages[1], source.box2);

    const w1 = source.box1.right - source.box1.left;
    const h1 = source.box1.top - source.box1.bottom;
    const w2 = source.box2.right - source.box2.left;
    const h2 = source.box2.top - source.box2.bottom;

    const stackW = Math.max(w1, w2);
    const stackH = h1 + h2 + VECTOR_STACK_GAP_PT;
    const fitScale = Math.min(cellWpt / stackW, cellHpt / stackH);

    const drawW1 = w1 * fitScale, drawH1 = h1 * fitScale;
    const drawW2 = w2 * fitScale, drawH2 = h2 * fitScale;
    const blockW = stackW * fitScale;
    const blockH = stackH * fitScale;
    const blockX = xPt + (cellWpt - blockW) / 2;
    const blockTopY = yPt + (cellHpt + blockH) / 2;

    const y1 = blockTopY - drawH1;
    const x1 = blockX + (blockW - drawW1) / 2;
    finalPage.drawPage(embeddedPage1, { x: x1, y: y1, width: drawW1, height: drawH1 });

    const y2 = y1 - VECTOR_STACK_GAP_PT * fitScale - drawH2;
    const x2 = blockX + (blockW - drawW2) / 2;
    finalPage.drawPage(embeddedPage2, { x: x2, y: y2, width: drawW2, height: drawH2 });
  },

  /** Konversi ArrayBuffer/Uint8Array PDF hasil pdf-lib ke string base64. */
  _arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  },

  _formatTanggalPanjang(isoDate) {
    const d = new Date(isoDate + "T00:00:00");
    const hariList = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const bulanList = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember",
    ];
    const hari = hariList[d.getDay()];
    const tgl = String(d.getDate()).padStart(2, "0");
    const bulan = bulanList[d.getMonth()];
    const tahun = d.getFullYear();
    return `${hari}, ${tgl} ${bulan} ${tahun}`;
  },
};

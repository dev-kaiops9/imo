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
 * -----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// Budget ukuran PDF harian — supaya "Unduh IMO" bulanan (menggabungkan
// s.d. ±31 file harian + Cover/SmartCard/Daftar Hadir) tidak pernah
// mendekati batas blob keras Apps Script (50MB).
//
// Target lunak 1MB/hari × 31 hari ≈ 31MB, jauh di bawah 50MB — beri
// banyak ruang untuk halaman Cover/SmartCard/Daftar Hadir + overhead.
// Batas keras 1,1MB dijaga lewat reserve overhead tabel/teks di bawah
// target, BUKAN dengan upscale kualitas balik kalau kelewat (JPEG tidak
// bisa "kurang dari 0" — pada kualitas & DPI terendah di tangga di bawah,
// foto asli manapun praktis sudah jauh di bawah budget ini).
const PDF_HARIAN_TARGET_BYTES = 1000 * 1024; // ~1MB — target yang DIKEJAR
const PDF_HARIAN_HARD_CAP_BYTES = Math.round(1.1 * 1024 * 1024); // 1,1MB — ambang peringatan
const PDF_OVERHEAD_RESERVE_BYTES = 40 * 1024; // cadangan vektor tabel/teks jsPDF (kecil, tapi disisihkan)
// Tangga DPI dicoba dari yang PALING TINGGI dulu (paling tajam) — turun
// hanya kalau kualitas terendah di tangga itu MASIH kelewat jatah.
const FOTO_DPI_CANDIDATES = [300, 250, 200, 150];
const FOTO_QUALITY_MIN = 0.4;
const FOTO_QUALITY_MAX = 0.92;
const FOTO_QUALITY_BINARY_STEPS = 6; // ~0,008 resolusi kualitas — cukup halus

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
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const columns = CONFIG.getTableColumns(data.mapping.tabel, targetKey);
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

    if (isLibur) {
      // LIBUR: tidak ada foto sama sekali (Serah Terima Dinasan tetap
      // kosong) — kolom Dokumentasi Kegiatan diisi teks "LIBUR" bold merah.
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...LIBUR_COLOR);
      this._drawCenteredText(doc, "LIBUR", dokCol, bodyTop, rowBodyH);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
    } else {
      // Pagi/Siang/Malam & Lainnya: alur foto existing (foto Serah Terima
      // kosong/null untuk Lainnya otomatis membuat kolom "gabung" kosong).
      const croppedSerahTerima = await this._withCroppedDataUrl(photos.fotoSerahTerima);
      const croppedDokumentasi = await this._withCroppedDataUrl(photos.fotoDokumentasi);

      // ---- Bagi jatah ukuran (budget) PDF harian ke foto yang aktif ----
      // Hanya sel yang benar-benar terisi foto yang ikut dibagi jatah;
      // kalau cuma satu yang terisi (mis. dinas "Lainnya"), semua jatah
      // dialihkan ke foto itu — sama seperti pola yang sudah dipakai di
      // migrasi "Kompres PDF Lama" sebelumnya.
      const slots = [
        { col: targetCol, photo: croppedSerahTerima },
        { col: dokCol, photo: croppedDokumentasi },
      ].filter((s) => s.photo && s.col);

      const totalBudget = PDF_HARIAN_TARGET_BYTES - PDF_OVERHEAD_RESERVE_BYTES;
      const totalActiveWidth = slots.reduce((sum, s) => sum + s.col.width, 0);

      for (const s of slots) {
        const share = totalActiveWidth > 0 ? s.col.width / totalActiveWidth : 1;
        const budgetBytes = Math.max(1, Math.round(totalBudget * share));
        await this._placeImageInCellBudgeted(doc, s.photo, s.col, bodyTop, rowBodyH, budgetBytes);
      }
    }

    // BARU — nama file bercabang sesuai mode (lihat Form.mode/collect()).
    // Mode Kedudukan (data.mode !== MODE_WAKILAN, termasuk semua pemanggil
    // lama yang belum mengirim field "mode") tetap memakai buildPdfFileName()
    // yang sama persis seperti sebelumnya.
    const fileName = data.mode === CONFIG.MODE_WAKILAN
      ? CONFIG.buildPdfFileNameWakilan(data.tanggal, data.wakilan, data.stasiunTempatWakilan, data.dinas)
      : CONFIG.buildPdfFileName(data.tanggal, data.dinas);
    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];

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
          `PDF harian ini ${(blob.size / 1024 / 1024).toFixed(2)}MB, sedikit di atas target 1,1MB (foto kemungkinan sangat detail).`,
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
    const pad = 4;
    const maxW = col.width - pad * 2;
    const maxH = rowBodyH - pad * 2;

    // Foto dicari DPI & kualitas JPEG SETINGGI mungkin yang masih muat
    // jatah (budgetBytes) milik sel ini — lihat _compressForBudget di
    // bawah. Ukuran fisik (maxW x maxH mm) tempat foto digambar di
    // halaman TIDAK berubah; yang disesuaikan hanya resolusi piksel &
    // kualitas kompresi datanya, supaya PDF harian gabungan tetap masuk
    // jatah ~1MB (batas keras 1,1MB) tanpa foto terlihat pecah/kotak.
    const { dataUrl: dataUrlForPdf, format } = await this._compressForBudget(
      photo.dataUrl,
      photo.mimeType,
      maxW,
      maxH,
      budgetBytes
    );

    try {
      const props = doc.getImageProperties(dataUrlForPdf);
      const ratio = Math.min(maxW / props.width, maxH / props.height);
      const drawW = props.width * ratio;
      const drawH = props.height * ratio;
      const drawX = col.x + pad + (maxW - drawW) / 2;
      const drawY = bodyTop + pad + (maxH - drawH) / 2;

      doc.addImage(dataUrlForPdf, format, drawX, drawY, drawW, drawH, undefined, "NONE");
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

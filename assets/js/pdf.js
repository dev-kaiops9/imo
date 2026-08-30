/**
 * pdf.js
 * -----------------------------------------------------------------------
 * Membuat dokumen PDF di browser (jsPDF) berisi MURNI tabel serah terima
 * (tanpa judul/keterangan tambahan di atas maupun di bawah tabel), persis
 * seperti struktur kolom yang didefinisikan di CONFIG.getTableColumns()
 * — kolom & posisi yang sama persis dipakai juga oleh preview.js supaya
 * preview dan hasil PDF selalu identik.
 * -----------------------------------------------------------------------
 */

const PdfBuilder = {
  /**
   * @param {object} data hasil Form.collect()
   * @param {object} photos { fotoSerahTerima: {dataUrl,...}, fotoDokumentasi: {...} }
   * @returns {Promise<{blob: Blob, base64: string, fileName: string}>}
   */
  async build(data, photos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const marginX = 12;
    const tableW = pageW - marginX * 2;
    const rowHeaderH = 12;
    const rowBodyH = 100; // tinggi baris tetap & wajar — sebelumnya dipaksa mengisi
                          // seluruh sisa halaman, jadi foto & teks terlihat "ditarik"
                          // memanjang ke atas/bawah. Tabel sekarang diposisikan
                          // di tengah halaman secara vertikal.
    const tableTop = (pageH - (rowHeaderH + rowBodyH)) / 2;

    // ---- Struktur kolom (sumber tunggal: CONFIG, sama dengan preview) ----
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

    const tanggalLabel = this._formatTanggalPanjang(data.tanggal);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    columns.forEach((c) => {
      if (c.key === "hari") {
        doc.text(tanggalLabel, c.x + c.width / 2, bodyTop + rowBodyH / 2, {
          align: "center",
          maxWidth: c.width - 4,
        });
      }
      if (c.key === "kegiatan") {
        doc.text(data.kegiatan || "", c.x + c.width / 2, bodyTop + rowBodyH / 2, {
          align: "center",
          maxWidth: c.width - 4,
        });
      }
    });

    // ---- Tempatkan foto sesuai mapping ----
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const targetCol = columns.find((c) => c.key === targetKey);
    const dokCol = columns.find((c) => c.key === "dok");

    // Foto yang diupload petugas seringkali berupa hasil jepretan HP yang
    // menyertakan banyak ruang putih/kosong di sekeliling konten asli
    // (dokumen atau objek foto) — bukan cuma dokumen itu sendiri. Kalau
    // rasio foto MENTAH ini langsung dipakai untuk fit-to-cell, konten
    // aslinya ikut "ketarik kecil" karena ruang kosong itu ikut dihitung.
    // Maka sebelum ditempatkan, foto di-crop otomatis dulu membuang
    // ruang putih di tepinya — hasilnya konten mengisi sel semaksimal
    // mungkin, tetap tanpa distorsi (rasio hasil crop yang dipakai).
    const croppedSerahTerima = await this._withCroppedDataUrl(photos.fotoSerahTerima);
    const croppedDokumentasi = await this._withCroppedDataUrl(photos.fotoDokumentasi);

    this._placeImageInCell(doc, croppedSerahTerima, targetCol, bodyTop, rowBodyH);
    this._placeImageInCell(doc, croppedDokumentasi, dokCol, bodyTop, rowBodyH);

    const fileName = CONFIG.buildPdfFileName(data.tanggal, data.dinas);
    const blob = doc.output("blob");
    const base64 = doc.output("datauristring").split(",")[1];

    return { blob, base64, fileName };
  },

  /**
   * Mengembalikan salinan objek foto dengan dataUrl yang sudah di-crop
   * (ruang putih/kosong di tepi dibuang). Jika gagal atau tidak ada
   * konten yang cukup jelas untuk dipotong, foto asli dikembalikan
   * apa adanya — jadi fungsi ini aman dipanggil untuk foto apapun.
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
          // 1) Analisis di resolusi kecil dulu (cepat) untuk menemukan
          // bounding box konten — supaya tidak berat saat foto sumbernya
          // beresolusi besar (foto kamera HP bisa 4000px+).
          const SCAN_MAX = 500;
          const scale = Math.min(1, SCAN_MAX / Math.max(img.width, img.height));
          const sw = Math.max(1, Math.round(img.width * scale));
          const sh = Math.max(1, Math.round(img.height * scale));

          const scanCanvas = document.createElement("canvas");
          scanCanvas.width = sw;
          scanCanvas.height = sh;
          const sctx = scanCanvas.getContext("2d");
          sctx.drawImage(img, 0, 0, sw, sh);
          const { data } = sctx.getImageData(0, 0, sw, sh);

          // Piksel dianggap "kosong/putih" kalau ketiga channel-nya di
          // atas ambang batas ini. Cukup toleran terhadap noise hasil
          // kompresi JPEG & background yang sedikit off-white.
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

          // Tidak ada konten terdeteksi (foto polos/putih semua) → pakai foto asli.
          if (maxX < 0 || maxY < 0) {
            resolve(dataUrl);
            return;
          }

          // Sedikit padding supaya tidak memotong pas di garis tepi konten.
          const padX = Math.round(sw * 0.01);
          const padY = Math.round(sh * 0.01);
          minX = Math.max(0, minX - padX);
          minY = Math.max(0, minY - padY);
          maxX = Math.min(sw - 1, maxX + padX);
          maxY = Math.min(sh - 1, maxY + padY);

          // Kalau konten yang terdeteksi sudah mendekati seluruh foto
          // (mis. foto dokumentasi kegiatan yang penuh dari tepi ke tepi),
          // tidak ada whitespace berarti untuk dibuang — pakai foto asli.
          const coverage = ((maxX - minX) * (maxY - minY)) / (sw * sh);
          if (coverage > 0.97) {
            resolve(dataUrl);
            return;
          }

          // 2) Terapkan bounding box (dikonversi ke skala resolusi asli)
          // ke gambar resolusi PENUH supaya hasil crop tetap tajam.
          const fx = img.width / sw;
          const fy = img.height / sh;
          const cropX = Math.round(minX * fx);
          const cropY = Math.round(minY * fy);
          const cropW = Math.round((maxX - minX) * fx);
          const cropH = Math.round((maxY - minY) * fy);

          const outCanvas = document.createElement("canvas");
          outCanvas.width = cropW;
          outCanvas.height = cropH;
          const octx = outCanvas.getContext("2d");
          // Isi putih dulu — jaga-jaga kalau sumbernya PNG transparan,
          // supaya area transparan tidak berubah jadi hitam saat
          // dikonversi ke JPEG (JPEG tidak mendukung alpha).
          octx.fillStyle = "#FFFFFF";
          octx.fillRect(0, 0, cropW, cropH);
          octx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

          const outType = mimeType && mimeType.includes("png") ? "image/png" : "image/jpeg";
          resolve(outCanvas.toDataURL(outType, 0.95));
        } catch (e) {
          // Gagal crop (mis. gambar bermasalah) → tetap pakai foto asli,
          // jangan sampai proses pembuatan PDF gagal total karenanya.
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  _placeImageInCell(doc, photo, col, bodyTop, rowBodyH) {
    if (!photo || !col) return;
    const pad = 4;
    const maxW = col.width - pad * 2;
    const maxH = rowBodyH - pad * 2;

    // jsPDF butuh format gambar eksplisit; deteksi dari mime type.
    const format = photo.mimeType && photo.mimeType.includes("png") ? "PNG" : "JPEG";

    try {
      // Pertahankan rasio asli gambar (contain), lalu center di dalam sel.
      // Foto hasil scan dokumen (mis. Serah Terima Dinasan) biasanya
      // portrait/rasio sempit — kalau dipaksa stretch ke ukuran sel jadi
      // gepeng. Dengan "contain", sisa ruang otomatis jadi spasi putih
      // di kiri-kanan (atau atas-bawah), bukan gambar terdistorsi.
      const props = doc.getImageProperties(photo.dataUrl);
      const ratio = Math.min(maxW / props.width, maxH / props.height);
      const drawW = props.width * ratio;
      const drawH = props.height * ratio;
      const drawX = col.x + pad + (maxW - drawW) / 2;
      const drawY = bodyTop + pad + (maxH - drawH) / 2;

      // Kompresi "NONE" = kualitas gambar dipertahankan penuh (tidak
      // dikompres ulang oleh jsPDF), supaya saat PDF di-zoom teks di
      // dalam foto tetap tajam, bukan buram.
      doc.addImage(photo.dataUrl, format, drawX, drawY, drawW, drawH, undefined, "NONE");
    } catch (e) {
      // Jika gagal (mis. format tak didukung), tampilkan placeholder teks.
      doc.setFontSize(8);
      doc.text("(gambar tidak dapat ditampilkan)", col.x + pad, bodyTop + pad + 6);
    }
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

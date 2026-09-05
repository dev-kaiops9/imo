/**
 * preview.js
 * -----------------------------------------------------------------------
 * Menampilkan tabel preview PERSIS seperti hasil akhir PDF: satu tabel
 * dengan kolom & posisi yang sama (struktur diambil dari
 * CONFIG.getTableColumns(), sumber tunggal yang sama dipakai pdf.js) —
 * sama persis dengan tampilan di imo versi lama.
 *
 * Identitas (Nama/NIPP/Jabatan/Stasiun) sekarang diambil dari sesi Login
 * (Form.currentUser) alih-alih step form "Data Pegawai" yang sudah tidak
 * ada lagi. Preview ini HANYA menampilkan data (tidak mengirim apa pun ke
 * server) — main.js yang memanggil Preview.render() lalu membuka overlay,
 * dan penyimpanan permanen baru terjadi saat tombol "Simpan" ditekan.
 * -----------------------------------------------------------------------
 */

const Preview = {
  render() {
    const data = Form.collect();
    const photos = UploadField.state;

    // targetKey hanya berarti untuk "Stasiun Buka" (1 foto -> kolom
    // "gabung"). "Stasiun Tutup" punya 2 foto sekaligus (awal & akhir) —
    // lihat isTutup, sama seperti di pdf.js supaya preview & PDF identik.
    const isTutup = data.jenisSerahTerima === CONFIG.JENIS_TUTUP;
    const targetKey = CONFIG.getTargetPhotoKey(data.jenisSerahTerima);
    const columns = CONFIG.getTableColumns(data.mapping.tabel);
    const tanggalLabel = this._formatTanggalPanjang(data.tanggal);

    const photoByKey = isTutup
      ? { awal: photos.fotoAwalDinas, akhir: photos.fotoAkhirDinas, dok: photos.fotoDokumentasi }
      : { [targetKey]: photos.fotoSerahTerima, dok: photos.fotoDokumentasi };

    const isLibur = data.dinas === CONFIG.DINAS_KHUSUS.LIBUR;

    const wrap = document.getElementById("pvTableWrap");
    wrap.innerHTML = "";
    wrap.appendChild(this._buildTable(columns, data.kegiatan, tanggalLabel, photoByKey, isLibur));
  },

  _buildTable(columns, kegiatan, tanggalLabel, photoByKey, isLibur) {
    const table = document.createElement("table");
    table.className = "pv-table";

    const colgroup = document.createElement("colgroup");
    columns.forEach((c) => {
      const col = document.createElement("col");
      col.style.width = `${c.w * 100}%`;
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    columns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    const bodyRow = document.createElement("tr");
    columns.forEach((c) => {
      const td = document.createElement("td");
      if (c.key === "hari") {
        td.textContent = tanggalLabel;
      } else if (c.key === "kegiatan") {
        td.textContent = kegiatan || "";
        if (isLibur) td.classList.add("pv-table__libur");
      } else if (isLibur && c.key === "dok") {
        // LIBUR: tidak ada foto dokumentasi — tampilkan teks "LIBUR" (bold, merah).
        td.textContent = "LIBUR";
        td.classList.add("pv-table__libur");
      } else if (photoByKey[c.key]) {
        const img = document.createElement("img");
        img.src = photoByKey[c.key].dataUrl;
        img.alt = c.label;
        td.className = "pv-table__photo-cell";
        td.appendChild(img);
      }
      bodyRow.appendChild(td);
    });
    tbody.appendChild(bodyRow);
    table.appendChild(tbody);

    return table;
  },

  _formatTanggalPanjang(isoDate) {
    const d = new Date(isoDate + "T00:00:00");
    return d.toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  },
};

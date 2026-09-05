/**
 * main.js
 * -----------------------------------------------------------------------
 * Titik masuk aplikasi: navigasi stepper, overlay "sedang memproses", dan
 * alur akhir (preview -> generate PDF -> kirim ke Apps Script -> simpan
 * ke Google Drive -> tampilkan hasil).
 * -----------------------------------------------------------------------
 */

const BULAN_ID_LIST = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "yyyy-mm-dd" -> "2026/Agustus", dipakai hanya untuk menampilkan lokasi
 *  folder di pesan sukses (folder sebenarnya dibuat di backend/Code.gs). */
function tahunBulanFolder_(tanggalISO) {
  const d = new Date(String(tanggalISO || "") + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${BULAN_ID_LIST[d.getMonth()]}`;
}

// ---------------------------------------------------------------------
// Busy overlay (loading saat generate PDF / simpan)
// ---------------------------------------------------------------------
const Busy = {
  show(text) {
    document.getElementById("busyText").textContent = text || "MEMPROSES…";
    document.getElementById("busyOverlay").classList.add("is-open");
  },
  hide() {
    document.getElementById("busyOverlay").classList.remove("is-open");
  },
};

// ---------------------------------------------------------------------
// Stepper navigation (3 langkah: Data Dinas -> Unggah Foto -> Hasil)
// ---------------------------------------------------------------------
const Stepper = {
  current: 1,

  goTo(stepNumber) {
    this.current = stepNumber;

    document.querySelectorAll(".step-panel").forEach((panel) => {
      panel.classList.toggle("hidden", Number(panel.dataset.panel) !== stepNumber);
    });

    document.querySelectorAll(".step").forEach((step) => {
      const n = Number(step.dataset.step);
      step.classList.toggle("is-active", n === stepNumber);
      step.classList.toggle("is-done", n < stepNumber);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  },
};

// ---------------------------------------------------------------------
// Popup "Tanggal Sudah Ada" — muncul saat user menekan "Lanjut →" di
// Langkah 1 tapi tanggal yang dipilih sudah punya data tersimpan
// sebelumnya (lihat Form.checkTanggalDuplikat di form.js).
// ---------------------------------------------------------------------
const DuplikatTanggalModal = {
  open(tanggalTampil) {
    document.getElementById("duplikatTanggalValue").textContent = tanggalTampil || "-";
    const overlay = document.getElementById("duplikatTanggalOverlay");
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
  },
  close() {
    const overlay = document.getElementById("duplikatTanggalOverlay");
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
  },
};

function wireDuplikatTanggalModal() {
  const overlay = document.getElementById("duplikatTanggalOverlay");
  if (!overlay) return; // jaga-jaga kalau markup belum ada di HTML.
  document.getElementById("btnTutupDuplikatTanggal").addEventListener("click", () => DuplikatTanggalModal.close());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) DuplikatTanggalModal.close();
  });
}

// ---------------------------------------------------------------------
// Wiring tombol next/back antar step
// ---------------------------------------------------------------------
function wireStepNavigation() {
  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = Number(btn.dataset.next);

      // Langkah 1 -> 2: validasi field dulu, baru cek duplikat tanggal
      // ke server. Langkah lain (>1) tidak divalidasi ulang di sini
      // (step 2 divalidasi terpisah lewat tombol "Lihat Preview").
      if (Stepper.current === 1) {
        if (!Form.validateStep1()) return;

        btn.disabled = true;
        try {
          const { duplikat, tanggalTampil } = await Form.checkTanggalDuplikat();
          if (duplikat) {
            DuplikatTanggalModal.open(tanggalTampil);
            return; // Batalkan perpindahan step — user harus ganti tanggal.
          }
        } finally {
          btn.disabled = false;
        }
      }

      Stepper.goTo(target);
    });
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => Stepper.goTo(Number(btn.dataset.back)));
  });
}

// ---------------------------------------------------------------------
// Alur Preview -> Simpan
// ---------------------------------------------------------------------
function wirePreviewAndSave() {
  document.getElementById("btnGoPreview").addEventListener("click", () => {
    if (!Form.validateStep2()) return;
    Preview.render();
    document.getElementById("previewOverlay").classList.add("is-open");
    document.getElementById("previewOverlay").setAttribute("aria-hidden", "false");
  });

  document.getElementById("btnEditPreview").addEventListener("click", () => {
    document.getElementById("previewOverlay").classList.remove("is-open");
    document.getElementById("previewOverlay").setAttribute("aria-hidden", "true");
  });

  document.getElementById("btnSavePreview").addEventListener("click", async () => {
    const data = Form.collect();

    try {
      Busy.show("MEMBUAT PDF…");
      const pdf = await Pdf.build(data);

      Busy.show("MENYIMPAN DATA…");
      const result = await Api.saveSerahTerima(data, pdf);

      Busy.hide();
      document.getElementById("previewOverlay").classList.remove("is-open");
      document.getElementById("previewOverlay").setAttribute("aria-hidden", "true");
      showResult(true, "File Tersimpan di Database");
      Toast.show("Data berhasil disimpan.", "success");

      // Update cache lokal daftar "PDF Tersimpan" supaya kalau user
      // langsung isi entri baru lagi tanpa reload halaman, pengecekan
      // duplikat tanggal (Form.checkTanggalDuplikat) langsung tahu
      // tanggal ini sudah terpakai — tanpa perlu fetch ulang ke server.
      Form.registerSavedPdf(data.tanggal, data.dinas, data.jenisSerahTerima, result.pdfUrl);

      notifyParentPdfSaved();
    } catch (err) {
      Busy.hide();
      Toast.show("Gagal menyimpan: " + err.message, "error");
    }
  });
}

function showResult(success, text) {
  document.getElementById("resultTitle").textContent = success ? "Tersimpan" : "Gagal Menyimpan";
  document.getElementById("resultText").textContent = text;
  Stepper.goTo(3);
}

// ---------------------------------------------------------------------
// Reset untuk entri baru
// ---------------------------------------------------------------------
function wireReset() {
  document.getElementById("btnReset").addEventListener("click", () => {
    Form.reset();
    UploadField.reset();
    Stepper.goTo(1);
  });
}

// ---------------------------------------------------------------------
// Jam berjalan (kalau elemen ada — dihilangkan saat dimuat di dalam shell
// dashboard yang topbar-nya sendiri sudah punya jam).
// ---------------------------------------------------------------------
function startLiveClock() {
  const el = document.getElementById("liveClock");
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleString("id-ID", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------------------------------------------------------------
// Beritahu shell dashboard (parent) supaya widget "PDF Tersimpan" di
// sidebar kanan langsung memuat ulang daftarnya setelah PDF baru
// tersimpan — tanpa ini, widget hanya akan ter-update saat halaman
// dashboard di-refresh/login ulang.
// ---------------------------------------------------------------------
function notifyParentPdfSaved() {
  try {
    if (window.parent && window.parent !== window && typeof window.parent.refreshSavedPdfWidget === "function") {
      window.parent.refreshSavedPdfWidget();
    }
  } catch (err) {
    // Halaman dimuat di luar shell dashboard (mis. dibuka langsung) — abaikan.
  }
}

// ---------------------------------------------------------------------
// Ajakan login (kalau user belum login lewat dashboard IMO Tools)
// ---------------------------------------------------------------------
function wireLoginGate() {
  const btnGoLogin = document.getElementById("btnGoLogin");
  if (!btnGoLogin) return;
  btnGoLogin.addEventListener("click", () => {
    try {
      // Halaman ini dimuat sebagai iframe di dalam dashboard IMO Tools yang
      // sama origin-nya, jadi modal Login di parent bisa dibuka langsung.
      if (window.parent && window.parent !== window && typeof window.parent.openLoginModal === "function") {
        window.parent.openLoginModal();
      } else {
        Toast.show("Buka menu utama IMO Tools untuk login.", "warn");
      }
    } catch (err) {
      Toast.show("Buka menu utama IMO Tools untuk login.", "warn");
    }
  });
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  Toast.init();
  Form.init();
  UploadField.init();
  wireStepNavigation();
  wireDuplikatTanggalModal();
  wirePreviewAndSave();
  wireReset();
  wireLoginGate();
  startLiveClock();
  Stepper.goTo(1);

  if (!Form.currentUser) {
    Toast.show("Silakan login terlebih dahulu untuk mengisi serah terima.", "warn");
  }
});

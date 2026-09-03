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
// Wiring tombol next/back antar step
// ---------------------------------------------------------------------
function wireStepNavigation() {
  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.next);
      const currentValid =
        (Stepper.current === 1 && Form.validateStep1()) ||
        Stepper.current > 1;
      if (currentValid) Stepper.goTo(target);
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
      await Api.saveSerahTerima(data, pdf);

      Busy.hide();
      document.getElementById("previewOverlay").classList.remove("is-open");
      document.getElementById("previewOverlay").setAttribute("aria-hidden", "true");
      showResult(true, "File Tersimpan di Database");
      Toast.show("Data berhasil disimpan.", "success");
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
  wirePreviewAndSave();
  wireReset();
  wireLoginGate();
  startLiveClock();
  Stepper.goTo(1);

  if (!Form.currentUser) {
    Toast.show("Silakan login terlebih dahulu untuk mengisi serah terima.", "warn");
  }
});

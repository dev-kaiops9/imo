/**
 * main.js
 * -----------------------------------------------------------------------
 * Titik masuk aplikasi: navigasi stepper, toast, overlay "sedang
 * memproses", dan alur akhir (preview -> generate PDF -> kirim ke
 * Apps Script -> tampilkan hasil).
 * -----------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------------
const Toast = {
  show(message, type = "success") {
    const stack = document.getElementById("toastStack");
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.25s ease";
      setTimeout(() => el.remove(), 260);
    }, 4200);
  },
};

// ---------------------------------------------------------------------
// Busy overlay (loading saat generate PDF / upload / simpan)
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
// Stepper navigation
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
        (Stepper.current === 2 && Form.validateStep2()) ||
        Stepper.current > 2;
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
    if (!Form.validateStep3()) return;
    const data = Form.collect();
    Preview.open(data, UploadField.state);
  });

  document.getElementById("btnEditPreview").addEventListener("click", () => Preview.close());

  document.getElementById("btnSavePreview").addEventListener("click", async () => {
    const data = Form.collect();
    const photos = UploadField.state;

    try {
      Busy.show("MEMBUAT PDF…");
      const pdf = PdfBuilder.build(data, photos);

      Busy.show("MENYIMPAN DATA…");
      await Api.simpanData({
        nipp: data.nipp,
        nama: data.nama,
        jabatan: data.jabatan,
        stasiun: data.stasiun,
        dinas: data.dinas,
        tanggal: data.tanggal,
        jenisSerahTerima: data.jenisSerahTerima,
        employeeFound: data.employeeFound,
        tabel: data.mapping.tabel,
        driveRootFolder: CONFIG.DRIVE_ROOT_FOLDER,
        pdfFileName: pdf.fileName,
        pdfBase64: pdf.base64,
        // Catatan: file foto serah terima & dokumentasi TIDAK dikirim ke
        // backend lagi — sudah tertempel di dalam PDF, jadi tidak perlu
        // disimpan sebagai file terpisah di Google Drive.
      });

      Busy.hide();
      Preview.close();
      showResult(true, `Tersimpan sebagai "${pdf.fileName}" di IMO_2026/${data.stasiun}/${data.jabatan}/${data.nipp}/`);
      Toast.show("Data berhasil disimpan.", "success");
    } catch (err) {
      Busy.hide();
      Toast.show("Gagal menyimpan: " + err.message, "error");
    }
  });
}

function showResult(success, text) {
  document.getElementById("resultTitle").textContent = success ? "Tersimpan" : "Gagal Menyimpan";
  document.getElementById("resultText").textContent = text;
  Stepper.goTo(4);
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
// Jam berjalan di top bar (nuansa papan informasi stasiun)
// ---------------------------------------------------------------------
function startLiveClock() {
  const el = document.getElementById("liveClock");
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
// Init
// ---------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  Form.init();
  UploadField.init();
  wireStepNavigation();
  wirePreviewAndSave();
  wireReset();
  startLiveClock();
});

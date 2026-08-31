/**
 * main.js
 * -----------------------------------------------------------------------
 * PLACEHOLDER SEMENTARA — file asli tidak berhasil dipulihkan dari backup.
 * Menyatukan semua modul: navigasi stepper, tab menu utama, jam realtime,
 * overlay preview, dan tombol simpan.
 * -----------------------------------------------------------------------
 */

let currentStep = 1;

function showStep(step) {
  document.querySelectorAll(".step-panel").forEach((p) => {
    p.classList.toggle("hidden", Number(p.dataset.panel) !== step);
  });
  document.querySelectorAll(".step").forEach((s) => {
    const n = Number(s.dataset.step);
    s.classList.toggle("is-active", n === step);
    s.classList.toggle("is-done", n < step);
  });
  currentStep = step;
}

function goToStep(step, validate) {
  if (validate && !validate()) return;
  showStep(step);
}

function wireStepper() {
  document.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = Number(btn.dataset.next);
      const validators = { 2: () => Form.validateStep1(), 3: () => Form.validateStep2() };
      goToStep(next, validators[next]);
    });
  });
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => showStep(Number(btn.dataset.back)));
  });

  document.getElementById("btnGoPreview").addEventListener("click", () => {
    if (!Form.validateStep3()) return;
    Preview.render();
    document.getElementById("previewOverlay").classList.add("is-open");
  });

  document.getElementById("btnEditPreview").addEventListener("click", () => {
    document.getElementById("previewOverlay").classList.remove("is-open");
  });

  document.getElementById("btnSavePreview").addEventListener("click", async () => {
    document.getElementById("previewOverlay").classList.remove("is-open");
    const busy = document.getElementById("busyOverlay");
    busy.classList.add("is-open");
    document.getElementById("busyText").textContent = "MEMPROSES…";

    const data = Form.collect();
    await Pdf.build(data);
    const res = await Api.saveSerahTerima(data);

    busy.classList.remove("is-open");
    if (res.ok) {
      Toast.show("Data tersimpan (mode demo — belum tersambung ke Drive).", "success");
      showStep(4);
    } else {
      Toast.show("Gagal menyimpan data.", "error");
    }
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    Form.reset();
    UploadField.reset();
    showStep(1);
  });
}

function wireMainMenuTabs() {
  const formTab = document.getElementById("tabIsiForm");
  const cekTab = document.getElementById("tabCekPdf");
  const formArea = document.getElementById("mainFormArea");
  const cekArea = document.getElementById("cekPdfArea");
  const stepperNav = document.getElementById("stepperNav");

  formTab.addEventListener("click", () => {
    formTab.classList.add("is-active");
    cekTab.classList.remove("is-active");
    formArea.classList.remove("hidden");
    stepperNav.classList.remove("hidden");
    cekArea.classList.add("hidden");
  });

  cekTab.addEventListener("click", () => {
    cekTab.classList.add("is-active");
    formTab.classList.remove("is-active");
    cekArea.classList.remove("hidden");
    formArea.classList.add("hidden");
    stepperNav.classList.add("hidden");
  });
}

function startClock() {
  const el = document.getElementById("liveClock");
  if (!el) return; // Header (dan jam) dihilangkan saat menu dimuat di dalam shell dashboard.
  const tick = () => {
    el.textContent = new Date().toLocaleString("id-ID", {
      weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  };
  tick();
  setInterval(tick, 1000);
}

window.addEventListener("DOMContentLoaded", () => {
  Toast.init();
  Form.init();
  UploadField.init();
  CekPdf.init();
  wireStepper();
  wireMainMenuTabs();
  startClock();
  showStep(1);
});

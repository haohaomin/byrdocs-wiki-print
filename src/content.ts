import {
  ensurePrintButtonPlacement,
  isPrintUiReady,
  needsPlacementSync,
} from "./print-button";
import { mountPrintFeature } from "./print";

function isExamPage(): boolean {
  return document.querySelector(".exam-page-main") !== null;
}

function syncPrintFeature(): void {
  try {
    if (!isExamPage()) return;

    if (!document.getElementById("bdwpPrintDialog")) {
      mountPrintFeature();
      return;
    }

    if (needsPlacementSync()) {
      ensurePrintButtonPlacement();
    }
  } catch (error) {
    console.error("[BYR Docs Wiki Print] init failed:", error);
  }
}

function maybeStopObserver(observer: MutationObserver): void {
  if (isPrintUiReady()) {
    observer.disconnect();
  }
}

let syncScheduled = false;
const observer = new MutationObserver(() => {
  if (!isExamPage()) return;
  if (syncScheduled) return;
  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    if (!isExamPage()) return;
    syncPrintFeature();
    maybeStopObserver(observer);
  });
});

function init(): void {
  syncPrintFeature();
  maybeStopObserver(observer);
}

observer.observe(document, { childList: true, subtree: true });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

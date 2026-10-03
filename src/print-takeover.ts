let takeoverBound = false;
let openDialogHandler: (() => void) | null = null;

function onPrintShortcut(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat) return;
  if (event.key !== "p" && event.key !== "P") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openDialogHandler?.();
}

function onNativePrintClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest("#examPrint")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openDialogHandler?.();
}

function bindTakeover(): void {
  if (takeoverBound) return;
  window.addEventListener("keydown", onPrintShortcut, true);
  document.addEventListener("click", onNativePrintClick, true);
  takeoverBound = true;
}

function unbindTakeover(): void {
  if (!takeoverBound) return;
  window.removeEventListener("keydown", onPrintShortcut, true);
  document.removeEventListener("click", onNativePrintClick, true);
  takeoverBound = false;
}

export function applyPrintTakeover(
  enabled: boolean,
  openDialog: () => void,
): void {
  openDialogHandler = openDialog;
  if (enabled) {
    bindTakeover();
  } else {
    unbindTakeover();
  }
}

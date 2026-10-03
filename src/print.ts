import { mountUpdateNotice } from "./update-notice";
import { ensurePrintButtonPlacement, mountPrintButton } from "./print-button";
import { preparePrintDocument, type PrintOptions } from "./print-document";
import { applyPrintTakeover } from "./print-takeover";
import {
  getTakeoverPrint,
  onTakeoverPrintChanged,
  setTakeoverPrint,
} from "./settings";

/** Print dialog, handlers, and answer reveal logic for BYR Docs Wiki exam pages. */

// Register at document_start, before upstream registers its Window listeners.
// Window print events target Window itself; capture alone does not reliably
// reorder listeners already installed by the page.
let beforePrintHandler: ((event: Event) => void) | undefined;
let afterPrintHandler: ((event: Event) => void) | undefined;
window.addEventListener("beforeprint", (event) => beforePrintHandler?.(event), true);
window.addEventListener("afterprint", (event) => afterPrintHandler?.(event), true);

function createDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.id = "bdwpPrintDialog";
  dialog.className = "bdwp-print-dialog";
  dialog.setAttribute("aria-labelledby", "bdwpPrintDialogTitle");
  dialog.innerHTML = `
  <div class="bdwp-print-dialog-panel">
    <h2 id="bdwpPrintDialogTitle" class="bdwp-print-dialog-title">打印选项</h2>
    <p class="bdwp-print-dialog-desc">选择要包含在打印稿中的内容。</p>
    <label class="bdwp-print-dialog-option">
      <input
        id="bdwpPrintInfo"
        type="checkbox"
      />
      <span>打印试题概要信息</span>
    </label>
    <label class="bdwp-print-dialog-option bdwp-print-dialog-option-spaced">
      <input
        id="bdwpPrintAnswers"
        type="checkbox"
        checked
      />
      <span>打印答案</span>
    </label>
    <fieldset id="bdwpPrintAnswerPlacement" class="bdwp-print-dialog-fieldset">
      <legend>答案位置</legend>
      <label class="bdwp-print-dialog-option">
        <input type="radio" name="bdwpPrintPlacement" value="end" checked />
        <span>统一放在最后</span>
      </label>
      <label class="bdwp-print-dialog-option">
        <input type="radio" name="bdwpPrintPlacement" value="inline" />
        <span>放在原题位置</span>
      </label>
    </fieldset>
    <label class="bdwp-print-dialog-option bdwp-print-dialog-option-spaced bdwp-print-dialog-takeover">
      <input id="bdwpTakeoverPrint" type="checkbox" checked />
      <span>仅扩展接管打印（拦截 Ctrl/Cmd+P 与主站打印按钮）</span>
    </label>
    <div class="bdwp-print-dialog-actions">
      <button
        id="bdwpPrintDialogCancel"
        class="bdwp-print-dialog-btn bdwp-print-dialog-btn-secondary"
        type="button"
      >
        取消
      </button>
      <button
        id="bdwpPrintDialogConfirm"
        class="bdwp-print-dialog-btn bdwp-print-dialog-btn-primary"
        type="button"
      >
        打印
      </button>
    </div>
  </div>
  `;
  return dialog;
}

export function mountPrintFeature(): void {
  if (document.getElementById("bdwpPrintDialog")) return;
  if (!document.querySelector(".exam-page-main")) return;

  const dialog = createDialog();
  document.body.append(dialog);
  const checkUpdates = mountUpdateNotice(dialog);
  checkUpdates();
  const answers = dialog.querySelector<HTMLInputElement>("#bdwpPrintAnswers")!;
  const info = dialog.querySelector<HTMLInputElement>("#bdwpPrintInfo")!;
  const placement = dialog.querySelector<HTMLFieldSetElement>("#bdwpPrintAnswerPlacement")!;
  const confirm = dialog.querySelector<HTMLButtonElement>("#bdwpPrintDialogConfirm")!;
  const takeover = dialog.querySelector<HTMLInputElement>("#bdwpTakeoverPrint")!;
  let options: PrintOptions = { answers: true, info: false, placement: "end" };
  let printDocument: HTMLElement | null = null;
  let preparing = false;
  let generation = 0;
  let takeoverEnabled = true;

  const syncPlacement = () => { placement.disabled = !answers.checked; };
  const syncTakeoverCheckbox = async () => { takeover.checked = await getTakeoverPrint(); };
  const openDialog = () => {
    if (preparing || printDocument) return;
    checkUpdates();
    answers.checked = options.answers;
    info.checked = options.info;
    placement.querySelectorAll<HTMLInputElement>("input").forEach(input => {
      input.checked = input.value === options.placement;
    });
    syncPlacement();
    void syncTakeoverCheckbox();
    if (!dialog.open) dialog.showModal();
  };
  const syncPrintTakeover = async () => {
    takeoverEnabled = await getTakeoverPrint();
    applyPrintTakeover(takeoverEnabled, openDialog);
  };
  const prepare = (): HTMLElement | null => {
    printDocument ??= preparePrintDocument(options);
    if (printDocument) document.documentElement.dataset.bdwpPrintActive = "true";
    return printDocument;
  };
  const finish = () => {
    generation++;
    printDocument?.remove();
    printDocument = null;
    delete document.documentElement.dataset.bdwpPrintActive;
    preparing = false;
    confirm.disabled = false;
  };

  mountPrintButton(openDialog);
  void syncPrintTakeover();
  onTakeoverPrintChanged(() => {
    void syncPrintTakeover();
    void syncTakeoverCheckbox();
  });
  takeover.addEventListener("change", () => {
    void setTakeoverPrint(takeover.checked).then(syncPrintTakeover);
  });
  dialog.querySelector("#bdwpPrintDialogCancel")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  answers.addEventListener("change", syncPlacement);
  confirm.addEventListener("click", async () => {
    if (preparing || printDocument) return;
    options = {
      answers: answers.checked,
      info: info.checked,
      placement: placement.querySelector<HTMLInputElement>("input:checked")?.value === "inline" ? "inline" : "end",
    };
    preparing = true;
    const job = ++generation;
    confirm.disabled = true;
    dialog.close();
    try {
      const prepared = prepare();
      const resources = [document.fonts.ready, ...Array.from(prepared?.querySelectorAll("img") ?? [], image => image.decode().catch(() => {}))];
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(resources), new Promise(resolve => { timeout = setTimeout(resolve, 4000); })]);
      } finally {
        clearTimeout(timeout);
      }
      if (job !== generation || !preparing || !printDocument) return;
      window.print();
    } catch (error) {
      if (job === generation) finish();
      throw error;
    }
  });

  // Keep early isolated-world listeners: only the owner may prepare/clean a job.
  beforePrintHandler = event => {
    if (!preparing && !printDocument && !takeoverEnabled) return;
    if (!document.querySelector(".exam-page-main")) return;
    event.stopImmediatePropagation();
    prepare();
  };
  afterPrintHandler = event => {
    if (!preparing && !printDocument) return;
    event.stopImmediatePropagation();
    finish();
  };
}

export { ensurePrintButtonPlacement };

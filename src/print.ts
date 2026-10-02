import { mountUpdateNotice } from "./update-notice";
import { ensurePrintButtonPlacement, mountPrintButton } from "./print-button";
import { buildPrintAnswersAppendix } from "./print-appendix";
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

type AnswerPlacement = "inline" | "end";

interface PrePrintState {
  solutions: { el: HTMLDetailsElement; open: boolean }[];
  inputs: { el: HTMLInputElement; checked: boolean }[];
  attributes: { el: Element; name: string; value: string | null }[];
}

// Work only with shared DOM: extension content scripts cannot access the site's
// window.__examState because Chrome runs them in an isolated world.
function prepareAnswers(withAnswers: boolean, placement: AnswerPlacement): PrePrintState {
  const root = document.querySelector(".exam-page-main")!;
  const state: PrePrintState = { solutions: [], inputs: [], attributes: [] };
  if (!withAnswers || placement === "end") return state;

  root.querySelectorAll<HTMLDetailsElement>(".exam-solution").forEach((el) => {
    state.solutions.push({ el, open: el.open });
    el.open = true;
  });
  root.querySelectorAll(".exam-choice-option").forEach((el) => {
    state.attributes.push({ el, name: "class", value: el.getAttribute("class") });
    el.classList.remove("is-correct", "is-wrong", "is-missed");
    const input = el.querySelector<HTMLInputElement>(".exam-choice-input");
    if (input) {
      state.inputs.push({ el: input, checked: input.checked });
      input.checked = el.getAttribute("data-answer") === "true";
    }
  });
  return state;
}

function restoreAnswers(state: PrePrintState): void {
  state.solutions.forEach(({ el, open }) => { el.open = open; });
  state.inputs.forEach(({ el, checked }) => { el.checked = checked; });
  state.attributes.forEach(({ el, name, value }) => {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  });
}

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
        <input id="bdwpPrintInfo" type="checkbox" />
        <span>打印试题概要信息</span>
      </label>
      <label class="bdwp-print-dialog-option bdwp-print-dialog-option-spaced">
        <input id="bdwpPrintAnswers" type="checkbox" checked />
        <span>打印答案</span>
      </label>
      <fieldset id="bdwpPrintAnswerPlacement" class="bdwp-print-dialog-fieldset">
        <legend class="bdwp-print-dialog-legend">答案位置</legend>
        <label class="bdwp-print-dialog-radio">
          <input type="radio" name="bdwpPrintAnswerPlacement" value="inline" />
          <span>放在原题位置</span>
        </label>
        <label class="bdwp-print-dialog-radio">
          <input type="radio" name="bdwpPrintAnswerPlacement" value="end" checked />
          <span>统一放在最后</span>
        </label>
      </fieldset>
      <label class="bdwp-print-dialog-option bdwp-print-dialog-option-spaced bdwp-print-dialog-takeover">
        <input id="bdwpTakeoverPrint" type="checkbox" checked />
        <span>仅扩展接管打印（拦截 Ctrl/Cmd+P 与主站打印按钮）</span>
      </label>
      <div class="bdwp-print-dialog-actions">
        <button id="bdwpPrintDialogCancel" class="bdwp-print-dialog-btn bdwp-print-dialog-btn-secondary" type="button">取消</button>
        <button id="bdwpPrintDialogConfirm" class="bdwp-print-dialog-btn bdwp-print-dialog-btn-primary" type="button">打印</button>
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

  const printAnswersInput = document.getElementById(
    "bdwpPrintAnswers",
  ) as HTMLInputElement | null;
  const printInfoInput = document.getElementById(
    "bdwpPrintInfo",
  ) as HTMLInputElement | null;
  const printAnswerPlacementFieldset = document.getElementById(
    "bdwpPrintAnswerPlacement",
  );
  const takeoverPrintInput = document.getElementById(
    "bdwpTakeoverPrint",
  ) as HTMLInputElement | null;
  const cancelButton = document.getElementById("bdwpPrintDialogCancel");
  const confirmButton = document.getElementById("bdwpPrintDialogConfirm");

  let printAnswersAppendix: HTMLElement | null = null;
  let prePrintState: PrePrintState | null = null;
  let takeoverEnabled = true;
  let printRequested = false;
  let suppressSolutionToggle = false;
  let toggleCleanup: number | undefined;
  let printWithAnswers = true;
  let printWithInfo = false;
  let printAnswerPlacement: AnswerPlacement = "end";

  const getSelectedAnswerPlacement = (): AnswerPlacement => {
    const selected = printAnswerPlacementFieldset?.querySelector(
      'input[name="bdwpPrintAnswerPlacement"]:checked',
    );
    return selected instanceof HTMLInputElement && selected.value === "inline"
      ? "inline"
      : "end";
  };

  const setAnswerPlacementInputs = (placement: AnswerPlacement): void => {
    printAnswerPlacementFieldset
      ?.querySelectorAll('input[name="bdwpPrintAnswerPlacement"]')
      .forEach((input) => {
        if (input instanceof HTMLInputElement) {
          input.checked = input.value === placement;
        }
      });
  };

  const syncPrintAnswerPlacementEnabled = (): void => {
    if (!(printAnswerPlacementFieldset instanceof HTMLFieldSetElement)) return;
    const enabled = printAnswersInput instanceof HTMLInputElement
      ? printAnswersInput.checked
      : true;
    printAnswerPlacementFieldset.disabled = !enabled;
  };

  const openDialog = () => {
    checkUpdates();
    if (printAnswersInput) printAnswersInput.checked = printWithAnswers;
    if (printInfoInput) printInfoInput.checked = printWithInfo;
    setAnswerPlacementInputs(printAnswerPlacement);
    syncPrintAnswerPlacementEnabled();
    void syncTakeoverCheckbox();
    if (!dialog.open) dialog.showModal();
  };

  const syncTakeoverCheckbox = async () => {
    if (!(takeoverPrintInput instanceof HTMLInputElement)) return;
    takeoverPrintInput.checked = await getTakeoverPrint();
  };

  const syncPrintTakeover = async () => {
    takeoverEnabled = await getTakeoverPrint();
    applyPrintTakeover(takeoverEnabled, openDialog);
  };

  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };

  const startPrint = (
    withAnswers: boolean,
    placement: AnswerPlacement,
    withInfo: boolean,
  ) => {
    printWithAnswers = withAnswers;
    printWithInfo = withInfo;
    printAnswerPlacement = withAnswers ? placement : "inline";
    printRequested = true;
    closeDialog();
    try {
      window.print();
    } catch (error) {
      finishPrint();
      throw error;
    }
  };

  mountPrintButton(openDialog);
  void syncPrintTakeover();
  onTakeoverPrintChanged(() => {
    void syncPrintTakeover();
    void syncTakeoverCheckbox();
  });

  takeoverPrintInput?.addEventListener("change", () => {
    if (!(takeoverPrintInput instanceof HTMLInputElement)) return;
    void setTakeoverPrint(takeoverPrintInput.checked).then(() => {
      void syncPrintTakeover();
    });
  });

  // Opening details queues a toggle event. Prevent the site's persistence
  // handler from saving temporary print state, including the restoring toggle.
  document.addEventListener("toggle", (event) => {
    if (suppressSolutionToggle && event.target instanceof Element &&
        event.target.matches(".exam-solution")) {
      event.stopImmediatePropagation();
    }
  }, true);

  const finishPrint = (): void => {
    printAnswersAppendix?.remove();
    printAnswersAppendix = null;
    if (prePrintState) restoreAnswers(prePrintState);
    prePrintState = null;
    printRequested = false;
    delete document.documentElement.dataset.bdwpPrintActive;
    delete document.documentElement.dataset.printAnswers;
    delete document.documentElement.dataset.printAnswerPlacement;
    delete document.documentElement.dataset.bdwpPrintInfo;
    toggleCleanup = window.setTimeout(() => { suppressSolutionToggle = false; }, 0);
  };

  beforePrintHandler = (event) => {
    if (!document.querySelector(".exam-page-main")) return;
    if (!printRequested && !takeoverEnabled) return;
    // Only one implementation may prepare/restore this print.
    event.stopImmediatePropagation();
    if (prePrintState) return;
    window.clearTimeout(toggleCleanup);
    suppressSolutionToggle = true;
    const html = document.documentElement;
    html.dataset.bdwpPrintActive = "true";
    html.dataset.printAnswers = String(printWithAnswers);
    html.dataset.printAnswerPlacement = printAnswerPlacement;
    html.dataset.bdwpPrintInfo = String(printWithInfo);
    prePrintState = prepareAnswers(printWithAnswers, printAnswerPlacement);
    if (printWithAnswers && printAnswerPlacement === "end") {
      printAnswersAppendix = buildPrintAnswersAppendix();
      if (printAnswersAppendix) {
        document.querySelector(".wiki-content")?.appendChild(printAnswersAppendix);
      }
    }
  };

  afterPrintHandler = (event) => {
    if (!prePrintState) return;
    event.stopImmediatePropagation();
    finishPrint();
  };

  printAnswersInput?.addEventListener("change", syncPrintAnswerPlacementEnabled);
  cancelButton?.addEventListener("click", closeDialog);
  confirmButton?.addEventListener("click", () => {
    startPrint(
      printAnswersInput?.checked ?? true,
      getSelectedAnswerPlacement(),
      printInfoInput?.checked ?? false,
    );
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
}

export { ensurePrintButtonPlacement };

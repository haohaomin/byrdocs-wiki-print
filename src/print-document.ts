import { buildPrintAnswersAppendix } from "./print-appendix";

type AnswerPlacement = "inline" | "end";
export interface PrintOptions {
  answers: boolean;
  info: boolean;
  placement: AnswerPlacement;
}

export function preparePrintDocument(options: PrintOptions): HTMLElement | null {
  const source = document.querySelector(".exam-page-main");
  if (!source) return null;

  // Work exclusively on a copy: no answer events or storage writes on the page.
  const printDocument = document.createElement("article");
  printDocument.className = "wiki-content bdwp-print-document";
  printDocument.dataset.answerMode = options.answers ? options.placement : "none";
  const title = document.querySelector("[data-page-heading], .wiki-content h1");
  if (title) printDocument.append(title.cloneNode(true));
  const questions = source.cloneNode(true) as HTMLElement;
  questions.className = "exam-page-main exam-print-questions";
  printDocument.append(questions);

  if (options.answers && options.placement === "end") {
    const appendix = buildPrintAnswersAppendix(questions);
    if (appendix) printDocument.append(appendix);
  }
  if (!options.info) questions.querySelector(".exam-info-box, #examInfoBox, :scope > aside")?.remove();

  printDocument.querySelectorAll(".related-exams, dialog, .exam-choices-submit, .code-toolbar")
    .forEach((element) => element.remove());
  printDocument.querySelectorAll("[id]").forEach((element) => {
    // Preserve IDs inside SVG diagrams, which may be used by clip paths or <use>.
    if (element instanceof HTMLElement) element.removeAttribute("id");
  });
  printDocument.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
    input.checked = false;
    input.removeAttribute("checked");
    // Cloned radio names must not join (and deselect) the original page's groups.
    input.removeAttribute("name");
  });
  // Chromium can split a fieldset despite break-inside: avoid. A plain block
  // keeps each copied option group together without affecting the live form.
  printDocument.querySelectorAll("fieldset.exam-choices").forEach((fieldset) => {
    const group = document.createElement("div");
    for (const attribute of fieldset.attributes) group.setAttribute(attribute.name, attribute.value);
    group.append(...fieldset.childNodes);
    fieldset.replaceWith(group);
  });
  printDocument.querySelectorAll<HTMLDetailsElement>(".exam-solution").forEach((solution) => {
    if (options.answers && (options.placement === "inline" || solution.closest(".print-answers-appendix"))) {
      solution.open = true;
    } else {
      solution.remove();
    }
  });
  printDocument.querySelectorAll(".exam-choice-option").forEach((option) => {
    option.classList.remove("is-correct", "is-wrong", "is-missed");
    if (options.answers && (options.placement === "inline" || option.closest(".print-answers-appendix")) && option.getAttribute("data-answer") === "true") {
      option.classList.add("exam-print-correct");
    }
  });
  printDocument.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const figure = image.closest<HTMLElement>(".exam-figure");
    if (figure && image.matches(".exam-figure-image")) {
      // cloneNode does not copy the live Figure component's error listeners.
      const update = () => {
        if (image.naturalWidth > 0) delete figure.dataset.state;
        else figure.dataset.state = "missing";
      };
      image.addEventListener("load", update);
      image.addEventListener("error", update);
      if (image.complete) update();
    }
    image.loading = "eager";
  });

  const footer = document.createElement("div");
  footer.className = "print-footer";
  const link = document.createElement("a");
  link.href = `${window.location.origin}${window.location.pathname}`;
  link.textContent = decodeURI(link.href);
  const license = document.createElement("a");
  license.href = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
  license.textContent = "CC BY-NC-SA 4.0";
  footer.append("本试卷来自 BYR Docs 维基真题：", link, document.createElement("br"), "除非另有声明，内容采用 ", license, " 授权。");
  printDocument.append(footer);
  document.body.append(printDocument);
  return printDocument;
}


// Adapted from byrdocs-wiki-print v0.1.3 (src/print-appendix.ts).
function findPrecedingHeadings(el: Element): { section: string; subsection: string } {
  const root = el.closest(".exam-page-main, .wiki-content") || document.body;
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((heading) => !heading.closest(".exam-solution, .related-exams"));
  let section = "";
  const subsections: string[] = [];
  for (const heading of headings) {
    if (!(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
    const level = Number(heading.tagName.slice(1));
    const text = (heading.textContent || "").trim();
    if (level <= 2) {
      section = text;
      subsections.length = 0;
    } else {
      // A new h3 closes the preceding h4/h5 hierarchy, for example.
      subsections.length = level - 3;
      subsections[level - 3] = text;
    }
  }
  return { section, subsection: subsections.filter(Boolean).join(" · ") };
}

function listItemNumber(li: Element): string {
  const list = li.parentElement;
  if (!(list instanceof HTMLOListElement)) return "";
  const items = Array.from(list.children).filter(child => child.tagName === "LI");
  const start = Number.parseInt(list.getAttribute("start") || "", 10);
  let number = Number.isFinite(start) ? start : list.reversed ? items.length : 1;
  for (const item of items) {
    const value = Number.parseInt(item.getAttribute("value") || "", 10);
    if (Number.isFinite(value)) number = value;
    if (item === li) return `${number}.`;
    number += list.reversed ? -1 : 1;
  }
  return "";
}

function listItemLabel(li: Element): string {
  const labels: string[] = [];
  let item: Element | null = li;
  while (item) {
    const number = listItemNumber(item);
    if (number) labels.unshift(number);
    item = item.parentElement?.closest("li") ?? null;
  }
  return labels.join(" · ");
}

function findListIndexLabel(el: Element): string {
  const li = el.closest("li");
  if (li) return listItemLabel(li);

  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.matches(".exam-blank, .exam-choices, .exam-solution, h1, h2, h3, h4, h5, h6")) break;
    if (prev.tagName === "OL") {
      const lastItem = Array.from(prev.children).filter(child => child.tagName === "LI").at(-1);
      if (lastItem) return listItemLabel(lastItem);
    }
    const numbered = (prev.textContent || "").trim().match(/^(\d+)\s*[.、]/);
    if (numbered) return `${numbered[1]}.`;
    prev = prev.previousElementSibling;
  }
  return "";
}

function buildLocalAnswerLabel(el: Element, fallbackIndex: number): string {
  if (el.classList.contains("exam-choices")) {
    const choiceText = (el.querySelector(".exam-choices-item")?.textContent || "").trim();
    if (choiceText) {
      const number = choiceText.match(/^第\s*(\d+)\s*题$/)?.[1];
      return number ? `${number}.` : choiceText;
    }
  }
  const { subsection } = findPrecedingHeadings(el);
  const listLabel = findListIndexLabel(el);
  // Headings provide context; they must not replace a question/subquestion number.
  return [subsection, listLabel].filter(Boolean).join(" · ") || `${fallbackIndex}.`;
}

function buildPrintAnswerLabel(el: Element, fallbackIndex: number): string {
  const local = buildLocalAnswerLabel(el, fallbackIndex);
  const headings = findPrecedingHeadings(el);
  if (el.classList.contains("exam-choices")) {
    const choiceText = (el.querySelector(".exam-choices-item")?.textContent || "").trim();
    if (choiceText) return choiceText;
  }
  const parts: string[] = [];
  if (headings.section) parts.push(headings.section);
  if (local) parts.push(local);
  if (parts.length) return parts.join(" · ");
  return String(fallbackIndex);
}

function appendClonedChildren(target: HTMLElement, source: Node): void {
  source.childNodes.forEach((node) => {
    target.appendChild(node.cloneNode(true));
  });
}

function isElementAfter(el: Element, marker: Element): boolean {
  return !!(marker.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function isElementBefore(el: Element, marker: Element): boolean {
  return !!(marker.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
}

function createPrintAnswerItem(
  labelText: string,
  body: HTMLElement,
): HTMLElement {
  const item = document.createElement("div");
  item.className = "print-answer-item";
  if (labelText) {
    const label = document.createElement("div");
    label.className = "print-answer-label";
    label.textContent = labelText;
    item.appendChild(label);
  }
  body.className = "print-answer-body";
  item.appendChild(body);
  return item;
}

function buildAnswerBodyFromSource(source: Element): HTMLElement | null {
  const body = document.createElement("div");
  if (source.classList.contains("exam-blank")) {
    const answer = source.querySelector(".exam-blank-answer");
    if (!(answer instanceof HTMLElement)) return null;
    if (
      !(answer.textContent || "").trim() &&
      !answer.querySelector(".katex, img, svg, math")
    ) {
      return null;
    }
    appendClonedChildren(body, answer);
    return body;
  }
  if (source.classList.contains("exam-choices")) {
    const letters: string[] = [];
    source.querySelectorAll(".exam-choice-option").forEach((opt, index) => {
      if (opt.getAttribute("data-answer") === "true") {
        letters.push(opt.getAttribute("data-choice") || String.fromCharCode(65 + index));
      }
    });
    if (!letters.length) return null;
    body.textContent = letters.join("、");
    return body;
  }
  if (source.classList.contains("exam-solution")) {
    const content = source.querySelector(".exam-solution-content");
    if (!(content instanceof HTMLElement)) return null;
    if (
      !(content.textContent || "").trim() &&
      !content.querySelector(".katex, img, svg, math")
    ) {
      return null;
    }
    appendClonedChildren(body, content);
    return body;
  }
  return null;
}

function createAnswerSection(titleText: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "print-answer-section";
  const title = document.createElement("h3");
  title.className = "print-answer-section-title";
  title.textContent = titleText;
  section.appendChild(title);
  return section;
}

export function buildPrintAnswersAppendix(root: Element): HTMLElement | null {

  const allSources = Array.from(
    root.querySelectorAll(
      ".exam-blank, .exam-choices, .exam-solution",
    ),
  ).filter((el) => !el.closest(".related-exams, .print-answers-appendix") &&
    !el.parentElement?.closest(".exam-solution"));

  const sectionHeadings = Array.from(root.querySelectorAll("h2")).filter(
    (el) => !el.closest(".related-exams, .exam-solution"),
  );

  const appendix = document.createElement("section");
  appendix.className = "print-answers-appendix";
  appendix.setAttribute("aria-label", "答案");

  const title = document.createElement("h2");
  title.className = "print-answers-appendix-title";
  title.textContent = "答案";
  appendix.appendChild(title);

  let itemCount = 0;

  const appendSourceItem = (
    target: HTMLElement,
    source: Element,
    useLocalLabel: boolean,
    sourceIndex: number,
  ): boolean => {
    const body = buildAnswerBodyFromSource(source);
    if (!body) return false;
    itemCount += 1;
    const labelText = useLocalLabel
      ? buildLocalAnswerLabel(source, sourceIndex + 1)
      : buildPrintAnswerLabel(source, sourceIndex + 1);
    target.appendChild(createPrintAnswerItem(labelText, body));
    return true;
  };

  if (!sectionHeadings.length) {
    allSources.forEach((source, index) => {
      appendSourceItem(appendix, source, false, index);
    });
    return itemCount > 0 ? appendix : null;
  }

  const prefaceSources = allSources.filter((source) =>
    isElementBefore(source, sectionHeadings[0]),
  );
  prefaceSources.forEach((source, index) => {
    appendSourceItem(appendix, source, false, index);
  });

  sectionHeadings.forEach((heading, index) => {
    const nextHeading = sectionHeadings[index + 1] || null;
    const headingText =
      (heading.textContent || "").trim() || `第 ${index + 1} 题`;
    const section = createAnswerSection(headingText);
    const sectionSources = allSources.filter((source) => {
      if (!isElementAfter(source, heading)) return false;
      if (nextHeading && !isElementBefore(source, nextHeading)) return false;
      return true;
    });

    // Preserve source order, including descending lists and mixed label styles.
    // Missing answers are skipped without renumbering the remaining sources.
    sectionSources.forEach((source, sourceIndex) => {
      appendSourceItem(section, source, true, sourceIndex);
    });

    if (section.querySelector(".print-answer-item")) {
      appendix.appendChild(section);
    }
  });

  return itemCount > 0 ? appendix : null;
}

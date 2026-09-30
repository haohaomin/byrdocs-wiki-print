type NumberedEntry = { label: string; body: HTMLElement };
type OtherEntry = { label: string; body: HTMLElement };

function findPrecedingHeadings(el: Element): { section: string; subsection: string } {
  const root =
    el.closest(".exam-page-main") ||
    el.closest(".wiki-content") ||
    document.body;
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((heading) => !heading.closest(".exam-solution, .related-exams"));
  let section = "";
  let subsection = "";

  for (let i = headings.length - 1; i >= 0; i -= 1) {
    const heading = headings[i];
    if (!(heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      continue;
    }
    const level = Number(heading.tagName.slice(1));
    const text = (heading.textContent || "").trim();
    if (!text) continue;
    if (level >= 3) {
      if (!subsection) subsection = text;
      continue;
    }
    section = text;
    break;
  }

  return { section, subsection };
}

function findListIndexLabel(el: Element): string {
  const li = el.closest("li");
  if (li?.parentElement) {
    const listParent = li.parentElement;
    let start = Number.parseInt(listParent.getAttribute("start") || "1", 10);
    if (!Number.isFinite(start)) start = 1;
    const items = Array.from(listParent.children).filter(
      (child) => child.tagName === "LI",
    );
    const index = items.indexOf(li);
    if (index >= 0) return String(start + index);
  }

  let prev = el.previousElementSibling;
  while (prev) {
    if (
      prev.classList.contains("exam-blank") ||
      prev.classList.contains("exam-choices") ||
      prev.classList.contains("exam-solution") ||
      /^H[1-6]$/.test(prev.tagName)
    ) {
      break;
    }
    if (prev.tagName === "OL" || prev.tagName === "UL") {
      let listStart = Number.parseInt(prev.getAttribute("start") || "1", 10);
      if (!Number.isFinite(listStart)) listStart = 1;
      const listItems = Array.from(prev.children).filter(
        (child) => child.tagName === "LI",
      );
      if (listItems.length) return String(listStart + listItems.length - 1);
    }
    const prevText = (prev.textContent || "").trim();
    const numbered = prevText.match(/^(\d+)\s*[.、]/);
    if (numbered) return numbered[1];
    prev = prev.previousElementSibling;
  }
  return "";
}

function buildLocalAnswerLabel(
  el: Element,
  fallbackIndex: number,
): { label: string; sort: number | null } {
  if (el.classList.contains("exam-choices")) {
    const choiceText = (el.querySelector(".exam-choices-item")?.textContent || "").trim();
    if (choiceText) {
      const number = choiceText.match(/^第\s*(\d+)\s*题$/)?.[1];
      return number
        ? { label: `${number}.`, sort: Number(number) }
        : { label: choiceText, sort: null };
    }
  }
  const headings = findPrecedingHeadings(el);
  if (headings.subsection) {
    return { label: headings.subsection, sort: null };
  }
  const listIndex = findListIndexLabel(el);
  if (listIndex) {
    return { label: `${listIndex}.`, sort: Number(listIndex) };
  }
  return { label: `${fallbackIndex}.`, sort: fallbackIndex };
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
  if (local.label) parts.push(local.label);
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
  bodyNode: HTMLElement | string,
  options?: { emptySection?: boolean },
): HTMLElement {
  const item = document.createElement("div");
  item.className = "print-answer-item";
  if (options?.emptySection) item.classList.add("is-section-empty");
  if (labelText) {
    const label = document.createElement("div");
    label.className = "print-answer-label";
    label.textContent = labelText;
    item.appendChild(label);
  }
  let body: HTMLElement;
  if (bodyNode instanceof HTMLElement) {
    body = bodyNode;
    body.className = "print-answer-body";
  } else {
    body = document.createElement("div");
    body.className = "print-answer-body";
    body.textContent = bodyNode;
  }
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
    source.querySelectorAll(".exam-choice-option[data-answer='true']").forEach((opt) => {
      const letter = opt.getAttribute("data-choice");
      if (letter) letters.push(letter);
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

function collectQuestionNumbersInRange(
  root: Element,
  startEl: Element,
  endEl: Element | null,
): number[] {
  const nums: number[] = [];
  root.querySelectorAll("ol").forEach((ol) => {
    if (ol.closest(".related-exams, .exam-solution, .exam-choices")) return;
    if (ol.parentElement?.closest("ol, ul")) return;
    if (!isElementAfter(ol, startEl)) return;
    if (endEl && !isElementBefore(ol, endEl)) return;
    let start = Number.parseInt(ol.getAttribute("start") || "1", 10);
    if (!Number.isFinite(start)) start = 1;
    const items = Array.from(ol.children).filter((child) => child.tagName === "LI");
    items.forEach((_item, index) => {
      nums.push(start + index);
    });
  });
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function collectSubsectionHeadingsInRange(
  root: Element,
  startEl: Element,
  endEl: Element | null,
): Element[] {
  return Array.from(root.querySelectorAll("h3")).filter((heading) => {
    if (heading.closest(".related-exams, .exam-solution")) return false;
    if (!isElementAfter(heading, startEl)) return false;
    if (endEl && !isElementBefore(heading, endEl)) return false;
    return !!(heading.textContent || "").trim();
  });
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

export function buildPrintAnswersAppendix(): HTMLElement | null {
  const root =
    document.querySelector(".wiki-content .exam-page-main") ||
    document.querySelector(".wiki-content");
  if (!root) return null;

  const allSources = Array.from(
    root.querySelectorAll(
      ".exam-blank[aria-pressed], .exam-choices[data-has-answer='true'], .exam-solution",
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
  ): boolean => {
    const body = buildAnswerBodyFromSource(source);
    if (!body) return false;
    itemCount += 1;
    const labelText = useLocalLabel
      ? buildLocalAnswerLabel(source, itemCount).label
      : buildPrintAnswerLabel(source, itemCount);
    target.appendChild(createPrintAnswerItem(labelText, body));
    return true;
  };

  if (!sectionHeadings.length) {
    allSources.forEach((source) => {
      appendSourceItem(appendix, source, false);
    });
    return itemCount > 0 ? appendix : null;
  }

  const prefaceSources = allSources.filter((source) =>
    isElementBefore(source, sectionHeadings[0]),
  );
  prefaceSources.forEach((source) => {
    appendSourceItem(appendix, source, false);
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

    const numberedEntries: Record<number, NumberedEntry[]> = {};
    const otherEntries: OtherEntry[] = [];
    sectionSources.forEach((source) => {
      const body = buildAnswerBodyFromSource(source);
      if (!body) return;
      const local = buildLocalAnswerLabel(
        source,
        Object.keys(numberedEntries).length + otherEntries.length + 1,
      );
      if (local.sort != null && Number.isFinite(local.sort)) {
        if (!numberedEntries[local.sort]) {
          numberedEntries[local.sort] = [];
        }
        numberedEntries[local.sort].push({ label: local.label, body });
      } else {
        otherEntries.push({ label: local.label, body });
      }
    });

    let expectedNumbers = collectQuestionNumbersInRange(root, heading, nextHeading);
    const numberedKeys = Object.keys(numberedEntries)
      .map(Number)
      .sort((a, b) => a - b);
    if (!expectedNumbers.length && numberedKeys.length) {
      const maxNum = numberedKeys[numberedKeys.length - 1];
      const minNum = numberedKeys[0];
      for (let n = minNum; n <= maxNum; n += 1) expectedNumbers.push(n);
    }

    if (expectedNumbers.length) {
      expectedNumbers.forEach((num) => {
        const entries = numberedEntries[num];
        if (entries?.length) {
          entries.forEach((entry) => {
            itemCount += 1;
            section.appendChild(createPrintAnswerItem(entry.label, entry.body));
          });
          delete numberedEntries[num];
        } else {
          itemCount += 1;
          section.appendChild(createPrintAnswerItem(`${num}.`, "暂无答案"));
        }
      });
      Object.keys(numberedEntries)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach((num) => {
          numberedEntries[num].forEach((entry) => {
            itemCount += 1;
            section.appendChild(createPrintAnswerItem(entry.label, entry.body));
          });
        });
    } else {
      numberedKeys.forEach((num) => {
        numberedEntries[num].forEach((entry) => {
          itemCount += 1;
          section.appendChild(createPrintAnswerItem(entry.label, entry.body));
        });
      });
    }

    otherEntries.forEach((entry) => {
      itemCount += 1;
      section.appendChild(createPrintAnswerItem(entry.label, entry.body));
    });

    if (!section.querySelector(".print-answer-item")) {
      const subsections = collectSubsectionHeadingsInRange(root, heading, nextHeading);
      if (subsections.length) {
        subsections.forEach((subheading) => {
          itemCount += 1;
          section.appendChild(
            createPrintAnswerItem((subheading.textContent || "").trim(), "暂无答案"),
          );
        });
      } else {
        itemCount += 1;
        section.appendChild(createPrintAnswerItem("", "暂无答案", { emptySection: true }));
      }
    }

    appendix.appendChild(section);
  });

  return itemCount > 0 ? appendix : null;
}

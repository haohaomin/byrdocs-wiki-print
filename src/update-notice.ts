import { DOWNLOAD_URL, RELEASES_URL, UPDATE_STATE_KEY, isNewerVersion, type UpdateState } from "./updates";

/** Network access belongs to the extension worker, never the wiki page. */
export function mountUpdateNotice(dialog: HTMLDialogElement): () => void {
  if (typeof chrome === "undefined" || !chrome.runtime?.getManifest || !chrome.storage?.local) return () => {};
  const notice = document.createElement("div");
  notice.className = "bdwp-update-notice";
  notice.hidden = true;
  const text = document.createElement("p");
  const download = document.createElement("a");
  download.textContent = "下载新版";
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  const details = document.createElement("a");
  details.textContent = "版本说明";
  details.href = RELEASES_URL;
  details.target = "_blank";
  details.rel = "noopener noreferrer";
  const help = document.createElement("small");
  help.textContent = "解压覆盖原目录 → 重新加载扩展 → 刷新试卷页";
  notice.append(text, download, details, help);
  dialog.querySelector(".bdwp-print-dialog-actions")?.before(notice);
  const render = (state: UpdateState) => {
    notice.hidden = !isNewerVersion(state.latestVersion, chrome.runtime.getManifest().version);
    text.textContent = `发现新版 v${state.latestVersion ?? ""}`;
    download.href = state.hasDownload ? DOWNLOAD_URL : RELEASES_URL;
  };
  void chrome.storage.local.get(UPDATE_STATE_KEY).then(data => render(data[UPDATE_STATE_KEY] as UpdateState ?? {})).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[UPDATE_STATE_KEY]) render(changes[UPDATE_STATE_KEY].newValue as UpdateState ?? {});
  });
  return () => {
    void chrome.runtime.sendMessage({ type: "bdwp-check-update" }).then(render).catch(() => {});
  };
}

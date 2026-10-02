import { getTakeoverPrint, setTakeoverPrint } from "./settings";
import { DOWNLOAD_URL, RELEASES_URL, UPDATE_STATE_KEY, isNewerVersion, type UpdateState } from "./updates";

const checkbox = document.getElementById("takeoverPrint") as HTMLInputElement;
const status = document.getElementById("status")!;
void getTakeoverPrint().then(value => { checkbox.checked = value; });
checkbox.addEventListener("change", () => {
  void setTakeoverPrint(checkbox.checked).then(() => {
    status.textContent = "已保存";
    window.setTimeout(() => { status.textContent = ""; }, 1200);
  });
});

const currentVersion = chrome.runtime.getManifest().version;
const version = document.getElementById("currentVersion")!;
const updateStatus = document.getElementById("updateStatus")!;
const checkedAt = document.getElementById("checkedAt")!;
const checkButton = document.getElementById("checkUpdates") as HTMLButtonElement;
const download = document.getElementById("downloadUpdate") as HTMLAnchorElement;
const release = document.getElementById("releaseNotes") as HTMLAnchorElement;
version.textContent = `当前版本 v${currentVersion}`;
release.href = RELEASES_URL;

function render(state: UpdateState): void {
  const available = isNewerVersion(state.latestVersion, currentVersion);
  const message = available ? `发现新版 v${state.latestVersion}`
    : state.checkedAt ? "当前无需更新。" : "尚未成功检查更新。";
  updateStatus.textContent = state.error ? `${available ? message + "。" : ""}${state.error}` : message;
  updateStatus.classList.toggle("error", !!state.error);
  download.hidden = !available;
  download.href = state.hasDownload ? DOWNLOAD_URL : RELEASES_URL;
  checkedAt.textContent = state.checkedAt
    ? `上次成功检查：${new Date(state.checkedAt).toLocaleString("zh-CN")}` : "";
}

async function check(force = false): Promise<void> {
  checkButton.disabled = true;
  checkButton.textContent = "正在检查…";
  try {
    render(await chrome.runtime.sendMessage({ type: "bdwp-check-update", force }));
  } catch {
    updateStatus.textContent = "无法连接更新服务，请重新加载扩展后重试。";
    updateStatus.classList.add("error");
  } finally {
    checkButton.disabled = false;
    checkButton.textContent = "检查更新";
  }
}
checkButton.addEventListener("click", () => { void check(true); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[UPDATE_STATE_KEY]) render(changes[UPDATE_STATE_KEY].newValue as UpdateState ?? {});
});
void chrome.storage.local.get(UPDATE_STATE_KEY).then(data => {
  render(data[UPDATE_STATE_KEY] as UpdateState ?? {});
  return check();
}).catch(() => {
  updateStatus.textContent = "无法读取更新状态，请重新加载扩展后重试。";
});

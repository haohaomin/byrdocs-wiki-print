import { createUpdateChecker, fetchLatestRelease, UPDATE_STATE_KEY, type UpdateState } from "./updates";

const ALARM_NAME = "check-github-release";
const check = createUpdateChecker({
  read: async () => (await chrome.storage.local.get(UPDATE_STATE_KEY))[UPDATE_STATE_KEY] as UpdateState ?? {},
  write: state => chrome.storage.local.set({ [UPDATE_STATE_KEY]: state }),
  now: Date.now,
  fetchRelease: fetchLatestRelease,
});

async function ensureAlarm(): Promise<void> {
  if (!await chrome.alarms.get(ALARM_NAME)) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  }
}

function start(): void {
  void ensureAlarm().catch(console.error);
  void check().catch(console.error);
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) void check().catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "bdwp-check-update") return;
  void check(message.force === true).then(sendResponse, () => {
    sendResponse({ error: "无法读取更新状态，请重新加载扩展后重试。" });
  });
  return true;
});
// Chrome may clear alarms between browser sessions; recreate it on worker startup.
void ensureAlarm().catch(console.error);

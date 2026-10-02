declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
    const onChanged: {
      addListener(
        callback: (
          changes: Record<string, chrome.storage.StorageChange>,
          areaName: string,
        ) => void,
      ): void;
    };
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
  }
}

declare namespace chrome {
  namespace runtime {
    const id: string;
    function getManifest(): { version: string };
    function sendMessage(message: unknown): Promise<import("./updates").UpdateState>;
    const onInstalled: { addListener(callback: () => void): void };
    const onStartup: { addListener(callback: () => void): void };
    const onMessage: {
      addListener(callback: (
        message: { type?: string; force?: boolean },
        sender: { id?: string },
        sendResponse: (response: import("./updates").UpdateState) => void,
      ) => boolean | void): void;
    };
  }
  namespace alarms {
    function get(name: string): Promise<{ name: string } | undefined>;
    function create(name: string, info: { periodInMinutes: number }): Promise<void> | void;
    const onAlarm: { addListener(callback: (alarm: { name: string }) => void): void };
  }
}

import type { Status } from "./timer.ts";

// 새 버전 정보. src-tauri/src/update.rs의 UpdateInfo(camelCase)와 같은 모양이다.
export type UpdateInfo = { current: string; latest: string; tag: string; htmlUrl: string };

export type UpdateState =
  | { kind: "none" }
  // 수동 확인 결과 안내("최신 버전입니다" 등). 설치할 것이 없다.
  | { kind: "notice"; message: string }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; percent: number | null }
  | { kind: "failed"; info: UpdateInfo; message: string };

export type BannerView = {
  visible: boolean;
  text: string;
  showInstall: boolean;
  installLabel: string;
  installDisabled: boolean;
  showRelease: boolean;
  showLater: boolean;
  laterLabel: string;
};

const RELEASES_URL = "https://github.com/sungback/cat_timer2/releases";

// 타이머가 돌아가는 중이거나 일시정지 중일 때 앱을 종료·교체하면 진행 상황을 잃으므로 막는다.
export function canInstall(timer: Status): boolean {
  return timer === "idle" || timer === "finished";
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

// Rust가 보내는 진행률 이벤트의 payload에서 퍼센트만 꺼낸다. 알 수 없으면 null.
export function normalizeProgress(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const percent = (payload as { percent?: unknown }).percent;
  return typeof percent === "number" && Number.isFinite(percent) ? clampPercent(percent) : null;
}

export function formatProgress(percent: number | null): string {
  return percent === null ? "업데이트를 내려받는 중..." : `업데이트를 내려받는 중... ${clampPercent(percent)}%`;
}

export function bannerView(state: UpdateState, timer: Status): BannerView {
  const hidden: BannerView = {
    visible: false,
    text: "",
    showInstall: false,
    installLabel: "",
    installDisabled: false,
    showRelease: false,
    showLater: false,
    laterLabel: "나중에",
  };
  switch (state.kind) {
    case "none":
      return hidden;
    case "notice":
      return { ...hidden, visible: true, text: state.message, showLater: true, laterLabel: "닫기" };
    case "available": {
      const ready = canInstall(timer);
      const base = `새 버전 v${state.info.latest}이 있습니다. (현재 v${state.info.current})`;
      return {
        visible: true,
        text: ready ? base : `${base} 타이머가 끝나면 업데이트할 수 있습니다.`,
        showInstall: true,
        installLabel: "업데이트",
        installDisabled: !ready,
        showRelease: false,
        showLater: true,
        laterLabel: "나중에",
      };
    }
    case "downloading":
      return { ...hidden, visible: true, text: formatProgress(state.percent) };
    case "failed":
      return {
        visible: true,
        text: `업데이트하지 못했습니다. ${state.message}`,
        showInstall: true,
        installLabel: "다시 시도",
        installDisabled: !canInstall(timer),
        showRelease: true,
        showLater: true,
        laterLabel: "나중에",
      };
  }
}

// --- Tauri 연결부 (브라우저에서는 window.__TAURI__가 없으므로 아무것도 하지 않는다) ---

type TauriBridge = {
  core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
  event: {
    listen: <T>(name: string, handler: (event: { payload: T }) => void) => Promise<() => void>;
  };
  app: { getVersion: () => Promise<string> };
};

function tauriBridge(): TauriBridge | null {
  return (window as unknown as { __TAURI__?: TauriBridge }).__TAURI__ ?? null;
}

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const CHECK_DELAY_MS = 2000;

// 배너를 연결한다. 시작 후 잠깐 뒤에 버전을 표시하고 새 버전을 확인한다.
// 확인 실패(오프라인 등)는 조용히 넘어가고, 설치는 사용자가 [업데이트]를 눌렀을 때만 시작한다.
export function initUpdater(getTimerStatus: () => Status): { refresh: () => void } {
  const banner = byId<HTMLDivElement>("update-banner");
  const text = byId<HTMLSpanElement>("update-text");
  const installButton = byId<HTMLButtonElement>("update-install");
  const releaseButton = byId<HTMLButtonElement>("update-release");
  const laterButton = byId<HTMLButtonElement>("update-later");
  const versionLabel = byId<HTMLSpanElement>("app-version");
  const checkButton = byId<HTMLButtonElement>("update-check");
  if (!banner || !text || !installButton || !releaseButton || !laterButton) {
    return { refresh: () => {} };
  }

  let state: UpdateState = { kind: "none" };

  function render(): void {
    const view = bannerView(state, getTimerStatus());
    banner!.hidden = !view.visible;
    text!.textContent = view.text;
    installButton!.hidden = !view.showInstall;
    installButton!.textContent = view.installLabel;
    installButton!.disabled = view.installDisabled;
    releaseButton!.hidden = !view.showRelease;
    laterButton!.hidden = !view.showLater;
    laterButton!.textContent = view.laterLabel;
  }

  // await 뒤에는 state가 바뀌었을 수 있다. TS가 앞선 검사로 타입을 좁히지 않도록 함수로 묶는다.
  function isDownloading(): boolean {
    return state.kind === "downloading";
  }

  // 수동 확인. 내려받는 중에는 건드리지 않는다. 결과는 배너로 알린다.
  async function checkNow(): Promise<void> {
    const bridge = tauriBridge();
    if (!checkButton || isDownloading()) return;
    if (!bridge) {
      state = { kind: "notice", message: "업데이트 확인은 설치한 앱에서만 쓸 수 있습니다." };
      render();
      return;
    }
    checkButton.disabled = true;
    checkButton.textContent = "확인 중...";
    try {
      const info = await bridge.core.invoke<UpdateInfo | null>("check_update_manual");
      if (isDownloading()) return;
      if (info) {
        state = { kind: "available", info };
      } else {
        const version = await bridge.app.getVersion().catch(() => "");
        state = { kind: "notice", message: `최신 버전입니다.${version ? ` (v${version})` : ""}` };
      }
    } catch (error) {
      if (isDownloading()) return;
      state = { kind: "notice", message: `업데이트를 확인하지 못했습니다. ${String(error)}` };
    } finally {
      checkButton.disabled = false;
      checkButton.textContent = "업데이트 확인";
      render();
    }
  }

  async function install(): Promise<void> {
    const bridge = tauriBridge();
    if ((state.kind !== "available" && state.kind !== "failed") || !bridge) return;
    if (!canInstall(getTimerStatus())) return;
    const info = state.info;
    state = { kind: "downloading", info, percent: null };
    render();
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await bridge.event.listen<unknown>("update-progress", (event) => {
        if (state.kind === "downloading") {
          state = { kind: "downloading", info, percent: normalizeProgress(event.payload) };
          render();
        }
      });
      // 성공하면 앱이 종료되고 도우미가 교체·재실행하므로 이 줄 아래는 보통 실행되지 않는다.
      await bridge.core.invoke("apply_update");
    } catch (error) {
      state = { kind: "failed", info, message: String(error) };
      render();
    } finally {
      unlisten?.();
    }
  }

  async function openReleasePage(): Promise<void> {
    const bridge = tauriBridge();
    if (!bridge || (state.kind !== "failed" && state.kind !== "available")) return;
    try {
      await bridge.core.invoke("open_release_page", { url: state.info.htmlUrl || RELEASES_URL });
    } catch {
      // 열지 못해도 할 수 있는 일이 없다. 배너는 그대로 둔다.
    }
  }

  checkButton?.addEventListener("click", () => void checkNow());
  installButton.addEventListener("click", () => void install());
  releaseButton.addEventListener("click", () => void openReleasePage());
  laterButton.addEventListener("click", () => {
    state = { kind: "none" };
    render();
  });

  window.setTimeout(() => {
    const bridge = tauriBridge();
    if (!bridge) return; // 브라우저에서는 업데이트 기능이 없다.
    bridge.app
      .getVersion()
      .then((version) => {
        if (versionLabel) versionLabel.textContent = `v${version}`;
      })
      .catch(() => {});
    bridge.core
      .invoke<UpdateInfo | null>("check_update")
      .then((info) => {
        if (info && state.kind === "none") {
          state = { kind: "available", info };
          render();
        }
      })
      .catch(() => {});
  }, CHECK_DELAY_MS);

  render();
  return { refresh: render };
}

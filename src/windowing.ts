// 창 동작(전체화면, 항상 위). Tauri 앱에서는 창 API를, 브라우저에서는 Fullscreen API를 쓴다.
// 항상 위에 표시는 Tauri 앱에서만 가능하다(브라우저에서는 버튼을 숨긴다).

type TauriWindow = {
  isFullscreen: () => Promise<boolean>;
  setFullscreen: (fullscreen: boolean) => Promise<void>;
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
};

function tauriWindow(): TauriWindow | null {
  const tauri = (window as unknown as {
    __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } };
  }).__TAURI__;
  try {
    return tauri?.window?.getCurrentWindow?.() ?? null;
  } catch {
    return null;
  }
}

export function canPinWindow(): boolean {
  return tauriWindow() !== null;
}

export async function isFullscreen(): Promise<boolean> {
  const win = tauriWindow();
  if (win) {
    try {
      return await win.isFullscreen();
    } catch {
      return false;
    }
  }
  return document.fullscreenElement !== null;
}

// 전체화면을 켜거나 끈다. 실패하면 예외를 던진다.
export async function setFullscreen(on: boolean): Promise<void> {
  const win = tauriWindow();
  if (win) {
    await win.setFullscreen(on);
    return;
  }
  if (on) await document.documentElement.requestFullscreen();
  else if (document.fullscreenElement) await document.exitFullscreen();
}

// 항상 위에 표시를 켜거나 끈다. Tauri가 아니면 아무것도 하지 않고 false를 돌려준다.
export async function setAlwaysOnTop(on: boolean): Promise<boolean> {
  const win = tauriWindow();
  if (!win) return false;
  await win.setAlwaysOnTop(on);
  return true;
}

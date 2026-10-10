import { DEFAULT_MINUTES, parseMinutes } from "./timer.ts";

// 마지막으로 쓴 분 설정을 기억한다. localStorage를 못 쓰는 환경(차단·비공개 창 등)에서는 조용히 기본값을 쓴다.
const MINUTES_KEY = "cattimer2.minutes";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// 저장된 값이 없거나 범위를 벗어나거나 읽을 수 없으면 기본값(15분)을 돌려준다.
export function loadMinutes(storage: StorageLike | null): number {
  if (!storage) return DEFAULT_MINUTES;
  try {
    const raw = storage.getItem(MINUTES_KEY);
    return raw === null ? DEFAULT_MINUTES : (parseMinutes(raw) ?? DEFAULT_MINUTES);
  } catch {
    return DEFAULT_MINUTES;
  }
}

export function saveMinutes(storage: StorageLike | null, minutes: number): void {
  if (!storage) return;
  try {
    storage.setItem(MINUTES_KEY, String(minutes));
  } catch {
    // 저장하지 못해도 타이머 동작에는 영향이 없다.
  }
}

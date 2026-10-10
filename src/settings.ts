import { DEFAULT_MINUTES, parseMinutes } from "./timer.ts";

// 마지막으로 쓴 분 설정을 기억한다. localStorage를 못 쓰는 환경(차단·비공개 창 등)에서는 조용히 기본값을 쓴다.
const MINUTES_KEY = "cattimer2.minutes";
const ALWAYS_ON_TOP_KEY = "cattimer2.alwaysOnTop";
const VOLUME_KEY = "cattimer2.volume";
const MUTED_KEY = "cattimer2.muted";
export const DEFAULT_VOLUME = 100;

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

// 항상 위에 표시 설정. 저장된 값이 "1"일 때만 켜진 것으로 본다.
export function loadAlwaysOnTop(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ALWAYS_ON_TOP_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAlwaysOnTop(storage: StorageLike | null, on: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(ALWAYS_ON_TOP_KEY, on ? "1" : "0");
  } catch {
    // 저장하지 못해도 이번 실행의 동작에는 영향이 없다.
  }
}

// 알림음 볼륨(0~100 정수). 없거나 이상한 값이면 100.
export function parseVolume(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw.trim())) return DEFAULT_VOLUME;
  const value = Number(raw);
  return value > 100 ? DEFAULT_VOLUME : value;
}

export function loadVolume(storage: StorageLike | null): number {
  if (!storage) return DEFAULT_VOLUME;
  try {
    return parseVolume(storage.getItem(VOLUME_KEY));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(storage: StorageLike | null, volume: number): void {
  if (!storage) return;
  try {
    storage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // 저장하지 못해도 이번 실행의 동작에는 영향이 없다.
  }
}

// 알림음 끄기. 저장된 값이 "1"일 때만 꺼진 것으로 본다.
export function loadMuted(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMuted(storage: StorageLike | null, isMuted: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(MUTED_KEY, isMuted ? "1" : "0");
  } catch {
    // 저장하지 못해도 이번 실행의 동작에는 영향이 없다.
  }
}

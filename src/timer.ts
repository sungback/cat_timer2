export const MS_PER_BLOCK = 60_000; // 블록 하나 = 1분
export const DEFAULT_MINUTES = 15;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;

export type Status = "idle" | "running" | "paused" | "finished";

// 입력값을 분 단위 정수로 변환한다. 범위를 벗어나거나 정수가 아니면 null.
export function parseMinutes(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) return null;
  return minutes;
}

// 남은 시간을 mm:ss로 표시한다. 초 단위는 올림해서 시작 때 15:00, 끝날 때 00:00이 된다.
export function formatRemaining(elapsedMs: number, totalMs: number): string {
  const seconds = Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// 블록 수는 총 시간(분)과 같다. 5분이면 5개, 15분이면 15개.
export function blockCountFor(totalMs: number): number {
  return Math.max(1, Math.round(totalMs / MS_PER_BLOCK));
}

// 블록별 진행률(0 = 그대로, 1 = 완전히 사라짐). 블록은 총 시간을 균등 분할해 순서대로 사라진다.
export function blockProgress(
  elapsedMs: number,
  totalMs: number,
  blockCount: number = blockCountFor(totalMs),
): number[] {
  const perBlockMs = totalMs / blockCount;
  return Array.from({ length: blockCount }, (_, index) => {
    const progress = elapsedMs / perBlockMs - index;
    return Math.min(1, Math.max(0, progress));
  });
}

// 경과 시간은 setInterval 횟수가 아니라 시계(now) 차이로 계산한다.
// 탭이 백그라운드에서 느려져도 오차가 쌓이지 않는다.
export class Countdown {
  status: Status = "idle";
  totalMs: number;
  private accumulatedMs = 0;
  private startedAt = 0;
  private readonly now: () => number;

  constructor(totalMs: number, now: () => number = () => performance.now()) {
    this.totalMs = totalMs;
    this.now = now;
  }

  get elapsedMs(): number {
    const running = this.status === "running" ? this.now() - this.startedAt : 0;
    return Math.min(this.totalMs, this.accumulatedMs + running);
  }

  start(): void {
    if (this.status === "running") return;
    if (this.status === "finished") this.reset();
    this.startedAt = this.now();
    this.status = "running";
  }

  pause(): void {
    if (this.status !== "running") return;
    this.accumulatedMs = this.elapsedMs;
    this.status = "paused";
  }

  reset(): void {
    this.accumulatedMs = 0;
    this.status = "idle";
  }

  // 대기·종료 상태에서만 총 시간을 바꿀 수 있다. 바꾸면 처음 상태로 돌아간다.
  setTotal(totalMs: number): boolean {
    if (this.status === "running" || this.status === "paused") return false;
    this.totalMs = totalMs;
    this.reset();
    return true;
  }

  // 시간이 다 됐으면 finished로 바꾸고, 이번 호출에서 막 끝났을 때만 true를 돌려준다.
  tick(): boolean {
    if (this.status !== "running" || this.elapsedMs < this.totalMs) return false;
    this.accumulatedMs = this.totalMs;
    this.status = "finished";
    return true;
  }
}

export type TimerKeyAction = "toggle" | "reset";

// 키보드 단축키: Space = 시작/일시정지, R = 리셋. 한글 자판에서도 되도록 key가 아니라 물리 키(code)로 판단한다.
export function timerKeyAction(code: string): TimerKeyAction | null {
  if (code === "Space") return "toggle";
  if (code === "KeyR") return "reset";
  return null;
}

// 종료 알림("시간 종료!")을 보여 줄지. 종료 상태이고 사용자가 닫지 않았을 때만 보인다.
export function finishNoticeVisible(status: Status, dismissed: boolean): boolean {
  return status === "finished" && !dismissed;
}

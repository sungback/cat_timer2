import "./style.css";
import { playAlarm, unlockAlarm } from "./alarm.ts";
import { catStepForKey, pickCatIndex, stepCatIndex } from "./cats.ts";
import { initUpdater } from "./updater.ts";
import {
  Countdown,
  DEFAULT_MINUTES,
  MAX_MINUTES,
  MIN_MINUTES,
  blockCountFor,
  blockProgress,
  formatRemaining,
  parseMinutes,
  type Status,
} from "./timer.ts";

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} 요소를 찾을 수 없습니다.`);
  return element as T;
}

const background = getElement<HTMLImageElement>("background");
const blocksRoot = getElement<HTMLDivElement>("blocks");
const minutesInput = getElement<HTMLInputElement>("minutes");
const toggleButton = getElement<HTMLButtonElement>("toggle");
const resetButton = getElement<HTMLButtonElement>("reset");
const prevCatButton = getElement<HTMLButtonElement>("prev-cat");
const nextCatButton = getElement<HTMLButtonElement>("next-cat");
const statusText = getElement<HTMLSpanElement>("status");
const remainingText = getElement<HTMLDivElement>("remaining");

const STATUS_LABEL: Record<Status, string> = {
  idle: "대기 중",
  running: "진행 중",
  paused: "일시정지",
  finished: "시간 종료",
};
const TOGGLE_LABEL: Record<Status, string> = {
  idle: "시작",
  running: "일시정지",
  paused: "계속",
  finished: "다시 시작",
};

const countdown = new Countdown(DEFAULT_MINUTES * 60_000);
// 새 버전 알림 배너. Tauri 앱 안에서만 동작한다(브라우저에서는 아무 일도 하지 않음).
const updater = initUpdater(() => countdown.status);
// src/assets/cats 폴더의 사진을 모두 모은다. 파일을 넣고 빼면 목록이 바뀐다(개발 서버 재시작 불필요, 빌드 시 반영).
// 이전/다음 버튼이 이 순서(파일명 숫자 순서)대로 사진을 넘긴다.
const catUrls = Object.entries(
  import.meta.glob("./assets/cats/*.{webp,jpg,jpeg,png}", {
    query: "?url",
    import: "default",
    eager: true,
    caseSensitive: false,
  }),
)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, url]) => url);
let catIndex: number | null = null;
let shownMinutes = DEFAULT_MINUTES;

// 숫자를 적을 수 있는 최대 블록 수. 이보다 많으면 칸이 좁아 숫자를 숨긴다.
const MAX_LABELED_BLOCKS = 30;
let blockElements: HTMLDivElement[] = [];

// 블록을 총 시간(분)만큼 다시 만든다.
function buildBlocks(): void {
  const count = blockCountFor(countdown.totalMs);
  blocksRoot.style.setProperty("--block-count", String(count));
  blocksRoot.classList.toggle("unlabeled", count > MAX_LABELED_BLOCKS);
  blockElements = Array.from({ length: count }, (_, index) => {
    const block = document.createElement("div");
    block.className = "block";
    block.textContent = String(index + 1);
    return block;
  });
  blocksRoot.replaceChildren(...blockElements);
}

// 직전과 다른 사진을 무작위로 보여 준다. 사진이 없으면 아무것도 하지 않는다.
function showRandomCat(): void {
  if (catUrls.length === 0) return;
  catIndex = pickCatIndex(catIndex, catUrls.length);
  background.src = catUrls[catIndex];
}

function renderBlocks(): void {
  remainingText.textContent = formatRemaining(countdown.elapsedMs, countdown.totalMs);
  const progress = blockProgress(countdown.elapsedMs, countdown.totalMs);
  blockElements.forEach((block, index) => {
    block.style.setProperty("--wiped", `${progress[index] * 100}%`);
  });
}

function renderControls(): void {
  const { status } = countdown;
  toggleButton.textContent = TOGGLE_LABEL[status];
  statusText.textContent = STATUS_LABEL[status];
  resetButton.disabled = status === "idle";
  minutesInput.disabled = status === "running" || status === "paused";
  // 타이머 상태가 바뀌면 배너의 [업데이트] 버튼 활성 여부도 다시 계산한다.
  updater.refresh();
}

function finishIfDone(): void {
  if (!countdown.tick()) return;
  playAlarm();
  renderBlocks();
  renderControls();
}

// 화면 갱신은 requestAnimationFrame, 종료 감지는 setInterval로 나눈다.
// 탭이 가려지면 rAF가 멈추지만 setInterval은 (느려도) 계속 돌아서 알림음이 제때 울린다.
function frame(): void {
  if (countdown.status === "running") {
    finishIfDone();
    renderBlocks();
  }
  requestAnimationFrame(frame);
}
setInterval(finishIfDone, 500);

toggleButton.addEventListener("click", () => {
  unlockAlarm();
  if (countdown.status === "running") {
    countdown.pause();
  } else {
    // 처음부터 시작할 때만 새 사진을 고른다. 일시정지에서 계속할 때는 그대로 둔다.
    if (countdown.status === "idle" || countdown.status === "finished") showRandomCat();
    countdown.start();
  }
  renderBlocks();
  renderControls();
});

resetButton.addEventListener("click", () => {
  countdown.reset();
  renderBlocks();
  renderControls();
});

// 사진만 순서대로 넘긴다. 타이머 상태와 진행 시간은 건드리지 않는다.
function showStepCat(delta: 1 | -1): void {
  if (catUrls.length === 0) return;
  catIndex = stepCatIndex(catIndex, delta, catUrls.length);
  background.src = catUrls[catIndex];
}
prevCatButton.addEventListener("click", () => showStepCat(-1));
nextCatButton.addEventListener("click", () => showStepCat(1));
prevCatButton.disabled = nextCatButton.disabled = catUrls.length <= 1;

// 방향키 ←/→로도 사진을 넘긴다. 분 입력창 등에서 타이핑 중이거나 Alt/Cmd+←(브라우저 뒤로 가기) 같은
// 조합키, 키를 누르고 있어서 반복되는 입력은 무시한다.
document.addEventListener("keydown", (event) => {
  const delta = catStepForKey(event.key);
  if (delta === null || event.defaultPrevented || event.repeat) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  showStepCat(delta);
});

minutesInput.addEventListener("change", () => {
  const minutes = parseMinutes(minutesInput.value);
  if (minutes === null) {
    // 잘못된 입력은 직전 값으로 되돌린다.
    minutesInput.value = String(shownMinutes);
    minutesInput.setAttribute("title", `${MIN_MINUTES}~${MAX_MINUTES} 사이의 정수를 입력하세요`);
    return;
  }
  if (!countdown.setTotal(minutes * 60_000)) {
    minutesInput.value = String(shownMinutes);
    return;
  }
  shownMinutes = minutes;
  minutesInput.value = String(minutes);
  buildBlocks();
  renderBlocks();
  renderControls();
});

showRandomCat();
buildBlocks();
renderBlocks();
renderControls();
requestAnimationFrame(frame);

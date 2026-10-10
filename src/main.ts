import "./style.css";
import { playAlarm, playPreview, setAlarmSound, unlockAlarm } from "./alarm.ts";
import { catStepForKey, pickCatIndex, stepCatIndex } from "./cats.ts";
import {
  browserStorage,
  DEFAULT_VOLUME,
  loadAlwaysOnTop,
  loadMinutes,
  loadMuted,
  loadVolume,
  saveAlwaysOnTop,
  saveMinutes,
  saveMuted,
  saveVolume,
} from "./settings.ts";
import { initUpdater } from "./updater.ts";
import { canPinWindow, isFullscreen, setAlwaysOnTop, setFullscreen } from "./windowing.ts";
import {
  Countdown,
  MAX_MINUTES,
  MIN_MINUTES,
  MS_PER_BLOCK,
  blockCountFor,
  blockProgress,
  finishNoticeVisible,
  formatRemaining,
  parseMinutes,
  timerKeyAction,
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
const shrinkButton = getElement<HTMLButtonElement>("shrink");
const extendButton = getElement<HTMLButtonElement>("extend");
const prevCatButton = getElement<HTMLButtonElement>("prev-cat");
const nextCatButton = getElement<HTMLButtonElement>("next-cat");
const statusText = getElement<HTMLSpanElement>("status");
const remainingText = getElement<HTMLDivElement>("remaining");
const muteButton = getElement<HTMLButtonElement>("mute");
const volumeInput = getElement<HTMLInputElement>("volume");
const pinButton = getElement<HTMLButtonElement>("pin");
const fullscreenButton = getElement<HTMLButtonElement>("fullscreen");
const finishNotice = getElement<HTMLDivElement>("finish-notice");
const finishNoticeText = getElement<HTMLButtonElement>("finish-notice-text");

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

// 마지막으로 쓴 분 설정으로 시작한다(저장된 값이 없으면 15분).
const storage = browserStorage();
const initialMinutes = loadMinutes(storage);
const countdown = new Countdown(initialMinutes * 60_000);
minutesInput.value = String(initialMinutes);
// 종료 알림을 사용자가 닫았는지. 새로 종료될 때마다 false로 돌아간다.
let finishDismissed = false;
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
let shownMinutes = initialMinutes;

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

// +1분/-1분 버튼 활성 여부. 남은 시간이 줄어드는 동안 바뀌므로 매 프레임에서도 부른다.
function updateAdjustButtons(): void {
  const { status } = countdown;
  // 시작한 뒤에만, 최대(180분)까지만 늘릴 수 있다.
  extendButton.disabled = status === "idle" || countdown.totalMs + MS_PER_BLOCK > MAX_MINUTES * MS_PER_BLOCK;
  // 줄이면 바로 끝나 버리거나(남은 시간 1분 이하) 최소 1분 아래가 되면 막는다.
  const canShrink =
    (status === "running" || status === "paused") &&
    countdown.totalMs - MS_PER_BLOCK >= MIN_MINUTES * MS_PER_BLOCK &&
    countdown.totalMs - MS_PER_BLOCK > countdown.elapsedMs;
  shrinkButton.disabled = !canShrink;
}

function renderControls(): void {
  const { status } = countdown;
  toggleButton.textContent = TOGGLE_LABEL[status];
  statusText.textContent = STATUS_LABEL[status];
  resetButton.disabled = status === "idle";
  minutesInput.disabled = status === "running" || status === "paused";
  updateAdjustButtons();
  finishNotice.hidden = !finishNoticeVisible(status, finishDismissed);
  // 타이머 상태가 바뀌면 배너의 [업데이트] 버튼 활성 여부도 다시 계산한다.
  updater.refresh();
}

function finishIfDone(): void {
  if (!countdown.tick()) return;
  finishDismissed = false;
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
    updateAdjustButtons();
  }
  requestAnimationFrame(frame);
}
setInterval(finishIfDone, 500);

// 시작/일시정지. 버튼 클릭과 Space 단축키가 같이 쓴다.
function toggleTimer(): void {
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
}

function resetTimer(): void {
  if (countdown.status === "idle") return;
  countdown.reset();
  renderBlocks();
  renderControls();
}

// 총 시간을 1분 늘리거나 줄인다. 블록이 한 칸 늘거나 줄고, 종료 후에 늘리면 이어서 진행한다.
// 임시 조정이라 저장하지 않는다(다음 실행은 저장된 분 설정으로 시작).
function adjustTotal(change: () => boolean): void {
  unlockAlarm();
  if (!change()) return;
  shownMinutes = countdown.totalMs / MS_PER_BLOCK;
  minutesInput.value = String(shownMinutes);
  buildBlocks();
  renderBlocks();
  renderControls();
}

function extendTimer(): void {
  adjustTotal(() => countdown.extend(MS_PER_BLOCK, MAX_MINUTES * MS_PER_BLOCK));
}

function shrinkTimer(): void {
  adjustTotal(() => countdown.shrink(MS_PER_BLOCK, MIN_MINUTES * MS_PER_BLOCK));
}

toggleButton.addEventListener("click", toggleTimer);
extendButton.addEventListener("click", extendTimer);
shrinkButton.addEventListener("click", shrinkTimer);
resetButton.addEventListener("click", resetTimer);
finishNoticeText.addEventListener("click", () => {
  finishDismissed = true;
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

// --- 알림음: 볼륨, 끄기 ---
let volume = loadVolume(storage);
let muted = loadMuted(storage);

function renderSound(): void {
  const off = muted || volume === 0;
  muteButton.textContent = off ? "소리 꺼짐" : "소리 켜짐";
  muteButton.classList.toggle("off", off);
  volumeInput.value = String(volume);
  setAlarmSound(volume, muted);
}

// 슬라이더를 움직이는 동안은 값만 바꾸고, 놓았을 때 크기를 들려 준다. 움직이면 음소거는 풀린다.
volumeInput.addEventListener("input", () => {
  volume = Number(volumeInput.value);
  if (volume > 0) muted = false;
  renderSound();
});
volumeInput.addEventListener("change", () => {
  saveVolume(storage, volume);
  saveMuted(storage, muted);
  unlockAlarm();
  playPreview();
});
muteButton.addEventListener("click", () => {
  muted = !(muted || volume === 0);
  // 볼륨 0에서 켜면 소리가 안 나는 상태가 되므로 기본 볼륨으로 올린다.
  if (!muted && volume === 0) volume = DEFAULT_VOLUME;
  renderSound();
  saveVolume(storage, volume);
  saveMuted(storage, muted);
  if (!muted) {
    unlockAlarm();
    playPreview();
  }
});
renderSound();

// --- 창: 전체화면, 항상 위에 표시 ---
let fullscreenOn = false;
let alwaysOnTop = false;

function renderWindowButtons(): void {
  fullscreenButton.setAttribute("aria-pressed", String(fullscreenOn));
  fullscreenButton.textContent = fullscreenOn ? "전체화면 해제" : "전체화면";
  pinButton.setAttribute("aria-pressed", String(alwaysOnTop));
}

async function syncFullscreen(): Promise<void> {
  fullscreenOn = await isFullscreen();
  renderWindowButtons();
}

async function changeFullscreen(on: boolean): Promise<void> {
  try {
    await setFullscreen(on);
  } catch {
    // 전체화면을 쓸 수 없는 환경이면 상태만 다시 읽는다.
  }
  await syncFullscreen();
}

async function togglePin(): Promise<void> {
  const next = !alwaysOnTop;
  try {
    if (await setAlwaysOnTop(next)) {
      alwaysOnTop = next;
      saveAlwaysOnTop(storage, next);
    }
  } catch {
    // 실패하면 이전 상태를 유지한다.
  }
  renderWindowButtons();
}

fullscreenButton.addEventListener("click", () => void changeFullscreen(!fullscreenOn));
pinButton.addEventListener("click", () => void togglePin());
// 브라우저에서 Esc로 나가거나 OS 기능(맥의 초록 버튼 등)으로 바뀌어도 버튼 표시를 맞춘다.
document.addEventListener("fullscreenchange", () => void syncFullscreen());
window.addEventListener("resize", () => void syncFullscreen());

if (canPinWindow()) {
  pinButton.hidden = false;
  if (loadAlwaysOnTop(storage)) {
    setAlwaysOnTop(true)
      .then((applied) => {
        alwaysOnTop = applied;
        renderWindowButtons();
      })
      .catch(() => {});
  }
}
void syncFullscreen();

// Space = 시작/일시정지, R = 리셋, F = 전체화면, Esc = 전체화면 해제. 입력창에서 타이핑 중이거나 조합키(Cmd+R 새로고침 등)·키 반복은 무시한다.
// 버튼에 포커스가 있을 때 Space는 브라우저가 클릭으로 처리하므로 여기서 또 처리하지 않는다.
document.addEventListener("keydown", (event) => {
  const action = timerKeyAction(event.code);
  if (action === null || event.defaultPrevented || event.repeat) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if (action === "toggle" && target.closest("button")) return;
  }
  if (action === "exit-fullscreen" && !fullscreenOn) return; // 전체화면이 아니면 Esc는 그대로 둔다.
  event.preventDefault();
  if (action === "toggle") toggleTimer();
  else if (action === "reset") resetTimer();
  else if (action === "fullscreen") void changeFullscreen(!fullscreenOn);
  else void changeFullscreen(false);
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
  saveMinutes(storage, minutes);
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

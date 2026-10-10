let context: AudioContext | null = null;

// 볼륨 100%일 때의 최대 게인(기존 값). 사용자 볼륨(0~100)을 여기에 곱한다.
const MAX_GAIN = 0.4;
let volumePercent = 100;
let muted = false;

// 볼륨(0~100)과 음소거를 실제 게인(0~0.4)으로 바꾼다. 음소거이거나 0이면 0.
export function alarmGain(volume: number, isMuted: boolean): number {
  if (isMuted || !Number.isFinite(volume) || volume <= 0) return 0;
  return (Math.min(100, volume) / 100) * MAX_GAIN;
}

export function setAlarmSound(volume: number, isMuted: boolean): void {
  volumePercent = volume;
  muted = isMuted;
}

// 브라우저 정책상 소리는 사용자 동작(클릭) 안에서 한 번 열어 둬야 나중에 재생된다.
export function unlockAlarm(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {
    context = null; // 오디오를 못 쓰는 환경이면 소리 없이 진행
  }
}

// 삑 소리를 beepCount번 낸다. 음소거이거나 볼륨이 0이면 아무것도 하지 않는다.
function playBeeps(beepCount: number): void {
  const peak = alarmGain(volumePercent, muted);
  if (!context || peak === 0) return;
  const beepSeconds = 0.25;
  const gapSeconds = 0.2;
  const startAt = context.currentTime + 0.05;

  for (let i = 0; i < beepCount; i++) {
    const begin = startAt + i * (beepSeconds + gapSeconds);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    // 시작·끝에서 볼륨을 부드럽게 줄여 "틱" 잡음을 막는다.
    gain.gain.setValueAtTime(0, begin);
    gain.gain.linearRampToValueAtTime(peak, begin + 0.02);
    gain.gain.linearRampToValueAtTime(0, begin + beepSeconds);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(begin);
    oscillator.stop(begin + beepSeconds + 0.02);
  }
}

// 시간 종료 알림: 삑 3번.
export function playAlarm(): void {
  playBeeps(3);
}

// 볼륨을 바꿀 때 크기를 들어 보게 하는 짧은 삑 1번.
export function playPreview(): void {
  playBeeps(1);
}

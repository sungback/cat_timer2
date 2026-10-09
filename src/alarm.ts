let context: AudioContext | null = null;

// 브라우저 정책상 소리는 사용자 동작(클릭) 안에서 한 번 열어 둬야 나중에 재생된다.
export function unlockAlarm(): void {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
  } catch {
    context = null; // 오디오를 못 쓰는 환경이면 소리 없이 진행
  }
}

// 짧은 삑 소리 3번.
export function playAlarm(): void {
  if (!context) return;
  const beepCount = 3;
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
    gain.gain.linearRampToValueAtTime(0.4, begin + 0.02);
    gain.gain.linearRampToValueAtTime(0, begin + beepSeconds);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(begin);
    oscillator.stop(begin + beepSeconds + 0.02);
  }
}

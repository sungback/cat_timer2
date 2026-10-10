import assert from "node:assert/strict";
import { test } from "node:test";
import { catStepForKey, pickCatIndex, stepCatIndex } from "./cats.ts";
import {
  Countdown,
  blockCountFor,
  blockProgress,
  finishNoticeVisible,
  formatRemaining,
  parseMinutes,
  timerKeyAction,
} from "./timer.ts";

function fakeClock() {
  let time = 1000;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("parseMinutes: 정수 1~180만 받는다", () => {
  assert.equal(parseMinutes("15"), 15);
  assert.equal(parseMinutes(" 1 "), 1);
  assert.equal(parseMinutes("180"), 180);
  for (const bad of ["", "0", "181", "-3", "1.5", "abc", "1e2"]) {
    assert.equal(parseMinutes(bad), null, bad);
  }
});

test("blockProgress: 15분이면 블록 하나가 60초", () => {
  const total = 15 * 60_000;
  assert.equal(blockProgress(0, total).length, 15);
  assert.deepEqual(blockProgress(0, total), new Array(15).fill(0));
  // 30초: 1번 블록 절반
  const half = blockProgress(30_000, total);
  assert.equal(half[0], 0.5);
  assert.equal(half[1], 0);
  // 90초: 1번 완료, 2번 절반
  const later = blockProgress(90_000, total);
  assert.deepEqual(later.slice(0, 3), [1, 0.5, 0]);
  // 끝: 전부 사라짐
  assert.deepEqual(blockProgress(total, total), new Array(15).fill(1));
});

test("blockCountFor: 블록 수는 분 수와 같다", () => {
  for (const minutes of [1, 5, 15, 60, 180]) {
    assert.equal(blockCountFor(minutes * 60_000), minutes);
    assert.equal(blockProgress(0, minutes * 60_000).length, minutes);
  }
  // 5분: 1분 지나면 1번 블록만 완전히 사라진다
  assert.deepEqual(blockProgress(60_000, 5 * 60_000), [1, 0, 0, 0, 0]);
});

test("formatRemaining: mm:ss, 초는 올림", () => {
  const total = 15 * 60_000;
  assert.equal(formatRemaining(0, total), "15:00");
  assert.equal(formatRemaining(1, total), "15:00");
  assert.equal(formatRemaining(1000, total), "14:59");
  assert.equal(formatRemaining(total - 500, total), "00:01");
  assert.equal(formatRemaining(total, total), "00:00");
  assert.equal(formatRemaining(0, 90 * 60_000), "90:00");
});

test("Countdown: 시작 → 일시정지 → 계속 → 종료", () => {
  const clock = fakeClock();
  const countdown = new Countdown(10_000, clock.now);
  assert.equal(countdown.status, "idle");

  countdown.start();
  clock.advance(4_000);
  assert.equal(countdown.elapsedMs, 4_000);

  countdown.pause();
  clock.advance(60_000); // 일시정지 중에는 시간이 흐르지 않는다
  assert.equal(countdown.status, "paused");
  assert.equal(countdown.elapsedMs, 4_000);

  countdown.start();
  clock.advance(5_999);
  assert.equal(countdown.tick(), false);
  clock.advance(1);
  assert.equal(countdown.tick(), true); // 막 끝난 호출에서만 true
  assert.equal(countdown.tick(), false);
  assert.equal(countdown.status, "finished");
  assert.equal(countdown.elapsedMs, 10_000);
});

test("Countdown: 늦게 tick해도 총 시간을 넘지 않는다", () => {
  const clock = fakeClock();
  const countdown = new Countdown(10_000, clock.now);
  countdown.start();
  clock.advance(999_999);
  assert.equal(countdown.elapsedMs, 10_000);
  assert.equal(countdown.tick(), true);
});

test("Countdown: 리셋, 종료 후 재시작, 시간 변경 제한", () => {
  const clock = fakeClock();
  const countdown = new Countdown(10_000, clock.now);

  countdown.start();
  clock.advance(3_000);
  assert.equal(countdown.setTotal(20_000), false); // 진행 중에는 못 바꾼다
  countdown.pause();
  assert.equal(countdown.setTotal(20_000), false); // 일시정지 중에도 못 바꾼다
  assert.equal(countdown.totalMs, 10_000);

  countdown.reset();
  assert.equal(countdown.status, "idle");
  assert.equal(countdown.elapsedMs, 0);
  assert.equal(countdown.setTotal(20_000), true);
  assert.equal(countdown.totalMs, 20_000);

  countdown.start();
  clock.advance(20_000);
  countdown.tick();
  assert.equal(countdown.status, "finished");
  countdown.start(); // 종료 후 시작 = 처음부터
  assert.equal(countdown.status, "running");
  assert.equal(countdown.elapsedMs, 0);
});

test("pickCatIndex: 사진 개수가 몇 장이든 범위 안이고 직전 사진과 겹치지 않는다", () => {
  for (const count of [2, 3, 22, 40]) {
    for (let exclude = 0; exclude < count; exclude++) {
      for (const r of [0, 0.25, 0.5, 0.999999]) {
        const index = pickCatIndex(exclude, count, () => r);
        assert.ok(index >= 0 && index < count);
        assert.notEqual(index, exclude);
      }
    }
    // 모든 후보가 나올 수 있다 (exclude 없음)
    const seen = new Set<number>();
    for (let i = 0; i < count; i++) seen.add(pickCatIndex(null, count, () => (i + 0.5) / count));
    assert.equal(seen.size, count);
  }
});

test("pickCatIndex: 사진이 0~1장이면 0", () => {
  assert.equal(pickCatIndex(null, 1), 0);
  assert.equal(pickCatIndex(0, 1), 0);
  assert.equal(pickCatIndex(null, 0), 0);
});

test("stepCatIndex: 다음/이전으로 순서대로 이동하고 처음·끝에서 이어진다", () => {
  assert.equal(stepCatIndex(0, 1, 14), 1);
  assert.equal(stepCatIndex(5, -1, 14), 4);
  assert.equal(stepCatIndex(13, 1, 14), 0); // 마지막 다음은 처음
  assert.equal(stepCatIndex(0, -1, 14), 13); // 처음 이전은 마지막
  // 한 바퀴 돌면 제자리로 돌아온다
  let index: number | null = 3;
  for (let i = 0; i < 14; i++) index = stepCatIndex(index, 1, 14);
  assert.equal(index, 3);
  // 사진을 아직 안 보여 준 상태
  assert.equal(stepCatIndex(null, 1, 14), 0);
  assert.equal(stepCatIndex(null, -1, 14), 13);
  // 사진이 0~1장이면 항상 0
  assert.equal(stepCatIndex(0, 1, 1), 0);
  assert.equal(stepCatIndex(null, -1, 0), 0);
});

test("catStepForKey: ←는 이전, →는 다음, 다른 키는 무시", () => {
  assert.equal(catStepForKey("ArrowRight"), 1);
  assert.equal(catStepForKey("ArrowLeft"), -1);
  for (const other of ["ArrowUp", "ArrowDown", "Enter", " ", "a", "Tab", ""]) {
    assert.equal(catStepForKey(other), null, other);
  }
});

test("timerKeyAction: Space는 시작/일시정지, R은 리셋, 그 밖은 null", () => {
  assert.equal(timerKeyAction("Space"), "toggle");
  assert.equal(timerKeyAction("KeyR"), "reset");
  for (const code of ["Enter", "KeyS", "ArrowLeft", ""]) assert.equal(timerKeyAction(code), null, code);
});

test("finishNoticeVisible: 종료 상태이고 닫지 않았을 때만 보인다", () => {
  assert.equal(finishNoticeVisible("finished", false), true);
  assert.equal(finishNoticeVisible("finished", true), false);
  for (const status of ["idle", "running", "paused"] as const) {
    assert.equal(finishNoticeVisible(status, false), false, status);
  }
});

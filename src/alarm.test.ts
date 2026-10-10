import assert from "node:assert/strict";
import { test } from "node:test";
import { alarmGain } from "./alarm.ts";

test("alarmGain: 음소거·0이면 0, 100%는 기존 최대값 0.4, 비례", () => {
  assert.equal(alarmGain(100, true), 0);
  assert.equal(alarmGain(0, false), 0);
  assert.equal(alarmGain(100, false), 0.4);
  assert.equal(alarmGain(50, false), 0.2);
  assert.ok(alarmGain(5, false) > 0);
});

test("alarmGain: 이상한 값은 안전하게 처리", () => {
  assert.equal(alarmGain(Number.NaN, false), 0);
  assert.equal(alarmGain(-10, false), 0);
  assert.equal(alarmGain(500, false), 0.4);
});

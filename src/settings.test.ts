import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadAlwaysOnTop,
  loadMinutes,
  loadMuted,
  loadVolume,
  parseVolume,
  saveAlwaysOnTop,
  saveMinutes,
  saveMuted,
  saveVolume,
  type StorageLike,
} from "./settings.ts";

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

test("loadMinutes: 저장된 값이 없거나 저장소가 없으면 15분", () => {
  assert.equal(loadMinutes(fakeStorage()), 15);
  assert.equal(loadMinutes(null), 15);
});

test("saveMinutes → loadMinutes: 저장한 값을 되살린다", () => {
  const storage = fakeStorage();
  saveMinutes(storage, 25);
  assert.equal(loadMinutes(storage), 25);
});

test("loadMinutes: 범위를 벗어나거나 이상한 값은 15분", () => {
  for (const bad of ["0", "181", "-3", "abc", "", "7.5", " "]) {
    assert.equal(loadMinutes(fakeStorage({ "cattimer2.minutes": bad })), 15, JSON.stringify(bad));
  }
  assert.equal(loadMinutes(fakeStorage({ "cattimer2.minutes": "180" })), 180);
  assert.equal(loadMinutes(fakeStorage({ "cattimer2.minutes": "1" })), 1);
});

test("저장소가 예외를 던져도 기본값·무시로 동작한다", () => {
  const broken: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadMinutes(broken), 15);
  assert.doesNotThrow(() => saveMinutes(broken, 20));
});

test("항상 위 설정: 기본은 꺼짐, 저장하면 복원, 저장소 오류는 꺼짐", () => {
  assert.equal(loadAlwaysOnTop(fakeStorage()), false);
  assert.equal(loadAlwaysOnTop(null), false);
  const storage = fakeStorage();
  saveAlwaysOnTop(storage, true);
  assert.equal(loadAlwaysOnTop(storage), true);
  saveAlwaysOnTop(storage, false);
  assert.equal(loadAlwaysOnTop(storage), false);
  assert.equal(loadAlwaysOnTop(fakeStorage({ "cattimer2.alwaysOnTop": "true" })), false, "1만 켜짐으로 본다");
  const broken: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadAlwaysOnTop(broken), false);
  assert.doesNotThrow(() => saveAlwaysOnTop(broken, true));
});

test("parseVolume: 0~100 정수만 받고 나머지는 100", () => {
  assert.equal(parseVolume("0"), 0);
  assert.equal(parseVolume("35"), 35);
  assert.equal(parseVolume("100"), 100);
  for (const bad of [null, "", "101", "-5", "abc", "7.5", "1e2"]) assert.equal(parseVolume(bad), 100, String(bad));
});

test("볼륨·음소거 저장과 복원, 저장소 오류는 기본값", () => {
  const storage = fakeStorage();
  assert.equal(loadVolume(storage), 100);
  assert.equal(loadMuted(storage), false);
  saveVolume(storage, 40);
  saveMuted(storage, true);
  assert.equal(loadVolume(storage), 40);
  assert.equal(loadMuted(storage), true);
  saveMuted(storage, false);
  assert.equal(loadMuted(storage), false);
  const broken: StorageLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadVolume(broken), 100);
  assert.equal(loadMuted(broken), false);
  assert.doesNotThrow(() => {
    saveVolume(broken, 10);
    saveMuted(broken, true);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMinutes, saveMinutes, type StorageLike } from "./settings.ts";

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

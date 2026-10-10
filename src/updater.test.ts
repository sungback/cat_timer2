import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bannerView,
  canInstall,
  clampPercent,
  formatProgress,
  normalizeProgress,
  type UpdateInfo,
} from "./updater.ts";

const info: UpdateInfo = {
  current: "0.1.0",
  latest: "0.2.0",
  tag: "v0.2.0",
  htmlUrl: "https://github.com/sungback/cat_timer2/releases/tag/v0.2.0",
};

test("canInstall: 타이머가 돌거나 일시정지 중이면 설치할 수 없다", () => {
  assert.equal(canInstall("idle"), true);
  assert.equal(canInstall("finished"), true);
  assert.equal(canInstall("running"), false);
  assert.equal(canInstall("paused"), false);
});

test("clampPercent / normalizeProgress: 0~100으로 맞추고 이상한 값은 null", () => {
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(42.4), 42);
  assert.equal(clampPercent(250), 100);
  assert.equal(normalizeProgress({ received: 10, total: 100, percent: 10 }), 10);
  assert.equal(normalizeProgress({ percent: 180 }), 100);
  for (const bad of [null, undefined, 5, "50", {}, { percent: null }, { percent: "9" }, { percent: Number.NaN }]) {
    assert.equal(normalizeProgress(bad), null, String(bad));
  }
});

test("formatProgress: 퍼센트를 모르면 숫자 없이 표시", () => {
  assert.equal(formatProgress(null), "업데이트를 내려받는 중...");
  assert.equal(formatProgress(42), "업데이트를 내려받는 중... 42%");
  assert.equal(formatProgress(140), "업데이트를 내려받는 중... 100%");
});

test("bannerView: 업데이트가 없으면 배너를 숨긴다", () => {
  const view = bannerView({ kind: "none" }, "idle");
  assert.equal(view.visible, false);
  assert.equal(view.showInstall, false);
});

test("bannerView(available): 대기 중에는 설치 가능, 타이머 중에는 비활성 + 안내", () => {
  const ready = bannerView({ kind: "available", info }, "idle");
  assert.equal(ready.visible, true);
  assert.equal(ready.installDisabled, false);
  assert.equal(ready.installLabel, "업데이트");
  assert.ok(ready.text.includes("v0.2.0") && ready.text.includes("v0.1.0"));
  assert.ok(!ready.text.includes("타이머가 끝나면"));
  assert.equal(ready.showLater, true);
  assert.equal(ready.showRelease, false);

  for (const timer of ["running", "paused"] as const) {
    const blocked = bannerView({ kind: "available", info }, timer);
    assert.equal(blocked.installDisabled, true, timer);
    assert.ok(blocked.text.includes("타이머가 끝나면"), timer);
    assert.equal(blocked.visible, true);
  }
  // 타이머가 끝나면(finished) 다시 설치할 수 있다.
  assert.equal(bannerView({ kind: "available", info }, "finished").installDisabled, false);
});

test("bannerView(downloading): 진행률만 보이고 버튼은 모두 숨긴다", () => {
  const view = bannerView({ kind: "downloading", info, percent: 37 }, "idle");
  assert.equal(view.visible, true);
  assert.equal(view.text, "업데이트를 내려받는 중... 37%");
  assert.equal(view.showInstall, false);
  assert.equal(view.showLater, false);
  assert.equal(view.showRelease, false);
});

test("bannerView(failed): 오류 문구, 다시 시도, 릴리스 페이지 열기", () => {
  const view = bannerView({ kind: "failed", info, message: "체크섬이 일치하지 않습니다." }, "idle");
  assert.equal(view.visible, true);
  assert.ok(view.text.includes("체크섬이 일치하지 않습니다."));
  assert.equal(view.showInstall, true);
  assert.equal(view.installLabel, "다시 시도");
  assert.equal(view.installDisabled, false);
  assert.equal(view.showRelease, true);
  assert.equal(view.showLater, true);
  // 실패 후에도 타이머가 돌고 있으면 다시 시도할 수 없다.
  assert.equal(bannerView({ kind: "failed", info, message: "x" }, "running").installDisabled, true);
});

test("bannerView(notice): 안내 문구와 닫기 버튼만 보인다(타이머 상태와 무관)", () => {
  for (const timer of ["idle", "running", "paused", "finished"] as const) {
    const view = bannerView({ kind: "notice", message: "최신 버전입니다. (v0.1.1)" }, timer);
    assert.equal(view.visible, true);
    assert.equal(view.text, "최신 버전입니다. (v0.1.1)");
    assert.equal(view.showInstall, false);
    assert.equal(view.showRelease, false);
    assert.equal(view.showLater, true);
    assert.equal(view.laterLabel, "닫기");
  }
});

test("bannerView: 새 버전·실패 배너의 보조 버튼 이름은 '나중에'", () => {
  assert.equal(bannerView({ kind: "available", info }, "idle").laterLabel, "나중에");
  assert.equal(bannerView({ kind: "failed", info, message: "x" }, "idle").laterLabel, "나중에");
});

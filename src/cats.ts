// 직전 사진(exclude)과 겹치지 않게 무작위 인덱스를 고른다. count는 사진 개수.
export function pickCatIndex(
  exclude: number | null,
  count: number,
  random: () => number = Math.random,
): number {
  if (count <= 1) return 0;
  const candidates = count - (exclude === null ? 0 : 1);
  let index = Math.min(candidates - 1, Math.floor(random() * candidates));
  if (exclude !== null && index >= exclude) index += 1;
  return index;
}

// 현재 사진에서 delta(+1 다음, -1 이전)만큼 이동한 인덱스. 처음/끝에서는 반대쪽으로 이어진다.
// current가 null이면(아직 사진을 안 보여 줬으면) 다음은 첫 사진, 이전은 마지막 사진이다.
export function stepCatIndex(current: number | null, delta: 1 | -1, count: number): number {
  if (count <= 1) return 0;
  if (current === null) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

// 방향키 → 사진 이동 방향. ←는 이전(-1), →는 다음(+1), 그 밖의 키는 null.
export function catStepForKey(key: string): 1 | -1 | null {
  if (key === "ArrowRight") return 1;
  if (key === "ArrowLeft") return -1;
  return null;
}

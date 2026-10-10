#!/usr/bin/env bash
# 릴리스에 올릴 파일을 검사한다. build.yml의 release 잡이 `gh release create` 직전에 실행한다.
#   - 파일 목록이 정확히 4개인지(이름 고정: 앱 안 업데이트가 이 이름으로 찾는다)
#   - .sha256이 64자리 소문자 16진수이고 실제 파일의 SHA-256과 같은지
#   - mac zip 안에 CatTimer2.app이 있는지, Windows exe가 PE 파일(MZ)인지
#   - 태그 = package.json 버전 = src-tauri/Cargo.toml 버전인지
#
# 사용법: scripts/check-release.sh <에셋 폴더> <태그 예: v0.1.0>
set -euo pipefail

dir="${1:?사용법: $0 <에셋 폴더> <태그>}"
tag="${2:?사용법: $0 <에셋 폴더> <태그>}"
root="$(cd "$(dirname "$0")/.." && pwd)"

MAC="CatTimer2-macOS.zip"
WIN="CatTimer2-Windows-Portable.exe"

fail() {
  echo "오류: $*" >&2
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

[ -d "$dir" ] || fail "에셋 폴더가 없습니다: $dir"

# 1) 파일 목록이 정확히 일치해야 한다(빠진 것도, 남는 것도 허용하지 않는다).
expected="$(printf '%s\n' "$MAC" "$MAC.sha256" "$WIN" "$WIN.sha256" | sort)"
actual="$(cd "$dir" && ls -A1 | sort)"
if [ "$expected" != "$actual" ]; then
  echo "기대한 파일:" >&2
  echo "$expected" >&2
  echo "실제 파일:" >&2
  echo "$actual" >&2
  fail "릴리스 파일 목록이 다릅니다."
fi

# 2) 체크섬
for f in "$MAC" "$WIN"; do
  [ -s "$dir/$f" ] || fail "$f 가 비어 있습니다."
  recorded="$(tr -d '\r\n' < "$dir/$f.sha256")"
  printf '%s' "$recorded" | grep -Eq '^[0-9a-f]{64}$' \
    || fail "$f.sha256 은 64자리 소문자 16진수여야 합니다: '$recorded'"
  computed="$(sha256_of "$dir/$f")"
  [ "$recorded" = "$computed" ] || fail "$f 의 SHA-256이 .sha256과 다릅니다. (기록 $recorded / 실제 $computed)"
  echo "체크섬 일치: $f $computed"
done

# 3) 내용 확인
unzip -tq "$dir/$MAC" >/dev/null || fail "$MAC 가 올바른 zip이 아닙니다."
# 주의: `unzip -l | grep -q`는 pipefail에서 grep이 먼저 끝나면 unzip이 SIGPIPE로 죽어 실패로 판정되므로 목록을 변수로 받는다.
listing="$(unzip -l "$dir/$MAC")"
grep -q 'CatTimer2\.app/Contents/Info\.plist' <<< "$listing" \
  || fail "$MAC 안에 CatTimer2.app 이 없습니다."
[ "$(head -c 2 "$dir/$WIN")" = "MZ" ] || fail "$WIN 은 Windows 실행 파일(MZ)이 아닙니다."

# 4) 버전: 태그 = package.json = Cargo.toml
case "$tag" in
  v[0-9]*) ;;
  *) fail "태그는 v로 시작하는 버전이어야 합니다: $tag" ;;
esac
tag_version="${tag#v}"
pkg_version="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" "$root/package.json")"
cargo_version="$(grep -m1 '^version' "$root/src-tauri/Cargo.toml" | sed -E 's/^version *= *"([^"]+)".*/\1/')"
[ "$tag_version" = "$pkg_version" ] || fail "태그($tag_version)와 package.json($pkg_version) 버전이 다릅니다."
[ "$tag_version" = "$cargo_version" ] || fail "태그($tag_version)와 Cargo.toml($cargo_version) 버전이 다릅니다."

echo "릴리스 검사 통과: $tag (파일 4개, 체크섬·버전 일치)"

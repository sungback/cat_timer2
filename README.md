# 고양이 타이머

화면 아래 블록이 왼쪽부터 하나씩 사라지는 시각 타이머입니다. 배경에는 고양이 사진이 나옵니다. Vite + TypeScript로 만든 웹앱입니다.

## 기능

- 분 단위로 시간을 정하면 블록 수가 그 분 수와 같아지고(1블록 = 1분), 시간이 지날수록 블록이 사라집니다.
- 블록 바로 위에 남은 시간을 `mm:ss`로 보여 줍니다.
- 시간이 다 되면 알림음이 울리고, 화면이 깜빡이며 "시간 종료!"가 나옵니다(문구를 누르면 닫힙니다).
- 알림음 크기(슬라이더)와 [소리 켜짐/꺼짐] 버튼. 슬라이더를 놓으면 크기를 들려 주고, 설정은 다음 실행 때도 유지됩니다.
- 시작 · 일시정지 · 리셋, 처음부터 시작할 때마다 배경 사진이 바뀝니다.
- `<-`, `->` 버튼이나 방향키 `←`, `→`로 사진을 순서대로 넘길 수 있습니다.
- 단축키: `Space` 시작/일시정지, `R` 리셋, `F` 전체화면(`Esc`로 해제). 마지막에 쓴 분 설정은 다음 실행 때도 유지됩니다.
- 컨트롤 패널의 [전체화면], [항상 위] 버튼. 항상 위에 표시(다른 창 위에 고정)는 설치한 앱에서만 되고 설정이 유지됩니다.

## 실행

Node.js가 필요합니다.

```sh
npm install
npm run dev      # 개발 서버
npm test         # 테스트
npm run build    # dist/ 에 빌드
```

## 릴리스 절차

릴리스는 `v*` 태그를 푸시하면 GitHub Actions(`.github/workflows/build.yml`)가 만든다. 앱 안 업데이트는 이 릴리스를 보고 동작한다.

1. **검증**: `npm test`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`이 모두 통과하는지 확인한다.
2. **버전 올리기**: 아래 두 곳을 같은 값으로 바꾼다(`src-tauri/tauri.conf.json`은 `package.json`을 따라가므로 손대지 않는다).
   - `npm version X.Y.Z --no-git-tag-version` (`package.json`, `package-lock.json`)
   - `src-tauri/Cargo.toml`의 `version` (`Cargo.lock`은 `cargo test` 때 자동으로 바뀐다)
3. **커밋·푸시**: 변경을 커밋하고 `main`에 푸시한다. `ci`와 `build` 워크플로가 통과할 때까지 기다린다(`gh run list`, `gh run watch <id>`).
4. **태그 푸시**: `git tag vX.Y.Z && git push origin vX.Y.Z`. mac(arm64)·windows 빌드가 모두 성공하면 `release` 잡이 파일을 검사한 뒤 릴리스를 만든다.
5. **확인**: `gh release view vX.Y.Z`로 에셋 4개(`CatTimer2-macOS.zip`, `CatTimer2-Windows-Portable.exe`와 각각의 `.sha256`)가 올라갔는지 본다.

주의할 점

- 태그, `package.json`, `Cargo.toml`의 버전이 하나라도 다르면 `scripts/check-release.sh`가 실패해 릴리스가 만들어지지 않는다.
- 에셋 파일명은 고정이다. 앱 안 업데이트(`src-tauri/src/update.rs`)가 이름으로 찾으므로 바꾸면 업데이트가 깨진다.
- 잘못 나간 릴리스는 `gh release delete vX.Y.Z --cleanup-tag`로 지우고 다음 패치 버전으로 다시 낸다. 이미 받아 간 사용자가 있을 수 있으므로 같은 번호를 재사용하지 않는다.
- 서명이 없어서 처음 설치할 때 macOS는 "개인정보 보호 및 보안"에서 허용이, Windows는 SmartScreen 경고에서 "추가 정보 → 실행"이 필요하다. 앱 안 업데이트로 올릴 때는 이 경고가 다시 뜨지 않도록 설계했다.
- v0.1.1 이하 Windows 앱은 업데이트 도우미 결함이 있어 앱 안 업데이트가 안 된다. v0.1.2 이상 exe를 직접 받아 교체해야 한다.

## 사진 추가·교체

`src/assets/cats/` 폴더에 사진 파일을 넣거나 빼면 목록이 자동으로 바뀝니다. 규격과 출처 기록 방법은 [`src/assets/cats/SOURCES.md`](src/assets/cats/SOURCES.md)에 있습니다.

## 라이선스

| 대상 | 라이선스 |
|---|---|
| 소스 코드 | [MIT License](LICENSE) |
| 배경 사진(`src/assets/cats/`) | 각 사진은 [Unsplash License](https://unsplash.com/license)로 받은 것입니다. **이 저장소의 MIT 라이선스는 사진에 적용되지 않습니다.** 촬영자와 출처는 [`SOURCES.md`](src/assets/cats/SOURCES.md)에 있습니다. |
| 아이콘(`public/icon.svg`) | [Bootstrap Icons](https://github.com/twbs/icons)의 `cup-hot`과 `clock`을 겹쳐 만든 것(MIT). 고지문은 [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md)에 있습니다. |

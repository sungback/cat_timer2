# 고양이 타이머

화면 아래 블록이 왼쪽부터 하나씩 사라지는 시각 타이머입니다. 배경에는 고양이 사진이 나옵니다. Vite + TypeScript로 만든 웹앱입니다.

## 기능

- 분 단위로 시간을 정하면 블록 수가 그 분 수와 같아지고(1블록 = 1분), 시간이 지날수록 블록이 사라집니다.
- 블록 바로 위에 남은 시간을 `mm:ss`로 보여 줍니다.
- 시간이 다 되면 알림음이 울리고, 화면이 깜빡이며 "시간 종료!"가 나옵니다(문구를 누르면 닫힙니다).
- 시작 · 일시정지 · 리셋, 처음부터 시작할 때마다 배경 사진이 바뀝니다.
- `<-`, `->` 버튼이나 방향키 `←`, `→`로 사진을 순서대로 넘길 수 있습니다.
- 단축키: `Space` 시작/일시정지, `R` 리셋. 마지막에 쓴 분 설정은 다음 실행 때도 유지됩니다.

## 실행

Node.js가 필요합니다.

```sh
npm install
npm run dev      # 개발 서버
npm test         # 테스트
npm run build    # dist/ 에 빌드
```

## 사진 추가·교체

`src/assets/cats/` 폴더에 사진 파일을 넣거나 빼면 목록이 자동으로 바뀝니다. 규격과 출처 기록 방법은 [`src/assets/cats/SOURCES.md`](src/assets/cats/SOURCES.md)에 있습니다.

## 라이선스

| 대상 | 라이선스 |
|---|---|
| 소스 코드 | [MIT License](LICENSE) |
| 배경 사진(`src/assets/cats/`) | 각 사진은 [Unsplash License](https://unsplash.com/license)로 받은 것입니다. **이 저장소의 MIT 라이선스는 사진에 적용되지 않습니다.** 촬영자와 출처는 [`SOURCES.md`](src/assets/cats/SOURCES.md)에 있습니다. |
| 아이콘(`public/icon.svg`) | [Bootstrap Icons](https://github.com/twbs/icons)의 `cup-hot`과 `clock`을 겹쳐 만든 것(MIT). 고지문은 [`public/THIRD_PARTY_LICENSES.md`](public/THIRD_PARTY_LICENSES.md)에 있습니다. |

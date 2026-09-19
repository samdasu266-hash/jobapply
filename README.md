# jobapply

지원 전형 일정 트래커. `index.html` 한 파일로 동작하며 빌드 과정이 없다.
데이터는 브라우저 `localStorage`에 저장되고, 가능하면 원격에도 동기화된다.

## 회귀 검사

```
node test/check.mjs          # 실패가 있으면 종료 코드 1
node test/check.mjs --keep   # 스크린샷을 test/out 에 남김
```

Playwright가 필요하다. 검사는 실제 브라우저에서 화면을 띄우고 확인한다.

**표시 여부는 반드시 계산된 스타일과 크기로 판정한다.** `el.hidden` 같은
속성만 보면 CSS가 덮어썼을 때를 놓친다 — 실제로 `.rmenu { display:flex }`가
`[hidden]`의 `display:none`을 이겨 메뉴가 항상 보이던 버그를 그렇게 놓쳤다.
`check.mjs`의 `shown()` 헬퍼가 이 판정을 담당한다.

검사 픽스처는 기본적으로 시드(미리 등록된 공고)를 넣지 않는다. 픽스처에
정의하지 않은 기관이 섞이면 결과를 읽을 수 없기 때문이다. 시드 자체를
확인할 때만 상태를 주지 않고 기본값으로 띄운다.

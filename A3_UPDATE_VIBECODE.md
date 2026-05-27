# A3 APK 업데이트 공유 바이브코드

## 목적

A1에서 A3 APK를 배포했을 때, A3 기기가 꺼져 있다가 며칠 뒤 켜져도 업데이트 팝업이 뜨는 구조와 조건을 공유한다.

## 핵심 결론

A3가 꺼져 있어도 업데이트는 가능하다.

이 구조는 푸시 알림처럼 배포 순간에 A3가 켜져 있어야 받는 방식이 아니다. A1이 Firestore `app_releases/a3` 문서에 최신 APK 정보를 저장해 두고, A3는 앱 시작 또는 실행 중 Firestore의 현재 문서를 읽어서 자기 버전과 비교한다.

따라서 A1에서 오늘 배포하고 A3가 3일 뒤 켜져도, Firestore 문서가 유지되어 있고 `versionCode`가 A3 현재 설치 버전보다 높으면 A3는 업데이트 대상으로 판단한다.

## 실제 동작 흐름

1. A1에서 A3 APK를 업로드한다.
2. A1 파일 목록에서 해당 APK의 `배포` 버튼을 누른다.
3. A1이 Firestore `app_releases/a3` 문서를 갱신한다.
4. 문서에는 `status: active`, `versionCode`, `apkUrl`, `forceUpdate: true`, `installMode: forced`, `autoUpdate: true`가 저장된다.
5. A3가 켜지면 `app_releases/a3` 현재 문서를 읽는다.
6. A3는 `문서 versionCode > 현재 설치 versionCode`이면 업데이트 대상으로 판단한다.
7. A3 화면을 막고 `업데이트가 필요합니다` 팝업을 띄운다.
8. 사용자가 `확인`을 누르면 APK를 다운로드하고 Android 설치 화면을 연다.

## A3가 꺼져 있다가 3일 후 켜진 경우

가능하다.

조건은 다음과 같다.

- Firestore `app_releases/a3` 문서가 그대로 유지되어 있어야 한다.
- 문서의 `status`가 `active`여야 한다.
- 문서의 `apkUrl` 또는 `url`이 유효해야 한다.
- 문서의 `versionCode`가 A3 현재 설치 앱의 `versionCode`보다 커야 한다.
- A3에 업데이트 감시 로직이 들어간 버전이 이미 설치되어 있어야 한다.
- A3가 켜졌을 때 인터넷과 Firebase 접속이 가능해야 한다.
- 새 APK는 기존 A3와 같은 `applicationId`와 같은 서명키로 빌드되어야 한다.

## 중요한 제한

일반 Android APK 환경에서는 완전 무음 설치가 불가능하다.

가능한 사용자 경험은 다음과 같다.

`A3 강제 팝업` -> `확인` -> `APK 다운로드` -> `Android 설치 화면` -> `사용자가 설치 확인`

알 수 없는 앱 설치 권한이 없으면 최초 1회는 권한 허용 화면이 먼저 열릴 수 있다.

## 현재 구현 기준

A1 배포 버튼은 `app_releases/a3` 문서를 active 릴리즈로 저장해야 한다.

필수 필드 예시:

```json
{
  "appId": "a3",
  "versionName": "1.0.0",
  "versionCode": 24,
  "apkUrl": "https://...apk",
  "url": "https://...apk",
  "storagePath": "app_releases/a3/...apk",
  "forceUpdate": true,
  "installMode": "forced",
  "autoUpdate": true,
  "status": "active",
  "storageDeleted": false
}
```

A3는 다음 조건으로 업데이트 여부를 판단한다.

```text
status == active
apkUrl is not empty
release.versionCode > currentInstalledVersionCode
```

## 운영 절차

1. A3 APK를 새로 빌드할 때 `versionCode`를 반드시 올린다.
2. A1에서 APK를 업로드한다.
3. 업로드만으로는 업데이트가 확정되지 않는다.
4. A1 파일 목록에서 `배포` 버튼을 눌러야 실제 최신 릴리즈가 된다.
5. Firebase `app_releases/a3` 문서의 `versionCode`와 `status: active`를 확인한다.
6. A3 기기를 켜면 버전 비교 후 팝업이 떠야 한다.

## 테스트 시나리오

1. A3 기기에 업데이트 감시 로직이 들어간 APK를 설치한다.
2. 현재 설치된 A3의 `versionCode`를 확인한다.
3. 더 높은 `versionCode`의 APK를 A1에서 업로드한다.
4. A1에서 해당 APK의 `배포` 버튼을 누른다.
5. A3를 꺼 둔다.
6. 시간이 지난 뒤 A3를 켠다.
7. `업데이트가 필요합니다` 팝업이 뜨는지 확인한다.
8. `확인`을 누르면 APK 다운로드 후 Android 설치 화면이 열리는지 확인한다.

## 실패 시 확인할 것

- A1에서 업로드만 하고 `배포`를 누르지 않았는지 확인한다.
- Firestore `app_releases/a3` 문서가 최신 APK를 가리키는지 확인한다.
- `versionCode`가 현재 A3 설치 버전보다 큰지 확인한다.
- A3 현장 앱이 업데이트 감시 로직이 들어간 버전인지 확인한다.
- APK 서명키가 기존 설치 앱과 같은지 확인한다.
- 기기에서 Firebase 접속이 가능한지 확인한다.
- 알 수 없는 앱 설치 권한이 허용되어 있는지 확인한다.

## 한 줄 요약

A1 배포는 Firestore에 최신 업데이트 상태를 저장하는 방식이므로, A3가 배포 순간에 꺼져 있어도 나중에 켜졌을 때 현재 문서를 읽고 업데이트 대상이면 강제 팝업을 띄운다.
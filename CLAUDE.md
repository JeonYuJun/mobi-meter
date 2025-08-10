# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 중요: 이 프로젝트에서는 모든 답변을 한국어로 제공해야 합니다.

## 프로젝트 개요

Mobi-Meter는 마비노기 MMORPG용 실시간 데미지 미터입니다. 네트워크 패킷을 캡처하여 전투 데이터를 분석하고 WebSocket 기반 웹 인터페이스로 통계를 표시합니다.

## 아키텍처

### 백엔드 (src/main.py)
- 포트 6519에서 실행되는 WebSocket 서버
- TCP 포트 16000의 패킷을 Scapy로 캡처
- 실시간 전투 데이터 파싱 및 분석
- 2Hz로 웹 클라이언트에 업데이트 브로드캐스트

### 프론트엔드 (web/)
- index.html: 실시간 대시보드가 있는 단일 페이지 애플리케이션
- css/styles.css: UI 스타일 정의
- js/app.js: WebSocket 클라이언트 및 데이터 처리 로직
- ws://localhost:6519에 연결하는 WebSocket 클라이언트

## 주요 의존성

### Python (수동 관리 - requirements.txt 없음):
- asyncio, json, time (내장)
- brotli - 압축
- websockets - WebSocket 서버
- scapy - 패킷 캡처
- aiohttp - HTTP 서버 (독립 실행 exe용)
- aiohttp-cors - CORS 지원
- dataclasses, typing (내장)

### 프론트엔드 (CDN):
- Font Awesome 6.4.0
- Chart.js 4.4.0
- chartjs-plugin-zoom 2.0.1
- html2canvas 1.4.1 (동적 로드)

## 개발 명령어

### 애플리케이션 실행
```bash
# 개발 모드 (Windows에서 관리자 권한 필요)
python src/main.py

# 프로덕션 실행 - exe 파일 사용
dist/mobi-meter.exe
```

### 빌드
```bash
# exe 파일 빌드 (콘솔창 표시)
pyinstaller --noconfirm --onefile --name mobi-meter --add-data "settings.json;." --add-data "_skills.json;." --add-data "_buffs.json;." --add-data "index.html;." --add-data "styles.css;." --add-data "app.js;." --collect-all scapy --collect-all brotli --collect-all websockets --hidden-import scapy.all --hidden-import scapy.layers.inet --hidden-import brotli --hidden-import websockets --hidden-import asyncio --hidden-import json --hidden-import dataclasses --hidden-import typing --hidden-import time --hidden-import webbrowser main.py

# 빌드 후 임시 파일 정리 (build.spec은 유지!)
rm -rf build
```

### 테스트
현재 테스트 프레임워크 미구현

### 린팅
현재 린팅 설정 없음

## 설정 파일

- `config/settings.json` - 런타임 설정 (포트, 디버그 모드, 인터페이스)
- `data/_skills.json` - 게임 스킬 매핑 (한국어 이름)
- `data/_buffs.json` - 버프/디버프 정의 및 스탯 수정자

## 중요 사항

1. **관리자 권한 필요**: Windows에서 패킷 캡처를 위해 관리자 권한 필요
2. **Npcap 의존성**: 패킷 캡처를 위해 Npcap 설치 필수
3. **패키지 관리 없음**: 의존성이 공식적으로 추적되지 않음 - 수동 설치 필요
4. **한국어 인터페이스**: UI와 스킬 이름이 한국어로 되어 있음
5. **게임 특화**: 한국 서버 마비노기 전용으로 설계됨

## 코드 구조

### src/main.py 주요 컴포넌트:
- `PacketParser`: 게임 패킷 디코딩 및 전투 데이터 추출
- `CombatDataProcessor`: 데미지, 스킬, 버프 분석
- `WebSocketHandler`: 클라이언트 연결 및 데이터 브로드캐스팅 관리
- `PacketCapture`: Scapy 기반 네트워크 패킷 가로채기

### web/ 주요 컴포넌트:
- `index.html`: 메인 UI 구조
- `css/styles.css`: 테마 및 레이아웃 스타일
- `js/app.js`: WebSocket 통신 및 차트 렌더링

## 개발 권장사항

이 코드베이스를 수정할 때:
1. 기존 한국어 인터페이스 유지
2. 관리자 권한으로 패킷 캡처 테스트
3. 실시간 업데이트를 위한 WebSocket 호환성 보장
4. 전투 통계를 위한 기존 데이터 구조 준수
5. 이 도구가 게임 이용약관과 관련하여 법적 회색지대에서 작동함을 인지

## 답변 언어
이 프로젝트에서 작업할 때는 반드시 한국어로 답변하고 소통해야 합니다.

## Git 커밋 규칙
- **절대 자동으로 커밋하지 말 것! 사용자가 명시적으로 요청할 때만 커밋**
- 커밋 메시지는 항상 심플하게 작성
- 긴 설명 없이 핵심만 간단히
- 예: "Add .gitignore", "Fix bug", "Update README"

## 버전 관리 규칙
- **버전은 사용자가 명시적으로 요청할 때만 변경할 것**
- 절대 자동으로 버전을 올리지 말 것
- 버전 변경 시 아래 두 곳을 동시에 수정:
  - `src/main.py`의 `__version__` 변수
  - `build.spec`의 `name` 필드 (예: mobi-meter-1.0.7)
- 빌드할 때마다 버전을 올리지 말고, 사용자가 버전 업데이트를 요청할 때만 변경

## 빌드 방법 (중요!)
항상 아래 방법으로만 빌드할 것:

### 빌드 전 확인사항
1. main.py에서 버전 확인 (__version__ 변수)
2. 버전명을 exe 파일명에 포함시킬 것 (예: mobi-meter-1.0.7.exe)

### 1. spec 파일 생성
```python
# build.spec
from PyInstaller.utils.hooks import collect_all

# 모든 필수 모듈 수집
tmp_ret = collect_all('scapy')
datas = tmp_ret[0]
binaries = tmp_ret[1]
hiddenimports = tmp_ret[2]

tmp_ret = collect_all('websockets')
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]

tmp_ret = collect_all('brotli')
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]

tmp_ret = collect_all('aiohttp')
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]

tmp_ret = collect_all('aiohttp_cors')
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]

# 프로젝트 파일 추가
datas += [
    ('../data/_skills.json', 'data'),
    ('../data/_buffs.json', 'data'),
    ('../config/settings.json', 'config'),
    ('../web/index.html', 'web'),
    ('../web/css/styles.css', 'web/css'),
    ('../web/js/app.js', 'web/js'),
    ('../assets/favicon.ico', 'assets'),
    ('../assets/favicon.png', 'assets'),
    ('../assets/icon.ico', '.')
]

# 추가 hidden imports
hiddenimports += [
    'asyncio',
    'json',
    'dataclasses',
    'typing',
    'time',
    'webbrowser',
    'scapy.all',
    'scapy.layers.inet'
]

a = Analysis(
    ['../src/main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='mobi-meter-1.0.7',  # 버전명 포함! 항상 main.py의 __version__과 일치시킬 것
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='../assets/icon.ico',
    # 참고: PyInstaller 6.x에서는 uac_admin 옵션이 제거됨
    # 관리자 권한은 exe 파일을 우클릭하여 "관리자 권한으로 실행" 선택
)
```

### 2. 빌드 실행
```bash
cd build
pyinstaller --clean build.spec
cd ..
```

### 3. 정리
```bash
# build 폴더만 삭제 (build.spec은 유지!)
rm -rf build
```

Windows 명령 프롬프트에서는:
```bash
# build 폴더만 삭제 (build.spec은 유지!)
rmdir /s /q build
```

### ⚠️ 중요: build.spec 파일 관리
- **build.spec 파일은 절대 삭제하지 말 것!**
- 빌드 설정이 변경될 때마다 build.spec이 달라질 수 있음
- 잘못된 빌드 방식으로 인한 오류 방지를 위해 항상 유지
- 버전 업데이트 시 build.spec의 name 필드만 수정

### 4. 결과
- dist/mobi-meter-X.X.X.exe 단일 파일 생성 (버전명 포함)
- VM에 복사해서 관리자 권한으로 실행

**절대 다른 방법으로 빌드하지 말 것!**
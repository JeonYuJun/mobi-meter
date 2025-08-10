# -*- mode: python ; coding: utf-8 -*-
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
    ('data/_skills.json', 'data'),
    ('data/_buffs.json', 'data'),
    ('config/settings.json', 'config'),
    ('web/index.html', 'web'),
    ('web/css/styles.css', 'web/css'),
    ('web/js/app.js', 'web/js'),
    ('assets/favicon.ico', 'assets'),
    ('assets/favicon.png', 'assets'),
    ('assets/icon.ico', 'assets')
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
    ['src/main.py'],
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
    name='mobi-meter-1.2.2',  # 버전명 포함! 항상 main.py의 __version__과 일치시킬 것
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
    icon='assets/icon.ico'
)
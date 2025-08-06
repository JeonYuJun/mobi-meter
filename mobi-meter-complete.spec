# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files, collect_dynamic_libs

# 모든 필수 패키지 완전 수집
scapy_all = collect_all('scapy')
websockets_all = collect_all('websockets')

# 데이터 파일 수집
datas = scapy_all[0] + websockets_all[0]
datas += [
    ('_skills.json', '.'),
    ('_buffs.json', '.'),
    ('settings.json', '.'),
    ('index.html', '.'),
    ('styles.css', '.'),
    ('app.js', '.')
]

# 바이너리 파일 수집
binaries = scapy_all[1] + websockets_all[1]

# Brotli 파일 명시적 추가
site_packages = 'C:\\Users\\jsb65\\AppData\\Local\\Programs\\Python\\Python313\\Lib\\site-packages'
binaries += [
    (os.path.join(site_packages, '_brotli.cp313-win_amd64.pyd'), '.'),
    (os.path.join(site_packages, 'brotli.py'), '.'),
]

# Hidden imports 수집
hiddenimports = scapy_all[2] + websockets_all[2]

# 추가 필수 imports
hiddenimports += [
    # Python 기본
    'asyncio',
    'asyncio.base_events',
    'asyncio.events', 
    'asyncio.futures',
    'asyncio.locks',
    'asyncio.protocols',
    'asyncio.queues',
    'asyncio.streams',
    'asyncio.tasks',
    'asyncio.transports',
    'asyncio.windows_events',
    'asyncio.windows_utils',
    'json',
    'time',
    'struct',
    'dataclasses',
    'typing',
    'collections',
    'functools',
    
    # Brotli
    'brotli',
    '_brotli',
    
    # WebSockets 모든 모듈
    'websockets',
    'websockets.auth',
    'websockets.client',
    'websockets.connection',
    'websockets.datastructures',
    'websockets.exceptions',
    'websockets.extensions',
    'websockets.extensions.base',
    'websockets.extensions.permessage_deflate',
    'websockets.frames',
    'websockets.headers',
    'websockets.http',
    'websockets.http11',
    'websockets.imports',
    'websockets.legacy',
    'websockets.legacy.auth',
    'websockets.legacy.client',
    'websockets.legacy.framing',
    'websockets.legacy.handshake',
    'websockets.legacy.http',
    'websockets.legacy.protocol',
    'websockets.legacy.server',
    'websockets.protocol',
    'websockets.server',
    'websockets.streams',
    'websockets.sync',
    'websockets.sync.client',
    'websockets.sync.connection',
    'websockets.sync.messages',
    'websockets.sync.server',
    'websockets.sync.utils',
    'websockets.typing',
    'websockets.uri',
    'websockets.utils',
    'websockets.version',
    
    # Scapy 핵심 모듈
    'scapy',
    'scapy.all',
    'scapy.arch',
    'scapy.arch.windows',
    'scapy.arch.windows.native',
    'scapy.base_classes',
    'scapy.config',
    'scapy.data',
    'scapy.error',
    'scapy.fields',
    'scapy.interfaces',
    'scapy.layers',
    'scapy.layers.all',
    'scapy.layers.inet',
    'scapy.layers.inet6',
    'scapy.layers.l2',
    'scapy.main',
    'scapy.packet',
    'scapy.plist',
    'scapy.route',
    'scapy.sendrecv',
    'scapy.sessions',
    'scapy.supersocket',
    'scapy.themes',
    'scapy.utils',
    'scapy.volatile',
]

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=None,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=None)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='mobi-meter',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX 비활성화로 압축 문제 방지
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
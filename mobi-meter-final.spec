# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_all, collect_submodules, collect_data_files, collect_dynamic_libs

# Scapy의 모든 데이터와 바이너리 수집
tmp_ret = collect_all('scapy')
datas = tmp_ret[0]
binaries = tmp_ret[1]
hiddenimports = tmp_ret[2]

# 추가 데이터 파일들
datas += [
    ('_skills.json', '.'),
    ('_buffs.json', '.'),
    ('settings.json', '.'),
    ('index.html', '.'),
    ('styles.css', '.'),
    ('app.js', '.')
]

# Brotli 바이너리 추가
try:
    import brotli
    brotli_path = os.path.dirname(brotli.__file__)
    # _brotli.pyd 파일 찾기
    for file in os.listdir(brotli_path):
        if file.startswith('_brotli') and file.endswith('.pyd'):
            binaries += [(os.path.join(brotli_path, file), '.')]
except:
    pass

# WebSockets 모든 모듈 수집
hiddenimports += collect_submodules('websockets')

# 추가 hidden imports
hiddenimports += [
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
    'json',
    'time',
    'struct',
    'dataclasses',
    'typing',
    'collections',
    'brotli',
    '_brotli',
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'websockets.server',
    'websockets.client',
    'websockets.connection',
    'websockets.exceptions',
    'websockets.protocol',
    'scapy',
    'scapy.all',
    'scapy.arch.windows',
    'scapy.arch.windows.native',
    'scapy.arch.pcapdnet',
    'scapy.arch.libpcap',
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
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
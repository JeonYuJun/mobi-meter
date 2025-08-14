# 필요한 라이브러리 임포트
import asyncio
import json
import brotli
import time
import sys
import struct
import webbrowser
from datetime import datetime
from functools import lru_cache
from websockets import serve
from scapy.all import AsyncSniffer, Packet, Raw
from scapy.layers.inet import TCP
from aiohttp import web
import aiohttp_cors

# 버전 정보
__version__ = "1.2.5"
__description__ = "Mabinogi Real-time Damage Meter"

# 전역 설정 변수
DEBUG = False  # 디버그 모드
PORT = 6519    # WebSocket 서버 포트
HTTP_PORT = 6520  # HTTP 서버 포트 (리소스 서빙용)
IFACE = None   # 네트워크 인터페이스
CONNECTED_CLIENTS = set()  # 연결된 클라이언트 추적
LAST_CONNECTION_TIME = 0  # 마지막 연결 시간 (0 = 타이머 비활성)

# 전역 로거 객체 (나중에 초기화됨)
logger = None

# 전역 PacketStreamer 인스턴스 (싱글톤)
global_streamer = None

# 시스템 상수 정의
class SystemConstants:
    # 게임 프로토콜 상수 (변경 금지)
    ATTACK_PACKET_SIZE = 35
    SKILL_PACKET_SIZE = 53
    BUFF_END_PACKET_SIZE = 16
    
    # 시스템 설정 상수
    MAX_DAMAGE_THRESHOLD = 2095071572  # 게임 내 최대 데미지
    BUFFER_SIZE = 16384  # 16KB 버퍼
    TCP_WINDOW = 10000  # TCP 재정렬 허용 범위
    MAX_TCP_SEGMENTS = 500  # 최대 TCP 세그먼트 수
    
    # 정리 주기
    CLEANUP_INTERVAL = 300  # 5분마다 메모리 정리
    DATA_RETENTION = 1800  # 30분 이상 된 데이터 삭제
    STATUS_INTERVAL = 60  # 1분마다 상태 출력
    AUTO_SHUTDOWN_DELAY = 180  # 연결이 없을 때 180초 후 자동 종료 (재연결 여유 시간)

# 간단한 로거 (색상 지원)
class SimpleLogger:
    def __init__(self, debug=False):
        self.debug = debug
        self.error_count = {}
        self.suppress_websocket_errors = True  # WebSocket 핸드셰이크 오류 억제
        
        # 색상 코드 (Windows 터미널 지원)
        self.colors = {
            'RESET': '\033[0m',
            'BOLD': '\033[1m',
            'RED': '\033[91m',
            'GREEN': '\033[92m',
            'YELLOW': '\033[93m',
            'BLUE': '\033[94m',
            'MAGENTA': '\033[95m',
            'CYAN': '\033[96m',
            'WHITE': '\033[97m',
            'GRAY': '\033[90m',
        }
        
        # Windows 터미널 색상 지원 활성화
        try:
            import os
            os.system('color')
        except:
            pass
        
    def log(self, message, level="INFO"):
        # WebSocket 핸드셰이크 오류는 무시
        if self.suppress_websocket_errors and "handshake failed" in message:
            return
            
        timestamp = datetime.now().strftime("%H:%M:%S")
        
        # 레벨별 색상 설정
        level_colors = {
            'ERROR': self.colors['RED'],
            'WARNING': self.colors['YELLOW'],
            'SUCCESS': self.colors['GREEN'],
            'INFO': self.colors['CYAN'],
            'IMPORTANT': self.colors['BLUE'],  # 자주색 대신 파란색
            'DEBUG': self.colors['GRAY']
        }
        
        color = level_colors.get(level, self.colors['WHITE'])
        
        # 아이콘 추가 (심플하게)
        icons = {
            'ERROR': '✖',
            'WARNING': '⚠',
            'SUCCESS': '✓',
            'INFO': '•',
            'IMPORTANT': '★',
            'DEBUG': '○'
        }
        
        icon = icons.get(level, '•')
        
        log_msg = f"{self.colors['GRAY']}[{timestamp}]{self.colors['RESET']} {icon} {color}{message}{self.colors['RESET']}"
        
        # 중요한 정보만 출력
        if level in ["ERROR", "WARNING", "IMPORTANT", "SUCCESS"] or self.debug:
            print(log_msg)
            
        # 에러는 파일로도 저장
        if level == "ERROR":
            try:
                with open("error.log", "a", encoding='utf-8') as f:
                    f.write(f"[{timestamp}] {message}\n")
            except:
                pass
                
    def count_error(self, error_type):
        self.error_count[error_type] = self.error_count.get(error_type, 0) + 1
        if self.error_count[error_type] % 10 == 0:
            self.log(f"{error_type} 오류 {self.error_count[error_type]}회 발생", "ERROR")

# 로거는 나중에 초기화 (DEBUG 값이 설정된 후)
logger = None

# 공격 플래그 비트 정의 (각 플래그가 어떤 공격 타입인지 나타냄)
FLAG_BITS = (
    (0, 'crit_flag', 0x01),
    (0, 'what1', 0x02),
    (0, 'unguarded_flag', 0x04),
    (0, 'break_flag', 0x08),

    (0, 'what05', 0x10),
    (0, 'cross_flag', 0x20),
    (0, 'first_hit_flag', 0x40),
    (0, 'default_attack_flag', 0x80),
    
    (1, 'multi_attack_flag', 0x01),
    (1, 'power_flag', 0x02),
    (1, 'fast_flag', 0x04),
    (1, 'dot_flag', 0x08),
    
    (1, 'what15', 0x10),
    (1, 'what16', 0x20),
    (1, 'what17', 0x40),
    (1, 'dot_flag2', 0x80),

    (2, 'dot_flag3', 0x01),
    (2, 'what22', 0x02),
    (2, 'what23', 0x04),
    (2, 'what24', 0x08),
    
    (2, 'what25', 0x10),
    (2, 'what26', 0x20),
    (2, 'what27', 0x40),
    (2, 'what28', 0x80),

    (3, 'what31', 0x01),
    (3, 'what32', 0x02),
    (3, 'what33', 0x04),
    (3, 'add_hit_flag', 0x08),

    (3, 'bleed_flag', 0x10),
    (3, 'dark_flag', 0x20),
    (3, 'fire_flag', 0x40),
    (3, 'holy_flag', 0x80),

    (4, 'ice_flag', 0x01),
    (4, 'electric_flag', 0x02),
    (4, 'poison_flag', 0x04),
    (4, 'mind_flag', 0x08),

    (4, 'dot_flag4', 0x10),
    (4, 'what46', 0x20),
    (4, 'what47', 0x40),
    (4, 'what48', 0x80),
)

# 플래그 바이트에서 각 비트를 추출하여 딕셔너리로 변환
@lru_cache(maxsize=256)
def extract_flags(flags: bytes) -> dict:
    result = {}
    for index, name, mask in FLAG_BITS:
        result[name] = int((flags[index] & mask) != 0) if index < len(flags) else 0
    return result

# 공격 패킷 파싱 (타입 10308)
def parse_attack(data):
    if len(data) != SystemConstants.ATTACK_PACKET_SIZE:
        return ""

    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    target_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p2, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    key1, pivot = int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    key2, pivot = int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    flags, pivot =  data[pivot:pivot+7], pivot+7
    c, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    return {
        "type": 1,
        "hide": False,
        "user_id": user_id,
        "target_id": target_id,
        "key1": key1,
        "key2": key2,
        "flags": extract_flags(flags),
        "ppp": c,
        #"etc": f"a:{key2}, c:{c}",
    }

# 스킬 사용 패킷 파싱 (타입 100041)
def parse_action(data):
    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    skill_name_len, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    skill_name, pivot =  data[pivot:pivot+skill_name_len], pivot+skill_name_len

    skill_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p2, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    what1, pivot =  data[pivot:pivot+17], pivot+17
    key1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    return {
        "type": 2,
        "hide": False,
        "user_id": user_id,
        #"skill_id": skill_id,
        #"what1": what1.hex(),
        "skill_name": skill_name.replace(b'\x00', b'').decode('utf-8', errors='replace').strip(),
        "key1": key1,
    }

# HP 변화 패킷 파싱 (타입 100178)
def parse_hp_changed(data):
    pivot = 0

    target_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    a, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    
    prev, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    b, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4    

    current, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    c, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
  
    return {
        "type": 3,
        "target_id": target_id,
        "prev_hp": prev,
        "current_hp": current,
    }

# 자가 데미지 패킷 파싱 (타입 10719)
def parse_self_damage(data):
    if len(data) != SystemConstants.SKILL_PACKET_SIZE:
        return ""

    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    e1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    target_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    e2, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    
    damage, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    e3, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    
    siran, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    e4, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    
    flags, pivot =  data[pivot:pivot+7], pivot+7

    return {
        "type": 4,
        "hide": False,
        "user_id": user_id,
        "target_id": target_id,
        "damage": damage,
        "flags": extract_flags(flags),
    }

# 공격력 패킷 파싱 (타입 100085)
def parse_atk(data):
    if len(data) != 16:
        return ""

    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    e1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    atk, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    e2, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    return {
        "type": 100085,
        "hide": False,
        "user_id": user_id,
        "atk": atk,
    }

# 버프 시작 패킷 파싱 (타입 100046)
def parse_buff(data):
    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    inst_key, pivot =  data[pivot:pivot+8].hex(), pivot+8

    key, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    flags, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    stack1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    stack2, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    adds = []
    for i in range(stack2):
        add, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
        adds.append(add)

    target_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p4, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    chunks = [data[i:i+4] for i in range(0, len(data), 4)]
    raw_hex_chunks = []
    for chunk in chunks:
        if len(chunk) > 0:
            raw_hex_chunks.append(chunk.hex())
    # 8바이트씩 끊어서 /로 구분
    payload_hex = " / ".join(raw_hex_chunks)
    
    return {
        "type": 11,
        "hide": False,
        "inst_key": inst_key,
        "buff_key": key,
        "user_id": user_id,
        "target_id": target_id,
        "stack": stack1,
        "length": len(data),
        "hex": payload_hex,
    }

# 버프 업데이트 패킷 파싱 (타입 100049)
def parse_buff_update(data):

    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    inst_key, pivot =  data[pivot:pivot+8].hex(), pivot+8

    key, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    flags, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    stack1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    stack2, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    adds = []
    for i in range(stack2):
        add, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
        adds.append(add)

    target_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p4, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    flags, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+8

    chunks = [data[i:i+4] for i in range(0, len(data), 4)]
    raw_hex_chunks = []
    for chunk in chunks:
        if len(chunk) > 0:
            raw_hex_chunks.append(chunk.hex())
    payload_hex = " / ".join(raw_hex_chunks)
    
    return {
        "type": 12,
        "hide": False,
        "inst_key": inst_key,
        "buff_key": key,
        "user_id": user_id,
        "target_id": target_id,
        "stack": stack1,
        "length": len(data),
        "hex": payload_hex,
    }

# 버프 종료 패킷 파싱 (타입 100047)
def parse_buff_end(data):
    pivot = 0

    user_id, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4
    p1, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    inst_key, pivot =  data[pivot:pivot+8].hex(), pivot+8

    flags, pivot =  int.from_bytes(data[pivot:pivot+4], byteorder='little'), pivot+4

    chunks = [data[i:i+4] for i in range(0, len(data), 4)]
    raw_hex_chunks = []
    for chunk in chunks:
        if len(chunk) > 0:
            raw_hex_chunks.append(chunk.hex())
    payload_hex = " / ".join(raw_hex_chunks)
    
    return {
        "type": 13,
        "hide": False,
        "inst_key": inst_key,
        "user_id": user_id,
        "flags": flags,
        "length": len(data),
        "hex": payload_hex,
    }

# 패킷 타입별 파싱 함수 매핑
parse_dict = {
    10308: parse_attack,
    100041: parse_action,      
    100178: parse_hp_changed,  # 체력 변화, (4 대상, 4 패딩, 4 기존, 4 패딩, 4 현재, 4패딩)
    10719: parse_self_damage,
    100085: parse_atk,
    100046: parse_buff,
    100049: parse_buff_update,
    100047: parse_buff_end
    }

# 패킷 분석 도구 함수들

# TCP 시퀀스 번호 관련 상수 및 함수
SEQ_MOD = 2**32

def seq_distance(a, b):
    return ((a - b + 2**31) % 2**32) - 2**31

# 네트워크 패킷을 캡처하고 처리하는 메인 클래스
class PacketStreamer:
    def __init__(self, filter_expr: str = "tcp and src port 16000"):  # 마비노기 서버 포트 16000
        self.queue: asyncio.Queue[Packet] = asyncio.Queue()
        # 디버그: 필터 표현식 출력
        if logger:
            logger.log(f"패킷 캡처 필터: {filter_expr}, 인터페이스: {IFACE}", "INFO")
        self.sniffer = AsyncSniffer(filter=filter_expr, prn=self._enqueue_packet, iface=IFACE)
        self.loop = asyncio.get_event_loop()
        self.buffer:bytes = b''
        self.tcp_segments = {}
        self.current_seq = None
        # 패킷 로깅 옵션 확인
        global settings
        packet_logging = settings.get("PacketLogging", False) if 'settings' in globals() else False
        self.analyzer = CombatLogAnalyzer(packet_logging_enabled=packet_logging)
        if packet_logging and logger:
            logger.log("패킷 로깅 활성화됨", "INFO")
        self.is_running = False
        self.status_task = None
        self.cleanup_task = None
        self.process_task = None  # 패킷 처리 태스크
        self.broadcast_task = None  # 데이터 브로드캐스트 태스크
        self.connected_websockets = set()  # 연결된 웹소켓 추적
        self.packet_count = 0  # 디버그: 패킷 카운터

    # 상태 모니터링
    async def print_status(self):
        """주기적으로 시스템 상태 출력"""
        while True:
            try:
                await asyncio.sleep(SystemConstants.STATUS_INTERVAL)  # 1분마다
                user_count = len(self.analyzer._user_data)
                segment_count = len(self.tcp_segments)
                buffer_size = len(self.buffer)
                
                # 상태 정보는 디버그 모드에서만 로그로 기록
                if logger and logger.debug:
                    logger.log(f"유저: {user_count} | TCP세그먼트: {segment_count} | 버퍼: {buffer_size}B", "DEBUG")
                
                # 에러 통계가 있으면 출력
                if logger and logger.error_count and logger.debug:
                    logger.log(f"에러 카운트: {dict(logger.error_count)}", "ERROR")
                    
            except Exception as e:
                if logger:
                    logger.log(f"상태 출력 오류: {e}", "ERROR")
    
    # 패킷 캡처 시작 (한 번만 실행)
    async def start_capture(self):
        if not self.is_running:
            self.is_running = True
            self.sniffer.start()
            self.status_task = asyncio.create_task(self.print_status())
            self.cleanup_task = asyncio.create_task(self.analyzer.cleanup_old_data())
            self.process_task = asyncio.create_task(self._process())  # 패킷 처리 태스크
            self.broadcast_task = asyncio.create_task(self._process2())  # 브로드캐스트 태스크
            if logger:
                logger.log("패킷 캡처 시작", "INFO")
    
    # 패킷 캡처 중지
    async def stop_capture(self):
        if self.is_running:
            self.is_running = False
            # 패킷 로그 저장
            if self.analyzer.packet_logger.enabled:
                self.analyzer.packet_logger.save_to_file()
            if self.status_task:
                self.status_task.cancel()
            if self.cleanup_task:
                self.cleanup_task.cancel()
            if self.process_task:
                self.process_task.cancel()
            if self.broadcast_task:
                self.broadcast_task.cancel()
            self.sniffer.stop()
            if logger:
                logger.log("패킷 캡처 중지", "INFO")
            self.sniffer.join()
    
    # 클라이언트 연결 추가
    async def add_client(self, websocket):
        self.connected_websockets.add(websocket)
        await self.start_capture()  # 첫 클라이언트 연결 시 캡처 시작
        
        # 클라이언트가 연결되면 클라이언트 측에서 자동으로 clear 명령을 보냄
        # 따라서 서버에서는 아무 데이터도 전송하지 않음
        if logger:
            logger.log("새 클라이언트 연결됨 - 클라이언트 측 자동 초기화 대기", "DEBUG")
    
    # 클라이언트 연결 제거
    async def remove_client(self, websocket):
        self.connected_websockets.discard(websocket)
        if not self.connected_websockets:  # 모든 클라이언트가 연결 해제되면
            await self.stop_capture()  # 캡처 중지
    
    # 데이터 초기화 (clear 명령 처리)
    def clear_data(self):
        # CombatLogAnalyzer 초기화
        self.analyzer._raw_data.clear()
        self.analyzer._damage_by_user_by_target_by_skill = {0:{0:{"": CombatDetailData()}}}
        self.analyzer._self_damage_by_user_by_target_by_skill = {0:{0:{"": CombatDetailData()}}}
        self.analyzer._buff_uptime_by_user_by_target_by_skill = {0:{0:{"": {"": BuffUptimeData()}}}}
        self.analyzer._buff_by_user_by_inst.clear()
        self.analyzer._time_data = {}  # clear() 대신 새 딕셔너리 할당
        self.analyzer._enemy_data = EnemyData()
        self.analyzer._user_tmp_data.clear()
        self.analyzer._user_data.clear()
        self.analyzer._self_damage_by_user.clear()
        self.analyzer._max_self_damage_by_user = SimpleDamageData()
        self.analyzer._data_changed = True
        self.analyzer._cached_json_data = None
        self.analyzer._last_sent_data_hash = None  # 해시도 초기화
        self.analyzer._last_combat_time = time.time()
        self.analyzer._is_user_data_updated = False  # 유저 데이터 플래그 초기화
        
        # PacketStreamer 버퍼 초기화
        self.buffer = b''
        self.tcp_segments.clear()
        self.current_seq = None
        
        if logger:
            logger.log("전투 데이터 초기화 완료", "INFO")
    
    # WebSocket 클라이언트에게 데이터 스트리밍
    async def stream(self, websocket) -> None:
        await self.add_client(websocket)
        # 각 클라이언트는 메시지 핸들링만 담당
        message_task = asyncio.create_task(self._handle_messages(websocket))
        try:
            await websocket.wait_closed()
        except Exception as e:
            error_msg = str(e)
            if logger and "1000" not in error_msg and "1001" not in error_msg:
                logger.log(f"WebSocket 스트림 오류: {e}", "DEBUG")
        finally:
            message_task.cancel()
            try:
                await message_task
            except asyncio.CancelledError:
                pass
            await self.remove_client(websocket)
    
    # WebSocket 메시지 처리
    async def _handle_messages(self, websocket) -> None:
        try:
            async for message in websocket:
                if message == "clear":
                    self.clear_data()
                    # 클리어 확인 메시지 전송
                    try:
                        await websocket.send(json.dumps({
                            "type": "clear_confirmed",
                            "timestamp": time.time()
                        }))
                    except Exception:
                        pass  # 전송 실패 무시
                elif message == "ping":
                    # 클라이언트 heartbeat에 pong으로 응답
                    try:
                        await websocket.send("pong")
                    except Exception:
                        pass  # 전송 실패 무시
        except asyncio.CancelledError:
            pass
        except Exception as e:
            error_msg = str(e)
            # 정상적인 연결 종료는 무시
            if "1000" not in error_msg and "1001" not in error_msg:
                if logger:
                    logger.log(f"메시지 처리 오류: {e}", "ERROR")

    def _enqueue_packet(self, pkt: Packet) -> None:
        self.packet_count += 1
        # 디버그: 패킷 캡처 카운터
        if DEBUG and logger and self.packet_count % 100 == 0:
            logger.log(f"캡처된 패킷 수: {self.packet_count}", "DEBUG")
        self.loop.call_soon_threadsafe(self.queue.put_nowait, pkt)

    # 바이너리 데이터에서 게임 패킷 파싱
    
    def _packet_parser(self, data: bytes) -> tuple[list,int]:
        global DEBUG
        res = []
        pivot = 0
        buffer_size = len(data)
        
        # 디버그: 원시 데이터 확인
        if DEBUG and logger and len(data) > 0:
            logger.log(f"패킷 파싱 시작 - 데이터 크기: {buffer_size} bytes", "DEBUG")
            # 처음 100바이트만 출력
            logger.log(f"원시 데이터 (처음 100바이트): {data[:min(100, buffer_size)].hex()}", "DEBUG")

        while(pivot < len(data)):
            
            # 패킷 시작 부분 찾기 (마비노기 패킷 시그니처)
            start_pivot = data.find(b'\x68\x27\x00\x00\x00\x00\x00\x00\x00', pivot)
            if start_pivot == -1:
                if DEBUG and logger and buffer_size > 0:
                    logger.log(f"패킷 시그니처를 찾을 수 없음 (pivot: {pivot})", "DEBUG")
                break
            # 패킷 끝 부분 찾기
            if data.find(b'\xe3\x27\x00\x00\x00\x00\x00\x00\x00', start_pivot + 9) == -1:
                break
            pivot = start_pivot + 9  # 패킷 시작 부분 이후로 이동

            # 패킷이 완전한지 확인
            while ( buffer_size > pivot + 9):

                # 데이터 타입, 길이, 인코딩 타입 추출
                data_type = int.from_bytes(data[pivot:pivot+4], byteorder='little')
                length = int.from_bytes(data[pivot+4:pivot+8], byteorder='little')
                encode_type = data[pivot+8]

                if data_type == 0:
                    break
                
                if buffer_size <= pivot + 9 + length:
                    break

               # 컨텐츠 추출
                content = data[pivot+9:pivot+9+length]

                try:
                    if encode_type == 1:
                        pass
                    elif data_type in parse_dict:
                        parse_func = parse_dict[data_type]
                        content = parse_func(content)
                        res.append(content)
                        # 디버그: 파싱된 패킷 확인
                        if DEBUG and logger and content:
                            if content.get("type") == 4:  # 데미지 패킷
                                logger.log(f"데미지 패킷 파싱: 유저ID={content.get('user_id')}, 데미지={content.get('damage')}", "DEBUG")
                    else:
                        # 알려지지 않은 패킷 타입
                        if DEBUG:
                            if logger:
                                logger.log(f"알려지지 않은 패킷 타입: {data_type}, 크기: {len(content)}", "INFO")
                            
                except Exception as e:
                    logger.count_error(f"packet_parse_{data_type}")
                    if DEBUG:
                        if logger:
                            logger.log(f"패킷 파싱 오류 (타입 {data_type}): {e}", "ERROR")

                pivot += 9 + length

        return (res, pivot)
    
    # TCP 패킷을 수집하고 재조립하는 메인 프로세스
    async def _process(self) -> None:
        while True:
            try:
                pkt: Packet = await self.queue.get()
            except asyncio.CancelledError as e:
                if logger:
                    logger.log("패킷 처리 취소됨", "INFO")
                break

            if pkt.haslayer(Raw):
                seq = pkt[TCP].seq
                payload = bytes(pkt[Raw].load)
                
                # 디버그: TCP 패킷 수신 확인
                if DEBUG and logger:
                    logger.log(f"TCP 패킷 수신 - SEQ: {seq}, 페이로드 크기: {len(payload)} bytes", "DEBUG")
                
                if self.current_seq is None:
                    self.current_seq = seq

                if abs(seq_distance(seq,self.current_seq)) > SystemConstants.TCP_WINDOW:
                    self.tcp_segments.clear()
                    self.current_seq = None
                    self.buffer = b''
                    continue
                    
                # TCP 세그먼트 수 제한
                if len(self.tcp_segments) > SystemConstants.MAX_TCP_SEGMENTS:
                    # 오래된 세그먼트 절반 삭제
                    sorted_seqs = sorted(self.tcp_segments.keys())
                    for seq in sorted_seqs[:len(sorted_seqs)//2]:
                        del self.tcp_segments[seq]
                    if logger:
                        logger.log(f"TCP 세그먼트 정리: {len(sorted_seqs)} -> {len(self.tcp_segments)}", "INFO")
                    
                if seq not in self.tcp_segments or self.tcp_segments[seq] != payload:
                    self.tcp_segments[seq] = payload

                if self.current_seq not in self.tcp_segments:
                    pass
                
                # 재조립
                while self.current_seq in self.tcp_segments:
                    segment = self.tcp_segments.pop(self.current_seq)
                    self.buffer += segment
                    self.current_seq = (self.current_seq + len(segment)) % SEQ_MOD

                if len(self.buffer) > SystemConstants.BUFFER_SIZE:
                    # 버퍼가 너무 크면 절반 정리
                    self.buffer = self.buffer[len(self.buffer)//2:]
                    if DEBUG:
                        if logger:
                            logger.log(f"버퍼 정리: {SystemConstants.BUFFER_SIZE} bytes 초과", "INFO")

                parsed, pivot = self._packet_parser(self.buffer)
                self.buffer = self.buffer[pivot:]

                if parsed:
                    try:
                        for entry in parsed:
                            self.analyzer.update(entry)
                    except Exception as e:
                        if logger:
                            logger.log(f"데이터 분석 오류: {e}", "ERROR")
                        if DEBUG:
                            break
                        # 디버그 모드가 아니면 계속 실행

    # 분석된 데이터를 주기적으로 WebSocket으로 전송
    async def _process2(self) -> None:
        while True:
            try:
                # 모든 연결된 클라이언트에게 브로드캐스트
                for ws in list(self.connected_websockets):
                    try:
                        await self.analyzer.send_data(ws)
                    except Exception as e:
                        error_msg = str(e)
                        # 개별 클라이언트 전송 실패 처리
                        if logger and DEBUG:
                            if "1001" in error_msg or "1011" in error_msg or "keepalive" in error_msg.lower():
                                # 연결 종료 관련 에러는 DEBUG 레벨로
                                logger.log(f"클라이언트 연결 종료됨", "DEBUG")
                            else:
                                logger.log(f"클라이언트 전송 실패: {e}", "DEBUG")
                        # 연결이 끊긴 클라이언트는 제거
                        self.connected_websockets.discard(ws)
                
                # 전투 상태에 따라 전송 주기 조절
                if self.analyzer._data_changed:
                    # 데이터 변경 시 빠른 업데이트
                    await asyncio.sleep(0.3)
                else:
                    # 변경 없을 때 느린 업데이트
                    await asyncio.sleep(1.5)
                    
            except asyncio.CancelledError as e:
                if logger:
                    logger.log("데이터 전송 취소됨", "INFO")
                break
            except Exception as e:
                if logger:
                    logger.log(f"WebSocket 전송 오류: {e}", "ERROR")
                await asyncio.sleep(1)  # 에러 발생시 잠시 대기 후 재시도

# 데이터 분석 관련 임포트
import time
from dataclasses import dataclass, field, asdict, is_dataclass
from collections import defaultdict
from typing import Dict, Any, DefaultDict

# 데미지 통계 데이터 클래스
@dataclass
class DamageData:
    total_damage: int = 0
    total_count: int = 0
    crit_count: int = 0
    addhit_count: int = 0
    power_count: int = 0
    fast_count: int = 0
    max_damage: int = 0
    min_damage: int = 0
    
    # 슬라이딩 윈도우 DPS를 위한 히스토리
    damage_history: list = field(default_factory=list)  # [(damage, timestamp), ...]
    sliding_window_dps: float = 0.0
    
    # 평균 공증/피증 계산을 위한 데이터
    base_damage_list: list = field(default_factory=list)
    actual_damage_list: list = field(default_factory=list)
    
    def add_damage_record(self, damage: int, timestamp: float, is_base: bool = False):
        """데미지 기록 추가 및 오래된 기록 정리"""
        self.damage_history.append((damage, timestamp))
        
        # 30분 이상 된 기록 제거
        cutoff_time = timestamp - 1800
        self.damage_history = [(d, t) for d, t in self.damage_history if t > cutoff_time]
        
        # base/actual 데미지 기록
        if is_base:
            self.base_damage_list.append(damage)
            if len(self.base_damage_list) > 1000:  # 최대 1000개만 유지
                self.base_damage_list = self.base_damage_list[-1000:]
        else:
            self.actual_damage_list.append(damage)
            if len(self.actual_damage_list) > 1000:
                self.actual_damage_list = self.actual_damage_list[-1000:]
    
    def calculate_sliding_dps(self, window_seconds: int = 5) -> float:
        """슬라이딩 윈도우 DPS 계산 (기본 5초)"""
        if not self.damage_history:
            return 0.0
        
        current_time = time.time()
        cutoff_time = current_time - window_seconds
        recent_damages = [d for d, t in self.damage_history if t >= cutoff_time]
        
        if not recent_damages:
            return 0.0
            
        total_damage = sum(recent_damages)
        return total_damage / window_seconds
    
    def calculate_avg_multiplier(self) -> float:
        """평균 공증 계산"""
        if not self.base_damage_list or not self.actual_damage_list:
            return 100.0
        
        avg_base = sum(self.base_damage_list) / len(self.base_damage_list)
        avg_actual = sum(self.actual_damage_list) / len(self.actual_damage_list)
        
        if avg_base == 0:
            return 100.0
            
        return (avg_actual / avg_base) * 100

# 버프 영향 데이터 클래스
@dataclass
class BuffImpactData:
    total_count: int = 0
    total_atk: float = 0
    total_dmg: float = 0

# 힐 데이터 클래스
@dataclass
class HealData:
    total_heal: int = 0
    total_count: int = 0
    min_heal: int = 0
    max_heal: int = 0

# 전투 상세 데이터 클래스 (모든 데미지 타입 포함)
@dataclass
class CombatDetailData:
    all: DamageData = field(default_factory=DamageData)
    normal: DamageData = field(default_factory=DamageData)
    dot: DamageData = field(default_factory=DamageData)
    special: DamageData = field(default_factory=DamageData)
    buff: BuffImpactData = field(default_factory=BuffImpactData)

# 버프 지속시간 데이터 클래스
@dataclass
class BuffUptimeData:
    type: int = 0
    max_stack: int = 0
    total_stack: int = 0  # 버프 스택 누적 값
    total_count: int = 0  # 버프 활성 횟수 (타격 횟수)

# 간단한 데미지 데이터 클래스
@dataclass
class SimpleDamageData:
    total_damage: int = 0
    id: int = 0

# 적 정보 데이터 클래스
@dataclass
class EnemyData:
    max_hp: int = 0
    total_damage: int = 0
    max_hp_tid: int = 0
    most_attacked_tid: int = 0
    last_attacked_tid: int = 0

# 유저 정보 데이터 클래스
@dataclass
class UserData:
    job: str = ""

# 버프 인스턴스 데이터 클래스
@dataclass
class BuffInstData:
    buff_type: int = 0
    buff_flag: int = 0
    buff_name: str = ""
    buff_stack: int = 0
    tid: int = 0

# 유저 임시 데이터 클래스 (현재 버프 상태)
@dataclass
class UserTmpData:
    atk_buff: float = 0.0
    dmg_buff: float = 0.0
    buff: Dict[str, BuffInstData] = field(default_factory=dict[str,BuffInstData])

# 타입 정의 (유저ID -> 타겟ID -> 스킬명 -> 데이터)
DamageContainer = Dict[int, Dict[int, Dict[str, CombatDetailData]]]
BuffUptimeContainer = Dict[int, Dict[int, Dict[str, Dict[str, BuffUptimeData]]]]
BuffInstContainer = Dict[int, Dict[str, BuffInstData]]
UserTmpDataContainer = DefaultDict[int, UserTmpData]

# 도트 데미지 플래그와 한국어 이름 매핑
dotFlag2Name = [
    ["bleed_flag", "출혈"],
    ["dark_flag", "암흑"],
    ["fire_flag", "화상"],
    ["holy_flag", "신성"],
    ["ice_flag", "빙결"],
    ["electric_flag", "감전"],
    ["poison_flag", "중독"],
    ["mind_flag", "정신"],
    ["dump_flag123", "무속성"]
]

# 패킷 로거 클래스
class PacketLogger:
    def __init__(self, enabled=False):
        self.enabled = enabled
        self.packets = []
        self.session_start = time.time()
        self.damage_calculations = []
        self.packet_counts = {1: 0, 2: 0, 3: 0, 4: 0, 11: 0, 12: 0, 13: 0}
        
    def log_packet(self, packet_type, raw_data, processed_data=None):
        if not self.enabled:
            return
            
        self.packet_counts[packet_type] = self.packet_counts.get(packet_type, 0) + 1
        
        log_entry = {
            "timestamp": time.time(),
            "type": packet_type,
            "raw_data": raw_data,
            "processed": processed_data
        }
        
        self.packets.append(log_entry)
        
        # 10000개 넘으면 저장하고 일부만 유지
        if len(self.packets) > 10000:
            self.save_to_file()
            # 최근 1000개만 유지
            self.packets = self.packets[-1000:]
            self.damage_calculations = self.damage_calculations[-500:]
            
    def log_damage_calculation(self, uid, tid, damage, source, skill=""):
        if not self.enabled:
            return
            
        calc_entry = {
            "timestamp": time.time(),
            "uid": uid,
            "tid": tid,
            "damage": damage,
            "source": source,
            "skill": skill
        }
        
        self.damage_calculations.append(calc_entry)
        
    def save_to_file(self):
        if not self.enabled or len(self.packets) == 0:
            return
            
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"packet_log_{timestamp}.json"
        
        summary = {
            "session_start": datetime.fromtimestamp(self.session_start).isoformat(),
            "session_end": datetime.now().isoformat(),
            "packet_counts": self.packet_counts,
            "total_packets": len(self.packets),
            "damage_calculations": len(self.damage_calculations)
        }
        
        log_data = {
            "summary": summary,
            "packets": self.packets[-5000:],  # 최근 5000개만 저장
            "damage_calculations": self.damage_calculations[-2000:]  # 최근 2000개만
        }
        
        try:
            import os
            os.makedirs("packet_logs", exist_ok=True)
            filepath = os.path.join("packet_logs", filename)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(log_data, f, ensure_ascii=False, indent=2)
                
            if logger:
                logger.log(f"패킷 로그 저장: {filepath}", "INFO")
        except Exception as e:
            if logger:
                logger.log(f"패킷 로그 저장 실패: {e}", "ERROR")

# 전투 로그를 분석하고 통계를 생성하는 메인 분석 클래스
class CombatLogAnalyzer:
    def __init__(self, packet_logging_enabled=False):
        self._raw_data: Dict[int, Any] = {}
        
        # 패킷 로거 초기화
        self.packet_logger = PacketLogger(enabled=packet_logging_enabled)

        # 메인 데이터베이스
        self._damage_by_user_by_target_by_skill: DamageContainer = {0:{0:{"": CombatDetailData()}}}
        self._self_damage_by_user_by_target_by_skill: DamageContainer = {0:{0:{"": CombatDetailData()}}}
        self._buff_uptime_by_user_by_target_by_skill: BuffUptimeContainer = {0:{0:{"": {"": BuffUptimeData()}}}}

        # 임시 데이터
        self._buff_by_user_by_inst: BuffInstContainer = {}

        self._time_data: Dict[int, Any] = {}
        self._enemy_data: EnemyData = EnemyData()
        self._user_tmp_data: UserTmpDataContainer = defaultdict(UserTmpData)

        self._is_user_data_updated: bool = False
        self._user_data: Dict[int,UserData] = {}

        self._self_damage_by_user: DefaultDict[int, SimpleDamageData] = defaultdict(SimpleDamageData)
        self._max_self_damage_by_user: SimpleDamageData = SimpleDamageData()
        
        # 성능 최적화를 위한 캐시
        self._last_sent_data_hash = None  # 마지막 전송 데이터 해시
        self._data_changed = True  # 데이터 변경 플래그
        self._cached_json_data = None  # JSON 캐시
        self._last_combat_time = time.time()  # 마지막 전투 시간

        # 스킬 및 버프 데이터 파일 로드
        import sys
        import os
        if getattr(sys, 'frozen', False):
            # PyInstaller로 빌드된 exe 실행시 - 임시 폴더 사용
            base_path = sys._MEIPASS
        else:
            base_path = os.path.dirname(os.path.abspath(__file__))
            base_path = os.path.dirname(base_path)  # src 폴더의 상위 폴더로 이동
        
        # 데이터 파일 경로 설정
        skills_path = os.path.join(base_path, 'data', '_skills.json')
        buffs_path = os.path.join(base_path, 'data', '_buffs.json')
        
        with open(skills_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            self._skill_code_2_name:Dict[str,str]        = data["Code2Name"]
            self._skill_rawname_2_name:Dict[str,str]     = data["RawName2Name"]
            self._skill_unhandled_rawnames:Dict[str,str] = data["UnhandledRawNames"]
        with open(buffs_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            self._buff_name_2_detail:Dict[str,Dict]      = data["info"]
            self._buff_unhandled_code:Dict[str,str]      = data["UnhandledCode"]
            self._buff_code_2_name:Dict[str,str]         = {}
            for key, item in self._buff_name_2_detail.items():
                self._buff_code_2_name[str(item.get("code",""))] = key

    # 오래된 데이터 정리
    async def cleanup_old_data(self):
        """30분 이상 된 데이터를 자동으로 정리"""
        while True:
            try:
                await asyncio.sleep(SystemConstants.CLEANUP_INTERVAL)  # 5분마다
                current_time = time.time()
                cleaned_count = 0
                
                # 시간 데이터 정리
                for uid in list(self._time_data.keys()):
                    if uid in self._time_data:
                        end_time = self._time_data[uid].get('end', 0)
                        if current_time - end_time > SystemConstants.DATA_RETENTION:
                            # 관련 데이터 모두 삭제
                            del self._time_data[uid]
                            if uid in self._damage_by_user_by_target_by_skill:
                                del self._damage_by_user_by_target_by_skill[uid]
                            if uid in self._self_damage_by_user_by_target_by_skill:
                                del self._self_damage_by_user_by_target_by_skill[uid]
                            if uid in self._buff_uptime_by_user_by_target_by_skill:
                                del self._buff_uptime_by_user_by_target_by_skill[uid]
                            if uid in self._user_data:
                                del self._user_data[uid]
                            cleaned_count += 1
                
                if cleaned_count > 0:
                    if logger:
                        logger.log(f"메모리 정리: {cleaned_count}명의 오래된 데이터 삭제", "INFO")
                    
            except Exception as e:
                if logger:
                    logger.log(f"메모리 정리 오류: {e}", "ERROR")
    
    # WebSocket으로 분석된 데이터 전송 (성능 최적화)
    async def send_data(self, websocket):
        # 데이터 변경이 없으면 전송 건너뛰기
        if not self._data_changed:
            return
        
        # 전투 중인지 확인 (마지막 데이터로부터 10초 이내)
        is_combat_active = (time.time() - self._last_combat_time) < 10
        
        # 캐싱된 JSON 데이터가 없거나 전투 중일 때만 새로 생성
        if is_combat_active or self._cached_json_data is None:
            # 필요한 경우에만 recursive_asdict 수행
            def recursive_asdict(obj):
                if is_dataclass(obj) and not isinstance(obj, type):
                    return {k: recursive_asdict(v) for k, v in asdict(obj).items()}
                elif isinstance(obj, dict):
                    return {str(k): recursive_asdict(v) for k, v in obj.items()}
                else:
                    return obj
            
            # 전투 시간 계산
            combat_duration = self._calculate_combat_duration()
            
            # 버프 가동률 계산 (타격 횟수 기반)
            buff_stats = self._calculate_buff_stats()
            
            data = {
                "self_id": self._max_self_damage_by_user.id,
                "enemy": {
                    "max_hp_tid": self._enemy_data.max_hp_tid,
                    "most_attacked_tid": self._enemy_data.most_attacked_tid,
                    "last_attacked_tid": self._enemy_data.last_attacked_tid,
                },
                "damage":recursive_asdict(self._damage_by_user_by_target_by_skill),
                "damage2":recursive_asdict(self._self_damage_by_user_by_target_by_skill),
                "buff":recursive_asdict(self._buff_uptime_by_user_by_target_by_skill),
                "hit_time":recursive_asdict(self._time_data),
                "stats": {
                    "combat_duration": combat_duration,
                    "buff_uptime": buff_stats
                }
            }
            
            if self._is_user_data_updated:
                self._is_user_data_updated = False
                data["user"] = recursive_asdict(self._user_data)
            if DEBUG:
                data["user_tmp"] = recursive_asdict(self._user_tmp_data)
            
            # 데이터 해시 계산하여 변경 확인
            import hashlib
            data_str = json.dumps(data, sort_keys=True)
            data_hash = hashlib.md5(data_str.encode()).hexdigest()
            
            # 데이터가 실제로 변경되었을 때만 전송
            if data_hash != self._last_sent_data_hash:
                self._last_sent_data_hash = data_hash
                self._cached_json_data = data
            else:
                # 변경 없으면 전송 건너뛰기
                self._data_changed = False
                return
        
        try:
            # 데이터가 없으면 기본 구조 전송
            data_to_send = self._cached_json_data if self._cached_json_data is not None else {
                "self_id": 0,
                "enemy": {"max_hp_tid": 0, "max_hp": 0, "last_attacked_tid": 0},
                "damage": {0: {0: {"": {}}}},
                "damage2": {0: {0: {"": {}}}},
                "buff": {0: {0: {"": {"": {}}}}},
                "hit_time": {},
                "stats": {
                    "combat_duration": 0,
                    "buff_uptime": {}
                }
            }
            await websocket.send(json.dumps({
                "type": "damage",
                "data": data_to_send
            }))
            self._data_changed = False  # 전송 후 플래그 리셋
        except Exception as e:
            if logger:
                logger.log(f"데이터 전송 오류: {e}", "ERROR")

    # 새로운 패킷 데이터로 통계 업데이트
    def update(self, entry):
        type = entry["type"]
        
        # 패킷 로깅
        self.packet_logger.log_packet(type, entry)
        
        # 데이터 변경 표시 및 전투 시간 업데이트
        self._data_changed = True
        self._last_combat_time = time.time()

        if(type == 1):  # 공격 패킷
            uid = entry.get("user_id", 0)
            tid = entry.get("target_id", 0)
            flags = entry.get("flags", {})

            CombatLogAnalyzer._update_hit_time(self._time_data, 0)
            CombatLogAnalyzer._update_hit_time(self._time_data, tid)

            skill = CombatLogAnalyzer._get_skill_key(
                self._skill_code_2_name,
                entry.get("key1", "0"),
                entry.get("key2", "0"),
                CombatLogAnalyzer._is_dot(flags),
                flags
            )
            utdata = self._user_tmp_data.setdefault(uid, UserTmpData())
            is_updated = False
            
            # HP 변화 패킷과 매칭 (타입 3)
            if self._raw_data.get(3) is not None:
                tid3 = self._raw_data[3].get("target_id",0)
                # 타겟 ID가 일치하고 시간차가 적을 때만 매칭
                if tid3 == tid:
                    damage = self._raw_data[3].get("prev_hp", 0) - self._raw_data[3].get("current_hp", 0)
                    if damage > 0:  # 데미지가 양수일 때만
                        CombatLogAnalyzer._update_combat(self._damage_by_user_by_target_by_skill, 
                                                         uid, tid, damage, flags, skill, utdata)
                        is_updated = True
                        # 데미지 계산 로깅
                        self.packet_logger.log_damage_calculation(uid, tid, damage, "type1+3", skill)
                        self._raw_data[3] = None  # 사용한 패킷은 초기화

            # 자가 데미지 패킷과 매칭 (타입 4)
            if self._raw_data.get(4) is not None:
                tid4 = self._raw_data[4].get("target_id",0)
                uid4 = self._raw_data[4].get("user_id", 0)
                # 유저 ID와 타겟 ID가 일치할 때만
                if tid4 == tid and uid4 == uid:
                    damage = self._raw_data[4].get("damage", 0)
                    if damage > 0:  # 데미지가 양수일 때만
                        CombatLogAnalyzer._update_combat(self._self_damage_by_user_by_target_by_skill, 
                                                         uid, tid, damage, flags, skill, utdata)
                        # 데미지 계산 로깅
                        self.packet_logger.log_damage_calculation(uid, tid, damage, "type1+4", skill)
                        CombatLogAnalyzer._update_enemy_data(self._enemy_data, tid, 0, self._self_damage_by_user_by_target_by_skill[0][tid][""].all.total_damage)
                        is_updated = True
                        self._raw_data[4] = None  # 사용한 패킷은 초기화

            # 타격 시 버프 가동률 업데이트 (참고 미터기 방식)
            if CombatLogAnalyzer._is_dot(flags) == False and is_updated:
                # 현재 활성화된 버프를 카운트
                CombatLogAnalyzer._update_buff_uptime(
                    self._buff_uptime_by_user_by_target_by_skill, 
                    uid, tid, skill, 
                    self._user_tmp_data[uid]
                )

        elif type == 2:  # 스킬 사용 패킷
            uid = entry.get("user_id", 0)
            key1:str = str(entry.get("key1", "0"))
            key2:str = str(entry.get("key2", "0"))
            skill_name:str = entry.get("skill_name", "")
            if key1 not in self._skill_code_2_name and skill_name not in self._skill_unhandled_rawnames:
                self._skill_code_2_name[key1] = self._skill_rawname_2_name.get(skill_name, skill_name)
            
            self._is_user_data_updated |= CombatLogAnalyzer._update_user_job(self._user_data.setdefault(uid, UserData()), skill_name)

        elif type == 3:  # HP 변화 패킷
            self._raw_data[3] = entry
            hp = entry.get("prev_hp", 0)
            tid = entry.get("target_id", 0)
            CombatLogAnalyzer._update_enemy_data(self._enemy_data, tid, hp, 0)
            
        elif type == 4:  # 자가 데미지 패킷
            uid = entry["user_id"]
            damage = entry["damage"]            
            if damage > SystemConstants.MAX_DAMAGE_THRESHOLD: 
                if logger:
                    logger.log(f"비정상 데미지 감지: {damage}", "INFO")
                return
    
            self._raw_data[4] = entry

            self_damage = self._self_damage_by_user.setdefault(uid, SimpleDamageData())
            self_damage.total_damage += damage
            if self._max_self_damage_by_user.total_damage < self_damage.total_damage:
                self._max_self_damage_by_user.id = uid
                self._max_self_damage_by_user.total_damage = self_damage.total_damage
            
            # Type 4 독립 처리 로깅
            tid = entry.get("target_id", 0)
            if tid:
                self.packet_logger.log_damage_calculation(uid, tid, damage, "type4", "")

        elif type == 11 or type == 12:  # 버프 시작/업데이트 패킷
            buff_key = str(entry.get("buff_key",0))
            if buff_key not in self._buff_unhandled_code:
                inst_key = entry.get("inst_key", "")
                stack = entry.get("stack", 0)
                uid = entry.get("user_id", 0)
                tid = entry.get("target_id", 0)
                buff_name = self._buff_code_2_name.get(buff_key, buff_key)
                if DEBUG == True or buff_name != buff_key:
                    # 버프 상태 업데이트
                    CombatLogAnalyzer._update_user_buff(
                        self._buff_by_user_by_inst, 
                        self._user_tmp_data,
                        uid,
                        tid,
                        inst_key, 
                        buff_name, 
                        stack, 
                        self._buff_name_2_detail.get(buff_name)
                    )
        elif type == 13:  # 버프 종료 패킷
            inst_key = entry.get("inst_key", "")
            uid = entry.get("user_id", 0)
            if uid in self._buff_by_user_by_inst and inst_key in self._buff_by_user_by_inst[uid]:
                data = self._buff_by_user_by_inst[uid][inst_key]
                buff_name = data.buff_name
                tid = data.tid
                
                # 버프 상태 업데이트
                CombatLogAnalyzer._update_user_buff(
                    self._buff_by_user_by_inst, 
                    self._user_tmp_data,
                    uid, 
                    0,
                    inst_key, 
                    buff_name, 
                    0, 
                    self._buff_name_2_detail.get(buff_name)
                )
        pass
    
    # 전투 시간 계산
    def _calculate_combat_duration(self) -> float:
        """전투 지속 시간 계산"""
        if not self._time_data:
            return 0.0
        
        # 유효한 데이터만 필터링
        valid_data = []
        for tid, tid_data in self._time_data.items():
            if isinstance(tid_data, dict) and tid_data.get("start", 0) > 0 and tid_data.get("end", 0) > 0:
                valid_data.append(tid_data)
        
        if not valid_data:
            return 0.0
        
        # 모든 타겟의 최초 시작 시간과 최종 종료 시간 찾기
        min_start = min(d["start"] for d in valid_data)
        max_end = max(d["end"] for d in valid_data)
        
        # 음수나 비정상적인 값 방지
        duration = max_end - min_start
        return max(0.0, duration)
    
    # 버프 가동률 통계 계산 (타격 횟수 기반)
    def _calculate_buff_stats(self) -> dict:
        """버프 가동률 계산 - 참고 미터기 방식"""
        buff_stats = {}
        
        # 모든 유저의 버프 데이터 처리
        for uid, uid_data in self._buff_uptime_by_user_by_target_by_skill.items():
            if uid not in buff_stats:
                buff_stats[uid] = {}
            
            # 일반 타격수 계산 (normal + special, 도트 제외)
            normal_hits = 0
            if uid in self._damage_by_user_by_target_by_skill:
                for tid_data in self._damage_by_user_by_target_by_skill[uid].values():
                    for skill_data in tid_data.values():
                        normal_hits += skill_data.normal.total_count + skill_data.special.total_count
            
            # uid의 전체 버프 데이터 (tid=0, skill="")
            if 0 in uid_data and "" in uid_data[0]:
                for buff_name, buff_data in uid_data[0][""].items():
                    if isinstance(buff_data, BuffUptimeData):
                        # 타격 횟수 기반 가동률 계산
                        if normal_hits > 0:
                            uptime = (buff_data.total_count / normal_hits) * 100
                        else:
                            uptime = 0
                        
                        # 평균 스택 계산
                        if buff_data.total_count > 0:
                            avg_stack = buff_data.total_stack / buff_data.total_count
                        else:
                            avg_stack = 0
                        
                        buff_stats[uid][buff_name] = {
                            "uptime": round(min(uptime, 100), 1),  # 100% 초과 방지
                            "avg_stack": round(avg_stack, 1),
                            "max_stack": buff_data.max_stack,
                            "type": buff_data.type
                        }
        
        return buff_stats
    
    # 적 데이터 업데이트
    @staticmethod
    def _update_enemy_data(cc:EnemyData, tid:int, prev_hp:int = 0, total_damage:int = 0):
        if cc.max_hp < prev_hp:
            cc.max_hp = prev_hp
            cc.max_hp_tid = tid
        if cc.total_damage < total_damage:
            cc.total_damage = total_damage
            cc.most_attacked_tid = tid
        cc.last_attacked_tid = tid

    # 타격 시간 기록
    @staticmethod
    def _update_hit_time(cc, tid):
        td = cc.setdefault(tid, {"start":0, "end":0})
        t = time.time()
        if td["start"] == 0: 
            td["start"] = t
        td["end"] = t

    # 전투 데이터 업데이트
    @staticmethod
    def _update_combat(cc:DamageContainer, uid:int, tid:int, damage:int, flags, skill:str, utdata:UserTmpData):
        if damage <= 0: return

        is_dot       = CombatLogAnalyzer._is_dot(flags)
        is_special   = CombatLogAnalyzer._is_special(flags)

        gc = CombatLogAnalyzer._get_damage_container

        for c in [gc(cc,0,tid,"")]:
            CombatLogAnalyzer._update_damage_data(c.all, damage, flags)   
        
        for c in [gc(cc,uid,0,""), gc(cc,uid,tid,"")]:
            CombatLogAnalyzer._update_damage_data(c.all, damage, flags)
            if is_dot == False:
                CombatLogAnalyzer._update_buff_impact_data(c.buff, utdata)
            if is_dot:
                CombatLogAnalyzer._update_damage_data(c.dot, damage, flags)
            elif is_special:
                CombatLogAnalyzer._update_damage_data(c.special, damage, flags)
            else:
                CombatLogAnalyzer._update_damage_data(c.normal, damage, flags)

        for c in [gc(cc,uid,0,skill), gc(cc,uid,tid,skill)]:
            CombatLogAnalyzer._update_damage_data(c.all, damage, flags)
            CombatLogAnalyzer._update_buff_impact_data(c.buff, utdata)
            if is_dot:
                CombatLogAnalyzer._update_damage_data(c.dot, damage, flags)
            elif is_special:
                CombatLogAnalyzer._update_damage_data(c.special, damage, flags)
            else:
                CombatLogAnalyzer._update_damage_data(c.normal, damage, flags)
        
    # 데미지 컨테이너 가져오기 (없으면 생성)
    @staticmethod
    def _get_damage_container(container:DamageContainer, uid: int, tid: int, skill: str) -> CombatDetailData:
        return container.setdefault(uid, {}).setdefault(tid, {}).setdefault(skill, CombatDetailData())
    
    # 데미지 데이터 업데이트
    @staticmethod
    def _update_damage_data(c:DamageData, damage, flags):
        is_crit      = flags.get("crit_flag") == 1
        is_addhit    = flags.get("add_hit_flag") == 1
        is_power     = flags.get("power_flag") == 1
        is_fast      = flags.get("fast_flag") == 1

        c.total_damage  += damage
        c.total_count   += 1
        c.crit_count    += is_crit
        c.addhit_count  += is_addhit
        c.power_count   += is_power
        c.fast_count    += is_fast
        c.max_damage = max(c.max_damage, damage)
        if c.min_damage <= 0:
            c.min_damage = damage
        else:
            c.min_damage = min(c.min_damage, damage)

    # 버프 영향 데이터 업데이트
    @staticmethod
    def _update_buff_impact_data(c:BuffImpactData, utd:UserTmpData):
        c.total_count    += 1
        # 버프 값이 이미 퍼센트이므로 그대로 누적 (나중에 평균 계산)
        c.total_atk      += utd.atk_buff
        c.total_dmg      += utd.dmg_buff

    # 버프 지속시간 업데이트 (타격 시 호출)
    @staticmethod
    def _update_buff_uptime(cc:BuffUptimeContainer, uid, tid, skill, tmpdata: UserTmpData):
        gc = CombatLogAnalyzer._get_buff_uptime_container
        for buff_name, buff_inst in tmpdata.buff.items():
            for c in [gc(cc,uid,0,"",buff_name), gc(cc,uid,tid,"",buff_name), gc(cc,uid,0,skill,buff_name), gc(cc,uid,tid,skill,buff_name)]:
                CombatLogAnalyzer._update_buff_uptime_data(c, buff_inst)

    # 버프 지속시간 컨테이너 가져오기
    @staticmethod
    def _get_buff_uptime_container(container:BuffUptimeContainer, uid: int, tid: int, skill: str, buff: str) -> BuffUptimeData:
        return container.setdefault(uid, {}).setdefault(tid, {}).setdefault(skill, {}).setdefault(buff, BuffUptimeData())
    
    # 버프 지속시간 데이터 업데이트
    @staticmethod
    def _update_buff_uptime_data(c:BuffUptimeData, inst:BuffInstData):
        c.max_stack = max(c.max_stack, inst.buff_stack)
        # 실제 스택 값을 누적 (가중 평균 계산용)
        if inst.buff_stack > 0:
            c.total_stack += inst.buff_stack  # 실제 스택 값 누적
            c.total_count += 1  # 활성 횟수 카운트
        c.type = inst.buff_type
        
    # 유저 버프 상태 업데이트
    @staticmethod
    def _update_user_buff(cc:BuffInstContainer, utdc:UserTmpDataContainer, uid:int, tid:int, inst_key:str, buff_name:str, stack:int, buff_detail:Any):
        data       = cc.setdefault(uid, {}).setdefault(inst_key, BuffInstData())
        prev_stack = data.buff_stack
        user_data  = utdc[uid]
        if buff_detail:
            data.buff_type     = buff_detail.get("type", 0)
            data.buff_flag     = buff_detail.get("flag", 0)
            if data.buff_flag > 0:
                stack = data.buff_stack = 1 if stack > 0 else 0
            user_data.atk_buff += (stack-prev_stack) * buff_detail.get("atk", 0)
            user_data.dmg_buff += (stack-prev_stack) * buff_detail.get("dmg", 0)
        if stack > 0:
            data.buff_name  = buff_name
            data.buff_stack = stack
            data.tid        = tid
            user_data.buff[buff_name] = data
        else:
            if inst_key in cc.get(uid,{}):
                del cc[uid][inst_key]
            if buff_name in user_data.buff:
                del user_data.buff[buff_name]
    
    # 스킬 이름으로 유저 직업 판별
    @staticmethod
    def _update_user_job(user:UserData, raw_sname:str) -> bool:
        if user.job != "": return False
        
        raw_sname = raw_sname.lower()

        if "novicewarrior_shieldbash" in raw_sname: user.job = ""

        elif "expertwarrior" in raw_sname: user.job = "전사"
        elif "greatsword" in raw_sname: user.job = "대검"
        elif "swordmaster" in raw_sname: user.job = "검술"

        elif "healer" in raw_sname: user.job = "힐러"
        elif "monk" in raw_sname: user.job = "수도"
        elif "priest" in raw_sname: user.job = "사제"

        elif "bard" in raw_sname: user.job = "음유"
        elif "battlemusician" in raw_sname: user.job = "악사"
        elif "dancer" in raw_sname: user.job = "댄서"

        elif "fighter" in raw_sname: user.job = "격가"
        elif "dualblades" in raw_sname: user.job = "듀블"
        elif "highthief" in raw_sname: user.job = "도적"

        elif "highmage" in raw_sname: user.job = "븝미"
        elif "firemage" in raw_sname: user.job = "화법"
        elif "icemage" in raw_sname: user.job = "빙결"
        elif "lightningmage" in raw_sname: user.job = "전격"

        elif "higharcher" in raw_sname: user.job = "궁수"
        elif "arbalist" in raw_sname: user.job = "석궁"
        elif "longbowman" in raw_sname: user.job = "장궁"

        elif "novice" in raw_sname: user.job = "뉴비"
        elif "defaultattack" in raw_sname: user.job = ""
        else: user.job = ""

        return user.job != ""
    
    # 스킬 키 생성 (코드를 이름으로 변환)
    @staticmethod
    def _get_skill_key(key2name, key1:str, key2:str, is_dot:bool, flags:Dict):
        skey = None
        key1 = str(key1)
        key2 = str(key2)
        if key1 != "0":
            skey = key2name.get(f"{key1}_{key2}") or key2name.get(key1) or  key1
        else:
            keyparts = ["(도트)" if is_dot else "(특수)"]
            for flag, label in dotFlag2Name:
                if flags.get(flag) == 1:
                    keyparts.append(label)
            if len(keyparts) == 1:
                keyparts.append("무속성")
            skey = " ".join(keyparts)
        return skey
    
    # 도트 데미지 여부 확인
    @staticmethod
    def _is_dot(flags):
        return (flags.get("dot_flag") and flags.get("dot_flag2") and flags.get("dot_flag3")) or flags.get("dot_flag4")
    
    # 특수 공격 여부 확인
    @staticmethod
    def _is_special(flags):
        return (flags.get("dot_flag") or flags.get("dot_flag2") or flags.get("dot_flag3"))




# HTTP 서버 핸들러 - 리소스 파일 서빙
async def handle_http_request(request):
    """HTTP 요청을 처리하여 HTML/CSS/JS 파일 제공"""
    import sys
    import os
    
    # 요청 경로 가져오기
    path = request.path
    if logger:
        logger.log(f"HTTP 요청: {path}", "DEBUG")
    if path == '/':
        path = '/index.html'
    
    # 경로 매핑과 콘텐츠 타입 설정
    file_mappings = {
        '/index.html': ('web/index.html', 'text/html'),
        '/styles.css': ('web/css/styles.css', 'text/css'),
        '/app.js': ('web/js/app.js', 'application/javascript'),
        '/favicon.ico': ('assets/favicon.ico', 'image/x-icon'),
        '/favicon.png': ('assets/favicon.png', 'image/png')
    }
    
    if path not in file_mappings:
        if logger:
            logger.log(f"404 Not Found: {path}", "WARNING")
        return web.Response(text='404: Not Found', status=404)
    
    try:
        # PyInstaller로 빌드된 경우 리소스 경로 찾기
        if getattr(sys, 'frozen', False):
            base_path = sys._MEIPASS
        else:
            base_path = os.path.dirname(os.path.abspath(__file__))
            base_path = os.path.dirname(base_path)  # src 폴더의 상위 폴더로 이동
        
        relative_path, content_type = file_mappings[path]
        file_path = os.path.join(base_path, relative_path)
        
        # 바이너리 파일 처리
        if path.endswith(('.ico', '.png')):
            with open(file_path, 'rb') as f:
                content = f.read()
            return web.Response(
                body=content,
                content_type=content_type
            )
        
        # 텍스트 파일 처리
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # app.js의 WebSocket URL을 동적으로 수정
        if path == '/app.js':
            # localhost를 현재 호스트로 변경 (필요시)
            content = content.replace('ws://localhost:6519', f'ws://localhost:{PORT}')
        
        return web.Response(
            text=content,
            content_type=content_type,
            charset='utf-8'
        )
    except Exception as e:
        if logger:
            logger.log(f"HTTP 서버 파일 읽기 오류: {e}", "ERROR")
        return web.Response(text='Internal Server Error', status=500)

# 메인 함수 - WebSocket 및 HTTP 서버 시작
async def main() -> None:
    global CONNECTED_CLIENTS, LAST_CONNECTION_TIME, logger
    
    # 로거 초기화
    logger = SimpleLogger(debug=DEBUG)
    
    # 시작 메시지 (색상 적용)
    colors = {
        'RESET': '\033[0m',
        'BOLD': '\033[1m',
        'GREEN': '\033[92m',
        'BLUE': '\033[94m',
        'CYAN': '\033[96m',
        'MAGENTA': '\033[95m',
        'YELLOW': '\033[93m',
        'WHITE': '\033[97m',
    }
    
    # 심플한 디자인으로 변경
    startup_msg = f"""
{colors['CYAN']}{'━' * 70}{colors['RESET']}

        {colors['BOLD']}{colors['WHITE']}🎮  Mobi-Meter v{__version__}  🎮{colors['RESET']}
        {colors['YELLOW']}Real-time Damage Meter for Mabinogi{colors['RESET']}

{colors['CYAN']}{'━' * 70}{colors['RESET']}

  {colors['GREEN']}📡 WebSocket:{colors['RESET']}  ws://localhost:{PORT}
  {colors['GREEN']}🌐 HTTP:{colors['RESET']}       http://localhost:{HTTP_PORT}  
  {colors['BLUE']}📊 대시보드:{colors['RESET']}   http://localhost:{HTTP_PORT}/index.html

{colors['CYAN']}{'━' * 70}{colors['RESET']}

  {colors['YELLOW']}💡 종료: Ctrl+C{colors['RESET']}   |   {colors['GREEN']}✅ 서버 실행 중...{colors['RESET']}
"""
    print(startup_msg)
    
    # 추가 안내 메시지
    print("")  # 빈 줄 추가
    logger.log("모든 서비스가 정상적으로 시작되었습니다", "SUCCESS")
    logger.log(f"브라우저에서 http://localhost:{HTTP_PORT} 접속하세요", "INFO")
    
    async def wsserve(websocket) -> None:
        global CONNECTED_CLIENTS, LAST_CONNECTION_TIME, global_streamer
        client_ip = websocket.remote_address[0]
        if DEBUG:
            logger.log(f"클라이언트 연결: {client_ip}", "IMPORTANT")
        
        # 클라이언트 추가
        CONNECTED_CLIENTS.add(websocket)
        # 클라이언트가 있으면 타이머 리셋 (중요!)
        if len(CONNECTED_CLIENTS) > 0:
            LAST_CONNECTION_TIME = 0  # 타이머 완전 리셋
        logger.log(f"새 클라이언트 연결됨 [{client_ip}] | 총 {len(CONNECTED_CLIENTS)}명 접속 중", "SUCCESS")
        
        try:
            # 전역 PacketStreamer 사용 (싱글톤)
            if global_streamer is None:
                global_streamer = PacketStreamer()
                logger.log("전역 PacketStreamer 생성", "INFO")
            
            await global_streamer.stream(websocket)
        except Exception as e:
            # WebSocket 에러 처리 개선
            error_msg = str(e)
            if "1001" in error_msg:
                logger.log(f"클라이언트가 정상적으로 연결을 종료했습니다 [{client_ip}]", "INFO")
            elif "1011" in error_msg or "keepalive" in error_msg.lower():
                logger.log(f"클라이언트 응답 시간 초과 [{client_ip}] - 네트워크 지연 또는 클라이언트 문제", "WARNING")
            else:
                logger.log(f"WebSocket 오류 [{client_ip}]: {error_msg}", "ERROR")
        finally:
            # 클라이언트 제거
            CONNECTED_CLIENTS.discard(websocket)
            logger.log(f"클라이언트 연결 해제 [{client_ip}] | 남은 접속자: {len(CONNECTED_CLIENTS)}명", "WARNING")
            
            # 클라이언트가 남아있으면 타이머 리셋
            if len(CONNECTED_CLIENTS) > 0:
                LAST_CONNECTION_TIME = 0  # 타이머 리셋
            else:
                # 완전히 비었을 때만 타이머 시작
                LAST_CONNECTION_TIME = time.time()  # 현재 시간 설정
                logger.log(f"{SystemConstants.AUTO_SHUTDOWN_DELAY}초 후 자동 종료...", "WARNING")
        
    # HTTP 서버 설정 및 시작
    app = web.Application()
    app.router.add_get('/', handle_http_request)
    app.router.add_get('/{path}', handle_http_request)
    
    # CORS 설정 (필요시)
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*"
        )
    })
    
    for route in list(app.router.routes()):
        cors.add(route)
    
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', HTTP_PORT)
    
    # HTTP 서버 시작
    await site.start()
    logger.log(f"HTTP 서버 시작 완료 - 포트: {HTTP_PORT}", "IMPORTANT")
    
    # 자동 종료 체크 태스크
    async def auto_shutdown_check():
        global CONNECTED_CLIENTS, LAST_CONNECTION_TIME
        while True:
            await asyncio.sleep(5)  # 5초마다 체크
            
            # LAST_CONNECTION_TIME이 0이면 타이머 비활성 상태
            if LAST_CONNECTION_TIME == 0:
                continue
                
            if len(CONNECTED_CLIENTS) == 0:
                idle_time = time.time() - LAST_CONNECTION_TIME
                remaining = SystemConstants.AUTO_SHUTDOWN_DELAY - idle_time
                
                if remaining <= 0:
                    logger.log("연결된 클라이언트가 없어 프로그램을 종료합니다.", "WARNING")
                    # 서버들을 정리하고 종료
                    raise KeyboardInterrupt("자동 종료")
                elif remaining <= 10:
                    logger.log(f"{int(remaining)}초 후 자동 종료...", "INFO")
    
    # WebSocket 서버 시작 (ping/pong 설정 추가)
    ws_server = await serve(
        wsserve, 
        '0.0.0.0', 
        PORT, 
        max_size=10_000_000,
        ping_interval=120,  # 120초마다 ping 전송 (클라이언트 ping과 겹치지 않게)
        ping_timeout=60,    # 60초 내 pong 응답 대기 (충분한 시간)
        close_timeout=10    # 연결 종료 시 10초 대기
    )
    logger.log(f"WebSocket 서버 시작 완료 - 포트: {PORT}", "IMPORTANT")
    logger.log("실시간 데미지 측정 대기중...", "INFO")
    logger.log("관리자 권한으로 실행하세요", "WARNING")
    print("="*70)
    
    # 브라우저 자동 열기 (HTTP 서버 URL)
    logger.log("브라우저를 여는 중...", "INFO")
    try:
        # HTTP 서버 URL로 브라우저 열기
        http_url = f'http://localhost:{HTTP_PORT}'
        webbrowser.open(http_url)
        logger.log(f"브라우저에서 대시보드를 열었습니다: {http_url}", "IMPORTANT")
        # exe 파일 안내 메시지 제거
    except Exception as e:
        logger.log(f"수동으로 브라우저에서 {http_url}를 열어주세요", "WARNING")
    
    print("="*70)
    
    # 자동 종료 체크 시작
    shutdown_task = asyncio.create_task(auto_shutdown_check())
    
    try:
        # 서버 무한 대기
        await asyncio.Future()  # 프로그램이 종료될 때까지 대기
    except (KeyboardInterrupt, asyncio.CancelledError):
        # 정리 작업
        shutdown_task.cancel()
        ws_server.close()
        await ws_server.wait_closed()
        await runner.cleanup()

# 자동 재시작 기능
async def stable_main() -> None:
    """오류 발생시 자동으로 재시작하는 안정적인 메인 함수"""
    restart_count = 0
    max_restarts = 3
    
    while restart_count < max_restarts:
        try:
            await main()
            # main()이 정상 종료되면 (자동 종료 등) 프로그램 종료
            logger.log("프로그램을 종료합니다.", "IMPORTANT")
            break
        except KeyboardInterrupt:
            logger.log("사용자에 의해 중단됨", "INFO")
            break
        except Exception as e:
            restart_count += 1
            error_msg = str(e)
            logger.log(f"서버 오류 발생 (재시작 {restart_count}/{max_restarts}): {error_msg}", "ERROR")
            
            # 포트 충돌 오류 체크
            if "10048" in error_msg or "bind" in error_msg:
                error_msg = f"""
[오류] 포트 {PORT}가 이미 사용 중입니다!
  [해결방법1] 기존 실행 중인 mobi-meter.exe를 종료하세요
  [해결방법2] 작업 관리자에서 python.exe 또는 mobi-meter.exe 프로세스를 종료하세요
  [해결방법3] settings.json에서 다른 포트 번호로 변경하세요"""
                print(error_msg)
                break
            
            if restart_count < max_restarts:
                print(f"\n[오류] 5초 후 재시작... ({restart_count}/{max_restarts})")
                await asyncio.sleep(5)
            else:
                print(f"\n[종료] 재시작 횟수 초과")
                break

# 프로그램 진입점
if __name__ == '__main__':
    import sys
    import os
    import traceback
    
    # 임시 로거 객체 생성 (설정 파일 로드 전까지 사용)
    temp_logger = SimpleLogger(debug=False)
    
    # exe 실행시 실행 파일이 있는 디렉토리에서 settings.json 찾기
    if getattr(sys, 'frozen', False):
        # PyInstaller로 빌드된 exe 실행시
        base_path = sys._MEIPASS  # 임시 폴더에 압축 해제된 파일들의 경로
        # temp_logger.log("DEBUG", f"EXE 모드 - 데이터 경로: {base_path}")
    else:
        # 일반 Python 스크립트 실행시
        base_path = os.path.dirname(os.path.abspath(__file__))
        base_path = os.path.dirname(base_path)  # src 폴더의 상위 폴더로 이동
        # temp_logger.log("DEBUG", f"스크립트 모드 - 데이터 경로: {base_path}")
    
    settings_path = os.path.join(base_path, 'config', 'settings.json')
    # temp_logger.log("DEBUG", f"설정 파일 경로: {settings_path}")
    
    # 전역 settings 변수 초기화
    global settings
    settings = {}
    
    try:
        with open(settings_path, 'r', encoding='utf-8') as f:
            settings = json.load(f)  # 전체 설정을 전역 변수에 저장
            DEBUG   = settings.get("Debug", False)
            PORT    = settings.get("Port", 8080)
            IFACE    = settings.get("Iface", None)
            if IFACE == "None": IFACE = None
            # temp_logger.log("INFO", f"설정 파일 로드 성공 - Debug={DEBUG}")
    except FileNotFoundError:
        # temp_logger.log("INFO", "settings.json 없음 - 기본값 사용")
        settings = {"Debug": False, "Port": 8080, "Iface": None, "PacketLogging": False}
        DEBUG = False
        PORT = 8080
        IFACE = None
    except Exception as e:
        # temp_logger.log("ERROR", f"설정 파일 로드 실패: {e}")
        settings = {"Debug": False, "Port": 8080, "Iface": None, "PacketLogging": False}
        DEBUG = False
        PORT = 8080
        IFACE = None
    
    # 로거 초기화
    logger = SimpleLogger(DEBUG)
    
    # 안정적인 메인 함수 실행 (자동 재시작 포함)
    try:
        asyncio.run(stable_main())
    except Exception as e:
        print(f"\n[치명적 오류] {e}")
        print("\n상세 오류 정보:")
        traceback.print_exc()
    finally:
        # 콘솔 창 유지 (exe 실행 시 오류 확인용)
        print("\n프로그램이 종료되었습니다. Enter 키를 누르세요...")
        input()
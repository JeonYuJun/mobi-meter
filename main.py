# 필요한 라이브러리 임포트
import asyncio
import json
import brotli
from functools import lru_cache
from websockets import serve
from scapy.all import AsyncSniffer, Packet, Raw
from scapy.layers.inet import TCP

# 전역 설정 변수
DEBUG = False  # 디버그 모드
PORT = 8080    # WebSocket 서버 포트
IFACE = None   # 네트워크 인터페이스

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
    if len(data) != 35:
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
    if len(data) != 53:
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
    100047: parse_buff_end,
    }

# TCP 시퀀스 번호 관련 상수 및 함수
SEQ_MOD = 2**32

def seq_distance(a, b):
    return ((a - b + 2**31) % 2**32) - 2**31

# 네트워크 패킷을 캡처하고 처리하는 메인 클래스
class PacketStreamer:
    def __init__(self, filter_expr: str = "tcp and src port 16000"):  # 마비노기 서버 포트 16000
        self.queue: asyncio.Queue[Packet] = asyncio.Queue()
        self.sniffer = AsyncSniffer(filter=filter_expr, prn=self._enqueue_packet, iface=IFACE)
        self.loop = asyncio.get_event_loop()
        self.buffer:bytes = b''
        self.tcp_segments = {}
        self.current_seq = None
        self.analyzer = CombatLogAnalyzer()

    # WebSocket 클라이언트에게 데이터 스트리밍
    async def stream(self, websocket) -> None:
        self.sniffer.start()
        consumer_task = asyncio.create_task(self._process(websocket))
        consumer_task2 = asyncio.create_task(self._process2(websocket))
        try:
            await websocket.wait_closed()
        finally:
            consumer_task.cancel()
            consumer_task2.cancel()
            self.sniffer.stop()
            self.sniffer.join()

    def _enqueue_packet(self, pkt: Packet) -> None:
        self.loop.call_soon_threadsafe(self.queue.put_nowait, pkt)

    # 바이너리 데이터에서 게임 패킷 파싱
    def _packet_parser(self, data: bytes) -> tuple[list,int]:
        res = []
        pivot = 0
        buffer_size = len(data)

        while(pivot < len(data)):
            
            # 패킷 시작 부분 찾기 (마비노기 패킷 시그니처)
            start_pivot = data.find(b'\x68\x27\x00\x00\x00\x00\x00\x00\x00', pivot)
            if start_pivot == -1:
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
                except Exception as e:
                    pass

                pivot += 9 + length

        return (res, pivot)
    
    # TCP 패킷을 수집하고 재조립하는 메인 프로세스
    async def _process(self, websocket) -> None:
        while True:
            try:
                pkt: Packet = await self.queue.get()
            except asyncio.CancelledError as e:
                pass
                break

            if pkt.haslayer(Raw):
                seq = pkt[TCP].seq
                payload = bytes(pkt[Raw].load)
                
                if self.current_seq is None:
                    self.current_seq = seq

                if abs(seq_distance(seq,self.current_seq)) > 10000:
                    self.tcp_segments.clear()
                    self.current_seq = None
                    self.buffer = b''
                    continue
                    
                if seq not in self.tcp_segments or self.tcp_segments[seq] != payload:
                    self.tcp_segments[seq] = payload

                if self.current_seq not in self.tcp_segments:
                    pass
                
                # 재조립
                while self.current_seq in self.tcp_segments:
                    segment = self.tcp_segments.pop(self.current_seq)
                    self.buffer += segment
                    self.current_seq = (self.current_seq + len(segment)) % SEQ_MOD

                if len(self.buffer) > 1024 * 4 * 4:
                    self.buffer = self.buffer[len(self.buffer)//2:]

                parsed, pivot = self._packet_parser(self.buffer)
                self.buffer = self.buffer[pivot:]

                if parsed:
                    try:
                        for entry in parsed:
                            self.analyzer.update(entry)
                    except Exception as e:
                        pass
                        break

    # 분석된 데이터를 주기적으로 WebSocket으로 전송
    async def _process2(self, websocket) -> None:
        while True:
            try:
                await self.analyzer.send_data(websocket)
                await asyncio.sleep(0.5)
            except asyncio.CancelledError as e:            
                break

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
    total_stack: int = 0

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

# 전투 로그를 분석하고 통계를 생성하는 메인 분석 클래스
class CombatLogAnalyzer:
    def __init__(self):
        self._raw_data: Dict[int, Any] = {}

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

        # 스킬 및 버프 데이터 파일 로드
        import sys
        import os
        if getattr(sys, 'frozen', False):
            # PyInstaller로 빌드된 exe 실행시 - 임시 폴더 사용
            base_path = sys._MEIPASS
        else:
            base_path = os.path.dirname(os.path.abspath(__file__))
        
        # 데이터 파일 경로 설정
        skills_path = os.path.join(base_path, '_skills.json')
        buffs_path = os.path.join(base_path, '_buffs.json')
        
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

    # WebSocket으로 분석된 데이터 전송
    async def send_data(self, websocket):
        def recursive_asdict(obj):
            if is_dataclass(obj) and not isinstance(obj, type):
                return {k: recursive_asdict(v) for k, v in asdict(obj).items()}
            elif isinstance(obj, dict):
                return {str(k): recursive_asdict(v) for k, v in obj.items()}
            else:
                return obj
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
        }
        if self._is_user_data_updated:
            self._is_user_data_updated = False
            data["user"] = recursive_asdict(self._user_data)
        if DEBUG:
            data["user_tmp"] = recursive_asdict(self._user_tmp_data)

        try:
            await websocket.send(json.dumps({
                "type": "damage",
                "data": data
            }))
        except Exception as e:
            pass

    # 새로운 패킷 데이터로 통계 업데이트
    def update(self, entry):
        type = entry["type"]

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
            if self._raw_data.get(3) is not None:
                tid3 = self._raw_data[3].get("target_id",0)
                damage = self._raw_data[3].get("prev_hp", 0) - self._raw_data[3].get("current_hp", 0)
                if tid3 == tid:
                    CombatLogAnalyzer._update_combat(self._damage_by_user_by_target_by_skill, 
                                                     uid, tid, damage, flags, skill, utdata)
                    is_updated = True

            if self._raw_data.get(4) is not None:
                tid3 = self._raw_data[4].get("target_id",0)
                damage = self._raw_data[4].get("damage", 0)
                if tid3 == tid:
                    CombatLogAnalyzer._update_combat(self._self_damage_by_user_by_target_by_skill, 
                                                     uid, tid, damage, flags, skill, utdata)
                    CombatLogAnalyzer._update_enemy_data(self._enemy_data, tid, 0, self._self_damage_by_user_by_target_by_skill[0][tid][""].all.total_damage)
                    is_updated = True

            if CombatLogAnalyzer._is_dot(flags) == False and is_updated:
                CombatLogAnalyzer._update_buff_uptime(
                    self._buff_uptime_by_user_by_target_by_skill, 
                    uid, tid, skill, 
                    self._user_tmp_data[uid])

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
            if damage > 2095071572: return
    
            self._raw_data[4] = entry

            self_damage = self._self_damage_by_user.setdefault(uid, SimpleDamageData())
            self_damage.total_damage += damage
            if self._max_self_damage_by_user.total_damage < self_damage.total_damage:
                self._max_self_damage_by_user.id = uid
                self._max_self_damage_by_user.total_damage = self_damage.total_damage

        elif type == 11 or type == 12:  # 버프 시작/업데이트 패킷
            buff_key = str(entry.get("buff_key",0))
            if buff_key not in self._buff_unhandled_code:
                inst_key = entry.get("inst_key", "")
                stack = entry.get("stack", 0)
                uid = entry.get("user_id", 0)
                tid = entry.get("target_id", 0)
                buff_name = self._buff_code_2_name.get(buff_key, buff_key)
                if DEBUG == True or buff_name != buff_key:
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
                CombatLogAnalyzer._update_user_buff(
                    self._buff_by_user_by_inst, 
                    self._user_tmp_data,
                    uid, 
                    0,
                    inst_key, 
                    data.buff_name, 
                    0, 
                    self._buff_name_2_detail.get(data.buff_name)
                )
        pass
    
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
        c.total_atk      += utd.atk_buff
        c.total_dmg      += utd.dmg_buff

    # 버프 지속시간 업데이트
    @staticmethod
    def _update_buff_uptime(cc:BuffUptimeContainer, uid, tid, skill, tmpdata: UserTmpData):
        gc = CombatLogAnalyzer._get_buff_uptime_container
        for buff_name, buff_stack in tmpdata.buff.items():
            for c in [gc(cc,uid,0,"",buff_name), gc(cc,uid,tid,"",buff_name), gc(cc,uid,0,skill,buff_name), gc(cc,uid,tid,skill,buff_name)]:
                CombatLogAnalyzer._update_buff_uptime_data(c, buff_stack)

    # 버프 지속시간 컨테이너 가져오기
    @staticmethod
    def _get_buff_uptime_container(container:BuffUptimeContainer, uid: int, tid: int, skill: str, buff: str) -> BuffUptimeData:
        return container.setdefault(uid, {}).setdefault(tid, {}).setdefault(skill, {}).setdefault(buff, BuffUptimeData())
    
    # 버프 지속시간 데이터 업데이트
    @staticmethod
    def _update_buff_uptime_data(c:BuffUptimeData, inst:BuffInstData):
        c.max_stack = max(c.max_stack, inst.buff_stack)
        c.total_stack += inst.buff_stack
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




# 메인 함수 - WebSocket 서버 시작
async def main() -> None:
    print("\n" + "="*70)
    print("  🚀 Mobi-Meter 데미지 미터 서버 시작중...")
    print("="*70)
    
    async def wsserve(websocket) -> None:
        client_ip = websocket.remote_address[0]
        print(f"  ✅ 클라이언트 연결됨: {client_ip}")
        streamer = PacketStreamer()
        await streamer.stream(websocket)
        
    async with serve(wsserve, '0.0.0.0', PORT, max_size=10_000_000):
        print(f"  ✅ WebSocket 서버 시작 완료!")
        print(f"  📡 포트: {PORT}")
        print(f"  🌐 브라우저에서 index.html을 열어주세요")
        print(f"  📊 실시간 데미지 측정 대기중...")
        print(f"  ⚠️  관리자 권한으로 실행되었는지 확인하세요")
        print("="*70 + "\n")
        await asyncio.Future()  # run forever

# 프로그램 진입점
if __name__ == '__main__':
    import sys
    import os
    
    # exe 실행시 실행 파일이 있는 디렉토리에서 settings.json 찾기
    if getattr(sys, 'frozen', False):
        # PyInstaller로 빌드된 exe 실행시
        base_path = sys._MEIPASS  # 임시 폴더에 압축 해제된 파일들의 경로
        print(f"  📁 EXE 모드: 데이터 경로 = {base_path}")
    else:
        # 일반 Python 스크립트 실행시
        base_path = os.path.dirname(os.path.abspath(__file__))
        print(f"  📁 스크립트 모드: 데이터 경로 = {base_path}")
    
    settings_path = os.path.join(base_path, 'settings.json')
    print(f"  📄 설정 파일 경로: {settings_path}")
    
    try:
        with open(settings_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            DEBUG   = data["Debug"]
            PORT    = data["Port"]
            IFACE    = data["Iface"]
            if IFACE == "None": IFACE = None
            print(f"  ✅ 설정 파일 로드 성공")
    except FileNotFoundError:
        print(f"  ❌ 설정 파일을 찾을 수 없습니다: {settings_path}")
        print(f"  ℹ️  기본값 사용: PORT=8080, DEBUG=False")
        DEBUG = False
        PORT = 8080
        IFACE = None
    except Exception as e:
        print(f"  ❌ 설정 파일 로드 실패: {e}")
        DEBUG = False
        PORT = 8080
        IFACE = None
    
    asyncio.run(main())
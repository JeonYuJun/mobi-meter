// ========== 전역 변수 및 초기 설정 ==========
const wsUrl = "ws://localhost:8080";
let ws;

// 데미지 및 버프 데이터베이스
let damageDB  = {0:{0:{"":{}}}}  // 메인 데미지 DB
let damageDB2 = {0:{0:{"":{}}}}  // 싱글 모드용 데미지 DB
let buffDB = {};                 // 버프 정보 DB
let selfID = 0;                  // 본인 캐릭터 ID
let enemyData = {}               // 적 정보
let userData = {}                // 유저 정보
let hitTime = {};                // 타격 시간 기록
let userTmpData = {}             // 임시 유저 데이터

// UI 및 렌더링 관련 변수
let bossMode = "all";            // 보스 모드 (all/single)
let singleMode = false;          // 싱글 모드 여부
let render_timeout = null;       // 렌더링 타임아웃
let buffVisibleTypes = {}        // 버프 표시 타입

// 상세 정보 표시 관련
let skillDetailOpened = {};      // 스킬 상세 정보 열림 상태        
let selectedDetailUserId = null; // 선택된 유저 ID
const selectedDetailSkillName = {};

// 차트 관련 변수
let dpsChart = null;             // Chart.js 인스턴스
let dpsChartData = [];           // DPS 차트 데이터
let maxDataPoints = 120;         // 2분 데이터로 축소 (성능 개선)
let chartInitialized = false;
let chartUpdateTimeout = null;
let isTabActive = true;
let viewMode = localStorage.getItem('viewMode') || 'card';  // 저장된 값 또는 기본값 'card'

// 자동 초기화 관련 변수
let lastDataTime = Date.now();
let autoResetInterval = null;
let autoResetTimeout = 60000;    // 1분

// ========== 차트 관련 함수 ==========
// DPS 차트 초기화
function initDPSChart() {
    if (chartInitialized && dpsChart) {
        console.log('차트가 이미 초기화되어 있습니다');
        return;
    }
    
    const canvas = document.getElementById('realtimeDPSChart');
    if (!canvas) {
        console.error('차트 캔버스를 찾을 수 없습니다');
        // DOM이 완전히 로드되지 않았을 수 있으므로 다시 시도
        if (document.readyState !== 'complete') {
            setTimeout(initDPSChart, 100);
        }
        return;
    }
    
    // 차트 패널이 표시되어 있는지 확인
    const chartPanel = document.getElementById('chartPanel');
    if (!chartPanel || chartPanel.style.display === 'none') {
        console.log('차트 패널이 숨겨져 있어 초기화를 건너뜁니다');
        return;
    }
    
    // Chart.js가 로드되었는지 확인
    if (typeof Chart === 'undefined') {
        console.error('Chart.js가 아직 로드되지 않았습니다');
        setTimeout(initDPSChart, 100);
        return;
    }
    
    try {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('Canvas context를 가져올 수 없습니다');
            return;
        }
        
        dpsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: []
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#e0e0e0',
                        font: {
                            size: 11
                        },
                        usePointStyle: true,
                        padding: 10
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y.toLocaleString() + ' DPS';
                        }
                    }
                },
                zoom: {
                    zoom: {
                        wheel: {
                            enabled: false
                        },
                        pinch: {
                            enabled: false
                        },
                        mode: 'x'
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: null
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#999',
                        font: {
                            size: 10
                        },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 10
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#999',
                        font: {
                            size: 10
                        },
                        callback: function(value) {
                            return value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
        chartInitialized = true;
        console.log('차트 초기화 성공');
        
        // 초기화 성공 후 빈 차트 표시
        dpsChart.update();
    } catch (error) {
        console.error('차트 초기화 실패:', error);
        chartInitialized = false;
        dpsChart = null;
        // 재시도
        setTimeout(initDPSChart, 500);
    }
}

// DPS 차트 데이터 업데이트
function updateDPSChart() {
    const sorted = calcSortedItems();
    
    // 데이터가 없으면 차트를 초기화하지 않음
    if (sorted.length === 0) {
        return;
    }
    
    // 차트가 아직 초기화되지 않았고 데이터가 있으면 초기화
    if (!dpsChart || !chartInitialized) {
        console.log('첫 데이터 수신, 차트 초기화 시작...');
        // 차트 패널 표시
        const chartPanel = document.getElementById('chartPanel');
        if (chartPanel) {
            chartPanel.style.display = 'block';
        }
        initDPSChart();
        // 초기화 후 다음 업데이트에서 데이터 표시
        setTimeout(() => updateDPSChart(), 100);
        return;
    }
    const currentTime = new Date().toLocaleTimeString('ko-KR', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    
    // 새로운 레이블 추가
    if (dpsChart.data.labels.length >= maxDataPoints) {
        dpsChart.data.labels.shift();
    }
    dpsChart.data.labels.push(currentTime);
    
    // 데이터셋 업데이트 또는 생성
    const colors = ['#FF6B6B', '#4D9DE0', '#7AE582', '#FFD93D', '#A05ED9', '#E65A9C'];
    const top5 = sorted.slice(0, 5);
    
    // 기존 데이터셋 업데이트
    dpsChart.data.datasets = top5.map(([user_id, item], idx) => {
        const total = item[""].all.total_damage || 0;
        const dps = Math.floor(total / (getRuntimeSec() + 1));
        const jobName = userData[user_id] ? userData[user_id].job : user_id;
        const isSelf = selfID == user_id;
        
        // 기존 데이터셋 찾기
        let dataset = dpsChart.data.datasets.find(ds => ds.label === jobName);
        if (!dataset) {
            dataset = {
                label: jobName,
                data: new Array(dpsChart.data.labels.length - 1).fill(0),
                borderColor: isSelf ? '#00ff88' : colors[idx % colors.length],
                backgroundColor: isSelf ? 'rgba(0, 255, 136, 0.1)' : `rgba(${parseInt(colors[idx % colors.length].slice(1,3),16)}, ${parseInt(colors[idx % colors.length].slice(3,5),16)}, ${parseInt(colors[idx % colors.length].slice(5,7),16)}, 0.1)`,
                borderWidth: isSelf ? 3 : 2,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 5
            };
        }
        
        // 데이터 배열 길이 조정
        if (dataset.data.length >= maxDataPoints) {
            dataset.data.shift();
        }
        dataset.data.push(dps);
        
        return dataset;
    });
    
    dpsChart.update('none');
}

(function(){
    document.getElementById('damage-stats-list').addEventListener('click', e => {
        const card = e.target.closest('.damage-card');
        if (!card) return;
        
        selectedDetailUserId = card.dataset.userId;
        showDetailModal(card.dataset.userId);
    });
    document.getElementById('detail-panel').addEventListener('click', e => {
        const row = e.target.closest('.skill-row');
        if (!row) return;

        const skillId = row.dataset.skillId;
        const detail = document.getElementById(skillId);
        if (detail && detail.classList.contains('skill-detail-row')) {
            const isActive = detail.classList.contains('active');
            if (isActive) {
                detail.classList.remove('active');
                skillDetailOpened[skillId] = false;
                selectedDetailSkillName[selectedDetailUserId] = null;
            } else {
                detail.classList.add('active');
                skillDetailOpened[skillId] = true;
                selectedDetailSkillName[selectedDetailUserId] = detail.dataset.skill;
            }
            showDetailModal(selectedDetailUserId);
        }
    });
})()

// ========== 유틸리티 함수 ==========
// 현재 타겟 ID 가져오기 (보스모드에 따라)
function getTargetID(){
    if (bossMode == "all"){
        return 0;
    }
    else if (bossMode == "highest_hp") {
        return enemyData.max_hp_tid || 0;
    }
    else if(bossMode == "most_attacked"){
        return enemyData.most_attacked_tid || 0;
    }
    else{
        return enemyData.last_attacked_tid || 0;
    }
}
// 전투 진행 시간 계산 (초)
function getRuntimeSec(){
    const tid = getTargetID();
    return hitTime[tid]
                ? (hitTime[tid].end - hitTime[tid].start)
                : 0;                    
}
// 전체 데미지 합계 계산
function getTotalDamage(isSingle){
    const sorted = calcSortedItems()
    if (sorted.length === 0) {
        return 0;
    }
    const totalSum = sorted.reduce((sum, [uid,stat]) => sum + (stat[""].all.total_damage || 0), 0);
    return totalSum;
}
// 추가타 확률 계산
function calcAddHitPercent(item) {
    if (item == null) return 0;
    const nAddHit = item.normal.addhit_count + item.special.addhit_count;
    const nAll = item.normal.total_count + item.special.total_count;
    return nAddHit ? (nAddHit / (nAll-nAddHit) * 100).toFixed(2) : 0;
}
// 크리티컬 확률 계산
function calcCritHitPercent(item){
    if (item == null) return 0;
    const nCrit = item.normal.crit_count + item.special.crit_count;
    const nAll = item.normal.total_count + item.special.total_count;
    return nCrit ? (nCrit / nAll * 100).toFixed(2) : 0;
}
// 안전한 나눗셈 (0 체크)
function divideForDis(numerator, denominator){
    return denominator > 0 ? (numerator / denominator).toFixed(2) : 0;
}
// 백분율 계산
function calcPercent(numerator, denominator){
    return denominator > 0 ? (numerator / denominator * 100).toFixed(2) : 0;
}

// ========== 상세 정보 모달 관련 함수 ==========
// 플레이어 상세 정보 모달 표시
function showDetailModal(uid) {
    const modal = document.getElementById('detailModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    
    const tid = getTargetID();
    const db = singleMode ? damageDB2 : damageDB;
    
    if (!db[uid] || !db[uid][tid]) return;
    
    const jobName = userData[uid] ? userData[uid].job : uid;
    modalTitle.textContent = `${jobName} 상세 정보`;
    
    // 모달 내용 구성
    modalBody.innerHTML = '';
    
    // 통계 섹션
    const statsSection = document.createElement('div');
    statsSection.innerHTML = '<h3 style="margin-bottom: 16px;">전투 통계</h3>';
    renderDetailStats(uid, statsSection);
    modalBody.appendChild(statsSection);
    
    // 버프 섹션
    const buffSection = document.createElement('div');
    buffSection.style.marginTop = '24px';
    buffSection.innerHTML = '<h3 style="margin-bottom: 16px;">버프 가동률</h3>';
    renderDetailBuffs(uid, buffSection);
    modalBody.appendChild(buffSection);
    
    // 스킬 섹션
    const skillSection = document.createElement('div');
    skillSection.style.marginTop = '24px';
    skillSection.innerHTML = `
        <div style="margin-bottom: 16px;">
            <h3 style="margin: 0 0 12px 0;">스킬별 데미지</h3>
            <div style="display: grid; grid-template-columns: 1.5fr 1.2fr 0.8fr 0.8fr 0.8fr 0.8fr; gap: 12px; font-size: 0.85em; color: var(--text-dim); padding: 12px 16px; background: var(--bg-soft); border-radius: 8px; margin-bottom: 8px;">
                <div style="font-weight: 600;">스킬명</div>
                <div style="text-align: left; font-weight: 600;">데미지 (점유율)</div>
                <div style="text-align: center;" class="tooltip">
                    평균 공증
                    <span class="tooltip-text">스킬 사용 시 평균 공격력 증가</span>
                </div>
                <div style="text-align: center;" class="tooltip">
                    평균 피증
                    <span class="tooltip-text">스킬 사용 시 평균 피해 증가</span>
                </div>
                <div style="text-align: center;" class="tooltip">
                    크리율
                    <span class="tooltip-text">해당 스킬의 크리티컬 확률</span>
                </div>
                <div style="text-align: center;" class="tooltip">
                    추가타율
                    <span class="tooltip-text">해당 스킬의 추가타 발생률</span>
                </div>
            </div>
        </div>
    `;
    renderSkillDetail(uid, skillSection);
    modalBody.appendChild(skillSection);
    
    // 스킬 클릭 이벤트 추가
    setTimeout(() => {
        skillSection.querySelectorAll('.skill-row').forEach(row => {
            row.addEventListener('click', function() {
                const skillId = this.dataset.skillId;
                const detailRow = document.getElementById(skillId);
                if (detailRow) {
                    const isActive = detailRow.classList.contains('active');
                    if (isActive) {
                        detailRow.classList.remove('active');
                        skillDetailOpened[skillId] = false;
                        selectedDetailSkillName[uid] = null;
                    } else {
                        detailRow.classList.add('active');
                        skillDetailOpened[skillId] = true;
                        selectedDetailSkillName[uid] = detailRow.dataset.skill;
                    }
                    const statsParent = document.querySelector('.card-stats');
                    if (statsParent) {
                        renderDetailStats(uid, statsParent.parentElement);
                    }
                    // buff-stats 요소는 더 이상 사용하지 않으므로 제거
                }
            });
        });
    }, 100);
    
    modal.classList.add('open');
}

// 상세 통계 렌더링 (크리, 추타, 평균 데미지 등)
function renderDetailStats(uid, container) {
    const tid = getTargetID();
    const skill = selectedDetailSkillName[uid] ?? "";
    const db = singleMode ? damageDB2[uid][tid][skill] : damageDB[uid][tid][skill];
    
    const critRate = calcCritHitPercent(db);
    const addhitRate = calcAddHitPercent(db);
    const atkbuff = divideForDis(db.buff.total_atk, db.buff.total_count);
    const dmgbuff = divideForDis(db.buff.total_dmg, db.buff.total_count);
    
    const statsHtml = `
        <div class="card-stats" style="background: var(--bg-soft); padding: 16px; border-radius: 8px;">
            <div class="card-stat">
                <div class="card-stat-value">${critRate}%</div>
                <div class="card-stat-label">크리티컬 확률</div>
            </div>
            <div class="card-stat">
                <div class="card-stat-value">${addhitRate}%</div>
                <div class="card-stat-label">추가타 확률</div>
            </div>
            <div class="card-stat">
                <div class="card-stat-value">${atkbuff}</div>
                <div class="card-stat-label">평균 공격력 증가</div>
            </div>
            <div class="card-stat">
                <div class="card-stat-value">${dmgbuff}</div>
                <div class="card-stat-label">평균 피해 증가</div>
            </div>
        </div>
    `;
    
    container.innerHTML += statsHtml;
}

// 버프 가동률 렌더링
function renderDetailBuffs(uid, container) {
    const tid = getTargetID();
    const skill = selectedDetailSkillName[uid] ?? "";
    const db = singleMode ? damageDB2[uid][tid][skill] : damageDB[uid][tid][skill];
    const buffs = buffDB[uid] ? buffDB[uid][tid][skill] : {};
    
    const types = {"룬":1, "스킬":11, "시너지":12, "적":21, "펫":31};
    const colors = {1:"E68A2E", 11:"2E7DD9", 12:"36CC6D", 21:"A05ED9", 31:"E65A9C"};
    const typeNames = {1:"룬", 11:"스킬", 12:"시너지", 21:"적", 31:"펫"};
    
    // 버프를 타입별로 그룹화
    const buffsByType = {};
    for (const [key, value] of Object.entries(buffs)) {
        const type = value.type;
        if (!buffsByType[type]) buffsByType[type] = [];
        const uptime = calcPercent(value.total_stack/value.max_stack, db.normal.total_count + db.special.total_count);
        buffsByType[type].push({name: key, uptime, maxStack: value.max_stack, color: colors[type]});
    }
    
    // 탭 네비게이션 생성
    let tabsHtml = '<div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 2px solid var(--border-color); padding-bottom: 8px;">';
    tabsHtml += '<button class="buff-tab active" data-type="all" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 4px 4px 0 0; cursor: pointer;">전체</button>';
    
    for (const [typeCode, typeName] of Object.entries(typeNames)) {
        if (buffsByType[typeCode] && buffsByType[typeCode].length > 0) {
            tabsHtml += `<button class="buff-tab" data-type="${typeCode}" style="padding: 8px 16px; background: var(--bg-soft); color: var(--text-color); border: none; border-radius: 4px 4px 0 0; cursor: pointer;">${typeName} (${buffsByType[typeCode].length})</button>`;
        }
    }
    tabsHtml += '</div>';
    
    // 버프 컨테이너
    let buffHtml = '<div class="buff-container" style="max-height: 300px; overflow-y: auto; background: var(--bg-soft); padding: 16px; border-radius: 8px;">';
    buffHtml += '<div class="buff-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">';
    
    // 모든 버프 표시 (초기 상태)
    for (const [typeCode, buffList] of Object.entries(buffsByType)) {
        buffList.sort((a, b) => parseFloat(b.uptime) - parseFloat(a.uptime)); // 가동률 순으로 정렬
        buffList.forEach(buff => {
            buffHtml += `
                <div class="buff-item" data-type="${typeCode}" style="display: flex; align-items: center; padding: 12px; background: var(--bg-dark); border-radius: 6px; border: 1px solid var(--border-color);">
                    <div class="circle" style="width: 12px; height: 12px; border-radius: 50%; background:#${buff.color}; margin-right: 12px; flex-shrink: 0;"></div>
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${buff.name}</div>
                        <div style="font-size: 0.85em; color: var(--text-dim);">가동률: ${buff.uptime}% / 최대: ${buff.maxStack}</div>
                    </div>
                    <div style="margin-left: 12px; font-weight: 600; color: #${buff.color};">${buff.uptime}%</div>
                </div>
            `;
        });
    }
    
    buffHtml += '</div></div>';
    
    container.innerHTML += tabsHtml + buffHtml;
    
    // 탭 클릭 이벤트
    setTimeout(() => {
        const tabs = container.querySelectorAll('.buff-tab');
        const buffItems = container.querySelectorAll('.buff-item');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 탭 활성화 상태 변경
                tabs.forEach(t => {
                    t.style.background = 'var(--bg-soft)';
                    t.style.color = 'var(--text-color)';
                    t.classList.remove('active');
                });
                tab.style.background = 'var(--primary-color)';
                tab.style.color = 'white';
                tab.classList.add('active');
                
                // 버프 필터링
                const selectedType = tab.dataset.type;
                buffItems.forEach(item => {
                    if (selectedType === 'all' || item.dataset.type === selectedType) {
                        item.style.display = 'flex';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });
    }, 100);
}

function showDetail(uid) {
    showDetailModal(uid);
}
function renderDetailTitle(uid){
    const detailDiv = document.getElementById('detail-title-panel');
    while (detailDiv.firstChild) detailDiv.removeChild(detailDiv.firstChild);

    const sorted = calcSortedItems()
    const totalSum = sorted.reduce((sum, [uid,stat]) => sum + (stat[""].all.total_damage || 0), 0);

    sorted.forEach(([user_id, item], idx) => {
            if(user_id != uid) return;

            const stat = item[""];

            const total = stat.all.total_damage || 0;
            const critRate   = calcCritHitPercent(stat);
            const addhitRate = calcAddHitPercent(stat);
            const atkbuff    = divideForDis(stat.buff.total_atk, stat.buff.total_count);
            const dmgbuff    = divideForDis(stat.buff.total_dmg, stat.buff.total_count);
            const dps        = Math.floor(total/(getRuntimeSec()+1));
            const totalRate = sorted.length === 1 ? 1 : totalSum > 0 ? total / totalSum : 0
            const jobName =  userData[user_id] ? userData[user_id].job : user_id;
            const isSelf = selfID == user_id;

            const li = rankItem(idx, isSelf, jobName, total, totalRate, dps, critRate, addhitRate, atkbuff, dmgbuff);
            detailDiv.appendChild(li);
        });
}
function renderDetail(uid) {
    const tid = getTargetID();
    const skill = selectedDetailSkillName[uid] ?? "";
    const db = singleMode ? damageDB2[uid][tid][skill] : damageDB[uid][tid][skill]; 
    
    const rank = calcSortedItems().findIndex(([id, item]) => id === uid);
    const critRate  = calcCritHitPercent(db);
    const addhitRate = calcAddHitPercent(db);
    const atkbuff = divideForDis(db.buff.total_atk, db.buff.total_count);
    const dmgbuff = divideForDis(db.buff.total_dmg, db.buff.total_count);
    
    // 모든 detail-value span을 가져오기
    const values = document.querySelectorAll('#stat-detail-panel .detail-value');
    values[0].textContent = `${critRate}%`; 
    values[1].textContent = `${addhitRate}%`; 
    values[2].textContent = `${atkbuff}`;
    values[3].textContent = `${dmgbuff}`;
    

    const buffList = document.querySelectorAll('#stat-detail-panel .buff-list')[0];
    buffList.innerHTML = '';

    const buffs = buffDB[uid] ? buffDB[uid][tid][""] : {}
    const types = {"룬":1, "스킬":11, "시너지":12, "적":21, "펫":31};
    const colors = {1:"E68A2E", 11:"2E7DD9", 12:"36CC6D", 21:"A05ED9", 31:"E65A9C"};
    for (const [buffTypeName, buffTypeCode] of Object.entries(types)) 
    {
        if (buffVisibleTypes[buffTypeName] != true) continue;

        buffList.innerHTML += Object.entries(buffs)
            .filter(([key, v])=>v.type == buffTypeCode).map((
            [key, value])=>`
                <div class="buff-item">
                    <div class="circle" style="background:#${colors[buffTypeCode]};""></div>
                    ${key}&nbsp;
                    <span class="detail-value">(${calcPercent(value.total_stack/value.max_stack, db.normal.total_count + db.special.total_count)}% / ${value.max_stack})</span>
                </div>`)
            .join("")
    }

    if (userTmpData){
        const buffList = document.querySelectorAll('#stat-detail-panel .buff-list')[1];

        shortBuffHtml2 = Object.entries(userTmpData[uid].buff).map(([key, value])=>`<span class="detail-value">${key}(${value.buff_stack})</span>`).join("")
        buffList.innerHTML = `
            <div class="my-text-box" style="display: flex; align-items: center; width: 100%;">
                <span class="detail-label" style="margin-right: 8px;">버프:</span>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; flex: 1;">
                    ${shortBuffHtml2}
                </div>
            </div>
        `
    }
}
// 스킬별 데미지 상세 정보 렌더링
function renderSkillDetail(uid, container) {
    if (!container) {
        container = document.getElementById('skill-detail-panel');
    }

    const targetID = getTargetID();
    const db = singleMode  ? damageDB2[uid][targetID] : damageDB[uid][targetID]; 

    // 스킬별 딜량 집계
    const skillRows = [];
    let total = 0;
    for (const skill in db) {
        if (skill == "") continue;
        const skillObj = db[skill];
        const dmg = skillObj ? skillObj.all.total_damage || 0 : 0;
        if (dmg > 0) {
            const normal = skillObj.normal;
            const dot = skillObj.dot;
            const special = skillObj.special;
            const detail = {
                total: skillObj.all.total_damage,
                crit: calcCritHitPercent(skillObj),
                addhit: calcAddHitPercent(skillObj),
                atk: divideForDis(skillObj.buff.total_atk, skillObj.buff.total_count),
                dmg: divideForDis(skillObj.buff.total_dmg, skillObj.buff.total_count),
            }
            
            // 스킬별 버프 데이터 가져오기
            const skillBuffs = buffDB[uid] && buffDB[uid][targetID] && buffDB[uid][targetID][skill] ? buffDB[uid][targetID][skill] : {};
            const buffList = [];
            const colors = {1:"E68A2E", 11:"2E7DD9", 12:"36CC6D", 21:"A05ED9", 31:"E65A9C"};
            
            for (const [buffName, buffData] of Object.entries(skillBuffs)) {
                const uptime = calcPercent(buffData.total_stack/buffData.max_stack, normal.total_count + special.total_count);
                if (uptime > 0) {
                    buffList.push({
                        name: buffName,
                        uptime: uptime,
                        color: colors[buffData.type] || "999999"
                    });
                }
            }
            // 가동률 높은 순으로 정렬
            buffList.sort((a, b) => b.uptime - a.uptime);
            
            skillRows.push({ skill, dmg, detail, normal, dot, special, allBuffs: buffList });
            total += dmg;
        }
    }
    if (skillRows.length === 0) {
        return;
    }
    skillRows.sort((a, b) => b.dmg - a.dmg);

    let table = `<div class="skill-table">`;
    
    // 헤더 추가
    table += `
        <div class="skill-header">
            <div class="skill-name">스킬명</div>
            <div class="skill-damage">총 데미지</div>
            <div class="skill-stat">평균 공증</div>
            <div class="skill-stat">평균 피증</div>
            <div class="skill-stat">치명타율</div>
            <div class="skill-stat">추가타율</div>
        </div>
    `;
    
    skillRows.forEach((row, idx) => {
        const percent = calcPercent(row.dmg, total);
        const id = `skill_${uid}_${row.skill.replace(/[^\w가-힣]/g, '_')}`;
        
        table += `
        <div class="skill-row" data-skill-id="${id}">
            <div class="bar-bg" style="width: ${percent}%;"></div>
            <div class="skill-name" title="${row.skill}">${row.skill}</div>
            <div class="skill-damage">${row.dmg.toLocaleString()} (${percent}%)</div>
            <div class="skill-crit">${row.detail.atk}%</div>
            <div class="skill-crit">${row.detail.dmg}%</div>
            <div class="skill-crit">${row.detail.crit}%</div>
            <div class="skill-addhit">${row.detail.addhit}%</div>
        </div>
        <div id="${id}" data-skill="${row.skill}" class="skill-detail-row${skillDetailOpened[id] ? ' active' : ''}" style="${row.allBuffs && row.allBuffs.length > 0 ? 'grid-template-columns: repeat(4, 1fr);' : ''}">
            <div>
                <div>일반 데미지</div>
                <div><span>타수</span><span>${row.normal.total_count.toLocaleString()}</span></div>
                <div><span>총합</span><span>${row.normal.total_damage.toLocaleString()} (${calcPercent(row.normal.total_damage,row.detail.total)}%)</span></div>
                <div><span>최대</span><span>${row.normal.max_damage.toLocaleString()}</span></div>
                <div><span>최소</span><span>${row.normal.min_damage.toLocaleString()}</span></div>
                <div><span>강타율</span><span>${calcPercent(row.normal.power_count, row.normal.total_count)}%</span></div>
                <div><span>연타율</span><span>${calcPercent(row.normal.fast_count, row.normal.total_count)}%</span></div>
                <div><span>치명타율</span><span>${calcPercent(row.normal.crit_count, row.normal.total_count)}%</span></div>
            </div>
            <div>
                <div>도트 데미지</div>
                <div><span>타수</span><span>${row.dot.total_count.toLocaleString()}</span></div>
                <div><span>총합</span><span>${row.dot.total_damage.toLocaleString()} (${calcPercent(row.dot.total_damage,row.detail.total)}%)</span></div>
                <div><span>최대</span><span>${row.dot.max_damage.toLocaleString()}</span></div>
                <div><span>최소</span><span>${row.dot.min_damage.toLocaleString()}</span></div>
                <div><span>강타율</span><span>${calcPercent(row.dot.power_count, row.dot.total_count)}%</span></div>
                <div><span>연타율</span><span>${calcPercent(row.dot.fast_count, row.dot.total_count)}%</span></div>
                <div><span>치명타</span><span>${row.dot.crit_count.toLocaleString()}</span></div>
            </div>
            <div>
                <div>특수 데미지</div>
                <div><span>타수</span><span>${row.special.total_count.toLocaleString()}</span></div>
                <div><span>총합</span><span>${row.special.total_damage.toLocaleString()} (${calcPercent(row.special.total_damage,row.detail.total)}%)</span></div>
                <div><span>최대</span><span>${row.special.max_damage.toLocaleString()}</span></div>
                <div><span>최소</span><span>${row.special.min_damage.toLocaleString()}</span></div>
                <div><span>강타율</span><span>${calcPercent(row.special.power_count,row.special.total_count)}%</span></div>
                <div><span>연타율</span><span>${calcPercent(row.special.fast_count,row.special.total_count)}%</span></div>
                <div><span>치명타율</span><span>${calcPercent(row.special.crit_count,row.special.total_count)}%</span></div>
            </div>
            ${row.allBuffs && row.allBuffs.length > 0 ? `
            <div>
                <div>버프 가동률</div>
                ${row.allBuffs.slice(0, 7).map(buff => `
                    <div>
                        <span style="display: flex; align-items: center;">
                            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #${buff.color}; margin-right: 6px;"></span>
                            ${buff.name}
                        </span>
                        <span style="color: #${buff.color}; font-weight: 600;">${buff.uptime}%</span>
                    </div>
                `).join('')}
                ${row.allBuffs.length > 7 ? `<div style="text-align: center; color: var(--text-dim); font-size: 0.9em; margin-top: 4px;">... 외 ${row.allBuffs.length - 7}개</div>` : ''}
            </div>
            ` : ''}
        </div>
        `;
    });
    table += `</div>`;

    if (container) {
        container.innerHTML = table;
    } else {
        detailDiv.innerHTML = table;
    }
}

// 상세 정보 초기화
function clearDetails() {
    selectedDetailUserId = null;
    const detailDiv = document.getElementById('detail-panel');
    detailDiv.classList.remove('visible');
}

// ========== 데미지 순위 렌더링 함수 ==========
// 순위 아이템 HTML 생성
function rankItem(rank, isSelf, jobName, total, totalRate, dps, critRate, addhitRate, atk, dmg){
    const li = document.createElement('li');
    li.className = 'rank-li';

    if (rank === 0) li.classList.add('rank-1');
    else if (rank === 1) li.classList.add('rank-2');
    else if (rank === 2) li.classList.add('rank-3');
    
    const badge = document.createElement('span');
    badge.className = 'rank-badge' + (isSelf ? ' me' : '');
    badge.textContent = jobName;
    const totalSpan = document.createElement('span');
    totalSpan.className = 'rank-total';
    totalSpan.textContent = `총합: ${total.toLocaleString()}`;
    const dpsSpan = document.createElement('span');
    dpsSpan.className = 'rank-dps';
    dpsSpan.textContent = `DPS: ${dps.toLocaleString()}`;
    const critSpan = document.createElement('span');
    critSpan.className = 'rank-sub';
    critSpan.textContent = `치명타: ${critRate}%`;
    const addhitSpan = document.createElement('span');
    addhitSpan.className = 'rank-sub';
    addhitSpan.textContent = `추가타: ${addhitRate}%`;
    const atkSpan = document.createElement('span');
    atkSpan.className = 'rank-sub';
    atkSpan.textContent = `공증: ${atk}`;
    const dmgSpan = document.createElement('span');
    dmgSpan.className = 'rank-sub';
    dmgSpan.textContent = `피증: ${dmg}`;

    // 퍼센트 라벨(선택)
    const percentLabel = document.createElement('span');
    percentLabel.className = "rank-percent-label";
    // 행이 1개뿐이면 무조건 100%로 표기
    percentLabel.textContent = (totalRate*100).toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%';

    // 순위
    const rankNum = document.createElement('span');
    rankNum.className = 'rank-nonmedal';
    rankNum.textContent = (rank + 1).toString().padStart(1, '0');
    li.appendChild(rankNum);

    // === 행 전체 배경 그래프 추가 ===
    const barColor = rank === 0 ? '#bfa642'
       : rank === 1 ? '#8e8e8e'  
       : rank === 2 ? '#c07e47' 
       : '#5a7391'; 
    const bar = document.createElement('div');
    bar.classList.add("rank-damage-share-bar");
    bar.style.background = barColor;
    bar.style.width = ((document.body.offsetWidth-232) * totalRate) + 'px'; //실제크기기반으로 하면 깜빡임 현상 있음

    badge.style.zIndex = '1';
    totalSpan.style.zIndex = '1';
    totalSpan.style.fontWeight = 'bold';
    dpsSpan.style.zIndex = '1';
    dpsSpan.style.fontWeight = 'bold';

    li.appendChild(bar);
    li.appendChild(badge);
    li.appendChild(totalSpan);
    li.appendChild(dpsSpan);
    li.appendChild(critSpan);
    li.appendChild(addhitSpan);
    li.appendChild(atkSpan);
    li.appendChild(dmgSpan);
    li.appendChild(percentLabel);

    return li;
}

// 데미지 순위 표시 함수
// 데미지 순위 전체 렌더링
function renderDamageRanks() {
    const statsList = document.getElementById('damage-stats-list');
    while (statsList.firstChild) statsList.removeChild(statsList.firstChild);

    const sorted = calcSortedItems()
    
    // 데이터가 없을 때 빈 상태 표시
    if (sorted.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.style.cssText = 'text-align: center; padding: 40px; color: var(--text-dim); font-size: 0.9em;';
        emptyMessage.innerHTML = '<i class="fas fa-info-circle"></i> 측정된 데이터가 없습니다';
        statsList.appendChild(emptyMessage);
        return;
    }
    
    const totalSum = sorted.reduce((sum, [uid,stat]) => sum + (stat[""].all.total_damage || 0), 0);
    
    // 뷰 모드에 따라 다른 클래스 적용
    if (viewMode === 'list') {
        statsList.className = 'damage-list-container';
        renderListView(sorted, totalSum);
    } else {
        statsList.className = 'damage-cards-container';
        renderCardView(sorted, totalSum);
    }
}

// 카드 뷰 렌더링
// 카드형 뷰 렌더링
function renderCardView(sorted, totalSum) {
    const statsList = document.getElementById('damage-stats-list');
    
    sorted.forEach(([user_id, item], idx) => {
        const stat = item[""];
        const total = stat.all.total_damage || 0;
        const critRate = calcCritHitPercent(stat);
        const addhitRate = calcAddHitPercent(stat);
        const dps = Math.floor(total/(getRuntimeSec()+1));
        const totalRate = sorted.length === 1 ? 1 : totalSum > 0 ? total / totalSum : 0;
        const jobName = userData[user_id] ? userData[user_id].job : user_id;
        const isSelf = selfID == user_id;
        
        // 카드 생성
        const card = document.createElement('div');
        card.className = 'damage-card';
        if (idx === 0) card.classList.add('rank-1');
        else if (idx === 1) card.classList.add('rank-2');
        else if (idx === 2) card.classList.add('rank-3');
        if (isSelf) card.classList.add('me');
        
        card.dataset.userId = user_id;
        
        // 순위별 아이콘 추가
        let rankIcon = '';
        if (idx === 0) rankIcon = '<i class="fas fa-trophy rank-icon-glow" style="color: var(--accent-gold); margin-left: 4px; text-shadow: 0 0 10px var(--accent-gold);"></i>';
        else if (idx === 1) rankIcon = '<i class="fas fa-award rank-icon-glow" style="color: var(--accent-silver); margin-left: 4px; text-shadow: 0 0 10px var(--accent-silver);"></i>';
        else if (idx === 2) rankIcon = '<i class="fas fa-award rank-icon-glow" style="color: var(--accent-bronze); margin-left: 4px; text-shadow: 0 0 10px var(--accent-bronze);"></i>';
        
        card.innerHTML = `
            <div class="card-rank">#${idx + 1}</div>
            <div class="card-header">
                <div class="card-job">${jobName}${rankIcon}</div>
                ${isSelf ? '<div class="card-me-badge">ME</div>' : ''}
            </div>
            <div class="card-main-stat">
                <div class="card-dps">${dps.toLocaleString()}</div>
                <div class="card-dps-label">DPS</div>
            </div>
            <div class="card-stats">
                <div class="card-stat">
                    <div class="card-stat-value">${total.toLocaleString()}</div>
                    <div class="card-stat-label">총 데미지</div>
                </div>
                <div class="card-stat">
                    <div class="card-stat-value">${(totalRate * 100).toFixed(1)}%</div>
                    <div class="card-stat-label">점유율</div>
                </div>
                <div class="card-stat">
                    <div class="card-stat-value">${critRate}%</div>
                    <div class="card-stat-label">크리티컬</div>
                </div>
                <div class="card-stat">
                    <div class="card-stat-value">${addhitRate}%</div>
                    <div class="card-stat-label">추가타</div>
                </div>
            </div>
            <div class="card-progress">
                <div class="card-progress-bar" style="width: ${totalRate * 100}%"></div>
            </div>
        `;
        
        statsList.appendChild(card);
    });
}

// 리스트 뷰 렌더링
// 리스트형 뷰 렌더링
function renderListView(sorted, totalSum) {
    const statsList = document.getElementById('damage-stats-list');
    
    // 헤더 추가
    const header = document.createElement('div');
    header.className = 'damage-list-item';
    header.style.cssText = 'background: var(--bg-soft); font-weight: 600; font-size: 0.85em; color: var(--text-dim); cursor: default;';
    header.innerHTML = `
        <div class="list-rank">순위</div>
        <div>직업</div>
        <div>DPS</div>
        <div>총 데미지</div>
        <div>점유율</div>
        <div class="list-stat">크리율</div>
        <div class="list-stat">추가타</div>
        <div class="list-stat">공증</div>
        <div class="list-stat">피증</div>
    `;
    statsList.appendChild(header);
    
    sorted.forEach(([user_id, item], idx) => {
        const stat = item[""];
        const total = stat.all.total_damage || 0;
        const critRate = calcCritHitPercent(stat);
        const addhitRate = calcAddHitPercent(stat);
        const atkbuff = divideForDis(stat.buff.total_atk, stat.buff.total_count);
        const dmgbuff = divideForDis(stat.buff.total_dmg, stat.buff.total_count);
        const dps = Math.floor(total/(getRuntimeSec()+1));
        const totalRate = sorted.length === 1 ? 1 : totalSum > 0 ? total / totalSum : 0;
        const jobName = userData[user_id] ? userData[user_id].job : user_id;
        const isSelf = selfID == user_id;
        
        // 순위별 아이콘
        let rankIcon = '';
        if (idx === 0) rankIcon = '<i class="fas fa-trophy" style="color: var(--accent-gold); text-shadow: 0 0 10px var(--accent-gold);"></i>';
        else if (idx === 1) rankIcon = '<i class="fas fa-award" style="color: var(--accent-silver); text-shadow: 0 0 10px var(--accent-silver);"></i>';
        else if (idx === 2) rankIcon = '<i class="fas fa-award" style="color: var(--accent-bronze); text-shadow: 0 0 10px var(--accent-bronze);"></i>';
        
        const listItem = document.createElement('div');
        listItem.className = 'damage-list-item';
        if (idx === 0) listItem.classList.add('rank-1');
        else if (idx === 1) listItem.classList.add('rank-2');
        else if (idx === 2) listItem.classList.add('rank-3');
        if (isSelf) listItem.classList.add('me');
        
        listItem.dataset.userId = user_id;
        
        listItem.innerHTML = `
            <div class="list-damage-bar" style="width: ${totalRate * 100}%"></div>
            <div class="list-rank ${idx < 3 ? 'rank-' + (idx + 1) : ''}">${idx + 1}</div>
            <div class="list-job">
                ${jobName}
                ${rankIcon}
                ${isSelf ? '<span style="color: var(--accent-me); font-size: 0.8em; font-weight: 700;">[ME]</span>' : ''}
            </div>
            <div class="list-dps">${dps.toLocaleString()}</div>
            <div class="list-damage">${total.toLocaleString()}</div>
            <div class="list-share">${(totalRate * 100).toFixed(1)}%</div>
            <div class="list-stat">${critRate}%</div>
            <div class="list-stat">${addhitRate}%</div>
            <div class="list-stat">${atkbuff}</div>
            <div class="list-stat">${dmgbuff}</div>
        `;
        
        // 클릭 이벤트
        listItem.addEventListener('click', () => {
            showDetailModal(user_id);
        });
        
        statsList.appendChild(listItem);
    });
}

// 데미지 순위 정렬 계산
function calcSortedItems(){
    const tid = getTargetID();
    const statsSource = singleMode ? damageDB2 : damageDB;
    
    // 데이터 소스가 없거나 비어있으면 빈 배열 반환
    if (!statsSource || Object.keys(statsSource).length === 0) return [];
    
    // 초기화된 기본 데이터만 있는 경우도 빈 배열 반환
    if (Object.keys(statsSource).length === 1 && statsSource[0] && 
        Object.keys(statsSource[0]).length === 1 && statsSource[0][0]) {
        return [];
    }
    
    const sorted = Object.entries(statsSource)
        .filter(([user_id, item]) => {
            // 유효한 데이터만 필터링
            return item && item[tid] && item[tid][""] && 
                   item[tid][""].all && item[tid][""].all.total_damage > 0;
        })
        .filter(([user_id, item]) => {
            // 유저 데이터가 있는 경우만
            return userData[user_id] && userData[user_id].job && userData[user_id].job.length > 0;
        })
        .sort((a, b) => {
            const aDamage = (a[1][tid] && a[1][tid][""] && a[1][tid][""].all) ? a[1][tid][""].all.total_damage : 0;
            const bDamage = (b[1][tid] && b[1][tid][""] && b[1][tid][""].all) ? b[1][tid][""].all.total_damage : 0;
            return bDamage - aDamage;
        })
        .map(([key, item]) => [key, item[tid]])
        .slice(0, 12);

    return sorted;
}

// ========== 데이터 관리 함수 ==========
// 전체 데이터베이스 초기화
function clearDB () {
    damageDB  = {0:{0:{"":{}}}}
    damageDB2 = {0:{0:{"":{}}}}
    buffDB = {};
    selfID = 0;
    enemyData = {}
    userData = {}
    hitTime = {};
    userTmpData = null;

    selectedDetailUserId = null;
    skillDetailOpened = {};
    Object.keys(selectedDetailSkillName).forEach(key => delete selectedDetailSkillName[key]);
    
    // 차트 완전 초기화
    dpsChartData = [];
    chartInitialized = false;
    if (dpsChart) {
        try {
            dpsChart.destroy();
        } catch (e) {
            console.error('차트 제거 중 오류:', e);
        }
        dpsChart = null;
    }
    
    // 모든 UI 초기화
    document.getElementById('runtime-text').textContent = '0.00초';
    document.getElementById('total-text').textContent = '0';
    document.getElementById('total-dps-text').textContent = '0';
    
    // 카드 리스트 초기화 및 빈 메시지 표시
    const statsList = document.getElementById('damage-stats-list');
    statsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-dim); font-size: 0.9em;"><i class="fas fa-info-circle"></i> 측정된 데이터가 없습니다</div>';
    
    // 상세 패널 숨기기
    document.getElementById('detail-panel').style.display = 'none';
    
    // 차트 패널 숨기기
    const chartPanel = document.getElementById('chartPanel');
    if (chartPanel) {
        chartPanel.style.display = 'none';
    }
    
    // 모달 닫기
    const modal = document.getElementById('detailModal');
    if (modal && modal.classList.contains('open')) {
        modal.classList.remove('open');
    }
    
    // 버프 리스트 초기화
    const buffLists = document.querySelectorAll('.buff-list');
    buffLists.forEach(list => {
        list.innerHTML = '';
    });
    
    // 스킬 상세 패널 초기화
    const skillPanel = document.getElementById('skill-detail-panel');
    if (skillPanel) {
        skillPanel.innerHTML = '';
    }
    
    // 마지막 데이터 시간 리셋
    lastDataTime = Date.now();
    
    console.log('모든 데이터가 초기화되었습니다.');
}

// 자동 초기화 체크 함수
// 자동 초기화 체크
function checkAutoReset() {
    const now = Date.now();
    const timeSinceLastData = now - lastDataTime;
    
    // 1분 이상 데이터가 없고, 데이터가 있는 경우에만
    if (timeSinceLastData >= autoResetTimeout && getTotalDamage() > 0) {
        // 자동 초기화 확인 대화상자
        if (confirm('1분 이상 데이터 수집이 없었습니다.\n데이터를 초기화하시겠습니까?')) {
            clearDB();
            renderDamageRanks();
        } else {
            // 취소하면 타이머 재설정
            lastDataTime = Date.now();
        }
    }
}

// 자동 초기화 타이머 시작
// 자동 초기화 타이머 시작
function startAutoResetTimer() {
    if (!autoResetInterval) {
        autoResetInterval = setInterval(checkAutoReset, 5000); // 5초마다 체크
    }
}

(function() {
    singleMode = localStorage.getItem('singleMode') === 'true';
    bossMode = localStorage.getItem('bossMode') ?? "모두";
    buffVisibleTypes = JSON.parse(localStorage.getItem('buffVisibleTypes')) || {};

    const calcModeCheckBox = document.getElementById('calcmodechkbox');
    const singleModeCheckbox = document.getElementById('singleModeCheckbox');
    calcModeCheckBox.onchange = () => {
        bossMode = calcModeCheckBox.value;                
        renderDamageRanks();
        localStorage.setItem('bossMode', bossMode);
    };
    singleModeCheckbox.onchange = () => {
        singleMode = singleModeCheckbox.checked;                
        renderDamageRanks();
        localStorage.setItem('singleMode', singleMode);
    };
    singleModeCheckbox.checked = singleMode
    calcModeCheckBox.value = bossMode


    const group = document.getElementById('buff-radio-groups');
    const buttons = group.querySelectorAll('.btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const labels = Array.from(buttons).map(b=>b.innerText.trim())
            const label = btn.innerText.trim();
            const state = btn.classList.contains('active');

            if (label == "전체"){
                if(state == true){
                    labels.forEach(l=>buffVisibleTypes[l]=false);
                    buttons.forEach(b => b.classList.remove('active'));
                }
                else{
                    labels.forEach(l=>buffVisibleTypes[l]=true);
                    buttons.forEach(b => b.classList.add('active'));
                }
            }
            else{
                if(state == true){                            
                    buffVisibleTypes[label] = false;
                    btn.classList.remove('active');
                    buttons[0].classList.remove('active');
                }
                else {
                    buffVisibleTypes[label] = true;
                    btn.classList.add('active');
                }
            }

            localStorage.setItem('buffVisibleTypes', JSON.stringify(buffVisibleTypes));
            renderDamageRanks();
        });
    });
    
   buttons.forEach(btn => {
        const labels = Array.from(buttons).map(b=>b.innerText.trim())
        const label = btn.innerText.trim();
        let state = false;
        if (label == "전체"){
            state =  Object.values(buffVisibleTypes).every(v => v === true);
        }
        else{
            state = buffVisibleTypes[label]
        }
        if(state == false){
            btn.classList.remove('active');
        }
        else {
            btn.classList.add('active');
        }                
    });

})();

const saveAllBtn = document.getElementById('saveAllBtn');
saveAllBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    function getKoreaTime(){
        const now = new Date();
        const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const yyyy = kst.getFullYear();
        const mm = String(kst.getMonth() + 1).padStart(2, '0');
        const dd = String(kst.getDate()).padStart(2, '0');
        const HH = String(kst.getHours()).padStart(2, '0');
        const MM = String(kst.getMinutes()).padStart(2, '0');
        const SS = String(kst.getSeconds()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}T${HH}-${MM}-${SS}`;
    }
    const data = {
        damageDB,
        damageDB2,
        buffDB,
        selfID,
        enemyData,
        userData,
        hitTime
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `savedata_${getKoreaTime()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
};

// 데이터 불러오기 버튼 및 파일 input 생성
const loadAllBtn = document.getElementById('loadAllBtn');
let fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.json';

loadAllBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    fileInput.value = '';
    fileInput.click();
};

fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            clearDB();
            
            const data = JSON.parse(ev.target.result);

            // === 불러온 데이터 적용 ===
            Object.assign(damageDB, data.damageDB || {});
            Object.assign(damageDB2, data.damageDB2 || {});
            Object.assign(buffDB, data.buffDB || {});
            Object.assign(enemyData, data.enemyData || {});
            Object.assign(userData, data.userData || {});
            Object.assign(hitTime, data.hitTime || {});
            selfID = data.selfID;

            renderDamageRanks();
            // alert('데이터를 성공적으로 불러왔습니다.');
        } catch (err) {
            alert('불러오기 실패: ' + err);
        }
    };
    reader.readAsText(file, 'utf-8');
};

// 내보내기 메뉴 토글
document.getElementById('exportBtn').onclick = (e) => {
    e.stopPropagation();
    const menu = document.getElementById('exportMenu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};

// 클릭 외부 시 메뉴 닫기
document.addEventListener('click', () => {
    document.getElementById('exportMenu').style.display = 'none';
});

// 스크린샷 기능
window.exportScreenshot = async () => {
    const statsPanel = document.querySelector('.panel:has(#damage-stats-list)');
    if (!statsPanel) return;
    
    // html2canvas 라이브러리 로드
    if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        document.head.appendChild(script);
        await new Promise(resolve => script.onload = resolve);
    }
    
    try {
        const canvas = await html2canvas(statsPanel, {
            backgroundColor: '#0f0f0f',
            scale: 2
        });
        
        canvas.toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `damage_meter_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
            a.click();
            URL.revokeObjectURL(url);
        });
    } catch (err) {
        console.error('스크린샷 실패:', err);
    }
};

// CSV 내보내기
window.exportCSV = () => {
    const sorted = calcSortedItems();
    const runtime = getRuntimeSec();
    
    let csv = 'Rank,Name,DPS,Total Damage,Damage Share,Critical Rate,Add Hit Rate\n';
    
    sorted.forEach(([user_id, item], idx) => {
        const stat = item[""];
        const total = stat.all.total_damage || 0;
        const critRate = calcCritHitPercent(stat);
        const addhitRate = calcAddHitPercent(stat);
        const dps = Math.floor(total/(runtime+1));
        const totalSum = sorted.reduce((sum, [uid,s]) => sum + (s[""].all.total_damage || 0), 0);
        const share = ((total/totalSum)*100).toFixed(1);
        const jobName = userData[user_id] ? userData[user_id].job : user_id;
        
        csv += `${idx+1},"${jobName}",${dps},${total},${share}%,${critRate}%,${addhitRate}%\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `damage_report_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// 클립보드 복사 (Discord용)
window.copyToClipboard = () => {
    const sorted = calcSortedItems();
    const runtime = getRuntimeSec();
    const totalSum = sorted.reduce((sum, [uid,stat]) => sum + (stat[""].all.total_damage || 0), 0);
    
    let text = `**전투 시간**: ${runtime.toFixed(2)}초\n`;
    text += `**총 데미지**: ${totalSum.toLocaleString()}\n\n`;
    text += `**DPS 순위**\n`;
    
    sorted.slice(0, 10).forEach(([user_id, item], idx) => {
        const stat = item[""];
        const total = stat.all.total_damage || 0;
        const dps = Math.floor(total/(runtime+1));
        const share = ((total/totalSum)*100).toFixed(1);
        const jobName = userData[user_id] ? userData[user_id].job : user_id;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}.`;
        
        text += `${medal} **${jobName}** - ${dps.toLocaleString()} DPS (${share}%)\n`;
    });
    
    navigator.clipboard.writeText(text).then(() => {
        // 복사 완료 알림
        const btn = document.getElementById('exportBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> 복사됨!';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
        }, 2000);
    });
};

setInterval(() => {
    const elapsed = getRuntimeSec();
    const total = getTotalDamage(singleMode);
    document.getElementById('runtime-text').textContent = `${elapsed.toFixed(2)}초`;
    document.getElementById('total-text').textContent = `${total.toLocaleString()}`;
    document.getElementById('total-dps-text').textContent = `${Math.round(total/(elapsed+1)).toLocaleString()}`;
}, 500);

// ========== WebSocket 연결 관리 ==========
(function(){
    let isConnected = false;

    // WebSocket 연결 상태 변경 핸들러
    function onConnectionChanged(connected) {
        isConnected = connected;
        const ctrl = document.getElementById('connectSym');
        if (connected) {
            ctrl.classList.add("status-connected")
        } else {
            ctrl.classList.remove("status-connected")
        }
    }
    document.getElementById('connectBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        else{
            connect()
        }
    }
    document.getElementById('clearBtn').onclick = () => {
        // 모든 데이터 초기화
        clearDB();
        
        // WebSocket 재연결로 서버 데이터도 초기화
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        connect();
        
        // UI 렌더링
        renderDamageRanks();
    };

    // WebSocket 연결 함수
    function connect() {
        ws = new WebSocket(wsUrl);

        // 연결 성공 이벤트
        ws.onopen = () => {
            onConnectionChanged(true);
        };

        // 메시지 수신 이벤트 (서버로부터 데이터 받기)
        ws.onmessage = (event) => {
            try {
                const obj = JSON.parse(event.data);
                switch (obj.type) {
                    case "damage":
                        damageDB   = obj.data.damage;
                        damageDB2  = obj.data.damage2;
                        selfID    = obj.data.self_id;
                        enemyData  = obj.data.enemy;
                        hitTime    = obj.data.hit_time;
                        buffDB = obj.data.buff;
                        if (obj.data.user) {
                            userData = obj.data.user;
                        }
                        userTmpData = obj.data.user_tmp;
                        
                        // 데이터 수신 시간 업데이트
                        lastDataTime = Date.now();
                        
                        if (render_timeout) return;
                        render_timeout = setTimeout(() => {
                            renderDamageRanks();
                            // 차트 업데이트는 별도 타이머로 관리
                            if (!chartUpdateTimeout && isTabActive) {
                                chartUpdateTimeout = setTimeout(() => {
                                    updateDPSChart();
                                    chartUpdateTimeout = null;
                                }, 500); // 500ms 주기로 차트 업데이트
                            }
                            render_timeout = null;
                        }, 100);    
                        break;
                }
            } catch (e) {
                console.log("메시지 처리 오류:", e, event.data);
            }
        };

        // 연결 종료 이벤트
        ws.onclose = () => {
            onConnectionChanged(false);
        };

        ws.onerror = (err) => {
            onConnectionChanged(false);
        };
    }

    connect();
    
    // DOM 로드 완료 후 이벤트 설정
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupEventListeners);
    } else {
        setupEventListeners();
    }
    
    // ========== DOM 이벤트 리스너 설정 ==========
    // DOM이 완전히 로드된 후에 실행
    function setupEventListeners() {
        // 설정 패널 이벤트
        const settingsBtn = document.getElementById('settingsBtn');
        const settingsClose = document.getElementById('settingsClose');
        const settingsPanel = document.getElementById('settingsPanel');
        
        if (settingsBtn && settingsPanel) {
            settingsBtn.onclick = () => {
                settingsPanel.classList.add('open');
            };
        }
        
        if (settingsClose && settingsPanel) {
            settingsClose.onclick = () => {
                settingsPanel.classList.remove('open');
            };
        }
        
        // 토글 스위치 이벤트
        document.querySelectorAll('.toggle-switch').forEach(toggle => {
            toggle.onclick = () => {
                toggle.classList.toggle('active');
                
                // 차트 토글 처리
                if (toggle.id === 'chartToggle') {
                    const chartPanel = document.getElementById('chartPanel');
                    if (chartPanel) {
                        if (toggle.classList.contains('active')) {
                            // 차트가 표시되어야 하는데 데이터가 있으면 표시
                            if (getTotalDamage() > 0) {
                                chartPanel.style.display = 'block';
                                if (!chartInitialized) {
                                    initDPSChart();
                                }
                            }
                        } else {
                            chartPanel.style.display = 'none';
                        }
                        localStorage.setItem('chartEnabled', toggle.classList.contains('active'));
                    }
                }
                
                // 애니메이션 토글 처리
                if (toggle.id === 'animationToggle') {
                    if (toggle.classList.contains('active')) {
                        document.body.classList.remove('no-animation');
                    } else {
                        document.body.classList.add('no-animation');
                    }
                    localStorage.setItem('animationEnabled', toggle.classList.contains('active'));
                }
                
                // 자동 초기화 토글 처리
                if (toggle.id === 'autoResetToggle') {
                    if (toggle.classList.contains('active')) {
                        startAutoResetTimer();
                    } else {
                        if (autoResetInterval) {
                            clearInterval(autoResetInterval);
                            autoResetInterval = null;
                        }
                    }
                    localStorage.setItem('autoResetEnabled', toggle.classList.contains('active'));
                }
            };
        });
        
        // 저장된 설정 복원
        const chartEnabled = localStorage.getItem('chartEnabled') !== 'false';
        const animationEnabled = localStorage.getItem('animationEnabled') !== 'false';
        const autoResetEnabled = localStorage.getItem('autoResetEnabled') !== 'false';
        
        const chartToggle = document.getElementById('chartToggle');
        const animationToggle = document.getElementById('animationToggle');
        const autoResetToggle = document.getElementById('autoResetToggle');
        
        if (chartToggle) chartToggle.classList.toggle('active', chartEnabled);
        if (animationToggle) animationToggle.classList.toggle('active', animationEnabled);
        if (autoResetToggle) autoResetToggle.classList.toggle('active', autoResetEnabled);
        
        // 초기 상태 적용
        if (!chartEnabled && document.getElementById('chartPanel')) {
            document.getElementById('chartPanel').style.display = 'none';
        }
        if (!animationEnabled) {
            document.body.classList.add('no-animation');
        }
        if (!autoResetEnabled && autoResetInterval) {
            clearInterval(autoResetInterval);
            autoResetInterval = null;
        }
        
        // ===== 테마 및 UI 설정 이벤트 =====
        // 테마 변경 (select 요소 사용)
        const themeSelect = document.getElementById('themeSelect');
        if (themeSelect) {
            themeSelect.addEventListener('change', () => {
                const selectedTheme = themeSelect.value;
                document.body.setAttribute('data-theme', selectedTheme);
                localStorage.setItem('theme', selectedTheme);
            });
        }
        
        // 뷰 모드 변경 (select 요소 사용)
        const viewModeSelect = document.getElementById('viewModeSelect');
        if (viewModeSelect) {
            viewModeSelect.addEventListener('change', () => {
                viewMode = viewModeSelect.value;
                localStorage.setItem('viewMode', viewMode);
                renderDamageRanks();
            });
        }
        
        // 저장된 설정 복원
        const savedTheme = localStorage.getItem('theme') || 'dark';
        const savedViewMode = localStorage.getItem('viewMode') || 'card';
        
        // 테마 설정 복원
        if (themeSelect) {
            themeSelect.value = savedTheme;
        }
        document.body.setAttribute('data-theme', savedTheme);
        
        // 뷰 모드 설정 복원
        if (viewModeSelect) {
            viewModeSelect.value = savedViewMode;
        }
        viewMode = savedViewMode;
    }
    
    // Chart.js는 로드하되 초기화는 하지 않음
    // 데이터가 들어올 때 updateDPSChart에서 자동으로 초기화됨
    
    // 자동 초기화 타이머 시작
    startAutoResetTimer();
    
    // ===== 브라우저 탭 활성 상태 감지 (성능 최적화) =====
    document.addEventListener('visibilitychange', () => {
        isTabActive = !document.hidden;
        if (!isTabActive) {
            // 탭이 비활성화되면 차트 업데이트 중지
            if (chartUpdateTimeout) {
                clearTimeout(chartUpdateTimeout);
                chartUpdateTimeout = null;
            }
        }
    });
    
    // 모달 닫기 버튼 이벤트
    const modalClose = document.getElementById('modalClose');
    if (modalClose) {
        modalClose.onclick = () => {
            const detailModal = document.getElementById('detailModal');
            if (detailModal) {
                detailModal.classList.remove('open');
            }
        };
    }
    
    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('detailModal').classList.remove('open');
            const settingsPanel = document.getElementById('settingsPanel');
            if (settingsPanel) {
                settingsPanel.classList.remove('open');
            }
        }
    });
    
    // 전투 시간 업데이트
    setInterval(() => {
        const combatTimeElement = document.getElementById('combatTime');
        if (combatTimeElement) {
            const elapsed = getRuntimeSec();
            const minutes = Math.floor(elapsed / 60);
            const seconds = Math.floor(elapsed % 60);
            combatTimeElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
})();
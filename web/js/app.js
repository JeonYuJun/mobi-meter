// ========== 전역 변수 및 초기 설정 ==========
const wsUrl = "ws://localhost:6519";
let ws = null;
let reconnectInterval = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 3000; // 3초

// 데미지 및 버프 데이터베이스
let damageDB  = {0:{0:{"":{}}}}  // 메인 데미지 DB
let damageDB2 = {0:{0:{"":{}}}}  // 싱글 모드용 데미지 DB
let buffDB = {};                 // 버프 정보 DB
let selfID = 0;                  // 본인 캐릭터 ID
let enemyData = {}               // 적 정보
let userData = {}                // 유저 정보
let hitTime = {};                // 타격 시간 기록
let userTmpData = {}             // 임시 유저 데이터
let serverStats = {};            // 서버에서 받은 통계 데이터

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
let maxDataPoints = 3600;        // 30분 데이터 (전체 전투시간 지원)
let chartInitialized = false;
let chartUpdateTimeout = null;
let isTabActive = true;
let lastRenderHash = null;  // 마지막 렌더링 상태 해시 - 성능 최적화
let miniChart = null;  // 미니 차트 인스턴스
let userDpsHistory = {};  // 각 유저의 DPS 히스토리 저장
let viewMode = localStorage.getItem('viewMode') || 'card';  // 저장된 값 또는 기본값 'card'

// 자동 초기화 관련 변수
let lastDataTime = Date.now();
let autoResetInterval = null;
let autoResetTimeout = 60000;    // 기본 60초

// ========== 차트 관련 함수 ==========
// DPS 차트 초기화
function initDPSChart() {
    if (chartInitialized && dpsChart) {
        // console.log('차트가 이미 초기화되어 있습니다');
        return;
    }
    
    const canvas = document.getElementById('realtimeDPSChart');
    if (!canvas) {
        // console.error('차트 캔버스를 찾을 수 없습니다');
        // DOM이 완전히 로드되지 않았을 수 있으므로 다시 시도
        if (document.readyState !== 'complete') {
            setTimeout(initDPSChart, 100);
        }
        return;
    }
    
    // 차트 패널이 표시되어 있는지 확인
    const chartPanel = document.getElementById('chartPanel');
    if (!chartPanel || chartPanel.style.display === 'none') {
        // console.log('차트 패널이 숨겨져 있어 초기화를 건너뜁니다');
        return;
    }
    
    // Chart.js가 로드되었는지 확인
    if (typeof Chart === 'undefined') {
        // console.error('Chart.js가 아직 로드되지 않았습니다');
        setTimeout(initDPSChart, 100);
        return;
    }
    
    // Chart.js zoom 플러그인 등록 - 안전하게 처리
    if (typeof Chart.register === 'function') {
        // zoom 플러그인이 로드되었는지 확인
        if (typeof window.ChartZoom !== 'undefined') {
            try {
                Chart.register(window.ChartZoom);
            } catch (e) {
                console.warn('Zoom plugin registration warning:', e);
            }
        } else {
            console.warn('Chart.js zoom plugin not loaded yet');
        }
    }
    
    try {
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            // console.error('Canvas context를 가져올 수 없습니다');
            return;
        }
        
        // 더블클릭 이벤트 리스너 추가
        canvas.addEventListener('dblclick', function(e) {
            if (dpsChart && dpsChart.resetZoom) {
                dpsChart.resetZoom('default');
                // UI 업데이트
                const indicator = document.getElementById('zoomIndicator');
                const resetBtn = document.getElementById('resetZoomBtn');
                if (indicator) indicator.style.display = 'none';
                if (resetBtn) resetBtn.style.display = 'none';
            }
        });
        
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
                mode: 'nearest',  // index에서 nearest로 변경 (더 안정적)
                intersect: true,  // false에서 true로 변경 (tooltip 오류 방지)
                hover: {
                    mode: 'nearest',
                    intersect: true
                }
            },
            plugins: {
                decimation: {
                    enabled: true,
                    algorithm: 'lttb',
                    samples: 500,
                    threshold: 1000
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#e0e0e0',
                        font: {
                            size: 11
                        },
                        usePointStyle: true,
                        padding: 10,
                        generateLabels: function(chart) {
                            const original = Chart.defaults.plugins.legend.labels.generateLabels;
                            const labels = original.call(this, chart);
                            labels.forEach(label => {
                                label.strokeStyle = label.hidden ? 'rgba(128,128,128,0.3)' : label.strokeStyle;
                                label.fillStyle = label.hidden ? 'rgba(128,128,128,0.3)' : label.fillStyle;
                            });
                            return labels;
                        }
                    },
                    onClick: function(e, legendItem, legend) {
                        const index = legendItem.datasetIndex;
                        const chart = legend.chart;
                        const meta = chart.getDatasetMeta(index);
                        
                        meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
                        chart.update('none');
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: true,
                    intersect: true,  // false에서 true로 변경
                    mode: 'nearest',  // index에서 nearest로 변경
                    filter: function(tooltipItem) {
                        // null/undefined 데이터 필터링
                        return tooltipItem && tooltipItem.parsed !== undefined && tooltipItem.parsed.y !== null;
                    },
                    callbacks: {
                        label: function(context) {
                            try {
                                if (!context || !context.dataset || 
                                    context.parsed === undefined || context.parsed === null ||
                                    context.parsed.y === undefined || context.parsed.y === null) {
                                    return '';
                                }
                                const value = context.parsed.y;
                                const label = context.dataset.label || '';
                                return label + ': ' + value.toLocaleString() + ' DPS';
                            } catch (e) {
                                return '';
                            }
                        },
                        beforeLabel: function(context) {
                            return '';
                        }
                    }
                },
                zoom: {
                    limits: {
                        x: {min: 'original', max: 'original'},
                        y: {min: 0, max: 'original'}
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.1
                        },
                        pinch: {
                            enabled: true
                        },
                        drag: {
                            enabled: true,  // 드래그로 구간 확대
                            backgroundColor: 'rgba(100, 100, 100, 0.1)',
                            borderColor: 'rgba(255, 255, 255, 0.3)',
                            borderWidth: 1,
                            threshold: 10
                        },
                        mode: 'x',  // x축만 줌 (시간축)
                        onZoomStart: function(context) {
                            try {
                                if (!context || !context.chart || !context.chart.canvas) return false;
                                const chart = context.chart;
                                
                                // Chart.js 내부 메서드 체크
                                if (!chart.scales || !chart.scales.x || !chart.scales.y) return false;
                                
                                chart.isZooming = true;
                                
                                // 줌 표시기 보이기
                                const indicator = document.getElementById('zoomIndicator');
                                if (indicator) {
                                    indicator.style.display = 'inline-block';
                                }
                            } catch (e) {
                                console.error('Zoom start error:', e);
                                return false;
                            }
                        },
                        onZoomComplete: function(context) {
                            try {
                                if (!context || !context.chart || !context.chart.canvas) return;
                                const chart = context.chart;
                                
                                // Chart.js 내부 메서드 체크
                                if (!chart.scales || !chart.scales.x || !chart.scales.y) return;
                                
                                chart.isZooming = false;
                                
                                // 줌 레벨 확인
                                const xScale = chart.scales.x;
                                const isZoomed = xScale.min !== xScale.options.min || xScale.max !== xScale.options.max;
                                
                                // 줌 표시기와 리셋 버튼 표시/숨김
                                const indicator = document.getElementById('zoomIndicator');
                                const resetBtn = document.getElementById('resetZoomBtn');
                                if (indicator) {
                                    indicator.style.display = isZoomed ? 'inline-block' : 'none';
                                }
                                if (resetBtn) {
                                    resetBtn.style.display = isZoomed ? 'inline-block' : 'none';
                                }
                                
                                // 줌 레벨이 매우 낮으면 자동 리셋 (거의 전체 보기)
                                if (isZoomed && xScale.max - xScale.min >= (xScale.options.max - xScale.options.min) * 0.95) {
                                    // 95% 이상 확대된 상태면 자동 리셋
                                    chart.resetZoom('none');
                                }
                            } catch (e) {
                                console.error('Zoom complete error:', e);
                            }
                        }
                    },
                    pan: {
                        enabled: false  // Pan 기능 비활성화 (제대로 작동하지 않음)
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
                        maxTicksLimit: 15,
                        callback: function(value, index, ticks) {
                            const totalPoints = this.chart.data.labels.length;
                            const label = this.chart.data.labels[index];
                            
                            // 레이블이 비어있지 않은 경우만 표시
                            if (!label) return '';
                            
                            // 30초 단위로 표시 (6개 포인트마다, 5초 간격이므로)
                            if (index % 6 === 0) {
                                return label;
                            }
                            return '';
                        }
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    grace: '10%',
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
                            if (value >= 1000000) {
                                return (value / 1000000).toFixed(1) + 'M';
                            } else if (value >= 1000) {
                                return (value / 1000).toFixed(0) + 'k';
                            }
                            return value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
        chartInitialized = true;
        // console.log('차트 초기화 성공');
        
        // 초기화 성공 후 빈 차트 표시
        dpsChart.update();
    } catch (error) {
        // console.error('차트 초기화 실패:', error);
        chartInitialized = false;
        dpsChart = null;
        // 재시도 (더 긴 대기시간)
        setTimeout(() => {
            // console.log('차트 초기화 재시도...');
            initDPSChart();
        }, 1000);
    }
}

// 사용자 DPS 히스토리 업데이트 (5초마다)
let lastDpsUpdate = 0;
function updateUserDpsHistory() {
    const now = Date.now();
    if (now - lastDpsUpdate < 5000) return;  // 5초마다만 업데이트
    lastDpsUpdate = now;
    
    const tid = getTargetID();
    const db = singleMode ? damageDB2 : damageDB;
    
    for (const uid in db) {
        if (db[uid] && db[uid][tid]) {
            const userStats = db[uid][tid];
            
            // 안전한 접근 - undefined 체크 추가
            if (!userStats[""] || !userStats[""].all) {
                continue;  // 데이터가 없으면 건너뜀
            }
            
            const totalDamage = userStats[""].all.total_damage || 0;
            const runtime = getRuntimeSec();
            const currentDps = runtime > 0 ? Math.floor(totalDamage / runtime) : 0;
            
            if (!userDpsHistory[uid]) {
                userDpsHistory[uid] = [];
            }
            
            userDpsHistory[uid].push(currentDps);
            
            // 최대 360개 (30분) 데이터만 유지
            if (userDpsHistory[uid].length > 360) {
                userDpsHistory[uid].shift();
            }
        }
    }
}

// 미니 DPS 차트 초기화
function initMiniDPSChart(uid) {
    const canvas = document.getElementById('miniDPSChart');
    if (!canvas) return;
    
    // 기존 차트 제거
    if (miniChart) {
        try {
            miniChart.destroy();
        } catch (e) {
            // console.error('미니 차트 제거 중 오류:', e);
        }
    }
    
    // Chart.js zoom 플러그인 등록 (미니 차트용)
    if (typeof Chart.register === 'function' && window.ChartZoom) {
        Chart.register(window.ChartZoom);
    }
    
    const ctx = canvas.getContext('2d');
    
    // 해당 유저의 DPS 히스토리 가져오기
    const history = userDpsHistory[uid] || [];
    
    // 데이터가 없으면 현재 값만 표시
    if (history.length === 0) {
        const tid = getTargetID();
        const db = singleMode ? damageDB2 : damageDB;
        if (db[uid] && db[uid][tid]) {
            const userStats = db[uid][tid];
            const totalDamage = userStats[""].all.total_damage || 0;
            const runtime = getRuntimeSec();
            const currentDps = runtime > 0 ? Math.floor(totalDamage / runtime) : 0;
            history.push(currentDps);
        }
    }
    
    // 레이블과 데이터 준비
    const labels = [];
    const data = [...history];
    
    // 시간 레이블 생성 (5초 간격)
    for (let i = 0; i < data.length; i++) {
        const seconds = i * 5;
        if (seconds % 30 === 0) {
            labels.push(`${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}`);
        } else {
            labels.push('');
        }
    }
    
    try {
        miniChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'DPS',
                data: data,
                borderColor: '#00ff88',
                backgroundColor: 'rgba(0, 255, 136, 0.2)',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#00ff88',
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 0
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    intersect: false,
                    mode: 'index',
                    callbacks: {
                        title: function(context) {
                            try {
                                if (!context || !context.length || !context[0]) return '';
                                const index = context[0].dataIndex;
                                const seconds = index * 5;
                                return `${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}`;
                            } catch (e) {
                                return '';
                            }
                        },
                        label: function(context) {
                            try {
                                if (!context || context.parsed === undefined || context.parsed === null ||
                                    context.parsed.y === undefined || context.parsed.y === null) return '';
                                return context.parsed.y.toLocaleString() + ' DPS';
                            } catch (e) {
                                return '';
                            }
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
                        onDoubleClick: function(context) {
                            // 더블클릭으로 줌 리셋
                            if (context && context.chart) {
                                context.chart.resetZoom('default');
                            }
                        }
                    },
                    pan: {
                        enabled: false
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
                            size: 8
                        },
                        maxTicksLimit: 6,
                        callback: function(value, index) {
                            const seconds = index * 5;
                            if (seconds % 30 === 0) {
                                return `${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}`;
                            }
                            return '';
                        }
                    }
                },
                y: {
                    display: true,
                    beginAtZero: true,
                    grace: '10%',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#999',
                        font: {
                            size: 9
                        },
                        maxTicksLimit: 4,
                        callback: function(value) {
                            if (value >= 1000000) {
                                return (value / 1000000).toFixed(1) + 'M';
                            } else if (value >= 1000) {
                                return (value / 1000).toFixed(0) + 'k';
                            }
                            return value;
                        }
                    }
                }
            }
        }
    });
    } catch (error) {
        // console.error('미니 차트 초기화 실패:', error);
        miniChart = null;
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
        // console.log('첫 데이터 수신, 차트 초기화 시작...');
        // 차트 토글이 활성화되어 있을 때만 차트 패널 표시
        const chartToggle = document.getElementById('chartToggle');
        const chartPanel = document.getElementById('chartPanel');
        if (chartPanel && chartToggle && chartToggle.classList.contains('active')) {
            chartPanel.style.display = 'block';
            initDPSChart();
            // 초기화 후 다음 업데이트에서 데이터 표시
            setTimeout(() => updateDPSChart(), 100);
        }
        return;
    }
    // 전투 시간 계산 (5초마다 업데이트)
    const combatSeconds = dpsChart.data.labels.length * 5;
    const minutes = Math.floor(combatSeconds / 60);
    const seconds = combatSeconds % 60;
    const combatTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    // 새로운 레이블 추가
    if (dpsChart.data.labels.length >= maxDataPoints) {
        dpsChart.data.labels.shift();
    }
    dpsChart.data.labels.push(combatTime);
    
    // 데이터셋 업데이트 또는 생성 - 확장된 색상 팔레트 (12개)
    const colors = [
        '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E77E', 
        '#B19CD9', '#FF9A8B', '#6C88C4', '#FFB347',
        '#77DD77', '#AEC6CF', '#FFB6C1', '#FDFD96'
    ];
    
    // 차트에 표시할 최대 인원 (설정 가능)
    const maxChartUsers = parseInt(localStorage.getItem('maxChartUsers') || '12');
    const topUsers = sorted.slice(0, Math.min(maxChartUsers, sorted.length));
    
    // 전체 평균 DPS 계산
    let totalDpsSum = 0;
    let totalCount = 0;
    
    // 기존 데이터셋 업데이트
    const newDatasets = topUsers.map(([user_id, item], idx) => {
        const total = item[""].all.total_damage || 0;
        // 첫 데이터일 때는 0으로 처리하여 이상값 방지
        const runtime = getRuntimeSec();
        const dps = (runtime > 0 && dpsChart.data.labels.length > 1) ? Math.floor(total / runtime) : 0;
        const jobName = userData[user_id] ? userData[user_id].job : user_id;
        const isSelf = selfID == user_id;
        
        totalDpsSum += dps;
        totalCount++;
        
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
                pointHoverRadius: 7,
                pointHoverBackgroundColor: isSelf ? '#00ff88' : colors[idx % colors.length],
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2
            };
        }
        
        // 데이터 배열 길이 조정
        if (dataset.data.length >= maxDataPoints) {
            dataset.data.shift();
        }
        dataset.data.push(dps);
        
        return dataset;
    });
    
    // 평균선 데이터셋 추가
    const averageDps = totalCount > 0 ? Math.floor(totalDpsSum / totalCount) : 0;
    const averageDataset = {
        label: '평균 DPS',
        data: new Array(dpsChart.data.labels.length).fill(averageDps),
        borderColor: 'rgba(255, 255, 255, 0.3)',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderDash: [5, 5],
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false
    };
    
    // 전체 데이터셋 설정 (평균선 포함)
    dpsChart.data.datasets = [...newDatasets, averageDataset];
    
    // 각 데이터셋의 최고점 찾기 및 표시
    newDatasets.forEach(dataset => {
        const maxValue = Math.max(...dataset.data);
        const maxIndex = dataset.data.lastIndexOf(maxValue);
        
        // 최고점에 표시를 위해 pointRadius 설정
        dataset.pointRadius = dataset.data.map((value, index) => {
            return index === maxIndex && value === maxValue ? 5 : 0;
        });
        dataset.pointBackgroundColor = dataset.borderColor;
        dataset.pointBorderColor = '#fff';
        dataset.pointBorderWidth = 2;
    });
    
    // 차트 업데이트 (줌 상태 유지)
    if (dpsChart && !dpsChart.isZooming) {
        try {
            // 차트가 삭제되지 않았고 canvas가 연결되어 있는지 확인
            if (dpsChart.canvas && dpsChart.canvas.parentNode) {
                // tooltip을 잘못 업데이트시 트리거처 해제
                if (dpsChart.options && dpsChart.options.plugins && dpsChart.options.plugins.tooltip) {
                    // 업데이트 전 tooltip 숨기기
                    if (dpsChart.tooltip) {
                        dpsChart.tooltip._active = [];
                        dpsChart.tooltip.update(true);
                    }
                }
                dpsChart.update('none');
            }
        } catch (e) {
            console.error('Chart update error:', e);
            // 차트 재초기화 필요
            chartInitialized = false;
            dpsChart = null;
        }
    }
}

// 차트 줌 리셋 함수 (애니메이션 포함)
function resetChartZoom() {
    try {
        if (!dpsChart || !dpsChart.resetZoom) {
            console.warn('Chart not initialized or zoom plugin not available');
            return;
        }
        
        // 줌 상태 플래그 해제
        dpsChart.isZooming = false;
        
        // 줌 리셋 (애니메이션) - try-catch로 감싸기
        try {
            dpsChart.resetZoom('default');
        } catch (e) {
            console.error('Error resetting zoom:', e);
            // 대체 방법: 차트 재렌더링
            if (dpsChart.update) {
                dpsChart.update();
            }
        }
        
        // 버튼에 시각적 피드백 (event 객체 안전하게 처리)
        if (typeof event !== 'undefined' && event.currentTarget) {
            const button = event.currentTarget;
            if (button) {
                button.style.transform = 'scale(0.95)';
                button.style.transition = 'transform 0.1s';
                setTimeout(() => {
                    if (button) {
                        button.style.transform = 'scale(1)';
                    }
                }, 100);
            }
        }
        
        // 줌 표시기 숨기기
        const indicator = document.getElementById('zoomIndicator');
        const resetBtn = document.getElementById('resetZoomBtn');
        if (indicator) {
            indicator.style.display = 'none';
        }
        if (resetBtn) {
            resetBtn.style.display = 'none';
        }
        
        // 차트 업데이트 재개를 위한 플래그 리셋
        setTimeout(() => {
            if (dpsChart) {
                dpsChart.isZooming = false;
                // console.log('차트 줌 초기화 완료 - 실시간 업데이트 재개');
            }
        }, 300);
    } catch (error) {
        console.error('Error in resetChartZoom:', error);
    }
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
// 토스트 알림 표시 함수
function showToast(message, type = 'success') {
    // 기존 토스트 제거
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }
    
    // 토스트 생성
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    
    // 아이콘 설정
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    // 2초 후 사라지기
    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.3s ease forwards';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 2000);
}

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
// 모달 닫기 함수
function closeDetailModal() {
    const detailModal = document.getElementById('detailModal');
    if (detailModal) {
        detailModal.classList.remove('open');
    }
    
    // 스킬 선택 상태 완전 초기화
    if (selectedDetailUserId) {
        selectedDetailSkillName[selectedDetailUserId] = null;
        // 현재 사용자의 모든 스킬 상세 열림 상태 초기화
        Object.keys(skillDetailOpened).forEach(skillId => {
            if (skillId.startsWith(selectedDetailUserId + '_')) {
                skillDetailOpened[skillId] = false;
            }
        });
    }
    
    // 미니 차트 제거
    if (miniChart) {
        try {
            miniChart.destroy();
        } catch (e) {
            // console.error('미니 차트 제거 중 오류:', e);
        }
        miniChart = null;
    }
}

function showDetailModal(uid) {
    const modal = document.getElementById('detailModal');
    const modalBody = document.getElementById('modalBody');
    const modalTitle = document.getElementById('modalTitle');
    
    // 스킬 선택 상태 초기화 (모달을 열 때마다 초기화)
    selectedDetailSkillName[uid] = null;
    Object.keys(skillDetailOpened).forEach(skillId => {
        if (skillId.startsWith(uid + '_')) {
            skillDetailOpened[skillId] = false;
        }
    });
    
    const tid = getTargetID();
    const db = singleMode ? damageDB2 : damageDB;
    
    if (!db[uid] || !db[uid][tid]) return;
    
    const jobName = userData[uid] ? userData[uid].job : uid;
    
    // 순위 계산
    const sorted = calcSortedItems();
    const rank = sorted.findIndex(([id, item]) => id === uid) + 1;
    
    // 모달 헤더를 더 보기 좋게 표시
    modalTitle.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <span style="background: var(--primary-color); color: #000; padding: 4px 10px; border-radius: 4px; font-weight: bold; font-size: 0.9em;">
                ${rank}위
            </span>
            <span style="color: var(--text-color); font-weight: 600;">
                ${jobName}
            </span>
            <span style="color: var(--text-dim); font-size: 0.85em; font-weight: normal;">
                전투 상세
            </span>
        </div>
    `;
    
    // 모달 내용 구성
    modalBody.innerHTML = '';
    
    // 통계 섹션
    const statsSection = document.createElement('div');
    statsSection.innerHTML = '<h3 style="margin-bottom: 16px;">전투 통계</h3>';
    renderDetailStats(uid, statsSection);
    modalBody.appendChild(statsSection);
    
    // 개인 DPS 미니 차트 섹션
    const chartSection = document.createElement('div');
    chartSection.style.marginTop = '24px';
    chartSection.innerHTML = `
        <h3 style="margin-bottom: 16px;">DPS 추이</h3>
        <div style="position: relative; height: 150px; background: var(--bg-soft); border-radius: 8px; padding: 10px;">
            <canvas id="miniDPSChart" style="max-height: 130px;"></canvas>
        </div>
    `;
    modalBody.appendChild(chartSection);
    
    // 미니 차트 초기화
    setTimeout(() => {
        initMiniDPSChart(uid);
    }, 100);
    
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
                    공격증가
                    <span class="tooltip-text">버프로 인한 공격력 증가</span>
                </div>
                <div style="text-align: center;" class="tooltip">
                    피해증가
                    <span class="tooltip-text">버프로 인한 데미지 증가</span>
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
    
    // 전투 데이터 계산 - 전체 통계는 "" 스킬에서 가져와야 함
    const totalDb = singleMode ? damageDB2[uid][tid][""] : damageDB[uid][tid][""];
    const totalDamage = skill === "" ? (db.all.total_damage || 0) : (totalDb.all.total_damage || 0);
    const combatTime = getRuntimeSec();
    const dps = combatTime > 0 ? Math.floor(totalDamage / combatTime) : 0;
    
    // 새로운 통계 데이터 (슬라이딩 DPS, 버프 공격력/데미지)
    const stats = window.globalStats?.[uid] || {};
    const slidingDps = stats.sliding_dps || dps;
    const avgDamageMultiplier = stats.avg_damage_multiplier || 100;
    const avgDamageReceived = stats.avg_damage_received || 100;
    
    // 전체 대미지 중 비율 계산
    const sorted = calcSortedItems();
    const totalSum = sorted.reduce((sum, [uid,stat]) => sum + (stat[""].all.total_damage || 0), 0);
    const damageRate = totalSum > 0 ? ((totalDamage / totalSum) * 100).toFixed(1) : 0;
    
    // 타격 횟수 계산 - 스킬별 데이터 사용
    const totalHits = (db.normal.total_count || 0) + (db.special.total_count || 0) + (db.dot.total_count || 0);
    
    // 각종 확률 계산 - 스킬별 데이터 사용
    const critRate = calcCritHitPercent(db);
    const addhitRate = calcAddHitPercent(db);
    // 강타율과 연타율은 normal과 special 공격에서만 계산 (dot 제외)
    const normalSpecialHits = (db.normal.total_count || 0) + (db.special.total_count || 0);
    const powerRate = normalSpecialHits > 0 ? ((db.normal.power_count + db.special.power_count) / normalSpecialHits * 100).toFixed(1) : 0;
    const fastRate = normalSpecialHits > 0 ? ((db.normal.fast_count + db.special.fast_count) / normalSpecialHits * 100).toFixed(1) : 0;
    
    // 버프 데이터는 전체 통계에서 가져와야 함
    const atkbuff = totalDb.buff.total_count > 0 ? (totalDb.buff.total_atk / totalDb.buff.total_count).toFixed(1) : 0;
    const dmgbuff = totalDb.buff.total_count > 0 ? (totalDb.buff.total_dmg / totalDb.buff.total_count).toFixed(1) : 0;
    
    // 기존 통계 섹션 제거
    const existingStats = container.querySelector('.modal-stats-container');
    if (existingStats) {
        existingStats.remove();
    }
    
    const statsHtml = `
        <div class="modal-stats-container" style="margin-top: 12px;">
            <!-- 기본 통계 섹션 -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px;">
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">${skill ? '스킬 데미지' : '총 데미지'}</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; word-break: break-all; margin-top: 8px;">${skill ? (db.all.total_damage || 0).toLocaleString() : totalDamage.toLocaleString()}</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">DPS</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #4CAF50; word-break: break-all; margin-top: 8px;">${dps.toLocaleString()}</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">데미지 비율</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${damageRate}%</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">전투 시간</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${Math.floor(combatTime)}초</div>
                </div>
            </div>
            
            <!-- 타격 횟수 섹션 -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px;">
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">일반 타격수</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; word-break: break-all; margin-top: 8px;">
                        ${((skill ? db.normal.total_count : totalDb.normal.total_count) || 0).toLocaleString()}
                    </div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">특수 타격수</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; word-break: break-all; margin-top: 8px;">
                        ${((skill ? db.special.total_count : totalDb.special.total_count) || 0).toLocaleString()}
                    </div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">도트 타격수</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; word-break: break-all; margin-top: 8px;">
                        ${((skill ? db.dot.total_count : totalDb.dot.total_count) || 0).toLocaleString()}
                    </div>
                </div>
            </div>
            
            <!-- 확률 통계 섹션 (첫 번째 줄) -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px;">
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">치명타</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${critRate}%</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">추가타</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${addhitRate}%</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">강타율</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${powerRate}%</div>
                </div>
            </div>
            
            <!-- 버프 통계 섹션 (두 번째 줄) -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">연타율</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${fastRate}%</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">공격증가</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${atkbuff}%</div>
                </div>
                <div class="buff-item" style="background: var(--bg-soft); padding: 12px 10px; border-radius: 6px; text-align: center; border: 1px solid var(--border-color); overflow: hidden; display: flex; flex-direction: column; justify-content: center; min-height: 60px;">
                    <div style="font-size: 0.7em; color: var(--text-dim);">피해증가</div>
                    <div style="font-size: 0.95em; font-weight: 600; color: #00c896; margin-top: 8px;">${dmgbuff}%</div>
                </div>
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
    // 버프는 항상 전체 데이터("")를 사용해야 함
    const totalDb = singleMode ? damageDB2[uid][tid][""] : damageDB[uid][tid][""];
    const buffs = buffDB[uid] ? buffDB[uid][tid][""] : {};
    
    const types = {"룬":1, "스킬":11, "시너지":12, "적":21, "펫":31};
    const colors = {1:"E68A2E", 11:"2E7DD9", 12:"36CC6D", 21:"A05ED9", 31:"E65A9C"};
    const typeNames = {1:"룬", 11:"스킬", 12:"시너지", 21:"적", 31:"펫"};
    
    // 버프를 타입별로 그룹화
    const buffsByType = {};
    
    // 서버에서 받은 버프 통계 사용
    const buffStats = serverStats?.buff_uptime?.[uid] || {};
    
    for (const [key, value] of Object.entries(buffs)) {
        const type = value.type;
        if (!buffsByType[type]) buffsByType[type] = [];
        
        let uptime = 0;
        let avgStack = 0;
        let maxStack = value.max_stack || 0;
        
        if (skill && skill !== "") {
            // 스킬별 버프 데이터
            const skillBuffData = buffDB[uid]?.[tid]?.[skill]?.[key];
            if (skillBuffData && skillBuffData.total_count > 0) {
                const normalHits = (db.normal?.total_count || 0) + (db.special?.total_count || 0);
                // dist_20250806 방식: total_stack/max_stack 비율을 normalHits에 대한 백분율로 계산
                uptime = normalHits > 0 && skillBuffData.max_stack > 0 ? 
                    Math.min(100, calcPercent(skillBuffData.total_stack / skillBuffData.max_stack, normalHits)) : 0;
                avgStack = skillBuffData.total_stack / skillBuffData.total_count;
                maxStack = skillBuffData.max_stack || maxStack;
            }
        } else {
            // 전체 데이터
            if (value.total_count > 0 && value.max_stack > 0) {
                const normalHits = (totalDb.normal?.total_count || 0) + (totalDb.special?.total_count || 0);
                // dist_20250806 방식: total_stack/max_stack 비율을 normalHits에 대한 백분율로 계산
                uptime = normalHits > 0 ? 
                    Math.min(100, calcPercent(value.total_stack / value.max_stack, normalHits)) : 0;
                avgStack = value.total_stack / value.total_count;
            }
        }
        
        buffsByType[type].push({
            name: key, 
            uptime: parseFloat(uptime).toFixed(1),
            maxStack: maxStack,
            avgStack: parseFloat(avgStack).toFixed(1),
            color: colors[type]
        });
    }
    
    // 탭 네비게이션 생성
    let tabsHtml = '<div style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 2px solid var(--border-color); padding-bottom: 8px;">';
    tabsHtml += '<button class="buff-tab active" data-type="all" style="padding: 8px 16px; background: var(--primary-color); color: var(--bg-color); border: none; border-radius: 4px 4px 0 0; cursor: pointer;">전체</button>';
    
    for (const [typeCode, typeName] of Object.entries(typeNames)) {
        if (buffsByType[typeCode] && buffsByType[typeCode].length > 0) {
            tabsHtml += `<button class="buff-tab" data-type="${typeCode}" style="padding: 8px 16px; background: var(--bg-soft); color: var(--text-color); border: none; border-radius: 4px 4px 0 0; cursor: pointer;">${typeName} (${buffsByType[typeCode].length})</button>`;
        }
    }
    tabsHtml += '</div>';
    
    // 버프 컨테이너
    let buffHtml = '<div class="buff-container" style="height: auto; overflow: visible; background: var(--bg-soft); padding: 16px; border-radius: 8px;">';
    buffHtml += '<div class="buff-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">';
    
    // 모든 버프 표시 (초기 상태)
    for (const [typeCode, buffList] of Object.entries(buffsByType)) {
        buffList.sort((a, b) => parseFloat(b.uptime) - parseFloat(a.uptime)); // 가동률 순으로 정렬
        buffList.forEach(buff => {
            buffHtml += `
                <div class="buff-item" data-type="${typeCode}" style="display: flex; align-items: center; padding: 12px; background: var(--bg-soft); border-radius: 6px; border: 1px solid var(--border-color);">
                    <div class="circle" style="width: 12px; height: 12px; border-radius: 50%; background:#${buff.color}; margin-right: 12px; flex-shrink: 0;"></div>
                    <div style="flex: 1; overflow: hidden;">
                        <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${buff.name}</div>
                        <div style="font-size: 0.85em; color: var(--text-dim);">가동률: ${buff.uptime}% / 평균: ${buff.avgStack}스택 / 최대: ${buff.maxStack}스택</div>
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
            const atkbuff    = stat.buff.total_count > 0 ? (stat.buff.total_atk / stat.buff.total_count).toFixed(1) : 0;
            const dmgbuff    = stat.buff.total_count > 0 ? (stat.buff.total_dmg / stat.buff.total_count).toFixed(1) : 0;
            const dps        = getRuntimeSec() > 0 ? Math.floor(total / getRuntimeSec()) : 0;
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
    const atkbuff = db.buff.total_count > 0 ? (db.buff.total_atk / db.buff.total_count).toFixed(1) : 0;
    const dmgbuff = db.buff.total_count > 0 ? (db.buff.total_dmg / db.buff.total_count).toFixed(1) : 0;
    
    // 모든 detail-value span을 가져오기
    const values = document.querySelectorAll('#stat-detail-panel .detail-value');
    values[0].textContent = `${critRate}%`; 
    values[1].textContent = `${addhitRate}%`; 
    values[2].textContent = `${atkbuff}%`;
    values[3].textContent = `${dmgbuff}%`;
    

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
                    <span class="detail-value">(${calcPercent(value.total_stack, db.normal.total_count + db.special.total_count)}% / ${value.max_stack})</span>
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
                atk: skillObj.buff.total_count > 0 ? (skillObj.buff.total_atk / skillObj.buff.total_count).toFixed(1) : 0,
                dmg: skillObj.buff.total_count > 0 ? (skillObj.buff.total_dmg / skillObj.buff.total_count).toFixed(1) : 0,
            }
            
            // 스킬별 버프 데이터 가져오기
            const skillBuffs = buffDB[uid] && buffDB[uid][targetID] && buffDB[uid][targetID][skill] ? buffDB[uid][targetID][skill] : {};
            const buffList = [];
            const colors = {1:"E68A2E", 11:"2E7DD9", 12:"36CC6D", 21:"A05ED9", 31:"E65A9C"};
            
            for (const [buffName, buffData] of Object.entries(skillBuffs)) {
                // 버프 가동률은 버프 활성 횟수를 타격수로 나눔 (스택이 아닌 횟수 기준)
                const uptime = calcPercent(buffData.total_count, normal.total_count + special.total_count);
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
                <div><span>평균</span><span>${row.normal.total_count > 0 ? Math.floor(row.normal.total_damage / row.normal.total_count).toLocaleString() : '0'}</span></div>
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
                <div><span>평균</span><span>${row.dot.total_count > 0 ? Math.floor(row.dot.total_damage / row.dot.total_count).toLocaleString() : '0'}</span></div>
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
                <div><span>평균</span><span>${row.special.total_count > 0 ? Math.floor(row.special.total_damage / row.special.total_count).toLocaleString() : '0'}</span></div>
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
    atkSpan.textContent = `공격증가: ${atk}%`;
    const dmgSpan = document.createElement('span');
    dmgSpan.className = 'rank-sub';
    dmgSpan.textContent = `피해증가: ${dmg}%`;

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
    const sorted = calcSortedItems()
    
    // 데이터 해시 생성 - 성능 최적화
    const currentHash = JSON.stringify(sorted.map(([uid, stat]) => ({
        uid,
        damage: Math.floor(stat[""].all.total_damage / 100) * 100, // 100 단위로 반올림
        dps: Math.floor(stat[""].all.dps / 10) * 10 // 10 단위로 반올림
    })));
    
    // 데이터가 크게 변하지 않았으면 렌더링 건너뛰기 - 성능 최적화
    if (lastRenderHash === currentHash) {
        return;
    }
    lastRenderHash = currentHash;
    
    const statsList = document.getElementById('damage-stats-list');
    while (statsList.firstChild) statsList.removeChild(statsList.firstChild);
    
    // 데이터가 없을 때 빈 상태 표시
    if (sorted.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.style.cssText = 'text-align: center; padding: 40px; color: var(--text-dim); font-size: 0.9em;';
        emptyMessage.innerHTML = '<i class="fas fa-info-circle"></i> 측정된 데이터가 없습니다';
        statsList.appendChild(emptyMessage);
        lastRenderHash = null;  // 빈 상태일 때 해시 초기화
        return;
    }
    
    const totalSum = sorted.reduce((sum, [uid,stat]) => sum + (stat[""].all.total_damage || 0), 0);
    
    // 뷰 모드에 따라 다른 클래스 적용
    if (viewMode === 'list') {
        statsList.className = 'damage-list-container';
        renderListView(sorted, totalSum);
    } else {
        statsList.className = '';  // 클래스 제거 - CSS와 충돌 방지
        renderCardView(sorted, totalSum);
    }
}

// 카드 뷰 렌더링 (하이브리드: 상위 3명 카드, 나머지 리스트)
// 카드형 뷰 렌더링
function renderCardView(sorted, totalSum) {
    const statsList = document.getElementById('damage-stats-list');
    
    // 전체 컨테이너 생성
    const fullContainer = document.createElement('div');
    fullContainer.style.cssText = 'display: flex; flex-direction: column; gap: 20px; width: 100%;';
    
    // 상위 3명까지만 카드로 표시
    const top3Container = document.createElement('div');
    top3Container.style.cssText = 'display: grid !important; grid-template-columns: repeat(3, 1fr) !important; gap: 20px !important; width: 100% !important;';
    
    sorted.slice(0, 3).forEach(([user_id, item], idx) => {
        const stat = item[""];
        const total = stat.all.total_damage || 0;
        const critRate = calcCritHitPercent(stat);
        const addhitRate = calcAddHitPercent(stat);
        const dps = getRuntimeSec() > 0 ? Math.floor(total / getRuntimeSec()) : 0;
        
        // 새로운 통계 데이터 가져오기
        const stats = window.globalStats?.[user_id] || {};
        const slidingDps = stats.sliding_dps || dps;
        
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
                ${isSelf ? '<div class="card-me-badge"><i class="fas fa-user"></i></div>' : ''}
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
        
        top3Container.appendChild(card);
    });
    
    fullContainer.appendChild(top3Container);
    
    // 4등부터는 간단한 리스트로 표시
    if (sorted.length > 3) {
        const listContainer = document.createElement('div');
        listContainer.className = 'damage-list-container';
        listContainer.style.cssText = 'margin-top: 20px; width: 100%;';
        
        // 리스트 헤더 추가
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
            <div class="list-stat">공격증가</div>
            <div class="list-stat">피해증가</div>
        `;
        listContainer.appendChild(header);
        
        // 4등부터 리스트 아이템 추가
        sorted.slice(3).forEach(([user_id, item], originalIdx) => {
            const idx = originalIdx + 3; // 실제 순위
            const stat = item[""];
            const total = stat.all.total_damage || 0;
            const critRate = calcCritHitPercent(stat);
            const addhitRate = calcAddHitPercent(stat);
            const atkbuff = stat.buff.total_count > 0 ? (stat.buff.total_atk / stat.buff.total_count).toFixed(1) : 0;
            const dmgbuff = stat.buff.total_count > 0 ? (stat.buff.total_dmg / stat.buff.total_count).toFixed(1) : 0;
            const dps = getRuntimeSec() > 0 ? Math.floor(total / getRuntimeSec()) : 0;
            
            // 새로운 통계 데이터는 참고만
            const stats = window.globalStats?.[user_id] || {};
            const slidingDps = stats.sliding_dps || 0;
            const avgDmgMultiplier = stats.avg_damage_multiplier || 100;
            const avgDmgReceived = stats.avg_damage_received || 100;
            
            const totalRate = sorted.length === 1 ? 1 : totalSum > 0 ? total / totalSum : 0;
            const jobName = userData[user_id] ? userData[user_id].job : user_id;
            const isSelf = selfID == user_id;
            
            const listItem = document.createElement('div');
            listItem.className = 'damage-list-item';
            if (isSelf) listItem.classList.add('me');
            
            listItem.dataset.userId = user_id;
            
            listItem.innerHTML = `
                <div class="list-damage-bar" style="width: ${totalRate * 100}%"></div>
                <div class="list-rank">${idx + 1}</div>
                <div class="list-job">
                    ${jobName}
                    ${isSelf ? '<span class="list-me-indicator"><i class="fas fa-user"></i></span>' : ''}
                </div>
                <div class="list-dps">${dps.toLocaleString()}</div>
                <div class="list-damage">${total.toLocaleString()}</div>
                <div class="list-share">${(totalRate * 100).toFixed(1)}%</div>
                <div class="list-stat">${critRate}%</div>
                <div class="list-stat">${addhitRate}%</div>
                <div class="list-stat">${atkbuff}%</div>
                <div class="list-stat">${dmgbuff}%</div>
            `;
            
            listContainer.appendChild(listItem);
        });
        
        fullContainer.appendChild(listContainer);
    }
    
    statsList.appendChild(fullContainer);
}

// 리스트 뷰 렌더링
// 리스트형 뷰 렌더링
function renderListView(sorted, totalSum) {
    const statsList = document.getElementById('damage-stats-list');
    
    // 헤더 추가
    const header = document.createElement('div');
    header.className = 'damage-list-header';
    header.innerHTML = `
        <div style="text-align: center;">순위</div>
        <div>직업</div>
        <div style="text-align: center;">DPS</div>
        <div style="text-align: center;">총 데미지</div>
        <div style="text-align: center;">점유율</div>
        <div style="text-align: center;">크리</div>
        <div style="text-align: center;">추타</div>
        <div style="text-align: center;">공증</div>
        <div style="text-align: center;">피증</div>
    `;
    statsList.appendChild(header);
    
    sorted.forEach(([user_id, item], idx) => {
        const stat = item[""];
        const total = stat.all.total_damage || 0;
        const critRate = calcCritHitPercent(stat);
        const addhitRate = calcAddHitPercent(stat);
        const atkbuff = stat.buff.total_count > 0 ? (stat.buff.total_atk / stat.buff.total_count).toFixed(1) : 0;
        const dmgbuff = stat.buff.total_count > 0 ? (stat.buff.total_dmg / stat.buff.total_count).toFixed(1) : 0;
        const dps = getRuntimeSec() > 0 ? Math.floor(total / getRuntimeSec()) : 0;
        
        // 새로운 통계 데이터는 참고만
        const stats = window.globalStats?.[user_id] || {};
        const slidingDps = stats.sliding_dps || 0;
        const avgDmgMultiplier = stats.avg_damage_multiplier || 100;
        const avgDmgReceived = stats.avg_damage_received || 100;
        
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
                ${isSelf ? '<span class="list-me-indicator"><i class="fas fa-user"></i></span>' : ''}
            </div>
            <div class="list-dps">${dps.toLocaleString()}</div>
            <div class="list-damage">${total.toLocaleString()}</div>
            <div class="list-share">${(totalRate * 100).toFixed(1)}%</div>
            <div class="list-stat">${critRate}%</div>
            <div class="list-stat">${addhitRate}%</div>
            <div class="list-stat">${atkbuff}%</div>
            <div class="list-stat">${dmgbuff}%</div>
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
    serverStats = {};

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
            // console.error('차트 제거 중 오류:', e);
        }
        dpsChart = null;
    }
    // 미니 차트도 제거
    if (miniChart) {
        try {
            miniChart.destroy();
        } catch (e) {
            // console.error('미니 차트 제거 중 오류:', e);
        }
        miniChart = null;
    }
    // DPS 히스토리 초기화
    userDpsHistory = {};
    lastDpsUpdate = 0;
    
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
    
    // console.log('모든 데이터가 초기화되었습니다.');
}

// 자동 초기화 체크 함수
// 자동 초기화 체크
function checkAutoReset() {
    const now = Date.now();
    const timeSinceLastData = now - lastDataTime;
    
    // 설정된 시간 이상 데이터가 없고, 데이터가 있는 경우에만
    if (timeSinceLastData >= autoResetTimeout && getTotalDamage() > 0) {
        // 자동 초기화 실행 - clearBtn 클릭 이벤트 실행
        // console.log(`자동 초기화: ${autoResetTimeout/1000}초 동안 데이터 없음`);
        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn && clearBtn.onclick) {
            clearBtn.onclick();
        }
    }
}

// 자동 초기화 타이머 시작
// 자동 초기화 타이머 시작
function startAutoResetTimer() {
    if (!autoResetInterval) {
        autoResetInterval = setInterval(checkAutoReset, 10000); // 10초마다 체크 - 성능 최적화
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

// 저장 버튼 이벤트
document.addEventListener('DOMContentLoaded', () => {
    const saveAllBtn = document.getElementById('saveAllBtn');
    if (saveAllBtn) {
        saveAllBtn.onclick = () => {
    // WebSocket 연결은 유지
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
    }
    
    // 데이터 불러오기 버튼 및 파일 input 생성
    const loadAllBtn = document.getElementById('loadAllBtn');
    if (loadAllBtn) {
        let fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        
        loadAllBtn.onclick = () => {
            // WebSocket 연결은 유지
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
    }
});

// 내보내기 메뉴 토글
document.getElementById('exportBtn').onclick = (e) => {
    e.stopPropagation();
    const btn = document.getElementById('exportBtn');
    const menu = document.getElementById('exportMenu');
    
    if (menu.style.display === 'none') {
        // 버튼의 위치를 가져와서 메뉴 위치 설정
        const rect = btn.getBoundingClientRect();
        menu.style.top = (rect.bottom + 5) + 'px';
        menu.style.left = Math.max(10, rect.left - 100) + 'px'; // 메뉴가 버튼보다 넓으므로 조정
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
};

// 클릭 외부 시 메뉴 닫기
document.addEventListener('click', () => {
    document.getElementById('exportMenu').style.display = 'none';
});

// html2canvas 로드 함수
let html2canvasLoadPromise = null;

async function loadHtml2Canvas() {
    // 이미 로드됨
    if (window.html2canvas) {
        console.log('[html2canvas] 이미 로드됨');
        return true;
    }
    
    // 이미 로딩 중이면 같은 promise 반환
    if (html2canvasLoadPromise) {
        console.log('[html2canvas] 로딩 중... 기다리는 중');
        try {
            return await html2canvasLoadPromise;
        } catch (error) {
            console.error('[html2canvas] 로드 실패 (기다리던 중):', error);
            html2canvasLoadPromise = null;
            return false;
        }
    }
    
    // 새로운 로드 promise 생성
    html2canvasLoadPromise = new Promise((resolve, reject) => {
        console.log('[html2canvas] 스크립트 로드 시작');
        
        // 이미 스크립트 태그가 있는지 확인
        const existingScript = document.querySelector('script[src*="html2canvas"]');
        if (existingScript) {
            console.log('[html2canvas] 기존 스크립트 태그 발견');
            existingScript.remove(); // 기존 스크립트 제거
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
        script.id = 'html2canvas-script';
        
        let loadTimeout = setTimeout(() => {
            console.error('[html2canvas] 로드 타임아웃');
            reject(new Error('스크립트 로드 타임아웃'));
        }, 10000);
        
        script.onload = () => {
            clearTimeout(loadTimeout);
            console.log('[html2canvas] 스크립트 태그 로드 완료');
            
            // 전역 객체 확인을 위해 약간 대기
            setTimeout(() => {
                if (window.html2canvas) {
                    console.log('[html2canvas] 전역 객체 확인 완료');
                    resolve(true);
                } else {
                    console.error('[html2canvas] 전역 객체를 찾을 수 없음');
                    reject(new Error('전역 객체를 찾을 수 없음'));
                }
            }, 500);
        };
        
        script.onerror = (error) => {
            clearTimeout(loadTimeout);
            console.error('[html2canvas] 스크립트 로드 에러:', error);
            reject(new Error('스크립트 로드 실패'));
        };
        
        document.head.appendChild(script);
        console.log('[html2canvas] 스크립트 태그 추가됨');
    });
    
    try {
        const result = await html2canvasLoadPromise;
        console.log('[html2canvas] 로드 성공');
        return result;
    } catch (error) {
        console.error('[html2canvas] 로드 실패:', error);
        html2canvasLoadPromise = null; // 다음 시도를 위해 리셋
        showToast('이미지 캡처 라이브러리 로드 실패', 'error');
        return false;
    }
}

// 스크린샷 기능  
window.exportScreenshot = async () => {
    console.log('[Screenshot] exportScreenshot 시작');
    
    // 전체 컨테이너 찾기
    const container = document.querySelector('.container');
    if (!container) {
        console.error('[Screenshot] 컨테이너를 찾을 수 없음');
        showToast('화면을 캡처할 수 없습니다', 'error');
        return;
    }
    
    // html2canvas 라이브러리 로드
    console.log('[Screenshot] html2canvas 로드 시작');
    const loaded = await loadHtml2Canvas();
    if (!loaded || !window.html2canvas) {
        console.error('[Screenshot] html2canvas 로드 실패');
        showToast('스크린샷 라이브러리를 로드할 수 없습니다', 'error');
        return;
    }
    console.log('[Screenshot] html2canvas 로드 완료');
    
    // 스타일 변수들
    const originalScrollY = window.scrollY;
    const originalStyles = [];
    
    try {
        // 스크롤 위치 초기화
        window.scrollTo(0, 0);
        
        // 모든 스크롤 가능 영역의 원래 스타일 저장
        const scrollElements = container.querySelectorAll('#damage-stats-list, .damage-cards-container, .damage-list-container');
        
        scrollElements.forEach(el => {
            originalStyles.push({
                element: el,
                overflow: el.style.overflow,
                maxHeight: el.style.maxHeight,
                height: el.style.height
            });
            // 전체 콘텐츠 표시
            el.style.overflow = 'visible';
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
        });
        
        // 레이아웃 계산을 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 200));
        
        console.log('[Screenshot] canvas 생성 시작');
        const canvas = await html2canvas(container, {
            backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-color') || '#0f0f0f',
            scale: 2,
            height: container.scrollHeight,
            windowHeight: container.scrollHeight,
            scrollX: 0,
            scrollY: -window.scrollY,
            logging: false,
            useCORS: true,
            allowTaint: true
        });
        console.log('[Screenshot] canvas 생성 완료');
        
        // 원래 스타일로 복원
        originalStyles.forEach(style => {
            style.element.style.overflow = style.overflow;
            style.element.style.maxHeight = style.maxHeight;
            style.element.style.height = style.height;
        });
        
        // 스크롤 위치 복원
        window.scrollTo(0, originalScrollY);
        
        // Blob 생성 및 다운로드
        console.log('[Screenshot] 다운로드 준비');
        canvas.toBlob(blob => {
            if (!blob) {
                console.error('[Screenshot] Blob 생성 실패');
                showToast('이미지 생성에 실패했습니다', 'error');
                return;
            }
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mobi-meter_${new Date().getTime()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            console.log('[Screenshot] 다운로드 완료');
            showToast('이미지가 다운로드되었습니다', 'success');
        });
    } catch (err) {
        console.error('[Screenshot] 캡처 실패:', err);
        showToast(`이미지 캡처 실패: ${err.message || '알 수 없는 오류'}`, 'error');
        
        // 에러 발생 시에도 스타일 복원
        originalStyles.forEach(style => {
            if (style.element) {
                style.element.style.overflow = style.overflow;
                style.element.style.maxHeight = style.maxHeight;
                style.element.style.height = style.height;
            }
        });
        
        // 스크롤 위치 복원
        window.scrollTo(0, originalScrollY);
    }
};


// 클립보드에 이미지 복사
window.copyToClipboard = async () => {
    console.log('[Clipboard] copyToClipboard 시작');
    
    // 전체 컨테이너 찾기
    const container = document.querySelector('.container');
    if (!container) {
        console.error('[Clipboard] 컨테이너를 찾을 수 없음');
        showToast('화면을 캡처할 수 없습니다', 'error');
        return;
    }
    
    // html2canvas 라이브러리 로드
    console.log('[Clipboard] html2canvas 로드 시작');
    const loaded = await loadHtml2Canvas();
    if (!loaded || !window.html2canvas) {
        console.error('[Clipboard] html2canvas 로드 실패');
        showToast('스크린샷 라이브러리를 로드할 수 없습니다', 'error');
        return;
    }
    console.log('[Clipboard] html2canvas 로드 완료');
    
    try {
        // 스크롤 위치 초기화
        const originalScrollY = window.scrollY;
        window.scrollTo(0, 0);
        
        // 모든 스크롤 가능 영역의 원래 스타일 저장
        const scrollElements = container.querySelectorAll('#damage-stats-list, .damage-cards-container, .damage-list-container');
        const originalStyles = [];
        
        scrollElements.forEach(el => {
            originalStyles.push({
                element: el,
                overflow: el.style.overflow,
                maxHeight: el.style.maxHeight,
                height: el.style.height
            });
            // 전체 콘텐츠 표시
            el.style.overflow = 'visible';
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
        });
        
        // 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const canvas = await html2canvas(container, {
            backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-color') || '#0f0f0f',
            scale: 2,
            height: container.scrollHeight,
            windowHeight: container.scrollHeight,
            scrollX: 0,
            scrollY: -window.scrollY
        });
        
        // 원래 스타일로 복원
        originalStyles.forEach(style => {
            style.element.style.overflow = style.overflow;
            style.element.style.maxHeight = style.maxHeight;
            style.element.style.height = style.height;
        });
        
        // 스크롤 위치 복원
        window.scrollTo(0, originalScrollY);
        
        canvas.toBlob(async (blob) => {
            try {
                // 클립보드 API 사용 가능 여부 확인
                if (navigator.clipboard && window.ClipboardItem) {
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            'image/png': blob
                        })
                    ]);
                    showToast('이미지가 클립보드에 복사되었습니다!', 'success');
                } else {
                    // 대체 방법: 다운로드로 안내
                    // console.log('클립보드 API가 지원되지 않아 다운로드합니다.');
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `mobi-meter-copy_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('클립보드 복사가 지원되지 않아 이미지로 다운로드되었습니다.', 'error');
                }
            } catch (err) {
                // console.error('클립보드 복사 실패:', err);
                // 실패 시 다운로드로 대체
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `mobi-meter-copy_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('클립보드 복사 대신 이미지로 다운로드되었습니다.', 'error');
            }
        });
    } catch (err) {
        // console.error('스크린샷 실패:', err);
        showToast('이미지 캡처에 실패했습니다.', 'error');
        // 에러 발생 시에도 스타일 복원
        const scrollElements = container.querySelectorAll('#damage-stats-list, .damage-cards-container');
        scrollElements.forEach(el => {
            el.style.overflow = '';
            el.style.maxHeight = '';
            el.style.height = '';
        });
    }
};

// 모달 스크린샷 기능
window.exportModalScreenshot = async () => {
    console.log('[Modal Screenshot] exportModalScreenshot 시작');
    
    const modal = document.querySelector('#detailModal .modal-content');
    const modalBody = document.querySelector('#detailModal .modal-body');
    if (!modal || !modalBody) {
        console.error('[Modal Screenshot] 모달 요소를 찾을 수 없음');
        showToast('모달을 캡처할 수 없습니다', 'error');
        return;
    }
    
    // html2canvas 라이브러리 로드
    console.log('[Modal Screenshot] html2canvas 로드 시작');
    const loaded = await loadHtml2Canvas();
    if (!loaded || !window.html2canvas) {
        console.error('[Modal Screenshot] html2canvas 로드 실패');
        showToast('스크린샷 라이브러리를 로드할 수 없습니다', 'error');
        return;
    }
    console.log('[Modal Screenshot] html2canvas 로드 완료');
    
    // 원래 스타일 저장
    const originalOverflow = modalBody.style.overflow || '';
    const originalMaxHeight = modalBody.style.maxHeight || '';
    const originalHeight = modalBody.style.height || '';
    const originalModalMaxHeight = modal.style.maxHeight || '';
    const originalModalHeight = modal.style.height || '';
    
    try {
        // 스크롤 영역을 전체 표시로 변경
        modalBody.style.overflow = 'visible';
        modalBody.style.maxHeight = 'none';
        modalBody.style.height = 'auto';
        modal.style.maxHeight = 'none';
        modal.style.height = 'auto';
        
        // 레이아웃 계산을 위해 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 전체 높이 계산
        const fullHeight = modal.scrollHeight;
        
        // 모달 전체 캡처
        console.log('[Modal Screenshot] canvas 생성 시작');
        const canvas = await html2canvas(modal, {
            backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-soft') || '#1a1a1a',
            scale: 2,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            logging: false,
            allowTaint: true,
            width: modal.scrollWidth,
            height: fullHeight,
            windowWidth: modal.scrollWidth,
            windowHeight: fullHeight
        });
        console.log('[Modal Screenshot] canvas 생성 완료');
        
        // 스타일 원복
        modalBody.style.overflow = originalOverflow;
        modalBody.style.maxHeight = originalMaxHeight;
        modalBody.style.height = originalHeight;
        modal.style.maxHeight = originalModalMaxHeight;
        modal.style.height = originalModalHeight;
        
        // Blob 생성 및 다운로드
        console.log('[Modal Screenshot] 다운로드 준비');
        canvas.toBlob(blob => {
            if (!blob) {
                console.error('[Modal Screenshot] Blob 생성 실패');
                showToast('이미지 생성에 실패했습니다', 'error');
                return;
            }
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `mobi-meter-detail_${new Date().getTime()}.png`;
            a.click();
            URL.revokeObjectURL(url);
            console.log('[Modal Screenshot] 다운로드 완료');
            showToast('모달 이미지가 다운로드되었습니다', 'success');
        });
    } catch (err) {
        console.error('[Modal Screenshot] 캡처 실패:', err);
        showToast(`모달 캡처 실패: ${err.message || '알 수 없는 오류'}`, 'error');
        
        // 스타일 원복
        modalBody.style.overflow = originalOverflow;
        modalBody.style.maxHeight = originalMaxHeight;
        modalBody.style.height = originalHeight;
        modal.style.maxHeight = originalModalMaxHeight;
        modal.style.height = originalModalHeight;
    }
};

// 모달 클립보드 복사
window.copyModalToClipboard = async () => {
    console.log('[Modal Clipboard] copyModalToClipboard 시작');
    
    const modal = document.querySelector('#detailModal .modal-content');
    const modalBody = document.querySelector('#detailModal .modal-body');
    if (!modal || !modalBody) {
        console.error('[Modal Clipboard] 모달 요소를 찾을 수 없음');
        showToast('모달을 캡처할 수 없습니다', 'error');
        return;
    }
    
    // html2canvas 라이브러리 로드
    console.log('[Modal Clipboard] html2canvas 로드 시작');
    const loaded = await loadHtml2Canvas();
    if (!loaded || !window.html2canvas) {
        console.error('[Modal Clipboard] html2canvas 로드 실패');
        showToast('스크린샷 라이브러리를 로드할 수 없습니다', 'error');
        return;
    }
    console.log('[Modal Clipboard] html2canvas 로드 완료');
    
    // 현재 스타일 저장 (try 블록 밖에서 선언)
    const originalOverflow = modalBody.style.overflow || '';
    const originalMaxHeight = modalBody.style.maxHeight || '';
    const originalHeight = modalBody.style.height || '';
    const originalModalMaxHeight = modal.style.maxHeight || '';
    const originalModalHeight = modal.style.height || '';
    
    try {
        
        // 스크롤 영역을 전체 표시로 변경
        modalBody.style.overflow = 'visible';
        modalBody.style.maxHeight = 'none';
        modalBody.style.height = 'auto';
        modal.style.maxHeight = 'none';
        modal.style.height = 'auto';
        
        // 잠시 대기 (레이아웃 계산을 위해)
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 전체 높이 계산
        const fullHeight = modal.scrollHeight;
        
        const canvas = await html2canvas(modal, {
            backgroundColor: getComputedStyle(document.body).getPropertyValue('--bg-soft'),
            scale: 2,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
            logging: false,
            width: modal.scrollWidth,
            height: fullHeight,
            windowWidth: modal.scrollWidth,
            windowHeight: fullHeight
        });
        
        // 스타일 원복
        modalBody.style.overflow = originalOverflow;
        modalBody.style.maxHeight = originalMaxHeight;
        modalBody.style.height = originalHeight;
        modal.style.maxHeight = originalModalMaxHeight;
        modal.style.height = originalModalHeight;
        
        canvas.toBlob(async (blob) => {
            try {
                // 클립보드 API 사용 가능 여부 확인
                if (navigator.clipboard && window.ClipboardItem) {
                    await navigator.clipboard.write([
                        new ClipboardItem({'image/png': blob})
                    ]);
                    // console.log('모달 이미지가 클립보드에 복사되었습니다.');
                    showToast('클립보드에 이미지가 복사되었습니다!', 'success');
                } else {
                    // 대체 방법: 다운로드로 안내
                    // console.log('클립보드 API가 지원되지 않아 다운로드합니다.');
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `modal_copy_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('클립보드 복사가 지원되지 않아 이미지로 다운로드되었습니다.', 'error');
                }
            } catch (clipboardErr) {
                // console.error('클립보드 API 실패:', clipboardErr);
                // 실패 시 다운로드로 대체
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `modal_copy_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.png`;
                a.click();
                URL.revokeObjectURL(url);
                showToast('클립보드 복사 대신 이미지로 다운로드되었습니다.', 'error');
            }
        });
    } catch (err) {
        // console.error('모달 클립보드 복사 실패:', err);
        showToast('클립보드 복사에 실패했습니다.', 'error');
        // 스타일 원복
        modalBody.style.overflow = originalOverflow;
        modalBody.style.maxHeight = originalMaxHeight;
        modalBody.style.height = originalHeight;
        modal.style.maxHeight = originalModalMaxHeight;
        modal.style.height = originalModalHeight;
    }
};

setInterval(() => {
    const elapsed = getRuntimeSec();
    const total = getTotalDamage(singleMode);
    document.getElementById('runtime-text').textContent = `${elapsed.toFixed(2)}초`;
    document.getElementById('total-text').textContent = `${total.toLocaleString()}`;
    document.getElementById('total-dps-text').textContent = elapsed > 0 ? `${Math.round(total/elapsed).toLocaleString()}` : '0';
}, 500);

// ========== WebSocket 연결 관리 ==========
// IIFE 제거하여 전역 스코프에서 새로운 UI 기능 접근 가능하도록 함
let isWebSocketConnected = false;
let isReconnecting = false;  // 재연결 중 플래그 추가

// WebSocket 연결 상태 변경 핸들러
function onConnectionChanged(connected) {
    isWebSocketConnected = connected;
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
        // 재연결 중이면 무시
        if (reconnectInterval) return;
        
        // 모든 데이터 초기화
        clearDB();
        
        // 서버에 clear 명령 전송
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('clear');
            // UI 즉시 업데이트
            renderDamageRanks();
        } else {
            // 연결이 없으면 연결 후 clear
            connect();
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send('clear');
                }
            }, 100);
            // 새 연결 시 렌더링
            renderDamageRanks();
        }
        // 즉시 렌더링 제거 (재연결 후에만 렌더링)
    };

    // WebSocket 연결 함수
    function connect() {
        // 이미 연결 중이거나 연결되어 있으면 무시
        if (ws && (ws.readyState === WebSocket.CONNECTING || 
                   ws.readyState === WebSocket.OPEN)) {
            return;
        }
        
        ws = new WebSocket(wsUrl);

        // 연결 성공 이벤트
        ws.onopen = () => {
            onConnectionChanged(true);
            reconnectAttempts = 0; // 재연결 시도 횟수 초기화
            
            // 재연결 인터벌 정리
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
            
            // 페이지 로드/새로고침 시 자동 초기화
            clearDB();  // 클라이언트 데이터 초기화
            ws.send('clear');  // 서버에 초기화 명령
            renderDamageRanks();  // UI 업데이트
            console.log('WebSocket 연결 성공');
        };

        // 메시지 수신 이벤트 (서버로부터 데이터 받기)
        ws.onmessage = (event) => {
            try {
                const obj = JSON.parse(event.data);
                switch (obj.type) {
                    case "clear_confirmed":
                        // 서버에서 clear 확인 메시지
                        console.log('서버 데이터 초기화 완료');
                        break;
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
                        
                        // 서버 통계 데이터 저장
                        if (obj.data.stats) {
                            serverStats = obj.data.stats;
                        }
                        
                        // 새로운 통계 데이터 저장 (슬라이딩 DPS, 버프 공격력/데미지 등)
                        if (obj.data.stats) {
                            window.globalStats = obj.data.stats;
                        }
                        
                        // 데이터 수신 시간 업데이트
                        lastDataTime = Date.now();
                        
                        if (render_timeout) return;
                        render_timeout = setTimeout(() => {
                            renderDamageRanks();
                            updateUserDpsHistory();  // DPS 히스토리 업데이트
                            // 차트 업데이트는 별도 타이머로 관리 - 성능 최적화
                            if (!chartUpdateTimeout && isTabActive) {
                                chartUpdateTimeout = setTimeout(() => {
                                    updateDPSChart();
                                    chartUpdateTimeout = null;
                                }, 500); // 500ms로 조정 - 부드러운 실시간 업데이트
                            }
                            render_timeout = null;
                        }, 200);  // 200ms로 렌더링 주기 증가 - 성능 최적화    
                        break;
                }
            } catch (e) {
                // console.log("메시지 처리 오류:", e, event.data);
            }
        };

        // 연결 종료 이벤트
        ws.onclose = (event) => {
            onConnectionChanged(false);
            ws = null;
            
            // 정상 종료가 아니면 자동 재연결 시도
            if (event.code !== 1000 && event.code !== 1001) {
                console.log(`WebSocket 연결 종료 (코드: ${event.code}). 재연결 시도...`);
                startReconnect();
            } else {
                console.log('WebSocket 정상 종료');
            }
        };

        ws.onerror = (err) => {
            onConnectionChanged(false);
            console.error('WebSocket 오류:', err);
        };
    }

    // 자동 재연결 함수
    function startReconnect() {
        if (reconnectInterval) return; // 이미 재연결 중이면 무시
        
        reconnectInterval = setInterval(() => {
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.log('최대 재연결 시도 횟수 초과. 재연결 중단.');
                clearInterval(reconnectInterval);
                reconnectInterval = null;
                reconnectAttempts = 0;
                return;
            }
            
            reconnectAttempts++;
            console.log(`재연결 시도 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
            connect();
        }, RECONNECT_DELAY);
    }

    // 페이지 가시성 변경 감지 (탭 전환 시)
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
            console.log('페이지 활성화 - WebSocket 재연결 시도');
            connect();
        }
    });

    // 온라인/오프라인 상태 감지
    window.addEventListener('online', () => {
        console.log('네트워크 연결됨 - WebSocket 재연결 시도');
        connect();
    });

    window.addEventListener('offline', () => {
        console.log('네트워크 연결 끊김');
        if (ws) {
            ws.close();
        }
    });

    connect();
    
    // DOM 로드 완료 후 이벤트 설정
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setupEventListeners();
            // Chart.js 로딩 대기 후 초기화 준비
            setTimeout(() => {
                if (typeof Chart !== 'undefined' && window.ChartZoom) {
                    Chart.register(window.ChartZoom);
                    // console.log('Chart.js zoom 플러그인 등록 완료');
                }
            }, 100);
        });
    } else {
        setupEventListeners();
        // Chart.js 로딩 대기 후 초기화 준비
        setTimeout(() => {
            if (typeof Chart !== 'undefined' && window.ChartZoom) {
                Chart.register(window.ChartZoom);
                // console.log('Chart.js zoom 플러그인 등록 완료');
            }
        }, 100);
    }
    
    // ========== DOM 이벤트 리스너 설정 ==========
    // DOM이 완전히 로드된 후에 실행
    function setupEventListeners() {
        // 차트 컨트롤 버튼 이벤트
        const resetZoomBtn = document.getElementById('resetZoomBtn');
        if (resetZoomBtn) {
            resetZoomBtn.onclick = (event) => {
                try {
                    if (!dpsChart) {
                        console.warn('Chart not initialized');
                        return;
                    }
                    
                    // 차트 인스턴스와 zoom 플러그인 확인
                    if (!dpsChart.resetZoom || typeof dpsChart.resetZoom !== 'function') {
                        console.warn('Zoom plugin not available');
                        // 대체: 차트 업데이트로 시도
                        if (dpsChart.update) {
                            dpsChart.update();
                        }
                        return;
                    }
                    
                    // 안전하게 zoom 리셋
                    try {
                        dpsChart.resetZoom('default');
                    } catch (e) {
                        console.error('Error resetting zoom:', e);
                        // 대체: 차트 재렌더링
                        if (dpsChart.update) {
                            dpsChart.update();
                        }
                    }
                    
                    // UI 업데이트
                    resetZoomBtn.style.display = 'none';
                    const indicator = document.getElementById('zoomIndicator');
                    if (indicator) {
                        indicator.style.display = 'none';
                    }
                    
                    // 버튼 클릭 피드백
                    resetZoomBtn.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        resetZoomBtn.style.transform = 'scale(1)';
                    }, 100);
                } catch (error) {
                    console.error('Error in resetZoomBtn onclick:', error);
                }
            };
        }
        
        // 차트 최대 인원 설정
        const chartMaxUsers = document.getElementById('chartMaxUsers');
        if (chartMaxUsers) {
            // 저장된 값 불러오기
            const savedValue = localStorage.getItem('maxChartUsers');
            if (savedValue) {
                chartMaxUsers.value = savedValue;
            }
            
            chartMaxUsers.onchange = () => {
                localStorage.setItem('maxChartUsers', chartMaxUsers.value);
                // 차트 데이터 업데이트
                if (dpsChart) {
                    updateDPSChart();
                }
            };
        }
        
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
        
        // 토글 스위치 이벤트 - 다크모드 토글은 별도 처리하므로 제외
        document.querySelectorAll('.toggle-switch').forEach(toggle => {
            // 다크모드 토글은 아래에서 별도로 처리
            if (toggle.id === 'darkModeToggle') return;
            
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
        const savedAutoResetTime = parseInt(localStorage.getItem('autoResetTime')) || 60;
        
        const chartToggle = document.getElementById('chartToggle');
        const animationToggle = document.getElementById('animationToggle');
        const autoResetToggle = document.getElementById('autoResetToggle');
        const autoResetTimeInput = document.getElementById('autoResetTime');
        
        if (chartToggle) chartToggle.classList.toggle('active', chartEnabled);
        if (animationToggle) animationToggle.classList.toggle('active', animationEnabled);
        if (autoResetToggle) autoResetToggle.classList.toggle('active', autoResetEnabled);
        
        // 자동 초기화 시간 설정
        if (autoResetTimeInput) {
            autoResetTimeInput.value = savedAutoResetTime;
            autoResetTimeout = savedAutoResetTime * 1000;
            
            // 시간 변경 이벤트
            autoResetTimeInput.addEventListener('change', () => {
                let value = parseInt(autoResetTimeInput.value);
                if (value < 30) value = 30;
                if (value > 180) value = 180;
                autoResetTimeInput.value = value;
                autoResetTimeout = value * 1000;
                localStorage.setItem('autoResetTime', value);
                // console.log(`자동 초기화 시간 변경: ${value}초`);
            });
        }
        
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
        // 다크 모드 토글
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.onclick = () => {
                // 토글 상태 변경
                darkModeToggle.classList.toggle('active');
                
                // 변경된 상태 확인
                const isDarkMode = darkModeToggle.classList.contains('active');
                
                if (isDarkMode) {
                    // 다크 모드 활성화
                    document.body.removeAttribute('data-theme');
                    localStorage.setItem('darkMode', 'true');
                } else {
                    // 라이트 모드 활성화
                    document.body.setAttribute('data-theme', 'light');
                    localStorage.setItem('darkMode', 'false');
                }
            };
        }
        
        // 뷰 모드 변경 (select 요소 사용)
        const viewModeSelect = document.getElementById('viewModeSelect');
        if (viewModeSelect) {
            viewModeSelect.addEventListener('change', () => {
                viewMode = viewModeSelect.value;
                localStorage.setItem('viewMode', viewMode);
                // 렌더 해시를 리셋하여 강제로 다시 렌더링
                lastRenderHash = null;
                renderDamageRanks();
            });
        }
        
        // 저장된 설정 복원
        const savedDarkMode = localStorage.getItem('darkMode') !== 'false';
        const savedViewMode = localStorage.getItem('viewMode') || 'card';
        
        // 다크 모드 설정 복원
        if (darkModeToggle) {
            if (savedDarkMode) {
                darkModeToggle.classList.add('active');
                document.body.removeAttribute('data-theme');
            } else {
                darkModeToggle.classList.remove('active');
                document.body.setAttribute('data-theme', 'light');
            }
        }
        
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
    
    // 모달 외부 클릭 시 닫기
    const detailModal = document.getElementById('detailModal');
    if (detailModal) {
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) {
                closeDetailModal();
            }
        });
    }
    
    // 설정창 외부 클릭 시 닫기
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel) {
        // 설정창 외부 영역 클릭 감지를 위한 이벤트
        document.addEventListener('click', (e) => {
            if (settingsPanel.classList.contains('open')) {
                // 설정 버튼과 설정 패널 내부가 아닌 경우 닫기
                const settingsBtn = document.getElementById('settingsBtn');
                if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
                    settingsPanel.classList.remove('open');
                }
            }
        });
    }
    
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
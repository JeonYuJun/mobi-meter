/**
 * Mobi-Meter 이미지 캡처 시스템
 * 
 * CTO 레벨 재작성 - 모든 캡처 기능을 안정적이고 효율적으로 재구성
 * 
 * 주요 개선사항:
 * 1. 중복 코드 완전 제거
 * 2. 메모리 누수 방지
 * 3. 에러 처리 강화
 * 4. 성능 최적화
 */

// ========== 전역 변수 및 설정 ==========
const CAPTURE_CONFIG = {
    SCALE: 2,
    MAX_HEIGHT: 10000,
    BACKGROUND_COLOR: '#1a1a1a',
    ANIMATION_WAIT: 300,
    LAYOUT_WAIT: 200,
    CLEANUP_DELAY: 100,
    SCROLLBAR_WIDTH: 17
};

// html2canvas 로드 상태 관리
let html2canvasPromise = null;
let captureInProgress = false;

// ========== 유틸리티 함수 ==========

/**
 * html2canvas 라이브러리 로드
 * 싱글톤 패턴으로 중복 로드 방지
 */
async function ensureHtml2Canvas() {
    // 이미 로드되어 있으면 즉시 반환
    if (window.html2canvas && typeof window.html2canvas === 'function') {
        return true;
    }
    
    // 로드 중이면 기존 Promise 반환
    if (html2canvasPromise) {
        return html2canvasPromise;
    }
    
    // 새로운 로드 시작
    html2canvasPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.async = true;
        
        const timeout = setTimeout(() => {
            script.remove();
            html2canvasPromise = null;
            reject(new Error('html2canvas 로드 타임아웃'));
        }, 10000);
        
        script.onload = () => {
            clearTimeout(timeout);
            if (window.html2canvas && typeof window.html2canvas === 'function') {
                resolve(true);
            } else {
                script.remove();
                html2canvasPromise = null;
                reject(new Error('html2canvas 로드 실패'));
            }
        };
        
        script.onerror = () => {
            clearTimeout(timeout);
            script.remove();
            html2canvasPromise = null;
            reject(new Error('html2canvas 스크립트 로드 실패'));
        };
        
        document.head.appendChild(script);
    });
    
    try {
        return await html2canvasPromise;
    } catch (error) {
        html2canvasPromise = null;
        throw error;
    }
}

/**
 * 임시 canvas 및 DOM 요소 정리
 * 메모리 누수 방지를 위한 철저한 정리
 */
function cleanupCaptureArtifacts() {
    try {
        // html2canvas가 생성한 요소들 제거
        const tempElements = document.querySelectorAll(
            'canvas[data-html2canvas-canvas], ' +
            '[data-html2canvas-clone], ' +
            '.html2canvas-container'
        );
        
        tempElements.forEach(element => {
            try {
                // Canvas인 경우 메모리 해제
                if (element.tagName === 'CANVAS') {
                    const ctx = element.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, element.width, element.height);
                    }
                    element.width = 0;
                    element.height = 0;
                }
                
                // DOM에서 제거
                if (element.parentNode) {
                    element.parentNode.removeChild(element);
                }
            } catch (e) {
                console.warn('요소 정리 중 오류:', e);
            }
        });
        
        // ID나 클래스가 없는 임시 canvas 제거
        const orphanCanvases = document.querySelectorAll('canvas');
        orphanCanvases.forEach(canvas => {
            if (!canvas.id && !canvas.className && 
                canvas.id !== 'realtimeDPSChart' && 
                canvas.id !== 'miniDPSChart') {
                try {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                    canvas.width = 0;
                    canvas.height = 0;
                    if (canvas.parentNode) {
                        canvas.parentNode.removeChild(canvas);
                    }
                } catch (e) {
                    console.warn('임시 canvas 정리 중 오류:', e);
                }
            }
        });
    } catch (error) {
        console.error('캡처 아티팩트 정리 실패:', error);
    }
}

/**
 * 스타일 백업 및 복원 관리
 */
class StyleManager {
    constructor() {
        this.backups = new Map();
    }
    
    backup(element, properties) {
        const backup = {};
        properties.forEach(prop => {
            backup[prop] = element.style[prop] || '';
        });
        this.backups.set(element, backup);
        return backup;
    }
    
    restore(element) {
        const backup = this.backups.get(element);
        if (backup) {
            Object.entries(backup).forEach(([prop, value]) => {
                element.style[prop] = value;
            });
            this.backups.delete(element);
        }
    }
    
    restoreAll() {
        this.backups.forEach((backup, element) => {
            Object.entries(backup).forEach(([prop, value]) => {
                try {
                    element.style[prop] = value;
                } catch (e) {
                    console.warn('스타일 복원 실패:', e);
                }
            });
        });
        this.backups.clear();
    }
}

/**
 * 캡처 작업 관리자
 * 동시 캡처 방지 및 리소스 관리
 */
class CaptureManager {
    constructor() {
        this.isCapturing = false;
        this.styleManager = new StyleManager();
    }
    
    async capture(element, options = {}) {
        if (this.isCapturing) {
            throw new Error('이미 캡처가 진행 중입니다');
        }
        
        this.isCapturing = true;
        let canvas = null;
        
        try {
            // html2canvas 로드 확인
            await ensureHtml2Canvas();
            
            // 캡처 전 정리
            cleanupCaptureArtifacts();
            
            // 캡처 옵션 병합
            const captureOptions = {
                backgroundColor: CAPTURE_CONFIG.BACKGROUND_COLOR,
                scale: CAPTURE_CONFIG.SCALE,
                useCORS: true,
                logging: false,
                allowTaint: false,
                foreignObjectRendering: false,
                removeContainer: true,
                ...options
            };
            
            // 캡처 실행
            canvas = await window.html2canvas(element, captureOptions);
            
            // Blob 생성
            return await this.canvasToBlob(canvas);
            
        } finally {
            // 리소스 정리
            if (canvas) {
                try {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                    }
                    canvas.width = 0;
                    canvas.height = 0;
                } catch (e) {
                    console.warn('Canvas 정리 실패:', e);
                }
            }
            
            // 스타일 복원
            this.styleManager.restoreAll();
            
            // 캡처 상태 해제
            this.isCapturing = false;
            
            // 지연 정리
            setTimeout(() => {
                cleanupCaptureArtifacts();
            }, CAPTURE_CONFIG.CLEANUP_DELAY);
        }
    }
    
    canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob(
                blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Blob 생성 실패'));
                    }
                },
                'image/png'
            );
        });
    }
}

// ========== 메인 캡처 함수 ==========

const captureManager = new CaptureManager();

/**
 * 전체 화면 캡처 공통 함수
 */
async function captureFullScreen() {
    const container = document.querySelector('.container');
    if (!container) {
        throw new Error('캡처할 컨테이너를 찾을 수 없습니다');
    }
    
    const styleManager = captureManager.styleManager;
    const originalScrollY = window.scrollY;
    const originalBodyClass = document.body.className;
    
    try {
        // 스크린샷 모드 활성화
        document.body.classList.add('screenshot-mode');
        await new Promise(resolve => setTimeout(resolve, CAPTURE_CONFIG.ANIMATION_WAIT));
        
        // 스크롤 초기화
        window.scrollTo(0, 0);
        
        // 스크롤 영역 확장
        const scrollElements = container.querySelectorAll(
            '#damage-stats-list, .damage-cards-container, .damage-list-container'
        );
        
        scrollElements.forEach(el => {
            styleManager.backup(el, ['overflow', 'maxHeight', 'height']);
            el.style.overflow = 'visible';
            el.style.maxHeight = 'none';
            el.style.height = 'auto';
        });
        
        // 레이아웃 안정화 대기
        await new Promise(resolve => setTimeout(resolve, CAPTURE_CONFIG.LAYOUT_WAIT));
        
        // 캡처 실행
        const blob = await captureManager.capture(container, {
            height: container.scrollHeight,
            windowHeight: container.scrollHeight,
            scrollX: 0,
            scrollY: -window.scrollY,
            onclone: (clonedDoc) => {
                // 모달 그라디언트 제거
                const modal = clonedDoc.querySelector('#detailModal .modal-content');
                if (modal) {
                    modal.style.background = CAPTURE_CONFIG.BACKGROUND_COLOR;
                }
                
                // 0 크기 canvas 숨김
                const canvases = clonedDoc.querySelectorAll('canvas');
                canvases.forEach(canvas => {
                    if (canvas.width === 0 || canvas.height === 0) {
                        canvas.style.display = 'none';
                    }
                });
            }
        });
        
        return blob;
        
    } finally {
        // 복원
        styleManager.restoreAll();
        window.scrollTo(0, originalScrollY);
        document.body.classList.remove('screenshot-mode');
        document.body.className = originalBodyClass;
    }
}

/**
 * 모달 캡처 공통 함수
 */
async function captureModal() {
    const modal = document.querySelector('#detailModal .modal-content');
    const modalBody = document.querySelector('#detailModal .modal-body');
    
    if (!modal || !modalBody) {
        throw new Error('모달을 찾을 수 없습니다');
    }
    
    const styleManager = captureManager.styleManager;
    const originalBodyClass = document.body.className;
    
    try {
        // 스크린샷 모드 활성화
        document.body.classList.add('screenshot-mode');
        await new Promise(resolve => setTimeout(resolve, CAPTURE_CONFIG.ANIMATION_WAIT));
        
        // 모달 스타일 백업 및 확장
        styleManager.backup(modalBody, ['overflow', 'maxHeight', 'height']);
        styleManager.backup(modal, ['maxHeight', 'height']);
        
        modalBody.style.overflow = 'visible';
        modalBody.style.maxHeight = 'none';
        modalBody.style.height = 'auto';
        modal.style.maxHeight = 'none';
        modal.style.height = 'auto';
        
        // 레이아웃 안정화 대기
        await new Promise(resolve => setTimeout(resolve, CAPTURE_CONFIG.LAYOUT_WAIT));
        
        // 실제 콘텐츠 크기 계산
        const fullHeight = Math.min(modal.scrollHeight, CAPTURE_CONFIG.MAX_HEIGHT);
        const contentWidth = modalBody.scrollWidth;
        
        // padding 고려한 너비 계산
        const modalStyle = window.getComputedStyle(modal);
        const paddingLeft = parseFloat(modalStyle.paddingLeft) || 0;
        const paddingRight = parseFloat(modalStyle.paddingRight) || 0;
        const actualWidth = Math.max(
            contentWidth,
            modal.clientWidth - CAPTURE_CONFIG.SCROLLBAR_WIDTH
        );
        
        // 캡처 실행
        const blob = await captureManager.capture(modal, {
            width: actualWidth,
            height: fullHeight,
            windowWidth: actualWidth,
            windowHeight: fullHeight,
            ignoreElements: (element) => {
                // 불필요한 요소 제외
                if (element.tagName === 'CANVAS') return true;
                if (element.classList && element.classList.contains('chart-container')) return true;
                
                // gradient 가진 요소 제외
                const style = window.getComputedStyle(element);
                return style.backgroundImage && style.backgroundImage.includes('gradient');
            },
            onclone: (clonedDoc) => {
                // 모든 gradient 제거
                const allElements = clonedDoc.querySelectorAll('*');
                allElements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.backgroundImage?.includes('gradient') || 
                        style.background?.includes('gradient')) {
                        el.style.background = CAPTURE_CONFIG.BACKGROUND_COLOR;
                        el.style.backgroundImage = 'none';
                    }
                });
                
                // 모달 배경 단색 처리
                const clonedModal = clonedDoc.querySelector('#detailModal .modal-content');
                if (clonedModal) {
                    clonedModal.style.background = CAPTURE_CONFIG.BACKGROUND_COLOR;
                    clonedModal.style.backgroundImage = 'none';
                }
                
                // canvas 및 chart-container 제거
                clonedDoc.querySelectorAll('canvas, .chart-container').forEach(el => {
                    el.remove();
                });
            }
        });
        
        return blob;
        
    } finally {
        // 복원
        styleManager.restoreAll();
        document.body.classList.remove('screenshot-mode');
        document.body.className = originalBodyClass;
    }
}

/**
 * Blob를 다운로드하는 함수
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Blob를 클립보드에 복사하는 함수
 */
async function copyBlobToClipboard(blob) {
    if (navigator.clipboard && window.ClipboardItem) {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            return true;
        } catch (error) {
            console.warn('클립보드 복사 실패:', error);
            return false;
        }
    }
    return false;
}

// ========== 외부 인터페이스 함수 ==========

/**
 * 전체 화면 스크린샷 다운로드
 */
window.exportScreenshot = async () => {
    try {
        const blob = await captureFullScreen();
        const filename = `mobi-meter_${new Date().getTime()}.png`;
        downloadBlob(blob, filename);
        showToast('이미지가 다운로드되었습니다', 'success');
    } catch (error) {
        console.error('[Screenshot] 캡처 실패:', error);
        showToast(`이미지 캡처 실패: ${error.message}`, 'error');
    }
};

/**
 * 전체 화면 클립보드 복사
 */
window.copyToClipboard = async () => {
    try {
        const blob = await captureFullScreen();
        const copied = await copyBlobToClipboard(blob);
        
        if (copied) {
            showToast('이미지가 클립보드에 복사되었습니다!', 'success');
        } else {
            // 클립보드 실패 시 다운로드로 대체
            const filename = `mobi-meter-copy_${new Date().getTime()}.png`;
            downloadBlob(blob, filename);
            showToast('클립보드 복사가 지원되지 않아 다운로드되었습니다', 'warning');
        }
    } catch (error) {
        console.error('[Clipboard] 캡처 실패:', error);
        showToast('이미지 캡처에 실패했습니다', 'error');
    }
};

/**
 * 모달 스크린샷 다운로드
 */
window.exportModalScreenshot = async (event) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    try {
        const blob = await captureModal();
        const filename = `mobi-meter-detail_${new Date().getTime()}.png`;
        downloadBlob(blob, filename);
        showToast('모달 이미지가 다운로드되었습니다', 'success');
    } catch (error) {
        console.error('[Modal Screenshot] 캡처 실패:', error);
        showToast('모달 캡처에 실패했습니다', 'error');
    }
};

/**
 * 모달 클립보드 복사
 */
window.copyModalToClipboard = async (event) => {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    try {
        const blob = await captureModal();
        const copied = await copyBlobToClipboard(blob);
        
        if (copied) {
            showToast('클립보드에 이미지가 복사되었습니다!', 'success');
        } else {
            // 클립보드 실패 시 다운로드로 대체
            const filename = `modal-copy_${new Date().getTime()}.png`;
            downloadBlob(blob, filename);
            showToast('클립보드 복사가 지원되지 않아 다운로드되었습니다', 'warning');
        }
    } catch (error) {
        console.error('[Modal Clipboard] 캡처 실패:', error);
        showToast('클립보드 복사에 실패했습니다', 'error');
    }
};

// 초기화 시 정리 실행
document.addEventListener('DOMContentLoaded', () => {
    cleanupCaptureArtifacts();
});
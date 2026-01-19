import express, { Request, Response, Router } from 'express';
import { influxDB } from '../config/influx';
import { QueryApi } from '@influxdata/influxdb-client';

const org = process.env.INFLUX_ORG || 'jiaa';
const bucket = process.env.INFLUX_BUCKET || 'sensor_data';

// InfluxDB Query API
const queryApi: QueryApi = influxDB.getQueryApi(org);

export interface DailyStats {
    date: string;
    dayLabel: string;
    focusTime: number;
    sleepTime: number;
    awayTime: number;
    distractionTime: number;
    concentrationScore: number;
    phoneDetections: number;
    gazeOffCount: number;
    drowsyCount: number;
    gameCount: number;
}

export interface HourlyPattern {
    hour: number;
    avgConcentration: number;
    phoneUsage: number;
}

export interface WeekComparison {
    thisWeek: number;
    lastWeek: number;
    change: number;
}

const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

import { authMiddleware } from '../middleware/auth';

/**
 * UTC 시간을 한국 시간(KST, UTC+9)으로 변환
 */
function utcToKst(utcDate: Date): Date {
    return new Date(utcDate.getTime() + (9 * 60 * 60 * 1000));
}

/**
 * InfluxDB에서 주간 통계 조회
 */
async function getWeeklyStatsFromInflux(userId: string, weekOffset: number = 0): Promise<DailyStats[]> {
    const stats: DailyStats[] = [];

    // 날짜 범위 계산
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (weekOffset * 7));
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    
    console.log(`[Statistics] getWeeklyStatsFromInflux called: userId=${userId}, weekOffset=${weekOffset}`);
    console.log(`[Statistics] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Flux 쿼리: 일별 집계 (User ID 필터 추가)
    // Separate queries for score aggregation and game counting
    const scoreQuery = `
        from(bucket: "${bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "user_activity")
            |> filter(fn: (r) => r["user_id"] == "${userId}")
            |> filter(fn: (r) => r["_field"] == "score")
            |> aggregateWindow(every: 1d, fn: mean, createEmpty: true)
            |> yield(name: "daily_stats")
    `;
    
    const gameQuery = `
        from(bucket: "${bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "user_activity")
            |> filter(fn: (r) => r["user_id"] == "${userId}")
            |> filter(fn: (r) => r["category"] == "PLAY")
            |> aggregateWindow(every: 1d, fn: count, createEmpty: true)
            |> yield(name: "game_stats")
    `;

    try {
        const results: Map<string, any> = new Map();

        // 먼저 7일간의 빈 데이터 초기화
        for (let i = 6; i >= 0; i--) {
            const date = new Date(endDate);
            date.setDate(endDate.getDate() - i);
            const dateKey = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
            results.set(dateKey, {
                date: dateKey,
                dayLabel: DAYS_KR[date.getDay()],
                focusTime: 0,
                sleepTime: 0,
                awayTime: 0,
                distractionTime: 0,
                concentrationScore: 0,
                phoneDetections: 0,
                gazeOffCount: 0,
                drowsyCount: 0,
                gameCount: 0,
                scoreSum: 0,
                scoreCount: 0,
                focusTimeSum: 0,
                sleepTimeSum: 0,
                awayTimeSum: 0,
                distractionTimeSum: 0,
                phoneDetectionsSum: 0,
                gazeOffCountSum: 0,
                drowsyCountSum: 0
            });
        }

        // InfluxDB 쿼리 실행 - Score 데이터
        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(scoreQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                    const utcTime = new Date(data._time);
                    const kstTime = utcToKst(utcTime);
                    const dateKey = `${String(kstTime.getMonth() + 1).padStart(2, '0')}/${String(kstTime.getDate()).padStart(2, '0')}`;

                    const existing = results.get(dateKey);
                    if (existing && data._field === 'score' && data._value !== null) {
                        existing.scoreSum += data._value;
                        existing.scoreCount += 1;
                    }
                },
                error(error) {
                    console.error('[Statistics] InfluxDB Score Query Error:', error);
                    reject(error);
                },
                complete() {
                    resolve();
                }
            });
        });
        
        // InfluxDB 쿼리 실행 - 시간 추적 데이터 (focus_time_sec, sleep_time_sec, away_time_sec, distraction_time_sec)
        // distraction_time_sec이 증가하고 concentration_score가 낮을 때 phone detection으로 간주
        const timeFields = ['focus_time_sec', 'sleep_time_sec', 'away_time_sec', 'distraction_time_sec'];
        for (const field of timeFields) {
            const timeQuery = `
                from(bucket: "${bucket}")
                    |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
                    |> filter(fn: (r) => r["_measurement"] == "user_activity")
                    |> filter(fn: (r) => r["user_id"] == "${userId}")
                    |> filter(fn: (r) => r["_field"] == "${field}")
                    |> aggregateWindow(every: 1d, fn: sum, createEmpty: true)
            `;
            
            await new Promise<void>((resolve, reject) => {
                queryApi.queryRows(timeQuery, {
                    next(row, tableMeta) {
                        const data = tableMeta.toObject(row);
                        // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                        const utcTime = new Date(data._time);
                        const kstTime = utcToKst(utcTime);
                        const dateKey = `${String(kstTime.getMonth() + 1).padStart(2, '0')}/${String(kstTime.getDate()).padStart(2, '0')}`;

                        const existing = results.get(dateKey);
                        if (existing && data._value !== null) {
                            const value = data._value as number;
                            if (field === 'focus_time_sec') {
                                existing.focusTimeSum += value;
                            } else if (field === 'sleep_time_sec') {
                                existing.sleepTimeSum += value;
                            } else if (field === 'away_time_sec') {
                                existing.awayTimeSum += value;
                            } else if (field === 'distraction_time_sec') {
                                existing.distractionTimeSum += value;
                                // distraction_time_sec이 증가하면 phone detection 가능성 증가
                                // 웹캠에서 "PHONE DETECTED" 상태일 때 distraction_time이 증가함
                                // 단, 정확한 카운트를 위해서는 별도 쿼리가 필요하지만 여기서는 힌트만 제공
                            }
                        }
                    },
                    error(error) {
                        console.error(`[Statistics] InfluxDB ${field} Query Error:`, error);
                        // 시간 필드는 선택적이므로 에러가 나도 계속 진행
                        resolve();
                    },
                    complete() {
                        resolve();
                    }
                });
            });
        }

        // InfluxDB 쿼리 실행 - Game 카운트 (category == "PLAY")
        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(gameQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                    const utcTime = new Date(data._time);
                    const kstTime = utcToKst(utcTime);
                    const dateKey = `${String(kstTime.getMonth() + 1).padStart(2, '0')}/${String(kstTime.getDate()).padStart(2, '0')}`;

                    const existing = results.get(dateKey);
                    if (existing && data._value !== null) {
                        existing.gameCount += Math.round(data._value as number);
                    }
                },
                error(error) {
                    console.error('[Statistics] InfluxDB Game Query Error:', error);
                    // Don't reject - game count is optional
                    resolve();
                },
                complete() {
                    resolve();
                }
            });
        });

        // InfluxDB 쿼리 실행 - sleep_time_sec 필드로 졸음 카운트 (더 정확함)
        // sleep_time_sec가 0보다 큰 레코드는 졸음이 발생한 것으로 간주
        const sleepTimeQuery = `
            from(bucket: "${bucket}")
                |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
                |> filter(fn: (r) => r["_measurement"] == "user_activity")
                |> filter(fn: (r) => r["user_id"] == "${userId}")
                |> filter(fn: (r) => r["_field"] == "sleep_time_sec")
                |> filter(fn: (r) => exists r["_value"] and r["_value"] > 0)
        `;

        let sleepTimeCount = 0;
        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(sleepTimeQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    sleepTimeCount++;
                    // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                    const utcTime = new Date(data._time);
                    const kstTime = utcToKst(utcTime);
                    const dateKey = `${String(kstTime.getMonth() + 1).padStart(2, '0')}/${String(kstTime.getDate()).padStart(2, '0')}`;
                    const existing = results.get(dateKey);
                    
                    if (existing) {
                        // sleep_time_sec가 있으면 졸음 발생으로 카운트
                        existing.drowsyCount = (existing.drowsyCount || 0) + 1;
                    }
                },
                error(error) {
                    console.error('[Statistics] InfluxDB Sleep Time Query Error:', error);
                    resolve(); // Don't reject - optional
                },
                complete() {
                    console.log(`[Statistics] Sleep time query completed. Found ${sleepTimeCount} sleep records.`);
                    resolve();
                }
            });
        });

        // InfluxDB 쿼리 실행 - State 필드 값별 카운트 (gaze off)
        const stateQuery = `
            from(bucket: "${bucket}")
                |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
                |> filter(fn: (r) => r["_measurement"] == "user_activity")
                |> filter(fn: (r) => r["user_id"] == "${userId}")
                |> filter(fn: (r) => r["_field"] == "state")
        `;

        let stateCount = 0;
        let phoneFromStateCount = 0;
        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(stateQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    stateCount++;
                    // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                    const utcTime = new Date(data._time);
                    const kstTime = utcToKst(utcTime);
                    const dateKey = `${String(kstTime.getMonth() + 1).padStart(2, '0')}/${String(kstTime.getDate()).padStart(2, '0')}`;
                    const existing = results.get(dateKey);
                    
                    if (existing && data._value) {
                        const state = String(data._value).toUpperCase();
                        
                        // State별 카운트 집계 (SLEEPING은 이미 sleep_time_sec로 처리했으므로 제외)
                        if (state === 'DISTRACTED') {
                            existing.gazeOffCount = (existing.gazeOffCount || 0) + 1;
                        }
                        
                        // 웹캠에서 감지된 PHONE DETECTED 상태 카운트
                        if (state.includes('PHONE') || state === 'PHONE_DETECTED') {
                            existing.phoneDetections = (existing.phoneDetections || 0) + 1;
                            phoneFromStateCount++;
                        }
                    }
                },
                error(error) {
                    console.error('[Statistics] InfluxDB State Query Error:', error);
                    resolve(); // Don't reject - optional
                },
                complete() {
                    console.log(`[Statistics] State query completed. Processed ${stateCount} records, found ${phoneFromStateCount} phone detections from state field.`);
                    resolve();
                }
            });
        });

        // InfluxDB 쿼리 실행 - action_detail 필드에서 phone detection 찾기
        const actionDetailQuery = `
            from(bucket: "${bucket}")
                |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
                |> filter(fn: (r) => r["_measurement"] == "user_activity")
                |> filter(fn: (r) => r["user_id"] == "${userId}")
                |> filter(fn: (r) => r["_field"] == "action_detail")
        `;

        let actionDetailCount = 0;
        let phoneDetectionsFound = 0;
        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(actionDetailQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    actionDetailCount++;
                    // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                    const utcTime = new Date(data._time);
                    const kstTime = utcToKst(utcTime);
                    const dateKey = `${String(kstTime.getMonth() + 1).padStart(2, '0')}/${String(kstTime.getDate()).padStart(2, '0')}`;
                    const existing = results.get(dateKey);
                    
                    if (existing && data._value) {
                        const actionDetail = String(data._value).toLowerCase();
                        
                        // Phone 관련 앱/웹사이트 감지 및 웹캠에서 감지된 PHONE DETECTED 상태
                        const phoneKeywords = ['phone', 'iphone', 'android', 'mobile', 'whatsapp', 'kakao', 'line', 'messenger', 'telegram', 'instagram', 'facebook', 'tiktok', 'snapchat', 'phone detected', 'phone_detected'];
                        if (phoneKeywords.some(keyword => actionDetail.includes(keyword))) {
                            existing.phoneDetections = (existing.phoneDetections || 0) + 1;
                            phoneDetectionsFound++;
                        }
                    }
                },
                error(error) {
                    console.error('[Statistics] InfluxDB Action Detail Query Error:', error);
                    resolve(); // Don't reject - optional
                },
                complete() {
                    console.log(`[Statistics] Action detail query completed. Processed ${actionDetailCount} records, found ${phoneDetectionsFound} phone detections.`);
                    resolve();
                }
            });
        });

        // 결과 정리
        let totalRecords = 0;
        for (const [, value] of results) {
            totalRecords++;
            const avgScore = value.scoreCount > 0 ? Math.round(value.scoreSum / value.scoreCount) : 0; // 데이터 없으면 0점

            // 실제 시간 데이터 사용 (초 -> 분 변환)
            const focusTimeMin = Math.round((value.focusTimeSum || 0) / 60);
            const sleepTimeMin = Math.round((value.sleepTimeSum || 0) / 60);
            const awayTimeMin = Math.round((value.awayTimeSum || 0) / 60);
            const distractionTimeMin = Math.round((value.distractionTimeSum || 0) / 60);

            const finalStats = {
                date: value.date,
                dayLabel: value.dayLabel,
                focusTime: focusTimeMin,
                sleepTime: sleepTimeMin,
                awayTime: awayTimeMin,
                distractionTime: distractionTimeMin,
                concentrationScore: avgScore,
                phoneDetections: value.phoneDetections || 0,
                gazeOffCount: value.gazeOffCount || 0,
                drowsyCount: value.drowsyCount || 0,
                gameCount: value.gameCount || 0
            };
            
            // 디버깅: 모든 날짜의 통계 로그 (데이터가 있는 경우만)
            if (value.scoreCount > 0 || value.focusTimeSum > 0 || value.sleepTimeSum > 0 || 
                value.awayTimeSum > 0 || value.distractionTimeSum > 0 || 
                finalStats.phoneDetections > 0 || finalStats.gazeOffCount > 0 || 
                finalStats.drowsyCount > 0 || finalStats.gameCount > 0) {
                console.log(`[Statistics] ${value.date} (${value.dayLabel}) stats:`, {
                    score: `${avgScore} (${value.scoreCount} records)`,
                    focus: `${focusTimeMin}min (${value.focusTimeSum}s)`,
                    sleep: `${sleepTimeMin}min (${value.sleepTimeSum}s)`,
                    away: `${awayTimeMin}min`,
                    distraction: `${distractionTimeMin}min`,
                    phone: finalStats.phoneDetections,
                    drowsy: finalStats.drowsyCount,
                    gaze: finalStats.gazeOffCount,
                    game: finalStats.gameCount
                });
            }
            
            stats.push(finalStats);
        }

        console.log(`[Statistics] Processed ${totalRecords} days. Total stats entries: ${stats.length}`);
        console.log(`[Statistics] Summary:`, {
            totalFocusTime: stats.reduce((sum, s) => sum + s.focusTime, 0),
            totalSleepTime: stats.reduce((sum, s) => sum + s.sleepTime, 0),
            totalPhoneDetections: stats.reduce((sum, s) => sum + s.phoneDetections, 0),
            totalDrowsyCount: stats.reduce((sum, s) => sum + s.drowsyCount, 0),
            totalGazeOffCount: stats.reduce((sum, s) => sum + s.gazeOffCount, 0),
            totalGameCount: stats.reduce((sum, s) => sum + s.gameCount, 0)
        });

        return stats;
    } catch (error) {
        console.error('[Statistics] Failed to query InfluxDB:', error);
        return generateFallbackWeeklyStats(weekOffset);
    }
}

/**
 * 에러 발생 시 빈 주간 통계 데이터 생성
 */
function generateFallbackWeeklyStats(weekOffset: number = 0): DailyStats[] {
    const stats: DailyStats[] = [];
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (weekOffset * 7));

    for (let i = 6; i >= 0; i--) {
        const date = new Date(endDate);
        date.setDate(endDate.getDate() - i);

        stats.push({
            date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
            dayLabel: DAYS_KR[date.getDay()],
            focusTime: 0,
            sleepTime: 0,
            awayTime: 0,
            distractionTime: 0,
            concentrationScore: 0,
            phoneDetections: 0,
            gazeOffCount: 0,
            drowsyCount: 0,
            gameCount: 0
        });
    }

    return stats;
}

/**
 * 시간대별 패턴 조회
 */
async function getHourlyPatternsFromInflux(userId: string): Promise<HourlyPattern[]> {
    const patterns: HourlyPattern[] = [];

    // User ID 필터 추가
    const fluxQuery = `
        from(bucket: "${bucket}")
            |> range(start: -7d)
            |> filter(fn: (r) => r["_measurement"] == "user_activity")
            |> filter(fn: (r) => r["user_id"] == "${userId}")
            |> filter(fn: (r) => r["_field"] == "score")
            |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
            |> group(columns: ["_time"])
    `;

    try {
        const hourlyData: Map<number, { sum: number; count: number }> = new Map();

        // 9시~18시 초기화
        for (let h = 9; h <= 18; h++) {
            hourlyData.set(h, { sum: 0, count: 0 });
        }

        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    // InfluxDB는 UTC로 시간을 저장하므로, 한국 시간(KST, UTC+9)으로 변환
                    const utcTime = new Date(data._time);
                    const kstTime = utcToKst(utcTime);
                    const hour = kstTime.getHours();

                    if (hour >= 9 && hour <= 18 && data._value !== null) {
                        const existing = hourlyData.get(hour);
                        if (existing) {
                            existing.sum += data._value;
                            existing.count += 1;
                        }
                    }
                },
                error(error) {
                    console.error('[Statistics] Hourly Query Error:', error);
                    reject(error);
                },
                complete() {
                    resolve();
                }
            });
        });

        for (let hour = 9; hour <= 18; hour++) {
            const data = hourlyData.get(hour)!;
            const avgConcentration = data.count > 0 ? Math.round(data.sum / data.count) : 0;

            patterns.push({
                hour,
                avgConcentration,
                phoneUsage: 0
            });
        }

        return patterns;
    } catch (error) {
        console.error('[Statistics] Failed to get hourly patterns:', error);
        return generateFallbackHourlyPatterns();
    }
}

/**
 * 에러 발생 시 빈 시간대별 패턴 데이터 생성
 */
function generateFallbackHourlyPatterns(): HourlyPattern[] {
    const patterns: HourlyPattern[] = [];

    for (let hour = 9; hour <= 18; hour++) {
        patterns.push({
            hour,
            avgConcentration: 0,
            phoneUsage: 0
        });
    }

    return patterns;
}


/**
 * Express 라우터 생성
 */
export function createStatisticsRouter(): Router {
    const router = Router();

    // 모든 라우트에 인증 미들웨어 적용
    router.use(authMiddleware);

    // 주간 통계 조회
    router.get('/weekly', async (req: Request, res: Response) => {
        try {
            if (!req.user) throw new Error("User context missing");
            const userId = String(req.user.id); // JWT에서 추출한 ID를 사용
            const weekOffset = parseInt(req.query.weekOffset as string) || 0;
            const stats = await getWeeklyStatsFromInflux(userId, weekOffset);
            res.json({ success: true, data: stats });
        } catch (error) {
            console.error('[Statistics API] Weekly stats error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch weekly stats' });
        }
    });

    // 시간대별 패턴 조회
    router.get('/hourly', async (req: Request, res: Response) => {
        try {
            if (!req.user) throw new Error("User context missing");
            const userId = String(req.user.id);
            const patterns = await getHourlyPatternsFromInflux(userId);
            res.json({ success: true, data: patterns });
        } catch (error) {
            console.error('[Statistics API] Hourly patterns error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch hourly patterns' });
        }
    });

    // 주간 비교 데이터
    router.get('/comparison', async (req: Request, res: Response) => {
        try {
            if (!req.user) throw new Error("User context missing");
            const userId = String(req.user.id);

            const thisWeekStats = await getWeeklyStatsFromInflux(userId, 0);
            const lastWeekStats = await getWeeklyStatsFromInflux(userId, -1);

            const thisWeekTotal = thisWeekStats.reduce((sum, s) => sum + s.focusTime, 0);
            const lastWeekTotal = lastWeekStats.reduce((sum, s) => sum + s.focusTime, 0);
            const change = lastWeekTotal > 0
                ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100
                : 0;

            const comparison: WeekComparison = {
                thisWeek: thisWeekTotal,
                lastWeek: lastWeekTotal,
                change: Math.round(change * 10) / 10
            };

            res.json({ success: true, data: comparison });
        } catch (error) {
            console.error('[Statistics API] Comparison error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch comparison data' });
        }
    });

    // 전체 통계 (한 번에 모든 데이터 조회)
    router.get('/all', async (req: Request, res: Response) => {
        try {
            if (!req.user) throw new Error("User context missing");
            let userId = String(req.user.id);
            
            console.log(`[Statistics API] /all requested by user: ${userId}`);
            
            // InfluxDB에서 가장 최근에 데이터가 있는 user_id 찾기
            // JWT의 UUID와 InfluxDB의 client_id가 다를 수 있으므로
            const findMostRecentUserId = async (): Promise<string> => {
                const query = `
                    from(bucket: "${bucket}")
                        |> range(start: -7d)
                        |> filter(fn: (r) => r["_measurement"] == "user_activity")
                        |> group(columns: ["user_id"])
                        |> count()
                        |> sort(columns: ["_value"], desc: true)
                        |> limit(n: 1)
                `;
                
                return new Promise<string>((resolve, reject) => {
                    let foundUserId = userId; // 기본값
                    queryApi.queryRows(query, {
                        next(row, tableMeta) {
                            const data = tableMeta.toObject(row);
                            if (data.user_id) {
                                foundUserId = String(data.user_id);
                            }
                        },
                        error(error) {
                            console.error('[Statistics] Error finding user_id:', error);
                            resolve(userId); // 에러 시 원본 사용
                        },
                        complete() {
                            console.log(`[Statistics API] Using user_id: ${foundUserId} (requested: ${userId})`);
                            resolve(foundUserId);
                        }
                    });
                });
            };
            
            // 가장 최근에 데이터가 있는 user_id 사용
            userId = await findMostRecentUserId();

            const [thisWeekStats, lastWeekStats, hourlyPatterns] = await Promise.all([
                getWeeklyStatsFromInflux(userId, 0),
                getWeeklyStatsFromInflux(userId, -1),
                getHourlyPatternsFromInflux(userId)
            ]);

            console.log(`[Statistics API] Fetched stats for user ${userId}:`);
            console.log(`  - This week: ${thisWeekStats.length} days`);
            console.log(`  - Last week: ${lastWeekStats.length} days`);
            console.log(`  - Hourly patterns: ${hourlyPatterns.length} hours`);
            
            // 첫 번째 날짜의 데이터 샘플 로그
            if (thisWeekStats.length > 0) {
                const sample = thisWeekStats[0];
                console.log(`[Statistics API] Sample day (${sample.date}):`, {
                    focusTime: sample.focusTime,
                    sleepTime: sample.sleepTime,
                    distractionTime: sample.distractionTime,
                    phoneDetections: sample.phoneDetections,
                    drowsyCount: sample.drowsyCount,
                    gazeOffCount: sample.gazeOffCount,
                    gameCount: sample.gameCount
                });
            }

            const thisWeekTotal = thisWeekStats.reduce((sum, s) => sum + s.focusTime, 0);
            const lastWeekTotal = lastWeekStats.reduce((sum, s) => sum + s.focusTime, 0);
            const change = lastWeekTotal > 0
                ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100
                : 0;

            const response = {
                success: true,
                data: {
                    weeklyStats: thisWeekStats,
                    hourlyPatterns,
                    weekComparison: {
                        thisWeek: thisWeekTotal,
                        lastWeek: lastWeekTotal,
                        change: Math.round(change * 10) / 10
                    }
                }
            };
            
            console.log(`[Statistics API] Response prepared. Total focus time this week: ${thisWeekTotal} minutes`);
            
            res.json(response);
        } catch (error) {
            console.error('[Statistics API] All stats error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch all stats', details: String(error) });
        }
    });

    return router;
}

import cors from 'cors';

/**
 * Express 서버 시작
 */
export function startExpressServer(port: number = 3001): void {
    const app = express();

    app.use(express.json());
    app.use(cors()); // Enable CORS for Client Access

    // 헬스체크
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', service: 'statistics-api' });
    });

    // 통계 API 라우터
    app.use('/api/stats', createStatisticsRouter());

    app.listen(port, () => {
        console.log(`📊 Statistics API Server running on http://localhost:${port}`);
        console.log(`   - GET /api/stats/weekly?weekOffset=0`);
        console.log(`   - GET /api/stats/hourly`);
        console.log(`   - GET /api/stats/comparison`);
        console.log(`   - GET /api/stats/all`);
    });
}

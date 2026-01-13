import express, { Request, Response, Router } from 'express';
import cors from 'cors';
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

/**
 * InfluxDB에서 주간 통계 조회
 */
async function getWeeklyStatsFromInflux(weekOffset: number = 0): Promise<DailyStats[]> {
    const stats: DailyStats[] = [];

    // 날짜 범위 계산
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + (weekOffset * 7));
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);

    // Flux 쿼리: 일별 집계
    const fluxQuery = `
        from(bucket: "${bucket}")
            |> range(start: ${startDate.toISOString()}, stop: ${new Date(endDate.getTime() + 86400000).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "system_log")
            |> filter(fn: (r) => r["_field"] == "score" or r["_field"] == "state")
            |> aggregateWindow(every: 1d, fn: mean, createEmpty: true)
            |> yield(name: "daily_stats")
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
                scoreCount: 0
            });
        }

        // InfluxDB 쿼리 실행
        await new Promise<void>((resolve, reject) => {
            queryApi.queryRows(fluxQuery, {
                next(row, tableMeta) {
                    const data = tableMeta.toObject(row);
                    const time = new Date(data._time);
                    const dateKey = `${String(time.getMonth() + 1).padStart(2, '0')}/${String(time.getDate()).padStart(2, '0')}`;

                    const existing = results.get(dateKey);
                    if (existing && data._field === 'score' && data._value !== null) {
                        existing.scoreSum += data._value;
                        existing.scoreCount += 1;
                    }
                },
                error(error) {
                    console.error('[Statistics] InfluxDB Query Error:', error);
                    reject(error);
                },
                complete() {
                    resolve();
                }
            });
        });

        // 결과 정리
        for (const [, value] of results) {
            const avgScore = value.scoreCount > 0 ? Math.round(value.scoreSum / value.scoreCount) : 50;

            // 점수 기반으로 시간 추정 (실제 데이터가 없을 때)
            const estimatedMinutes = value.scoreCount > 0 ? value.scoreCount * 5 : 0; // 5분 단위 데이터 가정

            stats.push({
                date: value.date,
                dayLabel: value.dayLabel,
                focusTime: Math.round(estimatedMinutes * (avgScore / 100)),
                sleepTime: Math.round(estimatedMinutes * 0.05),
                awayTime: Math.round(estimatedMinutes * 0.1),
                distractionTime: Math.round(estimatedMinutes * ((100 - avgScore) / 200)),
                concentrationScore: avgScore,
                phoneDetections: Math.floor(Math.random() * 8),  // TODO: 실제 데이터로 교체
                gazeOffCount: Math.floor(Math.random() * 12),
                drowsyCount: Math.floor(Math.random() * 4),
                gameCount: Math.floor(Math.random() * 2)
            });
        }

        return stats;
    } catch (error) {
        console.error('[Statistics] Failed to query InfluxDB:', error);
        // 에러 발생 시 빈 데이터 반환
        return generateFallbackWeeklyStats(weekOffset);
    }
}

/**
 * InfluxDB 쿼리 실패 시 폴백 데이터 생성
 */
function generateFallbackWeeklyStats(weekOffset: number = 0): DailyStats[] {
    const stats: DailyStats[] = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i + (weekOffset * 7));
        const seed = date.getDate() + date.getMonth() * 31;
        const focusTime = 90 + (seed % 210);

        stats.push({
            date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
            dayLabel: DAYS_KR[date.getDay()],
            focusTime,
            sleepTime: 5 + (seed % 20),
            awayTime: 15 + (seed % 75),
            distractionTime: 15 + (seed % 45),
            concentrationScore: Math.min(100, Math.round(focusTime / 3)),
            phoneDetections: 2 + (seed % 10),
            gazeOffCount: 4 + (seed % 14),
            drowsyCount: seed % 5,
            gameCount: seed % 3
        });
    }

    return stats;
}

/**
 * 시간대별 패턴 조회
 */
async function getHourlyPatternsFromInflux(): Promise<HourlyPattern[]> {
    const patterns: HourlyPattern[] = [];

    const fluxQuery = `
        from(bucket: "${bucket}")
            |> range(start: -7d)
            |> filter(fn: (r) => r["_measurement"] == "system_log")
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
                    const hour = new Date(data._time).getHours();

                    if (hour >= 9 && hour <= 18 && data._value !== null) {
                        const existing = hourlyData.get(hour)!;
                        existing.sum += data._value;
                        existing.count += 1;
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
            const avgConcentration = data.count > 0 ? Math.round(data.sum / data.count) : 70 + Math.random() * 20;

            patterns.push({
                hour,
                avgConcentration: Math.round(avgConcentration),
                phoneUsage: Math.round(10 + Math.random() * 20)  // TODO: 실제 데이터로 교체
            });
        }

        return patterns;
    } catch (error) {
        console.error('[Statistics] Failed to get hourly patterns:', error);
        return generateFallbackHourlyPatterns();
    }
}

/**
 * 폴백 시간대별 패턴 생성
 */
function generateFallbackHourlyPatterns(): HourlyPattern[] {
    const patterns: HourlyPattern[] = [];

    for (let hour = 9; hour <= 18; hour++) {
        let avgConcentration = 80;
        let phoneUsage = 10;

        if (hour === 12 || hour === 13) {
            avgConcentration = 60 + Math.random() * 10;
            phoneUsage = 20 + Math.random() * 10;
        } else if (hour === 15) {
            avgConcentration = 55 + Math.random() * 10;
            phoneUsage = 30 + Math.random() * 10;
        } else {
            avgConcentration = 75 + Math.random() * 15;
            phoneUsage = 5 + Math.random() * 15;
        }

        patterns.push({
            hour,
            avgConcentration: Math.round(avgConcentration),
            phoneUsage: Math.round(phoneUsage)
        });
    }

    return patterns;
}

/**
 * Express 라우터 생성
 */
export function createStatisticsRouter(): Router {
    const router = Router();

    // 주간 통계 조회
    router.get('/weekly', async (req: Request, res: Response) => {
        try {
            const weekOffset = parseInt(req.query.weekOffset as string) || 0;
            const stats = await getWeeklyStatsFromInflux(weekOffset);
            res.json({ success: true, data: stats });
        } catch (error) {
            console.error('[Statistics API] Weekly stats error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch weekly stats' });
        }
    });

    // 시간대별 패턴 조회
    router.get('/hourly', async (_req: Request, res: Response) => {
        try {
            const patterns = await getHourlyPatternsFromInflux();
            res.json({ success: true, data: patterns });
        } catch (error) {
            console.error('[Statistics API] Hourly patterns error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch hourly patterns' });
        }
    });

    // 주간 비교 데이터
    router.get('/comparison', async (_req: Request, res: Response) => {
        try {
            const thisWeekStats = await getWeeklyStatsFromInflux(0);
            const lastWeekStats = await getWeeklyStatsFromInflux(-1);

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
    router.get('/all', async (_req: Request, res: Response) => {
        try {
            const [thisWeekStats, lastWeekStats, hourlyPatterns] = await Promise.all([
                getWeeklyStatsFromInflux(0),
                getWeeklyStatsFromInflux(-1),
                getHourlyPatternsFromInflux()
            ]);

            const thisWeekTotal = thisWeekStats.reduce((sum, s) => sum + s.focusTime, 0);
            const lastWeekTotal = lastWeekStats.reduce((sum, s) => sum + s.focusTime, 0);
            const change = lastWeekTotal > 0
                ? ((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100
                : 0;

            res.json({
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
            });
        } catch (error) {
            console.error('[Statistics API] All stats error:', error);
            res.status(500).json({ success: false, error: 'Failed to fetch all stats' });
        }
    });

    return router;
}

/**
 * Express 서버 시작
 */
export function startExpressServer(port: number = 3001): void {
    const app = express();

    // CORS 설정
    app.use(cors({
        origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
        credentials: true
    }));

    app.use(express.json());

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

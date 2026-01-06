import * as fs from 'fs';
import * as path from 'path';

interface UserProfileData {
    avgCodingEntropy: number;
    lastUpdated: string;
}

export class UserProfile {
    // 사용자의 평소 코딩 습관 (초기값: 표준 코딩 패턴 4.0)
    private avgCodingEntropy: number = 4.0;

    // 학습률 (0.05 = 새로운 데이터를 5%씩 반영)
    // 노이즈에 강하게 하기 위해 보수적으로 설정
    private static readonly LEARNING_RATE: number = 0.05;

    constructor(data?: UserProfileData) {
        if (data) {
            this.avgCodingEntropy = data.avgCodingEntropy;
        }
    }

    /**
     * 사용자가 "코딩 중(Focusing)"일 때 호출되어 기준값을 업데이트함 (EMA)
     */
    public adaptThreshold(currentEntropy: number): void {
        // 학습 조건 유효성 체크 (너무 낮은 엔트로피는 코딩이 아닐 수 있음)
        if (currentEntropy < 1.0 || currentEntropy > 6.0) return;

        const oldVal = this.avgCodingEntropy;

        // 1. EMA로 사용자의 '평소 엔트로피' 업데이트
        this.avgCodingEntropy = (currentEntropy * UserProfile.LEARNING_RATE)
            + (this.avgCodingEntropy * (1.0 - UserProfile.LEARNING_RATE));

        // 로그 (디버깅용)
        // console.log(`[Profile] Updated Baseline: ${oldVal.toFixed(2)} -> ${this.avgCodingEntropy.toFixed(2)} (Input: ${currentEntropy})`);
    }

    /**
     * 현재 사용자에 딱 맞는 '게임 판별 커트라인' 반환
     */
    public getPersonalizedGameThreshold(): number {
        // 공식: 평소 코딩 엔트로피에서 "여유분"을 뺀 값을 기준선으로 잡음
        // Java 예시: -1.5 (표준편차 3배 가정)
        // 예: 평소 4.0 -> 기준 2.5 (표준)
        // 예: 평소 3.0 (고수) -> 기준 1.5 (게임 기준 완화)

        const dynamicThreshold = this.avgCodingEntropy - 1.5;

        // 안전장치: 아무리 학습해도 1.5 밑으로 내려가거나 3.5 위로 올라가면 안됨
        return Math.max(1.5, Math.min(dynamicThreshold, 3.5));
    }

    public toJSON(): UserProfileData {
        return {
            avgCodingEntropy: this.avgCodingEntropy,
            lastUpdated: new Date().toISOString()
        };
    }
}

export class UserProfileManager {
    private static instance: UserProfileManager;
    private profiles: Map<string, UserProfile> = new Map();
    // Save to 'data' directory for cleaner volume mounting
    private filePath: string = path.join(__dirname, '../../data/profiles.json');

    private constructor() {
        this.load();
    }

    public static getInstance(): UserProfileManager {
        if (!UserProfileManager.instance) {
            UserProfileManager.instance = new UserProfileManager();
        }
        return UserProfileManager.instance;
    }

    public getProfile(userId: string): UserProfile {
        if (!this.profiles.has(userId)) {
            this.profiles.set(userId, new UserProfile());
        }
        return this.profiles.get(userId)!;
    }

    public save(): void {
        const data: { [key: string]: UserProfileData } = {};
        this.profiles.forEach((profile, key) => {
            data[key] = profile.toJSON();
        });

        try {
            // Ensure directory exists
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
        } catch (e) {
            console.error("[Profile] Failed to save profiles:", e);
        }
    }

    private load(): void {
        if (fs.existsSync(this.filePath)) {
            try {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const data = JSON.parse(raw);
                for (const key in data) {
                    this.profiles.set(key, new UserProfile(data[key]));
                }
                console.log(`[Profile] Loaded ${this.profiles.size} profiles.`);
            } catch (e) {
                console.error("[Profile] Failed to load profiles:", e);
            }
        }
    }
}

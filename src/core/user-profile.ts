import { redis } from '../config/redis';

interface UserProfileData {
    avgCodingEntropy: number;
    lastUpdated: string;
}

export class UserProfile {
    // 사용자의 평소 코딩 습관 (초기값: 표준 코딩 패턴 4.0)
    private avgCodingEntropy: number = 4.0;

    // 학습률 (0.05 = 새로운 데이터를 5%씩 반영)
    private static readonly LEARNING_RATE: number = 0.05;

    constructor(data?: UserProfileData) {
        if (data) {
            this.avgCodingEntropy = data.avgCodingEntropy;
        }
    }

    public adaptThreshold(currentEntropy: number): void {
        if (currentEntropy < 1.0 || currentEntropy > 6.0) return;

        const oldVal = this.avgCodingEntropy;
        this.avgCodingEntropy = (currentEntropy * UserProfile.LEARNING_RATE)
            + (this.avgCodingEntropy * (1.0 - UserProfile.LEARNING_RATE));

        // Note: We don't save per update here to avoid spamming Redis. 
        // Manager should handle saving, or we make this async and save immediately.
        // ideally, the Manager saves periodically or we save after update.
        // determining strategy: Save immediately for simplicity.
    }

    public getPersonalizedGameThreshold(): number {
        const dynamicThreshold = this.avgCodingEntropy - 1.5;
        return Math.max(1.5, Math.min(dynamicThreshold, 3.5));
    }

    public toJSON(): UserProfileData {
        return {
            avgCodingEntropy: this.avgCodingEntropy,
            lastUpdated: new Date().toISOString()
        };
    }

    public getEntropy(): number {
        return this.avgCodingEntropy;
    }
}

export class UserProfileManager {
    private static instance: UserProfileManager;
    private profiles: Map<string, UserProfile> = new Map();
    private static readonly REDIS_PREFIX = "jiaa:profile:";

    private constructor() {
        // Initial load not strictly necessary as we load on demand
        console.log("[UserProfileManager] Initialized with Redis");
    }

    public static getInstance(): UserProfileManager {
        if (!UserProfileManager.instance) {
            UserProfileManager.instance = new UserProfileManager();
        }
        return UserProfileManager.instance;
    }

    public async getProfile(userId: string): Promise<UserProfile> {
        if (this.profiles.has(userId)) {
            return this.profiles.get(userId)!;
        }

        // Try load from Redis
        const key = `${UserProfileManager.REDIS_PREFIX}${userId}`;
        try {
            const raw = await redis.get(key);
            if (raw) {
                const data = JSON.parse(raw);
                const profile = new UserProfile(data);
                this.profiles.set(userId, profile);
                console.log(`[Profile] Loaded from Redis for ${userId}`);
                return profile;
            }
        } catch (e) {
            console.error(`[Profile] Redis Load Error for ${userId}:`, e);
        }

        // Return new if not found
        const newProfile = new UserProfile();
        this.profiles.set(userId, newProfile);
        return newProfile;
    }

    public async saveProfile(userId: string): Promise<void> {
        const profile = this.profiles.get(userId);
        if (!profile) return;

        const key = `${UserProfileManager.REDIS_PREFIX}${userId}`;
        const data = JSON.stringify(profile.toJSON());

        try {
            await redis.set(key, data);
            // console.log(`[Profile] Saved to Redis for ${userId}`);
        } catch (e) {
            console.error(`[Profile] Redis Save Error for ${userId}:`, e);
        }
    }
}

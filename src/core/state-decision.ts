import { SystemLogRequest } from './scoring-engine';
import { UserProfileManager } from './user-profile';

// Enum mirroring common/score.proto
export enum UserState {
    NORMAL = 0,
    FOCUSING = 1,
    DISTRACTED = 2,
    SLEEPING = 3,
    AFK = 4,
    EMERGENCY = 5,
    GAMING = 6
}

export class StateDecisionMaker {
    public static async determineState(score: number, data: SystemLogRequest): Promise<UserState> {
        if (data.is_emergency) {
            return UserState.EMERGENCY;
        }

        // 1. Game Detection Logic (Priority High)
        // A. Title Based
        if (data.window_title) {
            const gameTitles = ["League of Legends", "Overwatch", "Battlegrounds", "Minecraft", "Roblox"];
            if (gameTitles.some(t => data.window_title!.includes(t))) {
                return UserState.GAMING;
            }
        }

        const totalActivity = data.keystroke_count + data.click_count;

        // B. Idle Handling (Zero Handling) - User Req #2
        // If activity is very low, do not apply Game Logic (Except Dragging/Explicit Title)
        if (totalActivity < 3 && data.mouse_distance < 100) {
            // Not enough data to judge -> Normal/Idle
            return UserState.NORMAL;
        }

        // C. Click Spamming (FPS/AOS Pattern) - User Req #3
        // Relaxed: > 4 -> > 6
        if (data.click_count > 6) {
            console.log(`[Decision] GAMING: Click Spam (${data.click_count})`);
            return UserState.GAMING;
        }

        // D. Entropy Based (Adaptive Threshold)
        // Check User Profile
        const profileManager = UserProfileManager.getInstance();
        const userProfile = await profileManager.getProfile(data.user_id || "default");
        const dynamicThreshold = userProfile.getPersonalizedGameThreshold();

        if (data.keyboard_entropy !== undefined && totalActivity > 10) {
            // Tier 1: Obvious Gaming (Spamming)
            // If Entropy is extremely low, ignore Dwell Time (it's definitely unnatural)
            if (data.keyboard_entropy < 1.5) {
                console.log(`[Decision] GAMING: Critical Entropy (${data.keyboard_entropy})`);
                return UserState.GAMING;
            }

            // Tier 2: Suspicious (Adaptive)
            // Compare against DYNAMIC Threshold (e.g. 2.5)
            if (data.keyboard_entropy < dynamicThreshold) {
                // Relaxed Dwell Check: 90ms -> 120ms
                if (data.avg_dwell_time !== undefined && data.avg_dwell_time < 120) {
                    console.log(`[Decision] GAMING: Entropy (${data.keyboard_entropy}) < Threshold (${dynamicThreshold.toFixed(2)}) + Low Dwell`);
                    return UserState.GAMING;
                }
            }
        }

        // E. Mouse Dragging (Refined Logic)
        if (data.is_dragging) {
            // Case 1: Dragging + Key Spamming
            if (data.mouse_distance > 1000 &&
                data.keystroke_count > 5 &&
                data.keyboard_entropy !== undefined &&
                data.keyboard_entropy < dynamicThreshold) { // Use Dynamic Here too!

                if (data.avg_dwell_time === undefined || data.avg_dwell_time < 120) {
                    console.log(`[Decision] GAMING: Drag w/ Spam (Ent < ${dynamicThreshold.toFixed(2)})`);
                    return UserState.GAMING;
                }
            }
            // Case 2: Extreme Mouse Movement (Panic)
            // Relaxed: 4000 -> 8000
            if (data.mouse_distance > 8000) {
                console.log(`[Decision] GAMING: Extreme Drag (${data.mouse_distance})`);
                return UserState.GAMING;
            }
        }

        // 2. Standard Logic

        // [Learning Phase] - User Req "Anomaly Detection"
        // If we reached here, it means it's NOT Gaming, NOT Idle, NOT Emergency.
        // So it is "Normal Productivity" (Coding, Chatting, Browsing etc.)
        // We update the Baseline if there is sufficient activity.
        // Only learn if Entropy is clearly in the "Productive Range" (> 3.0)
        // This prevents learning "Undetected Gaming" as "Normal".
        if (data.keyboard_entropy !== undefined && totalActivity > 10 && data.keyboard_entropy > 3.0) {
            userProfile.adaptThreshold(data.keyboard_entropy);
            await profileManager.saveProfile(data.user_id || "default");
        }

        if (score >= 80) {
            return UserState.FOCUSING;
        }

        if (score < 30) {
            if (data.is_eyes_closed) {
                return UserState.SLEEPING; // High probability of sleeping
            }
            return UserState.DISTRACTED; // Or just low focus
        }

        return UserState.NORMAL;
    }
}

import { SystemLogRequest } from './scoring-engine';

// Enum mirroring common/score.proto
export enum UserState {
    NORMAL = 0,
    FOCUSING = 1,
    DISTRACTED = 2,
    SLEEPING = 3,
    AFK = 4,
    EMERGENCY = 5
}

export class StateDecisionMaker {
    public static determineState(score: number, data: SystemLogRequest): UserState {
        if (data.is_emergency) {
            return UserState.EMERGENCY;
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

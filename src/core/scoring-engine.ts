// Types for SystemLogRequest (Manual mapping or use generated types if available)
// For now, defining interface based on log.proto
export interface SystemLogRequest {
    user_id: string;
    timestamp: number;
    mouse_distance: number;
    keystroke_count: number;
    click_count: number;
    is_os_idle: boolean;
    is_eyes_closed: boolean;
    vision_score: number;
    is_emergency: boolean;
    keyboard_entropy?: number;
    window_title?: string;
    is_dragging?: boolean;
    avg_dwell_time?: number;
}

export class ScoringEngine {
    private static WEIGHT_MOUSE = 0.2;
    private static WEIGHT_KEYBOARD = 0.2;
    private static WEIGHT_VISION = 0.6;

    public static calculateScore(data: SystemLogRequest): number {
        // Mouse Score: 1000px = 100 points
        const mouseScore = Math.min(data.mouse_distance / 10, 100);

        // Keyboard Score: 5 keys = 100 points
        const keyScore = Math.min(data.keystroke_count * 20, 100);

        let osScore = Math.max(mouseScore, keyScore);
        if (data.is_os_idle) {
            osScore = 0;
        }

        let visionScore = 0;
        if (data.is_eyes_closed) {
            visionScore = 0;
        } else {
            // Assuming vision_score is 0.0 ~ 1.0 from proto, mapping to 0~100
            visionScore = Math.floor(data.vision_score * 100);
        }

        const finalScore = (osScore * (ScoringEngine.WEIGHT_MOUSE + ScoringEngine.WEIGHT_KEYBOARD)) +
            (visionScore * ScoringEngine.WEIGHT_VISION);

        return Math.floor(Math.min(finalScore, 100));
    }
}

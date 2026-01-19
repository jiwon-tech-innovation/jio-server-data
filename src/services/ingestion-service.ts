import { consumer, producer } from '../config/kafka';
import { ScoringEngine, SystemLogRequest } from '../core/scoring-engine';
import { StateDecisionMaker, UserState } from '../core/state-decision';
import { eventBus, EVENTS } from '../core/event-bus';
import { writeApi, Point } from '../config/influx';
<<<<<<< HEAD
=======
import { BlacklistManager } from '../core/blacklist-manager';
>>>>>>> origin/mvp/v5.0.0

const TOPIC = process.env.ACTIVITY_TOPIC || 'client-activity';
const STATE_TOPIC = 'command-state'; // Dev 4가 수신하는 토픽

// 이전 상태 추적 (상태 변경 시에만 전송)
let previousState: UserState | null = null;

<<<<<<< HEAD
=======

// [Wall 3] AI Verification Helper
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

// gRPC Setup
const PROTO_PATH = path.join(__dirname, '../protos/intelligence.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const intelligenceService = protoDescriptor.jiaa.intelligence.IntelligenceService;

// Connect to AI Infrastructure
const AI_GRPC_URL = process.env.AI_GRPC_URL || 'api.jiobserver.cloud:443';
const client = new intelligenceService(AI_GRPC_URL, grpc.credentials.createSsl());

// [Wall 3] AI Verification Helper via gRPC
async function classifyContent(windowTitle: string): Promise<{ state: string, reason: string }> {
    return new Promise((resolve) => {
        const request = {
            url: '',
            window_title: windowTitle
        };

        console.log(`[Wall 3] gRPC Calling AnalyzeUrl to ${AI_GRPC_URL}...`);

        client.AnalyzeUrl(request, (err: any, response: any) => {
            if (err) {
                console.error(`[AI] gRPC Error: ${err.message}`);
                // Fail-safe: Assume PLAY if AI is unreachable/error
                resolve({ state: 'PLAY', reason: 'gRPC_ERROR' });
                return;
            }

            // Map Enum String (STUDY, PLAY, ETC) to UserState string logic
            // Proto Enum: URL_UNKNOWN=0, STUDY=1, PLAY=2, NEUTRAL=3, WORK=4
            // Response typically returns string "STUDY" or "PLAY" if enums=String in loader

            let state = 'PLAY';
            // Proto Enum: UNKNOWN=0, STUDY=1, PLAY=2, WORK=3
            if (response.category === 'STUDY' || response.category === 'WORK') {
                state = 'STUDY'; // Treat work as STUDY/SAFE
            }

            resolve({
                state: state,
                reason: response.reason || 'AI Judgment'
            });
        });
    });
}

>>>>>>> origin/mvp/v5.0.0
export const startIngestion = async () => {
    console.log(`[Ingestion] Subscribing to topic: ${TOPIC}`);
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (!message.value) return;

            try {
                const payloadString = message.value.toString();
                const rawData = JSON.parse(payloadString);

                // Map ClientActivity (Go) to SystemLogRequest (TS)
                // Go JSON tags: client_id, activity_type, timestamp, metadata
                const data: SystemLogRequest = {
                    user_id: rawData.client_id || rawData.user_id || rawData.ClientID,
                    timestamp: new Date(rawData.timestamp || rawData.Timestamp).getTime(),
                    is_os_idle: false,
                    is_eyes_closed: false,
                    vision_score: 0,
                    is_emergency: false,
                    mouse_distance: 0,
                    keystroke_count: 0,
                    click_count: 0
                };

                // Extract Metadata if available (try strict lowercase first, then Fallback)
                const meta = rawData.metadata || rawData.Metadata;
                if (meta) {
                    if (meta.mouse_distance) data.mouse_distance = parseInt(meta.mouse_distance);
                    if (meta.keystroke_count) data.keystroke_count = parseInt(meta.keystroke_count);
                    if (meta.click_count) data.click_count = parseInt(meta.click_count);
                    if (meta.entropy) data.keyboard_entropy = parseFloat(meta.entropy);
                    if (meta.window_title) data.window_title = meta.window_title;
                    if (meta.is_dragging) data.is_dragging = (meta.is_dragging === 'true');
                    if (meta.avg_dwell_time) data.avg_dwell_time = parseFloat(meta.avg_dwell_time);
<<<<<<< HEAD

                    // [FIX] Telemetry Pipeline
                    if (meta.is_os_idle) data.is_os_idle = (meta.is_os_idle === 'true');
                    if (meta.is_eyes_closed) data.is_eyes_closed = (meta.is_eyes_closed === 'true');
                    if (meta.concentration_score) data.vision_score = parseFloat(meta.concentration_score);
=======
>>>>>>> origin/mvp/v5.0.0
                }

                // If explicit fields exist (legacy/fallback)
                if (rawData.mouse_distance) data.mouse_distance = rawData.mouse_distance;
                if (rawData.keystroke_count) data.keystroke_count = rawData.keystroke_count;

                console.log(`[Ingestion] Received Activity: Keys=${data.keystroke_count}, Mouse=${data.mouse_distance}, Clicks=${data.click_count}`);

                // 1. Calculate
                const score = ScoringEngine.calculateScore(data);
<<<<<<< HEAD
                const state = await StateDecisionMaker.determineState(score, data);

                const stateStr = UserState[state];
                if (state === UserState.GAMING) {
                    console.log(`\x1b[31m[Ingestion] 🚨 GAMING DETECTED! Score: ${score}, State: ${stateStr}\x1b[0m`);
                } else {
=======
                let state = await StateDecisionMaker.determineState(score, data);

                // [Wall 3] AI Verification Loop
                if (state === UserState.GAMING) {
                    let aiConfirmed = true;

                    // Only verify if we have a title (otherwise we rely on heuristic)
                    if (data.window_title && data.window_title !== "Unknown") {
                        console.log(`[Wall 3] Heuristic says GAMING. Verifying with AI for title: '${data.window_title}'...`);
                        const aiResult = await classifyContent(data.window_title);
                        console.log(`[Wall 3] AI Result: ${aiResult.state} (${aiResult.reason})`);

                        if (aiResult.state === 'STUDY') {
                            console.log(`\x1b[32m[Wall 3] 🛡️ AI OVERRIDE: Gaming -> Normal (Context: ${aiResult.reason})\x1b[0m`);
                            state = UserState.NORMAL; // Override state
                            aiConfirmed = false;
                        } else {
                            console.log(`[Wall 3] AI Confirmed Gaming.`);
                        }
                    }

                    if (aiConfirmed) {
                        const stateStr = UserState[state];
                        console.log(`\x1b[31m[Ingestion] 🚨 CONFIRMED GAMING! Score: ${score}, State: ${stateStr}\x1b[0m`);

                        // [Feedback Loop] Auto-Report to Blacklist
                        if (data.window_title && data.window_title !== "Unknown") {
                            console.log(`[Feedback] Auto-reporting '${data.window_title}' to Blacklist...`);
                            BlacklistManager.getInstance().reportApp(data.window_title, true);
                        }
                    }
                } else {
                    const stateStr = UserState[state];
>>>>>>> origin/mvp/v5.0.0
                    console.log(`[Ingestion] Score: ${score}, State: ${stateStr}`);
                }

                // 2. Broadcast internal event (for gRPC stream to Dev 3)
                const updatePayload = {
                    current_score: score,
                    state: state,
                    feedback_msg: getFeedbackMsg(state),
                    timestamp: Date.now()
                };
                eventBus.emit(EVENTS.SCORE_UPDATED, updatePayload);

                // 3. Send state to Dev 4 (Go server) via Kafka
                //    상태가 변경되었거나, 긴급 상태일 때만 전송
                if (state !== previousState || state === UserState.EMERGENCY) {
                    await sendStateToDev4(data.user_id, state, score);
                    previousState = state;
                }

                // 4. Persist to InfluxDB CHECKED
                // Schema Update for TIL: Use 'user_activity' and add 'category', 'action_detail'

                // Derive Category
                let category = "NEUTRAL";
                if (state === UserState.FOCUSING) category = "STUDY";
                else if (state === UserState.GAMING) category = "PLAY";
                else if (state === UserState.DISTRACTED) category = "PLAY"; // Distracted is basically playing/slacking
                else if (state === UserState.SLEEPING) category = "SLEEP";

                const point = new Point('user_activity') // Changed from 'system_log'
                    .tag('user_id', data.user_id)
                    .tag('category', category) // Added Tag
                    .floatField('score', score)
                    .stringField('state', UserState[state])
                    .intField('mouse_distance', data.mouse_distance)
                    .intField('keystroke_count', data.keystroke_count)
                    .intField('click_count', data.click_count);

                if (data.window_title) {
                    point.stringField('action_detail', data.window_title); // Added Field
                } else {
                    // Fallback to state if no window title
                    point.stringField('action_detail', UserState[state]);
                }

                if (data.keyboard_entropy !== undefined) {
                    point.floatField('entropy', data.keyboard_entropy);
                }

                point.timestamp(new Date(data.timestamp || Date.now()));

                writeApi.writePoint(point);

            } catch (err) {
                console.error('Error processing message:', err);
            }
        },
    });
};

/**
 * Dev 4 (Go server)에게 상태 결정을 전송
 * Go 서버의 StateMessage 형식에 맞춤
 */
async function sendStateToDev4(clientId: string, state: UserState, score: number): Promise<void> {
    const stateMessage = {
        client_id: clientId,
        state: userStateToCommandState(state),
        payload: JSON.stringify({ score }),
        priority: getPriority(state),
        timestamp: Date.now()
    };

    try {
        await producer.send({
            topic: STATE_TOPIC,
            messages: [
                {
                    key: clientId,
                    value: JSON.stringify(stateMessage)
                }
            ]
        });
        console.log(`[Ingestion] Sent state to Dev 4: ${stateMessage.state} (priority: ${stateMessage.priority})`);
    } catch (err) {
        console.error('[Ingestion] Failed to send state to Dev 4:', err);
    }
}

/**
 * UserState를 Go 서버의 CommandState 문자열로 변환
 */
function userStateToCommandState(state: UserState): string {
    switch (state) {
        case UserState.FOCUSING: return 'THINKING';      // Score > 80
        case UserState.SLEEPING: return 'SLEEPING';      // Score < 30 + eyes closed
        case UserState.DISTRACTED: return 'DISTRACTED';  // Score < 30
        case UserState.EMERGENCY: return 'EMERGENCY';    // Audio > 90dB
        case UserState.AFK: return 'DISTRACTED';
        case UserState.GAMING: return 'DISTRACTED';      // Treat Gaming as Distraction
        default: return 'AWAKE';
    }
}

/**
 * 상태에 따른 우선순위 결정 (1-10)
 */
function getPriority(state: UserState): number {
    switch (state) {
        case UserState.EMERGENCY: return 10;   // 최고 우선순위
        case UserState.SLEEPING: return 8;
        case UserState.DISTRACTED: return 6;
        case UserState.FOCUSING: return 3;     // 낮은 우선순위 (건드리지 마)
        case UserState.GAMING: return 9;       // Very High Priority (Stop Gaming!)
        default: return 5;
    }
}

function getFeedbackMsg(state: UserState): string {
    switch (state) {
        case UserState.FOCUSING: return "Great Focus!";
        case UserState.SLEEPING: return "Wake Up!";
        case UserState.DISTRACTED: return "Stay Focused!";
        case UserState.EMERGENCY: return "Emergency Detected!";
        case UserState.GAMING: return "Stop Gaming! Back to Work!";
        default: return "Keep Going!";
    }
}

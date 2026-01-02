import { consumer, producer } from '../config/kafka';
import { ScoringEngine, SystemLogRequest } from '../core/scoring-engine';
import { StateDecisionMaker, UserState } from '../core/state-decision';
import { eventBus, EVENTS } from '../core/event-bus';
import { writeApi, Point } from '../config/influx';

const TOPIC = process.env.ACTIVITY_TOPIC || 'client-activity';
const STATE_TOPIC = 'command-state'; // Dev 4가 수신하는 토픽

// 이전 상태 추적 (상태 변경 시에만 전송)
let previousState: UserState | null = null;

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
                }

                // If explicit fields exist (legacy/fallback)
                if (rawData.mouse_distance) data.mouse_distance = rawData.mouse_distance;
                if (rawData.keystroke_count) data.keystroke_count = rawData.keystroke_count;

                console.log(`[Ingestion] Received Activity: Keys=${data.keystroke_count}, Mouse=${data.mouse_distance}, Clicks=${data.click_count}`);

                // 1. Calculate
                const score = ScoringEngine.calculateScore(data);
                const state = StateDecisionMaker.determineState(score, data);

                console.log(`[Ingestion] Score: ${score}, State: ${UserState[state]}`);

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

                // 4. Persist to InfluxDB
                const point = new Point('system_log')
                    .tag('user_id', data.user_id)
                    .floatField('score', score)
                    .stringField('state', UserState[state])
                    .intField('mouse_distance', data.mouse_distance)
                    .intField('keystroke_count', data.keystroke_count)
                    .intField('click_count', data.click_count)
                    .timestamp(new Date(data.timestamp || Date.now()));

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
        default: return 5;
    }
}

function getFeedbackMsg(state: UserState): string {
    switch (state) {
        case UserState.FOCUSING: return "Great Focus!";
        case UserState.SLEEPING: return "Wake Up!";
        case UserState.DISTRACTED: return "Stay Focused!";
        case UserState.EMERGENCY: return "Emergency Detected!";
        default: return "Keep Going!";
    }
}

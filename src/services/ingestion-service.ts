import { consumer } from '../config/kafka';
import { ScoringEngine, SystemLogRequest } from '../core/scoring-engine';
import { StateDecisionMaker, UserState } from '../core/state-decision';
import { eventBus, EVENTS } from '../core/event-bus';
import { writeApi, Point } from '../config/influx';

const TOPIC = 'sensor-data';

export const startIngestion = async () => {
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
            if (!message.value) return;

            try {
                const payloadString = message.value.toString();
                // Assuming JSON payload for now as Proto deserialization from Kafka raw bytes requires generated code usually
                // or we use JSON format. Assuming data is sent as JSON from upstream for simplicity in Node.js
                const data: SystemLogRequest = JSON.parse(payloadString);

                // 1. Calculate
                const score = ScoringEngine.calculateScore(data);
                const state = StateDecisionMaker.determineState(score, data);

                console.log(`[Ingestion] Score: ${score}, State: ${state}`);

                // 2. Broadcast internal event
                const updatePayload = {
                    current_score: score,
                    state: state,
                    feedback_msg: getFeedbackMsg(state),
                    timestamp: Date.now()
                };
                eventBus.emit(EVENTS.SCORE_UPDATED, updatePayload);

                // 3. Persist to InfluxDB
                const point = new Point('system_log')
                    .tag('user_id', data.user_id)
                    .floatField('score', score)
                    .stringField('state', UserState[state])
                    .intField('mouse_distance', data.mouse_distance)
                    .intField('keystroke_count', data.keystroke_count)
                    .timestamp(new Date(data.timestamp || Date.now()));

                writeApi.writePoint(point);
                // writeApi.flush(); // Flush regularly or rely on buffering

            } catch (err) {
                console.error('Error processing message:', err);
            }
        },
    });
};

function getFeedbackMsg(state: UserState): string {
    switch (state) {
        case UserState.FOCUSING: return "Great Focus!";
        case UserState.SLEEPING: return "Wake Up!";
        case UserState.DISTRACTED: return "Stay Focused!";
        case UserState.EMERGENCY: return "Emergency Detected!";
        default: return "Keep Going!";
    }
}

import { EventEmitter } from 'events';

class EventBus extends EventEmitter { }

export const eventBus = new EventBus();
export const EVENTS = {
    SCORE_UPDATED: 'score_updated',
};

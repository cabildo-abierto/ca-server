import type {
    NodeSavedSession,
    NodeSavedSessionStore,
    NodeSavedState,
    NodeSavedStateStore,
} from '@atproto/oauth-client-node';
import type { RedisClientType } from 'redis';

export class StateStore implements NodeSavedStateStore {
    constructor(private db: RedisClientType) {}

    async get(key: string): Promise<NodeSavedState | undefined> {
        const result = await this.db.get(`authState:${key}`);
        if (!result) return undefined;
        return JSON.parse(result) as NodeSavedState;
    }

    async set(key: string, val: NodeSavedState) {
        const state = JSON.stringify(val);
        await this.db.set(`authState:${key}`, state);
    }

    async del(key: string) {
        await this.db.del(`authState:${key}`);
    }
}

export class SessionStore implements NodeSavedSessionStore {
    constructor(private db: RedisClientType) {}

    async get(key: string): Promise<NodeSavedSession | undefined> {
        const result = await this.db.get(`authSession:${key}`);
        if (!result) return undefined;
        return JSON.parse(result) as NodeSavedSession;
    }

    async set(key: string, val: NodeSavedSession) {
        const session = JSON.stringify(val);
        await this.db.set(`authSession:${key}`, session);
    }

    async del(key: string) {
        await this.db.del(`authSession:${key}`);
    }
}

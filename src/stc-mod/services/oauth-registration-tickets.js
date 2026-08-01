import crypto from 'node:crypto';

export const OAUTH_REGISTRATION_TICKET_TTL_MS = 10 * 60 * 1000;

/**
 * In-memory store for short-lived OAuth registration tickets.
 * The browser only receives the opaque ticket; trusted provider identity data
 * remains on the server and is removed before it is returned to a consumer.
 */
export class OAuthRegistrationTicketStore {
    /**
     * @param {{ ttlMs?: number, now?: () => number }} options
     */
    constructor({ ttlMs = OAUTH_REGISTRATION_TICKET_TTL_MS, now = () => Date.now() } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.tickets = new Map();
    }

    /**
     * @param {{ provider: string, providerUserId: string, username?: string|null, email?: string|null, avatar?: string|null }} identity
     * @param {string} sessionBinding
     * @returns {string}
     */
    create(identity, sessionBinding) {
        if (!identity?.provider || !identity?.providerUserId || !sessionBinding) {
            throw new Error('OAuth registration ticket requires provider identity and a session binding.');
        }

        this.cleanupExpired();

        const ticket = crypto.randomBytes(32).toString('base64url');
        const ticketHash = this.hash(ticket);
        this.tickets.set(ticketHash, {
            identity: {
                provider: String(identity.provider),
                providerUserId: String(identity.providerUserId),
                username: typeof identity.username === 'string' ? identity.username : null,
                email: typeof identity.email === 'string' ? identity.email : null,
                avatar: typeof identity.avatar === 'string' ? identity.avatar : null,
            },
            sessionBinding,
            expiresAt: this.now() + this.ttlMs,
        });

        return ticket;
    }

    /**
     * Reads trusted identity data without consuming the ticket. This is only
     * used for server-side preconditions; callers must still call consume()
     * immediately before changing account state.
     * @param {string} ticket
     * @param {string} sessionBinding
     * @returns {{ provider: string, providerUserId: string, username: string|null, email: string|null, avatar: string|null }|null}
     */
    read(ticket, sessionBinding) {
        if (!ticket || !sessionBinding) return null;

        const ticketHash = this.hash(ticket);
        const record = this.tickets.get(ticketHash);
        if (!record) return null;

        if (record.expiresAt <= this.now()) {
            this.tickets.delete(ticketHash);
            return null;
        }

        if (record.sessionBinding !== sessionBinding) {
            return null;
        }

        return { ...record.identity };
    }

    /**
     * Atomically consumes a ticket. A successful lookup deletes it before the
     * trusted identity is returned, so replay attempts always fail.
     * @param {string} ticket
     * @param {string} sessionBinding
     * @returns {{ provider: string, providerUserId: string, username: string|null, email: string|null, avatar: string|null }|null}
     */
    consume(ticket, sessionBinding) {
        if (!ticket || !sessionBinding) return null;

        const ticketHash = this.hash(ticket);
        const record = this.tickets.get(ticketHash);
        if (!record) return null;

        if (record.expiresAt <= this.now()) {
            this.tickets.delete(ticketHash);
            return null;
        }

        if (record.sessionBinding !== sessionBinding) {
            return null;
        }

        this.tickets.delete(ticketHash);
        return { ...record.identity };
    }

    cleanupExpired() {
        const now = this.now();
        for (const [ticketHash, record] of this.tickets) {
            if (record.expiresAt <= now) {
                this.tickets.delete(ticketHash);
            }
        }
    }

    clear() {
        this.tickets.clear();
    }

    /**
     * @param {string} ticket
     * @returns {string}
     */
    hash(ticket) {
        return crypto.createHash('sha256').update(String(ticket)).digest('hex');
    }
}

const oauthRegistrationTickets = new OAuthRegistrationTicketStore();

export function createOAuthRegistrationTicket(identity, sessionBinding) {
    return oauthRegistrationTickets.create(identity, sessionBinding);
}

export function getOAuthRegistrationTicket(ticket, sessionBinding) {
    return oauthRegistrationTickets.read(ticket, sessionBinding);
}

export function consumeOAuthRegistrationTicket(ticket, sessionBinding) {
    return oauthRegistrationTickets.consume(ticket, sessionBinding);
}

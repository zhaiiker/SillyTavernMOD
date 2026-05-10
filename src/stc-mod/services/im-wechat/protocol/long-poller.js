/**
 * STC-MOD WeChat iLink Bot Protocol - Long Poller
 *
 * Implements the getupdates long-polling loop:
 *   - POST /ilink/bot/getupdates with cursor (get_updates_buf)
 *   - Server holds up to 35s until messages arrive
 *   - On disconnect/error: exponential backoff reconnect
 *   - Emits messages via callback; never blocks on processing
 */
import { EventEmitter } from 'node:events';
import { ilinkPost, IlinkError } from './client.js';
import { CHANNEL_VERSION } from './types.js';

const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 15000, 30000];

/**
 * @typedef {Object} LongPollerOptions
 * @property {string} botToken
 * @property {string} [baseUrl]
 * @property {number} [timeoutMs=40000]
 */

/**
 * Long-polling worker for a single bot account.
 * Emits:
 *   'messages' → WeixinMessage[]
 *   'error' → Error
 *   'token_invalid' → void (should stop and require re-login)
 *   'stopped' → void
 */
export class LongPoller extends EventEmitter {
    /**
     * @param {LongPollerOptions} options
     */
    constructor(options) {
        super();
        this.botToken = options.botToken;
        this.baseUrl = options.baseUrl;
        this.timeoutMs = options.timeoutMs || 40000;

        /** @type {string} */
        this._cursor = '';
        this._running = false;
        this._backoffIndex = 0;
        this._currentAbort = null;
    }

    /** Start the polling loop. Idempotent. */
    start() {
        if (this._running) return;
        this._running = true;
        this._backoffIndex = 0;
        this._loop();
    }

    /** Gracefully stop the polling loop. */
    stop() {
        this._running = false;
        if (this._currentAbort) {
            this._currentAbort.abort();
            this._currentAbort = null;
        }
        this.emit('stopped');
    }

    /** @returns {boolean} */
    get isRunning() {
        return this._running;
    }

    /** @returns {string} Current cursor value */
    get cursor() {
        return this._cursor;
    }

    /** Set cursor (e.g. when restoring from persistence) */
    set cursor(value) {
        this._cursor = value || '';
    }

    /** @private */
    async _loop() {
        while (this._running) {
            try {
                const data = await this._poll();

                // Success — reset backoff
                this._backoffIndex = 0;

                // Update cursor (only if response includes one)
                if (data.get_updates_buf) {
                    this._cursor = data.get_updates_buf;
                }

                // Emit messages if any
                const msgs = data.msgs || [];
                if (msgs.length > 0) {
                    this.emit('messages', msgs);
                }

                // Immediately poll again (no sleep on success — server already held 35s)
            } catch (err) {
                if (!this._running) break; // Stopped during poll

                if (err instanceof IlinkError && err.httpStatus === 401) {
                    this.emit('token_invalid');
                    this._running = false;
                    break;
                }

                this.emit('error', err);

                // Exponential backoff
                const delay = BACKOFF_SCHEDULE_MS[Math.min(this._backoffIndex, BACKOFF_SCHEDULE_MS.length - 1)];
                this._backoffIndex++;
                await this._sleep(delay);
            }
        }

        this.emit('stopped');
    }

    /** @private */
    async _poll() {
        return await ilinkPost('/ilink/bot/getupdates', {
            get_updates_buf: this._cursor,
            base_info: { channel_version: CHANNEL_VERSION },
        }, {
            botToken: this.botToken,
            baseUrl: this.baseUrl,
            timeoutMs: this.timeoutMs,
        });
    }

    /**
     * @private
     * @param {number} ms
     */
    _sleep(ms) {
        return new Promise(resolve => {
            const timer = setTimeout(resolve, ms);
            // Allow stop() to interrupt sleep
            const onStop = () => {
                clearTimeout(timer);
                resolve();
            };
            this.once('stopped', onStop);
            // Clean up listener if sleep completes normally
            setTimeout(() => this.removeListener('stopped', onStop), ms + 10);
        });
    }
}

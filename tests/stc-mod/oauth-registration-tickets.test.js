import assert from 'node:assert/strict';
import test from 'node:test';

import { OAuthRegistrationTicketStore } from '../../src/stc-mod/services/oauth-registration-tickets.js';

const identity = {
    provider: 'github',
    providerUserId: '12345',
    username: 'octocat',
    email: 'octocat@example.com',
    avatar: 'https://example.com/avatar.png',
};

test('OAuth registration ticket returns server-side identity exactly once', () => {
    const store = new OAuthRegistrationTicketStore();
    const ticket = store.create(identity, 'browser-session');

    assert.deepEqual(store.read(ticket, 'browser-session'), identity);
    assert.deepEqual(store.read(ticket, 'browser-session'), identity);
    assert.deepEqual(store.consume(ticket, 'browser-session'), identity);
    assert.equal(store.read(ticket, 'browser-session'), null);
    assert.equal(store.consume(ticket, 'browser-session'), null);
});

test('OAuth registration ticket is bound to the initiating browser session', () => {
    const store = new OAuthRegistrationTicketStore();
    const ticket = store.create(identity, 'correct-session');

    assert.equal(store.consume(ticket, 'wrong-session'), null);
    assert.deepEqual(store.consume(ticket, 'correct-session'), identity);
});

test('OAuth registration ticket expires', () => {
    let now = 1_000;
    const store = new OAuthRegistrationTicketStore({ ttlMs: 500, now: () => now });
    const ticket = store.create(identity, 'browser-session');

    now += 501;
    assert.equal(store.consume(ticket, 'browser-session'), null);
});

test('forged OAuth registration tickets are rejected', () => {
    const store = new OAuthRegistrationTicketStore();
    store.create(identity, 'browser-session');

    assert.equal(store.consume('attacker-controlled-ticket', 'browser-session'), null);
});

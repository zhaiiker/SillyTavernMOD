import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_REGISTRATION_PASSWORD_LENGTH, validateRegistrationPassword } from '../../src/stc-mod/services/password-policy.js';

test('registration password requires at least eight characters', () => {
    assert.equal(MIN_REGISTRATION_PASSWORD_LENGTH, 8);
    assert.equal(validateRegistrationPassword('1234567').valid, false);
    assert.equal(validateRegistrationPassword('12345678').valid, true);
});

test('registration password rejects missing and non-string values', () => {
    assert.equal(validateRegistrationPassword('').valid, false);
    assert.equal(validateRegistrationPassword(undefined).valid, false);
    assert.equal(validateRegistrationPassword(12345678).valid, false);
});

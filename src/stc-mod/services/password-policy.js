export const MIN_REGISTRATION_PASSWORD_LENGTH = 8;

/**
 * @param {unknown} password
 * @returns {{ valid: true }|{ valid: false, error: string }}
 */
export function validateRegistrationPassword(password) {
    if (typeof password !== 'string' || password.length < MIN_REGISTRATION_PASSWORD_LENGTH) {
        return {
            valid: false,
            error: `密码长度至少需要 ${MIN_REGISTRATION_PASSWORD_LENGTH} 个字符`,
        };
    }

    return { valid: true };
}

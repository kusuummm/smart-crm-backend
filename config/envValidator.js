/**
 * Environment Configuration & Secret Validator
 * Enforces secure environment management:
 * 1. Validates that critical secrets are present in production
 * 2. Prevents default, placeholder, or weak secret values in production
 * 3. Never logs or prints confidential secret values
 */

const KNOWN_PLACEHOLDERS = [
  'your_super_secret_jwt_key_here_change_in_production',
  'your_razorpay_key_id',
  'your_razorpay_key_secret',
  'your_razorpay_webhook_secret',
  'your_permanent_access_token_here',
  'your_webhook_verify_token_here',
  'your_meta_app_secret_here',
  'your_email_password',
  'your_aws_key',
  'your_aws_secret',
  'your_openai_api_key',
  'your_gemini_api_key',
  'placeholder',
  'secret',
  '123456',
  'password',
];

function validateEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // 1. JWT_SECRET Validation
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    errors.push('JWT_SECRET is missing. It must be configured in environment variables.');
  } else if (isProduction && KNOWN_PLACEHOLDERS.includes(jwtSecret)) {
    errors.push('JWT_SECRET is using a known default placeholder in production. Rotate with a strong random secret.');
  } else if (jwtSecret.length < 32 && isProduction) {
    warnings.push('JWT_SECRET is shorter than 32 characters. Consider using a 256-bit high-entropy secret.');
  }

  // 2. MONGO_URI Validation
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri && !process.env.TEST_SUITE) {
    errors.push('MONGO_URI is missing. It must be configured in environment variables.');
  } else if (mongoUri && isProduction && KNOWN_PLACEHOLDERS.some((p) => mongoUri.includes(p))) {
    errors.push('MONGO_URI contains placeholder credentials in production.');
  }

  // 3. Webhook & API Key validations
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  if (razorpaySecret && isProduction && KNOWN_PLACEHOLDERS.includes(razorpaySecret)) {
    errors.push('RAZORPAY_KEY_SECRET is using a default placeholder value in production.');
  }

  // In test environment, do not crash on missing non-essential secrets
  if (errors.length > 0) {
    console.error('================================================================');
    console.error('CRITICAL: SECURE ENVIRONMENT VALIDATION FAILED');
    errors.forEach((err) => console.error(` - [ERROR] ${err}`));
    console.error('================================================================');
    if (isProduction) {
      throw new Error(`Secure environment validation failed with ${errors.length} error(s). Application startup aborted.`);
    }
  }

  if (warnings.length > 0 && isProduction) {
    warnings.forEach((warn) => console.warn(` - [SECURITY WARNING] ${warn}`));
  }

  return { isValid: errors.length === 0, errors, warnings };
}

module.exports = { validateEnvironment, KNOWN_PLACEHOLDERS };

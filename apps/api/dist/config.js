import 'dotenv/config';
import { z } from 'zod';
const bool = z.preprocess((v) => (typeof v === 'string' ? ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()) : v), z.boolean());
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ROLE: z.enum(['api', 'worker', 'all']).default('all'),
    PORT: z.coerce.number().default(4100),
    LOG_LEVEL: z.string().default('info'),
    DATABASE_URL: z.string().min(1),
    PUBLIC_STORE_URL: z.string().url().default('http://localhost:5173'),
    PUBLIC_CONSOLE_URL: z.string().url().default('http://localhost:5174'),
    PUBLIC_API_URL: z.string().url().default('http://localhost:4100'),
    CORS_ORIGINS: z.string().default(''),
    COOKIE_SECRET: z.string().min(16),
    SESSION_TTL_HOURS: z.coerce.number().default(72),
    TRUST_PROXY: bool.default(true),
    RESEND_API_KEY: z.string().default(''),
    RESEND_FROM_EMAIL: z.string().default('Earthora Farms <contactus@earthorafarms.com>'),
    ADMIN_NOTIFY_EMAIL: z.string().default('contactus@earthorafarms.com'),
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),
    ASSETS_DIR: z.string().default('./data/assets'),
    ASSETS_PUBLIC_BASE: z.string().default('http://localhost:4100/media'),
    R2_ENDPOINT: z.string().default(''),
    R2_ACCESS_KEY_ID: z.string().default(''),
    R2_SECRET_ACCESS_KEY: z.string().default(''),
    R2_BUCKET: z.string().default(''),
    TOKEN_SIGNING_SECRET: z.string().min(16),
    PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
    COMPANY_NAME: z.string().default('Earthora Farms'),
    COMPANY_ADDRESS: z.string().default('Ahmedabad, Gujarat, India'),
    COMPANY_EMAIL: z.string().default('contactus@earthorafarms.com'),
    COMPANY_PHONE: z.string().default(''),
    COMPANY_GSTIN: z.string().default(''),
    BANK_ACCOUNT_NO: z.string().default(''),
    BANK_IFSC: z.string().default(''),
    BANK_BRANCH: z.string().default(''),
    LOW_STOCK_ALERT_EMAILS: z.string().default(''),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    GEMINI_API_KEY: z.string().default(''),
});
export function loadConfig(env = process.env) {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Invalid configuration: ${issues}`);
    }
    return parsed.data;
}
export const config = loadConfig();
export const isProd = config.NODE_ENV === 'production';
//# sourceMappingURL=config.js.map
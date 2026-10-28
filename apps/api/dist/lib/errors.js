export class HttpError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, message, code = 'error', details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
export const badRequest = (m, details) => new HttpError(400, m, 'bad_request', details);
export const unauthorized = (m = 'Unauthorized') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m = 'Forbidden') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m) => new HttpError(409, m, 'conflict');
export const tooMany = (m = 'Too many requests') => new HttpError(429, m, 'rate_limited');
export const upstream = (m) => new HttpError(502, m, 'upstream');
//# sourceMappingURL=errors.js.map
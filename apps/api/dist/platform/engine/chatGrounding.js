/** Typed chat has no verified, structured farm-location record yet. Inherited
 * website copy disagrees, and a warehouse/contact address is not a farm. Keep
 * this uncertainty explicit until the owner approves a canonical location. */
export const CHAT_CATALOGUE_RULE = 'The LIVE CATALOGUE is the only source for currently listed product names, formats, prices and stock. Website pages, persona notes and older messages may mention discontinued products; they do not establish availability. If the live lookup failed, do not interpret that as an empty catalogue. An ingredient such as leaf powder is not a separately sold powder product.';
export const CHAT_LOCATION_RULE = 'The farm location is currently unverified: inherited website sources disagree. Do not assert a farm location, cultivation origin, altitude or soil origin from those pages. A contact, office or warehouse address is not confirmation of the farm location. If asked where the farm is, say its exact location needs confirmation; do not choose one of the conflicting locations. A request for the contact address may use a contact source, labelled as contact/warehouse only.';
function overviewIntent(message) {
    const text = message.normalize('NFKC').trim();
    // Leave product detail, transactional and medical questions with their normal
    // evidence/tools. These narrow factual intents are not a new conversation router.
    if (/\b(?:price|cost|benefits?|ingredients?|dosage|cure|treat|add to cart|place.{0,12}order|track.{0,12}order)\b|कीमत|सामग्री|फायदे|ખરીદ|કિંમત|ઘટકો/u.test(text.toLowerCase()))
        return { company: false, farmLocation: false };
    const company = /\b(?:what (?:is|kind of company is) earthora(?: farms)?|(?:tell me|introduction|introduce|learn|know).{0,40}(?:your company|earthora(?: farms)?)|(?:what|tell me).{0,25}(?:company|brand).{0,20}(?:focus|about|do))\b/i.test(text)
        || /(?:अर्थोरा|अर्थोरा फार्म्स|Earthora|कंपनी).{0,25}(?:क्या है|बारे में)|(?:અમારી|તમારી|Earthora|અર્થોરા).{0,30}(?:કંપની|વિશે)/iu.test(text);
    const farmLocation = (/(?:\bfarm\b|\bour farms\b|\byour farms\b|earthora farms|खेत|फार्म|ફાર્મ|ખેતર)/iu.test(text)
        && /\b(?:where|location|located|address|situated)\b|कहाँ|कहां|पता|ક્યાં|સરનામું|સ્થળ/iu.test(text));
    return { company, farmLocation };
}
/** Source-derived direct answers for company/location enquiries. Product names
 * are read afresh each turn; failed retrieval and an empty active list differ.
 * This deliberately makes no claim about organic certification, benefits or farm
 * geography, none of which a product-name listing proves. */
export function groundedChatCompanyReply(message, catalogue, language) {
    const intent = overviewIntent(message);
    if (!intent.company && !intent.farmLocation)
        return null;
    const rows = catalogue.ok && Array.isArray(catalogue.data) ? catalogue.data : null;
    const names = rows?.flatMap(row => row && typeof row.name === 'string' && row.name.trim()
        && (row.status === undefined || row.status === 'active') ? [row.name.trim()] : []) ?? null;
    const valid = names !== null && names.length === rows?.length;
    const listed = valid && names.length ? names.slice(0, 6).join(', ') : '';
    const rest = valid && names.length > 6 ? names.length - 6 : 0;
    const lang = language === 'hi' || language === 'gu' ? language : 'en';
    const parts = [];
    if (intent.company) {
        parts.push({
            en: listed ? `Earthora Farms is the company behind our product range. The current catalogue lists ${listed}${rest ? `, and ${rest} other products` : ''}.`
                : valid ? 'Earthora Farms is the company behind this store. No active products are listed in the current catalogue.'
                    : 'Earthora Farms is the company behind this store. I cannot verify the current product catalogue right now.',
            hi: listed ? `Earthora Farms हमारे प्रोडक्ट की कंपनी है। अभी की कैटलॉग में ${listed}${rest ? ` और ${rest} अन्य प्रोडक्ट` : ''} सूचीबद्ध हैं।`
                : valid ? 'Earthora Farms इस स्टोर की कंपनी है। अभी कैटलॉग में कोई सक्रिय प्रोडक्ट सूचीबद्ध नहीं है।'
                    : 'Earthora Farms इस स्टोर की कंपनी है। अभी मैं मौजूदा प्रोडक्ट कैटलॉग की पुष्टि नहीं कर पा रही हूँ।',
            gu: listed ? `Earthora Farms અમારા પ્રોડક્ટની કંપની છે. હાલની કેટલોગમાં ${listed}${rest ? ` અને ${rest} અન્ય પ્રોડક્ટ` : ''} સૂચિબદ્ધ છે.`
                : valid ? 'Earthora Farms આ સ્ટોરની કંપની છે. હાલ કેટલોગમાં કોઈ સક્રિય પ્રોડક્ટ સૂચિબદ્ધ નથી.'
                    : 'Earthora Farms આ સ્ટોરની કંપની છે. અત્યારે હું હાલની પ્રોડક્ટ કેટલોગની પુષ્ટિ કરી શકતી નથી.',
        }[lang]);
    }
    if (intent.farmLocation)
        parts.push({
            en: 'I cannot confirm the exact farm location from verified information. The contact/warehouse address is not confirmed as the farm location.',
            hi: 'पुष्टि की हुई जानकारी से खेत की सही लोकेशन नहीं बता सकती। संपर्क या वेयरहाउस का पता खेत का पता होने की पुष्टि नहीं है।',
            gu: 'ચકાસેલી માહિતીથી ફાર્મનું ચોક્કસ સ્થળ કહી શકતી નથી. સંપર્ક કે વેરહાઉસનું સરનામું ફાર્મનું જ સરનામું છે તેની પુષ્ટિ નથી.',
        }[lang]);
    return parts.join(' ');
}
//# sourceMappingURL=chatGrounding.js.map
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FEED_SOURCE_LANGUAGE_CODES = void 0;
exports.getLanguageNameIn = getLanguageNameIn;
exports.getLocalizedLanguageName = getLocalizedLanguageName;
var _i18nIsoLanguages = _interopRequireDefault(require("@cospired/i18n-iso-languages"));
var _ar = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/ar.json"));
var _de = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/de.json"));
var _en = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/en.json"));
var _es = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/es.json"));
var _fr = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/fr.json"));
var _id = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/id.json"));
var _it = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/it.json"));
var _ja = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/ja.json"));
var _ko = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/ko.json"));
var _nl = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/nl.json"));
var _pl = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/pl.json"));
var _pt = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/pt.json"));
var _ru = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/ru.json"));
var _th = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/th.json"));
var _uk = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/uk.json"));
var _vi = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/vi.json"));
var _zh = _interopRequireDefault(require("@cospired/i18n-iso-languages/langs/zh.json"));
var _languageCodes = require("./language-codes");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Language display names, resolved in the reader's own UI language.
//
// The feed carries articles in ~100 source languages. Naming one of them
// inside a translated sentence ("This article is in {{language}}") only
// works if the name itself is translated — an English "German" dropped into
// a Hindi sentence is unreadable, and so is the endonym ("Deutsch") for a
// reader who doesn't know the script.
//
// @cospired/i18n-iso-languages ships name packs for 17 of the app's 20 UI
// locales (~108 KB for all of them). The three it has no pack for — Hindi,
// Turkish, Traditional Chinese — are covered by EXTRA_LANGUAGE_NAMES below.

for (const pack of [_ar.default, _de.default, _en.default, _es.default, _fr.default, _id.default, _it.default, _ja.default, _ko.default, _nl.default, _pl.default, _pt.default, _ru.default, _th.default, _uk.default, _vi.default, _zh.default]) {
  _i18nIsoLanguages.default.registerLocale(pack);
}

/** The pack locales registered above, for resolving an app language to one. */
const PACK_LOCALES = new Set(['ar', 'de', 'en', 'es', 'fr', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'th', 'uk', 'vi', 'zh']);

/**
 * The source languages that actually appear in the feed, ordered by volume.
 * Measured over a two-day window of production `news-article` documents —
 * these ~70 codes cover >99% of articles out of ~100 distinct primary
 * subtags. EXTRA_LANGUAGE_NAMES is filled for exactly this set; anything
 * rarer falls through to the English name rather than to nothing.
 */
const FEED_SOURCE_LANGUAGE_CODES = exports.FEED_SOURCE_LANGUAGE_CODES = ['en', 'es', 'ar', 'fr', 'ru', 'hi', 'pt', 'fa', 'id', 'de', 'el', 'zh', 'ko', 'tr', 'bn', 'vi', 'hr', 'nl', 'bs', 'ro', 'kn', 'it', 'sq', 'te', 'ms', 'bg', 'ne', 'az', 'sv', 'mk', 'pl', 'hu', 'lv', 'uk', 'ur', 'sl', 'sk', 'lt', 'fi', 'da', 'cs', 'mr', 'no', 'ca', 'et', 'ta', 'or', 'ml', 'ja', 'gu', 'si', 'th', 'ky', 'is', 'tg', 'af', 'km', 'he', 'sr', 'ka', 'hy', 'gl', 'sw', 'uz', 'mn', 'ps', 'sd', 'lb', 'so', 'pa', 'am', 'my', 'yue', 'tl', 'be'];

/**
 * Names for UI locales @cospired ships no pack for. Keyed by app language,
 * then by the ISO 639-1 primary subtag (Chinese collapses to `zh` — the
 * notices say "Chinese", not "Chinese (Simplified)").
 *
 * `zh-Hant` is here because the only Chinese pack is Simplified, and
 * 德语/德語 is a visible difference to a Traditional reader.
 */
const EXTRA_LANGUAGE_NAMES = {
  hi: {
    en: 'अंग्रेज़ी',
    es: 'स्पेनिश',
    ar: 'अरबी',
    fr: 'फ़्रेंच',
    ru: 'रूसी',
    hi: 'हिन्दी',
    pt: 'पुर्तगाली',
    fa: 'फ़ारसी',
    id: 'इंडोनेशियाई',
    de: 'जर्मन',
    el: 'ग्रीक',
    zh: 'चीनी',
    ko: 'कोरियाई',
    tr: 'तुर्की',
    bn: 'बंगाली',
    vi: 'वियतनामी',
    hr: 'क्रोएशियाई',
    nl: 'डच',
    bs: 'बोस्नियाई',
    ro: 'रोमानियाई',
    kn: 'कन्नड़',
    it: 'इतालवी',
    sq: 'अल्बानियाई',
    te: 'तेलुगु',
    ms: 'मलय',
    bg: 'बल्गेरियाई',
    ne: 'नेपाली',
    az: 'अज़रबैजानी',
    sv: 'स्वीडिश',
    mk: 'मैसेडोनियाई',
    pl: 'पोलिश',
    hu: 'हंगेरियाई',
    lv: 'लातवियाई',
    uk: 'यूक्रेनी',
    ur: 'उर्दू',
    sl: 'स्लोवेनियाई',
    sk: 'स्लोवाक',
    lt: 'लिथुआनियाई',
    fi: 'फिनिश',
    da: 'डैनिश',
    cs: 'चेक',
    mr: 'मराठी',
    no: 'नॉर्वेजियाई',
    ca: 'कातालान',
    et: 'एस्टोनियाई',
    ta: 'तमिल',
    or: 'ओड़िया',
    ml: 'मलयालम',
    ja: 'जापानी',
    gu: 'गुजराती',
    si: 'सिंहली',
    th: 'थाई',
    ky: 'किर्गिज़',
    is: 'आइसलैंडिक',
    tg: 'ताजिक',
    af: 'अफ़्रीकांस',
    km: 'खमेर',
    he: 'हिब्रू',
    sr: 'सर्बियाई',
    ka: 'जॉर्जियाई',
    hy: 'अर्मेनियाई',
    gl: 'गैलिशियन',
    sw: 'स्वाहिली',
    uz: 'उज़्बेक',
    mn: 'मंगोलियाई',
    ps: 'पश्तो',
    sd: 'सिंधी',
    lb: 'लक्ज़मबर्गिश',
    so: 'सोमाली',
    pa: 'पंजाबी',
    am: 'अम्हारिक्',
    my: 'बर्मी',
    yue: 'कैंटोनीज़',
    tl: 'तागालोग',
    be: 'बेलारूसी'
  },
  tr: {
    en: 'İngilizce',
    es: 'İspanyolca',
    ar: 'Arapça',
    fr: 'Fransızca',
    ru: 'Rusça',
    hi: 'Hintçe',
    pt: 'Portekizce',
    fa: 'Farsça',
    id: 'Endonezce',
    de: 'Almanca',
    el: 'Yunanca',
    zh: 'Çince',
    ko: 'Korece',
    tr: 'Türkçe',
    bn: 'Bengalce',
    vi: 'Vietnamca',
    hr: 'Hırvatça',
    nl: 'Hollandaca',
    bs: 'Boşnakça',
    ro: 'Rumence',
    kn: 'Kannadaca',
    it: 'İtalyanca',
    sq: 'Arnavutça',
    te: 'Teluguca',
    ms: 'Malayca',
    bg: 'Bulgarca',
    ne: 'Nepalce',
    az: 'Azerbaycanca',
    sv: 'İsveççe',
    mk: 'Makedonca',
    pl: 'Lehçe',
    hu: 'Macarca',
    lv: 'Letonca',
    uk: 'Ukraynaca',
    ur: 'Urduca',
    sl: 'Slovence',
    sk: 'Slovakça',
    lt: 'Litvanca',
    fi: 'Fince',
    da: 'Danca',
    cs: 'Çekçe',
    mr: 'Marathice',
    no: 'Norveççe',
    ca: 'Katalanca',
    et: 'Estonca',
    ta: 'Tamilce',
    or: 'Oriyaca',
    ml: 'Malayalamca',
    ja: 'Japonca',
    gu: 'Gucaratça',
    si: 'Sinhalaca',
    th: 'Tayca',
    ky: 'Kırgızca',
    is: 'İzlandaca',
    tg: 'Tacikçe',
    af: 'Afrikaanca',
    km: 'Kmerce',
    he: 'İbranice',
    sr: 'Sırpça',
    ka: 'Gürcüce',
    hy: 'Ermenice',
    gl: 'Galiçyaca',
    sw: 'Svahilice',
    uz: 'Özbekçe',
    mn: 'Moğolca',
    ps: 'Peştuca',
    sd: 'Sindhice',
    lb: 'Lüksemburgca',
    so: 'Somalice',
    pa: 'Pencapça',
    am: 'Amharca',
    my: 'Birmanca',
    yue: 'Kantonca',
    tl: 'Tagalogca',
    be: 'Belarusça'
  },
  'zh-Hant': {
    en: '英語',
    es: '西班牙語',
    ar: '阿拉伯語',
    fr: '法語',
    ru: '俄語',
    hi: '印地語',
    pt: '葡萄牙語',
    fa: '波斯語',
    id: '印尼語',
    de: '德語',
    el: '希臘語',
    zh: '中文',
    ko: '韓語',
    tr: '土耳其語',
    bn: '孟加拉語',
    vi: '越南語',
    hr: '克羅埃西亞語',
    nl: '荷蘭語',
    bs: '波士尼亞語',
    ro: '羅馬尼亞語',
    kn: '坎納達語',
    it: '義大利語',
    sq: '阿爾巴尼亞語',
    te: '泰盧固語',
    ms: '馬來語',
    bg: '保加利亞語',
    ne: '尼泊爾語',
    az: '亞塞拜然語',
    sv: '瑞典語',
    mk: '馬其頓語',
    pl: '波蘭語',
    hu: '匈牙利語',
    lv: '拉脫維亞語',
    uk: '烏克蘭語',
    ur: '烏爾都語',
    sl: '斯洛維尼亞語',
    sk: '斯洛伐克語',
    lt: '立陶宛語',
    fi: '芬蘭語',
    da: '丹麥語',
    cs: '捷克語',
    mr: '馬拉地語',
    no: '挪威語',
    ca: '加泰隆尼亞語',
    et: '愛沙尼亞語',
    ta: '坦米爾語',
    or: '奧里亞語',
    ml: '馬拉雅拉姆語',
    ja: '日語',
    gu: '古吉拉特語',
    si: '僧伽羅語',
    th: '泰語',
    ky: '吉爾吉斯語',
    is: '冰島語',
    tg: '塔吉克語',
    af: '南非荷蘭語',
    km: '高棉語',
    he: '希伯來語',
    sr: '塞爾維亞語',
    ka: '喬治亞語',
    hy: '亞美尼亞語',
    gl: '加利西亞語',
    sw: '斯瓦希里語',
    uz: '烏茲別克語',
    mn: '蒙古語',
    ps: '普什圖語',
    sd: '信德語',
    lb: '盧森堡語',
    so: '索馬利語',
    pa: '旁遮普語',
    am: '阿姆哈拉語',
    my: '緬甸語',
    yue: '粵語',
    tl: '他加祿語',
    be: '白俄羅斯語'
  }
};

/** Languages @cospired has no entry for in any locale. */
const MISSING_FROM_PACKS = {
  yue: 'Cantonese'
};

/**
 * A few pack entries carry an ISO disambiguator — "Greek (modern)",
 * "Hebrew (modern)". Correct as a catalogue label, wrong inside "This article
 * is in ___". Greek alone is a top-12 source language in the feed, so the
 * qualifier would be very visible.
 */
function stripQualifier(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Resolve `code` to its name written in `locale`. Returns null when the
 * code is unknown. Exported mainly so `getLanguageName` can ask for 'en'.
 */
function getLanguageNameIn(code, locale) {
  const canonical = (0, _languageCodes.canonicalizeLanguageCode)(code);
  if (!canonical) return null;
  const primary = (0, _languageCodes.primarySubtag)(canonical);
  const override = EXTRA_LANGUAGE_NAMES[locale]?.[primary];
  if (override) return override;

  // `zh-Hant` has no pack of its own; the Simplified one is far closer for
  // a Traditional reader than English is. Same shape for any `xx-YY`.
  const packLocale = PACK_LOCALES.has(locale) ? locale : PACK_LOCALES.has((0, _languageCodes.primarySubtag)(locale)) ? (0, _languageCodes.primarySubtag)(locale) : 'en';
  const name = _i18nIsoLanguages.default.getName(primary, packLocale);
  if (name && name !== primary) return stripQualifier(name);

  // Not in the packs at all — fall back to the English stopgap, then to
  // the English pack, so an unusual code still reads as a language.
  if (MISSING_FROM_PACKS[primary]) return MISSING_FROM_PACKS[primary];
  if (packLocale !== 'en') {
    const english = _i18nIsoLanguages.default.getName(primary, 'en');
    if (english && english !== primary) return stripQualifier(english);
  }
  return null;
}

/**
 * The user-facing resolver: names a source language in the reader's app
 * language, falling back to English rather than to nothing.
 */
function getLocalizedLanguageName(code, appLanguage) {
  return getLanguageNameIn(code, appLanguage || 'en');
}
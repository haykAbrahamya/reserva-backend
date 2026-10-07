import { deriveChannel, isBotUserAgent, referrerHostOf } from './traffic-source';

/**
 * Channel and bot rules are contract §4, and the legacy-copy migration applies
 * the same rules in SQL. A table per rule, so a change shows up as a diff of
 * cases rather than a silent shift in the console's charts.
 */
describe('deriveChannel — a utm_source tag wins', () => {
  it.each([
    ['instagram', 'instagram'],
    ['ig', 'instagram'],
    ['Instagram', 'instagram'],
    [' IG ', 'instagram'],
    ['facebook', 'facebook'],
    ['fb', 'facebook'],
    ['google', 'google'],
    ['tiktok', 'tiktok'],
    ['telegram', 'telegram'],
    ['tg', 'telegram'],
    ['whatsapp', 'whatsapp'],
    ['wa', 'whatsapp'],
    ['newsletter', 'campaign'],
    ['instagram_story', 'campaign'],
    ['yandex', 'campaign'],
    ['constructor', 'campaign'], // not an inherited Object key
  ])('utm_source=%p → %s', (source, channel) => {
    expect(deriveChannel(source, '')).toBe(channel);
    // Even when the referrer says otherwise.
    expect(deriveChannel(source, 'https://t.me/')).toBe(channel);
  });

  it('ignores a blank utm_source', () => {
    expect(deriveChannel('', 'https://t.me/')).toBe('telegram');
    expect(deriveChannel('   ', '')).toBe('direct');
    expect(deriveChannel(undefined, undefined)).toBe('direct');
  });
});

describe('deriveChannel — else the referrer host', () => {
  it.each([
    ['https://www.instagram.com/', 'instagram'],
    ['https://l.instagram.com/?u=https%3A%2F%2Fantheris.reserva.am', 'instagram'],
    ['https://instagram.com/antheris', 'instagram'],
    ['https://www.facebook.com/', 'facebook'],
    ['https://m.facebook.com/', 'facebook'],
    ['https://l.facebook.com/l.php', 'facebook'],
    ['https://fb.me/abc', 'facebook'],
    ['https://fb.com/', 'facebook'],
    ['https://www.google.com/', 'google'],
    ['https://www.google.am/', 'google'],
    ['https://google.ru/search?q=salon', 'google'],
    ['https://www.google.co.uk/', 'google'],
    ['https://www.google.com.ua/', 'google'],
    ['https://www.bing.com/', 'search'],
    ['https://yandex.ru/', 'search'],
    ['https://yandex.com.tr/', 'search'],
    ['https://duckduckgo.com/', 'search'],
    ['https://search.yahoo.com/', 'search'],
    ['https://www.tiktok.com/@antheris', 'tiktok'],
    ['https://t.me/', 'telegram'],
    ['https://web.telegram.org/k/', 'telegram'],
    ['https://wa.me/37491000000', 'whatsapp'],
    ['https://web.whatsapp.com/', 'whatsapp'],
    ['https://reserva.am/salons', 'reserva'],
    ['https://antheris.reserva.am/', 'reserva'],
    ['https://www.reserva.am/', 'reserva'],
    ['https://linktr.ee/antheris', 'other'],
    ['https://chatgpt.com/', 'other'],
    ['http://localhost:5174/salons', 'other'],
    ['https://notinstagram.com/', 'other'],
    ['https://googleusercontent.com/', 'other'],
    ['android-app://com.google.android.gm/', 'other'], // the Gmail app, not Google search
    ['https://reserva.am.example.com/', 'other'],
  ])('%s → %s', (referrer, channel) => {
    expect(deriveChannel(undefined, referrer)).toBe(channel);
  });

  it('is direct with no referrer and other with one we cannot parse', () => {
    expect(deriveChannel(undefined, '')).toBe('direct');
    expect(deriveChannel(null, '  ')).toBe('direct');
    expect(deriveChannel(undefined, null)).toBe('direct');
    expect(deriveChannel(undefined, 'not a url')).toBe('other');
  });
});

describe('referrerHostOf', () => {
  it.each([
    ['https://www.Google.com/search?q=1', 'google.com'],
    ['https://L.Instagram.com/?u=x', 'l.instagram.com'],
    ['http://localhost:5174/salons', 'localhost'],
    ['https://user:pw@www.tiktok.com:443/@x', 'tiktok.com'],
    ['https://google.com./', 'google.com'],
  ])('%s → %s', (referrer, host) => {
    expect(referrerHostOf(referrer)).toBe(host);
  });

  it('is null for an empty or unparseable referrer', () => {
    for (const referrer of [undefined, null, '', '   ', 'not a url', '/relative/path']) {
      expect(referrerHostOf(referrer)).toBeNull();
    }
  });
});

describe('isBotUserAgent', () => {
  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'TelegramBot (like TwitterBot)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/154.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; moto g power) Chrome-Lighthouse',
    'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    'Mozilla/5.0 (compatible; Embedly/0.2; +http://support.embed.ly/)',
    'Mozilla/5.0 (compatible; Pingdom.com_bot_version_1.4_(http://www.pingdom.com/))',
    'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
    'Site24x7 monitoring',
    'Baiduspider+(+http://www.baidu.com/search/spider.htm)',
    'python-requests/2.31.0',
    'curl/8.4.0',
    'Wget/1.21.4',
    'Mozilla/5.0 (Macintosh) Slack-LinkExpanding Preview',
    'AhrefsBot crawler',
  ])('bot: %s', (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 389.0.0.29.81 (iPhone15,2; iOS 18_6; hy_AM; hy; scale=3.00; 1179x2556; 773312156)',
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  ])('human: %s', (ua) => {
    expect(isBotUserAgent(ua)).toBe(false);
  });

  it('does not call a missing User-Agent a bot', () => {
    expect(isBotUserAgent(undefined)).toBe(false);
    expect(isBotUserAgent('')).toBe(false);
  });
});

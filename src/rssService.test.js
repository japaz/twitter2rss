
const RSSService = require('./rssService');

describe('RSSService', () => {
  it('should generate a valid RSS feed', () => {
    const config = {
      title: 'Test Feed',
      description: 'Test Description',
      siteUrl: 'http://example.com',
      feedUrl: 'http://example.com/rss',
    };
    const tweets = [
      {
        id: '1',
        text: 'Hello world!',
        created_at: '2025-06-26T10:00:00Z',
        author_name: 'Test User',
        author_username: 'testuser',
        entities: {},
        public_metrics: {},
      },
    ];

    const rssService = new RSSService(config);
    const feed = rssService.generateFeed(tweets);

    expect(feed).toContain('<title><![CDATA[Test Feed]]></title>');
    expect(feed).toContain('<item>');
  });
});

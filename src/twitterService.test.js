
const TwitterService = require('./twitterService');
const { TwitterApi } = require('twitter-api-v2');

jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    readOnly: {
      v2: {
        listTweets: jest.fn(),
      },
    },
  })),
}));

describe('TwitterService', () => {
  let twitterService;
  let mockListTweets;

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods:
    TwitterApi.mockClear();
    // Re-mock the implementation to get a fresh mock function for each test
    mockListTweets = jest.fn();
    const mockTwitterApi = {
      readOnly: {
        v2: {
          listTweets: mockListTweets,
        },
      },
    };
    TwitterApi.mockImplementation(() => mockTwitterApi);
    twitterService = new TwitterService('test-token');
  });

  it('should fetch and process tweets correctly', async () => {
    const mockApiResponse = {
      data: [
        { id: '1', text: 'Tweet 1', author_id: '101' },
        { id: '2', text: 'Tweet 2', author_id: '102' },
      ],
      includes: {
        users: [
          { id: '101', name: 'User One', username: 'userone' },
          { id: '102', name: 'User Two', username: 'usertwo' },
        ],
      },
    };
    mockListTweets.mockResolvedValue(mockApiResponse);

    const tweets = await twitterService.getListTweets('list-id');

    expect(mockListTweets).toHaveBeenCalledWith('list-id', expect.any(Object));
    expect(tweets).toHaveLength(2);
    expect(tweets[0]).toEqual(expect.objectContaining({
      id: '1',
      text: 'Tweet 1',
      author_name: 'User One',
      author_username: 'userone',
    }));
    expect(tweets[1]).toEqual(expect.objectContaining({
      id: '2',
      text: 'Tweet 2',
      author_name: 'User Two',
      author_username: 'usertwo',
    }));
  });

  it('should handle errors from the Twitter API', async () => {
    const apiError = new Error('API Error');
    apiError.code = 404;
    mockListTweets.mockRejectedValue(apiError);

    await expect(twitterService.getListTweets('list-id')).rejects.toThrow(
      'List not found. Please check the list ID.'
    );
  });
});

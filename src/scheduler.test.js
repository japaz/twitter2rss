const AdaptiveScheduler = require('./scheduler');

// Mock dependencies
jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ stop: jest.fn() }),
}));

const mockDatabase = {
  setConfig: jest.fn(),
  getConfig: jest.fn(),
};

const mockTwitterService = {}; // Not used directly in these tests

describe('AdaptiveScheduler', () => {
  let scheduler;
  let mockFetchFunction;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    scheduler = new AdaptiveScheduler(mockDatabase, mockTwitterService, 60, 480);
    mockFetchFunction = jest.fn();
  });

  it('should decrease interval on high activity', async () => {
    mockFetchFunction.mockResolvedValue({ newTweets: 15 });
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBeLessThan(60);
    expect(scheduler.currentInterval).toBe(60 * 0.8);
  });

  it('should slightly decrease interval on moderate activity', async () => {
    mockFetchFunction.mockResolvedValue({ newTweets: 7 });
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBe(60 * 0.9);
  });

  it('should keep the same interval on low activity', async () => {
    mockFetchFunction.mockResolvedValue({ newTweets: 3 });
    const initialInterval = scheduler.currentInterval;
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBe(initialInterval);
  });

  it('should slightly increase interval on no activity', async () => {
    mockFetchFunction.mockResolvedValue({ newTweets: 0 });
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBeGreaterThan(60);
    expect(scheduler.currentInterval).toBe(60 * 1.2);
  });

  it('should significantly increase interval after 3 consecutive empty fetches', async () => {
    mockFetchFunction.mockResolvedValue({ newTweets: 0 });
    scheduler.consecutiveEmptyFetches = 2;
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBe(60 * 1.5);
    expect(scheduler.consecutiveEmptyFetches).toBe(3);
  });

  it('should reset consecutive empty fetches after finding new tweets', async () => {
    scheduler.consecutiveEmptyFetches = 3;
    mockFetchFunction.mockResolvedValue({ newTweets: 5 });
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.consecutiveEmptyFetches).toBe(0);
  });

  it('should not let interval go below minInterval', async () => {
    scheduler.currentInterval = 65;
    mockFetchFunction.mockResolvedValue({ newTweets: 15 });
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBe(60); // minInterval is 60
  });

  it('should not let interval go above maxInterval', async () => {
    scheduler.currentInterval = 450;
    mockFetchFunction.mockResolvedValue({ newTweets: 0 });
    scheduler.consecutiveEmptyFetches = 3;
    await scheduler.runFetch(mockFetchFunction);
    expect(scheduler.currentInterval).toBe(480); // maxInterval is 480
  });
});
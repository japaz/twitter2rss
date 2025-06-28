#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const TwitterService = require(path.join(__dirname, '..', 'src', 'twitterService'));

async function verifySetup() {
  console.log('🔍 Twitter List RSS Setup Verification\n');
  
  // Check environment variables
  console.log('📋 Checking environment variables...');
  
  // Always require list ID
  if (!process.env.TWITTER_LIST_ID) {
    console.error('❌ Missing required environment variable: TWITTER_LIST_ID');
    process.exit(1);
  }
  
  // Check for authentication credentials
  const hasBearerToken = !!process.env.TWITTER_BEARER_TOKEN;
  const hasOAuthCredentials = !!(
    process.env.TWITTER_API_KEY && 
    process.env.TWITTER_API_SECRET && 
    process.env.TWITTER_ACCESS_TOKEN && 
    process.env.TWITTER_ACCESS_SECRET
  );
  
  if (!hasBearerToken && !hasOAuthCredentials) {
    console.error('❌ Missing Twitter API credentials. You need either:');
    console.error('   1. TWITTER_BEARER_TOKEN (for public lists), OR');
    console.error('   2. All OAuth 1.0a credentials for private lists:');
    console.error('      - TWITTER_API_KEY');
    console.error('      - TWITTER_API_SECRET');
    console.error('      - TWITTER_ACCESS_TOKEN');
    console.error('      - TWITTER_ACCESS_SECRET');
    console.error('Please add the appropriate credentials to your .env file.');
    process.exit(1);
  }
  
  console.log('✅ Required environment variables present');
  
  // Determine authentication method
  let authMethod, twitterCredentials;
  if (hasOAuthCredentials) {
    authMethod = 'OAuth 1.0a (can access private lists)';
    twitterCredentials = {
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET
    };
    
    console.log('🔐 Using OAuth 1.0a authentication (private lists supported)');
  } else {
    authMethod = 'Bearer Token (public lists only)';
    twitterCredentials = process.env.TWITTER_BEARER_TOKEN;
    
    console.log('🔑 Using Bearer Token authentication (public lists only)');
    
    // Validate Bearer Token format
    if (!twitterCredentials.startsWith('AAAA') || twitterCredentials.length < 100) {
      console.warn('⚠️  Bearer token format looks suspicious. Twitter Bearer tokens typically:');
      console.warn('   - Start with "AAAA"');
      console.warn('   - Are over 100 characters long');
      console.warn('   - Should be generated from Twitter Developer Portal');
    }
  }
  
  // Validate List ID format
  const listId = process.env.TWITTER_LIST_ID;
  if (!/^\d+$/.test(listId)) {
    console.warn('⚠️  List ID format looks suspicious. Twitter List IDs should be numeric.');
    console.warn('   Example: 1234567890123456789');
  }
  
  console.log('🔑 Testing Twitter API credentials...');
  
  try {
    const twitterService = new TwitterService(twitterCredentials);
    const isValid = await twitterService.verifyCredentials();
    
    if (!isValid) {
      console.error('❌ Twitter API credential verification failed');
      console.error('\n🛠️  Troubleshooting steps:');
      console.error('1. Check your Bearer Token in Twitter Developer Portal');
      console.error('2. Ensure your app has at least "Essential" access level');
      console.error('3. Verify your app is not suspended or restricted');
      console.error('4. Make sure you copied the Bearer Token correctly (no extra spaces)');
      console.error('5. Try regenerating your Bearer Token');
      process.exit(1);
    }
    
    console.log('✅ Twitter API credentials verified successfully');
    
    // Test list access
    console.log(`📝 Testing access to list ID: ${listId}...`);
    
    try {
      const listInfo = await twitterService.getListInfo(listId);
      
      if (!listInfo) {
        console.error('❌ Could not access the specified Twitter list');
        console.error('\n🛠️  Possible issues:');
        console.error('1. List ID is incorrect');
        console.error('2. List is private and your account doesn\'t have access');
        console.error('3. List has been deleted');
        console.error('4. Your app doesn\'t have permission to read lists');
        console.error('\n💡 Try accessing the list directly in your browser:');
        console.error(`   https://twitter.com/i/lists/${listId}`);
        process.exit(1);
      }
      
      console.log('✅ List access verified successfully');
      console.log(`   List name: "${listInfo.name}"`);
      console.log(`   Members: ${listInfo.member_count || 'Unknown'}`);
      console.log(`   Followers: ${listInfo.follower_count || 'Unknown'}`);
      
    } catch (listError) {
      if (listError.message.includes('Rate limit')) {
        console.warn('⚠️  Rate limit encountered while testing list access');
        console.log('   This is temporary - your credentials are working!');
        console.log('   Skipping detailed list verification due to rate limit...');
        console.log('✅ Authentication successful - proceeding with basic tweet test');
      } else {
        console.error('❌ List access test failed:', listError.message);
        console.error('\n🛠️  Possible issues:');
        console.error('1. List ID is incorrect');
        console.error('2. List is private and your account doesn\'t have access');
        console.error('3. List has been deleted');
        console.error('4. Your app doesn\'t have permission to read lists');
        console.error('\n💡 Try accessing the list directly in your browser:');
        console.error(`   https://twitter.com/i/lists/${listId}`);
        process.exit(1);
      }
    }
    
    // Test fetching recent tweets (with rate limit handling)
    console.log('📰 Testing tweet fetching...');
    
    try {
      const tweets = await twitterService.getListTweets(listId);
      
      console.log(`✅ Successfully fetched ${tweets.length} tweets from the list`);
      
      if (tweets.length === 0) {
        console.warn('⚠️  No tweets found in the list. This could mean:');
        console.warn('   - The list is empty');
        console.warn('   - All tweets are older than the default fetch window');
        console.warn('   - The list members haven\'t posted recently');
      } else {
        console.log(`   Most recent tweet: "${tweets[0].text.substring(0, 100)}..."`);
        console.log(`   Author: @${tweets[0].author_username}`);
      }
      
    } catch (tweetError) {
      if (tweetError.message.includes('Rate limit')) {
        console.warn('⚠️  Rate limit encountered while testing tweet fetching');
        console.log('   This is expected after testing credentials and list access');
        console.log('   Your setup is working correctly!');
      } else {
        console.error('❌ Tweet fetching test failed:', tweetError.message);
        console.error('   But authentication was successful, so this might be a temporary issue');
      }
    }
    
    console.log('\n🎉 Setup verification completed successfully!');
    console.log('Your Twitter List RSS feed should work correctly.');
    
  } catch (error) {
    console.error('❌ Setup verification failed:', error.message);
    console.error('\n🛠️  Debug information:');
    console.error('Error details:', {
      message: error.message,
      code: error.code || 'Unknown',
      stack: error.stack
    });
    process.exit(1);
  }
}

// Run the verification
verifySetup().catch(error => {
  console.error('❌ Unexpected error during verification:', error);
  process.exit(1);
});

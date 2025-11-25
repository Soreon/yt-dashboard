// Example configuration - Copy these values to app.js and index.html

// ==================================================
// STEP 1: Get your credentials from Google Cloud Console
// ==================================================

// Visit: https://console.cloud.google.com/

// 1. Create a project (or select existing)
// 2. Enable "YouTube Data API v3"
// 3. Create API Key: APIs & Services > Credentials > Create Credentials > API key
// 4. Create OAuth Client: APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID
//    - Application type: Web application
//    - Authorized JavaScript origins: http://localhost:8000, https://yourdomain.com
//    - Authorized redirect URIs: http://localhost:8000, https://yourdomain.com

// ==================================================
// STEP 2: Replace in app.js (lines 4-5)
// ==================================================

const API_KEY = 'AIzaSy...your_api_key_here...xyz123';
const CLIENT_ID = '123456789-abc...your_client_id...apps.googleusercontent.com';

// ==================================================
// STEP 3: Replace in index.html (line 14)
// ==================================================

// Find this line:
// data-client_id="YOUR_CLIENT_ID.apps.googleusercontent.com"

// Replace with:
// data-client_id="123456789-abc...your_client_id...apps.googleusercontent.com"

// Note: The exact line number may vary. Look for the div with id="g_id_onload"

// ==================================================
// STEP 4: Serve the application
// ==================================================

// Choose one of these methods:

// Python 3:
// python -m http.server 8000

// Python 2:
// python -m SimpleHTTPServer 8000

// Node.js (npx):
// npx http-server -p 8000

// PHP:
// php -S localhost:8000

// Then open: http://localhost:8000

// ==================================================
// IMPORTANT NOTES
// ==================================================

// 1. Never commit your actual API keys to version control
// 2. Add sensitive values to .gitignore if needed
// 3. The API key is visible in client-side code - this is expected for YouTube API
// 4. For production, add domain restrictions in Google Cloud Console
// 5. Monitor your API quota usage in Google Cloud Console

// ==================================================
// QUOTA INFORMATION
// ==================================================

// Default quota: 10,000 units per day
// subscriptions.list: 1 unit per request
// channels.list: 1 unit per request

// Example usage:
// - 100 subscriptions: ~3 units (1 for subs + 2 for channels with batching)
// - With cache: ~1 unit on subsequent loads

// To increase quota, request quota increase in Google Cloud Console

// Which build this is: 'test' or 'production'.
// This file always says 'test'. The store (production) build of the Android app
// replaces it with its own copy (android/app/src/production/assets/public/env.js),
// so real ads can only ever appear in the store build.
window.APP_ENV = 'test';

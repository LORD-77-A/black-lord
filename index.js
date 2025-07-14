// index.js

const config = require('./config.json');
const client = require('./bot');

// تسجيل الدخول
client.login(config.token);

// تشغيل لوحة التحكم
require('./dashboard');
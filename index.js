// index.js

// تحميل متغيرات البيئة من ملف .env
require('dotenv').config();

// تحميل ملف البوت الرئيسي
const client = require('./bot');

// تشغيل لوحة التحكم (Dashboard)
require('./dashboard');

// تسجيل الدخول إلى Discord باستخدام التوكن من .env
client.login(process.env.TOKEN);
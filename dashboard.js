const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');
const { exec } = require('child_process');

const configPath = path.join(__dirname, 'config.json');
const rulePath = path.join(__dirname, 'rule.json');

let config = JSON.parse(fs.readFileSync(configPath));
let rule = JSON.parse(fs.readFileSync(rulePath));

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// تحديث config و rule من الملفات بعد كل تعديل لتجنب عدم التزامن
function reloadConfig() {
    config = JSON.parse(fs.readFileSync(configPath));
}
function reloadRule() {
    rule = JSON.parse(fs.readFileSync(rulePath));
}

// ✅ Get full config
app.get('/config.json', (req, res) => {
    res.sendFile(configPath);
});

// ✅ Get all channels
app.get('/api/channels', (req, res) => {
    reloadConfig();
    res.json(config.channels);
});

// ✅ Update specific channel (name & tags)
app.post('/api/channels/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    const { name, tags } = req.body;
    if (!Array.isArray(tags) || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'صيغة البيانات غير صحيحة' });
    }
    if (!config.channels[id]) config.channels[id] = {};
    config.channels[id].name = name;
    config.channels[id].tags = tags;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// ✅ Add new channel
app.post('/api/channels', (req, res) => {
    reloadConfig();
    const { id, name, tags } = req.body;
    if (!id || !name || !Array.isArray(tags)) {
        return res.status(400).json({ success: false });
    }
    config.channels[id] = { name, tags, bannedTags: [] };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// ✅ Delete channel
app.delete('/api/channels/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    if (config.channels[id]) {
        delete config.channels[id];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, message: 'الروم غير موجود' });
});

// ✅ Get global banned tags
app.get('/api/banned', (req, res) => {
    reloadConfig();
    res.json(config.bannedTags || []);
});

// ✅ Update global banned tags
app.post('/api/banned', (req, res) => {
    reloadConfig();
    config.bannedTags = req.body.bannedTags || [];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// ✅ Get per-channel banned tags
app.get('/api/channel-banned/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    const ch = config.channels[id];
    if (!ch) return res.status(404).json({ success: false, message: 'الروم غير موجود' });
    res.json(ch.bannedTags || []);
});

// ✅ Update per-channel banned tags
app.post('/api/channel-banned/:id', (req, res) => {
    reloadConfig();
    const { id } = req.params;
    const { bannedTags } = req.body;
    if (!Array.isArray(bannedTags)) return res.status(400).json({ success: false });
    if (!config.channels[id]) return res.status(404).json({ success: false, message: 'الروم غير موجود' });

    config.channels[id].bannedTags = bannedTags;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// ✅ Get summaryChannel (ككائن يحتوي على id و name)
app.get('/api/summary-channel', (req, res) => {
    reloadConfig();
    res.json({
        summaryChannel: config.summaryChannel || { id: '', name: '' }
    });
});

// ✅ Update summaryChannel (ككائن يحتوي على id و name)
app.post('/api/summary-channel', (req, res) => {
    reloadConfig();
    const { summaryChannel, summaryChannelName } = req.body;

    if (!summaryChannel) {
        return res.status(400).json({ success: false, message: 'Missing summaryChannel ID' });
    }

    config.summaryChannel = {
        id: summaryChannel,
        name: summaryChannelName || ''
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
});

// ✅ Get roles (رولات) مع الاسم والآيدي
app.get('/api/rules', (req, res) => {
    reloadRule();
    res.json(rule);
});

// ✅ Update roles (رولات) مع الاسم والآيدي
app.post('/api/rules/:command', (req, res) => {
    reloadRule();
    const { command } = req.params;
    const roles = req.body.roles;

    if (!Array.isArray(roles)) return res.status(400).json({ success: false });
    for (const r of roles) {
        if (!r.id || !r.name) {
            return res.status(400).json({ success: false, message: 'كل رول يجب أن يحتوي على id و name' });
        }
    }

    rule[command] = roles;

    fs.writeFileSync(rulePath, JSON.stringify(rule, null, 2));
    res.json({ success: true });
});

// ✅ Bot status control
app.post('/api/bot-status', (req, res) => {
    reloadConfig();
    const { status } = req.body;
    if (!['running', 'stopped'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    config.botStatus = status;
    config.startTime = status === 'running' ? Date.now() : null;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const cmd = status === 'running' ? 'pm2 start bot' : 'pm2 stop bot';
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ success: false, message: stderr });
        }
        res.json({ success: true, message: stdout });
    });
});

// ✅ Bot uptime
app.get('/api/uptime', (req, res) => {
    reloadConfig();
    if (!config.startTime) return res.json({ uptime: 0 });
    const diffMs = Date.now() - config.startTime;
    res.json({ uptime: diffMs });
});

// ✅ Serve main dashboard page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Dashboard running at http://localhost:${PORT}`);
});
